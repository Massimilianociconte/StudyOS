// Stato osservabile dei file dei materiali per la UI (caricamenti in corso, errori, copia locale
// cambiata). Senza dipendenze: lo scrivono attachmentFiles.ts e attachmentSync.ts, lo leggono le viste.

export interface FileSyncStatus {
  uploading: ReadonlySet<string>;
  errors: ReadonlyMap<string, string>;
  /** Cresce a ogni cambio della copia locale: chi mostra lo stato rilegge l'indice. */
  localVersion: number;
}

let status: FileSyncStatus = { uploading: new Set(), errors: new Map(), localVersion: 0 };
const listeners = new Set<(value: FileSyncStatus) => void>();

const publish = (next: FileSyncStatus) => {
  status = next;
  listeners.forEach((listener) => listener(status));
};

export const getFileStatus = () => status;

export const subscribeFileStatus = (listener: (value: FileSyncStatus) => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const setUploading = (id: string, active: boolean) => {
  if (status.uploading.has(id) === active) return;
  const uploading = new Set(status.uploading);
  if (active) uploading.add(id);
  else uploading.delete(id);
  publish({ ...status, uploading });
};

export const setFileError = (id: string, message: string | undefined) => {
  if (status.errors.get(id) === message) return;
  const errors = new Map(status.errors);
  if (message) errors.set(id, message);
  else errors.delete(id);
  publish({ ...status, errors });
};

export const bumpLocalFiles = () => publish({ ...status, localVersion: status.localVersion + 1 });
