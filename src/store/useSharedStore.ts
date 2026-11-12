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
  supersededOutboxKeys,
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
  /**
   * Prima di un invio: le voci risultano tentate, anche su disco. Se la risposta si perde la riga può
   * essere già sul server, e un'eliminazione successiva deve mandare il tombstone.
   */
  markAttempted: (entries: readonly SharedOutboxEntry[]) => Promise<void>;
  /** Fine di un invio: `entries` escono dalla coda (le accettate), `accepted` sono quelle che il server ha scritto. */
  settlePushed: (entries: readonly SharedOutboxEntry[], accepted: readonly SharedOutboxEntry[]) => Promise<void>;
  /**
   * Voci rifiutate dal server: escono dalla coda solo insieme alla riga riletta (`rows`), che prende il
   * loro posto in cache. Se la rilettura non riesce restano in coda e la passata dopo riprova, invece di
   * mostrare come salvata una modifica che il server non ha.
   */
  settleRejected: (ownerId: string, entries: readonly SharedOutboxEntry[], rows: readonly RemoteSharedRow[]) => Promise<void>;
  toggleOwner: (ownerId: string) => void;
  setNotice: (text: string | null) => void;
  setSyncError: (text: string | null) => void;
  /**
   * Vault bloccato: via i dati altrui dalla memoria (la cache su disco, se c'è, resta). Le modifiche non
   * ancora inviate restano da parte, fuori dallo stato, finché lo stesso account sblocca.
   */
  forgetMemory: () => void;
  /** Logout, cambio account o reset: via memoria, tabelle e meta della condivisione. */
  clear: () => Promise<void>;
}

const readHidden = () => {
  const value = readUiState(HIDDEN_KEY, "device");
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
};

const pendingKeys = (outbox: readonly SharedOutboxEntry[]) => new Set(outbox.map((entry) => entry.key));

const sentKey = (entry: SharedOutboxEntry) => `${entry.key}|${entry.queuedAt}`;

/** Modifiche non ancora inviate di chi guarda e gli elementi a cui puntano. */
interface PendingWrites {
  viewerId: string;
  outbox: SharedOutboxEntry[];
  items: SharedItem[];
}

const pendingWritesOf = (state: Pick<SharedState, "viewerId" | "outbox" | "items">): PendingWrites | null => {
  if (!state.viewerId || !state.outbox.length) return null;
  const keys = pendingKeys(state.outbox);
  return { viewerId: state.viewerId, outbox: [...state.outbox], items: state.items.filter((entry) => keys.has(entry.key)) };
};

