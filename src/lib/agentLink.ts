import { useSyncExternalStore } from "react";
import type { AgentTool } from "../agent/catalog";
import { hubCandidates, isLocalPage, normalizePublicHub } from "../agent/hubEndpoint";
import { decideToolAction, normalizeAgentPolicy, type AgentPolicy, type AgentRisk, type PolicyChoice } from "../agent/policy";
import type { AgentCallResult, AuditEntry } from "../agent/types";
import { appendAudit, readAgentToken, readAudit, readBrowserId, readBrowserSecret, readSavedHub, readStoredPolicy, writeAgentToken, writeBrowserSecret, writeSavedHub, writeStoredPolicy } from "./agentLocal";
import { createId, nowIso } from "./id";
import { hubRevokesPerBrowser, pairFirstError, parseRevokeOutcome, remoteRevokeResult, revokeNotice, revokePlan, type RemoteRevokeResult, type RevokeScope } from "./agentDesk";
import { agentCloudLabels } from "./labels";
import { AGENT_DESK_TEXT } from "./labels/agents";
import { loadOnce } from "./loadOnce";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";

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
  /** Connettore remoto: con «Consenti» si crea il permesso sul cloud dell'account. */
  cloud?: boolean;
  /** Nome dell'account scritto nell'indirizzo del connettore remoto. */
  accountName?: string;
}

