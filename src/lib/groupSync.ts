import type { RealtimeChannel } from "@supabase/supabase-js";
import type { GroupActivity, GroupInvite, GroupResource, StudyGroup } from "../types";
import { getMeta, setMeta } from "./db";
import {
  classifyGroupRpcError,
  inviteNotificationId,
  invitesToNotify,
  isCodeOnlyInvite,
  makeGroupInviteCode,
  mergeSharedSnapshot,
  normalizeInviteCode,
  realtimeGroupIds,
  serverStampOf,
  settleInviteNotifications,
  visibleMemberName,
  withServerStamp,
  type GroupRpcOutcome,
  type SharedSnapshot
} from "./groups";
import { GROUP_JOINED_EVENT, clearPendingInvite, readPendingInvite } from "./groupInvite";
import { getSession, isCloudConfigured, supabase } from "./supabase";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";

/**
 * Ponte verso le tabelle condivise (supabase/groups.sql): inviti tra account,
 * membri, bacheca e attività di gruppo. Tutto è progressivo:
 * senza login o senza migrazione applicata i gruppi restano locali e gli inviti
 * viaggiano via codice/link copiabile. Nessun errore viene mai mostrato per
 * indisponibilità del backend condiviso.
 */

export interface Actor {
  userId: string;
  displayName: string;
  email?: string;
}

const randomSuffix = () => {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
};

export const getLocalOwnerId = async (): Promise<string> => {
  const KEY = "device:ownerId";
  try {
    const stored = await getMeta<string>(KEY);
    if (stored) return stored;
    const created = `local-${randomSuffix()}`;
    await setMeta(KEY, created);
    return created;
  } catch {
    return `local-${randomSuffix()}`;
  }
};

/** Identità da firmare su membri/attività: account cloud se collegato, altrimenti stabile per dispositivo. */
export const getActor = async (): Promise<Actor> => {
  // Mai dall'email: il nome finisce nei gruppi, nelle notifiche e negli agenti degli altri membri.
  const displayName = visibleMemberName(selectPreferences(useStudyStore.getState()).displayName);
  try {
    const session = await getSession();
    if (session?.user) {
      return { userId: session.user.id, displayName, email: session.user.email ?? undefined };
    }
  } catch {
    // senza rete si resta locali
  }
  return { userId: await getLocalOwnerId(), displayName };
};

const SHARED_META_KEY = "groupSync:shared:v1";
let sharedCache: boolean | null = null;
let sharedCheckedAt = 0;
/** Migrazione assente sul server: si ricontrolla dopo 10 minuti (può essere applicata nel frattempo). */
const UNAVAILABLE_RETRY_MS = 10 * 60 * 1000;

const missingTable = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (/42P01|does not exist|Could not find the table/i.test(`${error.code ?? ""} ${error.message ?? ""}`)));

