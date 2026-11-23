import test from "node:test";
import assert from "node:assert/strict";
import { HttpHub, consentCode } from "../src/agent/httpHub.ts";
import { sha256Base64Url } from "../src/agent/oauth.ts";
import { ResultLedger } from "../src/agent/ledger.ts";
import {
  checkSiteConsent,
  decideSiteConsent,
  fetchSiteConsent,
  profileSlug,
  siteConsentHub,
  siteConsentIdFromUrl,
  urlWithoutSiteConsent
} from "../src/lib/agentSiteConsent.ts";

// Consenso del connettore remoto dal sito di StudyOS (#collega=<id>): nessun browser collegato all'hub,
// il permesso cloud creato dall'app è la prova, l'hub lo controlla sul cloud prima di emettere il codice.

const origin = "https://studyos-agent.esempio.workers.dev";
const SITE = "https://massimilianociconte.github.io/StudyOS/";
const SITE_ORIGIN = "https://massimilianociconte.github.io";
const redirect = "https://chatgpt.com/connector_platform_oauth_redirect";
const GOOD = "a".repeat(64);
const OTHER = "b".repeat(64);
const REVOKED = "d".repeat(64);
const ID = "AbCdEfGhIjKlMnOpQrStUvWx";

const fakeCloud = () => {
  const calls = [];
  let offline = false;
  return {
    calls,
    setOffline: (value) => {
      offline = value;
    },
    run: async (grant, name, args) => {
      calls.push({ grant, name, args });
      return { ok: true, data: { done: name, secret: grant.secret } };
    },
    verify: async (grant) => (offline ? "offline" : grant.secret === REVOKED ? "revoked" : "ok")
  };
};

const makeHub = (cloud, siteUrl = SITE) => new HttpHub({
  issuer: origin,
  canonical: `${origin}/mcp`,
  secureCookies: true,
  pairMode: "key",
  pairKey: "chiave-di-prova-lunga-abbastanza",
  disconnectedHint: "Apri StudyOS.",
  approvalWaitMs: 2000,
  approvalPollMs: 2000,
  pollWaitMs: 150,
  allowHost: (host) => host === "studyos-agent.esempio.workers.dev",
  allowOrigin: (value, mcp) => !value || value === SITE_ORIGIN || mcp,
  cloud,
  ...(siteUrl ? { siteUrl } : {})
});

const ask = (hub, path, options = {}) => hub.handle(new Request(`${origin}${path}`, options));
const json = (response) => response.json().then((body) => ({ status: response.status, body }));
const fromSite = (hub, path, body) => ask(hub, path, {
  method: "POST",
  headers: { "content-type": "application/json", origin: SITE_ORIGIN },
  body: JSON.stringify(body)
}).then(json);
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
  const html = await response.text();
  const link = /href="([^"]+#collega=[^"]+)"/.exec(html)?.[1].replace(/&amp;/g, "&") ?? "";
  return { response, verifier, cookie, html, link, requestId: decodeURIComponent(link.split("#collega=")[1] ?? "") };
};

const exchange = (hub, form) => ask(hub, "/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(form).toString()
}).then(json);

/** Collegamento completo dal sito: /authorize → «Consenti» con il permesso → /authorize/continue → token. */
const connectFromSite = async (hub, slug, secret) => {
  const clientId = await register(hub);
  const begun = await authorize(hub, clientId, `${origin}/u/${slug}/mcp`);
  assert.equal(begun.response.status, 200);
  const decided = await fromSite(hub, "/oauth/decide-cloud", {
    requestId: begun.requestId,
    approve: true,
    scopes: ["studyos:read", "studyos:write"],
    cloud: { secret, timeZone: "Europe/Rome" }
  });
  assert.equal(decided.status, 200, JSON.stringify(decided.body));
  const back = await ask(hub, "/authorize/continue", { headers: { cookie: begun.cookie } });
  assert.equal(back.status, 302);
  const code = new URL(back.headers.get("location")).searchParams.get("code");
  const issued = await exchange(hub, { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: begun.verifier, resource: `${origin}/u/${slug}/mcp` });
  assert.equal(issued.status, 200, JSON.stringify(issued.body));
  return { clientId, ...issued.body };
};

