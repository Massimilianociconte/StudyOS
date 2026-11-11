import test from "node:test";
import assert from "node:assert/strict";
import { cloudPathOf, cloudSlug } from "../src/agent/accounts.ts";
import { CLOUD_UNAVAILABLE } from "../src/agent/catalog.ts";
import { HttpHub } from "../src/agent/httpHub.ts";
import { OauthServer, sha256Base64Url } from "../src/agent/oauth.ts";

const origin = "https://studyos-agent.esempio.workers.dev";
const key = "chiave-di-prova-lunga-abbastanza";
const site = { "content-type": "application/json", origin: "https://massimilianociconte.github.io" };
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const SECRET = "c".repeat(64);
const MAX = { id: "browser_massimiliano", name: "Massimiliano Ciconte" };
const CAMILLA = { id: "browser_camilla_tel", name: "Camilla Rossi" };

const fakeRunner = () => {
  const calls = [];
  return {
    calls,
    run: async (grant, name, args) => {
      calls.push({ grant, name, args });
      return { ok: true, data: { done: name } };
    }
  };
};

const makeHub = (cloud) => new HttpHub({
  issuer: origin,
  canonical: `${origin}/mcp`,
  secureCookies: true,
  pairMode: "key",
  pairKey: key,
  disconnectedHint: "Apri StudyOS.",
  approvalWaitMs: 2000,
  approvalPollMs: 2000,
  pollWaitMs: 150,
  allowHost: (host) => host === "studyos-agent.esempio.workers.dev",
  allowOrigin: (value, mcp) => !value || value === "https://massimilianociconte.github.io" || mcp,
  ...(cloud ? { cloud } : {})
});

const ask = (hub, path, options = {}) => hub.handle(new Request(`${origin}${path}`, options));
const pair = async (hub) => (await (await ask(hub, "/pair", { method: "POST", headers: site, body: JSON.stringify({ code: key }) })).json()).token;
const bridge = (hub, path, body) => ask(hub, path, { method: "POST", headers: site, body: JSON.stringify(body) }).then((response) => response.json().then((json) => ({ status: response.status, json })));
const rpc = (hub, path, token, method, params = {}) => ask(hub, path, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })
});
const toolText = async (response) => JSON.parse((await response.json()).result.content[0].text);

const register = async (hub) => (await (await ask(hub, "/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: "ChatGPT", redirect_uris: [redirect] })
})).json()).client_id;

const authorize = async (hub, clientId, resource) => {
  const verifier = "v".repeat(20) + Math.random().toString(36).slice(2).padEnd(30, "x");
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: "S256",
    scope: "studyos:read studyos:write",
    state: "stato",
    resource
  });
  const response = await ask(hub, `/authorize?${query}`);
  const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
  return { response, verifier, cookie, html: await response.text() };
};

const exchange = async (hub, form) => ask(hub, "/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(form).toString()
}).then((response) => response.json().then((json) => ({ status: response.status, json })));

test("connettore remoto: indirizzo per account e resource OAuth", () => {
  assert.equal(cloudSlug("Camilla%20Rossi"), "camilla-rossi");
  assert.equal(cloudSlug("Camilla-Rossì"), "camilla-rossi");
  assert.equal(cloudSlug("%E0%A4%A"), null);
  assert.deepEqual(cloudPathOf("/u/camilla-rossi/mcp"), { slug: "camilla-rossi", query: "camilla rossi" });
  assert.equal(cloudPathOf("/u/camilla-rossi/altro"), null);
  assert.equal(cloudPathOf("/u//mcp"), null);
  const oauth = new OauthServer(`${origin}/mcp`);
  assert.equal(oauth.resolveResource(""), `${origin}/mcp`);
  assert.equal(oauth.resolveResource(origin), `${origin}/mcp`);
  assert.equal(oauth.resolveResource(`${origin}/u/Camilla%20Rossi/mcp`), `${origin}/u/camilla-rossi/mcp`);
  assert.equal(oauth.resolveResource(`${origin}/u/camilla-rossi/mcp/`), `${origin}/u/camilla-rossi/mcp`);
  assert.equal(oauth.resolveResource("https://altro.example/u/camilla-rossi/mcp"), null);
  assert.equal(oauth.resolveResource(`${origin}/u/camilla-rossi/mcp?x=1`), null);
});

