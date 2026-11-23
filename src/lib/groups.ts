/** Logica pura dei gruppi: codici di invito, normalizzazione, link condivisibili, merge col server. */

import type { GroupActivity, GroupInvite, GroupResource, GroupResourceRevision, StudyGroup } from "../types";
import { bindInviteRecipients } from "./people";
import { cutAtRunBoundary, redactEmails } from "./institutionalEmail";

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

/**
 * Caratteri al massimo nel nome di un gruppo (caratteri Unicode, come char_length in Postgres). Il server
 * rifiuta un nome più lungo quando lo si scrive o lo si cambia (studyos_groups_name_limit in
 * supabase/group-exams.sql); un nome più vecchio e più lungo arriva agli agenti tagliato a questa lunghezza.
 */
export const GROUP_NAME_MAX = 120;

/**
 * Nome da scrivere sul server: un nome locale più lungo di GROUP_NAME_MAX caratteri Unicode (scritto prima del
 * limite) si taglia al confine di una parola, come per gli agenti (cutAtRunBoundary): mai un pezzo d'indirizzo.
 * Una sola parola più lunga del limite: prima si oscurano gli indirizzi, poi si taglia. Senza il taglio il server
 * rifiuterebbe il nome (studyos_groups_name_limit) e la pubblicazione tornerebbe in coda per sempre.
 */
export const serverGroupName = (name: string): string => {
  if (Array.from(name).length <= GROUP_NAME_MAX) return name;
  const cut = cutAtRunBoundary(name, GROUP_NAME_MAX).trim();
  if (cut) return cut;
  return Array.from(redactEmails(name, false)).slice(0, GROUP_NAME_MAX).join("").trim();
};

/**
 * Il server ha rifiutato il nome del gruppo (23514 o il messaggio di studyos_groups_name_limit): riprovare non serve.
 * Un 23514 di un altro vincolo (per esempio studyos_groups_id_shape di un gruppo vecchio) non è il nome.
 */
export const isGroupNameLimitError = (error: { code?: unknown; message?: unknown } | null | undefined): boolean => {
  if (!error) return false;
  const message = typeof error.message === "string" ? error.message : "";
  if (/nome del gruppo|studyos_groups_name_limit/i.test(message)) return true;
  return error.code === "23514" && !/check constraint|violates/i.test(message);
};

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
  const localResources = new Map(current.resources.map((resource) => [resource.id, resource]));
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
      const local = localResources.get(resource.id);
      // Server con groups.sql precedente (senza la colonna delle versioni): quelle già note qui restano.
      const kept = resource === remote && remote.revisions === undefined && local?.revisions ? { ...resource, revisions: local.revisions } : resource;
      return remote && !kept.sharedAt ? { ...kept, sharedAt: remote.updatedAt, updatedAt: nudged(kept.updatedAt) } : kept;
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

// ——— Righe delle tabelle dei gruppi (supabase/groups.sql) → entità dell'app ———
// Qui e non in groupSync.ts: le usa anche il connettore remoto (agent/cloudRunner.ts), che gira
// nell'hub senza il client Supabase del browser.

export const groupFromRow = (row: Record<string, unknown>): StudyGroup => ({
  id: String(row.id),
  createdAt: String(row.created_at ?? row.createdAt ?? new Date().toISOString()),
  updatedAt: String(row.updated_at ?? row.updatedAt ?? new Date().toISOString()),
  archived: false,
  tags: [],
  name: String(row.name ?? ""),
  description: String(row.description ?? ""),
  ownerId: String(row.owner_id ?? ""),
  ownerDisplayName: String(row.owner_display_name ?? ""),
  members: [],
  inviteCode: String(row.invite_code ?? "")
});

/** Membro di un gruppo; `email` c'è solo se la riga la porta (il connettore remoto la riceve senza). */
export const memberFromRow = (row: Record<string, unknown>): StudyGroup["members"][number] => ({
  userId: String(row.user_id),
  email: (row.email as string | null) ?? undefined,
  displayName: String(row.display_name ?? ""),
  role: (row.role as StudyGroup["members"][number]["role"]) ?? "member",
  joinedAt: String(row.joined_at ?? new Date().toISOString())
});

