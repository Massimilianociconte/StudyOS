import { addDays, addMonths, addWeeks, isValid, parseISO, startOfDay, startOfMonth, startOfWeek } from "date-fns";
import type { StudySession, Subject } from "../types";
import { NO_SUBJECT_LABEL, NO_TOPIC_LABEL } from "./labels";
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

export const SESSION_SOURCES = ["pomodoro", "timer", "stopwatch", "manual", "unknown"] as const;
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

/** Quante sessioni, quanto durano in media e da dove arrivano (Pomodoro, timer, cronometro, a mano). */
export function sessionSummary(sessions: StudySession[]): SessionSummary {
  const bySource = Object.fromEntries(SESSION_SOURCES.map((key) => [key, { count: 0, minutes: 0 }])) as SessionSummary["bySource"];
  let totalMinutes = 0;
  let count = 0;
  for (const session of completed(sessions)) {
    const minutes = sessionMinutes(session);
    const key: SessionSourceKey = session.source && (SESSION_SOURCES as readonly string[]).includes(session.source) ? session.source : "unknown";
    bySource[key].count += 1;
    bySource[key].minutes += minutes;
    totalMinutes += minutes;
    count += 1;
  }
  return { count, totalMinutes, averageMinutes: count ? Math.round(totalMinutes / count) : 0, bySource };
}

/**
 * Percentuali intere che sommano sempre a 100 (metodo dei resti più grandi): prima la parte intera,
 * poi un punto in più ai resti maggiori. Senza minuti tutte 0.
 */
export function largestRemainderPercents(values: readonly number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (!total) return values.map(() => 0);
  const exact = values.map((value) => (Math.max(0, value) / total) * 100);
  const result = exact.map(Math.floor);
  let missing = 100 - result.reduce((sum, value) => sum + value, 0);
  const order = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (missing <= 0) break;
    result[index] += 1;
    missing -= 1;
  }
  return result;
}

/**
 * Ore (un decimale) delle righe che sommano sempre al totale mostrato: stessi resti più grandi delle
 * percentuali, in decimi d'ora (6 minuti). Es.: 50 e 25 minuti → 0,9 + 0,4 = 1,3 h (non 0,8 + 0,4).
 */
export function hoursThatAddUp(minutes: readonly number[]): number[] {
  const tenths = minutes.map((value) => Math.max(0, value) / 6);
  // Come formatHours sul totale dei minuti (stesso arrotondamento, niente somma di decimali).
  const target = Math.round((minutes.reduce((sum, value) => sum + Math.max(0, value), 0) / 60) * 10);
  const result = tenths.map(Math.floor);
  let missing = target - result.reduce((sum, value) => sum + value, 0);
  const order = tenths.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest || a.index - b.index);
  for (const { index } of order) {
    if (missing <= 0) break;
    result[index] += 1;
    missing -= 1;
  }
  return result.map((value) => value / 10);
}

/** Sessioni completate di una materia, dalla più recente. */
export function subjectSessions(sessions: StudySession[], subjectId: string): StudySession[] {
  return completed(sessions)
    .filter((session) => session.subjectId === subjectId)
    .sort((a, b) => startTime(b) - startTime(a));
}

export interface StudyTotals {
  total: number;
  today: number;
  /** Da lunedì. */
  week: number;
  month: number;
  count: number;
}

/** Minuti in tutto, oggi, questa settimana e questo mese (ogni sessione nel giorno in cui è iniziata). */
export function studyTotals(sessions: StudySession[], now: Date): StudyTotals {
  // Intervalli di calendario [inizio, inizio successivo): una sessione con l'orologio avanti
  // (altro dispositivo) non finisce in "oggi"; date-fns tiene conto dei giorni di 23 o 25 ore.
  const dayStart = startOfDay(now);
  const weekStart = startOfWeek(now, WEEK);
  const monthStart = startOfMonth(now);
  const within = (time: number, start: Date, end: Date) => time >= start.getTime() && time < end.getTime();
  const nextDay = addDays(dayStart, 1);
  const nextWeek = addWeeks(weekStart, 1);
  const nextMonth = addMonths(monthStart, 1);
  const totals: StudyTotals = { total: 0, today: 0, week: 0, month: 0, count: 0 };
  for (const session of completed(sessions)) {
    const minutes = sessionMinutes(session);
    const time = startTime(session);
    totals.total += minutes;
    totals.count += 1;
    if (within(time, dayStart, nextDay)) totals.today += minutes;
    if (within(time, weekStart, nextWeek)) totals.week += minutes;
    if (within(time, monthStart, nextMonth)) totals.month += minutes;
  }
  return totals;
}