/** Unione per chiave: a parità vince `over`. */
const unionByKey = <T extends { key: string }>(base: readonly T[], over: readonly T[]) => {
  const keys = new Set(over.map((entry) => entry.key));
  return [...base.filter((entry) => !keys.has(entry.key)), ...over];
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
  /**
   * Modifiche in coda messe da parte al blocco del vault (forgetMemory): fuori dallo stato, quindi
   * nessuna vista le mostra, e valgono solo per lo sblocco dello stesso account (hydrate). Col vault
   * non c'è disco: senza di questo il blocco perderebbe le modifiche non ancora inviate.
   */
  let parked: PendingWrites | null = null;

  /**
   * Modifiche in coda dello stesso account da portare nel nuovo caricamento: quelle in memoria (vault
   * attivato o tolto) o quelle messe da parte al blocco. Le due non convivono: il blocco svuota la
   * memoria e il caricamento dopo le riprende. Un altro account non eredita nulla.
   */
  const takePendingWrites = (viewerId: string): PendingWrites | null => {
    const live = get().viewerId === viewerId ? pendingWritesOf(get()) : null;
    const stashed = parked?.viewerId === viewerId ? parked : null;
    parked = null;
    return live ?? stashed;
  };

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

  /** Su disco le modifiche portate da hydrate, se sono ancora quelle in memoria (le più nuove le scrive writeItems). */
  const persistCarried = (carried: PendingWrites) =>
    toDisk(() => {
      const state = get();
      const items = state.items.filter((entry) => carried.items.includes(entry));
      const outbox = state.outbox.filter((entry) => carried.outbox.includes(entry));
      const removed = outbox.filter((entry) => entry.deleted).map((entry) => entry.key);
      return db.transaction("rw", [db.sharedItems, db.sharedOutbox], async () => {
        if (removed.length) await db.sharedItems.bulkDelete(removed);
        if (items.length) await db.sharedItems.bulkPut(items);
        if (outbox.length) await db.sharedOutbox.bulkPut(outbox);
      });
    });

  /**
   * Righe del server nella cache (LWW). Una voce in coda superata da una versione del server uguale o
   * più recente esce dalla coda: inviarla riscriverebbe la versione del proprietario a nome di chi guarda.
   */
  const withServerRows = (ownerId: string, rows: readonly RemoteSharedRow[], outbox: readonly SharedOutboxEntry[]) => {
    const live = withoutSupersededRows(rows, ownerId, outbox);
    const items = mergeSharedRows(get().items, ownerId, live, pendingKeys(outbox));
    const superseded = supersededOutboxKeys(get().items, ownerId, live, outbox);
    return { items, outbox: superseded.size ? outbox.filter((entry) => !superseded.has(entry.key)) : [...outbox] };
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
      // Stesso account (vault attivato o tolto, sblocco): le modifiche non ancora inviate restano in coda,
      // e passano su disco se ora c'è. Prese qui, dopo le attese: valgono anche quelle fatte nel frattempo.
      const carried = takePendingWrites(viewerId);
      if (carried) {
        const deleted = new Set(carried.outbox.filter((entry) => entry.deleted).map((entry) => entry.key));
        items = unionByKey(items.filter((entry) => !deleted.has(entry.key)), carried.items);
        outbox = unionByKey(outbox, carried.outbox);
      }
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
      if (carried) await persistCarried(carried);
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
      const before = get().outbox;
      const { items, outbox } = withServerRows(ownerId, rows, before);
      await writeItems(items, outbox.length === before.length ? undefined : outbox);
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
      const queued = state.outbox.find((candidate) => candidate.key === key);
      const next: SharedItem = {
        key,
        ownerId,
        entityType,
        entityId: entity.id,
        entity: prepareSharedWrite(previous?.entity, entity, now) as SharedEntity,
        serverUpdatedAt: previous?.serverUpdatedAt ?? ""
      };
      const entry: SharedOutboxEntry = {
        key,
        ownerId,
        entityType,
        entityId: entity.id,
        deleted: false,
        queuedAt: now,
        // Una versione di prima forse già arrivata al server resta tale: l'eliminazione manderà il tombstone.
        ...(queued?.attempted ? { attempted: true } : {})
      };
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
      // Creato qui, ancora in coda, mai inviato e senza versione sul server: non c'è nulla da eliminare
      // lassù. Dopo un invio tentato no: la risposta può essersi persa con la riga già scritta.
      const queued = state.outbox.find((candidate) => candidate.key === key);
      const neverReachedServer = previous.serverUpdatedAt === "" && queued !== undefined && !queued.deleted && !queued.attempted;
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

    markAttempted: async (entries) => {
      if (!get().viewerId) return;
      const sent = new Set(entries.map(sentKey));
      const before = get().outbox;
      // Stessa chiave e stesso queuedAt: per settle e per il segnale di voci nuove (shareSync) resta la stessa voce.
      const outbox = before.map((entry) => (!entry.attempted && sent.has(sentKey(entry)) ? { ...entry, attempted: true } : entry));
      if (outbox.some((entry, index) => entry !== before[index])) await writeItems(get().items, outbox);
    },

    settlePushed: async (entries, accepted) => {
      if (!get().viewerId) return;
      const state = get();
      const done = new Set(entries.map(sentKey));
      const outbox = state.outbox.filter((entry) => !done.has(sentKey(entry)));
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

    settleRejected: async (ownerId, entries, rows) => {
      if (!get().viewerId) return;
      // Una modifica fatta durante l'invio ha un queuedAt diverso: resta in coda, e vince se più recente.
      const done = new Set(entries.map(sentKey));
      const { items, outbox } = withServerRows(ownerId, rows, get().outbox.filter((entry) => !done.has(sentKey(entry))));
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

    forgetMemory: () => {
      // Una seconda chiamata, a memoria già vuota, non perde ciò che è stato messo da parte.
      if (get().viewerId) parked = pendingWritesOf(get());
      set({ ...EMPTY });
    },

    clear: async () => {
      parked = null;
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