test("consenso dal sito: pagina con link e codice, dettagli senza redirect né state, codice al ritorno", async () => {
  const cloud = fakeCloud();
  const hub = makeHub(cloud);
  const clientId = await register(hub);
  // Nessun browser collegato: la richiesta parte lo stesso, per un account che l'hub non ha mai visto.
  const begun = await authorize(hub, clientId, `${origin}/u/studente-prova/mcp`);
  assert.equal(begun.response.status, 200);
  assert.ok(begun.link.startsWith(`${SITE}#collega=`), begun.link);
  assert.match(begun.html, /Conferma in StudyOS/);
  const code = consentCode(begun.requestId);
  assert.match(code, /^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  assert.ok(begun.html.includes(code));
  assert.match(begun.cookie, /^studyos_oauth=/);
  assert.match((await ask(hub, `/authorize?x=1`)).status.toString(), /^4/);

  // La pagina dell'hub non avvisa «non collegato»: si conferma dal sito.
  const waiting = await (await ask(hub, "/oauth/wait", { headers: { cookie: begun.cookie } })).json();
  assert.deepEqual(waiting, { state: "pending", connected: true });

  const details = await json(await ask(hub, `/oauth/request?id=${begun.requestId}`, { headers: { origin: SITE_ORIGIN } }));
  assert.equal(details.status, 200);
  assert.equal(details.body.clientName, "ChatGPT");
  assert.equal(details.body.redirectHost, "chatgpt.com");
  assert.equal(details.body.accountSlug, "studente-prova");
  assert.equal(details.body.account, "Studente Prova");
  assert.equal(details.body.code, code);
  assert.equal(details.body.decided, false);
  const raw = JSON.stringify(details.body);
  assert.ok(!raw.includes("connector_platform_oauth_redirect") && !raw.includes("stato"), "niente redirect_uri né state");

  // Prima del consenso il ritorno mostra di nuovo la pagina (nessun codice).
  const early = await ask(hub, "/authorize/continue", { headers: { cookie: begun.cookie } });
  assert.equal(early.status, 200);
  assert.match(await early.text(), /Conferma in StudyOS/);

  const decided = await fromSite(hub, "/oauth/decide-cloud", { requestId: begun.requestId, approve: true, scopes: ["studyos:read"], cloud: { secret: GOOD, timeZone: "Europe/Rome" } });
  assert.equal(decided.status, 200);
  assert.equal(decided.body.continueUrl, `${origin}/authorize/continue`);

  const back = await ask(hub, "/authorize/continue", { headers: { cookie: begun.cookie } });
  assert.equal(back.status, 302);
  const location = new URL(back.headers.get("location"));
  assert.equal(`${location.origin}${location.pathname}`, redirect);
  assert.equal(location.searchParams.get("state"), "stato");
  assert.ok(location.searchParams.get("code"));

  // Una seconda decisione è rifiutata; un'altra finestra senza cookie non legge il codice.
  const twice = await fromSite(hub, "/oauth/decide-cloud", { requestId: begun.requestId, approve: true, cloud: { secret: OTHER, timeZone: "Europe/Rome" } });
  assert.equal(twice.status, 409);
  const elsewhere = await ask(hub, "/authorize/continue");
  assert.equal(elsewhere.status, 200);
  assert.doesNotMatch(await elsewhere.text(), /code=/);
});

test("consenso dal sito: permesso mancante, revocato, cloud spento, rifiuto, richiesta sconosciuta", async () => {
  const cloud = fakeCloud();
  const hub = makeHub(cloud);
  const clientId = await register(hub);
  const begun = await authorize(hub, clientId, `${origin}/u/studente-prova/mcp`);
  const id = begun.requestId;

  assert.equal((await fromSite(hub, "/oauth/decide-cloud", { requestId: id, approve: true })).status, 400);
  assert.equal((await fromSite(hub, "/oauth/decide-cloud", { requestId: id, approve: true, cloud: { secret: "corto", timeZone: "Europe/Rome" } })).status, 400);
  assert.equal((await fromSite(hub, "/oauth/decide-cloud", { requestId: id, approve: true, cloud: { secret: GOOD, timeZone: "Marte/Base" } })).status, 400);
  assert.equal((await fromSite(hub, "/oauth/decide-cloud", { requestId: id, approve: true, cloud: { secret: REVOKED, timeZone: "Europe/Rome" } })).status, 403);
  cloud.setOffline(true);
  assert.equal((await fromSite(hub, "/oauth/decide-cloud", { requestId: id, approve: true, cloud: { secret: GOOD, timeZone: "Europe/Rome" } })).status, 503);
  cloud.setOffline(false);
  // Nessuno di questi tentativi ha deciso la richiesta.
  assert.equal((await json(await ask(hub, `/oauth/request?id=${id}`))).body.decided, false);

  const denied = await fromSite(hub, "/oauth/decide-cloud", { requestId: id, approve: false });
  assert.equal(denied.status, 200);
  const back = await ask(hub, "/authorize/continue", { headers: { cookie: begun.cookie } });
  assert.equal(back.status, 302);
  assert.equal(new URL(back.headers.get("location")).searchParams.get("error"), "access_denied");

  assert.equal((await ask(hub, `/oauth/request?id=${ID}`)).status, 404);
  assert.equal((await ask(hub, "/oauth/request?id=../../x")).status, 404);
  assert.equal((await fromSite(hub, "/oauth/decide-cloud", { requestId: ID, approve: true, cloud: { secret: GOOD, timeZone: "Europe/Rome" } })).status, 404);

  // Un consenso del connettore principale (/mcp, verso i browser collegati di tutti) non si decide dal
  // sito, nemmeno con un permesso cloud valido: resta da decidere.
  const main = await authorize(hub, clientId, `${origin}/mcp`);
  const mainId = decodeURIComponent(main.cookie.split("=")[1] ?? "");
  assert.ok(mainId.length >= 16, "id dal cookie della pagina");
  assert.equal(main.link, "", "nessun link al sito per /mcp");
  assert.equal((await ask(hub, `/oauth/request?id=${mainId}`)).status, 404);
  assert.equal((await fromSite(hub, "/oauth/decide-cloud", { requestId: mainId, approve: true, scopes: ["studyos:read", "studyos:write"], cloud: { secret: GOOD, timeZone: "Europe/Rome" } })).status, 404);
  assert.equal(hub.oauth.pendingConsent(mainId)?.decided, false);
  assert.deepEqual(await (await ask(hub, "/oauth/wait", { headers: { cookie: main.cookie } })).json(), { state: "pending", connected: false });

  // Senza siteUrl (hub locale) la pagina non offre il sito.
  const local = makeHub(fakeCloud(), "");
  const localBegun = await authorize(local, await register(local), `${origin}/u/studente-prova/mcp`);
  assert.equal(localBegun.link, "");
});

test("consenso dal sito: CORS per il sito pubblicato, non per altri", async () => {
  const hub = makeHub(fakeCloud());
  const clientId = await register(hub);
  const begun = await authorize(hub, clientId, `${origin}/u/studente-prova/mcp`);
  const preflight = await ask(hub, "/oauth/decide-cloud", {
    method: "OPTIONS",
    headers: { origin: SITE_ORIGIN, "access-control-request-method": "POST", "access-control-request-headers": "content-type" }
  });
  assert.ok(preflight.status === 204 || preflight.status === 200, String(preflight.status));
  assert.equal(preflight.headers.get("access-control-allow-origin"), SITE_ORIGIN);
  const foreignPreflight = await ask(hub, "/oauth/decide-cloud", {
    method: "OPTIONS",
    headers: { origin: "https://malevolo.example", "access-control-request-method": "POST", "access-control-request-headers": "content-type" }
  });
  assert.equal(foreignPreflight.headers.get("access-control-allow-origin"), null);
  // Con la richiesta vera, in JSON e in text/plain (che salta il preflight): l'hub rifiuta l'origine.
  for (const type of ["application/json", "text/plain"]) {
    const foreign = await ask(hub, "/oauth/decide-cloud", {
      method: "POST",
      headers: { "content-type": type, origin: "https://malevolo.example" },
      body: JSON.stringify({ requestId: begun.requestId, approve: true, cloud: { secret: GOOD, timeZone: "Europe/Rome" } })
    });
    assert.equal(foreign.status, 403, type);
    assert.equal(foreign.headers.get("access-control-allow-origin"), null);
  }
  for (const path of [`/oauth/request?id=${begun.requestId}`]) {
    assert.equal((await ask(hub, path, { headers: { origin: "https://malevolo.example" } })).status, 403);
  }
  assert.equal(hub.oauth.pendingConsent(begun.requestId)?.decided, false);
});

test("consenso dal sito: token separati per account, niente /mcp, refresh con tolleranza di 60 s", async () => {
  const cloud = fakeCloud();
  const hub = makeHub(cloud);
  const primo = await connectFromSite(hub, "studente-prova", GOOD);
  const secondo = await connectFromSite(hub, "altro-account", OTHER);

  // Ogni token apre solo il suo indirizzo: né l'altro account né il connettore principale.
  assert.equal((await rpc(hub, "/mcp", primo.access_token, "tools/list")).status, 401);
  assert.equal((await rpc(hub, "/u/altro-account/mcp", primo.access_token, "tools/list")).status, 401);
  assert.equal((await rpc(hub, "/u/studente-prova/mcp", secondo.access_token, "tools/list")).status, 401);

  // CRUD con l'app chiusa: ogni chiamata usa il permesso cloud della sua concessione.
  for (const [name, args] of [
    ["studyos_create_task", { title: "Ripasso capitolo 3" }],
    ["studyos_list_tasks", {}],
    ["studyos_update_task", { id: "task_1", status: "done" }],
    ["studyos_delete_task", { id: "task_1", confirm: true }]
  ]) {
    const result = await toolText(await rpc(hub, "/u/studente-prova/mcp", primo.access_token, "tools/call", { name, arguments: args }));
    assert.equal(result.ok, true, `${name}: ${JSON.stringify(result)}`);
    assert.equal(cloud.calls.at(-1).grant.secret, GOOD);
    assert.equal(cloud.calls.at(-1).name, name);
  }
  const theirs = await toolText(await rpc(hub, "/u/altro-account/mcp", secondo.access_token, "tools/call", { name: "studyos_list_tasks", arguments: { account: "Studente Prova" } }));
  assert.equal(theirs.ok, true);
  assert.equal(cloud.calls.at(-1).grant.secret, OTHER, "il nome nell'argomento non cambia account");

  // Refresh ripetuto entro 60 s: una coppia nuova; entrambe valide per lo stesso indirizzo.
  const first = await exchange(hub, { grant_type: "refresh_token", client_id: primo.clientId, refresh_token: primo.refresh_token });
  const retry = await exchange(hub, { grant_type: "refresh_token", client_id: primo.clientId, refresh_token: primo.refresh_token });
  assert.equal(first.status, 200);
  assert.equal(retry.status, 200);
  for (const token of [first.body.access_token, retry.body.access_token]) {
    const status = await toolText(await rpc(hub, "/u/studente-prova/mcp", token, "tools/call", { name: "studyos_status", arguments: {} }));
    assert.equal(status.ok, true);
    assert.equal((await rpc(hub, "/u/altro-account/mcp", token, "tools/list")).status, 401);
  }
  // Un client diverso non usa il refresh di un altro.
  const stolen = await exchange(hub, { grant_type: "refresh_token", client_id: secondo.clientId, refresh_token: first.body.refresh_token });
  assert.equal(stolen.status, 400);

  // «Revoca gli accessi di questo browser» non li conta tra quelli «di prima» (si tolgono dal cloud).
  assert.deepEqual(hub.oauth.revokeApprover(await sha256Base64Url("segreto-di-un-browser")), { revoked: 0, legacy: 0 });

  // Riavvio del Durable Object: concessioni e tolleranza sopravvivono allo snapshot.
  const restored = makeHub(cloud);
  restored.importState(hub.exportState());
  const after = await toolText(await rpc(restored, "/u/studente-prova/mcp", first.body.access_token, "tools/call", { name: "studyos_list_tasks", arguments: {} }));
  assert.equal(after.ok, true);
  const graceAfterRestart = await exchange(restored, { grant_type: "refresh_token", client_id: primo.clientId, refresh_token: primo.refresh_token });
  assert.equal(graceAfterRestart.status, 200);
});

test("registro degli esiti: lo snapshot tiene i più recenti entro il tetto", () => {
  const ledger = new ResultLedger();
  const now = Date.now();
  const big = "x".repeat(40 * 1024);
  ledger.remember("grande", { ok: true, data: { big } }, now);
  for (let index = 0; index < 20; index += 1) ledger.remember(`call_${index}`, { ok: true, data: { text: "y".repeat(15 * 1024), index } }, now + index);
  const saved = ledger.exportState(now + 100);
  const ids = saved.map((item) => item.id);
  assert.ok(!ids.includes("grande"), "un esito oltre 32 KB resta solo in memoria");
  assert.ok(JSON.stringify(saved).length < 300 * 1024);
  assert.ok(ids.includes("call_19") && !ids.includes("call_0"), "si tengono i più recenti");
  assert.deepEqual([...ids].sort((a, b) => Number(a.split("_")[1]) - Number(b.split("_")[1])), ids, "in ordine di tempo");
  assert.equal(ledger.recall("grande", now + 100)?.ok, true, "in memoria resta");
});

test("app: link #collega, hub solo dalla build, controlli prima di «Consenti»", async () => {
  assert.equal(siteConsentIdFromUrl(`${SITE}#collega=${ID}`), ID);
  assert.equal(siteConsentIdFromUrl(`${SITE}#collega=corto`), "");
  assert.equal(siteConsentIdFromUrl(`${SITE}#collega=${ID}<script>`), "");
  assert.equal(siteConsentIdFromUrl(`${SITE}#condividi=abc`), "");
  assert.equal(urlWithoutSiteConsent(`${SITE}#collega=${ID}`), SITE);
  assert.equal(urlWithoutSiteConsent(`${SITE}#a=1&collega=${ID}`), `${SITE}#a=1`);

  // L'hub viene dalla build (o dal tunnel salvato), mai dal link; in locale il loopback.
  assert.equal(siteConsentHub(SITE_ORIGIN, "", `${origin}/`), origin);
  assert.equal(siteConsentHub(SITE_ORIGIN, "", "https://malevolo.example"), "");
  assert.equal(siteConsentHub("http://127.0.0.1:5173", "", origin).startsWith("http://127.0.0.1"), true);

  assert.equal(profileSlug(" Studente Prova "), "studente-prova");
  assert.equal(profileSlug("Cicónte, M."), profileSlug("ciconte m"));
  assert.equal(profileSlug(""), "");

  const request = { accountSlug: "studente-prova", expiresAt: new Date(Date.now() + 60_000).toISOString(), decided: false };
  assert.deepEqual(checkSiteConsent(request, { signedIn: true, displayName: "Studente Prova" }), { ok: true });
  assert.deepEqual(checkSiteConsent(request, { signedIn: false, displayName: "Studente Prova" }), { ok: false, reason: "signIn" });
  assert.deepEqual(checkSiteConsent(request, { signedIn: true, displayName: "" }), { ok: false, reason: "noName" });
  assert.deepEqual(checkSiteConsent(request, { signedIn: true, displayName: "Altro Account" }), { ok: false, reason: "otherAccount" });
  assert.deepEqual(checkSiteConsent({ ...request, decided: true }, { signedIn: true, displayName: "Studente Prova" }), { ok: false, reason: "decided" });
  assert.deepEqual(checkSiteConsent({ ...request, expiresAt: new Date(Date.now() - 1).toISOString() }, { signedIn: true, displayName: "Studente Prova" }), { ok: false, reason: "expired" });
});

test("app ↔ hub: dettagli, «Consenti» con il permesso creato dall'app, ritorno solo sull'hub della build", async () => {
  const cloud = fakeCloud();
  const hub = makeHub(cloud);
  const fetcher = (input, init) => hub.handle(new Request(input, { ...init, headers: { ...(init?.headers ?? {}), origin: SITE_ORIGIN } }));
  const clientId = await register(hub);
  const begun = await authorize(hub, clientId, `${origin}/u/studente-prova/mcp`);

  const details = await fetchSiteConsent(begun.requestId, { hub: origin, fetcher, offline: "giù" });
  assert.equal(details.clientName, "ChatGPT");
  assert.equal(details.accountSlug, "studente-prova");
  assert.equal(details.code, consentCode(begun.requestId));
  await assert.rejects(fetchSiteConsent(ID, { hub: origin, fetcher, offline: "giù" }), /scaduta o non trovata/);
  await assert.rejects(fetchSiteConsent(ID, { hub: "", fetcher, offline: "giù" }), /giù/);
  await assert.rejects(fetchSiteConsent(ID, { hub: origin, fetcher: async () => { throw new TypeError("rete"); }, offline: "giù" }), /giù/);

  // Un errore del cloud (es. 20 assistenti) arriva com'è e la richiesta resta da decidere.
  await assert.rejects(
    decideSiteConsent(begun.requestId, { approve: true, write: true, clientName: "ChatGPT" }, { hub: origin, fetcher, offline: "giù", createGrant: async () => { throw new Error("Hai già 20 assistenti collegati"); } }),
    /20 assistenti/
  );
  let label = "";
  const done = await decideSiteConsent(begun.requestId, { approve: true, write: false, clientName: "ChatGPT" }, {
    hub: origin,
    fetcher,
    offline: "giù",
    createGrant: async (value) => {
      label = value;
      return { secret: GOOD, timeZone: "Europe/Rome" };
    }
  });
  assert.equal(label, "ChatGPT");
  assert.equal(done.continueUrl, `${origin}/authorize/continue`);
  const back = await ask(hub, "/authorize/continue", { headers: { cookie: begun.cookie } });
  const code = new URL(back.headers.get("location")).searchParams.get("code");
  const issued = await exchange(hub, { grant_type: "authorization_code", client_id: clientId, code, redirect_uri: redirect, code_verifier: begun.verifier });
  assert.equal(issued.status, 200);
  assert.equal(issued.body.scope, "studyos:read", "senza «Anche creare…» solo lettura");

  // Una risposta che indica un altro host non si segue.
  const tricky = async () => new Response(JSON.stringify({ ok: true, continueUrl: "https://malevolo.example/x" }), { status: 200 });
  const safe = await decideSiteConsent(ID, { approve: false, write: false, clientName: "X" }, { hub: origin, fetcher: tricky, offline: "giù" });
  assert.equal(safe.continueUrl, `${origin}/authorize/continue`);
});
