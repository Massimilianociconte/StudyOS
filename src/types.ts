export type ID = string;

export type ThemeMode = "light" | "dark" | "focus";
export type PaletteName =
  | "aurora"
  | "milk"
  | "space"
  | "university"
  | "forest"
  | "sunset"
  | "graphite";
export type EntityType =
  | "subject"
  | "exam"
  | "calendarEvent"
  | "task"
  | "studySession"
  | "studyTopic"
  | "attachment"
  | "goal"
  | "note"
  | "notification"
  | "studyGroup"
  | "groupInvite"
  | "groupResource"
  | "groupActivity"
  | "studyDeck"
  | "flashcard"
  | "quiz"
  | "quizQuestion";

export interface BaseEntity {
  id: ID;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  tags: string[];
}

export interface UserSettings {
  id: "settings";
  themeMode: ThemeMode;
  palette: PaletteName;
  density: "comfortable" | "compact";
  cardShape: "soft" | "super";
  /** "last" = riapre l'ultima sezione usata su questo dispositivo. */
  initialView: AppView | "last";
  /** Versione delle impostazioni locali (migrazioni una tantum). */
  schemaVersion?: number;
  dateFormat: "dd/MM/yyyy" | "yyyy-MM-dd";
  dashboardLayout: string[];
  profile?: {
    displayName?: string;
    avatarDataUrl?: string;
  };
  /**
   * Con la password dell'app (security.mode "vault") le notifiche dei promemoria su questo dispositivo
   * dicono solo «Promemoria StudyOS» e l'ora; true = anche il titolo. Senza password il titolo c'è sempre.
   */
  pushShowTitles?: boolean;
  security: {
    mode: "standard" | "vault";
    backupEncryptionDefault: boolean;
    passphraseHint?: string;
    verifierSalt?: string;
    verifierHash?: string;
  };
  updatedAt: string;
}

export type AppView =
  | "career"
  | "dashboard"
  | "calendar"
  | "tasks"
  | "study"
  | "subjects"
  | "exams"
  | "materials"
  | "goals"
  | "stats"
  | "barb"
  | "groups"
  | "sharing"
  | "learn"
  | "settings";

export interface Subject extends BaseEntity {
  /** Collegamento stabile al catalogo universitario, preservato anche rinominando la materia. */
  universityCourseId?: string;
  /** Semestre personale esplicitamente scelto; assente = semestre ufficiale del corso. */
  semesterOverride?: "primo" | "secondo" | "annuale" | "non-definito";
  name: string;
  teacher: string;
  color: string;
  icon: string;
  cover?: string;
  cfu: number;
  semester: string;
  status: "not-started" | "active" | "review" | "exam-ready" | "completed" | "archived";
  targetGrade?: number;
  examDate?: string;
  notes: string;
  /** Durate del timer ricordate per questa materia (vince sulle preferenze). */
  timer?: TimerSettings;
}

export interface Exam extends BaseEntity {
  subjectId: ID;
  date: string;
  program: string[];
  preparation: number;
  targetGrade: number;
  status: "planning" | "studying" | "reviewing" | "ready" | "done";
  simulations: number;
  frequentQuestions: string[];
  cover?: string;
  /** Voto registrato (18–30) per un esame superato: alimenta il libretto e la media. */
  grade?: number;
  /** Lode: nella media vale 30. */
  honors?: boolean;
  /** Esame superato senza voto numerico (idoneità, tirocinio): conta solo nei CFU. */
  passFail?: boolean;
}

export type EventCategory =
  | "study"
  | "lesson"
  | "lab"
  | "exam"
  | "review"
  | "deadline"
  | "project"
  | "gym"
  | "personal"
  | "work"
  | "relax"
  | "other"
  /** Vacanza (più giorni, tutto il giorno): le versioni vecchie mostrano solo un'etichetta vuota. */
  | "vacation";

