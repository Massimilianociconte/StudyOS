// Esami e appelli ufficiali (anche nel calendario, nelle materie e nel corso di laurea).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

/** Un solo nome, ovunque, per aggiungere le date d'esame ufficiali dell'università. */
export const OFFICIAL_EXAMS_ADD_LABEL = "Aggiungi appelli ufficiali";

/** Esami: intestazione, schede, collegamenti della scheda d'esame, stati vuoti, date ufficiali. */
export const EXAMS_TEXT = {
  title: "Esami",
  subtitle: "Le date dei tuoi esami, quanto sei pronto e le date ufficiali degli appelli. Voti e medie sono in Libretto e laurea.",
  /** Senza «Corso di laurea» (Impostazioni): niente date ufficiali. */
  subtitlePersonal: "Le date dei tuoi esami e quanto sei pronto. Voti e medie sono in Libretto e laurea.",
  tabsLabel: "Quali esami vedere",
  tabPersonal: "I miei esami",
  tabOfficial: "Date ufficiali",
  addExam: "Aggiungi esame",
  /** Modulo aperto da Home o Statistiche con un esame del calendario (chiave `exams.new`). */
  fromCalendar: (title: string) => `Dal calendario: «${title}». Controlla materia e ora, poi salva.`,
  /** Casella (spuntata) del modulo: salvando, l'esame prende il posto di quell'occorrenza. */
  replaceEvent: (title: string) => `Togli «${title}» dal calendario: lo sostituisce l'esame`,
  /** Dopo il salvataggio, con Annulla che rimette l'evento. */
  eventReplaced: (title: string) => `Esame aggiunto: «${title}» tolto dal calendario.`,
  /** Dopo «Annulla»: torna l'evento, l'esame appena salvato no (si toglie a parte, se serve). */
  eventRestored: "Evento rimesso nel calendario; l'esame resta.",
  /** «Annulla» quando l'evento era già cambiato altrove (sync, un'altra scheda): non si sovrascrive. */
  eventNotRestored: "Evento non rimesso: nel frattempo è cambiato. L'esame resta.",
  recordGrade: "Registra un voto",
  /** Esame con la data passata: apre il modulo breve dell'esito (voto, idoneità, non superato). */
  recordOutcome: "Registra l'esito",
  librettoHint: "Medie e voto di laurea sono in Libretto e laurea.",
  /** Esame non superato senza la nuova data. */
  dateToDecide: "Non superato · nuova data da decidere",
  dateToDecideShort: "Data",
  dateToDecideBox: "da decidere",
  /**
   * Riquadro dei giorni all'esame (Esami e Home): il giorno stesso «Oggi», mai «0 giorni»; una data
   * già passata «Data / passata» (come «Data / da decidere»), mai un numero negativo.
   */
  countdown: (days: number) =>
    days < 0 ? { value: "Data", unit: "passata" } : days === 0 ? { value: "Oggi", unit: "" } : { value: String(days), unit: days === 1 ? "giorno" : "giorni" },
  /** Giorni all'esame in riga, dopo la data: «oggi», «domani», «12 giorni» (come in Statistiche); mai negativi. */
  countdownInline: (days: number) => (days < 0 ? "data passata" : days === 0 ? "oggi" : days === 1 ? "domani" : `${days} giorni`),
  // Chiudere «Aggiungi esame» o «Modifica esame» (✕, Esc, tocco fuori) con dati cambiati.
  unsavedTitle: "Scartare le modifiche?",
  unsavedText: "Hai cambiato l'esame (data, preparazione, programma…) senza salvarlo.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche",
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
  /** Cella del mese in «Date ufficiali» (nome accessibile). */
  dayCellLabel: (date: string, count: number) => `Apri ${date}, ${count} ${count === 1 ? "appello" : "appelli"}`,
  // Un appello con più iscrizioni (commissioni, aule o chiusure diverse): si sceglie la propria.
  slotChooserIntro: (count: number) => `Negli elenchi ufficiali questo appello ha ${count} iscrizioni. Apri la tua: commissione, aula e chiusura delle iscrizioni possono essere diverse.`,
  registrationLabel: (index: number, commission?: string | null) => `Iscrizione ${index}${commission ? ` · ${commission}` : ""}`,
  /** Cosa distingue un'iscrizione o una prova dalle altre (data di chiusura già scritta). */
  registrationHint: ({ component, location, closes, list }: { component?: string | null; location?: string | null; closes?: string | null; list?: string | null }) =>
    [component, location, closes ? `chiusura iscrizioni ${closes}` : null, list ? `elenco ${list}` : null].filter(Boolean).join(" · "),
  seeDetails: "Vedi dettagli",
  shownDetails: "Dettagli qui sotto",
  timeNotPublished: "Orario non pubblicato",
  officialEyebrow: "Appello ufficiale",
  /** Appello già passato nella scelta degli appelli da aggiungere: si vede, non si sceglie. */
  pastSuffix: " · Passato",
  noFutureSessions: "Nessun appello futuro da aggiungere",
  // Dettaglio di un appello ufficiale: lo si aggiunge al calendario da qui.
  addSessionToCalendar: "Aggiungi al calendario",
  addingSession: "Aggiunta in corso…",
  sessionAdded: "Fatto: l'appello è nel calendario, come promemoria di tutta la giornata.",
  sessionInCalendar: "Già nel calendario.",
  sessionPast: "Appello passato: non si aggiunge al calendario.",
  sessionNotYours: "Per aggiungerlo al calendario, l'insegnamento deve essere tra le tue materie attive.",
  sessionNotAdded: "Non è stato aggiunto: è già nel calendario o non è più valido.",
  sessionAddFailed: "Non è stato possibile aggiungerlo. Riprova tra qualche secondo.",
  // Fonti: la pagina degli appelli si legge; il feed JSON è il dato tecnico da cui vengono le date.
  openBarbExamsPage: "Apri la pagina degli appelli BARB",
  openOfficialSource: "Apri la fonte ufficiale UNIMI",
  officialSource: "Fonte ufficiale UNIMI",
  technicalData: "Dati ufficiali UNIMI (formato tecnico)",
  referenceSource: (code: string | number, technical: boolean) => (technical ? `Dati ${code} (formato tecnico)` : `Fonte ${code}`),
  verifiedOn: (day: string, page?: string | number | null) => `Verificata il ${day}${page ? ` · pagina ${page}` : ""}. Date e iscrizioni possono cambiare: controlla la fonte prima di iscriverti.`
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
