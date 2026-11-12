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
import { getCloudSyncState, setCloudSyncState } from "./cloudSyncState";
import { useStudyStore } from "../store/useStudyStore";
import { COLLECTIONS, ENTITY_TYPES, countEntities, pickCollections, type CollectionKey } from "./collections";
import { collectionTable, db, deleteMeta, getMeta, setMeta, type SyncOutboxRow } from "./db";
import { isPersistenceHalted, outboxKey, requestPersist, subscribeLocalChanges } from "./persistence";
import { chunkBySize, indexCollections, legacySnapshotToRows, planMerge, planOrphanPuts, type PendingOutbox, type RemoteRow } from "./syncMerge";
import { personalRemovals } from "./accountSwitch";
import { ACCOUNT_TEXT } from "./labels/account";
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

export type { CloudSyncState, CloudSyncStatus } from "./cloudSyncState";
export { getCloudSyncState, subscribeCloudSync } from "./cloudSyncState";

const PAGE_SIZE = 200;
const PUSH_MAX_BYTES = 900_000;
const PUSH_MAX_ROWS = 200;
const CURSOR_OVERLAP_MS = 60_000;
const LOCAL_DEBOUNCE_MS = 1_200;
const REMOTE_DEBOUNCE_MS = 400;
const PERIODIC_MS = 5 * 60_000;
const MAX_RETRY_MS = 5 * 60_000;

// Versione dei tipi di entità sincronizzati. Una build precedente scarta i tipi che non conosce
// ma fa avanzare comunque il cursore: quando la versione sale, il primo pull riparte da zero
// (merge LWW normale) per recuperare le righe saltate. 2 = preferenze personali.
const SYNC_SCHEMA = 3;

const metaKeys = {
  cursor: (userId: string) => `cloud:cursor:${userId}`,
  migrated: (userId: string) => `cloud:migrated:${userId}`,
  schema: (userId: string) => `cloud:schema:${userId}`,
  boundUser: "cloud:boundUser",
  lastSync: (userId: string) => `cloud:lastSync:${userId}`
};

// Un id per caricamento di pagina: le righe scritte da questa pagina non vengono riscaricate,
// mentre altre schede/dispositivi (id diversi) le ricevono normalmente.
const clientId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `client-${Date.now()}`;

const errorMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "Sync fallita.";
  if (/failed to fetch|networkerror|load failed|network request failed|timed? ?out|timeout|aborted|err_connection/i.test(message)) {
    return "Server cloud non raggiungibile: le modifiche restano salvate su questo dispositivo, nuovo tentativo automatico.";
  }
  return message;
};
const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

const setState = setCloudSyncState;
const currentSession = () => getCloudSyncState().session;

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
  // Un'altra scheda è diventata quella attiva (activeTab.ts): questa non sincronizza più.
  return !store.loading && !store.locked && !isPersistenceHalted();
};

class SyncSuspendedError extends Error {
  constructor() {
    super("Sincronizzazione sospesa: workspace bloccato o in caricamento.");
    this.name = "SyncSuspendedError";
  }
}

/** L'account è uscito (o cambiato) durante la passata: si interrompe senza toccare dati né cursori. */
class SessionChangedError extends Error {
  constructor() {
    super("Sincronizzazione interrotta: l'account è cambiato.");
    this.name = "SessionChangedError";
  }
}

const assertSameSession = (userId: string) => {
  if (currentSession()?.user.id !== userId) throw new SessionChangedError();
};

/**
 * Con il vault bloccato (o durante il caricamento) lo stato in memoria è vuoto: leggere lo
 * stato in quel momento trasformerebbe ogni voce dell'outbox in un'eliminazione cloud.
 * La sync si interrompe senza avanzare cursori né toccare l'outbox.
 */
const assertStoreReady = () => {
  if (!storeReady()) throw new SyncSuspendedError();
};

/**
 * Ogni scrittura dell'outbox arriva dopo un'attesa (rete, lettura): nel frattempo un'altra scheda
 * può aver preso il blocco (activeTab.ts). Il controllo è dentro la transazione: se la scheda è
 * stata fermata, la transazione si annulla e nulla viene scritto.
 */
const outboxTransaction = <T,>(work: () => Promise<T>) =>
  db.transaction("rw", db.syncOutbox, async () => {
    if (isPersistenceHalted()) throw new SyncSuspendedError();
    return work();
  });


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

