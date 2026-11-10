// Dati di altre persone (condivisioni ricevute) e condivisioni proprie. Separato da useStudyStore:
// niente commit(), niente coda di sync personale, niente backup. Le scritture sono ottimistiche e
// finiscono in sharedOutbox; src/lib/shareSync.ts (caricato in differita) le invia al server.
// Con il vault attivo (`persistent: false`) tutto resta in memoria.

import { create } from "zustand";
import { db, getMeta, setMeta } from "../lib/db";
import {
  dropUnshared,
  mergeSharedRows,
  prepareSharedWrite,
  reconcileOwner,
  sharedKey,
  sharedWriteError,
  ShareUserError,
  type RemoteSharedRow,
  type ShareGrant,
  type ShareInviteSummary,
  type SharedEntity,
  type SharedItem,
  type SharedOutboxEntry,
  type SharedSubjectLabel,
  withoutSupersededRows
} from "../lib/sharing";
import { readUiState, writeUiState } from "../lib/uiState";

/** off = niente account o cloud; missing = supabase/sharing.sql non eseguito. */
export type SharingAvailability = "unknown" | "off" | "missing" | "ready";

const VIEWER_META = "share:viewer";
const GRANTS_META = "share:grants";
const HIDDEN_KEY = "sharing.hiddenOwners";
const STORAGE_ERROR = "Non riesco a salvare su questo dispositivo i dati condivisi: restano in memoria finché l'app è aperta.";

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
  /** Fine di un invio: `entries` inviate, `accepted` quelle che il server ha scritto. */
  settlePushed: (entries: readonly SharedOutboxEntry[], accepted: readonly SharedOutboxEntry[]) => Promise<void>;
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
  /**
   * Scrive su disco, se si può. Se l'archivio non risponde (quota, blocco, navigazione privata) la
   * cache passa alla sola memoria, come col vault: l'operazione, già applicata in memoria, non fallisce.
   */
  const toDisk = async (operation: () => Promise<unknown>) => {
    if (!get().persistent) return;
    try {
      await operation();
    } catch {
      set({ persistent: false, syncError: STORAGE_ERROR });
    }
  };

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
    await toDisk(() =>
      db.transaction("rw", [db.sharedItems, db.sharedOutbox], async () => {
        if (put.length) await db.sharedItems.bulkPut(put);
        if (remove.length) await db.sharedItems.bulkDelete(remove);
        if (outboxPut.length) await db.sharedOutbox.bulkPut(outboxPut);
        if (outboxRemove.length) await db.sharedOutbox.bulkDelete(outboxRemove);
      })
    );
  };

  return {
    ...EMPTY,
    availability: "unknown",
    hiddenOwners: readHidden(),
    persistent: true,

    setAvailability: (availability) => set({ availability }),

    hydrate: async (viewerId, persistent) => {
      // Passaggio al vault: subito in sola memoria, prima di qualunque attesa. Una scrittura ancora in
      // corso (setShares, applyRows…) non arriva più sul disco dopo che clearTables lo ha svuotato.
      if (!persistent) set({ persistent: false });
      // Un errore dell'archivio non blocca l'avvio: si lavora in memoria e lo si segnala.
      let storageFailed = false;
      const failed = () => {
        storageFailed = true;
        return undefined;
      };
      const cachedViewer = await getMeta<string>(VIEWER_META).catch(failed);
      const reuse = persistent && cachedViewer === viewerId;
      if (!reuse) await clearTables().catch(failed);
      if (persistent) await setMeta(VIEWER_META, viewerId).catch(failed);
      let items: SharedItem[] = [];
      let outbox: SharedOutboxEntry[] = [];
      let grants: GrantsSnapshot | undefined;
      if (reuse) {
        try {
          [items, outbox, grants] = await Promise.all([db.sharedItems.toArray(), db.sharedOutbox.toArray(), getMeta<GrantsSnapshot>(GRANTS_META)]);
        } catch {
          storageFailed = true;
        }
      }
      // Col vault (persistent: false) un errore nel pulire il disco non cambia nulla: resta tutto in memoria.
      const degraded = persistent && storageFailed;
      set({
        ...EMPTY,
        viewerId,
        persistent: persistent && !degraded,
        items,
        outbox,
        given: grants?.viewerId === viewerId ? grants.given : [],
        received: grants?.viewerId === viewerId ? grants.received : [],
        syncError: degraded ? STORAGE_ERROR : null
      });
    },

    // Senza `viewerId` (logout, cambio account, vault bloccato) una risposta in ritardo non fa nulla:
    // non deve rimettere in memoria, né scrivere su disco, dati altrui.
    setShares: async (given, received, invites) => {
      const viewerId = get().viewerId;
      if (!viewerId) return;
      const items = dropUnshared(get().items, received, pendingKeys(get().outbox));
      set({ given, received, invites });
      await writeItems(items);
      if (get().viewerId !== viewerId) return;
      await toDisk(() => setMeta(GRANTS_META, { viewerId, given, received } satisfies GrantsSnapshot));
    },

    setLabels: (labels) => set({ labels }),

    applyRows: async (ownerId, rows) => {
      if (!get().viewerId) return;
      const outbox = get().outbox;
      await writeItems(mergeSharedRows(get().items, ownerId, withoutSupersededRows(rows, ownerId, outbox), pendingKeys(outbox)));
    },

    reconcile: async (ownerId, types, visible) => {
      if (!get().viewerId) return;
      await writeItems(reconcileOwner(get().items, ownerId, types, visible, pendingKeys(get().outbox)));
    },

    saveSharedItem: async (ownerId, entityType, entity) => {
      const state = get();
      const key = sharedKey(ownerId, entityType, entity.id);
      const previous = state.items.find((entry) => entry.key === key);
      const error = sharedWriteError(state.received, ownerId, entityType, previous?.entity, entity);
      if (error) throw new ShareUserError(error);
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
      if (error) throw new ShareUserError(error);
      const now = new Date().toISOString();
      // Creato qui e ancora in coda, senza versione sul server: non c'è nulla da eliminare lassù.
      const neverReachedServer = previous.serverUpdatedAt === "" && state.outbox.some((candidate) => candidate.key === key && !candidate.deleted);
      const outbox = state.outbox.filter((candidate) => candidate.key !== key);
      if (!neverReachedServer) outbox.push({ key, ownerId, entityType, entityId, deleted: true, deletedAt: now, queuedAt: now });
      await writeItems(state.items.filter((candidate) => candidate.key !== key), outbox);
    },

    settleOutbox: async (entries) => {
      // Una modifica fatta durante l'invio ha un queuedAt diverso: resta in coda.
      const done = new Set(entries.map((entry) => `${entry.key}|${entry.queuedAt}`));
      const outbox = get().outbox.filter((entry) => !done.has(`${entry.key}|${entry.queuedAt}`));
      // Un elemento tenuto solo per la scrittura in coda, con la condivisione ormai revocata, esce ora.
      await writeItems(dropUnshared(get().items, get().received, pendingKeys(outbox)), outbox);
    },

    settlePushed: async (entries, accepted) => {
      if (!get().viewerId) return;
      const state = get();
      const done = new Set(entries.map((entry) => `${entry.key}|${entry.queuedAt}`));
      const outbox = state.outbox.filter((entry) => !done.has(`${entry.key}|${entry.queuedAt}`));
      const written = new Set(accepted.filter((entry) => !entry.deleted).map((entry) => entry.key));
      const now = new Date().toISOString();
      // Ora la riga esiste sul server: un'eliminazione successiva deve mandare il tombstone.
      // Il pull rimette la versione vera del server; qui basta che non sia più vuota.
      const items = state.items.map((entry) => (written.has(entry.key) && entry.serverUpdatedAt === "" ? { ...entry, serverUpdatedAt: now } : entry));
      // Creato qui ed eliminato mentre l'invio era in corso: allora sembrava mai arrivato al server
      // (nessun tombstone), ma la riga c'è e il pull lo riporterebbe in vita.
      const cached = new Set(items.map((entry) => entry.key));
      const pending = pendingKeys(outbox);
      for (const entry of accepted) {
        if (!written.has(entry.key) || cached.has(entry.key) || pending.has(entry.key)) continue;
        outbox.push({ key: entry.key, ownerId: entry.ownerId, entityType: entry.entityType, entityId: entry.entityId, deleted: true, deletedAt: now, queuedAt: now });
        pending.add(entry.key);
      }
      await writeItems(dropUnshared(items, get().received, pendingKeys(outbox)), outbox);
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
      // Le persone nascoste sono una scelta di questo account: un reset o un altro accesso non le eredita.
      set({ ...EMPTY, hiddenOwners: [], availability: get().availability === "missing" ? "missing" : "off" });
      writeUiState(HIDDEN_KEY, [], "device");
      await clearTables().catch(() => undefined);
    }
  };
});

/**
 * Elementi altrui dei tipi richiesti, senza le persone nascoste dall'utente. Restituisce un array
 * nuovo: si usa in useMemo sui campi letti dallo store, mai come selettore diretto.
 */
export const sharedOfTypes = (state: Pick<SharedState, "items" | "hiddenOwners">, entityTypes: readonly string[]) =>
  state.items.filter((entry) => entityTypes.includes(entry.entityType) && !state.hiddenOwners.includes(entry.ownerId));
