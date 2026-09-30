import { create } from "zustand";
import type {
  AppView,
  Attachment,
  CalendarEvent,
  DashboardWidget,
  Exam,
  Goal,
  Note,
  Preferences,
  Reminder,
  StudySession,
  StudySnapshot,
  StudyTopic,
  Subject,
  Tag,
  Task,
  UserSettings
} from "../types";
import { DEFAULT_PREFERENCES, PREFERENCES_ID, SETTINGS_SCHEMA_VERSION, createEmptySnapshot, defaultSettings } from "../data/defaults";
import { clearUiState, readDeviceUiState, readTabUiState } from "../lib/uiState";
import { scheduleReview, type ReviewRating } from "../lib/review";
import { createId, nowIso } from "../lib/id";
import { collectionTable, dataTables, db, readSnapshotFromDb } from "../lib/db";
import { decryptWithKey, deriveVaultKey, encryptWithKey, makePassphraseVerifier, verifyPassphrase } from "../lib/crypto";
import { fileToDataUrl } from "../lib/files";
import { normalizeTaskPatch, taskStatusTransitionPatch } from "../lib/taskTimer";
import {
  COLLECTIONS,
  countEntities,
  normalizeCollections,
  pickCollections,
  timestampOf,
  type CollectionKey,
  type CollectionsState,
  type SyncableEntity
} from "../lib/collections";
import {
  clearAllLocalData,
  configurePersistence,
  markRemoteApplied,
  requestPersist,
  resetBaseline,
  runExclusive,
  setPersistenceSuspended,
  setVaultSession
} from "../lib/persistence";
import {
  defaultTimer,
  loadTimer,
  saveTimer,
  settleTimerState,
  startTimerState,
  toggleTimerState,
  type TimerMode,
  type TimerState
} from "../lib/studyTimer";

let sessionPassphrase: string | undefined;

export type { TimerState } from "../lib/studyTimer";

export interface RemoteChange {
  collection: CollectionKey;
  id: string;
  /** Entità remota da applicare; null = eliminazione (tombstone). */
  entity: SyncableEntity | null;
  /** Timestamp LWW remoto: se nel frattempo l'entità locale è più recente, la modifica è scartata. */
  stamp?: number;
  force?: boolean;
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
  preferences: Preferences[];
  timer: TimerState;
  error?: string;
  /** Ultimo errore di salvataggio su IndexedDB (undefined = tutto salvato). */
  persistError?: string;
  init: () => Promise<void>;
  unlockVault: (passphrase: string) => Promise<void>;
  lockVault: () => Promise<void>;
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
  /** Import in blocco (es. da .ics): gli eventi con lo stesso `sourceUid` vengono aggiornati. */
  importEvents: (events: Array<Partial<CalendarEvent> & Pick<CalendarEvent, "title" | "start" | "end">>) => Promise<{ added: number; updated: number }>;
  deleteEvent: (id: string) => Promise<void>;
  /** Crea una materia e ne restituisce l'id. */
  addSubject: (subject: Partial<Subject> & Pick<Subject, "name">) => Promise<string>;
  updateSubject: (id: string, patch: Partial<Subject>) => Promise<void>;
  addExam: (exam: Partial<Exam> & Pick<Exam, "subjectId" | "date">) => Promise<void>;
  updateExam: (id: string, patch: Partial<Exam>) => Promise<void>;
  deleteExam: (id: string) => Promise<void>;
  addSession: (session: Partial<StudySession> & Pick<StudySession, "title">) => Promise<void>;
  updateSession: (id: string, patch: Partial<StudySession>) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  /** Crea argomenti da ripassare; restituisce quanti sono stati aggiunti (i duplicati per materia vengono saltati). */
  addTopics: (topics: Array<Partial<StudyTopic> & Pick<StudyTopic, "title" | "subjectId">>) => Promise<number>;
  updateTopic: (id: string, patch: Partial<StudyTopic>) => Promise<void>;
  deleteTopic: (id: string) => Promise<void>;
  /** Registra un ripasso con la valutazione dello studente e pianifica il successivo. */
  reviewTopic: (id: string, rating: ReviewRating) => Promise<void>;
  /** Aggiorna le preferenze personali sincronizzate (entità unica "main"). */
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
  addAttachment: (file: File, link?: { type?: Attachment["linkedEntityType"]; id?: string }) => Promise<void>;
  addExternalAttachment: (url: string, name: string, description?: string) => Promise<void>;
  updateAttachment: (id: string, patch: Partial<Attachment>) => Promise<void>;
  deleteAttachment: (id: string) => Promise<void>;
  addGoal: (goal: Partial<Goal> & Pick<Goal, "title">) => Promise<void>;
  updateGoal: (id: string, patch: Partial<Goal>) => Promise<void>;
  /** Sostituisce tutti i dati (import backup completo). Le differenze vengono propagate al cloud. */
  replaceAllData: (snapshot: Partial<StudySnapshot>) => Promise<void>;
  /** Unisce i dati per id: vince la versione con updatedAt più recente (import backup parziale). */
  mergeData: (snapshot: Partial<StudySnapshot>) => Promise<{ added: number; updated: number }>;
  /** Applica modifiche arrivate dal cloud senza riaccodarle nell'outbox. */
  applyRemoteChanges: (changes: RemoteChange[]) => Promise<void>;
  /**
   * Reset del workspace. `propagate=false` svuota solo questo dispositivo (outbox inclusa);
   * `propagate=true` elimina le entità anche dal cloud tramite tombstone.
   */
  resetAllData: (options?: { propagate?: boolean }) => Promise<void>;
  retryPersist: () => Promise<void>;
  startStudyTimer: (mode: TimerMode) => void;
  toggleStudyTimer: () => void;
  resetStudyTimer: (mode?: TimerMode) => void;
  settleStudyTimer: () => void;
}