/**
 * Accoda le entità locali (prima sync di un account, "Forza push").
 * `skip`: chiavi già presenti nel cloud. Le versioni locali più recenti di queste sono già
 * state riaccodate da planMerge; tutte le altre sono identiche o più vecchie e non vanno
 * ricaricate (prima un nuovo dispositivo re-inviava l'intero dataset, allegati compresi).
 */
const enqueueAllLocal = async (skip: Set<string> = new Set()) => {
  const collections = pickCollections(useStudyStore.getState());
  const existing = new Set([...(await db.syncOutbox.toCollection().primaryKeys()), ...skip]);
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
  if (rows.length) await outboxTransaction(() => db.syncOutbox.bulkPut(rows));
  return rows.length;
};

const requeueEntities = async (items: Array<{ collection: CollectionKey; id: string }>) => {
  if (!items.length) return;
  const base = Date.now() * 1000;
  await outboxTransaction(async () => {
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

const mergeRows = async (userId: string, rows: RemoteRow[], force: boolean) => {
  if (!rows.length) return 0;
  assertStoreReady();
  const outbox = await db.syncOutbox.toArray();
  // Uscita dall'account (o cambio) mentre la richiesta era in volo, es. «Togli i dati da qui»:
  // le righe arrivate tardi non devono riempire di nuovo il dispositivo appena svuotato.
  assertSameSession(userId);
  const pending = new Map<string, PendingOutbox>(outbox.map((row) => [row.key, { deleted: row.deleted, deletedAt: row.deletedAt }]));
  const plan = planMerge(rows, pickCollections(useStudyStore.getState()), pending, { force });
  if (plan.changes.length) {
    await useStudyStore
      .getState()
      .applyRemoteChanges(plan.changes.map((change) => ({ ...change, force })));
  }
  if (plan.dropOutbox.length) {
    await outboxTransaction(async () => {
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
    applied += await mergeRows(userId, rows, force);
    for (const row of rows) {
      if (!maxSeen || row.updated_at > maxSeen) maxSeen = row.updated_at;
    }
    if (rows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  assertSameSession(userId);
  if (maxSeen) await setMeta(metaKeys.cursor(userId), maxSeen);
  return applied;
};

/** Righe su disco delle voci in coda senza entità in memoria (senza vault i dati stanno nelle tabelle). */
const readStoredRows = async (rows: SyncOutboxRow[]) => {
  const known = rows.filter((row) => (COLLECTIONS as readonly string[]).includes(row.collection));
  const entries = await Promise.all(known.map(async (row) => [row.key, await collectionTable(row.collection).get(row.entityId)] as const));
  return new Map<string, unknown>(entries);
};

const push = async (userId: string) => {
  assertStoreReady();
  const queued = await db.syncOutbox.orderBy("queuedAt").toArray();
  if (!queued.length) return 0;
  assertStoreReady();
  const index = indexCollections(pickCollections(useStudyStore.getState()));
  const encoder = new TextEncoder();

  const prepare = (row: SyncOutboxRow, entity: unknown) => {
    const payload = row.deleted ? { id: row.entityId, deletedAt: row.deletedAt ?? new Date(row.queuedAt / 1000).toISOString() } : entity;
    const push: PushRow = { entity_type: row.entityType, entity_id: row.entityId, payload, deleted: row.deleted };
    return { row, push, size: encoder.encode(JSON.stringify(push)).length };
  };
  const orphans: SyncOutboxRow[] = [];
  const prepared = queued.flatMap((row) => {
    const entity = index[row.collection]?.get(row.entityId);
    // Una voce "put" senza entità in memoria non diventa MAI un'eliminazione cloud: le
    // eliminazioni reali arrivano dall'outbox con deleted=true.
    if (!row.deleted && !entity) {
      orphans.push(row);
      return [];
    }
    return [prepare(row, entity)];
  });

  if (orphans.length) {
    // Senza vault la riga può essere ancora su disco (scritta in un'altra scheda): si invia quella.
    // Si scartano solo le voci senza riga, e col vault (una sola scheda) come prima.
    const vault = useStudyStore.getState().settings.security.mode === "vault";
    const stored = vault ? new Map<string, unknown>() : await readStoredRows(orphans);
    assertStoreReady();
    const { send, drop } = planOrphanPuts(orphans, stored, vault);
    if (send.length) {
      prepared.push(...send.map((item) => prepare(item.row, item.entity)));
      prepared.sort((a, b) => a.row.queuedAt - b.row.queuedAt);
    }
    if (drop.length) {
      await outboxTransaction(async () => {
        for (const row of drop) {
          const current = await db.syncOutbox.get(row.key);
          if (current && current.queuedAt === row.queuedAt && !current.deleted) await db.syncOutbox.delete(row.key);
        }
      });
    }
  }

  let sent = 0;
  const failed: string[] = [];
  const oversizedKeys: string[] = [];
  for (const batch of chunkBySize(prepared, (item) => item.size, PUSH_MAX_BYTES, PUSH_MAX_ROWS)) {
    const oversized = batch.find((item) => item.size > PUSH_MAX_BYTES);
    if (oversized) {
      // Non blocca il resto della coda: resta in outbox e viene segnalato come avviso.
      oversizedKeys.push(oversized.row.key);
      continue;
    }
    assertStoreReady();
    try {
      const results = await pushEntityRows(userId, clientId, batch.map((item) => item.push));
      const accepted = new Set(results.filter((result) => result.accepted).map((result) => `${result.entity_type}:${result.entity_id}`));
      // Rimuove dall'outbox solo le voci accettate e non riaccodate nel frattempo.
      await outboxTransaction(async () => {
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
        if (remote) await mergeRows(userId, [remote], false);
        const pending = await db.syncOutbox.get(item.row.key);
        if (pending?.queuedAt === item.row.queuedAt) failed.push(`Conflitto cloud irrisolto per ${item.row.key}`);
      }
    } catch (error) {
      if (error instanceof SyncSuspendedError || error instanceof SessionChangedError) throw error;
      failed.push(errorMessage(error));
    }
  }
  setState({
    warning: oversizedKeys.length
      ? `${oversizedKeys.length} elementi troppo grandi per il cloud (limite ${Math.round(PUSH_MAX_BYTES / 1024)} KB): restano solo su questo dispositivo. Sostituisci gli allegati grandi con un link.`
      : undefined
  });
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
    if (legacy?.payload) await mergeRows(userId, legacySnapshotToRows(legacy.payload, legacy.updated_at), false);
  } else {
    await mergeRows(userId, rows, false);
  }
  const maxSeen = rows.reduce<string | null>((max, row) => (!max || row.updated_at > max ? row.updated_at : max), null);
  // Senza stato locale disponibile non si può accodare nulla: il flag "migrated" non va scritto.
  assertStoreReady();
  await enqueueAllLocal(new Set(rows.map((row) => `${row.entity_type}:${row.entity_id}`)));
  await push(userId);
  assertStoreReady();
  assertSameSession(userId);
  if (maxSeen) await setMeta(metaKeys.cursor(userId), maxSeen);
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
    // OK = solo il nuovo account: i dati di prima sono già tutti nel loro account (coda vuota, vedi
    // sopra), quindi si tolgono solo da qui. Unire due persone diverse era la scelta di OK e
    // portava nel nuovo account materie, eventi e (prima della correzione) nome e foto dell'altro.
    const merge = typeof window === "undefined" || !window.confirm(ACCOUNT_TEXT.switchConfirm);
    if (!merge) await store.resetAllData({ propagate: false });
    else {
      // Nome, foto e preferenze sono della persona: si tolgono qui (senza invio) e la prima
      // sincronizzazione porta quelli del nuovo account. Prima restavano e finivano nel nuovo account.
      const removals = personalRemovals(pickCollections(store));
      if (removals.length) await store.applyRemoteChanges(removals);
    }
  }
  // Solo un account precedente noto consente di scartare una coda già vuota.
  // Al primo collegamento i tombstone creati offline devono restare in coda.
  if (bound) await outboxTransaction(() => db.syncOutbox.clear());
  await deleteMeta(metaKeys.cursor(userId));
  await deleteMeta(metaKeys.migrated(userId));
  await setMeta(metaKeys.boundUser, userId);
  return true;
};

const syncOnce = async () => {
  const session = currentSession();
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
    const schema = (await getMeta<number>(metaKeys.schema(userId))) ?? 1;
    if (!migrated) {
      await firstSync(userId);
    } else {
      const force = forceNextPull;
      forceNextPull = false;
      if (schema < SYNC_SCHEMA) await deleteMeta(metaKeys.cursor(userId));
      await pull(userId, force);
      await push(userId);
    }
    if (schema < SYNC_SCHEMA) await setMeta(metaKeys.schema(userId), SYNC_SCHEMA);
    const lastSync = new Date().toISOString();
    await setMeta(metaKeys.lastSync(userId), lastSync);
    retryAttempt = 0;
    setState({ status: "idle", lastSync, error: undefined });
  } catch (error) {
    // Uscita o cambio di account a metà passata: chi ha cambiato la sessione ha già aggiornato lo stato.
    if (error instanceof SessionChangedError) return;
    if (error instanceof SyncSuspendedError || !storeReady()) {
      // Riprende da sola allo sblocco del vault (subscription in initCloudSync).
      setState({ status: "idle" });
      return;
    }
    setState({ status: isOnline() ? "error" : "offline", error: errorMessage(error) });
    scheduleRetry();
  } finally {
    await refreshPendingCount();
  }
};

/**
 * Attende la fine della sync in corso (al massimo `timeoutMs`), senza avviarne un'altra.
 * Serve prima di svuotare il dispositivo dopo l'uscita: una passata in volo non lo riempie di nuovo.
 */
export const whenSyncIdle = async (timeoutMs = 15_000): Promise<void> => {
  const current = running;
  if (!current) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    current.catch(() => undefined),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    })
  ]);
  if (timer !== undefined) clearTimeout(timer);
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
    } while (rerun && currentSession());
  })().finally(() => {
    running = null;
  });
  return running;
};

