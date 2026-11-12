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

import type { StudyGroup, StudySnapshot, UserSettings } from "../types";
import { COLLECTIONS, ENTITY_TYPES, laterStamp, timestampOf, type CollectionKey, type CollectionsState, type SyncableEntity } from "./collections";
import { groupLookup, isServerBacked } from "./syncScope";
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
  /** Sostituisce nello stato le entità a cui il flush ha dovuto dare un timbro nuovo (vedi `advanceStamps`). */
  replace?: (patch: Partial<CollectionsState>) => void;
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
// Un'altra scheda è diventata quella attiva (src/lib/activeTab.ts): da qui in poi niente scritture.
// Definitivo: la scheda si ricarica nella schermata di guardia.
let halted = false;

export class PersistenceHaltedError extends Error {
  constructor() {
    super("StudyOS è attivo in un'altra scheda: questa non salva più.");
    this.name = "PersistenceHaltedError";
  }
}

export const isPersistenceHalted = () => halted;

/** Blocco preso da un'altra scheda: smette subito di scrivere, senza salvare nulla. */
export const haltPersistence = () => {
  halted = true;
};
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

/**
 * true se l'entità è ancora su disco (ultimo stato salvato). Chi non la trova in memoria capisce
 * così se è stata eliminata qui e non ancora salvata (da non rimettere con un pull già in volo).
 */
export const isPersisted = (collection: CollectionKey, id: string) => baseline[collection].has(id);

export const markRemoteApplied = (collection: CollectionKey, id: string, entity: SyncableEntity | null) => {
  remoteRefs.set(outboxKey(collection, id), entity);
  if (vaultMode) vaultDirty = true;
};

const isRemoteEcho = (collection: CollectionKey, id: string, current: SyncableEntity | null) => {
  const key = outboxKey(collection, id);
  return remoteRefs.has(key) && remoteRefs.get(key) === current;
};

/**
 * Una modifica locale deve sempre portare il timbro avanti: il cloud accetta solo un updatedAt più
 * recente di quello che ha (e lo stesso solo con lo stesso contenuto). Un'azione che cambia il
 * contenuto senza toccare updatedAt, o un orologio indietro rispetto al dispositivo che ha scritto
 * prima, faceva rifiutare la modifica: il pull rimetteva la copia del cloud e la modifica spariva
 * in silenzio (o restava bloccata in coda). Qui, in un punto solo per tutte le azioni, l'entità
 * riceve `laterStamp` del timbro di prima. Restano fuori le copie arrivate dal cloud (eco) e i
 * gruppi pubblicati, che hanno il timbro del server (vedi syncScope).
 * Muta `diff.puts` e restituisce la patch da rimettere nello stato (stessi oggetti: il prossimo diff
 * non li rivede).
 */
export const advanceStamps = (
  diff: CollectionDiff,
  base: Baseline,
  collections: CollectionsState,
  options: { isEcho?: (collection: CollectionKey, item: SyncableEntity) => boolean; now?: number } = {}
): Partial<CollectionsState> => {
  const patch: Partial<Record<CollectionKey, SyncableEntity[]>> = {};
  const groupOf = groupLookup(collections.studyGroups, base.studyGroups.values() as Iterable<StudyGroup>);
  for (const key of COLLECTIONS) {
    const puts = diff.puts[key];
    if (!puts?.length) continue;
    const bumped = new Map<string, SyncableEntity>();
    for (const [index, item] of puts.entries()) {
      const previous = base[key].get(item.id);
      if (!previous || timestampOf(item.updatedAt) > timestampOf(previous.updatedAt)) continue;
      if (options.isEcho?.(key, item) || isServerBacked(key, item, groupOf)) continue;
      if (JSON.stringify(item) === JSON.stringify(previous)) continue;
      const next = { ...item, updatedAt: laterStamp(previous.updatedAt, options.now) };
      puts[index] = next;
      bumped.set(item.id, next);
    }
    if (bumped.size) {
      patch[key] = (collections[key] as unknown as SyncableEntity[]).map((item) => bumped.get(item.id) ?? item);
    }
  }
  return patch as Partial<CollectionsState>;
};

