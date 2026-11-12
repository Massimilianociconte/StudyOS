// File dei materiali nello spazio file privato dell'account (bucket `studyos-files`, supabase/storage.sql).
// Caricato solo con import(): fuori dal bundle iniziale come cloudSync.ts.
//
// - caricamento dei file aggiunti qui (copia locale `pending`) e migrazione dei file incorporati di prima:
//   solo con account collegato, dati locali legati a quell'account, rete, vault sbloccato e scheda attiva;
//   la riga perde i byte solo a caricamento confermato;
// - download su richiesta (con cache) e file condivisi da altri (senza cache);
// - eliminazioni in coda e svuotamento della cartella dell'account.
// Lo Storage si chiama via REST con fetch: il client supabase-js ha un timeout di 30 s per richiesta,
// troppo poco per 25 MB su una rete lenta. Il token è quello della sessione di supabase-js.
// Design: docs/superpowers/specs/2026-11-12-attachments-storage-design.md.

import type { Attachment } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { getCloudSyncState, subscribeCloudSync } from "./cloudSyncState";
import { db, deleteMeta, getMeta, setMeta } from "./db";
import { isPersistenceHalted } from "./persistence";
import { pullEntityRow, supabase } from "./supabase";
import { downloadBlob } from "./backup";
import {
  FILES_BUCKET,
  decodeDataUrl,
  encodeDataUrl,
  isStorageMissing,
  objectPath,
  planFileWork,
  retryDelay,
  sanitizeFileName,
  storageErrorText,
  uploadMime
} from "./attachments";
import {
  BOUND_USER_KEY,
  FileLockedError,
  deleteLocalFiles,
  localFileIndex,
  localFilesAvailable,
  markUploaded,
  readLocalBytes,
  saveLocalFile,
  touchLocalFile,
  trimLocalCache
} from "./attachmentFiles";
import { setFileError, setUploading } from "./attachmentStatus";
import { FILE_TEXT } from "./labels";

/** Lavoro massimo per passata (caricamenti e migrazioni ciascuno): il resto alla passata dopo. */
const PER_PASS = 4;
const ORPHAN_CHECKS_PER_PASS = 5;
const PERIODIC_MS = 5 * 60_000;
const ORPHAN_RECHECK_MS = 60 * 60_000;
const eraseKey = (uid: string) => `files:erase:${uid}`;

const storageUrl = () => {
  const base = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, "");
  return base ? `${base}/storage/v1` : null;
};
const publishableKey = () => import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const isOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
const currentUid = () => getCloudSyncState().session?.user.id ?? null;
const storeReady = () => {
  const state = useStudyStore.getState();
  return !state.loading && !state.locked && !isPersistenceHalted();
};

class StorageHttpError extends Error {
  statusCode: string;
  constructor(statusCode: number, message: string) {
    super(message);
    this.name = "StorageHttpError";
    this.statusCode = String(statusCode);
  }
}

class SessionChangedError extends Error {}

const segment = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/** Più tempo ai file grandi: 60 s più circa 50 KB/s. */
const timeoutFor = (bytes = 0) => 60_000 + Math.ceil(bytes / 50_000) * 1000;

const storageFetch = async (path: string, init: RequestInit & { bytes?: number } = {}) => {
  const base = storageUrl();
  const apikey = publishableKey();
  if (!base || !apikey || !supabase) throw new Error(FILE_TEXT.signInToOpen);
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error(FILE_TEXT.signInToOpen);
  const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(timeoutFor(init.bytes)) : undefined;
  const { bytes: _bytes, headers, ...rest } = init;
  const response = await fetch(`${base}${path}`, { ...rest, signal, headers: { apikey, Authorization: `Bearer ${token}`, ...(headers ?? {}) } });
  if (!response.ok) {
    let message = response.statusText || "storage error";
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.message || body.error || message;
    } catch {
      // risposta senza JSON
    }
    throw new StorageHttpError(response.status, message);
  }
  return response;
};

// Stesse chiamate di storage-js (upload con corpo binario, download, remove, list).
const uploadObject = async (path: string, bytes: ArrayBuffer, type: string) => {
  await storageFetch(`/object/${FILES_BUCKET}/${segment(path)}`, {
    method: "POST",
    body: bytes,
    bytes: bytes.byteLength,
    headers: { "content-type": type, "x-upsert": "true", "cache-control": "max-age=3600" }
  });
};

const downloadObject = async (path: string, size?: number) =>
  (await storageFetch(`/object/${FILES_BUCKET}/${segment(path)}`, { method: "GET", bytes: size })).blob();

