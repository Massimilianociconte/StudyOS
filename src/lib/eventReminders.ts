// Promemoria degli eventi mentre l'app è aperta: quali scattano nelle prossime 48 ore, con una chiave
// per evento, occorrenza e promemoria (così ognuno avvisa una volta sola), e la frase "quando".
// Puro: il watcher (components/calendar/EventReminderWatcher) mette i timer e ricorda le chiavi.
import { differenceInCalendarDays, format } from "date-fns";
import { it } from "date-fns/locale";
import type { CalendarEvent, EventReminder } from "../types";
import { expandEvents, reminderInstants, sanitizeReminders } from "./repeat";
import { EVENT_REMINDER_TEXT, capitalizeFirst } from "./labels";

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Fin dove si guarda avanti. */
export const REMINDER_HORIZON_MS = 48 * HOUR_MS;
/** Un promemoria passato da poco (app appena aperta, scheda in pausa) avvisa ancora. */
export const REMINDER_GRACE_MS = 30 * MINUTE_MS;
/** Per quanto si ricordano le chiavi già avvisate. */
export const FIRED_KEEP_MS = 7 * DAY_MS;
export const FIRED_STORAGE_KEY = "studyos-event-reminders-fired";

export interface PlannedReminder {
  /** Evento + occorrenza + promemoria + istante: cambia se l'evento si sposta. */
  key: string;
  /** Istante del promemoria (ms). */
  at: number;
  /** Id da aprire (la serie per le occorrenze). */
  eventId: string;
  title: string;
  startMs: number;
  allDay: boolean;
}

/** Chiave di un promemoria dentro l'evento: "1d0m1800" = un giorno prima alle 18:00. */
export const reminderKeyOf = (reminder: EventReminder) =>
  `${reminder.daysBefore ?? 0}d${reminder.minutesBefore ?? 0}m${reminder.at ? reminder.at.replace(":", "") : ""}`;

const leadOf = (reminder: EventReminder) => (reminder.daysBefore ?? 0) * DAY_MS + (reminder.minutesBefore ?? 0) * MINUTE_MS;

const isShared = (event: CalendarEvent) => Boolean((event as { sharedFrom?: unknown }).sharedFrom);

/**
 * Radice della famiglia di una serie: dopo "questa e le successive" la serie figlia (`S~giorno`) tiene
 * la chiave della madre, così un'occorrenza già avvisata non avvisa di nuovo.
 */
const familyOf = (id: string) => (typeof id === "string" ? id.split("~")[0] || id : String(id));

/**
 * Promemoria con l'istante in [fromMs, toMs] (in ordine), di eventi propri, non fatti, non saltati e
 * non ancora finiti; `accept` scarta altro (es. eventi già cominciati). Senza promemoria esce subito.
 */
