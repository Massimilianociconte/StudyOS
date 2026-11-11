// Import/export iCalendar (.ics, RFC 5545) per il calendario di StudyOS.
// - Export: eventi con la regola completa (RRULE), date escluse (EXDATE), occorrenze modificate
//   (RECURRENCE-ID), divisioni "questa e le successive" (una serie per parte), promemoria (VALARM)
//   e un VTIMEZONE per ogni fuso usato; esami e scadenze delle attività aperte.
// - Import: file di Google, Apple, Samsung e Outlook (anche con fusi Windows o inventati): serie,
//   date escluse e occorrenze modificate diventano le stesse righe che crea il motore delle
//   ripetizioni (lib/repeat.ts), e un secondo import dello stesso file non duplica nulla.
// Tutto puro: niente store, niente DOM. Lo store carica `mergeIcsImport` solo quando serve.
import type { CalendarEvent, EventCategory, EventReminder, Exam, RepeatRule, Subject, Task, Weekday } from "../types";
import {
  MAX_COUNT,
  MAX_INTERVAL,
  applyRepeatFields,
  countBefore,
  isOccurrenceRow,
  legacyProjection,
  normalizeRepeat,
  occurrenceId,
  reminderInstants,
  sanitizeReminders,
  validateRepeat
} from "./repeat";
import {
  civilAddDays,
  civilDateOf,
  civilDaysBetween,
  civilFromParts,
  civilWeekday,
  daysInMonth,
  deviceTimeZone,
  isCivilDate,
  isValidTimeZone,
  parseCivil,
  timeZoneOffset,
  utcToZonedParts,
  zonedToUtc
} from "./tz";
import { EVENT_CATEGORY_LABEL, ICS_TEXT } from "./labels";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_EVENTS = 2000;
const DEFAULT_COLOR = "#7CF7C8";
const WEEKDAY_BY_NUMBER: readonly Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_CODES = new Set<string>(WEEKDAY_BY_NUMBER);

const pad = (value: number, size = 2) => String(Math.abs(value)).padStart(size, "0");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isWeekday = (value: unknown): value is Weekday => typeof value === "string" && WEEKDAY_CODES.has(value);
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const timestamp = (value: unknown) => {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
};
const validZone = (zone: unknown) => (isValidTimeZone(zone) ? zone : undefined);
const deviceZone = () => validZone(deviceTimeZone()) ?? "UTC";
/** Fusi scritti come UTC puro (`…Z`), senza VTIMEZONE. */
const UTC_ZONES = new Set(["UTC", "Etc/UTC", "GMT", "Etc/GMT", "Etc/Universal", "Etc/Zulu", "Universal", "Zulu"]);

// ---------------------------------------------------------------------------------------
// Testo
// ---------------------------------------------------------------------------------------

export const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export const unescapeText = (value: string) => value.replace(/\\([\\;,nN])/g, (_match, char: string) => (char === "n" || char === "N" ? "\n" : char));

/** Piega le righe a 75 ottetti (RFC 5545 §3.1) senza spezzare caratteri multibyte. */
export const foldLine = (line: string) => {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let bytes = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    const limit = parts.length ? 74 : 75; // le righe di continuazione iniziano con uno spazio
    if (bytes + size > limit) {
      parts.push(current);
      current = "";
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
};

const utcStamp = (ms: number) => {
  const date = new Date(ms);
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
};
const civilStamp = (date: string) => date.replace(/-/g, "");
const civilAt = (date: string, wall: readonly number[], zone: string) => {
  const parts = parseCivil(date);
  return parts ? zonedToUtc([parts.year, parts.month, parts.day, wall[0] ?? 0, wall[1] ?? 0, wall[2] ?? 0], zone).getTime() : Number.NaN;
};

// ---------------------------------------------------------------------------------------
// RRULE <-> regola del motore
// ---------------------------------------------------------------------------------------

export interface RRuleContext {
  /** Giorno d'inizio della serie (YYYY-MM-DD) nel suo fuso. */
  startDate: string;
  allDay: boolean;
  /** Fuso della serie (assente = dispositivo): serve per UNTIL in UTC. */
  zone?: string;
  /** Ora d'inizio da orologio [ore, minuti, secondi] (solo con orario). */
  wall?: readonly number[];
}

const FREQ_OUT = { daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" } as const;
const FREQ_IN: Record<string, RepeatRule["freq"]> = { DAILY: "daily", WEEKLY: "weekly", MONTHLY: "monthly", YEARLY: "yearly" };

/** "Fino al" compreso: data per i tutto il giorno, fine di quel giorno nel fuso (in UTC) con orario. */
const untilValue = (date: string, ctx: RRuleContext) => (ctx.allDay ? civilStamp(date) : utcStamp(civilAt(date, [23, 59, 59], ctx.zone ?? deviceZone())));

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

/** RRULE della regola (senza "RRULE:"), nell'ordine FREQ, INTERVAL, BY…, COUNT/UNTIL, WKST. */
export const toRRule = (rule: RepeatRule, ctx: RRuleContext) => {
  const parts: string[] = [`FREQ=${FREQ_OUT[rule.freq]}`];
  if (rule.interval && rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  const start = parseCivil(ctx.startDate);
  if (rule.freq === "weekly" && rule.byWeekday?.length) parts.push(`BYDAY=${rule.byWeekday.join(",")}`);
  if (rule.freq === "monthly" && rule.monthly) {
    const monthly = rule.monthly;
    if (monthly.by === "lastDay") parts.push("BYMONTHDAY=-1");
    else if (monthly.by === "weekday") parts.push(`BYDAY=${monthly.nth}${monthly.weekday}`);
    // Regola vecchia "quel giorno o l'ultimo del mese": dal 28 al giorno, l'ultimo che esiste.
    else if (monthly.by === "clampDay" && start && start.day > 28) parts.push(`BYMONTHDAY=${range(28, start.day).join(",")}`, "BYSETPOS=-1");
  }
  if (rule.freq === "yearly" && start?.month === 2 && start.day === 29) {
    if (rule.yearlyLeap === "mar1") parts.push("BYYEARDAY=60");
    else if (rule.yearlyLeap !== "skip") parts.push("BYMONTH=2", "BYMONTHDAY=-1");
  }
  if (rule.end?.type === "count") parts.push(`COUNT=${rule.end.count}`);
  else if (rule.end?.type === "until") parts.push(`UNTIL=${untilValue(rule.end.date, ctx)}`);
  if (rule.wkst && rule.wkst !== "MO") parts.push(`WKST=${rule.wkst}`);
  return parts.join(";");
};

/**
 * Giorno compreso di un UNTIL nel fuso della serie: se l'occorrenza di quel giorno inizierebbe dopo
 * UNTIL, l'ultimo giorno è quello prima.
 */
const untilDate = (value: string, ctx: RRuleContext) => {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/.exec(value);
  if (!match) return undefined;
  const date = civilFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
  if (!isCivilDate(date)) return undefined;
  if (match[4] === undefined) return date;
  let wallDate = date;
  let seconds = Number(match[4]) * 3600 + Number(match[5]) * 60 + Number(match[6] ?? 0);
  if (match[7]) {
    const parts = utcToZonedParts(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)), ctx.zone);
    wallDate = civilFromParts(parts.year, parts.month, parts.day);
    seconds = parts.hour * 3600 + parts.minute * 60 + parts.second;
  }
  const wall = ctx.allDay ? [0, 0, 0] : ctx.wall ?? [0, 0, 0];
  const startSeconds = (wall[0] ?? 0) * 3600 + (wall[1] ?? 0) * 60 + (wall[2] ?? 0);
  return startSeconds > seconds ? civilAddDays(wallDate, -1) : wallDate;
};

const BYDAY_TOKEN = /^([+-]?\d{1,2})?(MO|TU|WE|TH|FR|SA|SU)$/;

export interface RRuleImport {
  /** Regola valida per il motore, o null se la ripetizione non si può seguire (solo la prima data). */
  rule: RepeatRule | null;
  /** Parti del testo non seguite o semplificate, nell'ordine del file. */
  unsupported: string[];
}

/**
 * Regola del motore da una RRULE (RFC 5545). Le parti che il motore non sa seguire si elencano in
 * `unsupported` e la regola originale resta in `sourceRRule` (si riesporta così com'è). Il
 * risultato passa sempre `validateRepeat`: anche un file strano non rompe il calendario.
 */
export const fromRRule = (value: string, ctx: RRuleContext): RRuleImport => {
  const source = value.trim();
  if (!source) return { rule: null, unsupported: [] };
  const parts = source
    .split(";")
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const split = text.indexOf("=");
      return { text, key: (split < 0 ? text : text.slice(0, split)).trim().toUpperCase(), value: split < 0 ? "" : text.slice(split + 1).trim().toUpperCase(), ok: false };
    });
  const get = (key: string) => parts.find((part) => part.key === key);
  const freqPart = get("FREQ");
  const freq = freqPart ? FREQ_IN[freqPart.value] : undefined;
  if (!freqPart || !freq) return { rule: null, unsupported: freqPart ? [freqPart.text] : [source] };
  freqPart.ok = true;
  const rule: RepeatRule = { freq };

  const intervalPart = get("INTERVAL");
  if (intervalPart) {
    const interval = /^\d+$/.test(intervalPart.value) ? Number(intervalPart.value) : Number.NaN;
    if (interval > MAX_INTERVAL) return { rule: null, unsupported: [intervalPart.text] };
    if (interval >= 1) {
      intervalPart.ok = true;
      if (interval > 1) rule.interval = interval;
    }
  }
  const untilPart = get("UNTIL");
  if (untilPart) {
    const date = untilDate(untilPart.value, ctx);
    if (date) {
      rule.end = { type: "until", date };
      untilPart.ok = true;
    }
  }
  const countPart = get("COUNT");
  if (countPart && !rule.end) {
    const count = /^\d+$/.test(countPart.value) ? Number(countPart.value) : Number.NaN;
    if (count >= 1) {
      rule.end = { type: "count", count: Math.min(count, MAX_COUNT) };
      countPart.ok = count <= MAX_COUNT;
    }
  }
  const wkstPart = get("WKST");
  if (wkstPart && isWeekday(wkstPart.value)) {
    wkstPart.ok = true;
    if (freq === "weekly" && wkstPart.value !== "MO") rule.wkst = wkstPart.value;
  }

  const start = parseCivil(ctx.startDate);
  const byDay = get("BYDAY");
  const tokens = byDay ? byDay.value.split(",").map((token) => BYDAY_TOKEN.exec(token.trim())) : [];
  const valid = tokens.filter((token): token is RegExpExecArray => token !== null);
  const plain = valid.filter((token) => token[1] === undefined).map((token) => token[2] as Weekday);
  const cleanPlain = byDay !== undefined && valid.length === tokens.length && plain.length === tokens.length && plain.length > 0;
  const bySetPos = get("BYSETPOS");
  const byMonthDay = get("BYMONTHDAY");
  const byMonth = get("BYMONTH");
  const byYearDay = get("BYYEARDAY");
  const others = (...keys: string[]) => parts.some((part) => part.key.startsWith("BY") && !keys.includes(part.key));

  if (freq === "daily" && byDay && cleanPlain && !rule.interval) {
    // Giorni feriali scritti come DAILY;BYDAY: una serie settimanale su quei giorni.
    rule.freq = "weekly";
    rule.byWeekday = [...new Set(plain)];
    byDay.ok = true;
  } else if (freq === "weekly" && byDay && plain.length) {
    rule.byWeekday = [...new Set(plain)];
    byDay.ok = cleanPlain;
  } else if (freq === "monthly" && start) {
    if (byDay && !byMonthDay && valid.length === 1 && tokens.length === 1) {
      const [, ordinal, weekday] = valid[0];
      const nth = ordinal !== undefined ? Number(ordinal) : bySetPos && /^-?\d+$/.test(bySetPos.value) ? Number(bySetPos.value) : Number.NaN;
      const fromSetPos = ordinal === undefined;
      if ((nth === -1 || (nth >= 1 && nth <= 4)) && (fromSetPos ? bySetPos !== undefined : bySetPos === undefined)) {
        rule.monthly = { by: "weekday", nth: nth as 1 | 2 | 3 | 4 | -1, weekday: weekday as Weekday };
        byDay.ok = true;
        if (bySetPos) bySetPos.ok = true;
      }
    } else if (byMonthDay && !byDay) {
      const days = byMonthDay.value.split(",").map((day) => day.trim());
      if (days.length === 1 && days[0] === "-1" && !bySetPos) {
        rule.monthly = { by: "lastDay" };
        byMonthDay.ok = true;
      } else if (days.length === 1 && Number(days[0]) === start.day && !bySetPos) {
        byMonthDay.ok = true;
      } else if (start.day > 28 && bySetPos?.value === "-1" && days.join(",") === range(28, start.day).join(",")) {
        rule.monthly = { by: "clampDay" };
        byMonthDay.ok = true;
        bySetPos.ok = true;
      }
    }
  } else if (freq === "yearly" && start) {
    const leapDay = start.month === 2 && start.day === 29;
    if (leapDay) {
      if (byMonth?.value === "2" && byMonthDay?.value === "-1" && !byYearDay && !byDay) {
        rule.yearlyLeap = "feb28";
        byMonth.ok = true;
        byMonthDay.ok = true;
      } else if (byYearDay?.value === "60" && !byMonth && !byMonthDay && !byDay) {
        rule.yearlyLeap = "mar1";
        byYearDay.ok = true;
      } else {
        rule.yearlyLeap = "skip";
        if (byMonth?.value === "2") byMonth.ok = true;
        if (byMonthDay?.value === "29") byMonthDay.ok = true;
      }
    } else if (!byDay && !byYearDay && !others("BYMONTH", "BYMONTHDAY")) {
      if (byMonth && Number(byMonth.value) === start.month) byMonth.ok = true;
      if (byMonthDay && Number(byMonthDay.value) === start.day) byMonthDay.ok = true;
    }
  }

  const unsupported = parts.filter((part) => !part.ok).map((part) => part.text);
  if (unsupported.length && source.length <= 1000) rule.sourceRRule = source;
  const checked = validateRepeat(rule);
  return checked.ok ? { rule: checked.rule, unsupported } : { rule: null, unsupported: parts.map((part) => part.text) };
};

