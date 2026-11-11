// Motore delle ripetizioni del calendario: regole (sottoinsieme di RRULE, RFC 5545), occorrenze
// modificate o cancellate (righe separate `serie@giorno`), divisioni "questa e le successive",
// fusi orari, ricorrenze annuali e promemoria. Tutto puro: niente store, niente DOM.
//
// Compatibilità (docs/plans/2026-11-11-ux-audit/recurrence.md §6-7):
// - `recurrence`/`recurrenceUntil` restano la proiezione per le app vecchie; `repeat` vale solo se
//   `repeatLegacy` coincide ancora con loro (un'app vecchia che cambia la ripetizione vince).
// - Senza `timeZone` un evento si espande come sempre: ora locale del dispositivo, "fino al" dalla
//   mezzanotte locale, mensile che usa l'ultimo giorno del mese se il giorno non esiste.
// - Le regole di altri sono dati non fidati: si validano e ogni espansione ha un tetto.
import { parseISO } from "date-fns";
import type { CalendarEvent, EventOccasion, EventReminder, OccasionKind, RepeatEnd, RepeatMonthly, RepeatRule, Weekday } from "../types";
import {
  civilAddDays,
  civilDateOf,
  civilDayNumber,
  civilDaysBetween,
  civilFromDayNumber,
  civilFromParts,
  civilWeekday,
  daysInMonth,
  deviceTimeZone,
  isCivilDate,
  isValidTimeZone,
  localMidnight,
  parseCivil,
  utcToZonedParts,
  zonedToUtc
} from "./tz";
import { MONTH_NAME, REMINDER_TEXT, REPEAT_TEXT, WEEKDAY_NAME, WEEKDAY_SHORT } from "./labels";

export interface EventOccurrence extends CalendarEvent {
  /** Chiave univoca dell'occorrenza (id + inizio), da usare come key React. */
  occurrenceKey: string;
  /** true se l'evento fa parte di una serie ripetuta. */
  recurring: boolean;
  /** Giorno (YYYY-MM-DD, nel fuso della serie) dell'occorrenza: con l'id della serie la individua. */
  occurrenceDate: string;
}

/** Al massimo tante occorrenze per evento in una chiamata (come prima). */
export const MAX_OCCURRENCES = 1000;
export const MAX_INTERVAL = 99;
export const MAX_COUNT = 999;
/** Tetto ai passi di qualsiasi ciclo su una regola: nessun dato può bloccare la pagina. */
const MAX_STEPS = 20_000;
const MAX_REMINDERS = 10;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

export const WEEKDAYS: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];
/** Numerazione di Date.getDay(): 0 = domenica. */
const WEEKDAY_NUMBER: Record<Weekday, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const WEEKDAY_BY_NUMBER: Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isWeekday = (value: unknown): value is Weekday => typeof value === "string" && Object.hasOwn(WEEKDAY_NUMBER, value);
const isIntIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

// ---------------------------------------------------------------------------------------
// Validazione e normalizzazione
// ---------------------------------------------------------------------------------------

export type RepeatValidation = { ok: true; rule: RepeatRule } | { ok: false; errors: string[] };

/**
 * Controlla una regola (anche di un'altra persona) e ne restituisce una copia pulita con solo i
 * campi noti. Rifiuta intervalli fuori da 1–99, conteggi fuori da 1–999, giorni inventati,
 * combinazioni senza senso (giorni della settimana su una regola non settimanale).
 */
export const validateRepeat = (input: unknown): RepeatValidation => {
  const errors: string[] = [];
  if (!isRecord(input)) return { ok: false, errors: ["repeat"] };
  const freq = input.freq;
  if (freq !== "daily" && freq !== "weekly" && freq !== "monthly" && freq !== "yearly") return { ok: false, errors: ["freq"] };
  const rule: RepeatRule = { freq };
  if (input.interval !== undefined) {
    if (isIntIn(input.interval, 1, MAX_INTERVAL)) {
      if (input.interval !== 1) rule.interval = input.interval;
    } else errors.push("interval");
  }
  if (input.byWeekday !== undefined) {
    const list = input.byWeekday;
    if (freq !== "weekly" || !Array.isArray(list) || !list.length || list.length > 7 || !list.every(isWeekday)) errors.push("byWeekday");
    else rule.byWeekday = WEEKDAYS.filter((day) => list.includes(day));
  }
  if (input.monthly !== undefined) {
    const monthly = input.monthly;
    if (freq !== "monthly" || !isRecord(monthly)) errors.push("monthly");
    else if (monthly.by === "day" || monthly.by === "lastDay" || monthly.by === "clampDay") rule.monthly = { by: monthly.by };
    else if (monthly.by === "weekday" && (monthly.nth === -1 || isIntIn(monthly.nth, 1, 4)) && isWeekday(monthly.weekday)) {
      rule.monthly = { by: "weekday", nth: monthly.nth as 1 | 2 | 3 | 4 | -1, weekday: monthly.weekday };
    } else errors.push("monthly");
  }
  if (input.yearlyLeap !== undefined) {
    if (freq === "yearly" && (input.yearlyLeap === "feb28" || input.yearlyLeap === "mar1" || input.yearlyLeap === "skip")) rule.yearlyLeap = input.yearlyLeap;
    else errors.push("yearlyLeap");
  }
  if (input.end !== undefined) {
    const end = input.end;
    if (!isRecord(end)) errors.push("end");
    else if (end.type === "never") rule.end = { type: "never" };
    else if (end.type === "until" && isCivilDate(end.date)) rule.end = { type: "until", date: end.date };
    else if (end.type === "count" && isIntIn(end.count, 1, MAX_COUNT)) rule.end = { type: "count", count: end.count };
    else errors.push("end");
  }
  if (input.wkst !== undefined) {
    if (isWeekday(input.wkst)) {
      if (input.wkst !== "MO") rule.wkst = input.wkst;
    } else errors.push("wkst");
  }
  if (input.sourceRRule !== undefined) {
    if (typeof input.sourceRRule === "string" && input.sourceRRule.length <= 1000) rule.sourceRRule = input.sourceRRule;
    else errors.push("sourceRRule");
  }
  return errors.length ? { ok: false, errors } : { ok: true, rule };
};

type LegacyFields = Pick<CalendarEvent, "recurrence" | "recurrenceUntil">;

/** Impronta dei campi vecchi salvata con `repeat`: se cambia, li ha toccati un'app vecchia. */
export const repeatLegacyKey = (event: Partial<LegacyFields>) => `${event.recurrence ?? "none"}|${event.recurrenceUntil ?? ""}`;

/**
 * Regola dei soli campi vecchi, con la stessa semantica di sempre: "daily", "weekly", e ogni altro
 * valore non vuoto mensile con il giorno troncato a fine mese ("clampDay").
 */
export const legacyRule = (event: Partial<LegacyFields>): RepeatRule | null => {
  const recurrence = (event.recurrence ?? "none") as unknown;
  if (recurrence === "none") return null;
  const rule: RepeatRule =
    recurrence === "daily" ? { freq: "daily" } : recurrence === "weekly" ? { freq: "weekly" } : { freq: "monthly", monthly: { by: "clampDay" } };
  const until = typeof event.recurrenceUntil === "string" ? event.recurrenceUntil.slice(0, 10) : "";
  if (isCivilDate(until)) rule.end = { type: "until", date: until };
  return rule;
};

/** Regola che vale per l'evento: `repeat` se valido e non superato da un'app vecchia, altrimenti i campi vecchi. */
export const normalizeRepeat = (event: Partial<Pick<CalendarEvent, "repeat" | "repeatLegacy" | "recurrence" | "recurrenceUntil">>): RepeatRule | null => {
  if (event.repeat !== undefined && event.repeat !== null) {
    const stale = typeof event.repeatLegacy === "string" && event.repeatLegacy !== repeatLegacyKey(event);
    if (!stale) {
      const checked = validateRepeat(event.repeat);
      if (checked.ok) return checked.rule;
    }
  }
  return legacyRule(event);
};

