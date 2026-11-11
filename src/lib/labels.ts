// Etichette italiane per i valori enum salvati nei dati: la UI non mostra mai i codici interni.
import type { Attachment, CalendarEvent, Exam, Goal, StudySession, Subject, Task } from "../types";
import type { InviteBlock, ItemRevision, ShareAction, ShareInviteStatus, SharePermission, ShareScope } from "./sharing";
import type { RevertSummary } from "./shareHistory";

export const PRIORITY_LABEL: Record<Task["priority"], string> = {
  low: "Bassa",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente"
};

export const ENERGY_LABEL: Record<Task["energy"], string> = {
  low: "Energia bassa",
  medium: "Energia media",
  high: "Energia alta"
};

export const TASK_STATUS_LABEL: Record<Task["status"], string> = {
  todo: "Da fare",
  doing: "In corso",
  blocked: "Bloccata",
  done: "Completata",
  postponed: "Rimandata",
  archived: "Archiviata"
};

export const SUBJECT_STATUS_LABEL: Record<Subject["status"], string> = {
  "not-started": "Non iniziata",
  active: "In corso",
  review: "Da ripassare",
  "exam-ready": "Pronta per l'esame",
  completed: "Completata",
  archived: "Archiviata"
};

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

/** Pezzi comuni dell'interfaccia: menu "Altre azioni", aiuto "?" (HelpTip), aggiunta rapida. */
export const UI_TEXT = {
  moreActions: "Altre azioni",
  help: "Aiuto",
  helpAria: (title: string) => `Aiuto: ${title}`,
  example: "Per esempio:",
  close: "Chiudi",
  /** Scadenza dell'attività nell'aggiunta rapida: parte vuota, si può scegliere. */
  dueOptional: "Entro quando? (facoltativa)"
} as const;

/** Un solo nome, ovunque, per aggiungere le date d'esame ufficiali dell'università. */
export const OFFICIAL_EXAMS_ADD_LABEL = "Aggiungi appelli ufficiali";

export const EXAM_STATUS_LABEL: Record<Exam["status"], string> = {
  planning: "Da pianificare",
  studying: "In preparazione",
  reviewing: "In ripasso",
  ready: "Pronto per l'esame",
  done: "Sostenuto"
};

/** Esami: intestazione, schede, collegamenti della scheda d'esame, stati vuoti, date ufficiali. */
export const EXAMS_TEXT = {
  title: "Esami",
  subtitle: "Le date dei tuoi esami, quanto sei pronto e le date ufficiali degli appelli. Voti e medie sono in Libretto e laurea.",
  tabsLabel: "Quali esami vedere",
  tabPersonal: "I miei esami",
  tabOfficial: "Date ufficiali",
  addExam: "Aggiungi esame",
  recordGrade: "Registra un voto",
  shareProgress: "Condividi i progressi",
  study: "Studia",
  readiness: "Quanto sei pronto",
  tasksLink: (count: number) => `${count} attività da fare`,
  tasksAria: (name: string) => `Apri le attività di ${name}`,
  studyLink: (time: string) => `${time} di studio`,
  studyAria: (name: string) => `Studia ${name}: apre il timer con la materia già scelta`,
  studyTimeAria: (name: string) => `Tempo già studiato per ${name}: apri lo Studio con questa materia`,
  topicsLink: (count: number) => `${count} ${count === 1 ? "argomento" : "argomenti"} da ripassare`,
  topicsAria: "Apri gli argomenti da ripassare in Studio",
  riskHigh: "Sei indietro",
  riskMedium: "Un po' indietro",
  noSubjectsTitle: "Ancora nessuna materia",
  noSubjectsBody: "Ogni esame appartiene a una materia: aggiungi prima la materia, poi la data dell'esame. Per esempio: Biochimica, poi l'esame del 14 febbraio.",
  goToSubjects: "Vai a Materie",
  pickFromDegree: "Scegli dal corso di laurea",
  noUpcomingTitle: "Ancora nessun esame in arrivo",
  noUpcomingBody: "Aggiungi la data del prossimo esame: qui vedrai i giorni che mancano e quanto sei pronto. Per esempio: Biochimica, 14 febbraio alle 9:00.",
  officialTitle: "Date ufficiali degli appelli",
  courseFilter: "Insegnamento",
  allCourses: "Tutti gli insegnamenti",
  legacy: "Vecchio piano di studi (F92)",
  browseByCourse: "Sfoglia per insegnamento",
  browseByCourseHint: "Scegli un insegnamento per vedere tutte le sue date, anche quelle passate.",
  coursesInPlan: (count: number) => `${count} insegnamenti nel piano`,
  sameDay: (days: number) => `${days} ${days === 1 ? "giorno" : "giorni"} con più appelli`,
  noSessionsInPeriodBody: "Cambia periodo, oppure scegli un insegnamento nel filtro qui sopra per vedere tutte le sue date.",
  incompleteSources: "Alcune fonti ufficiali sono incomplete: qui vedi solo le date verificate.",
  registrations: (count: number) => `${count} iscrizioni diverse: tocca per sceglierne una`,
  registrationsCount: (count: number) => `${count} iscrizioni negli elenchi ufficiali`,
  officialEyebrow: "Appello ufficiale"
} as const;

/** Tipo di prova e momento degli appelli ufficiali. */
export const BARB_EXAM_TYPE_LABEL: Record<string, string> = {
  written: "Scritto",
  oral: "Orale",
  practical: "Pratico",
  exam: "Esame",
  partial: "Parziale"
};
export const BARB_EXAM_TYPE_MISSING = "Tipo non pubblicato";
export const BARB_EXAM_TIMING_LABEL = { passato: "Passato", prossimo: "Prossimo", futuro: "Futuro" } as const;

/** Aiuto "?" della sezione Esami. */
export const EXAMS_HELP = {
  riskHigh: {
    title: "Sei indietro",
    text: "Mancano meno di 10 giorni e la preparazione è sotto il 70%.",
    example: "mancano 8 giorni e sei al 60%. Dopo ogni sessione di studio alza la preparazione con +."
  },
  riskMedium: {
    title: "Un po' indietro",
    text: "Mancano meno di 20 giorni e la preparazione è sotto il 55%.",
    example: "mancano 15 giorni e sei al 40%. Dopo ogni sessione di studio alza la preparazione con +."
  },
  readiness: {
    title: "Quanto sei pronto",
    text: "Quanto ti senti pronto, da 0 a 100%. Lo decidi tu: aggiornalo con + e − dopo lo studio.",
    example: "hai finito metà del programma → 50%."
  },
  official: (covered: number, total: number, sessions: number, checked: string) => ({
    title: "Date ufficiali",
    text: `Le date d'esame pubblicate dall'università per tutti gli insegnamenti del corso: ${covered} insegnamenti su ${total} hanno date, ${sessions} appelli in tutto (fonti controllate il ${checked}). Non entrano nel tuo calendario finché non le aggiungi. Se un insegnamento non ha date, non vuol dire che non ci siano esami: qui compaiono solo le date verificate.`,
    example: "tocca un appello per vedere orario, aula e date di iscrizione."
  }),
  sameDay: (dates: string) => ({
    title: "Più appelli nello stesso giorno",
    text: `${dates}. Stesso giorno non vuol dire stessa ora: controlla gli orari nei dettagli di ogni appello.`
  }),
  legacy: {
    title: "Vecchio piano di studi (F92)",
    text: "Insegnamenti del piano di studi degli anni passati. Ti servono solo se devi ancora sostenere un esame del vecchio piano."
  }
} as const;

/** Libretto e laurea: corso di laurea in sola lettura, stato vuoto. */
export const CAREER_TEXT = {
  rulesOf: (name: string, level: string, cfu: number) => `Regole di: ${name} · ${level} · ${cfu} CFU`,
  changeInSettings: "Cambia in Impostazioni",
  changeInSettingsAria: "Cambia il corso di laurea in Impostazioni",
  basis: "Media da usare",
  recordGrade: "Registra un voto",
  emptyTitle: "Ancora nessun voto nel libretto",
  emptyBody: "Registra i voti degli esami che hai superato: medie e voto di laurea previsto si aggiornano da soli. Per esempio: Biochimica, 28, 6 CFU."
} as const;

/** Aiuto "?" di Libretto e laurea e del pannello del voto. */
export const CAREER_HELP = {
  weighted: {
    title: "Media ponderata",
    text: "Gli esami con più CFU contano di più. La lode vale 30.",
    example: "30 in un esame da 12 CFU e 24 in uno da 6 → (30×12 + 24×6) / 18 = 28."
  },
  arithmetic: {
    title: "Media aritmetica",
    text: "Media semplice dei voti: ogni esame conta uguale, qualunque sia il numero di CFU.",
    example: "30 e 24 → (30 + 24) / 2 = 27."
  },
  cfu: {
    title: "CFU acquisiti",
    text: "I crediti degli esami superati, idoneità comprese, sul totale del tuo corso di laurea.",
    example: "superi un esame da 6 CFU → i CFU acquisiti salgono di 6."
  },
  base: {
    title: "Voto di partenza",
    text: "La media ponderata portata su 110: è il punto da cui parte il voto di laurea.",
    example: "media 27 → 27 × 110 / 30 = 99."
  },
  basis: {
    title: "Media da usare",
    text: "Puoi includere i voti obiettivo degli esami che devi ancora dare, per vedere dove arriveresti."
  },
  passFail: {
    title: "Idoneità",
    text: "Esame senza voto: ti dà i CFU ma non entra nella media.",
    example: "inglese B2."
  },
  honors: {
    title: "Lode",
    text: "Nella media vale 30. In alcuni corsi aggiunge punti al voto di laurea."
  }
} as const;

