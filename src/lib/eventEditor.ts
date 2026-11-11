// Logica del modulo evento (creazione e modifica), senza React: bozza ↔ campi dell'evento, modifiche
// da salvare, orari e "tutto il giorno", errori, promemoria, scelta "solo questo / successivi / tutti".
import type { CalendarEvent, EventCategory, EventReminder, RepeatRule } from "../types";
import { eventTypeKey, LEGACY_AUTO_COLOR, resolveEventColor, typeDefaultColor, type TypeColorOverrides } from "./eventColors";
import { EVENT_EDITOR_TEXT, MONTH_NAME, SCOPE_TEXT, WEEKDAY_NAME } from "./labels";
import { describeReminder, normalizeRepeat, sanitizeReminders, validateRepeat, type OccurrenceScope } from "./repeat";
import { adaptRuleToStart, weekdayOf } from "./repeatPicker";
import { CALENDAR_EVENT_FIELD_GROUPS, changedFields, safeCssColor } from "./sharing";
import { civilAddDays, civilDaysBetween, isCivilDate, localMidnight, parseCivil } from "./tz";

const MINUTE_MS = 60_000;
const pad = (value: number) => String(value).padStart(2, "0");

/** Data e ora locali "YYYY-MM-DDTHH:mm" (come `datetime-local`); "" se non valida. */
export const toLocalInput = (value: string | Date) => {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const dateOf = (local: string) => local.slice(0, 10);
const timeOf = (local: string) => local.slice(11, 16) || "00:00";
const localMs = (local: string) => (local ? new Date(local).getTime() : Number.NaN);
const withDate = (date: string, time: string) => `${date}T${time}`;

/**
 * Bozza del modulo. Con orario `start`/`end` sono ora locale; tutto il giorno contano le date, e
 * `end` ha l'ULTIMO giorno compreso (gli orari restano per quando si toglie "Tutto il giorno").
 */
export interface EventDraft {
  title: string;
  allDay: boolean;
  start: string;
  end: string;
  category: EventCategory;
  subjectId: string;
  /** Colore mostrato: quello della tipologia, o quello scelto a mano (`colorCustom`). */
  color: string;
  colorCustom: boolean;
  repeat: RepeatRule | null;
  reminders: EventReminder[];
  description: string;
  location: string;
  links: string[];
  priority: CalendarEvent["priority"];
  status: CalendarEvent["status"];
}

export interface ColorContext {
  subjectColor?: string;
  overrides?: TypeColorOverrides;
}

/** Tavolozza del modulo e di "Colori delle tipologie" (ogni colore ha un nome in EVENT_COLOR_NAME). */
export const EVENT_PALETTE = [
  "#EF4444",
  "#F97316",
  "#FACC15",
  "#A3E635",
  "#22C55E",
  "#14B8A6",
  "#7CF7C8",
  "#06B6D4",
  "#3B82F6",
  "#6366F1",
  "#A855F7",
  "#D946EF",
  "#EC4899",
  "#B45309",
  "#FFFFFF",
  "#D4D4D4"
] as const;

export const DEFAULT_DURATION = 60;
/** Durate proposte (minuti). */
export const DURATION_CHOICES = [15, 30, 45, 60, 90, 120, 180, 240] as const;

/** Bozza di un evento nuovo che inizia a `start` (un'ora). */
export const newEventDraft = ({
  start,
  subjectId = "",
  category = "study",
  subjectColor,
  overrides
}: { start: Date; subjectId?: string; category?: EventCategory } & ColorContext): EventDraft => ({
  title: "",
  allDay: false,
  start: toLocalInput(start),
  end: toLocalInput(new Date(start.getTime() + DEFAULT_DURATION * MINUTE_MS)),
  category,
  subjectId,
  color: typeDefaultColor(eventTypeKey({ category }), { subjectColor, overrides }),
  colorCustom: false,
  repeat: null,
  reminders: [],
  description: "",
  location: "",
  links: [],
  priority: "medium",
  status: "planned"
});

/**
 * Colore scelto a mano? `colorCustom` se c'è; per gli eventi di prima, sì solo se il colore non è
 * quello che l'app assegnava da sola (#7CF7C8 o il colore della materia).
 */
export const initialColorCustom = (event: Pick<CalendarEvent, "color" | "colorCustom">, subjectColor: string | undefined) => {
  if (typeof event.colorCustom === "boolean") return event.colorCustom;
  const own = safeCssColor(event.color).toLowerCase();
  if (!own) return false;
  return ![LEGACY_AUTO_COLOR.toLowerCase(), safeCssColor(subjectColor).toLowerCase()].includes(own);
};

/** Colore della bozza dopo un cambio di tipologia o materia: segue la tipologia se non è scelto a mano. */
export const draftColor = (draft: Pick<EventDraft, "category" | "color" | "colorCustom">, context: ColorContext) =>
  draft.colorCustom && safeCssColor(draft.color) ? safeCssColor(draft.color) : typeDefaultColor(eventTypeKey({ category: draft.category }), context);

/** Ultimo giorno (compreso) di un tutto il giorno salvato con fine esclusiva. */
const lastDayOf = (startLocal: string, endLocal: string) => {
  const startDate = dateOf(startLocal);
  const endDate = dateOf(endLocal);
  if (!isCivilDate(endDate) || endDate <= startDate) return startDate;
  return timeOf(endLocal) === "00:00" ? civilAddDays(endDate, -1) : endDate;
};

/**
 * Bozza da un evento (o da un'occorrenza: inizio e fine sono i suoi). `repeat`: la regola da
 * mostrare se diversa da quella dell'evento (es. la serie di una riga modificata).
 */
export const draftFromEvent = (event: CalendarEvent, { subjectColor, overrides, repeat }: ColorContext & { repeat?: RepeatRule | null } = {}): EventDraft => {
  const start = toLocalInput(event.start);
  const end = toLocalInput(event.end);
  const allDay = event.allDay === true;
  const colorCustom = initialColorCustom(event, subjectColor);
  return {
    title: event.title ?? "",
    allDay,
    start: allDay ? withDate(dateOf(start), "00:00") : start,
    end: allDay ? withDate(lastDayOf(start, end), "00:00") : end,
    category: event.category,
    subjectId: event.subjectId ?? "",
    color: resolveEventColor({
      category: event.category,
      occasionKind: event.occasion?.kind,
      subjectColor,
      color: event.color,
      colorCustom,
      overrides
    }),
    colorCustom,
    repeat: repeat !== undefined ? repeat : normalizeRepeat(event),
    reminders: sanitizeReminders(event.reminders),
    description: event.description ?? "",
    location: typeof event.location === "string" ? event.location : "",
    links: Array.isArray(event.links) ? [...event.links] : [],
    priority: event.priority ?? "medium",
    status: event.status ?? "planned"
  };
};

const isoOf = (local: string) => {
  const ms = localMs(local);
  return Number.isNaN(ms) ? local : new Date(ms).toISOString();
};

/** Inizio e fine da salvare: istanti; tutto il giorno, mezzanotti locali con fine esclusiva. */
export const draftTimes = (draft: Pick<EventDraft, "allDay" | "start" | "end">) => {
  if (!draft.allDay) return { start: isoOf(draft.start), end: isoOf(draft.end) };
  const first = dateOf(draft.start);
  const last = dateOf(draft.end);
  if (!isCivilDate(first)) return { start: draft.start, end: draft.end };
  const end = isCivilDate(last) && last >= first ? last : first;
  return { start: localMidnight(first).toISOString(), end: localMidnight(civilAddDays(end, 1)).toISOString() };
};

/**
 * Campi dell'evento dalla bozza. Sempre gli stessi campi (anche `repeat`, vuoto = non si ripete):
 * il confronto tra bozza iniziale e attuale (`editorChanges`) vede solo ciò che è cambiato.
 */
export const draftPatch = (draft: EventDraft): Partial<CalendarEvent> => {
  const times = draftTimes(draft);
  const location = draft.location.trim();
  return {
    title: draft.title.trim(),
    description: draft.description.trim(),
    category: draft.category,
    subjectId: draft.subjectId || undefined,
    priority: draft.priority,
    status: draft.status,
    start: times.start,
    end: times.end,
    allDay: draft.allDay,
    color: safeCssColor(draft.color) || draft.color,
    colorCustom: draft.colorCustom,
    repeat: draft.repeat ?? undefined,
    reminders: sanitizeReminders(draft.reminders),
    location: location || undefined,
    links: draft.links
  };
};

const EDITOR_GROUPS = [...CALENDAR_EVENT_FIELD_GROUPS, ["color", "colorCustom"]] as const;

/**
 * Campi cambiati tra la bozza all'apertura e quella attuale. Orari e ripetizione viaggiano insieme
 * (CALENDAR_EVENT_FIELD_GROUPS), ma solo i campi del modulo: mai `timeZone` o `repeatLegacy` vuoti.
 */
export const editorChanges = (before: Partial<CalendarEvent>, after: Partial<CalendarEvent>): Partial<CalendarEvent> => {
  const changes = changedFields(before, after, EDITOR_GROUPS) as Record<string, unknown>;
  return Object.fromEntries(Object.entries(changes).filter(([key]) => key in after)) as Partial<CalendarEvent>;
};

/** Primo errore del modulo, "" se si può salvare. */
export const validateDraft = (draft: EventDraft, { subjectRequired = false }: { subjectRequired?: boolean } = {}) => {
  if (!draft.title.trim()) return EVENT_EDITOR_TEXT.titleMissing;
  const first = dateOf(draft.start);
  if (!isCivilDate(first) || (!draft.allDay && Number.isNaN(localMs(draft.start)))) return EVENT_EDITOR_TEXT.dateMissing;
  if (draft.allDay) {
    const last = dateOf(draft.end);
    if (!isCivilDate(last)) return EVENT_EDITOR_TEXT.dateMissing;
    if (last < first) return EVENT_EDITOR_TEXT.lastDayBeforeFirst;
  } else {
    const end = localMs(draft.end);
    if (Number.isNaN(end) || end <= localMs(draft.start)) return EVENT_EDITOR_TEXT.endBeforeStart;
  }
  if (draft.repeat) {
    const checked = validateRepeat(draft.repeat);
    if (checked.ok && checked.rule.end?.type === "until" && checked.rule.end.date < first) return EVENT_EDITOR_TEXT.repeatEndsEarly;
  }
  if (subjectRequired && !draft.subjectId) return EVENT_EDITOR_TEXT.subjectMissing;
  return "";
};

/** Durata in minuti (con orario), 0 se non calcolabile. */
export const draftDuration = (draft: Pick<EventDraft, "start" | "end">) => {
  const minutes = Math.round((localMs(draft.end) - localMs(draft.start)) / MINUTE_MS);
  return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
};

export const setDraftDuration = <T extends EventDraft>(draft: T, minutes: number): T => {
  const start = localMs(draft.start);
  if (Number.isNaN(start)) return draft;
  return { ...draft, end: toLocalInput(new Date(start + minutes * MINUTE_MS)) };
};

/**
 * Nuovo inizio: la fine si sposta con la stessa durata (o, tutto il giorno, lo stesso numero di
 * giorni) e le ripetizioni legate al giorno della settimana seguono la nuova data.
 */
export const changeStart = <T extends EventDraft>(draft: T, next: string): T => {
  const oldDate = dateOf(draft.start);
  const newDate = dateOf(next);
  const repeat = isCivilDate(oldDate) && isCivilDate(newDate) ? adaptRuleToStart(draft.repeat, oldDate, newDate) : draft.repeat;
  if (draft.allDay) {
    const span = isCivilDate(oldDate) && isCivilDate(dateOf(draft.end)) ? Math.max(0, civilDaysBetween(oldDate, dateOf(draft.end))) : 0;
    const end = isCivilDate(newDate) ? withDate(civilAddDays(newDate, span), timeOf(draft.end)) : draft.end;
    return { ...draft, start: next, end, repeat };
  }
  const duration = localMs(draft.end) - localMs(draft.start);
  const startMs = localMs(next);
  const keep = Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_DURATION * MINUTE_MS;
  const end = Number.isNaN(startMs) ? draft.end : toLocalInput(new Date(startMs + keep));
  return { ...draft, start: next, end, repeat };
};

/**
 * "Tutto il giorno" acceso: valgono le date (l'ultimo giorno è quello della fine). Spento: si
 * ritrovano gli orari di prima se stanno nel primo giorno, altrimenti 9:00–10:00.
 */
export const setDraftAllDay = <T extends EventDraft>(draft: T, on: boolean): T => {
  if (on === draft.allDay) return draft;
  const first = dateOf(draft.start);
  if (on) {
    if (!isCivilDate(first)) return { ...draft, allDay: true };
    return { ...draft, allDay: true, end: withDate(lastDayOf(draft.start, draft.end), timeOf(draft.end)) };
  }
  const day = isCivilDate(first) ? first : toLocalInput(new Date()).slice(0, 10);
  const startTime = timeOf(draft.start);
  const start = withDate(day, startTime === "00:00" ? "09:00" : startTime);
  const sameDayEnd = withDate(day, timeOf(draft.end));
  const end = localMs(sameDayEnd) > localMs(start) ? sameDayEnd : toLocalInput(new Date(localMs(start) + DEFAULT_DURATION * MINUTE_MS));
  return { ...draft, allDay: false, start, end };
};

/** Sposta inizio e fine della modifica di `days` giorni (ora locale), il resto uguale. */
export const shiftPatchDays = (patch: Partial<CalendarEvent>, days: number): Partial<CalendarEvent> => {
  if (!days) return patch;
  const shift = (value: string | undefined) => {
    if (value === undefined) return undefined;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    date.setDate(date.getDate() + days);
    return date.toISOString();
  };
  return {
    ...patch,
    ...(patch.start !== undefined ? { start: shift(patch.start) } : {}),
    ...(patch.end !== undefined ? { end: shift(patch.end) } : {})
  };
};

/** Quale modulo apre l'evento: ricorrenza annuale, vacanza o modulo completo. */
export const editorFormFor = (event: Pick<CalendarEvent, "category" | "occasion">): "occasion" | "vacation" | "event" =>
  event.occasion ? "occasion" : (event.category as string) === "vacation" ? "vacation" : "event";

// ---------------------------------------------------------------------------------------
// Promemoria
// ---------------------------------------------------------------------------------------

const TIMED_REMINDERS: EventReminder[] = [{ minutesBefore: 0 }, { minutesBefore: 15 }, { minutesBefore: 60 }, { daysBefore: 1, at: "09:00" }];
const ALL_DAY_REMINDERS: EventReminder[] = [{ at: "09:00" }, { daysBefore: 1, at: "09:00" }, { daysBefore: 7, at: "09:00" }];

const reminderKey = (reminder: EventReminder) => {
  const [clean] = sanitizeReminders([reminder]);
  if (!clean) return "";
  // Stesso momento scritto in due modi (1 giorno = 1440 minuti) = stesso promemoria.
  if (clean.at) return `${clean.daysBefore ?? 0}@${clean.at}`;
  return String((clean.minutesBefore ?? 0) + (clean.daysBefore ?? 0) * 1440);
};

/** Scelte pronte: con orario o tutto il giorno. */
export const reminderChoices = (allDay: boolean) =>
  (allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS).map((reminder) => ({ key: reminderKey(reminder), label: describeReminder(reminder), reminder }));

export const hasReminder = (list: readonly EventReminder[], reminder: EventReminder) => list.some((item) => reminderKey(item) === reminderKey(reminder));

/** Aggiunge un promemoria valido, senza doppioni (al massimo 10). */
export const addReminder = (list: readonly EventReminder[], reminder: EventReminder): EventReminder[] => {
  const [clean] = sanitizeReminders([reminder]);
  if (!clean || hasReminder(list, clean)) return [...list];
  return sanitizeReminders([...list, clean]);
};

export const removeReminder = (list: readonly EventReminder[], index: number): EventReminder[] => list.filter((_, position) => position !== index);

/** Promemoria personalizzato: quanto prima e (per i giorni) a che ora; null se fuori dai limiti. */
export const customReminder = (amount: number, unit: "minutes" | "hours" | "days", at?: string): EventReminder | null => {
  if (!Number.isInteger(amount) || amount < 0) return null;
  const minutes = unit === "minutes" ? amount : unit === "hours" ? amount * 60 : amount * 1440;
  const reminder: EventReminder = unit === "days" && at ? { daysBefore: amount, at } : { minutesBefore: minutes };
  const [clean] = sanitizeReminders([reminder]);
  return clean ?? null;
};

// ---------------------------------------------------------------------------------------
// Solo questo · Questo e i successivi · Tutti
// ---------------------------------------------------------------------------------------

export type ScopeAction = "edit" | "move" | "delete";

export interface ScopeOption {
  id: OccurrenceScope;
  label: string;
  /** Conseguenze, in frasi brevi. */
  details: string[];
}

/** "giovedì 12 novembre" */
export const occurrenceDayText = (date: string) => {
  const parts = parseCivil(date);
  if (!parts) return date;
  return `${WEEKDAY_NAME[weekdayOf(date)]} ${parts.day} ${MONTH_NAME[parts.month - 1]}`;
};

/**
 * Opzioni della scelta per un evento che si ripete, con le conseguenze dette chiaramente.
 * - Cambiando la regola non c'è "Solo questo" (una data sola non ha una ripetizione).
 * - "Questo e i successivi": le modifiche ai singoli giorni dopo quella data si perdono se cambia
 *   l'orario, i giorni annullati restano annullati, le modifiche successive alla serie si sostituiscono.
 * - Eventi di altri (`sharedOnly`): solo "Tutti".
 */
export const scopeOptions = ({
  action,
  date,
  ruleChanged = false,
  timeChanged = false,
  subjectChanged = false,
  pinsZone,
  sharedOnly = false
}: {
  action: ScopeAction;
  date: string;
  ruleChanged?: boolean;
  timeChanged?: boolean;
  subjectChanged?: boolean;
  /** La serie non ha un fuso: la prima modifica di un giorno lo fissa (quello del dispositivo). */
  pinsZone?: string;
  sharedOnly?: boolean;
}): ScopeOption[] => {
  const day = occurrenceDayText(date);
  const pin = pinsZone ? [SCOPE_TEXT.pinZone(pinsZone)] : [];
  const all: ScopeOption = {
    id: "all",
    label: SCOPE_TEXT.all,
    details: sharedOnly
      ? [SCOPE_TEXT.sharedAll]
      : action === "delete"
        ? [SCOPE_TEXT.allDelete]
        : [action === "move" ? SCOPE_TEXT.allMove : SCOPE_TEXT.allEdit, SCOPE_TEXT.allRows, ...pin]
  };
  if (sharedOnly) return [all];
  const options: ScopeOption[] = [];
  if (!(action === "edit" && ruleChanged)) {
    const text = action === "delete" ? SCOPE_TEXT.thisDelete(day) : action === "move" ? SCOPE_TEXT.thisMove(day) : SCOPE_TEXT.thisEdit(day);
    options.push({ id: "this", label: SCOPE_TEXT.this, details: [text, ...(action === "edit" && subjectChanged ? [SCOPE_TEXT.thisSubject] : []), ...pin] });
  }
  const following =
    action === "delete"
      ? [SCOPE_TEXT.followingDelete(day)]
      : [
          action === "move" ? SCOPE_TEXT.followingMove(day) : SCOPE_TEXT.followingEdit(day),
          timeChanged ? SCOPE_TEXT.followingTimeChanged : SCOPE_TEXT.followingSameTime,
          SCOPE_TEXT.followingSplits,
          ...(ruleChanged ? [] : [SCOPE_TEXT.followingKeepsEnd]),
          ...pin
        ];
  options.push({ id: "following", label: SCOPE_TEXT.following, details: following }, all);
  return options;
};
