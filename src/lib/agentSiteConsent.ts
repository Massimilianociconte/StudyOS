// Consenso del connettore remoto dal sito di StudyOS (#collega=<id>), su qualsiasi dispositivo e
// senza browser collegato all'hub: la pagina di consenso dell'hub manda qui, la persona conferma con
// l'accesso al suo account, l'app crea il permesso cloud e lo passa all'hub, che lo prova sul cloud
// prima di emettere il codice. Poi si torna alla pagina dell'hub (/authorize/continue), che rimanda
// all'assistente.
//
// Sicurezza: l'hub è sempre quello configurato in questa build (mai un indirizzo preso dal link) e
// il permesso vale solo per l'account con cui è fatto l'accesso. Il nome nell'indirizzo del
// connettore deve essere quello del profilo: altrimenti si rifiuta, per non collegare l'account
// sbagliato a un indirizzo pensato per un'altra persona.

import { cloudSlug } from "../agent/accounts";
import { hubCandidates } from "../agent/hubEndpoint";
import { readSavedHub } from "./agentLocal";

export { clearSiteConsent, readSiteConsent, saveSiteConsent, siteConsentIdFromUrl, urlWithoutSiteConsent } from "./siteConsentLink";

export interface SiteConsentRequest {
  clientName: string;
  redirectHost: string;
  scopes: string[];
  /** Nome dell'account nell'indirizzo del connettore e il suo slug (`/u/<slug>/mcp`). */
  account: string;
  accountSlug: string;
  /** Codice da confrontare con quello della pagina dell'hub. */
  code: string;
  expiresAt: string;
  decided: boolean;
}

/** Hub di questa build: quello configurato (o il tunnel salvato dall'app). Mai uno preso dal link. */
export const siteConsentHub = (pageOrigin: string, saved: string, configured: string) => hubCandidates(pageOrigin, saved, configured)[0] ?? "";

const configuredHub = () => {
  const value = import.meta.env?.VITE_AGENT_HUB_ORIGIN;
  return typeof value === "string" ? value : "";
};

const currentHub = () => siteConsentHub(typeof window === "undefined" ? "" : window.location.origin, readSavedHub(), configuredHub());

/** Slug del profilo, come quello dell'indirizzo che l'app mostra in Impostazioni → Agenti. */
export const profileSlug = (displayName: string) => cloudSlug(encodeURIComponent(displayName.trim())) ?? "";

export type ConsentCheck = { ok: true } | { ok: false; reason: "signIn" | "noName" | "otherAccount" | "expired" | "decided" };

/** Si può confermare da qui? Serve l'accesso all'account e un profilo con lo stesso nome dell'indirizzo. */
export const checkSiteConsent = (request: Pick<SiteConsentRequest, "accountSlug" | "expiresAt" | "decided">, input: { signedIn: boolean; displayName: string; now?: number }): ConsentCheck => {
  if (request.decided) return { ok: false, reason: "decided" };
  const expires = Date.parse(request.expiresAt);
  if (Number.isFinite(expires) && expires <= (input.now ?? Date.now())) return { ok: false, reason: "expired" };
  if (!input.signedIn) return { ok: false, reason: "signIn" };
  const mine = profileSlug(input.displayName);
  if (!mine) return { ok: false, reason: "noName" };
  if (mine !== request.accountSlug) return { ok: false, reason: "otherAccount" };
  return { ok: true };
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const errorOf = (data: unknown, fallback: string) => (isRecord(data) && typeof data.error === "string" ? data.error : fallback);

/** Dettagli della richiesta dall'hub. Lancia un errore leggibile se è scaduta o l'hub non risponde. */
export const fetchSiteConsent = async (id: string, options: { hub?: string; fetcher?: typeof fetch; offline: string } ): Promise<SiteConsentRequest> => {
  const hub = options.hub ?? currentHub();
  if (!hub) throw new Error(options.offline);
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${hub}/oauth/request?id=${encodeURIComponent(id)}`, { headers: { accept: "application/json" } });
  } catch {
    throw new Error(options.offline);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !isRecord(data)) throw new Error(errorOf(data, options.offline));
  const text = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : "");
  return {
    clientName: text("clientName") || "Assistente",
    redirectHost: text("redirectHost"),
    scopes: Array.isArray(data.scopes) ? data.scopes.filter((scope): scope is string => typeof scope === "string") : [],
    account: text("account"),
    accountSlug: text("accountSlug"),
    code: text("code"),
    expiresAt: text("expiresAt"),
    decided: data.decided === true
  };
};

/**
 * Decisione: con «Consenti» crea il permesso cloud dell'account (serve l'accesso) e lo passa all'hub.
 * Restituisce l'indirizzo dell'hub a cui tornare per completare il collegamento.
 */
export const decideSiteConsent = async (
  id: string,
  choice: { approve: boolean; write: boolean; clientName: string },
  options: {
    hub?: string;
    fetcher?: typeof fetch;
    offline: string;
    createGrant?: (label: string) => Promise<{ secret: string; timeZone: string }>;
  }
): Promise<{ continueUrl: string }> => {
  const hub = options.hub ?? currentHub();
  if (!hub) throw new Error(options.offline);
  let cloud: { secret: string; timeZone: string } | undefined;
  if (choice.approve) {
    const create = options.createGrant ?? (await import("./agentCloud")).createAgentGrant;
    cloud = await create(choice.clientName);
  }
  const fetcher = options.fetcher ?? fetch;
  let response: Response;
  try {
    response = await fetcher(`${hub}/oauth/decide-cloud`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        requestId: id,
        approve: choice.approve,
        scopes: choice.approve ? ["studyos:read", ...(choice.write ? ["studyos:write"] : [])] : [],
        ...(cloud ? { cloud } : {})
      })
    });
  } catch {
    throw new Error(options.offline);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorOf(data, options.offline));
  const next = isRecord(data) && typeof data.continueUrl === "string" ? data.continueUrl : "";
  // Si torna solo sull'hub di questa build: un indirizzo diverso nella risposta non si segue.
  return { continueUrl: next.startsWith(`${hub}/`) ? next : `${hub}/authorize/continue` };
};