/** Corso di laurea: filtri cliccabili, fonti, dettagli tecnici chiusi per chi gestisce l'app. */
export const BARB_TEXT = {
  meta: (name: string, year: string, verified: string) => `${name} · anno accademico ${year} · dati verificati il ${verified}`,
  degreeRow: "Corso di laurea",
  semesterFilterOn: "Filtro attivo",
  semesterFilterOff: "Mostra solo questi",
  semesterHelpTitle: (label: string) => `Orario del ${label}`,
  coursesTile: "Insegnamenti",
  coursesTileHint: (offered: number) => `${offered} attivi quest'anno`,
  teachersTile: "Docenti",
  teachersTileHint: (contacts: number) => `${contacts} contatti ufficiali`,
  mine: "Nelle tue materie",
  mineGroupAria: "Nelle tue materie: mostra solo quelle, anche per semestre",
  mineAll: (count: number) => `Tutte · ${count}`,
  mineSemester: (label: string, count: number, cfu: number) => `${label} · ${count} ${count === 1 ? "insegnamento" : "insegnamenti"} · ${cfu} CFU`,
  openDetails: "Apri i dettagli",
  alreadyAdded: "Già nelle tue materie",
  officialSource: "Fonte ufficiale:",
  openOfficialPage: "Apri la pagina ufficiale",
  verifiedOn: (date: string) => `verificata il ${date}`,
  reliability: (percent: number) => `Affidabilità stimata dei dati: ${percent}%`,
  sourceAddress: "Indirizzo della fonte:",
  conflictNote: "Da verificare:",
  lastUpdate: (date: string, changes: number) => `${date} · ${changes} ${changes === 1 ? "modifica" : "modifiche"}`,
  technicalDetails: "Dettagli tecnici (per chi gestisce l'app)",
  technicalPages: (count: number) => `${count} pagine controllate all'ultimo aggiornamento, con il codice di risposta`,
  technicalLog: "Registro degli aggiornamenti"
} as const;

/** Tipo di insegnamento nel piano di studi (prima in BarbView). */
export const BARB_CHARACTER_LABEL: Record<string, string> = {
  obbligatorio: "Obbligatorio",
  "opzionale-scelta-guidata": "Scelta guidata",
  "scelta-libera": "Scelta libera",
  lingua: "Lingua",
  "altre-conoscenze": "Altre conoscenze",
  "tirocinio-tesi": "Tirocinio e tesi"
};

/** Aiuto "?" della sezione Corso di laurea. */
export const BARB_HELP = {
  ssd: {
    title: "Settore (SSD)",
    text: "Il codice della disciplina usato dall'università.",
    example: "BIO/10 è Biochimica."
  },
  choiceGroup: {
    title: "Gruppi a scelta",
    text: "Da ogni gruppo scegli il numero di insegnamenti indicato accanto al titolo.",
    example: "dal Gruppo 2 ne scegli 2, per 12 CFU."
  },
  ariel: {
    title: "Ariel",
    text: "La piattaforma dell'Università di Milano con i materiali del corso: dispense, avvisi e registrazioni."
  }
} as const;

export const GOAL_STATUS_LABEL: Record<Goal["status"], string> = {
  active: "Attivo",
  paused: "In pausa",
  done: "Raggiunto",
  archived: "Archiviato"
};

export const GOAL_CATEGORY_LABEL: Record<Goal["category"], string> = {
  study: "Studio",
  exam: "Esame",
  notes: "Appunti",
  review: "Ripasso",
  streak: "Costanza",
  fitness: "Sport",
  personal: "Personale",
  project: "Progetto"
};

// ——— Attività, Materie, Materiali, Obiettivi e Home: riepiloghi, filtri, collegamenti, aiuti "?" ———

/** Pillola di un filtro attivo, uguale in ogni sezione: "In ritardo ✕", "Solo: Analisi ✕". */
export const FILTER_CHIP_TEXT = {
  only: (name: string) => `Solo: ${name}`,
  clear: (name: string) => `Togli il filtro «${name}»`
} as const;

/** "Condividi" come voce del menu "Altre azioni". */
export const SHARE_ACTION_LABEL = "Condividi";

export const TASKS_TEXT = {
  newTask: "Nuova attività",
  summary: "Riepilogo delle attività da fare",
  open: (count: number) => `${count} da fare`,
  overdue: (count: number) => `${count} in ritardo`,
  urgent: (count: number) => `${count} ${count === 1 ? "urgente" : "urgenti"}`,
  planned: (minutes: number) => `${formatMinutes(minutes)} previste`,
  /** Nome del filtro nella pillola "✕" e nell'aiuto dei pulsanti del riepilogo. */
  filterName: { overdue: "In ritardo", urgent: "Urgenti" },
  filterAria: { overdue: "Mostra solo le attività in ritardo", urgent: "Mostra solo le attività urgenti" },
  activeFilters: "Filtri attivi",
  quickAdd: "Aggiunta rapida",
  quickAddField: "Scrivi un'attività",
  quickAddPlaceholder: "Scrivi un'attività…",
  details: "Dettagli",
  detailsAria: "Dettagli: materia, priorità e scadenza",
  add: "Aggiungi",
  subjectOptional: "Materia (facoltativa)",
  noSubject: "Nessuna materia",
  priority: "Priorità",
  dueOptional: "Scadenza (facoltativa)",
  /** Dopo l'aggiunta rapida con un filtro attivo: l'attività può non comparire nell'elenco filtrato. */
  addedFiltered: (title: string) => `Aggiunta «${title}». Se non la vedi, togli i filtri.`,
  views: "Come vedere le attività",
  sortBy: "Ordina per",
  emptyTitle: "Ancora nessuna attività",
  emptyBody: "Qui annoti compiti, consegne e cose da studiare. Es.: «Esercizi 1–10 di pagina 52, entro venerdì».",
  fromCalendar: "Scegli dal calendario",
  filteredEmptyTitle: "Nessuna attività con questi filtri",
  filteredEmptyBody: "Togli i filtri per rivedere tutte le attività da fare.",
  clearFilters: "Togli i filtri",
  noneHereTitle: "Niente da fare qui",
  noneHereBody: "Non hai attività da fare da mostrare in questa vista. Es.: aggiungine una dalla lista.",
  backToList: "Torna alla lista",
  focusTitle: "Piano di oggi",
  howItWorks: "Come funziona?",
  close: "Chiudi senza salvare"
} as const;

export const TASKS_HELP = {
  views: {
    title: "Come vedere le attività",
    text: "Lista: tutte, divise per scadenza. Piano di oggi: le 6 più urgenti. Per materia: divise per materia. Per stato: colonne Da fare, In corso, Completata… tra cui spostarle. Urgenza e importanza: quattro riquadri per decidere cosa fare prima."
  },
  focus: { title: "Piano di oggi", text: "Le 6 attività da fare più urgenti, in ordine di scadenza e priorità." },
  matrix: {
    title: "Urgenza e importanza",
    text: "Quattro riquadri per decidere cosa fare prima. Urgente = priorità alta o urgente. Importante = importanza 4 o 5, che imposti aprendo l'attività.",
    example: "«Consegnare la relazione domani» va in «Fai ora»."
  },
  effort: {
    label: "A cosa servono?",
    title: "Importanza, difficoltà ed energia",
    text: "Ti aiutano a scegliere cosa fare in base a come stai.",
    example: "se sei stanco, scegli un'attività con energia bassa, come riordinare gli appunti."
  },
  status: {
    title: "Stato «In corso»",
    text: "Quando metti un'attività «In corso» parte un timer che misura quanto ci metti. Lo fermi cambiando stato."
  }
} as const;

const daysText = (count: number) => `${count} ${count === 1 ? "giorno" : "giorni"}`;

