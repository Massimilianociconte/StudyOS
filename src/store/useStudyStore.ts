import { create } from "zustand";
import type { BarbExamSession } from "../lib/university/examTypes";
import { barbReminderEventId, preserveBarbReminderDates } from "../lib/barbReminders";
import {
  applyEditPlan,
  applyRepeatFields,
  changesRepeat,
  isOccurrenceRow,
  planDelete,
  planEdit,
  sanitizeOccasion,
  sanitizeReminders,
  unlinkEvents,
  type OccurrenceScope
} from "../lib/repeat";
import { deviceTimeZone, isValidTimeZone } from "../lib/tz";
import type {
  AppNotification,
  AppView,
  Attachment,
  CalendarEvent,
  DashboardWidget,
  Exam,
  Goal,
  GroupActivity,
  GroupInvite,
  GroupMember,
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
  UserSettings
} from "../types";
import { DEFAULT_PREFERENCES, PREFERENCES_ID, SETTINGS_SCHEMA_VERSION, createEmptySnapshot, defaultSettings } from "../data/defaults";
import { clearUiState, readDeviceUiState, readTabUiState } from "../lib/uiState";
import { scheduleReview, type ReviewRating } from "../lib/review";
import { createId, nowIso } from "../lib/id";
import { makeGroupInviteCode } from "../lib/groups";
import { ShareUserError, isRestorableEntity, restoredPayload, restoredUpdatedAt, type RestoreVersion } from "../lib/sharing";
import { RESTORE_TEXT } from "../lib/labels";
import { collectionTable, dataTables, db, readSnapshotFromDb } from "../lib/db";
import { decryptWithKey, deriveVaultKey, encryptWithKey, makePassphraseVerifier, verifyPassphrase } from "../lib/crypto";
import { fileToDataUrl } from "../lib/files";
import { normalizeTaskPatch, taskStatusTransitionPatch } from "../lib/taskTimer";
import {
  COLLECTIONS,
  COLLECTION_BY_ENTITY_TYPE,
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
  advanceTimerState,
  defaultTimer,
  endTimerState,
  finishedSession,
  isTimerIdle,
  loadTimer,
  nextPhase,
  saveTimer,
  sessionFromBlock,
  skipBreakState,
  startCountdownState,
  startStopwatchState,
  startTimerState,
  syncTimerDurations,
  timerElapsedSeconds,
  timerUnsavedSeconds,
  toggleTimerState,
  type FinishedBlock,
  type TimerEvent,
  type TimerFinish,
  type TimerKind,
  type TimerMode,
  type TimerState
} from "../lib/studyTimer";
import { relinkSession, reviewedSessionTimes, sessionLinksOf, type SessionEdit, type SessionLinks } from "../lib/studySessions";
import { resolveTimerDurations } from "../lib/timerPrefs";
import type { TimerSettings } from "../types";
import { useSharedStore } from "./useSharedStore";

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

