import type { RealtimeChannel } from "@supabase/supabase-js";
import type { GroupActivity, GroupInvite, GroupResource, StudyGroup } from "../types";
import { getMeta, setMeta } from "./db";
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

export interface SharedSnapshot {
  groups: StudyGroup[];
  invites: GroupInvite[];
  resources: GroupResource[];
  activities: GroupActivity[];
}

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

const mergeShared = (snapshot: SharedSnapshot) => {
  const state = useStudyStore.getState();
  const byId = <T extends { id: string; updatedAt: string }>(items: T[]) => new Map(items.map((item) => [item.id, item]));
  const merge = <T extends { id: string; updatedAt: string }>(current: T[], incoming: T[]): { next: T[]; fresh: T[] } => {
    const map = byId(current);
    const fresh: T[] = [];
    for (const item of incoming) {
      const existing = map.get(item.id);
      if (!existing) {
        map.set(item.id, item);
        fresh.push(item);
      } else if (item.updatedAt > existing.updatedAt) {
        map.set(item.id, item);
      }
    }
    return { next: [...map.values()], fresh };
  };
  const groups = merge(state.studyGroups, snapshot.groups);
  const invites = merge(state.groupInvites, snapshot.invites);
  const resources = merge(state.groupResources, snapshot.resources);
  const activities = merge(state.groupActivities, snapshot.activities);
  useStudyStore.setState({
    studyGroups: groups.next,
    groupInvites: invites.next,
    groupResources: resources.next,
    groupActivities: activities.next
  });
  // setState passa dalla sottoscrizione di persistenza: salvataggio e outbox automatici.
  return { freshInvites: invites.fresh, freshGroups: groups.fresh };
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
    const myGroupIds = [...new Set(localGroups.filter((g) => g.ownerId === me || g.members.some((m) => m.userId === me)).map((g) => g.id))];
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
    const { freshInvites } = mergeShared(snapshot);
    await notifyFreshInvites(freshInvites);
    return true;
  } catch {
    return false;
  }
};

const pushRow = async (table: string, row: Record<string, unknown>) => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    const { error } = await supabase.from(table).upsert(row, { onConflict: "id" });
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

export const pushSharedGroup = (group: StudyGroup) =>
  pushRow("studyos_groups", {
    id: group.id,
    name: group.name,
    description: group.description,
    owner_id: group.ownerId,
    owner_display_name: group.ownerDisplayName,
    invite_code: group.inviteCode,
    updated_at: group.updatedAt
  });

export const pushSharedMembership = (groupId: string, member: StudyGroup["members"][number]) =>
  pushRow("studyos_group_members", {
    group_id: groupId,
    user_id: member.userId,
    email: member.email ?? null,
    display_name: member.displayName,
    role: member.role,
    joined_at: member.joinedAt
  });

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

export const pushSharedResource = (resource: GroupResource) =>
  pushRow("studyos_group_resources", {
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

export const pushSharedActivity = (activity: GroupActivity) =>
  pushRow("studyos_group_activity", {
    id: activity.id,
    group_id: activity.groupId,
    actor_display_name: activity.actorDisplayName,
    text: activity.text
  });

/** Accettazione lato server: verifica destinatario, aggiunge membro, registra attività. */
export const acceptInviteRemote = async (inviteId: string): Promise<boolean> => {
  if (!(await isSharedAvailable()) || !supabase) return false;
  try {
    const { error } = await supabase.rpc("accept_group_invite", { p_invite_id: inviteId });
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
export const joinByCodeRemote = async (code: string): Promise<{ groupId: string } | null> => {
  if (!(await isSharedAvailable()) || !supabase) return null;
  try {
    const { data, error } = await supabase.rpc("join_group_by_code", { p_code: code.trim().toUpperCase() });
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
        useStudyStore.setState({ groupInvites: [invite, ...state.groupInvites] });
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