export const SUBJECTS_TEXT = {
  /** "3 materie in corso · 21 CFU (1° semestre 15 CFU · 2° semestre 6 CFU)". */
  subtitle: (count: number, cfu: number, bySemester: string) =>
    `${count} ${count === 1 ? "materia in corso" : "materie in corso"} · ${cfu} CFU${bySemester ? ` (${bySemester})` : ""}. Tocca una materia per vederne esami, materiali e argomenti.`,
  subtitleEmpty: "Aggiungi le materie che segui: ognuna raccoglie esami, attività, materiali e ore di studio.",
  semesterFilter: "Filtra le materie per semestre",
  allSemesters: "Tutte",
  add: "Aggiungi materia",
  nameField: "Nome della nuova materia",
  namePlaceholder: "Nome della materia (Es. Biochimica)",
  chooseFromCourse: "Scegli dal corso di laurea",
  typeName: "Scrivi il nome",
  emptyTitle: "Ancora nessuna materia",
  emptyBodyCourse: "Scegli le materie dal piano del tuo corso di laurea, oppure scrivi il nome qui sopra. Es.: «Biochimica».",
  emptyBody: "Scrivi il nome qui sopra e premi «Aggiungi materia»: qui vedrai CFU, esami e ore di studio. Es.: «Biochimica».",
  noneInSemesterTitle: "Nessuna materia in questo periodo",
  noneInSemesterBody: "Scegli un altro semestre oppure torna a tutte le materie.",
  showAll: "Mostra tutte le materie",
  cardMenu: (name: string) => `Azioni per ${name}`,
  markAs: (status: string) => `Segna come ${status.toLowerCase()}`,
  restore: "Ripristina",
  restoreSubject: "Ripristina materia",
  archiveSubject: "Archivia materia",
  completed: "Superate",
  archivedGroup: "Archiviate",
  days: daysText,
  /** Pillola dell'esame sulla scheda: "12 dic · 30 giorni". */
  examPill: (date: string, count: number) => `${date} · ${daysText(count)}`,
  openExam: (name: string) => `Apri l'esame di ${name}`,
  examIn: "Esame tra",
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
  emptyBody: "Qui ritrovi dispense, appunti e link. Es.: le slide di una lezione o il link a un video.",
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

export const SESSION_STATUS_LABEL: Record<StudySession["status"], string> = {
  planned: "Pianificata",
  running: "In corso",
  completed: "Completata",
  skipped: "Saltata"
};

export const SESSION_TEMPLATE_LABEL: Record<StudySession["template"], string> = {
  "new-topic": "Nuovo argomento",
  review: "Ripasso",
  exercises: "Esercizi",
  "exam-simulation": "Simulazione esame",
  "pdf-reading": "Lettura PDF",
  "notes-cleanup": "Riordino appunti",
  memorization: "Memorizzazione",
  lab: "Laboratorio",
  "oral-prep": "Preparazione orale"
};

/** Le tre modalità del timer di studio. */
export const TIMER_KIND_LABEL: Record<"pomodoro" | "timer" | "stopwatch", string> = {
  pomodoro: "Pomodoro",
  timer: "Timer",
  stopwatch: "Cronometro"
};

/** Fasi del Pomodoro. */
export const TIMER_PHASE_LABEL: Record<"focus" | "short" | "long", string> = {
  focus: "Studio",
  short: "Pausa breve",
  long: "Pausa lunga"
};

/** Durate di partenza che un agente può chiedere (studyos_timer_control, campo `mode`). */
export const TIMER_MODE_LABEL: Record<"classic" | "pomodoro" | "deep-focus", string> = {
  pomodoro: "Pomodoro",
  classic: "Classico",
  "deep-focus": "Concentrazione lunga"
};

/** Da dove arriva una sessione di studio (assente = vecchia o aggiunta a mano). */
export const SESSION_SOURCE_LABEL: Record<"pomodoro" | "timer" | "stopwatch" | "manual", string> = {
  pomodoro: "Pomodoro",
  timer: "Timer",
  stopwatch: "Cronometro",
  manual: "Aggiunta a mano"
};

/** Timer di studio (vista Studio, impostazioni del timer, avvisi a fine blocco). */
export const TIMER_TEXT = {
  kindAria: "Modalità del timer",
  kindHelp: {
    title: "Pomodoro, Timer o Cronometro?",
    text: "Pomodoro: blocchi di studio con una pausa breve dopo ognuno e una pausa lunga ogni tanto; ogni blocco finito si salva da solo nelle tue ore. Timer: scegli quanto vuoi studiare e il tempo conta alla rovescia; alla fine controlli e salvi. Cronometro: il tempo conta in avanti finché non premi «Termina».",
    example: "Pomodoro: 25 minuti di studio e 5 di pausa. Timer: 1 h 30 min."
  },
  blockOf: (block: number, every: number) => `Blocco ${block} di ${every}`,
  idle: {
    pomodoro: "Scegli la materia e avvia: a fine blocco parte la pausa.",
    timer: "Scegli quanto vuoi studiare: il tempo conta alla rovescia.",
    stopwatch: "Studia quanto vuoi: il tempo conta in avanti."
  },
  timerEnded: (studied: string) => `Tempo finito · ${studied} di studio da salvare`,
  stoppedToSave: (studied: string) => `Fermo · ${studied} di studio da salvare`,
  timerPhase: (total: string) => `Timer · ${total}`,
  running: (studied: string) => `In corso · ${studied} di studio`,
  paused: (studied: string) => `In pausa · ${studied} di studio`,
  onBreak: "Alzati, bevi un bicchiere d'acqua, riposa gli occhi.",
  breakPaused: "Pausa ferma: riprendila o saltala.",
  target: (target: string) => `Obiettivo: ${target}`,
  targetReached: (target: string) => `Obiettivo di ${target} raggiunto: il cronometro continua.`,
  start: "Avvia",
  pause: "Pausa",
  resume: "Riprendi",
  finish: "Termina e salva",
  endEarly: "Termina prima",
  end: "Termina",
  saveEnded: "Rivedi e salva",
  finishHint: "Disponibile dopo almeno 1 minuto di studio",
  endCycle: "Termina il Pomodoro",
  skipBreak: "Salta la pausa",
  discard: "Scarta",
  discardHint: "Ferma il timer senza salvare",
  discardConfirm: (studied: string) => `Scartare ${studied} di studio? Non verranno salvati.`,
  discardConfirmShort: "Scartare il timer?",
  discardYes: "Sì, scarta",
  discardNo: "No",
  discarded: (studied: string) => `Sessione scartata (${studied}).`,
  undo: "Annulla",
  tooShort: "Studia almeno 1 minuto per poter salvare la sessione.",
  saved: (studied: string) => `Sessione salvata: ${studied}.`,
  cycleEnded: "Pomodoro terminato: i blocchi finiti sono già nelle tue ore.",
  switchBlocked: "Prima termina o scarta la sessione in corso.",
  subject: "Materia",
  noSubject: "Nessuna materia",
  noSubjectsYet: "Non hai ancora materie.",
  addSubjects: "Aggiungile",
  focusQuick: "Blocco di studio",
  minutes: (minutes: number) => `${minutes} min`,
  otherDuration: "Altra durata",
  timerDurationFor: (name: string) => `Durata per ${name}`,
  timerDurationDefault: "Durata per tutte le materie",
  timerQuick: "Durata del timer",
  hoursField: "Ore",
  minutesField: "Minuti",
  customApply: "Usa",
  customInvalid: "Scrivi una durata da 1 minuto a 10 ore.",
  whatField: "Cosa studi?",
  whatPlaceholder: "Argomento, capitolo o lezione (facoltativo)",
  whatTopic: "Argomento della materia",
  templateLine: (template: string) => `Tipo di sessione: ${template}`,
  breaksSummary: (short: number, long: number, every: number) => `Pausa ${short} min · lunga ${long} min ogni ${every} ${every === 1 ? "blocco" : "blocchi"}`,
  noTarget: "Nessun obiettivo",
  durationsFor: (name: string) => `Durate di ${name}`,
  defaultDurations: "Durate per tutte le materie",
  change: "Cambia",
  settings: "Impostazioni timer",
  templateField: "Tipo di sessione",
  templateHelp: {
    title: "Tipo di sessione",
    text: "Serve solo a ricordarti cosa hai fatto: lo vedi accanto alla sessione salvata.",
    example: "Esercizi."
  },
  detailsDone: "Fatto",
  tabTitle: (clock: string, label: string) => `${clock} · ${label}`
} as const;

/** Pannello "Impostazioni timer" (Drawer della vista Studio). */
export const TIMER_SETTINGS_TEXT = {
  eyebrow: "Studio",
  title: "Impostazioni timer",
  forSubject: (name: string) => `Valgono solo per ${name}: ogni materia ricorda le sue durate.`,
  forAll: "Valgono per tutte le materie che non hanno durate proprie.",
  focus: "Blocco di studio (minuti)",
  shortBreak: "Pausa breve (minuti)",
  longBreak: "Pausa lunga (minuti)",
  longBreakEvery: "Pausa lunga ogni (blocchi)",
  target: "Obiettivo del cronometro (minuti)",
  timer: "Timer (minuti)",
  targetHint: "Facoltativo: ti avvisa al traguardo e il cronometro continua.",
  invalid: (field: string, min: number, max: number) => `${field}: scrivi un numero intero da ${min} a ${max}.`,
  alsoDefaults: "Usa queste durate anche per le altre materie",
  backToDefaults: "Usa le durate generali",
  resetDefaults: "Torna a 25 · 5 · 15",
  save: "Salva",
  cancel: "Annulla",
  alerts: "Avvisi",
  sound: "Suono a fine blocco e pausa",
  vibrate: "Vibrazione (sui telefoni che la supportano)",
  systemTitle: "Avvisi fuori dall'app",
  systemText: "Ti avvisiamo anche quando StudyOS è in secondo piano.",
  systemEnable: "Attiva le notifiche",
  systemOn: "Notifiche attive su questo dispositivo.",
  systemBlocked: "Le notifiche sono bloccate: puoi riattivarle dalle impostazioni del browser per questo sito.",
  systemUnsupported: "Questo browser non mostra notifiche di sistema: resta l'avviso dentro l'app."
} as const;

/** Avvisi del timer (banner nell'app e notifica di sistema, se attivata). */
export const TIMER_ALERT_TEXT = {
  focusDone: (subject?: string) => `Blocco finito${subject ? ` · ${subject}` : ""}`,
  focusDoneBody: (studied: string, breakLabel: string, breakLength: string) => `${studied} salvati nelle tue ore. Ora ${breakLabel.toLowerCase()} di ${breakLength}.`,
  focusDoneBreakOver: (studied: string) => `${studied} salvati nelle tue ore. Anche la pausa è finita: avvia il prossimo blocco quando vuoi.`,
  timerDone: (subject?: string) => `Tempo finito${subject ? ` · ${subject}` : ""}`,
  timerDoneBody: (studied: string) => `${studied} di studio: controlla cosa hai fatto e salva.`,
  breakDone: "Pausa finita",
  breakDoneBody: "Pronto per il prossimo blocco?",
  targetReached: "Obiettivo raggiunto",
  targetReachedBody: (studied: string) => `Hai studiato ${studied}. Il cronometro continua: fermalo quando hai finito.`,
  close: "Chiudi",
  goToStudy: "Vai a Studio",
  startNext: "Avvia il blocco",
  skipBreak: "Salta la pausa",
  edit: "Modifica",
  undo: "Annulla"
} as const;

/** Riepilogo di Timer e Cronometro, modifica di una sessione salvata e "Aggiungi studio fatto". */
export const SESSION_FORM_TEXT = {
  eyebrow: "Studio",
  reviewTitle: "Riepilogo della sessione",
  reviewWhen: (kind: string, start: string, end: string) => `${kind} · dalle ${start} alle ${end}`,
  reviewWhenDays: (kind: string, start: string, end: string) => `${kind} · da ${start} a ${end}`,
  reviewStudied: (studied: string) => `${studied} di studio, pause escluse`,
  reviewIntro: "Controlla materia, argomento e minuti: puoi correggere tutto prima di salvare.",
  longTitle: (studied: string) => `${studied} senza salvare: sono più di 4 ore.`,
  longText: "Se il cronometro è rimasto acceso dopo lo studio, scrivi i minuti che hai studiato davvero: la fine si sposta di conseguenza.",
  longFix: "Correggi i minuti",
  editTitle: "Modifica sessione",
  addTitle: "Aggiungi studio fatto",
  addIntro: "Hai studiato senza timer, in biblioteca, a lezione o in gruppo? Aggiungilo qui: conterà nelle tue ore.",
  subject: "Materia",
  noSubject: "Nessuna materia",
  topic: "Argomento",
  noTopic: "Nessun argomento",
  title: "Descrizione (facoltativa)",
  titlePlaceholder: "Es. Capitolo 4, esercizi 3–5",
  notes: "Note (facoltative)",
  notesPlaceholder: "Cosa rivedere, dubbi da chiedere…",
  minutes: "Minuti di studio",
  minutesPlaceholder: "Es. 60",
  date: "Giorno",
  time: "Ora di inizio",
  template: "Tipo di sessione",
  savedWith: (source: string) => `Salvata con: ${source}`,
  endsAt: (time: string) => `Fine alle ${time}`,
  save: "Salva",
  saveAdd: "Salva sessione",
  cancel: "Annulla",
  discard: "Scarta",
  discardConfirm: (studied: string) => `Scartare ${studied} di studio? Non verranno salvati.`,
  discardYes: "Sì, scarta",
  discardNo: "No",
  discarded: (studied: string) => `Sessione scartata (${studied}).`,
  delete: "Elimina",
  deleteConfirm: "Eliminare la sessione? Le ore verranno tolte dalle statistiche.",
  deleteYes: "Sì, elimina",
  deleteNo: "No",
  deleted: (title: string) => `Sessione eliminata: ${title}.`,
  loadFailedReview: "Non riesco ad aprire il riepilogo",
  loadFailedReviewBody: "Il tempo studiato non è perso: controlla la connessione e tocca «Rivedi e salva» in Studio. Se succede ancora, ricarica la pagina.",
  loadFailedEdit: "Non riesco ad aprire la sessione",
  loadFailedEditBody: "Controlla la connessione e riprova. Se succede ancora, ricarica la pagina.",
  undo: "Annulla",
  saved: (studied: string) => `Sessione salvata: ${studied}.`,
  updated: "Sessione aggiornata.",
  added: (studied: string) => `Studio aggiunto: ${studied}.`,
  error: {
    minutes: "Scrivi i minuti di studio: un numero intero da 1 a 960 (16 ore).",
    start: "Controlla il giorno e l'ora di inizio.",
    future: "L'ora di inizio è nel futuro: scegli un momento già passato."
  }
} as const;

/** Sessioni senza argomento (tempo per argomento). */
export const NO_TOPIC_LABEL = "Senza argomento";

export const SUBJECT_STUDY_UNIT_LABEL: Record<"day" | "week" | "month", string> = {
  day: "Giorni",
  week: "Settimane",
  month: "Mesi"
};

/** Studio nella pagina della materia (Materie → dettaglio). */
export const SUBJECT_STUDY_TEXT = {
  title: "Studio",
  study: "Studia questa materia",
  average: (minutes: string) => `in media ${minutes}`,
  today: "Oggi",
  week: "Settimana",
  month: "Mese",
  unitAria: "Andamento per",
  trendAria: (unit: string, hours: string) => `Ore di studio di questa materia, ${unit}: ${hours} ore in tutto`,
  trendTooltip: "Studio",
  weekOf: (date: string) => `settimana dal ${date}`,
  byTopic: "Tempo per argomento",
  topicRow: (count: number, minutes: string) => `${minutes} · ${count} ${count === 1 ? "sessione" : "sessioni"}`,
  sessions: "Sessioni",
  showAll: (count: number) => `Mostra tutte (${count})`,
  showLess: "Mostra meno",
  empty: "Nessuna sessione per questa materia. Avvia il timer in Studio scegliendo questa materia: il tempo comparirà qui."
} as const;

/** Argomenti da ripassare: filtro per materia (Studio → Argomenti). */
const topicCount = (count: number) => `${count} ${count === 1 ? "argomento" : "argomenti"}`;
export const TOPIC_FILTER_TEXT = {
  aria: "Filtra per materia",
  all: (count: number) => `Tutte le materie · ${topicCount(count)}`,
  option: (name: string, count: number) => `${name} · ${topicCount(count)}`,
  showAll: "Mostra tutti",
  emptyFiltered: "Nessun argomento per questa materia. Scrivine uno qui sopra oppure importa il programma dell'esame dalla sezione Esami."
} as const;

/** Colonna laterale di Studio: i numeri portano dove servono. */
export const STUDY_SIDE_TEXT = {
  week: "Questa settimana",
  weekHint: (target: string, streak: number) =>
    `su ${target} h di obiettivo${streak ? ` · ${streak} ${streak === 1 ? "giorno" : "giorni"} di fila` : ""}`,
  weekProgress: "Ore di studio della settimana rispetto all'obiettivo",
  changeTarget: "Cambia obiettivo",
  upcoming: "Prossimi ripassi",
  seeAll: "Vedi tutti",
  noUpcoming: "Nessun altro ripasso in programma.",
  upcomingEmpty: "Qui vedrai quando ripassare ogni argomento."
} as const;

export const STATS_PERIOD_LABEL: Record<"week" | "month" | "semester", string> = {
  week: "Settimana",
  month: "Mese",
  semester: "Semestre"
};

export const STATS_TEXT = {
  title: "Statistiche",
  subtitle: "Quanto studi, su quali materie e quanto sei pronto per gli esami.",
  periodAria: "Periodo",
  previous: "Periodo precedente",
  next: "Periodo successivo",
  backToNow: "Torna a oggi",
  thisWeek: "Questa settimana",
  thisMonth: "Questo mese",
  thisSemester: "Questo semestre",
  studied: "Ore di studio",
  ofTarget: (target: string) => `su ${target} h di obiettivo`,
  hoursValue: (hours: string) => `${hours} h`,
  sessions: "Sessioni",
  sessionsHint: (average: string) => `in media ${average} l'una`,
  noSessionsHint: "Nessuna in questo periodo",
  streak: "Giorni di fila",
  streakHint: (streak: number) => (streak ? "fino a oggi" : "Studia oggi per iniziare"),
  streakHelp: {
    title: "Giorni di fila",
    text: "Giorni consecutivi con almeno una sessione di studio salvata.",
    example: "hai studiato lunedì, martedì e mercoledì → 3."
  },
  tasksDone: "Attività fatte",
  tasksEmptyHint: "Aggiungile in Attività",
  tasksHelp: {
    title: "Attività fatte",
    text: "Attività segnate come fatte nel periodo scelto."
  },
  reviews: "Ripassi fatti",
  reviewsEmptyHint: "Aggiungi argomenti in Studio",
  reviewsHelp: {
    title: "Ripassi fatti",
    text: "Argomenti ripassati nel periodo scelto. Conta l'ultimo ripasso di ogni argomento: se lo ripassi più volte, conta una volta sola."
  },
  trendDay: "Ore al giorno",
  trendWeek: "Ore a settimana",
  trendTotal: (hours: string) => `${hours} h in tutto`,
  trendAria: (period: string, hours: string) => `Ore di studio, ${period}: ${hours} ore in tutto`,
  trendTooltip: "Studio",
  trendEmpty: "Nessuna ora in questo periodo. Usa il timer in Studio o aggiungi lo studio fatto: le ore compariranno qui.",
  weekOf: (date: string) => `settimana dal ${date}`,
  bySubject: "Ore per materia",
  bySubjectAria: (hours: string) => `Ore per materia, ${hours} ore in tutto`,
  bySubjectEmpty: "Quando salvi una sessione di studio, qui vedrai come dividi le ore tra le materie.",
  openSubject: (name: string) => `Apri la materia ${name}`,
  howYouStudy: "Come studi",
  average: "Durata media",
  sessionsCount: (count: number) => `${count} ${count === 1 ? "sessione" : "sessioni"}`,
  sourceUnknown: "Senza indicazione",
  sourceRow: (count: number, minutes: string) => `${count} ${count === 1 ? "sessione" : "sessioni"} · ${minutes}`,
  howEmpty: "Qui vedrai quanto durano le tue sessioni e se le salvi con il Pomodoro, il Timer, il cronometro o a mano.",
  exams: "Preparazione esami",
  examsOrder: "Dal più vicino",
  examReady: (prep: number) => `${prep}% pronto`,
  examWhen: (days: number) => (days === 0 ? "oggi" : days === 1 ? "domani" : `tra ${days} giorni`),
  openExam: (name: string) => `Apri l'esame di ${name}`,
  examsEmpty: "Nessun esame in programma. Aggiungi la data di un esame nella sezione Esami per seguire qui quanto sei pronto.",
  watch: "Da tenere d'occhio",
  overdue: "Attività in ritardo",
  blocked: "Attività bloccate",
  postponed: "Attività rimandate",
  emptyTitle: "Ancora niente da contare",
  emptyBody: "Le statistiche si riempiono quando usi il timer o completi attività.",
  goToStudy: "Vai a Studio"
} as const;

export const EVENT_CATEGORY_LABEL: Record<CalendarEvent["category"], string> = {
  study: "Studio",
  lesson: "Lezione",
  lab: "Laboratorio",
  exam: "Esame",
  review: "Ripasso",
  deadline: "Scadenza",
  project: "Progetto",
  gym: "Palestra",
  personal: "Personale",
  work: "Lavoro",
  relax: "Relax",
  other: "Altro"
};

export const EVENT_STATUS_LABEL: Record<CalendarEvent["status"], string> = {
  planned: "Pianificato",
  "in-progress": "In corso",
  done: "Fatto",
  skipped: "Saltato"
};

/** Calendario: intestazione, menu "Altre azioni", viste, filtro per materia, riepiloghi, stati vuoti. */
export const CALENDAR_TEXT = {
  subtitle: "Lezioni, studio, scadenze ed esami.",
  newEvent: "Nuovo evento",
  importFile: "Importa da un altro calendario",
  exportFile: "Esporta il calendario",
  share: "Condividi",
  officialDates: "Date ufficiali degli appelli",
  subjectSummary: "Riepilogo per materia",
  examSummary: "Riepilogo esami",
  backToCalendar: "Torna al calendario",
  viewsLabel: "Vista calendario",
  dayFocus: "Solo 8–19, ore grandi",
  dayFocusTitle: "Mostra il giorno dalle 8 alle 19, con le ore più grandi",
  filterLabel: "Mostra gli impegni di una materia",
  allSubjects: "Tutte",
  onlySubject: (name: string) => `Solo: ${name}`,
  clearFilter: (name: string) => `Togli «Solo: ${name}» e mostra tutte le materie`,
  showAll: "Mostra tutte le materie",
  addEvent: "Aggiungi un evento",
  emptySubject: (name: string) => `Nessun impegno di ${name} in questo periodo`,
  emptyWeek: "Settimana senza impegni",
  sharedCalendars: "Calendari condivisi:",
  summaryCounts: (planned: number, withItems: number) =>
    `${planned} ${planned === 1 ? "materia" : "materie"} nel piano di studio · ${withItems} con impegni in calendario`,
  summaryHint: "Tocca una materia per vedere nel calendario solo i suoi impegni.",
  summaryItems: (items: number) => (items === 1 ? "1 impegno in calendario" : `${items} impegni in calendario`),
  summaryBreakdown: ({ events, weekly, exams, deadlines }: { events: number; weekly: number; exams: number; deadlines: number }) =>
    [
      events ? `${events} ${events === 1 ? "evento" : "eventi"}${weekly ? ` (${weekly} ogni settimana)` : ""}` : "",
      exams ? `${exams} ${exams === 1 ? "esame" : "esami"}` : "",
      deadlines ? `${deadlines} ${deadlines === 1 ? "scadenza" : "scadenze"}` : ""
    ]
      .filter(Boolean)
      .join(" · "),
  summaryShow: (name: string) => `Mostra solo ${name} nel calendario`,
  summaryCompleted: "Superata",
  openSubject: "Apri materia",
  openSubjectAria: (name: string) => `Apri la materia ${name}`,
  summaryEmptyTitle: "Ancora nessuna materia",
  summaryEmptyBody: "Aggiungi le tue materie: qui vedrai quanti impegni hai in calendario per ognuna e potrai mostrarne una sola.",
  goSubjects: "Vai a Materie",
  openExamAria: (name: string) => `Apri l'esame di ${name}`
} as const;

/** Aiuto "?" del Calendario (HelpTip): testi ed esempi. */
export const CALENDAR_HELP = {
  views: {
    title: "Le viste del calendario",
    text: "Giorno, Settimana e Mese mostrano gli impegni sul calendario; Agenda li elenca per le prossime due settimane. Tocca un orario libero per aggiungere un evento.",
    example: "tocca martedì alle 10 per segnare la lezione di Anatomia."
  },
  shared: {
    title: "Calendari condivisi",
    text: "I bordi tratteggiati sono eventi di un'altra persona. Tocca il suo nome per mostrarli o nasconderli.",
    example: "nascondi il calendario di Giulia per vedere solo il tuo."
  }
} as const;

/** Selettore di data e ora (DateField, DateTimeField, DateRangeField): nomi di giorni e mesi, testi. */
export const DATE_PICKER_TEXT = {
  weekdaysShort: ["lun", "mar", "mer", "gio", "ven", "sab", "dom"],
  weekdaysLong: ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"],
  monthsShort: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
  monthsLong: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
  previousMonth: "Mese precedente",
  nextMonth: "Mese successivo",
  previousYear: "Anno precedente",
  nextYear: "Anno successivo",
  previousYears: "Anni precedenti",
  nextYears: "Anni successivi",
  chooseMonthYear: (title: string) => `${title}: scegli mese e anno`,
  chooseYear: (year: number) => `${year}: scegli l'anno`,
  backToDays: "Torna ai giorni",
  today: "Oggi",
  todaySuffix: "oggi",
  done: "Fatto",
  clear: "Togli la data",
  noDate: "Nessuna data",
  chooseDate: "Scegli la data",
  chooseDateTime: "Scegli data e ora",
  chooseRange: "Scegli i giorni",
  time: "Ora",
  timeInput: "Scrivi l'ora",
  timePlaceholder: "hh:mm",
  timeSlots: "Orari",
  timeInvalid: "Scrivi un orario come 9:30",
  timeTooEarly: (min: string) => `Scegli un orario dalle ${min} in poi.`,
  rangeStartHint: "Tocca il primo giorno",
  rangeEndHint: "Ora tocca l'ultimo giorno",
  days: (count: number) => (count === 1 ? "1 giorno" : `${count} giorni`)
} as const;

/** Griglie del calendario: eventi nascosti su schermi stretti ("+N") ed eventi su più giorni. */
export const CALENDAR_LAYOUT_TEXT = {
  more: (count: number) => `+${count}`,
  moreAria: (count: number) => `Altri ${count} ${count === 1 ? "evento" : "eventi"} in questa fascia: apri l'elenco`,
  dayOfSpan: (index: number, total: number) => `giorno ${index} di ${total}`
} as const;

/** Tipologie del calendario oltre alle categorie degli eventi: vacanza, ricorrenze, festività calcolate. */
export const EVENT_TYPE_EXTRA_LABEL = {
  vacation: "Vacanza",
  birthday: "Compleanno",
  anniversary: "Anniversario",
  holiday: "Festività"
} as const;

/** Colore semantico della priorità (token del tema, leggibile in chiaro e scuro). */
export const PRIORITY_TONE: Record<Task["priority"], string> = {
  low: "var(--faint)",
  medium: "var(--accent-2)",
  high: "var(--warning)",
  urgent: "var(--accent-3)"
};

export type AttachmentKind = "pdf" | "image" | "video" | "doc" | "link" | "file";

export const attachmentKind = (attachment: Pick<Attachment, "mimeType" | "name" | "externalUrl">): AttachmentKind => {
  const mime = attachment.mimeType.toLowerCase();
  const name = attachment.name.toLowerCase();
  const url = attachment.externalUrl?.toLowerCase() ?? "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/") || /youtube\.com|youtu\.be|vimeo\.com/.test(url)) return "video";
  if (/word|document|presentation|sheet|excel|powerpoint|text\/plain|markdown/.test(mime)) return "doc";
  if (attachment.externalUrl) return "link";
  return "file";
};

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  pdf: "PDF",
  image: "Immagine",
  video: "Video",
  doc: "Documento",
  link: "Link",
  file: "File"
};

