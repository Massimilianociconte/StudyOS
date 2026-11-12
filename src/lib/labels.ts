// Etichette italiane per i valori enum salvati nei dati (la UI non mostra mai i codici interni) e testi
// condivisi dalla struttura dell'app o da più schermate. I testi di una sola schermata sono in
// labels/<schermata>.ts e si caricano con lei.
import type { Attachment, CalendarEvent, Exam, Goal, StudySession, Subject, Task } from "../types";
import type { ShareAction, SharePermission, ShareScope } from "./sharing";

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

/** Pezzi comuni dell'interfaccia: menu "Altre azioni", aiuto "?" (HelpTip), aggiunta rapida. */
export const UI_TEXT = {
  moreActions: "Altre azioni",
  help: "Aiuto",
  helpAria: (title: string) => `Aiuto: ${title}`,
  example: "Per esempio:",
  close: "Chiudi",
  showPassword: "Mostra la password",
  hidePassword: "Nascondi la password",
  /** Scadenza dell'attività nell'aggiunta rapida: parte vuota, si può scegliere. */
  dueOptional: "Entro quando? (facoltativa)"
} as const;

/** Tipo di elemento creato con l'aggiunta rapida (il «+»), per la conferma dopo il salvataggio. */
export type QuickAddSaved = "task" | "taskTimer" | "taskDone" | "event" | "session" | "subject" | "link" | "file";

/** Aggiunta rapida (il «+»): domanda prima di perdere quello che si è scritto e conferma di cosa si è creato e dove. */
export const QUICK_ADD_TEXT = {
  unsavedTitle: "Scartare le modifiche?",
  unsavedText: "Hai scritto qualcosa che non è ancora salvato.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche",
  /** Dopo «Salva»: cosa si è creato e in quale sezione si trova. `title` vuoto = senza nome. */
  saved: (kind: QuickAddSaved, title: string) => {
    const what: Record<QuickAddSaved, string> = {
      task: "Attività creata: la trovi in Attività",
      taskTimer: "Attività creata e cronometro avviato: la trovi in Attività",
      taskDone: "Attività salvata come fatta: la trovi in Attività",
      event: "Evento aggiunto al Calendario",
      session: "Studio pianificato aggiunto al Calendario",
      subject: "Materia creata: la trovi in Materie",
      link: "Link salvato: lo trovi in Materiali",
      file: "File salvato: lo trovi in Materiali"
    };
    const name = title.trim();
    return name ? `${what[kind]} («${name}»).` : `${what[kind]}.`;
  }
} as const;

/** Struttura dell'app: blocco con la password dell'app (barra laterale e foglio «Altro» sui telefoni). */
export const SHELL_TEXT = {
  lock: "Blocca StudyOS",
  lockAria: "Blocca StudyOS (servirà la password per riaprirlo)",
  lockTitle: "Chiude StudyOS: per riaprirlo servirà la password"
} as const;

/** Riquadro mostrato quando una sezione non si carica (ViewErrorBoundary, nel bundle iniziale). */
export const VIEW_ERROR_TEXT = {
  title: "Questa sezione non si è caricata",
  body: "I tuoi dati sono al sicuro. Ricarica la pagina; se succede ancora, scarica una copia di sicurezza da Impostazioni → Copia di sicurezza.",
  reload: "Ricarica la pagina"
} as const;

/** Ricerca globale nella barra in alto. Sui telefoni il segnaposto è corto: il testo intero è nel nome accessibile. */
export const SEARCH_TEXT = {
  placeholder: "Cerca…",
  placeholderWide: "Cerca in StudyOS: attività, eventi, materie, file…",
  aria: "Cerca in StudyOS: attività, eventi, materie, file",
  clear: "Cancella la ricerca",
  results: "Risultati della ricerca",
  count: (count: number) => `${count} ${count === 1 ? "risultato" : "risultati"}`,
  keys: "↑ ↓ per scegliere · Invio per aprire",
  empty: (query: string) => `Nessun risultato per "${query}"`,
  emptyHint: "Prova con una parola più corta o controlla come è scritta.",
  /** Esame non superato senza nuova data: al posto della data passata e dello stato. */
  examDateToDecide: "Non superato · nuova data da decidere"
} as const;