export const resourceFromRow = (row: Record<string, unknown>): GroupResource => ({
  id: String(row.id),
  createdAt: String(row.created_at ?? new Date().toISOString()),
  updatedAt: String(row.updated_at ?? new Date().toISOString()),
  archived: false,
  tags: [],
  groupId: String(row.group_id ?? ""),
  kind: (row.kind as GroupResource["kind"]) ?? "note",
  title: String(row.title ?? ""),
  url: (row.url as string | null) ?? undefined,
  body: (row.body as string | null) ?? undefined,
  pinned: Boolean(row.pinned),
  addedByUserId: String(row.added_by_user_id ?? ""),
  addedByDisplayName: String(row.added_by_display_name ?? ""),
  revisions: parseResourceRevisions(row.revisions)
});

export const activityFromRow = (row: Record<string, unknown>): GroupActivity => ({
  id: String(row.id),
  createdAt: String(row.created_at ?? new Date().toISOString()),
  updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  archived: false,
  tags: [],
  groupId: String(row.group_id ?? ""),
  actorDisplayName: String(row.actor_display_name ?? ""),
  text: String(row.text ?? "")
});

// ——— Annunci della bacheca: modifiche, versioni precedenti, avvisi agli altri membri ———

/** Versioni precedenti conservate per annuncio: uguale a v_keep in supabase/groups.sql. */
export const MAX_RESOURCE_REVISIONS = 20;

const RESOURCE_KINDS: readonly GroupResource["kind"][] = ["link", "note", "file", "task"];

/** Nome di chi ha modificato quando manca: lo stesso del server (studyos_group_resources_guard). */
export const UNKNOWN_EDITOR = "Un membro";

const optionalText = (value: unknown) => (typeof value === "string" && value ? value : undefined);

/**
 * Versioni arrivate dal server (colonna jsonb `revisions`): solo voci complete. `undefined` se la
 * colonna non c'è (groups.sql precedente): chi riceve tiene allora le versioni che conosce.
 */
export const parseResourceRevisions = (value: unknown): GroupResourceRevision[] | undefined => {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((entry): GroupResourceRevision[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    const id = optionalText(row.id);
    const at = optionalText(row.at);
    if (!id || !at || typeof row.title !== "string" || Number.isNaN(Date.parse(at))) return [];
    const kind = RESOURCE_KINDS.includes(row.kind as GroupResource["kind"]) ? (row.kind as GroupResource["kind"]) : "note";
    return [
      {
        id,
        at,
        byUserId: optionalText(row.byUserId) ?? "",
        byDisplayName: optionalText(row.byDisplayName)?.trim() || UNKNOWN_EDITOR,
        kind,
        title: row.title,
        url: optionalText(row.url),
        body: optionalText(row.body)
      }
    ];
  });
};

/** Le parti di un annuncio che si possono modificare (il tipo resta quello scelto all'inizio). */
export interface ResourceContent {
  title: string;
  url?: string;
  body?: string;
}

/** Testi ripuliti come in addGroupResource: spazi esterni tolti, vuoto = assente. */
export const cleanResourceContent = (content: ResourceContent): ResourceContent => ({
  title: content.title.trim(),
  url: content.url?.trim() || undefined,
  body: content.body?.trim() || undefined
});

export type ResourceChange = "titolo" | "link" | "testo";

/** Cosa cambia passando da una versione all'altra, con le parole dell'interfaccia. */
export const resourceChanges = (before: ResourceContent, after: ResourceContent): ResourceChange[] => {
  const changes: ResourceChange[] = [];
  if (before.title !== after.title) changes.push("titolo");
  if ((before.url ?? "") !== (after.url ?? "")) changes.push("link");
  if ((before.body ?? "") !== (after.body ?? "")) changes.push("testo");
  return changes;
};

/**
 * Modifica fatta sul dispositivo (gruppo solo locale, o server senza la colonna delle versioni): la
 * versione sostituita va in fondo, con chi l'ha cambiata. Nei gruppi condivisi la scrive il server.
 */
export const withResourceRevision = (
  resource: GroupResource,
  editor: { userId: string; displayName: string },
  at: string,
  id: string
): GroupResourceRevision[] =>
  [
    ...(resource.revisions ?? []),
    {
      id,
      at,
      byUserId: editor.userId,
      byDisplayName: editor.displayName.trim() || UNKNOWN_EDITOR,
      kind: resource.kind,
      title: resource.title,
      url: resource.url,
      body: resource.body
    }
  ].slice(-MAX_RESOURCE_REVISIONS);

