import type { VaultRecord } from "../types";

const ITERATIONS = 250_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const toBase64 = (bytes: ArrayBuffer | Uint8Array) => {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  array.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
};

const fromBase64 = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const bufferSource = (bytes: Uint8Array) =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const deriveAesKey = async (passphrase: string, salt: Uint8Array) => {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, [
    "deriveKey"
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bufferSource(salt), iterations: ITERATIONS, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
};

export const makePassphraseVerifier = async (passphrase: string, existingSalt?: string) => {
  const salt = existingSalt ? fromBase64(existingSalt) : crypto.getRandomValues(new Uint8Array(16));
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, [
    "deriveBits"
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: bufferSource(salt), iterations: ITERATIONS, hash: "SHA-256" },
    material,
    256
  );
  return { salt: toBase64(salt), hash: toBase64(bits) };
};

export const verifyPassphrase = async (passphrase: string, salt: string, hash: string) => {
  const verifier = await makePassphraseVerifier(passphrase, salt);
  return verifier.hash === hash;
};

export const encryptString = async (plainText: string, passphrase: string): Promise<VaultRecord> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);
  const payload = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferSource(iv) }, key, encoder.encode(plainText));

  return {
    id: "main",
    encrypted: true,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    payload: toBase64(payload),
    updatedAt: new Date().toISOString()
  };
};

export const decryptString = async (record: VaultRecord, passphrase: string) => {
  const key = await deriveAesKey(passphrase, fromBase64(record.salt));
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferSource(fromBase64(record.iv)) },
    key,
    fromBase64(record.payload)
  );
  return decoder.decode(decrypted);
};
