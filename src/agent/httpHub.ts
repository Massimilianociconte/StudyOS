// Ponte HTTP di StudyOS. Lo stesso codice gira sul programma locale e sull'hub pubblico.
// Non legge IndexedDB: consegna le azioni al browser collegato e conserva solo token (in hash) e esiti.
import {
  BROWSER_FORGET_MS,
  accountKey as accountKeyOf,
  accountLabel,
  chooseAccount,
  cloudMcpPath,
  cloudPathOf,
  listAccounts,
  parseBrowserInfo,
  type AccountChoice,
  type AccountView,
  type BridgeBrowser
} from "./accounts";
import { AGENT_MCP_PATH, AGENT_PROTOCOL_VERSIONS, AGENT_SERVER_VERSION } from "./constants";
import { toolSummary } from "./catalog";
import { choosePoller, siteFromOrigin, type BridgeSite } from "./hubEndpoint";
import { ResultLedger } from "./ledger";
import { handleMcpRpc } from "./mcp";
import { OauthServer, REQUEST_TTL_MS, randomToken, timingSafeEqual, type CloudGrantRecord, type PersistedOauth } from "./oauth";
import type { AgentActor, AgentCallResult } from "./types";
import type { CloudRunner } from "./cloudRunner";
import { isTimeZone } from "./zonedDate";

const BODY_LIMIT = 262_144;
const PUBLISHED_FRESH_MS = 45_000;
/** Un'azione che il browser non ha ritirato entro questo tempo non parte più: niente esecuzioni a sorpresa ore dopo. */
const STALE_CALL_MS = 120_000;
/** Il lastSeen di un browser si salva al più una volta al giorno: serve solo a dimenticare i browser spariti. */
const SEEN_SAVE_MS = 24 * 60 * 60_000;
/** Collegamento del browser: 8 tentativi sbagliati negli ultimi 10 minuti bloccano /pair finché non escono dalla finestra. */
const PAIR_WINDOW_MS = 10 * 60_000;
const PAIR_MAX_FAILURES = 8;

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
  /** Errori negli ultimi 10 minuti e fine del blocco: scritti per gli stati di prima, letti solo se manca `pairFailureTimes`. */
  pairFailures: number;
  pairLockedUntil: number;
  /** Istanti dei tentativi di collegamento sbagliati ancora nella finestra di 10 minuti. */
  pairFailureTimes?: number[];
  /** Browser collegati con il nome del loro account (assente negli snapshot di prima). */
  browsers?: BridgeBrowser[];
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
  /**
   * Connettore remoto di ogni account (/u/<nome>/mcp): esegue gli strumenti sui dati cloud con
   * l'app chiusa. Assente = solo il connettore principale, che passa dal browser.
   */
  cloud?: Pick<CloudRunner, "run">;
}

interface CallJob {
  type: "call";
  id: string;
  name: string;
  args: Record<string, unknown>;
  actor: AgentActor;
  summary: string;
  queuedAt: number;
  /** accountKey dell'account che deve eseguirla: la ritira solo un suo browser. */
  account: string;
}

interface ConsentJob {
  type: "consent";
  requestId: string;
  clientName: string;
  scopes: string[];
  redirectHost: string;
  /** Connettore remoto: la richiesta va solo ai browser di questo account (accountKey). */
  account?: string;
  /** Nome dell'account da mostrare nella richiesta. */
  accountName?: string;
  /** true = con «Consenti» l'app crea il permesso cloud e lo manda con la decisione. */
  cloud?: boolean;
}

type Job = CallJob | ConsentJob;