const removeObjects = async (paths: readonly string[]) => {
  for (let index = 0; index < paths.length; index += 100) {
    await storageFetch(`/object/${FILES_BUCKET}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefixes: paths.slice(index, index + 100) })
    });
  }
};

interface ListedObject {
  name: string;
  id: string | null;
  created_at?: string | null;
}

const listFolder = async (folder: string) => {
  const items: ListedObject[] = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await storageFetch(`/object/list/${FILES_BUCKET}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prefix: folder, limit: 1000, offset, sortBy: { column: "name", order: "asc" } })
    });
    const page = (await response.json()) as ListedObject[];
    items.push(...page.filter((item) => item.id !== null));
    if (page.length < 1000) return items;
  }
};

// ─── Passata di lavoro ──────────────────────────────────────────────────────

const retry = new Map<string, { attempts: number; at: number }>();
const orphanCheckedAt = new Map<string, number>();

const failed = (id: string, error: unknown) => {
  const attempts = (retry.get(id)?.attempts ?? 0) + 1;
  // Bucket assente (storage.sql non eseguito): inutile riprovare ogni minuto.
  const wait = isStorageMissing(error) ? 30 * 60_000 : retryDelay(attempts);
  retry.set(id, { attempts, at: Date.now() + wait });
  setFileError(id, error instanceof FileLockedError ? FILE_TEXT.locked : storageErrorText(error, FILE_TEXT.uploadFailed));
};

const succeeded = (id: string) => {
  retry.delete(id);
  setFileError(id, undefined);
};

const assertSameUser = (uid: string) => {
  if (currentUid() !== uid || !storeReady()) throw new SessionChangedError();
};

/** I dati di questo dispositivo sono di questo account (cloudSync.ts ha finito di collegarli). */
const boundTo = async (uid: string) => (await getMeta<string>(BOUND_USER_KEY)) === uid;

/** Righe segnate come caricate; i materiali spariti intanto: via oggetto e copia locale. */
const markStored = async (uid: string, items: { id: string; dataUrl?: string }[]) => {
  if (!items.length) return;
  assertSameUser(uid);
  const { stored, missing } = await useStudyStore.getState().markAttachmentsStored(items);
  stored.forEach(succeeded);
  if (missing.length) {
    await removeObjects(missing.map((id) => objectPath(uid, id))).catch(() => undefined);
    await deleteLocalFiles(missing);
  }
};

const uploadLocal = async (uid: string, id: string) => {
  const local = await readLocalBytes(id);
  if (!local) return;
  setUploading(id, true);
  try {
    await uploadObject(objectPath(uid, id), local.bytes, local.type);
    await markUploaded(id, uid);
    await markStored(uid, [{ id }]);
  } finally {
    setUploading(id, false);
  }
};

const migrateEmbedded = async (uid: string, id: string) => {
  const material = useStudyStore.getState().attachments.find((item) => item.id === id);
  const dataUrl = material?.dataUrl;
  const decoded = decodeDataUrl(dataUrl);
  if (!material || !dataUrl || !decoded) return;
  const type = uploadMime(material.name, material.mimeType || decoded.mime);
  const bytes = decoded.bytes.buffer.slice(decoded.bytes.byteOffset, decoded.bytes.byteOffset + decoded.bytes.byteLength) as ArrayBuffer;
  setUploading(id, true);
  try {
    await uploadObject(objectPath(uid, id), bytes, type);
    // Copia locale come cache (si apre anche offline); se non si salva, il file è comunque nel cloud.
    await saveLocalFile(id, bytes, { type, pending: false, uploadedFor: uid }).catch(() => undefined);
    // Il dataUrl si toglie solo ora, e solo se è ancora quello caricato.
    await markStored(uid, [{ id, dataUrl }]);
  } finally {
    setUploading(id, false);
  }
};

/** Copie da caricare senza materiale: si tolgono solo se il cloud dice che il materiale è stato eliminato. */
const checkOrphans = async (uid: string, ids: readonly string[]) => {
  const now = Date.now();
  const due = ids.filter((id) => (orphanCheckedAt.get(id) ?? 0) + ORPHAN_RECHECK_MS <= now).slice(0, ORPHAN_CHECKS_PER_PASS);
  for (const id of due) {
    orphanCheckedAt.set(id, now);
    const row = await pullEntityRow(uid, "attachment", id).catch(() => null);
    assertSameUser(uid);
    if (row?.deleted && !useStudyStore.getState().attachments.some((item) => item.id === id)) await deleteLocalFiles([id]);
  }
};

const processDeletes = async (uid: string) => {
  const rows = (await db.attachmentDeletes.toArray()).filter((row) => (row.owner ?? uid) === uid);
  if (!rows.length) return;
  await removeObjects(rows.map((row) => objectPath(uid, row.id)));
  await db.attachmentDeletes.bulkDelete(rows.map((row) => row.id));
};

