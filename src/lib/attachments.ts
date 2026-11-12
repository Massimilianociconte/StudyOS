// File dei materiali fuori dal JSON sincronizzato: regole pure (niente Dexie, niente supabase-js).
// Il materiale tiene solo i metadati e `storedFile`; i byte stanno in Dexie (attachmentFiles.ts) e nel
// bucket privato `studyos-files` (attachmentSync.ts, supabase/storage.sql), percorso `<uid>/<id>`.
// Design: docs/superpowers/specs/2026-11-12-attachments-storage-design.md.

import type { Attachment } from "../types";
import { laterStamp } from "./collections";
import { FILE_TEXT } from "./labels";

export type StoredFile = NonNullable<Attachment["storedFile"]>;

export const FILES_BUCKET = "studyos-files";

/** 25 MB: `file_size_limit` del bucket in supabase/storage.sql (un test controlla che coincidano). */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;

/** Oltre questo totale la copia locale toglie i file già nel cloud usati meno di recente (mai quelli da caricare). */
export const CACHE_LIMIT_BYTES = 150 * 1024 * 1024;

/**
 * Tipi che si possono caricare: stesso elenco di `allowed_mime_types` in supabase/storage.sql (più
 * FALLBACK_MIME). Mai HTML, SVG, script o eseguibili: anche se l'app scarica sempre e non apre i file
 * nella pagina, il bucket non li accetta.
 */
export const FILE_MIME_TYPES = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/bmp",
  "text/plain",
  "text/markdown",
  "text/csv",
  "application/rtf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.oasis.opendocument.text",
  "application/vnd.oasis.opendocument.spreadsheet",
  "application/vnd.oasis.opendocument.presentation",
  "application/epub+zip",
  "application/zip",
  "audio/mpeg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "video/mp4",
  "video/webm",
  "video/quicktime"
] as const;

/** Solo per i file incorporati di prima con un tipo fuori elenco: si caricano così e si scaricano. */
export const FALLBACK_MIME = "application/octet-stream";

const ALLOWED = new Set<string>(FILE_MIME_TYPES);

/** Nomi diversi dello stesso tipo che i browser danno. */
const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "audio/mp3": "audio/mpeg",
  "audio/x-mp3": "audio/mpeg",
  "audio/m4a": "audio/x-m4a",
  "audio/x-wav": "audio/wav",
  "audio/wave": "audio/wav",
  "audio/vnd.wave": "audio/wav",
  "application/x-zip-compressed": "application/zip",
  "text/x-markdown": "text/markdown",
  "text/rtf": "application/rtf"
};

/** Tipo dall'estensione, quando il browser non lo dà (es. .md, .heic su alcuni sistemi). */
const EXTENSION_MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  bmp: "image/bmp",
  txt: "text/plain",
  md: "text/markdown",
  markdown: "text/markdown",
  csv: "text/csv",
  rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip",
  zip: "application/zip",
  mp3: "audio/mpeg",
  m4a: "audio/x-m4a",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime"
};

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
};

/** `accept` dei campi «Carica un file»: il selettore propone solo i tipi ammessi. */
export const FILE_ACCEPT = [...FILE_MIME_TYPES, ...Object.keys(EXTENSION_MIME).map((extension) => `.${extension}`)].join(",");

/** Tipo ammesso del file (dal tipo dichiarato o dall'estensione), null se non si può caricare. */
export const allowedMime = (name: string, type: string | undefined): string | null => {
  const declared = (type ?? "").split(";")[0].trim().toLowerCase();
  const canonical = MIME_ALIASES[declared] ?? declared;
  if (ALLOWED.has(canonical)) return canonical;
  return EXTENSION_MIME[extensionOf(name)] ?? null;
};

/** Tipo con cui caricare un file che c'è già (anche vecchio): fuori elenco diventa FALLBACK_MIME. */
export const uploadMime = (name: string, type: string | undefined) => allowedMime(name, type) ?? FALLBACK_MIME;

const MAX_NAME = 120;

/**
 * Nome mostrato e usato per il download: senza separatori di percorso, caratteri di controllo,
 * caratteri vietati nei nomi dei file e segni che invertono il testo (es. «gpj.exe» mostrato al
 * contrario). Al massimo 120 caratteri, estensione compresa.
 */
export const sanitizeFileName = (raw: string | undefined | null): string => {
  const cleaned = String(raw ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[.\s]+/, "")
    .replace(/[.\s]+$/, "");
  if (!cleaned) return "file";
  if (cleaned.length <= MAX_NAME) return cleaned;
  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : "";
  return `${cleaned.slice(0, MAX_NAME - extension.length).trimEnd()}${extension}`;
};

export type NewFileCheck = { ok: true; name: string; mime: string } | { ok: false; error: string };

