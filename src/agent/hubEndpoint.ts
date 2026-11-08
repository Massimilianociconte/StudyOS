/** Scelta dell'hub e della finestra che esegue le azioni. Non è un controllo di sicurezza. */
import { AGENT_HUB_ORIGIN } from "./constants";

export const PUBLISHED_HOST = "massimilianociconte.github.io";
export type BridgeSite = "published" | "local";

const TUNNEL_HOST = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.trycloudflare\.com$/;

export const normalizePublicHub = (value: string): string | null => {
  let raw = value.trim().replace(/\/mcp\/?$/i, "").replace(/\/+$/, "");
  if (!raw || /[\s@\\]/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.port) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  const host = url.hostname.toLowerCase();
  if (!TUNNEL_HOST.test(host)) return null;
  return `https://${host}`;
};

export const isLocalPage = (pageOrigin: string) => {
  try {
    const host = new URL(pageOrigin).hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "::1";
  } catch {
    return false;
  }
};

/** In sviluppo si parla solo col loopback. Sul sito pubblicato si prova prima quello, poi il tunnel salvato. */
export const hubCandidates = (pageOrigin: string, saved: string | null | undefined): string[] => {
  if (isLocalPage(pageOrigin)) return [AGENT_HUB_ORIGIN];
  const tunnel = saved ? normalizePublicHub(saved) : null;
  return tunnel ? [AGENT_HUB_ORIGIN, tunnel] : [AGENT_HUB_ORIGIN];
};

export const bridgeSite = (hostname: string): BridgeSite => hostname.toLowerCase() === PUBLISHED_HOST ? "published" : "local";

export const siteFromOrigin = (origin: string | undefined): BridgeSite => {
  if (!origin) return "local";
  try {
    return bridgeSite(new URL(origin).hostname);
  } catch {
    return "local";
  }
};

/**
 * Se la scheda pubblicata è collegata, le azioni vanno lì.
 * Mentre il suo heartbeat è fresco, la copia locale non le intercetta.
 */
export const choosePoller = <T extends { site: BridgeSite }>(pollers: readonly T[], publishedFresh: boolean): T | null => {
  const published = pollers.find((item) => item.site === "published");
  if (published) return published;
  if (publishedFresh) return null;
  return pollers.find((item) => item.site === "local") ?? null;
};
