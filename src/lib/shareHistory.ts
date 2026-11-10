// Cronologia delle modifiche di altri: quali versioni si possono ripristinare e l'annullamento in un
// colpo delle modifiche di una persona. Solo funzioni pure: le usano shareSync.ts e la scheda
// "Modifiche di altri", entrambe caricate con import(), quindi resta fuori dal bundle iniziale.

import { timestampOf } from "./collections";
import {
  PROTECTED_ENTITY_TYPES,
  canRestoreRevision,
  revisionActorName,
  type ItemRevision,
  type RestoreVersion,
  type ShareGrant
} from "./sharing";

type Payload = Record<string, unknown>;

/** Prima la più vecchia; a parità di ora (stessa transazione) vale l'ordine di inserimento. */
const byChange = (a: ItemRevision, b: ItemRevision) => timestampOf(a.changedAt) - timestampOf(b.changedAt) || a.id - b.id;

const sameEntity = (a: ItemRevision, b: ItemRevision) => a.entityType === b.entityType && a.entityId === b.entityId;

/** L'ultima eliminazione dello stesso elemento dopo `revision` (conserva copertine e file), se c'è. */
export const laterDeletion = (revision: ItemRevision, revisions: readonly ItemRevision[]) =>
  revisions
    .filter((other) => other.change === "delete" && sameEntity(other, revision) && byChange(other, revision) > 0)
    .sort(byChange)
    .at(-1) ?? null;

/**
 * Il ripristino di questa versione fallirebbe di sicuro: è la versione di una modifica (senza copertine
 * e file) di un elemento che il proprietario non ha su questo dispositivo, e nessuna eliminazione
 * successiva li conserva. `revisions` è l'elenco caricato, dalle più recenti: chi è più recente di una
 * riga dell'elenco ci sta anche lui.
 */
export const restoreBlocked = (revision: ItemRevision, revisions: readonly ItemRevision[], hasLocal: (entityType: string, entityId: string) => boolean) =>
  revision.change === "update" &&
  PROTECTED_ENTITY_TYPES.has(revision.entityType) &&
  !hasLocal(revision.entityType, revision.entityId) &&
  !laterDeletion(revision, revisions);

/** Dove sta un elemento oggi: la copia del proprietario su questo dispositivo e la riga sul server. */
export interface ItemState {
  local: { updatedAt?: string } | null;
  /** `updatedAt`: orologio del server, come `changedAt` delle revisioni. */
  server: { updatedAt: string; deleted: boolean } | null;
}

export interface RevertEntry {
  /** La versione prima della prima modifica della persona da quel giorno. */
  revision: ItemRevision;
  /**
   * L'eliminazione successiva che conserva copertine e file, quando servono e il proprietario non ha
   * l'elemento su questo dispositivo (la versione di una modifica non li ha).
   */
  deletedAfter: ItemRevision | null;
  /** Dopo la persona l'ha cambiato anche qualcun altro: quelle modifiche si perdono. */
  othersAfter: boolean;
  /** Dopo l'ultima modifica salvata l'ha cambiato il proprietario: le sue modifiche si perdono. */
  ownerAfter: boolean;
  /** L'ha eliminato il proprietario dopo l'ultima modifica salvata: tornerebbe tra i suoi dati. */
  ownerDeleted: boolean;
}

export interface RevertPlan {
  restore: RevertEntry[];
  /** Elementi aggiunti dalla persona che ci sono ancora: non c'è una versione prima, restano. */
  added: number;
  /** Elementi eliminati dopo dal proprietario la cui versione non ha i file: restano eliminati. */
  gone: number;
  /** Sul server ci sono ma non ancora su questo dispositivo, e la versione non ha i file: si saltano. */
  notHere: number;
}

/** Elementi (tipo e id) che la persona ha cambiato da `since`: di questi serve sapere dove stanno oggi. */
export const touchedEntities = (revisions: readonly ItemRevision[], actorId: string, since: string) => {
  const from = timestampOf(since);
  const seen = new Map<string, { entityType: string; entityId: string }>();
  for (const revision of revisions) {
    if (revision.changedBy !== actorId || timestampOf(revision.changedAt) < from) continue;
    seen.set(`${revision.entityType}:${revision.entityId}`, { entityType: revision.entityType, entityId: revision.entityId });
  }
  return [...seen.values()];
};

