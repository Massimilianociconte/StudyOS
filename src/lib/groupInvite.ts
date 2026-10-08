// Invito ricevuto via link o QR: si legge dall'URL, si ricorda in locale (sopravvive a login,
// registrazione e conferma email nella stessa scheda o in una nuova) e si consuma all'ingresso.

import { isInviteCodeShape, normalizeInviteCode } from "./groups";

export const INVITE_PARAM = "invito";
const STORAGE_KEY = "studyos-pending-invite";
/** Un invito dimenticato non deve far entrare in un gruppo settimane dopo. */
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const PENDING_INVITE_EVENT = "studyos:pending-invite";
export const GROUP_JOINED_EVENT = "studyos:group-joined";

export interface PendingInvite {
  code: string;
  savedAt: number;
  /** L'utente ha già scelto "Entra" (es. prima di accedere): dopo il login si entra da soli. */
  confirmed: boolean;
}

const hashParams = (hash: string) => new URLSearchParams(hash.replace(/^#/, ""));

/**
 * Codice di invito da un URL o da testo incollato. Preferito il frammento (#invito=…), che il
 * browser non invia ai server; accettata la query (?invito=…) dei link già condivisi e del
 * ritorno dalla conferma email.
 */
export const inviteCodeFromText = (value: string): string | null => {
  const text = value.trim();
  if (!text) return null;
  if (isInviteCodeShape(text)) return normalizeInviteCode(text);
  try {
    const url = new URL(text);
    const raw = hashParams(url.hash).get(INVITE_PARAM) ?? url.searchParams.get(INVITE_PARAM);
    return raw && isInviteCodeShape(raw) ? normalizeInviteCode(raw) : null;
  } catch {
    const match = /GRP[\s-]*[A-Z0-9]{4}[\s-]*[A-Z0-9]{4}/i.exec(text);
    return match && isInviteCodeShape(match[0]) ? normalizeInviteCode(match[0]) : null;
  }
};

/** Stesso URL senza il parametro di invito; il resto (es. token di Supabase nel frammento) resta. */
export const urlWithoutInvite = (href: string) => {
  const url = new URL(href);
  url.searchParams.delete(INVITE_PARAM);
  const hash = hashParams(url.hash);
  if (hash.has(INVITE_PARAM)) {
    hash.delete(INVITE_PARAM);
    const rest = hash.toString();
    url.hash = rest ? `#${rest}` : "";
  }
  return `${url.pathname}${url.search}${url.hash}`;
};

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const notify = () => {
  try {
    window.dispatchEvent(new Event(PENDING_INVITE_EVENT));
  } catch {
    // ambiente senza window (test)
  }
};

export const readPendingInvite = (now: number = Date.now()): PendingInvite | null => {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingInvite>;
    if (typeof value.code !== "string" || !isInviteCodeShape(value.code) || typeof value.savedAt !== "number") return null;
    if (now - value.savedAt > MAX_AGE_MS || value.savedAt > now + 60_000) return null;
    return { code: normalizeInviteCode(value.code), savedAt: value.savedAt, confirmed: value.confirmed === true };
  } catch {
    return null;
  }
};

const writePendingInvite = (invite: PendingInvite | null) => {
  try {
    if (invite) storage()?.setItem(STORAGE_KEY, JSON.stringify(invite));
    else storage()?.removeItem(STORAGE_KEY);
  } catch {
    // storage pieno o bloccato: l'invito vale solo per questa visita
  }
  notify();
};

/** Nuovo invito (link/QR). Se è lo stesso già confermato (ritorno dalla conferma email) resta confermato. */
export const savePendingInvite = (code: string, now: number = Date.now()) => {
  const normalized = normalizeInviteCode(code);
  const current = readPendingInvite(now);
  writePendingInvite({ code: normalized, savedAt: now, confirmed: current?.code === normalized && current.confirmed });
};

export const confirmPendingInvite = (now: number = Date.now()) => {
  const current = readPendingInvite(now);
  if (current) writePendingInvite({ ...current, confirmed: true, savedAt: now });
};

export const clearPendingInvite = () => writePendingInvite(null);

export const whatsappShareUrl = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export const telegramShareUrl = (link: string, text: string) =>
  `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
