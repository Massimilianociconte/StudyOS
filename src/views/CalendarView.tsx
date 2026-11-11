import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { useShallow } from "zustand/react/shallow";
import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek
} from "date-fns";
import { it } from "date-fns/locale";
import { useStudyStore } from "../store/useStudyStore";
import { sharedOfTypes, useSharedStore } from "../store/useSharedStore";
import { changedFields, originOf, ownerColor, safeCssColor, sharedKey, ShareUserError, type SharedEntity, type SharedOrigin } from "../lib/sharing";
import { SharedMark } from "../components/SharedMark";
import { createId } from "../lib/id";
import type { CalendarEvent, EventCategory, Exam, Task } from "../types";
import {
  Button,
  DIMMED_DISABLED_FIELDS,
  EmptyState,
  Field,
  HelpTip,
  IconButton,
  PageActions,
  Panel,
  SectionTitle,
  Segmented,
  Tag,
  inputClass,
  type PageAction
} from "../components/ui";
import { Icon } from "../components/Icon";
import { BarbExamImport } from "../components/BarbExamImport";
import { SEMESTER_LABEL, SEMESTER_TONE, subjectSemester } from "../lib/semesters";
import { safeHref } from "../lib/safeUrl";
import { CalendarTransfer, type CalendarTransferHandle } from "../components/CalendarTransfer";
import { TaskEditorModal } from "../components/TaskEditorModal";
import { allDayRange, daysUntil, selectableSubjects, shortDate, subjectColor, subjectName } from "../lib/selectors";
import { expandEvents, RECURRENCE_LABEL, type EventOccurrence } from "../lib/recurrence";
import {
  ALL_DAY_LABEL,
  CALENDAR_HELP,
  CALENDAR_TEXT,
  CALENDAR_VIEW_TEXT,
  EVENT_CATEGORY_LABEL,
  EVENT_STATUS_LABEL,
  EXAM_STATUS_LABEL,
  NO_SUBJECT_LABEL,
  OFFICIAL_EXAMS_ADD_LABEL,
  PRIORITY_LABEL,
  SHARE_TEXT,
  eventLinkLabel,
  formatMinutes
} from "../lib/labels";
import { isNullableString, oneOf, useUiState, writeUiState } from "../lib/uiState";
import { CourseIcon } from "../components/CourseIcon";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { resolveBarbCourse } from "../lib/university/examSessions";
import { cloudConfigured } from "../lib/cloudSyncState";
import {
  STORED_CALENDAR_MODES,
  dayForNewEvent,
  filterCalendarItems,
  hasItemsInRange,
  isCalendarSummary,
  resolveCalendarMode,
  resolveSubjectFilter,
  subjectCalendarSummary,
  type CalendarViewId,
  type SubjectCalendarSummary
} from "../lib/calendarFilter";
import { Agenda } from "../components/calendar/Agenda";
import { CalendarHoverPreview } from "../components/calendar/CalendarHoverPreview";
import { CalendarFilterRow } from "../components/calendar/CalendarFilters";
import { UndatedTasksDrawer } from "../components/calendar/UndatedTasks";
import { holidaysInRange } from "../lib/holidays";
import { undatedDueDate, undatedTasks } from "../lib/calendarRender";
import { todayYmd } from "../lib/datePicker";
import { DayList } from "../components/calendar/DayList";
import { MonthGrid } from "../components/calendar/MonthGrid";
import { TimeGrid } from "../components/calendar/TimeGrid";
import { defaultStartFor } from "../components/calendar/shared";

// Pannello Condividi (e CloudPanel con supabase-js) caricato solo quando si apre dal menu.
const loadShareDrawer = () => import("../components/ShareDrawer");
const ShareDrawer = lazy(() => loadShareDrawer().then((module) => ({ default: module.ShareDrawer })));

type StoredCalendarMode = (typeof STORED_CALENDAR_MODES)[number];
type Subjects = ReturnType<typeof useStudyStore.getState>["subjects"];

/** Occorrenza del calendario: propria, oppure di un'altra persona (`sharedFrom`). */
type CalendarOccurrence = EventOccurrence & { sharedFrom?: SharedOrigin };
type SharedCalendarEvent = CalendarEvent & { sharedFrom: SharedOrigin };
/** Evento mostrato (chip, anteprima, editor): proprio o di un'altra persona. */
type ShownEvent = CalendarEvent & { sharedFrom?: SharedOrigin };
/** Calendario di un'altra persona in cui posso aggiungere eventi, con le sue materie condivise. */
interface WritableCalendar {
  ownerId: string;
  name: string;
  subjects: { id: string; name: string; color: string }[];
  /** Ogni condivisione con "Può modificare" è limitata ad alcune materie: l'evento ne deve avere una. */
  subjectRequired: boolean;
}

/**
 * Evento di un'altra persona come lo usa il calendario. Sono dati di altri: senza titolo e orari
 * validi non si mostra, i testi e le liste mancanti diventano vuoti (niente errori nella vista).
 */
const sharedCalendarEvent = (entity: SharedEntity): CalendarEvent | null => {
  const { title, start, end } = entity;
  if (typeof title !== "string" || typeof start !== "string" || typeof end !== "string") return null;
  if (Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return null;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);
  const event = entity as unknown as CalendarEvent;
  return {
    ...event,
    description: text(entity.description),
    notes: text(entity.notes),
    // Colore scelto da un'altra persona: solo esadecimale (mai un url() da scaricare); se manca, quello di riserva.
    color: safeCssColor(entity.color),
    tags: strings(entity.tags),
    links: strings(entity.links),
    checklist: Array.isArray(entity.checklist) ? event.checklist : [],
    attachmentIds: strings(entity.attachmentIds)
  };
};

/** Campi dell'evento che cambiano insieme: se ne cambia uno, una modifica a un evento altrui li manda tutti. */
const LINKED_EVENT_FIELDS = [
  ["start", "end", "allDay"],
  ["recurrence", "recurrenceUntil"]
] as const;

/** Errore di una scrittura sui dati altrui: il testo dello store (già in italiano) o quello di riserva. */
const sharedFailure = (cause: unknown, fallback: string) => (cause instanceof ShareUserError ? cause.message : fallback);

// Quattro viste nel selettore; gli id restano quelli salvati in "calendar.mode". I riepiloghi
// ("exam", "semester") si aprono dal menu "Altre azioni"; la vecchia "Giornata di studio" ("focus")
// è l'opzione "Solo 8–19, ore grandi" di Giorno (vedi resolveCalendarMode).
const modes: { id: CalendarViewId; label: string; title: string }[] = [
  { id: "day", label: "Giorno", title: "Un giorno, ora per ora" },
  { id: "week", label: "Settimana", title: "Sette giorni con gli orari (sul telefono, un elenco giorno per giorno)" },
  { id: "month", label: "Mese", title: "Tutto il mese, un riquadro per giorno" },
  { id: "agenda", label: "Agenda", title: "Elenco di eventi, scadenze ed esami delle prossime due settimane" }
];

const categories = (Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]).map((id) => ({ id, label: EVENT_CATEGORY_LABEL[id] }));