export interface CalendarEvent extends BaseEntity {
  title: string;
  description: string;
  category: EventCategory;
  subjectId?: ID;
  color: string;
  priority: "low" | "medium" | "high" | "urgent";
  start: string;
  end: string;
  /**
   * Evento "Tutto il giorno": occupa l'intera giornata (start = mezzanotte locale del giorno,
   * end = mezzanotte successiva). Opzionale: gli eventi salvati prima dell'introduzione
   * (valore assente) restano eventi con orario.
   * Gli appelli BARB importati usano ISO locale senza offset: una data ufficiale
   * conserva lo stesso giorno anche su dispositivi con fusi orari diversi.
   */
  allDay?: boolean;
  recurrence?: "none" | "daily" | "weekly" | "monthly";
  /** Ultimo giorno (YYYY-MM-DD) in cui la serie si ripete; assente = senza fine. */
  recurrenceUntil?: string;
  status: "planned" | "in-progress" | "done" | "skipped";
  checklist: { id: ID; text: string; done: boolean }[];
  attachmentIds: ID[];
  cover?: string;
  notes: string;
  links: string[];
  goalId?: ID;
  /** UID dell'evento nel calendario .ics di origine: un nuovo import aggiorna invece di duplicare. */
  sourceUid?: string;
  /**
   * Impronta (sempre testo) dell'evento com'era nel file all'ultimo import e di come l'import l'ha scritto
   * (lib/ics.ts): un file non cambiato da allora non annulla le modifiche fatte qui.
   */
  sourceStamp?: string;
  /**
   * Regola di ripetizione completa (sottoinsieme di RRULE). Vale solo se `repeatLegacy` coincide
   * ancora con `recurrence|recurrenceUntil`: se una versione vecchia dell'app cambia la ripetizione,
   * vince quella vecchia. `recurrence`/`recurrenceUntil` restano sempre scritti come proiezione.
   */
  repeat?: RepeatRule;
  /** `${recurrence}|${recurrenceUntil ?? ""}` al momento del salvataggio di `repeat`. */
  repeatLegacy?: string;
  /** Fuso IANA dell'evento, preso alla creazione; assente = fuso del dispositivo (come prima). */
  timeZone?: string;
  /** Riga di un'occorrenza modificata o cancellata: id della serie (id della riga `${seriesId}@${originalDate}`). */
  seriesId?: ID;
  /**
   * Giorno (YYYY-MM-DD, nel fuso della serie) dell'occorrenza sostituita. In una serie figlia
   * (`splitFrom`) è il giorno da cui la madre si ferma.
   */
  originalDate?: string;
  /** Occorrenza eliminata (come EXDATE): la riga ha anche `archived: true`, così le app vecchie la saltano. */
  cancelled?: true;
  /** Serie figlia di "questa e le successive": chi espande chiude la madre prima della figlia. */
  splitFrom?: ID;
  /** Compleanno, anniversario o ricorrenza: tutto il giorno, ogni anno, `category: "personal"`. */
  occasion?: EventOccasion;
  /** Promemoria dell'evento (VALARM nell'esportazione). */
  reminders?: EventReminder[];
  /** RECURRENCE-ID importato (chiave di deduplica insieme a `sourceUid`). */
  sourceRecurrenceId?: string;
  /**
   * Riga importata (con `sourceRecurrenceId`) che nel file era un giorno cambiato a mano in StudyOS
   * (X-STUDYOS-EDITED), ricevuta quando l'import ha creato la serie (una copia). La cambia solo un file
   * segnato con lo stesso `sourceUid`; gli altri file non la toccano. Assente per tutte le altre righe.
   */
  sourceEdited?: true;
  /**
   * true = colore scelto a mano (resta anche cambiando tipologia); false = colore della tipologia.
   * Assente (eventi salvati prima): vedi `resolveEventColor`.
   */
  colorCustom?: boolean;
  /** Luogo o destinazione (facoltativo). */
  location?: string;
}

export type Weekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

/** Come si ripete una regola mensile: "day" salta i mesi senza quel giorno, "clampDay" usa l'ultimo (regola vecchia). */
export type RepeatMonthly =
  | { by: "day" }
  | { by: "lastDay" }
  | { by: "clampDay" }
  | { by: "weekday"; nth: 1 | 2 | 3 | 4 | -1; weekday: Weekday };

export type RepeatEnd =
  | { type: "never" }
  /** Ultimo giorno compreso (YYYY-MM-DD) nel fuso dell'evento. */
  | { type: "until"; date: string }
  /** Numero di volte (1–999); l'inizio dell'evento è la prima. */
  | { type: "count"; count: number };

/** Ripetizione (sottoinsieme di RRULE, RFC 5545): ogni 3 mesi = monthly × 3, ogni 6 mesi = monthly × 6. */
export interface RepeatRule {
  freq: "daily" | "weekly" | "monthly" | "yearly";
  /** 1–99 (assente = 1). */
  interval?: number;
  /** Giorni della settimana (solo settimanale): lun, mer, ven in un solo evento. */
  byWeekday?: Weekday[];
  /** Solo mensile; assente = stesso giorno del mese (i mesi senza quel giorno si saltano). */
  monthly?: RepeatMonthly;
  /** Solo annuale con inizio il 29 febbraio: negli anni non bisestili 28 febbraio (predefinito), 1° marzo o niente. */
  yearlyLeap?: "feb28" | "mar1" | "skip";
  end?: RepeatEnd;
  /** Inizio della settimana per "ogni N settimane" (assente = lunedì). */
  wkst?: Weekday;
  /** RRULE importata con parti non gestite: si esporta così com'è. */
  sourceRRule?: string;
}

