import test from "node:test";
import assert from "node:assert/strict";
import { HttpHub } from "../src/agent/httpHub.ts";

const origin = "https://studyos-agent.esempio.workers.dev";
const key = "chiave-di-prova-lunga-abbastanza";

const clock = { now: Date.now() };

const hub = () => new HttpHub({
  issuer: origin,
  canonical: `${origin}/mcp`,
  secureCookies: true,
  pairMode: "key",
  pairKey: key,
  disconnectedHint: "Apri StudyOS.",
  approvalWaitMs: 40,
  approvalPollMs: 2000,
  pollWaitMs: 40,
  now: () => clock.now,
  allowHost: (host) => host === "studyos-agent.esempio.workers.dev",
  allowOrigin: (value, mcp) => !value || value === "https://massimilianociconte.github.io" || mcp
});

const ask = (instance, path, options = {}) => instance.handle(new Request(`${origin}${path}`, options));

test("hub pubblico: rifiuta host e origine, accetta la chiave e risponde a ChatGPT senza il browser", async () => {
  const agent = hub();
  const foreign = await agent.handle(new Request("https://evil.example/health"));
  assert.equal(foreign.status, 421);

  const blocked = await ask(agent, "/health", { headers: { origin: "https://evil.example" } });
  assert.equal(blocked.status, 403);

  const health = await ask(agent, "/health", { headers: { origin: "https://massimilianociconte.github.io" } });
  assert.equal(health.status, 200);
  assert.equal(health.headers.get("access-control-allow-origin"), "https://massimilianociconte.github.io");
  const body = await health.json();
  assert.equal(body.mcp, `${origin}/mcp`);
  assert.equal(body.bridgeConnected, false);

  const status = await ask(agent, "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${agent.serviceToken}`
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "studyos_status", arguments: {} }
    })
  });
  assert.equal(status.status, 200);
  const offline = JSON.parse((await status.json()).result.content[0].text);
  assert.equal(offline.data.connected, false);
  assert.match(offline.data.message, /github\.io\/StudyOS/);

  const wrong = await ask(agent, "/pair", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://massimilianociconte.github.io" },
    body: JSON.stringify({ code: "chiave-sbagliata-ma-lunga" })
  });
  assert.equal(wrong.status, 401);

  const paired = await ask(agent, "/pair", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://massimilianociconte.github.io" },
    body: JSON.stringify({ code: key })
  });
  assert.equal(paired.status, 200);
  const token = (await paired.json()).token;
  assert.equal(typeof token, "string");
  assert.equal(token.length >= 20, true);

  const idle = await ask(agent, "/bridge/poll", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://massimilianociconte.github.io" },
    body: JSON.stringify({ token })
  });
  assert.equal(idle.status, 200);
  assert.equal((await idle.json()).type, "idle");

  const anonymous = await ask(agent, "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} })
  });
  assert.equal(anonymous.status, 401);
  assert.match(anonymous.headers.get("www-authenticate") ?? "", /resource_metadata=/);

  const listed = await ask(agent, "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${agent.serviceToken}`
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" })
  });
  assert.equal(listed.status, 200);
  const tools = await listed.json();
  assert.equal(Array.isArray(tools.result.tools), true);
  assert.equal(tools.result.tools.some((tool) => tool.name === "studyos_status"), true);

  const discovered = await ask(agent, "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${agent.serviceToken}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover"
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "discover-1",
      method: "server/discover",
      params: { _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } }
    })
  });
  assert.equal(discovered.status, 200);
  assert.match(discovered.headers.get("content-type") ?? "", /^application\/json/);
  const discovery = await discovered.json();
  assert.equal(discovery.result.supportedVersions.includes("2026-07-28"), true);

  const unsupported = await ask(agent, "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${agent.serviceToken}`,
      "mcp-protocol-version": "2099-01-01",
      "mcp-method": "server/discover"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 8, method: "server/discover", params: {} })
  });
  assert.equal(unsupported.status, 400);
  const rejected = await unsupported.json();
  assert.equal(rejected.error.code, -32022);
  assert.equal(rejected.error.data.supported.includes("2026-07-28"), true);

  const missing = await ask(agent, "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${agent.serviceToken}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "inesistente"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 9, method: "inesistente", params: {} })
  });
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, -32601);

  const streamOnly = await ask(agent, "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${agent.serviceToken}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover",
      origin: "https://chatgpt.com"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "discover-sse", method: "server/discover", params: {} })
  });
  assert.equal(streamOnly.status, 200);
  assert.match(streamOnly.headers.get("content-type") ?? "", /^application\/json/);

  const atRoot = await ask(agent, "/", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      authorization: `Bearer ${agent.serviceToken}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover",
      origin: "https://chatgpt.com"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: "discover-root", method: "server/discover", params: {} })
  });
  assert.equal(atRoot.status, 200);
  assert.match(atRoot.headers.get("content-type") ?? "", /^application\/json/);
  assert.equal((await atRoot.json()).result.supportedVersions.includes("2026-07-28"), true);

  const resources = await ask(agent, "/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      authorization: `Bearer ${agent.serviceToken}`,
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "resources/list"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 10, method: "resources/list", params: {} })
  });
  assert.equal(resources.status, 200);
  const resourceBody = await resources.json();
  assert.deepEqual(resourceBody.result.resources, []);
  assert.equal(resourceBody.result.resultType, "complete");
});

const site = { "content-type": "application/json", origin: "https://massimilianociconte.github.io" };
const mcpCall = (instance, id, name, args = {}, headers = {}) => ask(instance, "/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${instance.serviceToken}`, ...headers },
  body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
});
const toolResult = async (response) => JSON.parse((await response.json()).result.content[0].text);
const pairBrowser = async (instance) => {
  const paired = await ask(instance, "/pair", { method: "POST", headers: site, body: JSON.stringify({ code: key }) });
  return (await paired.json()).token;
};

