// Stato della vista Calendario senza DOM: filtro per materia, riepilogo "Per materia", periodo vuoto
// e viste (da 7 a 4, con i valori salvati di prima ancora validi).
//
// Il filtro lavora su qualunque elenco di voci mostrate (occorrenze, attività, esami, sessioni…)
// che abbia `subjectId`: un nuovo modello di occorrenze si aggancia passando i suoi elenchi.
import type { CalendarEvent, Exam, Subject, Task } from "../types";
import { expandEvents, isOccurrenceRow, normalizeRepeat } from "./repeat";

/* ------------------------------------------------------------------ */
/* Filtro per materia                                                   */
/* ------------------------------------------------------------------ */

/** Voce del calendario legata (forse) a una materia. `sharedFrom`: viene da un'altra persona. */
export interface SubjectLinked {
  subjectId?: string | null;
  sharedFrom?: unknown;
}

type SubjectState = Pick<Subject, "id" | "archived" | "status">;

export const isArchivedSubject = (subject: Pick<Subject, "archived" | "status">) => subject.archived || subject.status === "archived";

/**
 * La voce va mostrata con il filtro `subjectId` (null = tutte le materie)? Le voci di un'altra
 * persona usano le sue materie, mai le mie: con un filtro attivo non passano.
 */
export const itemMatchesSubject = (item: SubjectLinked, subjectId: string | null) => {
  if (!subjectId) return true;
  if (item.sharedFrom) return false;
  return item.subjectId === subjectId;
};

/** Elenco filtrato; senza filtro è lo stesso elenco (stesso riferimento: niente render inutili). */
export const filterBySubject = <T extends SubjectLinked>(items: readonly T[], subjectId: string | null): T[] =>
  subjectId ? items.filter((item) => itemMatchesSubject(item, subjectId)) : (items as T[]);

/** Filtra insieme tutti gli elenchi che una vista mostra (stesse chiavi in uscita). */
export const filterCalendarItems = <T extends Record<string, readonly SubjectLinked[]>>(groups: T, subjectId: string | null): T => {
  if (!subjectId) return groups;
  const result: Record<string, SubjectLinked[]> = {};
  for (const [key, items] of Object.entries(groups)) result[key] = filterBySubject(items, subjectId);
  return result as unknown as T;
};

/**
 * Filtro salvato ("calendar.subject") ancora valido: una materia che esiste e non è archiviata.
 * Altrimenti nessun filtro (null).
 */
export const resolveSubjectFilter = (stored: unknown, subjects: readonly SubjectState[]): string | null => {
  if (typeof stored !== "string" || !stored) return null;
  const subject = subjects.find((entry) => entry.id === stored);
  return subject && !isArchivedSubject(subject) ? subject.id : null;
};

/* ------------------------------------------------------------------ */
/* Riepilogo "Per materia"                                              */
/* ------------------------------------------------------------------ */

export interface SubjectCalendarRow<S> {
  subject: S;
  /** Eventi propri non archiviati: una serie che si ripete conta 1, anche se divisa in parti. */
  events: number;
  /** Di questi, quanti si ripetono ogni settimana (in uno o più giorni). */
  weekly: number;
  exams: number;
  /** Attività con una scadenza (anche già fatte: il calendario le mostra barrate). */
  deadlines: number;
  /** Totale delle voci della materia nel calendario. */
  items: number;
  /** Materia superata: resta nel piano di studio, in fondo all'elenco. */
  completed: boolean;
}

export interface SubjectCalendarSummary<S> {
  /** Materie del piano di studio (non archiviate). */
  planned: number;
  /** Materie del piano con almeno una voce nel calendario. */
  withItems: number;
  rows: SubjectCalendarRow<S>[];
}

type SummaryEvent = Pick<CalendarEvent, "id" | "subjectId" | "archived" | "start" | "recurrence"> &
  Partial<Pick<CalendarEvent, "splitFrom" | "seriesId" | "repeat" | "repeatLegacy" | "recurrenceUntil">>;

/**
 * Radice di ogni serie divisa con "questa e le successive" (`splitFrom` fino alla prima serie, anche
 * archiviata): le parti di una serie sono un impegno solo. Protetta dai cicli (dati di altri dispositivi).
 */
