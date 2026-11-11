// Festività e ricorrenze italiane, calcolate (mai salvate, mai esportate, fuori dai riepiloghi).
// Date civili YYYY-MM-DD: lo stesso giorno in ogni fuso.
import { HOLIDAY_NAME } from "./labels/calendar";
import { civilAddDays, civilDateOf, civilFromParts, civilWeekday, daysInMonth, parseCivil } from "./tz";

export type HolidayKind = "national" | "celebration" | "clock";

export interface Holiday {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  /** "national" = festa nazionale (giorno festivo), "celebration" = ricorrenza non festiva, "clock" = cambio dell'ora. */
  kind: HolidayKind;
  /** Nome di un'icona di components/Icon.tsx. */
  icon: string;
}

/** Primo anno in cui San Francesco d'Assisi (4 ottobre) è festa nazionale: Legge 8 ottobre 2025 n. 151. */
const SAINT_FRANCIS_NATIONAL_FROM = 2026;
/** Oltre questo intervallo di anni holidaysInRange non calcola (nessuna vista ne chiede tanti). */
const MAX_YEARS = 200;

/** Domenica di Pasqua (calendario gregoriano, algoritmo anonimo di Meeus/Jones/Butcher). */
export const easterSunday = (year: number) => {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return civilFromParts(year, month, day);
};

/** Ultima domenica del mese. */
const lastSunday = (year: number, month: number) => {
  const last = civilFromParts(year, month, daysInMonth(year, month));
  return civilAddDays(last, -civilWeekday(last));
};

/** n-esima domenica del mese (1 = prima). */
const nthSunday = (year: number, month: number, nth: number) => {
  const first = civilFromParts(year, month, 1);
  return civilAddDays(first, ((7 - civilWeekday(first)) % 7) + 7 * (nth - 1));
};

const KIND_ORDER: Record<HolidayKind, number> = { national: 0, celebration: 1, clock: 2 };

/** Festività e ricorrenze dell'anno, in ordine di data (a parità: festa, ricorrenza, cambio dell'ora). */
export const italianHolidays = (year: number): Holiday[] => {
  if (!Number.isInteger(year) || year < 1583 || year > 9999) return [];
  const day = (month: number, date: number) => civilFromParts(year, month, date);
  const easter = easterSunday(year);
  const item = (date: string, name: string, kind: HolidayKind, icon: string): Holiday => ({ date, name, kind, icon });
  const list: Holiday[] = [
    item(day(1, 1), HOLIDAY_NAME.newYear, "national", "Sparkles"),
    item(day(1, 6), HOLIDAY_NAME.epiphany, "national", "Star"),
    item(civilAddDays(easter, -52), HOLIDAY_NAME.fatThursday, "celebration", "Sparkles"),
    item(day(2, 14), HOLIDAY_NAME.valentine, "celebration", "Sparkles"),
    item(civilAddDays(easter, -47), HOLIDAY_NAME.fatTuesday, "celebration", "Sparkles"),
    item(civilAddDays(easter, -46), HOLIDAY_NAME.ashWednesday, "celebration", "CircleDot"),
    item(day(3, 8), HOLIDAY_NAME.womensDay, "celebration", "Sparkles"),
    item(day(3, 19), HOLIDAY_NAME.fathersDay, "celebration", "Users"),
    item(civilAddDays(easter, -7), HOLIDAY_NAME.palmSunday, "celebration", "CircleDot"),
    item(lastSunday(year, 3), HOLIDAY_NAME.summerTime, "clock", "Clock"),
    item(easter, HOLIDAY_NAME.easter, "national", "Sun"),
    item(civilAddDays(easter, 1), HOLIDAY_NAME.easterMonday, "national", "Sun"),
    item(day(4, 25), HOLIDAY_NAME.liberation, "national", "Landmark"),
    item(day(5, 1), HOLIDAY_NAME.labour, "national", "Landmark"),
    item(nthSunday(year, 5, 2), HOLIDAY_NAME.mothersDay, "celebration", "Users"),
    item(day(6, 2), HOLIDAY_NAME.republic, "national", "Landmark"),
    item(day(8, 15), HOLIDAY_NAME.assumption, "national", "Sun"),
    item(day(10, 2), HOLIDAY_NAME.grandparents, "celebration", "Users"),
    item(day(10, 4), HOLIDAY_NAME.saintFrancis, year >= SAINT_FRANCIS_NATIONAL_FROM ? "national" : "celebration", "Landmark"),
    item(lastSunday(year, 10), HOLIDAY_NAME.winterTime, "clock", "Clock"),
    item(day(10, 31), HOLIDAY_NAME.halloween, "celebration", "Moon"),
    item(day(11, 1), HOLIDAY_NAME.allSaints, "national", "Star"),
    item(day(11, 2), HOLIDAY_NAME.allSouls, "celebration", "CircleDot"),
    item(day(12, 8), HOLIDAY_NAME.immaculate, "national", "Star"),
    item(day(12, 24), HOLIDAY_NAME.christmasEve, "celebration", "Star"),
    item(day(12, 25), HOLIDAY_NAME.christmas, "national", "Star"),
    item(day(12, 26), HOLIDAY_NAME.saintStephen, "national", "Star"),
    item(day(12, 31), HOLIDAY_NAME.newYearsEve, "celebration", "Sparkles")
  ];
  return list
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || KIND_ORDER[a.entry.kind] - KIND_ORDER[b.entry.kind] || a.index - b.index)
    .map(({ entry }) => entry);
};

/** Data civile da una stringa YYYY-MM-DD o da una Date (giorno locale del dispositivo). */
const civilOf = (value: string | Date) => {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : civilDateOf(value);
  return parseCivil(value) ? value : null;
};

/** Festività con data in [from, to): inizio compreso, fine esclusa (come le viste del calendario). */
export const holidaysInRange = (from: string | Date, to: string | Date): Holiday[] => {
  const start = civilOf(from);
  const end = civilOf(to);
  if (!start || !end || start >= end) return [];
  const firstYear = Number(start.slice(0, 4));
  const lastYear = Math.min(Number(end.slice(0, 4)), firstYear + MAX_YEARS);
  const result: Holiday[] = [];
  for (let year = firstYear; year <= lastYear; year += 1) {
    for (const holiday of italianHolidays(year)) if (holiday.date >= start && holiday.date < end) result.push(holiday);
  }
  return result;
};