/** Controlli prima di salvare un file nuovo: dimensione, tipo ammesso, nome ripulito. */
export const checkNewFile = (file: { name?: string; type?: string; size: number }): NewFileCheck => {
  if (!Number.isFinite(file.size) || file.size <= 0) return { ok: false, error: FILE_TEXT.empty };
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: FILE_TEXT.tooBig };
  const name = sanitizeFileName(file.name);
  const mime = allowedMime(name, file.type);
  if (!mime) return { ok: false, error: FILE_TEXT.typeNotAllowed };
  return { ok: true, name, mime };
};

/** Id usabile come nome dell'oggetto (`<uid>/<id>`, stessa regola di studyos_can_read_file). */
export const isSafeObjectId = (id: unknown): id is string => typeof id === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(id);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Percorso nel bucket: mai salvato nei dati, si ricava sempre da proprietario e id. */
export const objectPath = (ownerId: string, attachmentId: string) => {
  if (!UUID.test(ownerId) || !isSafeObjectId(attachmentId)) throw new Error(FILE_TEXT.notFound);
  return `${ownerId}/${attachmentId}`;
};

// ─── Data URL (file incorporati di prima, backup) ───────────────────────────────

const CHUNK = 0x8000;

export const bytesToBase64 = (bytes: Uint8Array) => {
  const parts: string[] = [];
  for (let index = 0; index < bytes.length; index += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(index, index + CHUNK) as unknown as number[]));
  }
  return btoa(parts.join(""));
};

/** Byte e tipo di un data URL; null se non è un data URL leggibile. */
export const decodeDataUrl = (raw: unknown): { mime: string; bytes: Uint8Array<ArrayBuffer> } | null => {
  if (typeof raw !== "string") return null;
  const match = /^data:([\w.+-]+\/[\w.+-]+)?((?:;[\w.+-]+=[^;,]*)*)(;base64)?,/i.exec(raw);
  if (!match) return null;
  const mime = (match[1] ?? "text/plain").toLowerCase();
  const payload = raw.slice(match[0].length);
  try {
    if (match[3]) {
      const binary = atob(payload.replace(/\s+/g, ""));
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      return { mime, bytes };
    }
    return { mime, bytes: new Uint8Array(new TextEncoder().encode(decodeURIComponent(payload))) };
  } catch {
    return null;
  }
};

export const encodeDataUrl = (mime: string, bytes: Uint8Array) => `data:${mime || FALLBACK_MIME};base64,${bytesToBase64(bytes)}`;

// ─── Stato di un materiale ───────────────────────────────────────────────────

/** Ciò che serve sapere della copia locale di un file (riga `attachmentFiles`). */
export interface LocalFileInfo {
  pending: 0 | 1;
  uploadedFor?: string;
  size: number;
  usedAt: number;
}

type MaterialFields = Pick<Attachment, "id" | "externalUrl" | "dataUrl" | "storedFile">;

/**
 * - `link`: link esterno, niente file;
 * - `embedded`: file incorporato di prima (si migra quando c'è l'account);
 * - `cloud`: nel bucket (`here` se c'è anche la copia locale);
 * - `queued` / `uploading`: aggiunto qui, da caricare (account collegato);
 * - `guest`: aggiunto qui senza account, resta solo qui;
 * - `elsewhere`: aggiunto su un altro dispositivo che non l'ha ancora caricato;
 * - `none`: nessun file (materiale senza link né file).
 */
export type MaterialFileState = "link" | "embedded" | "cloud" | "here" | "queued" | "uploading" | "guest" | "elsewhere" | "none";

export const materialFileState = (
  material: MaterialFields,
  local: Pick<LocalFileInfo, "pending"> | undefined,
  context: { signedIn: boolean; uploading: boolean }
): MaterialFileState => {
  if (material.storedFile === "local") {
    if (local?.pending) return !context.signedIn ? "guest" : context.uploading ? "uploading" : "queued";
    return local ? "here" : "elsewhere";
  }
  if (material.storedFile === "cloud") return local ? "here" : "cloud";
  if (typeof material.dataUrl === "string" && material.dataUrl.startsWith("data:")) return "embedded";
  if (material.externalUrl) return "link";
  return "none";
};

/** Il materiale ha (o aveva) un file: si apre/scarica invece di aprire un link. */
export const hasFile = (material: MaterialFields) => Boolean(material.storedFile) || (typeof material.dataUrl === "string" && material.dataUrl.startsWith("data:"));

// ─── Piano del lavoro sul cloud ──────────────────────────────────────────────

export interface FilePlan {
  /** File incorporati di prima: caricare, poi togliere il `dataUrl` dalla riga. */
  migrate: string[];
  /** Copie locali da caricare (aggiunte qui, o cache di un altro account dopo un'unione). */
  upload: string[];
  /** Già caricati per questo account ma la riga non lo dice ancora: solo da segnare. */
  markStored: string[];
  /** Cache di materiali che qui non ci sono più. */
  dropCache: string[];
  /** Copie da caricare senza materiale (eliminato altrove, o dati non ancora tornati): si tengono. */
  orphanPending: string[];
}

