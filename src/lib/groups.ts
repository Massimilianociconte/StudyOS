/** Logica pura dei gruppi: codici di invito, normalizzazione, link condivisibili, merge col server. */

import type { GroupActivity, GroupInvite, GroupResource, StudyGroup } from "../types";

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Casuale crittografico: il codice è l'unica chiave per unirsi a un gruppo. */
const secureRandom = () => {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return value[0] / 2 ** 32;
};

const randomCodePart = (length: number, random: () => number = secureRandom) =>
  Array.from({ length }, () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]).join("");

/** Codice condivisibile tipo GRP-XXXX-XXXX (niente caratteri ambigui). */
export const makeGroupInviteCode = (random?: () => number) => `GRP-${randomCodePart(4, random)}-${randomCodePart(4, random)}`;

export const normalizeInviteCode = (value: string) => value.trim().toUpperCase().replace(/[\s-]+/g, "-");

export const isInviteCodeShape = (value: string) => /^GRP-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeInviteCode(value));

const inviteLinkBase = () => {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}`;
};

/**
 * Link di invito: apre StudyOS direttamente sull'ingresso nel gruppo. Il codice sta nel frammento
 * (#invito=…), che il browser non invia ai server né lascia nei loro log.
 */
export const groupInviteLink = (code: string) => `${inviteLinkBase()}#invito=${encodeURIComponent(normalizeInviteCode(code))}`;

export const groupInviteMessage = (groupName: string, inviter: string, code: string) =>
  `${inviter} ti invita nel gruppo di studio "${groupName}" su StudyOS.\n\nEntra da qui: ${groupInviteLink(code)}\n\nOppure apri Gruppi → Unisciti con codice e inserisci ${normalizeInviteCode(code)}`;

export interface SharedSnapshot {
  groups: StudyGroup[];
  invites: GroupInvite[];
  resources: GroupResource[];
  activities: GroupActivity[];
}

type Dated = { id: string; updatedAt: string };

/** Istante confrontabile: Postgres restituisce "+00:00" e microsecondi, il client "Z". */
const instant = (value: string) => {
  const time = Date.parse(value);
  return Number.isNaN(time) ? 0 : time;
};

const newerWins = <T extends Dated>(current: T[], incoming: T[]) => {
  const map = new Map(current.map((item) => [item.id, item]));
  const fresh: T[] = [];
  for (const item of incoming) {
    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      fresh.push(item);
    } else if (instant(item.updatedAt) > instant(existing.updatedAt)) {
      map.set(item.id, item);
    }
  }
  return { next: [...map.values()], fresh };
};

/**
 * Unisce lo stato condiviso scaricato con quello locale. `queriedGroupIds` sono i gruppi chiesti
 * al server (quelli di cui risulto membro); per quelli che il server restituisce:
 * - i membri sono quelli del server (chi entra con invito/codice non cambia la data del gruppo,
 *   e una rimozione deve sparire anche qui);
 * - le risorse già viste sul server (`sharedAt`) o di altri che non ci sono più sono state
 *   cancellate: si tolgono. Le proprie mai confermate restano (pubblicazione non ancora riuscita).
 * Un gruppo già visto sul server, chiesto e non più restituito è stato eliminato o mi hanno
 * rimosso: sparisce con bacheca e cronologia. I gruppi solo locali non vengono toccati.
 */
export const mergeSharedSnapshot = (current: SharedSnapshot, incoming: SharedSnapshot, me: string, queriedGroupIds: Iterable<string> = []) => {
  const serverGroups = new Map(incoming.groups.map((group) => [group.id, group]));
  const queried = new Set(queriedGroupIds);
  const gone = new Set(
    current.groups.filter((group) => group.sharedAt && queried.has(group.id) && !serverGroups.has(group.id)).map((group) => group.id)
  );

  const groups = newerWins(current.groups, incoming.groups);
  const nextGroups = groups.next
    .filter((group) => !gone.has(group.id))
    .map((group) => {
      const remote = serverGroups.get(group.id);
      if (!remote) return group;
      const members = remote.members.length ? remote.members : group.members;
      // Stesso oggetto se nulla cambia: lo store salva (e accoda alla sync) per riferimento.
      if (group.sharedAt && JSON.stringify(members) === JSON.stringify(group.members)) return group;
      return { ...group, members, sharedAt: group.sharedAt ?? remote.updatedAt };
    });

  const invites = newerWins(current.invites, incoming.invites);

  const serverResources = new Map(incoming.resources.map((resource) => [resource.id, resource]));
  const resources = newerWins(current.resources, incoming.resources);
  const nextResources = resources.next
    .filter((resource) => !gone.has(resource.groupId))
    .filter(
      (resource) =>
        !serverGroups.has(resource.groupId) ||
        serverResources.has(resource.id) ||
        (resource.addedByUserId === me && !resource.sharedAt)
    )
    .map((resource) => {
      const remote = serverResources.get(resource.id);
      return remote && !resource.sharedAt ? { ...resource, sharedAt: remote.updatedAt } : resource;
    });

  const activities = newerWins(current.activities, incoming.activities);

  return {
    groups: nextGroups,
    invites: invites.next,
    resources: nextResources,
    activities: activities.next.filter((activity) => !gone.has(activity.groupId)),
    freshInvites: invites.fresh,
    freshGroups: groups.fresh
  };
};
