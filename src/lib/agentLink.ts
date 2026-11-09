import { useSyncExternalStore } from "react";
import { findAgentTool } from "../agent/catalog";
import { describeAgentCall, executeAgentTool } from "../agent/execute";
import { hubCandidates, isLocalPage, normalizePublicHub } from "../agent/hubEndpoint";
import { decideAgentAction, normalizeAgentPolicy, type AgentPolicy, type AgentRisk, type PolicyChoice } from "../agent/policy";
import type { AgentCallResult, AuditEntry } from "../agent/types";
import { appendAudit, readAgentToken, readAudit, readSavedHub, readStoredPolicy, writeAgentToken, writeSavedHub, writeStoredPolicy } from "./agentLocal";
import { createId, nowIso } from "./id";
import { useStudyStore } from "../store/useStudyStore";

export interface PendingAgentCall {
  id: string;
  name: string;
  title: string;
  args: Record<string, unknown>;
  actorName: string;
  summary: string;
  risk: AgentRisk;
}

export interface PendingAgentConsent {
  requestId: string;
  clientName: string;
  scopes: string[];
  redirectHost: string;
}

export interface AgentLinkSnapshot {
  hub: "unknown" | "up" | "down";
  paired: boolean;
  error: string;
  notice: string;
  pendingCall: PendingAgentCall | null;
  /** Altre azioni in coda dietro a quella mostrata. */
  queuedCalls: number;
  pendingConsent: PendingAgentConsent | null;
  policy: AgentPolicy;
  audit: AuditEntry[];
}

type ConsentChoice = { approve: boolean; scopes: string[] };
type CallChoice = "approve" | "deny" | "locked" | "expired";

/** Una conferma lasciata a metà non vale per sempre: dopo 30 minuti l'agente non la aspetta più. */
const APPROVAL_TTL_MS = 30 * 60_000;

const listeners = new Set<() => void>();
let generation = 0;
let pollAbort: AbortController | null = null;
// Code di conferma: il giro di poll continua, così le letture non aspettano la decisione su una modifica.
const callQueue: Array<{ call: PendingAgentCall; decide: (choice: CallChoice) => void }> = [];
const consentQueue: Array<{ job: PendingAgentConsent; decide: (choice: ConsentChoice) => void }> = [];
// Le azioni girano una alla volta, nell'ordine in cui la persona le approva.
let running: Promise<unknown> = Promise.resolve();

const serial = <T>(task: () => Promise<T>): Promise<T> => {
  const next = running.then(task, task);
  running = next.catch(() => undefined);
  return next;
};

const storedSlice = () => ({
  paired: Boolean(readAgentToken()),
  policy: readStoredPolicy(),
  audit: readAudit(30)
});

let snapshot: AgentLinkSnapshot = {
  hub: "unknown",
  error: "",
  notice: "",
  pendingCall: null,
  queuedCalls: 0,
  pendingConsent: null,
  ...storedSlice()
};

const refresh = (patch: Partial<AgentLinkSnapshot> = {}) => {
  const next = { ...snapshot, ...patch, ...storedSlice() };
  const same = next.hub === snapshot.hub
    && next.paired === snapshot.paired
    && next.error === snapshot.error
    && next.notice === snapshot.notice
    && next.pendingCall === snapshot.pendingCall
    && next.queuedCalls === snapshot.queuedCalls
    && next.pendingConsent === snapshot.pendingConsent
    && JSON.stringify(next.policy) === JSON.stringify(snapshot.policy)
    && JSON.stringify(next.audit) === JSON.stringify(snapshot.audit);
  if (same) return;
  snapshot = next;
  for (const listener of listeners) listener();
};

export const subscribeAgentLink = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getAgentLinkSnapshot = () => snapshot;

export const useAgentLink = () => useSyncExternalStore(subscribeAgentLink, getAgentLinkSnapshot, getAgentLinkSnapshot);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const configuredHub = () => {
  const value = import.meta.env.VITE_AGENT_HUB_ORIGIN;
  return typeof value === "string" ? value : "";
};

const pageOrigin = () => {
  try {
    return window.location.origin;
  } catch {
    return "http://127.0.0.1:5173";
  }
};

const candidateList = () => hubCandidates(pageOrigin(), readSavedHub(), configuredHub());

let activeHub = "";

const localProgram = () => isLocalPage(pageOrigin());

