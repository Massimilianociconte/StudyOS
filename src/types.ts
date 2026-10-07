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
  | "groupActivity";

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
  | "other";

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
  dataUrl?: string;
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
}

/** Notifica dell'account: segue l'utente su ogni dispositivo (collezione sincronizzata). */
export interface AppNotification extends BaseEntity {
  kind: "invite" | "group" | "system";
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
  /** Email del destinatario, quando l'invito è nominale. */
  recipientEmail?: string;
  /** Codice usato per l'unione (uguale a StudyGroup.inviteCode o singolo). */
  code: string;
  status: "pending" | "accepted" | "declined";
}

/** Risorsa condivisa nella bacheca del gruppo. */
export interface GroupResource extends BaseEntity {
  groupId: string;
  kind: "link" | "note" | "file" | "task";
  title: string;
  url?: string;
  body?: string;
  pinned: boolean;
  addedByUserId: string;
  addedByDisplayName: string;
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
}

export interface BackupEnvelope {
  format: "studyos.backup";
  version: 1;
  /** Assente nei backup precedenti: vedi inferBackupScope. */
  scope?: "full" | "tasks" | "calendar" | "subjects";
  exportedAt: string;
  encrypted: boolean;
  data?: StudySnapshot;
  crypto?: VaultRecord;
  settings: Pick<UserSettings, "themeMode" | "palette" | "density" | "cardShape" | "dateFormat" | "profile">;
}
