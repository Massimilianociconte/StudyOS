import { cloudMcpPath, cloudPathOf } from "./accounts";
import { AGENT_DATA_SCOPES, AGENT_SCOPES, type AgentDataScope, type AgentScope } from "./constants";

export interface OAuthClient {
  clientId: string;
  clientName: string;
  redirectUris: string[];
  createdAt: string;
  /** Primo token emesso. Una registrazione mai usata scade dopo `UNUSED_CLIENT_TTL_MS`. */
  usedAt?: string;
}

/** Permesso cloud di un connettore remoto (`/u/<nome>/mcp`): segreto del grant e fuso del browser. */
export interface CloudGrantRecord {
  secret: string;
  timeZone: string;
}

export interface AccessRecord {
  clientId: string;
  clientName: string;
  scopes: AgentDataScope[];
  /** Indirizzo MCP per cui vale il token: /mcp dell'hub o /u/<nome>/mcp di un account. */
  resource: string;
  expiresAt: number;
  /** Stessa concessione di access e refresh: revocarne uno revoca tutta la famiglia. */
  family?: string;
  /** Solo per il connettore remoto. */
  cloud?: CloudGrantRecord;
  /**
   * SHA-256 del segreto del browser che ha premuto «Consenti» (l'hub lo dà a /pair o a
   * /bridge/secret e non lo conserva): solo chi ha quel segreto revoca questa concessione senza
   * scollegare tutti. Assente = concessione di prima, o di un browser senza segreto.
   */
  approver?: string;
}

export interface RefreshRecord extends AccessRecord {
  family: string;
}

interface AuthRequest {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state?: string;
  resource: string;
  scopes: AgentScope[];
  expiresAt: number;
  decision?: { approve: boolean; scopes: AgentDataScope[]; cloud?: CloudGrantRecord; approver?: string };
  code?: string;
  redirectTo?: string;
}

export interface TokenActor {
  name: string;
  source: "oauth";
  scopes: AgentDataScope[];
  clientId: string;
  resource: string;
  cloud?: CloudGrantRecord;
}

const CODE_TTL_MS = 60_000;
const ACCESS_TTL_MS = 60 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Consenso in attesa: la pagina /authorize e il cookie durano altrettanto (httpHub). */
export const REQUEST_TTL_MS = 5 * 60 * 1000;
/**
 * /register e /authorize sono aperti a chiunque: limiti perché non si riempiano per sempre.
 * - Client registrati: al limite si tolgono quelli senza token, consensi o codici, dal più vecchio,
 *   ma non nei 2 minuti dopo la registrazione; una registrazione mai usata scade dopo 24 ore.
 * - Consensi in attesa: 5 per client (il sesto prende il posto del più vecchio), 20 in tutto (oltre,
 *   si toglie il più vecchio, prima quelli dei client mai usati; mai un 429), così l'app non riceve
 *   una pioggia di richieste e chi si collega davvero non resta fuori.
 */
const MAX_CLIENTS = 50;
const REGISTRATION_GRACE_MS = 2 * 60 * 1000;
const UNUSED_CLIENT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_REQUESTS_PER_CLIENT = 5;
const MAX_PENDING_REQUESTS = 20;

const bytesToBase64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

export const randomToken = (size = 32) => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
};

export const sha256Base64Url = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
};

export const timingSafeEqual = (left: string, right: string) => {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  const length = Math.max(a.length, b.length);
  let diff = a.length === b.length ? 0 : 1;
  for (let index = 0; index < length; index += 1) diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return diff === 0;
};

export const canonicalResource = (value: string) => value.trim().replace(/\/+$/g, "");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BLOCKED_SCHEMES = new Set(["javascript:", "data:", "file:", "vbscript:", "blob:", "about:", "filesystem:", "intent:", "ftp:", "ws:", "wss:"]);

const isLoopback = (url: URL) => url.protocol === "http:" && LOOPBACK_HOSTS.has(url.hostname);

/**
 * https ovunque, http solo in loopback e lo schema privato di un'app nativa (RFC 8252 §7.1),
 * per esempio cursor://. Mai javascript:, data:, file: e simili.
 */