const isRestorableVersion = ({ entityType, payload, entityId }: RestoreVersion) =>
  Boolean(COLLECTION_BY_ENTITY_TYPE[entityType]) && typeof entityId === "string" && isRestorableEntity(entityType, payload, entityId);

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
  notifications: AppNotification[];
  studyGroups: StudyGroup[];
  groupInvites: GroupInvite[];
  groupResources: GroupResource[];
  groupActivities: GroupActivity[];
  timer: TimerState;
  /** Riepilogo aperto di un Timer o Cronometro finito (Salva / Scarta); si riapre dal timer. */
  timerReview: boolean;
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
  /** Importazione selettiva degli appelli pubblici: stesso UID = nessun nuovo evento. */
  importBarbExamSessions: (sessions: BarbExamSession[]) => Promise<{ added: number; skipped: number }>;
  deleteEvent: (id: string) => Promise<void>;
  /**
   * Modifica dall'occorrenza `originalDate` (YYYY-MM-DD nel fuso della serie) della serie `seriesId`:
   * "this" solo quella, "following" quella e le successive (la serie si divide), "all" tutta la serie.
   * `repeat` nella modifica = regola scelta (vuota = non si ripete più). Un solo salvataggio.
   */
  editOccurrence: (seriesId: string, originalDate: string, scope: OccurrenceScope, patch: Partial<CalendarEvent>) => Promise<void>;
  /**
   * Eliminazione con le stesse portate. "following" toglie sempre anche le serie nate da divisioni
   * che continuano dopo; `includeSplits` serve solo con "all" (tutta la famiglia, madre compresa).
   */
  deleteOccurrence: (seriesId: string, originalDate: string, scope: OccurrenceScope, options?: { includeSplits?: boolean }) => Promise<void>;
  /** Crea una materia e ne restituisce l'id. */
  addSubject: (subject: Partial<Subject> & Pick<Subject, "name">) => Promise<string>;
  updateSubject: (id: string, patch: Partial<Subject>) => Promise<void>;
  /**
   * Elimina per sempre una materia con i suoi esami (voti compresi) e argomenti; attività, eventi,
   * sessioni e widget restano senza materia, materiali/note/promemoria collegati si staccano.
   */
  deleteSubject: (id: string) => Promise<void>;
  addExam: (exam: Partial<Exam> & Pick<Exam, "subjectId" | "date">) => Promise<void>;
  updateExam: (id: string, patch: Partial<Exam>) => Promise<void>;
  deleteExam: (id: string) => Promise<void>;
  /** Con `id` (modulo "Aggiungi studio fatto") una sessione già presente non si aggiunge di nuovo. */
  addSession: (session: Partial<StudySession> & Pick<StudySession, "title">) => Promise<void>;
  updateSession: (id: string, patch: Partial<StudySession>) => Promise<void>;
  /** Restituisce i collegamenti tolti (obiettivi, file, note, promemoria) per "Annulla". */
  deleteSession: (id: string) => Promise<SessionLinks>;
  /** Annulla dopo Elimina: la sessione torna (updatedAt nuovo, vince sulla sync) con i suoi collegamenti, senza doppioni. */
  restoreSession: (session: StudySession, links?: SessionLinks) => Promise<void>;
  /** Crea argomenti da ripassare; restituisce quanti sono stati aggiunti (i duplicati per materia vengono saltati). */
  addTopics: (topics: Array<Partial<StudyTopic> & Pick<StudyTopic, "title" | "subjectId">>) => Promise<number>;
  updateTopic: (id: string, patch: Partial<StudyTopic>) => Promise<void>;
  deleteTopic: (id: string) => Promise<void>;
  /** Registra un ripasso con la valutazione dello studente e pianifica il successivo. */
  reviewTopic: (id: string, rating: ReviewRating) => Promise<void>;
  /** Aggiorna le preferenze personali sincronizzate (entità unica "main"). */
  updatePreferences: (patch: PreferencesPatch) => Promise<void>;
  /** Crea una notifica dell'account (max 200 conservate, le più vecchie vengono potate). */
  addNotification: (notification: Partial<AppNotification> & Pick<AppNotification, "kind" | "title">) => Promise<string>;
  /**
   * Ripristina una versione salvata nella cronologia come nuova versione locale (poi sync normale).
   * Solo elementi dei tipi che la condivisione copre; il contenuto lo hanno scritto altri, quindi
   * un tipo diverso, un `id` mancante o una versione che non è di `entityId` (l'elemento di cui la
   * cronologia parla) lanciano un errore senza scrivere nulla.
   */
  restoreEntity: (version: RestoreVersion) => Promise<void>;
  /**
   * Più versioni insieme (un solo salvataggio e una sola sync), per annullare le modifiche di una
   * persona. Le versioni non valide si saltano; restituisce quante sono state ripristinate.
   */
  restoreEntities: (versions: readonly RestoreVersion[]) => Promise<number>;
  markNotificationRead: (id: string) => Promise<void>;
  markAllNotificationsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
  /** Crea un gruppo di studio con l'utente corrente come proprietario. */
  createStudyGroup: (group: Partial<StudyGroup> & Pick<StudyGroup, "name">, owner: Pick<GroupMember, "userId" | "displayName" | "email">) => Promise<string>;
  updateStudyGroup: (id: string, patch: Partial<StudyGroup>) => Promise<void>;
  deleteStudyGroup: (id: string) => Promise<void>;
  /** Crea un invito pendente (per email e/o codice condivisibile). */
  createGroupInvite: (invite: Partial<GroupInvite> & Pick<GroupInvite, "groupId" | "groupName" | "fromUserId" | "fromDisplayName" | "code">) => Promise<string>;
  /** Accetta un invito: entra nei membri e lo segna accettato. */
  acceptGroupInvite: (inviteId: string, member: Pick<GroupMember, "userId" | "displayName" | "email">) => Promise<void>;
  declineGroupInvite: (inviteId: string) => Promise<void>;
  /** Entra in un gruppo tramite codice di invito; errore se il codice non esiste. */
  joinGroupByCode: (code: string, member: Pick<GroupMember, "userId" | "displayName" | "email">) => Promise<string>;
  addGroupResource: (resource: Partial<GroupResource> & Pick<GroupResource, "groupId" | "kind" | "title" | "addedByUserId" | "addedByDisplayName">) => Promise<string>;
  toggleResourcePin: (id: string) => Promise<void>;
  deleteGroupResource: (id: string) => Promise<void>;
  logGroupActivity: (groupId: string, actorDisplayName: string, text: string) => Promise<GroupActivity>;
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
  /** Avvia un blocco Pomodoro (`mode`: durata di partenza; `subjectId` null = nessuna materia). */
  startStudyTimer: (mode: TimerMode, options?: { subjectId?: string | null }) => void;
  /** Avvia (da fermo, con le durate attuali della materia), mette in pausa o riprende. */
  toggleStudyTimer: () => void;
  /**
   * Scarta il blocco o la sessione in corso: timer fermo, stessa materia. false = non ha azzerato
   * (un'altra scheda aveva uno stato più recente, preso al suo posto): niente "Annulla".
   */
  resetStudyTimer: (mode?: TimerMode) => boolean;
  /** Chiude la fase scaduta; a fine blocco Pomodoro salva la sessione (una volta sola). */
  settleStudyTimer: () => TimerEvent | null;
  startStopwatch: (subjectId?: string | null) => void;
  /** Avvia il Timer (conto alla rovescia): `minutes` esplicito (agenti) o la durata ricordata. */
  startCountdown: (minutes?: number, subjectId?: string | null) => void;
  /** "Termina e salva": salva il tempo studiato e azzera il timer in un colpo solo (agenti, Pomodoro). */
  finishStudyTimer: () => TimerFinish;
  /** "Termina" di Timer e Cronometro: il tempo si ferma e si apre il riepilogo prima di salvare. */
  endStudyTimer: () => { status: "review" | "too-short" | "idle" };
  setTimerReviewOpen: (open: boolean) => void;
  /** "Salva" del riepilogo di Timer e Cronometro: i campi corretti vincono su quelli del timer. */
  saveTimerReview: (edit: SessionEdit) => { status: "saved"; session: StudySession } | { status: "too-short" } | { status: "idle" };
  skipBreak: () => void;
  setTimerKind: (kind: TimerKind) => void;
  setTimerSubject: (subjectId: string | null) => void;
  /** "Cosa studi?" e tipo di sessione; `topicId` null toglie l'argomento (che deve essere della materia scelta). */
  setTimerDetails: (details: { title?: string; template?: StudySession["template"]; topicId?: string | null }) => void;
  markTimerTargetNotified: () => void;
  /** "Annulla" dopo Scarta: rimette lo stato precedente se nel frattempo non è partito altro. */
  restoreStudyTimer: (previous: TimerState) => boolean;
  /** Stato del timer cambiato in un'altra scheda. */
  reloadStudyTimer: () => void;
  /** Durate della materia e/o generali (null = togli); il timer fermo prende subito le nuove. */
  saveTimerSettings: (change: { subjectId?: string | null; subject?: TimerSettings | null; defaults?: TimerSettings | null }) => Promise<void>;
}

