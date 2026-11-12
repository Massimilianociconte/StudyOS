// Copia locale dei file dei materiali (Dexie v7: attachmentFiles, attachmentBytes, attachmentDeletes).
// Senza supabase-js: lo store la usa per aggiungere ed eliminare file, attachmentSync.ts per caricarli.
// Con il vault attivo i byte sono cifrati con la chiave della sessione (come la copia dei dati).
// Fuori dal browser (connettore remoto, test in Node) non c'è IndexedDB: tutto diventa un no-op.

import type { Attachment } from "../types";
import { decryptBytesWithKey, encryptBytesWithKey, type VaultKey } from "./crypto";
import { db, getMeta, setMeta, type AttachmentFileRow } from "./db";
import { PersistenceHaltedError, isPersistenceHalted, vaultSession } from "./persistence";
import { bumpLocalFiles } from "./attachmentStatus";
import { decodeDataUrl, hasFile, isSafeObjectId, planCacheEviction, sealingAction, uploadMime, withLocalFile, type LocalFileInfo } from "./attachments";
import { FILE_TEXT } from "./labels";

/** Account a cui sono legati i dati di questo dispositivo (scritto da cloudSync.ts). */
export const BOUND_USER_KEY = "cloud:boundUser";

/**
 * «Cancella anche dall'account»: richiesta di svuotare la cartella dei file dell'account (ora ISO).
 * Si scrive qui, nel bundle iniziale, prima di caricare attachmentSync.ts: anche offline la
 * richiesta resta e la passata dopo la esegue.
 */
export const fileEraseKey = (uid: string) => `files:erase:${uid}`;

export const requestAccountFilesErase = async (uid: string) => {
  if (!localFilesAvailable()) return;
  await setMeta(fileEraseKey(uid), new Date().toISOString());
  // Gli oggetti spariscono tutti: le eliminazioni in coda non servono più.
  await db.attachmentDeletes.clear();
};

export const localFilesAvailable = () => typeof indexedDB !== "undefined";

/** File cifrato e vault bloccato: non si può leggere adesso. */
export class FileLockedError extends Error {
  constructor() {
    super(FILE_TEXT.locked);
    this.name = "FileLockedError";
  }
}

/** Copia da caricare cifrata con una chiave che non c'è più (vault tolto o cambiato): illeggibile. */
export class FileUnreadableError extends Error {
  constructor() {
    super(FILE_TEXT.unreadable);
    this.name = "FileUnreadableError";
  }
}

const assertNotHalted = () => {
  if (isPersistenceHalted()) throw new PersistenceHaltedError();
};

const fileTables = () => [db.attachmentFiles, db.attachmentBytes] as const;

// ─── Chiavi del vault ────────────────────────────────────────────────────────
//
// Una scrittura iniziata con il vault attivo può finire dopo che il vault è stato tolto (o rifatto con
// un'altra password): la copia resterebbe cifrata con una chiave buttata. Le chiavi usate in questa
// pagina restano qui finché servono a rimettere in ordine queste copie. Mai con il vault bloccato:
// appena la sessione risulta bloccata si dimenticano (il blocco vale anche per i file).

const knownKeys = new Map<string, VaultKey>();
let lockWatch = false;

const rememberKey = (key: VaultKey) => {
  knownKeys.set(key.salt, key);
  if (lockWatch) return;
  lockWatch = true;
  // Al blocco del vault le chiavi tenute qui si dimenticano subito. import(): lo store importa questo
  // modulo, un import statico al contrario sarebbe circolare.
  void import("../store/useStudyStore")
    .then(({ useStudyStore }) =>
      useStudyStore.subscribe((state, previous) => {
        if (state.locked && !previous.locked) knownKeys.clear();
      })
    )
    .catch(() => {
      lockWatch = false;
    });
};

/** Il vault com'è adesso; se è bloccato, nessuna chiave resta in memoria qui. */
const session = () => {
  const current = vaultSession();
  if (current.mode && !current.key) knownKeys.clear();
  if (current.key) rememberKey(current.key);
  return current;
};

const sessionInfo = (current: ReturnType<typeof vaultSession>) => ({ mode: current.mode, salt: current.key?.salt });

/** Byte come vanno scritti adesso: cifrati con la chiave della sessione, o in chiaro senza vault. */
const sealForNow = async (bytes: ArrayBuffer): Promise<{ bytes: ArrayBuffer; sealed?: AttachmentFileRow["sealed"]; salt?: string }> => {
  const { mode, key } = session();
  if (!mode) return { bytes };
  if (!key) throw new FileLockedError();
  const result = await encryptBytesWithKey(bytes, key);
  return { bytes: result.bytes, sealed: { iv: result.iv, salt: result.salt }, salt: key.salt };
};

/** Il vault è cambiato rispetto a `salt` (chiave usata per scrivere, undefined = in chiaro)? */
const vaultChangedSince = (salt: string | undefined) => {
  const { mode, key } = session();
  if (mode && !key) return false; // bloccato: si sistema allo sblocco (sealLocalFiles / reconcile)
  return (mode ? key?.salt : undefined) !== salt;
};

