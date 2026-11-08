// Hub locale di StudyOS: MCP su stdio e su HTTP, OAuth per ChatGPT/Claude, ponte verso l'app.
// I dati restano nel browser. Questo processo non legge IndexedDB e non scrive i segreti nel repository.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_HUB_ORIGIN, AGENT_MCP_PATH, AGENT_PORT, AGENT_SERVER_VERSION } from "../src/agent/constants";
import { choosePoller, siteFromOrigin, type BridgeSite } from "../src/agent/hubEndpoint";
import { ResultLedger } from "../src/agent/ledger";
import { handleMcpRpc } from "../src/agent/mcp";
import { toolSummary } from "../src/agent/catalog";
import { OauthServer, randomToken, timingSafeEqual, type PersistedOauth } from "../src/agent/oauth";
import type { AgentActor, AgentCallResult } from "../src/agent/types";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HOME = join(homedir(), ".studyos");
const SECRETS_PATH = join(HOME, "agent.json");
const OAUTH_PATH = join(HOME, "oauth.json");
const PUBLIC_ORIGIN = (process.env.STUDYOS_PUBLIC_ORIGIN ?? "").replace(/\/+$/, "");
const CANONICAL = `${PUBLIC_ORIGIN || AGENT_HUB_ORIGIN}${AGENT_MCP_PATH}`;
const APP_ORIGIN = process.env.STUDYOS_APP_ORIGIN ?? "";

interface Secrets {
  bridgeToken: string;
  serviceToken: string;
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

const ledger = new ResultLedger();
const oauth = new OauthServer(CANONICAL);
let secrets: Secrets = { bridgeToken: "", serviceToken: "" };
let pairCode = "";
let pairExpires = 0;
let pairFailures = 0;
let pairLockedUntil = 0;
const calls: CallJob[] = [];
const consents: ConsentJob[] = [];
const finishers = new Map<string, (result: AgentCallResult) => void>();
const pollers: Array<{ site: BridgeSite; resolve: (job: Job | null) => void }> = [];
let lastSeen = 0;
let publishedSeen = 0;

const log = (message: string) => {
  if (process.argv.includes("--stdio")) return;
  process.stderr.write(`[studyos-agent] ${message}\n`);
};

const connected = () => Date.now() - lastSeen < 45_000;

const allowHost = (host: string | undefined) => {
  if (!host) return false;
  const normalized = host.toLowerCase();
  const local = [`127.0.0.1:${AGENT_PORT}`, `localhost:${AGENT_PORT}`];
  if (local.includes(normalized)) return true;
  if (!PUBLIC_ORIGIN) return false;
  try {
    return new URL(PUBLIC_ORIGIN).host.toLowerCase() === normalized;
  } catch {
    return false;
  }
};

const allowOrigin = (origin: string | undefined, mcp: boolean) => {
  if (!origin) return mcp;
  if (origin === AGENT_HUB_ORIGIN || origin === `http://localhost:${AGENT_PORT}`) return true;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return true;
  if (origin === "https://massimilianociconte.github.io") return true;
  if (APP_ORIGIN && origin === APP_ORIGIN) return true;
  if (PUBLIC_ORIGIN && origin === PUBLIC_ORIGIN) return true;
  if (mcp && /^https:\/\/([a-z0-9-]+\.)?(chatgpt\.com|chat\.openai\.com|claude\.ai|claude\.com)$/.test(origin)) return true;
  return false;
};

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[char] ?? char);