// ---------------------------------------------------------------------------------------
// Date di una regola (date civili, nel fuso della serie)
// ---------------------------------------------------------------------------------------

interface RuleDate {
  date: string;
  /** Posizione dalla prima (0), o -1 se la generazione è partita più avanti. */
  index: number;
}

const intervalOf = (rule: RepeatRule) => (isIntIn(rule.interval, 1, MAX_INTERVAL) ? rule.interval : 1);
const countOf = (rule: RepeatRule | null) => (rule?.end?.type === "count" ? rule.end.count : undefined);
const isLeap = (year: number) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/** Giorno del mese per la regola mensile, o null se quel mese non ne ha uno. */
const monthlyDay = (monthly: RepeatMonthly, startDay: number, year: number, month: number) => {
  const last = daysInMonth(year, month);
  if (monthly.by === "day") return startDay <= last ? startDay : null;
  if (monthly.by === "lastDay") return last;
  if (monthly.by === "clampDay") return Math.min(startDay, last);
  const target = WEEKDAY_NUMBER[monthly.weekday];
  if (monthly.nth === -1) {
    const lastWeekday = civilWeekday(civilFromParts(year, month, last));
    return last - ((lastWeekday - target + 7) % 7);
  }
  const firstWeekday = civilWeekday(civilFromParts(year, month, 1));
  return 1 + ((target - firstWeekday + 7) % 7) + 7 * (monthly.nth - 1);
};

/**
 * Date della regola in ordine crescente, dalla prima (sempre l'inizio, come DTSTART) o, senza
 * conteggio, da poco prima di `fromDate`. Chi chiama si ferma alla fine della finestra.
 */
function* ruleDates(rule: RepeatRule, startDate: string, fromDate?: string): Generator<RuleDate> {
  const interval = intervalOf(rule);
  const counted = countOf(rule) !== undefined;
  const skipTo = !counted && fromDate && fromDate > startDate ? fromDate : undefined;
  const start = civilDayNumber(startDate);
  let steps = 0;
  let index = 0;
  const next = (date: string, skipped: boolean): RuleDate => ({ date, index: skipped ? -1 : index++ });

  if (rule.freq === "daily" || (rule.freq === "weekly" && !rule.byWeekday?.length)) {
    const step = rule.freq === "daily" ? interval : 7 * interval;
    const first = skipTo ? Math.max(0, Math.floor((civilDayNumber(skipTo) - start) / step) - 1) : 0;
    for (let k = first; steps < MAX_STEPS; k += 1, steps += 1) yield { date: civilFromDayNumber(start + k * step), index: first ? -1 : k };
    return;
  }

  if (rule.freq === "weekly") {
    const weekStart = WEEKDAY_NUMBER[rule.wkst ?? "MO"];
    const startWeekday = civilWeekday(startDate);
    const week0 = start - ((startWeekday - weekStart + 7) % 7);
    const offsets = [...new Set((rule.byWeekday ?? []).map((day) => (WEEKDAY_NUMBER[day] - weekStart + 7) % 7))].sort((a, b) => a - b);
    const period = 7 * interval;
    const first = skipTo ? Math.max(0, Math.floor((civilDayNumber(skipTo) - week0) / period) - 1) : 0;
    const skipped = first > 0;
    if (!skipped && !offsets.includes((startWeekday - weekStart + 7) % 7)) yield next(startDate, false);
    for (let p = first; steps < MAX_STEPS; p += 1, steps += 1) {
      for (const offset of offsets) {
        const day = week0 + p * period + offset;
        if (day >= start) yield next(civilFromDayNumber(day), skipped);
      }
    }
    return;
  }

  const parts = parseCivil(startDate);
  if (!parts) return;

  if (rule.freq === "monthly") {
    const monthly: RepeatMonthly = rule.monthly ?? { by: "day" };
    const month0 = parts.year * 12 + parts.month - 1;
    const target = skipTo ? parseCivil(skipTo) : null;
    const first = target ? Math.max(0, Math.floor((target.year * 12 + target.month - 1 - month0) / interval) - 1) : 0;
    const skipped = first > 0;
    let emittedStart = skipped;
    for (let k = first; steps < MAX_STEPS; k += 1, steps += 1) {
      const monthIndex = month0 + k * interval;
      const year = Math.floor(monthIndex / 12);
      const month = monthIndex - year * 12 + 1;
      const day = monthlyDay(monthly, parts.day, year, month);
      const date = day === null ? null : civilFromParts(year, month, day);
      if (!emittedStart && (date === null || date >= startDate)) {
        emittedStart = true;
        yield next(startDate, false);
      }
      if (date !== null && date > startDate) yield next(date, skipped);
    }
    return;
  }

  // yearly
  const target = skipTo ? parseCivil(skipTo) : null;
  const first = target ? Math.max(0, Math.floor((target.year - parts.year) / interval) - 1) : 0;
  const skipped = first > 0;
  for (let k = first; steps < MAX_STEPS; k += 1, steps += 1) {
    const year = parts.year + k * interval;
    if (k === 0) {
      yield next(startDate, false);
      continue;
    }
    if (parts.month === 2 && parts.day === 29 && !isLeap(year)) {
      if (rule.yearlyLeap === "skip") continue;
      yield next(rule.yearlyLeap === "mar1" ? civilFromParts(year, 3, 1) : civilFromParts(year, 2, 28), skipped);
      continue;
    }
    yield next(civilFromParts(year, parts.month, parts.day), skipped);
  }
}

// ---------------------------------------------------------------------------------------
// Serie: inizio, durata, fuso
// ---------------------------------------------------------------------------------------

const FLOATING = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

interface Series {
  rule: RepeatRule | null;
  /** Fuso IANA valido dell'evento; assente = ora locale del dispositivo (come prima). */
  zone?: string;
  /** Tutto il giorno "fluttuante": stesso giorno in ogni fuso, da mezzanotte a mezzanotte locali. */
  civil: boolean;
  startDate: string;
  /** Ora da orologio dell'inizio [h, min, s, ms]. */
  wall: [number, number, number, number];
  baseStartMs: number;
  durationMs: number;
  spanDays: number;
}

const floatingFields = (match: RegExpExecArray) => {
  const [year, month, day] = match[1].split("-").map(Number);
  return [year, month, day, Number(match[2] ?? 0), Number(match[3] ?? 0), Number(match[4] ?? 0), Number((match[5] ?? "0").padEnd(3, "0"))];
};

/** Istante di un inizio o fine salvato: fluttuante = ora da orologio nel fuso (o del dispositivo). */
const instantOf = (value: unknown, zone: string | undefined) => {
  if (typeof value !== "string") return Number.NaN;
  const floating = FLOATING.exec(value);
  if (floating && zone) return isCivilDate(floating[1]) ? zonedToUtc(floatingFields(floating), zone).getTime() : Number.NaN;
  return parseISO(value).getTime();
};

/** Giorno civile di un inizio o fine salvato e se cade esattamente a mezzanotte. */
const civilOf = (value: unknown, zone: string | undefined): { date: string; midnight: boolean } | null => {
  if (typeof value !== "string") return null;
  const floating = FLOATING.exec(value);
  if (floating) {
    if (!isCivilDate(floating[1])) return null;
    const [, , , h, m, s, ms] = floatingFields(floating);
    return { date: floating[1], midnight: !h && !m && !s && !ms };
  }
  const ms = parseISO(value).getTime();
  if (Number.isNaN(ms)) return null;
  const parts = utcToZonedParts(ms, zone);
  return { date: civilFromParts(parts.year, parts.month, parts.day), midnight: !parts.hour && !parts.minute && !parts.second && !parts.millisecond };
};

