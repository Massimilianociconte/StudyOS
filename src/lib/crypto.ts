import type { VaultRecord } from "../types";

const ITERATIONS = 250_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// Conversione a blocchi: evita concatenazioni byte-per-byte (lente su snapshot di diversi MB).
const CHUNK = 0x8000;

const toBase64 = (bytes: ArrayBuffer | Uint8Array) => {
  const array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const parts: string[] = [];
  for (let index = 0; index < array.length; index += CHUNK) {
    parts.push(String.fromCharCode.apply(null, array.subarray(index, index + CHUNK) as unknown as number[]));
  }
  return btoa(parts.join(""));
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

const deriveAesKey = async (passphrase: string, salt: Uint8Array, iterations = ITERATIONS) => {
  const material = await crypto.subtle.importKey("raw", encoder.encode(passphrase), "PBKDF2", false, [
    "deriveKey"
  ]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bufferSource(salt), iterations, hash: "SHA-256" },
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

/**
 * Chiave AES-GCM derivata una sola volta per sessione (PBKDF2 è volutamente lento).
 * Il salt resta quello del record vault; ogni cifratura usa un IV casuale nuovo,
 * quindi riusare la chiave è sicuro e il formato VaultRecord resta invariato.
 */
export interface VaultKey {
  key: CryptoKey;
  salt: string;
  iterations: number;
}

export const deriveVaultKey = async (passphrase: string, salt?: string, iterations = ITERATIONS): Promise<VaultKey> => {
  const saltBytes = salt ? fromBase64(salt) : crypto.getRandomValues(new Uint8Array(16));
  return { key: await deriveAesKey(passphrase, saltBytes, iterations), salt: toBase64(saltBytes), iterations };
};

export const encryptWithKey = async (plainText: string, vaultKey: VaultKey): Promise<VaultRecord> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const payload = await crypto.subtle.encrypt({ name: "AES-GCM", iv: bufferSource(iv) }, vaultKey.key, encoder.encode(plainText));
  return {
    id: "main",
    encrypted: true,
    algorithm: "AES-GCM",
    kdf: "PBKDF2-SHA256",
    iterations: vaultKey.iterations,
    salt: vaultKey.salt,
    iv: toBase64(iv),
    payload: toBase64(payload),
    updatedAt: new Date().toISOString()
  };
};

export const decryptWithKey = async (record: VaultRecord, vaultKey: VaultKey) => {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bufferSource(fromBase64(record.iv)) },
    vaultKey.key,
    fromBase64(record.payload)
  );
  return decoder.decode(decrypted);
};

export const encryptString = async (plainText: string, passphrase: string): Promise<VaultRecord> =>
  encryptWithKey(plainText, await deriveVaultKey(passphrase));

export const decryptString = async (record: VaultRecord, passphrase: string) =>
  decryptWithKey(record, await deriveVaultKey(passphrase, record.salt, record.iterations || ITERATIONS));
