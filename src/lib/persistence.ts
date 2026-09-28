// Persistenza incrementale di StudyOS.
//
// Prima: ogni modifica svuotava e riscriveva tutte le 12 tabelle (allegati compresi),
// senza serializzazione né gestione errori. Ora:
// - diff per riferimento contro l'ultimo stato persistito (Zustand è immutabile: un'entità
//   non modificata mantiene lo stesso oggetto) -> solo bulkPut/bulkDelete necessari;
// - una sola transazione Dexie per flush, flush serializzati e coalescenti;
// - errori esposti allo store (nessuna perdita silenziosa) e ritentati al flush successivo;
// - vault: snapshot cifrato con chiave AES derivata una volta per sessione;
// - ogni modifica locale accoda la chiave nell'outbox del cloud sync (le modifiche
//   arrivate dal cloud no, per evitare eco infinite).

import type { StudySnapshot, UserSettings } from "../types";
import { COLLECTIONS, ENTITY_TYPES, type CollectionKey, type CollectionsState, type SyncableEntity } from "./collections";
import { collectionTable, dataTables, db, type SyncOutboxRow } from "./db";
import { encryptWithKey, type VaultKey } from "./crypto";

type Baseline = Record<CollectionKey, Map<string, SyncableEntity>>;

export interface CollectionDiff {
  puts: Partial<Record<CollectionKey, SyncableEntity[]>>;
  deletes: Partial<Record<CollectionKey, string[]>>;
  count: number;
}

const emptyBaseline = (): Baseline =>
  Object.fromEntries(COLLECTIONS.map((key) => [key, new Map()])) as unknown as Baseline;

export const baselineFrom = (collections: CollectionsState): Baseline =>
  Object.fromEntries(
    COLLECTIONS.map((key) => [key, new Map(collections[key].map((item) => [item.id, item as SyncableEntity]))])
  ) as unknown as Baseline;

/** Diff puro per riferimento: entità nuove/modificate -> puts, id spariti -> deletes. */
export const diffCollections = (state: CollectionsState, base: Baseline): CollectionDiff => {
  const diff: CollectionDiff = { puts: {}, deletes: {}, count: 0 };
  for (const key of COLLECTIONS) {
    const previous = base[key];
    const items = state[key] as unknown as SyncableEntity[];
    const seen = new Set<string>();
    const puts: SyncableEntity[] = [];
    for (const item of items) {
      seen.add(item.id);
      if (previous.get(item.id) !== item) puts.push(item);
    }
    const deletes: string[] = [];
    for (const id of previous.keys()) {
      if (!seen.has(id)) deletes.push(id);
    }
    if (puts.length) diff.puts[key] = puts;
    if (deletes.length) diff.deletes[key] = deletes;
    diff.count += puts.length + deletes.length;
  }
  return diff;
};

const commitDiff = (base: Baseline, diff: CollectionDiff) => {
  for (const key of COLLECTIONS) {
    for (const item of diff.puts[key] ?? []) base[key].set(item.id, item);
    for (const id of diff.deletes[key] ?? []) base[key].delete(id);
  }
};

let lastQueuedAt = 0;
const nextQueuedAt = () => {
  lastQueuedAt = Math.max(Date.now() * 1000, lastQueuedAt + 1);
  return lastQueuedAt;
};

export const outboxKey = (collection: CollectionKey, id: string) => `${ENTITY_TYPES[collection]}:${id}`;

export interface PersistHostState {
  collections: CollectionsState;
  settings: UserSettings;
  locked: boolean;
}

export interface PersistHost {
  getState: () => PersistHostState;
  onError: (message: string | undefined) => void;
}

const localChangeListeners = new Set<(count: number) => void>();

/** Notifica (es. al cloud sync) quando nuove modifiche locali entrano nell'outbox. */
export const subscribeLocalChanges = (listener: (count: number) => void) => {
  localChangeListeners.add(listener);
  return () => {
    localChangeListeners.delete(listener);
  };
};

let host: PersistHost | null = null;
let baseline: Baseline = emptyBaseline();
let baselineSettings: UserSettings | null = null;
let vaultKey: VaultKey | null = null;
let vaultMode = false;
let vaultDirty = false;
let suspended = false;
// Entità applicate dal cloud dopo l'ultimo flush: vanno scritte ma non riaccodate nell'outbox.
const remoteRefs = new Map<string, SyncableEntity | null>();

let chain: Promise<unknown> = Promise.resolve();
let pending: Promise<void> | null = null;

export const configurePersistence = (next: PersistHost) => {
  host = next;
};

export const resetBaseline = (collections: CollectionsState, settings: UserSettings | null) => {
  baseline = baselineFrom(collections);
  baselineSettings = settings;
  remoteRefs.clear();
  vaultDirty = false;
};

export const setVaultSession = (mode: boolean, key: VaultKey | null) => {
  vaultMode = mode;
  vaultKey = key;
};

export const hasVaultKey = () => vaultKey !== null;

/** Durante il lock del vault lo stato in memoria è vuoto: non va mai persistito né diffato. */
export const setPersistenceSuspended = (value: boolean) => {
  suspended = value;
};

export const markRemoteApplied = (collection: CollectionKey, id: string, entity: SyncableEntity | null) => {
  remoteRefs.set(outboxKey(collection, id), entity);
  if (vaultMode) vaultDirty = true;
};

