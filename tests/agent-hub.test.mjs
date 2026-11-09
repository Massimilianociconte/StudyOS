import test from "node:test";
import assert from "node:assert/strict";
import { HttpHub } from "../src/agent/httpHub.ts";

const origin = "https://studyos-agent.esempio.workers.dev";
const key = "chiave-di-prova-lunga-abbastanza";

const hub = () => new HttpHub({
  issuer: origin,
  canonical: `${origin}/mcp`,
  secureCookies: true,
  pairMode: "key",
  pairKey: key,
  disconnectedHint: "Apri StudyOS.",
  approvalWaitMs: 40,
  pollWaitMs: 40,
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
});
