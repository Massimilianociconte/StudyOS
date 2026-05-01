import { create } from "zustand";
import type {
  AppView,
  Attachment,
  CalendarEvent,
  DashboardWidget,
  Exam,
  Goal,
  Note,
  Reminder,
  StudySession,
  StudySnapshot,
  StudyTopic,
  Subject,
  Tag,
  Task,
  UserSettings
} from "../types";
import { createEmptySnapshot, defaultSettings } from "../data/defaults";
import { createId, nowIso } from "../lib/id";
import { clearDataTables, db, readSnapshotFromDb, writeSnapshotToDb } from "../lib/db";
import { decryptString, encryptString, makePassphraseVerifier, verifyPassphrase } from "../lib/crypto";
import { stripLegacyMockData } from "../lib/migrations";
import { fileToDataUrl } from "../lib/files";
import { normalizeTaskPatch, taskStatusTransitionPatch } from "../lib/taskTimer";

let sessionPassphrase: string | undefined;

interface TimerState {
  mode: "classic" | "pomodoro" | "deep-focus";
  running: boolean;
  remainingSeconds: number;
  label: string;
  linkedTaskId?: string;
}

interface StudyState {
  loading: boolean;
  locked: boolean;
  activeView: AppView;
  settings: UserSettings;
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
  timer: TimerState;
  error?: string;
  init: () => Promise<void>;
  unlockVault: (passphrase: string) => Promise<void>;
  lockVault: () => void;
  enableVault: (passphrase: string, hint?: string) => Promise<void>;
  disableVault: (passphrase?: string) => Promise<void>;
  setActiveView: (view: AppView) => void;
  updateSettings: (settings: Partial<UserSettings>) => Promise<void>;
  addTask: (task: Partial<Task> & Pick<Task, "title">) => Promise<void>;
  updateTask: (id: string, patch: Partial<Task>) => Promise<void>;
  toggleTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
  addEvent: (event: Partial<CalendarEvent> & Pick<CalendarEvent, "title" | "start" | "end">) => Promise<void>;
  updateEvent: (id: string, patch: Partial<CalendarEvent>) => Promise<void>;
  deleteEvent: (id: string) => Promise<void>;
  addSubject: (subject: Partial<Subject> & Pick<Subject, "name">) => Promise<void>;
  updateSubject: (id: string, patch: Partial<Subject>) => Promise<void>;
  addExam: (exam: Partial<Exam> & Pick<Exam, "subjectId" | "date">) => Promise<void>;
  updateExam: (id: string, patch: Partial<Exam>) => Promise<void>;
  deleteExam: (id: string) => Promise<void>;
  addSession: (session: Partial<StudySession> & Pick<StudySession, "title">) => Promise<void>;
  updateSession: (id: string, patch: Partial<StudySession>) => Promise<void>;
  completeTopicReview: (id: string) => Promise<void>;
  addAttachment: (file: File, link?: { type?: Attachment["linkedEntityType"]; id?: string }) => Promise<void>;
  addExternalAttachment: (url: string, name: string, description?: string) => Promise<void>;
  updateAttachment: (id: string, patch: Partial<Attachment>) => Promise<void>;
  deleteAttachment: (id: string) => Promise<void>;
  addGoal: (goal: Partial<Goal> & Pick<Goal, "title">) => Promise<void>;
  updateGoal: (id: string, patch: Partial<Goal>) => Promise<void>;
  replaceAllData: (snapshot: StudySnapshot) => Promise<void>;
  resetAllData: () => Promise<void>;
  setTimer: (timer: Partial<TimerState>) => void;
}

export const snapshotFromState = (state: Pick<
  StudyState,
  | "subjects"
  | "exams"
  | "events"
  | "tasks"
  | "sessions"
  | "topics"
  | "attachments"
  | "goals"
  | "notes"
  | "tags"
  | "reminders"
  | "widgets"
>): StudySnapshot => ({
  version: 1,
  exportedAt: nowIso(),
  subjects: state.subjects,
  exams: state.exams,
  events: state.events,
  tasks: state.tasks,
  sessions: state.sessions,
  topics: state.topics,
  attachments: state.attachments,
  goals: state.goals,
  notes: state.notes,
  tags: state.tags,
  reminders: state.reminders,
  widgets: state.widgets
});

