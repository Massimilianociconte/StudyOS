import test from "node:test";
import assert from "node:assert/strict";
import { HttpHub } from "../src/agent/httpHub.ts";
import { sha256Base64Url } from "../src/agent/oauth.ts";

// «Revoca» in Impostazioni → Agenti: ogni persona toglie solo gli accessi che ha dato lei.
// Scollegare tutti è una scelta a parte (scope "all").

const origin = "https://studyos-agent.esempio.workers.dev";
const key = "chiave-di-prova-lunga-abbastanza";
const site = { "content-type": "application/json", origin: "https://massimilianociconte.github.io" };
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const SECRET = "d".repeat(64);
const MAX = { id: "browser_massimiliano", name: "Massimiliano Ciconte" };
const CAMILLA = { id: "browser_camilla_tel", name: "Camilla Rossi" };

const makeHub = () => new HttpHub({
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
  cloud: { run: async (_grant, name) => ({ ok: true, data: { done: name } }) }
});

const ask = (hub, path, options = {}) => hub.handle(new Request(`${origin}${path}`, options));
const pair = async (hub) => (await (await ask(hub, "/pair", { method: "POST", headers: site, body: JSON.stringify({ code: key }) })).json()).token;
const bridge = (hub, path, body) => ask(hub, path, { method: "POST", headers: site, body: JSON.stringify(body) })
  .then((response) => response.json().then((json) => ({ status: response.status, json })));
const listTools = (hub, path, token) => ask(hub, path, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} })
}).then((response) => response.status);

const register = async (hub, name) => (await (await ask(hub, "/register", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ client_name: name, redirect_uris: [redirect] })
})).json()).client_id;

const startAuthorize = async (hub, clientId, resource) => {
  const verifier = "v".repeat(20) + Math.random().toString(36).slice(2).padEnd(30, "x");
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: await sha256Base64Url(verifier),
    code_challenge_method: "S256",
    scope: "studyos:read studyos:write",
    resource
  });
  const response = await ask(hub, `/authorize?${query}`);
  return { status: response.status, verifier, cookie: (response.headers.get("set-cookie") ?? "").split(";")[0] };
};

/**
 * Collega un client: /authorize, il browser `browser` ritira e decide il consenso, poi /token.
 * `browser` null = app di prima, che decide senza dire chi è (`poller` ritira la richiesta).
 */
const connect = async (hub, bridgeToken, { name, browser, poller = browser ?? MAX, resource = `${origin}/mcp` }) => {
  const clientId = await register(hub, name);
  const begun = await startAuthorize(hub, clientId, resource);
  assert.equal(begun.status, 200);
  const job = await bridge(hub, "/bridge/poll", { token: bridgeToken, browser: poller });
  assert.equal(job.json.type, "consent", JSON.stringify(job.json));
  const cloud = resource === `${origin}/mcp` ? {} : { cloud: { secret: SECRET, timeZone: "Europe/Rome" } };
  const decided = await bridge(hub, "/oauth/decide", {
    token: bridgeToken,
    requestId: job.json.requestId,
    approve: true,
    scopes: ["studyos:read", "studyos:write"],
    ...(browser ? { browser } : {}),
    ...cloud
  });
  assert.equal(decided.status, 200, JSON.stringify(decided.json));
  const waited = await (await ask(hub, "/oauth/wait", { headers: { cookie: begun.cookie } })).json();
  const code = new URL(waited.redirectTo).searchParams.get("code");
  const token = await ask(hub, "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: begun.verifier }).toString()
  }).then((response) => response.json());
  assert.ok(token.access_token, JSON.stringify(token));
  return { clientId, access: token.access_token, refresh: token.refresh_token };
};

const clientExists = (hub, clientId) => hub.exportState().oauth.clients.some((client) => client.clientId === clientId);

const setup = async () => {
  const hub = makeHub();
  const token = await pair(hub);
  // Entrambi i browser si presentano all'hub (così l'hub conosce i loro account).
  await Promise.all([bridge(hub, "/bridge/poll", { token, browser: MAX }), bridge(hub, "/bridge/poll", { token, browser: CAMILLA })]);
  return { hub, token };
};

test("revoca: Camilla toglie solo i suoi assistenti, quelli di Massimiliano restano", async () => {
  const { hub, token } = await setup();
  const maxGpt = await connect(hub, token, { name: "ChatGPT di Max", browser: MAX });
  const camillaClaude = await connect(hub, token, { name: "Claude di Camilla", browser: CAMILLA });
  const idle = await register(hub, "Registrato e mai usato");

  const revoked = await bridge(hub, "/oauth/revoke", { token, browser: CAMILLA });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
  assert.equal(revoked.json.scope, "account");
  assert.equal(revoked.json.revoked, 1);
  assert.equal(revoked.json.legacy, 0);

  assert.equal(await listTools(hub, "/mcp", camillaClaude.access), 401, "l'assistente di Camilla perde l'accesso");
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 200, "quello di Massimiliano no");
  // Anche il refresh di Camilla non vale più.
  const refreshed = await ask(hub, "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: camillaClaude.clientId, refresh_token: camillaClaude.refresh }).toString()
  });
  assert.notEqual(refreshed.status, 200);
  // Il client di Camilla, rimasto senza niente, sparisce; gli altri restano.
  assert.equal(clientExists(hub, camillaClaude.clientId), false);
  assert.equal(clientExists(hub, maxGpt.clientId), true);
  assert.equal(clientExists(hub, idle), true, "un client di altri, anche senza token, non si tocca");

  // L'account resta lo stesso dopo un riavvio dell'hub (stato salvato).
  const restarted = makeHub();
  restarted.importState(hub.exportState());
  await bridge(restarted, "/bridge/poll", { token, browser: MAX });
  const again = await bridge(restarted, "/oauth/revoke", { token, browser: MAX });
  assert.equal(again.json.revoked, 1);
  assert.equal(await listTools(restarted, "/mcp", maxGpt.access), 401);
});

