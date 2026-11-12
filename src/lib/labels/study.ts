// Studio: impostazioni del timer, colonna laterale, argomenti, statistiche di una materia.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

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

/** Elenco degli argomenti: argomenti in pausa, eliminazione, modifica. */
export const TOPIC_TEXT = {
  /** Materia superata o archiviata: l'argomento resta nell'elenco ma non torna nei ripassi. */
  paused: { completed: "In pausa: materia superata", archived: "In pausa: materia archiviata" },
  removeAria: (title: string) => `Elimina l'argomento «${title}»`,
  removeConfirm: (title: string) => `Eliminare l'argomento «${title}»? Perderai anche i ripassi fatti e le domande guida. Non si può annullare.`,
  remove: "Elimina argomento",
  cancel: "Annulla",
  save: "Salva modifiche",
  // «Annulla» o chiusura del riquadro con un argomento cambiato e non salvato.
  unsavedTitle: "Scartare le modifiche?",
  unsavedText: "Hai cambiato l'argomento senza salvarlo.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche"
} as const;

/** Riquadro «Ripasso» di Studio. */
export const REVIEW_TEXT = {
  showQuestions: (count: number) => `Mostra le ${count} domande guida`,
  showNotes: "Mostra le note",
  notes: "Note",
  /** «Annulla» dopo la valutazione: torna com'era prima del ripasso. */
  rated: (title: string, next: string) => `Ripasso di «${title}» salvato · prossimo tra ${next}`
} as const;

/** «Sessioni recenti» e «In programma» di Studio. */
export const SESSION_LIST_TEXT = {
  showAll: (count: number) => `Mostra tutte (${count})`,
  showLess: "Mostra meno",
  planned: "In programma",
  plannedHint: "Pianificate, anche da un assistente: tocca «Fatta» quando hai studiato.",
  done: "Fatta",
  doneAria: (title: string) => `Segna come fatta «${title}»`,
  remove: "Elimina",
  removeAria: (title: string) => `Elimina la sessione in programma «${title}»`,
  markedDone: (title: string, minutes: string) => `«${title}» segnata come fatta: ${minutes}.`
} as const;

/** Colonna laterale di Studio: i numeri portano dove servono. */
export const STUDY_SIDE_TEXT = {
  week: "Questa settimana",
  weekHint: (target: string | undefined, streak: number) =>
    `${target ? `su ${target} h di obiettivo` : "Nessun obiettivo settimanale"}${streak ? ` · ${streak} ${streak === 1 ? "giorno" : "giorni"} di fila` : ""}`,
  weekProgress: "Ore di studio della settimana rispetto all'obiettivo",
  changeTarget: "Cambia obiettivo",
  upcoming: "Prossimi ripassi",
  seeAll: "Vedi tutti",
  noUpcoming: "Nessun altro ripasso in programma.",
  upcomingEmpty: "Qui vedrai quando ripassare ogni argomento."
} as const;