const zoneOf = (event: Pick<CalendarEvent, "timeZone">) => (isValidTimeZone(event.timeZone) ? event.timeZone : undefined);

const seriesOf = (event: CalendarEvent, rule: RepeatRule | null = normalizeRepeat(event)): Series | null => {
  const zone = zoneOf(event);
  const floatingStart = typeof event.start === "string" && FLOATING.test(event.start);
  if (event.allDay === true && (floatingStart || zone)) {
    const start = civilOf(event.start, zone);
    if (!start) return null;
    const end = civilOf(event.end, zone);
    const endDate = end ? (end.midnight ? end.date : civilAddDays(end.date, 1)) : start.date;
    return {
      rule,
      zone,
      civil: true,
      startDate: start.date,
      wall: [0, 0, 0, 0],
      baseStartMs: localMidnight(start.date).getTime(),
      durationMs: DAY_MS,
      spanDays: Math.max(1, civilDaysBetween(start.date, endDate))
    };
  }
  const baseStartMs = instantOf(event.start, zone);
  if (Number.isNaN(baseStartMs)) return null;
  const baseEndMs = instantOf(event.end, zone);
  const durationMs = !Number.isNaN(baseEndMs) && baseEndMs > baseStartMs ? baseEndMs - baseStartMs : HOUR_MS;
  const parts = utcToZonedParts(baseStartMs, zone);
  return {
    rule,
    zone,
    civil: false,
    startDate: civilFromParts(parts.year, parts.month, parts.day),
    wall: [parts.hour, parts.minute, parts.second, parts.millisecond],
    baseStartMs,
    durationMs,
    spanDays: 1
  };
};

const instanceStartMs = (series: Series, date: string) => {
  if (series.civil) return localMidnight(date).getTime();
  if (date === series.startDate) return series.baseStartMs;
  const parts = parseCivil(date);
  if (!parts) return Number.NaN;
  return zonedToUtc([parts.year, parts.month, parts.day, ...series.wall], series.zone).getTime();
};

const instanceEndMs = (series: Series, date: string, startMs: number) =>
  series.civil ? localMidnight(civilAddDays(date, series.spanDays)).getTime() : startMs + series.durationMs;

/**
 * "Fino al" compreso. Nel fuso dell'evento (o per i tutto il giorno fluttuanti) si confrontano i
 * giorni; senza fuso vale la regola di sempre: entro mezzanotte locale del giorno + 24 ore.
 */
const withinUntil = (series: Series, end: RepeatEnd | undefined, date: string, startMs: number) => {
  if (end?.type !== "until") return true;
  if (series.zone || series.civil) return date <= end.date;
  return startMs <= localMidnight(end.date).getTime() + DAY_MS - 1;
};

interface Instance {
  date: string;
  startMs: number;
  endMs: number;
}

/**
 * Occorrenze della serie con giorno in [fromDate, toDate] (date civili), al massimo `limit`,
 * prima del giorno `cut` (inizio di una serie figlia). Conteggio e "fino al" come la regola.
 */
const seriesInstances = (series: Series, fromDate: string, toDate: string, cut: string | undefined, limit: number): Instance[] => {
  const out: Instance[] = [];
  const rule = series.rule;
  if (!rule) {
    if (series.startDate >= fromDate && series.startDate <= toDate && (!cut || series.startDate < cut)) {
      const startMs = instanceStartMs(series, series.startDate);
      out.push({ date: series.startDate, startMs, endMs: instanceEndMs(series, series.startDate, startMs) });
    }
    return out;
  }
  const count = countOf(rule);
  for (const { date, index } of ruleDates(rule, series.startDate, fromDate)) {
    if (date > toDate || (cut && date >= cut)) break;
    if (count !== undefined && index >= count) break;
    const startMs = instanceStartMs(series, date);
    if (Number.isNaN(startMs)) break;
    if (!withinUntil(series, rule.end, date, startMs)) break;
    if (date < fromDate) continue;
    out.push({ date, startMs, endMs: instanceEndMs(series, date, startMs) });
    if (out.length >= limit) break;
  }
  return out;
};

/** Il giorno è un'occorrenza della serie (prima del taglio di una figlia)? */
const hasInstance = (series: Series, date: string, cut?: string) =>
  isCivilDate(date) && seriesInstances(series, date, date, cut, 1).some((instance) => instance.date === date);

/** Giorni civili da guardare per la finestra [from, to). */
const windowDates = (series: Series, fromMs: number, toMs: number) => {
  if (series.civil) {
    return { fromDate: civilAddDays(civilDateOf(fromMs), -series.spanDays - 1), toDate: civilAddDays(civilDateOf(toMs), 1) };
  }
  const back = Math.max(fromMs - series.durationMs, -8.64e15);
  return { fromDate: civilAddDays(civilDateOf(back, series.zone), -1), toDate: civilAddDays(civilDateOf(toMs, series.zone), 1) };
};

/**
 * Occorrenze della regola che iniziano in [from, to). `wallStart` è l'inizio da orologio
 * ("YYYY-MM-DDTHH:mm[:ss]") nel fuso `zone` (assente = dispositivo).
 */
export const expandRule = (rule: RepeatRule | null, wallStart: string, zone: string | undefined, from: Date, to: Date): { date: string; start: Date }[] => {
  const match = FLOATING.exec(wallStart);
  if (!match || !isCivilDate(match[1])) return [];
  const fields = floatingFields(match);
  const series: Series = {
    rule,
    zone: isValidTimeZone(zone) ? zone : undefined,
    civil: false,
    startDate: match[1],
    wall: [fields[3], fields[4], fields[5], fields[6]],
    baseStartMs: zonedToUtc(fields, isValidTimeZone(zone) ? zone : undefined).getTime(),
    durationMs: 0,
    spanDays: 1
  };
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const { fromDate, toDate } = windowDates(series, fromMs, toMs);
  return seriesInstances(series, fromDate, toDate, undefined, MAX_OCCURRENCES * 2)
    .filter((instance) => instance.startMs >= fromMs && instance.startMs < toMs)
    .slice(0, MAX_OCCURRENCES)
    .map((instance) => ({ date: instance.date, start: new Date(instance.startMs) }));
};

/** Occorrenze prima del giorno `date` (escluso), contando dalla prima. Senza regola: 1 se l'inizio è prima. */
export const countBefore = (rule: RepeatRule | null, startDate: string, date: string) => {
  if (!rule) return startDate < date ? 1 : 0;
  const count = countOf(rule);
  let total = 0;
  for (const item of ruleDates(rule, startDate)) {
    if (item.date >= date) break;
    if (count !== undefined && item.index >= count) break;
    if (rule.end?.type === "until" && item.date > rule.end.date) break;
    total += 1;
  }
  return total;
};

/** Ultimo giorno della regola, se finisce (per "fino al" della proiezione vecchia). */
const lastDate = (rule: RepeatRule, startDate: string) => {
  if (rule.end?.type === "until") return rule.end.date;
  const count = countOf(rule);
  if (count === undefined) return undefined;
  let last: string | undefined;
  for (const item of ruleDates(rule, startDate)) {
    if (item.index >= count) break;
    last = item.date;
  }
  return last;
};

// ---------------------------------------------------------------------------------------
// Espansione di elenchi di eventi (con occorrenze modificate e divisioni)
// ---------------------------------------------------------------------------------------

export interface ExpandOptions<T> {
  /**
   * Gruppo di un evento (il proprietario): righe modificate e figlie si legano solo alla serie dello
   * stesso gruppo, perché le liste condivise mescolano persone con id uguali. Predefinito:
   * `sharedFrom.ownerId` se c'è, altrimenti un solo gruppo.
   */
  groupKey?: (event: T) => string;
}

