// Materie.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

const countWord = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Archiviare una materia dalla sua scheda (con Annulla) ed eliminarla per sempre dalle Archiviate. */
export const SUBJECT_REMOVE_TEXT = {
  archive: "Archivia",
  archiveAria: (name: string) => `Archivia ${name}`,
  archived: (name: string) => `«${name}» archiviata: attività, esami e materiali restano. La ritrovi in «Archiviate».`,
  undo: "Annulla",
  deleteForever: "Elimina per sempre",
  deleteAria: (name: string) => `Elimina per sempre ${name}`,
  confirm: (name: string, exams: number, graded: number, topics: number) => {
    const parts = [
      exams ? `${countWord(exams, "esame", "esami")}${graded ? " (voti compresi)" : ""}` : "",
      topics ? countWord(topics, "argomento", "argomenti") : ""
    ].filter(Boolean);
    const single = parts.length === 1 && exams + topics === 1;
    const lost = parts.length ? ` Si ${single ? "cancella" : "cancellano"} anche ${parts.join(" e ")}.` : "";
    return `Eliminare per sempre «${name}»?${lost} Attività, eventi, sessioni e materiali restano, senza materia. Non si può annullare.`;
  }
} as const;

const daysText = (count: number) => `${count} ${count === 1 ? "giorno" : "giorni"}`;

export const SUBJECTS_TEXT = {
  /** "3 materie in corso · 21 CFU (1° semestre 15 CFU · 2° semestre 6 CFU)". */
  subtitle: (count: number, cfu: number, bySemester: string) =>
    `${count} ${count === 1 ? "materia in corso" : "materie in corso"} · ${cfu} CFU${bySemester ? ` (${bySemester})` : ""}. Tocca una materia per vederne esami, materiali e argomenti.`,
  subtitleEmpty: "Aggiungi le materie che segui: ognuna raccoglie esami, attività, materiali e ore di studio.",
  semesterFilter: "Filtra le materie per semestre",
  /** Nel dettaglio dei CFU del sottotitolo, al posto di «Da definire». */
  noSemester: "senza semestre",
  noSemesterFilter: "Senza semestre",
  allSemesters: "Tutte",
  add: "Aggiungi materia",
  nameField: "Nome della nuova materia",
  namePlaceholder: "Nome della materia (Es. Biochimica)",
  chooseFromCourse: "Scegli dal corso di laurea",
  emptyTitle: "Ancora nessuna materia",
  emptyBodyCourse: "Scegli le materie dal piano del tuo corso di laurea, oppure scrivi il nome qui sopra. Es.: «Biochimica».",
  emptyBody: "Scrivi il nome qui sopra e premi «Aggiungi materia»: qui vedrai CFU, esami e ore di studio. Es.: «Biochimica».",
  noneInSemesterTitle: "Nessuna materia in questo periodo",
  noneInSemesterBody: "Scegli un altro semestre oppure torna a tutte le materie.",
  showAll: "Mostra tutte le materie",
  cardMenu: (name: string) => `Azioni per ${name}`,
  markAs: (status: string) => `Segna come ${status.toLowerCase()}`,
  /** «⋯» della scheda: apre «Registra il voto»; la materia è superata quando l'esito è salvato. */
  markPassed: "Superata: registra il voto",
  otherStatus: "Altro stato…",
  otherStatusTitle: (name: string) => `Stato di «${name}»`,
  cancel: "Annulla",
  /** Dettaglio chiuso con dati della materia cambiati e non salvati. */
  unsavedTitle: "Scartare le modifiche?",
  unsavedText: "Hai cambiato i dati della materia (nome, CFU, colore…) senza salvarli.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche",
  restore: "Ripristina",
  restoreSubject: "Ripristina materia",
  archiveSubject: "Archivia materia",
  completed: "Superate",
  archivedGroup: "Archiviate",
  days: daysText,
  /** Pillola dell'esame sulla scheda: "12 dic · 30 giorni"; oggi "oggi"; già passato senza esito "esito da registrare". */
  examPill: (date: string, count: number) =>
    `${date} · ${count < 0 ? "esito da registrare" : count === 0 ? "oggi" : daysText(count)}`,
  /** Esame non superato senza la nuova data. */
  examPillToDecide: "Esame: nuova data da decidere",
  examToDecide: "Da decidere",
  openExam: (name: string) => `Apri l'esame di ${name}`,
  examIn: "Esame tra",
  /** Esame già passato senza esito: il riquadro non dice «tra 0 giorni». */
  examPast: "Esame del",
  examInValue: (count: number) => (count < 0 ? "Esito da registrare" : count === 0 ? "Oggi" : daysText(count)),
  openTask: (title: string) => `Apri l'attività «${title}»`,
  allTasks: "Vedi le attività della materia",
  noTasks: "Nessuna attività da fare per questa materia."
} as const;

export const SUBJECTS_HELP = {
  cfu: {
    title: "CFU",
    text: "I crediti dell'esame: dicono quanto pesa.",
    example: "nella media ponderata un esame da 9 CFU conta più di uno da 6."
  },
  archive: {
    title: "Archivia",
    text: "La materia sparisce dall'elenco, ma attività, esami e materiali restano. La ritrovi in «Archiviate», da dove puoi anche eliminarla per sempre."
  },
  semester: {
    title: "Semestre",
    text: "Se la segui in un periodo diverso da quello del piano ufficiale, sceglilo qui.",
    example: "la recuperi nel secondo semestre."
  }
} as const;