export const safeRedirectUri = (value: string) => {
  try {
    const url = new URL(value);
    if (url.username || url.password || url.hash) return null;
    if (url.protocol === "https:") return url.toString();
    if (url.protocol === "http:") return isLoopback(url) ? url.toString() : null;
    if (BLOCKED_SCHEMES.has(url.protocol) || !/^[a-z][a-z0-9+.-]*:$/.test(url.protocol)) return null;
    return url.toString();
  } catch {
    return null;
  }
};

/** In loopback la porta cambia a ogni avvio del client nativo (RFC 8252 §7.3): conta il resto. */
const redirectRegistered = (registered: readonly string[], redirect: string) => {
  if (registered.includes(redirect)) return true;
  const asked = new URL(redirect);
  if (!isLoopback(asked)) return false;
  return registered.some((item) => {
    const known = new URL(item);
    return isLoopback(known) && known.hostname === asked.hostname && known.pathname === asked.pathname && known.search === asked.search;
  });
};

const parseScopes = (value: string | null | undefined): AgentScope[] => {
  const requested = (value ?? "studyos:read studyos:write")
    .split(/[\s,]+/)
    .filter((scope): scope is AgentScope => (AGENT_SCOPES as readonly string[]).includes(scope));
  const scopes = requested.length ? requested : (["studyos:read"] as AgentScope[]);
  if (!scopes.includes("studyos:read")) scopes.unshift("studyos:read");
  return scopes;
};

const dataScopes = (scopes: readonly string[], allowed: readonly string[]): AgentDataScope[] => {
  const picked = scopes.filter((scope): scope is AgentDataScope => (AGENT_DATA_SCOPES as readonly string[]).includes(scope) && allowed.includes(scope));
  return picked.length ? picked : ["studyos:read"];
};

export interface PersistedOauth {
  clients: OAuthClient[];
  access: Array<{ hash: string; record: AccessRecord }>;
  refresh: Array<{ hash: string; record: RefreshRecord }>;
}

/**
 * Authorization server OAuth 2.1 minimo per i client MCP (ChatGPT, Claude, altri):
 * PKCE S256, client pubblici, registrazione dinamica, refresh ruotati, audience sul resource.
 * I token in chiaro non vengono conservati: si salva solo l'hash.
 */
export class OauthServer {
  private readonly canonical: string;
  /** Origine dell'hub: issuer OAuth e alias del resource per i client che si collegano alla radice. */
  private readonly issuer: string;
  private readonly now: () => number;
  private clients = new Map<string, OAuthClient>();
  private requests = new Map<string, AuthRequest>();
  private codes = new Map<string, { request: AuthRequest; scopes: AgentDataScope[]; expiresAt: number; used: boolean }>();
  private access = new Map<string, AccessRecord>();
  private refresh = new Map<string, RefreshRecord>();

  constructor(canonical: string, now: () => number = () => Date.now()) {
    this.canonical = canonical;
    this.issuer = new URL(canonical).origin;
    this.now = now;
  }

  /**
   * Indirizzo MCP canonico chiesto dal client: /mcp (anche come radice dell'hub o assente, per i
   * client più vecchi) oppure il connettore remoto di un account, /u/<nome>/mcp. null = altro server.
   */
  resolveResource(value: string | null): string | null {
    const resource = canonicalResource(value ?? "");
    if (!resource || resource === this.canonical || resource === this.issuer) return this.canonical;
    try {
      const url = new URL(resource);
      if (url.origin !== this.issuer || url.search || url.hash) return null;
      const cloud = cloudPathOf(url.pathname);
      return cloud ? `${this.issuer}${cloudMcpPath(cloud.slug)}` : null;
    } catch {
      return null;
    }
  }

  /** true = indirizzo di un connettore remoto (dati cloud di un account). */
  isCloudResource(resource: string) {
    return resource !== this.canonical;
  }

  load(state: PersistedOauth) {
    this.clients = new Map(state.clients.map((client) => [client.clientId, client]));
    this.access = new Map(state.access.map((item) => [item.hash, item.record]));
    this.refresh = new Map(state.refresh.map((item) => [item.hash, item.record]));
    // Stati salvati prima di `usedAt`: un client con token è stato usato.
    for (const record of [...this.access.values(), ...this.refresh.values()]) {
      const client = this.clients.get(record.clientId);
      if (client && !client.usedAt) this.clients.set(client.clientId, { ...client, usedAt: client.createdAt });
    }
  }

