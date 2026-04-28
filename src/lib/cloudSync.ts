import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { snapshotFromState, useStudyStore } from "../store/useStudyStore";
import type { StudySnapshot } from "../types";
import {
  getSession,
  isCloudConfigured,
  onAuthChange,
  pullSnapshot,
  pushSnapshot,
  subscribeRemoteSnapshot,
  unsubscribeChannel
} from "./supabase";

export type CloudSyncStatus = "off" | "idle" | "syncing" | "error";

export interface CloudSyncState {
  status: CloudSyncStatus;
  session: Session | null;
  lastSync: string | null;
  error?: string;
  pendingChanges: boolean;
}

const CLIENT_ID_KEY = "studyos-client-id";
const DEBOUNCE_MS = 800;

const dataKeys = [
  "subjects",
  "exams",
  "events",
  "tasks",
  "sessions",
  "topics",
  "attachments",
  "goals",
  "notes",
  "tags",
  "reminders",
  "widgets",
  "settings"
] as const;

type StoreState = ReturnType<typeof useStudyStore.getState>;

const getClientId = () => {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
};

const hasLocalData = (state: StoreState) =>
  state.subjects.length +
    state.exams.length +
    state.events.length +
    state.tasks.length +
    state.sessions.length +
    state.topics.length +
    state.attachments.length +
    state.goals.length +
    state.notes.length +
    state.reminders.length >
  0;

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Sync fallita.";

let state: CloudSyncState = {
  status: isCloudConfigured() ? "idle" : "off",
  session: null,
  lastSync: null,
  pendingChanges: false
};

const listeners = new Set<(s: CloudSyncState) => void>();

const setState = (patch: Partial<CloudSyncState>) => {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener(state));
};

export const getCloudSyncState = () => state;

export const subscribeCloudSync = (listener: (s: CloudSyncState) => void) => {
  listeners.add(listener);
  listener(state);
  return () => {
    listeners.delete(listener);
  };
};

let clientId = "";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let applyingRemote = false;
let unsubscribeStore: (() => void) | null = null;
let realtimeChannel: RealtimeChannel | null = null;
let initialized = false;

const cancelPendingPush = () => {
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
};

const doPush = async () => {
  pushTimer = null;
  if (!state.session) return;
  setState({ status: "syncing", pendingChanges: false });
  try {
    const snapshot = snapshotFromState(useStudyStore.getState());
    const row = await pushSnapshot(snapshot, clientId);
    setState({ status: "idle", lastSync: row.updated_at, error: undefined });
  } catch (error) {
    setState({ status: "error", error: errorMessage(error), pendingChanges: true });
  }
};

const schedulePush = () => {
  if (!state.session || applyingRemote) return;
  setState({ pendingChanges: true });
  cancelPendingPush();
  pushTimer = setTimeout(doPush, DEBOUNCE_MS);
};

const applyRemoteSnapshot = async (snapshot: StudySnapshot, lastSync: string) => {
  applyingRemote = true;
  try {
    await useStudyStore.getState().replaceAllData(snapshot);
    setState({ lastSync, status: "idle", error: undefined, pendingChanges: false });
  } finally {
    applyingRemote = false;
  }
};

const initialSync = async () => {
  if (!state.session) return;
  setState({ status: "syncing" });
  try {
    const remote = await pullSnapshot();
    if (remote) {
      await applyRemoteSnapshot(remote.payload, remote.updated_at);
    } else {
      const snapshot = snapshotFromState(useStudyStore.getState());
      if (hasLocalData(useStudyStore.getState())) {
        const row = await pushSnapshot(snapshot, clientId);
        setState({ status: "idle", lastSync: row.updated_at, error: undefined });
      } else {
        setState({ status: "idle", error: undefined });
      }
    }
  } catch (error) {
    setState({ status: "error", error: errorMessage(error) });
  }
};

const startRealtime = (userId: string) => {
  stopRealtime();
  realtimeChannel = subscribeRemoteSnapshot(userId, async (row) => {
    if (row.client_id === clientId) return;
    try {
      const remote = await pullSnapshot();
      if (!remote) return;
      await applyRemoteSnapshot(remote.payload, remote.updated_at);
    } catch (error) {
      setState({ status: "error", error: errorMessage(error) });
    }
  });
};

const stopRealtime = () => {
  unsubscribeChannel(realtimeChannel);
  realtimeChannel = null;
};

const handleSession = async (session: Session | null) => {
  cancelPendingPush();
  if (!session) {
    stopRealtime();
    setState({
      session: null,
      status: isCloudConfigured() ? "idle" : "off",
      lastSync: null,
      error: undefined,
      pendingChanges: false
    });
    return;
  }
  setState({ session, error: undefined });
  await initialSync();
  startRealtime(session.user.id);
};

export const initCloudSync = async () => {
  if (initialized || !isCloudConfigured()) return;
  initialized = true;
  clientId = getClientId();

  unsubscribeStore = useStudyStore.subscribe((curr, prev) => {
    if (applyingRemote) return;
    const changed = dataKeys.some(
      (key) => (curr as unknown as Record<string, unknown>)[key] !== (prev as unknown as Record<string, unknown>)[key]
    );
    if (changed) schedulePush();
  });

  onAuthChange((session) => {
    void handleSession(session);
  });

  const initial = await getSession();
  if (initial) await handleSession(initial);
};

export const teardownCloudSync = () => {
  cancelPendingPush();
  stopRealtime();
  if (unsubscribeStore) {
    unsubscribeStore();
    unsubscribeStore = null;
  }
  initialized = false;
};

export const forcePushNow = async () => {
  cancelPendingPush();
  await doPush();
};

export const forcePullNow = async () => {
  if (!state.session) return;
  setState({ status: "syncing" });
  try {
    const remote = await pullSnapshot();
    if (!remote) {
      setState({ status: "idle", error: "Nessuno snapshot remoto." });
      return;
    }
    await applyRemoteSnapshot(remote.payload, remote.updated_at);
  } catch (error) {
    setState({ status: "error", error: errorMessage(error) });
  }
};