test("connettore remoto: consenso solo a Camilla, token legato al suo indirizzo e al permesso cloud", async () => {
  const runner = fakeRunner();
  const hub = makeHub(runner);
  const token = await pair(hub);
  // Entrambi i browser si presentano all'hub.
  await Promise.all([bridge(hub, "/bridge/poll", { token, browser: MAX }), bridge(hub, "/bridge/poll", { token, browser: CAMILLA })]);

  const camillaUrl = `${origin}/u/camilla-rossi/mcp`;
  const unauthorized = await rpc(hub, "/u/camilla-rossi/mcp", "", "tools/list");
  assert.equal(unauthorized.status, 401);
  assert.match(unauthorized.headers.get("www-authenticate"), /oauth-protected-resource\/u\/camilla-rossi\/mcp/);
  const metadata = await (await ask(hub, "/.well-known/oauth-protected-resource/u/camilla-rossi/mcp")).json();
  assert.equal(metadata.resource, camillaUrl);
  assert.deepEqual(metadata.authorization_servers, [origin]);

  const clientId = await register(hub);
  const begun = await authorize(hub, clientId, camillaUrl);
  assert.equal(begun.response.status, 200);
  assert.match(begun.html, /StudyOS di <b>Camilla Rossi<\/b>/);

  // Il browser di Massimiliano non riceve la richiesta, quello di Camilla sì.
  const [maxJob, camillaJob] = await Promise.all([
    bridge(hub, "/bridge/poll", { token, browser: MAX }),
    bridge(hub, "/bridge/poll", { token, browser: CAMILLA })
  ]);
  assert.equal(maxJob.json.type, "idle");
  assert.equal(camillaJob.json.type, "consent");
  assert.equal(camillaJob.json.cloud, true);
  assert.equal(camillaJob.json.accountName, "Camilla Rossi");
  const { requestId } = camillaJob.json;

  const noGrant = await bridge(hub, "/oauth/decide", { token, requestId, approve: true, scopes: ["studyos:read", "studyos:write"] });
  assert.equal(noGrant.status, 400);
  const badZone = await bridge(hub, "/oauth/decide", { token, requestId, approve: true, scopes: ["studyos:read"], cloud: { secret: SECRET, timeZone: "Marte/Base" } });
  assert.equal(badZone.status, 400);
  const decided = await bridge(hub, "/oauth/decide", {
    token, requestId, approve: true, scopes: ["studyos:read", "studyos:write"], cloud: { secret: SECRET, timeZone: "Europe/Rome" }
  });
  assert.equal(decided.status, 200);

  const waited = await (await ask(hub, "/oauth/wait", { headers: { cookie: begun.cookie } })).json();
  assert.equal(waited.state, "ready");
  const code = new URL(waited.redirectTo).searchParams.get("code");
  const wrongTarget = await exchange(hub, { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: begun.verifier, resource: `${origin}/mcp` });
  assert.equal(wrongTarget.json.error, "invalid_target");
  const issued = await exchange(hub, { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: begun.verifier, resource: camillaUrl });
  assert.equal(issued.status, 200, JSON.stringify(issued.json));
  const access = issued.json.access_token;

  // Il token di Camilla non apre il connettore principale né quello di un altro account.
  assert.equal((await rpc(hub, "/mcp", access, "tools/list")).status, 401);
  assert.equal((await rpc(hub, "/u/massimiliano-ciconte/mcp", access, "tools/list")).status, 401);

  const listed = await (await rpc(hub, "/u/camilla-rossi/mcp", access, "tools/list")).json();
  const names = listed.result.tools.map((tool) => tool.name);
  for (const name of CLOUD_UNAVAILABLE) assert.ok(!names.includes(name), name);
  assert.ok(names.includes("studyos_create_task"));
  assert.ok(listed.result.tools.every((tool) => !("account" in (tool.inputSchema.properties ?? {}))));
  assert.ok(listed.result.tools.every((tool) => !tool.description.includes("studyos_list_shared_items")));
  const init = await (await rpc(hub, "/u/camilla-rossi/mcp", access, "initialize", { protocolVersion: "2025-06-18" })).json();
  assert.match(init.result.instructions, /StudyOS di Camilla Rossi/);
  assert.match(init.result.instructions, /anche con StudyOS chiuso/);

  // Nessun browser deve essere aperto: la chiamata va al runner con il permesso della concessione.
  const created = await toolText(await rpc(hub, "/u/camilla-rossi/mcp", access, "tools/call", { name: "studyos_create_task", arguments: { title: "Ripasso", account: "Altro" } }));
  assert.equal(created.ok, true);
  assert.equal(created.data.account, "Camilla Rossi");
  assert.deepEqual(runner.calls.at(-1), { grant: { secret: SECRET, timeZone: "Europe/Rome" }, name: "studyos_create_task", args: runner.calls.at(-1).args });
  assert.equal(runner.calls.at(-1).args.title, "Ripasso");
  assert.equal("account" in runner.calls.at(-1).args, false);
  const shared = await toolText(await rpc(hub, "/u/camilla-rossi/mcp", access, "tools/call", { name: "studyos_share_with", arguments: {} }));
  assert.equal(shared.code, "invalid");

  // Il refresh ruota i token e tiene indirizzo e permesso.
  const refreshed = await exchange(hub, { grant_type: "refresh_token", client_id: clientId, refresh_token: issued.json.refresh_token });
  assert.equal(refreshed.status, 200);
  const again = await toolText(await rpc(hub, "/u/camilla-rossi/mcp", refreshed.json.access_token, "tools/call", { name: "studyos_list_tasks", arguments: {} }));
  assert.equal(again.ok, true);
  assert.equal(runner.calls.at(-1).grant.secret, SECRET);

  // Lo snapshot del Durable Object conserva la concessione.
  const restored = makeHub(runner);
  restored.importState(hub.exportState());
  const after = await toolText(await rpc(restored, "/u/camilla-rossi/mcp", refreshed.json.access_token, "tools/call", { name: "studyos_status", arguments: {} }));
  assert.equal(after.ok, true);
  assert.equal(after.data.account, "Camilla Rossi");
});

