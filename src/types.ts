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
  | "note";

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
  initialView: AppView;
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
  | "dashboard"
  | "calendar"
  | "tasks"
  | "study"
  | "subjects"
  | "exams"
  | "materials"
  | "goals"
  | "stats"
  | "settings";

export interface Subject extends BaseEntity {
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
  recurrence?: "none" | "daily" | "weekly" | "monthly";
  status: "planned" | "in-progress" | "done" | "skipped";
  checklist: { id: ID; text: string; done: boolean }[];
  attachmentIds: ID[];
  cover?: string;
  notes: string;
  links: string[];
  goalId?: ID;
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
}

export interface BackupEnvelope {
  format: "studyos.backup";
  version: 1;
  exportedAt: string;
  encrypted: boolean;
  data?: StudySnapshot;
  crypto?: VaultRecord;
  settings: Pick<UserSettings, "themeMode" | "palette" | "density" | "cardShape" | "dateFormat" | "profile">;
}