export const ATTACHMENT_KIND_ICON: Record<AttachmentKind, string> = {
  pdf: "FileText",
  image: "Image",
  video: "PlayCircle",
  doc: "FileText",
  link: "Link",
  file: "Paperclip"
};

const decimal = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

/** Ore con la virgola decimale italiana: 0,8 h. */
export const formatHours = (minutes: number) => decimal.format(Math.round((minutes / 60) * 10) / 10);

/** Durata leggibile: 45 min, 2 h, 13 h 55 min. */
export const formatMinutes = (minutes: number) => {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

export const formatNumber = (value: number) => decimal.format(value);

/** Tipo di pagina ufficiale da cui arrivano i dati del corso (sezione Fonti). */
export const UNIVERSITY_SOURCE_KIND_LABEL: Record<string, string> = {
  "calendario-didattico": "Calendario delle lezioni",
  "contatti-ufficiali": "Contatti",
  "elenco-insegnamenti": "Elenco insegnamenti",
  "manifesto-pdf": "Manifesto (PDF)",
  "piano-didattico": "Piano didattico",
  "scheda-corso": "Scheda del corso"
};

// --- File .ics: testi scritti nel file e avvisi dell'importazione (lib/ics.ts) ---

/** Elenco di titoli tra «»: al massimo tre, poi "e altri N". */
const quotedTitles = (titles: readonly string[]) => {
  const shown = titles.slice(0, 3).map((title) => `«${title}»`);
  const rest = titles.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} e ${rest === 1 ? "un altro evento" : `altri ${rest} eventi`}` : shown.length > 1 ? `${shown.slice(0, -1).join(", ")} e ${shown.at(-1)}` : shown[0] ?? "";
};

/** Parti di una regola di ripetizione (RRULE) che StudyOS non sa seguire, dette a parole. */
const RULE_PART_TEXT: Record<string, string> = {
  FREQ: "ripetizioni più fitte di una al giorno",
  INTERVAL: "un intervallo troppo lungo",
  COUNT: "troppe ripetizioni",
  UNTIL: "una data di fine non leggibile",
  BYSECOND: "i secondi",
  BYMINUTE: "più orari nello stesso giorno",
  BYHOUR: "più orari nello stesso giorno",
  BYDAY: "una scelta di giorni della settimana",
  BYMONTHDAY: "una scelta di giorni del mese",
  BYYEARDAY: "una scelta di giorni dell'anno",
  BYWEEKNO: "una scelta di settimane dell'anno",
  BYMONTH: "una scelta di mesi",
  BYSETPOS: "la scelta per posizione (es. «il secondo giorno feriale»)",
  WKST: "il primo giorno della settimana",
  RSCALE: "un calendario diverso da quello solito",
  SKIP: "un calendario diverso da quello solito"
};
const rulePartText = (part: string) => {
  const split = part.indexOf("=");
  const key = (split < 0 ? part : part.slice(0, split)).trim().toUpperCase();
  // INTERVAL=0 o non un numero: non è lungo, è sbagliato.
  if (key === "INTERVAL" && !/^\s*0*[1-9]\d*\s*$/.test(split < 0 ? "" : part.slice(split + 1))) return "un intervallo non valido";
  return RULE_PART_TEXT[key] ?? "una regola scritta in modo particolare";
};
const ruleParts = (parts: readonly string[]) => [...new Set(parts.map(rulePartText))].join(", ");

export const ICS_TEXT = {
  calendarName: "StudyOS",
  untitled: "Evento importato",
  location: (place: string) => `Luogo: ${place}`,
  examTitle: (subject: string) => `Esame: ${subject}`,
  examFallback: "materia",
  examCategory: "Esame",
  taskTitle: (title: string) => `Scadenza: ${title}`,
  taskCategory: "Scadenza",
  notCalendar: "Il file non è un calendario .ics valido.",
  skipped: (count: number) => (count === 1 ? "1 evento senza data valida è stato scartato." : `${count} eventi senza data valida sono stati scartati.`),
  tooMany: (max: number) => `Il file è molto grande: sono stati letti solo i primi ${max} eventi.`,
  unknownZone: (zone: string) =>
    `Il fuso orario «${zone}» non è stato riconosciuto: per i suoi eventi è stata usata l'ora di questo dispositivo. Controlla che gli orari siano giusti.`,
  simplified: (titles: readonly string[], parts: readonly string[]) =>
    `${quotedTitles(titles)} si ${titles.length === 1 ? "ripete" : "ripetono"} con una regola che StudyOS non sa seguire del tutto (${ruleParts(parts)}): è stata semplificata, controlla le date nel calendario.`,
  firstOnly: (titles: readonly string[], parts: readonly string[]) =>
    `${quotedTitles(titles)} si ${titles.length === 1 ? "ripete" : "ripetono"} in un modo che StudyOS non sa seguire (${ruleParts(parts)}): è stata importata solo la prima data.`,
  extraDates: "Alcune date aggiunte a mano a una serie sono state ignorate: se mancano, aggiungile come eventi singoli.",
  thisAndFuture: "Alcune modifiche nel file valgono per «questa e le successive»: sono state applicate solo al giorno indicato.",
  multipleRules: (titles: readonly string[]) => `${quotedTitles(titles)} ha più di una regola di ripetizione: è stata usata solo la prima.`,
  tasksIgnored: (count: number) =>
    count === 1 ? "1 attività con scadenza non è stata importata: StudyOS importa solo gli eventi." : `${count} attività con scadenza non sono state importate: StudyOS importa solo gli eventi.`,
  tooLong: (titles: readonly string[]) =>
    `${quotedTitles(titles)} ${titles.length === 1 ? "durava" : "duravano"} più di un anno: la fine è stata portata a un anno dopo l'inizio. Controlla le date.`,
  /** `read`: quanti giorni della serie sono stati letti davvero (i più vicini a oggi). */
  tooManyRows: (titles: readonly string[], read: number) =>
    read
      ? `${quotedTitles(titles)} ${titles.length === 1 ? "ha" : "hanno"} troppi giorni esclusi o modificati: ${read === 1 ? "è stato letto solo quello più vicino a oggi" : `sono stati letti solo i ${read} più vicini a oggi`}.`
      : `${quotedTitles(titles)}: il file ha troppi giorni esclusi o modificati in tutto, e per ${titles.length === 1 ? "questa serie" : "queste serie"} non ne è stato letto nessuno.`,
  legacyKept: (titles: readonly string[]) =>
    titles.length === 1
      ? `${quotedTitles(titles)} era già stato importato in più parti, con modifiche che non si possono unire senza perderne qualcuna: è rimasto com'era. Se vuoi la versione del file, elimina quelle parti e importa di nuovo.`
      : `${quotedTitles(titles)} erano già stati importati in più parti, con modifiche che non si possono unire senza perderne qualcuna: sono rimasti com'erano. Se vuoi la versione del file, elimina quelle parti e importa di nuovo.`,
  /** Il file divide una serie che c'era già: `date` (YYYY-MM-DD) è il primo giorno della parte nuova. */
  splitsExisting: (title: string, date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return `${quotedTitles([title])}: questo file divide una serie che hai già. Dal ${day} ${MONTH_NAME[month - 1] ?? ""} ${year} i giorni li decide la parte nuova, e importare di nuovo il calendario ufficiale non lo annulla. Per tornare indietro elimina la parte nuova.`;
  },
  /** Il file ha una parte (RELATED-TO) di una serie che c'era già, ma non si collega: resta un evento a sé. */
  partKeptApart: (title: string) =>
    `${quotedTitles([title])}: questo file ha una parte di una serie che hai già, ma non combacia con la tua: è stata aggiunta a parte. Se vedi giorni doppi, elimina quella che non ti serve.`
};

