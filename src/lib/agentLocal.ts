import { DEFAULT_AGENT_POLICY, normalizeAgentPolicy, type AgentPolicy } from "../agent/policy";
import type { AuditEntry } from "../agent/types";

const TOKEN_KEY = "studyos-agent-token";
const POLICY_KEY = "studyos-agent-policy";
const AUDIT_KEY = "studyos-agent-audit";
const HUB_KEY = "studyos-agent-hub";
const BROWSER_KEY = "studyos-agent-browser";
const AUDIT_LIMIT = 150;

const storage = () => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const readAgentToken = () => storage()?.getItem(TOKEN_KEY) ?? "";

let memoryBrowserId = "";

/**
 * Id casuale e stabile di questo browser per l'hub degli agenti: distingue i browser dello stesso
 * account da quelli di altre persone collegate allo stesso connettore. Non contiene dati personali.
 */
export const readBrowserId = () => {
  const store = storage();
  const saved = store?.getItem(BROWSER_KEY) ?? memoryBrowserId;
  if (/^[A-Za-z0-9_-]{8,80}$/.test(saved)) return saved;
  const created = `browser_${crypto.randomUUID().replace(/-/g, "")}`;
  memoryBrowserId = created;
  try {
    store?.setItem(BROWSER_KEY, created);
  } catch {
    // spazio pieno: resta l'id in memoria fino al ricaricamento
  }
  return created;
};

export const readSavedHub = () => storage()?.getItem(HUB_KEY) ?? "";

export const writeSavedHub = (value: string | null) => {
  const store = storage();
  if (!store) return;
  if (value) store.setItem(HUB_KEY, value);
  else store.removeItem(HUB_KEY);
};

export const writeAgentToken = (token: string | null) => {
  const store = storage();
  if (!store) return;
  if (token) store.setItem(TOKEN_KEY, token);
  else store.removeItem(TOKEN_KEY);
};

export const readStoredPolicy = (): AgentPolicy => {
  const raw = storage()?.getItem(POLICY_KEY);
  if (!raw) return { ...DEFAULT_AGENT_POLICY };
  try {
    return normalizeAgentPolicy(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_AGENT_POLICY };
  }
};

export const writeStoredPolicy = (policy: AgentPolicy) => {
  storage()?.setItem(POLICY_KEY, JSON.stringify(normalizeAgentPolicy(policy)));
};

export const readAudit = (limit = 40): AuditEntry[] => {
  const raw = storage()?.getItem(AUDIT_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, Math.max(1, Math.min(100, limit))) as AuditEntry[];
  } catch {
    return [];
  }
};

export const appendAudit = (entry: AuditEntry) => {
  const store = storage();
  if (!store) return;
  const next = [entry, ...readAudit(AUDIT_LIMIT)].slice(0, AUDIT_LIMIT);
  store.setItem(AUDIT_KEY, JSON.stringify(next));
};
