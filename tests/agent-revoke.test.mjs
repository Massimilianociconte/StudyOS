import test from "node:test";
import assert from "node:assert/strict";
import { HttpHub } from "../src/agent/httpHub.ts";
import { sha256Base64Url } from "../src/agent/oauth.ts";

// «Revoca gli accessi approvati da questo browser»: l'hub dà a ogni browser un segreto suo (a /pair o
// a /bridge/secret) e lega ogni consenso al suo hash. La revoca toglie solo ciò che quel segreto ha
// approvato: il nome del profilo non basta. Scollegare tutti è una scelta a parte (scope "all").

const origin = "https://studyos-agent.esempio.workers.dev";
const key = "chiave-di-prova-lunga-abbastanza";
const site = { "content-type": "application/json", origin: "https://massimilianociconte.github.io" };
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const CLOUD_SECRET = "d".repeat(64);
const MAX = { id: "browser_massimiliano", name: "Massimiliano Ciconte" };
const CAMILLA = { id: "browser_camilla_tel", name: "Camilla Rossi" };
const SECRET_SHAPE = /^[A-Za-z0-9_-]{43}$/;

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
const pair = async (hub) => (await ask(hub, "/pair", { method: "POST", headers: site, body: JSON.stringify({ code: key }) })).json();
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
 * Collega un client: /authorize, il browser `poller` ritira il consenso e lo approva con il suo
 * segreto (`secret` null = app di prima, che non ne ha uno), poi /token.
 */