/** Impronta del significato di una regola (non della forma): due regole equivalenti hanno la stessa. */
const ruleKey = (rule: RepeatRule | null, startDate: string) => {
  if (!rule) return "none";
  const day = parseCivil(startDate)?.day ?? 1;
  const weekday = isCivilDate(startDate) ? WEEKDAY_BY_NUMBER[civilWeekday(startDate)] : undefined;
  const byWeekday = rule.freq === "weekly" && rule.byWeekday?.length && !(rule.byWeekday.length === 1 && rule.byWeekday[0] === weekday) ? rule.byWeekday : null;
  const monthly = rule.freq === "monthly" && rule.monthly && rule.monthly.by !== "day" && !(rule.monthly.by === "clampDay" && day <= 28) ? rule.monthly : null;
  const leap = rule.freq === "yearly" && startDate.slice(5) === "02-29" && rule.yearlyLeap && rule.yearlyLeap !== "feb28" ? rule.yearlyLeap : null;
  const end = rule.end && rule.end.type !== "never" ? rule.end : null;
  return JSON.stringify([
    rule.freq,
    rule.interval ?? 1,
    byWeekday,
    monthly ? [monthly.by, monthly.by === "weekday" ? monthly.nth : 0, monthly.by === "weekday" ? monthly.weekday : ""] : null,
    leap,
    end ? [end.type, end.type === "until" ? end.date : end.type === "count" ? end.count : 0] : null,
    rule.freq === "weekly" && rule.wkst && rule.wkst !== "MO" ? rule.wkst : null
  ]);
};

const endKey = (rule: RepeatRule) => JSON.stringify(rule.end && rule.end.type !== "never" ? rule.end : null);

/**
 * Prima `date` (esclusa) come la ferma il motore quando una figlia parte da lì: con un conteggio le
 * occorrenze prima della figlia, altrimenti fino al giorno prima (copia di `truncatedRule`).
 */
const truncatedRule = (rule: RepeatRule, startDate: string, date: string): RepeatRule => {
  if (rule.end?.type === "count" && date > startDate) {
    const before = Math.max(1, countBefore(rule, startDate, date));
    return before === rule.end.count ? rule : { ...rule, end: { type: "count", count: before } };
  }
  if (rule.end?.type === "until" && rule.end.date < date) return rule;
  return { ...rule, end: { type: "until", date: civilAddDays(date, -1) } };
};

/** Il giorno è un'occorrenza della regola (prima del taglio `cut`)? */
const isInstanceOf = (rule: RepeatRule | null, startDate: string, date: string, cut?: string) => {
  if (!isCivilDate(date) || (cut !== undefined && date >= cut)) return false;
  if (!rule) return date === startDate;
  if (date < startDate) return false;
  return countBefore(rule, startDate, civilAddDays(date, 1)) > countBefore(rule, startDate, date);
};

// ---------------------------------------------------------------------------------------
// Inizio, fine e fuso di un evento salvato (come lo legge il motore)
// ---------------------------------------------------------------------------------------

const FLOATING = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/;

const instantIn = (value: unknown, zone: string) => {
  if (typeof value !== "string") return Number.NaN;
  const floating = FLOATING.exec(value);
  if (floating) {
    const civil = parseCivil(floating[1]);
    if (!civil) return Number.NaN;
    return zonedToUtc([civil.year, civil.month, civil.day, Number(floating[2] ?? 0), Number(floating[3] ?? 0), Number(floating[4] ?? 0)], zone).getTime();
  }
  return Date.parse(value);
};

const civilIn = (value: unknown, zone: string): { date: string; midnight: boolean } | null => {
  if (typeof value !== "string") return null;
  const floating = FLOATING.exec(value);
  if (floating) {
    if (!isCivilDate(floating[1])) return null;
    return { date: floating[1], midnight: !Number(floating[2] ?? 0) && !Number(floating[3] ?? 0) && !Number(floating[4] ?? 0) && !Number(floating[5] ?? 0) };
  }
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return null;
  const parts = utcToZonedParts(ms, zone);
  return { date: civilFromParts(parts.year, parts.month, parts.day), midnight: !parts.hour && !parts.minute && !parts.second && !parts.millisecond };
};

/** Giorno della mezzanotte più vicina all'istante nel fuso (a pari distanza il giorno prima), come il motore. */
const nearestMidnightDate = (ms: number, zone: string) => {
  const parts = utcToZonedParts(ms, zone);
  const date = civilFromParts(parts.year, parts.month, parts.day);
  if (!parts.hour && !parts.minute && !parts.second && !parts.millisecond) return date;
  const next = civilAddDays(date, 1);
  return civilAt(next, [0, 0, 0], zone) - ms < ms - civilAt(date, [0, 0, 0], zone) ? next : date;
};

interface Timing {
  allDay: boolean;
  /** Fuso dell'evento, o quello predefinito se non ne ha uno valido. */
  zone: string;
  startDate: string;
  /** Tutto il giorno: primo giorno dopo la fine (esclusivo). */
  endDate: string;
  wall: [number, number, number];
  startMs: number;
  endMs: number;
}

type TimingFields = Partial<Pick<CalendarEvent, "start" | "end" | "allDay" | "timeZone">>;

/**
 * Inizio e fine come li mostra il motore: tutto il giorno fluttuante o a mezzanotte = quel giorno;
 * vecchi istanti di mezzanotte di un altro fuso = giorno della mezzanotte più vicina, durata in giorni.
 */
const timingOf = (event: TimingFields, fallbackZone: string): Timing | null => {
  const zone = validZone(event.timeZone) ?? fallbackZone;
  if (event.allDay === true) {
    const start = civilIn(event.start, zone);
    if (!start) return null;
    const floatingStart = typeof event.start === "string" && FLOATING.test(event.start);
    let startDate = start.date;
    let endDate: string;
    if (!floatingStart && !start.midnight) {
      const startMs = Date.parse(event.start as string);
      const endMs = instantIn(event.end, zone);
      const days = !Number.isNaN(endMs) && endMs > startMs ? Math.round((endMs - startMs) / DAY_MS) : 1;
      startDate = nearestMidnightDate(startMs, zone);
      endDate = civilAddDays(startDate, Math.max(1, days));
    } else {
      const end = civilIn(event.end, zone);
      endDate = end ? (end.midnight ? end.date : civilAddDays(end.date, 1)) : civilAddDays(startDate, 1);
      if (endDate <= startDate) endDate = civilAddDays(startDate, 1);
    }
    return { allDay: true, zone, startDate, endDate, wall: [0, 0, 0], startMs: civilAt(startDate, [0, 0, 0], zone), endMs: civilAt(endDate, [0, 0, 0], zone) };
  }
  const startMs = instantIn(event.start, zone);
  if (Number.isNaN(startMs)) return null;
  const rawEnd = instantIn(event.end, zone);
  const endMs = !Number.isNaN(rawEnd) && rawEnd > startMs ? rawEnd : startMs + HOUR_MS;
  const parts = utcToZonedParts(startMs, zone);
  const startDate = civilFromParts(parts.year, parts.month, parts.day);
  return { allDay: false, zone, startDate, endDate: startDate, wall: [parts.hour, parts.minute, parts.second], startMs, endMs };
};

const sameTiming = (a: Timing | null, b: Timing | null) =>
  a !== null && b !== null && a.allDay === b.allDay && (a.allDay ? a.startDate === b.startDate && a.endDate === b.endDate : a.startMs === b.startMs && a.endMs === b.endMs);

const isShared = (event: unknown) => isRecord(event) && isRecord(event.sharedFrom);

const parentIdOf = (event: CalendarEvent) => (typeof event.splitFrom === "string" && event.splitFrom && event.splitFrom !== event.id ? event.splitFrom : undefined);

/** Giorno da cui ogni serie si ferma per le divisioni (copia di `splitCuts` del motore, un solo proprietario). */
const splitCutsOf = (masters: readonly CalendarEvent[], fallbackZone: string) => {
  const byId = new Map(masters.map((event) => [event.id, event]));
  const children = new Map<string, CalendarEvent[]>();
  for (const event of masters) {
    const parentId = parentIdOf(event);
    if (!parentId) continue;
    const list = children.get(parentId);
    if (list) list.push(event);
    else children.set(parentId, [event]);
  }
  const first = new Map<string, string>();
  const nextSibling = new Map<string, string>();
  for (const [parentId, list] of children) {
    const parentZone = validZone(byId.get(parentId)?.timeZone);
    const ordered = list
      .flatMap((child) => {
        const date = isCivilDate(child.originalDate) ? child.originalDate : civilIn(child.start, parentZone ?? validZone(child.timeZone) ?? fallbackZone)?.date;
        return date ? [{ child, date }] : [];
      })
      .sort((a, b) => compareText(a.date, b.date) || timestamp(a.child.updatedAt) - timestamp(b.child.updatedAt) || compareText(a.child.id, b.child.id));
    if (ordered.length) first.set(parentId, ordered[0].date);
    for (let index = 0; index + 1 < ordered.length; index += 1) nextSibling.set(ordered[index].child.id, ordered[index + 1].date);
  }
  const earlier = (a: string | undefined, b: string | undefined) => (a === undefined ? b : b === undefined || a <= b ? a : b);
  const bounds = new Map<string, string | undefined>();
  const boundOf = (id: string): string | undefined => {
    if (bounds.has(id)) return bounds.get(id);
    bounds.set(id, undefined);
    const event = byId.get(id);
    const parentId = event ? parentIdOf(event) : undefined;
    const bound = earlier(nextSibling.get(id), parentId && byId.has(parentId) ? boundOf(parentId) : undefined);
    bounds.set(id, bound);
    return bound;
  };
  const cuts = new Map<string, string>();
  for (const id of byId.keys()) {
    const cut = earlier(first.get(id), boundOf(id));
    if (cut !== undefined) cuts.set(id, cut);
  }
  return cuts;
};

