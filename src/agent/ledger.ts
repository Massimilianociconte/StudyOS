import type { AgentCallResult } from "./types";

const TTL_MS = 30 * 60 * 1000;

/** Esiti delle chiamate, così un agente può rileggere una conferma ancora in corso o appena chiusa. */
export class ResultLedger {
  private results = new Map<string, { at: number; result: AgentCallResult }>();

  remember(id: string, result: AgentCallResult, now = Date.now()) {
    this.results.set(id, { at: now, result });
    this.prune(now);
  }

  recall(id: string, now = Date.now()): AgentCallResult | undefined {
    this.prune(now);
    return this.results.get(id)?.result;
  }

  private prune(now: number) {
    for (const [id, item] of this.results) {
      if (now - item.at > TTL_MS) this.results.delete(id);
    }
  }
}