const startRealtime = async (userId: string) => {
  await stopRealtime();
  realtimeChannel = subscribeRemoteChanges(
    userId,
    (writerId) => {
      if (writerId && writerId === clientId) return;
      schedule(REMOTE_DEBOUNCE_MS);
    },
    (status) => setState({ realtime: status === "SUBSCRIBED" })
  );
};

const stopRealtime = async () => {
  const channel = realtimeChannel;
  realtimeChannel = null;
  setState({ realtime: false });
  await unsubscribeChannel(channel);
};

// All'avvio arrivano due sessioni quasi insieme (INITIAL_SESSION di onAuthStateChange e
// getSession): in parallelo entrambe avviavano il realtime, la seconda rimuoveva il canale della
// prima e supabase-js restituiva lo stesso canale già iscritto → errore e realtime spento.
let sessionChain: Promise<void> = Promise.resolve();
const handleSession = (session: Session | null) => {
  sessionChain = sessionChain.then(() => applySession(session)).catch(() => undefined);
  return sessionChain;
};

const applySession = async (session: Session | null) => {
  if (!session) {
    await stopRealtime();
    setState({
      session: null,
      status: isCloudConfigured() ? "idle" : "off",
      lastSync: null,
      error: undefined
    });
    return;
  }
  const sameUser = currentSession()?.user.id === session.user.id;
  setState({ session, error: undefined });
  if (sameUser && realtimeChannel) return; // semplice refresh del token
  const lastSync = (await getMeta<string>(metaKeys.lastSync(session.user.id))) ?? null;
  setState({ lastSync });
  await startRealtime(session.user.id);
  await requestSync();
};