export const planFileWork = (input: {
  attachments: readonly MaterialFields[];
  files: ReadonlyMap<string, Pick<LocalFileInfo, "pending" | "uploadedFor">>;
  uid: string;
  /** Prossimo tentativo per id (attesa dopo un errore): fino ad allora l'id non si riprova. */
  retryAt?: ReadonlyMap<string, number>;
  now?: number;
}): FilePlan => {
  const plan: FilePlan = { migrate: [], upload: [], markStored: [], dropCache: [], orphanPending: [] };
  const now = input.now ?? Date.now();
  const waiting = (id: string) => (input.retryAt?.get(id) ?? 0) > now;
  const seen = new Set<string>();
  for (const material of input.attachments) {
    if (!isSafeObjectId(material.id)) continue;
    seen.add(material.id);
    const local = input.files.get(material.id);
    const embedded = typeof material.dataUrl === "string" && material.dataUrl.startsWith("data:");
    if (local && local.uploadedFor === input.uid) {
      // Caricato per questo account (anche se la riscrittura della riga era fallita, o la riga ha perso il segno).
      if (material.storedFile !== "cloud" || embedded) plan.markStored.push(material.id);
      continue;
    }
    if (waiting(material.id)) continue;
    if (material.storedFile === "local" || material.storedFile === "cloud") {
      if (local) plan.upload.push(material.id);
      continue;
    }
    if (embedded) plan.migrate.push(material.id);
  }
  for (const [id, local] of input.files) {
    if (seen.has(id)) continue;
    (local.pending ? plan.orphanPending : plan.dropCache).push(id);
  }
  return plan;
};

/**
 * Riga dopo un caricamento confermato: senza `dataUrl`, con `storedFile: "cloud"` e timbro nuovo.
 * Null se nel frattempo il materiale ha un altro file incorporato (non quello caricato).
 */
export const withStoredFile = <T extends Attachment>(material: T, uploadedDataUrl?: string, now = Date.now()): T | null => {
  if (uploadedDataUrl !== undefined && material.dataUrl !== undefined && material.dataUrl !== uploadedDataUrl) return null;
  const { dataUrl: _dropped, ...rest } = material;
  return { ...rest, storedFile: "cloud", updatedAt: laterStamp(material.updatedAt, now) } as T;
};

/** Riga di un file incorporato importato da un backup: i byte vanno nella copia locale, mai nella sync. */
export const withLocalFile = <T extends Attachment>(material: T, mime: string, size: number): T => {
  const { dataUrl: _dropped, ...rest } = material;
  return { ...rest, mimeType: material.mimeType || mime, size: size || material.size, storedFile: "local" } as T;
};

/** Cache da togliere per restare sotto il limite: prima le meno usate, mai quelle da caricare. */
export const planCacheEviction = (rows: readonly ({ id: string } & Pick<LocalFileInfo, "pending" | "size" | "usedAt">)[], limit = CACHE_LIMIT_BYTES) => {
  let total = rows.reduce((sum, row) => sum + (row.size || 0), 0);
  const drop: string[] = [];
  for (const row of [...rows].filter((item) => !item.pending).sort((a, b) => a.usedAt - b.usedAt)) {
    if (total <= limit) break;
    drop.push(row.id);
    total -= row.size || 0;
  }
  return drop;
};

/** Attesa prima di riprovare: 30 s, 1 min, 2 min… fino a 30 min. */
export const retryDelay = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 30 * 60_000);

/** Messaggio per l'utente da un errore dello Storage (mai il testo grezzo). */
export const storageErrorText = (error: unknown, fallback: string = FILE_TEXT.downloadFailed) => {
  const raw = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String((error as { message: unknown }).message) : "";
  const status = typeof error === "object" && error && "statusCode" in error ? String((error as { statusCode: unknown }).statusCode) : "";
  if (/bucket not found/i.test(raw)) return FILE_TEXT.storageMissing;
  if (/object not found|not.?found/i.test(raw) || status === "404") return FILE_TEXT.notFound;
  if (/payload too large|maximum allowed size|too large/i.test(raw) || status === "413") return FILE_TEXT.tooBig;
  if (/mime type|invalid_mime_type/i.test(raw) || status === "415") return FILE_TEXT.typeNotAllowed;
  if (/failed to fetch|networkerror|load failed|network request failed|timed? ?out|aborted/i.test(raw)) return FILE_TEXT.offlineNotHere;
  return fallback;
};

/** L'errore dice che il bucket non c'è (storage.sql non eseguito): inutile riprovare presto. */
export const isStorageMissing = (error: unknown) => storageErrorText(error, "") === FILE_TEXT.storageMissing;