/** Home e Statistiche: esami segnati solo nel calendario (eventi di tipo «Esame») quando l'elenco degli esami è vuoto. */
export const CALENDAR_EXAMS_TEXT = {
  line: (count: number) =>
    count === 1
      ? "Hai 1 esame in calendario: aggiungilo agli esami per seguire voti e preparazione."
      : `Hai ${count} esami in calendario: aggiungili agli esami per seguire voti e preparazione.`,
  tile: (count: number) => (count === 1 ? "1 esame in calendario" : `${count} esami in calendario`),
  add: (title: string, day: string) => `Aggiungi «${title}» del ${day}`,
  addAria: (title: string, day: string) => `Aggiungi agli esami «${title}» del ${day}: si apre il modulo già compilato`
} as const;

export const EXAM_STATUS_LABEL: Record<Exam["status"], string> = {
  planning: "Da pianificare",
  studying: "In preparazione",
  reviewing: "In ripasso",
  ready: "Pronto per l'esame",
  done: "Sostenuto"
};

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

// ——— Studio: sessioni e timer (anche il timer sempre attivo dell'app) ———

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
  /** Durante la pausa del Pomodoro «Pausa» sembrerebbe la pausa stessa: il pulsante ferma il conto. */
  stopBreak: "Ferma",
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
  /** Stesso nome del campo del timer («Cosa studi?»): è lo stesso dato, il titolo della sessione. */
  title: "Cosa studi? (facoltativo)",
  titlePlaceholder: "Es. Capitolo 4, esercizi 3–5",
  notes: "Note (facoltative)",
  notesPlaceholder: "Cosa rivedere, dubbi da chiedere…",
  minutes: "Minuti di studio",
  minutesPlaceholder: "Es. 60",
  date: "Giorno e ora di inizio",
  time: "Ora di inizio",
  template: "Tipo di sessione",
  savedWith: (source: string) => `Salvata con: ${source}`,
  endsAt: (time: string, day?: string) => (day ? `Fine ${day} alle ${time}` : `Fine alle ${time}`),
  save: "Salva",
  saveAdd: "Salva sessione",
  cancel: "Annulla",
  discard: "Scarta",
  discardConfirm: (studied: string) => `Scartare ${studied} di studio? Non verranno salvati.`,
  discardYes: "Sì, scarta",
  discardNo: "No",
  discarded: (studied: string) => `Sessione scartata (${studied}).`,
  // Chiudere «Modifica sessione» o «Aggiungi studio fatto» (✕, Esc, tocco fuori, Indietro) con dati cambiati.
  unsavedTitle: "Scartare le modifiche?",
  unsavedEditText: "Hai cambiato la sessione senza salvarla.",
  unsavedAddText: "Hai scritto una sessione senza salvarla.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche",
  delete: "Elimina",
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
    future: "L'ora di inizio è nel futuro: scegli un momento già passato.",
    endsFuture: "La sessione finirebbe nel futuro: riduci la durata o sposta l'inizio prima.",
    reviewFuture: "Con questi minuti la sessione finirebbe nel futuro: riduci i minuti. L'inizio è quello del timer: per cambiarlo salva e poi tocca «Modifica»."
  }
} as const;

/** Sessioni senza argomento (tempo per argomento). */
export const NO_TOPIC_LABEL = "Senza argomento";

// ——— Calendario: tipi e stati degli eventi, scelta di date e ore ———

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
  other: "Altro",
  vacation: "Vacanza"
};

export const EVENT_STATUS_LABEL: Record<CalendarEvent["status"], string> = {
  planned: "Pianificato",
  "in-progress": "In corso",
  done: "Fatto",
  skipped: "Saltato"
};

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

/** Tipologie del calendario oltre alle categorie degli eventi: vacanza, ricorrenze, festività calcolate. */
export const EVENT_TYPE_EXTRA_LABEL = {
  vacation: "Vacanza",
  birthday: "Compleanno",
  anniversary: "Anniversario",
  holiday: "Festività"
} as const;

// --- Ripetizioni: riga "Non si ripete ▾" e "Personalizza" (anche nell'aggiunta rapida) ---