// --- Guida a importazione ed esportazione (components/CalendarTransfer, lib/calendarGuide) ---

export const CALENDAR_GUIDE_TEXT = {
  menuItem: "Importa o esporta",
  eyebrow: "Calendario",
  title: "Importa o esporta",
  honesty:
    "È una copia in un file .ics, non un collegamento: le modifiche fatte dopo non passano da sole da un'app all'altra. Quando cambia qualcosa, ripeti l'esportazione o l'importazione.",
  directionQuestion: "Cosa vuoi fare?",
  direction: {
    export: { title: "Da StudyOS a un'altra app", text: "Porta lezioni, esami e scadenze nel calendario del telefono o del computer." },
    import: { title: "Da un'altra app a StudyOS", text: "Aggiungi qui gli eventi di Google, Apple, Samsung o Outlook." }
  },
  deviceQuestion: "Su quale dispositivo?",
  device: {
    samsung: "Samsung (One UI)",
    android: "Pixel e altri Android",
    ios: "iPhone e iPad",
    windows: "Computer Windows",
    macos: "Mac"
  },
  thisDevice: "Questo dispositivo",
  appQuestion: "Con quale app?",
  app: {
    google: "Google Calendar",
    apple: "Calendario di Apple",
    samsung: "Calendario Samsung",
    outlook: "Outlook"
  },
  otherApp: "La tua app non c'è? Torna indietro e scegli il dispositivo su cui la usi.",
  route: (direction: "export" | "import", app: string, device: string) =>
    direction === "export" ? `Da StudyOS a ${app}, su ${device}` : `Da ${app} a StudyOS, su ${device}`,
  needsComputer: "Serve un computer",
  redirectTitle: "Da qui non si può",
  redirectButton: (app: string, device: string) => `Mostra come fare con ${app} su ${device}`,
  back: "Indietro",
  done: "Fatto",
  download: "Scarica il file",
  share: "Condividi il file",
  downloaded: (fileName: string) => `Scaricato: ${fileName}. Ora segui i passi qui sotto.`,
  loading: "Un momento…",
  chooseFile: "Scegli il file",
  tooBig: "Il file è troppo grande (massimo 5 MB). Esporta un periodo più breve dal tuo calendario e riprova.",
  unreadable: "Non è stato possibile leggere il file. Riprova o scegli un altro file .ics.",
  empty: (warning?: string) =>
    `Nel file non ci sono eventi da importare.${warning ? ` ${warning}` : ""} Scegli il file .ics esportato dal tuo calendario.`,
  previewSummary: (count: number, recurring: number, changed: number) =>
    `Nel file ${count === 1 ? "c'è 1 evento" : `ci sono ${count} eventi`}${recurring ? ` (${recurring} si ${recurring === 1 ? "ripete" : "ripetono"})` : ""}${
      changed ? `, più ${changed === 1 ? "1 giorno modificato" : `${changed} giorni modificati`} di una serie` : ""
    }.`,
  previewRange: (from: string, to?: string) => (to ? `Dal ${from} al ${to}.` : `Il ${from}.`),
  previewNoDuplicates: "Se importi di nuovo lo stesso file, gli eventi già presenti vengono aggiornati, non duplicati.",
  previewMore: (count: number) => `…e altri ${count}`,
  categoryLabel: "Tipo di evento",
  categoryHint: "Usato quando il titolo non fa capire il tipo (es. «Esame», «Laboratorio»).",
  matchSubjects: (count: number) => `Collega alle mie materie in base al titolo (${count} ${count === 1 ? "riconosciuto" : "riconosciuti"})`,
  warningsTitle: "Da controllare",
  /** Pulsante dell'anteprima, con i conti veri dell'unione con il calendario. */
  apply: (added: number, updated: number) => {
    const add = added === 1 ? "Aggiungi 1 evento" : `Aggiungi ${added} eventi`;
    const update = updated === 1 ? "aggiorna 1 evento" : `aggiorna ${updated} eventi`;
    if (added && updated) return `${add}, ${update}`;
    if (added) return add;
    if (updated) return `${update.charAt(0).toUpperCase()}${update.slice(1)}`;
    return "Aggiorna il calendario";
  },
  nothingNew: "Nessuna novità",
  nothingNewHint: "Questo file non cambia niente nel tuo calendario.",
  importFailed: "Non è stato possibile aggiungere gli eventi. Riprova tra poco.",
  resultTitle: "Importazione completata",
  result: (added: number, updated: number) => {
    const parts = [
      added ? `${added} ${added === 1 ? "evento aggiunto" : "eventi aggiunti"}` : "",
      updated ? `${updated} ${updated === 1 ? "evento aggiornato" : "eventi aggiornati"}` : ""
    ].filter(Boolean);
    return parts.length
      ? `Fatto: ${parts.join(", ")} nel calendario. Puoi modificarli o eliminarli come gli altri.`
      : "Nessuna novità: gli eventi di questo file erano già tutti nel calendario.";
  },
  importAnother: "Importa un altro file"
};