/** Le tabelle condivise esistono e sono leggibili (migrazione applicata)? */
export const isSharedAvailable = async (): Promise<boolean> => {
  if (sharedCache === true) return true;
  if (sharedCache === false && Date.now() - sharedCheckedAt < UNAVAILABLE_RETRY_MS) return false;
  try {
    // Solo l'esito positivo resta tra le visite: un "no" salvato per sempre impediva di accorgersi
    // della migrazione applicata dopo.
    if ((await getMeta<boolean>(SHARED_META_KEY)) === true) {
      sharedCache = true;
      return true;
    }
  } catch {
    // meta non disponibile: si controlla sul server
  }
  if (!isCloudConfigured() || !supabase) return false;
  try {
    const session = await getSession();
    // Senza sessione non si memorizza nulla: subito dopo il login (es. invito da completare) si
    // deve poter riprovare, non restare "non disponibile" fino al prossimo avvio.
    if (!session) return false;
    const { error } = await supabase.from("studyos_groups").select("id").limit(0);
    if (error && missingTable(error)) {
      sharedCache = false;
      sharedCheckedAt = Date.now();
      return false;
    }
    if (error) return false; // rete/permessi: non memorizzare, si riprova
    sharedCache = true;
    await setMeta(SHARED_META_KEY, true).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
};

/** Da chiamare dopo login/logout o applicazione della migrazione. */
export const resetSharedCache = async () => {
  sharedCache = null;
  try {
    await setMeta(SHARED_META_KEY, null);
  } catch {
    // ignora
  }
  stopInviteSubscription();
  // Account cambiato o uscito: niente più segnali dei gruppi dell'account di prima.
  stopGroupWatch();
};

const toGroup = (row: Record<string, unknown>): StudyGroup => ({
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

const toInvite = (row: Record<string, unknown>): GroupInvite => ({
  id: String(row.id),
  createdAt: String(row.created_at ?? new Date().toISOString()),
  updatedAt: String(row.updated_at ?? new Date().toISOString()),
  archived: false,
  tags: [],
  groupId: String(row.group_id ?? ""),
  groupName: String(row.group_name ?? ""),
  groupDescription: (row.group_description as string | null) ?? undefined,
  fromUserId: String(row.from_user_id ?? ""),
  fromDisplayName: String(row.from_display_name ?? ""),
  recipientEmail: (row.recipient_email as string | null) ?? undefined,
  recipientUserId: (row.recipient_user_id as string | null) ?? undefined,
  code: String(row.code ?? ""),
  status: (row.status as GroupInvite["status"]) ?? "pending"
});

const toResource = (row: Record<string, unknown>): GroupResource => ({
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
  addedByDisplayName: String(row.added_by_display_name ?? "")
});

const toActivity = (row: Record<string, unknown>): GroupActivity => ({
  id: String(row.id),
  createdAt: String(row.created_at ?? new Date().toISOString()),
  updatedAt: String(row.updated_at ?? row.created_at ?? new Date().toISOString()),
  archived: false,
  tags: [],
  groupId: String(row.group_id ?? ""),
  actorDisplayName: String(row.actor_display_name ?? ""),
  text: String(row.text ?? "")
});

type SharedPatch = Partial<
  Pick<ReturnType<typeof useStudyStore.getState>, "studyGroups" | "groupInvites" | "groupResources" | "groupActivities" | "notifications">
>;

/**
 * setState da solo resta in memoria: lo store salva su IndexedDB (e accoda per la sync personale)
 * solo con commit(), esposto come retryPersist. Senza, un refresh perdeva merge e marcature.
 */
const applyShared = async (patch: SharedPatch) => {
  useStudyStore.setState(patch);
  await useStudyStore.getState().retryPersist();
};

const mergeShared = async (snapshot: SharedSnapshot, me: string, queriedGroupIds: string[]) => {
  const state = useStudyStore.getState();
  // La lettura degli inviti ricevuti (recipient_user_id = me) è sempre completa: quelli spariti dal
  // server sono stati ritirati. Il legame all'account dato dalla migrazione resta (mergeSharedSnapshot).
  const merged = mergeSharedSnapshot(
    { groups: state.studyGroups, invites: state.groupInvites, resources: state.groupResources, activities: state.groupActivities },
    snapshot,
    me,
    queriedGroupIds,
    { receivedComplete: true }
  );
  await applyShared({
    studyGroups: merged.groups,
    groupInvites: merged.invites,
    groupResources: merged.resources,
    groupActivities: merged.activities,
    // Inviti risposti altrove o ritirati: la loro notifica «accetta o rifiuta» non resta da leggere.
    notifications: settleInviteNotifications(state.notifications, merged.invites, me, new Date().toISOString())
  });
  return { freshInvites: merged.freshInvites, freshGroups: merged.freshGroups };
};

/** Notifica di un invito ricevuto: id stabile, quindi una sola su tutti i dispositivi dell'account. */
const notifyInvite = (invite: GroupInvite) =>
  useStudyStore
    .getState()
    .addNotification({
      id: inviteNotificationId(invite.id),
      kind: "invite",
      title: `Invito al gruppo "${invite.groupName}"`,
      body: `${invite.fromDisplayName} ti ha invitato${invite.groupDescription ? `: ${invite.groupDescription}` : "."} Apri per accettare o rifiutare.`,
      linkView: "groups",
      linkGroupId: invite.groupId
    })
    .catch(() => undefined);

const notifyFreshInvites = async (fresh: GroupInvite[], me: string) => {
  // Solo quelli ricevuti dal mio account: anche gli inviti mandati da me arrivano dal server come «nuovi».
  for (const invite of invitesToNotify(fresh, me)) await notifyInvite(invite);
};

/** L'account è ancora quello della passata? (uscita o cambio account durante le letture) */
const stillSignedInAs = async (me: string) => {
  try {
    return (await getSession())?.user.id === me;
  } catch {
    return false;
  }
};

/** Inviti ricevuti già risposti: si rileggono per un mese, così uno risposto altrove si allinea qui. */
const RECEIVED_HISTORY_MS = 30 * 24 * 60 * 60 * 1000;
/** Righe per pagina delle risorse (sotto il tetto predefinito di PostgREST, 1000). */
const RESOURCE_PAGE = 500;

let pullRunning: Promise<boolean> | null = null;
let pullQueued: Promise<boolean> | null = null;

/**
 * Scarica le novità condivise: inviti al mio account, risposte ai miei inviti,
 * membri/risorse/attività dei miei gruppi. Ritorna false se non applicabile.
 * Una passata alla volta: chi chiama durante una passata aspetta quella dopo (una sola, che vede
 * anche ciò che è cambiato nel frattempo), così due passate non si sovrascrivono a vicenda.
 */
export const pullSharedUpdates = (): Promise<boolean> => {
  if (!pullRunning) {
    pullRunning = pullOnce().finally(() => {
      pullRunning = null;
    });
    return pullRunning;
  }
  if (pullQueued) return pullQueued;
  pullQueued = pullRunning.then(
    () => {
      pullQueued = null;
      return pullSharedUpdates();
    },
    () => {
      pullQueued = null;
      return pullSharedUpdates();
    }
  );
  return pullQueued;
};

const pullOnce = async (): Promise<boolean> => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch {
    return false;
  }
  if (!session?.user) return false;
  const me = session.user.id;
  // Solo per ripubblicare la mia riga da proprietario (repairOwnership): gli inviti ricevuti si
  // leggono per account (recipient_user_id, supabase/people.sql), l'email non vale come prova.
  const email = (session.user.email ?? "").toLowerCase();
  try {
    const snapshot: SharedSnapshot = { groups: [], invites: [], resources: [], activities: [] };
    /** Gruppi miei sul server in cui la mia riga da proprietario manca. */
    const ownerless: StudyGroup[] = [];
    // Inviti al mio account: tutti quelli in attesa e quelli risposti di recente. Un invito accettato o
    // rifiutato da un altro dispositivo (o ritirato) restava «in attesa» qui per sempre, con la sua
    // notifica da leggere.
    const since = new Date(Date.now() - RECEIVED_HISTORY_MS).toISOString();
    const { data, error } = await supabase
      .from("studyos_group_invites")
      .select("*")
      .eq("recipient_user_id", me)
      .or(`status.eq.pending,updated_at.gte."${since}"`);
    if (error) throw error;
    snapshot.invites.push(...(data ?? []).map(toInvite));
    const { data: sent, error: sentError } = await supabase.from("studyos_group_invites").select("*").eq("from_user_id", me);
    if (sentError) throw sentError;
    snapshot.invites.push(...(sent ?? []).map(toInvite));
    const localGroups = useStudyStore.getState().studyGroups;
    // Le appartenenze vere sono sul server: un gruppo appena accettato o unito con codice (anche
    // da un altro dispositivo) non è ancora tra quelli locali.
    const { data: memberships, error: membershipsError } = await supabase.from("studyos_group_members").select("group_id").eq("user_id", me);
    if (membershipsError) throw membershipsError;
    const myGroupIds = [
      ...new Set([
        ...(memberships ?? []).map((row) => String(row.group_id)),
        ...localGroups.filter((g) => g.ownerId === me || g.members.some((m) => m.userId === me)).map((g) => g.id)
      ])
    ];
    if (myGroupIds.length) {
      const { data: groups, error: groupsError } = await supabase.from("studyos_groups").select("*").in("id", myGroupIds);
      if (groupsError) throw groupsError;
      const { data: members, error: membersError } = await supabase.from("studyos_group_members").select("*").in("group_id", myGroupIds);
      if (membersError) throw membersError;
      const byGroup = new Map<string, StudyGroup["members"]>();
      for (const row of members ?? []) {
        const list = byGroup.get(String(row.group_id)) ?? [];
        list.push({
          userId: String(row.user_id),
          email: (row.email as string | null) ?? undefined,
          displayName: String(row.display_name ?? ""),
          role: (row.role as StudyGroup["members"][number]["role"]) ?? "member",
          joinedAt: String(row.joined_at ?? new Date().toISOString())
        });
        byGroup.set(String(row.group_id), list);
      }
      for (const row of groups ?? []) {
        const group = toGroup(row);
        const local = localGroups.find((g) => g.id === group.id);
        const serverMembers = byGroup.get(group.id);
        if (group.ownerId === me && !serverMembers?.some((member) => member.userId === me)) ownerless.push(group);
        group.members = serverMembers ?? local?.members ?? [];
        snapshot.groups.push(group);
      }
      // A pagine per chiave (id): una risposta troncata dal tetto di righe del server faceva sembrare
      // eliminate le risorse mancanti, che sparivano qui.
      let afterId = "";
      for (;;) {
        let page = supabase.from("studyos_group_resources").select("*").in("group_id", myGroupIds).order("id", { ascending: true }).limit(RESOURCE_PAGE);
        if (afterId) page = page.gt("id", afterId);
        const { data: resources, error: resourcesError } = await page;
        if (resourcesError) throw resourcesError;
        const rows = resources ?? [];
        snapshot.resources.push(...rows.map(toResource));
        if (rows.length < RESOURCE_PAGE) break;
        afterId = String(rows[rows.length - 1].id);
      }
      const { data: activities, error: activitiesError } = await supabase
        .from("studyos_group_activity")
        .select("*")
        .in("group_id", myGroupIds)
        .order("created_at", { ascending: false })
        .limit(200);
      if (activitiesError) throw activitiesError;
      snapshot.activities.push(...(activities ?? []).map(toActivity));
    }
    // Uscita («Esci e togli i dati») o cambio account durante le letture: i dati di prima non devono
    // finire nel profilo svuotato (e da lì nel cloud del prossimo account).
    if (!(await stillSignedInAs(me))) return false;
    const { freshInvites } = await mergeShared(snapshot, me, myGroupIds);
    if (!(await stillSignedInAs(me))) return false;
    await notifyFreshInvites(freshInvites, me);
    lastGroupPullAt = Date.now();
    watchedMe = me;
    await repairOwnership(ownerless, me, email);
    await flushPublishQueue(me);
    // Gruppi cambiati (entrato, uscito, creato): il canale in tempo reale segue quelli nuovi.
    if (mailboxOn) await watchGroups(me, myGroupIds);
    return true;
  } catch {
    return false;
  }
};

/**
 * Gruppo mio sul server senza la mia riga tra i membri (creazione interrotta tra le due scritture):
 * senza, non potevo invitare, pubblicare né vedere chi entrava. La riga si ripubblica.
 */
const repairOwnership = async (ownerless: StudyGroup[], me: string, email: string) => {
  for (const group of ownerless) {
    if (!(await stillSignedInAs(me))) return;
    const local = useStudyStore.getState().studyGroups.find((item) => item.id === group.id);
    const mine = local?.members.find((member) => member.userId === me);
    await pushSharedMembership(group.id, {
      userId: me,
      email: mine?.email ?? (email || undefined),
      displayName: mine?.displayName || group.ownerDisplayName || profileName() || "Studente",
      role: "owner",
      joinedAt: mine?.joinedAt ?? group.createdAt
    });
  }
};

// ——— Pubblicazioni da riprovare ———
// Gruppo, risorsa o invito nominale creati qui quando il server non rispondeva restavano solo su questo
// dispositivo per sempre (gli altri membri non li vedevano, l'invitato non riceveva nulla). Si ricordano
// qui e si riprovano dopo ogni pull riuscito. Solo il dispositivo che li ha creati li riprova: un elemento
// eliminato sul server non può tornare da un'altra copia.

type PublishKind = "group" | "resource" | "invite";
interface PublishEntry {
  kind: PublishKind;
  id: string;
  userId: string;
}

const PUBLISH_QUEUE_KEY = "groupSync:publishQueue:v1";
const PUBLISH_QUEUE_MAX = 200;
let publishChain: Promise<unknown> = Promise.resolve();

const samePublish = (a: PublishEntry) => (b: PublishEntry) => a.kind === b.kind && a.id === b.id && a.userId === b.userId;

const isPublishEntry = (value: unknown): value is PublishEntry =>
  Boolean(value) &&
  typeof value === "object" &&
  ["group", "resource", "invite"].includes((value as PublishEntry).kind) &&
  typeof (value as PublishEntry).id === "string" &&
  typeof (value as PublishEntry).userId === "string";

/** Modifiche alla coda una alla volta (lettura e scrittura su IndexedDB non si accavallano). */
const editPublishQueue = (edit: (entries: PublishEntry[]) => PublishEntry[]): Promise<PublishEntry[]> => {
  const run = publishChain.then(async () => {
    const stored = await getMeta<unknown>(PUBLISH_QUEUE_KEY).catch(() => undefined);
    const current = Array.isArray(stored) ? stored.filter(isPublishEntry) : [];
    const next = edit(current);
    await setMeta(PUBLISH_QUEUE_KEY, next).catch(() => undefined);
    return next;
  });
  publishChain = run.catch(() => undefined);
  return run;
};

const rememberPublish = async (kind: PublishKind, id: string, ok: boolean) => {
  let userId = "";
  try {
    userId = (await getSession())?.user.id ?? "";
  } catch {
    userId = "";
  }
  if (!userId) return; // senza account non c'è un server da raggiungere
  const entry = { kind, id, userId };
  await editPublishQueue((entries) =>
    ok ? entries.filter((item) => !samePublish(entry)(item)) : entries.some(samePublish(entry)) ? entries : [...entries, entry].slice(-PUBLISH_QUEUE_MAX)
  );
};

/** Gruppo e mia riga da proprietario. Se non riesce, si riprova dopo il prossimo pull. */
export const publishGroup = async (group: StudyGroup): Promise<boolean> => {
  const owner = group.members.find((member) => member.userId === group.ownerId);
  const ok = (await pushSharedGroup(group)) && (!owner || (await pushSharedMembership(group.id, owner)));
  await rememberPublish("group", group.id, ok);
  return ok;
};

export const publishResource = async (resource: GroupResource): Promise<boolean> => {
  const ok = await pushSharedResource(resource);
  await rememberPublish("resource", resource.id, ok);
  return ok;
};

export const publishInvite = async (invite: GroupInvite): Promise<boolean> => {
  const ok = await pushSharedInvite(invite);
  // Un invito a una persona (o per email, di prima) non si pubblica dal client: niente da riprovare.
  await rememberPublish("invite", invite.id, ok || !isCodeOnlyInvite(invite));
  return ok;
};

const flushPublishQueue = async (me: string) => {
  const entries = (await editPublishQueue((list) => list)).filter((entry) => entry.userId === me);
  // Prima i gruppi: risorse e inviti di un gruppo non ancora pubblicato fallirebbero.
  const order: PublishKind[] = ["group", "resource", "invite"];
  for (const kind of order) {
    for (const entry of entries.filter((item) => item.kind === kind)) {
      if (!(await stillSignedInAs(me))) return;
      const state = useStudyStore.getState();
      const done = () => editPublishQueue((list) => list.filter((item) => !samePublish(entry)(item)));
      if (kind === "group") {
        const group = state.studyGroups.find((item) => item.id === entry.id);
        if (!group || group.ownerId !== me) await done();
        else await publishGroup(group);
      } else if (kind === "resource") {
        const resource = state.groupResources.find((item) => item.id === entry.id);
        const group = resource ? state.studyGroups.find((item) => item.id === resource.groupId) : undefined;
        if (!resource || !group || resource.sharedAt) await done();
        else if (group.sharedAt) await publishResource(resource);
      } else {
        const invite = state.groupInvites.find((item) => item.id === entry.id);
        const group = invite ? state.studyGroups.find((item) => item.id === invite.groupId) : undefined;
        // Inviti per email rimasti in coda da prima: il server non li accetta più, si tolgono.
        if (!invite || !group || invite.status !== "pending" || !isCodeOnlyInvite(invite)) await done();
        else if (group.sharedAt) await publishInvite(invite);
      }
    }
  }
};

/** Esito di una scrittura: false se non è riuscita, altrimenti il timbro scritto dal server (se la tabella ne ha uno). */
type PushResult = false | { stamp?: string };

const pushRow = async (table: string, row: Record<string, unknown>, onConflict = "id"): Promise<PushResult> => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    const upsert = supabase.from(table).upsert(row, { onConflict });
    // Le tabelle con updated_at restituiscono il timbro: lo scrive il server (trigger di groups.sql).
    const { data, error } = "updated_at" in row ? await upsert.select("updated_at") : await upsert;
    if (error) return false;
    return { stamp: serverStampOf(data) };
  } catch {
    return false;
  }
};

