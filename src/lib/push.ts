// Notifiche push di questo dispositivo: permesso del browser, iscrizione al servizio push e riga
// in studyos_push_subscriptions (da cui il database sceglie a chi mandare le notifiche).
// Si carica solo con import(): porta con sé supabase-js, che resta fuori dal bundle iniziale.
// Il permesso si chiede sempre e solo dopo un tocco della persona (enablePush).

import type { SupabaseClient } from "@supabase/supabase-js";
import { VAPID_PUBLIC_KEY } from "./pushKeys";
import { AUTH_STORAGE_KEYS } from "./deviceSignOut";
import { PUSH_STATE_KEY, storedAuthUserId, writePushAccount } from "./pushLocal";

export type PushSupport = "ok" | "unsupported" | "ios-install" | "denied";

export interface PushEnvironment {
  isIos: boolean;
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: "default" | "granted" | "denied" | null;
}

/** L'ordine conta: su iPhone una scheda di Safari non ha PushManager, e la cura è "aggiungi alla Home". */
export const classifyPushSupport = (environment: PushEnvironment): PushSupport => {
  if (environment.isIos && !environment.standalone) return "ios-install";
  if (!environment.hasServiceWorker || !environment.hasPushManager || !environment.hasNotification) return "unsupported";
  if (environment.permission === "denied") return "denied";
  return "ok";
};

export const base64UrlToBytes = (value: string): Uint8Array<ArrayBuffer> => {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** Se il browser non riporta la chiave si considera uguale: niente nuova iscrizione a ogni avvio. */
export const sameServerKey = (current: ArrayBuffer | null | undefined, expected: Uint8Array): boolean => {
  if (current === null || current === undefined) return true;
  const actual = new Uint8Array(current);
  if (actual.length !== expected.length) return false;
  for (let index = 0; index < actual.length; index += 1) if (actual[index] !== expected[index]) return false;
  return true;
};

export interface SubscriptionRow {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export const rowFromSubscription = (json: { endpoint?: string; keys?: Record<string, string> }): SubscriptionRow | null => {
  const endpoint = json.endpoint;
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!endpoint || !p256dh || !auth) return null;
  if (!endpoint.startsWith("https://")) return null;
  return { endpoint, p256dh, auth };
};

// Cosa ricorda questo dispositivo: con quale account e quale endpoint è stata registrata l'iscrizione,
// e se le notifiche dei promemoria arrivano senza titolo (password dell'app, pushPrivateOf).
const STATE_KEY = PUSH_STATE_KEY;
const REFRESH_EVERY_MS = 12 * 60 * 60 * 1000;

export interface PushState {
  endpoint: string;
  userId: string;
  at: number;
  /** Riga scritta con `private` (assente = stato di una versione precedente: si riscrive). */
  private?: boolean;
}

export const parsePushState = (raw: string | null): PushState | null => {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const { endpoint, userId, at, private: hidden } = value as Record<string, unknown>;
    if (typeof endpoint !== "string" || !endpoint) return null;
    if (typeof userId !== "string" || !userId) return null;
    if (typeof at !== "number" || !Number.isFinite(at)) return null;
    return typeof hidden === "boolean" ? { endpoint, userId, at, private: hidden } : { endpoint, userId, at };
  } catch {
    return null;
  }
};

// In pushLocal (senza dipendenze): serve anche allo svuotamento del dispositivo, nel bundle iniziale.
export { storedAuthUserId };

/**
 * L'account che ha acceso le notifiche qui non ha più una sessione su questo dispositivo: nessuna
 * sessione salvata (uscita da un'altra scheda, sessione scaduta o revocata e tolta da supabase-js)
 * o una sessione di un altro account. Una sessione ancora salvata ma non rinnovata (offline) non conta.
 */
export const pushOwnerSignedOut = (ownerId: string, rawAuth: string | null): boolean => {
  const stored = storedAuthUserId(rawAuth);
  return stored === null || (stored !== undefined && stored !== ownerId);
};

/** `hidden` (se detto): la riga va riscritta anche quando cambia la scelta del titolo nascosto. */
export const shouldRefresh = (previous: PushState | null, endpoint: string, userId: string, now: number, hidden?: boolean): boolean =>
  !previous ||
  previous.endpoint !== endpoint ||
  previous.userId !== userId ||
  now < previous.at ||
  now - previous.at >= REFRESH_EVERY_MS ||
  (hidden !== undefined && previous.private !== hidden);