export interface AgentLinkSnapshot {
  hub: "unknown" | "up" | "down";
  /** Connettore remoto attivo sull'hub (`cloud` di /health); "unknown" prima della risposta. */
  remote: "unknown" | "on" | "off";
  /** La persona ha provato a collegare il browser in questa sessione: solo dopo l'hub giù è un errore. */
  attempted: boolean;
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
  remote: "unknown",
  attempted: false,
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
    && next.remote === snapshot.remote
    && next.attempted === snapshot.attempted
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
/** Versione dell'hub letta da /health: dice se sa revocare per browser. "" = non ancora letta. */
let hubVersion = "";

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

/**
 * Come l'hub riconosce questo browser: id stabile e nome del profilo, con cui in chat si sceglie
 * l'account. A vault chiuso il nome non si conosce e non si manda: l'hub tiene l'ultimo ricevuto.
 */
const browserInfo = () => {
  const id = readBrowserId();
  if (vaultClosed()) return { id };
  return { id, name: selectPreferences(useStudyStore.getState()).displayName.trim() };
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

// Condividere (alwaysAsk) chiede sempre conferma, anche con «Consenti» o in sessione fidata.
const policyFor = (tool: AgentTool) => decideToolAction(readStoredPolicy(), tool);

// Catalogo ed esecutore degli strumenti si caricano alla prima richiesta di un agente, non all'avvio:
// chi non collega agenti non li scarica. Un caricamento fallito non resta in memoria (si riprova
// alla richiesta dopo) e diventa un errore per l'agente, mai una pagina vuota.
type AgentTools = {
  findAgentTool: typeof import("../agent/catalog").findAgentTool;
  describeAgentCall: typeof import("../agent/execute").describeAgentCall;
  executeAgentTool: typeof import("../agent/execute").executeAgentTool;
};
const loadAgentTools = loadOnce<AgentTools>(() =>
  Promise.all([import("../agent/catalog"), import("../agent/execute")]).then(([catalog, execute]) => ({
    findAgentTool: catalog.findAgentTool,
    describeAgentCall: execute.describeAgentCall,
    executeAgentTool: execute.executeAgentTool
  }))
);

const TOOLS_UNAVAILABLE = "StudyOS non è riuscito a caricare gli strumenti per gli agenti (rete assente o app aggiornata): ricarica la pagina e riprova.";

const handleCall = async (job: { id: string; name: string; args: Record<string, unknown>; actorName: string }) => {
  let tools: AgentTools;
  try {
    tools = await loadAgentTools();
  } catch {
    // Strumenti non caricati: né rischio né decisione (non c'è stata), solo l'esito.
    record({ tool: job.name, status: "failed", summary: job.name, actor: job.actorName });
    await deliver(job.id, { ok: false, code: "failed", error: TOOLS_UNAVAILABLE });
    return;
  }
  const { findAgentTool, describeAgentCall, executeAgentTool } = tools;
  const tool = findAgentTool(job.name);
  const summary = await describeAgentCall(job.name, job.args);
  // Il registro resta sul dispositivo (localStorage, anche col vault): senza titoli e nomi di altre persone.
  const auditSummary = await describeAgentCall(job.name, job.args, { audit: true });
  const finish = async (result: AgentCallResult, decision: PolicyChoice) => {
    record({ tool: job.name, risk: tool?.risk ?? "write", decision, status: outcome(result), summary: auditSummary, actor: job.actorName });
    await deliver(job.id, result);
  };
  if (!tool) {
    await finish({ ok: false, code: "denied", error: "Strumento non riconosciuto da questa versione di StudyOS." }, "deny");
    return;
  }
  // Vault chiuso: l'esecuzione risponde «bloccato» senza toccare i dati e senza dialogo.
  if (vaultClosed()) {
    await finish(await executeAgentTool(job.name, job.args), policyFor(tool));
    return;
  }
  const decision = policyFor(tool);
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
  // Connettore remoto: il permesso sul cloud nasce qui, con l'accesso fatto all'account. Senza,
  // la richiesta si rifiuta subito e ChatGPT lo dice, invece di aspettare.
  let cloud: { secret: string; timeZone: string } | undefined;
  let cloudError = "";
  if (choice.approve && job.cloud) {
    try {
      const { createAgentGrant } = await import("./agentCloud");
      cloud = await createAgentGrant(job.clientName);
    } catch (error) {
      cloudError = error instanceof Error ? error.message : agentCloudLabels.failed;
    }
  }
  const approve = choice.approve && !cloudError;
  try {
    // `secret`: l'hub lega la concessione a questo browser, così la sua revoca toglie solo le sue.
    const secret = approve ? await ensureBrowserSecret() : "";
    await postJson("/oauth/decide", {
      token: readAgentToken(),
      requestId: job.requestId,
      approve,
      scopes: approve ? choice.scopes : [],
      ...(secret ? { secret } : {}),
      ...(cloud ? { cloud } : {})
    });
    if (cloudError) refresh({ error: cloudError });
    else if (!approve) refresh({ notice: `Accesso rifiutato a ${job.clientName}.` });
    else refresh({ notice: cloud ? agentCloudLabels.approved(job.clientName) : `${job.clientName} può usare StudyOS. Ogni modifica resta da confermare, salvo la policy.` });
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
    await postJson("/bridge/heartbeat", { token, browser: browserInfo() });
    if (snapshot.hub !== "up") refresh({ hub: "up" });
  } catch {
    // il giro di poll riporta l'errore
  }
};

const checkHealth = async () => {
  const origins = endpoints();
  if (!origins.length) {
    // Senza browser collegato non è un errore: lo diventa quando la persona prova a collegarsi.
    refresh({ hub: "down", ...(readAgentToken() ? { error: offlineCopy() } : {}) });
    return;
  }
  for (const origin of origins) {
    try {
      const response = await fetch(`${origin}/health`, { headers: { accept: "application/json" } });
      if (!response.ok) continue;
      const raw = await response.json().catch(() => ({}));
      if (isRecord(raw)) rememberPublicOrigin(raw);
      activeHub = origin;
      hubVersion = isRecord(raw) && typeof raw.version === "string" ? raw.version : "";
      const cloud = isRecord(raw) ? raw.cloud : undefined;
      refresh({ hub: "up", remote: cloud === true ? "on" : cloud === false ? "off" : "unknown" });
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
      const job = await postJson("/bridge/poll", { token, browser: browserInfo() }, pollAbort.signal);
      if (mine !== generation) return;
      refresh({ hub: "up", error: snapshot.error.startsWith("Il programma") ? "" : snapshot.error });
      if (!isRecord(job) || job.type === "idle") continue;
      if (job.type === "consent" && typeof job.requestId === "string") {
        void handleConsent({
          requestId: job.requestId,
          clientName: typeof job.clientName === "string" && job.clientName.trim() ? job.clientName : "Agente",
          scopes: Array.isArray(job.scopes) ? job.scopes.filter((item): item is string => typeof item === "string") : [],
          redirectHost: typeof job.redirectHost === "string" ? job.redirectHost : "",
          ...(job.cloud === true ? { cloud: true, accountName: typeof job.accountName === "string" ? job.accountName : "" } : {})
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
  // Un browser collegato prima dei segreti riceve il suo qui, senza ricollegarsi.
  void checkHealth().then(() => ensureBrowserSecret());
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
  refresh({ attempted: true });
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
    // Un browser che ha già il suo segreto lo tiene: i consensi approvati prima restano revocabili da qui.
    if (!readBrowserSecret() && typeof data.secret === "string") writeBrowserSecret(data.secret);
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
  const token = readAgentToken();
  // L'hub toglie subito questo browser dagli account scelti in chat; se non risponde lo dimentica dopo 30 giorni.
  if (token) void postJson("/bridge/forget", { token, browser: { id: readBrowserId() } }).catch(() => undefined);
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

/**
 * Permessi cloud dei connettori remoti di questo account (serve l'accesso fatto). `failed`: il cloud
 * non ha risposto, i permessi possono essere ancora attivi; mai da leggere come «niente da togliere».
 */
const revokeCloudGrants = async (): Promise<{ count: number; failed: boolean }> => {
  try {
    const { revokeAgentGrants } = await import("./agentCloud");
    return { count: await revokeAgentGrants(), failed: false };
  } catch {
    return { count: 0, failed: true };
  }
};

/**
 * Segreto di questo browser per approvare e revocare i consensi. Chi è collegato da prima lo chiede
 * all'hub con il token del ponte (/bridge/secret). "" = hub di prima o irraggiungibile.
 */
const ensureBrowserSecret = async () => {
  const saved = readBrowserSecret();
  if (saved) return saved;
  const token = readAgentToken();
  if (!token) return "";
  try {
    const data = await postJson("/bridge/secret", { token });
    if (typeof data.secret === "string") writeBrowserSecret(data.secret);
  } catch {
    // hub di prima della 1.6.0 o non raggiungibile: si riprova alla prossima richiesta
  }
  return readBrowserSecret();
};

/**
 * «Revoca gli accessi di questo browser» ("browser"): l'hub toglie solo le concessioni approvate con
 * il segreto di questo browser. "all" = «Scollega gli assistenti di tutti», dopo una conferma.
 * In entrambi i casi si revocano anche i permessi remoti di questo account nel cloud.
 * Restituisce l'errore da mostrare, null se riuscita.
 */
export const revokeAgentAccess = async (scope: Exclude<RevokeScope, "cloud"> = "browser"): Promise<string | null> => {
  const token = readAgentToken();
  if (!token) {
    const cloud = await revokeCloudGrants();
    if (cloud.count) {
      refresh({ error: "", notice: AGENT_DESK_TEXT.remote.revoked });
      return null;
    }
    const error = cloud.failed ? AGENT_DESK_TEXT.remote.failed : pairFirstError(localProgram());
    refresh({ error, notice: "" });
    return error;
  }
  try {
    const plan = revokePlan({ scope, hubVersion, token, secret: scope === "all" ? "" : await ensureBrowserSecret() });
    if (plan.kind !== "send") {
      // confirmAll: l'app chiede prima checkScopedRevoke, quindi qui arriva solo con l'hub giù o cambiato.
      const error = plan.kind === "confirmAll"
        ? (snapshot.hub === "down" ? offlineCopy() : AGENT_DESK_TEXT.oldHubAllOnly)
        : AGENT_DESK_TEXT.noSecret;
      refresh({ error, notice: "" });
      return error;
    }
    const data = await postJson("/oauth/revoke", plan.body);
    const cloud = await revokeCloudGrants();
    // L'hub ha tolto i suoi; se il cloud non ha risposto lo si dice, senza contarlo come «niente».
    refresh({ error: cloud.failed ? AGENT_DESK_TEXT.remote.failed : "", notice: revokeNotice(parseRevokeOutcome(data, scope), cloud.count) });
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Revoca non riuscita.";
    refresh({ error: message, notice: "" });
    return message;
  }
};

/**
 * Prima di «Revoca gli accessi di questo browser»: rilegge /health. "allOnly" = hub di prima della
 * 1.6.0 o senza versione, che a ogni /oauth/revoke scollega tutti: l'app apre la conferma per tutti.
 */
export const checkScopedRevoke = async (): Promise<"scoped" | "allOnly" | "down"> => {
  await checkHealth();
  if (snapshot.hub !== "up") return "down";
  return hubRevokesPerBrowser(hubVersion) ? "scoped" : "allOnly";
};

/**
 * «Scollega il connettore remoto»: i permessi remoti di questo account nel cloud e, con il browser
 * collegato, i token remoti dell'hub approvati da questo browser. Il connettore principale resta.
 * L'esito lo mostra il riquadro del connettore remoto, con «Riprova» se non è riuscita.
 */
export const revokeRemoteConnector = async (): Promise<RemoteRevokeResult> => {
  const token = readAgentToken();
  let hubRevoked = 0;
  let hubFailed = false;
  // Un hub di prima della 1.6.0 scollegherebbe tutti: lì basta il permesso tolto nel cloud.
  const plan = token ? revokePlan({ scope: "cloud", hubVersion, token, secret: await ensureBrowserSecret() }) : null;
  if (plan?.kind === "send") {
    try {
      const data = await postJson("/oauth/revoke", plan.body);
      hubRevoked = parseRevokeOutcome(data, "cloud").revoked;
    } catch {
      hubFailed = true;
    }
  }
  const cloud = await revokeCloudGrants();
  return remoteRevokeResult({ hubRevoked, cloudRevoked: cloud.count, hubFailed, cloudFailed: cloud.failed });
};
