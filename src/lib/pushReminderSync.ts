// Promemoria con l'app chiusa: tiene allineate le righe di `studyos_push_reminders`
// (supabase/push-reminders.sql) con i promemoria dei prossimi 7 giorni. Il server le manda come
// notifiche push all'ora giusta (pg_cron → studyos_push_due_reminders → Worker /push) ai dispositivi
// con le notifiche attive. Si carica solo con import() (dal watcher dei promemoria); supabase-js
// arriva solo quando serve. Senza account (ospite) non fa nulla.
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { useGroupExamStore } from "../store/useGroupExamStore";
import { reminderSourceEvents } from "./reminderSources";
import { getCloudSyncState, subscribeCloudSync } from "./cloudSyncState";
import { PUSH_CHANGED_EVENT } from "./pushDevice";
import {
  chunk,
  diffPushReminders,
  isMissingReminderTable,
  pushReminderFingerprint,
  pushReminderRows,
  pushRemindersWanted,
  reminderRowId,
  reminderSyncReady,
  rowZoneOf,
  serverRowOf,
  trackReminderAccount,
  type ReminderAccountTrack,
  type ServerReminderRow
} from "./pushReminders";
import { deviceTimeZone } from "./tz";

const TABLE = "studyos_push_reminders";
const SUBSCRIPTIONS = "studyos_push_subscriptions";
/** Dopo una modifica si aspetta un attimo: più modifiche di fila diventano una sola scrittura. */
const DEBOUNCE_MS = 4000;
/** Ogni tanto si ricontrolla anche senza modifiche: i 7 giorni scorrono in avanti. */
const RECHECK_MS = 30 * 60_000;
/** Oltre questo tempo si rilegge il server anche con le stesse righe (altri dispositivi, notifiche). */
const FULL_RECHECK_MS = 6 * 60 * 60_000;
const UPSERT_BATCH = 100;
const DELETE_BATCH = 50;

/** Inizio della pagina: i dati locali valgono solo dopo una sincronizzazione finita dopo di lui. */
const PAGE_START_MS =
  typeof performance !== "undefined" && Number.isFinite(performance.timeOrigin) && performance.timeOrigin > 0
    ? performance.timeOrigin
    : Date.now();

type Result = "signed-out" | "waiting" | "unchanged" | "missing" | "failed" | "ok";

let missingTable = false;
/** Dispositivi dell'account con le notifiche attive all'ultimo controllo (null = non ancora noto). */
let deviceCount: number | null = null;
let lastFingerprint = "";
let lastFullAt = 0;
/** Account della sessione e da quando: i dati dello store valgono per lui solo dopo un suo giro di sync. */
let track: ReminderAccountTrack | null = null;

/** Segue l'account della sessione e dice se i dati dello store sono i suoi, aggiornati. */
const readyFor = (cloud: ReturnType<typeof getCloudSyncState>) => {
  const userId = cloud.session?.user.id ?? null;
  track = trackReminderAccount(track, userId, Date.now(), PAGE_START_MS);
  return reminderSyncReady({ userId, status: cloud.status, lastSync: cloud.lastSync, accountChoice: cloud.accountChoice }, track);
};

/** Ancora lo stesso account dopo un'attesa di rete: altrimenti non si scrive niente. */
const stillSignedIn = (userId: string) => getCloudSyncState().session?.user.id === userId;

const loadClient = async () => {
  const { supabase } = await import("./supabase");
  return supabase;
};

/** Un giro: righe volute dallo store, righe in attesa sul server, poi solo le differenze. */
export const syncPushRemindersNow = async (): Promise<Result> => {
  const cloud = getCloudSyncState();
  const userId = cloud.session?.user.id;
  if (!userId) return "signed-out";
  if (missingTable) return "missing";
  // Dati locali di questo account e aggiornati: niente righe da un dispositivo rimasto indietro né
  // dall'account di prima (cambio di account, scelta «ask» ancora aperta).
  if (!readyFor(cloud)) return "waiting";
  const store = useStudyStore.getState();
  if (store.loading || store.locked) return "waiting";

  const now = new Date();
  // Stesse sorgenti del watcher in app: eventi, appelli scelti, promemoria autonomi.
  const events = reminderSourceEvents({ events: store.events, examPlans: store.examPlans, reminders: store.reminders, groupSessions: useGroupExamStore.getState().sessions });
  const zone = rowZoneOf(deviceTimeZone());
  const wanted = pushRemindersWanted(selectPreferences(store));
  const rows = wanted ? pushReminderRows(events, now) : [];
  const fingerprint = `${userId}|${wanted}|${pushReminderFingerprint(rows)}`;
  if (fingerprint === lastFingerprint && Date.now() - lastFullAt < FULL_RECHECK_MS) return "unchanged";

  const client = await loadClient();
  if (!client) return "failed";
  try {
    // Nessun dispositivo con le notifiche attive: le righe non servono, si tolgono.
    let devices = 0;
    if (wanted) {
      const { count, error } = await client.from(SUBSCRIPTIONS).select("id", { count: "exact", head: true }).eq("user_id", userId);
      if (error && !isMissingReminderTable(error)) return "failed";
      devices = error ? 0 : count ?? 0;
    }
    deviceCount = devices;
    const desired = devices > 0 ? rows : [];

    const { data, error } = await client
      .from(TABLE)
      .select("id, fire_at, title, body, url, tag, zone")
      .eq("user_id", userId)
      .is("sent_at", null)
      .gt("fire_at", now.toISOString())
      .order("fire_at", { ascending: true })
      .limit(1000);
    if (error) {
      if (isMissingReminderTable(error)) {
        missingTable = true;
        return "missing";
      }
      return "failed";
    }
    // Le righe scritte da un dispositivo in un altro fuso restano se sono ancora giuste per quel fuso.
    const { upserts, deletes } = diffPushReminders(
      desired,
      (data ?? []) as ServerReminderRow[],
      now.getTime(),
      desired.length ? { zone, rowsInZone: (other) => pushReminderRows(events, now, { zone: other }) } : { zone }
    );
    if (!stillSignedIn(userId)) return "waiting";
    // Prima si toglie, poi si scrive: il tetto di righe per account sul server non si supera per un attimo.
    for (const ids of chunk(deletes, DELETE_BATCH)) {
      const { error: deleteError } = await client.from(TABLE).delete().eq("user_id", userId).in("id", ids);
      if (deleteError) return "failed";
    }
    for (const batch of chunk(upserts, UPSERT_BATCH)) {
      if (!stillSignedIn(userId)) return "waiting";
      const { error: upsertError } = await client
        .from(TABLE)
        .upsert(batch.map((row) => ({ user_id: userId, ...serverRowOf(row) })), { onConflict: "user_id,id" });
      if (upsertError) return "failed";
    }
    lastFingerprint = fingerprint;
    lastFullAt = Date.now();
    return "ok";
  } catch {
    return "failed";
  }
};