// ---------------------------------------------------------------------------------------
// Fusi: nomi Windows e VTIMEZONE
// ---------------------------------------------------------------------------------------

/** Nomi dei fusi di Windows (Outlook, Exchange) -> fuso IANA principale (CLDR windowsZones, territorio 001). */
export const WINDOWS_ZONES: Readonly<Record<string, string>> = {
  "Dateline Standard Time": "Etc/GMT+12",
  "UTC-11": "Etc/GMT+11",
  "Aleutian Standard Time": "America/Adak",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Marquesas Standard Time": "Pacific/Marquesas",
  "Alaskan Standard Time": "America/Anchorage",
  "UTC-09": "Etc/GMT+9",
  "Pacific Standard Time (Mexico)": "America/Tijuana",
  "UTC-08": "Etc/GMT+8",
  "Pacific Standard Time": "America/Los_Angeles",
  "US Mountain Standard Time": "America/Phoenix",
  "Mountain Standard Time (Mexico)": "America/Mazatlan",
  "Mountain Standard Time": "America/Denver",
  "Yukon Standard Time": "America/Whitehorse",
  "Central America Standard Time": "America/Guatemala",
  "Central Standard Time": "America/Chicago",
  "Easter Island Standard Time": "Pacific/Easter",
  "Central Standard Time (Mexico)": "America/Mexico_City",
  "Mexico Standard Time": "America/Mexico_City",
  "Canada Central Standard Time": "America/Regina",
  "SA Pacific Standard Time": "America/Bogota",
  "Eastern Standard Time (Mexico)": "America/Cancun",
  "Eastern Standard Time": "America/New_York",
  "Haiti Standard Time": "America/Port-au-Prince",
  "Cuba Standard Time": "America/Havana",
  "US Eastern Standard Time": "America/Indiana/Indianapolis",
  "Turks And Caicos Standard Time": "America/Grand_Turk",
  "Paraguay Standard Time": "America/Asuncion",
  "Atlantic Standard Time": "America/Halifax",
  "Venezuela Standard Time": "America/Caracas",
  "Central Brazilian Standard Time": "America/Cuiaba",
  "SA Western Standard Time": "America/La_Paz",
  "Pacific SA Standard Time": "America/Santiago",
  "Newfoundland Standard Time": "America/St_Johns",
  "Tocantins Standard Time": "America/Araguaina",
  "E. South America Standard Time": "America/Sao_Paulo",
  "SA Eastern Standard Time": "America/Cayenne",
  "Argentina Standard Time": "America/Argentina/Buenos_Aires",
  "Greenland Standard Time": "America/Godthab",
  "Montevideo Standard Time": "America/Montevideo",
  "Magallanes Standard Time": "America/Punta_Arenas",
  "Saint Pierre Standard Time": "America/Miquelon",
  "Bahia Standard Time": "America/Bahia",
  "UTC-02": "Etc/GMT+2",
  "Mid-Atlantic Standard Time": "Etc/GMT+2",
  "Azores Standard Time": "Atlantic/Azores",
  "Cape Verde Standard Time": "Atlantic/Cape_Verde",
  UTC: "UTC",
  "GMT Standard Time": "Europe/London",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "Sao Tome Standard Time": "Africa/Sao_Tome",
  "Morocco Standard Time": "Africa/Casablanca",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "W. Central Africa Standard Time": "Africa/Lagos",
  "Jordan Standard Time": "Asia/Amman",
  "GTB Standard Time": "Europe/Bucharest",
  "Middle East Standard Time": "Asia/Beirut",
  "Egypt Standard Time": "Africa/Cairo",
  "E. Europe Standard Time": "Europe/Chisinau",
  "Syria Standard Time": "Asia/Damascus",
  "West Bank Standard Time": "Asia/Hebron",
  "South Africa Standard Time": "Africa/Johannesburg",
  "FLE Standard Time": "Europe/Kiev",
  "Israel Standard Time": "Asia/Jerusalem",
  "South Sudan Standard Time": "Africa/Juba",
  "Kaliningrad Standard Time": "Europe/Kaliningrad",
  "Sudan Standard Time": "Africa/Khartoum",
  "Libya Standard Time": "Africa/Tripoli",
  "Namibia Standard Time": "Africa/Windhoek",
  "Arabic Standard Time": "Asia/Baghdad",
  "Turkey Standard Time": "Europe/Istanbul",
  "Arab Standard Time": "Asia/Riyadh",
  "Belarus Standard Time": "Europe/Minsk",
  "Russian Standard Time": "Europe/Moscow",
  "E. Africa Standard Time": "Africa/Nairobi",
  "Volgograd Standard Time": "Europe/Volgograd",
  "Iran Standard Time": "Asia/Tehran",
  "Arabian Standard Time": "Asia/Dubai",
  "Astrakhan Standard Time": "Europe/Astrakhan",
  "Azerbaijan Standard Time": "Asia/Baku",
  "Russia Time Zone 3": "Europe/Samara",
  "Mauritius Standard Time": "Indian/Mauritius",
  "Saratov Standard Time": "Europe/Saratov",
  "Georgian Standard Time": "Asia/Tbilisi",
  "Caucasus Standard Time": "Asia/Yerevan",
  "Afghanistan Standard Time": "Asia/Kabul",
  "West Asia Standard Time": "Asia/Tashkent",
  "Qyzylorda Standard Time": "Asia/Qyzylorda",
  "Ekaterinburg Standard Time": "Asia/Yekaterinburg",
  "Pakistan Standard Time": "Asia/Karachi",
  "India Standard Time": "Asia/Kolkata",
  "Sri Lanka Standard Time": "Asia/Colombo",
  "Nepal Standard Time": "Asia/Kathmandu",
  "Central Asia Standard Time": "Asia/Bishkek",
  "Bangladesh Standard Time": "Asia/Dhaka",
  "Omsk Standard Time": "Asia/Omsk",
  "Myanmar Standard Time": "Asia/Yangon",
  "SE Asia Standard Time": "Asia/Bangkok",
  "Altai Standard Time": "Asia/Barnaul",
  "W. Mongolia Standard Time": "Asia/Hovd",
  "North Asia Standard Time": "Asia/Krasnoyarsk",
  "N. Central Asia Standard Time": "Asia/Novosibirsk",
  "Tomsk Standard Time": "Asia/Tomsk",
  "China Standard Time": "Asia/Shanghai",
  "North Asia East Standard Time": "Asia/Irkutsk",
  "Singapore Standard Time": "Asia/Singapore",
  "Malay Peninsula Standard Time": "Asia/Singapore",
  "W. Australia Standard Time": "Australia/Perth",
  "Taipei Standard Time": "Asia/Taipei",
  "Ulaanbaatar Standard Time": "Asia/Ulaanbaatar",
  "Aus Central W. Standard Time": "Australia/Eucla",
  "Transbaikal Standard Time": "Asia/Chita",
  "Tokyo Standard Time": "Asia/Tokyo",
  "North Korea Standard Time": "Asia/Pyongyang",
  "Korea Standard Time": "Asia/Seoul",
  "Yakutsk Standard Time": "Asia/Yakutsk",
  "Cen. Australia Standard Time": "Australia/Adelaide",
  "AUS Central Standard Time": "Australia/Darwin",
  "E. Australia Standard Time": "Australia/Brisbane",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "West Pacific Standard Time": "Pacific/Port_Moresby",
  "Tasmania Standard Time": "Australia/Hobart",
  "Vladivostok Standard Time": "Asia/Vladivostok",
  "Lord Howe Standard Time": "Australia/Lord_Howe",
  "Bougainville Standard Time": "Pacific/Bougainville",
  "Russia Time Zone 10": "Asia/Srednekolymsk",
  "Magadan Standard Time": "Asia/Magadan",
  "Norfolk Standard Time": "Pacific/Norfolk",
  "Sakhalin Standard Time": "Asia/Sakhalin",
  "Central Pacific Standard Time": "Pacific/Guadalcanal",
  "Russia Time Zone 11": "Asia/Kamchatka",
  "Kamchatka Standard Time": "Asia/Kamchatka",
  "New Zealand Standard Time": "Pacific/Auckland",
  "UTC+12": "Etc/GMT-12",
  "Fiji Standard Time": "Pacific/Fiji",
  "Chatham Islands Standard Time": "Pacific/Chatham",
  "UTC+13": "Etc/GMT-13",
  "Tonga Standard Time": "Pacific/Tongatapu",
  "Samoa Standard Time": "Pacific/Apia",
  "Line Islands Standard Time": "Pacific/Kiritimati"
};

const offsetText = (ms: number) => {
  const total = Math.round(ms / 1000);
  const abs = Math.abs(total);
  const seconds = abs % 60;
  return `${total < 0 ? "-" : "+"}${pad(Math.floor(abs / 3600))}${pad(Math.floor((abs % 3600) / 60))}${seconds ? pad(seconds) : ""}`;
};

interface Transition {
  ms: number;
  from: number;
  to: number;
}

/** Cambi d'ora del fuso tra l'inizio di `fromYear` e la fine di `toYear`, al secondo (da Intl). */
const transitionsOf = (zone: string, fromYear: number, toYear: number): Transition[] => {
  const out: Transition[] = [];
  const end = Date.UTC(toYear + 1, 0, 1);
  let t = Date.UTC(fromYear, 0, 1);
  let previous = timeZoneOffset(t, zone);
  while (t < end && out.length < 1000) {
    const next = Math.min(t + 7 * DAY_MS, end);
    const offset = timeZoneOffset(next, zone);
    if (offset === previous) {
      t = next;
      continue;
    }
    let lo = t;
    let hi = next;
    while (hi - lo > 1000) {
      const mid = Math.max(lo + 1000, Math.floor((lo + hi) / 2000) * 1000);
      if (timeZoneOffset(mid, zone) === previous) lo = mid;
      else hi = mid;
    }
    const to = timeZoneOffset(hi, zone);
    out.push({ ms: hi, from: previous, to });
    t = hi;
    previous = to;
  }
  return out;
};

/**
 * VTIMEZONE del fuso IANA per gli anni dati, dalle regole di Intl: gli anni con lo stesso cambio
 * (mese, n-esimo giorno della settimana, ora) diventano una regola annuale; quando le regole
 * cambiano, la regola vecchia ha UNTIL; un fuso senza cambi ha un solo STANDARD.
 */
