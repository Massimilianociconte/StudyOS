// Percorsi semplici "Nuova ricorrenza" (compleanno, anniversario…: ogni anno, tutto il giorno) e
// "Nuova vacanza" (un evento su più giorni): bozza ↔ campi dell'evento, errori, prossima volta. Puro.
import type { CalendarEvent, EventReminder, OccasionKind } from "../types";
import { eventTypeKey, typeDefaultColor, type TypeColorOverrides } from "./eventColors";
import { EVENT_EDITOR_TEXT, OCCASION_FORM_TEXT, VACATION_FORM_TEXT } from "./labels/calendar";
import { ageOn, allDayDays, allDayTimes, sanitizeOccasion, sanitizeReminders } from "./repeat";
import { civilAddDays, civilDateOf, civilDaysBetween, civilFromParts, daysInMonth, isCivilDate, isValidTimeZone, parseCivil } from "./tz";

export const OCCASION_KINDS: readonly OccasionKind[] = ["birthday", "anniversary", "holiday", "recurring-day"];

/** Promemoria proposto: il giorno stesso alle 9:00. */
const DEFAULT_OCCASION_REMINDERS: EventReminder[] = [{ at: "09:00" }];

export interface OccasionDraft {
  kind: OccasionKind;
  name: string;
  /** Giorno 1–31 e mese 1–12. */
  day: number;
  month: number;
  /** Anno di nascita o di inizio, come scritto ("" = nessuno). */
  year: string;
  notes: string;
  reminders: EventReminder[];
}

const isLeap = (year: number) => daysInMonth(year, 2) === 29;

/** Giorno della ricorrenza nell'anno `year`: il 29 febbraio, negli anni non bisestili, è il 28. */
const dateIn = (year: number, month: number, day: number) => civilFromParts(year, month, Math.min(day, daysInMonth(year, month)));

const yearOf = (draft: Pick<OccasionDraft, "year">) => (/^\d{4}$/.test(draft.year.trim()) ? Number(draft.year.trim()) : undefined);

/** Ora locale del giorno (YYYY-MM-DD) di un istante salvato (eventi con orario). */
const dayOf = (start: string) => {
  const date = new Date(start);
  return Number.isNaN(date.getTime()) ? "" : civilDateOf(date);
};

/**
 * Primo e ultimo giorno (compresi) di un evento salvato. Tutto il giorno: date nel fuso dell'evento
 * (`allDayDays`, lo stesso per tutti i moduli), mai in quello del dispositivo: un compleanno del 15/3
 * salvato a Roma resta il 15/3 aperto da Londra o New York.
 */
const daysOf = (event: Pick<CalendarEvent, "start" | "end" | "allDay" | "timeZone">) => {
  const days = event.allDay === true ? allDayDays(event) : null;
  if (days) return days;
  const first = dayOf(event.start);
  const end = dayOf(event.end);
  // La fine salvata è la mezzanotte dopo l'ultimo giorno.
  return { first, last: isCivilDate(first) && isCivilDate(end) && end > first ? civilAddDays(end, -1) : first };
};

/** Anno del primo giorno di una ricorrenza salvata (nel suo fuso). */
export const occasionStartYear = (event: Pick<CalendarEvent, "start" | "end" | "allDay" | "timeZone">) => parseCivil(daysOf(event).first)?.year;

const zoneOf = (event: Pick<CalendarEvent, "timeZone">) => (isValidTimeZone(event.timeZone) ? event.timeZone : undefined);

export const newOccasionDraft = ({ today, kind = "birthday", name = "" }: { today: string; kind?: OccasionKind; name?: string }): OccasionDraft => {
  const parts = parseCivil(today);
  return { kind, name, day: parts?.day ?? 1, month: parts?.month ?? 1, year: "", notes: "", reminders: [...DEFAULT_OCCASION_REMINDERS] };
};

/**
 * Nome dal titolo, per una ricorrenza senza `occasion.person` (creata dall'agente o importata): senza
 * "Compleanno di " o "Onomastico di " davanti, così salvando non si aggiunge un secondo prefisso.
 */
const nameFromTitle = (title: string) => {
  const trimmed = title.trim();
  const prefix = OCCASION_FORM_TEXT.titlePrefixes.find((item) => trimmed.toLowerCase().startsWith(item.toLowerCase()));
  return prefix ? trimmed.slice(prefix.length).trim() || trimmed : trimmed;
};

export const occasionDraftFromEvent = (event: CalendarEvent): OccasionDraft => {
  const occasion = sanitizeOccasion(event.occasion);
  const parts = parseCivil(daysOf(event).first);
  return {
    kind: occasion?.kind ?? "recurring-day",
    name: occasion?.person || nameFromTitle(event.title ?? ""),
    day: parts?.day ?? 1,
    month: parts?.month ?? 1,
    year: occasion?.birthYear ? String(occasion.birthYear) : "",
    notes: event.description ?? "",
    reminders: sanitizeReminders(event.reminders)
  };
};

