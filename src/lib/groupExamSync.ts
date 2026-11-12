// Appelli e correzioni dei gruppi sul server (supabase/group-exams.sql): pull, realtime, scritture con
// le funzioni del database e notifiche in app. Si carica sempre con import() (groupSync, viste, agenti):
// porta con sé il client Supabase. Niente scritture offline: senza rete non si sa se c'è un doppione.
//
// Ogni giro (pull, notifiche, scrittura) porta con sé la «generazione» in cui è partito: uscita, cambio di
// account e blocco del vault la fanno avanzare, e ciò che arriva dopo non tocca più lo store né i dati di
// un altro account.
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getMeta, setMeta } from "./db";
import { getSession, supabase } from "./supabase";
import { realtimeGroupIds } from "./groups";
import { getCloudSyncState, subscribeCloudSync } from "./cloudSyncState";
import { reminderSyncReady, trackReminderAccount, type ReminderAccountTrack } from "./pushReminders";
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
import { GROUP_EXAM_TEXT } from "./labels/groupExams";
import { useGroupExamStore, type GroupExamGroup } from "../store/useGroupExamStore";
import { useStudyStore } from "../store/useStudyStore";

const PAGE = 500;
const STALE_MS = 30_000;
const PERIODIC_MS = 5 * 60_000;
const NOTIFY_DELAY_MS = 1_000;
const seenKey = (userId: string) => `gexam-seen:${userId}`;

/** Inizio della pagina: i dati personali valgono solo dopo una sync finita dopo di lui (come le push). */
const PAGE_START_MS =
  typeof performance !== "undefined" && Number.isFinite(performance.timeOrigin) && performance.timeOrigin > 0 ? performance.timeOrigin : Date.now();

let me = "";
let running = false;
/** Cresce a ogni avvio, arresto o blocco: un giro partito prima non vale più. */
let generation = 0;
let channel: RealtimeChannel | null = null;
let channelKey = "";
let lastPullAt = 0;
/** Gruppi dell'ultimo pull riuscito: ciò che cambia rispetto a lui chiede un nuovo pull. */
let pulledKey = "";
let periodic: ReturnType<typeof setInterval> | null = null;
let notifyTimer: ReturnType<typeof setTimeout> | null = null;
let unsubscribe: (() => void) | null = null;
let unsubscribeCloud: (() => void) | null = null;
let queue: Promise<unknown> = Promise.resolve();
let notifyQueue: Promise<unknown> = Promise.resolve();
let track: ReminderAccountTrack | null = null;

const current = (owner: number) => running && owner === generation;

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

const groupsKey = (groups: readonly GroupExamGroup[]) => groups.map((group) => `${group.id}:${group.name}`).join("|");
const sameGroups = (a: readonly GroupExamGroup[], b: readonly GroupExamGroup[]) => groupsKey(a) === groupsKey(b);

/** Oggi nel giorno locale (YYYY-MM-DD), non quello UTC. */
const localToday = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/** I gruppi lasciati spariscono dallo store subito, senza aspettare un pull che può fallire. */
const dropLeftGroups = () => {
  const store = useGroupExamStore.getState();
  if (!running || !me || store.viewerId !== me) return;
  const groups = myGroups(me);
  if (!sameGroups(groups, store.groups)) store.setGroups(groups);
};

const pullTable = async <T>(table: string, ids: string[], convert: (row: unknown) => T | null): Promise<T[] | "missing" | null> => {
  const client = supabase;
  if (!client) return null;
  const out: T[] = [];
  // Pagine con cursore sull'id: una cancellazione tra due pagine non fa saltare nessuna riga.
  let last = "";
  for (;;) {
    let query = client.from(table).select("*").in("group_id", ids).order("id").limit(PAGE);
    if (last) query = query.gt("id", last);
    const { data, error } = await query;
    if (missingTable(error)) return "missing";
    if (error || !Array.isArray(data)) return null;
    for (const row of data) {
      const item = convert(row);
      if (item) out.push(item);
    }
    if (data.length < PAGE) return out;
    const lastId = (data[data.length - 1] as { id?: unknown }).id;
    if (typeof lastId !== "string") return null;
    last = lastId;
  }
};

/** I dati personali nello store sono quelli di questo account e aggiornati (piani e materie già scaricati). */
const personalDataCurrent = () => {
  const cloud = getCloudSyncState();
  const id = cloud.session?.user.id ?? null;
  track = trackReminderAccount(track, id, Date.now(), PAGE_START_MS);
  return id === me && reminderSyncReady({ userId: id, status: cloud.status, lastSync: cloud.lastSync, accountChoice: cloud.accountChoice }, track);
};

