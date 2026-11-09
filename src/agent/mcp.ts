import { AGENT_PROTOCOL_VERSIONS, AGENT_RESPONSE_CHAR_LIMIT, AGENT_SERVER_NAME, AGENT_SERVER_VERSION } from "./constants";
import { AGENT_TOOLS, findAgentTool, mcpToolDefinition } from "./catalog";
import { ResultLedger } from "./ledger";
import { parseToolArgs } from "./schema";
import type { AgentActor, AgentCallResult } from "./types";

export const AGENT_INSTRUCTIONS = [
  "StudyOS è il workspace di studio della persona. I dati stanno nel browser che ha il sito aperto (anche dal telefono, sulla copia pubblicata) e non vanno copiati altrove. Non chiedere segreti (passphrase, codici di invito, token, chiave di collegamento).",
  "Le letture rispondono subito. Le modifiche e le eliminazioni restano in attesa finché la persona le conferma nell'app, salvo una policy più stretta.",
  "Se la risposta contiene status=pending_approval, non ripetere l'azione: chiama studyos_approval_status con approvalId.",
  "Prima di aggiornare o eliminare, leggi l'id con uno strumento di elenco. Non inventare id, date di esami ufficiali o voti.",
  "Le eliminazioni richiedono confirm=true e vanno usate solo se la persona ha chiesto di cancellare quell'elemento. Per chiudere una task imposta status=done.",
  "Non puoi cambiare vault, passphrase, backup, reset dei dati, ruoli dei gruppi o codici di invito: quelle azioni restano nell'app."
].join(" ");

export interface McpDeps {
  actor: AgentActor;
  ledger: ResultLedger;
  connected: () => boolean;
  invoke: (call: { id: string; name: string; args: Record<string, unknown>; actor: AgentActor }) => Promise<AgentCallResult>;
  createId?: () => string;
}

type Rpc = { jsonrpc?: unknown; id?: unknown; method?: unknown; params?: unknown };

const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

const clip = (value: unknown) => {
  const text = JSON.stringify(value);
  if (text.length <= AGENT_RESPONSE_CHAR_LIMIT) return text;
  return `${text.slice(0, AGENT_RESPONSE_CHAR_LIMIT)}… [troncato: riduci limit o aggiungi un filtro]`;
};

export const toToolContent = (result: AgentCallResult) => ({
  content: [{ type: "text" as const, text: clip(result) }],
  isError: result.ok === false
});

const offlineStatus = () => ({
  ok: true as const,
  data: {
    connected: false,
    message: "StudyOS non è collegato. Apri https://massimilianociconte.github.io/StudyOS/ (va bene anche dal telefono), vai in Impostazioni → Agenti e collega questo browser. Tieni la pagina aperta: i dati restano lì."
  }
});

/** Gestisce un messaggio JSON-RPC MCP. null = notifica senza risposta. */
export const handleMcpRpc = async (message: unknown, deps: McpDeps): Promise<Record<string, unknown> | null> => {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return rpcError(null, -32600, "Richiesta JSON-RPC non valida.");
  }
  const rpc = message as Rpc;
  if (rpc.jsonrpc !== "2.0" || typeof rpc.method !== "string") return rpcError(rpc.id ?? null, -32600, "Richiesta JSON-RPC non valida.");
  if (rpc.id === undefined) {
    if (rpc.method === "notifications/initialized" || rpc.method.startsWith("notifications/")) return null;
    return null;
  }

  try {
    if (rpc.method === "initialize") {
      const params = rpc.params && typeof rpc.params === "object" ? (rpc.params as { protocolVersion?: unknown }) : {};
      const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : AGENT_PROTOCOL_VERSIONS[1];
      const protocolVersion = (AGENT_PROTOCOL_VERSIONS as readonly string[]).includes(requested) ? requested : AGENT_PROTOCOL_VERSIONS[1];
      return {
        jsonrpc: "2.0",
        id: rpc.id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: AGENT_SERVER_NAME, version: AGENT_SERVER_VERSION },
          instructions: AGENT_INSTRUCTIONS
        }
      };
    }
    if (rpc.method === "ping") return { jsonrpc: "2.0", id: rpc.id, result: {} };
    if (rpc.method === "tools/list") {
      return { jsonrpc: "2.0", id: rpc.id, result: { tools: AGENT_TOOLS.map(mcpToolDefinition) } };
    }
    if (rpc.method === "tools/call") {
      const params = rpc.params && typeof rpc.params === "object" ? (rpc.params as { name?: unknown; arguments?: unknown }) : {};
      const name = typeof params.name === "string" ? params.name : "";
      const found = findAgentTool(name);
      if (!found) return { jsonrpc: "2.0", id: rpc.id, result: toToolContent({ ok: false, code: "invalid", error: `Strumento sconosciuto: ${name}. Usa tools/list.` }) };
      const parsed = parseToolArgs(found.inputSchema, params.arguments ?? {});
      if (!parsed.ok) return { jsonrpc: "2.0", id: rpc.id, result: toToolContent({ ok: false, code: "invalid", error: parsed.error }) };
      if (found.risk !== "read" && !deps.actor.scopes.includes("studyos:write")) {
        return {
          jsonrpc: "2.0",
          id: rpc.id,
          result: toToolContent({ ok: false, code: "denied", error: "Questo collegamento può solo leggere. Ricollega StudyOS concedendo anche le azioni." })
        };
      }
      if (name === "studyos_approval_status") {
        const approvalId = String(parsed.data.approvalId ?? "");
        const stored = deps.ledger.recall(approvalId);
        const result: AgentCallResult = stored ?? { ok: false, code: "not_found", error: "Nessuna azione con questo approvalId. Potrebbe essere scaduta (30 minuti) o appartenere a un altro avvio del server." };
        return { jsonrpc: "2.0", id: rpc.id, result: toToolContent(result) };
      }
      if (!deps.connected()) {
        if (name === "studyos_status") return { jsonrpc: "2.0", id: rpc.id, result: toToolContent(offlineStatus()) };
        const offline = offlineStatus();
        return { jsonrpc: "2.0", id: rpc.id, result: toToolContent({ ok: false, code: "not_connected", error: String(offline.data.message ?? "") }) };
      }
      const id = deps.createId?.() ?? `call_${crypto.randomUUID()}`;
      const result = await deps.invoke({ id, name, args: parsed.data, actor: deps.actor });
      deps.ledger.remember(id, result);
      return { jsonrpc: "2.0", id: rpc.id, result: toToolContent(result) };
    }
    return rpcError(rpc.id, -32601, `Metodo non supportato: ${rpc.method}.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore interno.";
    return rpcError(rpc.id, -32603, message);
  }
};