/** Contenuto subito dopo la versione `index`: la versione successiva o l'annuncio attuale. */
export const contentAfterRevision = (resource: GroupResource, index: number): ResourceContent =>
  resource.revisions?.[index + 1] ?? resource;

/** «modificato il testo», «modificati titolo e testo»: le stesse parole del server (people.sql). */
export const resourceChangesText = (changes: ResourceChange[]) => {
  if (!changes.length) return "modificato il contenuto";
  if (changes.length === 1) return `modificato il ${changes[0]}`;
  return `modificati ${changes.slice(0, -1).join(", ")} e ${changes[changes.length - 1]}`;
};

/**
 * Testo dell'avviso: dove, da parte di chi e cosa è cambiato. Lo stesso della notifica push
 * (studyos_push_board_edit in supabase/people.sql); il nome lo scrive il server.
 */
export const boardEditText = (revision: GroupResourceRevision, after: ResourceContent, groupName: string) => {
  const editor = revision.byDisplayName.trim() || UNKNOWN_EDITOR;
  const group = groupName.trim() || "senza nome";
  const changes = resourceChanges(revision, after);
  const renamed = changes.includes("titolo") ? ` (prima "${revision.title}")` : "";
  return {
    title: `Modifica annuncio in bacheca "${group}" da parte di ${editor}`,
    body: `"${after.title}"${renamed}: ${resourceChangesText(changes)}.`
  };
};

export const BOARD_EDIT_NOTIFICATION_PREFIX = "notif-board-edit-";

export interface BoardEditNotice {
  /** Id stabile: più dispositivi dello stesso account non duplicano l'avviso. */
  id: string;
  groupId: string;
  resourceId: string;
  at: string;
  title: string;
  body: string;
}

/** Oltre questa età una modifica non diventa più un avviso (es. dispositivo rimasto spento a lungo). */
const NOTICE_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** Al più tanti avvisi per annuncio in un solo aggiornamento. */
const NOTICES_PER_RESOURCE = 5;

/**
 * Modifiche di altri membri arrivate con lo scaricamento: una per ogni versione nuova di un annuncio
 * che questo dispositivo conosceva già. Un annuncio mai visto (dispositivo nuovo, gruppo appena
 * raggiunto) non dà avvisi sul suo passato; le proprie modifiche nemmeno.
 */
export const boardEditNotices = ({
  current,
  incoming,
  groups,
  me,
  now = Date.now()
}: {
  current: readonly GroupResource[];
  incoming: readonly GroupResource[];
  groups: readonly Pick<StudyGroup, "id" | "name">[];
  me: string;
  now?: number;
}): BoardEditNotice[] => {
  const local = new Map(current.map((resource) => [resource.id, resource]));
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));
  const notices: BoardEditNotice[] = [];
  for (const resource of incoming) {
    const before = local.get(resource.id);
    if (!before || !resource.revisions?.length) continue;
    const seen = new Set((before.revisions ?? []).map((revision) => revision.id));
    // Copia senza versioni (app o server di prima): conta solo ciò che è successo dopo quella copia.
    const since = before.revisions ? Number.NEGATIVE_INFINITY : instant(before.updatedAt);
    const fresh = resource.revisions
      .map((revision, index) => ({ revision, index }))
      .filter(({ revision }) => {
        const at = instant(revision.at);
        return !seen.has(revision.id) && revision.byUserId !== me && at > since && now - at <= NOTICE_WINDOW_MS;
      })
      .slice(-NOTICES_PER_RESOURCE);
    for (const { revision, index } of fresh) {
      notices.push({
        id: `${BOARD_EDIT_NOTIFICATION_PREFIX}${revision.id}`,
        groupId: resource.groupId,
        resourceId: resource.id,
        at: revision.at,
        ...boardEditText(revision, contentAfterRevision(resource, index), groupNames.get(resource.groupId) ?? "")
      });
    }
  }
  return notices.sort((a, b) => instant(a.at) - instant(b.at));
};

/** Avviso di modifica della bacheca (nel pannello delle notifiche con il logo di StudyOS). */
export const isBoardEditNotification = (notification: { id: string }) => notification.id.startsWith(BOARD_EDIT_NOTIFICATION_PREFIX);
