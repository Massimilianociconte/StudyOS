// Statistiche.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

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
  /** Senza studio oggi la serie conta fino a ieri (resta viva fino a stasera). */
  streakHint: (streak: number, studiedToday: boolean) => (!streak ? "Studia oggi per iniziare" : studiedToday ? "fino a oggi" : "fino a ieri · studia oggi per continuare"),
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