const readBody = (req: IncomingMessage, limit = 262_144) => new Promise<string>((resolve, reject) => {
  const chunks: Buffer[] = [];
  let size = 0;
  req.on("data", (chunk: Buffer) => {
    size += chunk.length;
    if (size > limit) {
      reject(new Error("payload"));
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  req.on("error", reject);
});

const send = (res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}) => {
  const payload = typeof body === "string" ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/html; charset=utf-8" : "application/json; charset=utf-8", "cache-control": "no-store", ...extra });
  res.end(payload);
};

const cors = (req: IncomingMessage, res: ServerResponse) => {
  const origin = req.headers.origin;
  if (origin && allowOrigin(origin, false)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-private-network", "true");
  }
};

const cookie = (req: IncomingMessage, name: string) => {
  const header = req.headers.cookie ?? "";
  const match = header.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : "";
};

const headerOrigin = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

const wake = () => {
  if (pollers.length === 0) return;
  const job = consents[0] ?? calls[0];
  if (!job) return;
  const chosen = choosePoller(pollers, Date.now() - publishedSeen < 45_000);
  if (!chosen) return;
  if (consents[0]) consents.shift();
  else calls.shift();
  const index = pollers.indexOf(chosen);
  if (index >= 0) pollers.splice(index, 1);
  chosen.resolve(job);
};

const enqueueCall = (job: CallJob) => {
  calls.push(job);
  wake();
};

const bearer = (req: IncomingMessage) => {
  const header = req.headers.authorization ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1]?.trim() ?? "";
};

const actorFor = async (token: string): Promise<AgentActor | null> => {
  if (token && timingSafeEqual(token, secrets.serviceToken)) {
    return { name: "Client locale", source: "stdio", scopes: ["studyos:read", "studyos:write"] };
  }
  const remote = await oauth.authenticate(token);
  if (!remote) return null;
  return { name: remote.name, source: "oauth", scopes: remote.scopes };
};

const bridgeAuthorized = (token: string) => Boolean(token) && timingSafeEqual(token, secrets.bridgeToken);

const finishCall = (id: string, result: AgentCallResult) => {
  ledger.remember(id, result);
  const finish = finishers.get(id);
  if (!finish) return;
  finishers.delete(id);
  finish(result);
};

const invoke = (call: { id: string; name: string; args: Record<string, unknown>; actor: AgentActor }) => new Promise<AgentCallResult>((resolve) => {
  let settled = false;
  const timer = setTimeout(() => {
    finish({
      ok: true,
      data: {
        status: "pending_approval",
        approvalId: call.id,
        message: "L'azione è in attesa della conferma in StudyOS. Non ripeterla: chiama studyos_approval_status con questo approvalId."
      }
    });
  }, 110_000);
  const finish = (result: AgentCallResult) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    ledger.remember(call.id, result);
    finishers.delete(call.id);
    resolve(result);
  };
  finishers.set(call.id, finish);
  enqueueCall({ type: "call", id: call.id, name: call.name, args: call.args, actor: call.actor, summary: toolSummary(call.name, call.args) });
});

const metadata = () => ({
  issuer: PUBLIC_ORIGIN || AGENT_HUB_ORIGIN,
  authorization_endpoint: `${PUBLIC_ORIGIN || AGENT_HUB_ORIGIN}/authorize`,
  token_endpoint: `${PUBLIC_ORIGIN || AGENT_HUB_ORIGIN}/token`,
  registration_endpoint: `${PUBLIC_ORIGIN || AGENT_HUB_ORIGIN}/register`,
  revocation_endpoint: `${PUBLIC_ORIGIN || AGENT_HUB_ORIGIN}/revoke`,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none"],
  scopes_supported: ["studyos:read", "studyos:write", "offline_access"],
  service_documentation: "https://massimilianociconte.github.io/StudyOS/"
});

const authorizePage = (requestId: string, clientName: string) => `<!doctype html>
<meta charset="utf-8">
<title>Collega StudyOS</title>
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
    if (body.connected === false) status.textContent = "StudyOS non risulta collegato. Aprilo, vai in Impostazioni → Agenti e inserisci il codice del terminale.";
    setTimeout(tick, 1000);
  };
  tick();
</script>`;

