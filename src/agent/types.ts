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
  code: "invalid" | "not_found" | "denied" | "locked" | "not_connected" | "failed" | "pending";
  error: string;
  data?: Record<string, unknown>;
  summary?: string;
};

export interface AuditEntry {
  id: string;
  at: string;
  tool: string;
  risk: "read" | "write" | "destructive";
  decision: "allow" | "ask" | "deny";
  status: "executed" | "denied" | "failed" | "pending";
  summary: string;
  actor: string;
}