export const buildVTimezone = (zone: string, fromYear: number, toYear: number): string[] => {
  const lines = ["BEGIN:VTIMEZONE", `TZID:${zone}`, `X-LIC-LOCATION:${zone}`];
  const transitions = transitionsOf(zone, fromYear, toYear);
  if (!transitions.length) {
    const offset = offsetText(timeZoneOffset(Date.UTC(fromYear, 0, 1), zone));
    lines.push("BEGIN:STANDARD", `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`, "DTSTART:19700101T000000", "END:STANDARD", "END:VTIMEZONE");
    return lines;
  }
  const described = transitions.map((transition) => {
    const local = new Date(transition.ms + transition.from);
    const year = local.getUTCFullYear();
    const month = local.getUTCMonth() + 1;
    const day = local.getUTCDate();
    const nth = day + 7 > daysInMonth(year, month) ? -1 : Math.ceil(day / 7);
    const time = `${pad(local.getUTCHours())}${pad(local.getUTCMinutes())}${pad(local.getUTCSeconds())}`;
    const kind = transition.to > transition.from ? "DAYLIGHT" : "STANDARD";
    return {
      ...transition,
      kind,
      year,
      month,
      byDay: `${nth}${WEEKDAY_BY_NUMBER[local.getUTCDay()]}`,
      local: `${pad(year, 4)}${pad(month)}${pad(day)}T${time}`,
      key: `${kind}|${month}|${nth}${local.getUTCDay()}|${time}|${transition.from}|${transition.to}`
    };
  });
  type Item = (typeof described)[number];
  // Gruppi di anni consecutivi con lo stesso cambio, per tipo.
  const runs: Item[][] = [];
  const open = new Map<string, Item[]>();
  for (const item of described) {
    const current = open.get(item.kind);
    if (current && current[current.length - 1].key === item.key && current[current.length - 1].year === item.year - 1) current.push(item);
    else {
      const run = [item];
      runs.push(run);
      open.set(item.kind, run);
    }
  }
  const lastYear = described[described.length - 1].year;
  const lastRun = new Map<string, Item[]>();
  for (const run of runs) lastRun.set(run[0].kind, run);
  for (const run of runs) {
    const head = run[0];
    const tail = run[run.length - 1];
    const ongoing = lastRun.get(head.kind) === run && tail.year === lastYear && lastYear === toYear;
    lines.push(`BEGIN:${head.kind}`, `TZOFFSETFROM:${offsetText(head.from)}`, `TZOFFSETTO:${offsetText(head.to)}`, `DTSTART:${head.local}`);
    if (ongoing) lines.push(`RRULE:FREQ=YEARLY;BYMONTH=${head.month};BYDAY=${head.byDay}`);
    else if (run.length > 1) lines.push(`RRULE:FREQ=YEARLY;BYMONTH=${head.month};BYDAY=${head.byDay};UNTIL=${utcStamp(tail.ms)}`);
    lines.push(`END:${head.kind}`);
  }
  lines.push("END:VTIMEZONE");
  return lines;
};

// --- Lettura di un VTIMEZONE (anche con nomi inventati): scarto in ogni istante ---

interface Property {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface Component {
  name: string;
  props: Property[];
  children: Component[];
}

const unfold = (text: string) => text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n[ \t]/g, "");

const parseProperty = (line: string): Property | null => {
  // Il primo ":" fuori dalle virgolette separa nome e parametri dal valore.
  let quoted = false;
  let split = -1;
  const cuts: number[] = [];
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === ";") cuts.push(index);
    else if (!quoted && char === ":") {
      split = index;
      break;
    }
  }
  if (split < 0) return null;
  const bounds = [-1, ...cuts, split];
  const segments = bounds.slice(0, -1).map((start, index) => line.slice(start + 1, bounds[index + 1]));
  const params: Record<string, string> = {};
  for (const segment of segments.slice(1)) {
    const eq = segment.indexOf("=");
    if (eq > 0) params[segment.slice(0, eq).trim().toUpperCase()] = segment.slice(eq + 1).trim().replace(/^"(.*)"$/, "$1");
  }
  return { name: segments[0].trim().toUpperCase(), params, value: line.slice(split + 1) };
};

/** Albero dei blocchi BEGIN/END del testo (righe piegate già unite). */
const parseComponents = (text: string): Component[] => {
  const root: Component = { name: "", props: [], children: [] };
  const stack: Component[] = [root];
  for (const raw of unfold(text).split("\n")) {
    const line = raw.trimEnd();
    if (!line) continue;
    const property = parseProperty(line);
    if (!property) continue;
    const top = stack[stack.length - 1];
    if (property.name === "BEGIN") {
      if (stack.length > 8) continue;
      const component: Component = { name: property.value.trim().toUpperCase(), props: [], children: [] };
      top.children.push(component);
      stack.push(component);
    } else if (property.name === "END") {
      const name = property.value.trim().toUpperCase();
      const index = stack.map((component) => component.name).lastIndexOf(name);
      if (index > 0) stack.length = index;
    } else top.props.push(property);
  }
  return root.children;
};

const propOf = (component: Component, name: string) => component.props.find((property) => property.name === name);
const propsOf = (component: Component, name: string) => component.props.filter((property) => property.name === name);

const parseOffset = (value: string | undefined) => {
  const match = /^([+-])(\d{2})(\d{2})(\d{2})?$/.exec((value ?? "").trim());
  if (!match) return null;
  const ms = (Number(match[2]) * 3600 + Number(match[3]) * 60 + Number(match[4] ?? 0)) * 1000;
  return match[1] === "-" ? -ms : ms;
};

const LOCAL_STAMP = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?/;

interface Observance {
  from: number;
  to: number;
  local: number[];
  /** Inizio (UTC) della prima volta. */
  firstMs: number;
  rule?: { month: number; nth?: number; weekday?: number; monthDay?: number; untilMs?: number };
  extra: number[];
}

const observancesOf = (component: Component): Observance[] => {
  const out: Observance[] = [];
  for (const child of component.children) {
    if (child.name !== "STANDARD" && child.name !== "DAYLIGHT") continue;
    const from = parseOffset(propOf(child, "TZOFFSETFROM")?.value);
    const to = parseOffset(propOf(child, "TZOFFSETTO")?.value);
    const start = LOCAL_STAMP.exec(propOf(child, "DTSTART")?.value.trim() ?? "");
    if (from === null || to === null || !start) continue;
    const local = start.slice(1, 7).map((part) => Number(part ?? 0));
    const firstMs = Date.UTC(local[0], local[1] - 1, local[2], local[3], local[4], local[5]) - from;
    const observance: Observance = { from, to, local, firstMs, extra: [] };
    const rrule = propOf(child, "RRULE")?.value;
    if (rrule) {
      const parts = Object.fromEntries(
        rrule.split(";").map((part) => {
          const eq = part.indexOf("=");
          return [part.slice(0, eq).trim().toUpperCase(), part.slice(eq + 1).trim().toUpperCase()];
        })
      );
      if (parts.FREQ === "YEARLY") {
        const month = parts.BYMONTH ? Number(parts.BYMONTH) : local[1];
        const byDay = parts.BYDAY ? /^([+-]?\d)?(MO|TU|WE|TH|FR|SA|SU)$/.exec(parts.BYDAY) : null;
        const until = parts.UNTIL ? /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(parts.UNTIL) : null;
        const untilMs = until
          ? Date.UTC(Number(until[1]), Number(until[2]) - 1, Number(until[3]), Number(until[4] ?? 23), Number(until[5] ?? 59), Number(until[6] ?? 59)) - (until[7] ? 0 : from)
          : undefined;
        if (month >= 1 && month <= 12) {
          observance.rule = {
            month,
            ...(byDay ? { nth: byDay[1] ? Number(byDay[1]) : 1, weekday: WEEKDAY_BY_NUMBER.indexOf(byDay[2] as Weekday) } : {}),
            ...(!byDay && parts.BYMONTHDAY ? { monthDay: Number(parts.BYMONTHDAY) } : {}),
            ...(untilMs !== undefined ? { untilMs } : {})
          };
        }
      }
    }
    for (const rdate of propsOf(child, "RDATE")) {
      for (const value of rdate.value.split(",")) {
        const match = LOCAL_STAMP.exec(value.trim());
        if (match) observance.extra.push(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)) - from);
      }
    }
    out.push(observance);
  }
  return out;
};

/** Inizio (UTC) dell'osservanza nell'anno, se la sua regola ne ha uno. */
const onsetIn = (observance: Observance, year: number) => {
  const rule = observance.rule;
  if (!rule || year < observance.local[0]) return null;
  const last = daysInMonth(year, rule.month);
  let day: number;
  if (rule.weekday !== undefined && rule.weekday >= 0) {
    const nth = rule.nth ?? 1;
    if (nth < 0) {
      const lastWeekday = civilWeekday(civilFromParts(year, rule.month, last));
      day = last - ((lastWeekday - rule.weekday + 7) % 7) + 7 * (nth + 1);
    } else {
      const firstWeekday = civilWeekday(civilFromParts(year, rule.month, 1));
      day = 1 + ((rule.weekday - firstWeekday + 7) % 7) + 7 * (nth - 1);
    }
  } else if (rule.monthDay !== undefined) day = rule.monthDay < 0 ? last + 1 + rule.monthDay : rule.monthDay;
  else day = observance.local[2];
  if (day < 1 || day > last) return null;
  const ms = Date.UTC(year, rule.month - 1, day, observance.local[3], observance.local[4], observance.local[5]) - observance.from;
  if (ms < observance.firstMs || (rule.untilMs !== undefined && ms > rule.untilMs)) return null;
  return ms;
};

/** Ultimo inizio dell'osservanza non dopo `t`. */
const latestOnset = (observance: Observance, t: number) => {
  let best: number | null = observance.firstMs <= t ? observance.firstMs : null;
  for (const ms of observance.extra) if (ms <= t && (best === null || ms > best)) best = ms;
  if (observance.rule) {
    let year = new Date(t).getUTCFullYear() + 1;
    if (observance.rule.untilMs !== undefined) year = Math.min(year, new Date(observance.rule.untilMs).getUTCFullYear());
    for (let step = 0; step < 4 && year >= observance.local[0]; step += 1, year -= 1) {
      const ms = onsetIn(observance, year);
      if (ms !== null && ms <= t) {
        if (best === null || ms > best) best = ms;
        break;
      }
    }
  }
  return best;
};

/** Scarto (ms) del VTIMEZONE in ogni istante: quello dell'ultima osservanza iniziata (null se non si sa). */
const zoneRules = (component: Component) => {
  const observances = observancesOf(component);
  const offsetAt = (t: number): number | null => {
    let best: { ms: number; to: number } | null = null;
    for (const observance of observances) {
      const ms = latestOnset(observance, t);
      if (ms !== null && (best === null || ms > best.ms)) best = { ms, to: observance.to };
    }
    if (best) return best.to;
    const first = [...observances].sort((a, b) => a.firstMs - b.firstMs)[0];
    return first ? first.from : null;
  };
  const onsets = (year: number) => observances.flatMap((observance) => [onsetIn(observance, year), ...observance.extra.filter((ms) => new Date(ms).getUTCFullYear() === year)]).filter((ms): ms is number => ms !== null);
  return { offsetAt, onsets, empty: observances.length === 0 };
};

/** Lettore di un VTIMEZONE (righe o testo): scarto in ms in ogni istante. */
export const vtimezoneOffsets = (source: readonly string[] | string) => {
  const text = typeof source === "string" ? source : source.join("\r\n");
  const component = parseComponents(text).find((item) => item.name === "VTIMEZONE") ?? { name: "VTIMEZONE", props: [], children: [] };
  return zoneRules(component).offsetAt;
};

// ---------------------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------------------

export interface IcsExportInput {
  events: readonly CalendarEvent[];
  exams: readonly Exam[];
  tasks: readonly Task[];
  subjects: readonly Pick<Subject, "id" | "name">[];
  categoryLabel?: (category: EventCategory) => string;
  now?: Date;
  /** Fuso per gli eventi che non ne hanno uno (predefinito: quello del dispositivo). */
  timeZone?: string;
}

const formatDuration = (sign: number, days: number, minutes: number) => {
  if (!days && !minutes) return "PT0S";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const time = minutes ? `T${hours ? `${hours}H` : ""}${rest ? `${rest}M` : ""}` : "";
  return `${sign < 0 ? "-" : ""}P${days ? `${days}D` : ""}${time}`;
};

const signedMinutes = (minutes: number) => formatDuration(minutes < 0 ? -1 : 1, 0, Math.abs(minutes));

