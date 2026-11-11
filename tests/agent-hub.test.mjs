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
  clock.now = Date.now();
  const agent = hub();
  const register = (name = "x") => ask(agent, "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ redirect_uris: ["https://attacker.example/cb"], client_name: name })
  });
  for (let index = 0; index < 50; index += 1) assert.equal((await register()).status, 201);
  // Il 51° prende il posto del client fermo più vecchio (prima: 400 per sempre).
  const extra = await register();
  assert.equal(extra.status, 201);
  assert.equal(agent.exportState().oauth.clients.length, 50);

  // Una pioggia di /authorize con lo stesso client: al massimo 5 consensi in coda, mai di più.
  const clientId = (await extra.json()).client_id;
  const authorize = (id) => ask(agent, `/authorize?${new URLSearchParams({
    client_id: id, redirect_uri: "https://attacker.example/cb", response_type: "code", code_challenge: "x".repeat(43), code_challenge_method: "S256"
  })}`);
  const first = await authorize(clientId);
  assert.equal(first.status, 200);
  assert.match(first.headers.get("set-cookie") ?? "", /Max-Age=300;/);
  for (let index = 0; index < 30; index += 1) assert.equal((await authorize(clientId)).status, 200);
  assert.ok(agent.consents.length <= 5, `consensi in coda: ${agent.consents.length}`);

  // In tutto al massimo 20 consensi aperti: oltre, 429 finché i vecchi non scadono.
  const others = [];
  for (let index = 0; index < 4; index += 1) others.push((await (await register()).json()).client_id);
  for (const id of others) for (let index = 0; index < 5; index += 1) await authorize(id);
  const refused = await authorize((await (await register()).json()).client_id);
  assert.equal(refused.status, 429);
  assert.match(await refused.text(), /Troppe richieste di accesso/);

  const token = await pairBrowser(agent);
  const delivered = [];
  for (;;) {
    const job = await (await ask(agent, "/bridge/poll", { method: "POST", headers: site, body: JSON.stringify({ token }) })).json();
    if (job.type !== "consent") break;
    delivered.push(job);
  }
  assert.equal(delivered.length, 20);

  // «Revoca gli accessi» nell'app toglie anche i client registrati.
  const revoked = await ask(agent, "/oauth/revoke", { method: "POST", headers: site, body: JSON.stringify({ token }) });
  assert.equal(revoked.status, 200);
  assert.equal(agent.exportState().oauth.clients.length, 0);
  assert.equal((await register()).status, 201);
});
