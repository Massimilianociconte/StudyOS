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
import type { StudyGroup } from "../types";
import { COLLECTIONS, ENTITY_TYPES, countEntities, pickCollections, type CollectionKey, type CollectionsState } from "./collections";
import { GROUP_COLLECTIONS, groupLookup, isServerBacked } from "./syncScope";
import { collectionTable, db, deleteMeta, getMeta, setMeta, type SyncOutboxRow } from "./db";
import {
  LocalResetError,
  OUTBOX_WRITER,
  isPersistenceHalted,
  localResetGuard,
  noteLocalReset,
  outboxKey,
  requestPersist,
  subscribeLocalChanges
} from "./persistence";
import { chunkBySize, indexCollections, legacySnapshotToRows, newerCopy, planMerge, planOrphanPuts, tieBreakStamp, wellFormedForJsonb, type PendingOutbox, type RemoteRow } from "./syncMerge";
import { PERSONAL_COLLECTIONS, accountSwitchBlock, accountSwitchStep, personalRemovals, type AccountSwitchChoice } from "./accountSwitch";
import { countOutbox, discardable, parkedRow, stuckItems, type StuckItem } from "./stuckOutbox";
import { ACCOUNT_TEXT } from "./labels/account";
import {
  getSession,
  isCloudConfigured,
  onAuthChange,
  pullEntityRow,
  pullEntityRows,
  type PullAfter,
  pullLegacySnapshot,
  pushEntityRows,
  eraseAccountItems,
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
  /** Prima unione con l'account già fatta (anche se l'invio poi è fallito): «vince l'account» una volta sola. */
  merged: (userId: string) => `cloud:merged:${userId}`,
  schema: (userId: string) => `cloud:schema:${userId}`,
  boundUser: "cloud:boundUser",
  /** Domanda sul cambio di account aperta per la coppia «prima>adesso» (P6, vedi accountSwitchBlock). */
  switchAsked: "cloud:switchAsked",
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

// Le voci ferme (troppo grandi, stuckOutbox.ts) non sono «modifiche da inviare»: non partiranno mai
// così come sono. Si contano a parte e il pannello Account le elenca (P12).
const refreshPendingCount = async () => {
  const { pending, stuck } = countOutbox(await db.syncOutbox.toArray());
  setState({ pendingCount: pending, pendingChanges: pending > 0, stuckCount: stuck });
  return pending;
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

/** Dati di un altro account su questo dispositivo e nessuna scelta ancora: la sync aspetta (vedi bindUser). */
class AccountChoiceNeededError extends Error {
  constructor() {
    super("Scegli quali dati tenere su questo dispositivo.");
    this.name = "AccountChoiceNeededError";
  }
}

/** Scelta fatta nel pannello Account, valida solo per l'account per cui è stata fatta (solo in memoria). */
let switchChoice: { userId: string; choice: AccountSwitchChoice } | null = null;

const assertSameSession = (userId: string) => {
  if (currentSession()?.user.id !== userId) throw new SessionChangedError();
};

/**
 * Presa all'inizio di ogni passata (dopo bindUser): se intanto il dispositivo viene svuotato,
 * cursore, migrazione e ultima sync di questa passata non si scrivono più (P10).
 */
let passGuard: () => void = () => undefined;
const assertNoLocalReset = () => passGuard();

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
    // Anche vault bloccato: la voce da togliere o rimettere è stata decisa sullo stato di prima (P9).
    if (!storeReady()) throw new SyncSuspendedError();
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
  const groupOf = groupLookup(collections.studyGroups);
  const base = Date.now() * 1000;
  let counter = 0;
  const rows: SyncOutboxRow[] = [];
  for (const collection of COLLECTIONS) {
    for (const item of collections[collection] as unknown as Array<{ id: string }>) {
      const key = outboxKey(collection, item.id);
      if (existing.has(key)) continue;
      if (isServerBacked(collection, item, groupOf)) continue;
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

/**
 * Righe del cloud personale da non applicare: gruppi pubblicati e ciò che ne dipende, la cui verità
 * sono le tabelle condivise (syncScope). Vale sia per com'è qui sia per com'è arrivata la riga; i
 * gruppi arrivati nella stessa pagina contano, così la bacheca di un gruppo solo locale non si perde.
 */
const skipServerBacked = (rows: RemoteRow[], collections: CollectionsState) => {
  const incomingGroups = rows.flatMap((row) =>
    row.entity_type === ENTITY_TYPES.studyGroups && !row.deleted && row.payload && typeof row.payload === "object" && (row.payload as { id?: unknown }).id === row.entity_id
      ? [row.payload as StudyGroup]
      : []
  );
  const groupOf = groupLookup(collections.studyGroups, incomingGroups);
  return (collection: CollectionKey, row: RemoteRow, local: unknown) =>
    GROUP_COLLECTIONS.has(collection) &&
    ((local !== undefined && isServerBacked(collection, local, groupOf)) || (!row.deleted && isServerBacked(collection, row.payload, groupOf)));
};

const mergeRows = async (userId: string, rows: RemoteRow[], force: boolean, accountWins?: ReadonlySet<CollectionKey>) => {
  if (!rows.length) return 0;
  assertStoreReady();
  // Modifiche fatte mentre la pagina era in volo: prima su disco e in coda, così il merge le vede
  // come in attesa (un'eliminazione non ancora salvata sembrava «mai avuta» e tornava).
  await requestPersist();
  assertStoreReady();
  const outbox = await db.syncOutbox.toArray();
  // Vault bloccato durante la lettura: lo stato è vuoto e il merge scarterebbe le voci in coda (P9).
  assertStoreReady();
  // Uscita dall'account (o cambio) mentre la richiesta era in volo, es. «Togli i dati da qui»:
  // le righe arrivate tardi non devono riempire di nuovo il dispositivo appena svuotato.
  assertSameSession(userId);
  const pending = new Map<string, PendingOutbox>(outbox.map((row) => [row.key, { deleted: row.deleted, deletedAt: row.deletedAt }]));
  const collections = pickCollections(useStudyStore.getState());
  const plan = planMerge(rows, collections, pending, { force, accountWins, skip: skipServerBacked(rows, collections) });
  if (plan.changes.length) {
    await useStudyStore
      .getState()
      .applyRemoteChanges(plan.changes.map((change) => ({ ...change, force: force || change.force === true })));
    assertStoreReady();
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
  let after: PullAfter | null = null;
  let maxSeen = cursor ?? null;
  let applied = 0;
  for (;;) {
    const rows = await pullEntityRows(userId, since, after, PAGE_SIZE, force ? undefined : clientId);
    if (!rows.length) break;
    applied += await mergeRows(userId, rows, force);
    for (const row of rows) {
      if (!maxSeen || row.updated_at > maxSeen) maxSeen = row.updated_at;
    }
    if (rows.length < PAGE_SIZE) break;
    const last = rows[rows.length - 1];
    after = { updated_at: last.updated_at, id: last.id };
  }
  // Il cursore va avanti solo con le righe salvate: mai con il workspace bloccato a metà (P9).
  assertStoreReady();
  assertSameSession(userId);
  assertNoLocalReset();
  if (maxSeen) await setMeta(metaKeys.cursor(userId), maxSeen);
  return applied;
};

/** Righe su disco delle voci in coda senza entità in memoria (senza vault i dati stanno nelle tabelle). */
const readStoredRows = async (rows: SyncOutboxRow[]) => {
  const known = rows.filter((row) => (COLLECTIONS as readonly string[]).includes(row.collection));
  const entries = await Promise.all(known.map(async (row) => [row.key, await collectionTable(row.collection).get(row.entityId)] as const));
  return new Map<string, unknown>(entries);
};

/**
 * Rifiutata dal cloud con lo stesso timbro e un contenuto diverso (vedi `tieBreakStamp`): la copia
 * di qui riparte 1 ms dopo, come una modifica locale, e va alla passata successiva. Sblocca anche i
 * dispositivi già fermi su «Conflitto cloud irrisolto». false se non è un pareggio da sciogliere.
 */
const breakTie = async (row: SyncOutboxRow, remote: RemoteRow) => {
  if (row.deleted) return false;
  const list = pickCollections(useStudyStore.getState())[row.collection] as unknown as Array<{ id: string; updatedAt: string }>;
  const local = list.find((item) => item.id === row.entityId);
  const stamp = tieBreakStamp(local, remote);
  if (!local || !stamp) return false;
  assertStoreReady();
  useStudyStore.setState({
    [row.collection]: list.map((item) => (item === local ? { ...item, updatedAt: stamp } : item))
  } as unknown as Partial<ReturnType<typeof useStudyStore.getState>>);
  await useStudyStore.getState().retryPersist();
  return true;
};

const push = async (userId: string) => {
  assertStoreReady();
  const queued = await db.syncOutbox.orderBy("queuedAt").toArray();
  if (!queued.length) return 0;
  // Senza Web Locks più schede sono attive insieme (activeTab.ts): per una voce accodata da un'altra
  // pagina (o dalla sync stessa) la memoria di questa può essere indietro. Si legge anche la riga su
  // disco e parte la più recente; prima partiva la copia vecchia, il server la accettava (stesso timbro,
  // stesso contenuto) e la voce dell'altra scheda spariva (P15). Col vault su disco c'è solo lo
  // snapshot cifrato: resta la copia in memoria (con il vault la guardia è la stessa, vedi docs).
  const vault = useStudyStore.getState().settings.security.mode === "vault";
  const foreign = vault ? [] : queued.filter((row) => !row.deleted && row.writer !== OUTBOX_WRITER);
  const onDisk = foreign.length ? await readStoredRows(foreign) : new Map<string, unknown>();
  assertStoreReady();
  const index = indexCollections(pickCollections(useStudyStore.getState()));
  const encoder = new TextEncoder();

  const prepare = (row: SyncOutboxRow, entity: unknown) => {
    const payload = row.deleted ? { id: row.entityId, deletedAt: row.deletedAt ?? new Date(row.queuedAt / 1000).toISOString() } : wellFormedForJsonb(entity);
    const push: PushRow = { entity_type: row.entityType, entity_id: row.entityId, payload, deleted: row.deleted };
    return { row, push, size: encoder.encode(JSON.stringify(push)).length };
  };
  const orphans: SyncOutboxRow[] = [];
  // Voci accodate prima che il gruppo fosse pubblicato (o da una versione di prima): non partono.
  const outOfScope: SyncOutboxRow[] = [];
  const groupOf = groupLookup(pickCollections(useStudyStore.getState()).studyGroups);
  const prepared = queued.flatMap((row) => {
    const inMemory = index[row.collection]?.get(row.entityId);
    const entity = inMemory && onDisk.has(row.key) ? newerCopy(row.entityId, inMemory, onDisk.get(row.key)) : inMemory;
    // Una voce "put" senza entità in memoria non diventa MAI un'eliminazione cloud: le
    // eliminazioni reali arrivano dall'outbox con deleted=true.
    if (!row.deleted && !entity) {
      orphans.push(row);
      return [];
    }
    if (!row.deleted && isServerBacked(row.collection, entity, groupOf)) {
      outOfScope.push(row);
      return [];
    }
    return [prepare(row, entity)];
  });

  if (orphans.length) {
    // Senza vault la riga può essere ancora su disco (scritta in un'altra scheda): si invia quella.
    // Si scartano solo le voci senza riga, e col vault (una sola scheda) come prima.
    const stored = vault ? new Map<string, unknown>() : await readStoredRows(orphans);
    assertStoreReady();
    const { send, drop } = planOrphanPuts(orphans, stored, vault);
    const inScope = send.filter((item) => !isServerBacked(item.row.collection, item.entity, groupOf));
    outOfScope.push(...send.filter((item) => !inScope.includes(item)).map((item) => item.row));
    if (inScope.length) {
      prepared.push(...inScope.map((item) => prepare(item.row, item.entity)));
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
  if (outOfScope.length) {
    await outboxTransaction(async () => {
      for (const row of outOfScope) {
        const current = await db.syncOutbox.get(row.key);
        if (current && current.queuedAt === row.queuedAt) await db.syncOutbox.delete(row.key);
      }
    });
  }

  let sent = 0;
  let tieBroken = false;
  const failed: string[] = [];
  const oversized: Array<{ row: SyncOutboxRow; size: number }> = [];
  for (const batch of chunkBySize(prepared, (item) => item.size, PUSH_MAX_BYTES, PUSH_MAX_ROWS)) {
    const tooLarge = batch.find((item) => item.size > PUSH_MAX_BYTES);
    if (tooLarge) {
      // Non blocca il resto della coda: resta in outbox, segnata come ferma (sotto).
      oversized.push({ row: tooLarge.row, size: tooLarge.size });
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
        if (pending?.queuedAt !== item.row.queuedAt) continue;
        if (remote && (await breakTie(item.row, remote))) {
          tieBroken = true;
          continue;
        }
        failed.push(`Conflitto cloud irrisolto per ${item.row.key}`);
      }
    } catch (error) {
      if (error instanceof SyncSuspendedError || error instanceof SessionChangedError) throw error;
      failed.push(errorMessage(error));
    }
  }
  if (oversized.length) {
    // Voci che non partiranno mai così come sono: segnate come ferme, fuori dal conteggio delle
    // modifiche da inviare e nell'elenco del pannello Account (scarica una copia / togli dalla coda).
    // Una modifica locale le riaccoda senza segno e le rimette in gioco (P12).
    await outboxTransaction(async () => {
      for (const { row, size } of oversized) {
        const next = parkedRow(await db.syncOutbox.get(row.key), row, size);
        if (next) await db.syncOutbox.put(next);
      }
    });
  }
  // Le copie con il timbro nuovo partono subito, in un'altra passata (vedi requestSync).
  if (tieBroken) rerun = true;
  if (failed.length) throw new Error(failed.join(" · "));
  return sent;
};

/** Prima sync di un account su questo dispositivo: merge completo + migrazione dallo snapshot legacy. */
const firstSync = async (userId: string) => {
  const rows: RemoteRow[] = [];
  let after: PullAfter | null = null;
  for (;;) {
    const page = await pullEntityRows(userId, null, after, PAGE_SIZE);
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    const last = page[page.length - 1];
    after = { updated_at: last.updated_at, id: last.id };
  }
  // Nome, foto e preferenze dell'account vincono sulla copia di questo dispositivo, che può essere
  // di un'altra persona (primo accesso qui): la copia locale resta solo se l'account non ne ha.
  // Solo alla prima unione: se l'invio fallisce e la prima sync riparte, una modifica fatta qui nel
  // frattempo (nome corretto) non deve tornare indietro.
  const accountWins = (await getMeta<string>(metaKeys.merged(userId))) ? undefined : new Set(PERSONAL_COLLECTIONS);
  if (!rows.length) {
    const legacy = await pullLegacySnapshot(userId);
    if (legacy?.payload) await mergeRows(userId, legacySnapshotToRows(legacy.payload, legacy.updated_at), false, accountWins);
  } else {
    await mergeRows(userId, rows, false, accountWins);
  }
  assertStoreReady();
  assertSameSession(userId);
  assertNoLocalReset();
  await setMeta(metaKeys.merged(userId), new Date().toISOString());
  const maxSeen = rows.reduce<string | null>((max, row) => (!max || row.updated_at > max ? row.updated_at : max), null);
  // Senza stato locale disponibile non si può accodare nulla: il flag "migrated" non va scritto.
  assertStoreReady();
  await enqueueAllLocal(new Set(rows.map((row) => `${row.entity_type}:${row.entity_id}`)));
  await push(userId);
  assertStoreReady();
  assertSameSession(userId);
  assertNoLocalReset();
  if (maxSeen) await setMeta(metaKeys.cursor(userId), maxSeen);
  assertNoLocalReset();
  await setMeta(metaKeys.migrated(userId), new Date().toISOString());
};

/**
 * Collega il dispositivo all'account. Se i dati locali appartengono a un altro account la
 * sincronizzazione aspetta la scelta nel pannello Account (prima venivano sempre sovrascritti o
 * mescolati, poi un confirm() senza risposta li univa).
 */
const bindUser = async (userId: string) => {
  const bound = await getMeta<string>(metaKeys.boundUser);
  if (bound === userId) {
    // Tornati all'account di prima: una domanda rimasta aperta non vale più per le modifiche fatte ora.
    if (await getMeta<string>(metaKeys.switchAsked)) await deleteMeta(metaKeys.switchAsked);
    return true;
  }
  const choice = switchChoice?.userId === userId ? switchChoice.choice : null;
  const askedPair = `${bound ?? ""}>${userId}`;
  if (bound && bound !== userId) {
    const { pending, stuck } = countOutbox(await db.syncOutbox.toArray());
    const block = accountSwitchBlock({ pending, stuck, asked: (await getMeta<string>(metaKeys.switchAsked)) === askedPair, choice });
    if (block === "pending") {
      throw new Error("L'account precedente ha modifiche cloud in attesa. Ricollegalo e completa la sincronizzazione prima di cambiare account.");
    }
    // Elementi mai arrivati all'account di prima (troppo grandi): cambiando account si perderebbero.
    // La persona li vede nel pannello Account e sceglie: copia o via dalla coda (P12).
    if (block === "stuck") throw new Error(ACCOUNT_TEXT.switchStuck(stuck));
    // Modifiche fatte mentre la domanda era aperta: «mostra solo» le perderebbe, «aggiungi» no (P6).
    // La domanda resta aperta con i due pulsanti.
    if (block === "editedWhileAsked") throw new Error(ACCOUNT_TEXT.switchEditedWhileAsked(pending));
  }
  const store = useStudyStore.getState();
  const hasData = countEntities(pickCollections(store)) > 0;
  const step = accountSwitchStep({ bound, userId, hasData, choice });
  if (step === "ask") {
    // Nessuna risposta = nessuna unione: si resta fermi finché la persona non sceglie. Ricordata su
    // disco per questa coppia di account: una modifica fatta intanto non blocca la scelta, anche dopo
    // un ricaricamento.
    setState({ accountChoice: true });
    await setMeta(metaKeys.switchAsked, askedPair);
    throw new AccountChoiceNeededError();
  }
  switchChoice = null;
  if (getCloudSyncState().accountChoice) setState({ accountChoice: false });
  if (step === "separate") {
    // Solo il nuovo account: i dati di prima sono già tutti nel loro account (coda vuota, vedi sopra),
    // quindi si tolgono solo da qui.
    await store.resetAllData({ propagate: false });
  } else if (step === "merge") {
    // Nome, foto e preferenze sono della persona: si tolgono qui (senza invio) e la prima
    // sincronizzazione porta quelli del nuovo account. Prima restavano e finivano nel nuovo account.
    const removals = personalRemovals(pickCollections(store));
    if (removals.length) await store.applyRemoteChanges(removals);
  }
  // Solo un account precedente noto consente di scartare una coda già vuota.
  // Al primo collegamento i tombstone creati offline devono restare in coda.
  if (bound) await outboxTransaction(() => db.syncOutbox.clear());
  await deleteMeta(metaKeys.cursor(userId));
  await deleteMeta(metaKeys.migrated(userId));
  await deleteMeta(metaKeys.merged(userId));
  await deleteMeta(metaKeys.switchAsked);
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
    passGuard = localResetGuard();
    const migrated = await getMeta<string>(metaKeys.migrated(userId));
    const schema = (await getMeta<number>(metaKeys.schema(userId))) ?? 1;
    if (!migrated) {
      await firstSync(userId);
    } else {
      const force = forceNextPull;
      forceNextPull = false;
      if (schema < SYNC_SCHEMA) await deleteMeta(metaKeys.cursor(userId));
      try {
        await pull(userId, force);
      } catch (error) {
        // «Scarica di nuovo dal cloud» fallito (rete): il prossimo tentativo deve ripeterlo, non fare un
        // pull normale e lasciare la copia locale com'era. Non per un altro account (sessione cambiata).
        if (force && !(error instanceof SessionChangedError)) forceNextPull = true;
        throw error;
      }
      await push(userId);
    }
    assertNoLocalReset();
    if (schema < SYNC_SCHEMA) await setMeta(metaKeys.schema(userId), SYNC_SCHEMA);
    const lastSync = new Date().toISOString();
    assertNoLocalReset();
    await setMeta(metaKeys.lastSync(userId), lastSync);
    retryAttempt = 0;
    setState({ status: "idle", lastSync, error: undefined });
  } catch (error) {
    // Uscita o cambio di account a metà passata: chi ha cambiato la sessione ha già aggiornato lo stato.
    if (error instanceof SessionChangedError) return;
    // Dispositivo svuotato a metà passata: non è un errore, si ripete da zero (cursore e migrazione via).
    if (error instanceof LocalResetError) {
      setState({ status: "idle" });
      rerun = true;
      return;
    }
    // Aspetta la scelta nel pannello Account (chooseAccountSwitch): niente errore né nuovi tentativi.
    if (error instanceof AccountChoiceNeededError) {
      setState({ status: "idle", error: undefined });
      return;
    }
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
  // La scelta tra tenere separati gli account e unire vale solo per l'accesso in cui è stata chiesta.
  if (!session || currentSession()?.user.id !== session.user.id) {
    switchChoice = null;
    if (getCloudSyncState().accountChoice) setState({ accountChoice: false });
  }
  if (!session) {
    // Una richiesta di riscaricare tutto vale per l'account che l'ha chiesta, non per il prossimo.
    forceNextPull = false;
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
  if (!sameUser) forceNextPull = false;
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

/** Limite di un elemento per l'account, in KB (testo dell'elenco degli elementi fermi). */
export const CLOUD_ITEM_MAX_KB = Math.round(PUSH_MAX_BYTES / 1024);

/** Elementi che non arrivano all'account (troppo grandi), con titolo e dimensione (stuckOutbox.ts). */
export const listStuck = async (): Promise<StuckItem[]> =>
  stuckItems(await db.syncOutbox.toArray(), pickCollections(useStudyStore.getState()));

/**
 * «Togli dalla coda»: gli elementi restano su questo dispositivo ma non si prova più a inviarli, e
 * cambio account e «togli i dati da qui» non sono più fermi per loro. Solo le voci viste nell'elenco
 * e ancora ferme: una modifica arrivata dopo le ha rimesse in gioco e restano.
 */
export const discardStuck = async (items: ReadonlyArray<Pick<StuckItem, "key" | "queuedAt">>) => {
  await outboxTransaction(async () => {
    for (const item of items) {
      if (discardable(await db.syncOutbox.get(item.key), item)) await db.syncOutbox.delete(item.key);
    }
  });
  await refreshPendingCount();
  // Un cambio di account fermo per loro può ripartire.
  if (currentSession()) {
    retryAttempt = 0;
    void requestSync();
  }
};

/**
 * Risposta alla domanda del pannello Account (dati di un altro account su questo dispositivo):
 * "separate" mostra solo i dati dell'account collegato, "merge" aggiunge quelli di prima. Vale per
 * l'account collegato adesso; la sincronizzazione riparte subito.
 */
export const chooseAccountSwitch = async (choice: AccountSwitchChoice) => {
  const userId = currentSession()?.user.id;
  if (!userId) return;
  switchChoice = { userId, choice };
  retryAttempt = 0;
  await requestSync();
};

/**
 * «Cancella anche dall'account»: il server segna come eliminato ogni dato personale dell'account, anche
 * quelli mai arrivati su questo dispositivo (prima partivano solo le eliminazioni di ciò che c'era qui e
 * il resto tornava). Da chiamare dopo aver svuotato il dispositivo e prima della sync. "local-only": il
 * progetto non ha ancora la funzione e valgono solo le eliminazioni di qui; "failed": il server non ha
 * risposto (le eliminazioni di qui partono comunque con la sync).
 */
export const eraseAccountData = async (): Promise<"ok" | "local-only" | "failed"> => {
  if (!currentSession()) return "failed";
  try {
    return (await eraseAccountItems()) === "ok" ? "ok" : "local-only";
  } catch {
    return "failed";
  }
};

/**
 * Dopo un reset solo locale con account collegato: dimentica cursore e flag del dispositivo
 * così la prossima sync riscarica tutti i dati dal cloud (reset della cache locale).
 */
export const resetCloudDeviceState = async () => {
  const userId = currentSession()?.user.id;
  if (!userId) return;
  // Una passata già in volo (es. la prima sync) non riscrive cursore e migrazione appena tolti (P10).
  noteLocalReset();
  await deleteMeta(metaKeys.cursor(userId));
  await deleteMeta(metaKeys.migrated(userId));
  await deleteMeta(metaKeys.merged(userId));
  retryAttempt = 0;
  await requestSync();
};