type StoreState = StudyState;

export type PreferencesPatch = Partial<
  Pick<
    Preferences,
    "displayName" | "avatarDataUrl" | "weeklyTargetMinutes" | "degreeCfu" | "showBarb" | "degreeProgram" | "sbThesisGrade" | "barbThesisPoints" | "abroad" | "timer" | "eventTypeColors"
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
  groups: true,
  sharing: true,
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

// Ogni modifica porta l'ora: tra due schede vince lo stato più recente (vedi settleStudyTimer).
const setTimerState = (set: (partial: Partial<StoreState>) => void, timer: TimerState) => {
  const stamped = { ...timer, changedAt: Date.now() };
  saveTimer(stamped);
  set({ timer: stamped });
};

/** Durate del timer per una materia: materia → preferenze → predefiniti. */
const timerDurationsFor = (state: Pick<StoreState, "subjects" | "preferences">, subjectId?: string) =>
  resolveTimerDurations(subjectId ? state.subjects.find((subject) => subject.id === subjectId)?.timer : undefined, selectPreferences(state).timer);

const knownSubjectId = (state: Pick<StoreState, "subjects">, subjectId?: string | null) =>
  subjectId && state.subjects.some((subject) => subject.id === subjectId) ? subjectId : undefined;

/** Argomento valido per il timer: esiste ed è della materia scelta (senza materia nessun argomento). */
const topicFor = (state: Pick<StoreState, "topics">, subjectId?: string, topicId?: string) =>
  subjectId && topicId && state.topics.some((topic) => topic.id === topicId && topic.subjectId === subjectId) ? topicId : undefined;

/**
 * La persona sceglie materia o durate: un blocco non ancora avviato torna sulle sue durate anche
 * se un agente l'aveva preparato da 45 o 90 minuti (`mode` classic / deep-focus).
 */