type StoreState = StudyState;

export type PreferencesPatch = Partial<
  Pick<
    Preferences,
    "displayName" | "avatarDataUrl" | "weeklyTargetMinutes" | "degreeCfu" | "showBarb" | "degreeProgram" | "sbThesisGrade" | "barbThesisPoints" | "abroad"
  >
>;

// Un'entità salvata da una versione precedente può non avere i campi nuovi: si completano con i
// predefiniti. La cache per riferimento mantiene l'oggetto stabile (selettori Zustand).
const completedPreferences = new WeakMap<Preferences, Preferences>();

/** Preferenze dell'account o valori predefiniti (oggetto stabile: sicuro nei selettori). */
export const selectPreferences = (state: Pick<CollectionsState, "preferences">): Preferences => {
  const stored = state.preferences.find((item) => item.id === PREFERENCES_ID);
  if (!stored) return DEFAULT_PREFERENCES;
  let complete = completedPreferences.get(stored);
  if (!complete) {
    complete = { ...DEFAULT_PREFERENCES, ...stored };
    completedPreferences.set(stored, complete);
  }
  return complete;
};

/**
 * Il vecchio profilo (nome e foto) viveva nelle impostazioni del dispositivo: restava lo stesso
 * anche cambiando account e non si sincronizzava. Alla prima apertura diventa un'entità
 * `preferences` sincronizzata; il campo locale viene svuotato.
 */
const migrateLegacyProfile = (collections: CollectionsState, settings: UserSettings) => {
  const legacy = settings.profile;
  if (collections.preferences.length || (!legacy?.displayName?.trim() && !legacy?.avatarDataUrl)) return null;
  const now = nowIso();
  const preferences: Preferences = {
    ...DEFAULT_PREFERENCES,
    tags: [],
    createdAt: now,
    updatedAt: now,
    displayName: legacy.displayName?.trim() ?? "",
    avatarDataUrl: legacy.avatarDataUrl ?? ""
  };
  return { preferences: [preferences], settings: { ...settings, profile: { displayName: "", avatarDataUrl: "" }, updatedAt: now } };
};

export const snapshotFromState = (state: CollectionsState): StudySnapshot => ({
  version: 1,
  exportedAt: nowIso(),
  ...pickCollections(state)
});

