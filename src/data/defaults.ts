import type { Preferences, StudySnapshot, UserSettings } from "../types";
import { nowIso } from "../lib/id";

/** 2: "Vista iniziale" può essere "ultima sezione aperta" (nuovo predefinito). */
export const SETTINGS_SCHEMA_VERSION = 2;

export const defaultSettings = (): UserSettings => ({
  id: "settings",
  themeMode: "dark",
  palette: "aurora",
  density: "comfortable",
  cardShape: "soft",
  initialView: "last",
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
  schemaVersion: SETTINGS_SCHEMA_VERSION,
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
  widgets: [],
  preferences: [],
  notifications: [],
  studyGroups: [],
  groupInvites: [],
  groupResources: [],
  groupActivities: []
});

export const PREFERENCES_ID = "main";

/** Valori usati finché l'account non ha salvato preferenze proprie (oggetto stabile per i selettori). */
export const DEFAULT_PREFERENCES: Preferences = Object.freeze({
  id: PREFERENCES_ID,
  createdAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
  archived: false,
  tags: [],
  displayName: "",
  avatarDataUrl: "",
  // Stesso valore che prima era fisso nel codice: chi non lo cambia non vede differenze.
  weeklyTargetMinutes: 18 * 60,
  degreeCfu: 120,
  showBarb: true,
  degreeProgram: "barb",
  sbThesisGrade: 27,
  barbThesisPoints: 7,
  abroad: false
}) as Preferences;