/** Primo errore del modulo ricorrenza, "" se si può salvare. */
export const occasionError = (draft: OccasionDraft, today: string) => {
  if (!draft.name.trim()) return OCCASION_FORM_TEXT.nameMissing;
  const typed = draft.year.trim();
  const year = yearOf(draft);
  const current = parseCivil(today)?.year ?? new Date().getFullYear();
  if (typed && (year === undefined || year < 1 || year > current)) return OCCASION_FORM_TEXT.yearInvalid;
  const month = Math.trunc(draft.month);
  const day = Math.trunc(draft.day);
  // Senza anno vale anche il 29 febbraio (un anno bisestile qualsiasi).
  if (!(month >= 1 && month <= 12) || !(day >= 1 && day <= daysInMonth(year ?? 2024, month))) return OCCASION_FORM_TEXT.dayInvalid;
  return "";
};

/**
 * Primo giorno della serie: nell'anno `baseYear` (assente = quello di oggi; mai prima dell'anno
 * scritto). Il 29 febbraio parte dall'ultimo anno bisestile, così negli altri anni cade il 28.
 */
export const occasionStartDate = (draft: OccasionDraft, { today, baseYear }: { today: string; baseYear?: number }) => {
  const born = yearOf(draft);
  let year = Math.max(baseYear ?? parseCivil(today)?.year ?? new Date().getFullYear(), born ?? 0);
  if (draft.month === 2 && draft.day === 29) while (!isLeap(year)) year -= 1;
  return dateIn(year, draft.month, draft.day);
};

/** Prossima volta da oggi (compreso) e anni compiuti quel giorno (null senza anno). */
export const nextOccasion = (draft: OccasionDraft, today: string): { date: string; age: number | null } | null => {
  const now = parseCivil(today);
  if (!now || occasionError({ ...draft, name: draft.name || "x" }, today)) return null;
  const thisYear = dateIn(now.year, draft.month, draft.day);
  const date = thisYear >= today ? thisYear : dateIn(now.year + 1, draft.month, draft.day);
  return { date, age: ageOn(yearOf(draft), date) };
};

const occasionTitle = (kind: OccasionKind, name: string) => (kind === "birthday" ? OCCASION_FORM_TEXT.birthdayTitle(name) : name);

/**
 * Campi dell'evento: tutto il giorno, ogni anno, categoria Personale, la ricorrenza e i promemoria.
 * `keepColor` (modifica): il colore resta com'è (segue la tipologia se non scelto a mano).
 */
export const occasionFields = (
  draft: OccasionDraft,
  { today, baseYear, overrides, keepColor = false }: { today: string; baseYear?: number; overrides?: TypeColorOverrides; keepColor?: boolean }
): Partial<CalendarEvent> => {
  const name = draft.name.trim();
  const date = occasionStartDate(draft, { today, baseYear });
  const color = keepColor ? {} : { color: typeDefaultColor(eventTypeKey({ category: "personal", occasionKind: draft.kind }), { overrides }), colorCustom: false };
  return {
    title: occasionTitle(draft.kind, name),
    description: draft.notes.trim(),
    category: "personal",
    allDay: true,
    // Evento nuovo: il fuso è quello del dispositivo, che lo prende alla creazione.
    ...allDayTimes(date, date, undefined),
    repeat: { freq: "yearly" },
    occasion: sanitizeOccasion({ kind: draft.kind, person: name, birthYear: yearOf(draft) }),
    reminders: sanitizeReminders(draft.reminders),
    ...color
  };
};

const sameReminders = (a: readonly EventReminder[], b: readonly EventReminder[]) => JSON.stringify(sanitizeReminders(a)) === JSON.stringify(sanitizeReminders(b));

/** Inizio e fine (mezzanotti nel fuso dell'evento) del giorno `first` fino a `last` compreso, solo se cambiano. */
const dayChanges = (event: Pick<CalendarEvent, "start" | "end" | "timeZone">, first: string, last: string): Partial<CalendarEvent> => {
  const { start, end } = allDayTimes(first, last, zoneOf(event));
  return { ...(start !== event.start ? { start } : {}), ...(end !== event.end ? { end } : {}) };
};

/**
 * `from` sostituito da `to` solo dove è una parola intera: "Al" → "Bo" non cambia "Alberto" né "Alì".
 * Lettere, cifre e accenti attaccati non fanno da confine; `to` resta com'è scritto (anche con "$").
 */
