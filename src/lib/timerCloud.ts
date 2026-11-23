// Timer di studio nel cloud dell'account (studyos_timer_states, supabase/agent-parity.sql, 1.12.0):
// lo stesso timer su ogni dispositivo con l'accesso fatto e per il connettore remoto, che lo legge e
// lo cambia con l'app chiusa. Vince lo stato con changedAt più recente, come tra due schede
// (setTimerState in useStudyStore). Il timer resta anche in localStorage: senza cloud tutto come prima.
// Modulo pigro: lo carica App dopo l'avvio, solo con il cloud configurato.

import { cloudConfigured, getCloudSyncState, subscribeCloudSync } from "./cloudSyncState";
import { normalizeTimer, saveTimer, type TimerState } from "./studyTimer";
import { timerCloudPlan } from "./timerCloudPlan";
import { supabase } from "./supabase";
import { useStudyStore } from "../store/useStudyStore";

const PULL_MS = 30_000;
const PUSH_DELAY_MS = 1_200;
/** Account a cui appartiene il timer di questo dispositivo (l'ultimo con cui si è allineato). */
export const TIMER_OWNER_KEY = "studyos-timer-cloud-user";

/** Tabella non ancora creata (agent-parity.sql non eseguito): il timer resta solo su questo dispositivo. */
const missingTable = (error: { code?: string; message?: string }) =>
  error.code === "PGRST205" || error.code === "42P01" || /does not exist|could not find the table/i.test(error.message ?? "");

const stampOf = (timer: Pick<TimerState, "changedAt"> | null | undefined) => timer?.changedAt ?? 0;

const readOwner = () => {
  try {
    return localStorage.getItem(TIMER_OWNER_KEY);
  } catch {
    return null;
  }
};

const writeOwner = (user: string) => {
  try {
    localStorage.setItem(TIMER_OWNER_KEY, user);
  } catch {
    // storage non disponibile: si riallinea al prossimo avvio
  }
};

export const startTimerCloud = () => {
  const client = supabase;
  if (!cloudConfigured || !client) return () => undefined;
  let stopped = false;
  let missing = false;
  // Account allineato (pull riuscito): solo allora le modifiche di qui vanno nel cloud.
  let user: string | null = null;
  // changedAt già uguale sul server: niente push di ritorno per uno stato appena letto.
  let synced = 0;
  let pushTimer: number | undefined;
  let pulling = false;

  const adopt = (remote: TimerState) => {
    synced = Math.max(synced, stampOf(remote));
    // Come un'altra scheda: localStorage (le altre schede ricevono l'evento) e poi lo store.
    saveTimer(remote);
    useStudyStore.getState().reloadStudyTimer();
  };

  const signedInUser = () => {
    const sync = getCloudSyncState();
    return sync.session && !sync.accountChoice ? sync.session.user.id : null;
  };

  const push = async () => {
    pushTimer = undefined;
    const current = signedInUser();
    if (stopped || missing || !user || current !== user) return;
    const timer = useStudyStore.getState().timer;
    if (stampOf(timer) <= synced) return;
    const { data, error } = await client.rpc("studyos_timer_put", { p_state: timer });
    // Uscita o cambio di account durante l'invio: la risposta è dell'account di prima.
    if (error || stopped || signedInUser() !== user) return;
    const saved = data && typeof data === "object" ? normalizeTimer(data) : null;
    if (!saved) return;
    synced = Math.max(synced, stampOf(saved));
    // Un altro dispositivo (o l'assistente) l'ha cambiato dopo: vince il suo.
    if (stampOf(saved) > stampOf(useStudyStore.getState().timer)) adopt(saved);
  };

  const schedulePush = () => {
    if (pushTimer !== undefined) window.clearTimeout(pushTimer);
    pushTimer = window.setTimeout(() => void push().catch(() => undefined), PUSH_DELAY_MS);
  };

  const pull = async () => {
    const current = signedInUser();
    if (stopped || missing || !current || pulling) return;
    pulling = true;
    try {
      const { data, error } = await client.from("studyos_timer_states").select("state").eq("user_id", current).maybeSingle();
      if (error) {
        if (missingTable(error)) missing = true;
        return;
      }
      if (signedInUser() !== current) return;
      const raw = (data as { state?: unknown } | null)?.state;
      const remote = raw && typeof raw === "object" ? normalizeTimer(raw) : null;
      if (remote) synced = Math.max(synced, stampOf(remote));
      const local = useStudyStore.getState().timer;
      const step = timerCloudPlan(local, remote, readOwner(), current);
      user = current;
      if (step.owner) writeOwner(step.owner);
      if (step.action === "adopt" && remote) adopt(remote);
      else if (step.action === "push") schedulePush();
      // Timer di un altro account: resta qui ma non si manda; parte solo una modifica fatta da ora.
      else synced = Math.max(synced, stampOf(local));
    } catch {
      // Rete assente: al prossimo controllo.
    } finally {
      pulling = false;
    }
  };

  const unsubscribeStore = useStudyStore.subscribe((state, previous) => {
    if (state.timer === previous.timer || !user) return;
    if (stampOf(state.timer) > synced) schedulePush();
  });
  const unsubscribeSync = subscribeCloudSync(() => {
    const current = signedInUser();
    if (current === user) return;
    // Uscita o cambio di account: niente push finché il timer del nuovo account non è letto.
    user = null;
    synced = 0;
    if (current) void pull();
  });
  const onVisible = () => {
    if (document.visibilityState === "visible") void pull();
  };
  const interval = window.setInterval(() => {
    if (document.visibilityState === "visible") void pull();
  }, PULL_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("online", onVisible);

  return () => {
    stopped = true;
    if (pushTimer !== undefined) window.clearTimeout(pushTimer);
    window.clearInterval(interval);
    unsubscribeStore();
    unsubscribeSync();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.removeEventListener("online", onVisible);
  };
};
