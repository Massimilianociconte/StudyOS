// Cambio di account sullo stesso dispositivo (cloudSync bindUser): la scelta tra tenere separati gli
// account e unire i dati, e cosa togliere quando si unisce. Puro: testato in tests/accountSwitch.test.mjs.
//
// Le preferenze sono un documento solo (`preferences:main`) con lo stesso id in ogni account: con
// l'unione vinceva il più recente, e nome e foto dell'account di prima restavano e arrivavano anche
// nel nuovo account. Sono della persona, non del dispositivo: non si uniscono mai.

import type { CollectionKey, CollectionsState } from "./collections";

/** Collezioni della persona (nome, foto, corso, obiettivi di studio): restano quelle del nuovo account. */
export const PERSONAL_COLLECTIONS: readonly CollectionKey[] = ["preferences"];

/** Scelta fatta nel pannello Account: tenere separati gli account (consigliata) o unire. */
export type AccountSwitchChoice = "separate" | "merge";

/**
 * Cosa fare dei dati di questo dispositivo collegandolo a `userId`. "ask": i dati sono di un altro
 * account e nessuno ha ancora scelto, quindi la sincronizzazione aspetta e nulla passa da un account
 * all'altro. Prima la domanda era un confirm() del browser, e «nessuna risposta» (finestre bloccate,
 * Esc, app aperta dentro un'altra app) valeva «unisci»: i dati di una persona finivano nell'account
 * di un'altra. Unire richiede sempre una scelta esplicita.
 */
export const accountSwitchStep = (input: {
  bound: string | undefined | null;
  userId: string;
  hasData: boolean;
  choice?: AccountSwitchChoice | null;
}): "none" | "ask" | AccountSwitchChoice => {
  if (!input.bound || input.bound === input.userId || !input.hasData) return "none";
  return input.choice ?? "ask";
};

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