/**
 * «Cancella anche dall'account»: via gli oggetti creati prima della richiesta e non più tra i materiali
 * di qui (doppio controllo: l'ora del dispositivo può essere sbagliata, e i file aggiunti dopo restano).
 */
const runPendingErase = async (uid: string) => {
  const requestedAt = await getMeta<string>(eraseKey(uid));
  if (!requestedAt) return;
  const keep = new Set(useStudyStore.getState().attachments.map((item) => item.id));
  const limit = Date.parse(requestedAt);
  const objects = await listFolder(uid);
  const doomed = objects
    .filter((item) => !keep.has(item.name) && (!item.created_at || !Number.isFinite(limit) || Date.parse(item.created_at) <= limit + 60_000))
    .map((item) => `${uid}/${item.name}`);
  if (doomed.length) await removeObjects(doomed);
  await deleteMeta(eraseKey(uid));
};

const pass = async () => {
  const uid = currentUid();
  if (!uid || !isOnline() || !storeReady() || !localFilesAvailable() || !storageUrl()) return false;
  if (!(await boundTo(uid))) return false;
  await runPendingErase(uid);
  await processDeletes(uid).catch(() => undefined);
  assertSameUser(uid);
  const plan = planFileWork({
    attachments: useStudyStore.getState().attachments,
    files: await localFileIndex(),
    uid,
    retryAt: new Map([...retry].map(([id, value]) => [id, value.at]))
  });
  if (plan.markStored.length) await markStored(uid, plan.markStored.map((id) => ({ id })));
  for (const id of plan.upload.slice(0, PER_PASS)) {
    assertSameUser(uid);
    await uploadLocal(uid, id).catch((error) => {
      if (error instanceof SessionChangedError) throw error;
      failed(id, error);
    });
  }
  for (const id of plan.migrate.slice(0, PER_PASS)) {
    assertSameUser(uid);
    await migrateEmbedded(uid, id).catch((error) => {
      if (error instanceof SessionChangedError) throw error;
      failed(id, error);
    });
  }
  if (plan.dropCache.length) await deleteLocalFiles(plan.dropCache);
  await checkOrphans(uid, plan.orphanPending);
  await trimLocalCache();
  return plan.upload.length > PER_PASS || plan.migrate.length > PER_PASS;
};

let running: Promise<void> | null = null;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | null = null;

const run = (): Promise<void> => {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    try {
      const more = await pass();
      if (more) schedule(1_000);
    } catch {
      // Sessione cambiata, rete persa o errore dello Storage: si riprova alla prossima occasione.
      schedule(60_000);
    } finally {
      running = null;
      if (rerun) {
        rerun = false;
        schedule(500);
      }
    }
  })();
  return running;
};

const schedule = (delay: number) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void run();
  }, delay);
};

/** Chiede una passata subito (es. dopo «Riprova»). */
export const requestFileSync = () => {
  retry.clear();
  schedule(0);
};

let initialized = false;

export const initAttachmentSync = () => {
  if (initialized || !supabase || typeof window === "undefined") return;
  initialized = true;
  let lastUid: string | null = null;
  let lastStatus = getCloudSyncState().status;
  subscribeCloudSync((state) => {
    const uid = state.session?.user.id ?? null;
    // Nuovo account o fine di una sync (i dati possono essere appena stati collegati all'account).
    if (uid !== lastUid || (lastStatus === "syncing" && state.status !== "syncing")) schedule(800);
    lastUid = uid;
    lastStatus = state.status;
  });
  useStudyStore.subscribe((curr, prev) => {
    if (curr.attachments !== prev.attachments || curr.locked !== prev.locked || curr.loading !== prev.loading) schedule(1_500);
  });
  window.addEventListener("online", () => {
    retry.clear();
    schedule(500);
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") schedule(2_000);
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void run();
  }, PERIODIC_MS);
  schedule(1_500);
};

// ─── Apertura e download ────────────────────────────────────────────────────

