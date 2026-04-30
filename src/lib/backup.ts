import type { BackupEnvelope, StudySnapshot, UserSettings, VaultRecord } from "../types";
import { decryptString, encryptString } from "./crypto";

export const createBackupEnvelope = async (
  snapshot: StudySnapshot,
  settings: UserSettings,
  passphrase?: string
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
    exportedAt,
    encrypted: true,
    crypto: cryptoRecord,
    settings: backupSettings
  };
};

export const readBackupEnvelope = async (file: File) => {
  const text = await file.text();
  const parsed = JSON.parse(text) as BackupEnvelope;
  if (parsed.format !== "studyos.backup" || parsed.version !== 1) {
    throw new Error("Backup StudyOS non valido.");
  }
  return parsed;
};

export const snapshotFromBackup = async (backup: BackupEnvelope, passphrase?: string): Promise<StudySnapshot> => {
  if (!backup.encrypted && backup.data) return backup.data;
  if (!backup.crypto || !passphrase) throw new Error("Passphrase richiesta per questo backup.");
  return JSON.parse(await decryptString(backup.crypto as VaultRecord, passphrase)) as StudySnapshot;
};

export const downloadJson = (fileName: string, payload: unknown) => {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
};