/** Riscrive i byte in chiaro `plain` com'è il vault adesso, se la riga è ancora quella scritta con `salt`. */
const rewritePlain = async (id: string, plain: ArrayBuffer, salt: string | undefined) => {
  const stored = await sealForNow(plain);
  await db.transaction("rw", fileTables(), async () => {
    assertNotHalted();
    const current = await db.attachmentFiles.get(id);
    if (!current || current.sealed?.salt !== salt) return;
    const { sealed: _old, ...rest } = current;
    await db.attachmentBytes.put({ id, bytes: stored.bytes });
    await db.attachmentFiles.put({ ...rest, ...(stored.sealed ? { sealed: stored.sealed } : {}) });
  });
};

/**
 * Salva (o sostituisce) la copia locale. `pending`: unica copia, da caricare. La promise si risolve a
 * scrittura confermata: solo dopo si crea il materiale che la usa. Se intanto il vault è stato tolto o
 * cambiato, la copia si riscrive subito com'è il vault adesso (i byte in chiaro sono ancora qui).
 */
export const saveLocalFile = async (id: string, bytes: ArrayBuffer, info: { type: string; pending: boolean; uploadedFor?: string }) => {
  if (!isSafeObjectId(id)) throw new Error(FILE_TEXT.saveFailed);
  const stored = await sealForNow(bytes);
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
  // La copia è salvata: un errore qui (vault bloccato proprio ora) non la annulla, la sistema reconcile.
  let written = stored.salt;
  for (let attempt = 0; attempt < 3 && vaultChangedSince(written); attempt += 1) {
    const ok = await rewritePlain(id, bytes, written).then(() => true, () => false);
    if (!ok) break;
    written = session().key?.salt;
  }
  bumpLocalFiles();
};

/**
 * Copia non più leggibile: una cache si toglie (null = non c'è, si riscarica dall'account); una copia da
 * caricare resta (è l'unica) e si segnala con FileUnreadableError.
 */
const dropUnreadable = async (row: AttachmentFileRow) => {
  if (row.pending) throw new FileUnreadableError();
  await deleteLocalFiles([row.id]).catch(() => undefined);
  return null;
};

/**
 * Byte in chiaro della copia locale, null se qui non c'è (o era una cache illeggibile, ora tolta).
 * FileLockedError se cifrata e vault bloccato; FileUnreadableError se è una copia da caricare cifrata
 * con una chiave persa.
 */
