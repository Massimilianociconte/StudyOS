// Fusi orari IANA e date civili (YYYY-MM-DD) senza librerie esterne.
// - Con un fuso: ora "da orologio" <-> istante tramite Intl; nel buco del cambio d'ora l'orario
//   avanza (02:30 -> 03:30), nell'ora ripetuta vale la prima delle due (come RFC 5545).
// - Senza fuso: ora locale del dispositivo (Date), cioè il comportamento di sempre dell'app.
// - Le date civili sono stringhe YYYY-MM-DD: aritmetica sui giorni, nessun fuso coinvolto.

export interface WallTime {
  year: number;
  /** 1–12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

export interface ZonedParts extends WallTime {
  /** 0 = domenica … 6 = sabato */
  weekday: number;
}

const DAY_MS = 86_400_000;
const pad = (value: number, size = 2) => String(value).padStart(size, "0");

const formatters = new Map<string, Intl.DateTimeFormat>();

/** Formatter in cache per fuso (crearne uno è costoso). Lancia RangeError se il fuso non esiste. */
const formatterFor = (timeZone: string) => {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      weekday: "short",
      era: "short"
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
};

const WEEKDAY_INDEX: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Fuso del dispositivo (IANA), se il browser lo dice. */
export const deviceTimeZone = (): string | undefined => {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone ? zone : undefined;
  } catch {
    return undefined;
  }
};

/** Fuso IANA riconosciuto da questo dispositivo (i dati di altri possono contenere di tutto). */
export const isValidTimeZone = (zone: unknown): zone is string => {
  if (typeof zone !== "string" || !zone || zone.length > 64) return false;
  try {
    formatterFor(zone);
    return true;
  } catch {
    return false;
  }
};

/** Parti lette da Intl (lento: usato per gli scarti e nei giorni in cui lo scarto cambia). */
const intlParts = (ms: number, timeZone: string): ZonedParts => {
  const parts = formatterFor(timeZone).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const rawYear = Number(get("year"));
  const year = /^B/i.test(get("era")) ? 1 - rawYear : rawYear;
  return {
    year,
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    second: Number(get("second")),
    millisecond: ((ms % 1000) + 1000) % 1000,
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0
  };
};

/** Istante UTC di un'ora da orologio letta come se fosse UTC (anche per anni 0–99). */
const wallAsUtc = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0, millisecond = 0) => {
  const date = new Date(Date.UTC(2000, 0, 1, hour, minute, second, millisecond));
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
};

/** Scarto (ms) del fuso nell'istante: ora da orologio - UTC (al secondo, come Intl). */
export const timeZoneOffset = (instant: number, timeZone: string) => {
  const whole = Math.floor(instant / 1000) * 1000;
  const parts = intlParts(whole, timeZone);
  return wallAsUtc(parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second) - whole;
};

// Scarti in cache per (fuso, giorno UTC): un calendario chiede gli stessi giorni molte volte e Intl
// è lento. Un giorno vale solo se lo scarto è lo stesso all'inizio e alla fine (nessun cambio d'ora).
const dayOffsets = new Map<string, Map<number, number | null>>();
const MAX_CACHED_DAYS = 50_000;
/** Ultimo giorno (dal 1970) con l'intero giorno dentro le date valide di JavaScript. */
const MAX_DAY = 99_999_998;

/** Scarto costante per tutto il giorno UTC `day`, o null se in quel giorno cambia. */
const dayOffset = (timeZone: string, day: number) => {
  if (Math.abs(day) > MAX_DAY) return null;
  let days = dayOffsets.get(timeZone);
  if (!days) {
    days = new Map();
    dayOffsets.set(timeZone, days);
  }
  let offset = days.get(day);
  if (offset === undefined) {
    const first = timeZoneOffset(day * DAY_MS, timeZone);
    offset = first === timeZoneOffset((day + 1) * DAY_MS - 1000, timeZone) ? first : null;
    if (days.size >= MAX_CACHED_DAYS) days.clear();
    days.set(day, offset);
  }
  return offset;
};

/** Parti dell'ora da orologio di `instant` nel fuso (assente = fuso del dispositivo). */
export const utcToZonedParts = (instant: Date | number, timeZone?: string): ZonedParts => {
  const ms = typeof instant === "number" ? instant : instant.getTime();
  if (!timeZone) {
    const date = new Date(ms);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
      hour: date.getHours(),
      minute: date.getMinutes(),
      second: date.getSeconds(),
      millisecond: date.getMilliseconds(),
      weekday: date.getDay()
    };
  }
  formatterFor(timeZone); // fuso sconosciuto: RangeError, come prima
  const offset = Number.isFinite(ms) ? dayOffset(timeZone, Math.floor(ms / DAY_MS)) : null;
  if (offset === null) return intlParts(ms, timeZone);
  const shifted = new Date(ms + offset);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: ((ms % 1000) + 1000) % 1000,
    weekday: shifted.getUTCDay()
  };
};

const isFieldList = (wall: readonly number[] | Partial<WallTime>): wall is readonly number[] => Array.isArray(wall);

