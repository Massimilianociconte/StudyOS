// Cambio di account sullo stesso dispositivo (cloudSync bindUser), quando si sceglie di unire i dati
// al nuovo account. Puro: testato in tests/accountSwitch.test.mjs.
//
// Le preferenze sono un documento solo (`preferences:main`) con lo stesso id in ogni account: con
// l'unione vinceva il più recente, e nome e foto dell'account di prima restavano e arrivavano anche
// nel nuovo account. Sono della persona, non del dispositivo: non si uniscono mai.

import type { CollectionKey, CollectionsState } from "./collections";

/** Collezioni della persona (nome, foto, corso, obiettivi di studio): restano quelle del nuovo account. */
export const PERSONAL_COLLECTIONS: readonly CollectionKey[] = ["preferences"];

export interface PersonalRemoval {
  collection: CollectionKey;
  id: string;
  entity: null;
  force: true;
}

/**
 * Rimozioni locali da applicare prima di unire i dati al nuovo account (come modifiche remote: niente
 * coda d'invio). Poi la prima sincronizzazione scarica le preferenze del nuovo account, se ne ha.
 */
export const personalRemovals = (state: CollectionsState): PersonalRemoval[] =>
  PERSONAL_COLLECTIONS.flatMap((collection) =>
    (state[collection] as ReadonlyArray<{ id: string }>).map((item) => ({ collection, id: item.id, entity: null, force: true as const }))
  );
