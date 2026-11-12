// Note (dettaglio aperto dalla ricerca o dagli elementi a cui sono collegate).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

/** Tipo dell'elemento a cui una nota è collegata («Collegata a: Attività · …»). */
export const LINKED_KIND_LABEL: Readonly<Record<string, string>> = {
  task: "Attività",
  calendarEvent: "Evento",
  subject: "Materia",
  exam: "Esame",
  attachment: "Materiale",
  studySession: "Sessione di studio",
  studyTopic: "Argomento",
  goal: "Obiettivo"
};

export const NOTES_TEXT = {
  eyebrow: "Nota",
  untitled: "Nota senza titolo",
  emptyBody: "Questa nota non ha testo.",
  linkedTo: "Collegata a",
  linkedGone: "L'elemento collegato non c'è più.",
  openLinked: (kind: string, title: string) => `Apri ${kind.toLowerCase()} «${title}»`,
  updated: (date: string) => `Modificata il ${date}`,
  edit: "Modifica",
  title: "Titolo",
  body: "Testo",
  bodyPlaceholder: "Scrivi qui la nota",
  save: "Salva nota",
  cancelEdit: "Annulla modifiche",
  remove: "Elimina",
  removeAria: (title: string) => `Elimina la nota «${title}»`,
  removed: (title: string) => `Nota «${title}» eliminata.`,
  undo: "Annulla",
  close: "Chiudi",
  listTitle: (count: number) => (count === 1 ? "1 nota collegata" : `${count} note collegate`),
  openNote: (title: string) => `Apri la nota «${title}»`
} as const;
