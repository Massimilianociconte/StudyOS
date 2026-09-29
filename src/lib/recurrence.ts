// Espansione degli eventi ricorrenti in occorrenze per un intervallo visibile.
// La serie resta un solo evento salvato: le occorrenze sono calcolate e non vengono mai persistite.
import { addDays, addMonths, differenceInCalendarDays, parseISO } from "date-fns";
import type { CalendarEvent } from "../types";

export interface EventOccurrence extends CalendarEvent {
  /** Chiave univoca dell'occorrenza (id serie + inizio), da usare come key React. */
  occurrenceKey: string;
  /** true se l'evento fa parte di una serie ripetuta. */
  recurring: boolean;
}

const MAX_OCCURRENCES = 1000;

const valid = (date: Date) => !Number.isNaN(date.getTime());

const occurrence = (event: CalendarEvent, start: Date, durationMs: number, recurring: boolean): EventOccurrence => ({
  ...event,
  start: start.toISOString(),
  end: new Date(start.getTime() + durationMs).toISOString(),
  occurrenceKey: `${event.id}@${start.toISOString()}`,
  recurring
});

/** Occorrenze che si sovrappongono a [from, to), ordinate per inizio. */
export const expandEvents = (events: CalendarEvent[], from: Date, to: Date): EventOccurrence[] => {
  const result: EventOccurrence[] = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();

  for (const event of events) {
    if (event.archived) continue;
    const baseStart = parseISO(event.start);
    const baseEnd = parseISO(event.end);
    if (!valid(baseStart)) continue;
    const durationMs = valid(baseEnd) && baseEnd > baseStart ? baseEnd.getTime() - baseStart.getTime() : 60 * 60_000;
    const recurrence = event.recurrence ?? "none";

    if (recurrence === "none") {
      if (baseStart.getTime() < toMs && baseStart.getTime() + durationMs > fromMs) {
        result.push(occurrence(event, baseStart, durationMs, false));
      }
      continue;
    }

    const until = event.recurrenceUntil ? parseISO(event.recurrenceUntil) : null;
    // L'ultima occorrenza valida inizia entro la fine del giorno "fino al".
    const untilMs = until && valid(until) ? until.getTime() + 24 * 60 * 60_000 - 1 : Number.POSITIVE_INFINITY;
    const limitMs = Math.min(toMs, untilMs + 1);

    let cursor = baseStart;
    if (recurrence === "daily" || recurrence === "weekly") {
      const step = recurrence === "daily" ? 1 : 7;
      // Salta direttamente vicino all'inizio dell'intervallo (serie lunghe senza iterazioni inutili).
      const skip = Math.max(0, Math.floor(differenceInCalendarDays(from, baseStart) / step) - 1);
      cursor = addDays(baseStart, skip * step);
      for (let i = 0; i < MAX_OCCURRENCES && cursor.getTime() < limitMs; i += 1) {
        if (cursor.getTime() + durationMs > fromMs) result.push(occurrence(event, cursor, durationMs, true));
        cursor = addDays(cursor, step);
      }
    } else {
      for (let i = 0; i < MAX_OCCURRENCES && cursor.getTime() < limitMs; i += 1) {
        if (cursor.getTime() + durationMs > fromMs) result.push(occurrence(event, cursor, durationMs, true));
        cursor = addMonths(baseStart, i + 1);
      }
    }
  }

  return result.sort((a, b) => a.start.localeCompare(b.start));
};

export const RECURRENCE_LABEL: Record<NonNullable<CalendarEvent["recurrence"]>, string> = {
  none: "Non si ripete",
  daily: "Ogni giorno",
  weekly: "Ogni settimana",
  monthly: "Ogni mese"
};