type StampedKey = "studyGroups" | "groupResources" | "groupInvites";

/**
 * La copia locale prende il timbro scritto dal server (vedi `withServerStamp`). Senza il trigger di
 * groups.sql il server restituisce il timbro mandato e non cambia nulla.
 */
export const adoptServerStamp = async (key: StampedKey, id: string, stamp: string | undefined, sent?: string) => {
  const next = withServerStamp(useStudyStore.getState()[key] as ReadonlyArray<{ id: string; updatedAt: string }>, id, stamp, sent);
  if (next) await applyShared({ [key]: next } as unknown as SharedPatch);
};

/**
 * Cancellazione che dice la verità: con la RLS una riga che non posso cancellare non dà errore, solo
 * zero righe. true solo se dopo la chiamata la riga non c'è più (cancellata ora o già prima).
 */
const deleteWhere = async (table: string, match: Record<string, string>) => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    let removal = supabase.from(table).delete();
    for (const [column, value] of Object.entries(match)) removal = removal.eq(column, value);
    const { data, error } = await removal.select();
    if (error) return false;
    if (data?.length) return true;
    let check = supabase.from(table).select("*", { count: "exact", head: true });
    for (const [column, value] of Object.entries(match)) check = check.eq(column, value);
    const { count, error: checkError } = await check;
    return !checkError && count === 0;
  } catch {
    return false;
  }
};

