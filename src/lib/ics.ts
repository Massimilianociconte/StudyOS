// Import/export iCalendar (.ics, RFC 5545) per il calendario di StudyOS.
// - Export: eventi con la regola completa (RRULE), date escluse (EXDATE), occorrenze modificate
//   (RECURRENCE-ID), divisioni "questa e le successive" (una serie per parte), promemoria (VALARM)
//   e un VTIMEZONE per ogni fuso usato; esami e scadenze delle attività aperte.
// - Import: file di Google, Apple, Samsung e Outlook (anche con fusi Windows o inventati): serie,
//   date escluse e occorrenze modificate diventano le stesse righe che crea il motore delle
//   ripetizioni (lib/repeat.ts), e un secondo import dello stesso file non duplica nulla.
// Tutto puro: niente store, niente DOM. Lo store carica `mergeIcsImport` solo quando serve.
import type { CalendarEvent, EventCategory, EventOccasion, EventReminder, Exam, RepeatRule, Subject, Task, Weekday } from "../types";
import {
  MAX_COUNT,
  MAX_INTERVAL,
  applyRepeatFields,
  countBefore,
  expandRule,
  isOccurrenceRow,
  legacyProjection,
  normalizeRepeat,
  occurrenceId,
  reminderInstants,
  sanitizeOccasion,
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
import { EVENT_CATEGORY_LABEL } from "./labels";
import { ICS_TEXT } from "./labels/ics";
import { safeCssColor } from "./sharing";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MAX_EVENTS = 2000;
/** Giorni esclusi o modificati letti per una serie, e in tutto il file: oltre, il file è sospetto. */
const MAX_ROWS_PER_SERIES = 1000;
const MAX_ROWS = 20_000;
/**
 * Date escluse lette dal file per un evento e in tutto il file (le più vicine a oggi): il doppio delle righe
 * che l'unione tiene, così l'unione sceglie ancora; il resto non si legge nemmeno (un file ostile da 5 MB
 * può averne 300.000, e ognuna costa una conversione di fuso).
 */
const MAX_DATES_PER_EVENT = 2 * MAX_ROWS_PER_SERIES;
const MAX_DATES = 2 * MAX_ROWS;
/** Fusi diversi cercati per file; quanti di questi confrontati con le regole del loro VTIMEZONE (costa di più). */
const MAX_ZONE_LOOKUPS = 100;
const MAX_ZONE_MATCHES = 20;
/** Durata massima di un evento letto da un file (giorni): oltre è quasi certamente un errore. */
const MAX_SPAN_DAYS = 366;
/** X-STUDYOS-FROM vale entro questi giorni dal primo giorno della figlia (uno spostamento, non di più). */
const FROM_RANGE_DAYS = 366;
const DEFAULT_COLOR = "#7CF7C8";
const WEEKDAY_BY_NUMBER: readonly Weekday[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const WEEKDAY_CODES = new Set<string>(WEEKDAY_BY_NUMBER);

const pad = (value: number, size = 2) => String(Math.abs(value)).padStart(size, "0");
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isWeekday = (value: unknown): value is Weekday => typeof value === "string" && WEEKDAY_CODES.has(value);
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** Date.UTC anche per gli anni 0–99 (Date.UTC li porterebbe al 1900). */
const utcMs = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) => {
  if (year >= 100) return Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(Date.UTC(2000, month - 1, day, hour, minute, second));
  date.setUTCFullYear(year + date.getUTCFullYear() - 2000);
  return date.getTime();
};
const timestamp = (value: unknown) => {
  const ms = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(ms) ? 0 : ms;
};
const validZone = (zone: unknown) => (isValidTimeZone(zone) ? zone : undefined);
const deviceZone = () => validZone(deviceTimeZone()) ?? "UTC";

// ---------------------------------------------------------------------------------------
// Testo
// ---------------------------------------------------------------------------------------

export const escapeText = (value: string) => value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

export const unescapeText = (value: string) => value.replace(/\\([\\;,nN])/g, (_match, char: string) => (char === "n" || char === "N" ? "\n" : char));

// ---------------------------------------------------------------------------------------
// Colori (COLOR, RFC 7986: un nome di colore CSS)
// ---------------------------------------------------------------------------------------

const CSS_COLOR_NAMES =
  "aliceblue:f0f8ff antiquewhite:faebd7 aqua:00ffff aquamarine:7fffd4 azure:f0ffff beige:f5f5dc bisque:ffe4c4 " +
  "black:000000 blanchedalmond:ffebcd blue:0000ff blueviolet:8a2be2 brown:a52a2a burlywood:deb887 " +
  "cadetblue:5f9ea0 chartreuse:7fff00 chocolate:d2691e coral:ff7f50 cornflowerblue:6495ed cornsilk:fff8dc " +
  "crimson:dc143c cyan:00ffff darkblue:00008b darkcyan:008b8b darkgoldenrod:b8860b darkgray:a9a9a9 " +
  "darkgreen:006400 darkgrey:a9a9a9 darkkhaki:bdb76b darkmagenta:8b008b darkolivegreen:556b2f darkorange:ff8c00 " +
  "darkorchid:9932cc darkred:8b0000 darksalmon:e9967a darkseagreen:8fbc8f darkslateblue:483d8b " +
  "darkslategray:2f4f4f darkslategrey:2f4f4f darkturquoise:00ced1 darkviolet:9400d3 deeppink:ff1493 " +
  "deepskyblue:00bfff dimgray:696969 dimgrey:696969 dodgerblue:1e90ff firebrick:b22222 floralwhite:fffaf0 " +
  "forestgreen:228b22 fuchsia:ff00ff gainsboro:dcdcdc ghostwhite:f8f8ff gold:ffd700 goldenrod:daa520 gray:808080 " +
  "green:008000 greenyellow:adff2f grey:808080 honeydew:f0fff0 hotpink:ff69b4 indianred:cd5c5c indigo:4b0082 " +
  "ivory:fffff0 khaki:f0e68c lavender:e6e6fa lavenderblush:fff0f5 lawngreen:7cfc00 lemonchiffon:fffacd " +
  "lightblue:add8e6 lightcoral:f08080 lightcyan:e0ffff lightgoldenrodyellow:fafad2 lightgray:d3d3d3 " +
  "lightgreen:90ee90 lightgrey:d3d3d3 lightpink:ffb6c1 lightsalmon:ffa07a lightseagreen:20b2aa " +
  "lightskyblue:87cefa lightslategray:778899 lightslategrey:778899 lightsteelblue:b0c4de lightyellow:ffffe0 " +
  "lime:00ff00 limegreen:32cd32 linen:faf0e6 magenta:ff00ff maroon:800000 mediumaquamarine:66cdaa " +
  "mediumblue:0000cd mediumorchid:ba55d3 mediumpurple:9370db mediumseagreen:3cb371 mediumslateblue:7b68ee " +
  "mediumspringgreen:00fa9a mediumturquoise:48d1cc mediumvioletred:c71585 midnightblue:191970 mintcream:f5fffa " +
  "mistyrose:ffe4e1 moccasin:ffe4b5 navajowhite:ffdead navy:000080 oldlace:fdf5e6 olive:808000 olivedrab:6b8e23 " +
  "orange:ffa500 orangered:ff4500 orchid:da70d6 palegoldenrod:eee8aa palegreen:98fb98 paleturquoise:afeeee " +
  "palevioletred:db7093 papayawhip:ffefd5 peachpuff:ffdab9 peru:cd853f pink:ffc0cb plum:dda0dd powderblue:b0e0e6 " +
  "purple:800080 rebeccapurple:663399 red:ff0000 rosybrown:bc8f8f royalblue:4169e1 saddlebrown:8b4513 " +
  "salmon:fa8072 sandybrown:f4a460 seagreen:2e8b57 seashell:fff5ee sienna:a0522d silver:c0c0c0 skyblue:87ceeb " +
  "slateblue:6a5acd slategray:708090 slategrey:708090 snow:fffafa springgreen:00ff7f steelblue:4682b4 tan:d2b48c " +
  "teal:008080 thistle:d8bfd8 tomato:ff6347 turquoise:40e0d0 violet:ee82ee wheat:f5deb3 white:ffffff " +
  "whitesmoke:f5f5f5 yellow:ffff00 yellowgreen:9acd32";
let cssColors: { byName: Map<string, string>; byHex: Map<string, string> } | undefined;
const cssColorTables = () => {
  if (cssColors) return cssColors;
  const byName = new Map<string, string>();
  const byHex = new Map<string, string>();
  for (const pair of CSS_COLOR_NAMES.split(" ")) {
    const [name, hex] = pair.split(":");
    byName.set(name, `#${hex}`);
    if (!byHex.has(hex)) byHex.set(hex, name);
  }
  cssColors = { byName, byHex };
  return cssColors;
};
/** "#rrggbb" in minuscolo (anche da "#rgb"); undefined con la trasparenza o un valore non valido. */
const hex6 = (color: string) => {
  const value = safeCssColor(color).slice(1).toLowerCase();
  if (value.length === 6) return value;
  if (value.length === 3) return value.replace(/./g, (char) => char + char);
  return undefined;
};
/** Nome CSS del colore, se ne ha uno esatto. */
const cssColorName = (color: string) => {
  const hex = hex6(color);
  return hex ? cssColorTables().byHex.get(hex) : undefined;
};
/** Colore letto da X-STUDYOS-COLOR (valore esatto) o da COLOR (nome CSS); "" se non è un colore. */
const colorFromIcs = (exact: string | undefined, named: string | undefined) =>
  safeCssColor(exact) || safeCssColor(cssColorTables().byName.get(String(named ?? "").trim().toLowerCase()));

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
    const parts = utcToZonedParts(utcMs(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)), ctx.zone);
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

