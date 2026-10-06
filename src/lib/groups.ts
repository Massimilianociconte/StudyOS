/** Logica pura dei gruppi: codici di invito, normalizzazione, link condivisibili. */

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

const randomCodePart = (length: number, random: () => number = Math.random) =>
  Array.from({ length }, () => CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]).join("");

/** Codice condivisibile tipo GRP-XXXX-XXXX (niente caratteri ambigui). */
export const makeGroupInviteCode = (random?: () => number) => `GRP-${randomCodePart(4, random)}-${randomCodePart(4, random)}`;

export const normalizeInviteCode = (value: string) => value.trim().toUpperCase().replace(/[\s-]+/g, "-");

export const isInviteCodeShape = (value: string) => /^GRP-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(normalizeInviteCode(value));

const inviteLinkBase = () => {
  if (typeof window === "undefined") return "";
  return `${window.location.origin}${window.location.pathname}`;
};

/** Link che all'apertura precompila il codice in Gruppi → Unisciti (parametro ?invito=). */
export const groupInviteLink = (code: string) => `${inviteLinkBase()}?invito=${encodeURIComponent(normalizeInviteCode(code))}`;

export const groupInviteMessage = (groupName: string, inviter: string, code: string) =>
  `Unisciti al gruppo "${groupName}" su StudyOS (invito di ${inviter}).\n\nApri Gruppi → Unisciti con codice e inserisci: ${normalizeInviteCode(code)}\nOppure apri direttamente: ${groupInviteLink(code)}`;
