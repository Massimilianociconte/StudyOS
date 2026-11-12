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
  showAll: "Mostra tutti i materiali"
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
