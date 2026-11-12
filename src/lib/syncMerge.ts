// Logica di merge del cloud sync (pura, senza I/O: testata in tests/syncMerge.test.mjs).
//
// Strategia: last-writer-wins per entità sul campo `updatedAt` (o `deletedAt` per i
// tombstone). Le modifiche locali non ancora inviate (outbox) vincono solo se più recenti.

import {
  COLLECTION_BY_ENTITY_TYPE,
  COLLECTIONS,
  ENTITY_TYPES,
  timestampOf,
  type CollectionKey,
  type CollectionsState,
  type SyncableEntity
} from "./collections";

export interface RemoteRow {
  entity_type: string;
  entity_id: string;
  payload: unknown;
  deleted: boolean;
  updated_at: string;
  client_id?: string | null;
}

export interface PendingOutbox {
  deleted: boolean;
  deletedAt?: string;
}

export interface PlannedChange {
  collection: CollectionKey;
  id: string;
  entity: SyncableEntity | null;
  /** Timestamp LWW del valore remoto: lo store lo ricontrolla al momento dell'applicazione. */
  stamp: number;
  /** Il valore dell'account sostituisce quello locale anche se più recente (vedi `accountWins`). */
  force?: true;
}

export interface MergeOptions {
  /** Pull forzato: il remoto vince su tutto. */
  force?: boolean;
  /**
   * Collezioni in cui la copia dell'account vince sempre su quella del dispositivo (primo
   * collegamento dell'account qui). Il dispositivo può avere nome e foto di un'altra persona:
   * con last-writer-wins la copia locale, se più recente, sostituiva quella dell'account.
   */
  accountWins?: ReadonlySet<CollectionKey>;
  /**
   * Righe da non applicare: la loro verità è altrove (gruppi pubblicati → tabelle condivise, vedi
   * syncScope). Contano come ignorate; la coda locale di quelle chiavi la sistema il push.
   */
  skip?: (collection: CollectionKey, row: RemoteRow, local: SyncableEntity | undefined) => boolean;
}

export interface MergePlan {
  changes: PlannedChange[];
  /** Entità locali più recenti del remoto da (ri)accodare per l'invio. */
  requeue: Array<{ collection: CollectionKey; id: string }>;
  /** Chiavi outbox superate da una versione remota più recente. */
  dropOutbox: string[];
  skipped: number;
  ignored: number;
}

const keyOf = (collection: CollectionKey, id: string) => `${ENTITY_TYPES[collection]}:${id}`;

const isEntity = (value: unknown, id: string): value is SyncableEntity =>
  Boolean(value) && typeof value === "object" && (value as SyncableEntity).id === id;

/**
 * Copia da inviare per una voce accodata da un'altra pagina (senza Web Locks, P15): quella su disco se
 * è più recente di quella in memoria (la scheda che ha accodato l'ha salvata dopo), altrimenti quella
 * in memoria. Una riga su disco non valida non sostituisce mai la memoria.
 */
export const newerCopy = (id: string, memory: SyncableEntity, stored: unknown): SyncableEntity =>
  isEntity(stored, id) && timestampOf(stored.updatedAt) > timestampOf(memory.updatedAt) ? stored : memory;

const remoteStamp = (row: RemoteRow) => {
  const payload = (row.payload ?? {}) as { updatedAt?: string; deletedAt?: string };
  const own = row.deleted ? payload.deletedAt ?? payload.updatedAt : payload.updatedAt;
  return timestampOf(own) || timestampOf(row.updated_at);
};

/**
 * Il cloud ha rifiutato la copia di qui e la sua ha lo stesso timbro (al millisecondo): accetta
 * lo stesso timbro solo con lo stesso contenuto, e il merge a parità non sceglie, quindi la voce
 * restava in coda per sempre («Conflitto cloud irrisolto»). Vince la copia di qui con il timbro
 * 1 ms dopo, non «adesso»: una modifica vera arrivata dopo deve continuare a vincere.
 * null se non è un pareggio (o la riga del cloud è un'eliminazione): decide il merge come sempre.
 */
