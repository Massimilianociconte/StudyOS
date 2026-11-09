// Hub locale di StudyOS: MCP su stdio e su HTTP, OAuth per ChatGPT/Claude, ponte verso l'app.
// I dati restano nel browser. Questo processo non legge IndexedDB e non scrive i segreti nel repository.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { spawn } from "node:child_process";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_HUB_ORIGIN, AGENT_MCP_PATH, AGENT_PORT } from "../src/agent/constants";
import { HttpHub, type HubSnapshot } from "../src/agent/httpHub";
import type { PersistedOauth } from "../src/agent/oauth";

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

const issuer = PUBLIC_ORIGIN || AGENT_HUB_ORIGIN;
const hub = new HttpHub({
  issuer,
  canonical: CANONICAL,
  secureCookies: issuer.startsWith("https://"),
  pairMode: "code",
  disconnectedHint: "StudyOS non risulta collegato. Aprilo, vai in Impostazioni → Agenti e inserisci il codice del terminale.",
  allowHost: (host) => {
    const normalized = host.toLowerCase();
    if ([`127.0.0.1:${AGENT_PORT}`, `localhost:${AGENT_PORT}`].includes(normalized)) return true;
    if (!PUBLIC_ORIGIN) return false;
    try {
      return new URL(PUBLIC_ORIGIN).host.toLowerCase() === normalized;
    } catch {
      return false;
    }
  },
  allowOrigin: (origin, mcp) => {
    if (!origin) return mcp;
    if (origin === AGENT_HUB_ORIGIN || origin === `http://localhost:${AGENT_PORT}`) return true;
    if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return true;
    if (origin === "https://massimilianociconte.github.io") return true;
    if (APP_ORIGIN && origin === APP_ORIGIN) return true;
    if (PUBLIC_ORIGIN && origin === PUBLIC_ORIGIN) return true;
    if (mcp && /^https:\/\/([a-z0-9-]+\.)?(chatgpt\.com|chat\.openai\.com|claude\.ai|claude\.com|grok\.com|x\.ai)$/.test(origin)) return true;
    return false;
  },
  persist: async () => {
    const snapshot = hub.exportState();
    secrets = { bridgeToken: snapshot.bridgeToken, serviceToken: snapshot.serviceToken };
    await writeFile(OAUTH_PATH, JSON.stringify(snapshot.oauth), { mode: 0o600 });
    await chmod(OAUTH_PATH, 0o600);
    await writeFile(SECRETS_PATH, JSON.stringify(secrets), { mode: 0o600 });
    await chmod(SECRETS_PATH, 0o600);
  }
});
let secrets: Secrets = { bridgeToken: "", serviceToken: "" };

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

