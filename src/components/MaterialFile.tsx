// File dei materiali nelle viste (Materiali, Materie): stato della copia locale e dei caricamenti,
// apertura (sempre come download) e anteprima delle immagini. supabase-js arriva solo con import()
// al primo download dal cloud (src/lib/attachmentSync.ts).

import { useCallback, useEffect, useState } from "react";
import type { Attachment } from "../types";
import { FileLockedError, localFileIndex, readLocalBytes, touchLocalFile } from "../lib/attachmentFiles";
import { getFileStatus, subscribeFileStatus, type FileSyncStatus } from "../lib/attachmentStatus";
import { cloudConfigured, getCloudSyncState, subscribeCloudSync } from "../lib/cloudSyncState";
import { decodeDataUrl, materialFileState, sanitizeFileName, type LocalFileInfo, type MaterialFileState } from "../lib/attachments";
import { downloadBlob } from "../lib/backup";
import { FILE_TEXT } from "../lib/labels";
import { safeDataUrl } from "../lib/safeUrl";

export interface MaterialFiles {
  local: ReadonlyMap<string, LocalFileInfo & { type: string }>;
  status: FileSyncStatus;
  signedIn: boolean;
  stateOf: (material: Attachment) => MaterialFileState;
}

/** Indice della copia locale e stato dei caricamenti, aggiornati quando cambiano. */
export const useMaterialFiles = (): MaterialFiles => {
  const [status, setStatus] = useState(getFileStatus);
  const [local, setLocal] = useState<MaterialFiles["local"]>(() => new Map());
  const [signedIn, setSignedIn] = useState(() => Boolean(getCloudSyncState().session));
  useEffect(() => subscribeFileStatus(setStatus), []);
  useEffect(() => subscribeCloudSync((state) => setSignedIn(Boolean(state.session))), []);
  useEffect(() => {
    let alive = true;
    void localFileIndex()
      .then((index) => {
        if (alive) setLocal(index);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [status.localVersion]);
  const stateOf = useCallback(
    (material: Attachment) => materialFileState(material, local.get(material.id), { signedIn, uploading: status.uploading.has(material.id) }),
    [local, signedIn, status.uploading]
  );
  return { local, status, signedIn, stateOf };
};

/** Stati con un file da scaricare (anche solo per dire perché qui non si apre). */
export const FILE_STATES: ReadonlySet<MaterialFileState> = new Set(["embedded", "cloud", "here", "queued", "uploading", "guest", "elsewhere"]);

/** Riga di stato sotto il materiale: solo quando il file non è ancora nel tuo account. */
export const fileStateText = (state: MaterialFileState, error?: string) => {
  if (state === "uploading") return FILE_TEXT.statusUploading;
  if (state === "queued") return error ?? FILE_TEXT.statusQueued;
  // Senza cloud in questa versione non c'è un account in cui salvarlo: nessun invito ad accedere.
  if (state === "guest") return cloudConfigured ? FILE_TEXT.statusGuest : undefined;
  if (state === "elsewhere") return FILE_TEXT.statusElsewhere;
  return undefined;
};

/**
 * Scarica il file del materiale (sempre come download, mai aperto nella pagina). Copia locale e file
 * incorporato si aprono senza rete e senza caricare supabase-js; solo il download dal cloud passa da
 * attachmentSync.ts. `error`: il motivo in italiano se non si può (offline, altro dispositivo…).
 */
export const useOpenMaterial = () => {
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const open = useCallback(async (material: Attachment) => {
    setError("");
    setOpeningId(material.id);
    try {
      let local: Awaited<ReturnType<typeof readLocalBytes>>;
      try {
        local = await readLocalBytes(material.id);
      } catch (cause) {
        throw new Error(cause instanceof FileLockedError ? FILE_TEXT.locked : FILE_TEXT.downloadFailed);
      }
      if (local) {
        void touchLocalFile(material.id).catch(() => undefined);
        downloadBlob(sanitizeFileName(material.name), new Blob([local.bytes], { type: local.type }));
        return;
      }
      const embedded = decodeDataUrl(material.dataUrl);
      if (embedded) {
        downloadBlob(sanitizeFileName(material.name), new Blob([embedded.bytes], { type: embedded.mime }));
        return;
      }
      const { downloadMaterialFile } = await import("../lib/attachmentSync");
      await downloadMaterialFile(material);
    } catch (cause) {
      setError(cause instanceof Error && cause.message ? cause.message : FILE_TEXT.downloadFailed);
    } finally {
      setOpeningId(null);
    }
  }, []);
  return { open, openingId, error, clearError: () => setError("") };
};

/** Tipi che il browser mostra in un <img> (non HEIC; mai SVG, che non si carica). */
const PREVIEWABLE = /^image\/(png|jpeg|gif|webp|avif|bmp)$/;

/** Anteprima di un'immagine: dal file incorporato o dalla copia locale (URL blob:, revocato all'uscita). */
export function MaterialThumb({ material, hasLocal, className }: { material: Attachment; hasLocal: boolean; className?: string }) {
  const embedded = material.dataUrl?.startsWith("data:image") ? safeDataUrl(material.dataUrl) : undefined;
  const [url, setUrl] = useState<string | null>(null);
  const previewable = PREVIEWABLE.test(material.mimeType.toLowerCase());
  useEffect(() => {
    if (embedded || !hasLocal || !previewable || typeof URL.createObjectURL !== "function") return;
    let alive = true;
    let created: string | null = null;
    void (async () => {
      const local = await readLocalBytes(material.id).catch(() => null);
      if (!alive || !local) return;
      created = URL.createObjectURL(new Blob([local.bytes], { type: local.type }));
      setUrl(created);
    })();
    return () => {
      alive = false;
      if (created) URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [embedded, hasLocal, previewable, material.id]);
  const src = embedded ?? url;
  return src ? <img src={src} alt="" className={className} /> : null;
}
