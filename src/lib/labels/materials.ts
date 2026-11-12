// Materiali.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

export const MATERIALS_TEXT = {
  upload: "Carica un file",
  saveLink: "Salva un link",
  // Cosa fanno le pillole delle schede: si leggono dopo il testo della pillola, che dice già il nome.
  /** La pillola della materia applica il filtro. */
  filterBySubject: "mostra solo i materiali di questa materia",
  /** L'etichetta va nella ricerca. */
  searchTag: "cerca i materiali con questa etichetta",
  openLinked: "apri",
  subjectFilter: "Filtra per materia",
  allSubjects: "Tutte le materie",
  emptyTitle: "Ancora nessun materiale",
  emptyBody: "Carica un file o salva un link dalla barra qui sopra: qui ritrovi dispense, appunti e link. Es.: le slide di una lezione o il link a un video.",
  noneFoundTitle: "Nessun materiale trovato",
  noneFoundBody: "Nessun materiale corrisponde alla ricerca o ai filtri scelti.",
  showAll: "Mostra tutti i materiali",
  /** Materiale appena aggiunto che i filtri (tipo o ricerca) nascondono. */
  savedHidden: (name: string) => `«${name}» salvato · non rientra nei filtri`,
  showAllShort: "Mostra tutti",
  open: (name: string) => `Apri il link ${name}`,
  openTitle: "Apri il link",
  download: (name: string) => `Scarica ${name}`,
  downloadTitle: "Scarica il file",
  edit: (name: string) => `Modifica ${name}`,
  remove: (name: string) => `Elimina ${name}`,
  removeConfirm: (name: string) => `Eliminare «${name}»? Sparisce dai materiali e da attività, eventi o esami a cui è collegato. Non si può annullare.`,
  removeYes: "Elimina materiale",
  // Modifica di un materiale (Drawer).
  editEyebrow: "Materiale",
  editTitle: "Modifica materiale",
  cancel: "Annulla",
  save: "Salva modifiche",
  unsavedTitle: "Scartare le modifiche?",
  unsavedText: "Hai cambiato il materiale senza salvarlo.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche",
  // Le note della persona (create dagli agenti o arrivate con la sync).
  notesTitle: (count: number) => `Le tue note · ${count}`,
  notesShowAll: (count: number) => `Mostra tutte (${count})`,
  notesShowLess: "Mostra meno"
} as const;

export const MATERIALS_HELP = {
  subject: {
    title: "Materia",
    text: "Collegalo a una materia e lo ritrovi anche nella sua scheda.",
    example: "le slide di Anatomia."
  },
  tags: {
    title: "Etichette",
    text: "Parole per ritrovarlo con la ricerca.",
    example: "«orale», «formulario»."
  },
  subjectFilter: {
    title: "Filtro per materia",
    text: "Mostra i materiali collegati alla materia. Quelli collegati a un suo esame, a un'attività o a un evento non compaiono qui: li trovi aprendo l'esame, l'attività o l'evento."
  }
} as const;
