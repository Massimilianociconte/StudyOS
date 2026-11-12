// POST /push: il database (studyos_push_notify via pg_net) chiede di consegnare una notifica a
// un elenco di iscrizioni. Il Worker cifra e firma ogni push, poi segnala a push_gone gli
// endpoint scaduti (404/410). Nessuna chiave di servizio: solo la chiave publishable e il segreto
// condiviso. Nei log solo conteggi, mai titoli, testi o endpoint.
import { VAPID_PUBLIC_KEY } from "../src/lib/pushKeys";
import { sendWebPush, type WebPushSubscription } from "./webPush";

export interface PushEnv {
  STUDYOS_PUSH_SECRET?: string;
  STUDYOS_VAPID_PRIVATE_KEY?: string;
  STUDYOS_SUPABASE_URL?: string;
  STUDYOS_SUPABASE_KEY?: string;
}

export type PushNotification = {
  kind: "invite" | "accepted" | "permission";
  title: string;
  body: string;
  url: string;
  tag: string;
};

/** Contatto VAPID: l'URL del sito, nessun dato personale. */
export const VAPID_SUBJECT = "https://massimilianociconte.github.io/StudyOS/";
export const MAX_PUSH_BODY_BYTES = 64 * 1024;
export const MAX_PUSH_SUBSCRIPTIONS = 49;
/** Workers apre al massimo 6 connessioni in uscita alla volta per richiesta: oltre farebbe solo coda. */
export const PUSH_CONCURRENCY = 6;
export const MAX_TITLE_CHARS = 120;
export const MAX_BODY_CHARS = 400;

const KINDS = new Set(["invite", "accepted", "permission"]);
const OPEN_URL = /^\?apri=[a-z]{1,30}$/;
const TAG = /^[\x21-\x7e]{1,200}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

/** Confronto a tempo costante: si confrontano i due SHA-256, così non conta neppure la lunghezza. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(given)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected))
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}

/** Legge il corpo fino a `limit` byte; oltre restituisce null senza leggere il resto. */
async function readLimited(request: Request, limit: number): Promise<string | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > limit) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

const isText = (value: unknown, min: number, max: number): value is string =>
  typeof value === "string" && value.length >= min && value.length <= max;

/** Taglia a `max` caratteri senza spezzare emoji o lettere fuori dal piano base. */
const clip = (value: string, max: number) => {
  const chars = Array.from(value);
  return chars.length > max ? chars.slice(0, max).join("") : value;
};

export function parseNotification(value: unknown): PushNotification | null {
  if (!value || typeof value !== "object") return null;
  const { kind, title, body, url, tag } = value as Record<string, unknown>;
  if (typeof kind !== "string" || !KINDS.has(kind)) return null;
  if (typeof title !== "string" || !title.trim() || typeof body !== "string") return null;
  if (typeof url !== "string" || !OPEN_URL.test(url)) return null;
  if (typeof tag !== "string" || !TAG.test(tag)) return null;
  // Solo i cinque campi della tabella Interfacce finiscono nel messaggio cifrato, con testi corti: un nome di
  // gruppo lunghissimo accorcia la notifica invece di farla fallire (limite RFC 8291: 3993 byte).
  return { kind: kind as PushNotification["kind"], title: clip(title, MAX_TITLE_CHARS), body: clip(body, MAX_BODY_CHARS), url, tag };
}

export function parseSubscription(value: unknown): WebPushSubscription | null {
  if (!value || typeof value !== "object") return null;
  const { endpoint, p256dh, auth } = value as Record<string, unknown>;
  if (!isText(endpoint, 1, 2048) || typeof p256dh !== "string" || typeof auth !== "string") return null;
  const key = p256dh.replace(/=+$/, "");
  const secret = auth.replace(/=+$/, "");
  // 65 byte -> 87 caratteri base64url; 16 byte -> 22 caratteri.
  if (key.length !== 87 || !BASE64URL.test(key) || secret.length !== 22 || !BASE64URL.test(secret)) return null;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  return { endpoint, p256dh: key, auth: secret };
}