const buildOutbox = (diff: CollectionDiff): SyncOutboxRow[] => {
  const rows: SyncOutboxRow[] = [];
  const now = new Date().toISOString();
  const isRemoteEcho = (collection: CollectionKey, id: string, current: SyncableEntity | null) => {
    const key = outboxKey(collection, id);
    return remoteRefs.has(key) && remoteRefs.get(key) === current;
  };
  for (const key of COLLECTIONS) {
    for (const item of diff.puts[key] ?? []) {
      if (isRemoteEcho(key, item.id, item)) continue;
      rows.push({
        key: outboxKey(key, item.id),
        collection: key,
        entityType: ENTITY_TYPES[key],
        entityId: item.id,
        deleted: false,
        queuedAt: nextQueuedAt()
      });
    }
    for (const id of diff.deletes[key] ?? []) {
      if (isRemoteEcho(key, id, null)) continue;
      rows.push({
        key: outboxKey(key, id),
        collection: key,
        entityType: ENTITY_TYPES[key],
        entityId: id,
        deleted: true,
        deletedAt: now,
        queuedAt: nextQueuedAt()
      });
    }
  }
  return rows;
};

const snapshotOf = (collections: CollectionsState): StudySnapshot => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  ...collections
});

const flush = async () => {
  if (!host) return;
  const state = host.getState();
  if (suspended || state.locked) return;

  const diff = diffCollections(state.collections, baseline);
  const settingsChanged = state.settings !== baselineSettings;
  const needsVaultWrite = vaultMode && (diff.count > 0 || vaultDirty);
  if (!diff.count && !settingsChanged && !needsVaultWrite) {
    // Stato già allineato al disco (es. dopo un rollback): un vecchio errore non è più attuale.
    host.onError(undefined);
    return;
  }

  const outbox = buildOutbox(diff);
  const remoteKeysInFlush = new Map(remoteRefs);

  try {
    if (vaultMode) {
      if (!vaultKey) throw new Error("Vault bloccato: sblocca il workspace per salvare le modifiche.");
      const record = await encryptWithKey(JSON.stringify(snapshotOf(state.collections)), vaultKey);
      await db.transaction("rw", [db.settings, db.vault, db.syncOutbox], async () => {
        if (settingsChanged) await db.settings.put({ ...state.settings });
        await db.vault.put(record);
        if (outbox.length) await db.syncOutbox.bulkPut(outbox);
      });
    } else {
      await db.transaction("rw", [db.settings, db.syncOutbox, ...dataTables], async () => {
        if (settingsChanged) await db.settings.put({ ...state.settings });
        for (const key of COLLECTIONS) {
          const puts = diff.puts[key];
          const deletes = diff.deletes[key];
          if (puts?.length) await collectionTable(key).bulkPut(puts);
          if (deletes?.length) await collectionTable(key).bulkDelete(deletes);
        }
        if (outbox.length) await db.syncOutbox.bulkPut(outbox);
      });
    }
    commitDiff(baseline, diff);
    baselineSettings = state.settings;
    vaultDirty = false;
    for (const [key, ref] of remoteKeysInFlush) {
      if (remoteRefs.get(key) === ref) remoteRefs.delete(key);
    }
    host.onError(undefined);
    if (outbox.length) localChangeListeners.forEach((listener) => listener(outbox.length));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Salvataggio locale non riuscito.";
    host.onError(`Salvataggio non riuscito: ${message}`);
    throw error;
  }
};

/**
 * Richiede un flush. Chiamate ravvicinate (stesso tick) condividono lo stesso flush;
 * i flush sono serializzati. La promise si risolve a dati scritti su IndexedDB.
 */
// Col vault ogni flush ricifra l'intero snapshot: le modifiche ravvicinate (es. digitazione)
// vengono raccolte in un'unica scrittura.
const VAULT_COALESCE_MS = 250;

export const requestPersist = (): Promise<void> => {
  if (pending) return pending;
  const run = chain.then(async () => {
    if (vaultMode) await new Promise((resolve) => setTimeout(resolve, VAULT_COALESCE_MS));
    pending = null;
    await flush();
  });
  pending = run;
  chain = run.catch(() => undefined);
  return run;
};

/** Esegue un'operazione esclusiva (es. riscrittura completa) in coda ai flush. */
export const runExclusive = <T>(operation: () => Promise<T>): Promise<T> => {
  const run = chain.then(operation);
  chain = run.catch(() => undefined);
  return run;
};

/** Attende che tutte le scritture in coda siano completate (es. prima di un export). */
export const whenPersisted = () => chain.then(() => undefined);

export const clearAllLocalData = async () => {
  await db.transaction("rw", [db.vault, db.syncOutbox, db.meta, ...dataTables], async () => {
    await Promise.all(dataTables.map((table) => table.clear()));
    await db.vault.clear();
    await db.syncOutbox.clear();
    // Senza dati locali i cursori cloud non valgono più: al prossimo accesso (anche dopo un
    // logout) la sync riparte da zero e riscarica tutto invece di restare vuota.
    await db.meta
      .filter((row) => row.key.startsWith("cloud:cursor:") || row.key.startsWith("cloud:migrated:"))
      .delete();
  });
};
