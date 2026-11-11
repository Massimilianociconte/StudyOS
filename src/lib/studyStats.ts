import { addDays, addMonths, addWeeks, isValid, parseISO, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import type { StudySession, Subject } from "../types";
import { NO_SUBJECT_LABEL } from "./labels";
import { NO_SUBJECT_COLOR } from "./selectors";

/**
 * Statistiche dello studio per periodo (funzioni pure, testate in tests/studyStats.test.mjs).
 * Contano solo le sessioni completate, ciascuna nel giorno in cui è iniziata.
 */

export const STATS_PERIODS = ["week", "month", "semester"] as const;
export type StatsPeriod = (typeof STATS_PERIODS)[number];
export type TrendUnit = "day" | "week";
export type StatsSemesterId = "primo" | "secondo";

/** Inizio ufficiale di un semestre (da BARB_DATASET.semesters); null se non pubblicato. */
export interface OfficialSemester {
  id: string;
  startDate: string | null;
}

export interface PeriodRange {
  period: StatsPeriod;
  /** Inizio incluso, mezzanotte locale. */
  start: Date;
  /** Fine esclusa, mezzanotte locale. */
  end: Date;
  semesterId?: StatsSemesterId;
  /** Es. "2026/2027". */
  academicYear?: string;
}

export interface SubjectMinutes {
  /** null = "Senza materia" (nessuna materia o materia eliminata). */
  id: string | null;
  name: string;
  color: string;
  minutes: number;
}

export interface TrendBucket {
  start: Date;
  end: Date;
  minutes: number;
}

export const SESSION_SOURCES = ["pomodoro", "stopwatch", "manual", "unknown"] as const;
export type SessionSourceKey = (typeof SESSION_SOURCES)[number];

export interface SessionSummary {
  count: number;
  totalMinutes: number;
  /** Minuti per sessione, arrotondati. 0 senza sessioni. */
  averageMinutes: number;
  bySource: Record<SessionSourceKey, { count: number; minutes: number }>;
}

const WEEK = { weekStartsOn: 1 } as const;
/** Senza date ufficiali: 1 ottobre e 1 marzo (mesi da 0). */
const DEFAULT_SEMESTER_START: Record<StatsSemesterId, { month: number; day: number }> = {
  primo: { month: 9, day: 1 },
  secondo: { month: 2, day: 1 }
};

export const trendUnit = (period: StatsPeriod): TrendUnit => (period === "semester" ? "week" : "day");

const sessionMinutes = (session: StudySession) => Math.max(0, Number(session.actualMinutes) || 0);
const completed = (sessions: StudySession[]) => sessions.filter((session) => session.status === "completed");

const officialStart = (semesters: readonly OfficialSemester[] | undefined, id: StatsSemesterId): Date | null => {
  const raw = semesters?.find((semester) => semester.id === id)?.startDate;
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const date = parseISO(raw);
  return isValid(date) ? startOfDay(date) : null;
};

/** Le date ufficiali valgono per il loro anno; gli altri anni usano le date abituali. */
const semesterStart = (id: StatsSemesterId, year: number, semesters?: readonly OfficialSemester[]) => {
  const official = officialStart(semesters, id);
  if (official && official.getFullYear() === year) return official;
  const fallback = DEFAULT_SEMESTER_START[id];
  return new Date(year, fallback.month, fallback.day);
};

/**
 * Semestre che contiene `date`. I semestri sono contigui: il primo va fino all'inizio del secondo,
 * il secondo (con la sessione estiva) fino all'inizio del primo dell'anno dopo.
 */
export function semesterRange(date: Date, semesters?: readonly OfficialSemester[]): PeriodRange {
  const year = date.getFullYear();
  const starts: Array<{ id: StatsSemesterId; start: Date; academicStart: number }> = [];
  for (let current = year - 2; current <= year + 2; current += 1) {
    starts.push({ id: "primo", start: semesterStart("primo", current, semesters), academicStart: current });
    starts.push({ id: "secondo", start: semesterStart("secondo", current, semesters), academicStart: current - 1 });
  }
  starts.sort((a, b) => a.start.getTime() - b.start.getTime());
  let index = 0;
  for (let i = 0; i < starts.length; i += 1) if (starts[i].start.getTime() <= date.getTime()) index = i;
  const found = starts[index];
  const next = starts[Math.min(index + 1, starts.length - 1)];
  return {
    period: "semester",
    start: found.start,
    end: next.start,
    semesterId: found.id,
    academicYear: `${found.academicStart}/${found.academicStart + 1}`
  };
}

/** Periodo che contiene `now`, spostato di `offset` periodi (negativo = indietro). */
export function periodRange(period: StatsPeriod, now: Date, options: { offset?: number; semesters?: readonly OfficialSemester[] } = {}): PeriodRange {
  const offset = Math.trunc(options.offset ?? 0);
  if (period === "week") {
    const start = addWeeks(startOfWeek(now, WEEK), offset);
    return { period, start, end: addWeeks(start, 1) };
  }
  if (period === "month") {
    const start = addMonths(startOfMonth(now), offset);
    return { period, start, end: addMonths(start, 1) };
  }
  let range = semesterRange(now, options.semesters);
  for (let step = 0; step < Math.abs(offset); step += 1) {
    range = offset < 0 ? semesterRange(new Date(range.start.getTime() - 1), options.semesters) : semesterRange(range.end, options.semesters);
  }
  return range;
}

const startTime = (session: StudySession) => {
  const date = parseISO(session.start);
  return isValid(date) ? date.getTime() : Number.NaN;
};

/** Sessioni completate iniziate nel periodo. */
export function sessionsInRange(sessions: StudySession[], range: Pick<PeriodRange, "start" | "end">): StudySession[] {
  const from = range.start.getTime();
  const to = range.end.getTime();
  return completed(sessions).filter((session) => {
    const time = startTime(session);
    return time >= from && time < to;
  });
}

/**
 * Minuti per materia, dalla più studiata. Le sessioni senza materia o con una materia eliminata
 * finiscono in "Senza materia" (ultima riga): la somma è sempre il totale del periodo.
 */
export function minutesBySubject(subjects: Subject[], sessions: StudySession[]): SubjectMinutes[] {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  const totals = new Map<string, number>();
  let none = 0;
  for (const session of completed(sessions)) {
    const minutes = sessionMinutes(session);
    if (session.subjectId && byId.has(session.subjectId)) totals.set(session.subjectId, (totals.get(session.subjectId) ?? 0) + minutes);
    else none += minutes;
  }
  const rows: SubjectMinutes[] = [...totals.entries()]
    .filter(([, minutes]) => minutes > 0)
    .map(([id, minutes]) => {
      const subject = byId.get(id) as Subject;
      return { id, name: subject.name, color: subject.color, minutes };
    })
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name, "it"));
  return none > 0 ? [...rows, { id: null, name: NO_SUBJECT_LABEL, color: NO_SUBJECT_COLOR, minutes: none }] : rows;
}