/** La regola ha ancora occorrenze dal giorno `date` in poi (senza regola: l'evento è da `date` in poi). */
const runsInto = (rule: RepeatRule | null, startDate: string, date: string) => {
  if (!rule) return startDate >= date;
  if (rule.end?.type === "until") return rule.end.date >= date;
  if (rule.end?.type === "count") return countBefore(rule, startDate, date) < rule.end.count;
  return true;
};

/** Finestra di un'espansione: la regola dà al più un'occorrenza al giorno, sotto il limite del motore (1000). */
const WINDOW_DAYS = 999;
/** Oltre questo vuoto tra due date si apre una finestra nuova: date sparse in secoli non si espandono tutte. */
const WINDOW_GAP_DAYS = 31;

/**
 * Quali tra `dates` sono occorrenze della regola (prima del taglio `cut`): una passata in ordine, a
 * finestre che coprono solo i tratti con date da guardare. Migliaia di date costano come poche.
 */
const instanceDays = (rule: RepeatRule | null, startDate: string, dates: Iterable<string>, cut?: string) => {
  const wanted = [...new Set(dates)].filter((date) => isCivilDate(date) && date >= startDate && (cut === undefined || date < cut)).sort(compareText);
  const found = new Set<string>();
  if (!rule) {
    if (wanted[0] === startDate) found.add(startDate);
    return found;
  }
  const wallStart = `${startDate}T00:00:00`;
  const utcDay = (date: string) => new Date(civilAt(date, [0, 0, 0], "UTC"));
  // Con un numero di ripetizioni la regola non salta avanti: al massimo 999 date, si espande una volta sola.
  if (wanted.length && rule.end?.type === "count" && rule.end.count <= MAX_COUNT) {
    for (const instance of expandRule(rule, wallStart, "UTC", utcDay(startDate), utcDay(civilAddDays(wanted[wanted.length - 1], 1)))) found.add(instance.date);
    return found;
  }
  for (let index = 0; index < wanted.length; ) {
    const from = wanted[index];
    const limit = civilAddDays(from, WINDOW_DAYS);
    let last = index;
    while (last + 1 < wanted.length && wanted[last + 1] < limit && civilDaysBetween(wanted[last], wanted[last + 1]) <= WINDOW_GAP_DAYS) last += 1;
    const window = expandRule(rule, wallStart, "UTC", utcDay(from), utcDay(civilAddDays(wanted[last], 1)));
    for (const instance of window) found.add(instance.date);
    index = last + 1;
  }
  return found;
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
/** Giorno cambiato a mano: in questo calendario (niente sourceRecurrenceId) o ricevuto così con una copia. */
const isHandChange = (row: CalendarEvent | undefined) => Boolean(row && (!row.sourceRecurrenceId || row.sourceEdited === true));
/** UID con cui l'evento esce nel file: quello d'origine, o `id@studyos`. */
const exportUidOf = (event: CalendarEvent) => (typeof event.sourceUid === "string" && event.sourceUid ? event.sourceUid : `${event.id}@studyos`);

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

/**
 * Cambi d'ora del fuso tra l'inizio di `fromYear` e la fine di `toYear`, al secondo (da Intl). Passi di 3
 * giorni: i due cambi più vicini dei dati IANA distano 7 giorni (Gaza nel 2040, Ramadan; Brasile nel 2000),
 * e con passi di una settimana sparivano entrambi.
 */
const transitionsOf = (zone: string, fromYear: number, toYear: number): Transition[] => {
  const out: Transition[] = [];
  const end = utcMs(toYear + 1, 1, 1);
  let t = utcMs(fromYear, 1, 1);
  let previous = timeZoneOffset(t, zone);
  while (t < end && out.length < 1000) {
    const next = Math.min(t + 3 * DAY_MS, end);
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

/** Il cambio d'ora come lo scrive un VTIMEZONE: tipo, ora locale prima del cambio, n-esimo giorno della settimana. */
const describeTransition = (transition: Transition) => {
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
};

/**
 * VTIMEZONE del fuso IANA per gli anni dati, dalle regole di Intl: gli anni con lo stesso cambio
 * (mese, n-esimo giorno della settimana, ora) diventano una regola annuale; quando le regole
 * cambiano, la regola vecchia ha UNTIL; un fuso senza cambi ha un solo STANDARD.
 *
 * `checkYear` (≥ toYear): ultimo anno in cui il file usa il fuso (una serie senza fine va avanti). Le
 * regole annuali si controllano con i cambi veri di Intl fino a lì: se in un anno sbagliano (Gerusalemme,
 * «il venerdì prima dell'ultima domenica», a volte è il penultimo venerdì; Santiago, Il Cairo, Nuuk, Gaza,
 * Casablanca), il fuso esce con ogni cambio scritto come data (DTSTART e RDATE), fino a `checkYear`.
 */
export const buildVTimezone = (zone: string, fromYear: number, toYear: number, checkYear = toYear): string[] => {
  const lastYear = Math.max(toYear, checkYear);
  const all = transitionsOf(zone, fromYear, lastYear);
  const ruled = ruleVTimezone(zone, fromYear, toYear, all.filter((transition) => transition.ms < utcMs(toYear + 1, 1, 1)));
  if (matchesIntl(ruled, zone, all, fromYear, lastYear)) return ruled;
  return datedVTimezone(zone, all);
};

/** Il VTIMEZONE scritto, riletto, dà gli stessi cambi di Intl (`transitions`) e nessun altro tra fromYear e toYear. */
const matchesIntl = (lines: readonly string[], zone: string, transitions: readonly Transition[], fromYear: number, toYear: number) => {
  const component = parseComponents(lines.join("\r\n")).find((item) => item.name === "VTIMEZONE");
  if (!component) return false;
  const rules = zoneRules(component);
  const start = utcMs(fromYear, 1, 1);
  const end = utcMs(toYear + 1, 1, 1);
  if (rules.offsetAt(start) !== timeZoneOffset(start, zone)) return false;
  for (const transition of transitions) {
    if (rules.offsetAt(transition.ms) !== transition.to || rules.offsetAt(transition.ms - 1000) !== transition.from) return false;
  }
  const real = new Set(transitions.map((transition) => transition.ms));
  for (let year = fromYear; year <= toYear; year += 1) {
    for (const ms of rules.onsets(year)) if (ms >= start && ms < end && !real.has(ms)) return false;
  }
  return true;
};

/** Ogni cambio come data: per tipo e scarti, il primo in DTSTART e gli altri in RDATE (uno per anno). */
const datedVTimezone = (zone: string, transitions: readonly Transition[]): string[] => {
  const groups = new Map<string, ReturnType<typeof describeTransition>[]>();
  for (const item of transitions.map(describeTransition)) {
    const key = `${item.kind}|${item.from}|${item.to}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const lines = ["BEGIN:VTIMEZONE", `TZID:${zone}`, `X-LIC-LOCATION:${zone}`];
  for (const [head, ...rest] of groups.values()) {
    lines.push(`BEGIN:${head.kind}`, `TZOFFSETFROM:${offsetText(head.from)}`, `TZOFFSETTO:${offsetText(head.to)}`, `DTSTART:${head.local}`);
    for (const item of rest) lines.push(`RDATE:${item.local}`);
    lines.push(`END:${head.kind}`);
  }
  lines.push("END:VTIMEZONE");
  return lines;
};

/** VTIMEZONE con le regole annuali (vedi `buildVTimezone`), dai cambi tra fromYear e toYear. */
const ruleVTimezone = (zone: string, fromYear: number, toYear: number, transitions: readonly Transition[]): string[] => {
  const lines = ["BEGIN:VTIMEZONE", `TZID:${zone}`, `X-LIC-LOCATION:${zone}`];
  if (!transitions.length) {
    const offset = offsetText(timeZoneOffset(utcMs(fromYear, 1, 1), zone));
    lines.push("BEGIN:STANDARD", `TZOFFSETFROM:${offset}`, `TZOFFSETTO:${offset}`, "DTSTART:19700101T000000", "END:STANDARD", "END:VTIMEZONE");
    return lines;
  }
  const described = transitions.map(describeTransition);
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
    const firstMs = utcMs(local[0], local[1], local[2], local[3], local[4], local[5]) - from;
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
          ? utcMs(Number(until[1]), Number(until[2]), Number(until[3]), Number(until[4] ?? 23), Number(until[5] ?? 59), Number(until[6] ?? 59)) - (until[7] ? 0 : from)
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
        if (match) observance.extra.push(utcMs(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)) - from);
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
  const ms = utcMs(year, rule.month, day, observance.local[3], observance.local[4], observance.local[5]) - observance.from;
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

/** Anni dopo oggi in cui il VTIMEZONE di una serie senza fine deve essere giusto (oltre, le sue regole). */
const RULE_HORIZON_YEARS = 20;
const PERIOD_DAYS: Record<RepeatRule["freq"], number> = { daily: 1, weekly: 7, monthly: 31, yearly: 366 };

/** Ultimo anno (al più `horizon`) in cui la serie può avere un'occorrenza; con un conteggio, una stima per eccesso. */
const reachYear = (rule: RepeatRule, startDate: string, horizon: number) => {
  const startYear = Number(startDate.slice(0, 4));
  if (rule.end?.type === "until") return Math.min(Number(rule.end.date.slice(0, 4)), horizon);
  if (rule.end?.type === "count") return Math.min(startYear + Math.ceil((PERIOD_DAYS[rule.freq] * (rule.interval ?? 1) * rule.end.count) / 365), horizon);
  return horizon;
};

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
  /** Fin dove arrivano le serie di ogni fuso (anno): il suo VTIMEZONE deve essere giusto fino a lì. */
  const zoneReach = new Map<string, number>();
  const horizon = now.getUTCFullYear() + RULE_HORIZON_YEARS;
  const body: string[] = [];

  const useZone = (zone: string, ms: number) => {
    const year = utcToZonedParts(ms, zone).year;
    const known = zoneYears.get(zone);
    zoneYears.set(zone, known ? { min: Math.min(known.min, year), max: Math.max(known.max, year) } : { min: year, max: year });
  };
  /**
   * DTSTART/DTEND, RECURRENCE-ID, EXDATE: stesso tipo di valore e TZID dell'inizio della serie.
   * Anche UTC ha il suo TZID: un `…Z` di una serie si rilegge nel fuso del calendario (X-WR-TIMEZONE).
   */
  const dateLine = (name: string, timing: Timing, values: readonly { date: string; ms: number }[]) => {
    if (timing.allDay) return `${name};VALUE=DATE:${values.map((value) => civilStamp(value.date)).join(",")}`;
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
    const location = typeof event.location === "string" ? event.location.trim() : "";
    if (location) lines.push(`LOCATION:${escapeText(location)}`);
    // Colore scelto a mano: COLOR (RFC 7986) se ha un nome CSS, altrimenti il valore esatto per StudyOS.
    const color = event.colorCustom === true ? safeCssColor(event.color) : "";
    if (color) lines.push(cssColorName(color) ? `COLOR:${cssColorName(color)}` : `X-STUDYOS-COLOR:${color}`);
    const categories = [event.category ? label(event.category) : "", subjectName(event.subjectId) ?? ""].filter(Boolean);
    if (categories.length) lines.push(`CATEGORIES:${categories.map((value) => escapeText(String(value))).join(",")}`);
    // Saltato non è annullato: l'evento resta (anche nelle altre app), StudyOS rilegge lo stato.
    if (event.status === "skipped") lines.push("X-STUDYOS-STATUS:skipped");
    // Compleanni e anniversari: tipo, anno e persona solo per StudyOS (le altre app ignorano le X-).
    const occasion = sanitizeOccasion(event.occasion);
    if (occasion) {
      lines.push(`X-STUDYOS-OCCASION;KIND=${occasion.kind.toUpperCase()}${occasion.birthYear ? `;YEAR=${occasion.birthYear}` : ""}:${escapeText(occasion.person ?? "")}`);
    }
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
  const masterById = new Map(masters.map((event) => [event.id, event]));
  /**
   * Figlia di una divisione: RELATED-TO verso la madre (RFC 5545), così in un altro calendario resta nella
   * famiglia. Se ferma la parte prima da un giorno diverso dal suo primo (uno spostamento: la parte prima
   * tiene la sua ultima data spostata), X-STUDYOS-FROM dice quel giorno, così una copia nuova non la perde.
   */
  const relatedTo = (event: CalendarEvent, timing: Timing) => {
    const parentId = parentIdOf(event);
    const parent = parentId ? masterById.get(parentId) : undefined;
    if (!parent) return [];
    const from = isCivilDate(event.originalDate) && event.originalDate !== timing.startDate ? [`X-STUDYOS-FROM;VALUE=DATE:${civilStamp(event.originalDate)}`] : [];
    return [`RELATED-TO;RELTYPE=PARENT:${exportUidOf(parent)}`, ...from];
  };

  for (const event of masters) {
    const timing = timingOf(event, exportZone);
    if (!timing) continue;
    const uid = exportUidOf(event);
    const cut = cuts.get(event.id);
    if (cut !== undefined && cut <= timing.startDate) continue;
    let rule = normalizeRepeat(event);
    if (rule && cut !== undefined) rule = truncatedRule(rule, timing.startDate, cut);
    if (rule && !timing.allDay) zoneReach.set(timing.zone, Math.max(zoneReach.get(timing.zone) ?? 0, reachYear(rule, timing.startDate, horizon)));
    const rows = rowsBySeries.get(event.id);
    if (!rule) {
      // Evento singolo: una riga sul suo giorno lo cancella o lo sostituisce.
      const row = rows?.get(timing.startDate);
      if (row && (row.cancelled || row.archived)) continue;
      const shown = row ?? event;
      const shownTiming = row ? timingOf(row, timing.zone) : timing;
      if (!shownTiming) continue;
      vevent(uid, [...startEnd(shownTiming), ...relatedTo(event, timing), ...content(shown, shownTiming)]);
      continue;
    }
    const exdates: string[] = [];
    const overrides: [string, CalendarEvent][] = [];
    const days = instanceDays(rule, timing.startDate, rows?.keys() ?? []);
    for (const [date, row] of rows ?? []) {
      if (!days.has(date)) continue;
      if (row.cancelled || row.archived) exdates.push(date);
      else overrides.push([date, row]);
    }
    exdates.sort();
    // Giorni cambiati a mano (qui, o ricevuti così con una copia): X-STUDYOS-EDITED, così una copia nuova li
    // tiene come modifiche a mano. Le date restano anche in EXDATE per le altre app.
    const edited = exdates.filter((date) => isHandChange(rows?.get(date)));
    vevent(uid, [
      ...startEnd(timing),
      `RRULE:${rruleOf(rule, timing)}`,
      ...(exdates.length ? [dateLine("EXDATE", timing, exdates.map((date) => instant(timing, date)))] : []),
      ...(edited.length ? [dateLine("X-STUDYOS-EDITED", timing, edited.map((date) => instant(timing, date)))] : []),
      ...relatedTo(event, timing),
      ...content(event, timing)
    ]);
    for (const [date, row] of overrides.sort((a, b) => compareText(a[0], b[0]))) {
      const rowTiming = timingOf(row, timing.zone);
      if (!rowTiming) continue;
      vevent(uid, [
        dateLine("RECURRENCE-ID", timing, [instant(timing, date)]),
        ...startEnd(rowTiming),
        ...(isHandChange(row) ? ["X-STUDYOS-EDITED:TRUE"] : []),
        ...content(row, rowTiming)
      ]);
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
    zones.push(...buildVTimezone(zone, fromYear, toYear, Math.max(toYear, zoneReach.get(zone) ?? toYear)));
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
  /** Colore scelto a mano (X-STUDYOS-COLOR, o COLOR con un nome CSS). */
  color?: string;
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
  /**
   * Saltato (X-STUDYOS-STATUS:skipped, o STATUS:CANCELLED nei vecchi file di StudyOS): true. false = un file
   * di StudyOS dice che non lo è; assente = il file non lo sa (le altre app): lo stato resta quello di qui.
   */
  skipped?: boolean;
  /** Compleanno o anniversario esportato da StudyOS (X-STUDYOS-OCCASION). */
  occasion?: EventOccasion;
  /** RELATED-TO;RELTYPE=PARENT: UID della serie madre (figlia di una divisione fatta in StudyOS). */
  parentUid?: string;
  /** X-STUDYOS-FROM: giorno (YYYY-MM-DD) da cui la figlia ferma la parte prima, se non è il suo primo. */
  parentFrom?: string;
  /** X-STUDYOS-EDITED su un RECURRENCE-ID: giorno cambiato a mano in StudyOS. */
  edited?: true;
  /** X-STUDYOS-EDITED sulla serie: date escluse a mano in StudyOS (tra quelle di `exdates`). */
  editedExdates?: string[];
}

export interface IcsParseResult {
  events: IcsImportedEvent[];
  /** Avvisi in italiano semplice (regole semplificate, fusi sconosciuti, eventi scartati). */
  warnings: string[];
}

export interface IcsParseOptions {
  /** Fuso da usare per le ore senza fuso e per i fusi sconosciuti (predefinito: dispositivo). */
  timeZone?: string;
  /** Oggi, per scegliere cosa leggere di un file troppo grande (predefinito: adesso). */
  now?: string | number | Date;
}

/** Giorno (numero di giorni dal 1970) dalle prime cifre di una data del file, senza fuso; NaN se non è una data. */
const rawDay = (value: string) => {
  const match = /^\s*(\d{4})(\d{2})(\d{2})/.exec(value);
  return match ? Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / DAY_MS) : Number.NaN;
};

/**
 * I `max` elementi con la chiave più bassa, nell'ordine di partenza (a pari chiave, i primi). Chiave non
 * numerica = ultimi. Lineare più un ordinamento di numeri: regge le 300.000 date di un file ostile.
 */
const lowestKeys = <T>(items: readonly T[], keyOf: (item: T) => number, max: number): T[] => {
  if (items.length <= max) return [...items];
  if (max <= 0) return [];
  const keys = new Float64Array(items.length);
  items.forEach((item, index) => {
    const key = keyOf(item);
    keys[index] = Number.isNaN(key) ? Number.POSITIVE_INFINITY : key;
  });
  const threshold = Float64Array.from(keys).sort()[max - 1];
  let below = 0;
  for (const key of keys) if (key < threshold) below += 1;
  let ties = max - below;
  return items.filter((_, index) => keys[index] < threshold || (keys[index] === threshold && ties-- > 0));
};

/** Ultimo giorno (come `rawDay`) raggiunto da una RRULE che parte il giorno `start`; Infinity = senza fine. */
const RULE_STEP_DAYS: Record<string, number> = { DAILY: 1, WEEKLY: 7, MONTHLY: 31, YEARLY: 366 };
const ruleReachDay = (rule: string, start: number) => {
  const text = rule.toUpperCase();
  const until = /(?:^|;)\s*UNTIL=([^;]*)/.exec(text);
  if (until) {
    const day = rawDay(until[1]);
    return Number.isNaN(day) ? start : Math.max(start, day);
  }
  const count = /(?:^|;)\s*COUNT=(\d+)/.exec(text);
  if (!count) return Number.POSITIVE_INFINITY;
  const interval = Number(/(?:^|;)\s*INTERVAL=(\d+)/.exec(text)?.[1] ?? 1) || 1;
  const step = RULE_STEP_DAYS[/(?:^|;)\s*FREQ=([A-Z]+)/.exec(text)?.[1] ?? ""] ?? 1;
  return start + Math.min(Number(count[1]), 1e6) * interval * step;
};

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
  const tooLong: string[] = [];
  const nowMs = new Date(options.now ?? Date.now()).getTime();
  const today = Math.floor((Number.isFinite(nowMs) ? nowMs : Date.now()) / DAY_MS);
  let zoneLookups = 0;
  let zoneMatches = 0;
  let dateBudget = MAX_DATES;
  /** Serie a cui il tetto del file ha tolto date escluse: quante ne sono state lette \u2192 titoli. */
  const starved = new Map<number, string[]>();

  const calendars = parseComponents(text.replace(/^\uFEFF/, "")).filter((component) => component.name === "VCALENDAR");
  const studyOsFile = (calendar: Component) => /StudyOS/i.test(propOf(calendar, "PRODID")?.value ?? "");
  // Pi\u00F9 di MAX_EVENTS eventi: si leggono i pi\u00F9 vicini a oggi. Prima quelli in corso o in arrivo (dal pi\u00F9
  // vicino), poi i passati (dal pi\u00F9 recente); gli eventi senza data e quelli annullati per ultimi.
  const allEvents = calendars.flatMap((calendar) => {
    const fromStudyOs = studyOsFile(calendar);
    return calendar.children.filter((child) => child.name === "VEVENT").map((vevent) => ({ vevent, fromStudyOs }));
  });
  let chosen: Set<Component> | null = null;
  if (allEvents.length > MAX_EVENTS) {
    const PAST = 1e8;
    const rank = ({ vevent, fromStudyOs }: { vevent: Component; fromStudyOs: boolean }) => {
      const start = rawDay(propOf(vevent, "DTSTART")?.value ?? "");
      if (Number.isNaN(start)) return Number.NaN;
      const rid = propOf(vevent, "RECURRENCE-ID");
      if (!rid && !fromStudyOs && propOf(vevent, "STATUS")?.value.trim().toUpperCase() === "CANCELLED") return Number.NaN;
      const rule = rid ? undefined : propOf(vevent, "RRULE")?.value;
      const endDay = rawDay(propOf(vevent, "DTEND")?.value ?? "");
      const end = rule ? ruleReachDay(rule, start) : Number.isNaN(endDay) ? start : Math.max(start, endDay);
      return end >= today ? Math.max(0, start - today) : PAST + (today - end);
    };
    const kept = lowestKeys(allEvents, rank, MAX_EVENTS);
    chosen = new Set(kept.map((entry) => entry.vevent));
    tooMany = true;
  }

  for (const calendar of calendars) {
    // TZID come testo (RFC 5545): le virgole di Exchange arrivano protette ("Amsterdam\, Berlino").
    const tzidOf = (value: string | undefined) => unescapeText((value ?? "").trim().replace(/^"(.*)"$/, "$1")).trim();
    const vtimezones = new Map(calendar.children.filter((child) => child.name === "VTIMEZONE").map((child) => [tzidOf(propOf(child, "TZID")?.value), child]));
    const plainZone = (name: string | undefined) => {
      const clean = (name ?? "").trim().replace(/^"(.*)"$/, "$1");
      if (!clean) return undefined;
      return validZone(clean) ?? validZone(WINDOWS_ZONES[clean]);
    };
    const calendarZone = plainZone(propOf(calendar, "X-WR-TIMEZONE")?.value);
    // File scritto da StudyOS: dice per ogni evento se è saltato (prima con STATUS:CANCELLED, che StudyOS
    // non ha mai usato per un annullamento vero: quelli sono EXDATE o eventi tolti dal file).
    const fromStudyOs = studyOsFile(calendar);
    const defaultZone = calendarZone ?? fallbackZone;
    const resolved = new Map<string, string>();

    /** Fuso IANA di un TZID: IANA, Windows, percorso (…/Europe/Rome), X-LIC-LOCATION, regole del VTIMEZONE. */
    const resolveZone = (tzid: string, year: number) => {
      const known = resolved.get(tzid);
      if (known) return known;
      // Un file con migliaia di fusi diversi è ostile: oltre i primi non si cercano più (ora di qui).
      if (zoneLookups >= MAX_ZONE_LOOKUPS) {
        unknownZones.add(tzid);
        resolved.set(tzid, defaultZone);
        return defaultZone;
      }
      zoneLookups += 1;
      let zone = plainZone(tzid);
      if (!zone) {
        const path = /([A-Za-z_]+\/[A-Za-z_+\-0-9]+(?:\/[A-Za-z_+\-0-9]+)?)$/.exec(tzid);
        const segments = path ? path[1].split("/") : [];
        zone = validZone(segments.join("/")) ?? validZone(segments.slice(-2).join("/"));
      }
      const definition = vtimezones.get(tzid);
      if (!zone && definition) zone = plainZone(propOf(definition, "X-LIC-LOCATION")?.value);
      if (!zone && definition && zoneMatches < MAX_ZONE_MATCHES) {
        zoneMatches += 1;
        // Nome inventato (es. "Ora dell'Europa centrale"): il primo fuso con gli stessi scarti.
        const rules = zoneRules(definition);
        if (!rules.empty) {
          const samples = [utcMs(year, 1, 15, 12), utcMs(year, 7, 15, 12), ...rules.onsets(year).flatMap((ms) => [ms - HOUR_MS, ms + HOUR_MS])];
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
      if (match[7]) return { type: "time", ms: utcMs(fields[0], fields[1], fields[2], fields[3], fields[4], fields[5]), zone: "UTC", floating: false, utc: true };
      const tzid = property.params.TZID === undefined ? "" : tzidOf(property.params.TZID);
      const zone = tzid ? resolveZone(tzid, fields[0]) : zoneHint ?? defaultZone;
      return { type: "time", ms: zonedToUtc(fields, zone).getTime(), zone, floating: !tzid, utc: false };
    };

    /** RECURRENCE-ID ed EXDATE in forma unica: giorno o istante UTC. */
    const canonical = (value: DateValue) => (value.type === "date" ? civilStamp(value.date) : utcStamp(value.ms));

    const vevents = calendar.children.filter((child) => child.name === "VEVENT");
    todos += calendar.children.filter((child) => child.name === "VTODO").length;
    for (const vevent of vevents) {
      if (chosen && !chosen.has(vevent)) continue;
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
      const statusCancelled = propOf(vevent, "STATUS")?.value.trim().toUpperCase() === "CANCELLED";
      const cancelled = statusCancelled && !fromStudyOs;
      const skippedStatus =
        propOf(vevent, "X-STUDYOS-STATUS")?.value.trim().toLowerCase() === "skipped" || (statusCancelled && fromStudyOs) ? true : fromStudyOs ? false : undefined;
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
        if (civilDaysBetween(startDate, endDate) > MAX_SPAN_DAYS) {
          endDate = civilAddDays(startDate, MAX_SPAN_DAYS);
          tooLong.push(title);
        }
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
        if (endMs - startMs > MAX_SPAN_DAYS * DAY_MS) {
          endMs = startMs + MAX_SPAN_DAYS * DAY_MS;
          tooLong.push(title);
        }
        start = new Date(startMs).toISOString();
        end = new Date(endMs).toISOString();
      }

      const location = unescapeText(propOf(vevent, "LOCATION")?.value ?? "").trim();
      const description = unescapeText(propOf(vevent, "DESCRIPTION")?.value ?? "").trim();
      const color = colorFromIcs(propOf(vevent, "X-STUDYOS-COLOR")?.value, propOf(vevent, "COLOR")?.value);
      const categories = propsOf(vevent, "CATEGORIES")
        .flatMap((property) => property.value.split(/(?<!\\),/))
        .map((value) => unescapeText(value).trim())
        .filter(Boolean);

      const parentUid = propsOf(vevent, "RELATED-TO")
        .find((property) => property.params.RELTYPE?.toUpperCase() === "PARENT")
        ?.value.trim();
      // Giorno da cui la figlia ferma la parte prima (X-STUDYOS-FROM): solo un giorno (VALUE=DATE) valido.
      const fromProp = parentUid && !ridProp ? propOf(vevent, "X-STUDYOS-FROM") : undefined;
      const fromValue = fromProp ? readDate(fromProp, fromProp.value.trim(), zone) : null;
      const parentFrom = fromValue?.type === "date" ? fromValue.date : undefined;
      const occasionProp = propOf(vevent, "X-STUDYOS-OCCASION");
      const occasion = occasionProp
        ? sanitizeOccasion({ kind: occasionProp.params.KIND?.toLowerCase(), birthYear: Number(occasionProp.params.YEAR), person: unescapeText(occasionProp.value) })
        : undefined;

      const event: IcsImportedEvent = {
        uid: propOf(vevent, "UID")?.value.trim() || undefined,
        title,
        description,
        ...(location ? { location } : {}),
        ...(color ? { color } : {}),
        ...(categories.length ? { categories } : {}),
        start,
        end,
        allDay,
        ...(allDay ? {} : { timeZone: zone }),
        ...(occasion ? { occasion } : {}),
        ...(skippedStatus !== undefined ? { skipped: skippedStatus } : {}),
        ...(parentUid && !ridProp ? { parentUid } : {}),
        ...(parentFrom ? { parentFrom } : {}),
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
        if (propOf(vevent, "X-STUDYOS-EDITED")?.value.trim().toUpperCase() === "TRUE") event.edited = true;
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
        // Date escluse: si leggono solo le più vicine a oggi, per evento e in tutto il file. Quelle tolte da
        // un evento con troppe date le dice l'unione (che ne tiene ancora meno); quelle tolte dal tetto del
        // file si dicono qui.
        const nearest = (name: string, max: number) => {
          const values = propsOf(vevent, name).flatMap((property) => property.value.split(",").map((value) => ({ property, value: value.trim() })));
          const kept = lowestKeys(values, (entry) => Math.abs(rawDay(entry.value) - today), max);
          return { kept, total: values.length };
        };
        const room = Math.min(MAX_DATES_PER_EVENT, dateBudget);
        const listed = nearest("EXDATE", room);
        dateBudget -= listed.kept.length;
        if (listed.total > room && room < MAX_DATES_PER_EVENT) starved.set(room, [...(starved.get(room) ?? []), title]);
        const exdates = listed.kept.map(({ property, value }) => readDate(property, value, zone)).filter((value): value is DateValue => value !== null).map(canonical);
        if (exdates.length) event.exdates = [...new Set(exdates)].sort();
        const excluded = new Set(exdates);
        // X-STUDYOS-EDITED segna alcune di quelle date: non ne servono più di quante se ne sono lette.
        const edited = nearest("X-STUDYOS-EDITED", listed.kept.length)
          .kept.map(({ property, value }) => readDate(property, value, zone))
          .filter((value): value is DateValue => value !== null)
          .map(canonical)
          .filter((value) => excluded.has(value));
        if (edited.length) event.editedExdates = [...new Set(edited)].sort();
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

  if (unknownZones.size === 1) warnings.push(ICS_TEXT.unknownZone([...unknownZones][0]));
  else if (unknownZones.size) warnings.push(ICS_TEXT.unknownZones([...unknownZones]));
  for (const [read, titles] of starved) warnings.push(ICS_TEXT.tooManyRows([...new Set(titles)], read));
  for (const group of simplified.values()) warnings.push(ICS_TEXT.simplified(group.titles, group.parts));
  for (const group of firstOnly.values()) warnings.push(ICS_TEXT.firstOnly(group.titles, group.parts));
  if (multiple.length) warnings.push(ICS_TEXT.multipleRules([...new Set(multiple)]));
  if (extraDates) warnings.push(ICS_TEXT.extraDates);
  if (thisAndFuture) warnings.push(ICS_TEXT.thisAndFuture);
  if (skipped) warnings.push(ICS_TEXT.skipped(skipped));
  if (todos) warnings.push(ICS_TEXT.tasksIgnored(todos));
  if (tooLong.length) warnings.push(ICS_TEXT.tooLong([...new Set(tooLong)]));
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
  location?: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone?: string;
  repeat?: RepeatRule;
  exdates?: string[];
  reminders?: EventReminder[];
  cancelled?: true;
  /** Saltato secondo il file (vedi `IcsImportedEvent.skipped`): assente = lo stato resta quello di qui. */
  skipped?: boolean;
  category?: EventCategory;
  subjectId?: string;
  color?: string;
  /** Il colore viene dal file (scelto a mano): vale anche con una materia. */
  colorCustom?: true;
  tags?: string[];
  occasion?: EventOccasion;
  parentUid?: string;
  parentFrom?: string;
  edited?: true;
  editedExdates?: string[];
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
      ...(event.location ? { location: event.location } : {}),
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      ...(event.timeZone ? { timeZone: event.timeZone } : {}),
      ...(event.repeat ? { repeat: event.repeat } : {}),
      ...(event.exdates?.length ? { exdates: event.exdates } : {}),
      ...(event.reminders ? { reminders: event.reminders } : {}),
      ...(event.cancelled ? { cancelled: true as const } : {}),
      ...(event.skipped !== undefined ? { skipped: event.skipped } : {}),
      ...(event.occasion ? { occasion: event.occasion } : {}),
      ...(event.parentUid ? { parentUid: event.parentUid } : {}),
      ...(event.parentUid && event.parentFrom ? { parentFrom: event.parentFrom } : {}),
      ...(event.edited ? { edited: true as const } : {}),
      ...(event.editedExdates?.length ? { editedExdates: event.editedExdates } : {}),
      category: categoryFromList(categories) ?? guessCategory(event.title, options.defaultCategory),
      ...(subject ? { subjectId: subject.id, color: subject.color } : {}),
      ...(event.color ? { color: event.color, colorCustom: true as const } : {})
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
  /** Eventi tolti perché uniti a un altro (vecchi import): id tolto -> id che lo continua. */
  relinked: Map<string, string>;
  /** Cose da dire prima di scrivere (righe oltre il limite, vecchi import lasciati com'erano). */
  warnings: string[];
  /** Eventi modificati qui dopo l'ultimo import, cambiati nel file: le modifiche fatte qui si perdono. */
  editsReplaced: number;
}

type Linked = { linkedEntityType?: string; linkedEntityId?: string; updatedAt: string };

/** Allegati, note o promemoria di eventi uniti a un altro (`relinked`): passano a quello. Nessuno = stesso array. */
export const relinkEvents = <T extends Linked>(items: T[], relinked: ReadonlyMap<string, string>, now: string): T[] => {
  const target = (item: T) => (item.linkedEntityType === "calendarEvent" && typeof item.linkedEntityId === "string" ? relinked.get(item.linkedEntityId) : undefined);
  if (!relinked.size || !items.some((item) => target(item) !== undefined)) return items;
  return items.map((item) => {
    const to = target(item);
    return to === undefined ? item : { ...item, linkedEntityId: to, updatedAt: now };
  });
};

/** Due elenchi senza doppioni (per id, o per contenuto), nell'ordine: prima `a`. */
const unionList = <T>(a: readonly T[] | undefined, b: readonly T[] | undefined): T[] | undefined => {
  if (!Array.isArray(b) || !b.length) return a as T[] | undefined;
  const keyOf = (item: T) => (isRecord(item) && typeof item.id === "string" ? `id:${item.id}` : `value:${JSON.stringify(item)}`);
  const out = Array.isArray(a) ? [...a] : [];
  const seen = new Set(out.map(keyOf));
  for (const item of b) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
};

/** Note di due eventi unite (la seconda in fondo, se non c'è già). */
const joinNotes = (a: unknown, b: unknown) => {
  const first = typeof a === "string" ? a : "";
  const second = typeof b === "string" ? b.trim() : "";
  if (!second || first.includes(second)) return first;
  return first.trim() ? `${first.trimEnd()}\n\n${second}` : second;
};

/** Campi di una sola scelta: nell'unione dei vecchi import passano se la serie tenuta non li ha, se diversi non si unisce. */
const FILLED_FIELDS = ["subjectId", "goalId", "cover"] as const;

const ROW_DROPPED = ["repeat", "repeatLegacy", "recurrenceUntil", "sourceUid", "sourceRecurrenceId", "sourceEdited", "sourceStamp", "splitFrom", "cancelled"] as const;

/** Impronta corta di un testo (cyrb53: 53 bit in base 36), uguale per lo stesso testo su ogni dispositivo. */
const hashText = (text: string) => {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
};

/** Le due metà di `sourceStamp`: com'era l'evento nel file e come l'import l'ha scritto. */
const stampParts = (value: unknown) => {
  if (typeof value !== "string") return null;
  const [file, event] = value.split(".");
  return file && event ? { file, event } : null;
};

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

/** Luogo ("" se non c'è). */
const locationOf = (event: { location?: unknown }) => (typeof event.location === "string" ? event.location.trim() : "");

/** Luogo del file al posto di quello che c'era (senza luogo nel file, l'evento non ne ha). */
const withLocation = <T extends CalendarEvent>(event: T, location: string | undefined): T => {
  if (location) return { ...event, location };
  const copy = { ...event };
  delete copy.location;
  return copy;
};

/**
 * Stato dopo il file: saltato se il file lo dice; un file di StudyOS che dice «non saltato» toglie solo
 * «saltato» (fatto, in corso restano); un file che non lo sa lascia lo stato di qui.
 */
const statusFrom = (skipped: boolean | undefined, current: CalendarEvent["status"] | undefined): CalendarEvent["status"] => {
  if (skipped === true) return "skipped";
  if (skipped === false && current === "skipped") return "planned";
  return current ?? "planned";
};

/** Colore scelto a mano nel file: vale sopra quello della tipologia o della materia. */
const customColor = (item: Pick<IcsImportItem, "color" | "colorCustom">) => (item.colorCustom ? safeCssColor(item.color) : "");

/** Il colore del file (se ce n'è uno scelto a mano) è già quello dell'evento? */
const sameColor = (event: CalendarEvent, item: Pick<IcsImportItem, "color" | "colorCustom">) => {
  const color = customColor(item);
  return !color || (event.colorCustom === true && String(event.color ?? "").toLowerCase() === color.toLowerCase());
};

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
  const liveMasters = own.filter((event) => !isOccurrenceRow(event) && !event.archived);
  const cuts = splitCutsOf(liveMasters, fallbackZone);
  // Divisioni fatte in StudyOS ("questa e le successive"): le figlie di ogni serie.
  const childrenOf = new Map<string, CalendarEvent[]>();
  for (const event of liveMasters) {
    const parentId = parentIdOf(event);
    if (parentId) childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), event]);
  }

  const puts = new Map<string, CalendarEvent>();
  const deletes = new Set<string>();
  const created = new Set<string>();
  const touched = new Set<string>();
  const relinked = new Map<string, string>();
  const capped: { title: string; read: number }[] = [];
  const keptLegacy: string[] = [];
  let rowBudget = MAX_ROWS;
  // Righe messe da una serie del file, e righe importate prima che una serie non ha più messo (riga ->
  // serie): queste si tolgono solo alla fine, perché lo stesso giorno può arrivare con un altro UID
  // (la madre di una divisione e la figlia esportata da StudyOS).
  const placed = new Set<string>();
  const stale = new Map<string, string>();
  /** Serie locale di ogni UID del file, e le figlie che nel file dicono chi è la madre. */
  const masterOf = new Map<string, string>();
  const parentLinks: [string, string, string | undefined][] = [];
  /** Figlie nuove (create da questo import) di una serie che c'era già: non sono una copia nuova. */
  const joinsExisting = new Set<string>();
  /** Serie che avevi già, divise da questo file: titolo e giorno da cui decide la parte nuova. */
  const splitExisting: [string, string][] = [];
  /** Serie che avevi già con una parte nuova nel file che non si collega (resta a sé). */
  const keptApart: string[] = [];
  const nowMs = Date.parse(now);
  const today = civilDateOf(Number.isNaN(nowMs) ? Date.now() : nowMs, fallbackZone);
  const put = (event: CalendarEvent) => puts.set(event.id, event);

  // Impronte (sourceStamp): l'evento com'è nel file, e come l'import lo scrive. Al prossimo import un file
  // uguale lascia le modifiche fatte qui; un file cambiato le sostituisce, e lo si dice (`editsReplaced`).
  /** Eventi modificati qui che il file cambiato sostituisce: id -> titolo di adesso. */
  const replacedEdits = new Map<string, string>();
  const fileStamp = (item: IcsImportItem) =>
    hashText(
      JSON.stringify([
        item.title.trim(),
        item.description.trim(),
        item.location ?? "",
        customColor(item).toLowerCase(),
        item.start,
        item.end,
        item.allDay,
        item.timeZone ?? "",
        item.repeat ?? null,
        item.reminders ?? null,
        item.skipped ?? null
      ])
    );
  /**
   * I campi che l'import scrive, come si vedono: titolo, descrizione, luogo, colore scelto, orari, regola
   * (senza la fine: una divisione fatta qui la sposta, e l'import la rispetta), promemoria, e «saltato» se
   * il file lo dice.
   */
  const eventStamp = (event: CalendarEvent, withStatus: boolean) => {
    const timing = timingOf(event, fallbackZone);
    const rule = normalizeRepeat(event);
    return hashText(
      JSON.stringify([
        String(event.title ?? "").trim(),
        String(event.description ?? "").trim(),
        locationOf(event),
        event.colorCustom === true ? String(event.color ?? "").toLowerCase() : "",
        timing ? (timing.allDay ? [timing.startDate, timing.endDate] : [timing.startMs, timing.endMs]) : null,
        validZone(event.timeZone) ?? "",
        ruleKey(rule ? { ...rule, end: undefined } : null, timing?.startDate ?? ""),
        reminderKey(event, event.reminders),
        withStatus ? event.status === "skipped" : null
      ])
    );
  };
  const stamped = (event: CalendarEvent, item: IcsImportItem): CalendarEvent =>
    item.sourceUid ? { ...event, sourceStamp: `${fileStamp(item)}.${eventStamp(event, item.skipped !== undefined)}` } : event;

  const localMaster = (uid: string) => {
    const id = ownId(uid);
    const mine = id ? byId.get(id) : undefined;
    if (mine && !isOccurrenceRow(mine)) return mine;
    return bySource.get(sourceKey(uid));
  };
  /**
   * Serie che avevi già con questo UID, prima di questo import: anche un vecchio import diviso per giorno
   * della settimana (`uid#1`, `uid#3`), che `localMaster` non vede. Per i controlli sulle parti nuove.
   */
  const hadSeries = (uid: string) => localMaster(uid) ?? legacyGroups.get(uid)?.[0];

  const create = (item: IcsImportItem, extra: Partial<CalendarEvent> = {}) => {
    const base: CalendarEvent = {
      id: input.newId(item),
      createdAt: now,
      updatedAt: now,
      archived: false,
      tags: item.tags ?? [],
      title: item.title,
      description: item.description,
      ...(item.location ? { location: item.location } : {}),
      category: item.category ?? "lesson",
      ...(item.subjectId ? { subjectId: item.subjectId } : {}),
      color: item.color ?? DEFAULT_COLOR,
      ...(customColor(item) ? { color: customColor(item), colorCustom: true } : {}),
      priority: "medium",
      start: item.start,
      end: item.end,
      allDay: item.allDay,
      ...(item.timeZone ? { timeZone: item.timeZone } : {}),
      recurrence: "none",
      status: statusFrom(item.skipped, "planned"),
      checklist: [],
      attachmentIds: [],
      notes: "",
      links: [],
      ...(item.sourceUid ? { sourceUid: item.sourceUid } : {}),
      ...(item.reminders?.length ? { reminders: item.reminders } : {}),
      ...(item.occasion ? { occasion: item.occasion } : {}),
      ...extra
    };
    const event = stamped(item.repeat ? applyRepeatFields({ ...base, repeat: item.repeat }, { repeatChanged: true, timeZone: fallbackZone }) : base, item);
    put(event);
    created.add(event.id);
    return event;
  };

  /**
   * Evento aggiornato con i dati del file, o null se il file dice le stesse cose. Se il file non è cambiato
   * dall'ultimo import (stessa impronta), null anche se qui l'evento è stato modificato: le modifiche restano.
   */
  const updated = (existing: CalendarEvent, item: IcsImportItem, options: { rule: boolean; adopt?: string }) => {
    const previous = stampParts(existing.sourceStamp);
    if (!options.adopt && previous?.file === fileStamp(item)) return null;
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
    const status = statusFrom(item.skipped, existing.status);
    const same =
      !options.adopt &&
      !existing.archived &&
      status === existing.status &&
      String(existing.title ?? "").trim() === item.title.trim() &&
      sameDescription(existing, item.description) &&
      locationOf(existing) === (item.location ?? "") &&
      sameColor(existing, item) &&
      sameTiming(timing, incoming) &&
      !zoneChanged &&
      (!options.rule || ruleKey(current, timing?.startDate ?? "") === ruleKey(rule, incoming.startDate)) &&
      (item.reminders === undefined || reminderKey(existing, existing.reminders) === reminderKey(existing, item.reminders));
    if (same) return null;
    const next: CalendarEvent = withLocation(
      {
        ...existing,
        title: item.title,
        description: sameDescription(existing, item.description) ? existing.description : item.description,
        start: item.start,
        end: item.end,
        allDay: item.allDay,
        ...(item.timeZone ? { timeZone: item.timeZone } : {}),
        ...(item.reminders !== undefined ? { reminders: item.reminders } : {}),
        ...(customColor(item) ? { color: customColor(item), colorCustom: true } : {}),
        ...(options.adopt ? { sourceUid: options.adopt } : {}),
        status,
        archived: false,
        updatedAt: now
      },
      item.location
    );
    // Modificato qui dopo l'ultimo import (non è più come l'import l'aveva scritto): lo si dice prima.
    if (previous && previous.event !== eventStamp(existing, item.skipped !== undefined)) replacedEdits.set(existing.id, String(existing.title ?? ""));
    if (!options.rule) return stamped(next, item);
    return stamped(applyRepeatFields({ ...next, repeat: rule ?? undefined, repeatLegacy: undefined }, { repeatChanged: true, timeZone: fallbackZone }), item);
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
    // Stato del giorno: quello del file se lo sa (StudyOS), altrimenti quello che aveva già qui.
    const kept = previous && !previous.cancelled ? previous.status : row.status;
    return withLocation(
      {
        ...row,
        status: change.skipped === undefined ? kept ?? "planned" : statusFrom(change.skipped, row.status),
        title: change.title,
        description: change.description,
        start: change.start,
        end: change.end,
        allDay: change.allDay,
        ...(change.timeZone ? { timeZone: change.timeZone } : {}),
        ...(change.reminders !== undefined ? { reminders: change.reminders } : {}),
        ...(customColor(change) ? { color: customColor(change), colorCustom: true } : {})
      },
      change.location
    );
  };

  const sameRow = (current: CalendarEvent, desired: CalendarEvent) => {
    if (
      Boolean(current.cancelled) !== Boolean(desired.cancelled) ||
      current.sourceRecurrenceId !== desired.sourceRecurrenceId ||
      Boolean(current.sourceEdited) !== Boolean(desired.sourceEdited)
    )
      return false;
    if (desired.cancelled) return Boolean(current.archived);
    return (
      !current.archived &&
      current.status === desired.status &&
      String(current.title ?? "").trim() === String(desired.title ?? "").trim() &&
      sameDescription(current, String(desired.description ?? "")) &&
      locationOf(current) === locationOf(desired) &&
      (desired.colorCustom !== true || (current.colorCustom === true && String(current.color ?? "").toLowerCase() === String(desired.color ?? "").toLowerCase())) &&
      sameTiming(timingOf(current, fallbackZone), timingOf(desired, fallbackZone)) &&
      reminderKey(current, current.reminders) === reminderKey(current, desired.reminders)
    );
  };

  /** La serie e le figlie delle sue divisioni fatte in StudyOS, dalla madre in giù. */
  const familyOf = (master: CalendarEvent) => {
    const family = [master];
    const ids = new Set([master.id]);
    for (let index = 0; index < family.length; index += 1) {
      for (const child of childrenOf.get(family[index].id) ?? []) {
        if (ids.has(child.id)) continue;
        ids.add(child.id);
        family.push(child);
      }
    }
    return family;
  };

  /**
   * Righe della serie dal file (date escluse e giorni modificati). Un giorno dopo una divisione fatta
   * in StudyOS va alla figlia che lo mostra. `owned`: la serie è nel file, le righe importate non più
   * presenti si tolgono. Un giorno segnato come cambiato a mano (X-STUDYOS-EDITED) diventa una modifica
   * ricevuta (`sourceEdited`) solo se la serie nasce con questo import (una copia nuova) o se lo era già
   * con lo stesso UID; altrimenti è una modifica come le altre (un file estraneo non blocca giorni).
   */
  const applyRows = (
    master: CalendarEvent,
    uid: string,
    exdates: readonly string[],
    changes: readonly IcsImportItem[],
    owned: boolean,
    editedExdates: readonly string[] = []
  ) => {
    const timing = timingOf(master, fallbackZone);
    if (!timing) return;
    const dateOf = (rid: string | undefined) => {
      const day = DATE_ONLY.exec(rid ?? "");
      if (day) {
        const date = civilFromParts(Number(day[1]), Number(day[2]), Number(day[3]));
        return isCivilDate(date) ? date : undefined;
      }
      const match = DATE_TIME.exec(rid ?? "");
      if (!match) return undefined;
      return civilDateOf(utcMs(Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6] ?? 0)), timing.zone);
    };
    const entries = new Map<string, { rid: string; change: IcsImportItem | null; item?: IcsImportItem; edited: boolean }>();
    const editedSet = new Set(editedExdates);
    for (const rid of exdates) {
      const date = dateOf(rid);
      if (date) entries.set(date, { rid, change: null, edited: editedSet.has(rid) });
    }
    for (const change of changes) {
      const date = dateOf(change.sourceRecurrenceId);
      if (date) entries.set(date, { rid: change.sourceRecurrenceId as string, change: change.cancelled ? null : change, item: change, edited: Boolean(change.edited) });
    }
    // Troppi giorni per una serie (o per il file): si leggono i più vicini a oggi, con un avviso.
    let dates = [...entries.keys()].sort(compareText);
    const allowed = Math.max(0, Math.min(MAX_ROWS_PER_SERIES, rowBudget));
    if (dates.length > allowed) {
      const distance = (date: string) => Math.abs(civilDaysBetween(today, date));
      dates = [...dates].sort((a, b) => distance(a) - distance(b) || compareText(a, b)).slice(0, allowed).sort(compareText);
      capped.push({ title: master.title, read: allowed });
    }
    rowBudget -= dates.length;
    const family = familyOf(master).flatMap((member) => {
      const memberTiming = member === master ? timing : timingOf(member, fallbackZone);
      if (!memberTiming) return [];
      const days = instanceDays(normalizeRepeat(member), memberTiming.startDate, dates, cuts.get(member.id));
      return [{ member, timing: memberTiming, days, rows: rowsOf.get(member.id) ?? [] }];
    });
    let changed = false;
    for (const date of dates) {
      const { rid, change, item, edited } = entries.get(date) as { rid: string; change: IcsImportItem | null; item?: IcsImportItem; edited: boolean };
      const home = family.find((entry) => entry.days.has(date));
      if (!home) {
        // Non è un giorno della serie: una modifica diventa un evento singolo, una data esclusa non serve.
        if (item && !item.cancelled) standalone(uid, item);
        continue;
      }
      const id = occurrenceId(home.member.id, date);
      const current = puts.get(id) ?? byId.get(id) ?? home.rows.find((row) => row.originalDate === date);
      // Una modifica fatta a mano in questo calendario vince su ogni file.
      if (current && !current.sourceRecurrenceId) {
        placed.add(current.id);
        continue;
      }
      // Una modifica a mano ricevuta con una copia: la cambia solo un file segnato con lo stesso UID (una
      // copia più recente dell'originale); Google e gli altri file non la toccano.
      const received = current?.sourceEdited === true;
      if (current && received && !(edited && current.sourceUid === uid)) {
        placed.add(current.id);
        continue;
      }
      const fromFile = rowFor(home.member, home.timing, date, uid, rid, change, current);
      // Copia nuova = tutta la famiglia nasce con questo import: una figlia nuova di una serie che avevi già no.
      const fresh = created.has(home.member.id) && !joinsExisting.has(home.member.id);
      const desired = edited && (received || fresh) ? { ...fromFile, sourceEdited: true as const } : fromFile;
      placed.add(desired.id);
      if (current && current.id === desired.id && sameRow(current, desired)) continue;
      put(desired);
      changed = true;
    }
    if (owned) {
      // Anche nelle figlie, qualunque file le abbia messe: vale l'ultimo file della famiglia.
      for (const entry of family) {
        for (const row of entry.rows) {
          // Le modifiche ricevute con una copia restano finché un file segnato non le cambia.
          if (!row.sourceRecurrenceId || row.sourceEdited === true || placed.has(row.id) || puts.has(row.id)) continue;
          stale.set(row.id, master.id);
        }
      }
    }
    if (changed && !created.has(master.id)) touched.add(master.id);
  };

  /**
   * Vecchio import diviso per giorno della settimana (`uid#1`, `uid#3`): le altre serie si uniscono a
   * quella tenuta (`next`, già con la regola del file). Giorni cancellati e modificati, note, materia,
   * liste e collegamenti passano a lei. Null se qualcosa andrebbe perso: allora resta tutto com'era.
   */
  const adoptSiblings = (keeper: CalendarEvent, next: CalendarEvent, siblings: readonly CalendarEvent[], item: IcsImportItem) => {
    // Divisioni fatte in StudyOS su un vecchio import: non si uniscono senza sorprese.
    if ([keeper, ...siblings].some((event) => parentIdOf(event) || childrenOf.has(event.id))) return null;
    const timing = timingOf(next, fallbackZone);
    if (!timing) return null;
    const rule = normalizeRepeat(next);
    const cut = cuts.get(keeper.id);
    const taken = new Set((rowsOf.get(keeper.id) ?? []).map((row) => row.originalDate));
    const rows: CalendarEvent[] = [];
    const removed: string[] = [];
    const relink = new Map<string, string>();
    let master = next;
    for (const sibling of siblings) {
      const differs = (key: "category" | "color" | "priority" | "status", fallback: string) => String(sibling[key] ?? fallback) !== String(master[key] ?? fallback);
      if (differs("category", "lesson") || differs("color", DEFAULT_COLOR) || differs("priority", "medium") || differs("status", "planned")) return null;
      if (FILLED_FIELDS.some((key) => sibling[key] && master[key] && sibling[key] !== master[key])) return null;
      if (item.reminders === undefined && JSON.stringify(sibling.reminders ?? []) !== JSON.stringify(master.reminders ?? [])) return null;
      const siblingTiming = timingOf(sibling, fallbackZone);
      const siblingRows = rowsOf.get(sibling.id) ?? [];
      // Le righe venute dal file tornano con il file; quelle dell'utente passano alla serie tenuta,
      // sullo stesso istante letto nel suo fuso.
      const mine = siblingRows.flatMap((row) => {
        if (row.sourceRecurrenceId || !isCivilDate(row.originalDate)) return [];
        const date =
          timing.allDay || !siblingTiming || siblingTiming.allDay
            ? row.originalDate
            : civilDateOf(civilAt(row.originalDate, siblingTiming.wall, siblingTiming.zone), timing.zone);
        return [{ row, date }];
      });
      const days = instanceDays(rule, timing.startDate, mine.map((entry) => entry.date), cut);
      for (const { row, date } of mine) {
        if (!days.has(date)) {
          // Un giorno cancellato che la serie non ha più non si vedrebbe comunque; uno modificato sì.
          if (row.cancelled) continue;
          return null;
        }
        if (taken.has(date)) return null;
        taken.add(date);
        const id = occurrenceId(keeper.id, date);
        rows.push({ ...row, id, seriesId: keeper.id, originalDate: date, updatedAt: now });
        relink.set(row.id, id);
      }
      removed.push(sibling.id, ...siblingRows.map((row) => row.id));
      relink.set(sibling.id, keeper.id);
      const notes = joinNotes(master.notes, sibling.notes);
      const lists = {
        checklist: unionList(master.checklist, sibling.checklist),
        links: unionList(master.links, sibling.links),
        attachmentIds: unionList(master.attachmentIds, sibling.attachmentIds),
        tags: unionList(master.tags, sibling.tags)
      };
      master = {
        ...master,
        ...(notes !== (master.notes ?? "") ? { notes } : {}),
        ...Object.fromEntries(FILLED_FIELDS.filter((key) => !master[key] && sibling[key]).map((key) => [key, sibling[key]])),
        ...Object.fromEntries(Object.entries(lists).filter(([, value]) => value !== undefined))
      };
    }
    return { master, rows, removed, relink };
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
    const existing = localMaster(uid);
    if (!existing) {
      // Vecchio import: una serie per giorno della settimana. Si tiene quella del giorno d'inizio (o
      // la prima) e le altre si uniscono a lei; se non si può senza perdere nulla, resta tutto com'era.
      const group = (legacyGroups.get(uid) ?? []).filter((event) => !deletes.has(event.id));
      if (group.length) {
        const startDay = timingOf(item, fallbackZone)?.startDate;
        const weekday = startDay ? civilWeekday(startDay) : -1;
        const dated = group.map((event) => ({ event, timing: timingOf(event, fallbackZone) }));
        const keeper =
          dated.find((entry) => entry.timing && civilWeekday(entry.timing.startDate) === weekday)?.event ??
          [...dated].sort((a, b) => (a.timing?.startMs ?? 0) - (b.timing?.startMs ?? 0))[0].event;
        const next = updated(keeper, item, { rule: true, adopt: uid });
        const siblings = group.filter((event) => event.id !== keeper.id);
        const adopted = next ? adoptSiblings(keeper, next, siblings, item) : null;
        if (!adopted) {
          keptLegacy.push(item.title);
          changes.delete(uid);
          continue;
        }
        put(adopted.master);
        touched.add(keeper.id);
        masterOf.set(uid, keeper.id);
        for (const row of adopted.rows) put(row);
        for (const id of adopted.removed) deletes.add(id);
        for (const [from, to] of adopted.relink) relinked.set(from, to);
        applyRows(adopted.master, uid, item.exdates ?? [], changes.get(uid) ?? [], true, item.editedExdates);
        changes.delete(uid);
        continue;
      }
    }
    let master: CalendarEvent;
    if (existing) {
      const next = updated(existing, item, { rule: true });
      if (next) {
        put(next);
        touched.add(existing.id);
      }
      master = next ?? existing;
    } else master = create(item);
    masterOf.set(uid, master.id);
    if (item.parentUid && uid.endsWith("@studyos")) {
      parentLinks.push([uid, item.parentUid, item.parentFrom]);
      if (created.has(master.id) && hadSeries(item.parentUid)) joinsExisting.add(master.id);
    }
    applyRows(master, uid, item.exdates ?? [], changes.get(uid) ?? [], true, item.editedExdates);
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

  // Figlie di una divisione fatta in StudyOS (RELATED-TO verso la madre): tornano nella famiglia anche in
  // un altro calendario, così il file della madre non ne ripete i giorni. True se la figlia è collegata.
  // `from` (X-STUDYOS-FROM): giorno da cui la figlia ferma la parte prima, se non è il suo primo (dopo uno
  // spostamento la parte prima tiene la sua ultima data spostata). Vale solo dopo il primo giorno della
  // madre e entro un anno dal primo giorno della figlia; altrimenti, e nei file senza, il suo primo giorno.
  const linkChild = (childId: string, parentUid: string, from: string | undefined) => {
    // Solo con la madre nello stesso file: un file con la sola figlia non taglia una serie che hai già.
    const parentId = masterOf.get(parentUid);
    const child = puts.get(childId) ?? byId.get(childId);
    const parent = parentId ? puts.get(parentId) ?? byId.get(parentId) : undefined;
    if (!child || !parent || parent.id === child.id || parentIdOf(child) || isOccurrenceRow(parent)) return false;
    const childTiming = timingOf(child, fallbackZone);
    const parentTiming = timingOf(parent, fallbackZone);
    if (!childTiming || !parentTiming || parentTiming.startDate >= childTiming.startDate) return false;
    const takeOver =
      from && isCivilDate(from) && from > parentTiming.startDate && Math.abs(civilDaysBetween(childTiming.startDate, from)) <= FROM_RANGE_DAYS ? from : childTiming.startDate;
    // Niente giri: la madre non può discendere dalla figlia.
    let ancestor: CalendarEvent | undefined = parent;
    for (let steps = 0; ancestor && ancestor.id !== child.id && steps < 100; steps += 1) {
      const next = parentIdOf(ancestor);
      ancestor = next ? puts.get(next) ?? byId.get(next) : undefined;
    }
    if (ancestor?.id === child.id) return false;
    const existed = !created.has(parent.id);
    if (existed) {
      // Una serie che avevi già si divide solo se nel file finisce da sé prima della parte nuova (come la
      // esporta StudyOS dopo una divisione): il file non la taglia oltre quello che dice la sua stessa riga.
      // Il collegamento serve perché il calendario ufficiale, reimportato, non ne raddoppi i giorni (S6).
      const parentRule = normalizeRepeat(parent);
      const cut = cuts.get(parent.id);
      if (!parentRule) return false;
      if (runsInto(parentRule, parentTiming.startDate, takeOver) && !(cut !== undefined && cut <= takeOver)) return false;
    }
    put({ ...child, splitFrom: parent.id, originalDate: takeOver, ...(created.has(child.id) ? {} : { updatedAt: now }) });
    if (!created.has(child.id)) touched.add(child.id);
    if (existed) splitExisting.push([String(parent.title ?? ""), childTiming.startDate]);
    return true;
  };
  for (const [uid, parentUid, from] of parentLinks) {
    const childId = masterOf.get(uid) as string;
    if (linkChild(childId, parentUid, from) || !created.has(childId)) continue;
    // Parte nuova di una serie che hai già, rimasta a sé: lo si dice, perché può ripeterne i giorni.
    const yours = hadSeries(parentUid);
    if (yours) keptApart.push(String(yours.title ?? ""));
  }

  // Righe importate che nessuna serie del file ha messo: ora si possono togliere.
  for (const [id, masterId] of stale) {
    if (placed.has(id) || puts.has(id)) continue;
    deletes.add(id);
    if (!created.has(masterId)) touched.add(masterId);
  }

  for (const id of created) touched.delete(id);
  const warnings: string[] = [];
  if (keptLegacy.length) warnings.push(ICS_TEXT.legacyKept([...new Set(keptLegacy)]));
  const byRead = new Map<number, string[]>();
  for (const { title, read } of capped) byRead.set(read, [...(byRead.get(read) ?? []), title]);
  for (const [read, titles] of byRead) warnings.push(ICS_TEXT.tooManyRows([...new Set(titles)], read));
  for (const [title, date] of splitExisting) warnings.push(ICS_TEXT.splitsExisting(title, date));
  for (const title of new Set(keptApart)) warnings.push(ICS_TEXT.partKeptApart(title));
  // Solo gli eventi che questo import scrive davvero (un vecchio import che resta com'era no).
  const replaced = [...replacedEdits].filter(([id]) => puts.has(id));
  if (replaced.length) warnings.push(ICS_TEXT.editsReplaced(replaced.map(([, title]) => title)));
  return {
    puts: [...puts.values()],
    deletes: [...deletes].filter((id) => !puts.has(id)),
    added: created.size,
    updated: touched.size,
    relinked,
    warnings,
    editsReplaced: replaced.length
  };
};
