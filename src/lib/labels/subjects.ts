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
  add: "Nuova materia",
  chooseFromCourse: "Scegli dal corso di laurea",
  emptyTitle: "Ancora nessuna materia",
  emptyBodyCourse: "Scegli le materie dal piano del tuo corso di laurea, oppure premi «Nuova materia» qui sopra. Es.: «Biochimica».",
  emptyBody: "Premi «Nuova materia» qui sopra e scrivi il nome: qui vedrai CFU, esami e ore di studio. Es.: «Biochimica».",
  noneInSemesterTitle: "Nessuna materia in questo periodo",
  noneInSemesterBody: "Scegli un altro semestre oppure torna a tutte le materie.",
  showAll: "Mostra tutte le materie",
  cardMenu: (name: string) => `Azioni per ${name}`,
  progressTitle: "Progressi della materia",
  markAs: (status: string) => `Segna come ${status.toLowerCase()}`,
  /** «⋯» della scheda: apre «Registra il voto»; la materia è superata quando l'esito è salvato. */
  markPassed: "Superata: registra il voto",
  otherStatus: "Altro stato…",
  otherStatusTitle: (name: string) => `Stato di «${name}»`,
  cancel: "Annulla",
  /** Dettaglio chiuso con dati della materia cambiati e non salvati. */
  unsavedTitle: "Scartare le modifiche?",
  unsavedText: "Hai cambiato i dati della materia (nome, CFU, colore…) senza salvarli.",
  /** Solo un argomento o un materiale in modifica nel dettaglio, non salvato. */
  unsavedItemText: "Hai cambiato un argomento o un materiale senza salvarlo.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche",
  restore: "Ripristina",
  restoreSubject: "Ripristina materia",
  archiveSubject: "Archivia materia",
  completed: "Superate",
  /** Materie «Completata» (al 100% o segnate a mano) senza voto nel libretto: gruppo in alto, aperto. */
  pendingGroup: "Voto da registrare",
  pendingTag: "Voto da registrare",
  recordGrade: "Registra il voto",
  recordGradeAria: (name: string) => `Registra il voto di ${name}`,
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
  noTasks: "Nessuna attività da fare per questa materia.",
  cfuMissing: "Scrivi i CFU: un numero da 0 a 60.",
  cfuInvalid: "CFU non validi: scrivi un numero da 0 a 60.",
  // Materiali nel dettaglio della materia.
  seeInMaterials: "Vedi in Materiali",
  openMaterial: (name: string) => `Apri il link ${name}`,
  downloadMaterial: (name: string) => `Scarica ${name}`,
  editMaterial: (name: string) => `Modifica ${name}`,
  removeMaterial: (name: string) => `Elimina ${name}`,
  removeMaterialConfirm: (name: string) => `Eliminare «${name}»? Il materiale viene tolto dall'app e non si può recuperare.`,
  removeMaterialYes: "Elimina materiale",
  materialUnsavedText: "Hai cambiato il materiale senza salvarlo.",
  saveChanges: "Salva modifiche"
} as const;