/** Nome del servizio push dall'host dell'endpoint (mai l'endpoint intero, che è un segreto). */
export type PushDeviceKind = "chrome" | "firefox" | "safari" | "edge" | "other";
export const pushDeviceKindOf = (endpoint: string): PushDeviceKind => {
  let host = "";
  try {
    host = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (host === "fcm.googleapis.com" || host.endsWith(".googleapis.com")) return "chrome";
  if (host.endsWith(".mozilla.com") || host.endsWith(".mozaws.net")) return "firefox";
  if (host.endsWith(".push.apple.com")) return "safari";
  if (host.endsWith(".notify.windows.com")) return "edge";
  return "other";
};

/** Colonna `private` assente: people.sql non ancora rieseguito (si scrive la riga senza). */
export const isMissingPrivateColumn = (error: { code?: string | null; message?: string | null } | null | undefined) =>
  Boolean(error && /PGRST204|42703/.test(`${error.code ?? ""}`) && /private/i.test(`${error.message ?? ""}`));

const readState = (): PushState | null => {
  try {
    return parsePushState(window.localStorage.getItem(STATE_KEY));
  } catch {
    return null;
  }
};

const writeState = (state: PushState) => {
  try {
    window.localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    // storage non disponibile: la prossima partenza riallinea comunque
  }
};

const clearState = () => {
  try {
    window.localStorage.removeItem(STATE_KEY);
  } catch {
    // niente da pulire
  }
};

export const pushSupport = (): PushSupport => {
  if (typeof window === "undefined" || typeof navigator === "undefined") return "unsupported";
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches);
  const hasNotification = "Notification" in window;
  return classifyPushSupport({
    isIos,
    standalone,
    hasServiceWorker: "serviceWorker" in navigator,
    hasPushManager: "PushManager" in window,
    hasNotification,
    permission: hasNotification ? Notification.permission : null
  });
};

// ——— Browser e account ———

/** Il service worker c'è solo nella build pubblicata: in sviluppo non si arriva mai a iscriversi. */
const getRegistration = async (): Promise<ServiceWorkerRegistration | null> => {
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing?.active) return existing;
  return Promise.race([navigator.serviceWorker.ready, new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 5000))]);
};

interface Cloud {
  client: SupabaseClient;
  userId: string;
}

const cloudSession = async (): Promise<Cloud | null> => {
  const { supabase } = await import("./supabase");
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  return userId ? { client: supabase, userId } : null;
};

const TABLE = "studyos_push_subscriptions";

/**
 * Scrive la riga di questo dispositivo. `hidden`: promemoria senza titolo (il job manda «Promemoria
 * StudyOS» e l'ora). La sessione (`session_id`) la scrive il database dal token, non il client.
 */
const saveRow = async (cloud: Cloud, row: SubscriptionRow, hidden: boolean) => {
  const base = { ...row, last_seen_at: new Date().toISOString() };
  const result = await cloud.client.from(TABLE).upsert({ ...base, private: hidden }, { onConflict: "endpoint" });
  // Database non ancora aggiornato (people.sql senza la colonna): le notifiche funzionano lo stesso.
  if (isMissingPrivateColumn(result.error)) return cloud.client.from(TABLE).upsert(base, { onConflict: "endpoint" });
  return result;
};

const deleteRow = async (cloud: Cloud, endpoint: string) => {
  try {
    await cloud.client.from(TABLE).delete().eq("endpoint", endpoint);
  } catch {
    // offline: il servizio push scarta l'endpoint alla prima notifica e il server lo toglie (push_gone)
  }
};

/** Annulla l'iscrizione nel browser e toglie la sua riga. */
const forgetSubscription = async (cloud: Cloud, subscription: PushSubscription) => {
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe().catch(() => false);
  await deleteRow(cloud, endpoint);
};