export interface EventReminder {
  /** Minuti prima dell'inizio. */
  minutesBefore?: number;
  /** Giorni prima (con `at`: quel giorno a quell'ora). */
  daysBefore?: number;
  /** Ora del promemoria (HH:mm) nel fuso dell'evento, per gli eventi di tutto il giorno. */
  at?: string;
}

export type OccasionKind = "birthday" | "anniversary" | "holiday" | "recurring-day";

export interface EventOccasion {
  kind: OccasionKind;
  /** Anno di nascita o di inizio: l'età si calcola per ogni occorrenza. */
  birthYear?: number;
  person?: string;
}

export interface Task extends BaseEntity {
  title: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  dueDate?: string;
  subjectId?: ID;
  status: "todo" | "doing" | "blocked" | "done" | "postponed" | "archived";
  subtasks: { id: ID; text: string; done: boolean }[];
  attachmentIds: ID[];
  notes: string;
  estimatedMinutes: number;
  actualMinutes?: number;
  completedAt?: string;
  timerStartedAt?: string;
  timerAccumulatedSeconds?: number;
  timerLastReminderAt?: string;
  energy: "low" | "medium" | "high";
  difficulty: 1 | 2 | 3 | 4 | 5;
  importance: 1 | 2 | 3 | 4 | 5;
  cover?: string;
  /**
   * Peso nell'avanzamento della materia: 0 non conta (ripasso, organizzazione), 2 o 3 vale doppio o
   * triplo. Assente = 1, cioè parti uguali tra le attività (src/lib/subjectProgress.ts).
   */
  progressWeight?: 0 | 1 | 2 | 3;
}

export interface StudySession extends BaseEntity {
  title: string;
  subjectId?: ID;
  template:
    | "new-topic"
    | "review"
    | "exercises"
    | "exam-simulation"
    | "pdf-reading"
    | "notes-cleanup"
    | "memorization"
    | "lab"
    | "oral-prep";
  plannedMinutes: number;
  actualMinutes: number;
  start: string;
  end?: string;
  topics: string[];
  perceivedDifficulty: 1 | 2 | 3 | 4 | 5;
  focusLevel: 1 | 2 | 3 | 4 | 5;
  notes: string;
  attachmentIds: ID[];
  status: "planned" | "running" | "completed" | "skipped";
  /** Da dove arriva: blocco Pomodoro, Timer, cronometro o aggiunta a mano (assente = vecchia o a mano). */
  source?: "pomodoro" | "timer" | "stopwatch" | "manual";
  /** Argomento da ripassare studiato in questa sessione (StudyTopic della stessa materia). */
  topicId?: ID;
}

/**
 * Durate del timer di studio in minuti (tutte facoltative). Nella materia valgono solo per lei,
 * nelle preferenze per tutte le altre; mancano → valori predefiniti (vedi lib/timerPrefs.ts).
 */
export interface TimerSettings {
  focusMinutes?: number;
  shortBreakMinutes?: number;
  longBreakMinutes?: number;
  longBreakEvery?: number;
  stopwatchTargetMinutes?: number;
  /** Timer (conto alla rovescia): ultima durata scelta, in minuti. */
  timerMinutes?: number;
}

export interface StudyTopic extends BaseEntity {
  subjectId: ID;
  title: string;
  firstStudiedAt: string;
  comprehension: 1 | 2 | 3 | 4 | 5;
  memorization: 1 | 2 | 3 | 4 | 5;
  difficulty: 1 | 2 | 3 | 4 | 5;
  nextReviewDate: string;
  completedReviews: number;
  notes: string;
  attachmentIds: ID[];
  questions: string[];
  /** Ripasso a intervalli: giorni dell'ultimo intervallo e facilità (stile SM-2). */
  intervalDays?: number;
  ease?: number;
  lastReviewedAt?: string;
}

