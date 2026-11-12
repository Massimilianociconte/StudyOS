// Copia locale dei file dei materiali (Dexie v7: attachmentFiles, attachmentBytes, attachmentDeletes).
// Senza supabase-js: lo store la usa per aggiungere ed eliminare file, attachmentSync.ts per caricarli.
// Con il vault attivo i byte sono cifrati con la chiave della sessione (come la copia dei dati).
// Fuori dal browser (connettore remoto, test in Node) non c'è IndexedDB: tutto diventa un no-op.

import type { Attachment } from "../types";
import { decryptBytesWithKey, encryptBytesWithKey, type VaultKey } from "./crypto";
import { db, getMeta, type AttachmentFileRow } from "./db";
import { PersistenceHaltedError, isPersistenceHalted, vaultSession } from "./persistence";
import { bumpLocalFiles } from "./attachmentStatus";
import { decodeDataUrl, hasFile, isSafeObjectId, planCacheEviction, uploadMime, withLocalFile, type LocalFileInfo } from "./attachments";
import { FILE_TEXT } from "./labels";

/** Account a cui sono legati i dati di questo dispositivo (scritto da cloudSync.ts). */
export const BOUND_USER_KEY = "cloud:boundUser";

export const localFilesAvailable = () => typeof indexedDB !== "undefined";

/** File cifrato e vault bloccato (o chiave di un vault precedente): non si può leggere adesso. */
export class FileLockedError extends Error {
  constructor() {
    super(FILE_TEXT.locked);
    this.name = "FileLockedError";
  }
}

const assertNotHalted = () => {
  if (isPersistenceHalted()) throw new PersistenceHaltedError();
};

const fileTables = () => [db.attachmentFiles, db.attachmentBytes] as const;

const sealed = async (bytes: ArrayBuffer): Promise<{ bytes: ArrayBuffer; sealed?: AttachmentFileRow["sealed"] }> => {
  const { mode, key } = vaultSession();
  if (!mode) return { bytes };
  if (!key) throw new FileLockedError();
  const result = await encryptBytesWithKey(bytes, key);
  return { bytes: result.bytes, sealed: { iv: result.iv, salt: result.salt } };
};

/**
 * Salva (o sostituisce) la copia locale. `pending`: unica copia, da caricare. La promise si risolve a
 * scrittura confermata: solo dopo si crea il materiale che la usa.
 */
export const saveLocalFile = async (id: string, bytes: ArrayBuffer, info: { type: string; pending: boolean; uploadedFor?: string }) => {
  if (!isSafeObjectId(id)) throw new Error(FILE_TEXT.saveFailed);
  const stored = await sealed(bytes);
  const row: AttachmentFileRow = {
    id,
    pending: info.pending ? 1 : 0,
    ...(info.uploadedFor ? { uploadedFor: info.uploadedFor } : {}),
    type: info.type,
    size: bytes.byteLength,
    usedAt: Date.now(),
    ...(stored.sealed ? { sealed: stored.sealed } : {})
  };
  await db.transaction("rw", fileTables(), async () => {
    assertNotHalted();
    await db.attachmentBytes.put({ id, bytes: stored.bytes });
    await db.attachmentFiles.put(row);
  });
  bumpLocalFiles();
};

/** Byte in chiaro della copia locale, null se qui non c'è. FileLockedError se cifrata e illeggibile ora. */
export const readLocalBytes = async (id: string): Promise<{ bytes: ArrayBuffer; type: string; row: AttachmentFileRow } | null> => {
  if (!localFilesAvailable()) return null;
  const [row, data] = await db.transaction("r", fileTables(), () => Promise.all([db.attachmentFiles.get(id), db.attachmentBytes.get(id)]));
  if (!row || !data) return null;
  if (!row.sealed) return { bytes: data.bytes, type: row.type, row };
  const { key } = vaultSession();
  if (!key || key.salt !== row.sealed.salt) throw new FileLockedError();
  return { bytes: await decryptBytesWithKey(data.bytes, row.sealed.iv, key), type: row.type, row };
};

export const touchLocalFile = async (id: string) => {
  if (!localFilesAvailable() || isPersistenceHalted()) return;
  await db.attachmentFiles.update(id, { usedAt: Date.now() });
};

/** Indice della copia locale (solo metadati, senza leggere i byte). */
export const localFileIndex = async (): Promise<Map<string, LocalFileInfo & { type: string }>> => {
  if (!localFilesAvailable()) return new Map();
  const rows = await db.attachmentFiles.toArray();
  return new Map(rows.map((row) => [row.id, { pending: row.pending, uploadedFor: row.uploadedFor, size: row.size, usedAt: row.usedAt, type: row.type }]));
};

/** Caricamento confermato per `uid`: la copia diventa cache (si può togliere per spazio). */
export const markUploaded = async (id: string, uid: string) => {
  await db.transaction("rw", db.attachmentFiles, async () => {
    assertNotHalted();
    const row = await db.attachmentFiles.get(id);
    if (row) await db.attachmentFiles.put({ ...row, pending: 0, uploadedFor: uid });
  });
  bumpLocalFiles();
};

export const deleteLocalFiles = async (ids: readonly string[]) => {
  if (!ids.length || !localFilesAvailable()) return;
  await db.transaction("rw", fileTables(), async () => {
    assertNotHalted();
    await db.attachmentBytes.bulkDelete([...ids]);
    await db.attachmentFiles.bulkDelete([...ids]);
  });
  bumpLocalFiles();
};

/**
 * Materiale eliminato qui (dall'app o da un agente locale): via la copia locale e in coda l'eliminazione
 * dell'oggetto nel bucket, per l'account a cui erano legati i dati. Non lancia mai: un'eliminazione
 * non deve fallire per il file (al più resta un oggetto orfano).
 */