const toFields = (wall: readonly number[] | Partial<WallTime>) =>
  isFieldList(wall)
    ? [0, 1, 2, 3, 4, 5, 6].map((index) => Number(wall[index] ?? (index < 3 ? 1 : 0)))
    : [wall.year ?? 1970, wall.month ?? 1, wall.day ?? 1, wall.hour ?? 0, wall.minute ?? 0, wall.second ?? 0, wall.millisecond ?? 0].map(Number);

/**
 * Istante di un'ora da orologio (anno, mese 1–12, giorno, ore, minuti, secondi, ms) nel fuso.
 * Senza fuso: ora locale del dispositivo. Nel buco del cambio d'ora l'orario avanza della durata
 * del buco (02:30 -> 03:30); nell'ora ripetuta si usa la prima. Fuso sconosciuto: RangeError.
 */
export const zonedToUtc = (wall: readonly number[] | Partial<WallTime>, timeZone?: string): Date => {
  const [year, month, day, hour, minute, second, millisecond] = toFields(wall);
  if (!timeZone) {
    const local = new Date(year, month - 1, day, hour, minute, second, millisecond);
    if (year >= 0 && year < 100) local.setFullYear(year, month - 1, day);
    return local;
  }
  formatterFor(timeZone); // fuso sconosciuto: RangeError subito
  const guess = wallAsUtc(year, month, day, hour, minute, second, millisecond);
  // Via veloce: stesso scarto per tutto il giorno prima, quello e quello dopo -> un solo istante possibile.
  const guessDay = Math.floor(guess / DAY_MS);
  const steady = Number.isFinite(guess) ? dayOffset(timeZone, guessDay) : null;
  if (steady !== null && dayOffset(timeZone, guessDay - 1) === steady && dayOffset(timeZone, guessDay + 1) === steady) return new Date(guess - steady);
  const before = timeZoneOffset(guess - DAY_MS, timeZone);
  const offsets = new Set([before, timeZoneOffset(guess, timeZone), timeZoneOffset(guess + DAY_MS, timeZone)]);
  let best: number | undefined;
  for (const offset of offsets) {
    const candidate = guess - offset;
    if (timeZoneOffset(candidate, timeZone) === offset && (best === undefined || candidate < best)) best = candidate;
  }
  // Nessun istante ha quest'ora (buco): si usa lo scarto di prima del cambio, l'orario avanza.
  return new Date(best ?? guess - before);
};

// ---------------------------------------------------------------------------------------
// Date civili YYYY-MM-DD
// ---------------------------------------------------------------------------------------

const CIVIL = /^(\d{4})-(\d{2})-(\d{2})$/;

export const daysInMonth = (year: number, month: number) => new Date(wallAsUtc(year, month + 1, 0)).getUTCDate();

/** { anno, mese 1–12, giorno } di una data civile valida, altrimenti null. */
export const parseCivil = (value: unknown): { year: number; month: number; day: number } | null => {
  if (typeof value !== "string") return null;
  const match = CIVIL.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  return { year, month, day };
};

export const isCivilDate = (value: unknown): value is string => parseCivil(value) !== null;

export const civilFromParts = (year: number, month: number, day: number) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

/** Numero del giorno (giorni dal 1/1/1970) di una data civile; NaN se non valida. */
export const civilDayNumber = (value: string) => {
  const parts = parseCivil(value);
  return parts ? Math.round(wallAsUtc(parts.year, parts.month, parts.day) / DAY_MS) : Number.NaN;
};

/** Data civile del numero di giorno. */
export const civilFromDayNumber = (dayNumber: number) => {
  const date = new Date(dayNumber * DAY_MS);
  return civilFromParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
};

export const civilAddDays = (value: string, days: number) => civilFromDayNumber(civilDayNumber(value) + days);

/** Aggiunge mesi; se il giorno non esiste nel mese d'arrivo si usa l'ultimo (come date-fns addMonths). */
export const civilAddMonths = (value: string, months: number) => {
  const parts = parseCivil(value);
  if (!parts) return value;
  const index = parts.year * 12 + (parts.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = index - year * 12 + 1;
  return civilFromParts(year, month, Math.min(parts.day, daysInMonth(year, month)));
};

/** 0 = domenica … 6 = sabato */
export const civilWeekday = (value: string) => (((civilDayNumber(value) + 4) % 7) + 7) % 7;

export const civilDaysBetween = (from: string, to: string) => civilDayNumber(to) - civilDayNumber(from);

/** Data civile dell'istante nel fuso (assente = dispositivo). */
export const civilDateOf = (instant: Date | number, timeZone?: string) => {
  const parts = utcToZonedParts(instant, timeZone);
  return civilFromParts(parts.year, parts.month, parts.day);
};

/** Mezzanotte locale (dispositivo) della data civile: come parseISO("YYYY-MM-DD"). */
export const localMidnight = (value: string) => {
  const parts = parseCivil(value);
  if (!parts) return new Date(Number.NaN);
  return zonedToUtc([parts.year, parts.month, parts.day, 0, 0, 0, 0]);
};