const applySnapshot = (snapshot: StudySnapshot) => ({
  subjects: snapshot.subjects,
  exams: snapshot.exams,
  events: snapshot.events,
  tasks: snapshot.tasks,
  sessions: snapshot.sessions,
  topics: snapshot.topics,
  attachments: snapshot.attachments,
  goals: snapshot.goals,
  notes: snapshot.notes,
  tags: snapshot.tags,
  reminders: snapshot.reminders,
  widgets: snapshot.widgets
});

const taskDefaults = (task: Partial<Task> & Pick<Task, "title">): Task => ({
  id: createId("task"),
  createdAt: nowIso(),
  updatedAt: nowIso(),
  archived: false,
  tags: task.tags ?? [],
  title: task.title,
  description: task.description ?? "",
  priority: task.priority ?? "medium",
  dueDate: task.dueDate,
  subjectId: task.subjectId,
  status: task.status ?? "todo",
  subtasks: task.subtasks ?? [],
  attachmentIds: task.attachmentIds ?? [],
  notes: task.notes ?? "",
  estimatedMinutes: task.estimatedMinutes ?? 45,
  actualMinutes: task.actualMinutes,
  completedAt: task.completedAt,
  timerStartedAt: task.timerStartedAt,
  timerAccumulatedSeconds: task.timerAccumulatedSeconds,
  timerLastReminderAt: task.timerLastReminderAt,
  energy: task.energy ?? "medium",
  difficulty: task.difficulty ?? 2,
  importance: task.importance ?? 3,
  cover: task.cover
});

const persistState = async (state: StudyState) => {
  const snapshot = snapshotFromState(state);
  await db.settings.put({ ...state.settings, updatedAt: nowIso() });

  if (state.settings.security.mode === "vault") {
    if (!sessionPassphrase) return;
    const vault = await encryptString(JSON.stringify(snapshot), sessionPassphrase);
    await db.vault.put(vault);
    await clearDataTables();
    return;
  }

  await writeSnapshotToDb(snapshot);
};

