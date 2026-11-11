import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent
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
  isSameDay,
  isSameMonth,
  parseISO,
  setHours,
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
import { allDayRange, daysUntil, eventMinutes, isAllDayEvent, selectableSubjects, shortDate, studyDaysLabel, subjectColor, subjectName, timeLabel } from "../lib/selectors";
import { formatElapsedSeconds, isTaskCompletedLate, isTaskTimerRunning, taskElapsedSeconds } from "../lib/taskTimer";
import { expandEvents, RECURRENCE_LABEL, type EventOccurrence } from "../lib/recurrence";
import {
  ALL_DAY_LABEL,
  CALENDAR_HELP,
  CALENDAR_TEXT,
  ENERGY_LABEL,
  EVENT_CATEGORY_LABEL,
  EVENT_STATUS_LABEL,
  EXAM_STATUS_LABEL,
  NO_SUBJECT_LABEL,
  OFFICIAL_EXAMS_ADD_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SHARE_TEXT,
  TASK_STATUS_LABEL,
  capitalizeFirst,
  eventLinkLabel,
  formatMinutes
} from "../lib/labels";
import { useNow } from "../hooks/useNow";
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

/** Si trascina solo ciò che si può modificare: gli eventi altrui in sola lettura non sono trascinabili. */
const canDrag = (item: CalendarOccurrence) => !item.sharedFrom || item.sharedFrom.canEdit;

/** Materia da mostrare ("" = nessuna): per gli eventi di altri quella del proprietario, mai una delle mie. */
const occurrenceSubject = (item: ShownEvent, subjects: Subjects) =>
  item.sharedFrom ? item.sharedFrom.subjectName ?? "" : item.subjectId ? subjectName(subjects, item.subjectId) : "";

/**
 * Bordo tratteggiato nel colore della persona (outline: non tocca il bordo colorato a sinistra).
 * Classe e variabile, non stile in linea: così il contorno del focus da tastiera resta visibile.
 */
const SHARED_OUTLINE = "outline-dashed outline-1 -outline-offset-1 outline-[color:var(--owner-color)]";
const sharedOutlineClass = (item: ShownEvent) => (item.sharedFrom ? SHARED_OUTLINE : "");
const sharedOutline = (item: ShownEvent): CSSProperties =>
  item.sharedFrom ? ({ "--owner-color": item.sharedFrom.color } as CSSProperties) : {};

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

/** Prossima mezz'ora utile (o le 9:00 per un giorno senza orario). */
const defaultStartFor = (day: Date) => {
  if (day.getHours() || day.getMinutes()) {
    const selected = new Date(day);
    selected.setSeconds(0, 0);
    return selected;
  }
  if (isSameDay(day, new Date())) {
    const next = new Date();
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() < 30 ? 30 : 60);
    return next;
  }
  return setHours(startOfDay(day), 9);
};

type PreviewPoint = { x: number; y: number };
type CalendarPreviewState =
  | { kind: "event"; event: ShownEvent; x: number; y: number }
  | { kind: "task"; task: Task; x: number; y: number };

const supportsHoverPreview = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const pointerPoint = (event: ReactMouseEvent<HTMLElement>): PreviewPoint => ({ x: event.clientX, y: event.clientY });

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

// Solo colori esadecimali, anche per i miei eventi: chi li modifica con "Può modificare" non deve poter
// mettere nello stile un url() da scaricare. Evento di altri senza colore valido: quello della sua
// materia (dal proprietario), poi quello della persona; mai di una delle mie materie.
const eventColor = (event: ShownEvent, subjects: Subjects) =>
  safeCssColor(event.color) ||
  (event.sharedFrom ? event.sharedFrom.subjectColor || event.sharedFrom.color : subjectColor(subjects, event.subjectId));
