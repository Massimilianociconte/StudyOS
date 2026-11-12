// File dei materiali nello spazio file privato dell'account (bucket `studyos-files`, supabase/storage.sql).
// Caricato solo con import(): fuori dal bundle iniziale come cloudSync.ts.
//
// - caricamento dei file aggiunti qui (copia locale `pending`) e migrazione dei file incorporati di prima:
//   solo con account collegato, dati locali legati a quell'account, primo pull della sessione finito,
//   rete, vault sbloccato e scheda attiva; la riga perde i byte solo a caricamento confermato;
// - download su richiesta (con cache) e file condivisi da altri (senza cache);
// - pulizia: un oggetto si toglie solo se la riga nel cloud è eliminata da almeno 90 giorni (come la
//   cronologia), mai perché il materiale qui non c'è; svuotamento della cartella dell'account.
// Lo Storage si chiama via REST con fetch: il client supabase-js ha un timeout di 30 s per richiesta,
// troppo poco per 25 MB su una rete lenta. Il token è quello della sessione di supabase-js.
// Design: docs/superpowers/specs/2026-11-12-attachments-storage-design.md.

import type { Attachment } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { getCloudSyncState, subscribeCloudSync, type CloudSyncState } from "./cloudSyncState";
import { db, getMeta, deleteMeta, setMeta } from "./db";
import { LocalResetError, isPersistenceHalted, localResetGuard } from "./persistence";
import { supabase } from "./supabase";
import { downloadBlob } from "./backup";
import {
  FALLBACK_MIME,
  FILES_BUCKET,
  allowedMime,
  decodeDataUrl,
  encodeDataUrl,
  isSafeObjectId,
  isStorageMissing,
  objectFate,
  objectPath,
  orphanCopyFate,
  planBackupFiles,
  planFileWork,
  pullTransition,
  retryDelay,
  sanitizeFileName,
  sharedDownloadName,
  storageErrorText,
  uploadMime,
  BACKUP_FILES_LIMIT_BYTES,
  type FileRowState
} from "./attachments";
import {
  BOUND_USER_KEY,
  FileLockedError,
  FileUnreadableError,
  deleteLocalFiles,
  fileEraseKey,
  localFileIndex,
  localFilesAvailable,
  markUploaded,
  readLocalBytes,
  reconcileLocalSealing,
  requestAccountFilesErase,
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
/** Pulizia degli oggetti senza materiale: al più una volta al giorno per account. */
const CLEANUP_EVERY_MS = 24 * 60 * 60_000;
const cleanupKey = (uid: string) => `files:cleanup:${uid}`;
/** Stessa tabella di supabase.ts (righe personali). */
const ROWS_TABLE = "studyos_items";

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

/** Errori che fermano tutta la passata (non sono del singolo file). */
const stopsPass = (error: unknown) => error instanceof SessionChangedError || error instanceof LocalResetError;

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

/**
 * Stato nel cloud delle righe dei materiali `ids` (solo eliminata sì/no e le ore): 100 per richiesta,
 * senza il resto del payload. Un id senza riga non è nella mappa. Un errore lancia: mai «nessuna riga»
 * per un errore di rete.
 */
const rowStates = async (uid: string, ids: readonly string[]) => {
  const states = new Map<string, FileRowState>();
  if (!supabase) throw new Error(FILE_TEXT.signInToOpen);
  for (let index = 0; index < ids.length; index += 100) {
    const { data, error } = await supabase
      .from(ROWS_TABLE)
      .select("entity_id, deleted, updated_at, deleted_at:payload->>deletedAt")
      .eq("user_id", uid)
      .eq("entity_type", "attachment")
      .in("entity_id", ids.slice(index, index + 100));
    if (error) throw new Error(error.message);
    for (const row of (data ?? []) as unknown as Array<{ entity_id: string; deleted: boolean; updated_at: string | null; deleted_at: string | null }>) {
      states.set(row.entity_id, { deleted: row.deleted === true, updatedAt: row.updated_at, deletedAt: row.deleted_at });
    }
  }
  return states;
};

// ─── Primo pull della sessione ──────────────────────────────────────────────
//
// Le riscritture di righe fatte qui (segno «cloud», dataUrl tolto) partono solo dopo che la sync ha
// finito una passata per questo account in questa pagina, e solo se da allora il dispositivo non è
// stato svuotato: prima la copia di qui può essere vecchia e riporterebbe campi o materiali che
// un altro dispositivo ha cambiato o eliminato (pullTransition in attachments.ts).

let pulled: { uid: string; guard: () => void } | null = null;
let syncStart: { uid: string | null; lastSync: string | null; guard: () => void } | null = null;

const pulledFor = (uid: string) => {
  if (pulled?.uid !== uid) return false;
  try {
    pulled.guard();
    return true;
  } catch {
    pulled = null;
    return false;
  }
};

const watchPull = (state: CloudSyncState) => {
  const uid = state.session?.user.id ?? null;
  if (pulled && pulled.uid !== uid) pulled = null;
  const step = pullTransition(syncStart, { uid, status: state.status, lastSync: state.lastSync });
  if (step === "start") {
    syncStart = { uid, lastSync: state.lastSync, guard: localResetGuard() };
  } else if (step === "pulled" && syncStart && uid) {
    pulled = { uid, guard: syncStart.guard };
    syncStart = null;
  } else if (step === "end") {
    syncStart = null;
  }
};

// ─── Passata di lavoro ──────────────────────────────────────────────────────

const retry = new Map<string, { attempts: number; at: number }>();
const orphanCheckedAt = new Map<string, number>();

const failed = (id: string, error: unknown) => {
  const attempts = (retry.get(id)?.attempts ?? 0) + 1;
  // Bucket assente (storage.sql non eseguito) o copia illeggibile: inutile riprovare ogni minuto.
  const wait = isStorageMissing(error) || error instanceof FileUnreadableError ? 30 * 60_000 : retryDelay(attempts);
  retry.set(id, { attempts, at: Date.now() + wait });
  setFileError(
    id,
    error instanceof FileLockedError
      ? FILE_TEXT.locked
      : error instanceof FileUnreadableError
        ? FILE_TEXT.unreadable
        : storageErrorText(error, FILE_TEXT.uploadFailed)
  );
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

/**
 * Righe segnate come caricate. Un materiale che in memoria non c'è più (eliminato qui, dispositivo
 * svuotato a metà caricamento…) si lascia stare: né l'oggetto né la copia locale si toccano per
 * questo. L'oggetto si toglie solo con la pulizia (riga eliminata nel cloud da 90 giorni).
 */
const markStored = async (uid: string, items: { id: string; dataUrl?: string }[], check: () => void) => {
  if (!items.length) return;
  check();
  const { stored } = await useStudyStore.getState().markAttachmentsStored(items);
  stored.forEach(succeeded);
};

const uploadLocal = async (uid: string, id: string, check: () => void) => {
  const local = await readLocalBytes(id);
  if (!local) return;
  setUploading(id, true);
  try {
    await uploadObject(objectPath(uid, id), local.bytes, local.type);
    // Dispositivo svuotato intanto: la copia resta da caricare (si ricarica quando torna il materiale).
    await markUploaded(id, uid, check);
    await markStored(uid, [{ id }], check);
  } finally {
    setUploading(id, false);
  }
};

const migrateEmbedded = async (uid: string, id: string, check: () => void) => {
  const material = useStudyStore.getState().attachments.find((item) => item.id === id);
  const dataUrl = material?.dataUrl;
  const decoded = decodeDataUrl(dataUrl);
  if (!material || !dataUrl || !decoded) return;
  const type = uploadMime(material.name, material.mimeType || decoded.mime);
  const bytes = decoded.bytes.buffer.slice(decoded.bytes.byteOffset, decoded.bytes.byteOffset + decoded.bytes.byteLength) as ArrayBuffer;
  setUploading(id, true);
  try {
    await uploadObject(objectPath(uid, id), bytes, type);
    check();
    // Copia locale come cache (si apre anche offline); se non si salva, il file è comunque nel cloud.
    await saveLocalFile(id, bytes, { type, pending: false, uploadedFor: uid }).catch(() => undefined);
    // Il dataUrl si toglie solo ora, e solo se è ancora quello caricato.
    await markStored(uid, [{ id, dataUrl }], check);
  } finally {
    setUploading(id, false);
  }
};

/**
 * Copie da caricare senza materiale: restano finché la riga nel cloud è viva o non c'è. Se è eliminata
 * da poco il file si carica prima di toglierle (un ripristino dalla cronologia lo ritrova); dopo i 90
 * giorni si tolgono e basta.
 */
const checkOrphans = async (uid: string, ids: readonly string[], check: () => void) => {
  const now = Date.now();
  const due = ids.filter((id) => (orphanCheckedAt.get(id) ?? 0) + ORPHAN_RECHECK_MS <= now).slice(0, ORPHAN_CHECKS_PER_PASS);
  if (!due.length) return;
  due.forEach((id) => orphanCheckedAt.set(id, now));
  const states = await rowStates(uid, due);
  for (const id of due) {
    const fate = orphanCopyFate(states.get(id), now);
    if (fate === "keep") continue;
    check();
    // Il materiale è tornato intanto (pull o ripristino): la copia serve.
    if (useStudyStore.getState().attachments.some((item) => item.id === id)) continue;
    try {
      if (fate === "upload") {
        // Illeggibile (chiave del vault persa): non c'è niente da salvare.
        const local = await readLocalBytes(id).catch(() => null);
        if (local) await uploadObject(objectPath(uid, id), local.bytes, local.type);
      }
      await deleteLocalFiles([id], check);
    } catch (error) {
      if (stopsPass(error)) throw error;
      // Rete o Storage: si riprova al prossimo controllo (tra un'ora).
    }
  }
};

/**
 * Pulizia degli oggetti dell'account senza materiale (eliminati qui, da chi riceve una condivisione,
 * da un agente, caricamenti battuti da un'eliminazione): al più una volta al giorno. Si tolgono solo
 * quelli la cui riga nel cloud è eliminata da almeno 90 giorni; riga viva o assente: restano. La coda
 * delle eliminazioni di questo account non serve più (la pulizia vede tutta la cartella).
 */
const cleanupObjects = async (uid: string, check: () => void) => {
  const last = Date.parse((await getMeta<string>(cleanupKey(uid))) ?? "");
  if (Number.isFinite(last) && Date.now() - last < CLEANUP_EVERY_MS && Date.now() >= last) return;
  const present = () => new Set(useStudyStore.getState().attachments.map((item) => item.id));
  const here = present();
  const candidates = (await listFolder(uid)).map((item) => item.name).filter((name) => isSafeObjectId(name) && !here.has(name));
  const states = await rowStates(uid, candidates);
  const now = Date.now();
  check();
  const again = present();
  const doomed = candidates.filter((id) => !again.has(id) && objectFate(states.get(id), now) === "remove");
  if (doomed.length) await removeObjects(doomed.map((id) => objectPath(uid, id)));
  const queued = (await db.attachmentDeletes.toArray()).filter((row) => (row.owner ?? uid) === uid).map((row) => row.id);
  if (queued.length) await db.attachmentDeletes.bulkDelete(queued);
  await setMeta(cleanupKey(uid), new Date(now).toISOString());
};

/**
 * «Cancella anche dall'account»: via gli oggetti creati prima della richiesta e non più tra i materiali
 * di qui (doppio controllo: l'ora del dispositivo può essere sbagliata, e i file aggiunti dopo restano).
 */
const runPendingErase = async (uid: string) => {
  const requestedAt = await getMeta<string>(fileEraseKey(uid));
  if (!requestedAt) return;
  const keep = new Set(useStudyStore.getState().attachments.map((item) => item.id));
  const limit = Date.parse(requestedAt);
  const objects = await listFolder(uid);
  const doomed = objects
    .filter((item) => !keep.has(item.name) && (!item.created_at || !Number.isFinite(limit) || Date.parse(item.created_at) <= limit + 60_000))
    .map((item) => `${uid}/${item.name}`);
  if (doomed.length) await removeObjects(doomed);
  await deleteMeta(fileEraseKey(uid));
};

const pass = async () => {
  if (!storeReady() || !localFilesAvailable()) return false;
  // Copie scritte mentre il vault cambiava (tolto, rifatto): prima di tutto, anche senza account.
  const unreadable = await reconcileLocalSealing().catch(() => [] as string[]);
  unreadable.forEach((id) => setFileError(id, FILE_TEXT.unreadable));
  const uid = currentUid();
  if (!uid || !isOnline() || !storageUrl()) return false;
  if (!(await boundTo(uid))) return false;
  // Una richiesta di svuotare l'account che non riesce si riprova alla passata dopo: non ferma il resto.
  await runPendingErase(uid).catch(() => undefined);
  if (!pulledFor(uid)) return false;
  const guard = localResetGuard();
  const check = () => {
    assertSameUser(uid);
    guard();
  };
  check();
  const plan = planFileWork({
    attachments: useStudyStore.getState().attachments,
    files: await localFileIndex(),
    uid,
    retryAt: new Map([...retry].map(([id, value]) => [id, value.at]))
  });
  if (plan.markStored.length) await markStored(uid, plan.markStored.map((id) => ({ id })), check);
  for (const id of plan.upload.slice(0, PER_PASS)) {
    check();
    await uploadLocal(uid, id, check).catch((error) => {
      if (stopsPass(error)) throw error;
      failed(id, error);
    });
  }
  for (const id of plan.migrate.slice(0, PER_PASS)) {
    check();
    await migrateEmbedded(uid, id, check).catch((error) => {
      if (stopsPass(error)) throw error;
      failed(id, error);
    });
  }
  // Solo cache (il file è nell'account): via la copia, mai l'oggetto.
  if (plan.dropCache.length) await deleteLocalFiles(plan.dropCache, check);
  // Controlli sul cloud: se ora non rispondono si riprova più tardi, senza fermare il resto.
  const later = (error: unknown) => {
    if (stopsPass(error)) throw error;
  };
  await checkOrphans(uid, plan.orphanPending, check).catch(later);
  await cleanupObjects(uid, check).catch(later);
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
      // Sessione cambiata, dispositivo svuotato, rete persa o errore dello Storage: si riprova alla
      // prossima occasione (dopo uno svuotamento, alla fine della sync che segue).
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
  // Modulo caricato dopo una sync già finita in questa pagina: vale come primo pull.
  const state = getCloudSyncState();
  const uid = state.session?.user.id ?? null;
  const origin = typeof performance !== "undefined" ? performance.timeOrigin : NaN;
  if (uid && state.status !== "syncing" && state.lastSync && Number.isFinite(origin) && Date.parse(state.lastSync) >= origin) {
    pulled = { uid, guard: localResetGuard() };
  }
  let lastUid: string | null = uid;
  let lastStatus = state.status;
  subscribeCloudSync((next) => {
    watchPull(next);
    const nextUid = next.session?.user.id ?? null;
    // Nuovo account o fine di una sync (i dati possono essere appena stati collegati all'account).
    if (nextUid !== lastUid || (lastStatus === "syncing" && next.status !== "syncing")) schedule(800);
    lastUid = nextUid;
    lastStatus = next.status;
  });
  useStudyStore.subscribe((curr, prev) => {
    if (
      curr.attachments !== prev.attachments ||
      curr.locked !== prev.locked ||
      curr.loading !== prev.loading ||
      curr.settings?.security?.mode !== prev.settings?.security?.mode
    ) {
      schedule(1_500);
    }
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

/**
 * Il file di un materiale proprio: copia locale, file incorporato o download (poi in cache, salvo
 * `cache: false`). Una copia locale illeggibile (vault tolto o cambiato mentre si scriveva) non blocca:
 * si prova a scaricarla dall'account.
 */
export const openMaterialFile = async (material: Attachment, options: { cache?: boolean } = {}): Promise<Blob> => {
  let unreadable = false;
  try {
    const local = await readLocalBytes(material.id);
    if (local) {
      void touchLocalFile(material.id).catch(() => undefined);
      return new Blob([local.bytes], { type: local.type });
    }
  } catch (error) {
    if (error instanceof FileLockedError) throw new Error(FILE_TEXT.locked);
    unreadable = error instanceof FileUnreadableError;
    // Altri errori della copia locale: si prova comunque dall'account.
  }
  const embedded = decodeDataUrl(material.dataUrl);
  if (embedded) return new Blob([embedded.bytes], { type: embedded.mime });
  if (material.storedFile !== "cloud" && material.storedFile !== "local") throw new Error(unreadable ? FILE_TEXT.unreadable : FILE_TEXT.noFile);
  // «local»: aggiunto su un altro dispositivo. Se è già stato caricato (e una modifica vecchia ha
  // riportato il segno indietro) il file c'è lo stesso: si prova, e la riga si corregge.
  const elsewhere = material.storedFile === "local";
  const unavailable = (fallback: string) => (unreadable ? FILE_TEXT.unreadable : elsewhere ? FILE_TEXT.elsewhere : fallback);
  const uid = currentUid();
  if (!uid) throw new Error(unavailable(FILE_TEXT.signInToOpen));
  if (!isOnline()) throw new Error(unavailable(FILE_TEXT.offlineNotHere));
  let blob: Blob;
  try {
    blob = await downloadObject(objectPath(uid, material.id), material.size);
  } catch (error) {
    const text = storageErrorText(error);
    throw new Error(text === FILE_TEXT.notFound ? unavailable(text) : text);
  }
  const type = uploadMime(material.name, material.mimeType);
  // In cache solo se i dati di qui sono di questo account (altrimenti resterebbe una copia senza materiale).
  if (options.cache !== false && localFilesAvailable() && (await boundTo(uid))) {
    const guard = localResetGuard();
    await saveLocalFile(material.id, await blob.arrayBuffer(), { type, pending: false, uploadedFor: uid })
      .then(() => trimLocalCache())
      .catch(() => undefined);
    // Segno corretto solo dopo il primo pull (M1) e se il dispositivo non è stato svuotato intanto.
    if (elsewhere && currentUid() === uid && pulledFor(uid)) {
      try {
        guard();
        await useStudyStore.getState().markAttachmentsStored([{ id: material.id }]);
      } catch {
        // si corregge alla prossima passata
      }
    }
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

/**
 * File di un materiale condiviso da un'altra persona: solo online, nessuna copia su questo dispositivo.
 * Il nome si scarica con un'estensione sicura (sharedDownloadName). `notUploadedYet`: la riga dice
 * «local»; il file può essere già nell'account (segno rimasto indietro), se non c'è lo si dice.
 */
export const downloadSharedFile = async (item: { ownerId: string; entityId: string; name: string; mimeType?: string; size?: number; notUploadedYet?: boolean }) => {
  if (!isOnline()) throw new Error(FILE_TEXT.sharedOffline);
  if (!currentUid()) throw new Error(FILE_TEXT.signInToOpen);
  let blob: Blob;
  try {
    blob = await downloadObject(objectPath(item.ownerId, item.entityId), item.size);
  } catch (error) {
    const text = storageErrorText(error);
    throw new Error(text === FILE_TEXT.notFound ? (item.notUploadedYet ? FILE_TEXT.sharedNotUploaded : FILE_TEXT.sharedGone) : text);
  }
  const name = sharedDownloadName(item.name);
  // Tipo solo dall'estensione del nome sicuro: un tipo dichiarato da altri non conta.
  downloadBlob(name, new Blob([blob], { type: allowedMime(name, undefined) ?? FALLBACK_MIME }));
};

// ─── Cancellazione dall'account e backup ────────────────────────────────────

/**
 * «Cancella anche dall'account»: via tutti i file dell'account (anche quelli mai arrivati qui). La
 * richiesta resta salvata (SettingsView la scrive già prima di caricare questo modulo) e si riprova a
 * ogni passata finché non riesce. true = fatto subito.
 */
export const eraseAccountFiles = async (): Promise<boolean> => {
  const uid = currentUid();
  if (!uid || !localFilesAvailable()) return false;
  await requestAccountFilesErase(uid);
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
 * esportato), fino a BACKUP_FILES_LIMIT_BYTES in tutto (`overLimit`: quelli rimasti fuori per questo).
 * Quelli che non si possono avere (offline e mai scaricati, vault bloccato…) restano senza: il backup
 * parte lo stesso e `missing` dice quanti sono. I download fatti qui non vanno in cache.
 */
export const withFilesForExport = async (
  materials: readonly Attachment[],
  limit = BACKUP_FILES_LIMIT_BYTES
): Promise<{ attachments: Attachment[]; missing: number; overLimit: number }> => {
  const plan = planBackupFiles(materials, limit);
  const include = new Set(plan.include);
  let missing = 0;
  let overLimit = plan.overLimit.length;
  let total = 0;
  const attachments: Attachment[] = [];
  for (const material of materials) {
    if (!material.storedFile || !include.has(material.id)) {
      attachments.push(material);
      continue;
    }
    try {
      const blob = await openMaterialFile(material, { cache: false });
      // La dimensione dichiarata può essere sbagliata: conta quella vera.
      if (total + blob.size > limit) {
        overLimit += 1;
        attachments.push(material);
        continue;
      }
      total += blob.size;
      const { storedFile: _stored, ...rest } = material;
      attachments.push({ ...rest, dataUrl: encodeDataUrl(blob.type || uploadMime(material.name, material.mimeType), new Uint8Array(await blob.arrayBuffer())) });
    } catch {
      missing += 1;
      attachments.push(material);
    }
  }
  return { attachments, missing, overLimit };
};
