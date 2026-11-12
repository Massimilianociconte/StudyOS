// Impostazioni → Agenti → «Modifiche del connettore»: registro del connettore remoto e ripristino.
// Testi di questa sola schermata (vedi src/lib/agentChanges.ts); non si riesportano da ../labels.

/** Nome dell'elemento con l'articolo, per le frasi «Ha modificato l'attività «…»». */
export const CHANGE_ENTITY_LABEL: Record<string, string> = {
  task: "l'attività",
  calendarEvent: "l'evento",
  exam: "l'esame",
  subject: "la materia",
  studySession: "la sessione di studio",
  studyTopic: "l'argomento",
  attachment: "il materiale",
  goal: "l'obiettivo",
  note: "la nota",
  preferences: "le preferenze",
  notification: "la notifica",
  tag: "l'etichetta",
  reminder: "il promemoria",
  widget: "il widget",
  studyGroup: "il gruppo",
  groupInvite: "l'invito",
  groupResource: "la risorsa del gruppo",
  groupActivity: "l'attività del gruppo"
};

/** Campi cambiati, in parole semplici. Quelli non elencati diventano «altri dettagli». */
export const CHANGE_FIELD_LABEL: Record<string, string> = {
  title: "titolo",
  name: "nome",
  description: "descrizione",
  notes: "note",
  body: "testo",
  status: "stato",
  priority: "priorità",
  dueDate: "scadenza",
  start: "inizio",
  end: "fine",
  allDay: "tutto il giorno",
  date: "data",
  subjectId: "materia",
  category: "tipologia",
  location: "luogo",
  color: "colore",
  colorCustom: "colore",
  reminders: "promemoria",
  recurrence: "ripetizione",
  recurrenceUntil: "ripetizione",
  repeat: "ripetizione",
  occasion: "ricorrenza",
  subtasks: "sottotask",
  estimatedMinutes: "durata prevista",
  energy: "energia",
  difficulty: "difficoltà",
  importance: "importanza",
  teacher: "docente",
  cfu: "CFU",
  semester: "semestre",
  targetGrade: "voto obiettivo",
  grade: "voto",
  archived: "archiviazione",
  program: "programma",
  preparation: "preparazione",
  honors: "lode",
  plannedMinutes: "durata prevista",
  actualMinutes: "durata",
  topics: "argomenti",
  comprehension: "comprensione",
  memorization: "memorizzazione",
  nextReviewDate: "prossimo ripasso",
  completedReviews: "ripassi",
  lastReviewedAt: "ultimo ripasso",
  questions: "domande",
  externalUrl: "link",
  startDate: "inizio",
  deadline: "scadenza",
  progress: "avanzamento",
  metric: "misura",
  readAt: "lettura",
  displayName: "nome del profilo",
  weeklyTargetMinutes: "obiettivo settimanale",
  tags: "etichette",
  // Collegamenti (es. eliminare una sessione la toglie da obiettivi, note e materiali).
  linkedSessionIds: "sessioni collegate",
  linkedTaskIds: "attività collegate",
  linkedEntityId: "collegamento",
  linkedEntityType: "collegamento"
};

export const AGENT_CHANGES_TEXT = {
  open: "Modifiche del connettore",
  opening: "Apertura…",
  loadFailedChunk: "Non riesco ad aprire l'elenco. Controlla la connessione e riprova.",
  title: "Modifiche del connettore",
  eyebrow: "Connettore remoto",
  intro:
    "Qui trovi ogni modifica che ChatGPT o Claude hanno fatto ai tuoi dati con il connettore remoto, la più recente in alto. Le modifiche nate da una sola richiesta stanno insieme. Restano 90 giorni (circa le ultime 2000). «Ripristina» annulla tutta la richiesta, se nessuno di quegli elementi è cambiato dopo.",
  loading: "Caricamento…",
  empty: "Nessuna modifica del connettore remoto finora.",
  signIn: "Fai l'accesso al tuo account (Impostazioni → Account e sincronizzazione) per vedere le modifiche del connettore.",
  missingSql: "Il registro non è ancora attivo: chi gestisce StudyOS deve eseguire di nuovo supabase/agent.sql.",
  loadFailed: "Non riesco a leggere le modifiche. Controlla la connessione e riprova.",
  retry: "Riprova",
  more: "Mostra altre",
  restore: "Ripristina",
  /** Chi ha fatto la modifica. */
  byApp: "Tu, dall'app",
  byConnector: (label: string) => label || "Connettore remoto",
  unnamed: "senza titolo",
  otherFields: "altri dettagli",
  /** Frasi delle modifiche del connettore. */
  byAgent: {
    created: (what: string, title: string) => `Ha creato ${what} «${title}».`,
    updated: (what: string, title: string, fields: string) => (fields ? `Ha modificato ${what} «${title}»: ${fields}.` : `Ha modificato ${what} «${title}».`),
    deleted: (what: string, title: string) => `Ha eliminato ${what} «${title}».`
  },
  /** Frasi dei ripristini fatti dalla persona nell'app (accanto a «Tu, dall'app»). */
  byYou: {
    created: (what: string, title: string) => `Hai rimesso ${what} «${title}».`,
    updated: (what: string, title: string, fields: string) => (fields ? `Hai riportato ${what} «${title}» com'era: ${fields}.` : `Hai riportato ${what} «${title}» com'era.`),
    deleted: (what: string, title: string) => `Hai eliminato ${what} «${title}».`
  },
  /** Più modifiche nate dalla stessa richiesta. */
  together: (count: number) => `Una sola richiesta, ${count} modifiche: «Ripristina» le annulla tutte insieme.`,
  moreChanges: (count: number) => (count === 1 ? "…e un'altra modifica." : `…e altre ${count} modifiche.`),
  /** Ripristino: la voce che annulla un'altra modifica. */
  undo: "Annulla una modifica precedente.",
  restoredAt: (when: string) => `Annullata il ${when}.`,
  changedLater: "Un elemento è cambiato dopo: questa modifica non si può più annullare.",
  confirm: {
    create: (title: string) => `Annullare questa modifica? «${title}» sparisce dai tuoi dati.`,
    update: (title: string) => `Annullare questa modifica? «${title}» torna com'era prima.`,
    delete: (title: string) => `Annullare questa modifica? «${title}» torna tra i tuoi dati.`,
    many: (count: number) => `Annullare tutta la richiesta? Le ${count} modifiche tornano indietro insieme. Se uno di questi elementi è cambiato dopo, non si tocca niente.`
  },
  outcome: {
    restored: "Fatto: modifica annullata. I tuoi dispositivi la ricevono alla sincronizzazione.",
    restoredMany: (count: number) => `Fatto: ${count} elementi sono tornati com'erano. I tuoi dispositivi li ricevono alla sincronizzazione.`,
    conflict: "Non annullata: l'elemento è cambiato dopo questa modifica. Non è stato toccato niente.",
    conflictMany: (title?: string) =>
      `Non annullata: ${title ? `«${title}»` : "uno degli elementi"} è cambiato dopo. Si annulla tutto o niente, quindi non è stato toccato niente.`,
    already: "Questa modifica era già stata annullata.",
    notFound: "Questa modifica non c'è più nel registro.",
    failed: "Ripristino non riuscito. Controlla la connessione e riprova."
  }
} as const;