// Record (non array) per avere un errore di compilazione se si aggiunge una vista senza elencarla.
const APP_VIEWS: Record<AppView, true> = {
  dashboard: true,
  calendar: true,
  tasks: true,
  study: true,
  subjects: true,
  exams: true,
  career: true,
  materials: true,
  goals: true,
  stats: true,
  barb: true,
  settings: true
};

const isAppView = (value: unknown): value is AppView => typeof value === "string" && Object.hasOwn(APP_VIEWS, value);

/**
 * Sezione con cui aprire l'app: dopo un refresh (anche forzato) quella in cui era la scheda;
 * in una scheda nuova la "Vista iniziale" delle impostazioni ("last" = ultima usata qui).
 */
const startView = (settings: UserSettings): AppView => {
  const tabView = readTabUiState("view");
  if (isAppView(tabView)) return tabView;
  if (settings.initialView === "last") {
    const lastView = readDeviceUiState("view");
    return isAppView(lastView) ? lastView : "dashboard";
  }
  return isAppView(settings.initialView) ? settings.initialView : "dashboard";
};

/** Migrazioni una tantum delle impostazioni locali (lo schemaVersion salvato decide). */
const upgradeSettings = (saved: UserSettings): UserSettings => {
  const settings = { ...defaultSettings(), ...saved };
  if ((saved.schemaVersion ?? 1) < 2) {
    // Prima "Vista iniziale" era solo fissa, con "dashboard" predefinita: chi non l'aveva cambiata
    // riapre ora l'ultima sezione usata. Una scelta diversa dalla dashboard resta com'era.
    if (settings.initialView === "dashboard") settings.initialView = "last";
  }
  settings.schemaVersion = SETTINGS_SCHEMA_VERSION;
  return settings;
};

const applySnapshot = (snapshot: Partial<StudySnapshot>): CollectionsState => normalizeCollections(snapshot);

const taskDefaults = (task: Partial<Task> & Pick<Task, "title">): Task => {
  const createdAt = nowIso();
  return {
    id: createId("task"),
    createdAt,
    updatedAt: createdAt,
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
    completedAt: task.completedAt ?? (task.status === "done" ? createdAt : undefined),
    timerStartedAt: task.timerStartedAt,
    timerAccumulatedSeconds: task.timerAccumulatedSeconds,
    timerLastReminderAt: task.timerLastReminderAt,
    energy: task.energy ?? "medium",
    difficulty: task.difficulty ?? 2,
    importance: task.importance ?? 3,
    cover: task.cover
  };
};

/**
 * Ripristino completo: le entità uguali a quelle attuali restano invariate (nessuna scrittura),
 * le altre ricevono updatedAt = adesso. Senza questo, con la sync attiva il server (LWW)
 * rifiuterebbe le versioni del backup, più vecchie, e il pull le riporterebbe allo stato cloud.
 */
const restoredCollections = (incoming: CollectionsState, current: CollectionsState): CollectionsState => {
  const now = nowIso();
  const result = {} as Record<CollectionKey, SyncableEntity[]>;
  for (const key of COLLECTIONS) {
    const existing = new Map((current[key] as unknown as SyncableEntity[]).map((item) => [item.id, item]));
    result[key] = (incoming[key] as unknown as SyncableEntity[]).map((item) => {
      const local = existing.get(item.id);
      if (local && JSON.stringify(local) === JSON.stringify(item)) return local;
      return { ...item, updatedAt: now };
    });
  }
  return result as unknown as CollectionsState;
};

const errorText = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

/** Persiste senza propagare l'errore ai chiamanti UI: l'errore resta visibile in `persistError`. */
const commit = async () => {
  try {
    await requestPersist();
  } catch {
    // già esposto tramite persistError; il prossimo flush ritenta con il diff completo
  }
};

const setTimerState = (set: (partial: Partial<StoreState>) => void, timer: TimerState) => {
  saveTimer(timer);
  set({ timer });
};