/** Passi della guida (lib/calendarGuide). I nomi dei menu sono scritti in modo da restare veri tra una versione e l'altra. */
export const CALENDAR_GUIDE_STEPS = {
  download: "Scarica il file con il pulsante qui sotto: contiene i tuoi eventi, gli esami e le scadenze.",
  downloadPhone: "Scarica il file con il pulsante qui sotto: il telefono lo salva nella cartella Download.",
  downloadIos: "Scarica il file con il pulsante qui sotto: a seconda della versione, il Calendario lo apre subito oppure finisce nell'app File, nella cartella Download.",
  downloadToComputer:
    "Scarica il file con il pulsante qui sotto e mandalo al computer, per esempio per email a te stesso. Se hai fatto l'accesso con il tuo account, i dati si sincronizzano: allora puoi anche aprire StudyOS dal computer, entrare con lo stesso account e scaricarlo da lì.",
  googleOwnCalendar: "Consiglio: su calendar.google.com crea prima un calendario «StudyOS» (accanto ad «Altri calendari», +). Se vuoi ricominciare, lo elimini e reimporti il file.",
  googleSettings: "Apri calendar.google.com nel browser, fai clic sull'ingranaggio in alto e scegli «Impostazioni».",
  googleOnComputer: "Sul computer apri calendar.google.com nel browser (l'app del telefono non ha questa funzione), fai clic sull'ingranaggio in alto e scegli «Impostazioni».",
  googleImport: "Nel menu a sinistra apri «Importa ed esporta», seleziona il file e il calendario in cui aggiungerlo, poi premi «Importa».",
  googleOnPhone: "Dopo qualche minuto gli eventi compaiono anche nell'app Google Calendar del telefono.",
  googleExport:
    "Nel menu a sinistra apri «Importa ed esporta» e premi «Esporta»: scarichi un file .zip con un file .ics per ogni calendario. Per un solo calendario, usa «Esporta calendario» nelle sue impostazioni.",
  unzip: "Apri il file .zip ed estrai il file .ics del calendario che ti serve.",
  samsungOpenFile: "Apri l'app «I miei file», vai in «Download» e tocca il file che finisce con .ics.",
  samsungSave: "Se ti chiede con cosa aprirlo, scegli «Calendario»: controlla gli eventi, scegli in quale calendario metterli e salva.",
  samsungMenu: "Se il file non si apre, nell'app Calendario apri il menu (☰ oppure ⋮), poi le impostazioni, e cerca «Importa».",
  samsungExport: "Nell'app Calendario apri il menu (☰ oppure ⋮), poi le impostazioni, e cerca «Esporta»: salva il file .ics nel telefono. Il nome cambia un po' con la versione.",
  samsungGoogle: "Se non trovi «Esporta» e il calendario è collegato a un account Google, esportalo dal computer su calendar.google.com.",
  iosOpenFile: "Se il Calendario non si è aperto, apri l'app «File», vai in «Download» e tocca il file che finisce con .ics.",
  iosAddAll: "Nell'anteprima del Calendario tocca «Aggiungi tutti» e scegli il calendario. Consiglio: creane prima uno «StudyOS» (Calendario, «Calendari», «Aggiungi»).",
  macOpen: "Fai doppio clic sul file scaricato, oppure nell'app Calendario usa «File», poi «Importa…».",
  macPick: "Scegli il calendario in cui aggiungere gli eventi: meglio uno nuovo, «StudyOS» («File», poi «Nuovo calendario»), così puoi eliminarlo e reimportare.",
  macSelect: "Nell'app Calendario seleziona, nella colonna a sinistra, il calendario da portare in StudyOS.",
  macExport: "Usa «File», poi «Esporta», poi «Esporta…» e salva il file .ics. Non scegliere «Archivio Calendario»: è un altro formato.",
  outlookClassicImport: "Outlook classico: «File», poi «Apri ed esporta», poi «Importa/Esporta», e scegli di importare un file iCalendar (.ics).",
  outlookWebImport: "Nuovo Outlook o outlook.com: nel Calendario premi «Aggiungi calendario», poi «Carica da file», e scegli il file e il calendario.",
  outlookOnComputer: "Sul computer apri outlook.com nel browser: nel Calendario premi «Aggiungi calendario», poi «Carica da file», e scegli il file e il calendario.",
  outlookOnPhone: "Gli eventi compaiono anche nell'app Outlook, sul computer e sul telefono, con lo stesso account.",
  outlookSave: "Outlook classico: seleziona il calendario, poi «File» e «Salva calendario». In «Altre opzioni» scegli le date e «Dettagli completi».",
  outlookNoFile: "Il nuovo Outlook e outlook.com non salvano il calendario in un file: se lo stesso calendario è anche su Google, esportalo da calendar.google.com.",
  chooseFile: "Torna qui e premi «Scegli il file»: prima di aggiungere qualcosa vedrai un'anteprima.",
  chooseFilePhone: "Torna qui, tocca «Scegli il file» e cercalo nei file del telefono (di solito in Download): prima di aggiungere vedrai un'anteprima.",
  chooseFileFromComputer:
    "Porta il file .ics su questo dispositivo (per esempio per email a te stesso) e tocca «Scegli il file», oppure apri StudyOS dal computer. Prima di aggiungere vedrai un'anteprima."
};