/**
 * Annulla tutte le modifiche di una persona da `since`: ogni elemento torna alla versione prima della
 * sua prima modifica, con lo stesso ripristino di un elemento solo. `revisions` sono le revisioni di
 * tutti da `since` (servono per le eliminazioni successive e per le modifiche di altri); `stateOf`
 * dice dove sta oggi ogni elemento. Le scritture del proprietario non lasciano revisioni: si
 * riconoscono da un `updatedAt` più recente dell'ultima revisione dell'elemento.
 */
export const planRevert = (
  revisions: readonly ItemRevision[],
  actorId: string,
  since: string,
  stateOf: (entityType: string, entityId: string) => ItemState
): RevertPlan => {
  const from = timestampOf(since);
  const byEntity = new Map<string, ItemRevision[]>();
  for (const revision of revisions) {
    if (timestampOf(revision.changedAt) < from) continue;
    const key = `${revision.entityType}:${revision.entityId}`;
    byEntity.set(key, [...(byEntity.get(key) ?? []), revision]);
  }
  const plan: RevertPlan = { restore: [], added: 0, gone: 0, notHere: 0 };
  for (const list of byEntity.values()) {
    list.sort(byChange);
    const index = list.findIndex((revision) => revision.changedBy === actorId);
    if (index < 0) continue;
    const first = list[index];
    const later = list.slice(index + 1);
    const { local, server } = stateOf(first.entityType, first.entityId);
    // Creato dalla persona (anche rimettendo un elemento eliminato): prima non c'era nulla. Si conta
    // solo se c'è ancora.
    if (first.change === "create" || first.deleted) {
      if (local || server?.deleted === false) plan.added += 1;
      continue;
    }
    if (!canRestoreRevision(first)) continue;
    const lastAt = timestampOf(list[list.length - 1].changedAt);
    const ownerWrote = (local ? timestampOf(local.updatedAt) > lastAt : false) || (server ? timestampOf(server.updatedAt) > lastAt : false);
    // Versione di una modifica senza la copia del proprietario: copertine e file solo da un'eliminazione dopo.
    const needsSource = first.change === "update" && !local && PROTECTED_ENTITY_TYPES.has(first.entityType);
    const deletedAfter = needsSource ? (later.filter((revision) => revision.change === "delete").at(-1) ?? null) : null;
    if (needsSource && !deletedAfter) {
      if (server?.deleted === false) plan.notHere += 1;
      else plan.gone += 1;
      continue;
    }
    const ownerDeleted = !local && server?.deleted === true && ownerWrote;
    plan.restore.push({
      revision: first,
      deletedAfter,
      othersAfter: later.some((revision) => revision.changedBy !== actorId),
      ownerAfter: ownerWrote && !ownerDeleted,
      ownerDeleted
    });
  }
  return plan;
};

/** Cambiato dopo da altri o dal proprietario (anche eliminato): si può scegliere di lasciarlo com'è. */
const changedAfter = (entry: RevertEntry) => entry.othersAfter || entry.ownerAfter || entry.ownerDeleted;

/** Gli elementi che l'annullamento riscrive, saltando quelli cambiati dopo se lo si è scelto. */
export const entriesToRun = (plan: RevertPlan, skipChanged: boolean) =>
  skipChanged ? plan.restore.filter((entry) => !changedAfter(entry)) : plan.restore;

/** Conteggi di un annullamento, per la conferma e per l'esito. */
export interface RevertSummary {
  /** Elementi che tornano com'erano (con la scelta fatta). */
  toRestore: number;
  added: number;
  gone: number;
  notHere: number;
  /** Tra quelli che tornano: cambiati dopo da altri, dal proprietario, eliminati dal proprietario. */
  othersAfter: number;
  ownerAfter: number;
  ownerDeleted: number;
  /** Cambiati dopo da altri o dal proprietario: quanti si possono lasciare come sono. */
  changedAfter: number;
  /** Lasciati come sono per scelta. */
  skipped: number;
  /** Esito: riscritti davvero, e quelli che non si sono potuti riscrivere. */
  restored: number;
  notRestored: number;
}

