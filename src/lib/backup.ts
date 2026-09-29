import type { BackupEnvelope, StudySnapshot, UserSettings, VaultRecord } from "../types";
import { decryptString, encryptString } from "./crypto";
import { COLLECTIONS, countEntities, normalizeCollections } from "./collections";

export type BackupScope = NonNullable<BackupEnvelope["scope"]>;

export const createBackupEnvelope = async (
  snapshot: StudySnapshot,
  settings: UserSettings,
  passphrase?: string,
  scope: BackupScope = "full"
): Promise<BackupEnvelope> => {
  const exportedAt = new Date().toISOString();
  const backupSettings = {
    themeMode: settings.themeMode,
    palette: settings.palette,
    density: settings.density,
    cardShape: settings.cardShape,
    dateFormat: settings.dateFormat,
    profile: settings.profile
  };

  if (!passphrase) {
    return {
      format: "studyos.backup",
      version: 1,
      scope,
      exportedAt,
      encrypted: false,
      data: { ...snapshot, exportedAt },
      settings: backupSettings
    };
  }

  const cryptoRecord = await encryptString(JSON.stringify({ ...snapshot, exportedAt }), passphrase);
  return {
    format: "studyos.backup",
    version: 1,
    scope,
    exportedAt,
    encrypted: true,
    crypto: cryptoRecord,
    settings: backupSettings
  };
};

export const readBackupEnvelope = async (file: File) => {
  let parsed: BackupEnvelope;
  try {
    parsed = JSON.parse(await file.text()) as BackupEnvelope;
  } catch {
    throw new Error("Il file non è un JSON valido.");
  }
  if (parsed?.format !== "studyos.backup" || parsed.version !== 1) {
    throw new Error("Backup StudyOS non valido.");
  }
  if (parsed.encrypted && !parsed.crypto) throw new Error("Backup cifrato incompleto.");
  if (!parsed.encrypted && !parsed.data) throw new Error("Backup senza dati.");
  return parsed;
};

export const snapshotFromBackup = async (backup: BackupEnvelope, passphrase?: string): Promise<StudySnapshot> => {
  let raw: unknown;
  if (!backup.encrypted && backup.data) {
    raw = backup.data;
  } else {
    if (!backup.crypto || !passphrase) throw new Error("Passphrase richiesta per questo backup.");
    try {
      raw = JSON.parse(await decryptString(backup.crypto as VaultRecord, passphrase));
    } catch {
      throw new Error("Passphrase del backup non valida.");
    }
  }
  const collections = normalizeCollections(raw as Partial<StudySnapshot>);
  return { version: 1, exportedAt: backup.exportedAt, ...collections };
};

/**
 * Backup completi sostituiscono i dati; backup parziali (task, calendario, materie) vengono uniti.
 * I backup creati prima dell'introduzione di `scope` sono completi se contengono più collezioni.
 */
export const inferBackupScope = (backup: BackupEnvelope, snapshot: StudySnapshot): BackupScope => {
  if (backup.scope) return backup.scope;
  const nonEmpty = COLLECTIONS.filter((key) => snapshot[key].length > 0);
  if (nonEmpty.length === 1 && nonEmpty[0] === "tasks") return "tasks";
  if (nonEmpty.length === 1 && nonEmpty[0] === "events") return "calendar";
  if (nonEmpty.length === 1 && nonEmpty[0] === "subjects") return "subjects";
  return "full";
};

const COLLECTION_LABEL: Record<(typeof COLLECTIONS)[number], string> = {
  subjects: "materie",
  exams: "esami",
  events: "eventi",
  tasks: "task",
  sessions: "sessioni",
  topics: "argomenti",
  attachments: "materiali",
  goals: "obiettivi",
  notes: "note",
  tags: "tag",
  reminders: "promemoria",
  widgets: "widget",
  preferences: "preferenze"
};

export const backupSummary = (snapshot: StudySnapshot) => {
  const parts = COLLECTIONS.filter((key) => snapshot[key].length > 0).map((key) => `${snapshot[key].length} ${COLLECTION_LABEL[key]}`);
  return { total: countEntities(snapshot), text: parts.join(", ") || "nessun elemento" };
};

export const downloadJson = (fileName: string, payload: unknown) =>
  downloadBlob(fileName, new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));

export const downloadBlob = (fileName: string, blob: Blob) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoca differita: Safari/iOS annullano il download se l'URL viene revocato subito.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
};