const replaceWord = (text: string, from: string, to: string) => {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}\\p{M}])${escaped}(?![\\p{L}\\p{N}\\p{M}])`, "gu"), () => to);
};

/**
 * Campi da salvare modificando una ricorrenza: solo ciò che il modulo ha cambiato (`before` è la
 * bozza all'apertura, `after` quella salvata), {} se nulla. Mai la categoria, il colore o la regola.
 * Il titolo cambia solo con il nome o il tipo: se era quello di sempre ("Compleanno di …") si
 * riscrive, se è stato scelto a mano vi si sostituisce il nome. I promemoria solo se toccati.
 */
export const occasionChanges = (
  event: CalendarEvent,
  before: OccasionDraft,
  after: OccasionDraft,
  { today, baseYear }: { today: string; baseYear?: number }
): Partial<CalendarEvent> => {
  const changes: Partial<CalendarEvent> = {};
  const oldName = before.name.trim();
  const name = after.name.trim();
  const nameChanged = name !== oldName;
  const kindChanged = after.kind !== before.kind;
  const yearChanged = after.year.trim() !== before.year.trim();
  if (nameChanged || kindChanged) {
    const title = event.title ?? "";
    const derived = !title.trim() || title === occasionTitle(before.kind, oldName) || title === oldName;
    const next = derived ? occasionTitle(after.kind, name) : nameChanged && oldName ? replaceWord(title, oldName, name) : title;
    if (next !== title) changes.title = next;
  }
  if (nameChanged || kindChanged || yearChanged) {
    changes.occasion = sanitizeOccasion({ ...sanitizeOccasion(event.occasion), kind: after.kind, person: name, birthYear: yearOf(after) });
  }
  if (after.day !== before.day || after.month !== before.month || yearChanged) {
    const date = occasionStartDate(after, { today, baseYear });
    Object.assign(changes, dayChanges(event, date, date));
  }
  if (after.notes.trim() !== before.notes.trim()) changes.description = after.notes.trim();
  if (!sameReminders(after.reminders, before.reminders)) changes.reminders = sanitizeReminders(after.reminders);
  return changes;
};

// ---------------------------------------------------------------------------------------
// Vacanza
// ---------------------------------------------------------------------------------------

export interface VacationDraft {
  title: string;
  /** Primo e ultimo giorno compresi (YYYY-MM-DD). */
  first: string;
  last: string;
  destination: string;
  notes: string;
  reminders: EventReminder[];
}

export const newVacationDraft = (today: string, title = ""): VacationDraft => ({ title, first: today, last: today, destination: "", notes: "", reminders: [] });

export const vacationDraftFromEvent = (event: CalendarEvent): VacationDraft => {
  const { first, last } = daysOf(event);
  return {
    title: event.title ?? "",
    first,
    last,
    destination: typeof event.location === "string" ? event.location : "",
    notes: event.description ?? "",
    reminders: sanitizeReminders(event.reminders)
  };
};

/** Giorni di vacanza, partenza e ritorno compresi (0 se le date non vanno). */
export const vacationDays = (draft: Pick<VacationDraft, "first" | "last">) =>
  isCivilDate(draft.first) && isCivilDate(draft.last) && draft.last >= draft.first ? civilDaysBetween(draft.first, draft.last) + 1 : 0;

export const vacationError = (draft: VacationDraft) => {
  if (!draft.title.trim()) return VACATION_FORM_TEXT.nameMissing;
  if (!isCivilDate(draft.first) || !isCivilDate(draft.last)) return VACATION_FORM_TEXT.daysMissing;
  if (draft.last < draft.first) return EVENT_EDITOR_TEXT.lastDayBeforeFirst;
  return "";
};

/** Campi da salvare modificando una vacanza: solo ciò che il modulo ha cambiato, {} se nulla. Mai categoria o colore. */
export const vacationChanges = (event: CalendarEvent, before: VacationDraft, after: VacationDraft): Partial<CalendarEvent> => {
  const changes: Partial<CalendarEvent> = {};
  if (after.title.trim() !== before.title.trim()) changes.title = after.title.trim();
  if (after.first !== before.first || after.last !== before.last) Object.assign(changes, dayChanges(event, after.first, after.last));
  if (after.destination.trim() !== before.destination.trim()) changes.location = after.destination.trim() || undefined;
  if (after.notes.trim() !== before.notes.trim()) changes.description = after.notes.trim();
  if (!sameReminders(after.reminders, before.reminders)) changes.reminders = sanitizeReminders(after.reminders);
  return changes;
};

/** Campi dell'evento: un solo evento di tutto il giorno, dal primo all'ultimo giorno compresi. */
export const vacationFields = (draft: VacationDraft, { overrides, keepColor = false }: { overrides?: TypeColorOverrides; keepColor?: boolean } = {}): Partial<CalendarEvent> => {
  const destination = draft.destination.trim();
  const color = keepColor ? {} : { color: typeDefaultColor("vacation", { overrides }), colorCustom: false };
  return {
    title: draft.title.trim(),
    description: draft.notes.trim(),
    category: "vacation",
    allDay: true,
    // Evento nuovo: il fuso è quello del dispositivo, che lo prende alla creazione.
    ...allDayTimes(draft.first, draft.last, undefined),
    location: destination || undefined,
    reminders: sanitizeReminders(draft.reminders),
    ...color
  };
};
