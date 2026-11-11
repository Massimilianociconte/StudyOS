// Occorrenza di una serie in un giorno (per riaprire il modulo dopo un refresh, per l'agente),
// serie + giorno da passare a editOccurrence / deleteOccurrence e modifica da passare a "Tutti".
// Puro e leggero: lo usa anche l'agente, che sta nel bundle iniziale.
import type { CalendarEvent } from "../types";
import { expandEvents, isOccurrenceRow, occurrenceId, type EventOccurrence } from "./repeat";
import { civilAddDays, civilDateOf, civilDaysBetween, isCivilDate, localMidnight } from "./tz";

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

/** Giorno (YYYY-MM-DD) di un inizio: tutto il giorno nell'ora locale, altrimenti nel fuso della serie. */
const dayOfStart = (start: string, allDay: boolean | undefined, zone: string | undefined) => {
  const date = new Date(start);
  return Number.isNaN(date.getTime()) ? "" : civilDateOf(date, allDay ? undefined : zone);
};

/**
 * Modifica da passare a "Tutti" salvando dal giorno `date`. La serie si sposta dello scarto tra la
 * nuova occorrenza e `date` (con "tutto il giorno" cambiato, gli orari si scrivono così come sono dal
 * primo giorno). Il modulo parte dall'occorrenza come si vede, che può stare su un altro giorno (riga
 * spostata): la modifica si riporta al giorno giusto, così cambia solo ciò che è stato cambiato.
 */
export const allScopePatch = (
  changes: Partial<CalendarEvent>,
  {
    occurrence,
    series,
    date
  }: {
    occurrence: Pick<CalendarEvent, "start" | "allDay">;
    series: Pick<CalendarEvent, "start" | "allDay" | "timeZone">;
    date: string;
  }
): Partial<CalendarEvent> => {
  const toggled = changes.allDay !== undefined && changes.allDay !== (series.allDay ?? false);
  // "Tutto il giorno" che non cambia non si passa: una serie senza il campo lo vedrebbe come un
  // cambio e prenderebbe gli orari così come sono (spostandosi al giorno aperto).
  const { allDay: _allDay, ...withoutAllDay } = changes;
  const patch = toggled || changes.allDay === undefined ? changes : withoutAllDay;
  if (patch.start === undefined && patch.end === undefined) return patch;
  const zone = series.timeZone;
  const from = dayOfStart(occurrence.start, occurrence.allDay, zone);
  const to = toggled ? dayOfStart(series.start, series.allDay, zone) : date;
  if (!isCivilDate(from) || !isCivilDate(to)) return patch;
  return shiftPatchDays(patch, civilDaysBetween(from, to));
};
