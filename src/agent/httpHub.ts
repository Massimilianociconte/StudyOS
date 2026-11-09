// Ponte HTTP di StudyOS. Lo stesso codice gira sul programma locale e sull'hub pubblico.
// Non legge IndexedDB: consegna le azioni al browser collegato e conserva solo token (in hash) e esiti.
import { AGENT_MCP_PATH, AGENT_PROTOCOL_VERSIONS, AGENT_SERVER_VERSION } from "./constants";
import { toolSummary } from "./catalog";
import { choosePoller, siteFromOrigin, type BridgeSite } from "./hubEndpoint";
import { ResultLedger } from "./ledger";
import { handleMcpRpc } from "./mcp";
import { OauthServer, randomToken, timingSafeEqual, type PersistedOauth } from "./oauth";
import type { AgentActor, AgentCallResult } from "./types";

const BODY_LIMIT = 262_144;
const PUBLISHED_FRESH_MS = 45_000;
/** Un'azione che il browser non ha ritirato entro questo tempo non parte più: niente esecuzioni a sorpresa ore dopo. */
const STALE_CALL_MS = 120_000;

const isPendingResult = (result: AgentCallResult | undefined) => Boolean(result?.ok && result.data.status === "pending_approval");

const rpcId = (message: unknown) => {
  if (!message || typeof message !== "object" || !("id" in message)) return null;
  return (message as { id?: unknown }).id ?? null;
};

const metaProtocolVersion = (message: unknown) => {
  if (!message || typeof message !== "object") return null;
  const params = (message as { params?: unknown }).params;
  if (!params || typeof params !== "object") return null;
  const meta = (params as { _meta?: unknown })._meta;
  if (!meta || typeof meta !== "object") return null;
  const value = (meta as Record<string, unknown>)["io.modelcontextprotocol/protocolVersion"];
  return typeof value === "string" ? value : null;
};

const bodyMethod = (message: unknown) => {
  if (!message || typeof message !== "object") return null;
  const method = (message as { method?: unknown }).method;
  return typeof method === "string" ? method : null;
};

/** Valore che Mcp-Name deve riportare: params.name (tools/call, prompts/get) o params.uri (resources/read). */
const bodyName = (message: unknown) => {
  if (!message || typeof message !== "object") return null;
  const params = (message as { params?: unknown }).params;
  if (!params || typeof params !== "object") return null;
  const { name, uri } = params as { name?: unknown; uri?: unknown };
  if (typeof name === "string") return name;
  return typeof uri === "string" ? uri : null;
};

/** Le intestazioni MCP con caratteri non ASCII arrivano come =?base64?…?= */
const decodeHeaderValue = (value: string) => {
  const match = /^=\?base64\?([A-Za-z0-9+/=]*)\?=$/.exec(value);
  if (!match) return value;
  try {
    return new TextDecoder().decode(Uint8Array.from(atob(match[1]), (char) => char.charCodeAt(0)));
  } catch {
    return null;
  }
};

const protocolVersion = (request: Request, message: unknown) => request.headers.get("mcp-protocol-version") ?? metaProtocolVersion(message);

/** null = la richiesta può proseguire. Le versioni 2026 rifiutano header e versioni incoerenti prima del metodo. */
const protocolStatus = (request: Request, message: unknown): { status: number; body: Record<string, unknown> } | null => {
  const headerVersion = request.headers.get("mcp-protocol-version");
  const fromMeta = metaProtocolVersion(message);
  const id = rpcId(message);
  const error = (status: number, code: number, messageText: string, data?: unknown) => ({
    status,
    body: {
      jsonrpc: "2.0",
      id,
      error: data === undefined ? { code, message: messageText } : { code, message: messageText, data }
    }
  });
  if (headerVersion && fromMeta && headerVersion !== fromMeta) {
    return error(400, -32020, "MCP-Protocol-Version non coincide con il corpo della richiesta.");
  }
  const headerMethod = request.headers.get("mcp-method");
  const method = bodyMethod(message);
  if (headerMethod && method && headerMethod !== method) {
    return error(400, -32020, "Mcp-Method non coincide con il metodo JSON-RPC.");
  }
  const headerName = request.headers.get("mcp-name");
  const name = bodyName(message);
  if (headerName && name !== null && decodeHeaderValue(headerName) !== name) {
    return error(400, -32020, "Mcp-Name non coincide con il nome nel corpo della richiesta.");
  }
  const version = headerVersion ?? fromMeta;
  if (version && !(AGENT_PROTOCOL_VERSIONS as readonly string[]).includes(version)) {
    return error(400, -32022, "Unsupported protocol version", { supported: [...AGENT_PROTOCOL_VERSIONS], requested: version });
  }
  return null;
};