interface Waiter {
  site: BridgeSite;
  account: string;
  active: boolean;
  resolve: (job: Job | null) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

const emptyOauth = (): PersistedOauth => ({ clients: [], access: [], refresh: [] });

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

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
  /** Tentativi sbagliati (al più gli ultimi `PAIR_MAX_FAILURES`): il blocco guarda solo gli ultimi 10 minuti. */
  private pairFailureTimes: number[] = [];
  private readonly calls: CallJob[] = [];
  private readonly consents: ConsentJob[] = [];
  private readonly finishers = new Map<string, (result: AgentCallResult) => void>();
  /** Azioni non ancora concluse dal browser, anche dopo che l'agente ha ricevuto pending_approval. */
  private readonly open = new Set<string>();
  private readonly watchers = new Map<string, Set<(result: AgentCallResult) => void>>();
  private readonly waiters: Waiter[] = [];
  private readonly browsers = new Map<string, BridgeBrowser>();
  private readonly savedSeen = new Map<string, number>();
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
      pairFailures: this.recentPairFailures().length,
      pairLockedUntil: this.pairLockedUntil(),
      pairFailureTimes: [...this.pairFailureTimes],
      browsers: [...this.browsers.values()].filter((browser) => !browser.legacy).map((browser) => ({ ...browser }))
    };
  }

  importState(state: HubSnapshot) {
    if (state.bridgeToken && state.serviceToken) {
      this.bridgeToken = state.bridgeToken;
      this.serviceToken = state.serviceToken;
    }
    this.oauth.load(state.oauth ?? emptyOauth());
    this.ledger.importState(Array.isArray(state.ledger) ? state.ledger : []);
    if (Array.isArray(state.pairFailureTimes)) {
      this.pairFailureTimes = state.pairFailureTimes.filter((at): at is number => typeof at === "number" && Number.isFinite(at)).slice(-PAIR_MAX_FAILURES);
    } else {
      // Stato di prima: un blocco ancora attivo dura fino alla sua scadenza, il contatore vecchio no.
      const lockedUntil = typeof state.pairLockedUntil === "number" ? state.pairLockedUntil : 0;
      this.pairFailureTimes = lockedUntil > this.now() ? Array.from({ length: PAIR_MAX_FAILURES }, () => lockedUntil - PAIR_WINDOW_MS) : [];
    }
    this.browsers.clear();
    this.savedSeen.clear();
    for (const raw of Array.isArray(state.browsers) ? state.browsers : []) {
      const info = raw && typeof raw === "object" ? parseBrowserInfo({ id: raw.id, name: raw.label }) : null;
      if (!info || typeof raw.lastSeen !== "number" || this.now() - raw.lastSeen > BROWSER_FORGET_MS) continue;
      const label = info.name ?? "";
      this.browsers.set(info.id, {
        id: info.id,
        key: accountKeyOf(label),
        label,
        site: raw.site === "published" ? "published" : "local",
        lastSeen: raw.lastSeen
      });
      this.savedSeen.set(info.id, raw.lastSeen);
    }
    this.dirty = false;
  }

  armPairCode(code: string, expiresAt: number) {
    this.pairCode = code;
    this.pairExpires = expiresAt;
  }

  /** Tentativi sbagliati ancora nella finestra di 10 minuti (i più vecchi si dimenticano). */
  private recentPairFailures() {
    const since = this.now() - PAIR_WINDOW_MS;
    this.pairFailureTimes = this.pairFailureTimes.filter((at) => at > since);
    return this.pairFailureTimes;
  }

  /** Fine del blocco in corso, 0 se non c'è: quando il più vecchio degli errori esce dalla finestra. */
  private pairLockedUntil() {
    const recent = this.recentPairFailures();
    return recent.length >= PAIR_MAX_FAILURES ? recent[recent.length - PAIR_MAX_FAILURES] + PAIR_WINDOW_MS : 0;
  }

  takeDirty() {
    const dirty = this.dirty;
    this.dirty = false;
    return dirty;
  }

  connected() {
    return this.now() - this.lastSeen < PUBLISHED_FRESH_MS;
  }

  /** Account dei browser collegati, uno per nome. */
  accounts(): AccountView[] {
    return listAccounts(this.browsers.values(), this.now(), PUBLISHED_FRESH_MS);
  }

  private accountConnected(account: string) {
    const now = this.now();
    for (const browser of this.browsers.values()) {
      if (browser.key === account && now - browser.lastSeen < PUBLISHED_FRESH_MS) return true;
    }
    return false;
  }

  private publishedFresh(account: string) {
    const now = this.now();
    for (const browser of this.browsers.values()) {
      if (browser.key === account && browser.site === "published" && now - browser.lastSeen < PUBLISHED_FRESH_MS) return true;
    }
    return false;
  }

  /**
   * Registra il browser che chiede lavoro e restituisce il suo account. Un'app di prima senza
   * dichiarazione vale come account senza nome. true in `save` = lo snapshot va riscritto.
   */
  private touchBrowser(value: unknown, site: BridgeSite): { account: string; save: boolean } {
    const now = this.now();
    let save = false;
    for (const [id, browser] of this.browsers) {
      if (now - browser.lastSeen <= BROWSER_FORGET_MS) continue;
      this.browsers.delete(id);
      this.savedSeen.delete(id);
      save ||= !browser.legacy;
    }
    const info = parseBrowserInfo(value);
    if (!info) {
      const id = `legacy-${site}`;
      this.browsers.set(id, { id, key: "", label: "", site, lastSeen: now, legacy: true });
      return { account: "", save };
    }
    const known = this.browsers.get(info.id);
    const label = info.name ?? known?.label ?? "";
    const key = accountKeyOf(label);
    const renamed = !known || known.label !== label || known.site !== site;
    this.browsers.set(info.id, { id: info.id, key, label, site, lastSeen: now });
    if (renamed || now - (this.savedSeen.get(info.id) ?? 0) > SEEN_SAVE_MS) {
      this.savedSeen.set(info.id, now);
      save = true;
    }
    return { account: key, save };
  }

  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const mcp = url.pathname === AGENT_MCP_PATH || url.pathname === "/" || cloudPathOf(url.pathname) !== null;
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
        mcp: this.options.canonical,
        cloud: Boolean(this.options.cloud)
      });
    }
    const cloudMetadata = url.pathname.startsWith("/.well-known/oauth-protected-resource/u/")
      ? cloudPathOf(url.pathname.slice("/.well-known/oauth-protected-resource".length))
      : null;
    if (request.method === "GET" && cloudMetadata && this.options.cloud) {
      return this.json(200, {
        resource: `${this.options.issuer}${cloudMcpPath(cloudMetadata.slug)}`,
        authorization_servers: [this.options.issuer],
        scopes_supported: ["studyos:read", "studyos:write", "offline_access"],
        bearer_methods_supported: ["header"]
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
        // Il consenso nuovo può aver preso il posto di uno vecchio dello stesso client: fuori dalla coda.
        this.dropStaleConsents();
        if (!begun.ok) return this.html(begun.status ?? 400, this.messagePage(begun.description));
        const job: ConsentJob = { type: "consent", requestId: begun.requestId, clientName: begun.clientName, scopes: begun.scopes, redirectHost: begun.redirectHost };
        if (this.oauth.isCloudResource(begun.resource)) {
          // Connettore remoto: la richiesta va solo all'account scritto nell'indirizzo.
          const target = this.cloudAccount(begun.resource);
          if (!this.options.cloud || !target.ok) {
            this.oauth.dropRequest(begun.requestId);
            return this.html(this.options.cloud ? 404 : 501, this.messagePage(target.ok
              ? "Il connettore remoto non è attivo su questo hub: mancano STUDYOS_SUPABASE_URL e STUDYOS_SUPABASE_KEY."
              : target.error));
          }
          Object.assign(job, { account: target.key, accountName: accountLabel(target.name), cloud: true });
        }
        this.consents.push(job);
        this.claim();
        const secure = this.options.secureCookies ? "; Secure" : "";
        return this.html(200, this.authorizePage(begun.clientName, job.accountName), {
          "set-cookie": `studyos_oauth=${encodeURIComponent(begun.requestId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(REQUEST_TTL_MS / 1000)}${secure}`
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
      const pending = this.oauth.pendingConsent(requestId);
      const target = pending && this.oauth.isCloudResource(pending.resource) ? this.cloudAccount(pending.resource) : null;
      return this.json(200, { state: "pending", connected: target ? target.ok && this.accountConnected(target.key) : this.connected() });
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
        // Finestra scorrevole: 8 errori negli ultimi 10 minuti bloccano; i tentativi rifiutati
        // durante il blocco non contano, così il blocco finisce da solo.
        if (this.recentPairFailures().length >= PAIR_MAX_FAILURES) return this.json(429, { error: "Troppi tentativi. Attendi qualche minuto." });
        if (!this.pairAccepts(code)) {
          this.pairFailureTimes = [...this.recentPairFailures(), this.now()].slice(-PAIR_MAX_FAILURES);
          await this.markDirty();
          const error = this.options.pairMode === "key"
            ? "Chiave non valida."
            : "Codice non valido o scaduto. Riavvia npm run agent e usa il codice nuovo.";
          return this.json(401, { error });
        }
        if (this.options.pairMode === "code") this.pairCode = "";
        this.pairFailureTimes = [];
        await this.markDirty();
        return this.json(200, { token: this.bridgeToken });
      });
    }
    if (request.method === "POST" && (url.pathname === "/bridge/poll" || url.pathname === "/bridge/heartbeat" || url.pathname === "/bridge/forget" || url.pathname === "/bridge/result" || url.pathname === "/oauth/decide" || url.pathname === "/oauth/revoke")) {
      const body = JSON.parse(await this.readBody(request) || "{}") as { token?: string; id?: string; result?: AgentCallResult; requestId?: string; approve?: boolean; scopes?: string[]; browser?: unknown; cloud?: unknown };
      const site = siteFromOrigin(origin);
      const asksWork = url.pathname === "/bridge/poll" || url.pathname === "/bridge/heartbeat";
      const allowed = await this.exclusive(async () => {
        if (!this.bridgeAuthorized(body.token ?? "")) return null;
        this.lastSeen = this.now();
        if (site === "published") this.publishedSeen = this.now();
        if (!asksWork) return { account: "" };
        const touched = this.touchBrowser(body.browser, site);
        if (touched.save) await this.markDirty();
        return { account: touched.account };
      });
      if (!allowed) return this.json(401, { error: "Collegamento non riconosciuto." });
      if (url.pathname === "/bridge/heartbeat") return this.json(200, { ok: true });
      if (url.pathname === "/bridge/forget") {
        // Il browser si scollega: il suo account sparisce dalle scelte se non ha altri browser.
        const info = parseBrowserInfo(body.browser);
        await this.exclusive(async () => {
          if (!info || !this.browsers.delete(info.id)) return;
          this.savedSeen.delete(info.id);
          await this.markDirty();
        });
        return this.json(200, { ok: true });
      }
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
          const pending = this.oauth.pendingConsent(body.requestId ?? "");
          let cloud: CloudGrantRecord | undefined;
          if (pending && this.oauth.isCloudResource(pending.resource) && body.approve === true) {
            // Il permesso cloud creato dall'app con «Consenti»: segreto di 64 caratteri esadecimali e fuso del browser.
            const raw = isRecord(body.cloud) ? body.cloud : {};
            if (typeof raw.secret !== "string" || !/^[0-9a-f]{64}$/.test(raw.secret) || !isTimeZone(raw.timeZone)) {
              return this.json(400, { error: "Permesso cloud mancante o non valido: fai l'accesso al tuo account in StudyOS e riprova." });
            }
            cloud = { secret: raw.secret, timeZone: raw.timeZone };
          }
          const decided = this.oauth.decide(body.requestId ?? "", body.approve === true, body.scopes ?? [], undefined, cloud);
          if (!decided.ok) return this.json(400, { error: decided.error });
          await this.markDirty();
          return this.json(200, { ok: true });
        });
      }
      if (url.pathname === "/oauth/revoke") {
        return this.exclusive(async () => {
          this.oauth.revokeAll();
          this.dropStaleConsents();
          await this.markDirty();
          return this.json(200, { ok: true });
        });
      }
      const job = await this.poll(site, allowed.account);
      return this.json(200, job ?? { type: "idle" });
    }
    if (url.pathname === AGENT_MCP_PATH || url.pathname === "/") return this.mcp(request, url, null);
    const cloudPath = cloudPathOf(url.pathname);
    if (cloudPath && this.options.cloud) return this.mcp(request, url, cloudPath.slug);
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

  /** `slug` = connettore remoto di un account (/u/<slug>/mcp); null = connettore principale. */
  private async mcp(request: Request, url: URL, slug: string | null): Promise<Response> {
    if (request.method === "DELETE") return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
    // Nessuno stream GET (rimosso dal protocollo 2026-07-28): 405 come chiede la specifica.
    if (request.method !== "POST") return this.json(405, { error: "Usa POST. Il server risponde in JSON." }, { allow: "POST, DELETE" });
    const token = this.bearer(request);
    const resource = slug ? `${this.options.issuer}${cloudMcpPath(slug)}` : this.options.canonical;
    const cloudActor = slug ? await this.cloudActorFor(token, resource) : null;
    const actor: AgentActor | null = slug ? cloudActor : await this.actorFor(token);
    if (!actor) {
      const path = slug ? cloudMcpPath(slug) : url.pathname === AGENT_MCP_PATH ? AGENT_MCP_PATH : "";
      const metadata = `${this.options.issuer}/.well-known/oauth-protected-resource${path}`;
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
    const runner = this.options.cloud;
    const grant = cloudActor?.cloud;
    const response = await handleMcpRpc(message, grant && runner && slug
      ? {
        actor,
        ledger: this.ledger,
        connected: () => true,
        invoke: async () => ({ ok: false, code: "invalid", error: "Strumento non disponibile." }),
        cloud: { account: this.cloudLabel(slug), run: (name, args) => runner.run(grant, name, args) }
      }
      : {
        actor,
        ledger: this.ledger,
        connected: (account) => (account === undefined ? this.connected() : this.accountConnected(account)),
        accounts: () => this.accounts(),
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

  private invoke(call: { id: string; name: string; args: Record<string, unknown>; actor: AgentActor; account?: string }) {
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
        this.calls.push({ type: "call", id: call.id, name: call.name, args: call.args, actor: call.actor, summary: toolSummary(call.name, call.args), queuedAt: this.now(), account: call.account ?? "" });
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
    this.dropStaleConsents();
    return dropped > 0;
  }

  /** Richieste di consenso scadute, sostituite o revocate: non vanno più consegnate. */
  private dropStaleConsents() {
    for (let index = this.consents.length - 1; index >= 0; index -= 1) {
      if (!this.oauth.pendingConsent(this.consents[index].requestId)) this.consents.splice(index, 1);
    }
  }

  private async poll(site: BridgeSite, account: string): Promise<Job | null> {
    let resolveJob: (job: Job | null) => void = () => undefined;
    const done = new Promise<Job | null>((resolve) => {
      resolveJob = resolve;
    });
    const entry: Waiter = { site, account, active: true, resolve: (job) => resolveJob(job), timer: null };
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

  /**
   * Consegna il lavoro ai browser in attesa. Le richieste di accesso vanno a un browser qualsiasi;
   * un'azione solo a un browser del suo account, così un account scollegato non blocca gli altri.
   */
  private claim() {
    const active = () => this.waiters.filter((waiter) => waiter.active);
    // La richiesta di un connettore remoto va solo ai browser del suo account.
    for (let index = 0; index < this.consents.length;) {
      const job = this.consents[index];
      const chosen = job.account
        ? choosePoller(active().filter((waiter) => waiter.account === job.account), this.publishedFresh(job.account))
        : choosePoller(active(), this.now() - this.publishedSeen < PUBLISHED_FRESH_MS);
      if (!chosen) {
        index += 1;
        continue;
      }
      this.consents.splice(index, 1);
      this.hand(chosen, job);
    }
    for (let index = 0; index < this.calls.length;) {
      const job = this.calls[index];
      const chosen = choosePoller(active().filter((waiter) => waiter.account === job.account), this.publishedFresh(job.account));
      if (!chosen) {
        index += 1;
        continue;
      }
      this.calls.splice(index, 1);
      this.hand(chosen, job);
    }
  }

  private hand(chosen: Waiter, job: Job) {
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

  /** Account dell'indirizzo di un connettore remoto, con la stessa regola dei nomi in chat. */
  private cloudAccount(resource: string): AccountChoice {
    let query = "";
    try {
      query = cloudPathOf(new URL(resource).pathname)?.query ?? "";
    } catch {
      query = "";
    }
    if (!query) return { ok: false, code: "invalid", error: "Indirizzo del connettore non valido." };
    return chooseAccount(this.accounts().filter((account) => account.key), query);
  }

  private cloudLabel(slug: string) {
    const target = this.cloudAccount(`${this.options.issuer}${cloudMcpPath(slug)}`);
    return target.ok ? accountLabel(target.name) : slug.replace(/-/g, " ");
  }

  private async cloudActorFor(token: string, resource: string): Promise<(AgentActor & { cloud: CloudGrantRecord }) | null> {
    if (!token) return null;
    const remote = await this.oauth.authenticate(token, undefined, resource);
    if (!remote?.cloud) return null;
    return { name: remote.name, source: "oauth", scopes: remote.scopes, cloud: remote.cloud };
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

  private messagePage(text: string) {
    return `<!doctype html><meta charset="utf-8"><title>StudyOS</title><meta name="viewport" content="width=device-width, initial-scale=1"><p style="font: 16px/1.45 system-ui, sans-serif; max-width: 440px; margin: 40px auto; padding: 0 16px">${escapeHtml(text)}</p>`;
  }

  /** `accountName` = connettore remoto: la conferma arriva nello StudyOS di quella persona. */
  private authorizePage(clientName: string, accountName?: string) {
    const ask = accountName
      ? `<b>${escapeHtml(clientName)}</b> chiede di usare lo StudyOS di <b>${escapeHtml(accountName)}</b> anche quando l'app è chiusa. ${escapeHtml(accountName)} deve aprire StudyOS, con l'accesso al suo account, e confermare in Impostazioni → Agenti. Dopo, le modifiche partono senza altre conferme.`
      : `<b>${escapeHtml(clientName)}</b> chiede di usare il tuo studio. Apri StudyOS e conferma la richiesta in Impostazioni → Agenti. Le modifiche resteranno comunque da approvare una per una.`;
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
  <p>${ask}</p>
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
