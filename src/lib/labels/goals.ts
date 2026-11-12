// Obiettivi.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

export const GOALS_TEXT = {
  subtitle: "Fissa i tuoi traguardi e segna a che punto sei.",
  newField: "Titolo del nuovo obiettivo",
  newPlaceholder: "Es. Finire il programma di Patologia",
  create: "Crea obiettivo",
  emptyTitle: "Ancora nessun obiettivo",
  emptyBody: "Un traguardo da raggiungere, come finire un programma o studiare un tot di ore a settimana: scrivilo nel campo qui sopra e tocca «Crea obiettivo».",
  noneActiveTitle: "Nessun obiettivo in corso",
  noneActiveBody: "Quelli raggiunti o archiviati sono qui sotto. Puoi crearne uno nuovo dal campo qui sopra quando vuoi.",
  // Avviso dopo che un obiettivo cambia gruppo o viene eliminato, con «Annulla».
  reached: (title: string) => `«${title}» raggiunto: ora è tra «Raggiunti e archiviati».`,
  archived: (title: string) => `«${title}» archiviato: ora è tra «Raggiunti e archiviati».`,
  reopened: (title: string) => `«${title}» è di nuovo tra gli obiettivi in corso.`,
  deleted: (title: string) => `Obiettivo «${title}» eliminato.`,
  undo: "Annulla",
  remove: "Elimina",
  removeAria: (title: string) => `Elimina l'obiettivo «${title}»`,
  // Chiudere il dettaglio (✕, Esc, tocco fuori, Indietro, Archivia) con dati cambiati chiede prima.
  unsavedTitle: "Scartare le modifiche?",
  unsavedText: "Hai cambiato l'obiettivo (titolo, progresso, note…) senza salvarlo.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche"
} as const;

export const GOALS_HELP = {
  progress: {
    label: "Come segno i progressi?",
    title: "Progressi",
    text: "Ogni tocco su + o − sposta il progresso del 5%. Al 100% l'obiettivo è raggiunto; sotto il 100% torna in corso."
  }
} as const;