/** Il file di un materiale proprio: copia locale, file incorporato o download (poi in cache). */
export const openMaterialFile = async (material: Attachment): Promise<Blob> => {
  try {
    const local = await readLocalBytes(material.id);
    if (local) {
      void touchLocalFile(material.id).catch(() => undefined);
      return new Blob([local.bytes], { type: local.type });
    }
  } catch (error) {
    throw new Error(error instanceof FileLockedError ? FILE_TEXT.locked : FILE_TEXT.downloadFailed);
  }
  const embedded = decodeDataUrl(material.dataUrl);
  if (embedded) return new Blob([embedded.bytes], { type: embedded.mime });
  if (material.storedFile !== "cloud" && material.storedFile !== "local") throw new Error(FILE_TEXT.noFile);
  // «local»: aggiunto su un altro dispositivo. Se è già stato caricato (e una modifica vecchia ha
  // riportato il segno indietro) il file c'è lo stesso: si prova, e la riga si corregge.
  const elsewhere = material.storedFile === "local";
  const uid = currentUid();
  if (!uid) throw new Error(elsewhere ? FILE_TEXT.elsewhere : FILE_TEXT.signInToOpen);
  if (!isOnline()) throw new Error(elsewhere ? FILE_TEXT.elsewhere : FILE_TEXT.offlineNotHere);
  let blob: Blob;
  try {
    blob = await downloadObject(objectPath(uid, material.id), material.size);
  } catch (error) {
    const text = storageErrorText(error);
    throw new Error(elsewhere && text === FILE_TEXT.notFound ? FILE_TEXT.elsewhere : text);
  }
  const type = uploadMime(material.name, material.mimeType);
  // In cache solo se i dati di qui sono di questo account (altrimenti resterebbe una copia senza materiale).
  if (localFilesAvailable() && (await boundTo(uid))) {
    await saveLocalFile(material.id, await blob.arrayBuffer(), { type, pending: false, uploadedFor: uid })
      .then(() => trimLocalCache())
      .catch(() => undefined);
    if (elsewhere && currentUid() === uid) await useStudyStore.getState().markAttachmentsStored([{ id: material.id }]).catch(() => undefined);
  }
  return blob.type ? blob : new Blob([blob], { type });
};

/** Scarica il file (sempre come download, mai aperto nella pagina: un HTML o SVG girerebbe con l'origine dell'app). */
export const downloadMaterialFile = async (material: Attachment) => {
  const blob = await openMaterialFile(material);
  downloadBlob(sanitizeFileName(material.name), blob);
};

/** Byte di una copia locale o in cache, per le anteprime delle immagini (null se qui non c'è). */
export const localPreview = async (id: string): Promise<Blob | null> => {
  const local = await readLocalBytes(id).catch(() => null);
  return local ? new Blob([local.bytes], { type: local.type }) : null;
};

/** File di un materiale condiviso da un'altra persona: solo online, nessuna copia su questo dispositivo. */
export const downloadSharedFile = async (item: { ownerId: string; entityId: string; name: string; mimeType?: string; size?: number }) => {
  if (!isOnline()) throw new Error(FILE_TEXT.sharedOffline);
  if (!currentUid()) throw new Error(FILE_TEXT.signInToOpen);
  let blob: Blob;
  try {
    blob = await downloadObject(objectPath(item.ownerId, item.entityId), item.size);
  } catch (error) {
    const text = storageErrorText(error);
    throw new Error(text === FILE_TEXT.notFound ? FILE_TEXT.sharedGone : text);
  }
  downloadBlob(sanitizeFileName(item.name), blob.type ? blob : new Blob([blob], { type: uploadMime(item.name, item.mimeType) }));
};

// ─── Cancellazione dall'account e backup ────────────────────────────────────

/**
 * «Cancella anche dall'account»: via tutti i file dell'account (anche quelli mai arrivati qui). La
 * richiesta resta salvata e si riprova a ogni passata finché non riesce. true = fatto subito.
 */
export const eraseAccountFiles = async (): Promise<boolean> => {
  const uid = currentUid();
  if (!uid || !localFilesAvailable()) return false;
  await setMeta(eraseKey(uid), new Date().toISOString());
  // Gli oggetti spariscono tutti: le eliminazioni in coda non servono più.
  await db.attachmentDeletes.clear();
  try {
    await runPendingErase(uid);
    return true;
  } catch {
    schedule(60_000);
    return false;
  }
};

/**
 * Backup completo con i file: ogni materiale con un file lo porta incorporato (`dataUrl`, solo nel file
 * esportato). Quelli che non si possono avere (offline e mai scaricati, vault bloccato…) restano senza:
 * il backup parte lo stesso e `missing` dice quanti sono.
 */
export const withFilesForExport = async (materials: readonly Attachment[]): Promise<{ attachments: Attachment[]; missing: number }> => {
  let missing = 0;
  const attachments: Attachment[] = [];
  for (const material of materials) {
    if (!material.storedFile) {
      attachments.push(material);
      continue;
    }
    try {
      const blob = await openMaterialFile(material);
      const { storedFile: _stored, ...rest } = material;
      attachments.push({ ...rest, dataUrl: encodeDataUrl(blob.type || uploadMime(material.name, material.mimeType), new Uint8Array(await blob.arrayBuffer())) });
    } catch {
      missing += 1;
      attachments.push(material);
    }
  }
  return { attachments, missing };
};