  dump(): PersistedOauth {
    this.prune();
    return {
      clients: [...this.clients.values()],
      access: [...this.access.entries()].map(([hash, record]) => ({ hash, record })),
      refresh: [...this.refresh.entries()].map(([hash, record]) => ({ hash, record }))
    };
  }

  register(body: unknown, now = this.now()): { ok: true; client: OAuthClient } | { ok: false; error: string; status: number } {
    this.prune(now);
    if (this.clients.size >= MAX_CLIENTS) {
      // Si fa posto con i client fermi (nessun token, consenso o codice), dal più vecchio. Mai uno
      // registrato da meno di 2 minuti: il suo /authorize sta arrivando.
      const busy = this.busyClients();
      const idle = [...this.clients.values()]
        .filter((client) => !busy.has(client.clientId) && !(now - Date.parse(client.createdAt) < REGISTRATION_GRACE_MS))
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
      for (const client of idle) {
        if (this.clients.size < MAX_CLIENTS) break;
        this.clients.delete(client.clientId);
      }
    }
    if (this.clients.size >= MAX_CLIENTS) return { ok: false, status: 400, error: "Troppi client registrati. Revoca gli accessi da StudyOS." };
    const source = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const redirects = Array.isArray(source.redirect_uris) ? source.redirect_uris : [];
    if (!redirects.length || redirects.length > 5) return { ok: false, status: 400, error: "Servono da 1 a 5 redirect_uris." };
    const redirectUris: string[] = [];
    for (const item of redirects) {
      if (typeof item !== "string") return { ok: false, status: 400, error: "redirect_uris non valido." };
      const safe = safeRedirectUri(item);
      if (!safe) return { ok: false, status: 400, error: "redirect_uri deve essere https, oppure http su localhost." };
      redirectUris.push(safe);
    }
    // Ogni client è registrato come pubblico (PKCE, nessun segreto). Il metodo chiesto non blocca la
    // registrazione: la risposta dice token_endpoint_auth_method=none e il client si adegua (RFC 7591 §3.2.1).
    const client: OAuthClient = {
      clientId: randomToken(18),
      clientName: typeof source.client_name === "string" ? source.client_name.slice(0, 80) : "Agente MCP",
      redirectUris,
      createdAt: new Date(now).toISOString()
    };
    this.clients.set(client.clientId, client);
    return { ok: true, client };
  }

