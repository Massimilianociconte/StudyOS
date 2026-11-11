// Occorrenza di una serie in un giorno (per riaprire il modulo dopo un refresh, per l'agente) e
// serie + giorno da passare a editOccurrence / deleteOccurrence. Puro.
import type { CalendarEvent } from "../types";
import { expandEvents, isOccurrenceRow, occurrenceId, type EventOccurrence } from "./repeat";
import { civilAddDays, isCivilDate, localMidnight } from "./tz";

/**
 * Occorrenza `date` (YYYY-MM-DD, nel fuso della serie) dell'evento `id`: la serie o, se quel giorno
 * è stato modificato, la sua riga (`serie@giorno`). null se quel giorno non è un'occorrenza.
 */
export const findOccurrence = <T extends CalendarEvent>(events: readonly T[], id: string, date: string): (T & EventOccurrence) | null => {
  if (!isCivilDate(date)) return null;
  const target = events.find((event) => event.id === id);
  if (!target) return null;
  const seriesId = isOccurrenceRow(target) ? (target.seriesId as string) : id;
  const rowId = occurrenceId(seriesId, date);
  // Due giorni di margine: il giorno è nel fuso della serie, la finestra in ora locale.
  const items = expandEvents(events, localMidnight(civilAddDays(date, -2)), localMidnight(civilAddDays(date, 3)));
  return items.find((item) => item.occurrenceDate === date && (item.id === rowId || item.id === seriesId)) ?? null;
};

/** Serie e giorno dell'occorrenza (una riga modificata ha id `serie@giorno`). */
export const occurrenceTarget = (item: Pick<CalendarEvent, "id" | "seriesId" | "originalDate"> & { occurrenceDate: string }) =>
  isOccurrenceRow(item)
    ? { seriesId: item.seriesId as string, date: isCivilDate(item.originalDate) ? item.originalDate : item.occurrenceDate, row: true }
    : { seriesId: item.id, date: item.occurrenceDate, row: false };