/** Andamento nel periodo: un punto al giorno (settimana, mese) o a settimana (semestre, da lunedì). */
export function trendBuckets(sessions: StudySession[], range: PeriodRange, unit: TrendUnit = trendUnit(range.period)): TrendBucket[] {
  const buckets: TrendBucket[] = [];
  let cursor = range.start;
  while (cursor.getTime() < range.end.getTime()) {
    const next = unit === "day" ? addDays(startOfDay(cursor), 1) : addWeeks(startOfWeek(cursor, WEEK), 1);
    const end = next.getTime() < range.end.getTime() ? next : range.end;
    buckets.push({ start: cursor, end, minutes: 0 });
    cursor = end;
  }
  for (const session of sessionsInRange(sessions, range)) {
    const time = startTime(session);
    const bucket = buckets.find((item) => time >= item.start.getTime() && time < item.end.getTime());
    if (bucket) bucket.minutes += sessionMinutes(session);
  }
  return buckets;
}

/** Quante sessioni, quanto durano in media e da dove arrivano (Pomodoro, cronometro, a mano). */
export function sessionSummary(sessions: StudySession[]): SessionSummary {
  const bySource = Object.fromEntries(SESSION_SOURCES.map((key) => [key, { count: 0, minutes: 0 }])) as SessionSummary["bySource"];
  let totalMinutes = 0;
  let count = 0;
  for (const session of completed(sessions)) {
    const minutes = sessionMinutes(session);
    const key: SessionSourceKey = session.source === "pomodoro" || session.source === "stopwatch" || session.source === "manual" ? session.source : "unknown";
    bySource[key].count += 1;
    bySource[key].minutes += minutes;
    totalMinutes += minutes;
    count += 1;
  }
  return { count, totalMinutes, averageMinutes: count ? Math.round(totalMinutes / count) : 0, bySource };
}