const handle = async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", AGENT_HUB_ORIGIN);
  const origin = req.headers.origin;
  const mcp = url.pathname === AGENT_MCP_PATH;
  if (!allowHost(req.headers.host)) {
    send(res, 421, { error: "Host non ammesso." });
    return;
  }
  if (origin && !allowOrigin(origin, mcp)) {
    send(res, 403, { error: "Origine non ammessa." });
    return;
  }
  if (req.method === "OPTIONS") {
    const allowed = headerOrigin(origin);
    const headers: Record<string, string> = {
      "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
      "access-control-allow-headers": "authorization, content-type, accept, access-control-request-private-network",
      "access-control-allow-private-network": "true",
      "access-control-max-age": "600"
    };
    if (allowed && allowOrigin(allowed, mcp)) {
      headers["access-control-allow-origin"] = allowed;
      headers.vary = "Origin";
    }
    res.writeHead(204, headers);
    res.end();
    return;
  }
  cors(req, res);

  if (req.method === "GET" && url.pathname === "/health") {
    send(res, 200, { ok: true, service: "studyos-agent", version: AGENT_SERVER_VERSION, bridgeConnected: connected(), publicOrigin: PUBLIC_ORIGIN || null });
    return;
  }
  if (req.method === "GET" && (url.pathname === "/.well-known/oauth-protected-resource" || url.pathname === "/.well-known/oauth-protected-resource/mcp")) {
    send(res, 200, {
      resource: CANONICAL,
      authorization_servers: [PUBLIC_ORIGIN || AGENT_HUB_ORIGIN],
      scopes_supported: ["studyos:read", "studyos:write", "offline_access"],
      bearer_methods_supported: ["header"]
    });
    return;
  }
  if (req.method === "GET" && (url.pathname === "/.well-known/oauth-authorization-server" || url.pathname === "/.well-known/openid-configuration")) {
    send(res, 200, metadata());
    return;
  }
  if (req.method === "POST" && url.pathname === "/register") {
    const created = oauth.register(JSON.parse(await readBody(req) || "{}"));
    if (!created.ok) {
      send(res, created.status, { error: created.error });
      return;
    }
    await saveOauth();
    send(res, 201, { client_id: created.client.clientId, client_name: created.client.clientName, redirect_uris: created.client.redirectUris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
    return;
  }
  if (req.method === "GET" && url.pathname === "/authorize") {
    const begun = oauth.beginAuthorization(url.searchParams);
    if (!begun.ok) {
      send(res, 400, `<!doctype html><meta charset="utf-8"><title>StudyOS</title><p>${escapeHtml(begun.description)}</p>`, { "content-type": "text/html; charset=utf-8" });
      return;
    }
    consents.push({ type: "consent", requestId: begun.requestId, clientName: begun.clientName, scopes: begun.scopes, redirectHost: begun.redirectHost });
    wake();
    const secure = (PUBLIC_ORIGIN || "").startsWith("https://") ? "; Secure" : "";
    send(res, 200, authorizePage(begun.requestId, begun.clientName), { "set-cookie": `studyos_oauth=${encodeURIComponent(begun.requestId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600${secure}` });
    return;
  }
  if (req.method === "GET" && url.pathname === "/oauth/wait") {
    const requestId = cookie(req, "studyos_oauth");
    const result = requestId ? oauth.resultFor(requestId) : null;
    if (!requestId || !result) {
      send(res, 200, { state: "missing" });
      return;
    }
    if (result.state === "ready") {
      send(res, 200, result, { "set-cookie": "studyos_oauth=; HttpOnly; Path=/; Max-Age=0" });
      return;
    }
    send(res, 200, { state: "pending", connected: connected() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/token") {
    const raw = await readBody(req);
    const form = new URLSearchParams(req.headers["content-type"]?.includes("application/json") ? "" : raw);
    if (req.headers["content-type"]?.includes("application/json")) {
      const json = JSON.parse(raw || "{}") as Record<string, string>;
      for (const [key, value] of Object.entries(json)) if (typeof value === "string") form.set(key, value);
    }
    const exchanged = await oauth.exchange(form);
    if (!exchanged.ok) {
      send(res, exchanged.status, { error: exchanged.error });
      return;
    }
    await saveOauth();
    send(res, 200, exchanged.body);
    return;
  }
  if (req.method === "POST" && url.pathname === "/pair") {
    if (Date.now() < pairLockedUntil) {
      send(res, 429, { error: "Troppi tentativi. Attendi qualche minuto." });
      return;
    }
    const body = JSON.parse(await readBody(req) || "{}") as { code?: string };
    const code = (body.code ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!pairCode || Date.now() > pairExpires || !timingSafeEqual(code, pairCode)) {
      pairFailures += 1;
      if (pairFailures >= 8) pairLockedUntil = Date.now() + 10 * 60_000;
      send(res, 401, { error: "Codice non valido o scaduto. Riavvia npm run agent e usa il codice nuovo." });
      return;
    }
    pairCode = "";
    pairFailures = 0;
    send(res, 200, { token: secrets.bridgeToken });
    return;
  }
  if (req.method === "POST" && (url.pathname === "/bridge/poll" || url.pathname === "/bridge/heartbeat" || url.pathname === "/bridge/result" || url.pathname === "/oauth/decide" || url.pathname === "/oauth/revoke")) {
    const body = JSON.parse(await readBody(req) || "{}") as { token?: string; id?: string; result?: AgentCallResult; requestId?: string; approve?: boolean; scopes?: string[] };
    if (!bridgeAuthorized(body.token ?? "")) {
      send(res, 401, { error: "Collegamento non riconosciuto." });
      return;
    }
    lastSeen = Date.now();
    if (siteFromOrigin(headerOrigin(origin)) === "published") publishedSeen = Date.now();
    if (url.pathname === "/bridge/heartbeat") {
      send(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/bridge/result") {
      if (!body.id || !body.result) {
        send(res, 400, { error: "Manca l'esito." });
        return;
      }
      finishCall(body.id, body.result);
      send(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/oauth/decide") {
      const decided = oauth.decide(body.requestId ?? "", body.approve === true, body.scopes ?? []);
      if (!decided.ok) {
        send(res, 400, { error: decided.error });
        return;
      }
      await saveOauth();
      send(res, 200, { ok: true });
      return;
    }
    if (url.pathname === "/oauth/revoke") {
      oauth.revokeAll();
      await saveOauth();
      send(res, 200, { ok: true });
      return;
    }
    const job = await new Promise<Job | null>((resolve) => {
      const entry = { site: siteFromOrigin(headerOrigin(origin)), resolve };
      pollers.push(entry);
      wake();
      setTimeout(() => {
        const index = pollers.indexOf(entry);
        if (index >= 0) {
          pollers.splice(index, 1);
          resolve(null);
        }
      }, 20_000);
    });
    send(res, 200, job ?? { type: "idle" });
    return;
  }

  if (url.pathname === AGENT_MCP_PATH) {
    if (req.method === "GET" || req.method === "DELETE") {
      send(res, req.method === "DELETE" ? 204 : 405, req.method === "DELETE" ? "" : { error: "Usa POST. Il server risponde in JSON." });
      return;
    }
    if (req.method !== "POST") {
      send(res, 405, { error: "Metodo non ammesso." });
      return;
    }
    const token = bearer(req);
    const actor = await actorFor(token);
    if (!actor) {
      const metadataUrl = `${PUBLIC_ORIGIN || AGENT_HUB_ORIGIN}/.well-known/oauth-protected-resource/mcp`;
      res.writeHead(401, {
        "www-authenticate": `Bearer realm="studyos", resource_metadata="${metadataUrl}"`,
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store"
      });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(await readBody(req) || "null");
    } catch {
      send(res, 400, { jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON non valido." } });
      return;
    }
    const response = await handleMcpRpc(message, { actor, ledger, connected, invoke });
    if (!response) {
      res.writeHead(202);
      res.end();
      return;
    }
    const accept = req.headers.accept ?? "";
    if (accept.includes("text/event-stream") && !accept.includes("application/json")) {
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      res.end(`event: message\ndata: ${JSON.stringify(response)}\n\n`);
      return;
    }
    send(res, 200, response);
    return;
  }
  send(res, 404, { error: "Non trovato." });
};

const saveOauth = async () => {
  await writeFile(OAUTH_PATH, JSON.stringify(oauth.dump()), { mode: 0o600 });
  await chmod(OAUTH_PATH, 0o600);
};

const loadSecrets = async () => {
  await mkdir(HOME, { recursive: true, mode: 0o700 });
  await chmod(HOME, 0o700).catch(() => undefined);
  try {
    const parsed = JSON.parse(await readFile(SECRETS_PATH, "utf8")) as Secrets;
    if (parsed.bridgeToken && parsed.serviceToken) secrets = parsed;
    else throw new Error("incomplete");
  } catch {
    secrets = { bridgeToken: randomToken(32), serviceToken: randomToken(32) };
    await writeFile(SECRETS_PATH, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(SECRETS_PATH, 0o600);
  }
  try {
    oauth.load(JSON.parse(await readFile(OAUTH_PATH, "utf8")) as PersistedOauth);
  } catch {
    // primo avvio: nessun client OAuth
  }
};

const runHub = async () => {
  await loadSecrets();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  pairCode = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  pairExpires = Date.now() + 15 * 60_000;
  const shown = `${pairCode.slice(0, 4)}-${pairCode.slice(4)}`;
  const server = createServer((req, res) => {
    handle(req, res).catch((error) => {
      const message = error instanceof Error && error.message === "payload" ? "Richiesta troppo grande." : "Errore interno.";
      if (!res.headersSent) send(res, error instanceof Error && error.message === "payload" ? 413 : 500, { error: message });
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "EADDRINUSE") {
        reject(new Error("La porta 47321 è già occupata. Chiudi l'altro npm run agent e riprova."));
        return;
      }
      reject(error);
    });
    server.listen(AGENT_PORT, "127.0.0.1", () => resolve());
  });
  process.stderr.write([
    "",
    "StudyOS agenti",
    `MCP: ${CANONICAL}`,
    `Codice di collegamento (15 minuti, un solo uso): ${shown}`,
    "In StudyOS apri Impostazioni → Agenti e incolla il codice.",
    PUBLIC_ORIGIN ? `Origine pubblica: ${PUBLIC_ORIGIN}` : "Per ChatGPT sul web servi un tunnel HTTPS verso questa porta e STUDYOS_PUBLIC_ORIGIN.",
    ""
  ].join("\n"));
};

const frame = (message: unknown) => {
  const json = Buffer.from(JSON.stringify(message));
  return Buffer.concat([Buffer.from(`Content-Length: ${json.length}\r\n\r\n`), json]);
};

let stdinBuffer = Buffer.alloc(0);
let stdinReader: { resolve: (value: unknown) => void; reject: (error: Error) => void } | null = null;
let stdinError: Error | null = null;
let stdinBound = false;

const takeFrame = () => {
  const headerEnd = stdinBuffer.indexOf("\r\n\r\n");
  if (headerEnd === -1) return undefined;
  const header = stdinBuffer.subarray(0, headerEnd).toString("utf8");
  const match = /Content-Length:\s*(\d+)/i.exec(header);
  if (!match) throw new Error("Messaggio MCP senza Content-Length.");
  const length = Number(match[1]);
  if (!Number.isFinite(length) || length < 0 || length > 1_000_000) throw new Error("Content-Length non valido.");
  const start = headerEnd + 4;
  if (stdinBuffer.length < start + length) return undefined;
  const json = stdinBuffer.subarray(start, start + length).toString("utf8");
  stdinBuffer = stdinBuffer.subarray(start + length);
  return JSON.parse(json) as unknown;
};

const deliverStdin = () => {
  if (!stdinReader) return;
  try {
    const message = takeFrame();
    if (message === undefined) return;
    const reader = stdinReader;
    stdinReader = null;
    reader.resolve(message);
  } catch (error) {
    const reader = stdinReader;
    stdinReader = null;
    reader.reject(error instanceof Error ? error : new Error("Messaggio MCP non valido."));
  }
};

const bindStdin = () => {
  if (stdinBound) return;
  stdinBound = true;
  process.stdin.on("data", (chunk: Buffer) => {
    stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
    deliverStdin();
  });
  process.stdin.on("end", () => {
    stdinReader?.resolve(null);
    stdinReader = null;
  });
  process.stdin.on("error", (error: Error) => {
    stdinError = error;
    stdinReader?.reject(error);
    stdinReader = null;
  });
  process.stdin.resume();
};

const readFrame = () => new Promise<unknown>((resolve, reject) => {
  bindStdin();
  if (stdinError) {
    reject(stdinError);
    return;
  }
  try {
    const message = takeFrame();
    if (message !== undefined) {
      resolve(message);
      return;
    }
  } catch (error) {
    reject(error instanceof Error ? error : new Error("Messaggio MCP non valido."));
    return;
  }
  stdinReader = { resolve, reject };
});

const ensureHub = async () => {
  const healthy = async () => {
    try {
      const response = await fetch(`${AGENT_HUB_ORIGIN}/health`);
      return response.ok;
    } catch {
      return false;
    }
  };
  if (await healthy()) return;
  const child = spawn(process.execPath, ["--import", join(ROOT, "scripts/lib/register-ts.mjs"), join(ROOT, "scripts/agent.ts"), "--hub"], {
    cwd: ROOT,
    detached: true,
    stdio: ["ignore", "ignore", "pipe"]
  });
  child.stderr?.on("data", (chunk: Buffer) => process.stderr.write(chunk));
  child.unref();
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await healthy()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error("Il collegamento agenti non si avvia. Esegui npm run agent e controlla che la porta 47321 sia libera.");
};

const runStdio = async () => {
  await ensureHub();
  await loadSecrets();
  for (;;) {
    const message = await readFrame();
    if (!message) return;
    const response = await fetch(`${AGENT_HUB_ORIGIN}${AGENT_MCP_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        authorization: `Bearer ${secrets.serviceToken}`
      },
      body: JSON.stringify(message)
    });
    if (response.status === 202) continue;
    const body = await response.json();
    process.stdout.write(frame(body));
  }
};

const mode = process.argv.includes("--hub") ? "hub" : process.argv.includes("--stdio") || !process.stdin.isTTY ? "stdio" : "hub";
if (mode === "hub") {
  runHub().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Avvio non riuscito."}\n`);
    process.exit(1);
  });
} else {
  runStdio().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Client MCP non collegato."}\n`);
    process.exit(1);
  });
}