test("revoca: un browser a vault chiuso (senza nome) revoca per l'account che l'hub già conosce", async () => {
  const { hub, token } = await setup();
  const camillaClaude = await connect(hub, token, { name: "Claude di Camilla", browser: CAMILLA });
  const maxGpt = await connect(hub, token, { name: "ChatGPT di Max", browser: MAX });
  const revoked = await bridge(hub, "/oauth/revoke", { token, browser: { id: CAMILLA.id } });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.json.revoked, 1);
  assert.equal(await listTools(hub, "/mcp", camillaClaude.access), 401);
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 200);
});

test("revoca: gli accessi di prima, senza account, restano e la risposta li conta; «tutti» li toglie", async () => {
  const { hub, token } = await setup();
  const legacy = await connect(hub, token, { name: "ChatGPT di prima", browser: null });
  const camillaClaude = await connect(hub, token, { name: "Claude di Camilla", browser: CAMILLA });
  const maxGpt = await connect(hub, token, { name: "ChatGPT di Max", browser: MAX });

  const mine = await bridge(hub, "/oauth/revoke", { token, browser: CAMILLA });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.revoked, 1);
  assert.equal(mine.json.legacy, 1, "un accesso di prima non si sa di chi è: resta, e la risposta lo dice");
  assert.equal(await listTools(hub, "/mcp", legacy.access), 200);
  assert.equal(await listTools(hub, "/mcp", camillaClaude.access), 401);

  const everyone = await bridge(hub, "/oauth/revoke", { token, browser: CAMILLA, scope: "all" });
  assert.equal(everyone.status, 200);
  assert.equal(everyone.json.scope, "all");
  assert.equal(await listTools(hub, "/mcp", legacy.access), 401);
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 401);
  assert.deepEqual(hub.exportState().oauth.clients, []);
});

test("revoca: senza dire chi è (app di prima) non toglie niente a nessuno", async () => {
  const { hub, token } = await setup();
  const maxGpt = await connect(hub, token, { name: "ChatGPT di Max", browser: MAX });
  const refused = await bridge(hub, "/oauth/revoke", { token });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /Ricarica/);
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 200);
  const unknown = await bridge(hub, "/oauth/revoke", { token, browser: { id: "browser_mai_visto" } });
  assert.equal(unknown.status, 409);
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 200);
  const wrongKey = await bridge(hub, "/oauth/revoke", { token: "sbagliato", browser: MAX, scope: "all" });
  assert.equal(wrongKey.status, 401);
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 200);
});

test("revoca del connettore remoto: toglie solo il remoto di quell'account, anche quello di prima", async () => {
  const { hub, token } = await setup();
  const camillaUrl = `${origin}/u/camilla-rossi/mcp`;
  const maxUrl = `${origin}/u/massimiliano-ciconte/mcp`;
  const camillaRemote = await connect(hub, token, { name: "ChatGPT remoto", browser: CAMILLA, resource: camillaUrl });
  // Consenso remoto dato da un'app di prima: l'indirizzo dice comunque di chi è.
  const camillaRemoteOld = await connect(hub, token, { name: "ChatGPT remoto vecchio", browser: null, poller: CAMILLA, resource: camillaUrl });
  const camillaMain = await connect(hub, token, { name: "Claude di Camilla", browser: CAMILLA });
  const maxRemote = await connect(hub, token, { name: "ChatGPT remoto di Max", browser: MAX, resource: maxUrl });

  const remote = await bridge(hub, "/oauth/revoke", { token, browser: CAMILLA, scope: "cloud" });
  assert.equal(remote.status, 200);
  assert.equal(remote.json.scope, "cloud");
  assert.equal(remote.json.revoked, 2);
  assert.equal(remote.json.legacy, 0);
  assert.equal(await listTools(hub, "/u/camilla-rossi/mcp", camillaRemote.access), 401);
  assert.equal(await listTools(hub, "/u/camilla-rossi/mcp", camillaRemoteOld.access), 401);
  assert.equal(await listTools(hub, "/mcp", camillaMain.access), 200, "il connettore principale di Camilla resta");
  assert.equal(await listTools(hub, "/u/massimiliano-ciconte/mcp", maxRemote.access), 200, "il remoto di Max resta");

  // La revoca dell'account toglie anche il suo remoto e la richiesta remota ancora aperta.
  const pendingClient = await register(hub, "In attesa");
  const pending = await startAuthorize(hub, pendingClient, camillaUrl);
  assert.equal(pending.status, 200);
  const all = await bridge(hub, "/oauth/revoke", { token, browser: CAMILLA });
  assert.equal(all.json.revoked, 1);
  assert.equal(await listTools(hub, "/mcp", camillaMain.access), 401);
  const job = await bridge(hub, "/bridge/poll", { token, browser: CAMILLA });
  assert.equal(job.json.type, "idle", "la richiesta remota aperta per Camilla non arriva più");
  assert.equal(await listTools(hub, "/u/massimiliano-ciconte/mcp", maxRemote.access), 200);
});
