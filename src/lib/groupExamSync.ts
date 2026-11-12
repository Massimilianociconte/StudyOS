// Appelli e correzioni dei gruppi sul server (supabase/group-exams.sql): pull, realtime, scritture con
// le funzioni del database e notifiche in app. Si carica sempre con import() (groupSync, viste, agenti):
// porta con sé il client Supabase. Niente scritture offline: senza rete non si sa se c'è un doppione.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getMeta, setMeta } from "./db";
import { getSession, supabase } from "./supabase";
import { realtimeGroupIds } from "./groups";
import {
  historyFromRow,
  overrideFromRow,
  sessionFromRow,
  writeResultFrom,
  type CatalogOverride,
  type GroupExamSession,
  type GroupExamWriter,
  type GroupHistoryEntry
} from "./groupExams";
import { planGroupExamNotifications } from "./groupExamNotify";
import { localDay } from "./groupExamCalendar";
import { GROUP_EXAM_TEXT } from "./labels/groupExams";
import { useGroupExamStore, type GroupExamGroup } from "../store/useGroupExamStore";
import { useStudyStore } from "../store/useStudyStore";

const PAGE = 500;
const STALE_MS = 30_000;
const PERIODIC_MS = 5 * 60_000;
const NOTIFY_DELAY_MS = 1_000;
const seenKey = (userId: string) => `gexam-seen:${userId}`;

let me = "";
let running = false;
let channel: RealtimeChannel | null = null;
let channelKey = "";
let lastPullAt = 0;
let periodic: ReturnType<typeof setInterval> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let queue: Promise<unknown> = Promise.resolve();

type DbError = { code?: string; message?: string } | null;
const missingTable = (error: DbError) =>
  Boolean(error) && (error?.code === "42P01" || error?.code === "PGRST205" || /does not exist|could not find the table/i.test(error?.message ?? ""));
const missingFunction = (error: DbError) => Boolean(error) && (error?.code === "PGRST202" || /could not find the function/i.test(error?.message ?? ""));

/** Gruppi pubblicati di cui sono membro, come li vede lo store personale. */
const myGroups = (userId: string): GroupExamGroup[] =>
  useStudyStore
    .getState()
    .studyGroups.filter((group) => group.sharedAt && (group.ownerId === userId || group.members.some((member) => member.userId === userId)))
    .map((group) => ({ id: group.id, name: group.name }));

const sameGroups = (a: readonly GroupExamGroup[], b: readonly GroupExamGroup[]) =>
  a.map((group) => `${group.id}:${group.name}`).join("|") === b.map((group) => `${group.id}:${group.name}`).join("|");

const pullTable = async <T>(table: string, ids: string[], convert: (row: unknown) => T | null): Promise<T[] | "missing" | null> => {
  const client = supabase;
  if (!client) return null;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client.from(table).select("*").in("group_id", ids).order("id").range(from, from + PAGE - 1);
    if (missingTable(error)) return "missing";
    if (error || !Array.isArray(data)) return null;
    for (const row of data) {
      const item = convert(row);
      if (item) out.push(item);
    }
    if (data.length < PAGE) return out;
  }
};

/** Notifiche in app per ciò che è cambiato da altri (id stabili: niente doppioni tra dispositivi). */
const notify = async () => {
  if (!running || !me) return;
  const study = useStudyStore.getState();
  if (study.locked) return;
  const { sessions, ready } = useGroupExamStore.getState();
  if (!ready) return;
  const watermark = (await getMeta<string>(seenKey(me)).catch(() => undefined)) ?? undefined;
  const result = planGroupExamNotifications({ sessions, plans: study.examPlans, subjects: study.subjects, me, watermark, today: localDay(new Date().toISOString()) ?? "" });
  for (const item of result.notifications) await study.addNotification(item).catch(() => undefined);
  if (result.watermark && result.watermark !== watermark) await setMeta(seenKey(me), result.watermark).catch(() => undefined);
};

const notifySoon = () => {
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    void notify();
  }, NOTIFY_DELAY_MS);
};

const closeChannel = async () => {
  const current = channel;
  channel = null;
  channelKey = "";
  if (current && supabase) await supabase.removeChannel(current).catch(() => undefined);
};