const defaultGroupKey = (event: unknown) => {
  const shared = (event as { sharedFrom?: { ownerId?: unknown } }).sharedFrom;
  return typeof shared?.ownerId === "string" ? shared.ownerId : "";
};

/** Riga di un'occorrenza modificata o cancellata (non una serie). */
export const isOccurrenceRow = (event: Pick<CalendarEvent, "seriesId">) => typeof event.seriesId === "string" && event.seriesId.length > 0;

/** Id prevedibile della riga di un'occorrenza: modifiche da due dispositivi convergono. */
export const occurrenceId = (seriesId: string, date: string) => `${seriesId}@${date}`;

const timestamp = (value: unknown) => {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
};

const occurrenceOf = <T extends CalendarEvent>(event: T, startMs: number, endMs: number, date: string, recurring: boolean): T & EventOccurrence => {
  const start = new Date(startMs).toISOString();
  return { ...event, start, end: new Date(endMs).toISOString(), occurrenceKey: `${event.id}@${start}`, recurring, occurrenceDate: date };
};

/** Giorno da cui una figlia ferma la madre: quello salvato nella figlia o il suo inizio nel fuso della madre. */
const cutDateOf = (child: CalendarEvent, parent: Series) => {
  if (isCivilDate(child.originalDate)) return child.originalDate;
  return civilOf(child.start, parent.zone)?.date;
};

/**
 * Occorrenze che si sovrappongono a [from, to), ordinate per inizio. I campi extra di T restano.
 * - Le righe `seriesId` sostituiscono (o, cancellate, nascondono) l'occorrenza del loro giorno;
 *   restano nascoste se la serie non c'è o quel giorno non è più un'occorrenza.
 * - Le serie figlie (`splitFrom`) fermano la madre dal loro giorno, qualunque sia l'ordine delle scritture.
 * - Al massimo MAX_OCCURRENCES occorrenze per serie.
 */
export const expandEvents = <T extends CalendarEvent>(events: readonly T[], from: Date, to: Date, options: ExpandOptions<T> = {}): (T & EventOccurrence)[] => {
  const groupOf = options.groupKey ?? defaultGroupKey;
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const overrides = new Map<string, Map<string, T>>();
  const children = new Map<string, T[]>();
  const masters: T[] = [];
  const keyOf = (group: string, id: string) => `${group}\u0000${id}`;

  for (const event of events) {
    if (!isRecord(event)) continue;
    if (isOccurrenceRow(event)) {
      if (!isCivilDate(event.originalDate)) continue;
      const key = keyOf(groupOf(event), event.seriesId as string);
      const byDate = overrides.get(key) ?? new Map<string, T>();
      const existing = byDate.get(event.originalDate);
      if (!existing || timestamp(event.updatedAt) >= timestamp(existing.updatedAt)) byDate.set(event.originalDate, event);
      overrides.set(key, byDate);
      continue;
    }
    if (event.archived) continue;
    masters.push(event);
    if (typeof event.splitFrom === "string" && event.splitFrom && event.splitFrom !== event.id) {
      const key = keyOf(groupOf(event), event.splitFrom);
      children.set(key, [...(children.get(key) ?? []), event]);
    }
  }

  const result: { ms: number; item: T & EventOccurrence }[] = [];
  for (const event of masters) {
    const series = seriesOf(event);
    if (!series) continue;
    const key = keyOf(groupOf(event), event.id);
    const rows = overrides.get(key);
    let cut: string | undefined;
    for (const child of children.get(key) ?? []) {
      const date = cutDateOf(child, series);
      if (date && (!cut || date < cut)) cut = date;
    }
    const recurring = series.rule !== null;
    const { fromDate, toDate } = windowDates(series, fromMs, toMs);
    let emitted = 0;
    for (const instance of seriesInstances(series, fromDate, toDate, cut, MAX_OCCURRENCES * 2)) {
      if (instance.startMs >= toMs || emitted >= MAX_OCCURRENCES) break;
      if (rows?.has(instance.date) || instance.endMs <= fromMs) continue;
      result.push({ ms: instance.startMs, item: occurrenceOf(event, instance.startMs, instance.endMs, instance.date, recurring) });
      emitted += 1;
    }
    for (const [date, row] of rows ?? []) {
      if (row.cancelled || row.archived || !hasInstance(series, date, cut)) continue;
      const own = seriesOf(row, null);
      if (!own) continue;
      const startMs = instanceStartMs(own, own.startDate);
      const endMs = instanceEndMs(own, own.startDate, startMs);
      if (startMs < toMs && endMs > fromMs) result.push({ ms: startMs, item: occurrenceOf(row, startMs, endMs, date, true) });
    }
  }
  return result.sort((a, b) => a.ms - b.ms).map((entry) => entry.item);
};

/** Prossima occorrenza non ancora finita da `from` (entro `horizonDays`), con le righe modificate passate. */
export const nextOccurrence = <T extends CalendarEvent>(event: T, from: Date, options: { overrides?: readonly T[]; horizonDays?: number } = {}) => {
  const horizon = options.horizonDays ?? 366;
  const found = expandEvents([event, ...(options.overrides ?? [])], from, new Date(from.getTime() + horizon * DAY_MS));
  return found.find((item) => Date.parse(item.end) > from.getTime()) ?? null;
};

// ---------------------------------------------------------------------------------------
// Proiezione per le app vecchie e salvataggio
// ---------------------------------------------------------------------------------------

/**
 * Valori vecchi da salvare insieme alla regola: un sottoinsieme sicuro delle date vere per chi ha
 * un'app vecchia (lun, mer, ven -> "weekly" sul giorno d'inizio; ogni anno, ogni 2 settimane o il
 * secondo martedì -> "none", cioè solo la prima). "Fino al" = ultimo giorno della regola, se finisce.
 */
export const legacyProjection = (rule: RepeatRule | null, startDate: string): { recurrence: NonNullable<CalendarEvent["recurrence"]>; recurrenceUntil: string | undefined } => {
  const none = { recurrence: "none" as const, recurrenceUntil: undefined };
  if (!rule) return none;
  const interval = intervalOf(rule);
  const startDay = parseCivil(startDate)?.day ?? 1;
  let recurrence: NonNullable<CalendarEvent["recurrence"]> = "none";
  if (rule.freq === "daily") recurrence = interval === 1 ? "daily" : interval === 7 ? "weekly" : "none";
  else if (rule.freq === "weekly") {
    const startWeekday = WEEKDAY_BY_NUMBER[civilWeekday(startDate)];
    recurrence = interval === 1 && (!rule.byWeekday?.length || rule.byWeekday.includes(startWeekday)) ? "weekly" : "none";
  } else if (rule.freq === "monthly" && interval === 1) {
    const by = rule.monthly?.by ?? "day";
    const exact = by === "clampDay" || (by === "day" && startDay <= 28) || (by === "lastDay" && startDay === 31);
    recurrence = exact ? "monthly" : "none";
  }
  if (recurrence === "none") return none;
  return { recurrence, recurrenceUntil: lastDate(rule, startDate) };
};

const withoutKeys = <T extends object>(value: T, keys: readonly string[]): T => {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of keys) delete copy[key];
  return copy as T;
};

const RULE_KEYS = ["repeat", "repeatLegacy"] as const;

/** Giorno d'inizio della serie nel suo fuso (per proiezione e descrizioni). */
const startDateOf = (event: CalendarEvent, zone: string | undefined) => {
  const series = seriesOf({ ...event, timeZone: zone }, null);
  return series?.startDate ?? (typeof event.start === "string" ? event.start.slice(0, 10) : "");
};