const offlineCopy = () => localProgram()
  ? "Il programma agenti non risponde. Nella cartella di StudyOS avvia npm run agent."
  : "Il collegamento agenti non risponde. Ricarica StudyOS: ChatGPT parla con questo sito, anche dal telefono, senza il programma sul computer.";

const rememberPublicOrigin = (data: Record<string, unknown>) => {
  const advertised = typeof data.publicOrigin === "string" ? normalizePublicHub(data.publicOrigin) : null;
  if (advertised) writeSavedHub(advertised);
};

const endpoints = () => {
  const list = candidateList();
  if (activeHub && list.includes(activeHub)) return [...new Set([activeHub, ...list])];
  return list;
};

const postJson = async (path: string, body: unknown, signal?: AbortSignal) => {
  const origins = endpoints();
  if (!origins.length) throw new Error(offlineCopy());
  let last: Error | null = null;
  for (const origin of origins) {
    try {
      const response = await fetch(`${origin}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        signal
      });
      const raw = await response.json().catch(() => ({}));
      const data = isRecord(raw) ? raw : {};
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Il programma agenti non ha accettato la richiesta.");
      }
      activeHub = origin;
      return data;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      if (!(error instanceof TypeError)) throw error;
      last = error;
    }
  }
  throw last ?? new Error("Il programma agenti non risponde.");
};

const record = (entry: Omit<AuditEntry, "id" | "at">) => {
  appendAudit({ ...entry, id: createId("audit"), at: nowIso() });
  refresh();
};

const outcome = (result: AgentCallResult): AuditEntry["status"] => {
  if (result.ok) return "executed";
  return result.code === "denied" ? "denied" : "failed";
};

const deliver = async (id: string, result: AgentCallResult) => {
  const token = readAgentToken();
  if (!token) return;
  try {
    await postJson("/bridge/result", { token, id, result });
  } catch {
    await sleep(400);
    await postJson("/bridge/result", { token: readAgentToken(), id, result });
  }
};

const showQueues = (patch: Partial<AgentLinkSnapshot> = {}) => refresh({
  pendingCall: callQueue[0]?.call ?? null,
  queuedCalls: Math.max(0, callQueue.length - 1),
  pendingConsent: consentQueue[0]?.job ?? null,
  ...patch
});

const vaultClosed = () => {
  const current = useStudyStore.getState();
  return current.loading || current.locked;
};

const askPerson = (call: PendingAgentCall) => new Promise<CallChoice>((resolve) => {
  let finished = false;
  const entry = { call, decide: (choice: CallChoice) => finish(choice) };
  const watch = window.setInterval(() => {
    if (vaultClosed()) finish("locked");
  }, 400);
  const expiry = window.setTimeout(() => finish("expired"), APPROVAL_TTL_MS);
  function finish(choice: CallChoice) {
    if (finished) return;
    finished = true;
    window.clearInterval(watch);
    window.clearTimeout(expiry);
    const index = callQueue.indexOf(entry);
    if (index >= 0) callQueue.splice(index, 1);
    showQueues();
    resolve(choice);
  }
  callQueue.push(entry);
  showQueues({ notice: "" });
});

const policyFor = (risk: AgentRisk) => decideAgentAction(readStoredPolicy(), risk);

const handleCall = async (job: { id: string; name: string; args: Record<string, unknown>; actorName: string }) => {
  const tool = findAgentTool(job.name);
  const summary = describeAgentCall(job.name, job.args);
  const finish = async (result: AgentCallResult, decision: PolicyChoice) => {
    record({ tool: job.name, risk: tool?.risk ?? "write", decision, status: outcome(result), summary, actor: job.actorName });
    await deliver(job.id, result);
  };
  if (!tool) {
    await finish({ ok: false, code: "denied", error: "Strumento non riconosciuto da questa versione di StudyOS." }, "deny");
    return;
  }
  // Vault chiuso: l'esecuzione risponde «bloccato» senza toccare i dati e senza dialogo.
  if (vaultClosed()) {
    await finish(await executeAgentTool(job.name, job.args), policyFor(tool.risk));
    return;
  }
  const decision = policyFor(tool.risk);
  if (decision === "deny") {
    await finish({ ok: false, code: "denied", error: "Bloccato dalla policy di StudyOS. Puoi cambiarla in Impostazioni → Agenti." }, "deny");
    return;
  }
  if (decision === "ask") {
    const choice = await askPerson({ id: job.id, name: job.name, title: tool.title, args: job.args, actorName: job.actorName, summary, risk: tool.risk });
    if (choice === "deny") {
      await finish({ ok: false, code: "denied", error: "Rifiutato in StudyOS." }, "ask");
      return;
    }
    if (choice === "expired") {
      await finish({ ok: false, code: "denied", error: "Nessuna conferma in StudyOS entro 30 minuti: l'azione non è stata eseguita." }, "ask");
      return;
    }
  }
  const result = await serial(() => executeAgentTool(job.name, job.args));
  await finish(result, decision);
};

const handleConsent = async (job: PendingAgentConsent) => {
  const choice = await new Promise<ConsentChoice>((resolve) => {
    const entry = {
      job,
      decide: (value: ConsentChoice) => {
        const index = consentQueue.indexOf(entry);
        if (index < 0) return;
        consentQueue.splice(index, 1);
        showQueues();
        resolve(value);
      }
    };
    consentQueue.push(entry);
    showQueues({ notice: "" });
  });
  if (!readAgentToken()) return;
  try {
    await postJson("/oauth/decide", {
      token: readAgentToken(),
      requestId: job.requestId,
      approve: choice.approve,
      scopes: choice.scopes
    });
    refresh({ notice: choice.approve ? `${job.clientName} può usare StudyOS. Ogni modifica resta da confermare, salvo la policy.` : `Accesso rifiutato a ${job.clientName}.` });
  } catch (error) {
    refresh({ error: error instanceof Error ? error.message : "Conferma non inviata." });
  }
};

const dropQueues = () => {
  for (const entry of [...callQueue]) entry.decide("deny");
  for (const entry of [...consentQueue]) entry.decide({ approve: false, scopes: [] });
};

const heartbeat = async () => {
  const token = readAgentToken();
  if (!token || generation === 0) return;
  try {
    await postJson("/bridge/heartbeat", { token });
    if (snapshot.hub !== "up") refresh({ hub: "up" });
  } catch {
    // il giro di poll riporta l'errore
  }
};

const checkHealth = async () => {
  const origins = endpoints();
  if (!origins.length) {
    refresh({ hub: "down", error: offlineCopy() });
    return;
  }
  for (const origin of origins) {
    try {
      const response = await fetch(`${origin}/health`, { headers: { accept: "application/json" } });
      if (!response.ok) continue;
      const raw = await response.json().catch(() => ({}));
      if (isRecord(raw)) rememberPublicOrigin(raw);
      activeHub = origin;
      refresh({ hub: "up" });
      return;
    } catch {
      // prova il candidato successivo: sul sito pubblicato il tunnel è il ripiego
    }
  }
  refresh({ hub: "down" });
};

const loop = async (mine: number) => {
  while (mine === generation) {
    const token = readAgentToken();
    if (!token) {
      await checkHealth();
      await sleep(4000);
      continue;
    }
    pollAbort = new AbortController();
    try {
      const job = await postJson("/bridge/poll", { token }, pollAbort.signal);
      if (mine !== generation) return;
      refresh({ hub: "up", error: snapshot.error.startsWith("Il programma") ? "" : snapshot.error });
      if (!isRecord(job) || job.type === "idle") continue;
      if (job.type === "consent" && typeof job.requestId === "string") {
        void handleConsent({
          requestId: job.requestId,
          clientName: typeof job.clientName === "string" && job.clientName.trim() ? job.clientName : "Agente",
          scopes: Array.isArray(job.scopes) ? job.scopes.filter((item): item is string => typeof item === "string") : [],
          redirectHost: typeof job.redirectHost === "string" ? job.redirectHost : ""
        });
        continue;
      }
      if (job.type === "call" && typeof job.id === "string" && typeof job.name === "string" && isRecord(job.args)) {
        const actor = isRecord(job.actor) && typeof job.actor.name === "string" ? job.actor.name : "Agente";
        void handleCall({ id: job.id, name: job.name, args: job.args, actorName: actor }).catch(() => undefined);
      }
    } catch (error) {
      if (mine !== generation) return;
      if (error instanceof DOMException && error.name === "AbortError") return;
      const message = error instanceof Error ? error.message : "Programma agenti non raggiungibile.";
      if (message.includes("non riconosciuto")) {
        writeAgentToken(null);
        refresh({ hub: "up", error: localProgram()
          ? "Il collegamento non vale più. In StudyOS inserisci il codice nuovo di npm run agent."
          : "Il collegamento non vale più. In Impostazioni → Agenti incolla di nuovo la chiave." });
      } else {
        refresh({ hub: "down", error: offlineCopy() });
        await sleep(2000);
      }
    } finally {
      pollAbort = null;
    }
  }
};

/** Parte con l'app, anche a vault bloccato: in quel caso le azioni vengono rifiutate senza dialogo. */
export const startAgentLink = () => {
  const mine = ++generation;
  const heart = window.setInterval(() => void heartbeat(), 15_000);
  void checkHealth();
  void loop(mine);
  return () => {
    if (generation === mine) generation += 1;
    window.clearInterval(heart);
    pollAbort?.abort();
    dropQueues();
  };
};

export const saveAgentHubAddress = (value: string) => {
  const normalized = normalizePublicHub(value);
  if (!normalized) {
    refresh({ error: "Incolla l'indirizzo https del tunnel, per esempio https://nome.trycloudflare.com." });
    return;
  }
  writeSavedHub(normalized);
  refresh({ error: "", notice: "Indirizzo salvato. Verrà usato se il programma locale non risponde da questo sito." });
  void checkHealth();
};

export const pairAgent = async (code: string) => {
  const local = localProgram();
  const normalized = local ? code.toUpperCase().replace(/[^A-Z0-9]/g, "") : code.trim();
  if (local && normalized.length !== 8) {
    refresh({ error: "Il codice ha 8 caratteri, nel formato ABCD-EFGH." });
    throw new Error("Codice incompleto.");
  }
  if (!local && (normalized.length < 20 || /\s/.test(normalized))) {
    refresh({ error: "Incolla la chiave di collegamento per intero, senza spazi." });
    throw new Error("Chiave incompleta.");
  }
  try {
    const data = await postJson("/pair", { code: normalized });
    if (typeof data.token !== "string" || data.token.length < 20) throw new Error("Risposta di collegamento incompleta.");
    writeAgentToken(data.token);
    refresh({
      hub: "up",
      error: "",
      notice: localProgram()
        ? "Questo browser è collegato. Le azioni degli agenti compariranno qui."
        : "Questo browser è collegato al sito pubblicato. Tienilo aperto, anche dal telefono, mentre usi ChatGPT."
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Collegamento non riuscito.";
    refresh({ error: message === "Codice incompleto." || message === "Chiave incompleta." ? snapshot.error : message });
    throw error;
  }
};

export const disconnectAgent = () => {
  writeAgentToken(null);
  dropQueues();
  refresh({
    error: "",
    notice: localProgram()
      ? "Browser scollegato. Gli agenti non possono più leggere questo studio finché non inserisci un codice nuovo."
      : "Browser scollegato. Gli agenti non possono più leggere questo studio finché non incolli di nuovo la chiave."
  });
};

export const setAgentPolicyChoice = (risk: AgentRisk, choice: PolicyChoice) => {
  writeStoredPolicy(normalizeAgentPolicy({ ...readStoredPolicy(), [risk]: choice }));
  refresh({ notice: "" });
};

export const allowWritesFor15Minutes = () => {
  writeStoredPolicy(normalizeAgentPolicy({
    ...readStoredPolicy(),
    trustedWritesUntil: new Date(Date.now() + 15 * 60_000).toISOString()
  }));
  refresh({ notice: "Per 15 minuti le modifiche non chiedono conferma. Le eliminazioni sì." });
};

export const clearTrustedWrites = () => {
  writeStoredPolicy(normalizeAgentPolicy({ ...readStoredPolicy(), trustedWritesUntil: null }));
  refresh({ notice: "Le modifiche tornano a chiedere conferma." });
};

export const approvePendingCall = () => callQueue[0]?.decide("approve");
export const denyPendingCall = () => callQueue[0]?.decide("deny");

export const decideAgentConsent = (approve: boolean, scopes: string[]) => {
  const granted = approve ? ["studyos:read", ...scopes.filter((scope) => scope === "studyos:write")] : [];
  consentQueue[0]?.decide({ approve, scopes: granted });
};

export const revokeAgentAccess = async () => {
  const token = readAgentToken();
  if (!token) {
    refresh({ error: "Collega prima questo browser con il codice del terminale." });
    return;
  }
  try {
    await postJson("/oauth/revoke", { token });
    refresh({ error: "", notice: "Accessi di ChatGPT e degli altri agenti revocati. Questo browser resta collegato." });
  } catch (error) {
    refresh({ error: error instanceof Error ? error.message : "Revoca non riuscita." });
  }
};