const allDayEventLabel = (event: CalendarEvent) => event.tags?.includes("appello-importato") ? "Data appello" : ALL_DAY_LABEL;

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
          <SubjectFilterBar subjects={subjects} active={filterSubject} onChange={setStoredSubject} />
        </>
      )}

      {calendarOwners.length && !summary ? (
        <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Calendari di altre persone">
          <span className="inline-flex items-center gap-1.5 text-xs font-black text-[var(--muted)]">
            {CALENDAR_TEXT.sharedCalendars}
            <HelpTip {...CALENDAR_HELP.shared} />
          </span>
          {calendarOwners.map((owner) => {
            const hidden = hiddenOwners.includes(owner.id);
            return (
              <button
                key={owner.id}
                type="button"
                aria-pressed={!hidden}
                onClick={() => useSharedStore.getState().toggleOwner(owner.id)}
                className={`inline-flex min-h-9 items-center gap-1.5 rounded-full border border-dashed px-3 text-xs font-black ${hidden ? "opacity-50" : ""}`}
                style={{ borderColor: ownerColor(owner.id) }}
                title={hidden ? `Mostra gli eventi di ${owner.name}` : `Nascondi gli eventi di ${owner.name}`}
              >
                <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: ownerColor(owner.id) }} />
                {owner.name}
              </button>
            );
          })}
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
              <TimeGrid days={weekDays} occurrences={visible.occurrences} tasks={visible.tasks} exams={visible.exams} handlers={handlers} onPickDay={(day) => {
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
            handlers={handlers}
            onPickDay={(day) => {
              setCursor(day);
              setMode("day");
            }}
          />
        ) : null}

        {mode === "agenda" ? (
          <Agenda from={range.from} to={range.to} occurrences={visible.occurrences} tasks={visible.tasks} exams={visible.exams} handlers={handlers} empty={subjectEmpty} />
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
/* Griglia oraria (settimana / giorno / focus)                          */
/* ------------------------------------------------------------------ */

interface Placed {
  item: CalendarOccurrence;
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
}

/** Eventi sovrapposti affiancati in colonne (come Google/Apple Calendar). */
const layoutDay = (items: Omit<Placed, "lane" | "lanes">[]): Placed[] => {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const result: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    for (const entry of cluster) {
      let lane = laneEnds.findIndex((end) => end <= entry.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(entry.endMin);
      } else {
        laneEnds[lane] = entry.endMin;
      }
      entry.lane = lane;
    }
    for (const entry of cluster) result.push({ ...entry, lanes: laneEnds.length });
    cluster = [];
  };
  for (const entry of sorted) {
    if (cluster.length && entry.startMin >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    cluster.push({ ...entry, lane: 0, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, entry.endMin);
  }
  if (cluster.length) flush();
  return result;
};

const minutesInDay = (occurrence: CalendarOccurrence, day: Date) => {
  const dayStart = startOfDay(day).getTime();
  const start = Math.max(0, (parseISO(occurrence.start).getTime() - dayStart) / 60_000);
  const end = Math.min(24 * 60, (parseISO(occurrence.end).getTime() - dayStart) / 60_000);
  return { startMin: start, endMin: Math.max(end, start + 15) };
};

function TimeGrid({
  days,
  occurrences,
  tasks,
  exams,
  handlers,
  hourHeight = 46,
  fixedHours,
  onPickDay,
  onExpandHours
}: {
  days: Date[];
  occurrences: CalendarOccurrence[];
  tasks: Task[];
  exams: Exam[];
  handlers: Handlers;
  hourHeight?: number;
  fixedHours?: [number, number];
  onPickDay?: (day: Date) => void;
  onExpandHours?: () => void;
}) {
  const now = useNow(60_000);
  const grab = useRef<{ key: string; offsetMin: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Larghezza di una colonna giorno (52 px di etichette orarie, 6 px tra le colonne).
  const columnWidth = containerWidth ? (containerWidth - 52 - days.length * 6) / days.length : 200;

  const perDay = days.map((day) => {
    const dayStart = startOfDay(day).getTime();
    const dayEnd = dayStart + 24 * 60 * 60_000;
    const dayEvents = occurrences.filter((item) => parseISO(item.start).getTime() < dayEnd && parseISO(item.end).getTime() > dayStart);
    // Gli eventi "Tutto il giorno" non occupano corsie orarie: stanno nella riga in alto.
    const timed = dayEvents.filter((item) => !isAllDayEvent(item));
    return {
      day,
      allDay: dayEvents.filter(isAllDayEvent),
      placed: layoutDay(timed.map((item) => ({ item, ...minutesInDay(item, day) }))),
      tasks: tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day)).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
      exams: exams.filter((exam) => isSameDay(parseISO(exam.date), day))
    };
  });

  // Fascia oraria: 8–20 di base, allargata per includere gli eventi visibili.
  let [hourStart, hourEnd] = fixedHours ?? [8, 20];
  if (!fixedHours) {
    for (const entry of perDay) {
      for (const placed of entry.placed) {
        hourStart = Math.min(hourStart, Math.floor(placed.startMin / 60));
        hourEnd = Math.max(hourEnd, Math.ceil(placed.endMin / 60));
      }
    }
    hourStart = Math.max(0, hourStart);
    hourEnd = Math.min(24, hourEnd);
  }

  const hours = Array.from({ length: hourEnd - hourStart }, (_, index) => hourStart + index);
  const gridHeight = hours.length * hourHeight;
  const hasAllDay = perDay.some((entry) => entry.allDay.length || entry.tasks.length || entry.exams.length);
  // Fascia fissa (Focus 8–19): eventi interamente fuori fascia, che la griglia taglia.
  const hiddenBefore = fixedHours ? perDay.reduce((sum, entry) => sum + entry.placed.filter((placed) => placed.endMin <= hourStart * 60).length, 0) : 0;
  const hiddenAfter = fixedHours ? perDay.reduce((sum, entry) => sum + entry.placed.filter((placed) => placed.startMin >= hourEnd * 60).length, 0) : 0;
  const columns = `52px repeat(${days.length}, minmax(0, 1fr))`;

  const minutesFromPointer = (event: ReactMouseEvent<HTMLElement> | ReactDragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = hourStart * 60 + ((event.clientY - rect.top) / hourHeight) * 60;
    return Math.max(0, Math.min(24 * 60 - 15, Math.round(minutes / 15) * 15));
  };

  return (
    <div className="min-w-0" ref={containerRef}>
      {/* intestazione giorni */}
      <div className="grid grid-cols-1 gap-x-1.5" style={{ gridTemplateColumns: columns }}>
        <span />
        {days.map((day) => {
          const today = isSameDay(day, now);
          const content = (
            <>
              <span className="text-[11px] font-black uppercase text-[var(--faint)]">{format(day, "EEE", { locale: it })}</span>
              <span
                className={`grid h-8 min-w-8 place-items-center rounded-full px-1.5 text-lg font-black ${today ? "bg-[var(--accent)] text-[#10131d]" : ""}`}
              >
                {format(day, "d")}
              </span>
            </>
          );
          return onPickDay ? (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onPickDay(day)}
              className="flex items-center justify-center gap-1.5 rounded-[14px] py-1 hover:bg-[var(--surface-soft)] hover:underline hover:decoration-[var(--faint)] hover:underline-offset-4"
              aria-label={`Apri ${format(day, "EEEE d MMMM", { locale: it })}`}
              title={`Apri ${format(day, "EEEE d MMMM", { locale: it })}`}
            >
              {content}
            </button>
          ) : (
            <div key={day.toISOString()} className="flex items-center gap-1.5 py-1">
              {content}
            </div>
          );
        })}
      </div>

      {/* riga "tutto il giorno": eventi senza orario, esami e attività in scadenza */}
      {hasAllDay ? (
        <div className="mt-1.5 grid gap-x-1.5 border-b border-[var(--border)] pb-1.5" style={{ gridTemplateColumns: columns }}>
          <span
            className="pt-1 text-right text-[10px] font-black uppercase leading-tight text-[var(--faint)]"
            title="Eventi senza orario, esami e attività in scadenza"
          >
            Tutto il giorno
          </span>
          {perDay.map((entry) => {
            const dayKey = entry.day.toISOString();
            const base = days.length > 1 ? 3 : 12;
            const expanded = expandedDays.includes(dayKey);
            const limit = expanded ? Number.MAX_SAFE_INTEGER : base;
            const hidden = entry.tasks.length - limit;
            return (
              <div key={dayKey} className="grid grid-cols-1 min-w-0 content-start gap-1">
                {entry.allDay.map((item) => (
                  <AllDayChip key={item.occurrenceKey} item={item} handlers={handlers} />
                ))}
                {entry.exams.map((exam) => (
                  <ExamChip key={exam.id} exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} />
                ))}
                {entry.tasks.slice(0, limit).map((task) => (
                  <TaskChip key={task.id} task={task} handlers={handlers} />
                ))}
                {hidden > 0 ? (
                  <button
                    type="button"
                    onClick={() => (days.length > 1 ? onPickDay?.(entry.day) : setExpandedDays((value) => [...value, dayKey]))}
                    className="flex min-h-11 items-center text-left text-[11px] font-black text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    +{hidden} {hidden === 1 ? "altra" : "altre"}
                  </button>
                ) : expanded && days.length === 1 && entry.tasks.length > base ? (
                  <button
                    type="button"
                    onClick={() => setExpandedDays((value) => value.filter((key) => key !== dayKey))}
                    className="flex min-h-11 items-center text-left text-[11px] font-black text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    Mostra meno
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {hiddenBefore > 0 ? (
        <button
          type="button"
          onClick={onExpandHours}
          className="mt-1.5 w-full rounded-[14px] bg-[var(--surface-soft)] px-3 py-2 text-center text-xs font-black text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
        >
          {hiddenBefore} {hiddenBefore === 1 ? "evento prima" : "eventi prima"} delle {String(hourStart).padStart(2, "0")}:00 · mostra tutte le ore
        </button>
      ) : null}

      {/* corpo orario */}
      <div className="relative mt-1.5 grid gap-x-1.5" style={{ gridTemplateColumns: columns }}>
        <div className="relative" style={{ height: gridHeight }}>
          {hours.map((hour) => (
            <span
              key={hour}
              className="absolute right-1 -translate-y-1/2 text-[11px] font-black text-[var(--faint)]"
              style={{ top: (hour - hourStart) * hourHeight }}
            >
              {hour === hourStart ? "" : `${String(hour).padStart(2, "0")}:00`}
            </span>
          ))}
        </div>
        {perDay.map((entry) => {
          const key = entry.day.toISOString();
          const today = isSameDay(entry.day, now);
          const nowMin = (now.getTime() - startOfDay(entry.day).getTime()) / 60_000;
          return (
            <div
              key={key}
              role="presentation"
              title="Clicca su un orario libero per aggiungere un evento"
              className={`relative cursor-copy overflow-hidden rounded-[14px] ${dropTarget === key ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : today ? "bg-[var(--surface-soft)]" : ""}`}
              style={{
                height: gridHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${hourHeight}px)`
              }}
              onClick={(event) => {
                const minutes = minutesFromPointer(event);
                handlers.onCreate(addMinutes(startOfDay(entry.day), Math.floor(minutes / 30) * 30));
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(key);
              }}
              onDragLeave={() => setDropTarget((value) => (value === key ? null : value))}
              onDrop={(event) => {
                event.preventDefault();
                setDropTarget(null);
                const dragged = grab.current;
                grab.current = null;
                if (!dragged) return;
                const item = occurrences.find((occurrence) => occurrence.occurrenceKey === dragged.key);
                if (!item) return;
                const minutes = Math.max(0, minutesFromPointer(event) - Math.round(dragged.offsetMin / 15) * 15);
                handlers.onMoveEvent(item, addMinutes(startOfDay(entry.day), minutes));
              }}
            >
              {today && nowMin >= hourStart * 60 && nowMin <= hourEnd * 60 ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 right-0 z-10 h-0.5 bg-[var(--accent-3)]"
                  style={{ top: ((nowMin - hourStart * 60) / 60) * hourHeight }}
                >
                  <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--accent-3)]" />
                </span>
              ) : null}
              {entry.placed.map((placed) => {
                const top = ((placed.startMin - hourStart * 60) / 60) * hourHeight;
                const height = Math.max(20, ((placed.endMin - placed.startMin) / 60) * hourHeight - 2);
                const color = eventColor(placed.item, handlers.subjects);
                const width = 100 / placed.lanes;
                // Colonne strette (tablet in verticale): eventi sovrapposti a cascata invece che
                // in corsie affiancate da 30 px, dove il titolo diventerebbe illeggibile.
                const cascade = placed.lanes > 1 && columnWidth / placed.lanes < 72;
                const position = cascade
                  ? { left: `${placed.lane * 10}px`, width: `calc(100% - ${placed.lane * 10 + 2}px)`, zIndex: 1 + placed.lane }
                  : { left: `calc(${placed.lane * width}% + 1px)`, width: `calc(${width}% - 3px)` };
                // Righe disponibili nel blocco: il titolo ha la precedenza (colonne strette su tablet),
                // l'orario compare da 3 righe, la materia da 5.
                const lineCount = Math.max(1, Math.floor((height - 6) / 13.75));
                const showTime = lineCount >= 3;
                const showSubject = lineCount >= 5 && Boolean(occurrenceSubject(placed.item, handlers.subjects));
                const titleLines = Math.min(5, Math.max(1, lineCount - (showTime ? 1 : 0) - (showSubject ? 1 : 0)));
                return (
                  <button
                    key={placed.item.occurrenceKey}
                    type="button"
                    draggable={canDrag(placed.item)}
                    onDragStart={(event) => {
                      if (!canDrag(placed.item)) {
                        event.preventDefault();
                        return;
                      }
                      const rect = event.currentTarget.getBoundingClientRect();
                      grab.current = { key: placed.item.occurrenceKey, offsetMin: ((event.clientY - rect.top) / hourHeight) * 60 };
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", placed.item.occurrenceKey);
                      handlers.onPreviewHide();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.onEditEvent(placed.item.id, placed.item.sharedFrom?.ownerId);
                    }}
                    onMouseEnter={(event) => handlers.onPreviewEvent(placed.item, pointerPoint(event))}
                    onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
                    onMouseLeave={handlers.onPreviewHide}
                    className={`absolute overflow-hidden rounded-[10px] border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight hover:z-20 hover:brightness-110 ${
                      placed.item.status === "done" ? "opacity-60" : ""
                    } ${sharedOutlineClass(placed.item)}`}
                    style={{
                      top,
                      height,
                      ...position,
                      borderLeftColor: color,
                      background: `color-mix(in srgb, ${color} 24%, var(--bg-2))`,
                      boxShadow: cascade ? "0 0 0 1px var(--bg-2)" : undefined,
                      ...sharedOutline(placed.item)
                    }}
                  >
                    <span
                      className="safe-text font-black"
                      style={{ display: "-webkit-box", WebkitLineClamp: titleLines, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                    >
                      {placed.item.sharedFrom ? (
                        <>
                          <SharedMark origin={placed.item.sharedFrom} compact />{" "}
                        </>
                      ) : null}
                      {placed.item.recurring ? (
                        <span role="img" aria-label="Si ripete">
                          ↻{" "}
                        </span>
                      ) : null}
                      {placed.item.title}
                    </span>
                    {showTime ? (
                      <span className="one-line-safe block font-bold text-[var(--muted)]">
                        {timeLabel(placed.item.start)}–{timeLabel(placed.item.end)}
                      </span>
                    ) : null}
                    {showSubject ? (
                      <span className="one-line-safe block font-bold text-[var(--muted)]">{occurrenceSubject(placed.item, handlers.subjects)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {hiddenAfter > 0 ? (
        <button
          type="button"
          onClick={onExpandHours}
          className="mt-1.5 w-full rounded-[14px] bg-[var(--surface-soft)] px-3 py-2 text-center text-xs font-black text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
        >
          {hiddenAfter} {hiddenAfter === 1 ? "evento dopo" : "eventi dopo"} le {String(hourEnd).padStart(2, "0")}:00 · mostra tutte le ore
        </button>
      ) : null}
    </div>
  );
}

function TaskChip({ task, handlers }: { task: Task; handlers: Handlers }) {
  const done = task.status === "done";
  const overdue = !done && task.dueDate ? isBefore(parseISO(task.dueDate), new Date()) : false;
  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 rounded-[10px] bg-[var(--surface-soft)] px-1.5 py-1 text-[11px] font-bold hover:bg-[var(--surface)] ${done ? "opacity-55" : ""}`}
      title={task.title}
    >
      <button
        type="button"
        aria-label={done ? `Segna "${task.title}" come da fare` : `Segna "${task.title}" come fatta`}
        onClick={(event) => {
          event.stopPropagation();
          handlers.onToggleTask(task.id);
        }}
        className="relative grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-[1.5px] after:absolute after:-inset-4 after:content-['']"
        style={{ borderColor: PRIORITY_TONE[task.priority], background: done ? PRIORITY_TONE[task.priority] : "transparent" }}
      >
        {done ? <Icon name="Check" className="h-2.5 w-2.5 text-[#10131d]" /> : null}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          handlers.onEditTask(task.id);
        }}
        onMouseEnter={(event) => handlers.onPreviewTask(task, pointerPoint(event))}
        onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
        onMouseLeave={handlers.onPreviewHide}
        aria-label={`Apri l'attività "${task.title}"`}
        className={`min-w-0 flex-1 truncate text-left ${done ? "line-through" : ""} ${overdue ? "text-[var(--danger-text)]" : ""}`}
      >
        {task.title}
      </button>
    </div>
  );
}

function AllDayChip({ item, handlers }: { item: CalendarOccurrence; handlers: Handlers }) {
  const color = eventColor(item, handlers.subjects);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        handlers.onEditEvent(item.id, item.sharedFrom?.ownerId);
      }}
      onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
      onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
      onMouseLeave={handlers.onPreviewHide}
      className={`flex min-w-0 items-center gap-1.5 rounded-[10px] px-1.5 py-1 text-left text-[11px] font-black hover:brightness-110 ${
        item.status === "done" ? "opacity-60" : ""
      } ${sharedOutlineClass(item)}`}
      style={{ background: `color-mix(in srgb, ${color} 26%, var(--bg-2))`, ...sharedOutline(item) }}
      title={`${allDayEventLabel(item)} · ${item.title}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {item.sharedFrom ? <SharedMark origin={item.sharedFrom} compact /> : null}
      <span className="min-w-0 truncate">
        {item.recurring ? (
          <span role="img" aria-label="Si ripete">
            ↻{" "}
          </span>
        ) : null}
        {item.title}
      </span>
    </button>
  );
}

function ExamChip({ exam, subjects, onOpen }: { exam: Exam; subjects: Subjects; onOpen: (id: string) => void }) {
  const color = subjectColor(subjects, exam.subjectId);
  const name = subjectName(subjects, exam.subjectId);
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-1.5 rounded-[10px] px-1.5 py-1 text-left text-[11px] font-black hover:brightness-110"
      style={{ background: `color-mix(in srgb, ${color} 26%, var(--bg-2))` }}
      title={`Esame di ${name} · preparazione al ${exam.preparation}%`}
      aria-label={CALENDAR_TEXT.openExamAria(name)}
      onClick={(event) => {
        // Nella cella del mese e nella griglia oraria il click crea un evento: aprire un esame non deve farlo.
        event.stopPropagation();
        onOpen(exam.id);
      }}
    >
      <Icon name="GraduationCap" className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">Esame · {name}</span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Settimana su mobile: elenco per giorno                               */
/* ------------------------------------------------------------------ */

function DayList({
  days,
  occurrences,
  tasks,
  exams,
  handlers,
  empty: emptyWeek
}: {
  days: Date[];
  occurrences: CalendarOccurrence[];
  tasks: Task[];
  exams: Exam[];
  handlers: Handlers;
  /** Al posto di sette "Nessun impegno" quando tutta la settimana è vuota. */
  empty?: ReactNode;
}) {
  const perDay = days.map((day) => {
    const dayEvents = occurrences.filter((item) => isSameDay(parseISO(item.start), day));
    const dayTasks = tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day));
    const dayExams = exams.filter((exam) => isSameDay(parseISO(exam.date), day));
    return { day, dayEvents, dayTasks, dayExams, empty: !dayEvents.length && !dayTasks.length && !dayExams.length };
  });
  if (perDay.every((entry) => entry.empty)) return <>{emptyWeek}</>;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {perDay.map(({ day, dayEvents, dayTasks, dayExams, empty }) => {
        return (
          <section key={day.toISOString()} aria-label={format(day, "EEEE d MMMM", { locale: it })}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className={`text-sm font-black capitalize ${isSameDay(day, new Date()) ? "text-[var(--accent-ink)]" : ""}`}>{format(day, "EEEE d MMMM", { locale: it })}</h3>
              <button
                type="button"
                onClick={() => handlers.onCreate(defaultStartFor(day))}
                className="grid h-11 min-w-11 place-items-center rounded-full bg-[var(--surface-soft)] px-2.5"
                aria-label={`Aggiungi un evento il ${format(day, "d MMMM", { locale: it })}`}
                title={`Aggiungi un evento il ${format(day, "d MMMM", { locale: it })}`}
              >
                <Icon name="Plus" className="h-4 w-4" />
              </button>
            </div>
            {empty ? (
              <p className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-2 text-xs font-bold text-[var(--faint)]">Nessun impegno</p>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                {dayExams.map((exam) => (
                  <li key={exam.id}>
                    <ExamChip exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} />
                  </li>
                ))}
                {dayEvents.map((item) => (
                  <li key={item.occurrenceKey}>
                    <EventRow item={item} handlers={handlers} />
                  </li>
                ))}
                {dayTasks.map((task) => (
                  <li key={task.id}>
                    <TaskChip task={task} handlers={handlers} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function EventRow({ item, handlers }: { item: CalendarOccurrence; handlers: Handlers }) {
  const color = eventColor(item, handlers.subjects);
  const allDay = isAllDayEvent(item);
  return (
    <button
      type="button"
      onClick={() => handlers.onEditEvent(item.id, item.sharedFrom?.ownerId)}
      onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
      onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
      onMouseLeave={handlers.onPreviewHide}
      className={`flex w-full min-w-0 items-center gap-3 rounded-[14px] px-2.5 py-2 text-left hover:bg-[var(--surface-soft)] ${item.status === "done" ? "opacity-60" : ""} ${sharedOutlineClass(item)}`}
      style={sharedOutline(item)}
    >
      {allDay ? (
        <span className="w-12 shrink-0 text-center text-xs font-black text-[var(--faint)]" title={allDayEventLabel(item)} aria-hidden="true">
          —
        </span>
      ) : (
        <span className="w-12 shrink-0 text-xs font-black tabular-nums">{timeLabel(item.start)}</span>
      )}
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="one-line-safe block text-sm font-extrabold">
          {item.recurring ? (
            <span role="img" aria-label="Si ripete">
              ↻{" "}
            </span>
          ) : null}
          {item.title}
        </span>
        <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
          {allDay ? allDayEventLabel(item) : `${timeLabel(item.start)}–${timeLabel(item.end)}`}
          {occurrenceSubject(item, handlers.subjects) ? ` · ${occurrenceSubject(item, handlers.subjects)}` : ""}
        </span>
      </span>
      {item.sharedFrom ? <SharedMark origin={item.sharedFrom} /> : null}
      <Tag className="hidden shrink-0 sm:inline-flex">{EVENT_CATEGORY_LABEL[item.category]}</Tag>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Mese                                                                 */
/* ------------------------------------------------------------------ */

function MonthGrid({
  days,
  month,
  occurrences,
  tasks,
  exams,
  handlers,
  onPickDay
}: {
  days: Date[];
  month: Date;
  occurrences: CalendarOccurrence[];
  tasks: Task[];
  exams: Exam[];
  handlers: Handlers;
  onPickDay: (day: Date) => void;
}) {
  const [dropDay, setDropDay] = useState<string | null>(null);
  const dragged = useRef<string | null>(null);
  const limit = 3;
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
      {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => (
        <div key={day} className="px-1 pb-1 text-[11px] font-black uppercase text-[var(--faint)]">
          {day}
        </div>
      ))}
      {days.map((day) => {
        const key = day.toISOString();
        const dayEvents = occurrences.filter((item) => isSameDay(parseISO(item.start), day));
        const dayTasks = tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day));
        const dayExams = exams.filter((exam) => isSameDay(parseISO(exam.date), day));
        const total = dayEvents.length + dayTasks.length + dayExams.length;
        const today = isSameDay(day, new Date());
        const outside = !isSameMonth(day, month);
        let shown = 0;
        return (
          <div
            key={key}
            role="presentation"
            title="Clicca per aggiungere un evento in questo giorno"
            onClick={() => handlers.onCreate(defaultStartFor(day))}
            onDragOver={(event) => {
              event.preventDefault();
              setDropDay(key);
            }}
            onDragLeave={() => setDropDay((value) => (value === key ? null : value))}
            onDrop={(event) => {
              event.preventDefault();
              setDropDay(null);
              const item = occurrences.find((occurrence) => occurrence.occurrenceKey === dragged.current);
              dragged.current = null;
              if (!item) return;
              const start = parseISO(item.start);
              const next = startOfDay(day);
              next.setHours(start.getHours(), start.getMinutes(), 0, 0);
              handlers.onMoveEvent(item, next);
            }}
            className={`min-h-[68px] min-w-0 cursor-copy rounded-[14px] border p-1 sm:min-h-[112px] sm:p-1.5 ${
              dropDay === key ? "border-[var(--accent)]" : "border-[var(--border)]"
            } ${outside ? "opacity-45" : ""} ${today ? "bg-[var(--surface)]" : "bg-[var(--surface-soft)]"}`}
          >
            <div className="mb-1 flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onPickDay(day);
                }}
                className={`relative grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-black before:absolute before:-inset-2.5 before:content-[""] hover:bg-[var(--surface-strong)] ${
                  today ? "bg-[var(--accent)] text-[#10131d] hover:bg-[var(--accent)]" : ""
                }`}
                aria-label={`Apri ${format(day, "EEEE d MMMM", { locale: it })}`}
                title={`Apri ${format(day, "EEEE d MMMM", { locale: it })}`}
              >
                {format(day, "d")}
              </button>
              {total ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] sm:hidden" /> : null}
            </div>
            <div className="hidden gap-0.5 sm:grid">
              {dayExams.map((exam) => {
                shown += 1;
                return shown <= limit ? <ExamChip key={exam.id} exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} /> : null;
              })}
              {dayEvents.map((item) => {
                shown += 1;
                if (shown > limit) return null;
                const color = eventColor(item, handlers.subjects);
                const allDay = isAllDayEvent(item);
                return (
                  <button
                    key={item.occurrenceKey}
                    type="button"
                    draggable={canDrag(item)}
                    onDragStart={(event) => {
                      if (!canDrag(item)) {
                        event.preventDefault();
                        return;
                      }
                      dragged.current = item.occurrenceKey;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.occurrenceKey);
                      handlers.onPreviewHide();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.onEditEvent(item.id, item.sharedFrom?.ownerId);
                    }}
                    onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
                    onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
                    onMouseLeave={handlers.onPreviewHide}
                    className={`flex min-w-0 items-center gap-1 rounded-[8px] px-1 py-0.5 text-left text-[11px] ${
                      allDay ? "font-black hover:brightness-110" : "font-bold hover:bg-[var(--surface-strong)]"
                    } ${sharedOutlineClass(item)}`}
                    style={allDay ? { background: `color-mix(in srgb, ${color} 26%, var(--bg-2))`, ...sharedOutline(item) } : sharedOutline(item)}
                    title={allDay ? `${allDayEventLabel(item)} · ${item.title}` : `${timeLabel(item.start)} · ${item.title}`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                    {item.sharedFrom ? <SharedMark origin={item.sharedFrom} compact /> : null}
                    {allDay ? null : <span className="shrink-0 tabular-nums text-[var(--muted)]">{timeLabel(item.start)}</span>}
                    <span className="min-w-0 truncate">{item.title}</span>
                  </button>
                );
              })}
              {dayTasks.map((task) => {
                shown += 1;
                return shown <= limit ? <TaskChip key={task.id} task={task} handlers={handlers} /> : null;
              })}
              {total > limit ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPickDay(day);
                  }}
                  className="flex min-h-11 items-center px-1 text-left text-[11px] font-black text-[var(--muted)] hover:text-[var(--text)]"
                >
                  +{total - limit} altri
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agenda                                                               */
/* ------------------------------------------------------------------ */

function Agenda({
  from,
  to,
  occurrences,
  tasks,
  exams,
  handlers,
  empty
}: {
  from: Date;
  to: Date;
  occurrences: CalendarOccurrence[];
  tasks: Task[];
  exams: Exam[];
  handlers: Handlers;
  /** Stato vuoto al posto di quello generico (es. con il filtro per materia). */
  empty?: ReactNode;
}) {
  const overdue = tasks
    .filter((task) => task.status !== "done" && task.dueDate && isBefore(parseISO(task.dueDate), startOfDay(new Date())))
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const days = eachDayOfInterval({ start: from, end: addDays(to, -1) });
  const sections = days
    .map((day) => ({
      day,
      events: occurrences.filter((item) => isSameDay(parseISO(item.start), day)),
      tasks: tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day)),
      exams: exams.filter((exam) => isSameDay(parseISO(exam.date), day))
    }))
    .filter((section) => section.events.length || section.tasks.length || section.exams.length);

  if (!sections.length && !overdue.length) {
    if (empty) return <>{empty}</>;
    return (
      <EmptyState
        icon="CalendarDays"
        title="Niente in programma"
        body="In queste due settimane non hai eventi, scadenze o esami: quello che aggiungi comparirà qui, giorno per giorno."
        action={
          <Button variant="primary" icon="Plus" onClick={() => handlers.onCreate(defaultStartFor(from))}>
            Nuovo evento
          </Button>
        }
      />
    );
  }

  const dayTitle = (day: Date) => {
    const diff = daysUntil(day);
    const base = format(day, "EEEE d MMMM", { locale: it });
    return diff === 0 ? `Oggi · ${base}` : diff === 1 ? `Domani · ${base}` : base;
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {overdue.length && isSameDay(from, startOfDay(new Date())) ? (
        <section aria-label="Attività in ritardo">
          <h3 className="mb-1.5 text-xs font-black uppercase text-[var(--danger-text)]">In ritardo · {overdue.length}</h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 sm:grid-cols-2">
            {overdue.map((task) => (
              <li key={task.id}>
                <TaskChip task={task} handlers={handlers} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sections.map((section) => (
        <section key={section.day.toISOString()} aria-label={dayTitle(section.day)} className="grid grid-cols-[minmax(0,1fr)] gap-1 md:grid-cols-[180px_minmax(0,1fr)] md:gap-4">
          <h3 className={`pt-2 text-sm font-black capitalize ${isSameDay(section.day, new Date()) ? "text-[var(--accent-ink)]" : ""}`}>{dayTitle(section.day)}</h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
            {section.exams.map((exam) => (
              <li key={exam.id} className="px-2.5 py-1">
                <ExamChip exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} />
              </li>
            ))}
            {section.events.map((item) => (
              <li key={item.occurrenceKey}>
                <EventRow item={item} handlers={handlers} />
              </li>
            ))}
            {section.tasks.length ? (
              <li className="grid grid-cols-[minmax(0,1fr)] gap-1 px-2.5 py-1 sm:grid-cols-2">
                {section.tasks.map((task) => (
                  <TaskChip key={task.id} task={task} handlers={handlers} />
                ))}
              </li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Anteprima al passaggio del mouse                                     */
/* ------------------------------------------------------------------ */

function CalendarHoverPreview({ preview, subjects }: { preview: CalendarPreviewState; subjects: Subjects }) {
  const width = 320;
  const height = preview.kind === "event" ? 200 : 240;
  const left = Math.min(Math.max(12, preview.x + 16), Math.max(12, window.innerWidth - width - 12));
  const top = Math.min(Math.max(12, preview.y + 16), Math.max(12, window.innerHeight - height - 12));
  const accent = preview.kind === "event" ? eventColor(preview.event, subjects) : subjectColor(subjects, preview.task.subjectId);
  const taskTimerRunning = preview.kind === "task" && isTaskTimerRunning(preview.task);
  const taskElapsed = preview.kind === "task" ? taskElapsedSeconds(preview.task) : 0;
  const taskCompletedLate = preview.kind === "task" && isTaskCompletedLate(preview.task);

  return (
    <aside
      aria-hidden="true"
      className="pointer-events-none fixed z-[60] w-[min(320px,calc(100vw-24px))] rounded-[24px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] p-4 text-left shadow-soft backdrop-blur-2xl"
      style={{ left, top }}
    >
      <div className="mb-2 flex items-start gap-3">
        <span className="mt-1 h-9 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase text-[var(--faint)]">
            {preview.kind === "event" ? EVENT_CATEGORY_LABEL[preview.event.category] : "Attività"}
          </p>
          <h4 className="two-line-safe text-base font-black">{preview.kind === "event" ? preview.event.title : preview.task.title}</h4>
        </div>
      </div>

      {preview.kind === "event" ? (
        <div className="grid grid-cols-1 gap-2 text-sm">
          <p className="font-bold text-[var(--muted)]">
            {capitalizeFirst(format(parseISO(preview.event.start), "EEEE d MMM", { locale: it }))} ·{" "}
            {isAllDayEvent(preview.event) ? allDayEventLabel(preview.event) : `${timeLabel(preview.event.start)}–${timeLabel(preview.event.end)} · ${formatMinutes(eventMinutes(preview.event))}`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {preview.event.sharedFrom ? <SharedMark origin={preview.event.sharedFrom} /> : null}
            <Tag color={accent}>{preview.event.sharedFrom ? preview.event.sharedFrom.subjectName ?? NO_SUBJECT_LABEL : subjectName(subjects, preview.event.subjectId)}</Tag>
            <Tag>{EVENT_STATUS_LABEL[preview.event.status]}</Tag>
            {preview.event.recurrence && preview.event.recurrence !== "none" ? <Tag>{RECURRENCE_LABEL[preview.event.recurrence]}</Tag> : null}
            {preview.event.category === "deadline" || preview.event.category === "exam" ? <Tag>{studyDaysLabel(preview.event.start)}</Tag> : null}
          </div>
          {preview.event.description || preview.event.notes ? (
            <p className="three-line-safe text-[var(--muted)]">{preview.event.description || preview.event.notes}</p>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 text-sm">
          <p className="font-bold text-[var(--muted)]">
            {preview.task.dueDate ? `${shortDate(preview.task.dueDate)} · ${timeLabel(preview.task.dueDate)}` : "Nessuna data"} ·{" "}
            {subjectName(subjects, preview.task.subjectId)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Tag color={PRIORITY_TONE[preview.task.priority]}>{PRIORITY_LABEL[preview.task.priority]}</Tag>
            <Tag>{TASK_STATUS_LABEL[preview.task.status]}</Tag>
            <Tag>{ENERGY_LABEL[preview.task.energy]}</Tag>
            <Tag>
              {formatMinutes(preview.task.estimatedMinutes)} stimati
              {taskTimerRunning ? ` · ⏱ ${formatElapsedSeconds(taskElapsed)}` : preview.task.actualMinutes !== undefined ? ` · ${preview.task.actualMinutes} min reali` : ""}
            </Tag>
            {taskCompletedLate ? <Tag className="text-[var(--warning-text)]">Completata in ritardo</Tag> : null}
          </div>
          {preview.task.description || preview.task.notes ? (
            <p className="three-line-safe text-[var(--muted)]">{preview.task.description || preview.task.notes}</p>
          ) : null}
        </div>
      )}
    </aside>
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
              aria-label={`${CALENDAR_TEXT.openExamAria(name)} · ${days} ${days === 1 ? "giorno" : "giorni"}`}
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
                  aria-label={CALENDAR_TEXT.openExamAria(subjectName(subjects, exam.subjectId))}
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
                aria-label={`${CALENDAR_TEXT.summaryShow(subject.name)} · ${CALENDAR_TEXT.summaryItems(row.items)}`}
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
                aria-label={CALENDAR_TEXT.openSubjectAria(subject.name)}
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

/**
 * Riga "Tutte · Analisi · Fisica…": scorre in orizzontale dentro la riga (mai la pagina). Con un
 * filtro attivo, a sinistra e sempre visibile, il chip "Solo: Analisi ✕" che lo toglie.
 */
function SubjectFilterBar({ subjects, active, onChange }: { subjects: Subjects; active: Subjects[number] | null; onChange: (id: string | null) => void }) {
  const rowRef = useRef<HTMLDivElement>(null);
  const options = selectableSubjects(subjects, active?.id);
  // La pillola attiva resta in vista anche quando la riga scorre (telefono).
  useEffect(() => {
    const row = rowRef.current;
    const pressed = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !pressed) return;
    const start = pressed.offsetLeft - row.offsetLeft;
    const end = start + pressed.offsetWidth;
    if (start < row.scrollLeft) row.scrollTo({ left: Math.max(0, start - 12) });
    else if (end > row.scrollLeft + row.clientWidth) row.scrollTo({ left: end - row.clientWidth + 12 });
  }, [active?.id]);
  if (!options.length) return null;
  const pill = (pressed: boolean) =>
    `motion-safe inline-flex min-h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-extrabold ${
      pressed
        ? "border-transparent bg-[var(--accent)] text-[#10131d]"
        : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
    }`;
  return (
    <div className="mb-4 flex min-w-0 items-center gap-2">
      {active ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={CALENDAR_TEXT.clearFilter(active.name)}
          title={CALENDAR_TEXT.showAll}
          className="motion-safe inline-flex min-h-9 max-w-[50%] shrink-0 items-center gap-1.5 rounded-full border border-[var(--accent-ink)] bg-[var(--surface-strong)] px-3 text-xs font-black text-[var(--text)] hover:bg-[var(--surface)]"
        >
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: safeCssColor(active.color) || "var(--accent)" }} />
          <span className="min-w-0 truncate">{CALENDAR_TEXT.onlySubject(active.name)}</span>
          <Icon name="X" className="h-3.5 w-3.5 shrink-0" />
        </button>
      ) : null}
      <div ref={rowRef} role="group" aria-label={CALENDAR_TEXT.filterLabel} className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5">
        <button type="button" aria-pressed={!active} onClick={() => onChange(null)} className={pill(!active)}>
          {CALENDAR_TEXT.allSubjects}
        </button>
        {options.map((subject) => {
          const pressed = active?.id === subject.id;
          return (
            <button key={subject.id} type="button" aria-pressed={pressed} onClick={() => onChange(pressed ? null : subject.id)} className={pill(pressed)}>
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: safeCssColor(subject.color) || "var(--accent)" }} />
              {subject.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}

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