const seriesRoots = (events: readonly SummaryEvent[]) => {
  const byId = new Map(events.map((event) => [event.id, event]));
  const roots = new Map<string, string>();
  return (id: string): string => {
    const known = roots.get(id);
    if (known !== undefined) return known;
    const seen = new Set<string>();
    let current = id;
    while (!seen.has(current)) {
      seen.add(current);
      const parent = byId.get(current)?.splitFrom;
      if (typeof parent !== "string" || !parent || !byId.has(parent)) break;
      current = parent;
    }
    for (const visited of seen) roots.set(visited, current);
    return current;
  };
};

/**
 * "Ogni settimana", in qualunque giorno: la regola `repeat` se vale (anche lun e mer, o i feriali),
 * altrimenti i campi vecchi. Ogni 2 settimane no; "ogni 7 giorni" sì.
 */
const repeatsWeekly = (event: SummaryEvent) => {
  const rule = normalizeRepeat(event);
  if (!rule) return false;
  const interval = rule.interval ?? 1;
  return (rule.freq === "weekly" && interval === 1) || (rule.freq === "daily" && interval === 7);
};

const startTime = (event: SummaryEvent) => {
  const time = Date.parse(event.start);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
};

export const subjectCalendarSummary = <S extends SubjectState>({
  subjects,
  events,
  exams,
  tasks
}: {
  subjects: readonly S[];
  events: readonly SummaryEvent[];
  exams: readonly Pick<Exam, "subjectId" | "archived">[];
  tasks: readonly Pick<Task, "subjectId" | "archived" | "status" | "dueDate">[];
}): SubjectCalendarSummary<S> => {
  const plan = subjects.filter((subject) => !isArchivedSubject(subject));
  const ordered = [...plan.filter((subject) => subject.status !== "completed"), ...plan.filter((subject) => subject.status === "completed")];
  const series = events.filter((event) => !isOccurrenceRow(event));
  const rootOf = seriesRoots(series);
  const rows = ordered.map((subject) => {
    // Una serie (con le sue parti divise) conta una volta; per "ogni settimana" vale la parte più recente.
    const families = new Map<string, SummaryEvent>();
    for (const event of series) {
      if (event.archived || event.subjectId !== subject.id) continue;
      const root = rootOf(event.id);
      const latest = families.get(root);
      if (!latest || startTime(event) > startTime(latest)) families.set(root, event);
    }
    const own = [...families.values()];
    const examCount = exams.filter((exam) => !exam.archived && exam.subjectId === subject.id).length;
    const deadlines = tasks.filter((task) => !task.archived && task.status !== "archived" && Boolean(task.dueDate) && task.subjectId === subject.id).length;
    return {
      subject,
      events: own.length,
      weekly: own.filter(repeatsWeekly).length,
      exams: examCount,
      deadlines,
      items: own.length + examCount + deadlines,
      completed: subject.status === "completed"
    };
  });
  return { planned: rows.length, withItems: rows.filter((row) => row.items > 0).length, rows };
};

const YEAR_WINDOW_DAYS = 366;
const localDayOf = (ms: number) => {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
};
const shiftDays = (day: Date, days: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate() + days);

/**
 * Giorno su cui aprire il calendario per una materia scelta nel riepilogo: quello della sua prossima
 * voce (evento o sua prossima volta, esame, scadenza) da oggi in poi; una voce già in corso porta a
 * oggi. Senza voci future, l'ultima passata; senza voci, null. Contano le stesse voci del riepilogo
 * (niente archiviate né giorni annullati); gli eventi si cercano un anno alla volta, fino a `years`.
 */
