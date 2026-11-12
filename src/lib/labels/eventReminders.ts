// Avvisi dei promemoria degli eventi (components/calendar/EventReminderWatcher, lib/eventReminders).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

/** Promemoria degli eventi che suonano ad app aperta: quando inizia l'evento, detto in breve. */
export const EVENT_REMINDER_TEXT = {
  now: "Adesso",
  inMinutes: (count: number) => `Tra ${count} ${count === 1 ? "minuto" : "minuti"}`,
  started: (time: string) => `Iniziato alle ${time}`,
  due: (time: string) => `Scaduto alle ${time}`,
  todayAt: (time: string) => `Oggi alle ${time}`,
  tomorrowAt: (time: string) => `Domani alle ${time}`,
  dayAt: (day: string, time: string) => `${day} alle ${time}`,
  today: "Oggi",
  tomorrow: "Domani",
  untitled: "Evento senza titolo"
} as const;
