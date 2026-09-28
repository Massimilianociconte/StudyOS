// Cloud sync offline-first per-entità (Supabase `studyos_items`, una riga per entità).
//
// Il vecchio motore caricava/scaricava un unico snapshot e sostituiva tutto:
// - al riavvio con modifiche offline non inviate, il pull sovrascriveva i dati locali;
// - bloccare il vault svuotava lo stato e il push caricava uno snapshot VUOTO sul cloud,
//   propagando la cancellazione a tutti i dispositivi;
// - nessun retry, nessuna gestione online/offline.
// Ora: outbox persistente in IndexedDB, pull incrementale via cursore `updated_at`,
// merge last-writer-wins per entità con tombstone, retry con backoff esponenziale,
// realtime solo come segnale, pausa automatica con vault bloccato.

import type { RealtimeChannel, Session } from "@supabase/supabase-js";
import { useStudyStore } from "../store/useStudyStore";
import { COLLECTIONS, ENTITY_TYPES, countEntities, pickCollections, type CollectionKey } from "./collections";
import { db, deleteMeta, getMeta, setMeta, type SyncOutboxRow } from "./db";
import { outboxKey, requestPersist, subscribeLocalChanges } from "./persistence";
import { chunkBySize, indexCollections, legacySnapshotToRows, planMerge, type PendingOutbox, type RemoteRow } from "./syncMerge";
import {
  getSession,
  isCloudConfigured,
  onAuthChange,
  pullEntityRow,
  pullEntityRows,
  pullLegacySnapshot,
  pushEntityRows,
  subscribeRemoteChanges,
  unsubscribeChannel,
  type PushRow
} from "./supabase";

export type CloudSyncStatus = "off" | "idle" | "syncing" | "error" | "offline";

export interface CloudSyncState {
  status: CloudSyncStatus;
  session: Session | null;
  lastSync: string | null;
  error?: string;
  pendingChanges: boolean;
  pendingCount: number;
  realtime: boolean;
}

const PAGE_SIZE = 200;
const PUSH_MAX_BYTES = 900_000;
const PUSH_MAX_ROWS = 200;
const CURSOR_OVERLAP_MS = 60_000;
const LOCAL_DEBOUNCE_MS = 1_200;
const REMOTE_DEBOUNCE_MS = 400;
const PERIODIC_MS = 5 * 60_000;
const MAX_RETRY_MS = 5 * 60_000;

const metaKeys = {
  cursor: (userId: string) => `cloud:cursor:${userId}`,
  migrated: (userId: string) => `cloud:migrated:${userId}`,
  boundUser: "cloud:boundUser",
  lastSync: (userId: string) => `cloud:lastSync:${userId}`
};

// Un id per caricamento di pagina: le righe scritte da questa pagina non vengono riscaricate,
// mentre altre schede/dispositivi (id diversi) le ricevono normalmente.
const clientId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `client-${Date.now()}`;

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Sync fallita.");
const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

let state: CloudSyncState = {
  status: isCloudConfigured() ? "idle" : "off",
  session: null,
  lastSync: null,
  pendingChanges: false,
  pendingCount: 0,
  realtime: false
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

let realtimeChannel: RealtimeChannel | null = null;
let initialized = false;
let running: Promise<void> | null = null;
let rerun = false;
let forceNextPull = false;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryAttempt = 0;
const cleanups: Array<() => void> = [];

const refreshPendingCount = async () => {
  const count = await db.syncOutbox.count();
  setState({ pendingCount: count, pendingChanges: count > 0 });
  return count;
};

const storeReady = () => {
  const store = useStudyStore.getState();
  return !store.loading && !store.locked;
};

const schedule = (delay: number) => {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void requestSync();
  }, delay);
};

const scheduleRetry = () => {
  if (retryTimer) clearTimeout(retryTimer);
  const delay = Math.min(MAX_RETRY_MS, 2_000 * 2 ** retryAttempt);
  retryAttempt += 1;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void requestSync();
  }, delay);
};