export const useStudyStore = create<StudyState>((set, get) => {
  configurePersistence({
    getState: () => {
      const state = get();
      return { collections: pickCollections(state), settings: state.settings, locked: state.locked || state.loading };
    },
    onError: (message) => {
      if (get().persistError !== message) set({ persistError: message });
    }
  });

  const detachLinked = (type: string, id: string) =>
    <T extends { linkedEntityType?: string; linkedEntityId?: string; updatedAt: string }>(item: T) =>
      item.linkedEntityType === type && item.linkedEntityId === id
        ? { ...item, linkedEntityType: undefined, linkedEntityId: undefined, updatedAt: nowIso() }
        : item;

  const rollbackCollections = (before: CollectionsState, applied: Partial<CollectionsState>) => {
    const rollback: Partial<CollectionsState> = {};
    const current = get();
    for (const key of COLLECTIONS) {
      if (applied[key] && current[key] === applied[key]) {
        (rollback as Record<string, unknown>)[key] = before[key];
      }
    }
    set(rollback as Partial<StoreState>);
  };

  return {
    loading: true,
    locked: false,
    activeView: "dashboard",
    settings: defaultSettings(),
    ...applySnapshot(createEmptySnapshot()),
    timer: typeof window === "undefined" ? defaultTimer() : loadTimer(),

    init: async () => {
      set({ loading: true, error: undefined });
      try {
        const savedSettings = await db.settings.get("settings");
        const settings = savedSettings ? upgradeSettings(savedSettings) : defaultSettings();
        if (!savedSettings || savedSettings.schemaVersion !== settings.schemaVersion) {
          // Impostazioni mancanti NON implicano workspace vuoto: i dati esistenti restano.
          await db.settings.put(settings);
        }
        const vault = await db.vault.get("main");

        if (settings.security.mode === "vault" && vault) {
          setPersistenceSuspended(true);
          setVaultSession(true, null);
          resetBaseline(applySnapshot(createEmptySnapshot()), settings);
          set({
            settings,
            activeView: startView(settings),
            locked: true,
            loading: false,
            ...applySnapshot(createEmptySnapshot())
          });
          return;
        }

        // Nota: la vecchia "pulizia mock legacy" cancellava a ogni avvio materie/task/tag
        // dell'utente con nomi comuni (es. "Economia", tag "urgente") e tutti i widget. Rimossa.
        const snapshot = applySnapshot(await readSnapshotFromDb());

        setVaultSession(false, null);
        setPersistenceSuspended(false);
        resetBaseline(snapshot, settings);
        set({
          settings,
          activeView: startView(settings),
          locked: false,
          loading: false,
          ...snapshot
        });
        const migrated = migrateLegacyProfile(snapshot, settings);
        if (migrated) {
          set(migrated);
          await commit();
        }
      } catch (error) {
        set({ loading: false, error: errorText(error, "Errore di avvio.") });
      }
    },

    unlockVault: async (passphrase) => {
      const settings = get().settings;
      const vault = await db.vault.get("main");
      if (!vault) throw new Error("Vault locale non trovato.");
      // Una sola derivazione PBKDF2: la chiave serve sia a decifrare sia ai salvataggi successivi.
      const key = await deriveVaultKey(passphrase, vault.salt, vault.iterations);
      let raw: string;
      try {
        raw = await decryptWithKey(vault, key);
      } catch {
        if (settings.security.verifierSalt && settings.security.verifierHash) {
          const ok = await verifyPassphrase(passphrase, settings.security.verifierSalt, settings.security.verifierHash);
          if (ok) throw new Error("Vault corrotto: la passphrase è corretta ma i dati non sono decifrabili.");
        }
        throw new Error("Passphrase non valida.");
      }
      const snapshot = applySnapshot(JSON.parse(raw) as StudySnapshot);
      sessionPassphrase = passphrase;
      setVaultSession(true, key);
      resetBaseline(snapshot, settings);
      setPersistenceSuspended(false);
      set({ locked: false, ...snapshot, activeView: startView(settings), error: undefined });
      const migrated = migrateLegacyProfile(snapshot, settings);
      if (migrated) {
        set(migrated);
        await commit();
      }
    },

    lockVault: async () => {
      // Salva prima eventuali modifiche in coda: dopo il lock lo stato in memoria viene svuotato.
      await requestPersist();
      setPersistenceSuspended(true);
      setVaultSession(true, null);
      sessionPassphrase = undefined;
      const empty = applySnapshot(createEmptySnapshot());
      resetBaseline(empty, get().settings);
      set({ locked: true, ...empty, activeView: "dashboard" });
    },

    enableVault: async (passphrase, hint) => {
      await commit();
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
      const key = await deriveVaultKey(passphrase);
      const collections = pickCollections(get());
      await runExclusive(async () => {
        const record = await encryptWithKey(JSON.stringify(snapshotFromState(collections)), key);
        await db.transaction("rw", [db.settings, db.vault, ...COLLECTIONS.map((c) => db[c])], async () => {
          await db.settings.put(settings);
          await db.vault.put(record);
          await Promise.all(COLLECTIONS.map((c) => db[c].clear()));
        });
      });
      sessionPassphrase = passphrase;
      setVaultSession(true, key);
      resetBaseline(collections, settings);
      set({ settings, locked: false });
    },

    disableVault: async (passphrase) => {
      const currentPassphrase = sessionPassphrase ?? passphrase;
      if (!currentPassphrase) throw new Error("Serve la passphrase per disattivare il vault.");

      await commit();
      let collections = pickCollections(get());
      if (get().locked) {
        const vault = await db.vault.get("main");
        if (!vault) throw new Error("Vault locale non trovato.");
        const key = await deriveVaultKey(currentPassphrase, vault.salt, vault.iterations);
        try {
          collections = applySnapshot(JSON.parse(await decryptWithKey(vault, key)) as StudySnapshot);
        } catch {
          throw new Error("Passphrase non valida.");
        }
      }

      const settings: UserSettings = {
        ...get().settings,
        security: {
          mode: "standard",
          backupEncryptionDefault: true
        },
        updatedAt: nowIso()
      };
      await runExclusive(async () => {
        await db.transaction("rw", [db.settings, db.vault, ...dataTables], async () => {
          await db.settings.put(settings);
          for (const key of COLLECTIONS) {
            const table = collectionTable(key);
            await table.clear();
            const items = collections[key] as unknown as SyncableEntity[];
            if (items.length) await table.bulkPut(items);
          }
          await db.vault.clear();
        });
      });
      sessionPassphrase = undefined;
      setVaultSession(false, null);
      resetBaseline(collections, settings);
      setPersistenceSuspended(false);
      set({ settings, locked: false, ...collections });
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
      await commit();
    },

    addTask: async (task) => {
      set((state) => ({ tasks: [taskDefaults(task), ...state.tasks] }));
      await commit();
    },

    updateTask: async (id, patch) => {
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === id ? { ...task, ...normalizeTaskPatch(task, patch), updatedAt: nowIso() } : task
        )
      }));
      await commit();
    },

    toggleTask: async (id) => {
      set((state) => ({
        tasks: state.tasks.map((task) =>
          task.id === id
            ? { ...task, ...taskStatusTransitionPatch(task, task.status === "done" ? "todo" : "done"), updatedAt: nowIso() }
            : task
        )
      }));
      await commit();
    },

    deleteTask: async (id) => {
      const detach = detachLinked("task", id);
      set((state) => ({
        tasks: state.tasks.filter((task) => task.id !== id),
        goals: state.goals.map((goal) =>
          goal.linkedTaskIds.includes(id)
            ? { ...goal, linkedTaskIds: goal.linkedTaskIds.filter((taskId) => taskId !== id), updatedAt: nowIso() }
            : goal
        ),
        attachments: state.attachments.map(detach),
        notes: state.notes.map(detach),
        reminders: state.reminders.map(detach)
      }));
      await commit();
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
        allDay: event.allDay,
        recurrence: event.recurrence ?? "none",
        recurrenceUntil: event.recurrenceUntil,
        status: event.status ?? "planned",
        checklist: event.checklist ?? [],
        attachmentIds: event.attachmentIds ?? [],
        cover: event.cover,
        notes: event.notes ?? "",
        links: event.links ?? [],
        goalId: event.goalId
      };
      set((state) => ({ events: [created, ...state.events] }));
      await commit();
    },

    importEvents: async (incoming) => {
      const now = nowIso();
      const bySource = new Map(get().events.filter((event) => event.sourceUid).map((event) => [event.sourceUid as string, event]));
      const updates = new Map<string, CalendarEvent>();
      const created: CalendarEvent[] = [];
      const seen = new Set<string>();
      for (const item of incoming) {
        if (item.sourceUid) {
          if (seen.has(item.sourceUid)) continue; // UID ripetuto nello stesso file
          seen.add(item.sourceUid);
        }
        const existing = item.sourceUid ? bySource.get(item.sourceUid) : undefined;
        if (existing) {
          updates.set(existing.id, {
            ...existing,
            title: item.title,
            description: item.description ?? existing.description,
            start: item.start,
            end: item.end,
            allDay: item.allDay ?? existing.allDay,
            recurrence: item.recurrence ?? existing.recurrence,
            recurrenceUntil: item.recurrenceUntil,
            archived: false,
            updatedAt: now
          });
          continue;
        }
        created.push({
          id: createId("event"),
          createdAt: now,
          updatedAt: now,
          archived: false,
          tags: item.tags ?? [],
          title: item.title,
          description: item.description ?? "",
          category: item.category ?? "lesson",
          subjectId: item.subjectId,
          color: item.color ?? "#7CF7C8",
          priority: item.priority ?? "medium",
          start: item.start,
          end: item.end,
          allDay: item.allDay,
          recurrence: item.recurrence ?? "none",
          recurrenceUntil: item.recurrenceUntil,
          status: "planned",
          checklist: [],
          attachmentIds: [],
          notes: "",
          links: [],
          sourceUid: item.sourceUid
        });
      }
      if (!created.length && !updates.size) return { added: 0, updated: 0 };
      set((state) => ({ events: [...created, ...state.events.map((event) => updates.get(event.id) ?? event)] }));
      await commit();
      return { added: created.length, updated: updates.size };
    },

    updateEvent: async (id, patch) => {
      set((state) => ({
        events: state.events.map((event) => (event.id === id ? { ...event, ...patch, updatedAt: nowIso() } : event))
      }));
      await commit();
    },

    deleteEvent: async (id) => {
      const detach = detachLinked("calendarEvent", id);
      set((state) => ({
        events: state.events.filter((event) => event.id !== id),
        attachments: state.attachments.map(detach),
        notes: state.notes.map(detach),
        reminders: state.reminders.map(detach)
      }));
      await commit();
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
      await commit();
      return created.id;
    },

    updateSubject: async (id, patch) => {
      set((state) => ({
        subjects: state.subjects.map((subject) =>
          subject.id === id ? { ...subject, ...patch, updatedAt: nowIso() } : subject
        )
      }));
      await commit();
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
        cover: exam.cover,
        grade: exam.grade,
        honors: exam.honors,
        passFail: exam.passFail
      };
      set((state) => ({ exams: [created, ...state.exams] }));
      await commit();
    },

    updateExam: async (id, patch) => {
      set((state) => ({
        exams: state.exams.map((exam) => (exam.id === id ? { ...exam, ...patch, updatedAt: nowIso() } : exam))
      }));
      await commit();
    },

    deleteExam: async (id) => {
      const detach = detachLinked("exam", id);
      set((state) => ({
        exams: state.exams.filter((exam) => exam.id !== id),
        attachments: state.attachments.map(detach),
        notes: state.notes.map(detach),
        reminders: state.reminders.map(detach)
      }));
      await commit();
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
      await commit();
    },

    updateSession: async (id, patch) => {
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === id ? { ...session, ...patch, updatedAt: nowIso() } : session
        )
      }));
      await commit();
    },

    deleteSession: async (id) => {
      const detach = detachLinked("studySession", id);
      set((state) => ({
        sessions: state.sessions.filter((session) => session.id !== id),
        goals: state.goals.map((goal) =>
          goal.linkedSessionIds.includes(id)
            ? { ...goal, linkedSessionIds: goal.linkedSessionIds.filter((sessionId) => sessionId !== id), updatedAt: nowIso() }
            : goal
        ),
        attachments: state.attachments.map(detach),
        notes: state.notes.map(detach),
        reminders: state.reminders.map(detach)
      }));
      await commit();
    },

    addTopics: async (items) => {
      const existing = new Set(get().topics.map((topic) => `${topic.subjectId}:${topic.title.trim().toLowerCase()}`));
      const now = nowIso();
      const created: StudyTopic[] = [];
      for (const item of items) {
        const title = item.title.trim();
        const key = `${item.subjectId}:${title.toLowerCase()}`;
        if (!title || existing.has(key)) continue;
        existing.add(key);
        created.push({
          id: createId("topic"),
          createdAt: now,
          updatedAt: now,
          archived: false,
          tags: item.tags ?? [],
          subjectId: item.subjectId,
          title,
          firstStudiedAt: item.firstStudiedAt ?? now,
          comprehension: item.comprehension ?? 3,
          memorization: item.memorization ?? 3,
          difficulty: item.difficulty ?? 3,
          // Un argomento nuovo è da ripassare subito: entra nella coda di oggi.
          nextReviewDate: item.nextReviewDate ?? now,
          completedReviews: item.completedReviews ?? 0,
          notes: item.notes ?? "",
          attachmentIds: item.attachmentIds ?? [],
          questions: item.questions ?? [],
          intervalDays: item.intervalDays,
          ease: item.ease
        });
      }
      if (!created.length) return 0;
      set((state) => ({ topics: [...created, ...state.topics] }));
      await commit();
      return created.length;
    },

    updateTopic: async (id, patch) => {
      set((state) => ({
        topics: state.topics.map((topic) => (topic.id === id ? { ...topic, ...patch, updatedAt: nowIso() } : topic))
      }));
      await commit();
    },

    deleteTopic: async (id) => {
      const detach = detachLinked("studyTopic", id);
      set((state) => ({
        topics: state.topics.filter((topic) => topic.id !== id),
        attachments: state.attachments.map(detach),
        notes: state.notes.map(detach),
        reminders: state.reminders.map(detach)
      }));
      await commit();
    },

    reviewTopic: async (id, rating) => {
      set((state) => ({
        topics: state.topics.map((topic) =>
          topic.id === id ? { ...topic, ...scheduleReview(topic, rating), updatedAt: nowIso() } : topic
        )
      }));
      await commit();
    },

    updatePreferences: async (patch) => {
      const now = nowIso();
      set((state) => {
        const current = state.preferences.find((item) => item.id === PREFERENCES_ID);
        const next: Preferences = current
          ? { ...current, ...patch, updatedAt: now }
          : { ...DEFAULT_PREFERENCES, tags: [], createdAt: now, updatedAt: now, ...patch };
        return { preferences: [next, ...state.preferences.filter((item) => item.id !== PREFERENCES_ID)] };
      });
      await commit();
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
      await commit();
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
      await commit();
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
      await commit();
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
      await commit();
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
      await commit();
    },

    updateGoal: async (id, patch) => {
      set((state) => ({
        goals: state.goals.map((goal) => (goal.id === id ? { ...goal, ...patch, updatedAt: nowIso() } : goal))
      }));
      await commit();
    },

    replaceAllData: async (snapshot) => {
      const previous = pickCollections(get());
      const incoming = restoredCollections(applySnapshot(snapshot), previous);
      set(incoming);
      try {
        await requestPersist();
      } catch (error) {
        rollbackCollections(previous, incoming);
        throw error;
      }
    },

    mergeData: async (snapshot) => {
      const incoming = applySnapshot(snapshot);
      let added = 0;
      let updated = 0;
      const next: Partial<CollectionsState> = {};
      const state = get();
      for (const key of COLLECTIONS) {
        const items = incoming[key] as unknown as SyncableEntity[];
        if (!items.length) continue;
        const current = state[key] as unknown as SyncableEntity[];
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of items) {
          const existing = byId.get(item.id);
          if (!existing) {
            // Un elemento ripristinato è una nuova modifica: altrimenti un tombstone cloud più
            // recente lo eliminerebbe di nuovo alla prossima sync.
            byId.set(item.id, { ...item, updatedAt: nowIso() });
            added += 1;
          } else if (timestampOf(item.updatedAt) > timestampOf(existing.updatedAt)) {
            byId.set(item.id, item);
            updated += 1;
          }
        }
        (next as Record<string, unknown>)[key] = [...byId.values()];
      }
      set(next as Partial<StoreState>);
      try {
        await requestPersist();
      } catch (error) {
        rollbackCollections(pickCollections(state), next);
        throw error;
      }
      return { added, updated };
    },

    applyRemoteChanges: async (changes) => {
      if (!changes.length) return;
      // Mai ignorare in silenzio: il chiamante avanzerebbe il cursore cloud perdendo le modifiche.
      if (get().locked || get().loading) throw new Error("Workspace bloccato: modifiche cloud non applicate.");
      const grouped = new Map<CollectionKey, RemoteChange[]>();
      for (const change of changes) {
        const list = grouped.get(change.collection) ?? [];
        list.push(change);
        grouped.set(change.collection, list);
      }
      const patch: Partial<CollectionsState> = {};
      const state = get();
      for (const [key, list] of grouped) {
        const byId = new Map((state[key] as unknown as SyncableEntity[]).map((item) => [item.id, item]));
        for (const change of list) {
          const current = byId.get(change.id);
          if (!change.force && current && change.stamp !== undefined && timestampOf(current.updatedAt) > change.stamp) {
            continue; // modificata localmente dopo il calcolo del merge: vince la versione locale
          }
          if (change.entity) byId.set(change.id, change.entity);
          else byId.delete(change.id);
          markRemoteApplied(key, change.id, change.entity);
        }
        (patch as Record<string, unknown>)[key] = [...byId.values()];
      }
      set(patch as Partial<StoreState>);
      // Il cursore cloud può avanzare solo dopo una scrittura locale confermata.
      await requestPersist();
    },

    resetAllData: async (options) => {
      const current = get().settings;
      const settings: UserSettings = {
        ...defaultSettings(),
        themeMode: current.themeMode,
        palette: current.palette,
        density: current.density,
        cardShape: current.cardShape,
        initialView: current.initialView,
        dateFormat: current.dateFormat
      };
      const empty = applySnapshot(createEmptySnapshot());

      if (options?.propagate) {
        // Le eliminazioni passano dal diff -> tombstone nell'outbox -> cloud.
        await commit();
        set({ ...empty });
        await requestPersist();
        await runExclusive(async () => {
          await db.vault.clear();
          await db.settings.put(settings);
        });
      } else {
        await commit();
        await runExclusive(async () => {
          await clearAllLocalData();
          await db.settings.put(settings);
        });
        resetBaseline(empty, settings);
      }
      sessionPassphrase = undefined;
      setVaultSession(false, null);
      setPersistenceSuspended(false);
      resetBaseline(empty, settings);
      // Filtri ed elementi aperti puntavano ai dati appena cancellati.
      clearUiState();
      set({ settings, locked: false, ...empty });
    },

    retryPersist: async () => {
      await commit();
    },

    startStudyTimer: (mode) => setTimerState(set, startTimerState(mode)),
    toggleStudyTimer: () => setTimerState(set, toggleTimerState(get().timer)),
    resetStudyTimer: (mode) => setTimerState(set, defaultTimer(mode ?? get().timer.mode)),
    settleStudyTimer: () => {
      const settled = settleTimerState(get().timer);
      if (settled !== get().timer) setTimerState(set, settled);
    }
  };
});

export const hasAnyLocalData = (state: CollectionsState) => countEntities(state) > 0;