  beginAuthorization(query: URLSearchParams, now = this.now()): { ok: true; requestId: string; clientName: string; scopes: AgentScope[]; redirectHost: string; resource: string } | { ok: false; error: string; description: string } {
    this.prune(now);
    const client = this.clients.get(query.get("client_id") ?? "");
    if (!client) return { ok: false, error: "invalid_client", description: "Client non registrato o rimosso (per esempio dopo una revoca in Impostazioni → Agenti di StudyOS): scollega e ricollega il connettore nell'assistente." };
    const redirect = safeRedirectUri(query.get("redirect_uri") ?? "");
    if (!redirect || !redirectRegistered(client.redirectUris, redirect)) return { ok: false, error: "invalid_request", description: "redirect_uri non registrato." };
    if (query.get("response_type") !== "code") return { ok: false, error: "unsupported_response_type", description: "Solo response_type=code." };
    const challenge = query.get("code_challenge") ?? "";
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(challenge) || (query.get("code_challenge_method") ?? "S256") !== "S256") {
      return { ok: false, error: "invalid_request", description: "PKCE S256 obbligatorio." };
    }
    const resource = this.resolveResource(query.get("resource"));
    if (!resource) return { ok: false, error: "invalid_target", description: "Il parametro resource non coincide con questo server." };
    const scopes = parseScopes(query.get("scope"));
    // Pochi consensi aperti, ma mai un rifiuto: chiunque può aprirne (bastano /register e /authorize),
    // e un rifiuto bloccherebbe chi si collega davvero. Per client il nuovo prende il posto del più
    // vecchio (chi riprova vede l'ultimo); oltre il limite in tutto si toglie il più vecchio in attesa,
    // prima tra quelli di client che non hanno mai completato un'autorizzazione.
    const own = [...this.requests.entries()].filter(([, item]) => item.clientId === client.clientId);
    for (const [id] of own.slice(0, Math.max(0, own.length - MAX_REQUESTS_PER_CLIENT + 1))) this.requests.delete(id);
    const waiting = [...this.requests.entries()].filter(([, item]) => !item.decision);
    const excess = waiting.length - MAX_PENDING_REQUESTS + 1;
    if (excess > 0) {
      const neverUsed = (clientId: string) => !this.clients.get(clientId)?.usedAt;
      const order = [...waiting.filter(([, item]) => neverUsed(item.clientId)), ...waiting.filter(([, item]) => !neverUsed(item.clientId))];
      for (const [id] of order.slice(0, excess)) this.requests.delete(id);
    }
    const requestId = randomToken(18);
    this.requests.set(requestId, {
      clientId: client.clientId,
      clientName: client.clientName,
      redirectUri: redirect,
      codeChallenge: challenge,
      state: query.get("state") ?? undefined,
      resource,
      scopes,
      expiresAt: now + REQUEST_TTL_MS
    });
    return { ok: true, requestId, clientName: client.clientName, scopes, redirectHost: new URL(redirect).host, resource };
  }

  /** Annulla una richiesta appena aperta (per esempio: nessun account con quel nome). */
  dropRequest(requestId: string) {
    this.requests.delete(requestId);
  }

  pendingConsent(requestId: string, now = this.now()) {
    const request = this.requests.get(requestId);
    if (!request || request.expiresAt <= now) return null;
    return { requestId, clientName: request.clientName, scopes: request.scopes, redirectHost: new URL(request.redirectUri).host, decided: Boolean(request.decision), resource: request.resource };
  }

  /**
   * Decisione della persona nell'app. Per un connettore remoto l'approvazione porta il permesso
   * cloud creato dall'app (`cloud`), che resta legato ai token di questa concessione. `approver` è
   * l'hash del segreto del browser che decide: con quel segreto si revoca questa concessione.
   */
  decide(requestId: string, approve: boolean, scopes: readonly string[], now = this.now(), cloud?: CloudGrantRecord, approver?: string): { ok: true; redirectTo: string } | { ok: false; error: string } {
    const request = this.requests.get(requestId);
    if (!request || request.expiresAt <= now) return { ok: false, error: "Richiesta di accesso scaduta." };
    if (request.decision) return { ok: false, error: "Richiesta già decisa." };
    if (approve && this.isCloudResource(request.resource) && !cloud) return { ok: false, error: "Per il connettore remoto serve il permesso sul cloud: fai l'accesso al tuo account in StudyOS e riprova." };
    if (!approve) {
      request.decision = { approve: false, scopes: [] };
      request.redirectTo = this.redirect(request, { error: "access_denied" });
      return { ok: true, redirectTo: request.redirectTo };
    }
    const granted = dataScopes(scopes.length ? scopes : request.scopes, request.scopes);
    request.decision = {
      approve: true,
      scopes: granted,
      ...(this.isCloudResource(request.resource) && cloud ? { cloud: { ...cloud } } : {}),
      ...(approver ? { approver } : {})
    };
    const code = randomToken(32);
    request.code = code;
    this.codes.set(code, { request, scopes: granted, expiresAt: now + CODE_TTL_MS, used: false });
    request.redirectTo = this.redirect(request, { code });
    return { ok: true, redirectTo: request.redirectTo };
  }

  /** Solo la pagina che ha aperto /authorize (cookie) può leggere l'URL di ritorno, che contiene il code. */
  resultFor(requestId: string, now = this.now()): { state: "pending" } | { state: "ready"; redirectTo: string } | null {
    const request = this.requests.get(requestId);
    if (!request || request.expiresAt <= now) return null;
    if (!request.redirectTo) return { state: "pending" };
    return { state: "ready", redirectTo: request.redirectTo };
  }

  async exchange(form: URLSearchParams, now = this.now()): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; error: string; status: number }> {
    this.prune(now);
    const grant = form.get("grant_type");
    const clientId = form.get("client_id") ?? "";
    const client = this.clients.get(clientId);
    if (!client) return { ok: false, status: 401, error: "invalid_client" };
    // resource è facoltativo; se c'è deve indicare lo stesso indirizzo della concessione.
    const asked = form.get("resource");
    const target = asked ? this.resolveResource(asked) : undefined;
    if (target === null) return { ok: false, status: 400, error: "invalid_target" };
    if (grant === "authorization_code") return this.exchangeCode(form, client, now, target);
    if (grant === "refresh_token") return this.exchangeRefresh(form, client, now, target);
    return { ok: false, status: 400, error: "unsupported_grant_type" };
  }

  /** Token valido per `resource` (di base /mcp): un token di un connettore non apre gli altri. */
  async authenticate(token: string, now = this.now(), resource = this.canonical): Promise<TokenActor | null> {
    this.prune(now);
    const record = this.access.get(await sha256Base64Url(token));
    if (!record || record.expiresAt <= now || record.resource !== resource) return null;
    if (this.isCloudResource(record.resource) && !record.cloud) return null;
    return {
      name: record.clientName,
      source: "oauth",
      scopes: record.scopes,
      clientId: record.clientId,
      resource: record.resource,
      ...(record.cloud ? { cloud: { ...record.cloud } } : {})
    };
  }

  /** «Scollega tutti» in StudyOS: token, consensi e client di tutti; ogni connettore si registra di nuovo. */
  revokeAll() {
    this.access.clear();
    this.refresh.clear();
    this.codes.clear();
    this.requests.clear();
    this.clients.clear();
  }

  /**
   * «Revoca gli accessi approvati da questo browser»: toglie solo le concessioni approvate con il
   * segreto il cui hash è `approver` (token, codici, consensi già decisi) e i client rimasti senza
   * niente. Le concessioni senza approvatore (di prima, o di un browser senza segreto) restano e si
   * contano in `legacy`: per toglierle serve `revokeAll`. `cloudOnly` = solo i connettori remoti.
   * Il nome dell'account non conta: chiunque può dichiararlo.
   */
  revokeApprover(approver: string, cloudOnly = false): { revoked: number; legacy: number } {
    this.prune();
    const inScope = (resource: string) => !cloudOnly || this.isCloudResource(resource);
    const touched = new Set<string>();
    const revoked = new Set<string>();
    const legacy = new Set<string>();
    for (const store of [this.access, this.refresh] as Array<Map<string, AccessRecord>>) {
      for (const [hash, record] of store) {
        if (!inScope(record.resource)) continue;
        const grant = record.family ?? hash;
        if (record.approver === approver) {
          store.delete(hash);
          touched.add(record.clientId);
          revoked.add(grant);
        } else if (!record.approver) {
          legacy.add(grant);
        }
      }
    }
    for (const [code, stored] of this.codes) {
      if (!inScope(stored.request.resource) || stored.request.decision?.approver !== approver) continue;
      this.codes.delete(code);
      touched.add(stored.request.clientId);
    }
    for (const [id, request] of this.requests) {
      if (!inScope(request.resource) || request.decision?.approver !== approver) continue;
      this.requests.delete(id);
      touched.add(request.clientId);
    }
    const busy = this.busyClients();
    for (const clientId of touched) if (!busy.has(clientId)) this.clients.delete(clientId);
    return { revoked: revoked.size, legacy: legacy.size };
  }

  /** RFC 7009: revoca un access o refresh token e il resto della stessa concessione. Esito sempre ok. */
  async revokeToken(raw: string, clientId?: string) {
    if (!raw) return;
    const hash = await sha256Base64Url(raw);
    const record = this.access.get(hash) ?? this.refresh.get(hash);
    if (!record || (clientId && record.clientId !== clientId)) return;
    this.access.delete(hash);
    this.refresh.delete(hash);
    if (!record.family) return;
    for (const [key, item] of this.access) if (item.family === record.family) this.access.delete(key);
    for (const [key, item] of this.refresh) if (item.family === record.family) this.refresh.delete(key);
  }

  private async exchangeCode(form: URLSearchParams, client: OAuthClient, now: number, target: string | undefined) {
    const code = form.get("code") ?? "";
    const stored = this.codes.get(code);
    if (!stored || stored.used || stored.expiresAt <= now || stored.request.clientId !== client.clientId) {
      return { ok: false as const, status: 400, error: "invalid_grant" };
    }
    if (target && target !== stored.request.resource) return { ok: false as const, status: 400, error: "invalid_target" };
    const redirect = safeRedirectUri(form.get("redirect_uri") ?? "");
    if (redirect !== stored.request.redirectUri) return { ok: false as const, status: 400, error: "invalid_grant" };
    const verifier = form.get("code_verifier") ?? "";
    const challenge = await sha256Base64Url(verifier);
    if (!timingSafeEqual(challenge, stored.request.codeChallenge)) return { ok: false as const, status: 400, error: "invalid_grant" };
    stored.used = true;
    this.codes.delete(code);
    return { ok: true as const, body: await this.issue(client, stored.scopes, now, randomToken(8), stored.request.resource, stored.request.decision?.cloud, stored.request.decision?.approver) };
  }

  private async exchangeRefresh(form: URLSearchParams, client: OAuthClient, now: number, target: string | undefined) {
    const raw = form.get("refresh_token") ?? "";
    const hash = await sha256Base64Url(raw);
    const stored = this.refresh.get(hash);
    if (!stored || stored.expiresAt <= now || stored.clientId !== client.clientId) return { ok: false as const, status: 400, error: "invalid_grant" };
    if (target && target !== (stored.resource || this.canonical)) return { ok: false as const, status: 400, error: "invalid_target" };
    this.refresh.delete(hash);
    return { ok: true as const, body: await this.issue(client, stored.scopes, now, stored.family, stored.resource || this.canonical, stored.cloud, stored.approver) };
  }

  private async issue(client: OAuthClient, scopes: AgentDataScope[], now: number, family: string, resource: string, cloud?: CloudGrantRecord, approver?: string) {
    const access = randomToken(32);
    const refresh = randomToken(32);
    const record: AccessRecord = {
      clientId: client.clientId,
      clientName: client.clientName,
      scopes,
      resource,
      expiresAt: now + ACCESS_TTL_MS,
      family,
      ...(cloud ? { cloud: { ...cloud } } : {}),
      ...(approver ? { approver } : {})
    };
    this.access.set(await sha256Base64Url(access), record);
    this.refresh.set(await sha256Base64Url(refresh), { ...record, expiresAt: now + REFRESH_TTL_MS, family });
    const registered = this.clients.get(client.clientId);
    if (registered && !registered.usedAt) this.clients.set(client.clientId, { ...registered, usedAt: new Date(now).toISOString() });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: Math.floor(ACCESS_TTL_MS / 1000),
      refresh_token: refresh,
      scope: scopes.join(" ")
    };
  }

  private redirect(request: AuthRequest, params: Record<string, string>) {
    const url = new URL(request.redirectUri);
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (request.state) url.searchParams.set("state", request.state);
    // RFC 9207: il client controlla che la risposta arrivi dall'issuer con cui ha iniziato.
    url.searchParams.set("iss", this.issuer);
    return url.toString();
  }

  private prune(now = this.now()) {
    for (const [id, request] of this.requests) if (request.expiresAt <= now) this.requests.delete(id);
    for (const [code, stored] of this.codes) if (stored.expiresAt <= now || stored.used) this.codes.delete(code);
    for (const [hash, record] of this.access) if (record.expiresAt <= now) this.access.delete(hash);
    for (const [hash, record] of this.refresh) if (record.expiresAt <= now) this.refresh.delete(hash);
    const busy = this.busyClients();
    for (const [id, client] of this.clients) {
      if (!client.usedAt && !busy.has(id) && !(now - Date.parse(client.createdAt) < UNUSED_CLIENT_TTL_MS)) this.clients.delete(id);
    }
  }

  /** Client con un token, un consenso o un codice ancora validi (dopo `prune`). */
  private busyClients() {
    const busy = new Set<string>();
    for (const record of this.access.values()) busy.add(record.clientId);
    for (const record of this.refresh.values()) busy.add(record.clientId);
    for (const request of this.requests.values()) busy.add(request.clientId);
    for (const stored of this.codes.values()) busy.add(stored.request.clientId);
    return busy;
  }
}