/**
 * La scheda aperta ha mostrato il promemoria come notifica di sistema: il server non lo manda più.
 * Se partono tutti e due (stesso istante), il tag uguale fa vedere una notifica sola. Non lancia mai.
 */
export const markReminderShown = async (key: string): Promise<void> => {
  try {
    const cloud = getCloudSyncState();
    const userId = cloud.session?.user.id;
    if (!userId || missingTable || deviceCount === 0 || !readyFor(cloud)) return;
    const client = await loadClient();
    if (!client) return;
    const { error } = await client
      .from(TABLE)
      .update({ sent_at: new Date().toISOString() })
      .eq("user_id", userId)
      .eq("id", reminderRowId(key))
      .is("sent_at", null);
    if (isMissingReminderTable(error)) missingTable = true;
  } catch {
    // offline: al peggio arriva anche la push, con lo stesso tag (una notifica sola)
  }
};

/** «Cancella anche dall'account»: tutte le righe dei promemoria dell'account. Non lancia mai. */
export const clearPushReminders = async (): Promise<void> => {
  lastFingerprint = "";
  lastFullAt = 0;
  try {
    const userId = getCloudSyncState().session?.user.id;
    if (!userId || missingTable) return;
    const client = await loadClient();
    if (!client) return;
    const { error } = await client.from(TABLE).delete().eq("user_id", userId);
    if (isMissingReminderTable(error)) missingTable = true;
  } catch {
    // il server le elimina comunque con erase_studyos_account_items, o scadono da sole
  }
};

let starts = 0;
let stopAll: (() => void) | null = null;

/**
 * Avvia la sincronizzazione: dopo le modifiche a eventi e preferenze, a ogni giro della sync cloud,
 * quando le notifiche del dispositivo cambiano e ogni 30 minuti. Restituisce la funzione di arresto.
 */
export const startPushReminderSync = (): (() => void) => {
  starts += 1;
  if (!stopAll) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let running = false;
    let again = false;
    const run = async () => {
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        await syncPushRemindersNow();
      } finally {
        running = false;
        if (again) {
          again = false;
          schedule();
        }
      }
    };
    const schedule = (delay = DEBOUNCE_MS) => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void run();
      }, delay);
    };
    const unsubscribeStore = useStudyStore.subscribe((state, previous) => {
      if (
        state.events !== previous.events ||
        state.examPlans !== previous.examPlans ||
        state.reminders !== previous.reminders ||
        state.preferences !== previous.preferences ||
        state.locked !== previous.locked
      )
        schedule();
    });
    const unsubscribeGroupExams = useGroupExamStore.subscribe((state, previous) => {
      if (state.sessions !== previous.sessions) schedule();
    });
    let cloudKey = "";
    const unsubscribeCloud = subscribeCloudSync((state) => {
      track = trackReminderAccount(track, state.session?.user.id ?? null, Date.now(), PAGE_START_MS);
      const key = `${state.session?.user.id ?? ""}|${state.status}|${state.lastSync ?? ""}|${state.accountChoice ? 1 : 0}`;
      if (key === cloudKey) return;
      const userChanged = key.split("|")[0] !== cloudKey.split("|")[0];
      cloudKey = key;
      if (userChanged) {
        lastFingerprint = "";
        deviceCount = null;
      }
      if (state.session && state.status === "idle") schedule();
    });
    const onPushChanged = () => {
      lastFingerprint = "";
      schedule();
    };
    window.addEventListener(PUSH_CHANGED_EVENT, onPushChanged);
    const interval = setInterval(() => schedule(0), RECHECK_MS);
    stopAll = () => {
      if (timer !== undefined) clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener(PUSH_CHANGED_EVENT, onPushChanged);
      unsubscribeStore();
      unsubscribeGroupExams();
      unsubscribeCloud();
    };
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    starts -= 1;
    if (starts === 0 && stopAll) {
      stopAll();
      stopAll = null;
    }
  };
};
