import Dexie, { type Table } from "dexie";
import type {
  AppNotification,
  Attachment,
  CalendarEvent,
  DashboardWidget,
  Exam,
  Goal,
  GroupActivity,
  GroupInvite,
  GroupResource,
  Note,
  Preferences,
  Reminder,
  StudyGroup,
  StudySession,
  StudySnapshot,
  StudyTopic,
  Subject,
  Tag,
  Task,
  UserSettings,
  VaultRecord
} from "../types";
import type { BarbCourse, BarbTeacher, UniversitySyncLog } from "./university/types";
import { COLLECTIONS, type CollectionKey, type SyncableEntity } from "./collections";

export interface BarbCourseRow extends BarbCourse {
  _key: string;
}

export interface BarbTeacherRow extends BarbTeacher {
  _key: string;
}

/** Coda locale delle modifiche da inviare al cloud (solo chiavi: il payload si legge dallo stato). */
export interface SyncOutboxRow {
  key: string; // `${entityType}:${entityId}`
  collection: CollectionKey;
  entityType: string;
  entityId: string;
  deleted: boolean;
  deletedAt?: string;
  queuedAt: number;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

const V1_STORES = {
  settings: "id",
  vault: "id, updatedAt",
  subjects: "id, updatedAt, archived, status, semester",
  exams: "id, date, subjectId, status",
  events: "id, start, end, category, subjectId, status, priority",
  tasks: "id, dueDate, subjectId, status, priority, importance",
  sessions: "id, start, subjectId, status, template",
  topics: "id, subjectId, nextReviewDate, difficulty",
  attachments: "id, addedAt, linkedEntityType, linkedEntityId, mimeType",
  goals: "id, deadline, category, status",
  notes: "id, linkedEntityType, linkedEntityId",
  tags: "id, label",
  reminders: "id, remindAt, done, linkedEntityType",
  widgets: "id, type, order, visible"
};

class StudyOSDatabase extends Dexie {
  settings!: Table<UserSettings, string>;
  vault!: Table<VaultRecord, string>;
  subjects!: Table<Subject, string>;
  exams!: Table<Exam, string>;
  events!: Table<CalendarEvent, string>;
  tasks!: Table<Task, string>;
  sessions!: Table<StudySession, string>;
  topics!: Table<StudyTopic, string>;
  attachments!: Table<Attachment, string>;
  goals!: Table<Goal, string>;
  notes!: Table<Note, string>;
  tags!: Table<Tag, string>;
  reminders!: Table<Reminder, string>;
  widgets!: Table<DashboardWidget, string>;
  preferences!: Table<Preferences, string>;
  notifications!: Table<AppNotification, string>;
  studyGroups!: Table<StudyGroup, string>;
  groupInvites!: Table<GroupInvite, string>;
  groupResources!: Table<GroupResource, string>;
  groupActivities!: Table<GroupActivity, string>;
  barbCourses!: Table<BarbCourseRow, string>;
  barbTeachers!: Table<BarbTeacherRow, string>;
  barbSyncLogs!: Table<UniversitySyncLog, string>;
  syncOutbox!: Table<SyncOutboxRow, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super("studyos-local-db");

    this.version(1).stores(V1_STORES);

    // v2: University Data Layer (BARB prima implementazione). Non tocca le tabelle v1.
    this.version(2).stores({
      ...V1_STORES,
      barbCourses: "_key, semester, character, year",
      barbTeachers: "_key",
      barbSyncLogs: "id, startedAt, scope"
    });

    // v3: cloud sync per-entità (outbox + meta cursori/flag). Tabelle precedenti invariate.
    this.version(3).stores({
      syncOutbox: "key, queuedAt, collection",
      meta: "key"
    });

    // v4: preferenze personali sincronizzate (nome, obiettivo settimanale, CFU del corso).
    this.version(4).stores({
      preferences: "id"
    });

    // v5: notifiche account + gruppi collaborativi. Tabelle precedenti invariate.
    this.version(5).stores({
      notifications: "id, updatedAt, kind, readAt",
      studyGroups: "id, updatedAt, inviteCode",
      groupInvites: "id, updatedAt, groupId, status, code",
      groupResources: "id, updatedAt, groupId, pinned",
      groupActivities: "id, updatedAt, groupId"
    });
  }
}

export const db = new StudyOSDatabase();

export const collectionTable = (key: CollectionKey) =>
  db[key] as unknown as Table<SyncableEntity, string>;

export const dataTables = COLLECTIONS.map((key) => collectionTable(key));

export const clearDataTables = async () => {
  await db.transaction("rw", dataTables, async () => {
    await Promise.all(dataTables.map((table) => table.clear()));
  });
};

export const readSnapshotFromDb = async (): Promise<StudySnapshot> => {
  const entries = await db.transaction("r", dataTables, () =>
    Promise.all(COLLECTIONS.map(async (key) => [key, await collectionTable(key).toArray()] as const))
  );
  const snapshot = Object.fromEntries(entries) as unknown as StudySnapshot;
  snapshot.widgets = [...snapshot.widgets].sort((a, b) => a.order - b.order);
  return { ...snapshot, version: 1, exportedAt: new Date().toISOString() };
};

export const writeSnapshotToDb = async (snapshot: StudySnapshot) => {
  await db.transaction("rw", dataTables, async () => {
    await Promise.all(dataTables.map((table) => table.clear()));
    await Promise.all(
      COLLECTIONS.map((key) => collectionTable(key).bulkPut((snapshot[key] ?? []) as unknown as SyncableEntity[]))
    );
  });
};

export const getMeta = async <T,>(key: string): Promise<T | undefined> =>
  (await db.meta.get(key))?.value as T | undefined;

export const setMeta = async (key: string, value: unknown) => {
  await db.meta.put({ key, value });
};

export const deleteMeta = async (key: string) => {
  await db.meta.delete(key);
};
