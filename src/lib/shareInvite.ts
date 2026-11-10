// Invito di condivisione arrivato da link o QR (#condividi=<token>): si ricorda in locale
// (sopravvive a login, registrazione e conferma email) finché non si risponde, al massimo 14 giorni.
// A differenza dei gruppi non si completa da solo dopo il login: chi riceve deve vedere cosa
// accetta e scegliere cosa condividere in cambio.

import { isShareToken } from "./sharing";

const STORAGE_KEY = "studyos-pending-share";
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const PENDING_SHARE_EVENT = "studyos:pending-share";

export interface PendingShare {
  token: string;
  savedAt: number;
}

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const notify = () => {
  try {
    window.dispatchEvent(new Event(PENDING_SHARE_EVENT));
  } catch {
    // ambiente senza window (test)
  }
};

export const readPendingShare = (now: number = Date.now()): PendingShare | null => {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingShare>;
    if (typeof value.token !== "string" || !isShareToken(value.token) || typeof value.savedAt !== "number") return null;
    if (now - value.savedAt > MAX_AGE_MS || value.savedAt > now + 60_000) return null;
    return { token: value.token, savedAt: value.savedAt };
  } catch {
    return null;
  }
};

const writePendingShare = (value: PendingShare | null) => {
  try {
    if (value) storage()?.setItem(STORAGE_KEY, JSON.stringify(value));
    else storage()?.removeItem(STORAGE_KEY);
  } catch {
    // storage pieno o bloccato: l'invito vale solo per questa visita
  }
  notify();
};

export const savePendingShare = (token: string, now: number = Date.now()) => {
  if (isShareToken(token)) writePendingShare({ token, savedAt: now });
};

export const clearPendingShare = () => writePendingShare(null);