/**
 * Chiede il permesso (se serve) e iscrive questo dispositivo. Da chiamare solo dal gestore di un
 * tocco: la prima cosa che aspetta è la richiesta di permesso, così il browser vede il gesto.
 * Ritorna false se il permesso manca, il browser rifiuta o la riga non si salva.
 * `private`: promemoria senza titolo su questo dispositivo (pushPrivateOf).
 */
export const enablePush = async ({ private: hidden = false }: { private?: boolean } = {}): Promise<boolean> => {
  if (pushSupport() !== "ok") return false;
  try {
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return false;
    const registration = await getRegistration();
    if (!registration) return false;
    const cloud = await cloudSession();
    if (!cloud) return false;

    const key = base64UrlToBytes(VAPID_PUBLIC_KEY);
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !sameServerKey(subscription.options.applicationServerKey, key)) {
      await forgetSubscription(cloud, subscription);
      subscription = null;
    }
    // Due tentativi: se il salvataggio fallisce (vincolo della tabella, rete) si annulla l'iscrizione
    // e se ne fa una nuova con un endpoint nuovo. Una riga rimasta a un altro account (uscita non
    // pulita) la rimpiazza il trigger del database prima dell'inserimento.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const row = rowFromSubscription(subscription.toJSON());
      if (row) {
        const { error } = await saveRow(cloud, row, hidden);
        if (!error) {
          writeState({ endpoint: row.endpoint, userId: cloud.userId, at: Date.now(), private: hidden });
          await writePushAccount(cloud.userId);
          return true;
        }
      }
      await subscription.unsubscribe().catch(() => false);
      subscription = null;
    }
    return false;
  } catch {
    return false;
  }
};

/** Spegne le notifiche di questo dispositivo: annulla l'iscrizione e toglie la riga. Non lancia mai. */
export const disablePush = async (): Promise<void> => {
  const state = readState();
  clearState();
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    const endpoint = subscription?.endpoint ?? state?.endpoint ?? null;
    if (subscription) await subscription.unsubscribe().catch(() => false);
    if (!endpoint) return;
    const cloud = await cloudSession();
    if (cloud) await deleteRow(cloud, endpoint);
  } catch {
    // niente da fare: l'iscrizione si ripulisce da sola alla prima notifica respinta
  }
};

const readAuthStorage = (): string | null => {
  try {
    return window.localStorage.getItem(AUTH_STORAGE_KEYS[0]);
  } catch {
    // storage illeggibile: come una sessione che non si sa leggere, non si tocca niente
    return "?";
  }
};

/**
 * Sessione finita senza passare da «Esci» (scaduta o revocata, uscita da un'altra scheda o da un
 * altro dispositivo con «esci ovunque», un altro account entrato): se questo dispositivo riceveva le
 * notifiche per l'account che non c'è più, l'iscrizione del browser si annulla, così le sue notifiche
 * smettono di comparire qui. La riga sul server non si può più togliere da qui (manca la sessione):
 * la toglie push_gone alla prima notifica respinta dal servizio push. Non lancia mai.
 */
export const dropPushOfEndedSession = async (): Promise<boolean> => {
  try {
    const state = readState();
    if (!state || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
    // Si aspetta che supabase-js abbia deciso della sessione salvata (rinnovata o tolta).
    const { supabase } = await import("./supabase");
    if (supabase) await supabase.auth.getSession().catch(() => undefined);
    if (!pushOwnerSignedOut(state.userId, readAuthStorage())) return false;
    clearState();
    // Il service worker non mostra più le push di quell'account (se la riga sul server resta).
    await writePushAccount(storedAuthUserId(readAuthStorage()) ?? null);
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    if (subscription) await subscription.unsubscribe().catch(() => false);
    return true;
  } catch {
    return false;
  }
};

/** L'interruttore è acceso se il permesso c'è, l'iscrizione esiste ed è di questo account. */
export const isPushEnabled = async (userId: string): Promise<boolean> => {
  if (pushSupport() !== "ok" || Notification.permission !== "granted") return false;
  if (readState()?.userId !== userId) return false;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration && (await registration.pushManager.getSubscription()));
  } catch {
    return false;
  }
};

/**
 * All'avvio con un account: se questo dispositivo aveva attivato le notifiche con questo account,
 * riallinea la riga (endpoint cambiato → sostituito; chiave del server cambiata → nuova iscrizione;
 * ogni 12 ore aggiorna last_seen_at; `private` cambiato → riscritto). Non iscrive mai chi non l'ha chiesto.
 */
