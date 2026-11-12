// Calcoli puri del selettore di data e ora (src/components/DatePicker.tsx): griglia del mese, tastiera,
// limiti, orari, lettura dell'ora scritta, formati italiani. Date come "YYYY-MM-DD" e calcoli in UTC:
// il cambio dell'ora non sposta mai un giorno.
import { DATE_PICKER_TEXT } from "./labels";

const pad = (value: number) => String(value).padStart(2, "0");

/** "YYYY-MM-DD" → anno, mese (0-11), giorno; null se non è una data vera. */
export function parseYmd(value: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return { year, month, day };
}

/** Anno, mese (0-11) e giorno → "YYYY-MM-DD" (i valori fuori misura scorrono: 32 gennaio = 1 febbraio). */
export function toYmd(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  return `${String(date.getUTCFullYear()).padStart(4, "0")}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

const partsOf = (ymd: string) => parseYmd(ymd) ?? { year: 1970, month: 0, day: 1 };

/** Data di oggi nell'ora LOCALE del dispositivo. */
export const todayYmd = (now: Date = new Date()) => `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

export const daysInMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** Giorno della settimana con lunedì = 0 … domenica = 6. */
export function weekdayIndex(ymd: string) {
  const { year, month, day } = partsOf(ymd);
  return (new Date(Date.UTC(year, month, day)).getUTCDay() + 6) % 7;
}

export function addDays(ymd: string, days: number) {
  const { year, month, day } = partsOf(ymd);
  return toYmd(year, month, day + days);
}

/** Stesso giorno N mesi dopo; se non esiste, l'ultimo del mese (31 gennaio + 1 = 28 o 29 febbraio). */
export function addMonths(ymd: string, months: number) {
  const { year, month, day } = partsOf(ymd);
  const target = new Date(Date.UTC(year, month + months, 1));
  const targetYear = target.getUTCFullYear();
  const targetMonth = target.getUTCMonth();
  return toYmd(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
}

export const addYears = (ymd: string, years: number) => addMonths(ymd, years * 12);

/** Giorni dal primo all'ultimo, entrambi compresi (partenza e ritorno di una vacanza). */
export function daysInclusive(start: string, end: string) {
  const a = partsOf(start);
  const b = partsOf(end);
  return Math.round((Date.UTC(b.year, b.month, b.day) - Date.UTC(a.year, a.month, a.day)) / 86_400_000) + 1;
}

export const isOutOfRange = (ymd: string, min?: string, max?: string) => Boolean((min && ymd < min) || (max && ymd > max));

export function clampYmd(ymd: string, min?: string, max?: string) {
  if (min && ymd < min) return min;
  if (max && ymd > max) return max;
  return ymd;
}

export type GridDay = {
  ymd: string;
  day: number;
  /** 0 = lunedì … 6 = domenica. */
  weekday: number;
  /** false per i giorni del mese prima o dopo, mostrati attenuati. */
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  disabled: boolean;
  inRange: boolean;
  rangeStart: boolean;
  rangeEnd: boolean;
};

/**
 * Griglia di un mese (0-11): sempre 6 settimane da lunedì a domenica, con i giorni dei mesi vicini in
 * testa e in coda, così il pannello non cambia altezza passando da un mese all'altro.
 */
export function monthGrid(
  year: number,
  month: number,
  {
    today,
    selected,
    min,
    max,
    range
  }: { today?: string; selected?: string; min?: string; max?: string; range?: { start: string; end: string } } = {}
): { weeks: GridDay[][] } {
  const first = toYmd(year, month, 1);
  const start = addDays(first, -weekdayIndex(first));
  const weeks: GridDay[][] = [];
  for (let row = 0; row < 6; row += 1) {
    const week: GridDay[] = [];
    for (let column = 0; column < 7; column += 1) {
      const ymd = addDays(start, row * 7 + column);
      const parts = partsOf(ymd);
      const inRange = Boolean(range && ymd >= range.start && ymd <= range.end);
      week.push({
        ymd,
        day: parts.day,
        weekday: column,
        inMonth: parts.month === month && parts.year === year,
        isToday: ymd === today,
        isSelected: ymd === selected,
        disabled: isOutOfRange(ymd, min, max),
        inRange,
        rangeStart: inRange && ymd === range?.start,
        rangeEnd: inRange && ymd === range?.end
      });
    }
    weeks.push(week);
  }
  return { weeks };
}

/**
 * Giorno da mettere a fuoco dopo un tasto: frecce ±1 giorno e ±1 settimana, Pagina su/giù ±1 mese
 * (con Maiusc ±1 anno), Home/End inizio e fine della settimana. Sempre dentro min/max; null = tasto
 * che la griglia non gestisce.
 */
export function moveByKey(ymd: string, key: string, { shiftKey = false, min, max }: { shiftKey?: boolean; min?: string; max?: string } = {}) {
  let next: string;
  if (key === "ArrowLeft") next = addDays(ymd, -1);
  else if (key === "ArrowRight") next = addDays(ymd, 1);
  else if (key === "ArrowUp") next = addDays(ymd, -7);
  else if (key === "ArrowDown") next = addDays(ymd, 7);
  else if (key === "PageUp") next = shiftKey ? addYears(ymd, -1) : addMonths(ymd, -1);
  else if (key === "PageDown") next = shiftKey ? addYears(ymd, 1) : addMonths(ymd, 1);
  else if (key === "Home") next = addDays(ymd, -weekdayIndex(ymd));
  else if (key === "End") next = addDays(ymd, 6 - weekdayIndex(ymd));
  else return null;
  return clampYmd(next, min, max);
}

/**
 * Giorno che diventa "a fuoco" quando un pulsante della griglia riceve il focus. Da tastiera il mese
 * segue il giorno (anche uno grigio del mese prima o dopo); con un tocco o un clic no: cambiare mese
 * mentre il dito è giù sposterebbe la griglia e il clic finirebbe altrove. Il clic sceglie il giorno
 * e solo dopo mostra il suo mese. null = nulla da spostare.
 */
export const focusMovesTo = (ymd: string, focusDay: string, byPointer: boolean) => (byPointer || ymd === focusDay ? null : ymd);

/** Lo stesso giorno in un altro mese e anno (l'ultimo del mese se non esiste), dentro i limiti. */
export function jumpTo(ymd: string, year: number, month: number, { min, max }: { min?: string; max?: string } = {}) {
  const { day } = partsOf(ymd);
  return clampYmd(toYmd(year, month, Math.min(day, daysInMonth(year, month))), min, max);
}

/** Mese interamente fuori dai limiti (non si può scegliere). */
export const monthDisabled = (year: number, month: number, min?: string, max?: string) =>
  Boolean((min && toYmd(year, month, daysInMonth(year, month)) < min) || (max && toYmd(year, month, 1) > max));

export const yearDisabled = (year: number, min?: string, max?: string) =>
  Boolean((min && `${year}-12-31` < min) || (max && `${year}-01-01` > max));

/** Pagina di 12 anni che contiene `year` (2016–2027 per il 2026): si scorre a pagine con ‹ ›. */
export function yearPage(year: number, size = 12) {
  const start = Math.floor(year / size) * size;
  return Array.from({ length: size }, (_, index) => start + index);
}

/** Orari del giorno ogni `step` minuti ("00:00" … "23:45"). */
export const timeSlots = (step = 15) =>
  Array.from({ length: Math.floor((24 * 60) / step) }, (_, index) => `${pad(Math.floor((index * step) / 60))}:${pad((index * step) % 60)}`);

const minutesOf = (time: string) => {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** Orario della lista più vicino a `time` (senza passare al giorno dopo); "09:00" se non è un orario. */
export function nearestSlot(time: string, step = 15) {
  const minutes = minutesOf(time);
  if (minutes === null) return "09:00";
  const slot = Math.min(Math.round(minutes / step) * step, 24 * 60 - step);
  return `${pad(Math.floor(slot / 60))}:${pad(slot % 60)}`;
}

/**
 * Ora scritta a mano → "HH:mm": "9.30", "930", "09:30", "14,15", "9h30", "9". null se non è un'ora
 * del giorno (24:00, 9:75) o se è ambigua ("9:5").
 */
export function parseTime(text: string): string | null {
  const value = text.trim().toLowerCase();
  let hours: number;
  let minutes: number;
  const separated = /^(\d{1,2})\s*[:.,h]\s*(\d{2})$/.exec(value);
  if (separated) {
    hours = Number(separated[1]);
    minutes = Number(separated[2]);
  } else if (/^\d{1,4}$/.test(value)) {
    hours = Number(value.length <= 2 ? value : value.slice(0, -2));
    minutes = value.length <= 2 ? 0 : Number(value.slice(-2));
  } else {
    return null;
  }
  if (hours > 23 || minutes > 59) return null;
  return `${pad(hours)}:${pad(minutes)}`;
}

/** Orario della lista da mostrare al centro: quello scritto nel campo se è un'ora, se no quello scelto (o le 9). */
export const slotInView = (typed: string, value: string, step = 15) => nearestSlot(parseTime(typed) ?? (value || "09:00"), step);

export type TypedTimeCheck = { status: "empty" | "invalid" | "early" } | { status: "ok"; time: string };

/**
 * Ora scritta nel campo, controllata prima di salvare o di chiudere con "Fatto": vuota (nulla da salvare),
 * non valida, prima di `minTime` oppure buona (normalizzata "HH:mm").
 */
export function checkTypedTime(typed: string, minTime?: string): TypedTimeCheck {
  if (!typed.trim()) return { status: "empty" };
  const time = parseTime(typed);
  if (!time) return { status: "invalid" };
  if (minTime && time < minTime) return { status: "early" };
  return { status: "ok", time };
}

/** Valore locale "YYYY-MM-DDTHH:mm" (come `datetime-local`) → data e ora; null se vuoto o non valido. */
export function splitDateTime(value: string): { date: string; time: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(value);
  const minutes = match ? minutesOf(match[2]) : null;
  if (!match || !parseYmd(match[1]) || minutes === null || minutes >= 24 * 60) return null;
  return { date: match[1], time: match[2] };
}

export const joinDateTime = (date: string, time: string) => `${date}T${time}`;

/** "gio 12 nov 2026" (con `year: false` "gio 12 nov"). */
export function formatDateShort(ymd: string, { year = true }: { year?: boolean } = {}) {
  const parts = partsOf(ymd);
  const text = `${DATE_PICKER_TEXT.weekdaysShort[weekdayIndex(ymd)]} ${parts.day} ${DATE_PICKER_TEXT.monthsShort[parts.month]}`;
  return year ? `${text} ${parts.year}` : text;
}

/** Nome completo per gli screen reader: "giovedì 12 novembre 2026". */
export function formatDateLong(ymd: string) {
  const parts = partsOf(ymd);
  return `${DATE_PICKER_TEXT.weekdaysLong[weekdayIndex(ymd)]} ${parts.day} ${DATE_PICKER_TEXT.monthsLong[parts.month]} ${parts.year}`;
}

/** "novembre 2026" */
export const formatMonthTitle = (year: number, month: number) => `${DATE_PICKER_TEXT.monthsLong[month]} ${year}`;

const sameYear = (a: string, b: string) => a.slice(0, 4) === b.slice(0, 4);

/** Testo del campo: giorno della settimana e data sempre, l'anno solo se non è quello in corso. */
export const formatDateField = (ymd: string, today: string) => formatDateShort(ymd, { year: !sameYear(ymd, today) });

/** "gio 12 nov, 10:00" ("" se vuoto; senza ora per gli eventi di tutto il giorno). */
export function formatDateTimeField(value: string, today: string, { allDay = false }: { allDay?: boolean } = {}) {
  const parts = splitDateTime(value);
  if (!parts) return "";
  const date = formatDateField(parts.date, today);
  return allDay ? date : `${date}, ${parts.time}`;
}

/** Più giorni: "ven 4 – dom 6 dic", "lun 30 nov – mer 2 dic", "mer 30 dic 2026 – sab 2 gen 2027". */
export function formatRangeField(start: string, end: string, today: string) {
  if (start === end) return formatDateField(start, today);
  const a = partsOf(start);
  const b = partsOf(end);
  const showYear = !sameYear(start, end) || !sameYear(start, today);
  if (a.year === b.year && a.month === b.month) {
    return `${DATE_PICKER_TEXT.weekdaysShort[weekdayIndex(start)]} ${a.day} – ${formatDateShort(end, { year: showYear })}`;
  }
  if (a.year === b.year) return `${formatDateShort(start, { year: false })} – ${formatDateShort(end, { year: showYear })}`;
  return `${formatDateShort(start)} – ${formatDateShort(end)}`;
}

export type RangePick = { start: string; end: string; anchor: string | null };

/**
 * Scelta di più giorni sullo stesso calendario: il primo tocco fissa l'inizio (per ora un giorno solo),
 * il secondo la fine; se il secondo giorno viene prima, i due si scambiano. `done` = intervallo completo.
 */
export function pickRange(state: RangePick, day: string): RangePick & { done: boolean } {
  if (!state.anchor) return { start: day, end: day, anchor: day, done: false };
  return { ...previewRange(state.anchor, day), anchor: null, done: true };
}

/**
 * "Fatto" a metà scelta: con il solo inizio toccato si salva quel giorno; senza tocchi null (resta
 * l'intervallo di prima).
 */
export const finishRange = (state: RangePick) => (state.anchor ? { start: state.anchor, end: state.anchor } : null);

/** Intervallo in anteprima mentre si sceglie la fine (dito o puntatore su `day`). */
export const previewRange = (anchor: string, day: string) => (day < anchor ? { start: day, end: anchor } : { start: anchor, end: day });