export const revertSummary = (plan: RevertPlan, skipChanged: boolean): RevertSummary => {
  const run = entriesToRun(plan, skipChanged);
  const count = (flag: keyof Pick<RevertEntry, "othersAfter" | "ownerAfter" | "ownerDeleted">) => run.filter((entry) => entry[flag]).length;
  return {
    toRestore: run.length,
    added: plan.added,
    gone: plan.gone,
    notHere: plan.notHere,
    othersAfter: count("othersAfter"),
    ownerAfter: count("ownerAfter"),
    ownerDeleted: count("ownerDeleted"),
    changedAfter: plan.restore.filter(changedAfter).length,
    skipped: plan.restore.length - run.length,
    restored: 0,
    notRestored: 0
  };
};

/**
 * Impronta di ciò che l'annullamento farebbe con la scelta fatta: se al momento di confermare è
 * diversa da quella del controllo, il riepilogo letto non vale più e si chiede di nuovo.
 */
export const planKey = (plan: RevertPlan, skipChanged: boolean) =>
  JSON.stringify([
    entriesToRun(plan, skipChanged)
      .map((entry) => [entry.revision.id, entry.deletedAfter?.id ?? null, entry.othersAfter, entry.ownerAfter, entry.ownerDeleted])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
    revertSummary(plan, skipChanged)
  ]);

/**
 * Versioni da riscrivere, dalle versioni intere scaricate per id. Senza la versione, o senza
 * l'eliminazione che serve per copertine e file, l'elemento si salta (`missing`): meglio non
 * ripristinare a metà. Il negozio ricontrolla al momento di scrivere (restoredPayload).
 */
export const revertVersions = (entries: readonly RevertEntry[], payloads: ReadonlyMap<number, Payload>) => {
  const versions: RestoreVersion[] = [];
  let missing = 0;
  for (const { revision, deletedAfter } of entries) {
    const payload = payloads.get(revision.id);
    const source = deletedAfter ? payloads.get(deletedAfter.id) : undefined;
    if (!payload || (deletedAfter && !source)) {
      missing += 1;
      continue;
    }
    versions.push({
      entityType: revision.entityType,
      entityId: revision.entityId,
      payload,
      complete: revision.change === "delete",
      protectedFrom: source ?? null
    });
  }
  return { versions, missing };
};

/**
 * Persone di cui si possono annullare le modifiche: chi ha cambiato qualcosa (`changedBy`, ultimi 90
 * giorni) e chi ha «Può modificare» (direttamente o da un gruppo), mai chi guarda. Nomi uguali (due
 * persone sconosciute) prendono un numero nell'etichetta del menu (`label`); nelle frasi resta `name`.
 */
export const revertCandidates = (
  changedBy: readonly (string | null)[],
  given: readonly ShareGrant[],
  groups: readonly { id: string; members: readonly { userId: string; displayName: string }[] }[],
  me: string
) => {
  const ids = new Set<string>();
  for (const id of changedBy) if (id) ids.add(id);
  for (const grant of given) {
    if (grant.permission !== "edit") continue;
    if (grant.granteeUserId) ids.add(grant.granteeUserId);
    if (grant.granteeGroupId) for (const member of groups.find((group) => group.id === grant.granteeGroupId)?.members ?? []) ids.add(member.userId);
  }
  ids.delete(me);
  const people = [...ids]
    .map((id) => ({ id, name: revisionActorName(id, given, groups) }))
    .sort((a, b) => a.name.localeCompare(b.name, "it") || a.id.localeCompare(b.id));
  const seen = new Map<string, number>();
  return people.map((person) => {
    const count = (seen.get(person.name) ?? 0) + 1;
    seen.set(person.name, count);
    return { ...person, label: count > 1 ? `${person.name} (${count})` : person.name };
  });
};