export const initCloudSync = async () => {
  if (initialized || !isCloudConfigured()) return;
  initialized = true;

  cleanups.push(
    subscribeLocalChanges(() => {
      void refreshPendingCount();
      if (currentSession()) schedule(LOCAL_DEBOUNCE_MS);
    })
  );

  // Dopo lo sblocco del vault la sync riparte (con vault bloccato è sospesa).
  cleanups.push(
    useStudyStore.subscribe((curr, prev) => {
      if (prev.locked && !curr.locked && currentSession()) schedule(REMOTE_DEBOUNCE_MS);
    })
  );

  if (typeof window !== "undefined") {
    const onOnline = () => {
      retryAttempt = 0;
      void requestSync();
    };
    const onOffline = () => setState({ status: "offline" });
    const onVisible = () => {
      if (document.visibilityState === "visible" && currentSession()) schedule(REMOTE_DEBOUNCE_MS);
    };
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    document.addEventListener("visibilitychange", onVisible);
    const interval = window.setInterval(() => {
      if (currentSession() && document.visibilityState === "visible") void requestSync();
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
  void stopRealtime();
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
  if (!currentSession()) return;
  forceNextPull = true;
  retryAttempt = 0;
  await requestSync();
};

export const isSignedIn = () => Boolean(currentSession());

/**
 * Dopo un reset solo locale con account collegato: dimentica cursore e flag del dispositivo
 * così la prossima sync riscarica tutti i dati dal cloud (reset della cache locale).
 */
export const resetCloudDeviceState = async () => {
  const userId = currentSession()?.user.id;
  if (!userId) return;
  await deleteMeta(metaKeys.cursor(userId));
  await deleteMeta(metaKeys.migrated(userId));
  retryAttempt = 0;
  await requestSync();
};
