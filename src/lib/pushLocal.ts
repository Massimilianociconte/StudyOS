// Stato delle notifiche condiviso tra la pagina e il service worker di questo dispositivo, in Cache
// Storage (il service worker non legge localStorage), con le stesse chiavi di public/sw.js:
// - quale account è entrato qui: il service worker non mostra le push di un altro account;
// - quali promemoria sono già comparsi come notifica (dalla push o dalla scheda aperta): la scheda
//   aperta non ripete un promemoria che la push ha già mostrato, e viceversa la push arriva in
//   silenzio.
// Nessuna dipendenza: sta nel bundle iniziale (guardia della sessione) e nei test in Node.
import type { UserSettings } from "../types";

export const PUSH_LOCAL_CACHE = "studyos-push-local-v1";
/** localStorage: account ed endpoint con cui questo dispositivo ha acceso le notifiche (push.ts). */
export const PUSH_STATE_KEY = "studyos-push-state";
/** Titolo delle notifiche dei promemoria senza titolo (stesso testo di push-reminders.sql). */
export const PRIVATE_REMINDER_TITLE = "Promemoria StudyOS";
const PREFIX = "/__studyos__/";
export const REMINDER_TAG_PREFIX = "studyos-reminder-";
/** Una notifica comparsa fino a 2 minuti prima dell'istante del promemoria conta già (orologi, cron). */
export const SHOWN_EARLY_MS = 2 * 60_000;
/** Per quanto si ricordano i promemoria comparsi. */
export const SHOWN_KEEP_MS = 3 * 24 * 60 * 60_000;

export type ShownBy = "push" | "page";

export interface ShownRecord {
  at: number;
  by: ShownBy;
}

export const accountKeyUrl = (origin: string) => `${origin}${PREFIX}push-account`;
export const shownKeyUrl = (origin: string, tag: string) => `${origin}${PREFIX}reminder-shown/${encodeURIComponent(tag)}`;

const searchOf = (url: string) => {
  try {
    return new URL(url).searchParams;
  } catch {
    return null;
  }
};

/** Istante e origine salvati nella chiave (`…?at=…&by=…`). */
export const parseShownKey = (url: string): ShownRecord | null => {
  const params = searchOf(url);
  if (!params) return null;
  const at = Number(params.get("at"));
  const by = params.get("by");
  if (!Number.isFinite(at) || at <= 0 || (by !== "push" && by !== "page")) return null;
  return { at, by };
};

/** Account salvato nella chiave (`…?account=…`): stringa vuota = nessun account entrato qui. */
export const parseAccountKey = (url: string): string | null => {
  const params = searchOf(url);
  const account = params?.get("account");
  return account ? account : null;
};

/** La notifica di questo promemoria è già comparsa su questo dispositivo (dalla push o dalla scheda). */
export const alreadyShown = (record: ShownRecord | null | undefined, atMs: number) =>
  Boolean(record && record.at >= atMs - SHOWN_EARLY_MS);

/**
 * Notifiche dei promemoria senza titolo su questo dispositivo: password dell'app attiva e «Mostra il
 * titolo nelle notifiche» spento. Senza password il titolo resta.
 */
export const pushPrivateOf = (settings: Pick<UserSettings, "security" | "pushShowTitles"> | null | undefined) =>
  settings?.security?.mode === "vault" && settings.pushShowTitles !== true;

/** Questo dispositivo ha acceso le notifiche push (stato salvato da push.ts). */
export const hasPushState = (): boolean => {
  try {
    return typeof localStorage !== "undefined" && Boolean(localStorage.getItem(PUSH_STATE_KEY));
  } catch {
    return false;
  }
};

interface CacheLike {
  keys(request?: string, options?: { ignoreSearch?: boolean }): Promise<readonly { url: string }[]>;
  put(request: string, response: Response): Promise<void>;
  delete(request: string, options?: { ignoreSearch?: boolean }): Promise<boolean>;
}
export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
}

const defaultStorage = (): CacheStorageLike | null =>
  typeof caches !== "undefined" ? (caches as unknown as CacheStorageLike) : null;
const defaultOrigin = (): string | null => (typeof location !== "undefined" && location.origin ? location.origin : null);

const openLocal = async (api: CacheStorageLike | null) => (api ? api.open(PUSH_LOCAL_CACHE) : null);

/** Ultima volta che il promemoria con questo tag è comparso qui; null se mai (o storage assente). */
export const readReminderShown = async (
  tag: string,
  api: CacheStorageLike | null = defaultStorage(),
  origin: string | null = defaultOrigin()
): Promise<ShownRecord | null> => {
  try {
    const cache = await openLocal(api);
    if (!cache || !origin) return null;
    let best: ShownRecord | null = null;
    for (const key of await cache.keys(shownKeyUrl(origin, tag), { ignoreSearch: true })) {
      const record = parseShownKey(key.url);
      if (record && (!best || record.at > best.at)) best = record;
    }
    return best;
  } catch {
    return null;
  }
};

/** Ricorda che il promemoria è comparso qui e toglie i ricordi più vecchi di 3 giorni. Non lancia mai. */
export const recordReminderShown = async (
  tag: string,
  by: ShownBy,
  now: number = Date.now(),
  api: CacheStorageLike | null = defaultStorage(),
  origin: string | null = defaultOrigin()
): Promise<void> => {
  try {
    const cache = await openLocal(api);
    if (!cache || !origin) return;
    const base = shownKeyUrl(origin, tag);
    await cache.delete(base, { ignoreSearch: true });
    await cache.put(`${base}?at=${now}&by=${by}`, new Response(""));
    for (const key of await cache.keys()) {
      const record = key.url.includes(`${PREFIX}reminder-shown/`) ? parseShownKey(key.url) : null;
      if (record && now - record.at > SHOWN_KEEP_MS) await cache.delete(key.url);
    }
  } catch {
    // storage pieno o assente: al peggio una notifica in più
  }
};

/** Account entrato su questo dispositivo (null = uscito), letto dal service worker. Non lancia mai. */
export const writePushAccount = async (
  userId: string | null,
  api: CacheStorageLike | null = defaultStorage(),
  origin: string | null = defaultOrigin()
): Promise<void> => {
  try {
    const cache = await openLocal(api);
    if (!cache || !origin) return;
    const base = accountKeyUrl(origin);
    await cache.delete(base, { ignoreSearch: true });
    await cache.put(`${base}?account=${encodeURIComponent(userId ?? "")}`, new Response(""));
  } catch {
    // storage assente: il service worker mostra tutto, come prima
  }
};

/** Account salvato (undefined = mai salvato su questo dispositivo). */
export const readPushAccount = async (
  api: CacheStorageLike | null = defaultStorage(),
  origin: string | null = defaultOrigin()
): Promise<string | null | undefined> => {
  try {
    const cache = await openLocal(api);
    if (!cache || !origin) return undefined;
    const [key] = await cache.keys(accountKeyUrl(origin), { ignoreSearch: true });
    return key ? parseAccountKey(key.url) : undefined;
  } catch {
    return undefined;
  }
};