const toDatetimeLocal = (date: string | Date) => {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

type PreviewPoint = { x: number; y: number };
type CalendarPreviewState =
  | { kind: "event"; event: ShownEvent; x: number; y: number }
  | { kind: "task"; task: Task; x: number; y: number };

const supportsHoverPreview = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

interface Handlers {
  subjects: Subjects;
  onEditEvent: (id: string, ownerId?: string) => void;
  onEditTask: (id: string) => void;
  onToggleTask: (id: string) => void;
  onCreate: (at: Date, kind?: "event" | "task") => void;
  /** Apre l'esame nella sezione Esami. */
  onOpenExam: (id: string) => void;
  onMoveEvent: (occurrence: CalendarOccurrence, nextStart: Date) => void;
  onPreviewEvent: (event: ShownEvent, point: PreviewPoint) => void;
  onPreviewTask: (task: Task, point: PreviewPoint) => void;
  onPreviewMove: (point: PreviewPoint) => void;
  onPreviewHide: () => void;
}

export function CalendarView() {
  // Valori salvati di prima ancora validi: "focus" diventa Giorno con "Solo 8–19", "exam" e
  // "semester" sono i riepiloghi del menu.
  const [storedMode, setMode] = useUiState<StoredCalendarMode>("calendar.mode", "week", { validate: oneOf(...STORED_CALENDAR_MODES) });
  const [storedDayFocus, setDayFocus] = useUiState<boolean>("calendar.dayFocus", false, { validate: (value) => typeof value === "boolean" });
  const { mode, dayFocus } = resolveCalendarMode(storedMode, storedDayFocus);
  useEffect(() => {
    if (storedMode !== "focus") return;
    setDayFocus(true);
    setMode("day");
  }, [storedMode, setDayFocus, setMode]);
  // Vista da cui si è aperto un riepilogo: "Torna al calendario" riporta lì.
  const returnMode = useRef<CalendarViewId>("week");
  const openSummary = (summary: "exam" | "semester") => {
    if (!isCalendarSummary(mode)) returnMode.current = mode;
    setMode(summary);
  };
  // Data visualizzata e dettaglio aperto restano dopo un refresh della scheda.
  const [cursorIso, setCursorIso] = useUiState("calendar.cursor", () => new Date().toISOString(), {
    scope: "tab",
    validate: (value) => typeof value === "string" && !Number.isNaN(Date.parse(value))
  });
  const cursor = useMemo(() => new Date(cursorIso), [cursorIso]);
  const setCursor = useCallback(
    (next: Date | ((current: Date) => Date)) => setCursorIso((iso) => (typeof next === "function" ? next(new Date(iso)) : next).toISOString()),
    [setCursorIso]
  );
  const [editingEventId, setEditingEventId] = useUiState<string | null>("calendar.editingEvent", null, { scope: "tab", validate: isNullableString });
  const [editingTaskId, setEditingTaskId] = useUiState<string | null>("calendar.editingTask", null, { scope: "tab", validate: isNullableString });
  const [creator, setCreator] = useState<{ at: Date; kind: "event" | "task"; subjectId?: string } | null>(null);
  const [preview, setPreview] = useState<CalendarPreviewState | null>(null);
  const [barbImportOpen, setBarbImportOpen] = useState(false);
  const [sharePhase, setSharePhase] = useState<"idle" | "loading" | "open">("idle");
  const transfer = useRef<CalendarTransferHandle>(null);
  const { events, subjects, exams, tasks, loading, locked, updateEvent, addEvent, deleteEvent, addTask, updateTask, toggleTask, deleteTask, setActiveView } =
    useStudyStore();
  // Filtro per materia: vale solo per una materia che esiste e non è archiviata. Un id non più
  // valido si toglie, ma solo a dati caricati (prima l'elenco delle materie è ancora vuoto).
  const [storedSubject, setStoredSubject] = useUiState<string | null>("calendar.subject", null, { scope: "tab", validate: isNullableString });
  const subjectFilter = resolveSubjectFilter(storedSubject, subjects);
  const filterSubject = subjectFilter ? subjects.find((subject) => subject.id === subjectFilter) ?? null : null;
  useEffect(() => {
    if (storedSubject && !subjectFilter && !loading && !locked) setStoredSubject(null);
  }, [storedSubject, subjectFilter, loading, locked, setStoredSubject]);
  /** Nuovo evento o attività: con un filtro attivo, già legato a quella materia (altrimenti sparirebbe dalla vista). */
  const openCreator = (at: Date, kind: "event" | "task" = "event") => setCreator({ at, kind, subjectId: subjectFilter ?? undefined });
  const openExam = (id: string) => {
    writeUiState("exams.editing", id, "tab");
    setActiveView("exams");
  };
  const openShare = () => {
    if (sharePhase !== "idle") return;
    setSharePhase("loading");
    loadShareDrawer().then(
      () => setSharePhase("open"),
      () => {
        setSharePhase("idle");
        setNotice(SHARE_TEXT.loadFailed);
      }
    );
  };
  const { sharedItems, received, labels, hiddenOwners } = useSharedStore(
    useShallow((state) => ({ sharedItems: state.items, received: state.received, labels: state.labels, hiddenOwners: state.hiddenOwners }))
  );
  const [editingSharedKey, setEditingSharedKey] = useUiState<string | null>("calendar.editingShared", null, { scope: "tab", validate: isNullableString });
  // Avviso sopra il calendario: spostamento non riuscito, evento altrui non più condiviso.
  const [notice, setNotice] = useState("");
  // Bozza non salvata nell'editor di un evento altrui: se la condivisione sparisce, lo si dice.
  const sharedDraftDirty = useRef(false);
  // Persone viste tra chi mi condivide il calendario, in questa sessione della vista.
  const seenOwners = useRef(new Set<string>());
  const closeSharedEditor = () => {
    sharedDraftDirty.current = false;
    setEditingSharedKey(null);
  };
  const sharedEvents = useMemo<SharedCalendarEvent[]>(
    () =>
      sharedOfTypes({ items: sharedItems, hiddenOwners }, ["calendarEvent"]).flatMap((entry) => {
        const event = sharedCalendarEvent(entry.entity);
        return event ? [{ ...event, sharedFrom: originOf(received, entry, labels) }] : [];
      }),
    [sharedItems, hiddenOwners, received, labels]
  );
  const editingShared = editingSharedKey
    ? sharedEvents.find((event) => sharedKey(event.sharedFrom.ownerId, "calendarEvent", event.id) === editingSharedKey) ?? null
    : null;
  /** Persone che condividono calendario o appelli con me (per il filtro). */
  const calendarOwners = useMemo(() => {
    const owners = new Map<string, string>();
    for (const grant of received) {
      if (grant.scope === "calendar" || grant.scope === "barb_exams") owners.set(grant.ownerId, grant.ownerName || "Un'altra persona");
    }
    return [...owners.entries()].map(([id, name]) => ({ id, name }));
  }, [received]);
  // L'evento altrui aperto si chiude quando quella persona non mi condivide più né calendario né appelli.
  // Non basta che manchi l'evento: col vault i dati altrui sono solo in memoria e, dopo un refresh,
  // arrivano dal server poco dopo. Per lo stesso motivo un elenco ancora vuoto non chiude nulla,
  // a meno che quella persona non ci fosse già prima.
  useEffect(() => {
    for (const owner of calendarOwners) seenOwners.current.add(owner.id);
    if (!editingSharedKey) return;
    const ownerId = editingSharedKey.slice(0, editingSharedKey.indexOf(":"));
    if (calendarOwners.some((owner) => owner.id === ownerId)) return;
    if (!received.length && !seenOwners.current.has(ownerId)) return;
    if (sharedDraftDirty.current) setNotice("L'evento che stavi modificando non è più condiviso con te: le modifiche non salvate sono andate perse.");
    closeSharedEditor();
  }, [calendarOwners, received, editingSharedKey]);
  // L'avviso riguarda la vista in cui è nato: cambiando vista sparisce.
  useEffect(() => setNotice(""), [mode]);
  /** Calendari altrui in cui posso aggiungere eventi ("Nel calendario di"), con le sole materie del proprietario. */
  const writableCalendars = useMemo(() => {
    const result = new Map<string, WritableCalendar>();
    for (const grant of received) {
      if (grant.scope !== "calendar" || grant.permission !== "edit") continue;
      const ownLabels = labels.filter((label) => label.ownerId === grant.ownerId && (!grant.subjectIds.length || grant.subjectIds.includes(label.id)));
      const current = result.get(grant.ownerId);
      const subjectsOf = [...(current?.subjects ?? []), ...ownLabels.map(({ id, name, color }) => ({ id, name, color: safeCssColor(color) }))];
      result.set(grant.ownerId, {
        ownerId: grant.ownerId,
        name: grant.ownerName || "Un'altra persona",
        subjects: subjectsOf.filter((subject, index) => subjectsOf.findIndex((other) => other.id === subject.id) === index),
        subjectRequired: (current?.subjectRequired ?? true) && grant.subjectIds.length > 0
      });
    }
    return [...result.values()];
  }, [received, labels]);
  const calendarTasks = useMemo(() => tasks.filter((task) => task.dueDate && task.status !== "archived"), [tasks]);
  // Festività italiane: calcolate per il periodo visibile, mai salvate né esportate; non contano negli
  // stati vuoti e il filtro per materia non le tocca. "Festività" le spegne (scelta del dispositivo).
  const [showHolidays, setShowHolidays] = useUiState<boolean>("calendar.holidays", true, {
    scope: "device",
    validate: (value) => typeof value === "boolean"
  });
  // Attività senza data ("Senza data · N" in Giorno e Agenda), con lo stesso filtro per materia.
  const [undatedOpen, setUndatedOpen] = useState(false);
  const undated = useMemo(() => filterCalendarItems({ tasks: undatedTasks(tasks) }, subjectFilter).tasks, [tasks, subjectFilter]);
  const placeUndated = (taskId: string, day: string) => {
    const dueDate = undatedDueDate(day);
    if (dueDate) void updateTask(taskId, { dueDate });
  };
  const editingEvent = editingEventId ? events.find((event) => event.id === editingEventId) ?? null : null;
  const editingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) ?? null : null;

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [cursor]);

  const range = useMemo(() => {
    if (mode === "month") return { from: monthDays[0], to: addDays(monthDays[monthDays.length - 1], 1) };
    if (mode === "week") return { from: weekDays[0], to: addDays(weekDays[6], 1) };
    if (mode === "agenda") return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 14) };
    return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 1) };
  }, [mode, cursor, monthDays, weekDays]);

  const occurrences = useMemo<CalendarOccurrence[]>(() => {
    const own = expandEvents(events, range.from, range.to);
    // Chiave con il proprietario: due persone possono avere lo stesso id (es. stesso appello importato).
    const shared = expandEvents(sharedEvents, range.from, range.to).map((item) => ({
      ...item,
      occurrenceKey: `${item.sharedFrom.ownerId}:${item.occurrenceKey}`
    }));
    return [...own, ...shared].sort((a, b) => a.start.localeCompare(b.start));
  }, [events, sharedEvents, range]);

  // Ciò che le quattro viste mostrano, filtrato per materia (senza filtro: gli stessi elenchi).
  const visible = useMemo(
    () => filterCalendarItems({ occurrences, tasks: calendarTasks, exams }, subjectFilter),
    [occurrences, calendarTasks, exams, subjectFilter]
  );
  const holidays = useMemo(() => (showHolidays ? holidaysInRange(todayYmd(range.from), todayYmd(range.to)) : []), [showHolidays, range]);
  const rangeEmpty = !hasItemsInRange(visible, range.from, range.to);
  const subjectSummary = useMemo(() => subjectCalendarSummary({ subjects, events, exams, tasks }), [subjects, events, exams, tasks]);
  const addForSubject = () => openCreator(defaultStartFor(dayForNewEvent(range.from, range.to)));
  const subjectEmpty = filterSubject ? (
    <SubjectEmptyNotice name={filterSubject.name} onAdd={addForSubject} onClear={() => setStoredSubject(null)} />
  ) : null;

  const navigate = (direction: -1 | 1) => {
    setCursor((current) => {
      if (mode === "day") return addDays(current, direction);
      if (mode === "week") return addWeeks(current, direction);
      if (mode === "agenda") return addDays(current, direction * 14);
      return addMonths(current, direction);
    });
  };

  const periodLabel =
    mode === "month"
      ? format(cursor, "MMMM yyyy", { locale: it })
      : mode === "week"
        ? `${format(weekDays[0], "d MMM", { locale: it })} – ${format(weekDays[6], "d MMM yyyy", { locale: it })}`
        : mode === "agenda"
          ? `${format(range.from, "d MMM", { locale: it })} – ${format(addDays(range.to, -1), "d MMM", { locale: it })}`
          : mode === "day"
            ? format(cursor, "EEEE d MMMM yyyy", { locale: it })
            : "";
  const summary = isCalendarSummary(mode);

  const moveEvent = async (item: CalendarOccurrence, nextStart: Date) => {
    const origin = item.sharedFrom;
    if (origin && !origin.canEdit) return;
    const series: ShownEvent | undefined = origin
      ? sharedEvents.find((event) => event.id === item.id && event.sharedFrom.ownerId === origin.ownerId)
      : events.find((event) => event.id === item.id);
    if (!series || Number.isNaN(nextStart.getTime())) return;
    // Spostare un'occorrenza sposta l'intera serie dello stesso scarto (niente eccezioni per singola data).
    const delta = nextStart.getTime() - parseISO(item.start).getTime();
    if (!delta) return;
    if (item.recurring && !window.confirm(`"${series.title}" si ripete: spostando questa data si spostano allo stesso modo anche tutte le altre. Continuare?`)) return;
    const start = new Date(parseISO(series.start).getTime() + delta);
    const end = new Date(parseISO(series.end).getTime() + delta);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    if (origin) {
      // Solo dallo store dei dati altrui (controlla il permesso e mette in coda la scrittura), sull'ultima
      // versione salvata: cambiano solo gli orari, il resto resta com'è per il proprietario.
      const latest = useSharedStore.getState().items.find((entry) => entry.key === sharedKey(origin.ownerId, "calendarEvent", series.id))?.entity;
      if (!latest) return;
      try {
        await useSharedStore.getState().saveSharedItem(origin.ownerId, "calendarEvent", { ...latest, start: start.toISOString(), end: end.toISOString() });
        setNotice("");
      } catch (cause) {
        setNotice(sharedFailure(cause, `"${series.title}" non è stato spostato. Riprova.`));
      }
      return;
    }
    await updateEvent(series.id, { start: start.toISOString(), end: end.toISOString() });
    setNotice("");
  };

  const handlers: Handlers = {
    subjects,
    onEditEvent: (id, ownerId) => (ownerId ? setEditingSharedKey(sharedKey(ownerId, "calendarEvent", id)) : setEditingEventId(id)),
    onEditTask: setEditingTaskId,
    onToggleTask: (id) => void toggleTask(id),
    onCreate: (at, kind = "event") => openCreator(at, kind),
    onOpenExam: openExam,
    onMoveEvent: (item, nextStart) => void moveEvent(item, nextStart),
    onPreviewEvent: (event, point) => {
      if (supportsHoverPreview()) setPreview({ kind: "event", event, x: point.x, y: point.y });
    },
    onPreviewTask: (task, point) => {
      if (supportsHoverPreview()) setPreview({ kind: "task", task, x: point.x, y: point.y });
    },
    onPreviewMove: (point) => setPreview((current) => (current ? { ...current, x: point.x, y: point.y } : current)),
    onPreviewHide: () => setPreview(null)
  };

  return (
    <div>
      <SectionTitle
        title="Calendario"
        subtitle={CALENDAR_TEXT.subtitle}
        action={
          // Una sola azione primaria; il resto, che si usa di rado, nel menu "Altre azioni".
          <PageActions
            primary={
              <Button icon="Plus" variant="primary" onClick={() => openCreator(defaultStartFor(new Date()))}>
                {CALENDAR_TEXT.newEvent}
              </Button>
            }
            more={[
              { label: OFFICIAL_EXAMS_ADD_LABEL, icon: "CalendarPlus", onClick: () => setBarbImportOpen(true) },
              { label: CALENDAR_TEXT.importFile, icon: "Import", onClick: () => transfer.current?.chooseFile() },
              { label: CALENDAR_TEXT.exportFile, icon: "Download", onClick: () => transfer.current?.exportFile() },
              ...(cloudConfigured ? [{ label: CALENDAR_TEXT.share, icon: "Share2", onClick: openShare } satisfies PageAction] : []),
              {
                label: CALENDAR_TEXT.officialDates,
                icon: "Landmark",
                onClick: () => {
                  writeUiState("exams.tab", "barb", "device");
                  setActiveView("exams");
                }
              },
              { label: CALENDAR_TEXT.subjectSummary, icon: "BookOpen", onClick: () => openSummary("semester") },
              { label: CALENDAR_TEXT.examSummary, icon: "GraduationCap", onClick: () => openSummary("exam") }
            ]}
          />
        }
      />
      <CalendarTransfer ref={transfer} buttons={false} />
      {barbImportOpen ? <BarbExamImport onClose={() => setBarbImportOpen(false)} /> : null}
      {sharePhase === "open" ? (
        <Suspense fallback={null}>
          <ShareDrawer open onClose={() => setSharePhase("idle")} initialScopes={["calendar"]} />
        </Suspense>
      ) : null}

      {summary ? (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <Button variant="soft" icon="ChevronLeft" onClick={() => setMode(returnMode.current)}>
            {CALENDAR_TEXT.backToCalendar}
          </Button>
          <h3 className="min-w-0 text-base font-black">{mode === "exam" ? CALENDAR_TEXT.examSummary : CALENDAR_TEXT.subjectSummary}</h3>
        </div>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="flex min-w-0 max-w-full items-center gap-2">
              <Segmented label={CALENDAR_TEXT.viewsLabel} value={mode as CalendarViewId} onChange={setMode} options={modes} className="min-w-0 max-sm:[&>button]:px-2.5" />
              <HelpTip {...CALENDAR_HELP.views} />
            </div>
            {mode === "day" ? (
              <button
                type="button"
                aria-pressed={dayFocus}
                onClick={() => setDayFocus((value) => !value)}
                title={CALENDAR_TEXT.dayFocusTitle}
                className={`motion-safe inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-xs font-black ${
                  dayFocus ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-strong)] hover:bg-[var(--surface)]"
                }`}
              >
                <Icon name={dayFocus ? "Check" : "Clock"} className="h-3.5 w-3.5 shrink-0" />
                {CALENDAR_TEXT.dayFocus}
              </button>
            ) : null}
            <div className="flex min-w-0 items-center gap-1.5 sm:ml-auto">
              <p className="mr-1 min-w-0 truncate text-sm font-black capitalize">{periodLabel}</p>
              <IconButton icon="ChevronLeft" label="Periodo precedente" onClick={() => navigate(-1)} />
              <button
                type="button"
                onClick={() => setCursor(new Date())}
                className="min-h-11 rounded-full bg-[var(--surface-strong)] px-3.5 text-xs font-black hover:bg-[var(--surface)]"
              >
                Oggi
              </button>
              <IconButton icon="ChevronRight" label="Periodo successivo" onClick={() => navigate(1)} />
            </div>
          </div>
          <CalendarFilterRow
            subjects={subjects}
            active={filterSubject}
            onChange={setStoredSubject}
            showHolidays={showHolidays}
            onToggleHolidays={() => setShowHolidays((value) => !value)}
            undatedCount={undated.length}
            onOpenUndated={mode === "day" || mode === "agenda" ? () => setUndatedOpen(true) : undefined}
          />
        </>
      )}

      {calendarOwners.length && !summary ? (
        // Con «Solo» attivo gli eventi altrui non si vedono (usano le materie del proprietario): i
        // pulsanti restano, spenti, con una riga che lo spiega.
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label={CALENDAR_VIEW_TEXT.sharedGroup}>
          <span className="inline-flex items-center gap-1.5 text-xs font-black text-[var(--muted)]">
            {CALENDAR_TEXT.sharedCalendars}
            <HelpTip {...CALENDAR_HELP.shared} />
          </span>
          {calendarOwners.map((owner) => {
            const hidden = hiddenOwners.includes(owner.id);
            const name = owner.name || CALENDAR_VIEW_TEXT.unknownOwner;
            return (
              <button
                key={owner.id}
                type="button"
                aria-pressed={!hidden}
                disabled={Boolean(filterSubject)}
                aria-describedby={filterSubject ? "calendar-shared-filtered" : undefined}
                onClick={() => useSharedStore.getState().toggleOwner(owner.id)}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-dashed px-3 text-xs font-black disabled:cursor-not-allowed disabled:opacity-40 ${hidden ? "opacity-50" : ""}`}
                style={{ borderColor: ownerColor(owner.id) }}
                title={hidden ? CALENDAR_VIEW_TEXT.showOwner(name) : CALENDAR_VIEW_TEXT.hideOwner(name)}
              >
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ownerColor(owner.id) }} />
                {name}
              </button>
            );
          })}
          {filterSubject ? (
            <p id="calendar-shared-filtered" className="basis-full text-xs font-bold text-[var(--muted)]">
              {CALENDAR_VIEW_TEXT.sharedFiltered}
            </p>
          ) : null}
        </div>
      ) : null}

      {notice ? (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
          <p className="min-w-0 flex-1">{notice}</p>
          <IconButton icon="X" label="Chiudi l'avviso" onClick={() => setNotice("")} />
        </div>
      ) : null}

      <Panel>
        {/* Filtro per materia senza nulla nel periodo (l'Agenda lo mostra al posto del suo stato vuoto). */}
        {subjectEmpty && rangeEmpty && (mode === "day" || mode === "week" || mode === "month") ? <div className="mb-3">{subjectEmpty}</div> : null}

        {mode === "week" ? (
          <>
            <div className="hidden md:block">
              <TimeGrid days={weekDays} occurrences={visible.occurrences} tasks={visible.tasks} exams={visible.exams} holidays={holidays} handlers={handlers} onPickDay={(day) => {
                setCursor(day);
                setMode("day");
              }} />
            </div>
            <div className="md:hidden">
              <DayList
                days={weekDays}
                occurrences={visible.occurrences}
                tasks={visible.tasks}
                exams={visible.exams}
                holidays={holidays}
                handlers={handlers}
                // Settimana vuota sul telefono: un messaggio solo (con un filtro, quello sopra).
                empty={
                  subjectEmpty ? null : (
                    <WeekEmptyNotice onAdd={() => openCreator(defaultStartFor(dayForNewEvent(range.from, range.to)))} />
                  )
                }
              />
            </div>
          </>
        ) : null}

        {mode === "day" ? (
          <TimeGrid
            days={[startOfDay(cursor)]}
            occurrences={visible.occurrences}
            tasks={visible.tasks}
            exams={visible.exams}
            holidays={holidays}
            handlers={handlers}
            hourHeight={dayFocus ? 64 : 52}
            fixedHours={dayFocus ? [8, 19] : undefined}
            onExpandHours={dayFocus ? () => setDayFocus(false) : undefined}
          />
        ) : null}

        {mode === "month" ? (
          <MonthGrid
            days={monthDays}
            month={cursor}
            occurrences={visible.occurrences}
            tasks={visible.tasks}
            exams={visible.exams}
            holidays={holidays}
            handlers={handlers}
            onPickDay={(day) => {
              setCursor(day);
              setMode("day");
            }}
          />
        ) : null}

        {mode === "agenda" ? (
          <Agenda
            from={range.from}
            to={range.to}
            occurrences={visible.occurrences}
            tasks={visible.tasks}
            exams={visible.exams}
            holidays={holidays}
            handlers={handlers}
            empty={subjectEmpty}
          />
        ) : null}
        {mode === "exam" ? <ExamSession exams={exams} subjects={subjects} onGoExams={() => setActiveView("exams")} onOpenExam={openExam} /> : null}
        {mode === "semester" ? (
          <SemesterMap
            summary={subjectSummary}
            onGoSubjects={() => setActiveView("subjects")}
            onFilter={(id) => {
              setStoredSubject(id);
              setMode("week");
            }}
            onOpenSubject={(id) => {
              writeUiState("subjects.open", id, "tab");
              setActiveView("subjects");
            }}
          />
        ) : null}
      </Panel>

      <UndatedTasksDrawer
        open={undatedOpen}
        onClose={() => setUndatedOpen(false)}
        tasks={undated}
        subjects={subjects}
        onPlace={placeUndated}
        onOpenTask={(id) => {
          setUndatedOpen(false);
          setEditingTaskId(id);
        }}
      />

      {editingEvent ? (
        <EventEditorModal
          event={editingEvent}
          subjects={subjects}
          onClose={() => setEditingEventId(null)}
          onSave={async (patch) => {
            await updateEvent(editingEvent.id, patch);
            setEditingEventId(null);
          }}
          onDelete={async () => {
            const label = editingEvent.title.length > 80 ? `${editingEvent.title.slice(0, 77)}…` : editingEvent.title;
            const series = editingEvent.recurrence && editingEvent.recurrence !== "none" ? " Si ripete: verranno eliminate tutte le sue date." : "";
            if (!window.confirm(`Eliminare l'evento "${label}"?${series} Non si può annullare.`)) return;
            await deleteEvent(editingEvent.id);
            setEditingEventId(null);
          }}
        />
      ) : null}

      {editingShared ? (
        <EventEditorModal
          event={editingShared}
          subjects={subjects}
          sharedFrom={editingShared.sharedFrom}
          onClose={closeSharedEditor}
          onDirtyChange={(dirty) => {
            sharedDraftDirty.current = dirty;
          }}
          onSave={async (_patch, changes) => {
            const ownerId = editingShared.sharedFrom.ownerId;
            // Solo i campi cambiati qui, sopra l'ultima versione nello store: ciò che il proprietario ha
            // cambiato nel frattempo resta. La materia è sua e da qui non cambia.
            const update: Partial<CalendarEvent> = { ...changes };
            delete update.subjectId;
            if (!Object.keys(update).length) {
              closeSharedEditor();
              return;
            }
            const latest = useSharedStore.getState().items.find((entry) => entry.key === sharedKey(ownerId, "calendarEvent", editingShared.id))?.entity;
            if (!latest) return "Questo evento non è più condiviso con te.";
            try {
              // Solo dallo store dei dati altrui: mai nel mio calendario.
              await useSharedStore.getState().saveSharedItem(ownerId, "calendarEvent", { ...latest, ...update });
              closeSharedEditor();
            } catch (cause) {
              return sharedFailure(cause, "Modifiche non salvate. Riprova.");
            }
          }}
          onDelete={async () => {
            const owner = editingShared.sharedFrom.ownerName;
            if (!window.confirm(`Eliminare "${editingShared.title}" dal calendario di ${owner}? Resta nella sua cronologia e può ripristinarlo.`)) return;
            try {
              await useSharedStore.getState().deleteSharedItem(editingShared.sharedFrom.ownerId, "calendarEvent", editingShared.id);
              closeSharedEditor();
            } catch (cause) {
              return sharedFailure(cause, "Evento non eliminato. Riprova.");
            }
          }}
        />
      ) : null}

      {creator ? (
        <CreateModal
          initial={creator}
          subjects={subjects}
          calendars={writableCalendars}
          onClose={() => setCreator(null)}
          onSubmit={async (draft) => {
            if (draft.kind === "task") {
              await addTask({
                title: draft.title,
                dueDate: draft.start.toISOString(),
                subjectId: draft.subjectId || undefined,
                priority: draft.priority,
                importance: draft.priority === "urgent" ? 5 : draft.priority === "high" ? 4 : 3
              });
            } else {
              const range = draft.allDay ? allDayRange(draft.start) : { start: draft.start.toISOString(), end: addMinutes(draft.start, draft.duration).toISOString() };
              if (draft.ownerId) {
                // Nel calendario di un'altra persona: solo dallo store dei dati altrui, mai nel mio calendario.
                const now = new Date().toISOString();
                const calendar = writableCalendars.find((entry) => entry.ownerId === draft.ownerId);
                const color = calendar?.subjects.find((subject) => subject.id === draft.subjectId)?.color || "#7CF7C8";
                const created: CalendarEvent = {
                  id: createId("event"),
                  createdAt: now,
                  updatedAt: now,
                  archived: false,
                  tags: [],
                  title: draft.title,
                  description: "",
                  category: draft.category,
                  subjectId: draft.subjectId || undefined,
                  color,
                  priority: draft.priority,
                  start: range.start,
                  end: range.end,
                  allDay: draft.allDay || undefined,
                  recurrence: draft.recurrence,
                  status: "planned",
                  checklist: [],
                  attachmentIds: [],
                  notes: "",
                  links: []
                };
                try {
                  await useSharedStore.getState().saveSharedItem(draft.ownerId, "calendarEvent", { ...created });
                  setCreator(null);
                } catch (cause) {
                  return sharedFailure(cause, "Evento non aggiunto. Riprova.");
                }
                return;
              }
              await addEvent({
                title: draft.title,
                start: range.start,
                end: range.end,
                allDay: draft.allDay || undefined,
                subjectId: draft.subjectId || undefined,
                color: subjectColor(subjects, draft.subjectId, "#7CF7C8"),
                priority: draft.priority,
                category: draft.category,
                recurrence: draft.recurrence
              });
            }
            setCreator(null);
          }}
        />
      ) : null}

      {editingTask ? (
        <TaskEditorModal
          task={editingTask}
          subjects={subjects}
          onClose={() => setEditingTaskId(null)}
          onSave={updateTask}
          onDelete={async (task) => {
            const label = task.title.length > 80 ? `${task.title.slice(0, 77)}…` : task.title;
            if (!window.confirm(`Eliminare l'attività "${label}"? Sparirà anche dalla sezione Attività e non si può annullare.`)) return;
            await deleteTask(task.id);
            setEditingTaskId(null);
            setPreview(null);
          }}
        />
      ) : null}

      {preview ? <CalendarHoverPreview preview={preview} subjects={subjects} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Modali                                                               */
/* ------------------------------------------------------------------ */

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <section className="soft-panel scrollbar-soft max-h-[90dvh] w-full max-w-2xl overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="safe-text text-2xl font-black">{title}</h3>
            {subtitle ? <p className="two-line-safe text-sm text-[var(--muted)]">{subtitle}</p> : null}
          </div>
          <IconButton icon="X" label="Chiudi" onClick={onClose} className="h-10 w-10" />
        </div>
        {children}
      </section>
    </div>
  );
}

function EventEditorModal({
  event,
  subjects,
  sharedFrom,
  onClose,
  onSave,
  onDelete,
  onDirtyChange
}: {
  event: CalendarEvent;
  subjects: Subjects;
  /** Evento di un'altra persona: sola lettura senza `canEdit`, materia del proprietario non modificabile. */
  sharedFrom?: SharedOrigin;
  onClose: () => void;
  /**
   * `patch` ha tutti i campi del modulo, `changes` solo quelli cambiati da quando l'editor è aperto
   * (orari e ripetizione insieme). Un testo restituito è un errore da mostrare accanto ai pulsanti.
   */
  onSave: (patch: Partial<CalendarEvent>, changes: Partial<CalendarEvent>) => Promise<string | void>;
  onDelete: () => Promise<string | void>;
  /** Ci sono modifiche non salvate nel modulo. */
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const readOnly = Boolean(sharedFrom && !sharedFrom.canEdit);
  const ownerFirstName = sharedFrom ? sharedFrom.ownerName.trim().split(/\s+/)[0] || sharedFrom.ownerName : "";
  // Colore di riserva: per un evento altrui quello della sua materia (dal proprietario), poi quello della
  // persona; mai di una delle mie materie.
  const fallbackColor = (subjectId?: string) => (sharedFrom ? sharedFrom.subjectColor || sharedFrom.color : subjectColor(subjects, subjectId));
  // Bozza all'apertura: il confronto con questa dice cosa è stato cambiato qui.
  const [initialDraft] = useState(() => ({
    title: event.title,
    description: event.description,
    category: event.category,
    subjectId: event.subjectId ?? "",
    priority: event.priority,
    status: event.status,
    start: toDatetimeLocal(event.start),
    end: toDatetimeLocal(event.end),
    allDay: event.allDay === true,
    // Orari precedenti: togliendo "Tutto il giorno" si ritrovano gli orari di prima.
    prevStart: "",
    prevEnd: "",
    color: event.color || fallbackColor(event.subjectId),
    recurrence: event.recurrence ?? "none",
    recurrenceUntil: event.recurrenceUntil ?? ""
  }));
  const [draft, setDraft] = useState(initialDraft);
  const [error, setError] = useState("");
  const recurring = draft.recurrence !== "none";
  // Gli orari precedenti servono solo a "Tutto il giorno": non contano come modifiche.
  const dirty = Object.keys(changedFields({ ...initialDraft, prevStart: "", prevEnd: "" }, { ...draft, prevStart: "", prevEnd: "" })).length > 0;
  useEffect(() => onDirtyChange?.(dirty), [dirty, onDirtyChange]);

  // Da bozza a campi dell'evento. La stessa conversione vale per la bozza iniziale e per quella attuale,
  // così il confronto vede solo ciò che è stato cambiato qui (le date si validano prima, in save).
  const toPatch = (value: typeof draft): Partial<CalendarEvent> => {
    const iso = (local: string) => {
      const at = new Date(local);
      return Number.isNaN(at.getTime()) ? local : at.toISOString();
    };
    const day = new Date(`${value.start.slice(0, 10)}T00:00`);
    const times = !value.allDay ? { start: iso(value.start), end: iso(value.end) } : Number.isNaN(day.getTime()) ? { start: value.start, end: value.end } : allDayRange(day);
    return {
      title: value.title.trim(),
      description: value.description.trim(),
      category: value.category,
      subjectId: value.subjectId || undefined,
      priority: value.priority,
      status: value.status,
      start: times.start,
      end: times.end,
      allDay: value.allDay,
      color: value.color || fallbackColor(value.subjectId),
      recurrence: value.recurrence,
      recurrenceUntil: value.recurrence !== "none" && value.recurrenceUntil ? value.recurrenceUntil : undefined
    };
  };

  const setAllDay = (value: boolean) => {
    setDraft((v) => {
      if (value) return { ...v, allDay: true, prevStart: v.start, prevEnd: v.end };
      const day = v.start.slice(0, 10) || toDatetimeLocal(new Date()).slice(0, 10);
      const sameDay = v.prevStart.slice(0, 10) === day && v.prevEnd > v.prevStart;
      return {
        ...v,
        allDay: false,
        start: sameDay ? v.prevStart : `${day}T09:00`,
        end: sameDay ? v.prevEnd : `${day}T10:00`
      };
    });
  };

  const remove = async () => {
    const failure = await onDelete();
    if (failure) setError(failure);
  };

  const save = async () => {
    if (!draft.title.trim()) {
      setError("Scrivi un titolo per l'evento.");
      return;
    }
    const day = draft.start.slice(0, 10);
    if (recurring && draft.recurrenceUntil && draft.recurrenceUntil < day) {
      setError("La data in «Fino al» deve venire dopo il giorno dell'evento.");
      return;
    }
    if (draft.allDay) {
      const at = new Date(`${day}T00:00`);
      if (!day || Number.isNaN(at.getTime())) {
        setError("Scegli il giorno dell'evento.");
        return;
      }
    } else {
      const start = new Date(draft.start);
      const end = new Date(draft.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
        setError("L'orario di fine deve venire dopo l'inizio: correggi «Fine».");
        return;
      }
    }
    const patch = toPatch(draft);
    const failure = await onSave(patch, changedFields(toPatch(initialDraft), patch, LINKED_EVENT_FIELDS));
    if (failure) setError(failure);
  };

  return (
    <ModalShell
      title={sharedFrom ? (readOnly ? `Evento di ${ownerFirstName}` : `Modifica evento di ${ownerFirstName}`) : "Modifica evento"}
      subtitle={
        readOnly
          ? undefined
          : recurring
            ? "Si ripete: le modifiche valgono per tutte le sue date."
            : "Cambia orario e dettagli, oppure elimina l'evento."
      }
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-3">
        {sharedFrom ? (
          <p className="flex flex-wrap items-center gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
            <SharedMark origin={sharedFrom} />
            <span className="min-w-0 flex-1">
              {readOnly
                ? "Puoi solo vedere questo evento."
                : `Le modifiche arrivano subito a ${ownerFirstName}, che le vede nella cronologia e può ripristinarle.`}
            </span>
          </p>
        ) : null}
        <fieldset disabled={readOnly} className={`m-0 grid min-w-0 grid-cols-1 gap-3 border-0 p-0 ${DIMMED_DISABLED_FIELDS}`}>
          {event.tags?.includes("appello-importato") ? (
            <Panel className="p-3">
              <h4 className="font-black">{sharedFrom ? "Appello ufficiale" : "Appello ufficiale aggiunto al tuo calendario"}</h4>
              <p className="mt-1 whitespace-pre-line text-sm text-[var(--muted)]">{event.description}</p>
              <p className="mt-2 whitespace-pre-line text-xs text-[var(--muted)]">{event.notes}</p>
              {event.links.map((url) => {
                const href = safeHref(url);
                // «Ufficiale UniMi» solo se il link porta davvero a unimi.it.
                return <a key={url} href={href} target="_blank" rel="noreferrer" className="safe-text mt-2 inline-block text-sm font-bold text-[var(--accent-ink)] underline">{eventLinkLabel(href)}</a>;
              })}
              {sharedFrom ? null : (
                <p className="mt-2 text-xs text-[var(--muted)]">Qui modifichi solo il tuo promemoria: la data ufficiale resta visibile in Esami › Date ufficiali.</p>
              )}
            </Panel>
          ) : null}
          <Field label="Titolo">
            <input className={inputClass} value={draft.title} placeholder="Es. Lezione di Anatomia" onChange={(e) => setDraft((v) => ({ ...v, title: e.target.value }))} />
          </Field>
          <label className={`flex min-h-11 items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] px-3 py-2 text-sm font-bold ${readOnly ? "cursor-not-allowed" : "cursor-pointer"}`}>
            <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--accent)]" checked={draft.allDay} onChange={(e) => setAllDay(e.target.checked)} />
            <span className="min-w-0 flex-1">
              {ALL_DAY_LABEL}
              <span className="block text-xs font-bold text-[var(--muted)]">Occupa l'intera giornata, senza orari</span>
            </span>
          </label>
          {draft.allDay ? (
            <Field label="Giorno">
              <input
                className={inputClass}
                type="date"
                value={draft.start.slice(0, 10)}
                onChange={(e) => setDraft((v) => ({ ...v, start: e.target.value ? `${e.target.value}T00:00` : "" }))}
              />
            </Field>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Inizio">
                <input
                  className={inputClass}
                  type="datetime-local"
                  value={draft.start}
                  onChange={(e) => {
                    const value = e.target.value;
                    setDraft((v) => {
                      // Spostando l'inizio la durata resta invariata.
                      const previousStart = new Date(v.start);
                      const previousEnd = new Date(v.end);
                      const nextStart = new Date(value);
                      const duration = previousEnd.getTime() - previousStart.getTime();
                      const nextEnd = Number.isFinite(duration) && duration > 0 && !Number.isNaN(nextStart.getTime()) ? toDatetimeLocal(new Date(nextStart.getTime() + duration)) : v.end;
                      return { ...v, start: value, end: nextEnd };
                    });
                  }}
                />
              </Field>
              <Field label="Fine">
                <input className={inputClass} type="datetime-local" value={draft.end} onChange={(e) => setDraft((v) => ({ ...v, end: e.target.value }))} />
              </Field>
              <p className="-mt-1 text-xs font-bold text-[var(--muted)] sm:col-span-2">Se cambi l'inizio, la fine si sposta e la durata resta la stessa.</p>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label={sharedFrom ? "Materia" : "Materia (facoltativa)"}>
              {sharedFrom ? (
                // La materia è del proprietario e decide cosa è condiviso: si mostra, non si cambia.
                <span className={`${inputClass} flex items-center text-[var(--muted)] opacity-60`}>{sharedFrom.subjectName ?? NO_SUBJECT_LABEL}</span>
              ) : (
                <select
                  className={inputClass}
                  value={draft.subjectId}
                  onChange={(e) => setDraft((v) => ({ ...v, subjectId: e.target.value, color: subjectColor(subjects, e.target.value, v.color) }))}
                >
                  <option value="">Nessuna</option>
                  {selectableSubjects(subjects, draft.subjectId).map((subject) => (
                    <option key={subject.id} value={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="Tipo di evento">
              <select className={inputClass} value={draft.category} onChange={(e) => setDraft((v) => ({ ...v, category: e.target.value as EventCategory }))}>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Ripetizione">
              <select className={inputClass} value={draft.recurrence} onChange={(e) => setDraft((v) => ({ ...v, recurrence: e.target.value as NonNullable<CalendarEvent["recurrence"]> }))}>
                {(Object.keys(RECURRENCE_LABEL) as NonNullable<CalendarEvent["recurrence"]>[]).map((key) => (
                  <option key={key} value={key}>
                    {RECURRENCE_LABEL[key]}
                  </option>
                ))}
              </select>
            </Field>
            {recurring ? (
              <Field label="Fino al (facoltativo)">
                <input className={inputClass} type="date" value={draft.recurrenceUntil} onChange={(e) => setDraft((v) => ({ ...v, recurrenceUntil: e.target.value }))} />
              </Field>
            ) : null}
          </div>
          <Field label="Descrizione (facoltativa)">
            <textarea
              className={`${inputClass} min-h-20 py-3`}
              value={draft.description}
              placeholder="Es. Aula 3, portare gli appunti del capitolo 2"
              onChange={(e) => setDraft((v) => ({ ...v, description: e.target.value }))}
            />
          </Field>
          <details className="quiet-panel p-4">
            <summary className="cursor-pointer text-sm font-extrabold">
              Altre opzioni <span className="font-bold text-[var(--muted)]">· priorità, stato, colore</span>
            </summary>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Priorità">
                <select className={inputClass} value={draft.priority} onChange={(e) => setDraft((v) => ({ ...v, priority: e.target.value as CalendarEvent["priority"] }))}>
                  {(Object.keys(PRIORITY_LABEL) as CalendarEvent["priority"][]).map((key) => (
                    <option key={key} value={key}>
                      {PRIORITY_LABEL[key]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Stato">
                <select className={inputClass} value={draft.status} onChange={(e) => setDraft((v) => ({ ...v, status: e.target.value as CalendarEvent["status"] }))}>
                  {(Object.keys(EVENT_STATUS_LABEL) as CalendarEvent["status"][]).map((key) => (
                    <option key={key} value={key}>
                      {EVENT_STATUS_LABEL[key]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Colore">
                <input
                  className="h-11 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-1"
                  type="color"
                  value={draft.color.startsWith("#") ? draft.color : "#7CF7C8"}
                  onChange={(e) => setDraft((v) => ({ ...v, color: e.target.value }))}
                />
              </Field>
            </div>
          </details>
        </fieldset>
        {error ? (
          <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {readOnly ? (
            <>
              <span className="flex-1" />
              <Button variant="primary" onClick={onClose}>
                Chiudi
              </Button>
            </>
          ) : (
            <>
              <Button variant="danger" icon="Trash2" onClick={() => void remove()}>
                Elimina evento
              </Button>
              <span className="flex-1" />
              <Button variant="soft" onClick={onClose}>
                Annulla
              </Button>
              <Button variant="primary" icon="Check" onClick={save}>
                Salva modifiche
              </Button>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

interface CreateDraft {
  kind: "event" | "task";
  title: string;
  subjectId: string;
  start: Date;
  duration: number;
  allDay: boolean;
  priority: Task["priority"];
  category: EventCategory;
  recurrence: NonNullable<CalendarEvent["recurrence"]>;
  /** Calendario in cui aggiungere l'evento: "" = il mio, altrimenti l'id del proprietario. */
  ownerId: string;
}

function CreateModal({
  initial,
  subjects,
  calendars = [],
  onClose,
  onSubmit
}: {
  /** `subjectId`: materia già scelta (es. con il filtro per materia attivo). */
  initial: { at: Date; kind: "event" | "task"; subjectId?: string };
  subjects: Subjects;
  /** Calendari di altre persone in cui posso aggiungere eventi ("Nel calendario di"). */
  calendars?: WritableCalendar[];
  onClose: () => void;
  /** Un testo restituito è un errore da mostrare accanto ai pulsanti (il modulo resta aperto). */
  onSubmit: (draft: CreateDraft) => Promise<string | void>;
}) {
  const [kind, setKind] = useState(initial.kind);
  const [ownerId, setOwnerId] = useState("");
  const [ownerNotice, setOwnerNotice] = useState("");
  const [error, setError] = useState("");
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState(initial.subjectId ?? "");
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(defaultStartFor(initial.at)));
  const [duration, setDuration] = useState<number | "allday">(60);
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [category, setCategory] = useState<EventCategory>("study");
  const [recurrence, setRecurrence] = useState<NonNullable<CalendarEvent["recurrence"]>>("none");
  const allDay = kind === "event" && duration === "allday";
  const start = new Date(startsAt);
  // Calendario scelto non più modificabile (permesso tolto a modulo aperto): si torna al mio, senza la
  // materia dell'altra persona, e lo si dice. Il menu resta utilizzabile.
  const target = ownerId ? calendars.find((calendar) => calendar.ownerId === ownerId) : undefined;
  if (ownerId && !target) {
    setOwnerId("");
    setSubjectId("");
    setOwnerNotice("Non puoi più aggiungere eventi in quel calendario: l'evento andrà nel tuo.");
  }
  // Evento nel calendario di un'altra persona: si scelgono solo le sue materie, mai le mie. Se mi ha
  // condiviso solo alcune materie, un evento senza materia non passerebbe: allora va scelta.
  const inOtherCalendar = kind === "event" && Boolean(target);
  const subjectRequired = inOtherCalendar && Boolean(target?.subjectRequired);
  const subjectOptions = inOtherCalendar && target ? target.subjects : selectableSubjects(subjects, subjectId);
  const validDate = !Number.isNaN(start.getTime());
  const valid = Boolean(title.trim()) && validDate && (!subjectRequired || Boolean(subjectId));

  const submit = async () => {
    if (!valid) return;
    setError("");
    const failure = await onSubmit({
      kind,
      title: title.trim(),
      subjectId,
      start,
      duration: typeof duration === "number" ? duration : 60,
      allDay,
      priority,
      category,
      recurrence,
      ownerId: inOtherCalendar ? ownerId : ""
    });
    if (failure) setError(failure);
  };

  const subjectField = (
    <Field label={subjectRequired ? "Materia" : "Materia (facoltativa)"}>
      <select className={inputClass} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
        {subjectRequired ? (
          <option value="" disabled>
            {subjectOptions.length ? "Scegli una materia" : "Nessuna materia condivisa"}
          </option>
        ) : (
          <option value="">Nessuna</option>
        )}
        {subjectOptions.map((subject) => (
          <option key={subject.id} value={subject.id}>
            {subject.name}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <ModalShell
      title={`${kind === "event" ? "Nuovo evento" : "Nuova attività"} · ${format(Number.isNaN(start.getTime()) ? initial.at : start, "EEEE d MMMM", { locale: it })}`}
      subtitle={kind === "task" ? "Comparirà nel calendario il giorno della scadenza e nella sezione Attività." : undefined}
      onClose={onClose}
    >
      <form
        className="grid grid-cols-1 gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Segmented
          label="Cosa vuoi aggiungere"
          value={kind}
          onChange={(next) => {
            setKind(next);
            // Una materia di un'altra persona non resta su un'attività mia (né viceversa).
            if (ownerId) setSubjectId("");
          }}
          className="justify-self-start"
          options={[
            { id: "event", label: "Evento", icon: "CalendarDays", title: "Un impegno con giorno e orario: lezione, studio, laboratorio…" },
            { id: "task", label: "Attività con scadenza", icon: "Check", title: "Una cosa da fare entro una data, da spuntare quando è fatta" }
          ]}
        />
        {kind === "event" && calendars.length ? (
          <Field label="Nel calendario di">
            <select
              className={inputClass}
              value={ownerId}
              onChange={(e) => {
                setOwnerId(e.target.value);
                setSubjectId("");
                setError("");
                setOwnerNotice("");
              }}
            >
              <option value="">Il mio calendario</option>
              {calendars.map((calendar) => (
                <option key={calendar.ownerId} value={calendar.ownerId}>
                  {calendar.name}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {ownerNotice && kind === "event" ? (
          <p role="status" className="text-xs font-bold text-[var(--muted)]">
            {ownerNotice}
          </p>
        ) : null}
        <Field label="Titolo">
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
            placeholder={kind === "event" ? "Es. Lezione di Anatomia" : "Es. Consegnare la relazione di laboratorio"}
          />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={allDay ? "Giorno" : kind === "event" ? "Inizio" : "Scadenza"}>
            {allDay ? (
              <input
                className={inputClass}
                type="date"
                value={startsAt.slice(0, 10)}
                onChange={(e) => setStartsAt(e.target.value ? `${e.target.value}T${startsAt.slice(11, 16) || "09:00"}` : "")}
              />
            ) : (
              <input className={inputClass} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            )}
          </Field>
          {kind === "event" ? (
            <Field label="Durata">
              <select
                className={inputClass}
                value={String(duration)}
                onChange={(e) => setDuration(e.target.value === "allday" ? "allday" : Number(e.target.value))}
              >
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatMinutes(minutes)}
                  </option>
                ))}
                <option value="allday">{ALL_DAY_LABEL}</option>
              </select>
            </Field>
          ) : (
            subjectField
          )}
        </div>
        {kind === "event" ? subjectField : null}
        <details className="quiet-panel p-4">
          <summary className="cursor-pointer text-sm font-extrabold">
            Altre opzioni <span className="font-bold text-[var(--muted)]">· {kind === "event" ? "tipo di evento, ripetizione" : "priorità"}</span>
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {kind === "event" ? (
              <>
                <Field label="Tipo di evento">
                  <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as EventCategory)}>
                    {categories.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Ripetizione">
                  <select className={inputClass} value={recurrence} onChange={(e) => setRecurrence(e.target.value as NonNullable<CalendarEvent["recurrence"]>)}>
                    {(Object.keys(RECURRENCE_LABEL) as NonNullable<CalendarEvent["recurrence"]>[]).map((key) => (
                      <option key={key} value={key}>
                        {RECURRENCE_LABEL[key]}
                      </option>
                    ))}
                  </select>
                </Field>
              </>
            ) : (
              <Field label="Priorità">
                <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as Task["priority"])}>
                  {(Object.keys(PRIORITY_LABEL) as Task["priority"][]).map((key) => (
                    <option key={key} value={key}>
                      {PRIORITY_LABEL[key]}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        </details>
        {!valid ? (
          <p className="text-xs font-bold text-[var(--muted)]">
            {!title.trim() ? "Scrivi un titolo per continuare." : !validDate ? "Scegli una data valida." : "Scegli una materia per continuare."}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="soft" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="primary" icon="Plus" type="submit" disabled={!valid}>
            {kind === "event" ? "Aggiungi evento" : "Aggiungi attività"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* Sessione esami e semestre                                            */
/* ------------------------------------------------------------------ */

function ExamSession({
  exams,
  subjects,
  onGoExams,
  onOpenExam
}: {
  exams: Exam[];
  subjects: Subjects;
  onGoExams: () => void;
  onOpenExam: (id: string) => void;
}) {
  const today = startOfDay(new Date());
  const upcoming = exams.filter((exam) => exam.status !== "done" && !isBefore(parseISO(exam.date), today)).sort((a, b) => a.date.localeCompare(b.date));
  const past = exams.filter((exam) => !upcoming.includes(exam)).sort((a, b) => b.date.localeCompare(a.date));
  if (!exams.length)
    return (
      <EmptyState
        icon="GraduationCap"
        title="Ancora nessun esame"
        body="Aggiungi i tuoi esami nella sezione Esami: qui vedrai quanti giorni mancano e a che punto è la preparazione."
        action={
          <Button variant="primary" icon="GraduationCap" onClick={onGoExams}>
            Vai a Esami
          </Button>
        }
      />
    );
  return (
    <div className="grid grid-cols-1 gap-5">
      {!upcoming.length ? <p className="text-sm font-bold text-[var(--muted)]">Nessun esame in arrivo.</p> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {upcoming.map((exam) => {
          const color = subjectColor(subjects, exam.subjectId);
          const days = daysUntil(exam.date);
          const name = subjectName(subjects, exam.subjectId);
          const preparation = Math.max(0, Math.min(100, exam.preparation));
          // Tutta la scheda è un pulsante che apre l'esame (solo testo e span dentro).
          return (
            <button
              key={exam.id}
              type="button"
              onClick={() => onOpenExam(exam.id)}
              // Nome accessibile = il testo della scheda (numero, giorni, materia); l'azione nel title.
              title={CALENDAR_TEXT.openExamAria(name)}
              className="quiet-panel motion-safe group block min-w-0 p-4 text-left hover:border-[var(--accent-ink)] hover:bg-[var(--surface)]"
              style={{ boxShadow: `inset 0 3px 0 ${color}` }}
            >
              <span className="flex items-baseline justify-between gap-2">
                <span className="text-3xl font-black tabular-nums">{days}</span>
                <Tag>{EXAM_STATUS_LABEL[exam.status]}</Tag>
              </span>
              <span className="block text-xs font-bold text-[var(--muted)]">
                {days === 1 ? "giorno" : "giorni"} all'esame · {format(parseISO(exam.date), "EEEE d MMMM", { locale: it })}
              </span>
              <span className="mt-2 flex items-center gap-1 font-black">
                <span className="two-line-safe min-w-0">{name}</span>
                <Icon name="ChevronRight" className="motion-safe h-4 w-4 shrink-0 text-[var(--muted)] group-hover:translate-x-0.5 group-hover:text-[var(--accent-ink)]" />
              </span>
              <span aria-hidden="true" className="mt-3 block h-2 overflow-hidden rounded-full bg-[var(--surface-strong)]">
                <span className="block h-full rounded-full" style={{ width: `${preparation}%`, background: color }} />
              </span>
              <span className="mt-1.5 block text-xs font-bold text-[var(--muted)]">
                Preparazione al {exam.preparation}% · voto obiettivo {exam.targetGrade}
              </span>
            </button>
          );
        })}
      </div>
      {past.length ? (
        <div>
          <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Già sostenuti o con data passata</h4>
          <ul className="grid grid-cols-1 gap-1">
            {past.map((exam) => (
              <li key={exam.id}>
                <button
                  type="button"
                  onClick={() => onOpenExam(exam.id)}
                  title={CALENDAR_TEXT.openExamAria(subjectName(subjects, exam.subjectId))}
                  className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[14px] px-2 text-left text-sm text-[var(--muted)] hover:bg-[var(--surface-soft)] hover:text-[var(--text)]"
                >
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: subjectColor(subjects, exam.subjectId) }} />
                  <span className="one-line-safe min-w-0">
                    <span className="font-bold">{subjectName(subjects, exam.subjectId)}</span> · {shortDate(exam.date)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Riepilogo "Per materia": ogni scheda mostra solo quella materia nel calendario (Settimana); "Apri
 * materia" porta alla sua scheda in Materie. Solo materie non archiviate, le superate in fondo.
 */
function SemesterMap({
  summary,
  onGoSubjects,
  onFilter,
  onOpenSubject
}: {
  summary: SubjectCalendarSummary<Subjects[number]>;
  onGoSubjects: () => void;
  onFilter: (id: string) => void;
  onOpenSubject: (id: string) => void;
}) {
  if (!summary.rows.length)
    return (
      <EmptyState
        icon="BookOpen"
        title={CALENDAR_TEXT.summaryEmptyTitle}
        body={CALENDAR_TEXT.summaryEmptyBody}
        action={
          <Button variant="primary" icon="Plus" onClick={onGoSubjects}>
            {CALENDAR_TEXT.goSubjects}
          </Button>
        }
      />
    );
  return (
    <div className="grid grid-cols-1 gap-4">
      <div>
        <p className="text-sm font-black">{CALENDAR_TEXT.summaryCounts(summary.planned, summary.withItems)}</p>
        <p className="text-xs font-bold text-[var(--muted)]">{CALENDAR_TEXT.summaryHint}</p>
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {summary.rows.map((row) => {
          const { subject } = row;
          const course = resolveBarbCourse(subject, BARB_DATASET.courses);
          const breakdown = CALENDAR_TEXT.summaryBreakdown(row);
          return (
            <li key={subject.id} className={`quiet-panel flex min-w-0 flex-col p-1.5 ${row.completed ? "opacity-80" : ""}`}>
              <button
                type="button"
                onClick={() => onFilter(subject.id)}
                // Nome accessibile = il testo della scheda (materia, voci); l'azione nel title.
                title={CALENDAR_TEXT.summaryShow(subject.name)}
                className="motion-safe group flex min-w-0 items-center gap-3 rounded-[14px] p-2 text-left hover:bg-[var(--surface)]"
              >
                <span className="grid h-11 w-11 shrink-0 grid-cols-1 place-items-center rounded-super" style={{ background: safeCssColor(subject.color) || "var(--accent)" }}>
                  {course ? <CourseIcon course={course} className="h-5 w-5 text-[#10131d]" /> : <Icon name={subject.icon} className="h-5 w-5 text-[#10131d]" />}
                </span>
                <span className="block min-w-0 flex-1">
                  <span className="two-line-safe block font-black leading-tight">{subject.name}</span>
                  <span className="block text-xs font-bold text-[var(--muted)]">{CALENDAR_TEXT.summaryItems(row.items)}</span>
                  {breakdown ? <span className="safe-text block text-xs font-medium text-[var(--muted)]">{breakdown}</span> : null}
                  <span className="mt-1 flex flex-wrap gap-1">
                    <Tag color={SEMESTER_TONE[subjectSemester(subject)]}>{SEMESTER_LABEL[subjectSemester(subject)]}</Tag>
                    {row.completed ? <Tag>{CALENDAR_TEXT.summaryCompleted}</Tag> : null}
                  </span>
                </span>
                <Icon name="ChevronRight" className="motion-safe h-4 w-4 shrink-0 text-[var(--muted)] group-hover:translate-x-0.5 group-hover:text-[var(--accent-ink)]" />
              </button>
              <button
                type="button"
                onClick={() => onOpenSubject(subject.id)}
                aria-label={`${CALENDAR_TEXT.openSubject} · ${subject.name}`}
                title={CALENDAR_TEXT.openSubjectAria(subject.name)}
                className="inline-flex min-h-11 items-center gap-1 self-start rounded-full px-2.5 text-xs font-extrabold text-[var(--accent-ink)] hover:underline"
              >
                {CALENDAR_TEXT.openSubject}
                <Icon name="ExternalLink" className="h-3.5 w-3.5" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Filtro per materia e stati vuoti                                     */
/* ------------------------------------------------------------------ */

/** Filtro per materia senza impegni nel periodo: un evento già legato alla materia, o tutte le materie. */
function SubjectEmptyNotice({ name, onAdd, onClear }: { name: string; onAdd: () => void; onClear: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] border border-dashed border-[var(--border)] p-3">
      <Icon name="CalendarDays" className="h-5 w-5 shrink-0 text-[var(--accent-ink)]" />
      <p className="safe-text min-w-0 flex-1 basis-48 text-sm font-bold">{CALENDAR_TEXT.emptySubject(name)}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" icon="Plus" onClick={onAdd}>
          {CALENDAR_TEXT.addEvent}
        </Button>
        <Button variant="ghost" onClick={onClear}>
          {CALENDAR_TEXT.showAll}
        </Button>
      </div>
    </div>
  );
}

/** Settimana vuota sul telefono: un solo messaggio invece di sette "Nessun impegno". */
function WeekEmptyNotice({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[18px] border border-dashed border-[var(--border)] p-3">
      <Icon name="CalendarDays" className="h-5 w-5 shrink-0 text-[var(--accent-ink)]" />
      <p className="safe-text min-w-0 flex-1 basis-40 text-sm font-bold">{CALENDAR_TEXT.emptyWeek}</p>
      <Button variant="primary" icon="Plus" onClick={onAdd}>
        {CALENDAR_TEXT.addEvent}
      </Button>
    </div>
  );
}