const connect = async (hub, bridgeToken, { name, poller, secret, resource = `${origin}/mcp` }) => {
  const clientId = await register(hub, name);
  const begun = await startAuthorize(hub, clientId, resource);
  assert.equal(begun.status, 200);
  const job = await bridge(hub, "/bridge/poll", { token: bridgeToken, browser: poller });
  assert.equal(job.json.type, "consent", JSON.stringify(job.json));
  assert.equal(JSON.stringify(job.json).includes(secret ?? "§"), false, "il segreto non va mai nei lavori");
  const cloud = resource === `${origin}/mcp` ? {} : { cloud: { secret: CLOUD_SECRET, timeZone: "Europe/Rome" } };
  const decided = await bridge(hub, "/oauth/decide", {
    token: bridgeToken,
    requestId: job.json.requestId,
    approve: true,
    scopes: ["studyos:read", "studyos:write"],
    ...(secret ? { secret } : {}),
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

/** Due browser collegati con la chiave: stesso token del ponte, un segreto a testa. */
const setup = async () => {
  const hub = makeHub();
  const max = await pair(hub);
  const camilla = await pair(hub);
  assert.equal(max.token, camilla.token);
  await Promise.all([bridge(hub, "/bridge/poll", { token: max.token, browser: MAX }), bridge(hub, "/bridge/poll", { token: camilla.token, browser: CAMILLA })]);
  return { hub, token: max.token, maxSecret: max.secret, camillaSecret: camilla.secret };
};

test("segreto del browser: lo dà /pair o /bridge/secret, ognuno diverso, e l'hub non lo salva", async () => {
  const { hub, token, maxSecret, camillaSecret } = await setup();
  assert.match(maxSecret, SECRET_SHAPE);
  assert.match(camillaSecret, SECRET_SHAPE);
  assert.notEqual(maxSecret, camillaSecret);
  // Un browser collegato prima riceve il suo con il token del ponte, senza la chiave.
  const later = await bridge(hub, "/bridge/secret", { token });
  assert.equal(later.status, 200);
  assert.match(later.json.secret, SECRET_SHAPE);
  assert.notEqual(later.json.secret, maxSecret);
  assert.equal((await bridge(hub, "/bridge/secret", { token: "sbagliato" })).status, 401);
  await connect(hub, token, { name: "ChatGPT di Max", poller: MAX, secret: maxSecret });
  const saved = JSON.stringify(hub.exportState());
  for (const secret of [maxSecret, camillaSecret, later.json.secret]) assert.equal(saved.includes(secret), false);
  assert.ok(saved.includes(await sha256Base64Url(maxSecret)), "resta solo l'hash, sulla concessione");
});

test("revoca: Camilla toglie solo gli accessi approvati dal suo browser, quelli di Max restano", async () => {
  const { hub, token, maxSecret, camillaSecret } = await setup();
  const maxGpt = await connect(hub, token, { name: "ChatGPT di Max", poller: MAX, secret: maxSecret });
  const camillaClaude = await connect(hub, token, { name: "Claude di Camilla", poller: CAMILLA, secret: camillaSecret });
  const idle = await register(hub, "Registrato e mai usato");

  const revoked = await bridge(hub, "/oauth/revoke", { token, secret: camillaSecret });
  assert.equal(revoked.status, 200, JSON.stringify(revoked.json));
  assert.equal(revoked.json.scope, "browser");
  assert.equal(revoked.json.revoked, 1);
  assert.equal(revoked.json.legacy, 0);

  assert.equal(await listTools(hub, "/mcp", camillaClaude.access), 401, "l'assistente di Camilla perde l'accesso");
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 200, "quello di Max no");
  const refreshed = await ask(hub, "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: camillaClaude.clientId, refresh_token: camillaClaude.refresh }).toString()
  });
  assert.notEqual(refreshed.status, 200);
  assert.equal(clientExists(hub, camillaClaude.clientId), false, "il client rimasto senza niente sparisce");
  assert.equal(clientExists(hub, maxGpt.clientId), true);
  assert.equal(clientExists(hub, idle), true, "un client di altri, anche senza token, non si tocca");

  // Il legame resta dopo un riavvio dell'hub (stato salvato).
  const restarted = makeHub();
  restarted.importState(hub.exportState());
  const again = await bridge(restarted, "/oauth/revoke", { token, secret: maxSecret });
  assert.equal(again.json.revoked, 1);
  assert.equal(await listTools(restarted, "/mcp", maxGpt.access), 401);
});

test("revoca: con il nome di Camilla, Max non toglie niente a lei e non scopre quanti accessi ha", async () => {
  const { hub, token, maxSecret, camillaSecret } = await setup();
  const maxGpt = await connect(hub, token, { name: "ChatGPT di Max", poller: MAX, secret: maxSecret });
  const camillaClaude = await connect(hub, token, { name: "Claude di Camilla", poller: CAMILLA, secret: camillaSecret });
  const camillaOther = await connect(hub, token, { name: "ChatGPT di Camilla", poller: CAMILLA, secret: camillaSecret });

  // Il browser di Max dichiara il nome di Camilla: senza il segreto di lei non succede niente.
  await bridge(hub, "/bridge/poll", { token, browser: { id: MAX.id, name: "Camilla Rossi" } });
  const spoof = await bridge(hub, "/oauth/revoke", { token, browser: { id: MAX.id, name: "Camilla Rossi" }, secret: maxSecret });
  assert.equal(spoof.status, 200);
  assert.equal(spoof.json.revoked, 1, "toglie solo il suo");
  assert.equal(JSON.stringify(spoof.json).includes("2"), false, "non dice quanti accessi ha Camilla");
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 401);
  assert.equal(await listTools(hub, "/mcp", camillaClaude.access), 200);
  assert.equal(await listTools(hub, "/mcp", camillaOther.access), 200);

  // Un segreto nuovo, mai usato per approvare, non toglie niente.
  const fresh = (await bridge(hub, "/bridge/secret", { token })).json.secret;
  const nothing = await bridge(hub, "/oauth/revoke", { token, secret: fresh, browser: CAMILLA });
  assert.equal(nothing.json.revoked, 0);
  assert.equal(await listTools(hub, "/mcp", camillaClaude.access), 200);
  // Il nome o l'id del browser, senza segreto, non bastano.
  const byName = await bridge(hub, "/oauth/revoke", { token, browser: CAMILLA });
  assert.equal(byName.status, 400);
  assert.equal(await listTools(hub, "/mcp", camillaClaude.access), 200);
});

test("revoca: chi cambia nome nel profilo toglie ancora gli accessi che ha approvato", async () => {
  const { hub, token, maxSecret } = await setup();
  const maxGpt = await connect(hub, token, { name: "ChatGPT di Max", poller: MAX, secret: maxSecret });
  await bridge(hub, "/bridge/poll", { token, browser: { id: MAX.id, name: "Max C" } });
  const renamed = await bridge(hub, "/oauth/revoke", { token, secret: maxSecret, browser: { id: MAX.id, name: "Max C" } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.json.revoked, 1);
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 401);
});