/** TRIGGER relativo all'inizio per un promemoria. */
const triggerOf = (reminder: EventReminder, timing: Timing) => {
  const days = reminder.daysBefore ?? 0;
  const minutes = reminder.minutesBefore ?? 0;
  if (!reminder.at) return formatDuration(-1, days, minutes);
  const [hour, minute] = reminder.at.split(":").map(Number);
  const startMinutes = timing.allDay ? 0 : timing.wall[0] * 60 + timing.wall[1];
  return signedMinutes(-days * 1440 + hour * 60 + minute - startMinutes - minutes);
};

export const buildIcs = ({ events, exams, tasks, subjects, categoryLabel, now = new Date(), timeZone }: IcsExportInput) => {
  const exportZone = validZone(timeZone) ?? deviceZone();
  const stamp = utcStamp(now.getTime());
  const label = categoryLabel ?? ((category: EventCategory) => EVENT_CATEGORY_LABEL[category] ?? category);
  const subjectName = (id?: string) => subjects.find((subject) => subject.id === id)?.name;
  const zoneYears = new Map<string, { min: number; max: number }>();
  const body: string[] = [];

  const useZone = (zone: string, ms: number) => {
    const year = utcToZonedParts(ms, zone).year;
    const known = zoneYears.get(zone);
    zoneYears.set(zone, known ? { min: Math.min(known.min, year), max: Math.max(known.max, year) } : { min: year, max: year });
  };
  /** DTSTART/DTEND, RECURRENCE-ID, EXDATE: stesso tipo di valore e TZID dell'inizio della serie. */
  const dateLine = (name: string, timing: Timing, values: readonly { date: string; ms: number }[]) => {
    if (timing.allDay) return `${name};VALUE=DATE:${values.map((value) => civilStamp(value.date)).join(",")}`;
    if (UTC_ZONES.has(timing.zone)) return `${name}:${values.map((value) => utcStamp(value.ms)).join(",")}`;
    values.forEach((value) => useZone(timing.zone, value.ms));
    return `${name};TZID=${timing.zone}:${values
      .map((value) => {
        const parts = utcToZonedParts(value.ms, timing.zone);
        return `${pad(parts.year, 4)}${pad(parts.month)}${pad(parts.day)}T${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}`;
      })
      .join(",")}`;
  };
  const instant = (timing: Timing, date: string) => ({ date, ms: timing.allDay ? civilAt(date, [0, 0, 0], timing.zone) : civilAt(date, timing.wall, timing.zone) });
  const startEnd = (timing: Timing) => [
    dateLine("DTSTART", timing, [{ date: timing.startDate, ms: timing.startMs }]),
    dateLine("DTEND", timing, [{ date: timing.endDate, ms: timing.endMs }])
  ];
  const content = (event: CalendarEvent, timing: Timing) => {
    const lines = [`SUMMARY:${escapeText(String(event.title ?? ""))}`];
    const description = [event.description, event.notes].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n\n");
    if (description) lines.push(`DESCRIPTION:${escapeText(description)}`);
    const categories = [event.category ? label(event.category) : "", subjectName(event.subjectId) ?? ""].filter(Boolean);
    if (categories.length) lines.push(`CATEGORIES:${categories.map((value) => escapeText(String(value))).join(",")}`);
    if (event.status === "skipped") lines.push("STATUS:CANCELLED");
    for (const reminder of sanitizeReminders(event.reminders)) {
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${escapeText(String(event.title ?? ""))}`, `TRIGGER:${triggerOf(reminder, timing)}`, "END:VALARM");
    }
    return lines;
  };
  const vevent = (uid: string, lines: readonly string[]) => body.push("BEGIN:VEVENT", `UID:${uid}`, `DTSTAMP:${stamp}`, ...lines, "END:VEVENT");

  /** RRULE della serie: quella importata così com'è se la regola non è cambiata (con la fine attuale). */
  const rruleOf = (rule: RepeatRule, timing: Timing) => {
    const ctx: RRuleContext = { startDate: timing.startDate, allDay: timing.allDay, zone: timing.zone, wall: timing.wall };
    const source = rule.sourceRRule;
    if (source) {
      const parsed = fromRRule(source, ctx).rule;
      const strip = (value: RepeatRule): RepeatRule => ({ ...value, end: undefined, sourceRRule: undefined });
      if (parsed && ruleKey(strip(parsed), timing.startDate) === ruleKey(strip(rule), timing.startDate)) {
        if (endKey(parsed) === endKey(rule)) return source;
        const kept = source.split(";").filter((part) => part.trim() && !/^\s*(UNTIL|COUNT)\s*=/i.test(part));
        const end = rule.end?.type === "count" ? `COUNT=${rule.end.count}` : rule.end?.type === "until" ? `UNTIL=${untilValue(rule.end.date, ctx)}` : "";
        return [...kept, ...(end ? [end] : [])].join(";");
      }
    }
    return toRRule(rule, ctx);
  };

  // Solo i propri eventi: quelli di altri (condivisi) non sono nostri da esportare.
  const own = events.filter((event) => isRecord(event) && !isShared(event));
  const masters = own.filter((event) => !isOccurrenceRow(event) && !event.archived);
  const rowsBySeries = new Map<string, Map<string, CalendarEvent>>();
  for (const row of own) {
    if (!isOccurrenceRow(row) || !isCivilDate(row.originalDate)) continue;
    const byDate = rowsBySeries.get(row.seriesId as string) ?? new Map<string, CalendarEvent>();
    const existing = byDate.get(row.originalDate);
    if (!existing || timestamp(row.updatedAt) >= timestamp(existing.updatedAt)) byDate.set(row.originalDate, row);
    rowsBySeries.set(row.seriesId as string, byDate);
  }
  const cuts = splitCutsOf(masters, exportZone);

  for (const event of masters) {
    const timing = timingOf(event, exportZone);
    if (!timing) continue;
    const uid = typeof event.sourceUid === "string" && event.sourceUid ? event.sourceUid : `${event.id}@studyos`;
    const cut = cuts.get(event.id);
    if (cut !== undefined && cut <= timing.startDate) continue;
    let rule = normalizeRepeat(event);
    if (rule && cut !== undefined) rule = truncatedRule(rule, timing.startDate, cut);
    const rows = rowsBySeries.get(event.id);
    if (!rule) {
      // Evento singolo: una riga sul suo giorno lo cancella o lo sostituisce.
      const row = rows?.get(timing.startDate);
      if (row && (row.cancelled || row.archived)) continue;
      const shown = row ?? event;
      const shownTiming = row ? timingOf(row, timing.zone) : timing;
      if (!shownTiming) continue;
      vevent(uid, [...startEnd(shownTiming), ...content(shown, shownTiming)]);
      continue;
    }
    const exdates: string[] = [];
    const overrides: [string, CalendarEvent][] = [];
    for (const [date, row] of rows ?? []) {
      if (!isInstanceOf(rule, timing.startDate, date)) continue;
      if (row.cancelled || row.archived) exdates.push(date);
      else overrides.push([date, row]);
    }
    exdates.sort();
    vevent(uid, [
      ...startEnd(timing),
      `RRULE:${rruleOf(rule, timing)}`,
      ...(exdates.length ? [dateLine("EXDATE", timing, exdates.map((date) => instant(timing, date)))] : []),
      ...content(event, timing)
    ]);
    for (const [date, row] of overrides.sort((a, b) => compareText(a[0], b[0]))) {
      const rowTiming = timingOf(row, timing.zone);
      if (!rowTiming) continue;
      vevent(uid, [dateLine("RECURRENCE-ID", timing, [instant(timing, date)]), ...startEnd(rowTiming), ...content(row, rowTiming)]);
    }
  }

  for (const exam of exams) {
    if (!isRecord(exam) || exam.archived) continue;
    const startMs = Date.parse(exam.date);
    if (Number.isNaN(startMs)) continue;
    const parts = utcToZonedParts(startMs, exportZone);
    const timing: Timing = {
      allDay: false,
      zone: exportZone,
      startDate: civilFromParts(parts.year, parts.month, parts.day),
      endDate: "",
      wall: [parts.hour, parts.minute, parts.second],
      startMs,
      endMs: startMs + 2 * HOUR_MS
    };
    vevent(`${exam.id}@studyos`, [...startEnd(timing), `SUMMARY:${escapeText(ICS_TEXT.examTitle(subjectName(exam.subjectId) ?? ICS_TEXT.examFallback))}`, `CATEGORIES:${ICS_TEXT.examCategory}`]);
  }

  for (const task of tasks) {
    if (!isRecord(task) || !task.dueDate || task.status === "done" || task.status === "archived") continue;
    const dueMs = Date.parse(task.dueDate);
    if (Number.isNaN(dueMs)) continue;
    // Il giorno che l'app mostra: quello del dispositivo (le attività non hanno un fuso).
    const date = civilDateOf(dueMs);
    vevent(`${task.id}@studyos`, [
      `DTSTART;VALUE=DATE:${civilStamp(date)}`,
      `DTEND;VALUE=DATE:${civilStamp(civilAddDays(date, 1))}`,
      `SUMMARY:${escapeText(ICS_TEXT.taskTitle(task.title))}`,
      "TRANSP:TRANSPARENT",
      `CATEGORIES:${ICS_TEXT.taskCategory}`
    ]);
  }

  // Un VTIMEZONE per ogni fuso usato, per gli anni degli eventi (le regole aperte valgono anche dopo).
  const nowYear = now.getUTCFullYear();
  const zones: string[] = [];
  for (const [zone, years] of [...zoneYears].sort((a, b) => compareText(a[0], b[0]))) {
    const toYear = Math.max(years.max, nowYear) + 1;
    const fromYear = Math.max(years.min - 1, toYear - 60);
    zones.push(...buildVTimezone(zone, fromYear, toYear));
  }

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//StudyOS//Calendario//IT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${ICS_TEXT.calendarName}`,
    `X-WR-TIMEZONE:${exportZone}`,
    ...zones,
    ...body,
    "END:VCALENDAR"
  ];
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
};

// ---------------------------------------------------------------------------------------
// Import: lettura del file
// ---------------------------------------------------------------------------------------

export interface IcsImportedEvent {
  uid?: string;
  /** RECURRENCE-ID: "YYYYMMDD" (giorno) o istante UTC "YYYYMMDDTHHMMSSZ" (uguale su ogni dispositivo). */
  recurrenceId?: string;
  title: string;
  description: string;
  location?: string;
  /** Valori di CATEGORIES (tipo di evento, materia). */
  categories?: string[];
  /** Con orario: istante ISO (UTC). Tutto il giorno: "YYYY-MM-DDT00:00:00" (stesso giorno in ogni fuso). */
  start: string;
  end: string;
  allDay: boolean;
  /** Fuso IANA dell'evento (solo con orario). */
  timeZone?: string;
  repeat?: RepeatRule;
  /** Proiezione per le app vecchie (e per le anteprime semplici). */
  recurrence: NonNullable<CalendarEvent["recurrence"]>;
  recurrenceUntil?: string;
  /** Parti della RRULE non seguite (solo per gli avvisi). */
  unsupported?: string[];
  /** Date escluse, nello stesso formato di `recurrenceId`. */
  exdates?: string[];
  /** Promemoria del file; assente = il file non ne ha (non si cancellano quelli che ci sono). */
  reminders?: EventReminder[];
  /** Occorrenza annullata (RECURRENCE-ID con STATUS:CANCELLED). */
  cancelled?: true;
}

export interface IcsParseResult {
  events: IcsImportedEvent[];
  /** Avvisi in italiano semplice (regole semplificate, fusi sconosciuti, eventi scartati). */
  warnings: string[];
}

export interface IcsParseOptions {
  /** Fuso da usare per le ore senza fuso e per i fusi sconosciuti (predefinito: dispositivo). */
  timeZone?: string;
}

type DateValue = { type: "date"; date: string } | { type: "time"; ms: number; zone: string; floating: boolean; utc: boolean };

const DATE_ONLY = /^(\d{4})(\d{2})(\d{2})$/;
const DATE_TIME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/i;

const parseDuration = (value: string) => {
  const text = value.trim().toUpperCase();
  const match = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(text);
  if (!match || text.endsWith("P") || text.endsWith("T")) return null;
  return {
    sign: match[1] === "-" ? -1 : 1,
    days: Number(match[2] ?? 0) * 7 + Number(match[3] ?? 0),
    seconds: Number(match[4] ?? 0) * 3600 + Number(match[5] ?? 0) * 60 + Number(match[6] ?? 0)
  };
};

const hhmm = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** Promemoria di un tutto il giorno da uno scarto (minuti, negativo = prima) dalla mezzanotte d'inizio. */
const allDayReminder = (offset: number): EventReminder | null => {
  if (offset === 0) return { minutesBefore: 0 };
  if (offset < 0) {
    if (-offset % 1440 === 0) return { daysBefore: -offset / 1440 };
    const daysBefore = Math.ceil(-offset / 1440);
    return { daysBefore, at: hhmm(offset + daysBefore * 1440) };
  }
  return offset < 1440 ? { at: hhmm(offset) } : null;
};

export const parseIcs = (text: string, options: IcsParseOptions = {}): IcsParseResult => {
  const events: IcsImportedEvent[] = [];
  if (typeof text !== "string" || !/BEGIN:VCALENDAR/i.test(text)) return { events, warnings: [ICS_TEXT.notCalendar] };
  const fallbackZone = validZone(options.timeZone) ?? deviceZone();
  const warnings: string[] = [];
  const unknownZones = new Set<string>();
  const simplified = new Map<string, { parts: string[]; titles: string[] }>();
  const firstOnly = new Map<string, { parts: string[]; titles: string[] }>();
  const multiple: string[] = [];
  let extraDates = false;
  let thisAndFuture = false;
  let skipped = 0;
  let todos = 0;
  let tooMany = false;

  for (const calendar of parseComponents(text.replace(/^\uFEFF/, "")).filter((component) => component.name === "VCALENDAR")) {
    const vtimezones = new Map(calendar.children.filter((child) => child.name === "VTIMEZONE").map((child) => [propOf(child, "TZID")?.value.trim().replace(/^"(.*)"$/, "$1") ?? "", child]));
    const plainZone = (name: string | undefined) => {
      const clean = (name ?? "").trim().replace(/^"(.*)"$/, "$1");
      if (!clean) return undefined;
      return validZone(clean) ?? validZone(WINDOWS_ZONES[clean]);
    };
    const calendarZone = plainZone(propOf(calendar, "X-WR-TIMEZONE")?.value);
    const defaultZone = calendarZone ?? fallbackZone;
    const resolved = new Map<string, string>();

    /** Fuso IANA di un TZID: IANA, Windows, percorso (…/Europe/Rome), X-LIC-LOCATION, regole del VTIMEZONE. */
    const resolveZone = (tzid: string, year: number) => {
      const known = resolved.get(tzid);
      if (known) return known;
      let zone = plainZone(tzid);
      if (!zone) {
        const path = /([A-Za-z_]+\/[A-Za-z_+\-0-9]+(?:\/[A-Za-z_+\-0-9]+)?)$/.exec(tzid);
        const segments = path ? path[1].split("/") : [];
        zone = validZone(segments.join("/")) ?? validZone(segments.slice(-2).join("/"));
      }
      const definition = vtimezones.get(tzid);
      if (!zone && definition) zone = plainZone(propOf(definition, "X-LIC-LOCATION")?.value);
      if (!zone && definition) {
        // Nome inventato (es. "Ora dell'Europa centrale"): il primo fuso con gli stessi scarti.
        const rules = zoneRules(definition);
        if (!rules.empty) {
          const samples = [Date.UTC(year, 0, 15, 12), Date.UTC(year, 6, 15, 12), ...rules.onsets(year).flatMap((ms) => [ms - HOUR_MS, ms + HOUR_MS])];
          const candidates = [...new Set([calendarZone, fallbackZone, ...Object.values(WINDOWS_ZONES)].filter((item): item is string => Boolean(item && isValidTimeZone(item))))];
          zone = candidates.find((candidate) => samples.every((ms) => rules.offsetAt(ms) === timeZoneOffset(ms, candidate)));
        }
      }
      if (!zone) {
        unknownZones.add(tzid);
        zone = defaultZone;
      }
      resolved.set(tzid, zone);
      return zone;
    };

    /** Valore di una data del file. `zoneHint`: fuso per le ore senza fuso (quello dell'inizio). */
    const readDate = (property: Property, value = property.value.trim(), zoneHint?: string): DateValue | null => {
      const dateOnly = DATE_ONLY.exec(value);
      if (dateOnly || property.params.VALUE?.toUpperCase() === "DATE") {
        const match = dateOnly ?? /^(\d{4})(\d{2})(\d{2})/.exec(value);
        if (!match) return null;
        const date = civilFromParts(Number(match[1]), Number(match[2]), Number(match[3]));
        return isCivilDate(date) ? { type: "date", date } : null;
      }
      const match = DATE_TIME.exec(value);
      if (!match) return null;
      const fields = [1, 2, 3, 4, 5, 6].map((index) => Number(match[index] ?? 0));
      if (!isCivilDate(civilFromParts(fields[0], fields[1], fields[2]))) return null;
      if (match[7]) return { type: "time", ms: Date.UTC(fields[0], fields[1] - 1, fields[2], fields[3], fields[4], fields[5]), zone: "UTC", floating: false, utc: true };
      const tzid = property.params.TZID?.trim();
      const zone = tzid ? resolveZone(tzid, fields[0]) : zoneHint ?? defaultZone;
      return { type: "time", ms: zonedToUtc(fields, zone).getTime(), zone, floating: !tzid, utc: false };
    };

    /** RECURRENCE-ID ed EXDATE in forma unica: giorno o istante UTC. */
    const canonical = (value: DateValue) => (value.type === "date" ? civilStamp(value.date) : utcStamp(value.ms));

    const vevents = calendar.children.filter((child) => child.name === "VEVENT");
    todos += calendar.children.filter((child) => child.name === "VTODO").length;
    for (const vevent of vevents) {
      if (events.length >= MAX_EVENTS) {
        tooMany = true;
        break;
      }
      const startProp = propOf(vevent, "DTSTART");
      const startValue = startProp ? readDate(startProp) : null;
      if (!startProp || !startValue) {
        skipped += 1;
        continue;
      }
      const ridProp = propOf(vevent, "RECURRENCE-ID");
      const cancelled = propOf(vevent, "STATUS")?.value.trim().toUpperCase() === "CANCELLED";
      if (cancelled && !ridProp) continue;
      const rrules = ridProp ? [] : propsOf(vevent, "RRULE");
      const recurring = rrules.length > 0;
      const title = unescapeText(propOf(vevent, "SUMMARY")?.value ?? "").trim() || ICS_TEXT.untitled;

      // Fuso dell'evento: quello dell'inizio; per le ore in UTC di una serie, quello del calendario.
      const zone = startValue.type === "date" ? defaultZone : startValue.utc ? (recurring ? calendarZone ?? "UTC" : calendarZone ?? fallbackZone) : startValue.zone;
      const wallOf = (ms: number) => utcToZonedParts(ms, zone);
      const endProp = propOf(vevent, "DTEND");
      const endValue = endProp ? readDate(endProp, undefined, zone) : null;
      const duration = propOf(vevent, "DURATION") ? parseDuration(propOf(vevent, "DURATION")!.value) : null;

      // Tutto il giorno: VALUE=DATE, o Outlook (X-MICROSOFT-CDO-ALLDAYEVENT) a mezzanotte.
      let allDay = startValue.type === "date";
      let startDate = startValue.type === "date" ? startValue.date : "";
      if (!allDay && startValue.type === "time" && propOf(vevent, "X-MICROSOFT-CDO-ALLDAYEVENT")?.value.trim().toUpperCase() === "TRUE") {
        const wall = wallOf(startValue.ms);
        if (!wall.hour && !wall.minute && !wall.second) {
          allDay = true;
          startDate = civilFromParts(wall.year, wall.month, wall.day);
        }
      }

      let start: string;
      let end: string;
      let startMs = Number.NaN;
      let endMs = Number.NaN;
      let wall: [number, number, number] = [0, 0, 0];
      if (allDay) {
        let endDate = "";
        if (endValue?.type === "date") endDate = endValue.date;
        else if (endValue?.type === "time") {
          const parts = wallOf(endValue.ms);
          endDate = civilFromParts(parts.year, parts.month, parts.day);
          if (parts.hour || parts.minute || parts.second) endDate = civilAddDays(endDate, 1);
        } else if (duration && duration.sign > 0) endDate = civilAddDays(startDate, duration.days + Math.ceil(duration.seconds / 86_400));
        if (!endDate || endDate <= startDate) endDate = civilAddDays(startDate, 1);
        start = `${startDate}T00:00:00`;
        end = `${endDate}T00:00:00`;
        startMs = civilAt(startDate, [0, 0, 0], zone);
        endMs = civilAt(endDate, [0, 0, 0], zone);
      } else {
        startMs = (startValue as Extract<DateValue, { type: "time" }>).ms;
        const parts = wallOf(startMs);
        startDate = civilFromParts(parts.year, parts.month, parts.day);
        wall = [parts.hour, parts.minute, parts.second];
        if (endValue?.type === "time") endMs = endValue.ms;
        else if (endValue?.type === "date") endMs = civilAt(endValue.date, [0, 0, 0], zone);
        else if (duration && duration.sign > 0) {
          const shifted = duration.days ? civilAt(civilAddDays(startDate, duration.days), wall, zone) : startMs;
          endMs = shifted + duration.seconds * 1000;
        }
        if (!(endMs > startMs)) endMs = startMs + HOUR_MS;
        start = new Date(startMs).toISOString();
        end = new Date(endMs).toISOString();
      }

      const location = unescapeText(propOf(vevent, "LOCATION")?.value ?? "").trim();
      const descriptionText = unescapeText(propOf(vevent, "DESCRIPTION")?.value ?? "").trim();
      const description = [descriptionText, location && !descriptionText.includes(ICS_TEXT.location(location)) ? ICS_TEXT.location(location) : ""].filter(Boolean).join("\n\n");
      const categories = propsOf(vevent, "CATEGORIES")
        .flatMap((property) => property.value.split(/(?<!\\),/))
        .map((value) => unescapeText(value).trim())
        .filter(Boolean);

      const event: IcsImportedEvent = {
        uid: propOf(vevent, "UID")?.value.trim() || undefined,
        title,
        description,
        ...(location ? { location } : {}),
        ...(categories.length ? { categories } : {}),
        start,
        end,
        allDay,
        ...(allDay ? {} : { timeZone: zone }),
        recurrence: "none"
      };

      if (ridProp) {
        const rid = readDate(ridProp, undefined, zone);
        if (!rid) {
          skipped += 1;
          continue;
        }
        event.recurrenceId = canonical(rid);
        if (ridProp.params.RANGE?.toUpperCase() === "THISANDFUTURE") thisAndFuture = true;
        if (cancelled) event.cancelled = true;
      }

      if (recurring) {
        if (rrules.length > 1) multiple.push(title);
        const ctx: RRuleContext = { startDate, allDay, zone, wall };
        const { rule, unsupported } = fromRRule(rrules[0].value, ctx);
        if (rule) {
          event.repeat = rule;
          const projection = legacyProjection(rule, startDate);
          event.recurrence = projection.recurrence;
          if (projection.recurrenceUntil) event.recurrenceUntil = projection.recurrenceUntil;
        }
        if (unsupported.length) {
          event.unsupported = unsupported;
          const groups = rule ? simplified : firstOnly;
          const key = unsupported.join(";");
          const group = groups.get(key) ?? { parts: unsupported, titles: [] };
          if (!group.titles.includes(title)) group.titles.push(title);
          groups.set(key, group);
        }
        const exdates = propsOf(vevent, "EXDATE").flatMap((property) =>
          property.value
            .split(",")
            .map((value) => readDate(property, value.trim(), zone))
            .filter((value): value is DateValue => value !== null)
            .map(canonical)
        );
        if (exdates.length) event.exdates = [...new Set(exdates)].sort();
        if (propOf(vevent, "RDATE") || propOf(vevent, "EXRULE")) extraDates = true;
      }

      // Promemoria: scarto dall'inizio (o dalla fine), o istante preciso.
      const reminders: EventReminder[] = [];
      for (const alarm of vevent.children.filter((child) => child.name === "VALARM")) {
        const trigger = propOf(alarm, "TRIGGER");
        if (!trigger) continue;
        const value = trigger.value.trim();
        const absolute = trigger.params.VALUE?.toUpperCase() === "DATE-TIME" || DATE_TIME.test(value);
        let reminder: EventReminder | null = null;
        if (absolute) {
          const at = readDate(trigger, value, zone);
          if (!at || at.type !== "time") continue;
          const offset = Math.round((at.ms - startMs) / 60_000);
          reminder = allDay ? allDayReminder(offset) : offset <= 0 ? { minutesBefore: -offset } : null;
        } else {
          const parsed = parseDuration(value);
          if (!parsed) continue;
          const minutes = Math.round(parsed.seconds / 60);
          if (trigger.params.RELATED?.toUpperCase() === "END") {
            const offset = parsed.sign * (parsed.days * 1440 + minutes) + Math.round((endMs - startMs) / 60_000);
            reminder = allDay ? allDayReminder(offset) : offset <= 0 ? { minutesBefore: -offset } : null;
          } else if (allDay) reminder = allDayReminder(parsed.sign * (parsed.days * 1440 + minutes));
          else if (parsed.sign < 0 || (!parsed.days && !minutes)) {
            reminder = parsed.days ? { daysBefore: parsed.days, ...(minutes ? { minutesBefore: minutes } : {}) } : { minutesBefore: minutes };
          }
        }
        if (reminder) reminders.push(reminder);
      }
      if (reminders.length) {
        const clean = sanitizeReminders(reminders);
        const unique = [...new Map(clean.map((item) => [JSON.stringify(item), item])).values()];
        if (unique.length) event.reminders = unique;
      }
      events.push(event);
    }
  }

  if (unknownZones.size) for (const zone of unknownZones) warnings.push(ICS_TEXT.unknownZone(zone));
  for (const group of simplified.values()) warnings.push(ICS_TEXT.simplified(group.titles, group.parts));
  for (const group of firstOnly.values()) warnings.push(ICS_TEXT.firstOnly(group.titles, group.parts));
  if (multiple.length) warnings.push(ICS_TEXT.multipleRules([...new Set(multiple)]));
  if (extraDates) warnings.push(ICS_TEXT.extraDates);
  if (thisAndFuture) warnings.push(ICS_TEXT.thisAndFuture);
  if (skipped) warnings.push(ICS_TEXT.skipped(skipped));
  if (todos) warnings.push(ICS_TEXT.tasksIgnored(todos));
  if (tooMany) warnings.push(ICS_TEXT.tooMany(MAX_EVENTS));
  return { events, warnings };
};

/** Categoria suggerita dal titolo (es. "Esame di…" → esame, "Laboratorio…" → laboratorio). */
export const guessCategory = (title: string, fallback: EventCategory): EventCategory => {
  if (/\b(esame|appello|prova (scritta|orale)|exam)\b/i.test(title)) return "exam";
  if (/\b(lab|laboratorio|esercitazion)/i.test(title)) return "lab";
  if (/\b(ricevimento|seminario|webinar)\b/i.test(title)) return "other";
  return fallback;
};

/** Materia il cui nome compare nel titolo dell'evento (la corrispondenza più lunga vince). */
export const matchSubject = <T extends Pick<Subject, "name" | "archived">>(title: string, subjects: readonly T[]) => {
  const normalized = title.toLowerCase();
  return subjects
    .filter((subject) => !subject.archived && subject.name.trim().length >= 4 && normalized.includes(subject.name.trim().toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length)[0];
};

// ---------------------------------------------------------------------------------------
// Import: dal file agli eventi del calendario
// ---------------------------------------------------------------------------------------

/** Evento del file pronto per l'unione: tipo, materia e colore già scelti. */
export interface IcsImportItem {
  sourceUid?: string;
  sourceRecurrenceId?: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone?: string;
  repeat?: RepeatRule;
  exdates?: string[];
  reminders?: EventReminder[];
  cancelled?: true;
  category?: EventCategory;
  subjectId?: string;
  color?: string;
  tags?: string[];
}

export interface IcsItemOptions {
  /** Tipo quando né CATEGORIES né il titolo lo dicono. */
  defaultCategory: EventCategory;
  subjects?: readonly Subject[];
  /** Collega alle materie anche cercandone il nome nel titolo. */
  matchSubjects?: boolean;
}

const categoryFromList = (values: readonly string[]): EventCategory | undefined => {
  const entries = Object.entries(EVENT_CATEGORY_LABEL) as [EventCategory, string][];
  for (const value of values) {
    const lower = value.trim().toLowerCase();
    if (lower === ICS_TEXT.examCategory.toLowerCase()) return "exam";
    if (lower === ICS_TEXT.taskCategory.toLowerCase()) return "deadline";
    const found = entries.find(([id, label]) => id === lower || label.toLowerCase() === lower);
    if (found) return found[0];
  }
  return undefined;
};

/** Eventi letti dal file -> elementi da unire: tipo da CATEGORIES o dal titolo, materia da CATEGORIES o dal titolo. */
export const icsImportItems = (events: readonly IcsImportedEvent[], options: IcsItemOptions): IcsImportItem[] => {
  const subjects = (options.subjects ?? []).filter((subject) => !subject.archived);
  return events.map((event) => {
    const categories = event.categories ?? [];
    const named = categories.map((value) => subjects.find((subject) => subject.name.trim().toLowerCase() === value.trim().toLowerCase())).find(Boolean);
    const subject = named ?? (options.matchSubjects ? matchSubject(event.title, subjects) : undefined);
    return {
      ...(event.uid ? { sourceUid: event.uid } : {}),
      ...(event.recurrenceId ? { sourceRecurrenceId: event.recurrenceId } : {}),
      title: event.title,
      description: event.description,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      ...(event.timeZone ? { timeZone: event.timeZone } : {}),
      ...(event.repeat ? { repeat: event.repeat } : {}),
      ...(event.exdates?.length ? { exdates: event.exdates } : {}),
      ...(event.reminders ? { reminders: event.reminders } : {}),
      ...(event.cancelled ? { cancelled: true as const } : {}),
      category: categoryFromList(categories) ?? guessCategory(event.title, options.defaultCategory),
      ...(subject ? { subjectId: subject.id, color: subject.color } : {})
    };
  });
};

export interface IcsMergeInput {
  events: readonly CalendarEvent[];
  exams: readonly Pick<Exam, "id">[];
  tasks: readonly Pick<Task, "id">[];
  items: readonly IcsImportItem[];
  now: string;
  /** Id di un evento nuovo (riceve l'elemento: gli appelli BARB hanno un id fisso). */
  newId: (item?: IcsImportItem) => string;
  /** Fuso per gli eventi che non ne hanno uno (predefinito: dispositivo). */
  timeZone?: string;
}

export interface IcsMergePlan {
  /** Eventi e righe da scrivere (nuovi o sostituiti, per id). */
  puts: CalendarEvent[];
  deletes: string[];
  added: number;
  updated: number;
}

const ROW_DROPPED = ["repeat", "repeatLegacy", "recurrenceUntil", "sourceUid", "sourceRecurrenceId", "splitFrom", "cancelled"] as const;

const withoutKeys = <T extends object>(value: T, keys: readonly string[]): T => {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of keys) delete copy[key];
  return copy as T;
};

const reminderKey = (event: CalendarEvent, reminders: unknown) =>
  reminderInstants({ start: event.start, end: event.end, allDay: event.allDay, timeZone: event.timeZone }, reminders)
    .map((date) => date.getTime())
    .join(",");

const exportedDescription = (event: CalendarEvent) =>
  [event.description, event.notes].filter((part): part is string => typeof part === "string" && part.trim().length > 0).join("\n\n").trim();

const sameDescription = (event: CalendarEvent, description: string) =>
  description.trim() === String(event.description ?? "").trim() || description.trim() === exportedDescription(event);

/**
 * Unisce gli eventi del file al calendario senza doppioni (recurrence.md §7.2 caso 12):
 * - stesso UID = stesso evento (gli UID `id@studyos` dei propri file ritrovano l'evento; esami e
 *   attività si saltano); niente cambia se il file dice le stesse cose (nemmeno `updatedAt`);
 * - EXDATE e RECURRENCE-ID diventano righe `serie@giorno` del motore; quelle importate prima e
 *   tolte dal file si tolgono, quelle modificate in StudyOS restano;
 * - i vecchi import divisi per giorno (`uid#1`, `uid#3`) si riuniscono in una serie sola.
 */
export const mergeIcsImport = (input: IcsMergeInput): IcsMergePlan => {
  const { now } = input;
  const fallbackZone = validZone(input.timeZone) ?? deviceZone();
  const own = input.events.filter((event) => isRecord(event) && !isShared(event));
  const byId = new Map(own.map((event) => [event.id, event]));
  const sourceKey = (uid: string, rid?: string) => `${uid}\u0000${rid ?? ""}`;
  const bySource = new Map<string, CalendarEvent>();
  const legacyGroups = new Map<string, CalendarEvent[]>();
  const rowsOf = new Map<string, CalendarEvent[]>();
  const loose = new Set<string>();
  for (const event of own) {
    if (isOccurrenceRow(event)) {
      const list = rowsOf.get(event.seriesId as string);
      if (list) list.push(event);
      else rowsOf.set(event.seriesId as string, [event]);
      continue;
    }
    if (typeof event.sourceUid === "string" && event.sourceUid) {
      const key = sourceKey(event.sourceUid, event.sourceRecurrenceId);
      if (!bySource.has(key)) bySource.set(key, event);
      const legacy = /^(.*)#[0-6]$/.exec(event.sourceUid);
      if (legacy) legacyGroups.set(legacy[1], [...(legacyGroups.get(legacy[1]) ?? []), event]);
    } else {
      const timing = timingOf(event, fallbackZone);
      if (timing) loose.add(`${String(event.title ?? "").trim()}\u0000${timing.startMs}\u0000${timing.endMs}`);
    }
  }
  const reserved = new Set([...input.exams.map((exam) => exam.id), ...input.tasks.map((task) => task.id)]);
  const ownId = (uid: string) => (uid.endsWith("@studyos") ? uid.slice(0, -"@studyos".length) : undefined);
  const cuts = splitCutsOf(
    own.filter((event) => !isOccurrenceRow(event) && !event.archived),
    fallbackZone
  );

  const puts = new Map<string, CalendarEvent>();
  const deletes = new Set<string>();
  const created = new Set<string>();
  const touched = new Set<string>();
  const put = (event: CalendarEvent) => puts.set(event.id, event);

  const localMaster = (uid: string) => {
    const id = ownId(uid);
    const mine = id ? byId.get(id) : undefined;
    if (mine && !isOccurrenceRow(mine)) return mine;
    return bySource.get(sourceKey(uid));
  };

  const create = (item: IcsImportItem, extra: Partial<CalendarEvent> = {}) => {
    const base: CalendarEvent = {
      id: input.newId(item),
      createdAt: now,
      updatedAt: now,
      archived: false,
      tags: item.tags ?? [],
      title: item.title,
      description: item.description,
      category: item.category ?? "lesson",
      ...(item.subjectId ? { subjectId: item.subjectId } : {}),
      color: item.color ?? DEFAULT_COLOR,
      priority: "medium",
      start: item.start,
      end: item.end,
      allDay: item.allDay,
      ...(item.timeZone ? { timeZone: item.timeZone } : {}),
      recurrence: "none",
      status: "planned",
      checklist: [],
      attachmentIds: [],
      notes: "",
      links: [],
      ...(item.sourceUid ? { sourceUid: item.sourceUid } : {}),
      ...(item.reminders?.length ? { reminders: item.reminders } : {}),
      ...extra
    };
    const event = item.repeat ? applyRepeatFields({ ...base, repeat: item.repeat }, { repeatChanged: true, timeZone: fallbackZone }) : base;
    put(event);
    created.add(event.id);
    return event;
  };

  /** Evento aggiornato con i dati del file, o null se il file dice le stesse cose. */
  const updated = (existing: CalendarEvent, item: IcsImportItem, options: { rule: boolean; adopt?: string }) => {
    const timing = timingOf(existing, fallbackZone);
    const incoming = timingOf({ start: item.start, end: item.end, allDay: item.allDay, timeZone: item.timeZone ?? existing.timeZone }, fallbackZone);
    if (!incoming) return null;
    const cut = cuts.get(existing.id);
    let rule = options.rule && item.repeat ? item.repeat : null;
    // Una serie divisa in StudyOS resta divisa: la regola del file si ferma alla figlia.
    if (rule && cut !== undefined && cut > incoming.startDate) rule = truncatedRule(rule, incoming.startDate, cut);
    let current = options.rule ? normalizeRepeat(existing) : null;
    if (current && timing && cut !== undefined && cut > timing.startDate) current = truncatedRule(current, timing.startDate, cut);
    const zoneChanged = Boolean(rule && item.timeZone && validZone(existing.timeZone) && item.timeZone !== existing.timeZone);
    const same =
      !options.adopt &&
      !existing.archived &&
      String(existing.title ?? "").trim() === item.title.trim() &&
      sameDescription(existing, item.description) &&
      sameTiming(timing, incoming) &&
      !zoneChanged &&
      (!options.rule || ruleKey(current, timing?.startDate ?? "") === ruleKey(rule, incoming.startDate)) &&
      (item.reminders === undefined || reminderKey(existing, existing.reminders) === reminderKey(existing, item.reminders));
    if (same) return null;
    const next: CalendarEvent = {
      ...existing,
      title: item.title,
      description: sameDescription(existing, item.description) ? existing.description : item.description,
      start: item.start,
      end: item.end,
      allDay: item.allDay,
      ...(item.timeZone ? { timeZone: item.timeZone } : {}),
      ...(item.reminders !== undefined ? { reminders: item.reminders } : {}),
      ...(options.adopt ? { sourceUid: options.adopt } : {}),
      archived: false,
      updatedAt: now
    };
    if (!options.rule) return next;
    return applyRepeatFields({ ...next, repeat: rule ?? undefined, repeatLegacy: undefined }, { repeatChanged: true, timeZone: fallbackZone });
  };

  /** Occorrenza della serie: stessa riga che crea il motore (copia della serie, senza regola). */
  const rowFor = (master: CalendarEvent, timing: Timing, date: string, uid: string, rid: string, change: IcsImportItem | null, previous?: CalendarEvent) => {
    const base = withoutKeys(master, ROW_DROPPED);
    let instance: { start: string; end: string };
    if (timing.allDay) instance = { start: `${date}T00:00:00`, end: `${civilAddDays(date, Math.max(1, civilDaysBetween(timing.startDate, timing.endDate)))}T00:00:00` };
    else {
      const startMs = civilAt(date, timing.wall, timing.zone);
      instance = { start: new Date(startMs).toISOString(), end: new Date(startMs + (timing.endMs - timing.startMs)).toISOString() };
    }
    const row: CalendarEvent = {
      ...base,
      ...instance,
      id: occurrenceId(master.id, date),
      seriesId: master.id,
      originalDate: date,
      recurrence: "none",
      archived: false,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      sourceUid: uid,
      sourceRecurrenceId: rid
    };
    if (!change) return { ...row, cancelled: true as const, archived: true };
    return {
      ...row,
      title: change.title,
      description: change.description,
      start: change.start,
      end: change.end,
      allDay: change.allDay,
      ...(change.timeZone ? { timeZone: change.timeZone } : {}),
      ...(change.reminders !== undefined ? { reminders: change.reminders } : {})
    };
  };

  const sameRow = (current: CalendarEvent, desired: CalendarEvent) => {
    if (Boolean(current.cancelled) !== Boolean(desired.cancelled) || current.sourceRecurrenceId !== desired.sourceRecurrenceId) return false;
    if (desired.cancelled) return Boolean(current.archived);
    return (
      !current.archived &&
      String(current.title ?? "").trim() === String(desired.title ?? "").trim() &&
      sameDescription(current, String(desired.description ?? "")) &&
      sameTiming(timingOf(current, fallbackZone), timingOf(desired, fallbackZone)) &&
      reminderKey(current, current.reminders) === reminderKey(current, desired.reminders)
    );
  };

  /** Righe della serie dal file. `owned`: la serie è nel file, le righe importate non più presenti si tolgono. */
  const applyRows = (master: CalendarEvent, uid: string, exdates: readonly string[], changes: readonly IcsImportItem[], owned: boolean) => {
    const timing = timingOf(master, fallbackZone);
    if (!timing) return;
    const rule = normalizeRepeat(master);
    const cut = cuts.get(master.id);
    const dateOf = (rid: string) => {
      const day = DATE_ONLY.exec(rid);
      if (day) {
        const date = civilFromParts(Number(day[1]), Number(day[2]), Number(day[3]));
        return isCivilDate(date) ? date : undefined;
      }
      const match = DATE_TIME.exec(rid);
      if (!match) return undefined;
      return civilDateOf(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)), timing.zone);
    };
    const wanted = new Map<string, { rid: string; change: IcsImportItem | null }>();
    for (const rid of exdates) {
      const date = dateOf(rid);
      if (date && isInstanceOf(rule, timing.startDate, date, cut)) wanted.set(date, { rid, change: null });
    }
    for (const change of changes) {
      const rid = change.sourceRecurrenceId as string;
      const date = dateOf(rid);
      if (!date) continue;
      if (isInstanceOf(rule, timing.startDate, date, cut)) wanted.set(date, { rid, change: change.cancelled ? null : change });
      else if (!change.cancelled) standalone(uid, change);
    }
    let changed = false;
    const rows = rowsOf.get(master.id) ?? [];
    for (const [date, { rid, change }] of wanted) {
      const id = occurrenceId(master.id, date);
      const current = byId.get(id) ?? rows.find((row) => row.originalDate === date);
      // Una modifica fatta in StudyOS a quel giorno vince sul file.
      if (current && !current.sourceRecurrenceId) continue;
      const desired = rowFor(master, timing, date, uid, rid, change, current);
      if (current && current.id === desired.id && sameRow(current, desired)) continue;
      put(desired);
      changed = true;
    }
    if (owned) {
      const rids = new Set([...wanted.values()].map((entry) => entry.rid));
      for (const row of rows) {
        if (row.sourceRecurrenceId && !rids.has(row.sourceRecurrenceId) && !puts.has(row.id)) {
          deletes.add(row.id);
          changed = true;
        }
      }
    }
    if (changed && !created.has(master.id)) touched.add(master.id);
  };

  /** Occorrenza senza la sua serie: un evento singolo, ritrovato con UID e RECURRENCE-ID. */
  const standalone = (uid: string, item: IcsImportItem) => {
    const existing = bySource.get(sourceKey(uid, item.sourceRecurrenceId));
    if (item.cancelled) {
      if (existing && !deletes.has(existing.id)) {
        deletes.add(existing.id);
        touched.add(existing.id);
      }
      return;
    }
    if (existing) {
      const next = updated(existing, item, { rule: false });
      if (next) {
        put(next);
        touched.add(existing.id);
      }
      return;
    }
    create({ ...item, repeat: undefined }, { sourceRecurrenceId: item.sourceRecurrenceId });
  };

  // Elementi del file per UID (il primo vince se un UID si ripete), senza UID a parte.
  const masters = new Map<string, IcsImportItem>();
  const changes = new Map<string, IcsImportItem[]>();
  const withoutUid: IcsImportItem[] = [];
  const seen = new Set<string>();
  for (const item of input.items) {
    if (!item.sourceUid) {
      withoutUid.push(item);
      continue;
    }
    const key = sourceKey(item.sourceUid, item.sourceRecurrenceId);
    if (seen.has(key)) continue;
    seen.add(key);
    if (item.sourceRecurrenceId) changes.set(item.sourceUid, [...(changes.get(item.sourceUid) ?? []), item]);
    else masters.set(item.sourceUid, item);
  }
  const isReserved = (uid: string) => {
    const id = ownId(uid);
    return id !== undefined && reserved.has(id);
  };

  for (const [uid, item] of masters) {
    if (isReserved(uid)) continue;
    let existing = localMaster(uid);
    let adopt: string | undefined;
    if (!existing) {
      // Vecchio import: una serie per giorno della settimana. Se ne tiene una (quella del giorno
      // d'inizio, o la prima), le altre si tolgono.
      const group = (legacyGroups.get(uid) ?? []).filter((event) => !deletes.has(event.id));
      if (group.length) {
        const startDay = timingOf(item, fallbackZone)?.startDate;
        const weekday = startDay ? civilWeekday(startDay) : -1;
        const dated = group.map((event) => ({ event, timing: timingOf(event, fallbackZone) }));
        const keeper =
          dated.find((entry) => entry.timing && civilWeekday(entry.timing.startDate) === weekday)?.event ??
          [...dated].sort((a, b) => (a.timing?.startMs ?? 0) - (b.timing?.startMs ?? 0))[0].event;
        for (const event of group) {
          if (event.id === keeper.id) continue;
          deletes.add(event.id);
          for (const row of rowsOf.get(event.id) ?? []) deletes.add(row.id);
        }
        existing = keeper;
        adopt = uid;
      }
    }
    let master: CalendarEvent;
    if (existing) {
      const next = updated(existing, item, { rule: true, adopt });
      if (next) {
        put(next);
        touched.add(existing.id);
      }
      master = next ?? existing;
    } else master = create(item);
    applyRows(master, uid, item.exdates ?? [], changes.get(uid) ?? [], true);
    changes.delete(uid);
  }

  // Occorrenze senza la serie nel file: righe della serie già importata, o eventi singoli.
  for (const [uid, list] of changes) {
    if (isReserved(uid)) continue;
    const master = localMaster(uid);
    if (master && !master.sourceRecurrenceId) applyRows(master, uid, [], list, false);
    else for (const item of list) standalone(uid, item);
  }

  for (const item of withoutUid) {
    const timing = timingOf(item, fallbackZone);
    const key = timing ? `${item.title.trim()}\u0000${timing.startMs}\u0000${timing.endMs}` : "";
    if (key && loose.has(key)) continue;
    loose.add(key);
    create(item);
  }

  for (const id of created) touched.delete(id);
  return { puts: [...puts.values()], deletes: [...deletes].filter((id) => !puts.has(id)), added: created.size, updated: touched.size };
};
