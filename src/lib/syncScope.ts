// Cosa porta la sincronizzazione personale (studyos_items) e cosa no.
//
// I gruppi pubblicati hanno già la loro verità nelle tabelle condivise (studyos_groups, membri,
// bacheca, cronologia, inviti), lette da ogni dispositivo con le policy RLS. Tenerne anche una copia
// nel cloud personale creava due verità con regole diverse: un'uscita dal gruppo lasciava un
// tombstone «adesso» che vinceva per sempre sul rientro (timbro vecchio del server), e un merge che
// cambiava membri o `sharedAt` faceva rifiutare la copia («Conflitto cloud irrisolto»).
// Ora il cloud personale porta solo ciò che esiste solo qui: gruppi non ancora pubblicati, con la
// loro bacheca, cronologia e inviti, e le risorse proprie non ancora pubblicate.

import type { CollectionKey } from "./collections";

export const GROUP_COLLECTIONS: ReadonlySet<CollectionKey> = new Set<CollectionKey>([
  "studyGroups",
  "groupInvites",
  "groupResources",
  "groupActivities"
]);

/** Gruppo come lo vede chi decide: basta sapere se è pubblicato. */
export type GroupLookup = (groupId: string) => { sharedAt?: string } | undefined;

const field = (entity: unknown, key: string) =>
  entity && typeof entity === "object" ? (entity as Record<string, unknown>)[key] : undefined;

/**
 * true se l'entità ha la sua verità nelle tabelle condivise e non va nel cloud personale.
 * - gruppo: pubblicato (`sharedAt`);
 * - risorsa della bacheca: vista sul server (`sharedAt`); una propria non ancora pubblicata resta;
 * - cronologia: del gruppo pubblicato;
 * - invito: del gruppo pubblicato, oppure di un gruppo che qui non c'è (invito ricevuto).
 */
export const isServerBacked = (collection: CollectionKey, entity: unknown, groupOf: GroupLookup): boolean => {
  if (!GROUP_COLLECTIONS.has(collection)) return false;
  if (collection === "studyGroups" || collection === "groupResources") return Boolean(field(entity, "sharedAt"));
  const groupId = field(entity, "groupId");
  const group = typeof groupId === "string" ? groupOf(groupId) : undefined;
  if (collection === "groupInvites") return !group || Boolean(group.sharedAt);
  return Boolean(group?.sharedAt);
};

/** Gruppi per id da più elenchi: il primo che ha l'id vince (es. stato attuale, poi quello di prima). */
export const groupLookup = (...lists: Array<Iterable<{ id: string; sharedAt?: string }>>): GroupLookup => {
  const map = new Map<string, { sharedAt?: string }>();
  for (const list of lists) {
    for (const group of list) if (!map.has(group.id)) map.set(group.id, group);
  }
  return (groupId) => map.get(groupId);
};
