// Link `#collega=<id>` del consenso del connettore remoto: lettura dal frammento e richiesta
// ricordata per 15 minuti. Nessun import: sta nel bundle principale, il resto (rete, permesso cloud,
// dialogo) arriva in differita con src/lib/agentSiteConsent.ts e il suo dialogo.

export const SITE_CONSENT_EVENT = "studyos:site-consent";
const STORAGE_KEY = "studyos.agent.siteConsent";
/** Quanto resta ricordata la richiesta (anche durante l'accesso all'account): come la sua durata sull'hub. */
const REMEMBER_MS = 15 * 60 * 1000;
const ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const HASH_RE = /#collega=([^&]*)/;

/** Id della richiesta da `#collega=<id>`, "" se non c'è o non è valido. */
export const siteConsentIdFromUrl = (href: string) => {
  const match = HASH_RE.exec(href);
  if (!match) return "";
  let id = "";
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return "";
  }
  return ID_RE.test(id) ? id : "";
};

/** Lo stesso indirizzo senza `#collega=…` (resta il resto del frammento, se c'è). */
export const urlWithoutSiteConsent = (href: string) => {
  const url = new URL(href);
  const rest = url.hash.replace(/^#/, "").split("&").filter((part) => part && !part.startsWith("collega=")).join("&");
  url.hash = rest ? `#${rest}` : "";
  return url.toString();
};

const storage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** Ricorda la richiesta per 15 minuti: resta anche se l'accesso all'account apre un'altra scheda. */
export const saveSiteConsent = (id: string, now = Date.now()) => {
  storage()?.setItem(STORAGE_KEY, JSON.stringify({ id, until: now + REMEMBER_MS }));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(SITE_CONSENT_EVENT));
};

export const readSiteConsent = (now = Date.now()) => {
  const raw = storage()?.getItem(STORAGE_KEY);
  if (!raw) return "";
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; until?: unknown };
    if (typeof parsed.id === "string" && ID_RE.test(parsed.id) && typeof parsed.until === "number" && parsed.until > now) return parsed.id;
  } catch {
    // valore rovinato: si toglie qui sotto
  }
  storage()?.removeItem(STORAGE_KEY);
  return "";
};

/**
 * Toglie la richiesta. `notify: false` la toglie senza chiudere il dialogo: serve prima di tornare
 * all'hub, perché chiudere un drawer fa Indietro nella cronologia e annullerebbe la navigazione.
 */
export const clearSiteConsent = (notify = true) => {
  storage()?.removeItem(STORAGE_KEY);
  if (notify && typeof window !== "undefined") window.dispatchEvent(new Event(SITE_CONSENT_EVENT));
};
