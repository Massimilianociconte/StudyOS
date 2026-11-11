// Obiettivi.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

export const GOALS_TEXT = {
  subtitle: "Fissa i tuoi traguardi e segna a che punto sei.",
  newField: "Titolo del nuovo obiettivo",
  newPlaceholder: "Es. Finire il programma di Patologia",
  create: "Crea obiettivo",
  emptyTitle: "Ancora nessun obiettivo",
  emptyBody: "Un traguardo da raggiungere, come finire un programma o studiare un tot di ore a settimana. Es.: «Finire il programma di Patologia».",
  createFirst: "Crea il primo obiettivo",
  noneActiveTitle: "Nessun obiettivo in corso",
  noneActiveBody: "Quelli raggiunti o archiviati sono qui sotto. Puoi crearne uno nuovo quando vuoi.",
  createOne: "Crea un obiettivo",
  metric: "Come lo misuri (facoltativo)"
} as const;

export const GOALS_HELP = {
  progress: {
    label: "Come segno i progressi?",
    title: "Progressi",
    text: "Ogni tocco su + o − sposta il progresso del 5%. Al 100% l'obiettivo è raggiunto."
  },
  metric: {
    title: "Come lo misuri",
    text: "L'unità con cui conti i passi verso il traguardo.",
    example: "ore a settimana, capitoli, esercizi."
  }
} as const;