function collectReminders(
  events: readonly CalendarEvent[],
  nowMs: number,
  fromMs: number,
  toMs: number,
  accept: (item: CalendarEvent, at: number, startMs: number) => boolean = () => true
): PlannedReminder[] {
  const own = events.filter((event) => !isShared(event));
  let maxLead = -1;
  for (const event of own) {
    for (const reminder of sanitizeReminders(event.reminders)) maxLead = Math.max(maxLead, leadOf(reminder));
  }
  if (maxLead < 0) return [];

  // "alle HH:mm" può cadere fino a un giorno dopo l'inizio: un giorno di margine da entrambe le parti.
  // Si espandono tutti gli eventi propri: le divisioni di una serie ("questa e le successive") contano.
  const occurrences = expandEvents(own, new Date(fromMs - 2 * DAY_MS), new Date(toMs + maxLead + DAY_MS));

  const planned: PlannedReminder[] = [];
  for (const item of occurrences) {
    if (item.archived || item.status === "done" || item.status === "skipped") continue;
    const list = sanitizeReminders(item.reminders);
    if (!list.length) continue;
    const [start] = reminderInstants(item, [{ minutesBefore: 0 }]);
    if (!start) continue;
    const startMs = start.getTime();
    const duration = Date.parse(item.end) - Date.parse(item.start);
    const endMs = startMs + (Number.isFinite(duration) && duration > 0 ? duration : HOUR_MS);
    if (endMs <= nowMs) continue;
    const eventId = item.seriesId ?? item.id;
    for (const reminder of list) {
      const [instant] = reminderInstants(item, [reminder]);
      if (!instant) continue;
      const at = instant.getTime();
      if (at < fromMs || at > toMs || !accept(item, at, startMs)) continue;
      planned.push({
        key: `${familyOf(eventId)}@${item.occurrenceDate}#${reminderKeyOf(reminder)}@${at}`,
        at,
        eventId,
        title: typeof item.title === "string" ? item.title : "",
        startMs,
        allDay: item.allDay === true
      });
    }
  }
  return planned.sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

/** Promemoria da avvisare tra `now - grace` e `now + horizon`, in ordine. */
export function planReminders(
  events: readonly CalendarEvent[],
  now: Date,
  { horizonMs = REMINDER_HORIZON_MS, graceMs = REMINDER_GRACE_MS }: { horizonMs?: number; graceMs?: number } = {}
): PlannedReminder[] {
  const nowMs = now.getTime();
  return collectReminders(events, nowMs, nowMs - graceMs, nowMs + horizonMs);
}

/** Fin dove si recuperano i promemoria persi ad app chiusa. */
export const MISSED_WINDOW_MS = 24 * HOUR_MS;
/** Al più tanti promemoria persi diventano notifiche in una volta (i più recenti). */
export const MISSED_MAX = 5;

/**
 * Promemoria persi ad app chiusa (o con il computer in pausa): istante nelle ultime 24 ore ma oltre la
 * mezz'ora di tolleranza, evento non ancora cominciato, evento creato prima del promemoria (uno messo
 * dopo non è "perso"). Stesse chiavi di planReminders: ognuno compare una volta sola. Diventano solo
 * notifiche in app, senza notifica di sistema né suono.
 */
export function missedReminders(
  events: readonly CalendarEvent[],
  now: Date,
  { windowMs = MISSED_WINDOW_MS, graceMs = REMINDER_GRACE_MS }: { windowMs?: number; graceMs?: number } = {}
): PlannedReminder[] {
  const nowMs = now.getTime();
  return collectReminders(events, nowMs, nowMs - windowMs, nowMs - graceMs - 1, (item, at, startMs) => {
    const created = Date.parse(item.createdAt);
    return startMs > nowMs && (Number.isNaN(created) || created < at);
  });
}

/**
 * Persi da avvisare ora: tolti quelli già avvisati (su questo dispositivo), i `max` più recenti in
 * `show`; gli altri in `skip`, da segnare come avvisati senza notifica, così non tornano a un riavvio.
 */
export function splitMissed(
  missed: readonly PlannedReminder[],
  isFired: (key: string) => boolean,
  max = MISSED_MAX
): { show: PlannedReminder[]; skip: PlannedReminder[] } {
  const fresh = missed.filter((item) => !isFired(item.key));
  const cut = Math.max(0, fresh.length - Math.max(0, max));
  return { show: fresh.slice(cut), skip: fresh.slice(0, cut) };
}

/** Chiavi già avvisate (dal localStorage): qualsiasi dato rovinato vale "nessuna". */
export function parseFired(raw: string | null): Record<string, number> {
  if (!raw) return {};
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, at] of Object.entries(value)) {
    if (typeof at === "number" && Number.isFinite(at) && at > 0) result[key] = at;
  }
  return result;
}

/** Toglie le chiavi avvisate da più di `keepMs`. */
export function pruneFired(fired: Record<string, number>, nowMs: number, keepMs = FIRED_KEEP_MS): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, at] of Object.entries(fired)) if (nowMs - at <= keepMs) result[key] = at;
  return result;
}

export { notificationIdOf } from "./reminderIds";

const dayText = (ms: number) => capitalizeFirst(format(ms, "EEEE d MMMM", { locale: it }));

/**
 * "Tra 15 minuti · 09:15", "Oggi alle 14:30", "Domani", "Iniziato alle 08:50"… La notifica resta
 * nell'elenco: accanto a "adesso" e "tra N minuti" c'è anche l'ora, che non invecchia.
 */
export function reminderWhenText(startMs: number, allDay: boolean, now: Date): string {
  const days = differenceInCalendarDays(startMs, now);
  if (allDay) return days <= 0 ? EVENT_REMINDER_TEXT.today : days === 1 ? EVENT_REMINDER_TEXT.tomorrow : dayText(startMs);
  const time = format(startMs, "HH:mm");
  const delta = startMs - now.getTime();
  if (Math.abs(delta) < MINUTE_MS) return `${EVENT_REMINDER_TEXT.now} · ${time}`;
  if (delta < 0) return EVENT_REMINDER_TEXT.started(time);
  if (delta < HOUR_MS) return `${EVENT_REMINDER_TEXT.inMinutes(Math.ceil(delta / MINUTE_MS))} · ${time}`;
  if (days === 0) return EVENT_REMINDER_TEXT.todayAt(time);
  if (days === 1) return EVENT_REMINDER_TEXT.tomorrowAt(time);
  return EVENT_REMINDER_TEXT.dayAt(dayText(startMs), time);
}