export const useStudyStore = create<StudyState>((set, get) => ({
  loading: true,
  locked: false,
  activeView: "dashboard",
  settings: defaultSettings(),
  ...applySnapshot(createEmptySnapshot()),
  timer: {
    mode: "pomodoro",
    running: false,
    remainingSeconds: 25 * 60,
    label: "Focus"
  },

  init: async () => {
    set({ loading: true, error: undefined });
    try {
      const savedSettings = await db.settings.get("settings");
      const settings = savedSettings ?? defaultSettings();
      const vault = await db.vault.get("main");

      if (settings.security.mode === "vault" && vault) {
        set({
          settings,
          activeView: settings.initialView,
          locked: true,
          loading: false,
          ...applySnapshot(createEmptySnapshot())
        });
        return;
      }

      let snapshot = await readSnapshotFromDb();
      if (!savedSettings) {
        snapshot = createEmptySnapshot();
        await db.settings.put(settings);
        await writeSnapshotToDb(snapshot);
      } else {
        const cleaned = stripLegacyMockData(snapshot);
        if (cleaned.changed) {
          snapshot = cleaned.snapshot;
          await writeSnapshotToDb(snapshot);
        }
      }

      set({
        settings,
        activeView: settings.initialView,
        locked: false,
        loading: false,
        ...applySnapshot(snapshot)
      });
    } catch (error) {
      set({ loading: false, error: error instanceof Error ? error.message : "Errore di avvio." });
    }
  },

  unlockVault: async (passphrase) => {
    const settings = get().settings;
    if (settings.security.verifierSalt && settings.security.verifierHash) {
      const ok = await verifyPassphrase(passphrase, settings.security.verifierSalt, settings.security.verifierHash);
      if (!ok) throw new Error("Passphrase non valida.");
    }

    const vault = await db.vault.get("main");
    if (!vault) throw new Error("Vault locale non trovato.");
    const rawSnapshot = JSON.parse(await decryptString(vault, passphrase)) as StudySnapshot;
    const cleaned = stripLegacyMockData(rawSnapshot);
    const snapshot = cleaned.snapshot;
    sessionPassphrase = passphrase;
    if (cleaned.changed) {
      await db.vault.put(await encryptString(JSON.stringify(snapshot), passphrase));
    }
    set({ locked: false, ...applySnapshot(snapshot), activeView: settings.initialView, error: undefined });
  },

  lockVault: () => {
    sessionPassphrase = undefined;
    set({ locked: true, ...applySnapshot(createEmptySnapshot()), activeView: "dashboard" });
  },

  enableVault: async (passphrase, hint) => {
    const verifier = await makePassphraseVerifier(passphrase);
    const settings: UserSettings = {
      ...get().settings,
      security: {
        ...get().settings.security,
        mode: "vault",
        backupEncryptionDefault: true,
        passphraseHint: hint,
        verifierSalt: verifier.salt,
        verifierHash: verifier.hash
      },
      updatedAt: nowIso()
    };
    const snapshot = snapshotFromState(get());
    const vault = await encryptString(JSON.stringify(snapshot), passphrase);
    await db.settings.put(settings);
    await db.vault.put(vault);
    await clearDataTables();
    sessionPassphrase = passphrase;
    set({ settings, locked: false });
  },

  disableVault: async (passphrase) => {
    const currentPassphrase = sessionPassphrase ?? passphrase;
    if (!currentPassphrase) throw new Error("Serve la passphrase per disattivare il vault.");

    const vault = await db.vault.get("main");
    let snapshot = snapshotFromState(get());
    if (vault && get().locked) {
      snapshot = JSON.parse(await decryptString(vault, currentPassphrase)) as StudySnapshot;
    }

    const settings: UserSettings = {
      ...get().settings,
      security: {
        mode: "standard",
        backupEncryptionDefault: true
      },
      updatedAt: nowIso()
    };
    await db.settings.put(settings);
    await writeSnapshotToDb(snapshot);
    await db.vault.clear();
    sessionPassphrase = undefined;
    set({ settings, locked: false, ...applySnapshot(snapshot) });
  },

  setActiveView: (view) => set({ activeView: view }),

  updateSettings: async (patch) => {
    const settings = {
      ...get().settings,
      ...patch,
      profile: patch.profile ? { ...get().settings.profile, ...patch.profile } : get().settings.profile,
      security: patch.security ? { ...get().settings.security, ...patch.security } : get().settings.security,
      updatedAt: nowIso()
    };
    set({ settings });
    await persistState(get());
  },

  addTask: async (task) => {
    set((state) => ({ tasks: [taskDefaults(task), ...state.tasks] }));
    await persistState(get());
  },

  updateTask: async (id, patch) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id ? { ...task, ...normalizeTaskPatch(task, patch), updatedAt: nowIso() } : task
      )
    }));
    await persistState(get());
  },

  toggleTask: async (id) => {
    set((state) => ({
      tasks: state.tasks.map((task) =>
        task.id === id
          ? { ...task, ...taskStatusTransitionPatch(task, task.status === "done" ? "todo" : "done"), updatedAt: nowIso() }
          : task
      )
    }));
    await persistState(get());
  },

  deleteTask: async (id) => {
    const detachLinkedEntity = <T extends { linkedEntityType?: string; linkedEntityId?: string; updatedAt: string }>(item: T) =>
      item.linkedEntityType === "task" && item.linkedEntityId === id
        ? { ...item, linkedEntityType: undefined, linkedEntityId: undefined, updatedAt: nowIso() }
        : item;

    set((state) => ({
      tasks: state.tasks.filter((task) => task.id !== id),
      goals: state.goals.map((goal) =>
        goal.linkedTaskIds.includes(id)
          ? { ...goal, linkedTaskIds: goal.linkedTaskIds.filter((taskId) => taskId !== id), updatedAt: nowIso() }
          : goal
      ),
      attachments: state.attachments.map(detachLinkedEntity),
      notes: state.notes.map(detachLinkedEntity),
      reminders: state.reminders.map(detachLinkedEntity)
    }));
    await persistState(get());
  },

  addEvent: async (event) => {
    const created: CalendarEvent = {
      id: createId("event"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
      tags: event.tags ?? [],
      title: event.title,
      description: event.description ?? "",
      category: event.category ?? "study",
      subjectId: event.subjectId,
      color: event.color ?? "#7CF7C8",
      priority: event.priority ?? "medium",
      start: event.start,
      end: event.end,
      recurrence: event.recurrence ?? "none",
      status: event.status ?? "planned",
      checklist: event.checklist ?? [],
      attachmentIds: event.attachmentIds ?? [],
      cover: event.cover,
      notes: event.notes ?? "",
      links: event.links ?? [],
      goalId: event.goalId
    };
    set((state) => ({ events: [created, ...state.events] }));
    await persistState(get());
  },

  updateEvent: async (id, patch) => {
    set((state) => ({
      events: state.events.map((event) => (event.id === id ? { ...event, ...patch, updatedAt: nowIso() } : event))
    }));
    await persistState(get());
  },

  deleteEvent: async (id) => {
    const detachLinkedEntity = <T extends { linkedEntityType?: string; linkedEntityId?: string; updatedAt: string }>(item: T) =>
      item.linkedEntityType === "calendarEvent" && item.linkedEntityId === id
        ? { ...item, linkedEntityType: undefined, linkedEntityId: undefined, updatedAt: nowIso() }
        : item;

    set((state) => ({
      events: state.events.filter((event) => event.id !== id),
      attachments: state.attachments.map(detachLinkedEntity),
      notes: state.notes.map(detachLinkedEntity),
      reminders: state.reminders.map(detachLinkedEntity)
    }));
    await persistState(get());
  },

  addSubject: async (subject) => {
    const created: Subject = {
      id: createId("subject"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
      tags: subject.tags ?? [],
      name: subject.name,
      teacher: subject.teacher ?? "",
      color: subject.color ?? "#7CF7C8",
      icon: subject.icon ?? "BookOpen",
      cover: subject.cover,
      cfu: subject.cfu ?? 6,
      semester: subject.semester ?? "Semestre",
      status: subject.status ?? "active",
      targetGrade: subject.targetGrade,
      examDate: subject.examDate,
      notes: subject.notes ?? ""
    };
    set((state) => ({ subjects: [created, ...state.subjects] }));
    await persistState(get());
  },

  updateSubject: async (id, patch) => {
    set((state) => ({
      subjects: state.subjects.map((subject) =>
        subject.id === id ? { ...subject, ...patch, updatedAt: nowIso() } : subject
      )
    }));
    await persistState(get());
  },

  addExam: async (exam) => {
    const created: Exam = {
      id: createId("exam"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
      tags: exam.tags ?? [],
      subjectId: exam.subjectId,
      date: exam.date,
      program: exam.program ?? [],
      preparation: exam.preparation ?? 0,
      targetGrade: exam.targetGrade ?? 28,
      status: exam.status ?? "planning",
      simulations: exam.simulations ?? 0,
      frequentQuestions: exam.frequentQuestions ?? [],
      cover: exam.cover
    };
    set((state) => ({ exams: [created, ...state.exams] }));
    await persistState(get());
  },

  updateExam: async (id, patch) => {
    set((state) => ({
      exams: state.exams.map((exam) => (exam.id === id ? { ...exam, ...patch, updatedAt: nowIso() } : exam))
    }));
    await persistState(get());
  },

  deleteExam: async (id) => {
    const detachLinkedEntity = <T extends { linkedEntityType?: string; linkedEntityId?: string; updatedAt: string }>(item: T) =>
      item.linkedEntityType === "exam" && item.linkedEntityId === id
        ? { ...item, linkedEntityType: undefined, linkedEntityId: undefined, updatedAt: nowIso() }
        : item;

    set((state) => ({
      exams: state.exams.filter((exam) => exam.id !== id),
      attachments: state.attachments.map(detachLinkedEntity),
      notes: state.notes.map(detachLinkedEntity),
      reminders: state.reminders.map(detachLinkedEntity)
    }));
    await persistState(get());
  },

  addSession: async (session) => {
    const created: StudySession = {
      id: createId("session"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
      tags: session.tags ?? [],
      title: session.title,
      subjectId: session.subjectId,
      template: session.template ?? "new-topic",
      plannedMinutes: session.plannedMinutes ?? 50,
      actualMinutes: session.actualMinutes ?? 0,
      start: session.start ?? nowIso(),
      end: session.end,
      topics: session.topics ?? [],
      perceivedDifficulty: session.perceivedDifficulty ?? 3,
      focusLevel: session.focusLevel ?? 3,
      notes: session.notes ?? "",
      attachmentIds: session.attachmentIds ?? [],
      status: session.status ?? "planned"
    };
    set((state) => ({ sessions: [created, ...state.sessions] }));
    await persistState(get());
  },

  updateSession: async (id, patch) => {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, ...patch, updatedAt: nowIso() } : session
      )
    }));
    await persistState(get());
  },

  completeTopicReview: async (id) => {
    const intervals = [1, 3, 7, 14, 30];
    set((state) => ({
      topics: state.topics.map((topic) => {
        if (topic.id !== id) return topic;
        const nextInterval = intervals[Math.min(topic.completedReviews + 1, intervals.length - 1)];
        const nextReviewDate = new Date();
        nextReviewDate.setDate(nextReviewDate.getDate() + nextInterval);
        return {
          ...topic,
          completedReviews: topic.completedReviews + 1,
          nextReviewDate: nextReviewDate.toISOString(),
          updatedAt: nowIso()
        };
      })
    }));
    await persistState(get());
  },

  addAttachment: async (file, link) => {
    const dataUrl = await fileToDataUrl(file);
    const attachment: Attachment = {
      id: createId("attachment"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
      tags: [],
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      addedAt: nowIso(),
      linkedEntityType: link?.type,
      linkedEntityId: link?.id,
      description: "",
      dataUrl
    };
    set((state) => ({ attachments: [attachment, ...state.attachments] }));
    await persistState(get());
  },

  addExternalAttachment: async (url, name, description) => {
    const attachment: Attachment = {
      id: createId("attachment"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
      tags: ["link"],
      name,
      mimeType: "text/uri-list",
      size: 0,
      addedAt: nowIso(),
      description: description ?? "",
      externalUrl: url
    };
    set((state) => ({ attachments: [attachment, ...state.attachments] }));
    await persistState(get());
  },

  updateAttachment: async (id, patch) => {
    set((state) => ({
      attachments: state.attachments.map((attachment) =>
        attachment.id === id
          ? {
              ...attachment,
              ...patch,
              tags: patch.tags ?? attachment.tags,
              updatedAt: nowIso()
            }
          : attachment
      )
    }));
    await persistState(get());
  },

  deleteAttachment: async (id) => {
    const removeId = (ids: string[]) => ids.filter((attachmentId) => attachmentId !== id);
    set((state) => ({
      attachments: state.attachments.filter((attachment) => attachment.id !== id),
      tasks: state.tasks.map((task) =>
        task.attachmentIds.includes(id) ? { ...task, attachmentIds: removeId(task.attachmentIds), updatedAt: nowIso() } : task
      ),
      events: state.events.map((event) =>
        event.attachmentIds.includes(id) ? { ...event, attachmentIds: removeId(event.attachmentIds), updatedAt: nowIso() } : event
      ),
      sessions: state.sessions.map((session) =>
        session.attachmentIds.includes(id)
          ? { ...session, attachmentIds: removeId(session.attachmentIds), updatedAt: nowIso() }
          : session
      ),
      topics: state.topics.map((topic) =>
        topic.attachmentIds.includes(id) ? { ...topic, attachmentIds: removeId(topic.attachmentIds), updatedAt: nowIso() } : topic
      )
    }));
    await persistState(get());
  },

  addGoal: async (goal) => {
    const created: Goal = {
      id: createId("goal"),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
      tags: goal.tags ?? [],
      title: goal.title,
      description: goal.description ?? "",
      category: goal.category ?? "study",
      startDate: goal.startDate ?? nowIso(),
      deadline: goal.deadline,
      progress: goal.progress ?? 0,
      metric: goal.metric ?? "%",
      linkedTaskIds: goal.linkedTaskIds ?? [],
      linkedSessionIds: goal.linkedSessionIds ?? [],
      status: goal.status ?? "active",
      notes: goal.notes ?? ""
    };
    set((state) => ({ goals: [created, ...state.goals] }));
    await persistState(get());
  },

  updateGoal: async (id, patch) => {
    set((state) => ({
      goals: state.goals.map((goal) => (goal.id === id ? { ...goal, ...patch, updatedAt: nowIso() } : goal))
    }));
    await persistState(get());
  },

  replaceAllData: async (snapshot) => {
    set({ ...applySnapshot(snapshot) });
    await persistState(get());
  },

  resetAllData: async () => {
    const current = get().settings;
    const settings = {
      ...defaultSettings(),
      themeMode: current.themeMode,
      palette: current.palette,
      density: current.density,
      cardShape: current.cardShape,
      initialView: current.initialView,
      dateFormat: current.dateFormat,
      profile: current.profile
    };
    const snapshot = createEmptySnapshot();
    await db.vault.clear();
    await db.settings.put(settings);
    await writeSnapshotToDb(snapshot);
    sessionPassphrase = undefined;
    set({ settings, locked: false, ...applySnapshot(snapshot) });
  },

  setTimer: (timer) => set((state) => ({ timer: { ...state.timer, ...timer } }))
}));
