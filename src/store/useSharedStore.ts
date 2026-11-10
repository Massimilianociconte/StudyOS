// Dati di altre persone (condivisioni ricevute) e condivisioni proprie. Separato da useStudyStore:
// niente commit(), niente coda di sync personale, niente backup. Le scritture sono ottimistiche e
// finiscono in sharedOutbox; src/lib/shareSync.ts (caricato in differita) le invia al server.
// Con il vault attivo (`persistent: false`) tutto resta in memoria.

import { create } from "zustand";
import { timestampOf } from "../lib/collections";
import { db, deleteMeta, getMeta, setMeta } from "../lib/db";
import {
  dropUnshared,
  mergeSharedRows,
  prepareSharedWrite,
  reconcileOwner,
  sharedKey,
  sharedWriteError,
  type RemoteSharedRow,
  type ShareGrant,
  type ShareInviteSummary,
  type SharedEntity,
  type SharedItem,
  type SharedOutboxEntry,
  type SharedSubjectLabel
} from "../lib/sharing";
import { readUiState, writeUiState } from "../lib/uiState";

/** off = niente account o cloud; missing = supabase/sharing.sql non eseguito. */
export type SharingAvailability = "unknown" | "off" | "missing" | "ready";

const VIEWER_META = "share:viewer";
const GRANTS_META = "share:grants";
const HIDDEN_KEY = "sharing.hiddenOwners";

interface GrantsSnapshot {
  viewerId: string;
  given: ShareGrant[];
  received: ShareGrant[];
}

export interface SharedState {
  availability: SharingAvailability;
  viewerId: string | null;
  given: ShareGrant[];
  received: ShareGrant[];
  invites: ShareInviteSummary[];
  items: SharedItem[];
  labels: SharedSubjectLabel[];
  outbox: SharedOutboxEntry[];
  hiddenOwners: string[];
  /** Avviso da mostrare una volta (es. permesso tolto mentre c'erano modifiche in coda). */
  notice: string | null;
  syncError: string | null;
  persistent: boolean;
  setAvailability: (value: SharingAvailability) => void;
  hydrate: (viewerId: string, persistent: boolean) => Promise<void>;
  setShares: (given: ShareGrant[], received: ShareGrant[], invites: ShareInviteSummary[]) => Promise<void>;
  setLabels: (labels: SharedSubjectLabel[]) => void;
  applyRows: (ownerId: string, rows: readonly RemoteSharedRow[]) => Promise<void>;
  reconcile: (ownerId: string, types: readonly string[], visible: ReadonlySet<string>) => Promise<void>;
  saveSharedItem: (ownerId: string, entityType: string, entity: SharedEntity) => Promise<void>;
  deleteSharedItem: (ownerId: string, entityType: string, entityId: string) => Promise<void>;
  settleOutbox: (entries: readonly SharedOutboxEntry[]) => Promise<void>;
  toggleOwner: (ownerId: string) => void;
  setNotice: (text: string | null) => void;
  setSyncError: (text: string | null) => void;
  /** Vault bloccato: via i dati altrui dalla memoria, la cache su disco (se c'è) resta. */
  forgetMemory: () => void;
  /** Logout, cambio account o reset: via memoria, tabelle e meta della condivisione. */
  clear: () => Promise<void>;
}

const readHidden = () => {
  const value = readUiState(HIDDEN_KEY, "device");
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
};

const pendingKeys = (outbox: readonly SharedOutboxEntry[]) => new Set(outbox.map((entry) => entry.key));

/**
 * Una mia eliminazione in coda non lascia l'elemento in cache, quindi mergeSharedRows non la
 * riconosce: una riga del server più vecchia dell'eliminazione la riporterebbe in vita.
 */
