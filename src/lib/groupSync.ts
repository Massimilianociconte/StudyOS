import type { RealtimeChannel } from "@supabase/supabase-js";
import type { GroupActivity, GroupInvite, GroupResource, StudyGroup } from "../types";
import { getMeta, setMeta } from "./db";
import { mergeSharedSnapshot, type SharedSnapshot } from "./groups";
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
  const displayName = selectPreferences(useStudyStore.getState()).displayName.trim() || "Studente";
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

const missingTable = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (/42P01|does not exist|Could not find the table/i.test(`${error.code ?? ""} ${error.message ?? ""}`)));

/** Le tabelle condivise esistono e sono leggibili (migrazione applicata)? */
export const isSharedAvailable = async (): Promise<boolean> => {
  if (sharedCache !== null) return sharedCache;
  try {
    const stored = await getMeta<boolean>(SHARED_META_KEY);
    if (typeof stored === "boolean") {
      sharedCache = stored;
      return stored;
    }
  } catch {
    // meta non disponibile: si riprova sotto
  }
  if (!isCloudConfigured() || !supabase) {
    sharedCache = false;
    return false;
  }
  try {
    const session = await getSession();
    if (!session) {
      sharedCache = false;
      return false;
    }
    const { error } = await supabase.from("studyos_groups").select("id").limit(0);
    if (error && missingTable(error)) {
      sharedCache = false;
      await setMeta(SHARED_META_KEY, false).catch(() => undefined);
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

type SharedPatch = Partial<Pick<ReturnType<typeof useStudyStore.getState>, "studyGroups" | "groupInvites" | "groupResources" | "groupActivities">>;

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
  const merged = mergeSharedSnapshot(
    { groups: state.studyGroups, invites: state.groupInvites, resources: state.groupResources, activities: state.groupActivities },
    snapshot,
    me,
    queriedGroupIds
  );
  await applyShared({
    studyGroups: merged.groups,
    groupInvites: merged.invites,
    groupResources: merged.resources,
    groupActivities: merged.activities
  });
  return { freshInvites: merged.freshInvites, freshGroups: merged.freshGroups };
};

const notifyFreshInvites = async (fresh: GroupInvite[]) => {
  const state = useStudyStore.getState();
  for (const invite of fresh) {
    if (invite.status !== "pending") continue;
    await state
      .addNotification({
        kind: "invite",
        title: `Invito al gruppo "${invite.groupName}"`,
        body: `${invite.fromDisplayName} ti ha invitato${invite.groupDescription ? `: ${invite.groupDescription}` : "."} Apri per accettare o rifiutare.`,
        linkView: "groups",
        linkGroupId: invite.groupId
      })
      .catch(() => undefined);
  }
};

/**
 * Scarica le novità condivise: inviti nominali, risposte ai miei inviti,
 * membri/risorse/attività dei miei gruppi. Ritorna false se non applicabile.
 */
export const pullSharedUpdates = async (): Promise<boolean> => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch {
    return false;
  }
  if (!session?.user) return false;
  const me = session.user.id;
  const email = (session.user.email ?? "").toLowerCase();
  try {
    const snapshot: SharedSnapshot = { groups: [], invites: [], resources: [], activities: [] };
    if (email) {
      const { data, error } = await supabase.from("studyos_group_invites").select("*").eq("recipient_email", email).eq("status", "pending");
      if (error) throw error;
      snapshot.invites.push(...(data ?? []).map(toInvite));
    }
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
        group.members = byGroup.get(group.id) ?? local?.members ?? [];
        snapshot.groups.push(group);
      }
      const { data: resources, error: resourcesError } = await supabase.from("studyos_group_resources").select("*").in("group_id", myGroupIds);
      if (resourcesError) throw resourcesError;
      snapshot.resources.push(...(resources ?? []).map(toResource));
      const { data: activities, error: activitiesError } = await supabase
        .from("studyos_group_activity")
        .select("*")
        .in("group_id", myGroupIds)
        .order("created_at", { ascending: false })
        .limit(200);
      if (activitiesError) throw activitiesError;
      snapshot.activities.push(...(activities ?? []).map(toActivity));
    }
    const { freshInvites } = await mergeShared(snapshot, me, myGroupIds);
    await notifyFreshInvites(freshInvites);
    return true;
  } catch {
    return false;
  }
};

const pushRow = async (table: string, row: Record<string, unknown>, onConflict = "id") => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    const { error } = await supabase.from(table).upsert(row, { onConflict });
    if (error) return false;
    return true;
  } catch {
    return false;
  }
};

const deleteRow = async (table: string, id: string) => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    const { error } = await supabase.from(table).delete().eq("id", id);
    return !error;
  } catch {
    return false;
  }
};

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
  if (ok) await markShared("group", group.id);
  return ok;
};

// La chiave dei membri è (group_id, user_id): con on_conflict=id l'upsert falliva sempre, e il
// proprietario non risultava membro (niente elenco membri né inviti nominali lato server).
export const pushSharedMembership = (groupId: string, member: StudyGroup["members"][number]) =>
  pushRow(
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
  );