export const readLocalBytes = async (id: string): Promise<{ bytes: ArrayBuffer; type: string; row: AttachmentFileRow } | null> => {
  if (!localFilesAvailable()) return null;
  const [row, data] = await db.transaction("r", fileTables(), () => Promise.all([db.attachmentFiles.get(id), db.attachmentBytes.get(id)]));
  if (!row || !data) return null;
  if (!row.sealed) return { bytes: data.bytes, type: row.type, row };
  const current = session();
  const action = sealingAction(row.sealed.salt, sessionInfo(current), new Set(knownKeys.keys()));
  if (action === "locked") throw new FileLockedError();
  const key = action === "ok" ? current.key : knownKeys.get(row.sealed.salt);
  const plain = key ? await decryptBytesWithKey(data.bytes, row.sealed.iv, key).catch(() => null) : null;
  if (!plain) return dropUnreadable(row);
  if (action === "rewrite") void rewritePlain(id, plain, row.sealed.salt).then(bumpLocalFiles, () => undefined);
  return { bytes: plain, type: row.type, row };
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

/** Id delle copie ancora da caricare (unica copia del file). */
export const pendingLocalFileIds = async (): Promise<string[]> => {
  if (!localFilesAvailable()) return [];
  return (await db.attachmentFiles.where("pending").equals(1).primaryKeys()) as string[];
};

/**
 * Copie da caricare che un'uscita con «togli i dati da qui» lascerebbe in chiaro: resetAllData le
 * decifra (sono l'unica copia del file) e poi toglie il vault. Vuoto senza vault o con il vault
 * bloccato (lì le copie si cancellano comunque). CloudPanel chiede prima se eliminarle.
 */
export const pendingFilesLeftPlain = async (): Promise<string[]> => {
  const { mode, key } = vaultSession();
  if (!mode || !key) return [];
  return pendingLocalFileIds();
};

/**
 * Caricamento confermato per `uid`: la copia diventa cache (si può togliere per spazio). `check` si
 * chiama dentro la transazione (es. localResetGuard: dispositivo svuotato a metà caricamento = la
 * copia resta da caricare e si ricarica quando torna il suo materiale).
 */
export const markUploaded = async (id: string, uid: string, check?: () => void) => {
  await db.transaction("rw", db.attachmentFiles, async () => {
    assertNotHalted();
    check?.();
    const row = await db.attachmentFiles.get(id);
    if (row) await db.attachmentFiles.put({ ...row, pending: 0, uploadedFor: uid });
  });
  bumpLocalFiles();
};

export const deleteLocalFiles = async (ids: readonly string[], check?: () => void) => {
  if (!ids.length || !localFilesAvailable()) return;
  await db.transaction("rw", fileTables(), async () => {
    assertNotHalted();
    check?.();
    await db.attachmentBytes.bulkDelete([...ids]);
    await db.attachmentFiles.bulkDelete([...ids]);
  });
  bumpLocalFiles();
};

/**
 * Materiale eliminato qui (dall'app o da un agente locale): via la copia locale e in coda l'eliminazione
 * dell'oggetto nel bucket, per l'account a cui erano legati i dati. L'oggetto si toglie solo dopo i 90
 * giorni della cronologia e solo se la riga nel cloud è ancora eliminata (attachmentSync.ts). Non lancia
 * mai: un'eliminazione non deve fallire per il file (al più resta un oggetto orfano).
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
      const { sealed: _old, ...rest } = current;
      await db.attachmentBytes.put({ id, bytes: next.bytes });
      await db.attachmentFiles.put({ ...rest, ...(next.row.sealed ? { sealed: next.row.sealed } : {}) });
    });
  }
  bumpLocalFiles();
};

/** Vault attivato (o sbloccato dopo un'attivazione interrotta): cifra le copie ancora in chiaro. */
export const sealLocalFiles = (key: VaultKey) => {
  rememberKey(key);
  return rewriteEach(async (row, bytes) => {
    if (row.sealed) return null;
    const result = await encryptBytesWithKey(bytes, key);
    return { row: { ...row, sealed: { iv: result.iv, salt: result.salt } }, bytes: result.bytes };
  });
};

/**
 * Vault da disattivare: decifra le copie con la sua chiave (o con una chiave di prima ancora in
 * memoria). Va fatto PRIMA di togliere il record del vault: un'interruzione lascia file in chiaro
 * (leggibili), mai file cifrati con una chiave persa. Le scritture che finiscono dopo questa passata
 * si sistemano da sole (saveLocalFile) o con reconcileLocalSealing.
 */
export const unsealLocalFiles = (key: VaultKey) => {
  rememberKey(key);
  return rewriteEach(async (row, bytes) => {
    const sealedWith = row.sealed ? (row.sealed.salt === key.salt ? key : knownKeys.get(row.sealed.salt)) : undefined;
    if (!row.sealed || !sealedWith) return null;
    // Una copia rovinata non si decifra comunque: si salta, il resto continua (reconcile la sistema).
    const plain = await decryptBytesWithKey(bytes, row.sealed.iv, sealedWith).catch(() => null);
    if (!plain) return null;
    const { sealed: _dropped, ...rest } = row;
    return { row: rest, bytes: plain };
  });
};

/**
 * Mette ogni copia in linea con il vault di adesso: riscrive quelle cifrate con una chiave di prima
 * ancora in memoria, cifra quelle in chiaro con il vault attivo, toglie le cache cifrate con una chiave
 * persa (si riscaricano). Le copie da caricare illeggibili restano: sono l'unica traccia del file.
 * Con il vault bloccato non fa nulla. Restituisce gli id delle copie da caricare illeggibili.
 */
export const reconcileLocalSealing = async (): Promise<string[]> => {
  if (!localFilesAvailable() || isPersistenceHalted()) return [];
  const current = session();
  if (current.mode && !current.key) return [];
  const rows = await db.attachmentFiles.toArray();
  const known = new Set(knownKeys.keys());
  const drop: string[] = [];
  const unreadable: string[] = [];
  let changed = false;
  for (const row of rows) {
    const action = sealingAction(row.sealed?.salt, sessionInfo(current), known);
    if (action === "ok" || action === "locked") continue;
    if (action === "lost") {
      (row.pending ? unreadable : drop).push(row.id);
      continue;
    }
    const data = await db.attachmentBytes.get(row.id);
    if (!data) continue;
    const key = row.sealed ? knownKeys.get(row.sealed.salt) : undefined;
    const plain = row.sealed ? (key ? await decryptBytesWithKey(data.bytes, row.sealed.iv, key).catch(() => null) : null) : data.bytes;
    if (!plain) {
      (row.pending ? unreadable : drop).push(row.id);
      continue;
    }
    if (await rewritePlain(row.id, plain, row.sealed?.salt).then(() => true, () => false)) changed = true;
  }
  if (drop.length) {
    await deleteLocalFiles(drop);
    changed = true;
  }
  // Chiavi di vault non più in uso e senza copie che le usano: via dalla memoria.
  const stillSealed = new Set((await db.attachmentFiles.toArray()).flatMap((row) => (row.sealed ? [row.sealed.salt] : [])));
  for (const salt of [...knownKeys.keys()]) {
    if (salt !== current.key?.salt && !stillSealed.has(salt)) knownKeys.delete(salt);
  }
  if (changed) bumpLocalFiles();
  return unreadable;
};

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