test("hub: Mcp-Name verificato, preflight CORS con le intestazioni MCP, revoca RFC 7009", async () => {
  const agent = hub();
  const mismatch = await mcpCall(agent, 1, "studyos_status", {}, { "mcp-method": "tools/call", "mcp-name": "studyos_delete_task" });
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error.code, -32020);
  const encoded = await mcpCall(agent, 2, "studyos_status", {}, { "mcp-method": "tools/call", "mcp-name": `=?base64?${Buffer.from("studyos_status").toString("base64")}?=` });
  assert.equal(encoded.status, 200);

  const preflight = await ask(agent, "/mcp", {
    method: "OPTIONS",
    headers: {
      origin: "https://claude.ai",
      "access-control-request-method": "POST",
      "access-control-request-headers": "authorization, content-type, mcp-protocol-version, mcp-method, mcp-name, mcp-param-id"
    }
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "https://claude.ai");
  const allowed = preflight.headers.get("access-control-allow-headers");
  for (const header of ["authorization", "mcp-protocol-version", "mcp-method", "mcp-name", "mcp-param-id"]) assert.match(allowed, new RegExp(header));

  const revoked = await ask(agent, "/revoke", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: "sconosciuto", token_type_hint: "access_token" })
  });
  assert.equal(revoked.status, 200);
  const metadata = await (await ask(agent, "/.well-known/oauth-authorization-server")).json();
  assert.equal(metadata.revocation_endpoint, `${origin}/revoke`);
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
});