/** Rimozione di un membro (proprietario) o uscita volontaria: senza, al pull ricompariva. */
export const removeSharedMember = async (groupId: string, userId: string) => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    const { error } = await supabase.from("studyos_group_members").delete().eq("group_id", groupId).eq("user_id", userId);
    return !error;
  } catch {
    return false;
  }
};

// Ruolo e fissaggio con update mirati, non upsert: Postgres applica il controllo di INSERT
// alla riga proposta anche quando diventa update, e la riga è di un altro utente.
const updateRows = async (table: string, patch: Record<string, unknown>, match: Record<string, string>) => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    let query = supabase.from(table).update(patch);
    for (const [column, value] of Object.entries(match)) query = query.eq(column, value);
    const { error } = await query;
    return !error;
  } catch {
    return false;
  }
};

export const pushSharedMemberRole = (groupId: string, userId: string, role: StudyGroup["members"][number]["role"]) =>
  updateRows("studyos_group_members", { role }, { group_id: groupId, user_id: userId });

export const pushSharedResourcePin = (resource: GroupResource) =>
  updateRows("studyos_group_resources", { pinned: resource.pinned, updated_at: resource.updatedAt }, { id: resource.id });

export const deleteSharedGroup = (groupId: string) => deleteRow("studyos_groups", groupId);

export const deleteSharedResource = (resourceId: string) => deleteRow("studyos_group_resources", resourceId);

export const pushSharedInvite = (invite: GroupInvite) =>
  pushRow("studyos_group_invites", {
    id: invite.id,
    group_id: invite.groupId,
    group_name: invite.groupName,
    group_description: invite.groupDescription ?? null,
    from_user_id: invite.fromUserId,
    from_display_name: invite.fromDisplayName,
    recipient_email: invite.recipientEmail ?? null,
    code: invite.code,
    status: invite.status,
    updated_at: invite.updatedAt
  });

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
  if (ok) await markShared("resource", resource.id);
  return ok;
};

export const pushSharedActivity = (activity: GroupActivity) =>
  pushRow("studyos_group_activity", {
    id: activity.id,
    group_id: activity.groupId,
    actor_display_name: activity.actorDisplayName,
    text: activity.text
  });

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

/** Accettazione lato server: verifica destinatario, aggiunge membro, registra attività. */
export const acceptInviteRemote = async (inviteId: string, displayName: string): Promise<boolean> => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    const { error } = await callGroupRpc("accept_group_invite", { p_invite_id: inviteId }, displayName);
    return !error;
  } catch {
    return false;
  }
};

export const declineInviteRemote = async (inviteId: string): Promise<boolean> => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    const { error } = await supabase.rpc("decline_group_invite", { p_invite_id: inviteId });
    return !error;
  } catch {
    return false;
  }
};

/** Unione con codice lato server: valida il codice e aggiunge il membro. */
export const joinByCodeRemote = async (code: string, displayName: string): Promise<{ groupId: string } | null> => {
  if (!(await isSharedAvailable()) || !supabase) return null;
  try {
    const { data, error } = await callGroupRpc("join_group_by_code", { p_code: code.trim().toUpperCase() }, displayName);
    if (error || !data) return null;
    const groupId = typeof data === "string" ? data : (data as { group_id?: string }).group_id;
    return groupId ? { groupId } : null;
  } catch {
    return null;
  }
};

let inviteChannel: RealtimeChannel | null = null;
let inviteSubscribedEmail = "";

const stopInviteSubscription = () => {
  if (inviteChannel && supabase) {
    void supabase.removeChannel(inviteChannel).catch(() => undefined);
  }
  inviteChannel = null;
  inviteSubscribedEmail = "";
};

const startInviteSubscription = (email: string) => {
  if (!supabase || inviteSubscribedEmail === email) return;
  stopInviteSubscription();
  inviteSubscribedEmail = email;
  inviteChannel = supabase
    .channel(`studyos-invites:${email}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "studyos_group_invites", filter: `recipient_email=eq.${email}` },
      (payload) => {
        const invite = toInvite((payload.new ?? {}) as Record<string, unknown>);
        if (!invite.id) return;
        const state = useStudyStore.getState();
        if (state.groupInvites.some((item) => item.id === invite.id)) return;
        void applyShared({ groupInvites: [invite, ...state.groupInvites] });
        void state
          .addNotification({
            kind: "invite",
            title: `Invito al gruppo "${invite.groupName}"`,
            body: `${invite.fromDisplayName} ti ha invitato. Apri per accettare o rifiutare.`,
            linkView: "groups",
            linkGroupId: invite.groupId
          })
          .catch(() => undefined);
      }
    )
    .subscribe();
};

/**
 * Cassetta postale condivisa: pull iniziale + realtime sugli inviti nominali.
 * Silenziosa quando non applicabile (ospite, offline, migrazione assente).
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
  const ok = await pullSharedUpdates();
  const email = (session.user.email ?? "").toLowerCase();
  if (ok && email && supabase) startInviteSubscription(email);
  return ok;
};

export const stopSharedMailbox = () => stopInviteSubscription();
