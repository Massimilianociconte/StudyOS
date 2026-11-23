import type { AgentCallResult } from "./types";

const TTL_MS = 30 * 60 * 1000;
/**
 * Tetto di ciò che finisce nello snapshot dell'hub (un solo valore nello storage del Durable Object):
 * gli esiti più recenti fino a 256 KB, ognuno al massimo 32 KB. Quelli fuori restano in memoria
 * finché l'hub è acceso; dopo un riavvio `studyos_approval_status` dice «Esito non disponibile».
 */
const PERSIST_ITEM_MAX = 32 * 1024;
const PERSIST_TOTAL_MAX = 256 * 1024;

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

  exportState(now = Date.now()) {
    this.prune(now);
    const kept: Array<{ id: string; at: number; result: AgentCallResult }> = [];
    let total = 0;
    for (const [id, item] of [...this.results.entries()].sort((a, b) => b[1].at - a[1].at)) {
      const size = JSON.stringify(item.result).length;
      if (size > PERSIST_ITEM_MAX || total + size > PERSIST_TOTAL_MAX) continue;
      total += size;
      kept.push({ id, at: item.at, result: item.result });
    }
    return kept.reverse();
  }

  importState(items: Array<{ id: string; at: number; result: AgentCallResult }>) {
    this.results = new Map(items.map((item) => [item.id, { at: item.at, result: item.result }]));
  }

  private prune(now: number) {
    for (const [id, item] of this.results) {
      if (now - item.at > TTL_MS) this.results.delete(id);
    }
  }
}
