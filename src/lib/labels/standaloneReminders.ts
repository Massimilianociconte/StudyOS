// Sezione «Promemoria» del pannello Notifiche (promemoria autonomi, anche quelli creati dagli agenti).
export const STANDALONE_REMINDERS_TEXT = {
  title: "Promemoria",
  empty: "Nessun promemoria in arrivo.",
  add: "Aggiungi promemoria",
  name: "Cosa ricordare",
  day: "Giorno",
  time: "Ora",
  save: "Salva",
  cancel: "Annulla",
  done: "Fatto",
  remove: "Elimina",
  removeAria: (title: string) => `Elimina il promemoria «${title}»`,
  doneAria: (title: string) => `Segna come fatto «${title}»`,
  removeConfirm: "Eliminare questo promemoria? Non si può annullare.",
  addFailed: "Non sono riuscito a salvare il promemoria. Riprova.",
  missingTitle: "Scrivi cosa ricordare.",
  badWhen: "Scegli un giorno e un'ora validi.",
  linked: (what: string) => `Collegato a: ${what}`,
  entity: {
    subject: "una materia",
    exam: "un esame",
    calendarEvent: "un evento",
    task: "un'attività",
    goal: "un obiettivo",
    note: "una nota"
  } as Record<string, string>
} as const;