const withoutSupersededRows = (rows: readonly RemoteSharedRow[], ownerId: string, outbox: readonly SharedOutboxEntry[]) => {
  const tombstones = new Map(outbox.filter((entry) => entry.deleted).map((entry) => [entry.key, entry]));
  if (!tombstones.size) return rows;
  return rows.filter((row) => {
    const tombstone = row.deleted ? undefined : tombstones.get(sharedKey(ownerId, row.entity_type, row.entity_id));
    if (!tombstone) return true;
    const remoteAt = typeof row.payload.updatedAt === "string" ? row.payload.updatedAt : undefined;
    return timestampOf(remoteAt) > timestampOf(tombstone.deletedAt ?? tombstone.queuedAt);
  });
};

const diffItems = (before: readonly SharedItem[], after: readonly SharedItem[]) => {
  const previous = new Map(before.map((entry) => [entry.key, entry]));
  const next = new Set(after.map((entry) => entry.key));
  return {
    put: after.filter((entry) => previous.get(entry.key) !== entry),
    remove: before.filter((entry) => !next.has(entry.key)).map((entry) => entry.key)
  };
};

const clearTables = async () => {
  await db.transaction("rw", [db.sharedItems, db.sharedOutbox, db.meta], async () => {
    await db.sharedItems.clear();
    await db.sharedOutbox.clear();
    await db.meta.filter((row) => row.key.startsWith("share:")).delete();
  });
};

const EMPTY = {
  viewerId: null,
  given: [],
  received: [],
  invites: [],
  items: [],
  labels: [],
  outbox: [],
  notice: null,
  syncError: null
} satisfies Partial<SharedState>;

