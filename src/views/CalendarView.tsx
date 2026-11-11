import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { useShallow } from "zustand/react/shallow";
import {
  addDays,
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
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { sharedOfTypes, useSharedStore } from "../store/useSharedStore";
import { originOf, ownerColor, safeCssColor, sharedKey, ShareUserError, type SharedEntity } from "../lib/sharing";
import { createId } from "../lib/id";
import type { CalendarEvent, EventOccasion, Exam, OccasionKind } from "../types";
import {
  Button,
  EmptyState,
  HelpTip,
  IconButton,
  PageActions,
  Panel,
  SectionTitle,
  Segmented,
  Tag,
  type PageAction
} from "../components/ui";
import { Icon } from "../components/Icon";
import { BarbExamImport } from "../components/BarbExamImport";
import { SEMESTER_LABEL, SEMESTER_TONE, subjectSemester } from "../lib/semesters";
import { CalendarTransfer, transferMenuItem, type CalendarTransferHandle } from "../components/CalendarTransfer";
import { TaskEditorModal } from "../components/TaskEditorModal";
import { EventEditor } from "../components/calendar/EventEditor";
import { ScopeChoice } from "../components/calendar/ScopeChoice";
import { OccasionForm, occasionIcon } from "../components/calendar/OccasionForm";
import { VacationForm } from "../components/calendar/VacationForm";
import { TypeColorsDrawer } from "../components/calendar/TypeColorsDrawer";
import { sanitizeTypeColorOverrides } from "../lib/eventColors";
import { draftFromEvent, editorFormFor, initialColorCustom, newEventDraft, rowHasOwnContent, scopeOptions, type EventDraft, type ScopeOption } from "../lib/eventEditor";
import { occurrenceEditCalls, scopeImpact, seriesMovePatch, seriesSpan, userRuleChange, type ScopeImpact } from "../lib/occurrenceEdit";
import {
  newOccasionDraft,
  newVacationDraft,
  OCCASION_KINDS,
  occasionChanges,
  occasionDraftFromEvent,
  occasionFields,
  vacationChanges,
  vacationDraftFromEvent,
  vacationFields
} from "../lib/occasionForms";
import { findOccurrence, occurrenceTarget } from "../lib/occurrenceLookup";
import { applyRepeatFields, changesRepeat, isOccurrenceRow, normalizeRepeat, type OccurrenceScope } from "../lib/repeat";
import { civilDateOf, deviceTimeZone, isCivilDate, parseCivil } from "../lib/tz";
import { daysUntil, shortDate, subjectColor, subjectName } from "../lib/selectors";
import { expandEvents } from "../lib/recurrence";
import {
  CALENDAR_HELP,
  CALENDAR_TEXT,
  CALENDAR_VIEW_TEXT,
  EVENT_EDITOR_TEXT,
  EXAM_STATUS_LABEL,
  OCCASION_FORM_TEXT,
  OCCASION_KIND_LABEL,
  OFFICIAL_EXAMS_ADD_LABEL,
  REPEAT_PICKER_TEXT,
  SCOPE_TEXT,
  SHARE_TEXT,
  TYPE_COLORS_TEXT,
  VACATION_FORM_TEXT
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
import type {
  CalendarOccurrence,
  CalendarPreviewState,
  Handlers,
  SharedCalendarEvent,
  ShownEvent,
  Subjects
} from "../components/calendar/types";

// Pannello Condividi (e CloudPanel con supabase-js) caricato solo quando si apre dal menu.
const loadShareDrawer = () => import("../components/ShareDrawer");
const ShareDrawer = lazy(() => loadShareDrawer().then((module) => ({ default: module.ShareDrawer })));

type StoredCalendarMode = (typeof STORED_CALENDAR_MODES)[number];

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

/** Titolo accorciato per le conferme. */
const shortTitle = (title: string) => (title.length > 80 ? `${title.slice(0, 77)}…` : title);
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Campi per un evento nuovo dal modulo: niente campi vuoti in più; il fuso è quello del dispositivo. */
const newEventFields = (patch: Partial<CalendarEvent>) => {
  const { allDay, reminders, repeat, location, ...rest } = patch;
  return {
    ...rest,
    title: patch.title ?? "",
    start: patch.start ?? "",
    end: patch.end ?? "",
    ...(allDay ? { allDay: true } : {}),
    ...(reminders?.length ? { reminders } : {}),
    ...(repeat ? { repeat } : {}),
    ...(location ? { location } : {}),
    timeZone: deviceTimeZone()
  };
};

const supportsHoverPreview = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

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
  // Giorno dell'occorrenza aperta di una serie (YYYY-MM-DD): con l'id la ritrova anche dopo un refresh.
  const [editingDate, setEditingDate] = useUiState<string | null>("calendar.editingDate", null, {
    scope: "tab",
    validate: (value): value is string | null => value === null || isCivilDate(value)
  });
  const closeEventEditor = () => {
    setEditingEventId(null);
    setEditingDate(null);
    setFullForm(null);
  };
  // Scelta "Solo questo · Questo e i successivi · Tutti" in attesa di risposta.
  const [scopeRequest, setScopeRequest] = useState<{ heading: string; options: ScopeOption[]; danger: boolean; resolve: (scope: OccurrenceScope | null) => void } | null>(null);
  const askScope = (heading: string, options: ScopeOption[], danger = false) =>
    new Promise<OccurrenceScope | null>((resolve) => setScopeRequest({ heading, options, danger, resolve }));
  const answerScope = (scope: OccurrenceScope | null) => {
    scopeRequest?.resolve(scope);
    setScopeRequest(null);
  };
  const [editingTaskId, setEditingTaskId] = useUiState<string | null>("calendar.editingTask", null, { scope: "tab", validate: isNullableString });
  // `draft` / `occasion`: dal modulo semplice ("Modulo completo"), con ciò che si era già scritto.
  const [creator, setCreator] = useState<{ at: Date; kind: "event" | "task"; subjectId?: string; draft?: EventDraft; occasion?: EventOccasion } | null>(null);
  // Percorsi semplici nuovi: ricorrenza (compleanno, anniversario…) o vacanza.
  const [simpleNew, setSimpleNew] = useState<{ form: "occasion"; kind?: OccasionKind; name?: string } | { form: "vacation"; title?: string } | null>(null);
  // Ricorrenza o vacanza aperta nel modulo completo, con le modifiche fatte nel modulo semplice.
  const [fullForm, setFullForm] = useState<{ id: string; draft: EventDraft } | null>(null);
  const [typeColorsOpen, setTypeColorsOpen] = useState(false);
  const [preview, setPreview] = useState<CalendarPreviewState | null>(null);
  const [barbImportOpen, setBarbImportOpen] = useState(false);
  const [sharePhase, setSharePhase] = useState<"idle" | "loading" | "open">("idle");
  const transfer = useRef<CalendarTransferHandle>(null);
  const {
    events,
    subjects,
    exams,
    tasks,
    loading,
    locked,
    updateEvent,
    addEvent,
    deleteEvent,
    editOccurrence,
    deleteOccurrence,
    addTask,
    updateTask,
    toggleTask,
    deleteTask,
    setActiveView,
    preferences,
    updatePreferences
  } = useStudyStore();
  // "Colori delle tipologie" (preferenza sincronizzata: ripulita prima dell'uso).
  const typeOverrides = useMemo(() => sanitizeTypeColorOverrides(selectPreferences({ preferences }).eventTypeColors), [preferences]);
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
    if (sharedDraftDirty.current) setNotice(EVENT_EDITOR_TEXT.sharedGoneDraft);
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
  // Giorno aperto di una serie: la sua riga (se cambiato da solo) o la serie con gli orari di quel giorno.
  const editingOccurrence = useMemo(
    () => (editingEventId && editingDate ? findOccurrence(events, editingEventId, editingDate) : null),
    [events, editingEventId, editingDate]
  );
  const editingSeries = editingOccurrence
    ? events.find((event) => event.id === occurrenceTarget(editingOccurrence).seriesId && !isOccurrenceRow(event)) ?? null
    : null;
  /** Modulo dell'evento aperto: ricorrenza e vacanza hanno il loro, salvo "Modulo completo". */
  const editingForm = editingEvent && !editingDate && fullForm?.id !== editingEvent.id ? editorFormFor(editingEvent) : "event";
  const todayCivil = civilDateOf(new Date());
  const editingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) ?? null : null;
  /** Colore della materia per il modulo (le tipologie con materia ne prendono il colore). */
  const ownColorContext = (subjectId?: string) => ({ subjectColor: subjects.find((subject) => subject.id === subjectId)?.color, overrides: typeOverrides });
  /** Bozza del modulo completo da campi già pronti (dal modulo semplice), sopra l'evento salvato se c'è. */
  const draftFromFields = (fields: Partial<CalendarEvent>, saved?: CalendarEvent) =>
    draftFromEvent({ links: [], priority: "medium", status: "planned", description: "", ...saved, ...fields } as CalendarEvent, ownColorContext(saved?.subjectId));
  const startYearOf = (event: CalendarEvent) => parseCivil(civilDateOf(new Date(event.start)))?.year;
  /** Colore scelto a mano per l'evento (per l'anteprima dei moduli semplici), se c'è. */
  const customColorOf = (event: CalendarEvent) =>
    initialColorCustom(event, ownColorContext(event.subjectId).subjectColor) ? safeCssColor(event.color) || undefined : undefined;

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
  // Le righe dei giorni cambiati da soli non sono eventi in più.
  const subjectSummary = useMemo(
    () => subjectCalendarSummary({ subjects, events: events.filter((event) => !isOccurrenceRow(event)), exams, tasks }),
    [subjects, events, exams, tasks]
  );
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

  /** La serie di un mio evento che si ripete (non la riga di un giorno) e il fuso che la modifica le fisserà. */
  const ownSeriesOf = (seriesId: string) => {
    const series = useStudyStore.getState().events.find((event) => event.id === seriesId && !isOccurrenceRow(event));
    return series ? { series, pinsZone: series.timeZone || series.allDay ? undefined : deviceTimeZone() } : null;
  };

  /**
   * Modifica di un giorno di una mia serie con la portata scelta (vedi `occurrenceEditCalls`). "Tutti"
   * da un giorno cambiato da solo: la serie cambia e quel giorno, se c'è ancora, prende anche lui la
   * modifica (lo si sta guardando).
   */
  const applyOccurrenceEdit = async (
    item: CalendarOccurrence,
    scope: OccurrenceScope,
    changes: Partial<CalendarEvent>,
    shown: Partial<CalendarEvent> = {}
  ) => {
    const target = occurrenceTarget(item);
    const own = ownSeriesOf(target.seriesId);
    if (!own) throw new Error("series missing");
    const { calls } = occurrenceEditCalls({ item, series: own.series, scope, changes, shown });
    for (const call of calls) await editOccurrence(target.seriesId, target.date, call.scope, call.patch);
  };

  /**
   * Scelta della portata per modificare o spostare un giorno di una mia serie: ciò che ogni portata fa
   * ai giorni cambiati o annullati da soli si calcola prima con il motore, così il testo dice il vero.
   */
  const occurrenceScopeOptions = (
    item: CalendarOccurrence,
    action: "edit" | "move",
    changes: Partial<CalendarEvent>,
    shown: Partial<CalendarEvent>,
    flags: { ruleChanged?: boolean; subjectChanged?: boolean } = {}
  ) => {
    const target = occurrenceTarget(item);
    const own = ownSeriesOf(target.seriesId);
    const current = useStudyStore.getState().events;
    const impacts: Partial<Record<"following" | "all", ScopeImpact>> = {};
    let newStart: string | undefined;
    if (own) {
      for (const scope of ["following", "all"] as const) {
        const plan = occurrenceEditCalls({ item, series: own.series, scope, changes, shown });
        impacts[scope] = scopeImpact(current, item, scope, plan.calls, undefined, changes);
        if (scope === "all") newStart = plan.newStart;
      }
    }
    return scopeOptions({
      action,
      date: target.date,
      ...flags,
      pinsZone: own?.pinsZone,
      impacts,
      span: seriesSpan(current, target.seriesId, target.date, civilDateOf(new Date())),
      newStart,
      rowContent: Boolean(own && target.row && rowHasOwnContent(item, own.series))
    });
  };

  const moveEvent = async (item: CalendarOccurrence, nextStart: Date) => {
    const origin = item.sharedFrom;
    if (origin && !origin.canEdit) return;
    if (Number.isNaN(nextStart.getTime())) return;
    const delta = nextStart.getTime() - parseISO(item.start).getTime();
    if (!delta) return;
    if (!origin && item.recurring) {
      // Un giorno di una mia serie: solo questo, questo e i successivi, o tutti.
      const target = occurrenceTarget(item);
      const own = ownSeriesOf(target.seriesId);
      const start = new Date(parseISO(item.start).getTime() + delta);
      const end = new Date(parseISO(item.end).getTime() + delta);
      if (!own || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
      const moved = { start: start.toISOString(), end: end.toISOString() };
      // Il giorno porta con sé ciò che mostra (per "Questo e i successivi" da un giorno cambiato da solo).
      const scope = await askScope(SCOPE_TEXT.titleMove(shortTitle(item.title)), occurrenceScopeOptions(item, "move", moved, item));
      if (!scope) return;
      try {
        await applyOccurrenceEdit(item, scope, moved, item);
        setNotice("");
      } catch {
        setNotice(EVENT_EDITOR_TEXT.moveFailed(shortTitle(item.title)));
      }
      return;
    }
    const series: ShownEvent | undefined = origin
      ? sharedEvents.find((event) => event.id === item.id && event.sharedFrom.ownerId === origin.ownerId)
      : events.find((event) => event.id === item.id);
    if (!series) return;
    // Evento altrui che si ripete: si sposta tutta la serie dello stesso scarto (lo si dice prima).
    if (item.recurring) {
      const scope = await askScope(SCOPE_TEXT.titleMove(shortTitle(series.title)), scopeOptions({ action: "move", date: item.occurrenceDate, sharedOnly: true }));
      if (scope !== "all") return;
    }
    const start = new Date(parseISO(series.start).getTime() + delta);
    const end = new Date(parseISO(series.end).getTime() + delta);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    if (origin) {
      // Solo dallo store dei dati altrui (controlla il permesso e mette in coda la scrittura), sull'ultima
      // versione salvata: cambiano gli orari (e la regola scritta con il giorno della settimana, che segue
      // il giorno nuovo), il resto resta com'è per il proprietario.
      const latest = useSharedStore.getState().items.find((entry) => entry.key === sharedKey(origin.ownerId, "calendarEvent", series.id))?.entity;
      const current = latest ? sharedCalendarEvent(latest) : null;
      if (!latest || !current) return;
      const moved = seriesMovePatch(current, start.toISOString(), end.toISOString());
      try {
        await useSharedStore.getState().saveSharedItem(origin.ownerId, "calendarEvent", { ...latest, ...moved } as SharedEntity);
        setNotice("");
      } catch (cause) {
        setNotice(sharedFailure(cause, EVENT_EDITOR_TEXT.moveFailed(shortTitle(series.title))));
      }
      return;
    }
    await updateEvent(series.id, { start: start.toISOString(), end: end.toISOString() });
    setNotice("");
  };

  const handlers: Handlers = {
    subjects,
    onEditEvent: (id, ownerId, occurrence) => {
      if (ownerId) {
        setEditingSharedKey(sharedKey(ownerId, "calendarEvent", id));
        return;
      }
      // Ricorrenze e vacanze si aprono nel loro modulo semplice, per tutta la serie.
      const stored = events.find((event) => event.id === id);
      const seriesId = stored && isOccurrenceRow(stored) ? (stored.seriesId as string) : id;
      const series = events.find((event) => event.id === seriesId);
      const simple = series ? editorFormFor(series) !== "event" : false;
      // Un giorno di una serie (anche già cambiato da solo, il cui occurrenceDate è il giorno originale)
      // si apre come tale: al salvataggio si sceglie a quali date vale. Un evento singolo no.
      const date = occurrence?.occurrenceDate;
      const recurring = Boolean(series && isCivilDate(date) && (seriesId !== id || normalizeRepeat(series)));
      setFullForm(null);
      setEditingEventId(simple ? seriesId : id);
      setEditingDate(!simple && recurring ? (date as string) : null);
    },
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
              { label: OCCASION_FORM_TEXT.menu, icon: "Cake", onClick: () => setSimpleNew({ form: "occasion" }) },
              { label: VACATION_FORM_TEXT.menu, icon: "Luggage", onClick: () => setSimpleNew({ form: "vacation" }) },
              { label: OFFICIAL_EXAMS_ADD_LABEL, icon: "CalendarPlus", onClick: () => setBarbImportOpen(true) },
              transferMenuItem(() => transfer.current?.open()),
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
              { label: CALENDAR_TEXT.examSummary, icon: "GraduationCap", onClick: () => openSummary("exam") },
              { label: TYPE_COLORS_TEXT.menu, icon: "Palette", onClick: () => setTypeColorsOpen(true) }
            ]}
          />
        }
      />
      <CalendarTransfer ref={transfer} />
      {barbImportOpen ? <BarbExamImport onClose={() => setBarbImportOpen(false)} /> : null}
      {typeColorsOpen ? (
        <TypeColorsDrawer overrides={typeOverrides} onSave={(next) => updatePreferences({ eventTypeColors: next })} onClose={() => setTypeColorsOpen(false)} />
      ) : null}
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

      {editingDate && editingOccurrence ? (
        <EventEditor
          overrides={typeOverrides}
          key={`${editingEventId}@${editingDate}`}
          heading={EVENT_EDITOR_TEXT.editEvent}
          initial={draftFromEvent(editingOccurrence, {
            ...ownColorContext(editingOccurrence.subjectId),
            // Una riga non ha la regola: si mostra quella della sua serie.
            repeat: normalizeRepeat(editingSeries ?? editingOccurrence)
          })}
          event={editingOccurrence}
          occurrenceDate={occurrenceTarget(editingOccurrence).date}
          subjects={subjects}
          repeatNote={REPEAT_PICKER_TEXT.onlyForSeries}
          onClose={closeEventEditor}
          onSubmit={async ({ changes, patch }) => {
            const item = editingOccurrence;
            const target = occurrenceTarget(item);
            const own = ownSeriesOf(target.seriesId);
            if (!own) return EVENT_EDITOR_TEXT.saveFailed;
            const scope = await askScope(
              SCOPE_TEXT.titleEdit(shortTitle(patch.title || item.title)),
              occurrenceScopeOptions(item, "edit", changes, patch, {
                ruleChanged: userRuleChange({ item, series: own.series, changes }),
                subjectChanged: "subjectId" in changes
              })
            );
            // Annullato: il modulo resta aperto con le modifiche.
            if (!scope) return;
            try {
              await applyOccurrenceEdit(item, scope, changes, patch);
              closeEventEditor();
            } catch {
              return EVENT_EDITOR_TEXT.saveFailed;
            }
          }}
          onDelete={async () => {
            const item = editingOccurrence;
            const target = occurrenceTarget(item);
            const span = seriesSpan(useStudyStore.getState().events, target.seriesId, target.date, civilDateOf(new Date()));
            const scope = await askScope(SCOPE_TEXT.titleDelete(shortTitle(item.title)), scopeOptions({ action: "delete", date: target.date, span }), true);
            if (!scope) return;
            try {
              // "Tutti": tutta la serie come la si vede, anche le parti nate da "Questo e i successivi".
              await deleteOccurrence(target.seriesId, target.date, scope, scope === "all" ? { includeSplits: true } : undefined);
              closeEventEditor();
            } catch {
              return EVENT_EDITOR_TEXT.deleteFailed;
            }
          }}
        />
      ) : null}

      {editingEvent && !editingDate && editingForm === "occasion" ? (
        <OccasionForm
          overrides={typeOverrides}
          customColor={customColorOf(editingEvent)}
          key={editingEvent.id}
          initial={occasionDraftFromEvent(editingEvent)}
          editing
          today={todayCivil}
          onClose={closeEventEditor}
          onSave={async (draft) => {
            // Solo ciò che il modulo ha cambiato: la regola, la categoria e il colore restano quelli salvati.
            const changes = occasionChanges(editingEvent, occasionDraftFromEvent(editingEvent), draft, { today: todayCivil, baseYear: startYearOf(editingEvent) });
            if (Object.keys(changes).length) await updateEvent(editingEvent.id, changes);
            closeEventEditor();
          }}
          onDelete={async () => {
            await deleteEvent(editingEvent.id);
            closeEventEditor();
          }}
          onFullForm={(draft) => {
            const changes = occasionChanges(editingEvent, occasionDraftFromEvent(editingEvent), draft, { today: todayCivil, baseYear: startYearOf(editingEvent) });
            setFullForm({ id: editingEvent.id, draft: draftFromFields(changes, editingEvent) });
          }}
        />
      ) : null}

      {editingEvent && !editingDate && editingForm === "vacation" ? (
        <VacationForm
          overrides={typeOverrides}
          customColor={customColorOf(editingEvent)}
          key={editingEvent.id}
          initial={vacationDraftFromEvent(editingEvent)}
          editing
          onClose={closeEventEditor}
          onSave={async (draft) => {
            const changes = vacationChanges(editingEvent, vacationDraftFromEvent(editingEvent), draft);
            if (Object.keys(changes).length) await updateEvent(editingEvent.id, changes);
            closeEventEditor();
          }}
          onDelete={async () => {
            await deleteEvent(editingEvent.id);
            closeEventEditor();
          }}
          onFullForm={(draft) => setFullForm({ id: editingEvent.id, draft: draftFromFields(vacationChanges(editingEvent, vacationDraftFromEvent(editingEvent), draft), editingEvent) })}
        />
      ) : null}

      {simpleNew?.form === "occasion" ? (
        <OccasionForm
          overrides={typeOverrides}
          initial={newOccasionDraft({ today: todayCivil, kind: simpleNew.kind, name: simpleNew.name })}
          editing={false}
          today={todayCivil}
          onClose={() => setSimpleNew(null)}
          onSave={async (draft) => {
            await addEvent(newEventFields(occasionFields(draft, { today: todayCivil, overrides: typeOverrides })));
            setSimpleNew(null);
          }}
          onFullForm={(draft) => {
            const { occasion, ...fields } = occasionFields(draft, { today: todayCivil, overrides: typeOverrides });
            setSimpleNew(null);
            setCreator({ at: new Date(), kind: "event", draft: draftFromFields({ ...fields, occasion }), occasion });
          }}
        />
      ) : null}

      {simpleNew?.form === "vacation" ? (
        <VacationForm
          overrides={typeOverrides}
          initial={newVacationDraft(todayCivil, simpleNew.title)}
          editing={false}
          onClose={() => setSimpleNew(null)}
          onSave={async (draft) => {
            await addEvent(newEventFields(vacationFields(draft, { overrides: typeOverrides })));
            setSimpleNew(null);
          }}
          onFullForm={(draft) => {
            setSimpleNew(null);
            setCreator({ at: new Date(), kind: "event", draft: draftFromFields(vacationFields(draft, { overrides: typeOverrides })) });
          }}
        />
      ) : null}

      {editingEvent && !editingDate && editingForm === "event" ? (
        <EventEditor
          overrides={typeOverrides}
          key={editingEvent.id}
          heading={EVENT_EDITOR_TEXT.editEvent}
          initial={fullForm?.id === editingEvent.id ? fullForm.draft : draftFromEvent(editingEvent, ownColorContext(editingEvent.subjectId))}
          base={draftFromEvent(editingEvent, ownColorContext(editingEvent.subjectId))}
          event={editingEvent}
          subjects={subjects}
          deleteConfirmText={(normalizeRepeat(editingEvent) ? EVENT_EDITOR_TEXT.deleteSeriesConfirm : EVENT_EDITOR_TEXT.deleteConfirm)(shortTitle(editingEvent.title))}
          onClose={closeEventEditor}
          onSubmit={async ({ changes }) => {
            await updateEvent(editingEvent.id, changes);
            closeEventEditor();
          }}
          onDelete={async () => {
            await deleteEvent(editingEvent.id);
            closeEventEditor();
          }}
        />
      ) : null}

      {editingShared ? (
        <EventEditor
          overrides={typeOverrides}
          key={editingSharedKey ?? editingShared.id}
          heading={(editingShared.sharedFrom.canEdit ? EVENT_EDITOR_TEXT.editShared : EVENT_EDITOR_TEXT.viewShared)(firstName(editingShared.sharedFrom.ownerName))}
          initial={draftFromEvent(editingShared, { subjectColor: editingShared.sharedFrom.subjectColor, overrides: typeOverrides })}
          event={editingShared}
          subjects={subjects}
          sharedFrom={editingShared.sharedFrom}
          deleteConfirmText={EVENT_EDITOR_TEXT.deleteShared(shortTitle(editingShared.title), editingShared.sharedFrom.ownerName)}
          onClose={closeSharedEditor}
          onDirtyChange={(dirty) => {
            sharedDraftDirty.current = dirty;
          }}
          onSubmit={async ({ changes }) => {
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
            if (!latest) return EVENT_EDITOR_TEXT.sharedGone;
            // Ripetizione cambiata: regola pulita più i campi vecchi, così la vedono anche le app vecchie.
            const merged = { ...latest, ...update } as unknown as CalendarEvent;
            const next = "repeat" in update ? applyRepeatFields(merged, { repeatChanged: changesRepeat(latest as unknown as CalendarEvent, update) }) : merged;
            try {
              // Solo dallo store dei dati altrui: mai nel mio calendario.
              await useSharedStore.getState().saveSharedItem(ownerId, "calendarEvent", { ...next } as unknown as SharedEntity);
              closeSharedEditor();
            } catch (cause) {
              return sharedFailure(cause, EVENT_EDITOR_TEXT.saveFailed);
            }
          }}
          onDelete={async () => {
            try {
              await useSharedStore.getState().deleteSharedItem(editingShared.sharedFrom.ownerId, "calendarEvent", editingShared.id);
              closeSharedEditor();
            } catch (cause) {
              return sharedFailure(cause, EVENT_EDITOR_TEXT.deleteFailed);
            }
          }}
        />
      ) : null}

      {creator ? (
        <EventEditor
          overrides={typeOverrides}
          heading={EVENT_EDITOR_TEXT.newEvent}
          occasionKind={creator.occasion?.kind}
          initial={creator.draft ?? newEventDraft({ start: defaultStartFor(creator.at), subjectId: creator.subjectId ?? "", ...ownColorContext(creator.subjectId) })}
          typeExtra={(draft) => (
            <div className="min-w-0">
              <span className="mb-1.5 block text-xs font-black uppercase text-[var(--faint)]">{EVENT_EDITOR_TEXT.typeOccasions}</span>
              <div className="flex flex-wrap gap-1.5">
                {OCCASION_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => {
                      // Percorso semplice della ricorrenza, con il titolo già scritto.
                      setCreator(null);
                      setSimpleNew({ form: "occasion", kind, name: draft.title.trim() });
                    }}
                    className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border)] px-3 text-sm font-extrabold text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    <Icon name={occasionIcon(kind)} className="h-4 w-4 shrink-0" />
                    {OCCASION_KIND_LABEL[kind]}
                  </button>
                ))}
              </div>
            </div>
          )}
          subjects={subjects}
          calendars={writableCalendars}
          createKind={creator.kind}
          onClose={() => setCreator(null)}
          onSubmit={async ({ kind, ownerId, draft, patch }) => {
            if (kind === "task") {
              await addTask({
                title: patch.title ?? "",
                dueDate: new Date(draft.start).toISOString(),
                subjectId: patch.subjectId,
                priority: draft.priority,
                importance: draft.priority === "urgent" ? 5 : draft.priority === "high" ? 4 : 3
              });
              setCreator(null);
              return;
            }
            const fields = newEventFields(patch);
            if (ownerId) {
              // Nel calendario di un'altra persona: solo dallo store dei dati altrui, mai nel mio calendario.
              const now = new Date().toISOString();
              const created = applyRepeatFields(
                {
                  ...fields,
                  id: createId("event"),
                  createdAt: now,
                  updatedAt: now,
                  archived: false,
                  tags: [],
                  description: fields.description ?? "",
                  category: fields.category ?? "study",
                  color: fields.color ?? "#7CF7C8",
                  priority: fields.priority ?? "medium",
                  recurrence: "none",
                  status: fields.status ?? "planned",
                  checklist: [],
                  attachmentIds: [],
                  notes: "",
                  // Il server non accetta collegamenti in un evento nuovo altrui (il modulo lo dice).
                  links: []
                },
                { repeatChanged: fields.repeat !== undefined }
              );
              try {
                await useSharedStore.getState().saveSharedItem(ownerId, "calendarEvent", { ...created } as unknown as SharedEntity);
                setCreator(null);
              } catch (cause) {
                return sharedFailure(cause, EVENT_EDITOR_TEXT.addFailed);
              }
              return;
            }
            await addEvent(creator.occasion ? { ...fields, occasion: creator.occasion } : fields);
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

      {scopeRequest ? (
        <ScopeChoice heading={scopeRequest.heading} options={scopeRequest.options} danger={scopeRequest.danger} onChoose={answerScope} onCancel={() => answerScope(null)} />
      ) : null}

      {preview ? <CalendarHoverPreview preview={preview} subjects={subjects} /> : null}
    </div>
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
