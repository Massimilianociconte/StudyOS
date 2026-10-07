import type { CalendarEvent } from '../types';

// Separati da barbExamImport: lo store li usa a ogni salvataggio di evento, e importarli da lì
// trascinava nel bundle iniziale il dataset BARB (~280 kB di JSON) anche per chi non lo apre mai.

/** Preserve date-only reminders through edits and ICS import as well as the first import. */
export function preserveBarbReminderDates<T extends Partial<CalendarEvent>>(event: T): T {
  if (!event.allDay || !event.sourceUid?.startsWith('barb-exam-') || !event.start || !event.end) return event;
  const floating = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T00:00:00`;
  };
  return { ...event, start: floating(event.start), end: floating(event.end) };
}

export const barbReminderEventId = (sourceUid: string) => `event-${sourceUid}`;