const buildOutbox = (diff: CollectionDiff, collections: CollectionsState): SyncOutboxRow[] => {
  const rows: SyncOutboxRow[] = [];
  const now = Date.now();
  // I gruppi pubblicati stanno nelle tabelle condivise, non nel cloud personale (vedi syncScope).
  // Per un'eliminazione conta com'era l'entità prima, con il suo gruppo anche se è sparito insieme.
  const groupOf = groupLookup(collections.studyGroups, baseline.studyGroups.values() as Iterable<StudyGroup>);
  for (const key of COLLECTIONS) {
    for (const item of diff.puts[key] ?? []) {
      if (isRemoteEcho(key, item.id, item)) continue;
      if (isServerBacked(key, item, groupOf)) continue;
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
      const previous = baseline[key].get(id);
      if (previous && isServerBacked(key, previous, groupOf)) continue;
      rows.push({
        key: outboxKey(key, id),
        collection: key,
        entityType: ENTITY_TYPES[key],
        entityId: id,
        deleted: true,
        // Come per le modifiche: dopo l'ultimo timbro visto, anche con l'orologio indietro.
        deletedAt: laterStamp(previous?.updatedAt, now),
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

/** Modifiche in memoria non ancora su disco (null: nulla da scrivere, es. vault bloccato). */
const pendingWrites = () => {
  if (!host) return null;
  const state = host.getState();
  if (suspended || state.locked) return null;
  const diff = diffCollections(state.collections, baseline);
  const settingsChanged = state.settings !== baselineSettings;
  const needsVaultWrite = vaultMode && (diff.count > 0 || vaultDirty);
  return { state, diff, settingsChanged, any: diff.count > 0 || settingsChanged || needsVaultWrite };
};

/**
 * Lo stop può arrivare a ogni attesa (scheda congelata che intanto perde il blocco): si ricontrolla
 * prima di ogni scrittura. Dentro la transazione l'eccezione la annulla tutta: niente scritto.
 */
const assertNotHalted = () => {
  if (halted) throw new PersistenceHaltedError();
};

const flush = async () => {
  // Chi aspetta (es. la sync prima di avanzare il cursore) non deve credere che i dati siano salvati.
  assertNotHalted();
  if (!host) return;
  const pendingNow = pendingWrites();
  if (!pendingNow) return;
  const { state, diff, settingsChanged } = pendingNow;
  if (!pendingNow.any) {
    // Stato già allineato al disco (es. dopo un rollback): un vecchio errore non è più attuale.
    host.onError(undefined);
    return;
  }

  // Sincrono fino alla prima attesa: nessuna azione può cambiare lo stato tra il diff e la patch.
  const stamped = advanceStamps(diff, baseline, state.collections, { isEcho: (key, item) => isRemoteEcho(key, item.id, item) });
  if (Object.keys(stamped).length) host.replace?.(stamped);
  const collections: CollectionsState = { ...state.collections, ...stamped };
  const outbox = buildOutbox(diff, collections);
  const remoteKeysInFlush = new Map(remoteRefs);

  try {
    if (vaultMode) {
      if (!vaultKey) throw new Error("Vault bloccato: sblocca il workspace per salvare le modifiche.");
      const record = await encryptWithKey(JSON.stringify(snapshotOf(collections)), vaultKey);
      // Col vault questa scrittura sostituisce l'intera copia: mai dopo lo stop.
      assertNotHalted();
      await db.transaction("rw", [db.settings, db.vault, db.syncOutbox], async () => {
        assertNotHalted();
        if (settingsChanged) await db.settings.put({ ...state.settings });
        assertNotHalted();
        await db.vault.put(record);
        assertNotHalted();
        if (outbox.length) await db.syncOutbox.bulkPut(outbox);
      });
    } else {
      await db.transaction("rw", [db.settings, db.syncOutbox, ...dataTables], async () => {
        assertNotHalted();
        if (settingsChanged) await db.settings.put({ ...state.settings });
        for (const key of COLLECTIONS) {
          const puts = diff.puts[key];
          const deletes = diff.deletes[key];
          assertNotHalted();
          if (puts?.length) await collectionTable(key).bulkPut(puts);
          if (deletes?.length) await collectionTable(key).bulkDelete(deletes);
        }
        assertNotHalted();
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
    // Stop a metà: nessun messaggio d'errore, la scheda sta passando alla guardia.
    if (halted) throw new PersistenceHaltedError();
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

/**
 * Un'altra scheda chiede il posto: salva tutto (dati, impostazioni, outbox del cloud) in coda ai
 * flush già chiesti, poi smette di scrivere. Il controllo finale e lo stop sono nello stesso tick:
 * nessuna modifica può restare a metà. Se il salvataggio fallisce la promise è rifiutata e la scheda
 * continua a scrivere (resta attiva).
 */
export const handOffPersistence = () =>
  runExclusive(async () => {
    for (let round = 0; round < 3 && pendingWrites()?.any; round += 1) await flush();
    if (pendingWrites()?.any) throw new Error("Modifiche ancora in corso: riprova tra un attimo.");
    halted = true;
  });

export const clearAllLocalData = async () => {
  await db.transaction("rw", [db.vault, db.syncOutbox, db.meta, db.sharedItems, db.sharedOutbox, ...dataTables], async () => {
    await Promise.all(dataTables.map((table) => table.clear()));
    await db.vault.clear();
    await db.syncOutbox.clear();
    await db.sharedItems.clear();
    await db.sharedOutbox.clear();
    // Senza dati locali i cursori cloud non valgono più: al prossimo accesso (anche dopo un
    // logout) la sync riparte da zero e riscarica tutto invece di restare vuota.
    await db.meta
      .filter(
        (row) => row.key.startsWith("cloud:cursor:") || row.key.startsWith("cloud:migrated:") || row.key.startsWith("share:")
      )
      .delete();
  });
};
