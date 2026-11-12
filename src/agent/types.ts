import type { AgentDataScope } from "./constants";

export interface AgentActor {
  name: string;
  source: "oauth" | "stdio" | "local";
  scopes: AgentDataScope[];
}

export type AgentCallResult = {
  ok: true;
  data: Record<string, unknown>;
  summary?: string;
} | {
  ok: false;
  /** conflict: qualcuno ha cambiato l'elemento del gruppo nel frattempo (data.current = versione attuale). */
  code: "invalid" | "not_found" | "denied" | "locked" | "not_connected" | "failed" | "pending" | "conflict";
  error: string;
  data?: Record<string, unknown>;
  summary?: string;
};

export interface AuditEntry {
  id: string;
  at: string;
  tool: string;
  /** Assente quando lo strumento non è stato nemmeno caricato (nessun rischio né decisione da dire). */
  risk?: "read" | "write" | "destructive";
  decision?: "allow" | "ask" | "deny";
  status: "executed" | "denied" | "failed" | "pending";
  summary: string;
  actor: string;
}
