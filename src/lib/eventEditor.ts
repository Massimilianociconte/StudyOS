// Logica del modulo evento (creazione e modifica), senza React: bozza ↔ campi dell'evento, modifiche
// da salvare, orari e "tutto il giorno", errori, promemoria, scelta "solo questo / successivi / tutti".
import type { CalendarEvent, EventCategory, EventReminder, RepeatRule, Weekday } from "../types";
import { EVENT_TYPE_COLORS, eventTypeKey, LEGACY_AUTO_COLOR, resolveEventColor, sanitizeTypeColorOverrides, typeDefaultColor, type EventTypeKey, type TypeColorOverrides } from "./eventColors";
import { DATE_PICKER_TEXT, MONTH_NAME, WEEKDAY_NAME, WEEKDAY_SHORT } from "./labels";
import { EVENT_EDITOR_TEXT, SCOPE_TEXT } from "./labels/calendar";
import {
  allDayDays,
  allDayTimes,
  applyRepeatFields,
  changesRepeat,
  describeReminder,
  isOccurrenceRow,
  normalizeRepeat,
  sanitizeReminders,
  validateRepeat,
  type OccurrenceScope
} from "./repeat";
import { adaptRuleToStart, weekdayOf } from "./repeatPicker";
import type { ScopeImpact, SeriesSpan } from "./occurrenceEdit";
import { startDayOf } from "./occurrenceLookup";
import { CALENDAR_EVENT_FIELD_GROUPS, changedFields, safeCssColor } from "./sharing";
import { civilAddDays, civilDaysBetween, isCivilDate, isValidTimeZone, localMidnight, parseCivil } from "./tz";

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
  /**
   * Fuso dell'evento aperto: i giorni di un tutto il giorno sono date in quel fuso e si salvano a
   * mezzanotte lì (assente: il dispositivo, che l'evento nuovo prende alla creazione).
   */
  timeZone?: string;
}

export interface ColorContext {
  subjectColor?: string;
  overrides?: TypeColorOverrides;
  /** Tipo della ricorrenza (compleanno, anniversario…): il suo colore vale più di quello della categoria. */
  occasionKind?: string;
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
  draft.colorCustom && safeCssColor(draft.color) ? safeCssColor(draft.color) : typeDefaultColor(eventTypeKey({ category: draft.category, occasionKind: context.occasionKind }), context);

/**
 * "Colori delle tipologie": la preferenza con il colore di `type` cambiato (`null` = Ripristina).
 * Il colore predefinito non si salva (la tipologia torna "Predefinito"); il resto si ripulisce.
 */
export const withTypeColor = (overrides: unknown, type: EventTypeKey, color: string | null): TypeColorOverrides => {
  const next: Record<string, unknown> = { ...sanitizeTypeColorOverrides(overrides) };
  const own = color === null ? "" : safeCssColor(color);
  if (!own || own.toLowerCase() === EVENT_TYPE_COLORS[type].toLowerCase()) delete next[type];
  else next[type] = own;
  return sanitizeTypeColorOverrides(next);
};

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
  // Tutto il giorno: le date nel fuso dell'evento (un'occorrenza espansa sta già sui giorni giusti).
  const days = allDay ? allDayDays(event) : null;
  const colorCustom = initialColorCustom(event, subjectColor);
  return {
    title: event.title ?? "",
    allDay,
    start: allDay ? withDate(days?.first ?? dateOf(start), "00:00") : start,
    end: allDay ? withDate(days?.last ?? lastDayOf(start, end), "00:00") : end,
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
    status: event.status ?? "planned",
    ...(isValidTimeZone(event.timeZone) ? { timeZone: event.timeZone } : {})
  };
};

const isoOf = (local: string) => {
  const ms = localMs(local);
  return Number.isNaN(ms) ? local : new Date(ms).toISOString();
};

/**
 * Inizio e fine da salvare: istanti; tutto il giorno, mezzanotti nel fuso dell'evento (`timeZone`,
 * altrimenti il dispositivo) con fine esclusiva, così il motore rilegge gli stessi giorni.
 */