export const tieBreakStamp = (local: Pick<SyncableEntity, "updatedAt"> | undefined, remote: RemoteRow): string | null => {
  if (!local || remote.deleted) return null;
  const stamp = timestampOf(local.updatedAt);
  if (!stamp || stamp !== remoteStamp(remote)) return null;
  return new Date(stamp + 1).toISOString();
};

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/** Senza regex con lookbehind (Safari prima della 16.4 non la compila). */
const cleanString = (value: string) => {
  let out = "";
  let changed = false;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code === 0) {
      changed = true;
      continue;
    }
    if (isHigh(code) && index + 1 < value.length && isLow(value.charCodeAt(index + 1))) {
      out += value[index] + value[index + 1];
      index += 1;
      continue;
    }
    if (isHigh(code) || isLow(code)) {
      out += "�";
      changed = true;
      continue;
    }
    out += value[index];
  }
  return changed ? out : value;
};

// eslint-disable-next-line no-control-regex
const SUSPECT = /[\u0000\uD800-\uDFFF]/;

/**
 * Copia inviabile al cloud: jsonb rifiuta `\u0000` e i surrogati spaiati (una mezza emoji tagliata
 * da uno slice), e un solo valore così faceva fallire per sempre tutto il lotto di 200 righe. Lo zero
 * si toglie, il mezzo carattere diventa U+FFFD. Stesso oggetto se non c'è niente da cambiare.
 */
export const wellFormedForJsonb = <T>(value: T): T => {
  if (typeof value === "string") {
    // Controllo veloce: quasi tutte le stringhe (anche gli allegati in base64) non hanno né zeri né surrogati.
    return (SUSPECT.test(value) ? cleanString(value) : value) as T;
  }
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const clean = wellFormedForJsonb(item);
      if (clean !== item) changed = true;
      return clean;
    });
    return (changed ? next : value) as T;
  }
  if (value && typeof value === "object") {
    let changed = false;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const cleanKey = wellFormedForJsonb(key);
      const clean = wellFormedForJsonb(item);
      if (clean !== item || cleanKey !== key) changed = true;
      next[cleanKey] = clean;
    }
    return (changed ? next : value) as T;
  }
  return value;
};

export const indexCollections = (state: CollectionsState) =>
  Object.fromEntries(
    COLLECTIONS.map((key) => [key, new Map((state[key] as unknown as SyncableEntity[]).map((item) => [item.id, item]))])
  ) as Record<CollectionKey, Map<string, SyncableEntity>>;

export const planMerge = (
  rows: RemoteRow[],
  local: CollectionsState,
  pending: Map<string, PendingOutbox>,
  options: MergeOptions = {}
): MergePlan => {
  const plan: MergePlan = { changes: [], requeue: [], dropOutbox: [], skipped: 0, ignored: 0 };
  const index = indexCollections(local);
  // Se la stessa entità compare più volte (pagine sovrapposte) vale l'ultima riga ricevuta.
  const latest = new Map<string, RemoteRow>();
  for (const row of rows) latest.set(`${row.entity_type}:${row.entity_id}`, row);

  for (const row of latest.values()) {
    const collection = COLLECTION_BY_ENTITY_TYPE[row.entity_type];
    if (!collection || !row.entity_id) {
      plan.ignored += 1;
      continue;
    }
    if (!row.deleted && !isEntity(row.payload, row.entity_id)) {
      plan.ignored += 1;
      continue;
    }
    const key = keyOf(collection, row.entity_id);
    const stamp = remoteStamp(row);
    const localEntity = index[collection].get(row.entity_id);
    if (options.skip?.(collection, row, localEntity)) {
      plan.ignored += 1;
      continue;
    }
    const localPending = pending.get(key);
    const accountWins = Boolean(options.accountWins?.has(collection));

    if (options.force || accountWins) {
      // Con accountWins la modifica va applicata anche se la copia locale è più recente: lo store
      // altrimenti la scarterebbe (ricontrollo LWW in applyRemoteChanges).
      const flag = accountWins ? { force: true as const } : {};
      if (row.deleted) {
        if (localEntity) plan.changes.push({ collection, id: row.entity_id, entity: null, stamp, ...flag });
        else plan.skipped += 1;
      } else {
        plan.changes.push({ collection, id: row.entity_id, entity: row.payload as SyncableEntity, stamp, ...flag });
      }
      if (localPending) plan.dropOutbox.push(key);
      continue;
    }

    if (row.deleted) {
      if (!localEntity) {
        if (localPending && (!localPending.deleted || stamp >= timestampOf(localPending.deletedAt))) {
          plan.dropOutbox.push(key);
        }
        plan.skipped += 1;
        continue;
      }
      if (stamp >= timestampOf(localEntity.updatedAt)) {
        plan.changes.push({ collection, id: row.entity_id, entity: null, stamp });
        if (localPending) plan.dropOutbox.push(key);
      } else if (!localPending) {
        // Modificata localmente dopo l'eliminazione remota: la versione locale "risorge".
        plan.requeue.push({ collection, id: row.entity_id });
      } else {
        plan.skipped += 1;
      }
      continue;
    }

    const remoteEntity = row.payload as SyncableEntity;
    if (!localEntity) {
      if (localPending?.deleted && timestampOf(localPending.deletedAt) >= stamp) {
        plan.skipped += 1; // eliminata qui dopo l'ultima modifica remota: il tombstone partirà al push
        continue;
      }
      plan.changes.push({ collection, id: row.entity_id, entity: remoteEntity, stamp });
      if (localPending) plan.dropOutbox.push(key);
      continue;
    }

    const localStamp = timestampOf(localEntity.updatedAt);
    if (stamp > localStamp) {
      plan.changes.push({ collection, id: row.entity_id, entity: remoteEntity, stamp });
      if (localPending) plan.dropOutbox.push(key);
    } else if (stamp < localStamp && !localPending) {
      plan.requeue.push({ collection, id: row.entity_id });
    } else {
      plan.skipped += 1;
    }
  }
  return plan;
};

