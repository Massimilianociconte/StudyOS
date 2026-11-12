// Home.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

export const HOME_TEXT = {
  openCalendar: "Apri calendario",
  allTasks: "Tutte le attività",
  allExams: "Tutti gli esami",
  allSubjects: "Tutte le materie",
  allGoals: "Tutti gli obiettivi",
  allMaterials: "Tutti i materiali",
  emptyToday: "Niente in programma oggi.",
  addEvent: "Aggiungi un impegno",
  emptyNext: "Qui comparirà la cosa più urgente da fare.",
  addTask: "Aggiungi un'attività",
  emptyExams: "Nessun esame in programma.",
  addExam: "Aggiungi un esame",
  emptySubjects: "Nessuna materia in corso.",
  addSubject: "Aggiungi una materia",
  emptyUpcoming: "Niente in programma nei prossimi giorni.",
  emptyGoals: "Nessun obiettivo in corso.",
  addGoal: "Crea un obiettivo",
  emptyMaterials: "Ancora nessun materiale.",
  addMaterial: "Aggiungi PDF, slide o link",
  /** Detto in coda alle righe cliccabili, dopo il loro testo visibile. */
  openAction: "apri",
  findAction: "cerca nei materiali",
  reviews: (count: number) => `${count} ${count === 1 ? "argomento da ripassare" : "argomenti da ripassare"}`,
  preparation: (value: number) => `preparazione ${value}%`,
  importance: (value: number) => `Importanza ${value}/5`
} as const;

/** Home: timer di studio avviato (al posto di «Inizia a studiare»), tocca per tornare a Studio. */
export const HOME_TIMER_TEXT = {
  paused: "In pausa",
  ended: "Da salvare",
  aria: (summary: string) => `Timer di studio: ${summary}. Apri Studio`,
  title: "Torna al timer nella sezione Studio"
} as const;

export const HOME_HELP = {
  next: {
    title: "Cosa fare adesso",
    text: "In cima va l'attività che conta di più: pesano la priorità, l'importanza e quanto è vicina la scadenza."
  },
  effort: {
    title: "Energia e importanza",
    text: "L'energia dice quanta concentrazione serve; l'importanza, da 1 a 5, quanto conta per te. Le cambi aprendo l'attività.",
    example: "ripassare le formule chiede poca energia, scrivere una relazione molta."
  },
  preparation: {
    title: "Preparazione",
    text: "Quanto ti senti pronto per l'esame, da 0 a 100%. La aggiorni tu in Esami."
  }
} as const;

/** Home: riquadro delle prossime ricorrenze (compleanni, anniversari). */
export const HOME_OCCASIONS_TEXT = {
  title: "Prossime ricorrenze",
  today: "Oggi",
  tomorrow: "Domani",
  inDays: (count: number) => `tra ${count} giorni`,
  openCalendar: "Apri calendario"
} as const;