test("connettore remoto: account sconosciuto, hub senza cloud, sola lettura", async () => {
  const runner = fakeRunner();
  const hub = makeHub(runner);
  const token = await pair(hub);
  await bridge(hub, "/bridge/poll", { token, browser: CAMILLA });
  const clientId = await register(hub);
  const unknown = await authorize(hub, clientId, `${origin}/u/giulia-bianchi/mcp`);
  assert.equal(unknown.response.status, 404);
  assert.match(unknown.html, /Nessun account collegato si chiama/);

  const plain = makeHub(null);
  const plainClient = await register(plain);
  const off = await authorize(plain, plainClient, `${origin}/u/camilla-rossi/mcp`);
  assert.equal(off.response.status, 501);
  assert.equal((await rpc(plain, "/u/camilla-rossi/mcp", "x", "tools/list")).status, 404);
  assert.equal((await ask(plain, "/.well-known/oauth-protected-resource/u/camilla-rossi/mcp")).status, 404);

  // Concessione di sola lettura: le modifiche si fermano nell'hub.
  const begun = await authorize(hub, clientId, `${origin}/u/camilla/mcp`);
  assert.equal(begun.response.status, 200, "camilla da sola trova Camilla Rossi");
  const job = await bridge(hub, "/bridge/poll", { token, browser: CAMILLA });
  await bridge(hub, "/oauth/decide", { token, requestId: job.json.requestId, approve: true, scopes: ["studyos:read"], cloud: { secret: SECRET, timeZone: "Europe/Rome" } });
  const waited = await (await ask(hub, "/oauth/wait", { headers: { cookie: begun.cookie } })).json();
  const issued = await exchange(hub, { grant_type: "authorization_code", client_id: clientId, code: new URL(waited.redirectTo).searchParams.get("code"), redirect_uri: redirect, code_verifier: begun.verifier });
  const denied = await toolText(await rpc(hub, "/u/camilla/mcp", issued.json.access_token, "tools/call", { name: "studyos_create_task", arguments: { title: "No" } }));
  assert.equal(denied.code, "denied");
  assert.equal(runner.calls.length, 0);
  const read = await toolText(await rpc(hub, "/u/camilla/mcp", issued.json.access_token, "tools/call", { name: "studyos_list_tasks", arguments: {} }));
  assert.equal(read.ok, true);
});