test("revoca: gli accessi di prima, senza segreto, restano e si contano; «tutti» li toglie", async () => {
  const { hub, token, maxSecret, camillaSecret } = await setup();
  const legacy = await connect(hub, token, { name: "ChatGPT di prima", poller: MAX, secret: null });
  const legacyRemote = await connect(hub, token, { name: "Remoto di prima", poller: CAMILLA, secret: null, resource: `${origin}/u/camilla-rossi/mcp` });
  const camillaClaude = await connect(hub, token, { name: "Claude di Camilla", poller: CAMILLA, secret: camillaSecret });
  const maxGpt = await connect(hub, token, { name: "ChatGPT di Max", poller: MAX, secret: maxSecret });

  const mine = await bridge(hub, "/oauth/revoke", { token, secret: camillaSecret });
  assert.equal(mine.status, 200);
  assert.equal(mine.json.revoked, 1);
  assert.equal(mine.json.legacy, 2, "gli accessi di prima non dicono chi li ha approvati: restano, e la risposta lo dice");
  assert.equal(await listTools(hub, "/mcp", legacy.access), 200);
  assert.equal(await listTools(hub, "/u/camilla-rossi/mcp", legacyRemote.access), 200, "nemmeno l'indirizzo col nome basta");
  assert.equal(await listTools(hub, "/mcp", camillaClaude.access), 401);

  const everyone = await bridge(hub, "/oauth/revoke", { token, scope: "all" });
  assert.equal(everyone.status, 200);
  assert.equal(everyone.json.scope, "all");
  for (const [path, item] of [["/mcp", legacy], ["/mcp", maxGpt], ["/u/camilla-rossi/mcp", legacyRemote]]) {
    assert.equal(await listTools(hub, path, item.access), 401);
  }
  assert.deepEqual(hub.exportState().oauth.clients, []);
});

test("revoca: un'app di prima (senza segreto) non toglie niente a nessuno; un segreto malformato è rifiutato", async () => {
  const { hub, token, maxSecret } = await setup();
  const maxGpt = await connect(hub, token, { name: "ChatGPT di Max", poller: MAX, secret: maxSecret });
  const old = await bridge(hub, "/oauth/revoke", { token });
  assert.equal(old.status, 400);
  assert.match(old.json.error, /Ricarica/);
  const round0 = await bridge(hub, "/oauth/revoke", { token, browser: MAX });
  assert.equal(round0.status, 400);
  const weak = await bridge(hub, "/oauth/revoke", { token, secret: "corto" });
  assert.equal(weak.status, 400);
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 200);
  const wrongKey = await bridge(hub, "/oauth/revoke", { token: "sbagliato", scope: "all" });
  assert.equal(wrongKey.status, 401);
  assert.equal(await listTools(hub, "/mcp", maxGpt.access), 200);

  // Approvare con un segreto malformato non lega la concessione a un valore scelto a caso.
  const clientId = await register(hub, "Malformato");
  assert.equal((await startAuthorize(hub, clientId, `${origin}/mcp`)).status, 200);
  const job = await bridge(hub, "/bridge/poll", { token, browser: MAX });
  const decided = await bridge(hub, "/oauth/decide", { token, requestId: job.json.requestId, approve: true, scopes: ["studyos:read"], secret: "aaaa" });
  assert.equal(decided.status, 400);
});

test("revoca del connettore remoto: solo il remoto approvato da questo browser", async () => {
  const { hub, token, maxSecret, camillaSecret } = await setup();
  const camillaUrl = `${origin}/u/camilla-rossi/mcp`;
  const maxUrl = `${origin}/u/massimiliano-ciconte/mcp`;
  const camillaRemote = await connect(hub, token, { name: "ChatGPT remoto", poller: CAMILLA, secret: camillaSecret, resource: camillaUrl });
  const camillaMain = await connect(hub, token, { name: "Claude di Camilla", poller: CAMILLA, secret: camillaSecret });
  const maxRemote = await connect(hub, token, { name: "ChatGPT remoto di Max", poller: MAX, secret: maxSecret, resource: maxUrl });

  const remote = await bridge(hub, "/oauth/revoke", { token, secret: camillaSecret, scope: "cloud" });
  assert.equal(remote.status, 200);
  assert.equal(remote.json.scope, "cloud");
  assert.equal(remote.json.revoked, 1);
  assert.equal(await listTools(hub, "/u/camilla-rossi/mcp", camillaRemote.access), 401);
  assert.equal(await listTools(hub, "/mcp", camillaMain.access), 200, "il connettore principale di Camilla resta");
  assert.equal(await listTools(hub, "/u/massimiliano-ciconte/mcp", maxRemote.access), 200, "il remoto di Max resta");

  const rest = await bridge(hub, "/oauth/revoke", { token, secret: camillaSecret });
  assert.equal(rest.json.revoked, 1);
  assert.equal(await listTools(hub, "/mcp", camillaMain.access), 401);
  assert.equal(await listTools(hub, "/u/massimiliano-ciconte/mcp", maxRemote.access), 200);
});
