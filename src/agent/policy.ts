export type AgentRisk = "read" | "write" | "destructive";

export type PolicyChoice = "allow" | "ask" | "deny";

export interface AgentPolicy {
  read: PolicyChoice;
  write: PolicyChoice;
  destructive: PolicyChoice;
  /** ISO: fino a questo istante le modifiche (non le eliminazioni) non chiedono conferma. */
  trustedWritesUntil?: string | null;
}

export const DEFAULT_AGENT_POLICY: AgentPolicy = {
  read: "allow",
  write: "ask",
  destructive: "ask"
};

const CHOICES = new Set<PolicyChoice>(["allow", "ask", "deny"]);

export const normalizeAgentPolicy = (value: unknown): AgentPolicy => {
  const source = value && typeof value === "object" ? (value as Partial<AgentPolicy>) : {};
  const trusted = typeof source.trustedWritesUntil === "string" ? source.trustedWritesUntil : null;
  return {
    read: CHOICES.has(source.read as PolicyChoice) ? (source.read as PolicyChoice) : DEFAULT_AGENT_POLICY.read,
    write: CHOICES.has(source.write as PolicyChoice) ? (source.write as PolicyChoice) : DEFAULT_AGENT_POLICY.write,
    destructive: CHOICES.has(source.destructive as PolicyChoice) ? (source.destructive as PolicyChoice) : DEFAULT_AGENT_POLICY.destructive,
    trustedWritesUntil: trusted
  };
};

/**
 * Decide se eseguire subito, chiedere conferma nell'app o rifiutare.
 * La sessione fidata allenta solo le modifiche, mai le eliminazioni e mai un divieto esplicito.
 */
export const decideAgentAction = (policy: AgentPolicy, risk: AgentRisk, now: Date = new Date()): PolicyChoice => {
  const choice = policy[risk];
  if (choice === "deny" || choice === "allow") return choice;
  if (risk === "write" && policy.trustedWritesUntil) {
    const until = Date.parse(policy.trustedWritesUntil);
    if (Number.isFinite(until) && until > now.getTime()) return "allow";
  }
  return "ask";
};

export const trustedWritesActive = (policy: AgentPolicy, now: Date = new Date()) => {
  if (!policy.trustedWritesUntil) return false;
  const until = Date.parse(policy.trustedWritesUntil);
  return Number.isFinite(until) && until > now.getTime();
};
