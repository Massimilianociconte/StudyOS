import Dexie, { type Table } from "dexie";
import type {
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
  UserSettings,
  VaultRecord
} from "../types";

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

  constructor() {
    super("studyos-local-db");

    this.version(1).stores({
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
    });
  }
}

export const db = new StudyOSDatabase();

export const dataTables = [
  db.subjects,
  db.exams,
  db.events,
  db.tasks,
  db.sessions,
  db.topics,
  db.attachments,
  db.goals,
  db.notes,
  db.tags,
  db.reminders,
  db.widgets
] as const;

export const clearDataTables = async () => {
  await db.transaction("rw", dataTables, async () => {
    await Promise.all(dataTables.map((table) => table.clear()));
  });
};

export const readSnapshotFromDb = async (): Promise<StudySnapshot> => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  subjects: await db.subjects.toArray(),
  exams: await db.exams.toArray(),
  events: await db.events.toArray(),
  tasks: await db.tasks.toArray(),
  sessions: await db.sessions.toArray(),
  topics: await db.topics.toArray(),
  attachments: await db.attachments.toArray(),
  goals: await db.goals.toArray(),
  notes: await db.notes.toArray(),
  tags: await db.tags.toArray(),
  reminders: await db.reminders.toArray(),
  widgets: await db.widgets.orderBy("order").toArray()
});

export const writeSnapshotToDb = async (snapshot: StudySnapshot) => {
  await db.transaction("rw", dataTables, async () => {
    await Promise.all(dataTables.map((table) => table.clear()));
    await Promise.all([
      db.subjects.bulkPut(snapshot.subjects),
      db.exams.bulkPut(snapshot.exams),
      db.events.bulkPut(snapshot.events),
      db.tasks.bulkPut(snapshot.tasks),
      db.sessions.bulkPut(snapshot.sessions),
      db.topics.bulkPut(snapshot.topics),
      db.attachments.bulkPut(snapshot.attachments),
      db.goals.bulkPut(snapshot.goals),
      db.notes.bulkPut(snapshot.notes),
      db.tags.bulkPut(snapshot.tags),
      db.reminders.bulkPut(snapshot.reminders),
      db.widgets.bulkPut(snapshot.widgets)
    ]);
  });
};