export const forgetMaterialFile = async (material: Pick<Attachment, "id" | "dataUrl" | "storedFile" | "externalUrl">) => {
  if (!localFilesAvailable() || !isSafeObjectId(material.id)) return;
  try {
    const row = await db.attachmentFiles.get(material.id);
    if (!row && !hasFile(material)) return;
    const owner = row?.uploadedFor ?? (await getMeta<string>(BOUND_USER_KEY));
    await db.transaction("rw", [db.attachmentFiles, db.attachmentBytes, db.attachmentDeletes], async () => {
      assertNotHalted();
      await db.attachmentBytes.delete(material.id);
      await db.attachmentFiles.delete(material.id);
      // Anche un file "local" di un altro dispositivo: se intanto l'ha caricato, l'oggetto va tolto.
      await db.attachmentDeletes.put({ id: material.id, ...(owner ? { owner } : {}), queuedAt: Date.now() });
    });
    bumpLocalFiles();
  } catch {
    // Copia locale non raggiungibile: il materiale si elimina comunque.
  }
};

/**
 * Svuotamento del dispositivo. `keepPending`: le copie da caricare restano (sono l'unica copia; tornano
 * a caricarsi quando torna il loro materiale), via la cache e la coda delle eliminazioni.
 */
export const clearLocalFiles = async ({ keepPending }: { keepPending: boolean }) => {
  if (!localFilesAvailable()) return;
  await db.transaction("rw", [db.attachmentFiles, db.attachmentBytes, db.attachmentDeletes], async () => {
    assertNotHalted();
    if (keepPending) {
      const cache = await db.attachmentFiles.where("pending").equals(0).primaryKeys();
      await db.attachmentBytes.bulkDelete(cache);
      await db.attachmentFiles.bulkDelete(cache);
    } else {
      await db.attachmentBytes.clear();
      await db.attachmentFiles.clear();
      await db.attachmentDeletes.clear();
    }
  });
  bumpLocalFiles();
};

/** Toglie la cache usata meno di recente oltre il limite (mai le copie da caricare). */
export const trimLocalCache = async () => {
  if (!localFilesAvailable()) return;
  const rows = await db.attachmentFiles.toArray();
  await deleteLocalFiles(planCacheEviction(rows));
};

/**
 * Riscrive una riga alla volta (cifrare è asincrono: non può stare dentro una transazione Dexie). Prima
 * di scrivere ricontrolla che la riga sia ancora quella letta: un file eliminato intanto non torna.
 */
const rewriteEach = async (convert: (row: AttachmentFileRow, bytes: ArrayBuffer) => Promise<{ row: AttachmentFileRow; bytes: ArrayBuffer } | null>) => {
  if (!localFilesAvailable()) return;
  const ids = await db.attachmentFiles.toCollection().primaryKeys();
  for (const id of ids) {
    const [row, data] = await db.transaction("r", fileTables(), () => Promise.all([db.attachmentFiles.get(id), db.attachmentBytes.get(id)]));
    if (!row || !data) continue;
    const next = await convert(row, data.bytes);
    if (!next) continue;
    await db.transaction("rw", fileTables(), async () => {
      assertNotHalted();
      const current = await db.attachmentFiles.get(id);
      if (!current || JSON.stringify(current.sealed ?? null) !== JSON.stringify(row.sealed ?? null)) return;
      await db.attachmentBytes.put({ id, bytes: next.bytes });
      await db.attachmentFiles.put({ ...current, sealed: next.row.sealed });
    });
  }
  bumpLocalFiles();
};

/** Vault attivato (o sbloccato dopo un'attivazione interrotta): cifra le copie ancora in chiaro. */
export const sealLocalFiles = (key: VaultKey) =>
  rewriteEach(async (row, bytes) => {
    if (row.sealed) return null;
    const result = await encryptBytesWithKey(bytes, key);
    return { row: { ...row, sealed: { iv: result.iv, salt: result.salt } }, bytes: result.bytes };
  });

/**
 * Vault da disattivare: decifra le copie con la sua chiave. Va fatto PRIMA di togliere il record del
 * vault: un'interruzione lascia file in chiaro (leggibili), mai file cifrati con una chiave persa.
 */
export const unsealLocalFiles = (key: VaultKey) =>
  rewriteEach(async (row, bytes) => {
    if (!row.sealed || row.sealed.salt !== key.salt) return null;
    // Una copia rovinata non si decifra comunque: si salta, il resto continua.
    const plain = await decryptBytesWithKey(bytes, row.sealed.iv, key).catch(() => null);
    if (!plain) return null;
    const { sealed: _dropped, ...rest } = row;
    return { row: rest, bytes: plain };
  });

/**
 * Import di un backup: i file incorporati (`dataUrl`) diventano copie locali da caricare e la riga resta
 * senza byte, così non passano mai dalla sync. Fuori dal browser restano come sono.
 */
export const ingestEmbeddedFiles = async <T extends Attachment>(items: readonly T[]): Promise<T[]> => {
  if (!localFilesAvailable()) return [...items];
  const result: T[] = [];
  for (const item of items) {
    const decoded = isSafeObjectId(item.id) ? decodeDataUrl(item.dataUrl) : null;
    if (!decoded) {
      result.push(item);
      continue;
    }
    const type = uploadMime(item.name ?? "", item.mimeType || decoded.mime);
    const bytes = decoded.bytes.buffer.slice(decoded.bytes.byteOffset, decoded.bytes.byteOffset + decoded.bytes.byteLength) as ArrayBuffer;
    await saveLocalFile(item.id, bytes, { type, pending: true });
    result.push(withLocalFile(item, type, decoded.bytes.byteLength));
  }
  return result;
};