/** Riga "Non si ripete ▾" e sezione "Personalizza". Le frasi delle regole sono in REPEAT_TEXT (lib/repeat.ts). */
export const REPEAT_PICKER_TEXT = {
  label: "Ripetizione",
  workdays: "Giorni feriali (lun–ven)",
  custom: "Personalizza…",
  customTitle: "Ripetizione personalizzata",
  every: "Ogni",
  interval: "Ogni quanto",
  unit: "Unità",
  units: { day: "giorni", week: "settimane", month: "mesi", year: "anni" },
  unitsOne: { day: "giorno", week: "settimana", month: "mese", year: "anno" },
  quarterly: "Ogni 3 mesi",
  halfYearly: "Ogni 6 mesi",
  weekdays: "Nei giorni",
  monthlyMode: "Quale giorno del mese",
  monthlyDay: (day: number) => `Il giorno ${day}`,
  monthlyLastDay: "L'ultimo giorno del mese",
  monthlyWeekday: "Un giorno della settimana",
  clamp: "Nei mesi senza questo giorno, l'ultimo del mese",
  nth: "Quale",
  nthOptions: { 1: "primo", 2: "secondo", 3: "terzo", 4: "quarto", [-1]: "ultimo" } as Record<number, string>,
  weekdayField: "Giorno della settimana",
  end: "Fine della ripetizione",
  endNever: "Mai",
  endUntil: "Il giorno",
  endCount: "Dopo un numero di volte",
  untilField: "Ultimo giorno (compreso)",
  countField: "Quante volte",
  countSuffix: (count: number) => (count === 1 ? "volta" : "volte"),
  summary: "Si ripete così",
  intervalInvalid: "Scrivi un numero tra 1 e 99.",
  weekdaysMissing: "Scegli almeno un giorno della settimana.",
  untilInvalid: "La ripetizione deve finire dopo l'inizio: scegli un giorno successivo.",
  countInvalid: "Scrivi un numero di volte tra 1 e 999.",
  onlyForSeries: "Per cambiare la ripetizione scegli poi «Questo e i successivi» o «Tutti».",
  /** Aggiunta veloce: solo le scelte pronte; il resto dal modulo completo. */
  quickMore: "Per cambiare la durata, scegliere altri giorni o la fine della ripetizione, apri poi l'evento dal Calendario."
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

export const SHARE_PERMISSION_LABEL: Record<SharePermission, string> = {
  view: "Può vedere",
  edit: "Può modificare"
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

/** Una condivisione da cambiare o togliere che sul server non c'è più (tolta altrove, o non più tua). */
export const SHARE_GONE_TEXT = "Questa condivisione non c'è più.";

/** Avviso della condivisione mostrato in ogni sezione (AppShell), lì dove si è fatta la modifica. */
export const SHARE_NOTICE_TEXT = {
  denied: (owner: string) => `Non hai più il permesso di modificare i dati di ${owner || "questa persona"}: la modifica non è stata salvata.`,
  gone: (owner: string) => `${owner || "Il proprietario"} ha eliminato ciò che stavi modificando: la modifica non è stata salvata.`,
  dismiss: "Ok",
  dismissTitle: "Chiudi l'avviso sulla condivisione"
} as const;

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

/** Impostazioni → Agenti: più persone sullo stesso connettore, ognuna scelta per nome in chat. */
export const agentAccountLabels = {
  title: "Più persone sullo stesso connettore",
  named: (name: string) => `Gli assistenti trovano questo StudyOS con il nome «${name}», quello del tuo profilo.`,
  /** Profilo senza nome: una riga sola sotto «Collega ChatGPT o Claude». */
  unnamed: "Scrivi il tuo nome nel profilo: serve per sceglierti in chat se più persone usano lo stesso connettore.",
  toProfile: "Vai al profilo",
  /** `local` = pagina di sviluppo con npm run agent: lì ogni browser usa un codice nuovo, non la chiave. */
  help: (local: boolean) =>
    `Più persone possono usare lo stesso connettore in ChatGPT o Claude. Ognuna apre StudyOS nel suo browser, scrive il proprio nome nel profilo e collega il browser qui ${local ? "con un codice nuovo del terminale" : "con la stessa chiave"}. In chat basta dire di chi è l'account, per esempio «nell'account di Camilla Rossi»: la modifica va in quello StudyOS, e la richiesta di conferma compare lì.`,
  /** Sotto «Revoca gli accessi di questo browser»: toglie solo ciò che questo browser ha approvato. */
  revokeHint:
    "Toglie gli assistenti che hai approvato con «Consenti» in questo browser, anche il connettore remoto approvato qui. Quelli approvati su un altro dispositivo revocali da lì, oppure usa «Scollega gli assistenti di tutti» in Avanzate. Per ridare l'accesso a un assistente, togli il connettore StudyOS nelle sue impostazioni e aggiungilo di nuovo."
} as const;

/** Connettore remoto di un account (`/u/<nome>/mcp`): ChatGPT lavora sui dati cloud con l'app chiusa. */
export const agentCloudLabels = {
  consentKicker: "Connettore remoto",
  consentBody: (account: string) =>
    `Vuole usare lo StudyOS${account ? ` di ${account}` : ""} anche quando l'app è chiusa: legge e modifica i dati salvati nel cloud del tuo account. Le modifiche non chiederanno conferma qui.`,
  signInHint: "Serve l'accesso al tuo account StudyOS: lo trovi in Impostazioni → Account e sincronizzazione.",
  approved: (client: string) =>
    `${client} può usare il tuo StudyOS anche con l'app chiusa. Le modifiche arrivano qui alla sincronizzazione successiva.`,
  signIn: "Per il connettore remoto fai prima l'accesso al tuo account StudyOS (Impostazioni → Account e sincronizzazione), poi ricollega il connettore in ChatGPT.",
  noCloud: "Questa copia di StudyOS non ha il cloud attivo: il connettore remoto non può funzionare.",
  missingSql: "Il cloud non è ancora pronto per il connettore remoto: va eseguito supabase/agent.sql nel progetto Supabase.",
  failed: "Non sono riuscito a creare il permesso per il connettore remoto. Riprova.",
  revoked: (count: number) =>
    count === 1 ? "Anche il connettore remoto di questo account è scollegato." : count > 1 ? `Anche i ${count} connettori remoti di questo account sono scollegati.` : ""
} as const;

// ——— Persone: ricerca, profilo online, inviti all'account (supabase/people.sql) ———

/**
 * Testi di "Trova una persona", del profilo online e degli inviti all'account. Le voci di `errors`
 * da `rateLimited` a `emailInvitesGone` sono identiche ai messaggi di supabase/people.sql:
 * peopleErrorText (lib/people.ts) le riconosce nel testo del server.
 */
export const peopleLabels = {
  findTitle: "Trova una persona",
  findHint: "Scrivi la sua email esatta o il suo @nome. L'email delle altre persone non compare mai.",
  findFieldLabel: "Email o @nome della persona",
  findPlaceholder: "nome@esempio.it oppure @nome",
  search: "Cerca",
  searching: "Cerco…",
  invite: "Invita",
  inviting: "Invito…",
  wait: "Un attimo…",
  noName: "Nome non impostato",
  noHandle: "Senza @nome",
  somebody: "una persona",
  notFound: "Nessuna persona trovata",
  notFoundHint: "Controlla l'email o il @nome. Se non ha ancora un account, mandale il link di invito.",
  checkHint: "Prima di invitare, controlla con la persona che nome e @nome siano proprio i suoi.",
  needsLogin: "Accedi al tuo account per cercare le persone.",
  needsScopes: "Scegli almeno una cosa da condividere.",
  groupSectionTitle: "Invita una persona con il suo account",
  groupSectionHint: "Per chi ha già un account StudyOS: l'invito compare nella sua app (notifiche e Gruppi) e può accettarlo con un tocco.",
  groupNotAllowed:
    "Solo il proprietario e gli amministratori possono invitare una persona con il suo account. Tu puoi mandare il link, il QR o il codice.",
  groupNotOnline: "Il gruppo non è ancora online: riapri questa finestra tra poco.",
  groupInvited: (name: string) => `Invito mandato a ${name}: lo vede nelle notifiche e in Gruppi.`,
  groupActivity: (name: string) => `ha invitato ${name}`,
  adminRoleHint: "come un membro, ma può anche invitare una persona trovata con la ricerca (email o @nome).",
  shareTarget: "Una persona (cerca per email o @nome)",
  shareInvited: (name: string, scopes: string) =>
    `Invito mandato a ${name}: lo vede nelle notifiche e in Condivisione → Inviti. Quando accetta, vede ${scopes}.`,
  withLink: "Con link",
  sentToPerson: "A una persona, nella sua app",
  invitedPerson: "Persona invitata",
  codeInvite: (code: string) => `Codice ${code}`,
  sentInvitesTitle: (count: number) => `Inviti mandati · ${count}`,
  waiting: "in attesa",
  expired: "scaduto",
  expiredEmailInvite: "Scaduto: cerca la persona per invitarla di nuovo",
  profileTitle: "Profilo online",
  profileIntro: "Come ti vedono gli altri quando ti cercano per invitarti.",
  profileNoCloud: "Gli account non sono attivi in questa versione dell'app.",
  profileSignedOut: "Con l'account puoi scegliere un @nome e farti trovare da chi vuole invitarti.",
  profileLoading: "Carico il profilo online…",
  profileVisibleName: (name: string) => `Nome visibile: ${name}`,
  profileNameHint: "È il nome scritto in «Il tuo nome», qui sopra: il profilo online si aggiorna da solo.",
  handleLabel: "Il tuo @nome (facoltativo)",
  handlePlaceholder: "es. giulia.rossi",
  handleRule: "Da 3 a 24 caratteri: lettere minuscole, numeri, _ e punto.",
  handleChecking: "Controllo se è libero…",
  handleAvailable: "Libero: puoi usarlo.",
  handleTaken: "Già preso: scegline un altro.",
  handleCurrent: "È il tuo @nome.",
  handleSave: "Salva @nome",
  handleRemove: "Togli @nome",
  handleSaved: (handle: string) => `Fatto: ora ti trovano anche come @${handle}.`,
  handleRemoved: "@nome tolto: ti trovano solo con l'email esatta.",
  discoverableLabel: "Gli altri possono trovarmi",
  discoverableOn: "Chi conosce la tua email o il tuo @nome può trovarti per invitarti. Non vede mai la tua email.",
  discoverableOff: "Nessuno ti trova con la ricerca. Gli inviti già ricevuti restano e puoi sempre entrare con link, QR o codice.",
  saving: "Salvo…",
  retry: "Riprova",
  notice: "Ora chi conosce la tua email o il tuo @nome può trovarti per invitarti. Puoi spegnerlo in Impostazioni → Profilo.",
  noticeOk: "Ok",
  noticeOpenProfile: "Apri il profilo",
  errors: {
    rateLimited: "Troppe ricerche, riprova tra un minuto",
    notFound: "Nessuna persona trovata",
    alreadyMember: "È già nel gruppo",
    alreadyInvited: "Ha già un invito",
    notAllowed: "Solo proprietario e amministratori possono invitare",
    self: "Non puoi invitare te stesso",
    tooManyInvites: "Troppi inviti in attesa: annullane qualcuno",
    emailInvitesGone: "Gli inviti per email non ci sono più: cerca la persona",
    badQuery: "Scrivi un'email completa (nome@esempio.it) o un @nome.",
    badHandle: "Il @nome va da 3 a 24 caratteri: lettere minuscole, numeri, _ e punto.",
    handleTaken: "Questo @nome è già preso: scegline un altro.",
    unavailable:
      "La ricerca delle persone non è ancora attiva sul server: esegui supabase/people.sql nel SQL Editor di Supabase (vedi supabase/README.md).",
    offline: "Server cloud non raggiungibile: controlla la connessione e riprova.",
    noPermission: "Non hai il permesso per questa operazione.",
    signedOut: "Accedi al tuo account per cercare le persone.",
    noCloud: "Gli account non sono attivi in questa versione dell'app.",
    generic: "Il server ha risposto con un errore. Riprova tra poco."
  }
} as const;

/** Notifiche push del dispositivo: interruttore in Impostazioni → Profilo e proposta dopo il primo invito. */
export const pushLabels = {
  toggle: "Notifiche su questo dispositivo",
  hint: "Ricevi un avviso anche con l'app chiusa: inviti, inviti accettati e permessi cambiati.",
  checking: "Controllo…",
  on: "Attive su questo dispositivo. Puoi spegnerle quando vuoi.",
  off: "Spente su questo dispositivo.",
  needAccount: "Accedi con il tuo account per ricevere le notifiche.",
  unsupported: "Questo browser non supporta le notifiche. Gli avvisi restano nella campanella dell'app.",
  iosInstall: "Aggiungi StudyOS alla schermata Home per ricevere le notifiche",
  denied: "Hai bloccato le notifiche per StudyOS. Riattivale dalle impostazioni del browser o del telefono, poi torna qui.",
  failed: "Non sono riuscito ad attivare le notifiche. Riprova tra poco.",
  promptTitle: "Vuoi un avviso quando ricevi un invito?",
  promptBody:
    "Ti mandiamo una notifica anche quando StudyOS è chiuso: inviti, inviti accettati e permessi cambiati. Puoi spegnerla in Impostazioni → Profilo.",
  promptAccept: "Attiva le notifiche",
  promptLater: "Non ora",
  promptFailed: "Non è stato possibile attivarle. Puoi riprovare da Impostazioni → Profilo.",
  promptClose: "Chiudi"
} as const;