/** Perché una combinazione non si fa da quel dispositivo, e dove si fa. */
export const CALENDAR_GUIDE_REDIRECT = {
  appleOnlyApple: "Il Calendario di Apple c'è solo su iPhone, iPad e Mac: segui i passi da uno di questi.",
  appleIosNoFile:
    "Il Calendario di iPhone e iPad non salva i calendari in un file. Serve un Mac con lo stesso account iCloud: da lì esporti il calendario e poi lo scegli in StudyOS.",
  appleOnlyMac: "Solo il Calendario del Mac salva i calendari in un file .ics: segui i passi dal Mac.",
  samsungOnlySamsung: "Il Calendario Samsung c'è solo sui telefoni e tablet Samsung: segui i passi da lì.",
  outlookOnlyWindows: "Solo Outlook classico per Windows salva il calendario in un file .ics: le app per telefono, per Mac e outlook.com non lo fanno."
};

/** Etichetta degli eventi senza orario, che occupano l'intera giornata. */
export const ALL_DAY_LABEL = "Tutto il giorno";

// --- Ripetizioni, ricorrenze, promemoria e festività (frasi composte in lib/repeat.ts) ---

type WeekdayCode = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export const WEEKDAY_NAME: Record<WeekdayCode, string> = {
  MO: "lunedì",
  TU: "martedì",
  WE: "mercoledì",
  TH: "giovedì",
  FR: "venerdì",
  SA: "sabato",
  SU: "domenica"
};

export const WEEKDAY_SHORT: Record<WeekdayCode, string> = { MO: "lun", TU: "mar", WE: "mer", TH: "gio", FR: "ven", SA: "sab", SU: "dom" };

export const MONTH_NAME = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"] as const;

export const REPEAT_TEXT = {
  none: "Non si ripete",
  daily: "Ogni giorno",
  everyDays: (count: number) => `Ogni ${count} giorni`,
  weekly: "Ogni settimana",
  everyWeeks: (count: number) => `Ogni ${count} settimane`,
  monthly: "Ogni mese",
  everyMonths: (count: number) => `Ogni ${count} mesi`,
  yearly: "Ogni anno",
  everyYears: (count: number) => `Ogni ${count} anni`,
  workdays: "Ogni giorno feriale (lun–ven)",
  lastDay: "l'ultimo giorno",
  orLastDay: "(o l'ultimo giorno del mese)",
  /** Ordinali del "primo lunedì" / "prima domenica" del mese. */
  ordinalMasculine: { 1: "primo", 2: "secondo", 3: "terzo", 4: "quarto", [-1]: "ultimo" } as Record<number, string>,
  ordinalFeminine: { 1: "prima", 2: "seconda", 3: "terza", 4: "quarta", [-1]: "ultima" } as Record<number, string>,
  leapFeb28: "il 28 febbraio negli anni non bisestili",
  leapMar1: "il 1° marzo negli anni non bisestili",
  leapSkip: "solo negli anni bisestili",
  until: "fino",
  times: (count: number) => (count === 1 ? "per 1 volta" : `per ${count} volte`)
};

export const OCCASION_KIND_LABEL: Record<"birthday" | "anniversary" | "holiday" | "recurring-day", string> = {
  birthday: "Compleanno",
  anniversary: "Anniversario",
  holiday: "Festa o ricorrenza personale",
  "recurring-day": "Altro ogni anno"
};

/** "compie 25 anni" per un compleanno, "25 anni" per un anniversario o una ricorrenza. */
export const occasionAgeText = (kind: string, years: number) => {
  const span = `${years} ${years === 1 ? "anno" : "anni"}`;
  return kind === "birthday" ? `compie ${span}` : span;
};

export const REMINDER_TEXT = {
  atStart: "All'ora dell'evento",
  minutesBefore: (count: number) => `${count} ${count === 1 ? "minuto" : "minuti"} prima`,
  hoursBefore: (count: number) => `${count} ${count === 1 ? "ora" : "ore"} prima`,
  daysBefore: (count: number) => `${count} ${count === 1 ? "giorno" : "giorni"} prima`,
  sameDay: "Il giorno stesso",
  at: (time: string) => `alle ${time}`,
  /** Onestà sui limiti: finché non ci sono le notifiche push, avvisano solo ad app aperta. */
  appOpenOnly: "I promemoria avvisano quando StudyOS è aperta."
};

export const HOLIDAY_NAME = {
  newYear: "Capodanno",
  epiphany: "Epifania",
  valentine: "San Valentino",
  fatThursday: "Giovedì grasso",
  fatTuesday: "Martedì grasso",
  ashWednesday: "Mercoledì delle Ceneri",
  womensDay: "Festa della donna",
  fathersDay: "Festa del papà",
  palmSunday: "Domenica delle Palme",
  easter: "Pasqua",
  easterMonday: "Lunedì dell'Angelo (Pasquetta)",
  liberation: "Festa della Liberazione",
  labour: "Festa dei lavoratori",
  mothersDay: "Festa della mamma",
  republic: "Festa della Repubblica",
  assumption: "Ferragosto",
  grandparents: "Festa dei nonni",
  saintFrancis: "San Francesco d'Assisi",
  halloween: "Halloween",
  allSaints: "Ognissanti",
  allSouls: "Commemorazione dei defunti",
  immaculate: "Immacolata Concezione",
  christmasEve: "Vigilia di Natale",
  christmas: "Natale",
  saintStephen: "Santo Stefano",
  newYearsEve: "San Silvestro",
  summerTime: "Inizia l'ora legale (lancette avanti di un'ora)",
  winterTime: "Torna l'ora solare (lancette indietro di un'ora)"
} as const;

export const HOLIDAY_KIND_LABEL: Record<"national" | "celebration" | "clock", string> = {
  national: "Festa nazionale",
  celebration: "Ricorrenza",
  clock: "Cambio dell'ora"
};

export const HOLIDAYS_TOGGLE_LABEL = "Festività";

/** Evento senza materia, o con una materia che non si conosce (es. di un'altra persona, non condivisa). */
export const NO_SUBJECT_LABEL = "Senza materia";

/**
 * Prima lettera maiuscola: nomi di giorni/mesi da date-fns a inizio frase, etichette
 * dinamiche in Tag/Pill. Non tocca il resto della stringa (acronimi e nomi propri salvi).
 */
export const capitalizeFirst = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

