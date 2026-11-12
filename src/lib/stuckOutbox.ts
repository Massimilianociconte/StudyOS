// Voci dell'outbox cloud che non partiranno mai così come sono (P12): oggi gli elementi oltre il limite
// di un invio. Prima restavano in coda per sempre e bloccavano il cambio di account («modifiche cloud
// in attesa») e «Esci e togli i dati da qui», senza dire quali fossero. Qui solo logica pura: la sync
// le segna (`parkedRow`), i conteggi le tengono a parte e il pannello Account le elenca, ne scarica una
// copia o le toglie dalla coda. Finché ci sono, cambio account e svuotamento restano fermi: togliere i
// dati da qui perderebbe l'elemento, che nell'account non c'è.

import type { StudySnapshot } from "../types";
import { COLLECTIONS, type CollectionKey, type CollectionsState, type SyncableEntity } from "./collections";
import type { SyncOutboxRow } from "./db";

export type StuckReason = NonNullable<SyncOutboxRow["parked"]>;

export const isStuck = (row: Pick<SyncOutboxRow, "parked">) => row.parked !== undefined;

/** Modifiche da inviare (che partiranno) e voci ferme. */
export const countOutbox = (rows: ReadonlyArray<Pick<SyncOutboxRow, "parked">>) => {
  const stuck = rows.filter(isStuck).length;
  return { pending: rows.length - stuck, stuck };
};

/**
 * La voce da scrivere per segnarla come troppo grande, o null se non va toccata: già partita,
 * riaccodata da una modifica nuova (queuedAt diverso, si rivaluta alla prossima passata), eliminazione,
 * o già segnata uguale.
 */
export const parkedRow = (
  current: SyncOutboxRow | undefined,
  evaluated: Pick<SyncOutboxRow, "queuedAt">,
  size: number
): SyncOutboxRow | null => {
  if (!current || current.deleted || current.queuedAt !== evaluated.queuedAt) return null;
  if (current.parked === "too-large" && current.parkedSize === size) return null;
  return { ...current, parked: "too-large", parkedSize: size };
};

export interface StuckItem {
  key: string;
  collection: CollectionKey;
  id: string;
  /** Per scartare solo la voce vista nell'elenco, non una riaccodata dopo. */
  queuedAt: number;
  title: string;
  size: number;
  reason: StuckReason;
  /** false: l'elemento non è (più) in memoria qui, la copia scaricata non lo contiene. */
  here: boolean;
}

const titleOf = (entity: unknown) => {
  const record = (entity ?? {}) as { title?: unknown; name?: unknown };
  for (const value of [record.title, record.name]) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
};

export const stuckItems = (rows: ReadonlyArray<SyncOutboxRow>, collections: CollectionsState): StuckItem[] =>
  rows.filter(isStuck).flatMap((row) => {
    if (!(COLLECTIONS as readonly string[]).includes(row.collection)) return [];
    const entity = (collections[row.collection] as unknown as SyncableEntity[]).find((item) => item.id === row.entityId);
    return [
      {
        key: row.key,
        collection: row.collection,
        id: row.entityId,
        queuedAt: row.queuedAt,
        title: titleOf(entity),
        size: row.parkedSize ?? 0,
        reason: row.parked as StuckReason,
        here: Boolean(entity)
      }
    ];
  });

/** Copia (backup parziale, da unire all'importazione) dei soli elementi fermi. */
export const stuckSnapshot = (
  items: ReadonlyArray<Pick<StuckItem, "collection" | "id">>,
  collections: CollectionsState,
  exportedAt: string = new Date().toISOString()
): StudySnapshot => {
  const wanted = new Set(items.map((item) => `${item.collection}:${item.id}`));
  const picked = Object.fromEntries(
    COLLECTIONS.map((key) => [key, (collections[key] as unknown as SyncableEntity[]).filter((item) => wanted.has(`${key}:${item.id}`))])
  ) as unknown as CollectionsState;
  return { version: 1, exportedAt, ...picked };
};

/** Si toglie dalla coda solo la voce vista nell'elenco: ancora ferma e con lo stesso queuedAt. */
export const discardable = (current: SyncOutboxRow | undefined, item: Pick<StuckItem, "queuedAt">) =>
  Boolean(current && isStuck(current) && current.queuedAt === item.queuedAt);