export const subjectJumpDay = ({
  subjectId,
  events,
  exams,
  tasks,
  now = new Date(),
  years = 5
}: {
  subjectId: string;
  events: readonly CalendarEvent[];
  exams: readonly Pick<Exam, "subjectId" | "archived" | "date">[];
  tasks: readonly Pick<Task, "subjectId" | "archived" | "status" | "dueDate">[];
  now?: Date;
  years?: number;
}): Date | null => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayMs = today.getTime();
  const dated = [
    ...exams.filter((exam) => !exam.archived && exam.subjectId === subjectId).map((exam) => exam.date),
    ...tasks.filter((task) => !task.archived && task.status !== "archived" && task.subjectId === subjectId).map((task) => task.dueDate)
  ]
    .map((iso) => (typeof iso === "string" ? Date.parse(iso) : Number.NaN))
    .filter((ms) => !Number.isNaN(ms));
  // Le righe dei giorni cambiati da soli servono all'espansione (sostituiscono o annullano il loro giorno).
  const own = events.filter((event) => isOccurrenceRow(event) || event.subjectId === subjectId);
  const shown = (from: Date, to: Date) => expandEvents(own, from, to).filter((item) => item.subjectId === subjectId);

  let next = Math.min(Infinity, ...dated.filter((ms) => ms >= todayMs));
  for (let year = 0; year < years; year += 1) {
    const from = shiftDays(today, year * YEAR_WINDOW_DAYS);
    if (from.getTime() >= next) break;
    const first = shown(from, shiftDays(today, (year + 1) * YEAR_WINDOW_DAYS))[0];
    if (!first) continue;
    next = Math.min(next, Math.max(Date.parse(first.start), from.getTime()));
    break;
  }
  if (Number.isFinite(next)) return localDayOf(next);

  let last = Math.max(-Infinity, ...dated.filter((ms) => ms < todayMs));
  for (let year = 0; year < years; year += 1) {
    const to = shiftDays(today, -year * YEAR_WINDOW_DAYS);
    if (to.getTime() <= last) break;
    const found = shown(shiftDays(today, -(year + 1) * YEAR_WINDOW_DAYS), to);
    if (!found.length) continue;
    last = Math.max(last, Date.parse(found[found.length - 1].start));
    break;
  }
  return Number.isFinite(last) ? localDayOf(last) : null;
};

/* ------------------------------------------------------------------ */
/* Periodo mostrato                                                     */
/* ------------------------------------------------------------------ */

const inRange = (iso: string | undefined, fromMs: number, toMs: number) => {
  if (!iso) return false;
  const time = Date.parse(iso);
  return !Number.isNaN(time) && time >= fromMs && time < toMs;
};

/** C'è almeno una voce (evento, scadenza, esame) nel periodo [from, to)? */
export const hasItemsInRange = (
  {
    occurrences = [],
    tasks = [],
    exams = []
  }: {
    occurrences?: readonly Pick<CalendarEvent, "start" | "end">[];
    tasks?: readonly Pick<Task, "dueDate">[];
    exams?: readonly Pick<Exam, "date">[];
  },
  from: Date,
  to: Date
) => {
  const fromMs = from.getTime();
  const toMs = to.getTime();
  return (
    occurrences.some((item) => Date.parse(item.start) < toMs && Date.parse(item.end) > fromMs) ||
    tasks.some((task) => inRange(task.dueDate, fromMs, toMs)) ||
    exams.some((exam) => inRange(exam.date, fromMs, toMs))
  );
};

/** Giorno proposto per un nuovo evento: oggi se è nel periodo mostrato, altrimenti il primo giorno. */
export const dayForNewEvent = (from: Date, to: Date, now: Date = new Date()) => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return today.getTime() >= from.getTime() && today.getTime() < to.getTime() ? today : from;
};

/* ------------------------------------------------------------------ */
/* Viste                                                                */
/* ------------------------------------------------------------------ */

/** Viste nel selettore, nell'ordine in cui compaiono. */
export const CALENDAR_VIEWS = ["day", "week", "month", "agenda"] as const;
export type CalendarViewId = (typeof CALENDAR_VIEWS)[number];

/** Riepiloghi (non calendari), raggiunti dal menu "Altre azioni". */
export type CalendarSummaryId = "exam" | "semester";
export type CalendarMode = CalendarViewId | CalendarSummaryId;

/** Valori validi in "calendar.mode", compresi quelli di prima ("focus" = Giornata di studio). */
export const STORED_CALENDAR_MODES = [...CALENDAR_VIEWS, "exam", "semester", "focus"] as const;

export const isCalendarSummary = (mode: string): mode is CalendarSummaryId => mode === "exam" || mode === "semester";

/**
 * Vista da mostrare per i valori salvati. "focus" (la vecchia "Giornata di studio") diventa Giorno
 * con l'opzione "Solo 8–19, ore grandi"; "exam" e "semester" restano riepiloghi; il resto torna a
 * Settimana.
 */
export const resolveCalendarMode = (stored: unknown, dayFocus: unknown): { mode: CalendarMode; dayFocus: boolean } => {
  const focus = dayFocus === true;
  if (stored === "focus") return { mode: "day", dayFocus: true };
  if (typeof stored === "string" && ((CALENDAR_VIEWS as readonly string[]).includes(stored) || isCalendarSummary(stored))) {
    return { mode: stored as CalendarMode, dayFocus: focus };
  }
  return { mode: "week", dayFocus: false };
};