/** Accoda tutte le entità locali (prima sync di un account, "Forza push"). */
const enqueueAllLocal = async () => {
  const collections = pickCollections(useStudyStore.getState());
  const existing = new Set(await db.syncOutbox.toCollection().primaryKeys());
  const base = Date.now() * 1000;
  let counter = 0;
  const rows: SyncOutboxRow[] = [];
  for (const collection of COLLECTIONS) {
    for (const item of collections[collection] as unknown as Array<{ id: string }>) {
      const key = outboxKey(collection, item.id);
      if (existing.has(key)) continue;
      rows.push({
        key,
        collection,
        entityType: ENTITY_TYPES[collection],
        entityId: item.id,
        deleted: false,
        queuedAt: base + counter++
      });
    }
  }
  if (rows.length) await db.syncOutbox.bulkPut(rows);
  return rows.length;
};

const requeueEntities = async (items: Array<{ collection: CollectionKey; id: string }>) => {
  if (!items.length) return;
  const base = Date.now() * 1000;
  await db.transaction("rw", db.syncOutbox, async () => {
    for (const [index, item] of items.entries()) {
      const key = outboxKey(item.collection, item.id);
      if (await db.syncOutbox.get(key)) continue; // una modifica locale più recente è già in coda
      await db.syncOutbox.put({
        key,
        collection: item.collection,
        entityType: ENTITY_TYPES[item.collection],
        entityId: item.id,
        deleted: false,
        queuedAt: base + index
      });
    }
  });
};

const mergeRows = async (rows: RemoteRow[], force: boolean) => {
  if (!rows.length) return 0;
  const outbox = await db.syncOutbox.toArray();
  const pending = new Map<string, PendingOutbox>(outbox.map((row) => [row.key, { deleted: row.deleted, deletedAt: row.deletedAt }]));
  const plan = planMerge(rows, pickCollections(useStudyStore.getState()), pending, { force });
  if (plan.changes.length) {
    await useStudyStore
      .getState()
      .applyRemoteChanges(plan.changes.map((change) => ({ ...change, force })));
  }
  if (plan.dropOutbox.length) {
    await db.transaction("rw", db.syncOutbox, async () => {
      for (const key of plan.dropOutbox) {
        const previous = outbox.find((row) => row.key === key);
        const current = await db.syncOutbox.get(key);
        if (previous && current?.queuedAt === previous.queuedAt) await db.syncOutbox.delete(key);
      }
    });
  }
  if (plan.requeue.length) await requeueEntities(plan.requeue);
  return plan.changes.length;
};

