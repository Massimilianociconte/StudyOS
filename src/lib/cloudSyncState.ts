// Stato osservabile della sync cloud, senza dipendenze da supabase-js: il badge nella shell
// lo legge subito, mentre il motore di sync (e la libreria Supabase) viene caricato in differita.

import type { Session } from "@supabase/supabase-js";

export type CloudSyncStatus = "off" | "idle" | "syncing" | "error" | "offline";

export interface CloudSyncState {
  status: CloudSyncStatus;
  session: Session | null;
  lastSync: string | null;
  error?: string;
  pendingChanges: boolean;
  pendingCount: number;
  realtime: boolean;
  /** Problema non bloccante (es. elementi troppo grandi per il cloud). */
  warning?: string;
}

/** Stessa condizione di creazione del client in supabase.ts (variabili pubbliche di build). */
export const cloudConfigured = Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);

let state: CloudSyncState = {
  status: cloudConfigured ? "idle" : "off",
  session: null,
  lastSync: null,
  pendingChanges: false,
  pendingCount: 0,
  realtime: false
};

const listeners = new Set<(s: CloudSyncState) => void>();

export const setCloudSyncState = (patch: Partial<CloudSyncState>) => {
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