/**
 * Prepara un evento da salvare: con una regola valida scrive `repeat` (pulita), `repeatLegacy`,
 * `timeZone` (quello dell'evento o `options.timeZone`) e la proiezione vecchia; se un'app vecchia ha
 * cambiato i campi vecchi (impronta diversa) o la regola non è valida, la regola sparisce e valgono i
 * campi vecchi. `repeatChanged`: la regola è stata appena scelta (vince sull'impronta); se è vuota,
 * l'evento non si ripete più. Senza regola e senza cambi restituisce lo stesso oggetto.
 */
export const applyRepeatFields = <T extends CalendarEvent>(event: T, options: { repeatChanged?: boolean; timeZone?: string } = {}): T => {
  const raw = event.repeat as unknown;
  if (raw === undefined || raw === null) {
    if (!options.repeatChanged && !("repeat" in event) && !("repeatLegacy" in event)) return event;
    const cleared = withoutKeys(event, RULE_KEYS);
    return options.repeatChanged ? { ...cleared, recurrence: "none", recurrenceUntil: undefined } : cleared;
  }
  const stale = !options.repeatChanged && typeof event.repeatLegacy === "string" && event.repeatLegacy !== repeatLegacyKey(event);
  const checked = validateRepeat(raw);
  if (stale || !checked.ok) return withoutKeys(event, RULE_KEYS);
  const zone = zoneOf(event) ?? (isValidTimeZone(options.timeZone) ? options.timeZone : deviceTimeZone());
  const projection = legacyProjection(checked.rule, startDateOf(event, zone));
  return {
    ...event,
    repeat: checked.rule,
    recurrence: projection.recurrence,
    recurrenceUntil: projection.recurrenceUntil,
    repeatLegacy: repeatLegacyKey(projection),
    ...(zone ? { timeZone: zone } : {})
  };
};

/**
 * La modifica sceglie una regola diversa da quella che vale per l'evento (`normalizeRepeat`).
 * Un modulo che rimanda la regola mostrata non la cambia, così un cambio fatto da un'app vecchia
 * resta valido; `repeat` vuoto nella modifica = non si ripete più.
 */
export const changesRepeat = (event: CalendarEvent, patch: Partial<CalendarEvent>) => {
  if (!("repeat" in patch)) return false;
  const raw = patch.repeat as unknown;
  const checked = raw === undefined || raw === null ? null : validateRepeat(raw);
  if (checked && !checked.ok) return true;
  return JSON.stringify(checked ? checked.rule : null) !== JSON.stringify(normalizeRepeat(event));
};

/** La modifica cambia i campi vecchi (`recurrence`, `recurrenceUntil`) rispetto all'evento. */
const changesLegacy = (event: CalendarEvent, patch: Partial<CalendarEvent>) =>
  repeatLegacyKey({
    recurrence: "recurrence" in patch ? patch.recurrence : event.recurrence,
    recurrenceUntil: "recurrenceUntil" in patch ? patch.recurrenceUntil : event.recurrenceUntil
  }) !== repeatLegacyKey(event);

// ---------------------------------------------------------------------------------------
// Piani di modifica: solo questa, questa e le successive, tutta la serie
// ---------------------------------------------------------------------------------------

export type OccurrenceScope = "this" | "following" | "all";

export interface EditPlan {
  /** Righe da scrivere (nuove o sostituite, per id). */
  puts: CalendarEvent[];
  /** Id da eliminare. */
  deletes: string[];
}

export interface PlanOptions {
  /** Istante della modifica (updatedAt/createdAt). */
  now?: string;
  /** Fuso da fissare sulle serie che non ne hanno uno (predefinito: quello del dispositivo). */
  timeZone?: string;
  /** Id della serie figlia (predefinito prevedibile: due dispositivi che dividono allo stesso giorno convergono). */
  childId?: string;
  /** Serie di un'altra persona: le righe nuove nascono con `links: []` (lo chiede il server). */
  recipient?: boolean;
}

/** Campi che una riga di occorrenza non prende dalla modifica: identità, regola, chiavi d'importazione, materia. */
const OCCURRENCE_LOCKED = new Set([
  "id",
  "createdAt",
  "seriesId",
  "originalDate",
  "splitFrom",
  "repeat",
  "repeatLegacy",
  "recurrence",
  "recurrenceUntil",
  "sourceUid",
  "sourceRecurrenceId",
  "cancelled",
  "archived",
  "subjectId"
]);
/** Campi che una serie non prende dalla modifica (l'identità resta quella). */
const SERIES_LOCKED = new Set(["id", "createdAt", "seriesId", "originalDate", "cancelled", "sourceUid", "sourceRecurrenceId", "splitFrom"]);

const pickPatch = (patch: Partial<CalendarEvent>, locked: Set<string>) =>
  Object.fromEntries(Object.entries(patch).filter(([key]) => !locked.has(key))) as Partial<CalendarEvent>;

const EMPTY_PLAN: EditPlan = { puts: [], deletes: [] };

const nowOf = (options: PlanOptions) => options.now ?? new Date().toISOString();

const floatingDate = (date: string) => `${date}T00:00:00`;

/** Inizio e fine dell'occorrenza `date` della serie, come si salverebbero in una riga. */
const instanceFields = (series: Series, date: string) => {
  if (series.civil) return { start: floatingDate(date), end: floatingDate(civilAddDays(date, series.spanDays)) };
  const startMs = instanceStartMs(series, date);
  return { start: new Date(startMs).toISOString(), end: new Date(instanceEndMs(series, date, startMs)).toISOString() };
};

/** Riga nuova per l'occorrenza `date`: copia della serie, senza regola né chiavi d'importazione. */
const occurrenceSnapshot = (event: CalendarEvent, series: Series, date: string, options: PlanOptions): CalendarEvent => {
  const now = nowOf(options);
  const base = withoutKeys(event, ["repeat", "repeatLegacy", "recurrenceUntil", "sourceUid", "sourceRecurrenceId", "splitFrom", "cancelled"]);
  return {
    ...base,
    ...instanceFields(series, date),
    id: occurrenceId(event.id, date),
    seriesId: event.id,
    originalDate: date,
    recurrence: "none",
    subjectId: event.subjectId,
    archived: false,
    links: options.recipient ? [] : event.links,
    createdAt: now,
    updatedAt: now
  };
};

const rowsOf = (series: CalendarEvent, overrides: readonly CalendarEvent[]) => overrides.filter((row) => row.seriesId === series.id && isCivilDate(row.originalDate));

/** Nuovo inizio/fine della serie quando si sposta l'occorrenza `date`: stesso spostamento di giorni, nuova ora. */
const shiftedSeriesTimes = (event: CalendarEvent, series: Series, date: string, patch: Partial<CalendarEvent>) => {
  if (patch.start === undefined && patch.end === undefined) return {};
  if (date === series.startDate || (patch.allDay !== undefined && patch.allDay !== event.allDay)) {
    return { ...(patch.start !== undefined ? { start: patch.start } : {}), ...(patch.end !== undefined ? { end: patch.end } : {}) };
  }
  const original = instanceFields(series, date);
  const nextStart = patch.start ?? original.start;
  const nextEnd = patch.end ?? original.end;
  if (series.civil) {
    const startDay = civilOf(nextStart, series.zone);
    const endDay = civilOf(nextEnd, series.zone);
    if (!startDay) return {};
    const shift = civilDaysBetween(date, startDay.date);
    const span = endDay ? Math.max(1, civilDaysBetween(startDay.date, endDay.midnight ? endDay.date : civilAddDays(endDay.date, 1))) : series.spanDays;
    const first = civilAddDays(series.startDate, shift);
    return { start: floatingDate(first), end: floatingDate(civilAddDays(first, span)) };
  }
  const startMs = instantOf(nextStart, series.zone);
  const endMs = instantOf(nextEnd, series.zone);
  if (Number.isNaN(startMs)) return {};
  const wall = utcToZonedParts(startMs, series.zone);
  const shift = civilDaysBetween(date, civilFromParts(wall.year, wall.month, wall.day));
  const first = parseCivil(civilAddDays(series.startDate, shift));
  if (!first) return {};
  const newStart = zonedToUtc([first.year, first.month, first.day, wall.hour, wall.minute, wall.second, wall.millisecond], series.zone).getTime();
  const duration = !Number.isNaN(endMs) && endMs > startMs ? endMs - startMs : series.durationMs;
  return { start: new Date(newStart).toISOString(), end: new Date(newStart + duration).toISOString() };
};