const pull = async (userId: string, force = false) => {
  const cursor = force ? undefined : await getMeta<string>(metaKeys.cursor(userId));
  const since = cursor ? new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString() : null;
  let offset = 0;
  let maxSeen = cursor ?? null;
  let applied = 0;
  for (;;) {
    const rows = await pullEntityRows(userId, since, offset, PAGE_SIZE, force ? undefined : clientId);
    if (!rows.length) break;
    applied += await mergeRows(rows, force);
    for (const row of rows) {
      if (!maxSeen || row.updated_at > maxSeen) maxSeen = row.updated_at;
    }
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  if (maxSeen) await setMeta(metaKeys.cursor(userId), maxSeen);
  return applied;
};

const push = async (userId: string) => {
  const queued = await db.syncOutbox.orderBy("queuedAt").toArray();
  if (!queued.length) return 0;
  const index = indexCollections(pickCollections(useStudyStore.getState()));
  const now = new Date().toISOString();

  const prepared = queued.map((row) => {
    const entity = index[row.collection]?.get(row.entityId);
    const deleted = row.deleted || !entity;
    const payload = deleted ? { id: row.entityId, deletedAt: row.deletedAt ?? now } : entity;
    const push: PushRow = { entity_type: row.entityType, entity_id: row.entityId, payload, deleted };
    return { row, push, size: new TextEncoder().encode(JSON.stringify(push)).length };
  });

  let sent = 0;
  const failed: string[] = [];
  for (const batch of chunkBySize(prepared, (item) => item.size, PUSH_MAX_BYTES, PUSH_MAX_ROWS)) {
    const oversized = batch.find((item) => item.size > PUSH_MAX_BYTES);
    if (oversized) {
      failed.push(`${oversized.row.entityType}:${oversized.row.entityId} supera il limite cloud di ${PUSH_MAX_BYTES} byte`);
      continue;
    }
    try {
      const results = await pushEntityRows(userId, clientId, batch.map((item) => item.push));
      const accepted = new Set(results.filter((result) => result.accepted).map((result) => `${result.entity_type}:${result.entity_id}`));
      // Rimuove dall'outbox solo le voci accettate e non riaccodate nel frattempo.
      await db.transaction("rw", db.syncOutbox, async () => {
        for (const item of batch) {
          if (!accepted.has(item.row.key)) continue;
          const current = await db.syncOutbox.get(item.row.key);
          if (current && current.queuedAt === item.row.queuedAt) await db.syncOutbox.delete(item.row.key);
        }
      });
      sent += accepted.size;
      for (const item of batch) {
        if (accepted.has(item.row.key)) continue;
        const remote = await pullEntityRow(userId, item.row.entityType, item.row.entityId);
        if (remote) await mergeRows([remote], false);
        const pending = await db.syncOutbox.get(item.row.key);
        if (pending?.queuedAt === item.row.queuedAt) failed.push(`Conflitto cloud irrisolto per ${item.row.key}`);
      }
    } catch (error) {
      failed.push(errorMessage(error));
    }
  }
  if (failed.length) throw new Error(failed.join(" · "));
  return sent;
};

/** Prima sync di un account su questo dispositivo: merge completo + migrazione dallo snapshot legacy. */
const firstSync = async (userId: string) => {
  const rows: RemoteRow[] = [];
  let offset = 0;
  for (;;) {
    const page = await pullEntityRows(userId, null, offset, PAGE_SIZE);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  if (!rows.length) {
    const legacy = await pullLegacySnapshot(userId);
    if (legacy?.payload) await mergeRows(legacySnapshotToRows(legacy.payload, legacy.updated_at), false);
  } else {
    await mergeRows(rows, false);
  }
  const maxSeen = rows.reduce<string | null>((max, row) => (!max || row.updated_at > max ? row.updated_at : max), null);
  if (maxSeen) await setMeta(metaKeys.cursor(userId), maxSeen);
  await enqueueAllLocal();
  await push(userId);
  await setMeta(metaKeys.migrated(userId), new Date().toISOString());
};

/**
 * Collega il dispositivo all'account. Se i dati locali appartengono a un altro account
 * chiede se unirli o sostituirli (prima venivano sempre sovrascritti o mescolati).
 */
const bindUser = async (userId: string) => {
  const bound = await getMeta<string>(metaKeys.boundUser);
  if (bound === userId) return true;
  if (bound && bound !== userId && (await db.syncOutbox.count()) > 0) {
    throw new Error("L'account precedente ha modifiche cloud in attesa. Ricollegalo e completa la sincronizzazione prima di cambiare account.");
  }
  const store = useStudyStore.getState();
  const hasData = countEntities(pickCollections(store)) > 0;
  if (bound && bound !== userId && hasData) {
    const merge =
      typeof window === "undefined" ||
      window.confirm(
        "I dati su questo dispositivo provengono da un altro account.\n\nOK = uniscili al nuovo account\nAnnulla = sostituiscili con i dati del nuovo account"
      );
    if (!merge) await store.resetAllData({ propagate: false });
  }
  // Solo un account precedente noto consente di scartare una coda già vuota.
  // Al primo collegamento i tombstone creati offline devono restare in coda.
  if (bound) await db.syncOutbox.clear();
  await deleteMeta(metaKeys.cursor(userId));
  await deleteMeta(metaKeys.migrated(userId));
  await setMeta(metaKeys.boundUser, userId);
  return true;
};

const syncOnce = async () => {
  const session = state.session;
  if (!session) return;
  if (!isOnline()) {
    setState({ status: "offline" });
    return;
  }
  if (!storeReady()) return;
  const userId = session.user.id;

  setState({ status: "syncing" });
  try {
    // Un flush fallito non deve essere seguito da pull/push o avanzamento del cursore.
    await requestPersist();
    await bindUser(userId);
    const migrated = await getMeta<string>(metaKeys.migrated(userId));
    if (!migrated) {
      await firstSync(userId);
    } else {
      const force = forceNextPull;
      forceNextPull = false;
      await pull(userId, force);
      await push(userId);
    }
    const lastSync = new Date().toISOString();
    await setMeta(metaKeys.lastSync(userId), lastSync);
    retryAttempt = 0;
    setState({ status: "idle", lastSync, error: undefined });
  } catch (error) {
    setState({ status: isOnline() ? "error" : "offline", error: errorMessage(error) });
    scheduleRetry();
  } finally {
    await refreshPendingCount();
  }
};

/** Esegue una sync (single-flight: richieste concorrenti vengono unite in un'ulteriore passata). */
export const requestSync = (): Promise<void> => {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await syncOnce();
    } while (rerun && state.session);
  })().finally(() => {
    running = null;
  });
  return running;
};

