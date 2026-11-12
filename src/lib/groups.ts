/** Logica pura dei gruppi: codici di invito, normalizzazione, link condivisibili, merge col server. */

import type { GroupActivity, GroupInvite, GroupResource, StudyGroup } from "../types";
import { bindInviteRecipients } from "./people";

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

export const inviteLinkBase = () => {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}`;
};

/**
 * Link di invito: apre StudyOS direttamente sull'ingresso nel gruppo. Il codice sta nel frammento
 * (#invito=…), che il browser non invia ai server né lascia nei loro log.
 */
export const groupInviteLink = (code: string) => `${inviteLinkBase()}#invito=${encodeURIComponent(normalizeInviteCode(code))}`;

export const groupInviteMessage = (groupName: string, inviter: string, code: string) =>
  `${inviter} ti invita nel gruppo di studio "${groupName}" su StudyOS.\n\nEntra da qui: ${groupInviteLink(code)}\n\nOppure apri Gruppi → Entra con un codice e scrivi ${normalizeInviteCode(code)}`;

/** Gruppi ascoltati in tempo reale al massimo (limite del filtro `in` di Supabase Realtime). */
export const REALTIME_GROUPS_MAX = 100;

/**
 * Id dei gruppi da mettere nel filtro Realtime `group_id=in.(…)`: senza doppioni, ordinati (stesso
 * canale per gli stessi gruppi) e solo con lettere, cifre, `_` e `-`. Una virgola o una parentesi in
 * un id arrivato da altri cambierebbe il filtro: quel gruppo si aggiorna comunque al pull.
 */
export const realtimeGroupIds = (ids: Iterable<string>, max = REALTIME_GROUPS_MAX): string[] =>
  [...new Set([...ids].filter((id) => typeof id === "string" && /^[A-Za-z0-9_-]{1,120}$/.test(id)))].sort().slice(0, max);

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

/**
 * Timbro per ciò che il merge cambia senza un timbro nuovo dal server (membri, `sharedAt`): 1 ms
 * dopo quello attuale. Il cloud personale accetta lo stesso timbro solo con lo stesso contenuto e
 * rifiutava per sempre la copia cambiata («Conflitto cloud irrisolto»). Solo 1 ms e non «adesso»:
 * una modifica vera sul server, anche di poco dopo, deve continuare a vincere.
 */
const nudged = (stamp: string) => new Date(instant(stamp) + 1).toISOString();

/** Ordine fisso dei membri: il server li restituisce in un ordine qualsiasi. */
const byJoin = (members: StudyGroup["members"]) =>
  [...members].sort((a, b) => instant(a.joinedAt) - instant(b.joinedAt) || a.userId.localeCompare(b.userId));

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
 * Esito di una RPC dei gruppi (accept/decline/join) letto dal messaggio dell'errore (supabase/groups.sql):
 * - "handled": l'invito ha già una risposta (da un altro dispositivo dello stesso account);
 * - "not-found": invito o gruppo non esistono più;
 * - "other-account": l'invito è per un altro account (o un vecchio invito per email mai legato a uno);
 * - "invalid-code": codice inesistente o disattivato;
 * - "unavailable": rete, sessione o server. Solo questo è da riprovare: l'invito resta in attesa.
 */
export type GroupRpcOutcome = "ok" | "handled" | "not-found" | "other-account" | "invalid-code" | "unavailable";

export const classifyGroupRpcError = (error: { message?: string | null } | null | undefined): GroupRpcOutcome => {
  if (!error) return "ok";
  const text = String(error.message ?? "");
  if (/già gestito/i.test(text)) return "handled";
  if (/invito non trovato/i.test(text)) return "not-found";
  if (/altro account/i.test(text)) return "other-account";
  if (/codice non valido/i.test(text)) return "invalid-code";
  return "unavailable";
};

const INVITE_NOTIFICATION_PREFIX = "notif-group-invite-";

interface InviteNotification {
  id: string;
  kind: string;
  linkGroupId?: string;
  readAt?: string;
  updatedAt: string;
}

/**
 * Notifiche «accetta o rifiuta» di inviti che non sono più in attesa (accettati o rifiutati da un altro
 * dispositivo, ritirati, gruppo eliminato): diventano lette. Stesso array se non cambia nulla.
 * `invites` deve essere l'elenco già unito con il server, `me` l'id dell'account.
 */
