// Solo schemi sicuri nei link aperti dall'utente: un backup importato o un payload cloud
// non devono poter inserire `javascript:` (XSS al click) nei materiali.

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/** Normalizza un link esterno ("www.sito.it" -> https://www.sito.it); null se non sicuro. */
export const normalizeExternalUrl = (raw: string | null | undefined): string | null => {
  const value = raw?.trim();
  if (!value) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(withScheme);
    if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;
    if ((url.protocol === "http:" || url.protocol === "https:") && !url.hostname.includes(".") && url.hostname !== "localhost") {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
};

/** href sicuro per il rendering; undefined disattiva il link. */
export const safeHref = (raw: string | null | undefined) => normalizeExternalUrl(raw) ?? undefined;

/** Allegati incorporati: solo data URL (mai javascript: o altri schemi). */
export const safeDataUrl = (raw: string | null | undefined) =>
  typeof raw === "string" && /^data:[\w.+-]+\/[\w.+-]+[;,]/i.test(raw) ? raw : undefined;