export const draftTimes = (draft: Pick<EventDraft, "allDay" | "start" | "end" | "timeZone">) => {
  if (!draft.allDay) return { start: isoOf(draft.start), end: isoOf(draft.end) };
  const first = dateOf(draft.start);
  const last = dateOf(draft.end);
  if (!isCivilDate(first)) return { start: draft.start, end: draft.end };
  return allDayTimes(first, isCivilDate(last) ? last : first, draft.timeZone);
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
 * Giorno della ripetizione per la bozza: quello dell'inizio nel fuso `zone` dell'evento, dove la
 * regola si ripete (da Tokyo un lunedì sera a Roma si mostra martedì, ma la regola dice lunedì). Tutto
 * il giorno, o senza fuso: il giorno mostrato.
 */
export const draftRuleDay = (draft: Pick<EventDraft, "allDay" | "start">, zone?: string) => {
  const shown = dateOf(draft.start);
  if (draft.allDay || !zone) return shown;
  const day = startDayOf(isoOf(draft.start), false, zone);
  return isCivilDate(day) ? day : shown;
};

/**
 * Nuovo inizio: la fine si sposta con la stessa durata (o, tutto il giorno, lo stesso numero di
 * giorni) e le ripetizioni legate al giorno della settimana seguono la nuova data (nel fuso `zone`
 * dell'evento, vedi `draftRuleDay`).
 */
export const changeStart = <T extends EventDraft>(draft: T, next: string, zone?: string): T => {
  const oldDate = dateOf(draft.start);
  const newDate = dateOf(next);
  const ruleFrom = draftRuleDay(draft, zone);
  const ruleTo = draftRuleDay({ allDay: draft.allDay, start: next }, zone);
  const repeat = isCivilDate(ruleFrom) && isCivilDate(ruleTo) ? adaptRuleToStart(draft.repeat, ruleFrom, ruleTo) : draft.repeat;
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

/**
 * Nuova tipologia: il colore la segue (se non è scelto a mano). «Vacanza» è sempre di tutto il giorno,
 * come «Nuova vacanza»: un evento con orario diventa il suo primo giorno, dal… al… lo stesso giorno
 * (gli orari restano per quando si toglie "Tutto il giorno"); un periodo già di tutto il giorno resta.
 */
export const setDraftCategory = <T extends EventDraft>(draft: T, category: EventCategory, context: ColorContext): T => {
  const next = { ...draft, category, color: draftColor({ ...draft, category }, context) };
  if (category !== "vacation" || draft.allDay) return next;
  const day = dateOf(draft.start);
  if (!isCivilDate(day)) return { ...next, allDay: true };
  return { ...next, allDay: true, end: withDate(day, timeOf(draft.end)) };
};

/**
 * Evento di un'altra persona dopo la modifica `changes` del modulo, sopra la sua ultima versione
 * `latest` (ciò che il proprietario ha cambiato nel frattempo resta). null = nulla da salvare.
 * - Promemoria: sono personali, suonerebbero sui dispositivi del proprietario. Restano i suoi.
 * - Materia: è sua e decide cosa è condiviso. Resta la sua.
 * - Un giorno cambiato da solo (riga) non prende una regola: le app vecchie lo ripeterebbero da solo.
 * - Regola cambiata: regola pulita più i campi vecchi; una serie senza fuso resta senza (vale il fuso di
 *   chi la guarda, come per il proprietario, di cui non si conosce il fuso): mai il fuso di chi riceve.
 */
export const recipientEventUpdate = (latest: CalendarEvent, changes: Partial<CalendarEvent>): CalendarEvent | null => {
  const update: Partial<CalendarEvent> = { ...changes };
  delete update.subjectId;
  delete update.reminders;
  if (isOccurrenceRow(latest)) delete update.repeat;
  if (!Object.keys(update).length) return null;
  const merged = { ...latest, ...update } as CalendarEvent;
  if (!("repeat" in update)) return merged;
  const next = applyRepeatFields(merged, { repeatChanged: changesRepeat(latest, update) });
  if (isValidTimeZone(latest.timeZone) || next.timeZone === latest.timeZone) return next;
  const zoneless = { ...next };
  if ("timeZone" in latest) zoneless.timeZone = latest.timeZone;
  else delete zoneless.timeZone;
  return zoneless;
};

// Spostamento della modifica per "Tutti": in occurrenceLookup.ts (lo usa anche l'agente, nel bundle iniziale).
export { allScopePatch, shiftPatchDays } from "./occurrenceLookup";

/** Campi di contenuto che un giorno cambiato da solo può avere diversi dalla sua serie. */
const ROW_CONTENT_KEYS = ["title", "description", "category", "color", "colorCustom", "priority", "status", "reminders", "location", "links"] as const;

/**
 * Modifica da passare a "Questo e i successivi". Dalla serie: solo i campi cambiati. Da un giorno
 * cambiato da solo (riga): i successivi prendono anche ciò che quel giorno mostrava (titolo, colore,
 * note...), non orari, regola o materia se non cambiati.
 */
/** Il giorno cambiato da solo `row` ha contenuti suoi (titolo, colore, note…) diversi da quelli della serie? */
export const rowHasOwnContent = (row: Partial<CalendarEvent>, series: Partial<CalendarEvent>) =>
  ROW_CONTENT_KEYS.some((key) => JSON.stringify(row[key] ?? null) !== JSON.stringify(series[key] ?? null));

export const followingPatch = (shown: Partial<CalendarEvent>, changes: Partial<CalendarEvent>, fromRow: boolean): Partial<CalendarEvent> => {
  if (!fromRow) return changes;
  const content: Partial<CalendarEvent> = {};
  for (const key of ROW_CONTENT_KEYS) if (key in shown) Object.assign(content, { [key]: shown[key] });
  return { ...content, ...changes };
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
  /** Una riga breve e vera (quali date): si vede sempre. */
  summary: string;
  /** Ciò che si perde, sparisce, raddoppia, si sposta o torna (SCOPE_WARNING_KEYS): sempre visibile. */
  warnings: string[];
  /**
   * Tutte le conseguenze, in ordine (descrizione accessibile della scelta). In «Dettagli» quelle che
   * non sono in `warnings`.
   */
  details: string[];
}

/** "giovedì 12 novembre" */
export const occurrenceDayText = (date: string) => {
  const parts = parseCivil(date);
  if (!parts) return date;
  return `${WEEKDAY_NAME[weekdayOf(date)]} ${parts.day} ${MONTH_NAME[parts.month - 1]}`;
};

/**
 * Date in breve, per mese: "ven 4, 11, 18 dic, ven 1 gen" (il giorno della settimana solo quando
 * cambia, il mese alla fine dei suoi giorni).
 */
export const shortDatesText = (dates: readonly string[]) => {
  const groups: string[] = [];
  let items: string[] = [];
  let group = "";
  let month = "";
  let weekday = "";
  const close = () => {
    if (items.length) groups.push(`${items.join(", ")} ${month}`);
    items = [];
  };
  for (const date of dates) {
    const parts = parseCivil(date);
    if (!parts) continue;
    if (`${parts.year}-${parts.month}` !== group) {
      close();
      group = `${parts.year}-${parts.month}`;
      month = DATE_PICKER_TEXT.monthsShort[parts.month - 1];
      weekday = "";
    }
    const day = WEEKDAY_SHORT[weekdayOf(date)];
    items.push(day === weekday ? String(parts.day) : `${day} ${parts.day}`);
    weekday = day;
  }
  close();
  return groups.join(", ");
};

/** Date che spariscono dette per nome: le prime, poi "e altre date dopo". */
const GONE_SHOWN = 6;

/**
 * Righe della scelta SEMPRE VISIBILI (sotto la riga breve): dicono che qualcosa si perde, viene
 * sostituito, sparisce, raddoppia, si sposta o torna, o che la scelta tocca anche date fuori da quelle
 * scelte (materia, inizio della serie). Unico elenco: ogni riga nuova della scelta va messa qui o
 * in SCOPE_DETAIL_KEYS (il tipo lo impone).
 */
export const SCOPE_WARNING_KEYS = [
  "thisSubject",
  "followingDaysShift",
  "allDaysShift",
  "followingTakesDay",
  "changedLost",
  "changedGone",
  "cancelledBack",
  "ownLost",
  "followingSplits",
  "followingGone",
  "followingMovesSplits",
  "followingBoth",
  "followingStartsOn",
  "newStart"
] as const satisfies readonly (keyof typeof SCOPE_TEXT)[];

/** Righe solo in «Dettagli»: la scelta detta per intero, ciò che resta così, la fine della serie, il fuso (uguale per tutte le scelte). */
export const SCOPE_DETAIL_KEYS = [
  "thisEdit",
  "thisMove",
  "thisDelete",
  "followingEdit",
  "followingMove",
  "followingDelete",
  "allEdit",
  "allMove",
  "allDelete",
  "allDeleteFamily",
  "sharedAll",
  "rowsKept",
  "othersKept",
  "followingKeepsSplits",
  "followingSplitsOwnDays",
  "followingSplitsOwnTime",
  "followingKeepsEnd",
  "followingNewEnd",
  "pinZone"
] as const satisfies readonly (keyof typeof SCOPE_TEXT)[];

type ScopeLineKey = (typeof SCOPE_WARNING_KEYS)[number] | (typeof SCOPE_DETAIL_KEYS)[number];
type ScopeLine = readonly [ScopeLineKey, string];
const WARNING_KEYS: ReadonlySet<ScopeLineKey> = new Set(SCOPE_WARNING_KEYS);

/** Opzione con le sue righe: `details` tutte, in ordine; `warnings` quelle da non nascondere mai. */
const scopeOption = (id: OccurrenceScope, label: string, summary: string, lines: readonly ScopeLine[]): ScopeOption => ({
  id,
  label,
  summary,
  warnings: lines.filter(([key]) => WARNING_KEYS.has(key)).map(([, text]) => text),
  details: lines.map(([, text]) => text)
});

/** Che cosa fa "Questo e i successivi" alle parti cambiate prima (assorbite con una regola nuova, o lasciate). */
const splitLines = (impact: ScopeImpact | undefined): ScopeLine[] => {
  if (!impact) return [];
  const gone = impact.gone ?? [];
  const goneLine: ScopeLine[] = gone.length
    ? [["followingGone", SCOPE_TEXT.followingGone(shortDatesText(gone.slice(0, GONE_SHOWN)), gone.length > GONE_SHOWN || impact.goneMore === true)]]
    : [];
  if (impact.absorbed) return [["followingSplits", SCOPE_TEXT.followingSplits], ...goneLine];
  // Senza parti dopo può sparire il giorno aperto (una regola nuova che non lo ha).
  if (!impact.laterParts) return goneLine;
  // Spostando il giorno si spostano le parti con gli stessi giorni e orario; le altre restano (e lo si dice se ce ne sono di tutti e due i tipi).
  const moved = impact.laterMoved ?? 0;
  return [
    moved ? ["followingMovesSplits", SCOPE_TEXT.followingMovesSplits] : ["followingKeepsSplits", SCOPE_TEXT.followingKeepsSplits],
    ...(moved && impact.laterOwnDays ? [["followingSplitsOwnDays", SCOPE_TEXT.followingSplitsOwnDays] as const] : []),
    ...(impact.laterOwnTime ? [["followingSplitsOwnTime", SCOPE_TEXT.followingSplitsOwnTime] as const] : [])
  ];
};

/** Righe sui giorni cambiati o annullati da soli: quanti perdono la modifica, quanti restano. */
const rowLines = (impact: ScopeImpact | undefined): ScopeLine[] => {
  if (!impact) return [];
  const lost: ScopeLine[] = [
    ...(impact.changedLost ? [["changedLost", SCOPE_TEXT.changedLost(impact.changedLost)] as const] : []),
    ...(impact.changedGone ? [["changedGone", SCOPE_TEXT.changedGone(impact.changedGone)] as const] : []),
    ...(impact.cancelledLost ? [["cancelledBack", SCOPE_TEXT.cancelledBack(impact.cancelledLost)] as const] : [])
  ];
  return [...lost, ...(impact.kept ? [lost.length ? (["othersKept", SCOPE_TEXT.othersKept] as const) : (["rowsKept", SCOPE_TEXT.rowsKept] as const)] : [])];
};

const WEEK: readonly Weekday[] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/**
 * Giorni della settimana in breve: tre o più di fila con il trattino ("lun–ven", anche a cavallo della
 * domenica: "dom–gio"), gli altri separati da virgole ("lun, mer").
 */
export const weekdaysText = (days: readonly Weekday[]) => {
  const set = new Set(days.filter((day) => WEEK.includes(day)));
  if (set.size === 7) return `${WEEKDAY_SHORT.MO}–${WEEKDAY_SHORT.SU}`;
  const has = (index: number) => set.has(WEEK[(index + 7) % 7]);
  // Si parte dal primo giorno che apre una serie di fila (non preceduto da un altro).
  const first = WEEK.findIndex((_, index) => has(index) && !has(index - 1));
  if (first < 0) return "";
  const runs: Weekday[][] = [];
  for (let step = 0; step < 7; step += 1) {
    const index = (first + step) % 7;
    if (!has(index)) continue;
    if (step > 0 && has(index - 1)) runs[runs.length - 1].push(WEEK[index]);
    else runs.push([WEEK[index]]);
  }
  return runs
    .map((run) =>
      run.length >= 3 ? `${WEEKDAY_SHORT[run[0]]}–${WEEKDAY_SHORT[run[run.length - 1]]}` : run.map((day) => WEEKDAY_SHORT[day]).join(", ")
    )
    .join(", ");
};

/**
 * Opzioni della scelta per un evento che si ripete, con le conseguenze dette come stanno.
 * - Cambiando la regola non c'è "Solo questo" (una data sola non ha una ripetizione).
 * - `impacts`: che cosa fanno davvero "Questo e i successivi" e "Tutti" ai giorni cambiati o
 *   annullati da soli (vedi `scopeImpact`): si dice quanti perdono la modifica e quanti restano.
 * - `span`: le date che "Tutti" tocca (una parte di una serie divisa, giorni passati o no, parti
 *   eliminate); `newStart`: il nuovo primo giorno della serie con una regola nuova.
 * - Dal primo giorno di una serie mai divisa "Questo e i successivi" è "Tutti": non si propone.
 * - `rowContent`: il giorno è cambiato da solo con contenuti suoi, che "Questo e i successivi" porta
 *   ai giorni dopo (lo si dice).
 * - `daysShift`: spostando il giorno, una regola con più giorni della settimana li sposta tutti
 *   (vedi `movedRule`): si dicono i giorni prima e dopo.
 * - Eventi di altri (`sharedOnly`): solo "Tutti".
 */
export const scopeOptions = ({
  action,
  date,
  opened,
  ruleChanged = false,
  subjectChanged = false,
  pinsZone,
  sharedOnly = false,
  impacts = {},
  span,
  newStart,
  rowContent = false,
  daysShift
}: {
  action: ScopeAction;
  date: string;
  /** Il giorno aperto, se non è `date` (un giorno spostato da solo): la scelta nomina questo. */
  opened?: string;
  ruleChanged?: boolean;
  subjectChanged?: boolean;
  /** La serie non ha un fuso: la prima modifica di un giorno lo fissa (quello del dispositivo). */
  pinsZone?: string;
  sharedOnly?: boolean;
  impacts?: Partial<Record<"following" | "all", ScopeImpact>>;
  span?: SeriesSpan;
  newStart?: string;
  rowContent?: boolean;
  daysShift?: { from: readonly Weekday[]; to: readonly Weekday[] };
}): ScopeOption[] => {
  const day = occurrenceDayText(opened || date);
  const pin: ScopeLine[] = pinsZone ? [["pinZone", SCOPE_TEXT.pinZone(pinsZone)]] : [];
  const shift = daysShift && action !== "delete" ? { from: weekdaysText(daysShift.from), to: weekdaysText(daysShift.to) } : null;
  const range = {
    ...(span?.from ? { from: occurrenceDayText(span.from) } : {}),
    ...(span?.until ? { until: occurrenceDayText(span.until) } : {}),
    past: span?.past ?? false
  };
  const family = action === "delete" && Boolean(span && span.parts > 1);
  const allShift: ScopeLine[] = shift ? [["allDaysShift", SCOPE_TEXT.allDaysShift(shift.from, shift.to)]] : [];
  const all = scopeOption(
    "all",
    SCOPE_TEXT.all,
    sharedOnly
      ? SCOPE_TEXT.sharedAllShort
      : action === "delete"
        ? family
          ? SCOPE_TEXT.allDeleteFamilyShort
          : SCOPE_TEXT.allDeleteShort(range.past)
        : SCOPE_TEXT.allShort(range),
    sharedOnly
      ? [["sharedAll", SCOPE_TEXT.sharedAll], ...allShift]
      : action === "delete"
        ? [family ? ["allDeleteFamily", SCOPE_TEXT.allDeleteFamily] : ["allDelete", SCOPE_TEXT.allDelete(range.past)]]
        : [
            action === "move" ? ["allMove", SCOPE_TEXT.allMove(range)] : ["allEdit", SCOPE_TEXT.allEdit(range)],
            ...allShift,
            ...(impacts.all?.ownLost ? [["ownLost", SCOPE_TEXT.ownLost] as const] : []),
            ...(newStart ? [["newStart", SCOPE_TEXT.newStart(occurrenceDayText(newStart))] as const] : []),
            ...rowLines(impacts.all),
            ...pin
          ]
  );
  if (sharedOnly) return [all];
  const options: ScopeOption[] = [];
  if (!(action === "edit" && ruleChanged)) {
    const text: ScopeLine =
      action === "delete" ? ["thisDelete", SCOPE_TEXT.thisDelete(day)] : action === "move" ? ["thisMove", SCOPE_TEXT.thisMove(day)] : ["thisEdit", SCOPE_TEXT.thisEdit(day)];
    options.push(
      scopeOption("this", SCOPE_TEXT.this, SCOPE_TEXT.thisShort(day), [text, ...(action === "edit" && subjectChanged ? [["thisSubject", SCOPE_TEXT.thisSubject] as const] : []), ...pin])
    );
  }
  const following: ScopeLine[] =
    action === "delete"
      ? [["followingDelete", SCOPE_TEXT.followingDelete(day)]]
      : [
          action === "move" ? ["followingMove", SCOPE_TEXT.followingMove(day)] : ["followingEdit", SCOPE_TEXT.followingEdit(day)],
          ...(impacts.following?.startsOn ? [["followingStartsOn", SCOPE_TEXT.followingStartsOn(occurrenceDayText(impacts.following.startsOn))] as const] : []),
          ...(shift ? [["followingDaysShift", SCOPE_TEXT.followingDaysShift(shift.from, shift.to)] as const] : []),
          ...(rowContent ? [["followingTakesDay", SCOPE_TEXT.followingTakesDay] as const] : []),
          ...rowLines(impacts.following),
          ...splitLines(impacts.following),
          // Spostando, i giorni in cui una data spostata arriva su quella di un'altra parte: ci sono tutte e due.
          ...(impacts.following?.both?.length
            ? [["followingBoth", SCOPE_TEXT.followingBoth(shortDatesText(impacts.following.both.slice(0, GONE_SHOWN)))] as const]
            : []),
          // Se spariscono date, la fine di prima non vale più per tutto ciò che viene dopo; se la
          // modifica sposta l'ultima data, si dice quella nuova.
          ...(ruleChanged || impacts.following?.gone?.length
            ? []
            : [
                impacts.following?.endsOn
                  ? (["followingNewEnd", SCOPE_TEXT.followingNewEnd(occurrenceDayText(impacts.following.endsOn))] as const)
                  : (["followingKeepsEnd", SCOPE_TEXT.followingKeepsEnd] as const)
              ]),
          ...pin
        ];
  const firstDay = span?.start === date && span.parts === 1;
  if (!firstDay) options.push(scopeOption("following", SCOPE_TEXT.following, SCOPE_TEXT.followingShort(day), following));
  options.push(all);
  return options;
};
