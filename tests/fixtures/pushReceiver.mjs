// Lato dispositivo di una Web Push (RFC 8291), scritto a parte da worker/webPush.ts:
// serve ai test per decifrare ciò che il Worker invia. Solo WebCrypto.

const encoder = new TextEncoder();

export const b64u = (bytes) => Buffer.from(bytes).toString("base64url");
export const unb64u = (text) => new Uint8Array(Buffer.from(text, "base64url"));

const join = (...parts) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const hkdf = async (salt, ikm, info, length) => {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8));
};

/** Un dispositivo iscritto: chiavi ECDH P-256 e segreto `auth` come li dà `PushSubscription.toJSON()`. */
export async function makeReceiver() {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: pair.privateKey, publicKey, p256dh: b64u(publicKey), auth: b64u(auth) };
}

/** Decifra un corpo aes128gcm a record singolo; restituisce il testo e i campi dell'intestazione. */
export async function decryptPush(body, receiver) {
  const bytes = new Uint8Array(body);
  const salt = bytes.slice(0, 16);
  const recordSize = new DataView(bytes.buffer, bytes.byteOffset).getUint32(16);
  const idLength = bytes[20];
  const asPublic = bytes.slice(21, 21 + idLength);
  const record = bytes.slice(21 + idLength);
  const asKey = await crypto.subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: asKey }, receiver.privateKey, 256));
  const ikm = await hkdf(unb64u(receiver.auth), ecdh, join(encoder.encode("WebPush: info\0"), receiver.publicKey, asPublic), 32);
  const cek = await hkdf(salt, ikm, encoder.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, encoder.encode("Content-Encoding: nonce\0"), 12);
  const key = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, record));
  return {
    text: new TextDecoder().decode(padded.slice(0, -1)),
    delimiter: padded[padded.length - 1],
    recordSize,
    idLength,
    headerLength: 21 + idLength
  };
}