/**
 * Notifiche in app per ciò che è cambiato da altri (id stabili: niente doppioni tra dispositivi). Una alla
 * volta; solo dopo la sync personale (altrimenti il segno supera cambi di cui il piano non è ancora arrivato)
 * e mai per un account diverso da quello che ha avviato il giro.
 */
const notify = (): Promise<void> => {
  const owner = generation;
  const run = notifyQueue.then(async () => {
    const viewer = me;
    if (!current(owner) || !viewer) return;
    const study = useStudyStore.getState();
    if (study.locked || study.loading || !personalDataCurrent()) return;
    const { sessions, ready, viewerId } = useGroupExamStore.getState();
    if (!ready || viewerId !== viewer) return;
    const stored = (await getMeta<string>(seenKey(viewer)).catch(() => undefined)) ?? undefined;
    if (!current(owner)) return;
    const result = planGroupExamNotifications({ sessions, plans: study.examPlans, subjects: study.subjects, me: viewer, watermark: stored, today: localToday() });
    for (const item of result.notifications) {
      // `createdAt` = istante dell'evento: una lettura o eliminazione fatta dopo, su un altro dispositivo, vince.
      await study.addNotification({ id: item.id, kind: item.kind, title: item.title, body: item.body, linkView: item.linkView, linkGroupId: item.linkGroupId, createdAt: item.createdAt }).catch(() => undefined);
      if (!current(owner)) return;
    }
    // Il segno avanza sempre (anche con il gruppo vuoto): «primo avvio» vale solo senza segno salvato.
    if (result.watermark !== stored) await setMeta(seenKey(viewer), result.watermark).catch(() => undefined);
  });
  notifyQueue = run.catch(() => undefined);
  return run.catch(() => undefined);
};

const notifySoon = () => {
  if (notifyTimer) clearTimeout(notifyTimer);
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    void notify();
  }, NOTIFY_DELAY_MS);
};

const closeChannel = async () => {
  const opened = channel;
  channel = null;
  channelKey = "";
  if (opened && supabase) await supabase.removeChannel(opened).catch(() => undefined);
};

const watch = async (ids: string[], owner: number) => {
  const client = supabase;
  if (!client || !current(owner)) return;
  const shown = realtimeGroupIds(ids);
  const key = `${me}|${shown.join(",")}`;
  if (channel && key === channelKey) return;
  await closeChannel();
  if (!shown.length || !current(owner)) return;
  channelKey = key;
  const filter = `group_id=in.(${shown.join(",")})`;
  // Una riga storta non deve fermare il canale: sessionFromRow/overrideFromRow la scartano, il resto va.
  const onSession = (payload: { new?: Record<string, unknown> | null }) => {
    if (!current(owner)) return;
    try {
      const row = sessionFromRow(payload.new);
      if (!row) return;
      useGroupExamStore.getState().applySession(row);
      notifySoon();
    } catch {
      // riga illeggibile: la prossima lettura completa la rimette a posto
    }
  };
  const onOverride = (payload: { new?: Record<string, unknown> | null }) => {
    if (!current(owner)) return;
    try {
      const row = overrideFromRow(payload.new);
      if (row) useGroupExamStore.getState().applyOverride(row);
    } catch {
      // vedi sopra
    }
  };
  // Una cancellazione vera (pulizia dopo 180 giorni, gruppo eliminato) porta solo l'id.
  const onDelete = (drop: (id: string) => void) => (payload: { old?: Record<string, unknown> | null }) => {
    if (!current(owner)) return;
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
      if (status !== "SUBSCRIBED" || !current(owner)) return;
      void refreshGroupExams();
    });
};