const startRealtime = (userId: string) => {
  stopRealtime();
  realtimeChannel = subscribeRemoteChanges(
    userId,
    (writerId) => {
      if (writerId && writerId === clientId) return;
      schedule(REMOTE_DEBOUNCE_MS);
    },
    (status) => setState({ realtime: status === "SUBSCRIBED" })
  );
};

const stopRealtime = () => {
  unsubscribeChannel(realtimeChannel);
  realtimeChannel = null;
  setState({ realtime: false });
};

const handleSession = async (session: Session | null) => {
  if (!session) {
    stopRealtime();
    setState({
      session: null,
      status: isCloudConfigured() ? "idle" : "off",
      lastSync: null,
      error: undefined
    });
    return;
  }
  const sameUser = state.session?.user.id === session.user.id;
  setState({ session, error: undefined });
  if (sameUser && realtimeChannel) return; // semplice refresh del token
  const lastSync = (await getMeta<string>(metaKeys.lastSync(session.user.id))) ?? null;
  setState({ lastSync });
  startRealtime(session.user.id);
  await requestSync();
};

export const initCloudSync = async () => {
  if (initialized || !isCloudConfigured()) return;
  initialized = true;

  cleanups.push(
    subscribeLocalChanges(() => {
      void refreshPendingCount();
      if (state.session) schedule(LOCAL_DEBOUNCE_MS);
    })
  );

  // Dopo lo sblocco del vault la sync riparte (con vault bloccato è sospesa).
  cleanups.push(
    useStudyStore.subscribe((curr, prev) => {
      if (prev.locked && !curr.locked && state.session) schedule(REMOTE_DEBOUNCE_MS);
    })
  );

  if (typeof window !== "undefined") {
    const onOnline = () => {
      retryAttempt = 0;
      void requestSync();
    };
    const onOffline = () => setState({ status: "offline" });
    const onVisible = () => {
      if (document.visibilityState === "visible" && state.session) schedule(REMOTE_DEBOUNCE_MS);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => {
      if (state.session && document.visibilityState === "visible") void requestSync();
    }, PERIODIC_MS);
    cleanups.push(() => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(interval);
    });
  }

  cleanups.push(onAuthChange((session) => void handleSession(session)));
  await refreshPendingCount();
  const initial = await getSession();
  if (initial) await handleSession(initial);
};

export const teardownCloudSync = () => {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (retryTimer) clearTimeout(retryTimer);
  stopRealtime();
  cleanups.splice(0).forEach((cleanup) => cleanup());
  initialized = false;
};

/** Reinvia tutte le entità locali (recupero dopo problemi). Non cancella nulla sul cloud. */
export const forcePushNow = async () => {
  await enqueueAllLocal();
  await refreshPendingCount();
  retryAttempt = 0;
  await requestSync();
};

/** Riscarica tutto dal cloud: la versione remota vince su ogni entità presente nel cloud. */
export const forcePullNow = async () => {
  if (!state.session) return;
  forceNextPull = true;
  retryAttempt = 0;
  await requestSync();
};

export const isSignedIn = () => Boolean(state.session);

/**
 * Dopo un reset solo locale con account collegato: dimentica cursore e flag del dispositivo
 * così la prossima sync riscarica tutti i dati dal cloud (reset della cache locale).
 */
export const resetCloudDeviceState = async () => {
  const userId = state.session?.user.id;
  if (!userId) return;
  await deleteMeta(metaKeys.cursor(userId));
  await deleteMeta(metaKeys.migrated(userId));
  retryAttempt = 0;
  await requestSync();
};