const deleteRow = (table: string, id: string) => deleteWhere(table, { id });

/** Pubblicazione riuscita: da qui in poi, se sparisce dal server, è stato eliminato. */
const markShared = async (kind: "group" | "resource", id: string) => {
  const sharedAt = new Date().toISOString();
  const state = useStudyStore.getState();
  if (kind === "group") {
    if (!state.studyGroups.some((group) => group.id === id && !group.sharedAt)) return;
    await applyShared({ studyGroups: state.studyGroups.map((group) => (group.id === id ? { ...group, sharedAt } : group)) });
  } else {
    if (!state.groupResources.some((resource) => resource.id === id && !resource.sharedAt)) return;
    await applyShared({ groupResources: state.groupResources.map((resource) => (resource.id === id ? { ...resource, sharedAt } : resource)) });
  }
};

export const pushSharedGroup = async (group: StudyGroup) => {
  const ok = await pushRow("studyos_groups", {
    id: group.id,
    name: group.name,
    description: group.description,
    owner_id: group.ownerId,
    owner_display_name: group.ownerDisplayName,
    invite_code: group.inviteCode,
    updated_at: group.updatedAt
  });
  if (!ok) return false;
  await markShared("group", group.id);
  await adoptServerStamp("studyGroups", group.id, ok.stamp, group.updatedAt);
  return true;
};

