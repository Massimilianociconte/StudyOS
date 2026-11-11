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
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { sharedOfTypes, useSharedStore } from "../store/useSharedStore";
import { originOf, ownerColor, safeCssColor, sharedKey, ShareUserError, type SharedEntity, type SharedOrigin } from "../lib/sharing";
import { SharedMark } from "../components/SharedMark";
import { createId } from "../lib/id";
import type { CalendarEvent, EventOccasion, Exam, OccasionKind, Task } from "../types";
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
import { CalendarTransfer, type CalendarTransferHandle } from "../components/CalendarTransfer";
import { TaskEditorModal } from "../components/TaskEditorModal";
import { EventEditor } from "../components/calendar/EventEditor";
import { ScopeChoice } from "../components/calendar/ScopeChoice";
import { OccasionForm, occasionIcon } from "../components/calendar/OccasionForm";
import { VacationForm } from "../components/calendar/VacationForm";
import { TypeColorsDrawer } from "../components/calendar/TypeColorsDrawer";
import { sanitizeTypeColorOverrides } from "../lib/eventColors";
import { allScopePatch, draftFromEvent, editorFormFor, followingPatch, newEventDraft, scopeOptions, wallTimeChanged, type EventDraft, type ScopeOption } from "../lib/eventEditor";
import {
  newOccasionDraft,
  newVacationDraft,
  OCCASION_KINDS,
  occasionDraftFromEvent,
  occasionFields,
  vacationDraftFromEvent,
  vacationFields
} from "../lib/occasionForms";
import { findOccurrence, occurrenceTarget } from "../lib/occurrenceLookup";
import { applyRepeatFields, changesRepeat, isOccurrenceRow, normalizeRepeat, type OccurrenceScope } from "../lib/repeat";
import { civilDateOf, deviceTimeZone, isCivilDate, parseCivil } from "../lib/tz";
import { daysUntil, eventMinutes, isAllDayEvent, selectableSubjects, shortDate, studyDaysLabel, subjectColor, subjectName, timeLabel } from "../lib/selectors";
import { formatElapsedSeconds, isTaskCompletedLate, isTaskTimerRunning, taskElapsedSeconds } from "../lib/taskTimer";
import { expandEvents, RECURRENCE_LABEL, type EventOccurrence } from "../lib/recurrence";
import {
  ALL_DAY_LABEL,
  CALENDAR_HELP,
  CALENDAR_TEXT,
  ENERGY_LABEL,
  EVENT_CATEGORY_LABEL,
  EVENT_EDITOR_TEXT,
  EVENT_STATUS_LABEL,
  EXAM_STATUS_LABEL,
  NO_SUBJECT_LABEL,
  OCCASION_FORM_TEXT,
  OCCASION_KIND_LABEL,
  OFFICIAL_EXAMS_ADD_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  REPEAT_PICKER_TEXT,
  SCOPE_TEXT,
  SHARE_TEXT,
  TASK_STATUS_LABEL,
  TYPE_COLORS_TEXT,
  VACATION_FORM_TEXT,
  capitalizeFirst,
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
  /** `occurrence`: il giorno toccato, per una serie che si ripete. */
  onEditEvent: (id: string, ownerId?: string, occurrence?: CalendarOccurrence) => void;
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
  const todayYmd = civilDateOf(new Date());
  const editingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) ?? null : null;
  /** Colore della materia per il modulo (le tipologie con materia ne prendono il colore). */
  const ownColorContext = (subjectId?: string) => ({ subjectColor: subjects.find((subject) => subject.id === subjectId)?.color, overrides: typeOverrides });
  /** Bozza del modulo completo da campi già pronti (dal modulo semplice), sopra l'evento salvato se c'è. */
  const draftFromFields = (fields: Partial<CalendarEvent>, saved?: CalendarEvent) =>
    draftFromEvent({ links: [], priority: "medium", status: "planned", description: "", ...saved, ...fields } as CalendarEvent, ownColorContext(saved?.subjectId));
  const startYearOf = (event: CalendarEvent) => parseCivil(civilDateOf(new Date(event.start)))?.year;

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
   * Modifica di un giorno di una mia serie con la portata scelta. "Tutti" da un giorno cambiato da
   * solo: la serie cambia e quel giorno prende anche lui la modifica (lo si sta guardando).
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
    if (scope === "all") {
      await editOccurrence(target.seriesId, target.date, "all", allScopePatch(changes, { occurrence: item, series: own.series, date: target.date }));
      if (target.row) await editOccurrence(target.seriesId, target.date, "this", changes);
      return;
    }
    await editOccurrence(target.seriesId, target.date, scope, scope === "following" ? followingPatch(shown, changes, target.row) : changes);
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
      const scope = await askScope(
        SCOPE_TEXT.titleMove(shortTitle(item.title)),
        scopeOptions({ action: "move", date: target.date, timeChanged: wallTimeChanged(item, moved), pinsZone: own.pinsZone })
      );
      if (!scope) return;
      try {
        await applyOccurrenceEdit(item, scope, moved);
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
      // versione salvata: cambiano solo gli orari, il resto resta com'è per il proprietario.
      const latest = useSharedStore.getState().items.find((entry) => entry.key === sharedKey(origin.ownerId, "calendarEvent", series.id))?.entity;
      if (!latest) return;
      try {
        await useSharedStore.getState().saveSharedItem(origin.ownerId, "calendarEvent", { ...latest, start: start.toISOString(), end: end.toISOString() });
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
      const seriesId = occurrence?.recurring ? occurrenceTarget(occurrence).seriesId : id;
      const series = events.find((event) => event.id === seriesId);
      const simple = series ? editorFormFor(series) !== "event" : false;
      setFullForm(null);
      setEditingEventId(simple ? seriesId : id);
      // Un giorno di una serie si apre come tale: al salvataggio si sceglie a quali date vale.
      setEditingDate(!simple && occurrence?.recurring ? occurrence.occurrenceDate : null);
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
              { label: CALENDAR_TEXT.examSummary, icon: "GraduationCap", onClick: () => openSummary("exam") },
              { label: TYPE_COLORS_TEXT.menu, icon: "Palette", onClick: () => setTypeColorsOpen(true) }
            ]}
          />
        }
      />
      <CalendarTransfer ref={transfer} buttons={false} />
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
              scopeOptions({
                action: "edit",
                date: target.date,
                ruleChanged: "repeat" in changes,
                timeChanged: wallTimeChanged(item, changes),
                subjectChanged: "subjectId" in changes,
                pinsZone: own.pinsZone
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
            const scope = await askScope(SCOPE_TEXT.titleDelete(shortTitle(item.title)), scopeOptions({ action: "delete", date: target.date }), true);
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
          key={editingEvent.id}
          initial={occasionDraftFromEvent(editingEvent)}
          editing
          today={todayYmd}
          onClose={closeEventEditor}
          onSave={async (draft) => {
            // La regola resta quella salvata (ogni anno, o quella scelta nel modulo completo).
            const { repeat: _repeat, ...fields } = occasionFields(draft, { today: todayYmd, baseYear: startYearOf(editingEvent), keepColor: true });
            await updateEvent(editingEvent.id, fields);
            closeEventEditor();
          }}
          onDelete={async () => {
            await deleteEvent(editingEvent.id);
            closeEventEditor();
          }}
          onFullForm={(draft) => {
            const { repeat: _repeat, ...fields } = occasionFields(draft, { today: todayYmd, baseYear: startYearOf(editingEvent), keepColor: true });
            setFullForm({ id: editingEvent.id, draft: draftFromFields(fields, editingEvent) });
          }}
        />
      ) : null}

      {editingEvent && !editingDate && editingForm === "vacation" ? (
        <VacationForm
          overrides={typeOverrides}
          key={editingEvent.id}
          initial={vacationDraftFromEvent(editingEvent)}
          editing
          onClose={closeEventEditor}
          onSave={async (draft) => {
            await updateEvent(editingEvent.id, vacationFields(draft, { keepColor: true }));
            closeEventEditor();
          }}
          onDelete={async () => {
            await deleteEvent(editingEvent.id);
            closeEventEditor();
          }}
          onFullForm={(draft) => setFullForm({ id: editingEvent.id, draft: draftFromFields(vacationFields(draft, { keepColor: true }), editingEvent) })}
        />
      ) : null}

      {simpleNew?.form === "occasion" ? (
        <OccasionForm
          overrides={typeOverrides}
          initial={newOccasionDraft({ today: todayYmd, kind: simpleNew.kind, name: simpleNew.name })}
          editing={false}
          today={todayYmd}
          onClose={() => setSimpleNew(null)}
          onSave={async (draft) => {
            await addEvent(newEventFields(occasionFields(draft, { today: todayYmd, overrides: typeOverrides })));
            setSimpleNew(null);
          }}
          onFullForm={(draft) => {
            const { occasion, ...fields } = occasionFields(draft, { today: todayYmd, overrides: typeOverrides });
            setSimpleNew(null);
            setCreator({ at: new Date(), kind: "event", draft: draftFromFields({ ...fields, occasion }), occasion });
          }}
        />
      ) : null}

      {simpleNew?.form === "vacation" ? (
        <VacationForm
          overrides={typeOverrides}
          initial={newVacationDraft(todayYmd, simpleNew.title)}
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
                      handlers.onEditEvent(placed.item.id, placed.item.sharedFrom?.ownerId, placed.item);
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
        handlers.onEditEvent(item.id, item.sharedFrom?.ownerId, item);
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
      onClick={() => handlers.onEditEvent(item.id, item.sharedFrom?.ownerId, item)}
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
                      handlers.onEditEvent(item.id, item.sharedFrom?.ownerId, item);
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