export const useSharedStore = create<SharedState>((set, get) => {
  /** Applica un nuovo elenco di elementi (e di voci in coda) in memoria e, se si può, su disco. */
  const writeItems = async (items: SharedItem[], outbox?: SharedOutboxEntry[]) => {
    const before = get().items;
    const beforeOutbox = get().outbox;
    set(outbox ? { items, outbox } : { items });
    if (!get().persistent) return;
    const { put, remove } = diffItems(before, items);
    const outboxPut = outbox ? outbox.filter((entry) => !beforeOutbox.includes(entry)) : [];
    const outboxRemove = outbox ? beforeOutbox.filter((entry) => !outbox.some((next) => next.key === entry.key)).map((entry) => entry.key) : [];
    if (!put.length && !remove.length && !outboxPut.length && !outboxRemove.length) return;
    await db.transaction("rw", [db.sharedItems, db.sharedOutbox], async () => {
      if (put.length) await db.sharedItems.bulkPut(put);
      if (remove.length) await db.sharedItems.bulkDelete(remove);
      if (outboxPut.length) await db.sharedOutbox.bulkPut(outboxPut);
      if (outboxRemove.length) await db.sharedOutbox.bulkDelete(outboxRemove);
    });
  };

  return {
    ...EMPTY,
    availability: "unknown",
    hiddenOwners: readHidden(),
    persistent: true,

    setAvailability: (availability) => set({ availability }),

    hydrate: async (viewerId, persistent) => {
      const cachedViewer = await getMeta<string>(VIEWER_META).catch(() => undefined);
      const reuse = persistent && cachedViewer === viewerId;
      if (!reuse) await clearTables().catch(() => undefined);
      if (persistent) await setMeta(VIEWER_META, viewerId).catch(() => undefined);
      const [items, outbox, grants] = reuse
        ? await Promise.all([db.sharedItems.toArray(), db.sharedOutbox.toArray(), getMeta<GrantsSnapshot>(GRANTS_META)])
        : [[], [], undefined];
      set({
        ...EMPTY,
        viewerId,
        persistent,
        items,
        outbox,
        given: grants?.viewerId === viewerId ? grants.given : [],
        received: grants?.viewerId === viewerId ? grants.received : []
      });
    },

    setShares: async (given, received, invites) => {
      const items = dropUnshared(get().items, received, pendingKeys(get().outbox));
      set({ given, received, invites });
      await writeItems(items);
      const viewerId = get().viewerId;
      if (get().persistent && viewerId) {
        await setMeta(GRANTS_META, { viewerId, given, received } satisfies GrantsSnapshot).catch(() => undefined);
      }
    },

    setLabels: (labels) => set({ labels }),

    applyRows: async (ownerId, rows) => {
      const outbox = get().outbox;
      await writeItems(mergeSharedRows(get().items, ownerId, withoutSupersededRows(rows, ownerId, outbox), pendingKeys(outbox)));
    },

    reconcile: async (ownerId, types, visible) => {
      await writeItems(reconcileOwner(get().items, ownerId, types, visible, pendingKeys(get().outbox)));
    },

    saveSharedItem: async (ownerId, entityType, entity) => {
      const state = get();
      const key = sharedKey(ownerId, entityType, entity.id);
      const previous = state.items.find((entry) => entry.key === key);
      const error = sharedWriteError(state.received, ownerId, entityType, previous?.entity, entity);
      if (error) throw new Error(error);
      const now = new Date().toISOString();
      const next: SharedItem = {
        key,
        ownerId,
        entityType,
        entityId: entity.id,
        entity: prepareSharedWrite(previous?.entity, entity, now) as SharedEntity,
        serverUpdatedAt: previous?.serverUpdatedAt ?? ""
      };
      const entry: SharedOutboxEntry = { key, ownerId, entityType, entityId: entity.id, deleted: false, queuedAt: now };
      await writeItems(
        previous ? state.items.map((candidate) => (candidate.key === key ? next : candidate)) : [...state.items, next],
        [...state.outbox.filter((candidate) => candidate.key !== key), entry]
      );
    },

    deleteSharedItem: async (ownerId, entityType, entityId) => {
      const state = get();
      const key = sharedKey(ownerId, entityType, entityId);
      const previous = state.items.find((entry) => entry.key === key);
      if (!previous) return;
      const error = sharedWriteError(state.received, ownerId, entityType, previous.entity, null);
      if (error) throw new Error(error);
      const now = new Date().toISOString();
      const entry: SharedOutboxEntry = { key, ownerId, entityType, entityId, deleted: true, deletedAt: now, queuedAt: now };
      await writeItems(
        state.items.filter((candidate) => candidate.key !== key),
        [...state.outbox.filter((candidate) => candidate.key !== key), entry]
      );
    },

    settleOutbox: async (entries) => {
      // Una modifica fatta durante l'invio ha un queuedAt diverso: resta in coda.
      const done = new Set(entries.map((entry) => `${entry.key}|${entry.queuedAt}`));
      await writeItems(get().items, get().outbox.filter((entry) => !done.has(`${entry.key}|${entry.queuedAt}`)));
    },

    toggleOwner: (ownerId) => {
      const current = get().hiddenOwners;
      const hiddenOwners = current.includes(ownerId) ? current.filter((id) => id !== ownerId) : [...current, ownerId];
      writeUiState(HIDDEN_KEY, hiddenOwners, "device");
      set({ hiddenOwners });
    },

    setNotice: (notice) => set({ notice }),
    setSyncError: (syncError) => set({ syncError }),

    forgetMemory: () => set({ ...EMPTY }),

    clear: async () => {
      set({ ...EMPTY, availability: get().availability === "missing" ? "missing" : "off" });
      await clearTables().catch(() => undefined);
      await deleteMeta(VIEWER_META).catch(() => undefined);
    }
  };
});

/**
 * Elementi altrui dei tipi richiesti, senza le persone nascoste dall'utente. Restituisce un array
 * nuovo: si usa in useMemo sui campi letti dallo store, mai come selettore diretto.
 */
export const sharedOfTypes = (state: Pick<SharedState, "items" | "hiddenOwners">, entityTypes: readonly string[]) =>
  state.items.filter((entry) => entityTypes.includes(entry.entityType) && !state.hiddenOwners.includes(entry.ownerId));
