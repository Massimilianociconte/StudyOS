// Attività (anche il modulo attività aperto dal calendario).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.
import { formatMinutes } from "../labels";

/** Pillola di un filtro attivo, uguale in ogni sezione: "In ritardo ✕", "Solo: Analisi ✕". */
export const FILTER_CHIP_TEXT = {
  only: (name: string) => `Solo: ${name}`,
  clear: (name: string) => `Togli il filtro «${name}»`
} as const;

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
  /** Dopo l'aggiunta rapida: sempre, perché la nuova attività può finire fuori dalla parte visibile. */
  added: (title: string) => `Aggiunta «${title}».`,
  /** Dopo l'aggiunta rapida con un filtro attivo: l'attività può non comparire nell'elenco filtrato. */
  addedFiltered: (title: string) => `Aggiunta «${title}». Se non la vedi, togli i filtri.`,
  /** Stato cambiato in «In corso» dal menu di una riga o di una scheda (o trascinando): parte il timer. */
  timerStarted: (title: string) => `Timer avviato per «${title}».`,
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

/** Editor di un'attività (anche quello aperto dal calendario). */
export const TASK_EDITOR_TEXT = {
  eyebrow: "Attività",
  title: "Modifica attività",
  added: (date: string) => `Aggiunta il ${date}`,
  completed: (date: string) => `Completata il ${date}`,
  late: "in ritardo",
  save: "Salva modifiche",
  saving: "Salvataggio…",
  cancel: "Annulla",
  remove: "Elimina attività",
  discardTitle: "Scartare le modifiche?",
  discardText: "Quello che hai cambiato non è ancora salvato.",
  /** «Nuova attività» chiusa con qualcosa di scritto. */
  discardNewText: "Quello che hai scritto non è ancora salvato.",
  keepEditing: "Continua a modificare",
  // Stesse parole di Materie, Obiettivi, Note, Studio ed Eventi.
  discard: "Scarta le modifiche",
  minutesHint: "Se usi il timer si aggiorna da solo.",
  minutesRunning: "Il timer è in corso: se cambi i minuti, riparte da lì.",
  archivedHint: "Le archiviate spariscono dall'elenco: le ritrovi in fondo, con «Mostra le archiviate».",
  steps: "Passaggi",
  stepsCount: (done: number, total: number) => `${done} di ${total} fatti`,
  stepsHint: "Dividi l'attività in piccoli passi da spuntare.",
  stepText: (index: number) => `Passaggio ${index}`,
  stepDone: (text: string) => `Fatto: ${text}`,
  removeStep: (text: string) => `Togli il passaggio «${text}»`,
  newStep: "Nuovo passaggio",
  newStepPlaceholder: "Es. Esercizi da 1 a 5",
  addStep: "Aggiungi"
} as const;

/** Pillole dell'aggiunta rapida: le scelte di «Dettagli» che valgono per le prossime attività. */
export const QUICK_TASK_TEXT = {
  applied: "Scelte per le prossime attività",
  deletedSubject: "Materia eliminata",
  due: (date: string) => `Scade il ${date}`,
  clear: (label: string) => `Togli «${label}» dalle prossime attività`
} as const;

/** Elenco: nomi brevi delle viste sul telefono (a 375 px stanno tutti in una riga), archiviate. */
export const TASKS_LIST_TEXT = {
  viewsShort: { list: "Lista", focus: "Oggi", subject: "Materie", kanban: "Stato", matrix: "Urgenza" },
  showArchived: "Mostra le archiviate",
  hideArchived: "Nascondi le archiviate",
  restore: "Ripristina",
  restored: "Attività ripristinata",
  restoreAria: (title: string) => `Ripristina «${title}» tra le attività da fare`
} as const;

export const TASKS_HELP = {
  views: {
    title: "Come vedere le attività",
    text: "Lista: tutte, divise per scadenza. Piano di oggi: le 6 più urgenti. Per materia: divise per materia. Per stato: colonne Da fare, In corso, Completata… tra cui spostarle; «In corso» fa partire un timer. Urgenza e importanza: quattro riquadri per decidere cosa fare prima."
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
