/** Porta fissa: la CSP della build consente solo questo loopback. */
export const AGENT_PORT = 47321;

export const AGENT_HUB_ORIGIN = `http://127.0.0.1:${AGENT_PORT}`;

export const AGENT_MCP_PATH = "/mcp";

export const AGENT_RESOURCE_PATH = `${AGENT_HUB_ORIGIN}${AGENT_MCP_PATH}`;

export const AGENT_SERVER_NAME = "studyos-mcp-server";

export const AGENT_SERVER_VERSION = "1.0.0";

export const AGENT_PROTOCOL_VERSIONS = ["2026-07-28", "2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const AGENT_SCOPES = ["studyos:read", "studyos:write", "offline_access"] as const;

export type AgentScope = (typeof AGENT_SCOPES)[number];

export const AGENT_DATA_SCOPES = ["studyos:read", "studyos:write"] as const;

export type AgentDataScope = (typeof AGENT_DATA_SCOPES)[number];

/** Risposte tool: oltre questa soglia si tronca e si chiede di filtrare. */
export const AGENT_RESPONSE_CHAR_LIMIT = 24_000;
