// Ponte HTTP di StudyOS. Lo stesso codice gira sul programma locale e sull'hub pubblico.
// Non legge IndexedDB: consegna le azioni al browser collegato e conserva solo token (in hash) e esiti.
import { AGENT_MCP_PATH, AGENT_SERVER_VERSION } from "./constants";
import { toolSummary } from "./catalog";
import { choosePoller, siteFromOrigin, type BridgeSite } from "./hubEndpoint";
import { ResultLedger } from "./ledger";
import { handleMcpRpc } from "./mcp";
import { OauthServer, randomToken, timingSafeEqual, type PersistedOauth } from "./oauth";
import type { AgentActor, AgentCallResult } from "./types";

const BODY_LIMIT = 262_144;
const PUBLISHED_FRESH_MS = 45_000;

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
  persist?: () => Promise<void>;
}

interface CallJob {
  type: "call";
  id: string;
  name: string;
  args: Record<string, unknown>;
  actor: AgentActor;
  summary: string;
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
  private pairCode = "";
  private pairExpires = 0;
  private pairFailures = 0;
  private pairLockedUntil = 0;
  private readonly calls: CallJob[] = [];
  private readonly consents: ConsentJob[] = [];
  private readonly finishers = new Map<string, (result: AgentCallResult) => void>();
  private readonly waiters: Waiter[] = [];
  private lastSeen = 0;
  private publishedSeen = 0;
  private gate: Promise<void> = Promise.resolve();
  private dirty = false;

  constructor(options: HttpHubOptions) {
    this.options = options;
    this.now = options.now ?? (() => Date.now());
    this.approvalWaitMs = options.approvalWaitMs ?? 110_000;
    this.pollWaitMs = options.pollWaitMs ?? 20_000;
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
    const mcp = url.pathname === AGENT_MCP_PATH;
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
      return this.json(200, {
        resource: this.options.canonical,
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
        const raw = await this.readBody(request);
        const form = new URLSearchParams(request.headers.get("content-type")?.includes("application/json") ? "" : raw);
        if (request.headers.get("content-type")?.includes("application/json")) {
          const parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
          for (const [key, value] of Object.entries(parsed)) if (typeof value === "string") form.set(key, value);
        }
        const exchanged = await this.oauth.exchange(form);
        if (!exchanged.ok) return this.json(exchanged.status, { error: exchanged.error });
        await this.markDirty();
        return this.json(200, exchanged.body);
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
    if (url.pathname === AGENT_MCP_PATH) return this.mcp(request);
    return this.json(404, { error: "Non trovato." });
  }

  private async mcp(request: Request): Promise<Response> {
    if (request.method === "DELETE") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    if (request.method !== "POST") return this.json(request.method === "GET" ? 405 : 405, { error: request.method === "GET" ? "Usa POST. Il server risponde in JSON." : "Metodo non ammesso." });
    const token = this.bearer(request);
    const actor = await this.actorFor(token);
    if (!actor) {
      return this.json(401, { error: "unauthorized" }, {
        "www-authenticate": `Bearer realm="studyos", resource_metadata="${this.options.issuer}/.well-known/oauth-protected-resource/mcp"`
      });
    }
    let message: unknown;
    try {
      message = JSON.parse(await this.readBody(request) || "null");
    } catch (error) {
      if (error instanceof Error && error.message === "payload") throw error;
      return this.json(400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON non valido." } });
    }
    const response = await handleMcpRpc(message, {
      actor,
      ledger: this.ledger,
      connected: () => this.connected(),
      invoke: (call) => this.invoke(call)
    });
    if (!response) return new Response(null, { status: 202, headers: { "cache-control": "no-store" } });
    const accept = request.headers.get("accept") ?? "";
    if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
      return new Response(`event: message\ndata: ${JSON.stringify(response)}\n\n`, {
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" }
      });
    }
    return this.json(200, response);
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
              message: "L'azione è in attesa della conferma in StudyOS. Non ripeterla: chiama studyos_approval_status con questo approvalId."
            }
          });
          await this.markDirty();
          done(this.ledger.recall(call.id) ?? { ok: false, code: "failed", error: "Esito non disponibile." });
        });
      }, this.approvalWaitMs);
      void this.exclusive(async () => {
        this.finishers.set(call.id, (result) => {
          this.ledger.remember(call.id, result);
          done(result);
        });
        this.calls.push({ type: "call", id: call.id, name: call.name, args: call.args, actor: call.actor, summary: toolSummary(call.name, call.args) });
        this.claim();
      });
    });
  }

  private settle(id: string, result: AgentCallResult) {
    const index = this.calls.findIndex((item) => item.id === id);
    if (index >= 0) this.calls.splice(index, 1);
    const finish = this.finishers.get(id);
    if (finish) {
      this.finishers.delete(id);
      finish(result);
      return;
    }
    this.ledger.remember(id, result);
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
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }

  private preflight(request: Request, mcp: boolean) {
    const origin = request.headers.get("origin");
    const headers = new Headers({
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, accept, access-control-request-private-network",
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