export interface Attachment extends BaseEntity {
  name: string;
  mimeType: string;
  size: number;
  addedAt: string;
  linkedEntityType?: EntityType;
  linkedEntityId?: ID;
  description: string;
  /** File incorporato in Base64 (versioni di prima): si sposta nello spazio file con l'account. */
  dataUrl?: string;
  /**
   * File fuori dalla riga sincronizzata (src/lib/attachments.ts): "local" = solo sul dispositivo che
   * l'ha aggiunto (da caricare o senza account), "cloud" = nel bucket privato `<uid>/<id>`. Il percorso
   * non si salva mai. Chiave protetta della condivisione, come `dataUrl`.
   */
  storedFile?: "local" | "cloud";
  externalUrl?: string;
}

export interface Goal extends BaseEntity {
  title: string;
  description: string;
  category: "study" | "exam" | "notes" | "review" | "streak" | "fitness" | "personal" | "project";
  startDate: string;
  deadline?: string;
  progress: number;
  metric: string;
  linkedTaskIds: ID[];
  linkedSessionIds: ID[];
  status: "active" | "paused" | "done" | "archived";
  notes: string;
}

export interface Note extends BaseEntity {
  title: string;
  body: string;
  linkedEntityType?: EntityType;
  linkedEntityId?: ID;
}

export interface Tag extends BaseEntity {
  label: string;
  color: string;
}

export interface Reminder extends BaseEntity {
  title: string;
  remindAt: string;
  linkedEntityType?: EntityType;
  linkedEntityId?: ID;
  done: boolean;
}

export interface DashboardWidget extends BaseEntity {
  type:
    | "today"
    | "deadlines"
    | "study"
    | "exams"
    | "urgent"
    | "subjects"
    | "materials"
    | "weekly-progress"
    | "streak"
    | "suggestion";
  title: string;
  order: number;
  size: "small" | "medium" | "large" | "wide";
  color: string;
  icon: string;
  subjectId?: ID;
  visible: boolean;
}

/**
 * Preferenze personali dell'account (una sola entità, id "main"). Sono sincronizzate con il
 * cloud come le altre entità, quindi seguono l'account e non il dispositivo.
 */
export interface Preferences extends BaseEntity {
  displayName: string;
  avatarDataUrl?: string;
  /** Obiettivo di studio settimanale in minuti. */
  weeklyTargetMinutes: number;
  /** CFU totali del corso di laurea (per il libretto). */
  degreeCfu: number;
  /** Mostra la sezione del corso BARB · UNIMI nella navigazione. */
  showBarb: boolean;
  /** Corso di laurea per la proiezione del voto (regole in lib/graduation.ts). */
  degreeProgram?: "barb" | "scienze-biologiche";
  /** Scenario della proiezione: voto della prova finale (Scienze biologiche, 18–30). */
  sbThesisGrade?: number;
  /** Scenario della proiezione: punti della tesi (BARB, 1–9). */
  barbThesisPoints?: number;
  /** Scenario della proiezione: esperienza all'estero riconosciuta dal corso. */
  abroad?: boolean;
  /** Durate del timer per tutte le materie senza durate proprie. */
  timer?: TimerSettings;
  /**
   * "Colori delle tipologie": colore scelto per una tipologia (chiavi di EVENT_TYPE_COLORS, es.
   * "exam", "birthday"). Arriva dalla sincronizzazione: leggerlo con `sanitizeTypeColorOverrides`.
   */
  eventTypeColors?: Partial<Record<string, string>>;
  /**
   * Promemoria con l'app chiusa (notifiche push, supabase/push-reminders.sql) sui dispositivi con le
   * notifiche attive. Assente = acceso; false = solo ad app aperta.
   */
  pushReminders?: boolean;
  /**
   * Coppie di materie che la persona ha detto diverse nel riquadro «Possibili doppioni» di Materie
   * (chiavi di `subjectPairKey`): non vengono più proposte. Arriva dalla sincronizzazione: leggerle
   * con `dismissedSubjectPairs`.
   */
  distinctSubjectPairs?: string[];
  /**
   * Tema e colori (Impostazioni › Aspetto): seguono l'account su ogni dispositivo. Assenti = quelli
   * del dispositivo (account di prima). Arrivano dalla sincronizzazione: leggerli con `validLook`.
   */
  themeMode?: ThemeMode;
  palette?: PaletteName;
}

/** Notifica dell'account: segue l'utente su ogni dispositivo (collezione sincronizzata). */
export interface AppNotification extends BaseEntity {
  kind: "invite" | "group" | "share" | "system";
  title: string;
  body: string;
  /** Vista da aprire toccando la notifica. */
  linkView?: AppView;
  /** Gruppo collegato (inviti, bacheca, membri). */
  linkGroupId?: ID;
  /** ISO di lettura; assente = non letta. */
  readAt?: string;
}