export interface HubSnapshot {
  issuer: string;
  bridgeToken: string;
  serviceToken: string;
  oauth: PersistedOauth;
  ledger: Array<{ id: string; at: number; result: AgentCallResult }>;
  pairFailures: number;
  pairLockedUntil: number;
}

export interface HttpHubOptions {
  issuer: string;
  canonical: string;
  secureCookies: boolean;
  allowHost: (host: string) => boolean;
  allowOrigin: (origin: string | undefined, mcp: boolean) => boolean;
  /** `code`: codice da terminale, un solo uso. `key`: chiave stabile dell'hub pubblico. */
  pairMode: "code" | "key";
  pairKey?: string;
  disconnectedHint: string;
  now?: () => number;
  approvalWaitMs?: number;
  pollWaitMs?: number;
  /** Quanto studyos_approval_status aspetta una conferma ancora aperta prima di rispondere. */
  approvalPollMs?: number;
  persist?: () => Promise<void>;
}

interface CallJob {
  type: "call";
  id: string;
  name: string;
  args: Record<string, unknown>;
  actor: AgentActor;
  summary: string;
  queuedAt: number;
}

interface ConsentJob {
  type: "consent";
  requestId: string;
  clientName: string;
  scopes: string[];
  redirectHost: string;
}

type Job = CallJob | ConsentJob;

interface Waiter {
  site: BridgeSite;
  active: boolean;
  resolve: (job: Job | null) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const emptyOauth = (): PersistedOauth => ({ clients: [], access: [], refresh: [] });

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);

export class HttpHub {
  readonly oauth: OauthServer;
  readonly ledger = new ResultLedger();
  bridgeToken: string;
  serviceToken: string;
  private readonly options: HttpHubOptions;
  private readonly now: () => number;
  private readonly approvalWaitMs: number;
  private readonly pollWaitMs: number;
  private readonly approvalPollMs: number;
  private pairCode = "";
  private pairExpires = 0;
  private pairFailures = 0;
  private pairLockedUntil = 0;
  private readonly calls: CallJob[] = [];
  private readonly consents: ConsentJob[] = [];
  private readonly finishers = new Map<string, (result: AgentCallResult) => void>();
  /** Azioni non ancora concluse dal browser, anche dopo che l'agente ha ricevuto pending_approval. */
  private readonly open = new Set<string>();
  private readonly watchers = new Map<string, Set<(result: AgentCallResult) => void>>();
  private readonly waiters: Waiter[] = [];
  private lastSeen = 0;
  private publishedSeen = 0;
  private gate: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(options: HttpHubOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    // Sotto i 60 s: è il timeout predefinito dell'SDK MCP TypeScript (Claude Desktop, Cursor) e di Codex.
    this.approvalWaitMs = options.approvalWaitMs ?? 45_000;
    this.pollWaitMs = options.pollWaitMs ?? 20_000;
    this.approvalPollMs = options.approvalPollMs ?? 40_000;
    this.oauth = new OauthServer(options.canonical, this.now);
    this.bridgeToken = randomToken(32);
    this.serviceToken = randomToken(32);
  }

  exportState(): HubSnapshot {
    return {
      issuer: this.options.issuer,
      bridgeToken: this.bridgeToken,
      serviceToken: this.serviceToken,
      oauth: this.oauth.dump(),
      ledger: this.ledger.exportState(this.now()),
      pairFailures: this.pairFailures,
      pairLockedUntil: this.pairLockedUntil
    };
  }

  importState(state: HubSnapshot) {
    if (state.bridgeToken && state.serviceToken) {
      this.bridgeToken = state.bridgeToken;
      this.serviceToken = state.serviceToken;
    }
    this.oauth.load(state.oauth ?? emptyOauth());
    this.ledger.importState(Array.isArray(state.ledger) ? state.ledger : []);
    this.pairFailures = state.pairFailures || 0;
    this.pairLockedUntil = state.pairLockedUntil || 0;
    this.dirty = false;
  }

