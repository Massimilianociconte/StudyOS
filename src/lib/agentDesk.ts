// Impostazioni → Agenti AI: logica pura della schermata (stato, revoche, connettore remoto).
// Niente DOM e niente rete: la usano AgentDesk, agentLink e i test.
import { cloudMcpPath, cloudSlug } from "../agent/accounts";
import { agentCloudLabels } from "./labels";
import { AGENT_DESK_TEXT } from "./labels/agents";

/** "browser" = solo gli accessi approvati da questo browser; "cloud" = solo i suoi remoti; "all" = di tutti. */
export type RevokeScope = "browser" | "cloud" | "all";

export interface RevokeOutcome {
  scope: RevokeScope;
  /** Concessioni tolte (un assistente collegato = una concessione). */
  revoked: number;
  /** Concessioni senza browser che le ha approvate (di prima, o di un'app senza segreto): restano. */
  legacy: number;
}

const count = (value: unknown) => (typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 0);

/**
 * Risposta di /oauth/revoke. Un hub di prima della 1.6.0 risponde solo { ok: true } e ha
 * scollegato tutti: l'esito lo dice, invece di promettere una revoca solo tua.
 */
export const parseRevokeOutcome = (data: unknown, asked: RevokeScope): RevokeOutcome => {
  const source = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const scope: RevokeScope = source.scope === "browser" || source.scope === "cloud" || source.scope === "all"
    ? source.scope
    : "ok" in source ? "all" : asked;
  return { scope, revoked: count(source.revoked), legacy: count(source.legacy) };
};

/**
 * Versione dell'hub (`/health`) che revoca per browser. Prima della 1.6.0 /oauth/revoke scollegava
 * tutti qualunque cosa chiedesse: lì non si manda mai una revoca limitata.
 */
export const hubRevokesPerBrowser = (version: unknown) => {
  const match = typeof version === "string" ? /^(\d+)\.(\d+)\./.exec(version) : null;
  if (!match) return false;
  const [major, minor] = [Number(match[1]), Number(match[2])];
  return major > 1 || (major === 1 && minor >= 6);
};

export type RevokePlan =
  | { kind: "send"; body: Record<string, string> }
  /** Hub di prima con il connettore remoto: basta il permesso tolto nel cloud. */
  | { kind: "skip" }
  /** Questo browser non ha ancora il suo segreto: la revoca limitata non si può chiedere. */
  | { kind: "noSecret" }
  /** Hub di prima della 1.6.0 o versione ignota: sa solo scollegare tutti, quindi si chiede conferma. */
  | { kind: "confirmAll" };

/**
 * Corpo di /oauth/revoke. Una revoca limitata porta il segreto di questo browser, mai il nome del
 * profilo: l'hub toglie solo ciò che quel segreto ha approvato.
 */
export const revokePlan = ({ scope, hubVersion, token, secret }: { scope: RevokeScope; hubVersion: unknown; token: string; secret: string }): RevokePlan => {
  if (scope === "all") return { kind: "send", body: { token, scope: "all" } };
  // Un hub di prima tratta qualunque /oauth/revoke come «scollega tutti»: mai una revoca limitata lì.
  if (!hubRevokesPerBrowser(hubVersion)) return scope === "cloud" ? { kind: "skip" } : { kind: "confirmAll" };
  if (!secret) return { kind: "noSecret" };
  return { kind: "send", body: scope === "cloud" ? { token, secret, scope: "cloud" } : { token, secret } };
};

/** Frase dopo una revoca: cosa è stato tolto, cosa resta e perché. `cloudGrants` = permessi remoti tolti nel cloud. */
export const revokeNotice = (outcome: RevokeOutcome, cloudGrants: number): string => {
  if (outcome.scope === "cloud") {
    return outcome.revoked > 0 || cloudGrants > 0 ? AGENT_DESK_TEXT.remote.revoked : AGENT_DESK_TEXT.remote.none;
  }
  const parts = outcome.scope === "all"
    ? [AGENT_DESK_TEXT.revokedAll]
    : [
      AGENT_DESK_TEXT.revokedMine(outcome.revoked),
      outcome.legacy > 0 ? AGENT_DESK_TEXT.revokedLegacy(outcome.legacy, AGENT_DESK_TEXT.revokeAllButton) : ""
    ];
  return [...parts, agentCloudLabels.revoked(cloudGrants), AGENT_DESK_TEXT.browserStays].filter(Boolean).join(" ");
};

/** Revoca chiesta senza browser collegato: «chiave» sul sito pubblicato, «codice» con npm run agent. */
export const pairFirstError = (local: boolean) => AGENT_DESK_TEXT.pairFirst(local);

export interface DeskStatus {
  label: string;
  tone: "neutral" | "ok" | "warn";
}

/**
 * Un solo stato in cima alla schermata. Chi non ha ancora provato a collegarsi vede «Non ancora
 * collegato», mai un errore: l'hub irraggiungibile conta solo dopo un tentativo o a browser collegato.
 */
export const agentDeskStatus = ({ paired, hub, attempted }: { paired: boolean; hub: "unknown" | "up" | "down"; attempted: boolean }): DeskStatus => {
  const text = AGENT_DESK_TEXT.status;
  if (!paired) return attempted && hub === "down" ? { label: text.unreachable, tone: "warn" } : { label: text.notYet, tone: "neutral" };
  if (hub === "up") return { label: text.connected, tone: "ok" };
  if (hub === "down") return { label: text.unreachable, tone: "warn" };
  return { label: text.checking, tone: "neutral" };
};

export type RemoteConnectorView =
  | { kind: "address"; address: string }
  | { kind: "noCloud" | "noHub" | "off" | "noName" };

/**
 * Indirizzo del connettore remoto di questo account (`<hub>/u/<nome>/mcp`), o perché non si può
 * mostrare: app senza cloud, pagina senza hub pubblico, hub che non l'ha attivo (`/health`), profilo
 * senza nome. `remote` "unknown" = /health non ancora letto: l'indirizzo si mostra.
 */
export const remoteConnectorView = ({ cloud, hub, remote, displayName }: {
  cloud: boolean;
  hub: string | null;
  remote: "unknown" | "on" | "off";
  displayName: string;
}): RemoteConnectorView => {
  if (!cloud) return { kind: "noCloud" };
  if (!hub) return { kind: "noHub" };
  if (remote === "off") return { kind: "off" };
  // cloudSlug decodifica come un pezzo di URL: un nome con «%» va codificato prima.
  const slug = cloudSlug(encodeURIComponent(displayName.trim()));
  if (!slug) return { kind: "noName" };
  return { kind: "address", address: `${hub}${cloudMcpPath(slug)}` };
};