// La chiave dei membri è (group_id, user_id): con on_conflict=id l'upsert falliva sempre, e il
// proprietario non risultava membro (niente elenco membri né inviti nominali lato server).
export const pushSharedMembership = async (groupId: string, member: StudyGroup["members"][number]) =>
  Boolean(
    await pushRow(
      "studyos_group_members",
      {
        group_id: groupId,
        user_id: member.userId,
        email: member.email ?? null,
        display_name: member.displayName,
        role: member.role,
        joined_at: member.joinedAt
      },
      "group_id,user_id"
    )
  );

/** Rimozione di un membro (proprietario) o uscita volontaria: senza, al pull ricompariva. */
export const removeSharedMember = (groupId: string, userId: string) =>
  deleteWhere("studyos_group_members", { group_id: groupId, user_id: userId });

// Ruolo e fissaggio con update mirati, non upsert: Postgres applica il controllo di INSERT
// alla riga proposta anche quando diventa update, e la riga è di un altro utente.
// Come per le cancellazioni, una riga esclusa dalla RLS dà zero righe senza errore: conta solo se
// la modifica ha toccato almeno una riga.
const updateRows = async (table: string, patch: Record<string, unknown>, match: Record<string, string>): Promise<PushResult> => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    let query = supabase.from(table).update(patch);
    for (const [column, value] of Object.entries(match)) query = query.eq(column, value);
    const { data, error } = await query.select();
    return !error && data?.length ? { stamp: serverStampOf(data) } : false;
  } catch {
    return false;
  }
};

export const pushSharedMemberRole = async (groupId: string, userId: string, role: StudyGroup["members"][number]["role"]) =>
  Boolean(await updateRows("studyos_group_members", { role }, { group_id: groupId, user_id: userId }));

/** Fissaggio sul server; il timbro restituito va adottato dopo il cambio locale (adoptServerStamp). */
export const pushSharedResourcePin = (resource: GroupResource) =>
  updateRows("studyos_group_resources", { pinned: resource.pinned, updated_at: resource.updatedAt }, { id: resource.id });

export const deleteSharedGroup = (groupId: string) => deleteRow("studyos_groups", groupId);

export const deleteSharedResource = (resourceId: string) => deleteRow("studyos_group_resources", resourceId);

/**
 * Solo inviti con codice, senza destinatario (la policy di inserimento rifiuta gli altri): quelli a
 * una persona li crea il server con invite_person_to_group, quelli per email non esistono più.
 */
export const pushSharedInvite = async (invite: GroupInvite) => {
  if (!isCodeOnlyInvite(invite)) return false;
  const ok = await pushRow("studyos_group_invites", {
    id: invite.id,
    group_id: invite.groupId,
    group_name: invite.groupName,
    group_description: invite.groupDescription ?? null,
    from_user_id: invite.fromUserId,
    from_display_name: invite.fromDisplayName,
    recipient_email: null,
    code: invite.code,
    status: invite.status,
    updated_at: invite.updatedAt
  });
  if (ok) await adoptServerStamp("groupInvites", invite.id, ok.stamp, invite.updatedAt);
  return Boolean(ok);
};

/** Nome della persona appena invitata, solo per l'elenco di chi invita (il server non lo conserva). */
export const rememberInviteRecipient = async (inviteId: string, name: string) => {
  const state = useStudyStore.getState();
  if (!state.groupInvites.some((invite) => invite.id === inviteId && invite.recipientName !== name)) return;
  await applyShared({ groupInvites: state.groupInvites.map((invite) => (invite.id === inviteId ? { ...invite, recipientName: name } : invite)) });
};

export const pushSharedResource = async (resource: GroupResource) => {
  const ok = await pushRow("studyos_group_resources", {
    id: resource.id,
    group_id: resource.groupId,
    kind: resource.kind,
    title: resource.title,
    url: resource.url ?? null,
    body: resource.body ?? null,
    pinned: resource.pinned,
    added_by_user_id: resource.addedByUserId,
    added_by_display_name: resource.addedByDisplayName,
    updated_at: resource.updatedAt
  });
  if (!ok) return false;
  await markShared("resource", resource.id);
  await adoptServerStamp("groupResources", resource.id, ok.stamp, resource.updatedAt);
  return true;
};

export const pushSharedActivity = async (activity: GroupActivity) =>
  Boolean(
    await pushRow("studyos_group_activity", {
      id: activity.id,
      group_id: activity.groupId,
      actor_display_name: activity.actorDisplayName,
      text: activity.text
    })
  );

/**
 * RPC con il nome di chi entra; se il progetto ha ancora la migrazione precedente (funzione
 * senza p_display_name, errore PGRST202) si riprova con la firma vecchia.
 */
const callGroupRpc = async (name: string, args: Record<string, unknown>, displayName: string) => {
  if (!supabase) return { data: null, error: { message: "offline" } };
  const first = await supabase.rpc(name, { ...args, p_display_name: displayName });
  if (first.error?.code === "PGRST202") return supabase.rpc(name, args);
  return first;
};

