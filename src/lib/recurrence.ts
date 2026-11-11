// Espansione degli eventi ricorrenti in occorrenze per un intervallo visibile.
// La serie resta un solo evento salvato: le occorrenze sono calcolate e non vengono mai persistite.
// Il motore è in lib/repeat.ts (regole, fusi, occorrenze modificate, divisioni): qui resta la
// stessa interfaccia di sempre per chi la usa già.
import type { CalendarEvent } from "../types";
import { expandEvents as expandWithRepeat, type EventOccurrence, type ExpandOptions } from "./repeat";

export type { EventOccurrence } from "./repeat";

/**
 * Occorrenze che si sovrappongono a [from, to), ordinate per inizio. I campi extra di T restano.
 * Gli eventi senza `timeZone` né `repeat` si espandono esattamente come prima.
 */
export const expandEvents = <T extends CalendarEvent>(events: readonly T[], from: Date, to: Date, options?: ExpandOptions<T>): (T & EventOccurrence)[] =>
  expandWithRepeat(events, from, to, options);

export const RECURRENCE_LABEL: Record<NonNullable<CalendarEvent["recurrence"]>, string> = {
  none: "Non si ripete",
  daily: "Ogni giorno",
  weekly: "Ogni settimana",
  monthly: "Ogni mese"
};