/** Materia cambiata su una serie: la seguono le sue righe, nello stesso salvataggio. */
const subjectRewrites = (rows: readonly CalendarEvent[], subjectId: string | undefined, now: string) =>
  rows.filter((row) => row.subjectId !== subjectId).map((row) => ({ ...row, subjectId, updatedAt: now }));

const planAll = (event: CalendarEvent, series: Series, rows: readonly CalendarEvent[], date: string, patch: Partial<CalendarEvent>, options: PlanOptions): EditPlan => {
  const now = nowOf(options);
  const fields = { ...pickPatch(patch, SERIES_LOCKED), ...shiftedSeriesTimes(event, series, date, patch) };
  const next = applyRepeatFields({ ...event, ...fields, updatedAt: now }, { repeatChanged: changesRepeat(event, patch), timeZone: options.timeZone });
  const nextSeries = seriesOf(next);
  const deletes: string[] = [];
  const kept: CalendarEvent[] = [];
  for (const row of rows) {
    if (nextSeries && hasInstance(nextSeries, row.originalDate as string)) kept.push(row);
    else deletes.push(row.id);
  }
  return { puts: [next, ...(next.subjectId !== event.subjectId ? subjectRewrites(kept, next.subjectId, now) : [])], deletes };
};

/**
 * Piano di una modifica all'occorrenza `originalDate` della serie `series`:
 * - "this": riga `serie@giorno` (nuova o la stessa di prima) con la modifica; la materia è della
 *   serie, quindi un cambio di materia vale per la serie e tutte le sue righe;
 * - "following": divisione (vedi `planSplit`); dalla prima occorrenza è come "all";
 * - "all": la serie; inizio e fine si spostano come l'occorrenza toccata (stessi giorni di scarto,
 *   nuova ora); le righe che non sono più occorrenze si eliminano, le altre seguono la materia.
 * Giorno che non è un'occorrenza: piano vuoto.
 */
export const planEdit = (
  event: CalendarEvent,
  overrides: readonly CalendarEvent[],
  originalDate: string,
  scope: OccurrenceScope,
  patch: Partial<CalendarEvent>,
  options: PlanOptions = {}
): EditPlan => {
  const series = seriesOf(event);
  if (!series || !hasInstance(series, originalDate)) return EMPTY_PLAN;
  const rows = rowsOf(event, overrides);
  if (scope === "following") return planSplit(event, rows, originalDate, patch, options);
  if (scope === "all" || !series.rule) return planAll(event, series, rows, originalDate, patch, options);
  const now = nowOf(options);
  const existing = rows.find((row) => row.originalDate === originalDate);
  const base = existing ?? occurrenceSnapshot(event, series, originalDate, options);
  const row: CalendarEvent = { ...base, ...pickPatch(patch, OCCURRENCE_LOCKED), updatedAt: now };
  if (!("subjectId" in patch) || patch.subjectId === event.subjectId) return { puts: [row], deletes: [] };
  // Materia della serie: cambia la serie e tutte le righe, compresa questa.
  const subjectId = patch.subjectId;
  const seriesPut = { ...event, subjectId, updatedAt: now };
  const others = subjectRewrites(rows.filter((item) => item.id !== row.id), subjectId, now);
  return { puts: [seriesPut, ...others, { ...row, subjectId }], deletes: [] };
};

/** Regola della madre fermata prima del giorno `date`: conteggio = occorrenze prima, o "fino al" giorno prima. */
const truncatedRule = (rule: RepeatRule, startDate: string, date: string): RepeatRule => {
  const count = countOf(rule);
  if (count !== undefined) return { ...rule, end: { type: "count", count: Math.max(1, countBefore(rule, startDate, date)) } };
  return { ...rule, end: { type: "until", date: civilAddDays(date, -1) } };
};

/**
 * "Questa e le successive" dal giorno `originalDate`: la madre finisce prima, nasce una figlia
 * (`splitFrom`, `originalDate` = giorno della divisione, nessun `sourceUid`) con la modifica e le
 * occorrenze rimaste; le righe successive passano alla figlia (le modificate si perdono se cambia
 * l'ora, come in Google; le cancellate restano), quella del giorno stesso è sostituita dalla modifica.
 */
export const planSplit = (
  event: CalendarEvent,
  overrides: readonly CalendarEvent[],
  originalDate: string,
  patch: Partial<CalendarEvent> = {},
  options: PlanOptions = {}
): EditPlan => {
  const series = seriesOf(event);
  if (!series || !hasInstance(series, originalDate)) return EMPTY_PLAN;
  const rows = rowsOf(event, overrides);
  if (!series.rule || originalDate === series.startDate) return planAll(event, series, rows, originalDate, patch, options);
  const now = nowOf(options);
  const zone = series.zone ?? (series.civil ? undefined : isValidTimeZone(options.timeZone) ? options.timeZone : deviceTimeZone());
  const parent = applyRepeatFields(
    { ...event, repeat: truncatedRule(series.rule, series.startDate, originalDate), repeatLegacy: undefined, updatedAt: now },
    { repeatChanged: true, timeZone: zone }
  );
  const count = countOf(series.rule);
  const remaining = count !== undefined ? { ...series.rule, end: { type: "count" as const, count: Math.max(1, count - countBefore(series.rule, series.startDate, originalDate)) } } : series.rule;
  const childId = options.childId ?? `${event.id}~${originalDate}`;
  const base = withoutKeys(event, ["sourceUid", "sourceRecurrenceId", "seriesId", "cancelled", "repeatLegacy"]);
  // Regola della figlia: quella della modifica; se la modifica cambia solo i campi vecchi, la loro.
  const newRule = changesRepeat(event, patch);
  const legacyPatch = !newRule && changesLegacy(event, patch);
  const childRule = newRule
    ? patch.repeat
    : legacyPatch
      ? legacyRule({ recurrence: patch.recurrence ?? event.recurrence, recurrenceUntil: "recurrenceUntil" in patch ? patch.recurrenceUntil : event.recurrenceUntil }) ?? undefined
      : remaining;
  const child = applyRepeatFields(
    {
      ...base,
      ...instanceFields(series, originalDate),
      ...pickPatch(patch, SERIES_LOCKED),
      repeat: childRule,
      id: childId,
      splitFrom: event.id,
      originalDate,
      archived: false,
      links: options.recipient ? [] : event.links,
      createdAt: now,
      updatedAt: now
    },
    { repeatChanged: true, timeZone: zone }
  );
  const childSeries = seriesOf(child);
  const sameTime = childSeries !== null && childSeries.civil === series.civil && childSeries.wall.join() === series.wall.join() && childSeries.durationMs === series.durationMs;
  const puts: CalendarEvent[] = [parent, child];
  const deletes: string[] = [];
  for (const row of rows) {
    const date = row.originalDate as string;
    if (date < originalDate) continue;
    deletes.push(row.id);
    if (date === originalDate || !childSeries || !hasInstance(childSeries, date)) continue;
    if (!row.cancelled && !sameTime) continue;
    puts.push({ ...row, id: occurrenceId(childId, date), seriesId: childId, subjectId: child.subjectId, updatedAt: now });
  }
  return { puts, deletes };
};