/** Membro di un gruppo di studio. */
export interface GroupMember {
  userId: string;
  email?: string;
  displayName: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
}

/** Gruppo di studio collaborativo (local-first; condiviso via cloud se configurato). */
export interface StudyGroup extends BaseEntity {
  name: string;
  description: string;
  /** id utente del proprietario (auth) oppure id locale del dispositivo creatore. */
  ownerId: string;
  ownerDisplayName: string;
  members: GroupMember[];
  /** Codice di invito condivisibile (es. GRP-XXXX-XXXX). */
  inviteCode: string;
  /** Visto almeno una volta sul backend condiviso: se poi sparisce, è stato eliminato o si è stati rimossi. */
  sharedAt?: string;
}

/** Invito a un gruppo: per email e/o codice condivisibile. */
export interface GroupInvite extends BaseEntity {
  groupId: string;
  groupName: string;
  groupDescription?: string;
  fromUserId: string;
  fromDisplayName: string;
  /** Email del destinatario degli inviti nominali di prima: quelli nuovi vanno a un account (recipientUserId). */
  recipientEmail?: string;
  /** Account destinatario (supabase/people.sql): solo lui può accettare. */
  recipientUserId?: string;
  /** Nome della persona invitata, solo per l'elenco di chi invita (il server non lo conserva). */
  recipientName?: string;
  /** Codice usato per l'unione (uguale a StudyGroup.inviteCode o singolo). */
  code: string;
  status: "pending" | "accepted" | "declined";
}

/** Risorsa condivisa nella bacheca del gruppo. */
/**
 * Versione precedente di un annuncio della bacheca: il contenuto sostituito, con chi l'ha cambiato e
 * quando. Nei gruppi condivisi la scrive solo il server (studyos_group_resources_guard, groups.sql).
 */
export interface GroupResourceRevision {
  id: string;
  /** Ora della modifica che ha sostituito questa versione. */
  at: string;
  byUserId: string;
  byDisplayName: string;
  kind: GroupResource["kind"];
  title: string;
  url?: string;
  body?: string;
}

export interface GroupResource extends BaseEntity {
  groupId: string;
  kind: "link" | "note" | "file" | "task";
  title: string;
  url?: string;
  body?: string;
  pinned: boolean;
  addedByUserId: string;
  addedByDisplayName: string;
  /** Versioni precedenti, dalla più vecchia; l'ultima dice chi ha fatto l'ultima modifica e quando. */
  revisions?: GroupResourceRevision[];
  /** Visto almeno una volta sul backend condiviso: se poi sparisce, è stata cancellata. */
  sharedAt?: string;
}

/** Voce minima della cronologia attività del gruppo. */
export interface GroupActivity extends BaseEntity {
  groupId: string;
  actorDisplayName: string;
  text: string;
}

export interface VaultRecord {
  id: "main";
  encrypted: true;
  algorithm: "AES-GCM";
  kdf: "PBKDF2-SHA256";
  iterations: number;
  salt: string;
  iv: string;
  payload: string;
  updatedAt: string;
}

/** Tipo di prova di un appello del gruppo (stessi valori della colonna kind di group-exams.sql). */
export type GroupExamKind = "appello" | "preappello" | "prova_in_itinere" | "scritto" | "orale" | "laboratorio" | "altro";

/** Stato personale di un appello nel piano d'esame. */
export type ExamPlanStatus = "planned" | "registered" | "taken" | "passed" | "failed" | "withdrawn" | "skipped";

/** Copia dell'appello al momento della scelta: serve offline e per dire «è cambiato da quando l'hai scelto». */
export interface ExamPlanSnapshot {
  groupId: ID;
  groupName: string;
  courseKey: string;
  courseName: string;
  /** Giorno YYYY-MM-DD. */
  date: string;
  kind: GroupExamKind;
  time: string | null;
  room: string;
  registrationCloses: string | null;
  version: number;
}

/** Piano d'esame personale sopra un appello del gruppo (collezione examPlans, sync personale). */
export interface ExamPlan extends BaseEntity {
  sessionId: ID;
  selected: boolean;
  status: ExamPlanStatus;
  notes: string;
  reminders: EventReminder[];
  remindRegistration: boolean;
  subjectId?: ID;
  examId?: ID;
  linkedEventId?: ID;
  /** `event:<id>` / `exam:<id>` scartati con «Tienili separati». */
  dismissedMatches: string[];
  snapshot: ExamPlanSnapshot;
}