export const hostOf = (url: string | undefined) => {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

/**
 * Testo di un link di un appello: «ufficiale UniMi» solo se porta davvero a unimi.it (o a un suo
 * sottodominio); gli altri mostrano dove portano, così un link cambiato non si spaccia per l'ateneo.
 */
export const eventLinkLabel = (href: string | undefined) => {
  let url: URL;
  try {
    url = new URL(href ?? "");
  } catch {
    return "Apri il link";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Apri il link";
  const host = url.hostname.toLowerCase();
  if (host === "unimi.it" || host.endsWith(".unimi.it")) return "Apri la pagina ufficiale UniMi";
  return `Apri la pagina · ${hostOf(href)}`;
};

// ——— Condivisione ———

export const SHARE_SCOPE_LABEL: Record<ShareScope, string> = {
  calendar: "Calendario",
  barb_exams: "Appelli ufficiali",
  tasks: "Attività",
  study: "Studio",
  progress: "Progressi",
  materials: "Materiali",
  goals: "Obiettivi"
};

export const SHARE_SCOPE_HINT: Record<ShareScope, string> = {
  calendar: "Eventi e lezioni, compresi gli appelli che hai aggiunto",
  barb_exams: "Solo gli appelli ufficiali che hai scelto (in sola lettura)",
  tasks: "Le cose da fare, con scadenza",
  study: "Sessioni di studio e argomenti da ripassare",
  progress: "Esami ancora da sostenere e preparazione, mai i voti",
  materials: "File, link e note",
  goals: "I tuoi traguardi"
};

export const SHARE_PERMISSION_LABEL: Record<SharePermission, string> = {
  view: "Può vedere",
  edit: "Può modificare"
};

export const SHARE_INVITE_STATUS_LABEL: Record<ShareInviteStatus, string> = {
  pending: "In attesa",
  accepted: "Accettato",
  declined: "Rifiutato",
  expired: "Scaduto"
};

/** Cosa non è andato a buon fine quando fallisce un'azione appena fatta (pannello Condividi, sezione Condivisione). */
export const SHARE_ACTION_FAILED: Record<ShareAction, string> = {
  invite: "Invito non creato.",
  share: "Condivisione non salvata.",
  accept: "Invito non accettato.",
  decline: "Invito non rifiutato.",
  cancel: "Invito non annullato.",
  update: "Permessi non aggiornati.",
  revoke: "Condivisione non tolta.",
  leave: "Non sei uscito dalla condivisione.",
  open: "Invito non aperto.",
  history: "Cronologia non caricata.",
  restore: "Ripristino non riuscito.",
  revertCheck: "Controllo non riuscito.",
  revert: "Modifiche non annullate.",
  save: "Modifiche non salvate.",
  delete: "Elemento non eliminato."
};

/**
 * Testi del dettaglio di un elemento di un'altra persona. `who` è il nome di chi condivide già adatto
 * a una frase ("Giulia Rossi", "un'altra persona"; vedi actorInSentence): i testi aggiungono "Di", "a", "dai dati di".
 */
export const SHARED_ITEM_TEXT = {
  gone: "Questo elemento non è più condiviso con te.",
  invalidField: (label: string) => `Controlla «${label}»: serve un valore valido.`,
  readOnlyIntro: (who: string) => `Di ${who}: puoi solo vedere.`,
  editIntro: (who: string) => `Di ${who}: le modifiche arrivano subito anche a ${who}, che può ripristinarle dalla cronologia.`,
  deleteConfirm: (title: string, who: string) => `Eliminare «${title}» dai dati di ${who}? Resta nella sua cronologia e può ripristinarlo.`
} as const;

/** Perché un invito aperto da link non si può accettare (il link salvato su questo dispositivo si toglie). */
export const SHARE_INVITE_BLOCKED: Record<InviteBlock, string> = {
  invalid: "Link non valido, oppure l'invito è stato annullato.",
  own: "È un tuo invito: mandalo a un'altra persona.",
  otherAccount: "Questo invito è per un altro indirizzo email: accedi con quell'account e riapri il link.",
  accepted: "Invito già usato.",
  declined: "Invito rifiutato.",
  expired: "Invito scaduto: chiedine uno nuovo."
};

/** Schede della sezione Condivisione. */
export const SHARING_TAB_LABEL = {
  mine: "Condivisi da me",
  received: "Condivisi con me",
  invites: "Inviti",
  history: "Modifiche di altri"
} as const;

/** Testi del pulsante e del pannello Condividi che non dipendono da un valore enum. */
export const SHARE_TEXT = {
  opening: "Apro…",
  loadFailed: "Non riesco ad aprire Condividi: controlla la connessione e riprova. Se succede ancora, ricarica la pagina.",
  done: "Fatto",
  linkOnce: "Il link non si può rivedere dopo aver chiuso questa finestra: se lo perdi, crea un nuovo invito.",
  /** Dopo il nome di un gruppo tra i destinatari: il codice del gruppo non scade, chi entra dopo vede anche lui. */
  groupTarget: "tutto il gruppo, anche chi entrerà dopo"
} as const;

/** Una condivisione da cambiare o togliere che sul server non c'è più (tolta altrove, o non più tua). */
export const SHARE_GONE_TEXT = "Questa condivisione non c'è più.";

/** Avviso della condivisione mostrato in ogni sezione (AppShell), lì dove si è fatta la modifica. */
export const SHARE_NOTICE_TEXT = {
  denied: (owner: string) => `Non hai più il permesso di modificare i dati di ${owner || "questa persona"}: la modifica non è stata salvata.`,
  dismiss: "Ok",
  dismissTitle: "Chiudi l'avviso sulla condivisione"
} as const;

export const REVISION_CHANGE_LABEL: Record<ItemRevision["change"], string> = {
  create: "ha aggiunto",
  update: "ha modificato",
  delete: "ha eliminato"
};

/** "Calendario (Può modificare), Attività (Può vedere)". */
export const scopesSummary = (offers: ReadonlyArray<{ scope: ShareScope; permission: SharePermission }>) =>
  offers.map((offer) => `${SHARE_SCOPE_LABEL[offer.scope]} (${SHARE_PERMISSION_LABEL[offer.permission]})`).join(", ");

/** Tipo di elemento condivisibile, per la cronologia ("ha modificato l'evento …"). */
export const SHARED_ENTITY_LABEL: Record<string, string> = {
  calendarEvent: "evento",
  task: "attività",
  studySession: "sessione di studio",
  studyTopic: "argomento",
  exam: "esame",
  attachment: "materiale",
  note: "nota",
  goal: "obiettivo"
};

/** Etichetta di un tipo che arriva dal server: i nomi di Object.prototype ("constructor"…) non sono tipi. */
export const sharedEntityLabel = (type: string) =>
  Object.hasOwn(SHARED_ENTITY_LABEL, type) ? SHARED_ENTITY_LABEL[type] : "elemento";

/** Chi ha fatto una modifica quando non si sa il nome: in testa a una frase, e in mezzo ("prima che un'altra persona…"). */
export const UNKNOWN_PERSON = "Un'altra persona";
export const UNKNOWN_PERSON_IN_SENTENCE = "un'altra persona";

/**
 * Intestazione della cronologia. La lista ha un tetto (`limit`): se è piena le modifiche più vecchie
 * possono mancare e lo dice, invece di promettere "gli ultimi 90 giorni".
 */
export const revisionListIntro = (shown: number, limit: number) =>
  `${shown >= limit ? `Ultime ${limit} modifiche degli ultimi 90 giorni (le più vecchie non compaiono).` : "Ultimi 90 giorni."} «Ripristina» riporta l'elemento alla versione prima della modifica.`;

/** "1 elemento" / "3 elementi" con la frase accordata al numero. */
const several = (count: number, one: string, many: (count: number) => string) => (count === 1 ? one : many(count));

/**
 * "Modifiche di altri" → annullare tutte le modifiche di una persona da un giorno. `who` è il nome già
 * adatto a una frase (actorInSentence), `day` il giorno scelto ("3 nov").
 */
/** "dal 3 nov", ma "dall'8 nov" e "dall'11 nov" (`Dal`/`Dall'` a inizio frase). */
const fromDay = (day: string, start = false) => `${start ? "D" : "d"}${/^(?:8|11)\b/.test(day) ? "all'" : "al "}${day}`;

export const REVERT_TEXT = {
  open: "Annulla le modifiche di una persona",
  intro:
    "Ogni elemento che ha modificato o eliminato torna com'era prima della sua prima modifica da quel giorno. Gli elementi che ha aggiunto restano.",
  person: "Persona",
  since: "Dal giorno",
  noPeople: "Nessuno può modificare i tuoi dati: qui compaiono le persone con «Può modificare».",
  check: "Controlla",
  checking: "Controllo…",
  close: "Chiudi",
  /** Accanto ad "Annulla" (che chiude la conferma): non deve iniziare con la stessa parola. */
  confirm: "Ripristina tutto",
  tooMany: "Troppe modifiche da quel giorno: scegli un giorno più vicino.",
  /** Tra il controllo e la conferma qualcosa è cambiato: si conferma solo ciò che si è letto. */
  changed: "Nel frattempo è cambiato qualcosa: rileggi il riepilogo e conferma di nuovo.",
  skipChanged: (count: number) =>
    several(count, "Lascia com'è l'elemento cambiato dopo da te o da altri", (n) => `Lascia come sono i ${n} elementi cambiati dopo da te o da altri`),
  skipChangedHint: "Così torna solo ciò che, dopo questa persona, nessun altro ha toccato.",
  nothing: (who: string, day: string) => `${fromDay(day, true)} ${who} non ha cambiato nulla dei tuoi dati.`,
  /** Cosa succede confermando: prima ciò che torna (e cosa si perde), poi ciò che resta com'è. */
  plan: (who: string, day: string, summary: RevertSummary) =>
    [
      summary.toRestore
        ? several(summary.toRestore, "1 elemento torna com'era", (n) => `${n} elementi tornano com'erano`) + ` prima delle modifiche di ${who} ${fromDay(day)}.`
        : "Nessun elemento da riportare indietro.",
      summary.ownerDeleted
        ? several(summary.ownerDeleted, "1 di questi l'avevi eliminato tu: torna tra i tuoi dati.", (n) => `${n} di questi li avevi eliminati tu: tornano tra i tuoi dati.`)
        : "",
      summary.ownerAfter
        ? several(summary.ownerAfter, "Su 1 di questi hai fatto modifiche anche tu, dopo: vengono sostituite.", (n) => `Su ${n} di questi hai fatto modifiche anche tu, dopo: vengono sostituite.`)
        : "",
      summary.othersAfter
        ? several(
            summary.othersAfter,
            "Su 1 di questi elementi ha fatto modifiche anche un'altra persona, dopo: si perdono anche quelle.",
            (n) => `Su ${n} di questi elementi hanno fatto modifiche anche altre persone, dopo: si perdono anche quelle.`
          )
        : "",
      summary.skipped
        ? several(summary.skipped, "1 elemento cambiato dopo da te o da altri resta com'è ora.", (n) => `${n} elementi cambiati dopo da te o da altri restano come sono ora.`)
        : "",
      summary.added
        ? several(summary.added, `1 elemento aggiunto da ${who} resta: eliminalo tu, se non ti serve.`, (n) => `${n} elementi aggiunti da ${who} restano: eliminali tu, se non ti servono.`)
        : "",
      summary.gone
        ? several(summary.gone, "1 elemento che hai eliminato tu resta eliminato.", (n) => `${n} elementi che hai eliminato tu restano eliminati.`)
        : "",
      summary.notHere
        ? several(
            summary.notHere,
            "1 elemento non è ancora arrivato su questo dispositivo e resta com'è: controlla di nuovo dopo la sincronizzazione.",
            (n) => `${n} elementi non sono ancora arrivati su questo dispositivo e restano come sono: controlla di nuovo dopo la sincronizzazione.`
          )
        : ""
    ]
      .filter(Boolean)
      .join(" "),
  done: (who: string, restored: number, notRestored: number) =>
    [
      restored
        ? several(restored, `Fatto: 1 elemento è tornato com'era prima delle modifiche di ${who}.`, (n) => `Fatto: ${n} elementi sono tornati com'erano prima delle modifiche di ${who}.`)
        : notRestored
          ? "Nessun elemento è cambiato."
          : `Nessun elemento è cambiato: le modifiche di ${who} non c'erano più da annullare.`,
      notRestored
        ? several(
            notRestored,
            "1 elemento non si è potuto ripristinare: non era più tra i tuoi dati o nella cronologia.",
            (n) => `${n} elementi non si sono potuti ripristinare: non erano più tra i tuoi dati o nella cronologia.`
          )
        : ""
    ]
      .filter(Boolean)
      .join(" ")
} as const;

/** Ripristino di una versione dalla cronologia "Modifiche di altri". */
export const RESTORE_TEXT = {
  notRestorable: "Questo elemento non si può ripristinare.",
  missing: "Questa versione non c'è più nella cronologia: aggiorna l'elenco.",
  /** Il controllo al momento di scrivere (l'elemento è sparito nel frattempo, e la versione non ha i suoi file). */
  notHere: "Questo elemento non è più tra i tuoi dati: aggiorna l'elenco e riprova.",
  /** Versione di una modifica, senza file: l'elemento non è qui e nessuna eliminazione salvata li conserva. */
  gone: (title: string) =>
    `«${title}» non è tra i tuoi dati su questo dispositivo (l'hai eliminato, o non è ancora arrivato) e questa versione non ha i suoi file: non si può ripristinare.`,
  /** Al posto di «Ripristina» quando il ripristino non riuscirebbe (gone). */
  blocked: "Non ripristinabile",
  blockedHint: "Non è tra i tuoi dati su questo dispositivo e questa versione non ha i suoi file."
} as const;