/**
 * Accettazione lato server: verifica destinatario, aggiunge membro, registra attività. Un errore di rete
 * non è più «accettato in locale»: l'invito resta in attesa e si riprova (vedi GroupRpcOutcome).
 */
export const acceptInviteRemote = async (inviteId: string, displayName: string = profileName()): Promise<GroupRpcOutcome> => {
  if (!(await isSharedAvailable()) || !supabase) return "unavailable";
  try {
    const { error } = await callGroupRpc("accept_group_invite", { p_invite_id: inviteId }, displayName);
    return classifyGroupRpcError(error);
  } catch {
    return "unavailable";
  }
};

export const declineInviteRemote = async (inviteId: string): Promise<GroupRpcOutcome> => {
  if (!(await isSharedAvailable()) || !supabase) return "unavailable";
  try {
    const { error } = await supabase.rpc("decline_group_invite", { p_invite_id: inviteId });
    return classifyGroupRpcError(error);
  } catch {
    return "unavailable";
  }
};

export type JoinByCodeResult = { status: "ok"; groupId: string } | { status: "invalid-code" } | { status: "unavailable" };

/** Unione con codice lato server: valida il codice e aggiunge il membro. */
export const joinByCodeRemote = async (code: string, displayName: string): Promise<JoinByCodeResult> => {
  if (!(await isSharedAvailable()) || !supabase) return { status: "unavailable" };
  try {
    const { data, error } = await callGroupRpc("join_group_by_code", { p_code: normalizeInviteCode(code) }, displayName);
    if (error) return classifyGroupRpcError(error) === "invalid-code" ? { status: "invalid-code" } : { status: "unavailable" };
    const groupId = typeof data === "string" ? data : (data as { group_id?: string } | null)?.group_id;
    return groupId ? { status: "ok", groupId } : { status: "invalid-code" };
  } catch {
    return { status: "unavailable" };
  }
};

/** Cronologia locale e, se il gruppo è condiviso, pubblicata anche per gli altri membri. */
export const logSharedActivity = async (groupId: string, actorDisplayName: string, text: string) => {
  const entry = await useStudyStore.getState().logGroupActivity(groupId, actorDisplayName, text);
  await pushSharedActivity(entry);
};

/**
 * Nome da mandare al server: quello del profilo. Vuoto = il server usa il nome del profilo online,
 * altrimenti «Studente»; mai l'email (studyos_member_name in supabase/groups.sql).
 */
const profileName = () => selectPreferences(useStudyStore.getState()).displayName.trim();

export interface InvitePreview {
  groupId: string;
  name: string;
  description: string;
  memberCount: number;
  ownerName: string;
  isMember: boolean;
}

export type InvitePreviewResult =
  | { status: "ok"; preview: InvitePreview }
  | { status: "not-found" }
  | { status: "unavailable" };

/** Anteprima dal server (nome, membri, responsabile). "unavailable" senza login, offline o migrazione vecchia. */
export const previewInvite = async (code: string): Promise<InvitePreviewResult> => {
  if (!(await isSharedAvailable()) || !supabase) return { status: "unavailable" };
  try {
    const { data, error } = await supabase.rpc("preview_group_invite", { p_code: code.trim().toUpperCase() });
    if (error) return { status: "unavailable" };
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!row) return { status: "not-found" };
    return {
      status: "ok",
      preview: {
        groupId: String(row.group_id ?? ""),
        name: String(row.name ?? ""),
        description: String(row.description ?? ""),
        memberCount: Number(row.member_count ?? 0),
        ownerName: String(row.owner_display_name ?? ""),
        isMember: Boolean(row.is_member)
      }
    };
  } catch {
    return { status: "unavailable" };
  }
};

/**
 * Ingresso con un codice (digitato, link o QR): prima il backend condiviso (vale tra account e
 * dispositivi), poi il gruppo locale se è su questo dispositivo. Ritorna l'id del gruppo.
 */
/** Ingresso non riuscito. `retryable`: il server non ha risposto, l'invito resta valido. */
export class GroupJoinError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = "GroupJoinError";
  }
}

export const joinGroupWithCode = async (code: string, actor: Actor): Promise<string> => {
  const remote = await joinByCodeRemote(code, profileName());
  if (remote.status === "ok") {
    // Con il backend condiviso l'ingresso è già registrato dal server (niente voce doppia).
    await pullSharedUpdates();
    return remote.groupId;
  }
  const store = useStudyStore.getState();
  const normalized = normalizeInviteCode(code);
  const local = store.studyGroups.find((group) => group.inviteCode.toUpperCase() === normalized);
  // Già dentro (es. ricliccato il link): non è un errore e non si scrive un altro ingresso.
  if (local?.members.some((member) => member.userId === actor.userId)) return local.id;
  // Gruppo mai pubblicato, solo su questo dispositivo: si entra qui. Un gruppo condiviso invece si
  // raggiunge solo dal server: entrare «in locale» mostrava un gruppo di cui non si era membri davvero.
  if (local && !local.sharedAt) {
    const groupId = await store.joinGroupByCode(code, actor);
    await store.logGroupActivity(groupId, actor.displayName, "è entrato nel gruppo").catch(() => undefined);
    return groupId;
  }
  if (remote.status === "invalid-code" || !isCloudConfigured()) {
    throw new GroupJoinError("Codice non valido o gruppo non più disponibile. Chiedi un nuovo invito.", false);
  }
  throw new GroupJoinError("Il server dei gruppi non risponde: controlla la connessione e riprova. L'invito resta valido.", true);
};

const announceJoined = (groupId: string) => {
  try {
    window.dispatchEvent(new CustomEvent(GROUP_JOINED_EVENT, { detail: { groupId } }));
  } catch {
    // ambiente senza window
  }
};

let completing = false;
/** Nuovi tentativi automatici quando il server non risponde (poi resta la scheda dell'invito). */
const COMPLETE_RETRY_MS = [15_000, 60_000];
let completeAttempt = 0;
let completeRetry: ReturnType<typeof setTimeout> | null = null;