export interface StudySnapshot {
  version: 1;
  exportedAt: string;
  subjects: Subject[];
  exams: Exam[];
  events: CalendarEvent[];
  tasks: Task[];
  sessions: StudySession[];
  topics: StudyTopic[];
  attachments: Attachment[];
  goals: Goal[];
  notes: Note[];
  tags: Tag[];
  reminders: Reminder[];
  widgets: DashboardWidget[];
  preferences: Preferences[];
  notifications: AppNotification[];
  studyGroups: StudyGroup[];
  groupInvites: GroupInvite[];
  groupResources: GroupResource[];
  groupActivities: GroupActivity[];
  examPlans: ExamPlan[];
  decks: StudyDeck[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  quizQuestions: QuizQuestion[];
  cardStates: FlashcardState[];
  studyRuns: StudyRun[];
  aiAnalyses: AiAnalysis[];
  aiRequests: AiRequest[];
  studyMarks: StudyMark[];
}

export interface BackupEnvelope {
  format: "studyos.backup";
  version: 1;
  /**
   * Assente nei backup precedenti: vedi inferBackupScope. "items": elementi scelti (es. quelli troppo
   * grandi per l'account, pannello Account), uniti ai dati all'importazione come gli altri parziali.
   */
  scope?: "full" | "tasks" | "calendar" | "subjects" | "items";
  exportedAt: string;
  encrypted: boolean;
  data?: StudySnapshot;
  crypto?: VaultRecord;
  settings: Pick<UserSettings, "themeMode" | "palette" | "density" | "cardShape" | "dateFormat" | "profile">;
}

// ─── Flashcard, quiz, ripasso e analisi degli agenti (design: docs/superpowers/specs/2026-11-16-flashcards-quiz-design.md) ───

/** Blocco di contenuto strutturato (schema v1, validato da src/lib/cardBlocks.ts). */
export type CardBlock =
  | { type: "text"; text: string }
  | { type: "heading"; text: string; level?: 2 | 3 }
  | { type: "list"; items: string[]; ordered?: boolean }
  | { type: "formula"; latex: string; display?: boolean; caption?: string }
  | { type: "image"; url: string; alt: string; caption?: string; width?: number; height?: number }
  | { type: "svg"; svg: string; alt: string; caption?: string; background?: "light" | "transparent" }
  | { type: "code"; code: string; language?: string }
  | { type: "table"; rows: string[][]; header?: string[]; caption?: string }
  | { type: "callout"; text: string; tone?: "info" | "tip" | "warning" | "key"; title?: string }
  | { type: "reference"; title: string; chapter?: string; section?: string; pages?: string; url?: string; note?: string };

export type CardBlockType = CardBlock["type"];

/** Fonte verificabile di un contenuto: mai pagine inventate. */
export interface SourceRef {
  title: string;
  chapter?: string;
  section?: string;
  pages?: string;
  url?: string;
  /** Materiale di StudyOS da cui viene (id di un attachment), se c'è. */
  attachmentId?: ID;
}

/** Chi ha creato un contenuto: una persona nell'app o un agente (con il modello, se lo dice). */
export interface ContentAuthor {
  kind: "person" | "agent";
  name?: string;
  model?: string;
}

export type DeckKind = "collection" | "topic" | "chapter" | "paragraph" | "subtopic";

/** Raccolta gerarchica di flashcard e quiz (collezione decks, entità studyDeck). */
export interface StudyDeck extends BaseEntity {
  title: string;
  description: string;
  kind: DeckKind;
  /** Raccolta madre; assente = radice (sotto la materia, se c'è). */
  parentId?: ID;
  subjectId?: ID;
  position: number;
  color?: string;
  icon?: string;
  source?: SourceRef;
  /** Metadati liberi (chiave → testo), al massimo 20. */
  meta?: Record<string, string>;
  author?: ContentAuthor;
  /** Chiave dell'agente per non duplicare la raccolta (unica nell'account). */
  externalRef?: string;
}

export interface Flashcard extends BaseEntity {
  deckId: ID;
  /** Copiato dalla raccolta: serve al filtro per materia della condivisione e alle statistiche. */
  subjectId?: ID;
  title?: string;
  front: CardBlock[];
  back: CardBlock[];
  /** Spiegazione pubblicata nella raccolta (visibile a chi la condivide). */
  explanation?: CardBlock[];
  difficulty?: 1 | 2 | 3 | 4 | 5;
  position: number;
  sources?: SourceRef[];
  author?: ContentAuthor;
  /** Sale a ogni modifica del contenuto: le risposte registrano la revisione che hanno visto. */
  revision: number;
  /** Chiave dell'agente per non duplicare lo stesso elemento (unica nella raccolta). */
  externalRef?: string;
}

export interface Quiz extends BaseEntity {
  deckId?: ID;
  subjectId?: ID;
  title: string;
  description: string;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  /** Tempo suggerito per la simulazione d'esame (minuti). */
  timeLimitMinutes?: number;
  position: number;
  sources?: SourceRef[];
  author?: ContentAuthor;
  revision: number;
  externalRef?: string;
}

export interface QuizOption {
  /** Id stabile: la correttezza non dipende dall'ordine mostrato. */
  id: string;
  text: string;
  correct: boolean;
  /** Perché questa opzione è giusta o sbagliata. */
  feedback?: string;
}

export interface QuizQuestion extends BaseEntity {
  quizId: ID;
  subjectId?: ID;
  /** single = una sola giusta; multiple = una o più giuste (punto solo con l'insieme esatto). */
  kind: "single" | "multiple";
  prompt: CardBlock[];
  options: QuizOption[];
  explanation?: CardBlock[];
  /** Errori comuni da evitare. */
  mistakes?: string;
  difficulty?: 1 | 2 | 3 | 4 | 5;
  position: number;
  sources?: SourceRef[];
  revision: number;
  externalRef?: string;
}

export type ReviewResult = "correct" | "wrong" | "doubt" | "skip";

/** Stato personale di ripasso di una scheda (id = id della scheda). Mai condiviso. */
export interface FlashcardState extends BaseEntity {
  /** Proprietario della scheda: assente = scheda propria; altrimenti id dell'account che la condivide. */
  ownerId?: string;
  deckId?: ID;
  subjectId?: ID;
  reps: number;
  lapses: number;
  ease: number;
  intervalDays: number;
  /** Prossimo ripasso (ISO). */
  due: string;
  lastResult?: Exclude<ReviewResult, "skip">;
  lastReviewedAt?: string;
  correct: number;
  wrong: number;
  doubt: number;
  /** Revisione della scheda all'ultima risposta. */
  revision?: number;
}

/** Evento compatto di una sessione: scheda o domanda, esito, ms, istante, revisione vista. */
export interface StudyRunEvent {
  /** Id della scheda o della domanda. */
  i: string;
  /** Esito. Nei quiz: correct, wrong o skip (non data). */
  r: ReviewResult;
  /** Millisecondi per rispondere. */
  ms?: number;
  /** Istante (ISO). */
  at: string;
  /** Revisione del contenuto vista. */
  v?: number;
  /** Quiz: opzioni scelte. */
  c?: string[];
  /** Quiz: segnata come dubbia dall'utente. */
  f?: boolean;
}

export type StudyRunMode = "review" | "free" | "training" | "exam" | "errors" | "random" | "custom";

/** Sessione di ripasso o tentativo di quiz (personale, storico immutabile per risposta). */
export interface StudyRun extends BaseEntity {
  kind: "flashcards" | "quiz";
  mode: StudyRunMode;
  title: string;
  quizId?: ID;
  deckIds: ID[];
  subjectIds: ID[];
  startedAt: string;
  endedAt?: string;
  /** Domande/schede previste, nell'ordine mostrato. */
  itemIds: ID[];
  events: StudyRunEvent[];
  /** Continuazione di una sessione con più di 400 risposte. */
  continuesId?: ID;
  /** Quiz: punteggio finale (corrette ÷ domande). */
  score?: number;
  /**
   * Sessione o tentativo interrotto, da riprendere da qui (anche da un altro dispositivo). Presente
   * solo finché la sessione non è chiusa: «Termina», la fine o «Scarta» lo tolgono.
   */
  progress?: RunProgress;
  /** Ripresa dopo un'interruzione (resta anche a sessione chiusa: la si riconosce nello storico). */
  resumed?: RunResumed;
}

/** Dispositivo (browser) che ha salvato il punto di ripresa: id casuale del browser e nome leggibile. */
export interface RunDevice {
  id: string;
  /** «iPhone · Safari», «Mac · Chrome». */
  name: string;
  kind: "phone" | "tablet" | "computer";
}

export interface RunResumed {
  /** Quante volte è stata ripresa. */
  count: number;
  /** Ultima ripresa (ISO). */
  at: string;
  /** Almeno una volta ripresa su un dispositivo diverso da quello dell'interruzione. */
  elsewhere?: boolean;
  /** Nome del dispositivo dell'interruzione, l'ultima volta che era un altro («iPhone · Safari»). */
  from?: string;
}

/** Punto di ripresa di una sessione di ripasso o di un tentativo di quiz in pausa. */
export interface RunProgress {
  /** Ultimo salvataggio (ISO). */
  at: string;
  /** Posizione in vista (0 = prima scheda o domanda). */
  index: number;
  /** Quiz: seme e mescolamento con cui sono state preparate le domande (l'ordine è in itemIds). */
  seed?: number;
  shuffle?: boolean;
  /** Quiz: opzioni scelte finora, per domanda. Gli eventi si scrivono solo alla fine del tentativo. */
  answers?: Record<string, string[]>;
  /** Quiz in allenamento: domande già confermate (esito già visto). */
  checked?: string[];
  /** Quiz simulazione d'esame: millisecondi già passati (il tempo riparte da qui). */
  elapsedMs?: number;
  /** Dove è stata interrotta (ultimo salvataggio). Assente nelle righe salvate prima. */
  device?: RunDevice;
}

export type StudyMarkKind = "card" | "question";

/**
 * Segno «dubbio» su una flashcard o una domanda di quiz: personale, si toglie quando si vuole
 * (id = id dell'elemento). Materia, raccolta e quiz sono copiati per raggruppare e filtrare anche
 * quando l'elemento è di un'altra persona.
 */
export interface StudyMark extends BaseEntity {
  kind: StudyMarkKind;
  /** Proprietario dell'elemento: assente = tuo; altrimenti id dell'account che lo condivide. */
  ownerId?: string;
  deckId?: ID;
  quizId?: ID;
  subjectId?: ID;
  /** Nota facoltativa: cosa non è chiaro. */
  note?: string;
}

export interface AiAnalysisSection {
  kind: "strengths" | "weaknesses" | "mistakes" | "priorities" | "tips" | "quizzes" | "progress" | "other";
  title: string;
  body: string;
  /** Elementi citati (schede, raccolte, quiz, materie) per i collegamenti nell'app. */
  refs?: { type: "flashcard" | "deck" | "quiz" | "subject"; id: ID }[];
}

/** Analisi qualitativa scritta da un agente (personale). */
export interface AiAnalysis extends BaseEntity {
  title: string;
  summary: string;
  sections: AiAnalysisSection[];
  scope: { subjectIds: ID[]; deckIds: ID[] };
  periodFrom?: string;
  periodTo?: string;
  agent: ContentAuthor;
  version: number;
  status: "active" | "archived";
  /** Analisi precedente che questa sostituisce. */
  supersedesId?: ID;
  /** Richiesta da cui nasce, se c'è. */
  requestId?: ID;
  /** Dati usati (contatori, filtri) dichiarati dall'agente. */
  dataNote?: string;
}

export type AiRequestStatus = "pending" | "claimed" | "completed" | "failed" | "expired" | "cancelled";
export type AiRequestStyle = "simple" | "deep" | "example" | "analogy" | "diagram" | "doubt" | "custom";

/** Richiesta dell'app a un agente («Spiegami meglio», «Analizza»): coda persistente, personale. */
export interface AiRequest extends BaseEntity {
  kind: "explain_card" | "explain_question" | "analysis";
  targetId?: ID;
  /** Proprietario del contenuto, se è di un'altra persona. */
  targetOwnerId?: string;
  style: AiRequestStyle;
  /** Domanda o dubbio scritto dall'utente. */
  prompt: string;
  status: AiRequestStatus;
  /** Ambito di un'analisi. */
  scope?: { subjectIds: ID[]; deckIds: ID[]; days?: number };
  expiresAt: string;
  claimedAt?: string;
  /** Nome dell'agente che l'ha presa. */
  claimedBy?: string;
  /** Hash della presa: solo chi l'ha presa la chiude. */
  claimToken?: string;
  leaseUntil?: string;
  attempts: number;
  /**
   * Sale a ogni presa, chiusura o rinuncia di un assistente: sul connettore remoto due assistenti
   * che prendono la stessa richiesta dalla stessa versione scrivono la stessa revisione con token
   * diversi, e il database rifiuta la seconda (agent.sql). Assente nelle richieste mai toccate.
   */
  revision?: number;
  completedAt?: string;
  result?: { title?: string; blocks: CardBlock[]; agent: ContentAuthor; analysisId?: ID };
  error?: string;
}