const nodeToRequest = async (req: IncomingMessage) => {
  const host = req.headers.host ?? `127.0.0.1:${AGENT_PORT}`;
  const url = `http://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) value.forEach((item) => headers.append(key, item));
  }
  const method = req.method ?? "GET";
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await readBody(req) : undefined;
  return new Request(url, { method, headers, body });
};

const writeNodeResponse = async (res: ServerResponse, response: Response) => {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, key) => {
    if (key === "set-cookie") return;
    headers[key] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length) headers["set-cookie"] = cookies;
  const body = response.status === 204 ? Buffer.alloc(0) : Buffer.from(await response.arrayBuffer());
  res.writeHead(response.status, headers);
  res.end(body);
};

const loadSecrets = async () => {
  await mkdir(HOME, { recursive: true, mode: 0o700 });
  await chmod(HOME, 0o700).catch(() => undefined);
  let loaded: Secrets | null = null;
  let oauthState: PersistedOauth | null = null;
  try {
    const parsed = JSON.parse(await readFile(SECRETS_PATH, "utf8")) as Secrets;
    if (parsed.bridgeToken && parsed.serviceToken) loaded = parsed;
  } catch {
    // primo avvio
  }
  try {
    oauthState = JSON.parse(await readFile(OAUTH_PATH, "utf8")) as PersistedOauth;
  } catch {
    // primo avvio: nessun client OAuth
  }
  if (loaded) {
    const snapshot: HubSnapshot = {
      issuer,
      bridgeToken: loaded.bridgeToken,
      serviceToken: loaded.serviceToken,
      oauth: oauthState ?? { clients: [], access: [], refresh: [] },
      ledger: [],
      pairFailures: 0,
      pairLockedUntil: 0
    };
    hub.importState(snapshot);
  }
  const exported = hub.exportState();
  secrets = { bridgeToken: exported.bridgeToken, serviceToken: exported.serviceToken };
  await writeFile(SECRETS_PATH, JSON.stringify(secrets), { mode: 0o600 });
  await chmod(SECRETS_PATH, 0o600);
  await writeFile(OAUTH_PATH, JSON.stringify(exported.oauth), { mode: 0o600 });
  await chmod(OAUTH_PATH, 0o600);
};

const runHub = async () => {
  await loadSecrets();
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  const pairCode = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
  hub.armPairCode(pairCode, Date.now() + 15 * 60_000);
  const shown = `${pairCode.slice(0, 4)}-${pairCode.slice(4)}`;
  const server = createServer((req, res) => {
    nodeToRequest(req)
      .then((request) => hub.handle(request))
      .then((response) => writeNodeResponse(res, response))
      .catch((error) => {
        const payload = error instanceof Error && error.message === "payload";
        if (!res.headersSent) {
          res.writeHead(payload ? 413 : 500, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
          res.end(JSON.stringify({ error: payload ? "Richiesta troppo grande." : "Errore interno." }));
        } else res.end();
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
    PUBLIC_ORIGIN ? `Origine pubblica: ${PUBLIC_ORIGIN}` : "ChatGPT usa il sito pubblicato, non questo programma. Qui servi solo localhost e i client locali.",
    ""
  ].join("\n"));
};

// MCP su stdio: un messaggio JSON per riga. Il vecchio framing Content-Length resta accettato e riceve risposte nello stesso formato.
let stdinBuffer = Buffer.alloc(0);
let legacyFraming = false;
const STDIN_LIMIT = 1_000_000;

const send = (message: unknown) => {
  const json = JSON.stringify(message);
  process.stdout.write(legacyFraming ? `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}` : `${json}\n`);
};

const rpcFailure = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

/** Prossimo messaggio completo dal buffer di stdin, o undefined se ne manca ancora una parte. */
const takeMessage = (): string | undefined => {
  let skip = 0;
  while (skip < stdinBuffer.length && [0x0a, 0x0d, 0x20, 0x09].includes(stdinBuffer[skip])) skip += 1;
  if (skip) stdinBuffer = stdinBuffer.subarray(skip);
  if (!stdinBuffer.length) return undefined;
  const first = stdinBuffer[0];
  if (first === 0x43 || first === 0x63) {
    legacyFraming = true;
    const headerEnd = stdinBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      if (stdinBuffer.length > 1024) throw new Error("Intestazione MCP non valida.");
      return undefined;
    }
    const match = /Content-Length:\s*(\d+)/i.exec(stdinBuffer.subarray(0, headerEnd).toString("utf8"));
    const length = match ? Number(match[1]) : Number.NaN;
    if (!Number.isFinite(length) || length > STDIN_LIMIT) throw new Error("Content-Length non valido.");
    const begin = headerEnd + 4;
    if (stdinBuffer.length < begin + length) return undefined;
    const json = stdinBuffer.subarray(begin, begin + length).toString("utf8");
    stdinBuffer = stdinBuffer.subarray(begin + length);
    return json;
  }
  const newline = stdinBuffer.indexOf(0x0a);
  if (newline === -1) {
    if (stdinBuffer.length > STDIN_LIMIT) throw new Error("Messaggio MCP troppo grande.");
    return undefined;
  }
  const line = stdinBuffer.subarray(0, newline).toString("utf8").trim();
  stdinBuffer = stdinBuffer.subarray(newline + 1);
  return line;
};

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

/** Il proxy stdio legge soltanto la chiave del programma agenti: non la crea e non la riscrive. */
const readSecrets = async () => {
  const parsed = JSON.parse(await readFile(SECRETS_PATH, "utf8")) as Partial<Secrets>;
  if (!parsed.serviceToken || !parsed.bridgeToken) throw new Error("Chiave del programma agenti mancante. Esegui npm run agent una volta e riprova.");
  secrets = { bridgeToken: parsed.bridgeToken, serviceToken: parsed.serviceToken };
};

const postToHub = (raw: string) => fetch(`${AGENT_HUB_ORIGIN}${AGENT_MCP_PATH}`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    accept: "application/json",
    authorization: `Bearer ${secrets.serviceToken}`
  },
  body: raw
});

const forward = async (raw: string) => {
  let message: unknown;
  try {
    message = JSON.parse(raw);
  } catch {
    send(rpcFailure(null, -32700, "JSON non valido."));
    return;
  }
  const id = message && typeof message === "object" && !Array.isArray(message) ? (message as { id?: unknown }).id : undefined;
  let response: Response;
  try {
    response = await postToHub(raw);
  } catch {
    // Il programma agenti si è chiuso: lo riavvia una volta e ripete.
    try {
      await ensureHub();
      await readSecrets();
      response = await postToHub(raw);
    } catch {
      if (id !== undefined) send(rpcFailure(id, -32603, "Il programma agenti non risponde. Avvia npm run agent e riprova."));
      return;
    }
  }
  if (response.status === 202) return;
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (body && body.jsonrpc === "2.0") {
    send(body);
    return;
  }
  if (id === undefined) return;
  send(rpcFailure(id, -32603, response.status === 401
    ? "Il programma agenti usa un'altra chiave. Riavvia npm run agent e il client MCP."
    : `Il programma agenti ha risposto con HTTP ${response.status}.`));
};

const runStdio = async () => {
  await ensureHub();
  await readSecrets();
  const inflight = new Set<Promise<void>>();
  // Ogni richiesta parte subito: una conferma in attesa non blocca ping, letture o annullamenti.
  process.stdin.on("data", (chunk: Buffer) => {
    stdinBuffer = Buffer.concat([stdinBuffer, chunk]);
    for (;;) {
      let raw: string | undefined;
      try {
        raw = takeMessage();
      } catch (error) {
        stdinBuffer = Buffer.alloc(0);
        send(rpcFailure(null, -32700, error instanceof Error ? error.message : "Messaggio MCP non valido."));
        return;
      }
      if (raw === undefined) return;
      if (!raw) continue;
      const task = forward(raw).finally(() => inflight.delete(task));
      inflight.add(task);
    }
  });
  await new Promise<void>((resolve) => {
    process.stdin.once("end", () => resolve());
    process.stdin.once("close", () => resolve());
  });
  await Promise.allSettled([...inflight]);
  process.exit(0);
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