const retryCompleteLater = () => {
  if (typeof window === "undefined" || completeRetry) return;
  const delay = COMPLETE_RETRY_MS[completeAttempt];
  if (delay === undefined) return;
  completeAttempt += 1;
  const again = () => {
    if (completeRetry) clearTimeout(completeRetry);
    completeRetry = null;
    window.removeEventListener("online", again);
    void completePendingInvite();
  };
  completeRetry = setTimeout(again, delay);
  window.addEventListener("online", again, { once: true });
};

/**
 * Dopo login o registrazione: se l'utente aveva già scelto "Entra" su un invito, entra da solo con
 * l'account appena usato. Senza conferma non fa nulla (la scheda dell'invito resta in Gruppi).
 * Se il server non risponde l'invito resta (prima veniva scartato con «Codice non valido»).
 */
export const completePendingInvite = async (): Promise<void> => {
  const pending = readPendingInvite();
  if (!pending?.confirmed || completing) return;
  completing = true;
  try {
    const actor = await getActor();
    if (!actor.email) return; // ancora senza sessione: si riprova al prossimo login
    // «Ignora» o un altro link nel frattempo: si entra solo nell'invito ancora confermato.
    const still = readPendingInvite();
    if (!still?.confirmed || still.code !== pending.code) return;
    const store = useStudyStore.getState();
    try {
      const groupId = await joinGroupWithCode(pending.code, actor);
      completeAttempt = 0;
      clearPendingInvite();
      const name = useStudyStore.getState().studyGroups.find((group) => group.id === groupId)?.name ?? "il gruppo";
      await store
        .addNotification({ kind: "group", title: `Sei entrato in "${name}"`, body: "Invito completato dopo l'accesso.", linkView: "groups", linkGroupId: groupId })
        .catch(() => undefined);
      announceJoined(groupId);
    } catch (cause) {
      if (cause instanceof GroupJoinError && cause.retryable) {
        // L'invito resta confermato: si riprova da soli tra poco o al ritorno della rete.
        retryCompleteLater();
        return;
      }
      completeAttempt = 0;
      clearPendingInvite();
      await store
        .addNotification({ kind: "system", title: "Invito non riuscito", body: cause instanceof Error ? cause.message : "Chiedi un nuovo invito.", linkView: "groups" })
        .catch(() => undefined);
    }
  } finally {
    completing = false;
  }
};

/** Nuovo codice: link e QR già inviati smettono di funzionare. Solo il proprietario lo pubblica. */
export const regenerateInviteCode = async (groupId: string): Promise<string> => {
  const store = useStudyStore.getState();
  const previous = store.studyGroups.find((item) => item.id === groupId)?.inviteCode;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const inviteCode = makeGroupInviteCode();
    await store.updateStudyGroup(groupId, { inviteCode });
    const group = useStudyStore.getState().studyGroups.find((item) => item.id === groupId);
    if (!group) throw new Error("Gruppo non trovato.");
    // Senza backend condiviso il codice nuovo vale in locale; sul server un codice già in uso
    // (indice univoco) fa fallire la pubblicazione: se ne prova un altro.
    if (!group.sharedAt || (await pushSharedGroup(group))) return inviteCode;
  }
  // Nessun codice pubblicato: torna quello che vale ancora sul server. Restava un codice mai pubblicato
  // (link e QR morti) mentre i vecchi link, che si volevano disattivare, funzionavano ancora.
  if (previous) await store.updateStudyGroup(groupId, { inviteCode: previous });
  throw new Error("Non è stato possibile pubblicare il nuovo codice: i vecchi link funzionano ancora. Controlla la connessione e riprova.");
};

let inviteChannel: RealtimeChannel | null = null;
let inviteSubscribedUser = "";

const stopInviteSubscription = () => {
  if (inviteChannel && supabase) {
    void supabase.removeChannel(inviteChannel).catch(() => undefined);
  }
  inviteChannel = null;
  inviteSubscribedUser = "";
};