/** Serie collegate da divisioni: la radice e tutte le figlie (stesso proprietario). */
const familyOf = (events: readonly CalendarEvent[], id: string) => {
  const byId = new Map(events.filter((item) => !isOccurrenceRow(item)).map((item) => [item.id, item]));
  let root = id;
  const seen = new Set<string>();
  while (!seen.has(root)) {
    seen.add(root);
    const parent = byId.get(root)?.splitFrom;
    if (typeof parent !== "string" || !byId.has(parent)) break;
    root = parent;
  }
  const family = new Set<string>([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of byId.values()) {
      if (typeof item.splitFrom === "string" && family.has(item.splitFrom) && !family.has(item.id)) {
        family.add(item.id);
        grew = true;
      }
    }
  }
  return family;
};

/** Figlie (e loro discendenti) che partono dal giorno `date` in poi. */
const childrenFrom = (events: readonly CalendarEvent[], id: string, date: string) => {
  const result = new Set<string>();
  const visit = (parentId: string) => {
    for (const item of events) {
      if (isOccurrenceRow(item) || item.splitFrom !== parentId || result.has(item.id)) continue;
      const cut = isCivilDate(item.originalDate) ? item.originalDate : typeof item.start === "string" ? item.start.slice(0, 10) : "";
      if (parentId === id && cut < date) continue;
      result.add(item.id);
      visit(item.id);
    }
  };
  visit(id);
  return result;
};

/**
 * Piano di un'eliminazione dall'occorrenza `originalDate` della serie `seriesId`:
 * - "this": riga cancellata `serie@giorno` (anche `archived`, così le app vecchie la saltano);
 *   per un evento che non si ripete, l'evento;
 * - "following": la serie finisce prima di quel giorno, le righe successive spariscono;
 * - "all": la serie e le sue righe.
 * `includeSplits`: anche le serie collegate da divisioni ("following": le figlie da quel giorno;
 * "all": tutta la famiglia, madre compresa) con le loro righe. Gli id da eliminare diventano
 * tombstone con la sincronizzazione.
 */
export const planDelete = (
  events: readonly CalendarEvent[],
  seriesId: string,
  originalDate: string,
  scope: OccurrenceScope,
  options: PlanOptions & { includeSplits?: boolean } = {}
): EditPlan => {
  const event = events.find((item) => item.id === seriesId && !isOccurrenceRow(item));
  if (!event) return EMPTY_PLAN;
  const series = seriesOf(event);
  if (!series || !hasInstance(series, originalDate)) return EMPTY_PLAN;
  const rows = rowsOf(event, events);
  const rowsOfIds = (ids: Set<string>) => events.filter((item) => isOccurrenceRow(item) && ids.has(item.seriesId as string)).map((item) => item.id);
  const wholeSeries = scope === "all" || !series.rule || (scope === "following" && originalDate === series.startDate);
  if (wholeSeries) {
    const ids = options.includeSplits && scope === "all" ? familyOf(events, seriesId) : new Set([seriesId]);
    if (options.includeSplits && scope !== "all") for (const id of childrenFrom(events, seriesId, originalDate)) ids.add(id);
    return { puts: [], deletes: [...ids, ...rowsOfIds(ids)] };
  }
  const now = nowOf(options);
  if (scope === "this") {
    const existing = rows.find((row) => row.originalDate === originalDate);
    const base = existing ?? occurrenceSnapshot(event, series, originalDate, options);
    return { puts: [{ ...base, cancelled: true, archived: true, updatedAt: now }], deletes: [] };
  }
  const zone = series.zone ?? (series.civil ? undefined : isValidTimeZone(options.timeZone) ? options.timeZone : deviceTimeZone());
  const parent = applyRepeatFields(
    { ...event, repeat: truncatedRule(series.rule as RepeatRule, series.startDate, originalDate), repeatLegacy: undefined, updatedAt: now },
    { repeatChanged: true, timeZone: zone }
  );
  const deletes = rows.filter((row) => (row.originalDate as string) >= originalDate).map((row) => row.id);
  if (options.includeSplits) {
    const ids = childrenFrom(events, seriesId, originalDate);
    deletes.push(...ids, ...rowsOfIds(ids));
  }
  return { puts: [parent], deletes };
};

/**
 * Lista dopo un piano: le righe del piano sostituiscono quelle con lo stesso id (le nuove vanno in
 * testa), le eliminate escono, tutte le altre restano lo stesso oggetto (il salvataggio confronta i
 * riferimenti). `removed`: id davvero tolti, per staccare allegati, note e promemoria.
 */
export const applyEditPlan = <T extends CalendarEvent>(events: readonly T[], plan: EditPlan): { events: T[]; removed: Set<string> } => {
  const puts = new Map(plan.puts.map((item) => [item.id, item as T]));
  const deletes = new Set(plan.deletes.filter((id) => !puts.has(id)));
  const removed = new Set<string>();
  const kept: T[] = [];
  for (const item of events) {
    if (deletes.has(item.id)) {
      removed.add(item.id);
      continue;
    }
    const put = puts.get(item.id);
    if (put) puts.delete(item.id);
    kept.push(put ?? item);
  }
  return { events: [...puts.values(), ...kept], removed };
};

type Linked = { linkedEntityType?: string; linkedEntityId?: string; updatedAt: string };

/** Allegati, note o promemoria collegati a eventi tolti: si staccano. Nessuno da staccare = stesso array. */
export const unlinkEvents = <T extends Linked>(items: T[], removed: ReadonlySet<string>, now: string): T[] => {
  const linked = (item: T) => item.linkedEntityType === "calendarEvent" && typeof item.linkedEntityId === "string" && removed.has(item.linkedEntityId);
  if (!removed.size || !items.some(linked)) return items;
  return items.map((item) => (linked(item) ? { ...item, linkedEntityType: undefined, linkedEntityId: undefined, updatedAt: now } : item));
};

// ---------------------------------------------------------------------------------------
// Ricorrenze e promemoria
// ---------------------------------------------------------------------------------------

/** Anni compiuti (o di anniversario) nel giorno `on`; null se l'anno non c'è o è dopo. */
export const ageOn = (birthYear: unknown, on: string | Date) => {
  if (!isIntIn(birthYear, 1, 9999)) return null;
  const year = typeof on === "string" ? parseCivil(on.slice(0, 10))?.year : on.getFullYear();
  if (year === undefined || Number.isNaN(year)) return null;
  const age = year - birthYear;
  return age >= 0 ? age : null;
};

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Promemoria validi (dati anche di altri): minuti 0–4 settimane, giorni 0–28, ora HH:mm. */
export const sanitizeReminders = (value: unknown): EventReminder[] => {
  if (!Array.isArray(value)) return [];
  const result: EventReminder[] = [];
  for (const item of value.slice(0, MAX_REMINDERS * 2)) {
    if (!isRecord(item)) continue;
    const minutes = item.minutesBefore;
    const days = item.daysBefore;
    const at = item.at;
    if (minutes !== undefined && !isIntIn(minutes, 0, 40_320)) continue;
    if (days !== undefined && !isIntIn(days, 0, 28)) continue;
    if (at !== undefined && !(typeof at === "string" && TIME.test(at))) continue;
    if (minutes === undefined && days === undefined && at === undefined) continue;
    result.push({ ...(minutes !== undefined ? { minutesBefore: minutes } : {}), ...(days !== undefined ? { daysBefore: days } : {}), ...(at !== undefined ? { at } : {}) });
    if (result.length >= MAX_REMINDERS) break;
  }
  return result;
};

const OCCASION_KINDS: readonly OccasionKind[] = ["birthday", "anniversary", "holiday", "recurring-day"];
const MAX_PERSON_LENGTH = 120;