export const settleInviteNotifications = <N extends InviteNotification>(notifications: N[], invites: GroupInvite[], me: string, now: string): N[] => {
  if (!me) return notifications;
  const pending = invites.filter((invite) => invite.status === "pending" && isReceivedInvite(invite, me));
  const pendingIds = new Set(pending.map((invite) => invite.id));
  const pendingGroups = new Set(pending.map((invite) => invite.groupId));
  let changed = false;
  const next = notifications.map((item) => {
    if (item.kind !== "invite" || item.readAt || !item.linkGroupId) return item;
    // Id stabile: vale il suo invito. Notifiche vecchie (id casuale): basta un invito in attesa per il gruppo.
    const inviteId = item.id.startsWith(INVITE_NOTIFICATION_PREFIX) ? item.id.slice(INVITE_NOTIFICATION_PREFIX.length) : null;
    const stillPending = inviteId ? pendingIds.has(inviteId) : pendingGroups.has(item.linkGroupId);
    if (stillPending) return item;
    changed = true;
    return { ...item, readAt: now, updatedAt: now };
  });
  return changed ? next : notifications;
};

/** Id della notifica di un invito: uguale su ogni dispositivo dell'account, così non si duplica. */
export const inviteNotificationId = (inviteId: string) => `${INVITE_NOTIFICATION_PREFIX}${inviteId}`;

/** `updated_at` della prima riga restituita da una scrittura, in ISO (ms); undefined se manca o non è una data. */
export const serverStampOf = (data: unknown) => {
  const value = Array.isArray(data) ? (data[0] as { updated_at?: unknown } | undefined)?.updated_at : undefined;
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
};

/**
 * Copia locale con il timbro scritto dal server (trigger `studyos_group_stamp` di groups.sql), se
 * nel frattempo non è cambiata (`sent`: il timbro mandato). null se non c'è nulla da cambiare.
 * Con l'orologio del dispositivo avanti il timbro locale restava più nuovo delle modifiche
 * successive degli altri membri, che non arrivavano mai.
 */
export const withServerStamp = <T extends { id: string; updatedAt: string }>(items: readonly T[], id: string, stamp: string | undefined, sent?: string): T[] | null => {
  if (!stamp) return null;
  const item = items.find((entry) => entry.id === id);
  if (!item || item.updatedAt === stamp || (sent !== undefined && item.updatedAt !== sent)) return null;
  return items.map((entry) => (entry.id === id ? { ...entry, updatedAt: stamp } : entry));
};

// ——— Inviti ricevuti: un solo percorso, per account ———
// Da supabase/people.sql un invito nominale vale solo per l'account destinatario (recipient_user_id):
// il client legge, notifica e chiude gli inviti ricevuti solo per id utente, mai per email. L'email
// resta su un invito solo come storia di prima della migrazione: quelli che la migrazione ha legato
// arrivano dal server con recipientUserId; gli altri non si possono più accettare.

/** Invito ricevuto dal mio account (lo ha mandato un altro). */
export const isReceivedInvite = (invite: Pick<GroupInvite, "fromUserId" | "recipientUserId">, me: string) =>
  Boolean(me) && invite.fromUserId !== me && invite.recipientUserId === me;

/**
 * Copia locale di un invito ricevuto per email prima della migrazione e mai legato a un account: il
 * server non la restituisce più (si legge per account) e non si può accettare. Serve solo a toglierla.
 */
export const isLegacyEmailInvite = (invite: Pick<GroupInvite, "fromUserId" | "recipientUserId" | "recipientEmail">, me: string) =>
  invite.fromUserId !== me && !invite.recipientUserId && Boolean(invite.recipientEmail);

/** Nome di riserva di chi non ha un nome nel profilo: lo stesso del server (studyos_member_name). */
export const NEUTRAL_MEMBER_NAME = "Studente";

/**
 * Nome che altre persone vedono (membri, cronologia, notifiche, i loro agenti): quello del profilo,
 * altrimenti «Studente». Non riceve l'email apposta: chi trova qualcuno con il @nome non deve poterne
 * dedurre l'indirizzo. Al massimo 80 caratteri, come sul server.
 */
export const visibleMemberName = (profileName: string | null | undefined) =>
  (profileName?.trim() || NEUTRAL_MEMBER_NAME).slice(0, 80);

