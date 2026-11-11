// Esami e appelli ufficiali (anche nel calendario, nelle materie e nel corso di laurea).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

/** Un solo nome, ovunque, per aggiungere le date d'esame ufficiali dell'università. */
export const OFFICIAL_EXAMS_ADD_LABEL = "Aggiungi appelli ufficiali";

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