test("hub: la conferma arriva con approval_status e le azioni mai ritirate scadono", async () => {
  clock.now = Date.now();
  const agent = hub();
  const token = await pairBrowser(agent);
  await ask(agent, "/bridge/poll", { method: "POST", headers: site, body: JSON.stringify({ token }) });

  const pending = await toolResult(await mcpCall(agent, 1, "studyos_create_task", { title: "Ripasso" }));
  assert.equal(pending.data.status, "pending_approval");
  const approvalId = pending.data.approvalId;

  const job = await (await ask(agent, "/bridge/poll", { method: "POST", headers: site, body: JSON.stringify({ token }) })).json();
  assert.equal(job.type, "call");
  assert.equal(job.id, approvalId);
  const waiting = mcpCall(agent, 2, "studyos_approval_status", { approvalId });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const delivered = await ask(agent, "/bridge/result", { method: "POST", headers: site, body: JSON.stringify({ token, id: approvalId, result: { ok: true, data: { id: "task_1" } } }) });
  assert.equal(delivered.status, 200);
  const settled = await toolResult(await waiting);
  assert.equal(settled.ok, true);
  assert.equal(settled.data.id, "task_1");

  const stale = await toolResult(await mcpCall(agent, 3, "studyos_create_task", { title: "Mai ritirata" }));
  assert.equal(stale.data.status, "pending_approval");
  clock.now += 121_000;
  const idle = await (await ask(agent, "/bridge/poll", { method: "POST", headers: site, body: JSON.stringify({ token }) })).json();
  assert.equal(idle.type, "idle");
  const dropped = await toolResult(await mcpCall(agent, 4, "studyos_approval_status", { approvalId: stale.data.approvalId }));
  assert.equal(dropped.ok, false);
  assert.equal(dropped.code, "not_connected");
  clock.now = Date.now();
});

test("hub: /register e /authorize aperti a tutti non si riempiono per sempre", async () => {
  const start = Date.parse("2026-11-12T10:00:00Z");
  clock.now = start;
  const minutes = (value) => value * 60_000;
  const agent = hub();
  const attacker = "https://attacker.example/cb";
  const real = "https://claude.ai/api/mcp/auth_callback";
  const register = async (callback = attacker, name = "x") => ask(agent, "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: [callback], client_name: name })
  });
  const registerId = async (callback, name) => (await (await register(callback, name)).json()).client_id;
  const authorize = (id, callback = attacker) => ask(agent, `/authorize?${new URLSearchParams({
    client_id: id, redirect_uri: callback, response_type: "code", code_challenge: "x".repeat(43), code_challenge_method: "S256"
  })}`);

  // Chiunque riempie i 20 consensi aperti (4 client x 5): chi si collega davvero entra lo stesso,
  // al posto del consenso più vecchio dell'attaccante (prima: 429, rinnovabile per sempre).
  const attackers = [];
  for (let index = 0; index < 4; index += 1) attackers.push(await registerId());
  for (const id of attackers) for (let index = 0; index < 5; index += 1) assert.equal((await authorize(id)).status, 200);
  const legit = await registerId(real, "Assistente vero");
  const first = await authorize(legit, real);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("set-cookie") ?? "", /Max-Age=300;/);

  // Una pioggia di /authorize con lo stesso client: al massimo 5 suoi consensi in coda.
  for (let index = 0; index < 30; index += 1) assert.equal((await authorize(attackers[0])).status, 200);
  assert.ok(agent.consents.length <= 20, `consensi in coda: ${agent.consents.length}`);
  assert.ok(agent.consents.filter((job) => job.clientName === "x").length <= 19);

  // L'attaccante rinnova i suoi prima che scadano: chi riprova dopo entra comunque.
  clock.now = start + minutes(4);
  for (const id of attackers) for (let index = 0; index < 5; index += 1) await authorize(id);
  clock.now = start + minutes(6);
  assert.equal((await authorize(legit, real)).status, 200);

  const token = await pairBrowser(agent);
  const delivered = [];
  for (;;) {
    const job = await (await ask(agent, "/bridge/poll", { method: "POST", headers: site, body: JSON.stringify({ token }) })).json();
    if (job.type !== "consent") break;
    delivered.push(job);
  }
  assert.ok(delivered.length <= 20, `consensi consegnati: ${delivered.length}`);
  assert.ok(delivered.some((job) => job.clientName === "Assistente vero"), "il consenso vero arriva all'app");

  // Registrazioni: un client appena registrato non viene tolto mentre va verso /authorize.
  clock.now = start + minutes(20);
  const fresh = await registerId(real, "Appena registrato");
  for (let index = 0; index < 50; index += 1) await register();
  assert.equal(agent.exportState().oauth.clients.length, 50);
  assert.equal((await authorize(fresh, real)).status, 200);
  // Pieno di client giovani: si rifiuta per poco, poi chi è fermo da più di 2 minuti fa posto.
  assert.equal((await register()).status, 400);
  clock.now = start + minutes(22) + 1;
  assert.equal((await register()).status, 201);
  assert.equal(agent.exportState().oauth.clients.length, 50);
  assert.ok(agent.exportState().oauth.clients.some((client) => client.clientId === fresh), "il client con un consenso aperto resta");

  // «Scollega gli assistenti di tutti» nell'app toglie anche i client registrati. Senza scope e
  // senza dire di quale browser è (app di prima) la revoca non tocca niente.
  const anonymous = await ask(agent, "/oauth/revoke", { method: "POST", headers: site, body: JSON.stringify({ token }) });
  assert.equal(anonymous.status, 400);
  assert.equal(agent.exportState().oauth.clients.length, 50);
  const revoked = await ask(agent, "/oauth/revoke", { method: "POST", headers: site, body: JSON.stringify({ token, scope: "all" }) });
  assert.equal(revoked.status, 200);
  assert.equal(agent.exportState().oauth.clients.length, 0);
  assert.equal((await register()).status, 201);
});