const watch = async (ids: string[]) => {
  const client = supabase;
  if (!client || !running) return;
  const shown = realtimeGroupIds(ids);
  const key = `${me}|${shown.join(",")}`;
  if (channel && key === channelKey) return;
  await closeChannel();
  if (!shown.length || !running) return;
  channelKey = key;
  const filter = `group_id=in.(${shown.join(",")})`;
  const onSession = (payload: { new?: Record<string, unknown> | null }) => {
    const row = sessionFromRow(payload.new);
    if (!row) return;
    useGroupExamStore.getState().applySession(row);
    notifySoon();
  };
  const onOverride = (payload: { new?: Record<string, unknown> | null }) => {
    const row = overrideFromRow(payload.new);
    if (row) useGroupExamStore.getState().applyOverride(row);
  };
  // Una cancellazione vera (pulizia dopo 180 giorni, gruppo eliminato) porta solo l'id.
  const onDelete = (drop: (id: string) => void) => (payload: { old?: Record<string, unknown> | null }) => {
    const id = payload.old?.id;
    if (typeof id === "string") drop(id);
  };
  channel = client
    .channel(`studyos-group-exams:${me}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "studyos_group_exam_sessions", filter }, onSession)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "studyos_group_exam_sessions", filter }, onSession)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "studyos_group_exam_sessions" }, onDelete((id) => useGroupExamStore.getState().dropSession(id)))
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "studyos_group_catalog_overrides", filter }, onOverride)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "studyos_group_catalog_overrides", filter }, onOverride)
    .on("postgres_changes", { event: "DELETE", schema: "public", table: "studyos_group_catalog_overrides" }, onDelete((id) => useGroupExamStore.getState().dropOverride(id)))
    .subscribe((status) => {
      // Ogni iscrizione (anche la prima): ciò che è cambiato tra il pull e l'iscrizione non arriva come evento.
      if (status !== "SUBSCRIBED") return;
      void refreshGroupExams();
    });
};

/** Pull completo dei miei gruppi (una volta per volta). false se non riuscito. */
export const refreshGroupExams = (): Promise<boolean> => {
  const run = queue.then(async () => {
    if (!running || !me) return false;
    const store = useGroupExamStore.getState();
    const groups = myGroups(me);
    if (!groups.length) {
      store.setSnapshot({ viewerId: me, groups, sessions: [], overrides: [] });
      await closeChannel();
      return true;
    }
    const ids = groups.map((group) => group.id);
    const [sessions, overrides] = await Promise.all([
      pullTable<GroupExamSession>("studyos_group_exam_sessions", ids, sessionFromRow),
      pullTable<CatalogOverride>("studyos_group_catalog_overrides", ids, overrideFromRow)
    ]);
    if (!running) return false;
    if (sessions === "missing" || overrides === "missing") {
      store.setUnavailable();
      return false;
    }
    if (!sessions || !overrides) {
      store.setError(GROUP_EXAM_TEXT.syncError);
      return false;
    }
    lastPullAt = Date.now();
    store.setSnapshot({ viewerId: me, groups, sessions, overrides });
    await notify();
    void watch(ids);
    return true;
  });
  queue = run.catch(() => undefined);
  return run.catch(() => false);
};

const refreshIfStale = () => {
  if (running && document.visibilityState === "visible" && Date.now() - lastPullAt > STALE_MS) void refreshGroupExams();
};

/** Vault bloccato: niente appelli in memoria e niente canale; allo sblocco si riparte. */
const pause = () => {
  running = false;
  void closeChannel();
  useGroupExamStore.getState().reset();
};

export const startGroupExamSync = async (): Promise<void> => {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch {
    return;
  }
  const userId = session?.user?.id;
  if (!userId || !supabase) return;
  if (unsubscribe && me === userId) {
    running = !useStudyStore.getState().locked;
    if (running) await refreshGroupExams();
    return;
  }
  stopGroupExamSync();
  me = userId;
  running = !useStudyStore.getState().locked;
  unsubscribe = useStudyStore.subscribe((state, previous) => {
    if (state.locked !== previous.locked) {
      if (state.locked) pause();
      else {
        running = true;
        void refreshGroupExams();
      }
      return;
    }
    if (running && state.studyGroups !== previous.studyGroups && !sameGroups(myGroups(me), useGroupExamStore.getState().groups)) void refreshGroupExams();
  });
  if (typeof window !== "undefined") {
    document.addEventListener("visibilitychange", refreshIfStale);
    window.addEventListener("online", refreshIfStale);
    periodic = setInterval(() => {
      if (running && document.visibilityState === "visible") void refreshGroupExams();
    }, PERIODIC_MS);
  }
  if (running) await refreshGroupExams();
};

export const stopGroupExamSync = () => {
  running = false;
  me = "";
  unsubscribe?.();
  unsubscribe = null;
  if (periodic) clearInterval(periodic);
  periodic = null;
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = null;
  if (typeof window !== "undefined") {
    document.removeEventListener("visibilitychange", refreshIfStale);
    window.removeEventListener("online", refreshIfStale);
  }
  void closeChannel();
  useGroupExamStore.getState().reset();
};

const callRpc = async (fn: string, args: Record<string, unknown>): Promise<unknown> => {
  const client = supabase;
  if (!client) throw new Error(GROUP_EXAM_TEXT.offline);
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(missingFunction(error) ? GROUP_EXAM_TEXT.notActive : GROUP_EXAM_TEXT.offline);
  return data;
};

const sessionOrOverride = (row: unknown): GroupExamSession | CatalogOverride | null => sessionFromRow(row) ?? overrideFromRow(row);

const applyRow = (row: GroupExamSession | CatalogOverride | undefined) => {
  if (!row) return;
  if ("courseKey" in row) useGroupExamStore.getState().applySession(row);
  else useGroupExamStore.getState().applyOverride(row);
};

/** Scritture sul server: la riga dell'esito (scritta, attuale o doppione) entra subito nello store. */
export const groupExamWriter: GroupExamWriter = {
  saveSession: async (groupId, id, expectedVersion, fields) => {
    const result = writeResultFrom(await callRpc("save_group_exam_session", { p_group_id: groupId, p_id: id, p_expected_version: expectedVersion, p_fields: fields }), sessionFromRow);
    applyRow(result.row);
    return result;
  },
  deleteSession: async (id, expectedVersion) => {
    const result = writeResultFrom(await callRpc("delete_group_exam_session", { p_id: id, p_expected_version: expectedVersion }), sessionFromRow);
    applyRow(result.row);
    return result;
  },
  restore: async (historyId, expectedVersion) => {
    const result = writeResultFrom(await callRpc("restore_group_record", { p_history_id: historyId, p_expected_version: expectedVersion }), sessionOrOverride);
    applyRow(result.row);
    return result;
  },
  listHistory: async ({ groupId, recordKind, recordId, limit, beforeId }) => {
    const client = supabase;
    if (!client) return null;
    let query = client.from("studyos_group_history").select("*").eq("group_id", groupId);
    if (recordKind) query = query.eq("record_kind", recordKind);
    if (recordId) query = query.eq("record_id", recordId);
    if (beforeId) query = query.lt("id", beforeId);
    const { data, error } = await query.order("id", { ascending: false }).limit(limit);
    if (error || !Array.isArray(data)) return null;
    return data.map(historyFromRow).filter((entry): entry is GroupHistoryEntry => entry !== null);
  },
  saveOverride: async (groupId, id, expectedVersion, targetKind, targetId, targetLabel, fields) => {
    const result = writeResultFrom(
      await callRpc("save_group_catalog_override", {
        p_group_id: groupId,
        p_id: id,
        p_expected_version: expectedVersion,
        p_target_kind: targetKind,
        p_target_id: targetId,
        p_target_label: targetLabel,
        p_fields: fields
      }),
      overrideFromRow
    );
    applyRow(result.row);
    return result;
  },
  deleteOverride: async (id, expectedVersion) => {
    const result = writeResultFrom(await callRpc("delete_group_catalog_override", { p_id: id, p_expected_version: expectedVersion }), overrideFromRow);
    applyRow(result.row);
    return result;
  }
};