async function eachLimited<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>) {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/**
 * Cancella le iscrizioni scadute tramite l'RPC push_gone (chiave publishable + segreto).
 * Un errore qui non tocca la risposta: le iscrizioni restano e si ripulisce al prossimo invio
 * (sul piano Free: al massimo 49 push + 1 push_gone = 50 sottorichieste).
 */
async function reportGone(env: PushEnv, endpoints: string[]): Promise<number | null> {
  if (!endpoints.length || !env.STUDYOS_SUPABASE_URL || !env.STUDYOS_SUPABASE_KEY) return null;
  try {
    const response = await fetch(`${env.STUDYOS_SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/rpc/push_gone`, {
      method: "POST",
      headers: { apikey: env.STUDYOS_SUPABASE_KEY, "content-type": "application/json" },
      body: JSON.stringify({ p_secret: env.STUDYOS_PUSH_SECRET, p_endpoints: endpoints })
    });
    if (!response.ok) {
      await response.body?.cancel();
      console.warn(JSON.stringify({ push_gone: response.status }));
      return null;
    }
    const removed = await response.json();
    return typeof removed === "number" ? removed : null;
  } catch {
    console.warn(JSON.stringify({ push_gone: "network" }));
    return null;
  }
}

/**
 * `POST /push` con intestazione `x-studyos-push-secret`. Corpo:
 * `{ notification: {kind,title,body,url,tag}, subscriptions: [{endpoint,p256dh,auth}] }`.
 * Risposta `{ sent, gone }`. `publicKey` serve ai test; in produzione è quella di pushKeys.ts.
 */
export async function handlePush(request: Request, env: PushEnv, publicKey: string = VAPID_PUBLIC_KEY): Promise<Response> {
  if (request.method !== "POST") return json(405, { error: "Usa POST" }, { allow: "POST" });
  const secret = env.STUDYOS_PUSH_SECRET ?? "";
  const privateKey = env.STUDYOS_VAPID_PRIVATE_KEY ?? "";
  if (!secret || !privateKey || !publicKey) return json(503, { error: "Push non configurate" });
  if (!(await sameSecret(request.headers.get("x-studyos-push-secret") ?? "", secret))) {
    return json(401, { error: "Segreto mancante o errato" });
  }

  const text = await readLimited(request, MAX_PUSH_BODY_BYTES);
  if (text === null) return json(413, { error: "Corpo oltre 64 kB" });
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return json(400, { error: "JSON non valido" });
  }
  const input = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const notification = parseNotification(input.notification);
  if (!notification) return json(400, { error: "Notifica non valida" });
  if (!Array.isArray(input.subscriptions)) return json(400, { error: "Iscrizioni mancanti" });
  if (input.subscriptions.length > MAX_PUSH_SUBSCRIPTIONS) return json(400, { error: `Al massimo ${MAX_PUSH_SUBSCRIPTIONS} iscrizioni` });

  const unique = new Map<string, WebPushSubscription>();
  let skipped = 0;
  for (const raw of input.subscriptions) {
    const subscription = parseSubscription(raw);
    if (!subscription) skipped += 1;
    else if (!unique.has(subscription.endpoint)) unique.set(subscription.endpoint, subscription);
  }

  const payload = JSON.stringify(notification);
  const options = { publicKey, privateKey, subject: VAPID_SUBJECT, topic: notification.tag };
  const gone: string[] = [];
  const statuses: Record<string, number> = {};
  let sent = 0;
  let failed = 0;
  await eachLimited([...unique.values()], PUSH_CONCURRENCY, async (subscription) => {
    try {
      const { status } = await sendWebPush(subscription, payload, options);
      statuses[status] = (statuses[status] ?? 0) + 1;
      if (status >= 200 && status < 300) sent += 1;
      else if (status === 404 || status === 410) gone.push(subscription.endpoint);
      else failed += 1;
    } catch {
      failed += 1;
    }
  });

  const removed = await reportGone(env, gone);
  console.log(JSON.stringify({ push: { total: unique.size, sent, gone: gone.length, failed, skipped, removed, statuses } }));
  return json(200, { sent, gone: gone.length });
}