export const RECENT_TREND_UNITS = ["day", "week", "month"] as const;
export type RecentTrendUnit = (typeof RECENT_TREND_UNITS)[number];
/** Quanti punti mostra l'andamento: due settimane di giorni, tre mesi di settimane, un anno di mesi. */
const RECENT_COUNT: Record<RecentTrendUnit, number> = { day: 14, week: 12, month: 12 };

/** Andamento recente fino a oggi: gli ultimi giorni, settimane (da lunedì) o mesi. */
export function recentTrend(sessions: StudySession[], unit: RecentTrendUnit, now: Date, count: number = RECENT_COUNT[unit]): TrendBucket[] {
  const current = unit === "day" ? startOfDay(now) : unit === "week" ? startOfWeek(now, WEEK) : startOfMonth(now);
  const step = (date: Date, amount: number) => (unit === "day" ? addDays(date, amount) : unit === "week" ? addWeeks(date, amount) : addMonths(date, amount));
  const buckets: TrendBucket[] = [];
  for (let index = count - 1; index >= 0; index -= 1) {
    const start = step(current, -index);
    buckets.push({ start, end: step(start, 1), minutes: 0 });
  }
  if (!buckets.length) return buckets;
  const from = buckets[0].start.getTime();
  const to = buckets[buckets.length - 1].end.getTime();
  for (const session of completed(sessions)) {
    const time = startTime(session);
    if (!(time >= from && time < to)) continue;
    const bucket = buckets.find((item) => time >= item.start.getTime() && time < item.end.getTime());
    if (bucket) bucket.minutes += sessionMinutes(session);
  }
  return buckets;
}

export interface TopicMinutes {
  /** null = "Senza argomento" (nessuno o argomento eliminato). */
  id: string | null;
  title: string;
  minutes: number;
  count: number;
}

/** Tempo per argomento, dal più studiato; le sessioni senza argomento in fondo. */
export function minutesByTopic(sessions: StudySession[], topics: ReadonlyArray<{ id: string; title: string }>): TopicMinutes[] {
  const byId = new Map(topics.map((topic) => [topic.id, topic]));
  const rows = new Map<string, TopicMinutes>();
  const none: TopicMinutes = { id: null, title: NO_TOPIC_LABEL, minutes: 0, count: 0 };
  for (const session of completed(sessions)) {
    const topic = session.topicId ? byId.get(session.topicId) : undefined;
    const row = topic ? (rows.get(topic.id) ?? { id: topic.id, title: topic.title, minutes: 0, count: 0 }) : none;
    row.minutes += sessionMinutes(session);
    row.count += 1;
    if (topic) rows.set(topic.id, row);
  }
  const sorted = [...rows.values()].sort((a, b) => b.minutes - a.minutes || a.title.localeCompare(b.title, "it"));
  return none.count ? [...sorted, none] : sorted;
}

/**
 * Obiettivo settimanale utilizzabile (minuti > 0) o undefined. Impostazioni chiede almeno un'ora,
 * ma un valore 0 o mancante può arrivare da dati vecchi, da un'altra versione o da un agente.
 */
export const weeklyTargetOf = (target: unknown): number | undefined =>
  typeof target === "number" && Number.isFinite(target) && target > 0 ? target : undefined;

/** Avanzamento della settimana verso l'obiettivo, da 0 a 100 (mai NaN): senza obiettivo valido 0. */
export const weeklyProgress = (minutes: number, target: unknown): number => {
  const goal = weeklyTargetOf(target);
  if (goal === undefined || !Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.min(100, (minutes / goal) * 100);
};

/** Quante date (ISO) cadono nel periodo: attività completate (`completedAt`), ripassi (`lastReviewedAt`). */
export function countInRange(dates: ReadonlyArray<string | undefined>, range: Pick<PeriodRange, "start" | "end">): number {
  const from = range.start.getTime();
  const to = range.end.getTime();
  let count = 0;
  for (const value of dates) {
    if (!value) continue;
    const date = parseISO(value);
    if (isValid(date) && date.getTime() >= from && date.getTime() < to) count += 1;
  }
  return count;
}