export const syncPushSubscription = async ({ private: hidden }: { private?: boolean } = {}): Promise<void> => {
  try {
    if (pushSupport() !== "ok" || Notification.permission !== "granted") return;
    const previous = readState();
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration) return;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const cloud = await cloudSession();
    if (!cloud) return;
    // Dispositivo condiviso: l'iscrizione di un altro account (uscita non pulita) o senza stato
    // non deve continuare a ricevere le notifiche di chi non c'è più. La sua riga nel database
    // non è nostra da togliere: la ripulisce push_gone alla prima notifica respinta.
    if (!previous || cloud.userId !== previous.userId) {
      await subscription.unsubscribe().catch(() => false);
      clearState();
      return;
    }

    const key = base64UrlToBytes(VAPID_PUBLIC_KEY);
    if (!sameServerKey(subscription.options.applicationServerKey, key)) {
      await forgetSubscription(cloud, subscription);
      subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    }
    const row = rowFromSubscription(subscription.toJSON());
    if (!row) return;
    const now = Date.now();
    if (!shouldRefresh(previous, row.endpoint, cloud.userId, now, hidden)) return;
    const value = hidden ?? previous.private ?? false;
    const { error } = await saveRow(cloud, row, value);
    if (error) return;
    if (previous.endpoint !== row.endpoint) await deleteRow(cloud, previous.endpoint);
    writeState({ endpoint: row.endpoint, userId: cloud.userId, at: now, private: value });
  } catch {
    // rete assente o browser che rifiuta: si riprova al prossimo avvio
  }
};

/** Password dell'app accesa o spenta, «Mostra il titolo nelle notifiche» cambiato: riscrive `private`. */
export const updatePushPrivacy = async (hidden: boolean): Promise<void> => {
  const state = readState();
  if (!state || state.private === hidden) return;
  await syncPushSubscription({ private: hidden });
};

export interface PushDevice {
  id: string;
  kind: PushDeviceKind;
  lastSeenAt: string;
  /** È l'iscrizione di questo browser. */
  current: boolean;
}

const currentEndpoint = async (): Promise<string | null> => {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return readState()?.endpoint ?? null;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = registration ? await registration.pushManager.getSubscription() : null;
    return subscription?.endpoint ?? readState()?.endpoint ?? null;
  } catch {
    return readState()?.endpoint ?? null;
  }
};

/**
 * Dispositivi di questo account con le notifiche attive (Impostazioni), dal più recente. Solo il tipo
 * di browser e l'ultimo accesso: l'endpoint non esce da qui. null se non si riesce a leggere.
 */
export const listPushDevices = async (): Promise<PushDevice[] | null> => {
  try {
    const cloud = await cloudSession();
    if (!cloud) return null;
    const { data, error } = await cloud.client
      .from(TABLE)
      .select("id, endpoint, last_seen_at")
      .eq("user_id", cloud.userId)
      .order("last_seen_at", { ascending: false })
      .limit(50);
    if (error) return null;
    const here = await currentEndpoint();
    return ((data ?? []) as { id: string; endpoint: string; last_seen_at: string }[]).map((row) => ({
      id: row.id,
      kind: pushDeviceKindOf(row.endpoint),
      lastSeenAt: row.last_seen_at,
      current: Boolean(here && row.endpoint === here)
    }));
  } catch {
    return null;
  }
};

/**
 * «Rimuovi»: toglie la riga del dispositivo dal server, così smette subito di ricevere le notifiche
 * dell'account (anche un telefono perso). Se è questo browser, spegne anche l'iscrizione qui.
 */
export const removePushDevice = async (id: string): Promise<boolean> => {
  try {
    const cloud = await cloudSession();
    if (!cloud) return false;
    const here = await currentEndpoint();
    const { data, error } = await cloud.client.from(TABLE).delete().eq("user_id", cloud.userId).eq("id", id).select("endpoint");
    if (error) return false;
    const removed = ((data ?? []) as { endpoint: string }[]).map((row) => row.endpoint);
    if (here && removed.includes(here)) await disablePush();
    return true;
  } catch {
    return false;
  }
};