export const SUBJECTS_HELP = {
  pendingGrade: {
    title: "Voto da registrare",
    text: "Materie completate (al 100% o segnate da te) che nel libretto non hanno ancora il voto. Quando lo registri passano tra le Superate. Se non hai finito, dal menu ⋯ scegli «Segna come in corso».",
    example: "finisci l'ultima attività di Biochimica: la materia arriva al 100% e compare qui."
  },
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

/** Riquadro «Possibili doppioni» di Materie e unione di due materie. */
export const SUBJECT_DUPLICATE_TEXT = {
  title: (count: number) => (count === 1 ? "Una materia sembra doppia" : `${count} materie sembrano doppie`),
  intro: "Attività, esami ed eventi divisi su due copie non contano insieme nei progressi. Unisci le copie, oppure di' che sono materie diverse.",
  pair: (a: string, b: string) => `«${a}» e «${b}»`,
  reason: {
    name: "stesso nome",
    course: "stesso insegnamento del corso",
    teacher: "stesso docente e nome simile",
    words: "stesso nome detto in modo diverso",
    partial: "nome simile"
  } as Record<string, string>,
  merge: "Unisci…",
  mergeAria: (a: string, b: string) => `Unisci ${a} e ${b}`,
  distinct: "Sono diverse",
  distinctAria: (a: string, b: string) => `${a} e ${b} sono materie diverse: non proporle più`,
  nameLegend: "Nome da tenere",
  catalogNote: (name: string) => `Resta «${name}», collegata al corso di laurea: CFU, docente e appelli ufficiali continuano a funzionare.`,
  moves: (name: string, list: string) => (list ? `Passano a «${name}»: ${list}.` : `L'altra copia non ha niente di collegato.`),
  fields: "I campi vuoti si completano con quelli dell'altra copia; le note si uniscono senza ripetersi.",
  confirm: "Unisci le materie",
  cancel: "Annulla",
  merged: (name: string, list: string) => `Fatto: ora tutto è in «${name}»${list ? ` (${list})` : ""}.`,
  more: (count: number) => `Altre ${count} coppie: le vedi dopo aver sistemato queste.`
} as const;

/** Nomi per «Passano a …»: le collezioni che la persona riconosce. Le altre (stato interno) non si elencano. */
export const MOVED_LABELS: Record<string, [string, string]> = {
  tasks: ["attività", "attività"],
  exams: ["esame", "esami"],
  events: ["evento", "eventi"],
  sessions: ["sessione di studio", "sessioni di studio"],
  topics: ["argomento", "argomenti"],
  attachments: ["materiale", "materiali"],
  notes: ["nota", "note"],
  reminders: ["promemoria", "promemoria"],
  examPlans: ["piano d'esame", "piani d'esame"],
  goals: ["obiettivo", "obiettivi"],
  decks: ["mazzo", "mazzi"],
  flashcards: ["scheda", "schede"],
  quizzes: ["quiz", "quiz"],
  quizQuestions: ["domanda", "domande"],
  aiAnalyses: ["analisi", "analisi"]
};

export const movedList = (moved: Partial<Record<string, number>>): string =>
  Object.entries(MOVED_LABELS)
    .filter(([key]) => (moved[key] ?? 0) > 0)
    .map(([key, [one, many]]) => `${moved[key]} ${moved[key] === 1 ? one : many}`)
    .join(", ");

/** Modulo di una materia: «Nuova materia» e «Dati della materia» nel dettaglio. */
export const SUBJECT_FORM_TEXT = {
  eyebrow: "Nuova materia",
  title: "Che materia segui?",
  intro: "Bastano nome e CFU: il resto è facoltativo e puoi aggiungerlo anche dopo.",
  name: "Nome",
  namePlaceholder: "Es. Biochimica",
  teacher: "Docente (facoltativo)",
  icon: "Icona",
  iconOption: (label: string) => `Icona ${label}`,
  courseIcon: "Icona del corso di laurea",
  color: "Colore",
  customColor: "Colore personalizzato",
  status: "Stato",
  targetGrade: "Voto obiettivo (facoltativo)",
  notes: "Note (facoltative)",
  moreDetails: "Altri dettagli: icona, colore, stato, voto obiettivo, note",
  officialNew: "Da definire",
  create: "Crea materia",
  createAnyway: "Crea comunque",
  creating: "Creazione…",
  cancel: "Annulla",
  /** Avvisi sotto il nome mentre si scrive. */
  exists: (name: string) => `Hai già «${name}»: usa quella invece di crearne un'altra.`,
  similar: (names: string[]) =>
    names.length === 1 ? `Forse è «${names[0]}», che hai già.` : `Forse è una di queste, che hai già: ${names.map((name) => `«${name}»`).join(", ")}.`,
  similarHint: "Se è un'altra materia, crea pure.",
  open: (name: string) => `Apri «${name}»`,
  created: (name: string) => `Materia «${name}» creata.`,
  saveError: "Non è stato possibile salvare la materia. Riprova tra qualche secondo."
} as const;