/** Invito che il client può pubblicare da sé: solo con codice, senza destinatario (la policy rifiuta gli altri). */
export const isCodeOnlyInvite = (invite: Pick<GroupInvite, "recipientUserId" | "recipientEmail">) => !invite.recipientUserId && !invite.recipientEmail;

/**
 * Inviti nuovi da segnalare con una notifica: solo quelli ricevuti dal mio account e ancora in attesa.
 * Quelli che ho mandato io tornano dal server (creati lì da invite_person_to_group) e non vanno
 * notificati a me, come quelli con codice o di altri membri.
 */
export const invitesToNotify = (fresh: GroupInvite[], me: string): GroupInvite[] =>
  fresh.filter((invite) => invite.status === "pending" && isReceivedInvite(invite, me));

export interface MergeSharedOptions {
  /**
   * La lettura degli inviti ricevuti dal mio account è completa (tutti quelli in attesa): un invito
   * ricevuto in attesa qui ma non più sul server è stato ritirato o il gruppo eliminato.
   */
  receivedComplete?: boolean;
}

/**
 * Unisce lo stato condiviso scaricato con quello locale. `queriedGroupIds` sono i gruppi chiesti
 * al server (quelli di cui risulto membro); per quelli che il server restituisce:
 * - i membri sono quelli del server (chi entra con invito/codice non cambia la data del gruppo,
 *   e una rimozione deve sparire anche qui);
 * - le risorse già viste sul server (`sharedAt`) o di altri che non ci sono più sono state
 *   cancellate: si tolgono. Le proprie mai confermate restano (pubblicazione non ancora riuscita).
 * Un gruppo già visto sul server, chiesto e non più restituito è stato eliminato o mi hanno
 * rimosso: sparisce con bacheca, cronologia e inviti. I gruppi solo locali non vengono toccati.
 */
export const mergeSharedSnapshot = (
  current: SharedSnapshot,
  incoming: SharedSnapshot,
  me: string,
  queriedGroupIds: Iterable<string> = [],
  options: MergeSharedOptions = {}
) => {
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
      const members = remote.members.length ? byJoin(remote.members) : group.members;
      // Stesso oggetto se nulla cambia: lo store salva (e accoda alla sync) per riferimento.
      if (group.sharedAt && JSON.stringify(members) === JSON.stringify(group.members)) return group;
      return { ...group, members, sharedAt: group.sharedAt ?? remote.updatedAt, updatedAt: nudged(group.updatedAt) };
    });

  const invites = newerWins(current.invites, incoming.invites);
  const serverInvites = new Set(incoming.invites.map((invite) => invite.id));
  // La migrazione di people.sql lega gli inviti per email all'account (e ne aggiorna updated_at): il
  // legame resta anche se la copia locale sembra più recente (newerWins la terrebbe).
  const boundInvites = bindInviteRecipients(invites.next, incoming.invites);
  // Un invito ricevuto in attesa che il server non ha più restava qui per sempre (con la scheda
  // «Accetta» che finiva in «Invito non trovato»): si toglie. Quelli già risposti restano come storia.
  // Anche la copia di un invito per email mai legato a un account: il server non la manda più.
  const withdrawn = (invite: GroupInvite) =>
    Boolean(options.receivedComplete) &&
    invite.status === "pending" &&
    (isReceivedInvite(invite, me) || isLegacyEmailInvite(invite, me)) &&
    !serverInvites.has(invite.id);
  // Gruppo sparito: i suoi inviti locali vanno con lui; quelli che il server restituisce ancora sono veri
  // (es. un invito nominale in attesa per chi è stato tolto dal gruppo).
  const nextInvites = boundInvites.filter(
    (invite) => !(gone.has(invite.groupId) && !serverInvites.has(invite.id)) && !withdrawn(invite)
  );

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
      return remote && !resource.sharedAt ? { ...resource, sharedAt: remote.updatedAt, updatedAt: nudged(resource.updatedAt) } : resource;
    });

  const activities = newerWins(current.activities, incoming.activities);

  return {
    groups: nextGroups,
    invites: nextInvites,
    resources: nextResources,
    activities: activities.next.filter((activity) => !gone.has(activity.groupId)),
    freshInvites: invites.fresh,
    freshGroups: groups.fresh
  };
};
