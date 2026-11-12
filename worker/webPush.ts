// Web Push con sola WebCrypto (Cloudflare Workers e Node >= 20, nessuna dipendenza).
// - Cifratura del messaggio: RFC 8291 (aes128gcm di RFC 8188, un solo record).
// - Identità del server: RFC 8292 (VAPID, JWT ES256).
// - Intestazioni di consegna: RFC 8030 (TTL, Urgency, Topic).

type Bytes = Uint8Array<ArrayBuffer>;

export type WebPushSubscription = { endpoint: string; p256dh: string; auth: string };
export type WebPushOptions = { publicKey: string; privateKey: string; subject: string; topic?: string };
export type SenderKeys = { publicKey: Uint8Array; privateKey: CryptoKey };

/** Dimensione del record dichiarata nell'intestazione (RFC 8291 §4). */
export const RECORD_SIZE = 4096;
/** 4096 - 86 (intestazione) - 1 (delimitatore) - 16 (tag AES-GCM). */
export const MAX_PLAINTEXT_BYTES = 3993;
/** Le push valgono 24 ore: chi è spento più a lungo non riceve notifiche vecchie. */
export const PUSH_TTL_SECONDS = 86_400;
/** Scadenza del JWT VAPID: 12 ore, metà del massimo ammesso (24 ore) per tollerare orologi sfasati. */
export const VAPID_EXPIRY_SECONDS = 43_200;
/** Una richiesta al servizio push che non risponde entro 10 s conta come fallita. */
export const PUSH_TIMEOUT_MS = 10_000;

const encoder = new TextEncoder();
const BASE64URL = /^[A-Za-z0-9_-]*$/;

export const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromBase64Url = (text: string): Bytes => {
  const clean = text.replace(/=+$/, "");
  if (!BASE64URL.test(clean) || clean.length % 4 === 1) throw new Error("base64url non valido");
  const binary = atob(clean.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (clean.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const p256Point = (value: string, what: string): Bytes => {
  const point = fromBase64Url(value);
  if (point.length !== 65 || point[0] !== 4) throw new Error(`${what}: serve un punto P-256 non compresso di 65 byte`);
  return point;
};

/**
 * Importa una chiave privata P-256 dal solo scalare `d` (base64url, 32 byte) più la sua chiave
 * pubblica: WebCrypto non accetta il formato "raw" per le chiavi private, quindi passa da JWK.
 */
export async function importEcPrivateKey(publicKey: string, privateKey: string, algorithm: "ECDH" | "ECDSA"): Promise<CryptoKey> {
  const point = p256Point(publicKey, "Chiave pubblica");
  const d = fromBase64Url(privateKey);
  if (d.length !== 32) throw new Error("Chiave privata: servono 32 byte");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: toBase64Url(point.subarray(1, 33)),
    y: toBase64Url(point.subarray(33, 65)),
    d: toBase64Url(d)
  };
  return crypto.subtle.importKey("jwk", jwk, { name: algorithm, namedCurve: "P-256" }, false, algorithm === "ECDSA" ? ["sign"] : ["deriveBits"]);
}

async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
}

/**
 * Cifratura RFC 8291 con sale e chiavi del mittente dati. Uso interno e test con i vettori
 * dell'RFC: in produzione passa da `encryptPayload`, che li genera nuovi a ogni messaggio.
 */
export async function encryptPayloadWith(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  salt: Uint8Array,
  sender: SenderKeys
): Promise<Bytes> {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) throw new Error(`Messaggio push oltre ${MAX_PLAINTEXT_BYTES} byte`);
  if (salt.length !== 16) throw new Error("Il sale deve essere di 16 byte");
  const uaPublic = p256Point(p256dh, "p256dh");
  const asPublic = concat(sender.publicKey);
  if (asPublic.length !== 65 || asPublic[0] !== 4) throw new Error("Chiave pubblica del mittente non valida");
  const authSecret = fromBase64Url(auth);
  if (authSecret.length !== 16) throw new Error("auth: servono 16 byte");

  // importKey "raw" verifica che il punto stia sulla curva (RFC 8291 §7).
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, sender.privateKey, 256));

  // RFC 8291 §3.3-3.4: segreto di autenticazione + ECDH -> IKM; poi CEK e nonce di RFC 8188.
  const keyInfo = concat(encoder.encode("WebPush: info"), new Uint8Array([0]), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const saltBytes = concat(salt);
  const cek = await hkdf(saltBytes, ikm, concat(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdf(saltBytes, ikm, concat(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);

  // Un solo record: testo + delimitatore 0x02 (ultimo record), nessun riempimento.
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const record = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, concat(plaintext, new Uint8Array([2])))
  );

  // Intestazione aes128gcm: salt(16) | rs(4, big endian) | idlen(1) | keyid(65) = 86 byte.
  const header = new Uint8Array(86);
  header.set(saltBytes, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = 65;
  header.set(asPublic, 21);
  return concat(header, record);
}

/** Cifra `plaintext` per l'iscrizione (`p256dh`, `auth` in base64url) con chiavi e sale nuovi. */
export async function encryptPayload(plaintext: Uint8Array, p256dh: string, auth: string): Promise<Uint8Array<ArrayBuffer>> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const publicKey = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return encryptPayloadWith(plaintext, p256dh, auth, salt, { publicKey, privateKey: pair.privateKey });
}

/**
 * Valore completo dell'intestazione Authorization VAPID (RFC 8292):
 * `vapid t=<JWT ES256>, k=<chiave pubblica base64url>`; `aud` è l'origine dell'endpoint.
 */
export async function vapidAuthorization(
  endpoint: string,
  publicKey: string,
  privateKey: string,
  subject: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const aud = new URL(endpoint).origin;
  const part = (value: unknown) => toBase64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${part({ typ: "JWT", alg: "ES256" })}.${part({ aud, exp: nowSeconds + VAPID_EXPIRY_SECONDS, sub: subject })}`;
  const key = await importEcPrivateKey(publicKey, privateKey, "ECDSA");
  // WebCrypto firma ECDSA nel formato r||s (64 byte), lo stesso che vuole JWS.
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned)));
  return `vapid t=${unsigned}.${toBase64Url(signature)}, k=${publicKey}`;
}

/**
 * Topic RFC 8030: al massimo 32 caratteri base64url. I tag degli eventi (`group-invite:<id>`)
 * hanno `:` e sono più lunghi: si usa l'inizio del loro SHA-256, stabile e senza collisioni pratiche.
 */
export async function pushTopic(tag: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(tag)));
  return toBase64Url(digest).slice(0, 32);
}

/** Cifra, firma e consegna una push. Restituisce lo stato HTTP del servizio push (201 = accettata). */
export async function sendWebPush(sub: WebPushSubscription, payload: string, opts: WebPushOptions): Promise<{ status: number }> {
  const body = await encryptPayload(encoder.encode(payload), sub.p256dh, sub.auth);
  const headers: Record<string, string> = {
    authorization: await vapidAuthorization(sub.endpoint, opts.publicKey, opts.privateKey, opts.subject),
    "content-encoding": "aes128gcm",
    "content-type": "application/octet-stream",
    ttl: String(PUSH_TTL_SECONDS),
    urgency: "normal"
  };
  if (opts.topic) headers.topic = await pushTopic(opts.topic);
  const response = await fetch(sub.endpoint, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(PUSH_TIMEOUT_MS)
  });
  await response.body?.cancel();
  return { status: response.status };
}