test("hub: il blocco dei tentativi di collegamento conta solo gli ultimi 10 minuti e passa da solo", async () => {
  const start = Date.parse("2026-11-12T10:00:00Z");
  clock.now = start;
  const agent = hub();
  const pair = (code) => ask(agent, "/pair", { method: "POST", headers: site, body: JSON.stringify({ code }) });
  const minutes = (value) => value * 60_000;

  for (let index = 0; index < 8; index += 1) assert.equal((await pair(`sbagliata-${index}`)).status, 401);
  assert.equal((await pair(key)).status, 429, "8 errori in 10 minuti: bloccato, anche con la chiave giusta");

  // Scaduti gli errori, un solo tentativo sbagliato ogni 10 minuti non tiene il blocco per sempre.
  clock.now = start + minutes(10) + 1;
  assert.equal((await pair("ancora-sbagliata")).status, 401);
  assert.equal((await pair(key)).status, 200);

  // Finestra scorrevole: 7 errori, poi l'ottavo 9 minuti dopo blocca; quando i primi 7 escono
  // dalla finestra si torna a collegarsi, senza aspettare altri 10 minuti dall'ultimo.
  clock.now = start + minutes(30);
  for (let index = 0; index < 7; index += 1) assert.equal((await pair(`errore-${index}`)).status, 401);
  clock.now = start + minutes(39);
  assert.equal((await pair("errore-8")).status, 401);
  assert.equal((await pair(key)).status, 429);

  // Lo stato salvato tiene il blocco anche dopo un riavvio dell'hub.
  const saved = agent.exportState();
  const restarted = hub();
  restarted.importState(saved);
  const pairAgain = (code) => ask(restarted, "/pair", { method: "POST", headers: site, body: JSON.stringify({ code }) });
  assert.equal((await pairAgain(key)).status, 429);
  clock.now = start + minutes(40) + 1;
  assert.equal((await pairAgain(key)).status, 200);

  // Uno stato di prima (solo contatore e scadenza del blocco): il blocco dura fino alla scadenza scritta.
  const legacy = hub();
  legacy.importState({ ...saved, pairFailureTimes: undefined, pairFailures: 40, pairLockedUntil: clock.now + minutes(3) });
  const pairLegacy = (code) => ask(legacy, "/pair", { method: "POST", headers: site, body: JSON.stringify({ code }) });
  assert.equal((await pairLegacy(key)).status, 429);
  clock.now += minutes(3) + 1;
  assert.equal((await pairLegacy(key)).status, 200);
  const stale = hub();
  stale.importState({ ...saved, pairFailureTimes: undefined, pairFailures: 40, pairLockedUntil: clock.now - 1 });
  assert.equal((await ask(stale, "/pair", { method: "POST", headers: site, body: JSON.stringify({ code: key }) })).status, 200);
  clock.now = Date.now();
});
