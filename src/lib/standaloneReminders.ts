// Promemoria autonomi (collezione `reminders`): quali mostrare e come nasce l'istante dal modulo.
// Puri: li usano la sezione del pannello Notifiche e i test.
import type { Reminder } from "../types";

/** Da fare, non archiviati, con un istante valido: dal più vicino. */
export const listedReminders = (reminders: readonly Reminder[]) =>
  reminders
    .filter((item) => !item.done && !item.archived && Number.isFinite(Date.parse(item.remindAt)))
    .sort((a, b) => Date.parse(a.remindAt) - Date.parse(b.remindAt));

/** «2027-01-12» + «09:30» nel fuso del dispositivo → ISO; null se il giorno o l'ora non esistono. */
export const reminderInstant = (day: string, time: string): string | null => {
  const dayMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dayMatch || !timeMatch) return null;
  const [year, month, date] = [Number(dayMatch[1]), Number(dayMatch[2]), Number(dayMatch[3])];
  const [hours, minutes] = [Number(timeMatch[1]), Number(timeMatch[2])];
  if (hours > 23 || minutes > 59) return null;
  const at = new Date(year, month - 1, date, hours, minutes);
  if (at.getFullYear() !== year || at.getMonth() !== month - 1 || at.getDate() !== date) return null;
  return at.toISOString();
};