/** Pull completo dei miei gruppi (una volta per volta). false se non riuscito. */
export const refreshGroupExams = (): Promise<boolean> => {
  const run = queue.then(async () => {
    const viewer = me;
    const owner = generation;
    if (!running || !viewer) return false;
    const store = useGroupExamStore.getState();
    const groups = myGroups(viewer);
    // Gruppi lasciati: via subito, prima di ogni chiamata di rete (che può fallire).
    dropLeftGroups();
    if (!groups.length) {
      store.setSnapshot({ viewerId: viewer, groups, sessions: [], overrides: [] });
      pulledKey = groupsKey(groups);
      await closeChannel();
      return true;
    }
    const ids = groups.map((group) => group.id);
    const [sessions, overrides] = await Promise.all([
      pullTable<GroupExamSession>("studyos_group_exam_sessions", ids, sessionFromRow),
      pullTable<CatalogOverride>("studyos_group_catalog_overrides", ids, overrideFromRow)
    ]);
    // Uscito, account cambiato o vault bloccato nel frattempo: questo risultato non è più di nessuno.
    if (!current(owner)) return false;
    if (sessions === "missing" || overrides === "missing") {
      store.setUnavailable();
      return false;
    }
    if (!sessions || !overrides) {
      store.setError(GROUP_EXAM_TEXT.syncError);
      return false;
    }
    lastPullAt = Date.now();
    pulledKey = groupsKey(groups);
    store.setSnapshot({ viewerId: viewer, groups, sessions, overrides });
    // Un errore nelle notifiche non deve impedire di aprire il realtime.
    try {
      await notify();
    } catch {
      // le notifiche si riprovano al prossimo giro
    }
    void watch(ids, owner);
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
  generation += 1;
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
        generation += 1;
        void refreshGroupExams();
      }
      return;
    }
    if (!running) return;
    if (state.studyGroups !== previous.studyGroups) {
      dropLeftGroups();
      if (groupsKey(myGroups(me)) !== pulledKey) void refreshGroupExams();
    }
    // Piani o materie arrivati dalla sync personale: ciò che era in attesa si può notificare.
    if (state.examPlans !== previous.examPlans || state.subjects !== previous.subjects) notifySoon();
  });
  // Quando la sync personale finisce, i piani e le materie di questo account sono arrivati.
  unsubscribeCloud = subscribeCloudSync((cloud) => {
    if (running && cloud.status === "idle") notifySoon();
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
  generation += 1;
  me = "";
  pulledKey = "";
  unsubscribe?.();
  unsubscribe = null;
  unsubscribeCloud?.();
  unsubscribeCloud = null;
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
  if (error) {
    if (missingFunction(error)) throw new Error(GROUP_EXAM_TEXT.notActive);
    // «Offline» solo se la rete manca davvero; sessione scaduta, permessi e errori del server sono altro.
    const network = (typeof navigator !== "undefined" && navigator.onLine === false) || (!error.code && /fetch|network|load failed/i.test(error.message ?? ""));
    throw new Error(network ? GROUP_EXAM_TEXT.offline : GROUP_EXAM_TEXT.actionFailed);
  }
  return data;
};

const sessionOrOverride = (row: unknown): GroupExamSession | CatalogOverride | null => sessionFromRow(row) ?? overrideFromRow(row);

const applyRow = (row: GroupExamSession | CatalogOverride | undefined, owner: number) => {
  // Esito arrivato dopo un'uscita o un cambio di account: non entra nello store di un altro.
  if (!row || owner !== generation) return;
  if ("courseKey" in row) useGroupExamStore.getState().applySession(row);
  else useGroupExamStore.getState().applyOverride(row);
};

/** Scritture sul server: la riga dell'esito (scritta, attuale o doppione) entra subito nello store. */
export const groupExamWriter: GroupExamWriter = {
  saveSession: async (groupId, id, expectedVersion, fields) => {
    const owner = generation;
    const result = writeResultFrom(await callRpc("save_group_exam_session", { p_group_id: groupId, p_id: id, p_expected_version: expectedVersion, p_fields: fields }), sessionFromRow);
    applyRow(result.row, owner);
    return result;
  },
  deleteSession: async (id, expectedVersion) => {
    const owner = generation;
    const result = writeResultFrom(await callRpc("delete_group_exam_session", { p_id: id, p_expected_version: expectedVersion }), sessionFromRow);
    applyRow(result.row, owner);
    return result;
  },
  restore: async (historyId, expectedVersion) => {
    const owner = generation;
    const result = writeResultFrom(await callRpc("restore_group_record", { p_history_id: historyId, p_expected_version: expectedVersion }), sessionOrOverride);
    applyRow(result.row, owner);
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
    const owner = generation;
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
    applyRow(result.row, owner);
    return result;
  },
  deleteOverride: async (id, expectedVersion) => {
    const owner = generation;
    const result = writeResultFrom(await callRpc("delete_group_catalog_override", { p_id: id, p_expected_version: expectedVersion }), overrideFromRow);
    applyRow(result.row, owner);
    return result;
  }
};