/** Ricorrenza valida o niente: tipo noto, anno 1–9999, nome non vuoto (al più 120 caratteri). */
export const sanitizeOccasion = (value: unknown): EventOccasion | undefined => {
  if (!isRecord(value) || !OCCASION_KINDS.includes(value.kind as OccasionKind)) return undefined;
  const person = typeof value.person === "string" ? value.person.trim().slice(0, MAX_PERSON_LENGTH) : "";
  return {
    kind: value.kind as OccasionKind,
    ...(isIntIn(value.birthYear, 1, 9999) ? { birthYear: value.birthYear } : {}),
    ...(person ? { person } : {})
  };
};

/**
 * Istanti dei promemoria di un'occorrenza (o evento), in ordine, senza doppioni. Con `at` (HH:mm):
 * quel giorno (meno `daysBefore`) a quell'ora nel fuso dell'evento (assente = dispositivo); senza:
 * inizio meno giorni (da orologio) e minuti. I tutto il giorno partono dalla mezzanotte del giorno.
 */
export const reminderInstants = (
  item: Pick<CalendarEvent, "start"> & Partial<Pick<CalendarEvent, "end" | "allDay" | "timeZone" | "reminders">> & { occurrenceDate?: string },
  reminders: unknown = item.reminders
): Date[] => {
  const list = sanitizeReminders(reminders);
  if (!list.length) return [];
  const zone = zoneOf(item);
  const day = isCivilDate(item.occurrenceDate) ? item.occurrenceDate : civilOf(item.start, zone)?.date;
  const dayParts = parseCivil(day);
  if (!day || !dayParts) return [];
  const startMs = item.allDay === true ? zonedToUtc([dayParts.year, dayParts.month, dayParts.day], zone).getTime() : instantOf(item.start, zone);
  if (Number.isNaN(startMs)) return [];
  const startWall = utcToZonedParts(startMs, zone);
  const instants = new Set<number>();
  for (const reminder of list) {
    const days = reminder.daysBefore ?? 0;
    const target = parseCivil(civilAddDays(day, -days));
    if (!target) continue;
    let ms: number;
    if (reminder.at) {
      const [hour, minute] = reminder.at.split(":").map(Number);
      ms = zonedToUtc([target.year, target.month, target.day, hour, minute], zone).getTime() - (reminder.minutesBefore ?? 0) * 60_000;
    } else {
      const shifted = days ? zonedToUtc([target.year, target.month, target.day, startWall.hour, startWall.minute, startWall.second], zone).getTime() : startMs;
      ms = shifted - (reminder.minutesBefore ?? 0) * 60_000;
    }
    if (!Number.isNaN(ms)) instants.add(ms);
  }
  return [...instants].sort((a, b) => a - b).map((ms) => new Date(ms));
};

// ---------------------------------------------------------------------------------------
// Frasi in italiano
// ---------------------------------------------------------------------------------------

/** "il 12", "l'8", "l'11", "il 1°" */
const dayWithArticle = (day: number) => (day === 1 ? "il 1°" : day === 8 || day === 11 ? `l'${day}` : `il ${day}`);
/** "al 18", "all'8", "al 1°" */
const dayAfterAl = (day: number) => (day === 1 ? "al 1°" : day === 8 || day === 11 ? `all'${day}` : `al ${day}`);
const weekdayWithArticle = (day: Weekday) => `${day === "SU" ? "la" : "il"} ${WEEKDAY_NAME[day]}`;

const ordinalWeekday = (nth: number, day: Weekday) => {
  const feminine = day === "SU";
  const ordinal = (feminine ? REPEAT_TEXT.ordinalFeminine : REPEAT_TEXT.ordinalMasculine)[nth] ?? "";
  const article = nth === -1 ? "l'" : feminine ? "la " : "il ";
  return `${article}${ordinal} ${WEEKDAY_NAME[day]}`;
};

const every = (interval: number, one: string, many: (count: number) => string) => (interval === 1 ? one : many(interval));

/**
 * Frase della regola, es. "Ogni 2 settimane lun, mer, ven, fino al 18 dicembre". `startDate`
 * (YYYY-MM-DD) dà il giorno quando la regola lo prende dall'inizio dell'evento.
 */
export const describeRule = (rule: RepeatRule | null, startDate?: string) => {
  if (!rule) return REPEAT_TEXT.none;
  const interval = intervalOf(rule);
  const start = startDate ? parseCivil(startDate) : null;
  let text: string;
  if (rule.freq === "daily") text = every(interval, REPEAT_TEXT.daily, REPEAT_TEXT.everyDays);
  else if (rule.freq === "weekly") {
    const head = every(interval, REPEAT_TEXT.weekly, REPEAT_TEXT.everyWeeks);
    const days = rule.byWeekday ?? [];
    if (interval === 1 && days.length === 5 && ["MO", "TU", "WE", "TH", "FR"].every((day) => days.includes(day as Weekday))) text = REPEAT_TEXT.workdays;
    else if (days.length > 1) text = `${head} ${days.map((day) => WEEKDAY_SHORT[day]).join(", ")}`;
    else {
      const day = days[0] ?? (startDate && start ? WEEKDAY_BY_NUMBER[civilWeekday(startDate)] : undefined);
      text = day ? `${head} ${weekdayWithArticle(day)}` : head;
    }
  } else if (rule.freq === "monthly") {
    const head = every(interval, REPEAT_TEXT.monthly, REPEAT_TEXT.everyMonths);
    const monthly = rule.monthly ?? { by: "day" };
    if (monthly.by === "weekday") text = `${head} ${ordinalWeekday(monthly.nth, monthly.weekday)}`;
    else if (monthly.by === "lastDay") text = `${head} ${REPEAT_TEXT.lastDay}`;
    else if (!start) text = head;
    else text = `${head} ${dayWithArticle(start.day)}${monthly.by === "clampDay" && start.day > 28 ? ` ${REPEAT_TEXT.orLastDay}` : ""}`;
  } else {
    const head = every(interval, REPEAT_TEXT.yearly, REPEAT_TEXT.everyYears);
    if (!start) text = head;
    else {
      text = `${head} ${dayWithArticle(start.day)} ${MONTH_NAME[start.month - 1]}`;
      if (start.month === 2 && start.day === 29) {
        const leap = rule.yearlyLeap === "skip" ? REPEAT_TEXT.leapSkip : rule.yearlyLeap === "mar1" ? REPEAT_TEXT.leapMar1 : REPEAT_TEXT.leapFeb28;
        text += ` (${leap})`;
      }
    }
  }
  if (rule.end?.type === "until") {
    const until = parseCivil(rule.end.date);
    if (until) {
      const year = start && start.year === until.year ? "" : ` ${until.year}`;
      text += `, ${REPEAT_TEXT.until} ${dayAfterAl(until.day)} ${MONTH_NAME[until.month - 1]}${year}`;
    }
  } else if (rule.end?.type === "count") text += `, ${REPEAT_TEXT.times(rule.end.count)}`;
  return text;
};

/** Frase di un promemoria: "15 minuti prima", "1 giorno prima alle 9:00", "Il giorno stesso alle 8:00". */
export const describeReminder = (reminder: EventReminder) => {
  const [clean] = sanitizeReminders([reminder]);
  if (!clean) return "";
  if (clean.at) {
    const [hour, minute] = clean.at.split(":");
    const time = REMINDER_TEXT.at(`${Number(hour)}:${minute}`);
    const days = clean.daysBefore ?? 0;
    return days ? `${REMINDER_TEXT.daysBefore(days)} ${time}` : `${REMINDER_TEXT.sameDay} ${time}`;
  }
  const minutes = (clean.minutesBefore ?? 0) + (clean.daysBefore ?? 0) * 1440;
  if (!minutes) return REMINDER_TEXT.atStart;
  if (minutes % 1440 === 0) return REMINDER_TEXT.daysBefore(minutes / 1440);
  if (minutes % 60 === 0) return REMINDER_TEXT.hoursBefore(minutes / 60);
  return REMINDER_TEXT.minutesBefore(minutes);
};
