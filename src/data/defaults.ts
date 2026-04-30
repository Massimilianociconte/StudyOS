import type { StudySnapshot, UserSettings } from "../types";
import { nowIso } from "../lib/id";

export const defaultSettings = (): UserSettings => ({
  id: "settings",
  themeMode: "dark",
  palette: "aurora",
  density: "comfortable",
  cardShape: "soft",
  initialView: "dashboard",
  dateFormat: "dd/MM/yyyy",
  dashboardLayout: [
    "today",
    "study",
    "deadlines",
    "exams",
    "weekly-progress",
    "streak",
    "subjects",
    "materials",
    "suggestion"
  ],
  profile: {
    displayName: "",
    avatarDataUrl: ""
  },
  security: {
    mode: "standard",
    backupEncryptionDefault: true
  },
  updatedAt: nowIso()
});

export const createEmptySnapshot = (): StudySnapshot => ({
  version: 1,
  exportedAt: nowIso(),
  subjects: [],
  exams: [],
  events: [],
  tasks: [],
  sessions: [],
  topics: [],
  attachments: [],
  goals: [],
  notes: [],
  tags: [],
  reminders: [],
  widgets: []
});