/** Converte lo snapshot legacy (riga unica `snapshot/main`) in righe per-entità. */
export const legacySnapshotToRows = (snapshot: Partial<CollectionsState> | null | undefined, updatedAt: string): RemoteRow[] => {
  if (!snapshot) return [];
  const rows: RemoteRow[] = [];
  for (const key of COLLECTIONS) {
    const items = snapshot[key];
    if (!Array.isArray(items)) continue;
    for (const item of items as unknown as SyncableEntity[]) {
      if (!item || typeof item.id !== "string") continue;
      rows.push({
        entity_type: ENTITY_TYPES[key],
        entity_id: item.id,
        payload: item.updatedAt ? item : { ...item, updatedAt },
        deleted: false,
        updated_at: updatedAt
      });
    }
  }
  return rows;
};

/** Suddivide le righe da inviare in batch rispettando un limite di byte e di righe. */
export const chunkBySize = <T>(items: T[], sizeOf: (item: T) => number, maxBytes: number, maxRows: number): T[][] => {
  const batches: T[][] = [];
  let current: T[] = [];
  let bytes = 0;
  for (const item of items) {
    const size = sizeOf(item);
    if (current.length && (bytes + size > maxBytes || current.length >= maxRows)) {
      batches.push(current);
      current = [];
      bytes = 0;
    }
    current.push(item);
    bytes += size;
  }
  if (current.length) batches.push(current);
  return batches;
};

/**
 * Voci "put" in coda la cui entità non è in memoria (es. creata in un'altra scheda o finestra).
 * Senza vault la riga può essere ancora su disco: si invia quella, invece di perdere la modifica
 * mentre il badge dice «Sincronizzato». Col vault (una sola scheda: non succede) o se la riga non
 * c'è più, la voce si scarta: una voce put non diventa mai un'eliminazione cloud.
 * `stored`: riga letta da IndexedDB per chiave outbox.
 */
export const planOrphanPuts = <T extends { key: string; entityId: string }>(
  orphans: T[],
  stored: ReadonlyMap<string, unknown>,
  vault: boolean
): { send: Array<{ row: T; entity: SyncableEntity }>; drop: T[] } => {
  const plan: { send: Array<{ row: T; entity: SyncableEntity }>; drop: T[] } = { send: [], drop: [] };
  for (const row of orphans) {
    const entity = vault ? undefined : stored.get(row.key);
    if (isEntity(entity, row.entityId)) plan.send.push({ row, entity });
    else plan.drop.push(row);
  }
  return plan;
};