  armPairCode(code: string, expiresAt: number) {
    this.pairCode = code;
    this.pairExpires = expiresAt;
  }

  takeDirty() {
    const dirty = this.dirty;
    this.dirty = false;
    return dirty;
  }

  connected() {
    return this.now() - this.lastSeen < PUBLISHED_FRESH_MS;
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const mcp = url.pathname === AGENT_MCP_PATH || url.pathname === "/";
    if (host.toLowerCase() !== url.host.toLowerCase() || !this.options.allowHost(host)) {
      return this.json(421, { error: "Host non ammesso." });
    }
    const origin = request.headers.get("origin") ?? undefined;
    if (origin && !this.options.allowOrigin(origin, mcp)) {
      return this.withCors(request, this.json(403, { error: "Origine non ammessa." }), mcp);
    }
    if (request.method === "OPTIONS") return this.preflight(request, mcp);

    try {
      const response = await this.route(request, url, origin);
      if (mcp) this.traceMcp(request, response);
      return this.withCors(request, response, mcp);
    } catch (error) {
      const payload = error instanceof Error && error.message === "payload";
      return this.withCors(request, this.json(payload ? 413 : 500, { error: payload ? "Richiesta troppo grande." : "Errore interno." }), mcp);
    }
  }

  private async route(request: Request, url: URL, origin: string | undefined): Promise<Response> {
    if (request.method === "GET" && url.pathname === "/health") {
      return this.json(200, {
        ok: true,
        service: "studyos-agent",
        version: AGENT_SERVER_VERSION,
        bridgeConnected: this.connected(),
        publicOrigin: this.options.issuer.startsWith("https://") ? this.options.issuer : null,
        mcp: this.options.canonical
      });
    }
    if (request.method === "GET" && (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp")) {
      // RFC 9728: il documento alla radice descrive la radice, quello con /mcp descrive /mcp.
      return this.json(200, {
        resource: url.pathname.endsWith("/mcp") ? this.options.canonical : this.options.issuer,
        authorization_servers: [this.options.issuer],
        scopes_supported: ["studyos:read", "studyos:write", "offline_access"],
        bearer_methods_supported: ["header"]
      });
    }
    if (request.method === "GET" && (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration")) {
      return this.json(200, this.metadata());
    }
    if (request.method === "POST" && url.pathname === "/register") {
      return this.exclusive(async () => {
        const created = this.oauth.register(JSON.parse(await this.readBody(request) || "{}"));
        if (!created.ok) return this.json(created.status, { error: created.error });
        await this.markDirty();
        return this.json(201, {
          client_id: created.client.clientId,
          client_id_issued_at: Math.floor(Date.parse(created.client.createdAt) / 1000),
          client_name: created.client.clientName,
          redirect_uris: created.client.redirectUris,
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"]
        });
      });
    }
    if (request.method === "GET" && url.pathname === "/authorize") {
      return this.exclusive(async () => {
        const begun = this.oauth.beginAuthorization(url.searchParams);
        if (!begun.ok) return this.html(400, `<!doctype html><meta charset="utf-8"><title>StudyOS</title><p>${escapeHtml(begun.description)}</p>`);
        this.consents.push({ type: "consent", requestId: begun.requestId, clientName: begun.clientName, scopes: begun.scopes, redirectHost: begun.redirectHost });
        this.claim();
        const secure = this.options.secureCookies ? "; Secure" : "";
        return this.html(200, this.authorizePage(begun.clientName), {
          "set-cookie": `studyos_oauth=${encodeURIComponent(begun.requestId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}`
        });
      });
    }
    if (request.method === "GET" && url.pathname === "/oauth/wait") {
      const requestId = this.cookie(request, "studyos_oauth");
      const result = requestId ? this.oauth.resultFor(requestId) : null;
      if (!requestId || !result) return this.json(200, { state: "missing" });
      if (result.state === "ready") {
        return this.json(200, result, { "set-cookie": "studyos_oauth=; HttpOnly; Path=/; Max-Age=0" });
      }
      return this.json(200, { state: "pending", connected: this.connected() });
    }
    if (request.method === "POST" && url.pathname === "/token") {
      return this.exclusive(async () => {
        const form = await this.readForm(request);
        const exchanged = await this.oauth.exchange(form);
        if (!exchanged.ok) return this.json(exchanged.status, { error: exchanged.error });
        await this.markDirty();
        return this.json(200, exchanged.body);
      });
    }
    if (request.method === "POST" && url.pathname === "/revoke") {
      return this.exclusive(async () => {
        const form = await this.readForm(request);
        await this.oauth.revokeToken(form.get("token") ?? "", form.get("client_id") ?? undefined);
        await this.markDirty();
        return this.json(200, {});
      });
    }
    if (request.method === "POST" && url.pathname === "/pair") {
      return this.exclusive(async () => {
        const body = JSON.parse(await this.readBody(request) || "{}") as { code?: string };
        const code = this.options.pairMode === "key"
          ? (body.code ?? "").trim()
          : (body.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
        if (this.now() < this.pairLockedUntil) return this.json(429, { error: "Troppi tentativi. Attendi qualche minuto." });
        if (!this.pairAccepts(code)) {
          this.pairFailures += 1;
          if (this.pairFailures >= 8) this.pairLockedUntil = this.now() + 10 * 60_000;
          await this.markDirty();
          const error = this.options.pairMode === "key"
            ? "Chiave non valida."
            : "Codice non valido o scaduto. Riavvia npm run agent e usa il codice nuovo.";
          return this.json(401, { error });
        }
        if (this.options.pairMode === "code") this.pairCode = "";
        this.pairFailures = 0;
        await this.markDirty();
        return this.json(200, { token: this.bridgeToken });
      });
    }
    if (request.method === "POST" && (url.pathname === "/bridge/poll" || url.pathname === "/bridge/heartbeat" || url.pathname === "/bridge/result" || url.pathname === "/oauth/decide" || url.pathname === "/oauth/revoke")) {
      const body = JSON.parse(await this.readBody(request) || "{}") as { token?: string; id?: string; result?: AgentCallResult; requestId?: string; approve?: boolean; scopes?: string[] };
      const site = siteFromOrigin(origin);
      const allowed = await this.exclusive(async () => {
        if (!this.bridgeAuthorized(body.token ?? "")) return false;
        this.lastSeen = this.now();
        if (site === "published") this.publishedSeen = this.now();
        return true;
      });
      if (!allowed) return this.json(401, { error: "Collegamento non riconosciuto." });
      if (url.pathname === "/bridge/heartbeat") return this.json(200, { ok: true });
      if (url.pathname === "/bridge/result") {
        if (!body.id || !body.result) return this.json(400, { error: "Manca l'esito." });
        await this.exclusive(async () => {
          this.settle(body.id ?? "", body.result as AgentCallResult);
          await this.markDirty();
        });
        return this.json(200, { ok: true });
      }
      if (url.pathname === "/oauth/decide") {
        return this.exclusive(async () => {
          const decided = this.oauth.decide(body.requestId ?? "", body.approve === true, body.scopes ?? []);
          if (!decided.ok) return this.json(400, { error: decided.error });
          await this.markDirty();
          return this.json(200, { ok: true });
        });
      }
      if (url.pathname === "/oauth/revoke") {
        return this.exclusive(async () => {
          this.oauth.revokeAll();
          await this.markDirty();
          return this.json(200, { ok: true });
        });
      }
      const job = await this.poll(site);
      return this.json(200, job ?? { type: "idle" });
    }
    if (url.pathname === AGENT_MCP_PATH || url.pathname === "/") return this.mcp(request, url);
    return this.json(404, { error: "Non trovato." });
  }

  /** Form OAuth: x-www-form-urlencoded o JSON; client_id anche da Authorization: Basic (client_secret_basic). */
  private async readForm(request: Request) {
    const raw = await this.readBody(request);
    const json = request.headers.get("content-type")?.includes("application/json") ?? false;
    const form = new URLSearchParams(json ? "" : raw);
    if (json) {
      const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") form.set(key, value);
    }
    const basic = /^Basic\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
    if (basic && !form.get("client_id")) {
      try {
        const decoded = atob(basic[1].trim());
        const clientId = decodeURIComponent(decoded.slice(0, decoded.includes(":") ? decoded.indexOf(":") : undefined));
        if (clientId) form.set("client_id", clientId);
      } catch {
        // intestazione malformata: il client_id manca e /token risponde invalid_client
      }
    }
    return form;
  }

  private async mcp(request: Request, url: URL): Promise<Response> {
    if (request.method === "DELETE") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    // Nessuno stream GET (rimosso dal protocollo 2026-07-28): 405 come chiede la specifica.
    if (request.method !== "POST") return this.json(405, { error: "Usa POST. Il server risponde in JSON." }, { allow: "POST, DELETE" });
    const token = this.bearer(request);
    const actor = await this.actorFor(token);
    if (!actor) {
      const metadata = `${this.options.issuer}/.well-known/oauth-protected-resource${url.pathname === AGENT_MCP_PATH ? AGENT_MCP_PATH : ""}`;
      return this.json(401, { error: "unauthorized" }, {
        "www-authenticate": `Bearer realm="studyos", resource_metadata="${metadata}"`
      });
    }
    let message: unknown;
    try {
      message = JSON.parse(await this.readBody(request) || "null");
    } catch (error) {
      if (error instanceof Error && error.message === "payload") throw error;
      return this.json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON non valido." } });
    }
    const gated = protocolStatus(request, message);
    if (gated) return this.json(gated.status, gated.body);
    const response = await handleMcpRpc(message, {
      actor,
      ledger: this.ledger,
      connected: () => this.connected(),
      invoke: (call) => this.invoke(call),
      waitForResult: (id) => this.waitForResult(id)
    });
    if (!response) return new Response(null, { status: 202, headers: { "cache-control": "no-store" } });
    const version = protocolVersion(request, message);
    const errorCode = response.error && typeof response.error === "object" ? (response.error as { code?: unknown }).code : undefined;
    // 404 solo sul protocollo moderno: un client precedente legge l'errore JSON-RPC su HTTP 200.
    if (version === "2026-07-28" && errorCode === -32601) return this.json(404, response);
    // ChatGPT segna come incoerente una discovery il cui Content-Type è text/event-stream, anche con HTTP 200.
    return this.json(200, response);
  }

  private traceMcp(request: Request, response: Response) {
    const url = new URL(request.url);
    console.log(JSON.stringify({
      studyos: "mcp",
      path: url.pathname,
      http: request.method,
      status: response.status,
      protocol: request.headers.get("mcp-protocol-version") ?? "",
      rpc: request.headers.get("mcp-method") ?? "",
      accept: (request.headers.get("accept") ?? "").slice(0, 90),
      origin: request.headers.get("origin") ?? "",
      type: response.headers.get("content-type") ?? ""
    }));
  }

  private invoke(call: { id: string; name: string; args: Record<string, unknown>; actor: AgentActor }) {
    return new Promise<AgentCallResult>((resolve) => {
      let settled = false;
      const done = (result: AgentCallResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        void this.exclusive(async () => {
          if (!this.finishers.has(call.id)) return;
          this.finishers.delete(call.id);
          this.ledger.remember(call.id, {
            ok: true,
            data: {
              status: "pending_approval",
              approvalId: call.id,
              message: "L'azione aspetta la conferma della persona in StudyOS. Non ripeterla: avvisa la persona e chiama studyos_approval_status con questo approvalId."
            }
          });
          await this.markDirty();
          done(this.ledger.recall(call.id) ?? { ok: false, code: "failed", error: "Esito non disponibile." });
        });
      }, this.approvalWaitMs);
      void this.exclusive(async () => {
        if (this.dropStaleCalls()) await this.markDirty();
        this.finishers.set(call.id, (result) => {
          this.ledger.remember(call.id, result);
          done(result);
        });
        this.open.add(call.id);
        this.calls.push({ type: "call", id: call.id, name: call.name, args: call.args, actor: call.actor, summary: toolSummary(call.name, call.args), queuedAt: this.now() });
        this.claim();
      });
    });
  }

  private settle(id: string, result: AgentCallResult) {
    const index = this.calls.findIndex((item) => item.id === id);
    if (index >= 0) this.calls.splice(index, 1);
    this.open.delete(id);
    const finish = this.finishers.get(id);
    if (finish) {
      this.finishers.delete(id);
      finish(result);
    } else {
      this.ledger.remember(id, result);
    }
    const waiting = this.watchers.get(id);
    this.watchers.delete(id);
    for (const notify of waiting ?? []) notify(result);
  }

  /** Esito di un'azione: se è ancora in attesa di conferma, aspetta un poco che la persona decida. */
  waitForResult(id: string): Promise<AgentCallResult | undefined> {
    const current = this.ledger.recall(id);
    if (!isPendingResult(current) || !this.open.has(id)) return Promise.resolve(current);
    return new Promise((resolve) => {
      const listeners = this.watchers.get(id) ?? new Set<(result: AgentCallResult) => void>();
      const notify = (result: AgentCallResult) => {
        clearTimeout(timer);
        resolve(result);
      };
      const timer = setTimeout(() => {
        listeners.delete(notify);
        resolve(this.ledger.recall(id));
      }, this.approvalPollMs);
      listeners.add(notify);
      this.watchers.set(id, listeners);
    });
  }

  /** Toglie dalla coda le azioni che nessun browser ha ritirato in tempo e lo scrive nell'esito. */
  private dropStaleCalls() {
    const limit = this.now() - STALE_CALL_MS;
    let dropped = 0;
    for (let index = this.calls.length - 1; index >= 0; index -= 1) {
      const job = this.calls[index];
      if (job.queuedAt > limit) continue;
      this.calls.splice(index, 1);
      dropped += 1;
      this.settle(job.id, {
        ok: false,
        code: "not_connected",
        error: "StudyOS non ha ricevuto l'azione entro 2 minuti e non l'ha eseguita. Chiedi alla persona di aprire StudyOS e riprova."
      });
    }
    for (let index = this.consents.length - 1; index >= 0; index -= 1) {
      if (!this.oauth.pendingConsent(this.consents[index].requestId)) this.consents.splice(index, 1);
    }
    return dropped > 0;
  }

  private async poll(site: BridgeSite): Promise<Job | null> {
    let resolveJob: (job: Job | null) => void = () => undefined;
    const done = new Promise<Job | null>((resolve) => {
      resolveJob = resolve;
    });
    const entry: Waiter = { site, active: true, resolve: (job) => resolveJob(job), timer: null };
    await this.exclusive(async () => {
      this.lastSeen = this.now();
      if (site === "published") this.publishedSeen = this.now();
      if (this.dropStaleCalls()) await this.markDirty();
      this.waiters.push(entry);
      entry.timer = setTimeout(() => {
        void this.exclusive(async () => {
          if (!entry.active) return;
          entry.active = false;
          this.removeWaiter(entry);
          entry.resolve(null);
        });
      }, this.pollWaitMs);
      this.claim();
    });
    return done;
  }

  private claim() {
    const job = this.consents[0] ?? this.calls[0];
    if (!job) return;
    const chosen = choosePoller(this.waiters.filter((waiter) => waiter.active), this.now() - this.publishedSeen < PUBLISHED_FRESH_MS);
    if (!chosen) return;
    if (this.consents[0]) this.consents.shift();
    else this.calls.shift();
    chosen.active = false;
    if (chosen.timer) clearTimeout(chosen.timer);
    this.removeWaiter(chosen);
    chosen.resolve(job);
  }

  private removeWaiter(entry: Waiter) {
    const index = this.waiters.indexOf(entry);
    if (index >= 0) this.waiters.splice(index, 1);
  }

  private pairAccepts(code: string) {
    if (this.options.pairMode === "key") {
      const key = this.options.pairKey ?? "";
      return key.length >= 20 && code.length >= 20 && timingSafeEqual(code, key);
    }
    return Boolean(this.pairCode) && this.now() <= this.pairExpires && timingSafeEqual(code, this.pairCode);
  }

  private bridgeAuthorized(token: string) {
    return Boolean(token) && timingSafeEqual(token, this.bridgeToken);
  }

  private async actorFor(token: string): Promise<AgentActor | null> {
    if (token && timingSafeEqual(token, this.serviceToken)) {
      return { name: "Client locale", source: "stdio", scopes: ["studyos:read", "studyos:write"] };
    }
    const remote = await this.oauth.authenticate(token);
    if (!remote) return null;
    return { name: remote.name, source: "oauth", scopes: remote.scopes };
  }

  private bearer(request: Request) {
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.get("authorization") ?? "");
    return match?.[1]?.trim() ?? "";
  }

  private metadata() {
    const issuer = this.options.issuer;
    return {
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      revocation_endpoint: `${issuer}/revoke`,
      revocation_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      scopes_supported: ["studyos:read", "studyos:write", "offline_access"],
      service_documentation: "https://massimilianociconte.github.io/StudyOS/"
    };
  }

  private authorizePage(clientName: string) {
    return `<!doctype html>
<meta charset="utf-8">
<title>Collega StudyOS</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #10131d; color: #f4f1ea; font: 16px/1.45 ui-sans-serif, system-ui, sans-serif; }
  main { width: min(440px, calc(100% - 32px)); padding: 28px; border-radius: 28px; background: #1b2030; }
  h1 { margin: 0 0 8px; font-size: 28px; }
  p { color: #c8c2b8; }
  b { color: #f4f1ea; }
</style>
<main>
  <h1>StudyOS</h1>
  <p><b>${escapeHtml(clientName)}</b> chiede di usare il tuo studio. Apri StudyOS e conferma la richiesta in Impostazioni → Agenti. Le modifiche resteranno comunque da approvare una per una.</p>
  <p id="status">In attesa della tua conferma…</p>
</main>
<script>
  const status = document.getElementById("status");
  const hint = ${JSON.stringify(this.options.disconnectedHint)};
  const tick = async () => {
    const response = await fetch("/oauth/wait", { headers: { "accept": "application/json" } });
    const body = await response.json();
    if (body.state === "ready" && typeof body.redirectTo === "string") {
      location.replace(body.redirectTo);
      return;
    }
    if (body.state === "missing") {
      status.textContent = "La richiesta è scaduta. Torna all'agente e ripeti il collegamento.";
      return;
    }
    if (body.connected === false) status.textContent = hint;
    setTimeout(tick, 1000);
  };
  tick();
</script>`;
  }

  private cookie(request: Request, name: string) {
    const header = request.headers.get("cookie") ?? "";
    const match = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
    return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
  }

  private async readBody(request: Request) {
    const declared = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new Error("payload");
    const text = await request.text();
    if (text.length > BODY_LIMIT) throw new Error("payload");
    return text;
  }

  private async markDirty() {
    this.dirty = true;
    if (this.options.persist) await this.options.persist();
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.gate.then(() => fn());
    this.gate = run.then(() => undefined, () => undefined);
    return run;
  }

  private json(status: number, body: unknown, extra: Record<string, string> = {}) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
    });
  }

  private html(status: number, body: string, extra: Record<string, string> = {}) {
    return new Response(body, {
      status,
      headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", ...extra }
    });
  }

  private withCors(request: Request, response: Response, mcp: boolean) {
    const origin = request.headers.get("origin");
    if (!origin || !this.options.allowOrigin(origin, mcp)) return response;
    const headers = new Headers(response.headers);
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
    headers.set("access-control-allow-private-network", "true");
    // Un client MCP nel browser deve poter leggere la sfida OAuth e la versione del protocollo.
    headers.set("access-control-expose-headers", "www-authenticate, mcp-protocol-version, mcp-session-id");
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  private preflight(request: Request, mcp: boolean) {
    const origin = request.headers.get("origin");
    // Intestazioni standard MCP più le Mcp-Param-* dei tool: si rimandano quelle chieste, se sono nomi validi.
    const asked = (request.headers.get("access-control-request-headers") ?? "")
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item) => /^[a-z0-9!#$%&'*+.^_`|~-]+$/.test(item));
    const allowed = new Set(["authorization", "content-type", "accept", "mcp-protocol-version", "mcp-method", "mcp-name", "mcp-session-id", "last-event-id", ...asked]);
    const headers = new Headers({
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": [...allowed].join(", "),
      "access-control-allow-private-network": "true",
      "access-control-max-age": "600"
    });
    if (origin && this.options.allowOrigin(origin, mcp)) {
      headers.set("access-control-allow-origin", origin);
      headers.set("vary", "Origin");
    }
    return new Response(null, { status: 204, headers });
  }
}