const startInviteSubscription = (userId: string) => {
  if (!supabase || inviteSubscribedUser === userId) return;
  stopInviteSubscription();
  inviteSubscribedUser = userId;
  inviteChannel = supabase
    .channel(`studyos-invites:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "studyos_group_invites", filter: `recipient_user_id=eq.${userId}` },
      (payload) => {
        const invite = toInvite((payload.new ?? {}) as Record<string, unknown>);
        if (!invite.id) return;
        const state = useStudyStore.getState();
        if (state.groupInvites.some((item) => item.id === invite.id)) return;
        void applyShared({ groupInvites: [invite, ...state.groupInvites] });
        for (const received of invitesToNotify([invite], userId)) void notifyInvite(received);
      }
    )
    .subscribe();
};

// ——— Bacheca, cronologia e gruppi in tempo reale ———
// Gli eventi sono solo un segnale: si scarica tutto con il pull (stesse letture, stessa RLS), mai
// dal payload. Così una risorsa, un file o una nota aggiunti da un altro membro compaiono in circa
// un secondo, senza ricaricare la pagina e anche fuori dalla sezione Gruppi.

/** Attesa dopo un segnale: più eventi vicini (un'aggiunta scrive risorsa e cronologia) = un solo pull. */
const GROUP_SIGNAL_DEBOUNCE_MS = 400;
/** Al ritorno sulla scheda o in rete si ricontrolla se l'ultimo pull è più vecchio di così. */
const GROUP_STALE_MS = 30_000;
/** Controllo di riserva se il canale cade senza dirlo (telefono in tasca, rete che cambia). */
const GROUP_PERIODIC_MS = 5 * 60_000;

let mailboxOn = false;
let lastGroupPullAt = 0;
/** Account dell'ultimo pull riuscito: chi guarda i gruppi in tempo reale. */
let watchedMe = "";
let unsubscribeGroups: (() => void) | null = null;
let groupChannel: RealtimeChannel | null = null;
let groupChannelKey = "";
let groupWatch: Promise<void> = Promise.resolve();
let groupSignalTimer: ReturnType<typeof setTimeout> | null = null;
let groupPeriodic: ReturnType<typeof setInterval> | null = null;

const signalGroups = (delay = GROUP_SIGNAL_DEBOUNCE_MS) => {
  if (!mailboxOn) return;
  if (groupSignalTimer) clearTimeout(groupSignalTimer);
  groupSignalTimer = setTimeout(() => {
    groupSignalTimer = null;
    void pullSharedUpdates();
  }, delay);
};

const refreshIfStale = () => {
  if (document.visibilityState === "visible" && Date.now() - lastGroupPullAt > GROUP_STALE_MS) signalGroups(0);
};

const removeGroupChannel = async () => {
  const current = groupChannel;
  groupChannel = null;
  groupChannelKey = "";
  // Attendere la rimozione: supabase-js riusa un canale con lo stesso topic finché esiste.
  if (current && supabase) await supabase.removeChannel(current).catch(() => undefined);
};

/** Canale sui gruppi di cui sono membro; si rifà solo quando cambiano i gruppi (una modifica alla volta). */
const watchGroups = (me: string, groupIds: string[]): Promise<void> => {
  groupWatch = groupWatch.then(async () => {
    const client = supabase;
    if (!mailboxOn || !client) return;
    const ids = realtimeGroupIds(groupIds);
    const key = `${me}|${ids.join(",")}`;
    if (groupChannel && key === groupChannelKey) return;
    await removeGroupChannel();
    if (!ids.length || !mailboxOn) return;
    groupChannelKey = key;
    const inGroups = `in.(${ids.join(",")})`;
    const signal = () => signalGroups();
    // Una cancellazione porta solo l'id e arriva a ogni iscritto, senza filtro: conta solo se è di
    // una risorsa o di un gruppo che ho, e anche allora dal payload non si legge altro.
    const deleted = (known: (id: string) => boolean) => (payload: { old?: Record<string, unknown> | null }) => {
      const id = payload.old?.id;
      if (typeof id === "string" && known(id)) signal();
    };
    let subscribedOnce = false;
    groupChannel = client
      .channel(`studyos-groups:${me}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "studyos_group_resources", filter: `group_id=${inGroups}` }, signal)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "studyos_group_resources", filter: `group_id=${inGroups}` }, signal)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "studyos_group_resources" },
        deleted((id) => useStudyStore.getState().groupResources.some((resource) => resource.id === id))
      )
      // Chi entra o esce scrive nella cronologia (la tabella dei membri non è in Realtime).
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "studyos_group_activity", filter: `group_id=${inGroups}` }, signal)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "studyos_groups", filter: `id=${inGroups}` }, signal)
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "studyos_groups" },
        deleted((id) => useStudyStore.getState().studyGroups.some((group) => group.id === id))
      )
      .subscribe((status) => {
        // Iscritto (o di nuovo, dopo una caduta della rete): ciò che è cambiato prima non è arrivato
        // come evento, quindi si ricontrolla. Anche la prima volta: tra il pull fatto prima di aprire il
        // canale e l'iscrizione vera (secondi, su rete lenta) un altro membro può aver scritto, e
        // senza questo controllo lo si vedrebbe solo al prossimo evento o al controllo periodico.
        if (status !== "SUBSCRIBED") return;
        signalGroups(subscribedOnce ? 0 : undefined);
        subscribedOnce = true;
      });
  });
  return groupWatch;
};

/** Gruppi di cui sono proprietario o membro, come li vede lo store adesso. */
const myLocalGroupIds = (me: string) =>
  useStudyStore
    .getState()
    .studyGroups.filter((group) => group.ownerId === me || group.members.some((member) => member.userId === me))
    .map((group) => group.id);

const startGroupWatchdog = () => {
  if (groupPeriodic || typeof window === "undefined") return;
  // Gruppo creato o appena entrato da qui: il canale lo segue subito, senza aspettare il pull dopo.
  unsubscribeGroups = useStudyStore.subscribe((state, previous) => {
    if (state.studyGroups !== previous.studyGroups && mailboxOn && watchedMe) void watchGroups(watchedMe, myLocalGroupIds(watchedMe));
  });
  document.addEventListener("visibilitychange", refreshIfStale);
  window.addEventListener("online", refreshIfStale);
  groupPeriodic = setInterval(() => {
    if (document.visibilityState === "visible") signalGroups(0);
  }, GROUP_PERIODIC_MS);
};

const stopGroupWatch = () => {
  mailboxOn = false;
  watchedMe = "";
  unsubscribeGroups?.();
  unsubscribeGroups = null;
  if (groupSignalTimer) clearTimeout(groupSignalTimer);
  groupSignalTimer = null;
  if (groupPeriodic) clearInterval(groupPeriodic);
  groupPeriodic = null;
  if (typeof window !== "undefined") {
    document.removeEventListener("visibilitychange", refreshIfStale);
    window.removeEventListener("online", refreshIfStale);
  }
  groupWatch = groupWatch.then(removeGroupChannel);
};

/**
 * Cassetta postale condivisa: pull iniziale + realtime sugli inviti al mio account e sui miei gruppi
 * (bacheca, cronologia, nome). Silenziosa quando non applicabile (ospite, offline, migrazione assente).
 */
export const ensureSharedMailbox = async (): Promise<boolean> => {
  if (!(await isSharedAvailable())) return false;
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch {
    return false;
  }
  if (!session?.user) return false;
  mailboxOn = true;
  startGroupWatchdog();
  const ok = await pullSharedUpdates();
  if (ok && supabase) startInviteSubscription(session.user.id);
  return ok;
};

export const stopSharedMailbox = () => {
  stopInviteSubscription();
  stopGroupWatch();
};