const chosenByUser = (timer: TimerState): TimerState =>
  timer.mode !== "pomodoro" && timer.kind === "pomodoro" && isTimerIdle(timer) ? { ...timer, mode: "pomodoro" } : timer;

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

  /**
   * Un'altra scheda ha cambiato il timer dopo questa (evento "storage" perso, scheda tornata dalla
   * cache): si prende il suo stato e l'azione chiesta qui non si fa (true). Come reloadStudyTimer.
   */
  const adoptNewerTimer = () => {
    const stored = loadTimer();
    if ((stored.changedAt ?? 0) <= (get().timer.changedAt ?? 0)) return false;
    set(stored.ended ? { timer: stored } : { timer: stored, timerReview: false });
    return true;
  };

  /** Blocco di studio finito → sessione completata. Id già presente (altra scheda, ricarica) → nulla. */
  const saveTimerBlock = (block: FinishedBlock): StudySession | null => {
    const state = get();
    const id = block.sessionId ?? createId("session");
    if (state.sessions.some((session) => session.id === id)) return null;
    const session = sessionFromBlock({ ...block, sessionId: id }, { subjects: state.subjects, now: nowIso() });
    set((current) => ({ sessions: [session, ...current.sessions] }));
    void commit();
    return session;
  };

  return {
    loading: true,
    locked: false,
    activeView: "dashboard",
    settings: defaultSettings(),
    ...applySnapshot(createEmptySnapshot()),
    timer: typeof window === "undefined" ? defaultTimer() : loadTimer(),
    // Un Timer o Cronometro finito prima di chiudere l'app riapre il riepilogo (lo fa il watcher all'avvio).
    timerReview: false,

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

    addNotification: async (notification) => {
      // Id stabile (es. notif-share-<id>): più dispositivi dello stesso account non la duplicano.
      if (notification.id && get().notifications.some((entry) => entry.id === notification.id)) return notification.id;
      const now = nowIso();
      const created: AppNotification = {
        id: notification.id ?? createId("notification"),
        createdAt: now,
        updatedAt: now,
        archived: false,
        tags: notification.tags ?? [],
        kind: notification.kind,
        title: notification.title,
        body: notification.body ?? "",
        linkView: notification.linkView,
        linkGroupId: notification.linkGroupId
      };
      set((state) => {
        // Tetto anti-rumore: si conservano le 200 più recenti (le lette vecchie escono per prime).
        const next = [created, ...state.notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        const kept = next.slice(0, 200);
        return { notifications: kept };
      });
      await commit();
      return created.id;
    },

    restoreEntity: async (version) => {
      if (!isRestorableVersion(version)) throw new ShareUserError(RESTORE_TEXT.notRestorable);
      if (!(await get().restoreEntities([version]))) throw new ShareUserError(RESTORE_TEXT.notHere);
    },

    restoreEntities: async (versions) => {
      // Il negozio è il confine di fiducia: ogni versione deve essere di quell'elemento (`entityId`), non di un altro.
      const valid = versions.filter(isRestorableVersion);
      if (!valid.length) return 0;
      const now = nowIso();
      // Stessa strada di ogni modifica locale: updatedAt nuovo, diff di persistenza, outbox e sync. Con
      // un updatedAt più recente della copia locale vince per LWW e arriva anche a chi ha la condivisione.
      // Si decide qui, al momento di scrivere: tra il controllo e la scrittura l'elemento può essere
      // stato eliminato (dalla sync), e la versione di una modifica senza copia lo riscriverebbe senza file.
      const state = get();
      const patch: Partial<Record<CollectionKey, SyncableEntity[]>> = {};
      let written = 0;
      for (const version of valid) {
        const collection = COLLECTION_BY_ENTITY_TYPE[version.entityType];
        const current = patch[collection] ?? (state[collection] as unknown as SyncableEntity[]);
        const existing = current.find((entry) => entry.id === version.entityId);
        const base = restoredPayload(version, existing as unknown as Record<string, unknown> | undefined);
        if (!base) continue;
        const restored = { ...base, updatedAt: restoredUpdatedAt(now, existing?.updatedAt) } as unknown as SyncableEntity;
        // Al suo posto se c'è già (come gli altri aggiornamenti), in fondo se era stato eliminato.
        patch[collection] = existing ? current.map((entry) => (entry.id === version.entityId ? restored : entry)) : [...current, restored];
        written += 1;
      }
      if (!written) return 0;
      set(patch as unknown as Partial<StudyState>);
      await commit();
      return written;
    },

    markNotificationRead: async (id) => {
      const now = nowIso();
      set((state) => ({
        notifications: state.notifications.map((item) =>
          item.id === id && !item.readAt ? { ...item, readAt: now, updatedAt: now } : item
        )
      }));
      await commit();
    },

    markAllNotificationsRead: async () => {
      const now = nowIso();
      set((state) => ({
        notifications: state.notifications.map((item) => (item.readAt ? item : { ...item, readAt: now, updatedAt: now }))
      }));
      await commit();
    },

    deleteNotification: async (id) => {
      set((state) => ({ notifications: state.notifications.filter((item) => item.id !== id) }));
      await commit();
    },

    createStudyGroup: async (group, owner) => {
      const now = nowIso();
      const created: StudyGroup = {
        id: createId("studyGroup"),
        createdAt: now,
        updatedAt: now,
        archived: false,
        tags: group.tags ?? [],
        name: group.name.trim(),
        description: group.description?.trim() ?? "",
        ownerId: owner.userId,
        ownerDisplayName: owner.displayName,
        members: [{ userId: owner.userId, email: owner.email, displayName: owner.displayName, role: "owner", joinedAt: now }],
        inviteCode: group.inviteCode ?? makeGroupInviteCode()
      };
      if (!created.name) throw new Error("Il gruppo deve avere un nome.");
      set((state) => ({ studyGroups: [created, ...state.studyGroups] }));
      await commit();
      return created.id;
    },

    updateStudyGroup: async (id, patch) => {
      set((state) => ({
        studyGroups: state.studyGroups.map((group) =>
          group.id === id ? { ...group, ...patch, name: patch.name?.trim() || group.name, updatedAt: nowIso() } : group
        )
      }));
      await commit();
    },

    deleteStudyGroup: async (id) => {
      set((state) => ({
        studyGroups: state.studyGroups.filter((group) => group.id !== id),
        groupInvites: state.groupInvites.filter((invite) => invite.groupId !== id),
        groupResources: state.groupResources.filter((resource) => resource.groupId !== id),
        groupActivities: state.groupActivities.filter((activity) => activity.groupId !== id)
      }));
      await commit();
    },

    createGroupInvite: async (invite) => {
      const now = nowIso();
      const created: GroupInvite = {
        id: createId("groupInvite"),
        createdAt: now,
        updatedAt: now,
        archived: false,
        tags: [],
        groupId: invite.groupId,
        groupName: invite.groupName,
        groupDescription: invite.groupDescription,
        fromUserId: invite.fromUserId,
        fromDisplayName: invite.fromDisplayName,
        recipientEmail: invite.recipientEmail?.trim().toLowerCase() || undefined,
        code: invite.code.trim().toUpperCase(),
        status: "pending"
      };
      if (!created.code) throw new Error("Serve un codice di invito.");
      set((state) => ({ groupInvites: [created, ...state.groupInvites] }));
      await commit();
      return created.id;
    },

    acceptGroupInvite: async (inviteId, member) => {
      const now = nowIso();
      const invite = get().groupInvites.find((item) => item.id === inviteId);
      if (!invite) throw new Error("Invito non trovato.");
      if (invite.status !== "pending") throw new Error("Invito già gestito.");
      const group = get().studyGroups.find((item) => item.id === invite.groupId);
      set((state) => ({
        groupInvites: state.groupInvites.map((item) => (item.id === inviteId ? { ...item, status: "accepted" as const, updatedAt: now } : item)),
        studyGroups: group && !group.members.some((m) => m.userId === member.userId)
          ? state.studyGroups.map((item) =>
              item.id === group.id
                ? {
                    ...item,
                    members: [...item.members, { userId: member.userId, email: member.email, displayName: member.displayName, role: "member" as const, joinedAt: now }],
                    updatedAt: now
                  }
                : item
            )
          : state.studyGroups
      }));
      await commit();
    },

    declineGroupInvite: async (inviteId) => {
      const now = nowIso();
      set((state) => ({
        groupInvites: state.groupInvites.map((item) =>
          item.id === inviteId && item.status === "pending" ? { ...item, status: "declined" as const, updatedAt: now } : item
        )
      }));
      await commit();
    },

    joinGroupByCode: async (code, member) => {
      const normalized = code.trim().toUpperCase();
      const now = nowIso();
      const group = get().studyGroups.find((item) => item.inviteCode.toUpperCase() === normalized);
      if (!group) throw new Error("Nessun gruppo con questo codice su questo dispositivo.");
      if (group.members.some((m) => m.userId === member.userId)) return group.id;
      set((state) => ({
        studyGroups: state.studyGroups.map((item) =>
          item.id === group.id
            ? {
                ...item,
                members: [...item.members, { userId: member.userId, email: member.email, displayName: member.displayName, role: "member" as const, joinedAt: now }],
                updatedAt: now
              }
            : item
        )
      }));
      await commit();
      return group.id;
    },

    addGroupResource: async (resource) => {
      const now = nowIso();
      const created: GroupResource = {
        id: createId("groupResource"),
        createdAt: now,
        updatedAt: now,
        archived: false,
        tags: resource.tags ?? [],
        groupId: resource.groupId,
        kind: resource.kind,
        title: resource.title.trim(),
        url: resource.url?.trim() || undefined,
        body: resource.body?.trim() || undefined,
        pinned: resource.pinned ?? false,
        addedByUserId: resource.addedByUserId,
        addedByDisplayName: resource.addedByDisplayName
      };
      if (!created.title) throw new Error("La risorsa deve avere un titolo.");
      set((state) => ({ groupResources: [created, ...state.groupResources] }));
      await commit();
      return created.id;
    },

    toggleResourcePin: async (id) => {
      set((state) => ({
        groupResources: state.groupResources.map((resource) =>
          resource.id === id ? { ...resource, pinned: !resource.pinned, updatedAt: nowIso() } : resource
        )
      }));
      await commit();
    },

    deleteGroupResource: async (id) => {
      set((state) => ({ groupResources: state.groupResources.filter((resource) => resource.id !== id) }));
      await commit();
    },

    logGroupActivity: async (groupId, actorDisplayName, text) => {
      const now = nowIso();
      const entry: GroupActivity = {
        id: createId("groupActivity"),
        createdAt: now,
        updatedAt: now,
        archived: false,
        tags: [],
        groupId,
        actorDisplayName,
        text
      };
      set((state) => ({
        // Cronologia leggera: ultime 100 voci per gruppo, gli altri gruppi restano intatti.
        groupActivities: [
          entry,
          ...state.groupActivities.filter((item) => item.groupId !== groupId),
          ...state.groupActivities.filter((item) => item.groupId === groupId).slice(0, 99)
        ]
      }));
      await commit();
      return entry;
    },

    addEvent: async (event) => {
      // Campi della ripetizione nuova: scritti solo se ci sono; il fuso si prende alla creazione.
      const zone = isValidTimeZone(event.timeZone) ? event.timeZone : deviceTimeZone();
      const occasion = sanitizeOccasion(event.occasion);
      const extra = Object.fromEntries(
        (["repeat", "repeatLegacy", "seriesId", "originalDate", "cancelled", "splitFrom", "sourceRecurrenceId", "colorCustom", "location"] as const)
          .filter((key) => event[key] !== undefined)
          .map((key) => [key, event[key]])
      ) as Partial<CalendarEvent>;
      const draft: CalendarEvent = {
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
        sourceUid: event.sourceUid,
        goalId: event.goalId,
        ...extra,
        ...(zone ? { timeZone: zone } : {}),
        ...(occasion ? { occasion } : {}),
        ...(event.reminders !== undefined ? { reminders: sanitizeReminders(event.reminders) } : {})
      };
      // Regola valida: si scrivono anche impronta e proiezione per le app vecchie; non valida: si scarta.
      const created = applyRepeatFields(draft, { repeatChanged: event.repeat !== undefined && event.repeatLegacy === undefined, timeZone: zone });
      set((state) => ({ events: [created, ...state.events] }));
      await commit();
    },

    importBarbExamSessions: async (incoming) => {
      if (get().locked || get().loading) throw new Error("Attendi il caricamento o sblocca il calendario personale.");
      // Dataset BARB caricato solo qui (import dinamico): fuori dal bundle iniziale.
      const [{ BARB_EXAM_COURSES, BARB_EXAM_SESSIONS }, { prepareBarbExamImport }] = await Promise.all([
        import("../lib/university/examSessions"),
        import("../lib/barbExamImport")
      ]);
      // Solo record del dataset verificato: il chiamante sceglie gli id, non i contenuti ufficiali.
      const officialById = new Map(BARB_EXAM_SESSIONS.map((session) => [session.id, session]));
      const selected = incoming.flatMap((item) => {
        const official = officialById.get(item.id);
        return official ? [official] : [];
      });
      const current = get();
      const batch = prepareBarbExamImport(selected, BARB_EXAM_COURSES, current.subjects, current.events);
      if (!batch.events.length) return { added: 0, skipped: incoming.length };
      const now = nowIso();
      const created: CalendarEvent[] = batch.events.map((event) => ({
        ...event, id: barbReminderEventId(event.sourceUid!), createdAt: now, updatedAt: now,
        archived: false, tags: ["BARB", "appello-importato"], status: "planned",
        checklist: [], attachmentIds: []
      }));
      // set è sincrono prima del primo await: anche doppi click/import concorrenti vedono gli UID.
      set((state) => ({ events: [...created, ...state.events] }));
      await commit();
      if (get().persistError) throw new Error(`Gli appelli sono nel calendario ma il salvataggio va ritentato: ${get().persistError}`);
      return { added: created.length, skipped: incoming.length - created.length };
    },

    importEvents: async (incoming) => {
      const now = nowIso();
      const bySource = new Map(get().events.filter((event) => event.sourceUid).map((event) => [event.sourceUid as string, event]));
      const updates = new Map<string, CalendarEvent>();
      const created: CalendarEvent[] = [];
      const seen = new Set<string>();
      for (const raw of incoming) {
        const item = preserveBarbReminderDates(raw);
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
          id: item.sourceUid?.startsWith("barb-exam-") ? barbReminderEventId(item.sourceUid) : createId("event"),
          createdAt: now,
          updatedAt: now,
          archived: false,
          tags: item.tags ?? (item.sourceUid?.startsWith("barb-exam-") ? ["BARB", "appello-importato"] : []),
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
          notes: item.notes ?? "",
          links: item.links ?? [],
          sourceUid: item.sourceUid
        });
      }
      if (!created.length && !updates.size) return { added: 0, updated: 0 };
      set((state) => ({ events: [...created, ...state.events.map((event) => updates.get(event.id) ?? event)] }));
      await commit();
      return { added: created.length, updated: updates.size };
    },

    updateEvent: async (id, patch) => {
      const now = nowIso();
      set((state) => {
        const current = state.events.find((event) => event.id === id);
        if (!current) return {};
        const merged = preserveBarbReminderDates({ ...current, ...patch, updatedAt: now });
        // Regola: nuova se la modifica ne sceglie una, altrimenti vince un cambio fatto da un'app vecchia.
        const next = isOccurrenceRow(current) ? merged : applyRepeatFields(merged, { repeatChanged: changesRepeat(current, patch) });
        // Materia della serie: la seguono le sue righe, nello stesso salvataggio.
        const follow = !isOccurrenceRow(current) && next.subjectId !== current.subjectId;
        return {
          events: state.events.map((event) =>
            event.id === id
              ? next
              : follow && event.seriesId === id && event.subjectId !== next.subjectId
                ? { ...event, subjectId: next.subjectId, updatedAt: now }
                : event
          )
        };
      });
      await commit();
    },

    deleteEvent: async (id) => {
      const now = nowIso();
      set((state) => {
        const target = state.events.find((event) => event.id === id);
        // Una serie si porta via le sue righe (occorrenze modificate o cancellate).
        const rows = target && !isOccurrenceRow(target) ? state.events.filter((event) => event.seriesId === id).map((event) => event.id) : [];
        const ids = new Set([id, ...rows]);
        return {
          events: applyEditPlan(state.events, { puts: [], deletes: [...ids] }).events,
          attachments: unlinkEvents(state.attachments, ids, now),
          notes: unlinkEvents(state.notes, ids, now),
          reminders: unlinkEvents(state.reminders, ids, now)
        };
      });
      await commit();
    },

    editOccurrence: async (seriesId, originalDate, scope, patch) => {
      const now = nowIso();
      const events = get().events;
      const series = events.find((event) => event.id === seriesId && !isOccurrenceRow(event));
      const plan = series ? planEdit(series, events, originalDate, scope, patch, { now }) : null;
      if (!plan || (!plan.puts.length && !plan.deletes.length)) return;
      set((state) => {
        const result = applyEditPlan(state.events, { ...plan, puts: plan.puts.map((item) => preserveBarbReminderDates(item)) });
        return {
          events: result.events,
          attachments: unlinkEvents(state.attachments, result.removed, now),
          notes: unlinkEvents(state.notes, result.removed, now),
          reminders: unlinkEvents(state.reminders, result.removed, now)
        };
      });
      await commit();
    },

    deleteOccurrence: async (seriesId, originalDate, scope, options) => {
      const now = nowIso();
      const plan = planDelete(get().events, seriesId, originalDate, scope, { now, includeSplits: options?.includeSplits });
      if (!plan.puts.length && !plan.deletes.length) return;
      set((state) => {
        const result = applyEditPlan(state.events, plan);
        return {
          events: result.events,
          attachments: unlinkEvents(state.attachments, result.removed, now),
          notes: unlinkEvents(state.notes, result.removed, now),
          reminders: unlinkEvents(state.reminders, result.removed, now)
        };
      });
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
        universityCourseId: subject.universityCourseId,
        semesterOverride: subject.semesterOverride,
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

    deleteSubject: async (id) => {
      const before = get();
      // Esami e argomenti non esistono senza materia: se ne vanno con lei, e con loro i collegamenti.
      const gone = new Set([
        `subject:${id}`,
        ...before.exams.filter((exam) => exam.subjectId === id).map((exam) => `exam:${exam.id}`),
        ...before.topics.filter((topic) => topic.subjectId === id).map((topic) => `studyTopic:${topic.id}`)
      ]);
      const now = nowIso();
      const unlink = <T extends { linkedEntityType?: string; linkedEntityId?: string; updatedAt: string }>(item: T) =>
        item.linkedEntityType && gone.has(`${item.linkedEntityType}:${item.linkedEntityId}`)
          ? { ...item, linkedEntityType: undefined, linkedEntityId: undefined, updatedAt: now }
          : item;
      // Il resto resta senza materia; gli oggetti non toccati restano gli stessi (il diff non li riscrive).
      const free = <T extends { subjectId?: string; updatedAt: string }>(item: T) =>
        item.subjectId === id ? { ...item, subjectId: undefined, updatedAt: now } : item;
      set((state) => ({
        subjects: state.subjects.filter((subject) => subject.id !== id),
        exams: state.exams.filter((exam) => exam.subjectId !== id),
        topics: state.topics.filter((topic) => topic.subjectId !== id),
        tasks: state.tasks.map(free),
        events: state.events.map(free),
        sessions: state.sessions.map(free),
        widgets: state.widgets.map(free),
        attachments: state.attachments.map(unlink),
        notes: state.notes.map(unlink),
        reminders: state.reminders.map(unlink)
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
      // Stesso id (doppio tocco su Salva, salvataggio ripetuto): una sola sessione.
      if (session.id && get().sessions.some((item) => item.id === session.id)) return;
      const created: StudySession = {
        id: session.id || createId("session"),
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
      // Origine e argomento solo se ci sono (niente chiavi vuote nel JSON sincronizzato).
      if (session.source) created.source = session.source;
      if (session.topicId) created.topicId = session.topicId;
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
      const links = sessionLinksOf(get(), id);
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
      return links;
    },

    restoreSession: async (session, links) => {
      const state = get();
      if (state.sessions.some((item) => item.id === session.id)) return;
      // Come restoreEntities: updatedAt nuovo, così la sessione vince per LWW sulla cancellazione già
      // inviata al cloud (con quello vecchio la sync la eliminerebbe di nuovo poco dopo).
      const now = nowIso();
      const restored: StudySession = { ...session, updatedAt: restoredUpdatedAt(now, session.updatedAt) };
      const relinked = links ? relinkSession(state, session.id, links, now) : null;
      set((current) => ({ sessions: [restored, ...current.sessions], ...(relinked ?? {}) }));
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
          await useSharedStore.getState().clear();
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

    startStudyTimer: (mode, options) => {
      const state = get();
      const current = state.timer;
      const subjectId = knownSubjectId(state, options?.subjectId === undefined ? current.subjectId : options.subjectId);
      setTimerState(
        set,
        startTimerState(mode, Date.now(), {
          durations: timerDurationsFor(state, subjectId),
          subjectId,
          topicId: topicFor(state, subjectId, current.topicId),
          title: current.title,
          template: current.template,
          sessionId: createId("session")
        })
      );
      set({ timerReview: false });
    },
    startStopwatch: (subjectId) => {
      const state = get();
      const current = state.timer;
      const id = knownSubjectId(state, subjectId === undefined ? current.subjectId : subjectId);
      setTimerState(
        set,
        startStopwatchState(Date.now(), {
          mode: current.mode,
          subjectId: id,
          topicId: topicFor(state, id, current.topicId),
          title: current.title,
          template: current.template,
          targetMinutes: timerDurationsFor(state, id).stopwatchTargetMinutes,
          sessionId: createId("session")
        })
      );
      set({ timerReview: false });
    },
    startCountdown: (minutes, subjectId) => {
      const state = get();
      const current = state.timer;
      const id = knownSubjectId(state, subjectId === undefined ? current.subjectId : subjectId);
      setTimerState(
        set,
        startCountdownState(Date.now(), {
          mode: current.mode,
          subjectId: id,
          topicId: topicFor(state, id, current.topicId),
          title: current.title,
          template: current.template,
          minutes: minutes ?? timerDurationsFor(state, id).timerMinutes,
          sessionId: createId("session")
        })
      );
      set({ timerReview: false });
    },
    toggleStudyTimer: () => {
      const state = get();
      const now = Date.now();
      // Da fermo parte con le durate attuali della materia (il giro del Pomodoro continua).
      const timer = syncTimerDurations(state.timer, timerDurationsFor(state, state.timer.subjectId), now);
      const next = toggleTimerState(timer, now, { sessionId: createId("session") });
      // Timer arrivato a zero: non riparte da capo (resta il riepilogo).
      if (next === state.timer) return;
      setTimerState(set, next);
      if (!next.ended && state.timerReview) set({ timerReview: false });
    },
    resetStudyTimer: (mode) => {
      if (adoptNewerTimer()) return false;
      const state = get();
      const current = state.timer;
      const subjectId = knownSubjectId(state, current.subjectId);
      const durations = timerDurationsFor(state, subjectId);
      setTimerState(
        set,
        defaultTimer(mode ?? current.mode, {
          kind: mode ? "pomodoro" : current.kind,
          durations,
          subjectId,
          topicId: topicFor(state, subjectId, current.topicId),
          title: current.title,
          template: current.template,
          targetMinutes: durations.stopwatchTargetMinutes
        })
      );
      set({ timerReview: false });
      return true;
    },
    settleStudyTimer: () => {
      const state = get();
      // I blocchi si salvano solo con i dati caricati: init() sostituirebbe le sessioni appena aggiunte.
      if (state.loading || state.locked) return null;
      // Un'altra scheda può aver già chiuso questo blocco: si parte dallo stato più recente.
      const stored = loadTimer();
      const timer = (stored.changedAt ?? 0) > (state.timer.changedAt ?? 0) ? stored : state.timer;
      const durations = timerDurationsFor(state, timer.subjectId);
      const result = advanceTimerState(timer, Date.now(), durations);
      if (result.timer === timer) {
        if (timer !== state.timer) set({ timer });
        return null;
      }
      // Timer a zero: nessuna sessione automatica, si apre il riepilogo con la fine reale.
      if (result.timerEnded) {
        setTimerState(set, result.timer);
        set({ timerReview: true });
        return {
          type: "timer-done",
          minutes: Math.max(1, Math.round(timer.durationSeconds / 60)),
          subjectId: knownSubjectId(state, timer.subjectId),
          endedAt: result.timer.pausedAt ?? Date.now()
        };
      }
      const block = result.finishedBlock;
      const session = block ? saveTimerBlock(block) : null;
      setTimerState(set, result.timer);
      if (!block) return { type: "break-done" };
      const breakPhase = nextPhase("focus", timer.cycle, durations.longBreakEvery).phase;
      return {
        type: "focus-done",
        session,
        minutes: block.actualMinutes,
        subjectId: session?.subjectId ?? knownSubjectId(state, block.subjectId),
        breakPhase,
        breakMinutes: breakPhase === "long" ? durations.longBreakMinutes : durations.shortBreakMinutes,
        breakEnded: Boolean(result.breakEnded)
      };
    },
    finishStudyTimer: () => {
      const state = get();
      const now = Date.now();
      const timer = state.timer;
      if (state.loading || state.locked || isTimerIdle(timer, now)) return { status: "idle" };
      const subjectId = knownSubjectId(state, timer.subjectId);
      const durations = timerDurationsFor(state, subjectId);
      const ready = () =>
        defaultTimer(timer.mode, {
          kind: timer.kind,
          durations,
          subjectId,
          topicId: topicFor(state, subjectId, timer.topicId),
          title: timer.title,
          template: timer.template,
          targetMinutes: durations.stopwatchTargetMinutes
        });
      // Pausa del Pomodoro: i blocchi finiti sono già salvati, la pausa non è studio.
      if (timer.phase !== "focus") {
        setTimerState(set, ready());
        set({ timerReview: false });
        return { status: "ended" };
      }
      const block = finishedSession(timer, now);
      if (!block) return { status: "too-short" };
      const session = saveTimerBlock(block) ?? get().sessions.find((item) => item.id === block.sessionId);
      setTimerState(set, ready());
      set({ timerReview: false });
      return session ? { status: "saved", session } : { status: "ended" };
    },
    endStudyTimer: () => {
      const state = get();
      const now = Date.now();
      const timer = state.timer;
      if (timer.kind === "pomodoro" || isTimerIdle(timer, now)) return { status: "idle" };
      if (!timer.ended && timerUnsavedSeconds(timer, now) < 60) return { status: "too-short" };
      const ended = endTimerState(timer, now);
      if (ended !== timer) setTimerState(set, ended);
      set({ timerReview: true });
      return { status: "review" };
    },
    setTimerReviewOpen: (open) => {
      if (get().timerReview !== open) set({ timerReview: open });
    },
    saveTimerReview: (edit) => {
      const state = get();
      const now = Date.now();
      const timer = state.timer;
      if (state.loading || state.locked || timer.kind === "pomodoro" || !timer.ended) return { status: "idle" };
      // Scheda rimasta indietro (in background, evento "storage" perso): vince lo stato più recente.
      if (adoptNewerTimer()) return { status: "idle" };
      const block = finishedSession(timer, now);
      if (!block) return { status: "too-short" };
      // Minuti corretti (cronometro rimasto acceso): la fine si sposta, l'inizio resta quello vero.
      const times = reviewedSessionTimes(block, timerElapsedSeconds(timer, now), edit.minutes);
      const subjectId = knownSubjectId(state, edit.subjectId);
      const session =
        saveTimerBlock({
          ...block,
          start: times.start,
          end: times.end,
          actualMinutes: edit.minutes,
          // Cronometro senza obiettivo: il previsto è il tempo studiato, quindi quello corretto.
          plannedMinutes: timer.kind === "stopwatch" && timer.durationSeconds <= 0 ? edit.minutes : block.plannedMinutes,
          subjectId,
          topicId: topicFor(state, subjectId, edit.topicId),
          title: edit.title,
          notes: edit.notes,
          template: edit.template
        }) ?? get().sessions.find((item) => item.id === block.sessionId);
      // Il timer resta nella sua modalità, pronto per la prossima sessione.
      const nextSubjectId = knownSubjectId(state, timer.subjectId);
      const durations = timerDurationsFor(state, nextSubjectId);
      setTimerState(
        set,
        defaultTimer(timer.mode, {
          kind: timer.kind,
          durations,
          subjectId: nextSubjectId,
          topicId: topicFor(state, nextSubjectId, timer.topicId),
          title: timer.title,
          template: timer.template,
          targetMinutes: durations.stopwatchTargetMinutes
        })
      );
      set({ timerReview: false });
      return session ? { status: "saved", session } : { status: "idle" };
    },
    skipBreak: () => {
      const state = get();
      const timer = state.timer;
      const next = skipBreakState(timer, Date.now(), timerDurationsFor(state, timer.subjectId), createId("session"));
      if (next !== timer) setTimerState(set, next);
    },
    setTimerKind: (kind) => {
      const state = get();
      const current = state.timer;
      if (current.kind === kind) return;
      const subjectId = knownSubjectId(state, current.subjectId);
      const durations = timerDurationsFor(state, subjectId);
      setTimerState(
        set,
        defaultTimer("pomodoro", {
          kind,
          durations,
          subjectId,
          topicId: topicFor(state, subjectId, current.topicId),
          title: current.title,
          template: current.template,
          targetMinutes: durations.stopwatchTargetMinutes
        })
      );
      set({ timerReview: false });
    },
    setTimerSubject: (subjectId) => {
      const state = get();
      const id = knownSubjectId(state, subjectId);
      if (state.timer.subjectId === id) return;
      // L'argomento è della materia: cambiandola si stacca (il testo scritto resta).
      const next: TimerState = { ...state.timer, subjectId: id, topicId: topicFor(state, id, state.timer.topicId) };
      if (next.topicId === undefined) delete next.topicId;
      setTimerState(set, syncTimerDurations(chosenByUser(next), timerDurationsFor(state, id)));
    },
    setTimerDetails: (details) => {
      const state = get();
      const current = state.timer;
      const next: TimerState = { ...current };
      if (details.title !== undefined) next.title = details.title;
      if (details.template !== undefined) next.template = details.template;
      if (details.topicId !== undefined) {
        const topicId = details.topicId ? topicFor(state, current.subjectId, details.topicId) : undefined;
        if (topicId) next.topicId = topicId;
        else delete next.topicId;
      }
      if (next.title === current.title && next.template === current.template && next.topicId === current.topicId) return;
      setTimerState(set, next);
    },
    markTimerTargetNotified: () => {
      const current = get().timer;
      if (current.kind !== "stopwatch" || current.targetNotifiedSeconds === current.durationSeconds) return;
      setTimerState(set, { ...current, targetNotifiedSeconds: current.durationSeconds });
    },
    restoreStudyTimer: (previous) => {
      if (!isTimerIdle(get().timer)) return false;
      setTimerState(set, previous);
      // Annulla dopo Scarta dal riepilogo: il riepilogo torna aperto.
      set({ timerReview: previous.ended === true });
      return true;
    },
    reloadStudyTimer: () => {
      const stored = loadTimer();
      // Solo `set`: riscriverlo in localStorage farebbe rimbalzare l'evento tra le schede.
      // Se un'altra scheda ha salvato o scartato la sessione, il riepilogo qui si chiude.
      if ((stored.changedAt ?? 0) > (get().timer.changedAt ?? 0)) set(stored.ended ? { timer: stored } : { timer: stored, timerReview: false });
    },
    saveTimerSettings: async ({ subjectId, subject, defaults }) => {
      const writes: Array<Promise<void>> = [];
      const id = knownSubjectId(get(), subjectId);
      if (id && subject !== undefined) writes.push(get().updateSubject(id, { timer: subject ?? undefined }));
      if (defaults !== undefined) writes.push(get().updatePreferences({ timer: defaults ?? undefined }));
      const state = get();
      const synced = syncTimerDurations(chosenByUser(state.timer), timerDurationsFor(state, state.timer.subjectId));
      if (synced !== state.timer) setTimerState(set, synced);
      await Promise.all(writes);
    }
  };
});

export const hasAnyLocalData = (state: CollectionsState) => countEntities(state) > 0;
