import test from "node:test";
import assert from "node:assert/strict";
import { accountKey, chooseAccount, listAccounts, parseBrowserInfo } from "../src/agent/accounts.ts";
import { AGENT_TOOLS, HUB_TOOLS, mcpToolDefinition } from "../src/agent/catalog.ts";
import { HttpHub } from "../src/agent/httpHub.ts";

const origin = "https://studyos-agent.esempio.workers.dev";
const key = "chiave-di-prova-lunga-abbastanza";
const site = { "content-type": "application/json", origin: "https://massimilianociconte.github.io" };
const clock = { now: Date.now() };

const hub = () => new HttpHub({
  issuer: origin,
  canonical: `${origin}/mcp`,
  secureCookies: true,
  pairMode: "key",
  pairKey: key,
  disconnectedHint: "Apri StudyOS.",
  approvalWaitMs: 2000,
  approvalPollMs: 2000,
  pollWaitMs: 150,
  now: () => clock.now,
  allowHost: (host) => host === "studyos-agent.esempio.workers.dev",
  allowOrigin: (value, mcp) => !value || value === "https://massimilianociconte.github.io" || mcp
});

const ask = (instance, path, options = {}) => instance.handle(new Request(`${origin}${path}`, options));
const pair = async (instance) => (await (await ask(instance, "/pair", { method: "POST", headers: site, body: JSON.stringify({ code: key }) })).json()).token;
const poll = (instance, token, browser) =>
  ask(instance, "/bridge/poll", { method: "POST", headers: site, body: JSON.stringify(browser ? { token, browser } : { token }) }).then((response) => response.json());
const call = (instance, id, name, args = {}) => ask(instance, "/mcp", {
  method: "POST",
  headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${instance.serviceToken}` },
  body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } })
}).then(async (response) => JSON.parse((await response.json()).result.content[0].text));
const tick = (ms = 10) => new Promise((resolve) => setTimeout(resolve, ms));

const MAX = { id: "browser_massimiliano", name: "Massimiliano Ciconte" };
const CAMILLA = { id: "browser_camilla_tel", name: "Camilla Rossi" };

test("account: nome confrontabile e dichiarazione del browser", () => {
  assert.equal(accountKey("  Cicónte, Massimiliano "), "ciconte massimiliano");
  assert.equal(accountKey("CAMILLA   rossi"), "camilla rossi");
  assert.deepEqual(parseBrowserInfo({ id: "browser_abc12345", name: "  Camilla   Rossi " }), { id: "browser_abc12345", name: "Camilla Rossi" });
  assert.deepEqual(parseBrowserInfo({ id: "browser_abc12345" }), { id: "browser_abc12345" });
  assert.equal(parseBrowserInfo({ id: "corto" }), null);
  assert.equal(parseBrowserInfo({ id: "con spazi dentro" }), null);
  assert.equal(parseBrowserInfo(null), null);
  assert.equal(parseBrowserInfo({ id: "browser_abc12345", name: "x".repeat(200) }).name.length, 80);
});

test("account: un account per nome, collegato se uno dei suoi browser lo è", () => {
  const now = 1_000_000;
  const accounts = listAccounts([
    { id: "b1", key: "camilla rossi", label: "Camilla Rossi", site: "published", lastSeen: now - 90_000 },
    { id: "b2", key: "camilla rossi", label: "Camilla Rossi", site: "local", lastSeen: now - 1_000 },
    { id: "b3", key: "massimiliano ciconte", label: "Massimiliano Ciconte", site: "published", lastSeen: now - 90_000 },
    { id: "legacy-local", key: "", label: "", site: "local", lastSeen: now - 90_000, legacy: true }
  ], now, 45_000);
  assert.deepEqual(accounts, [
    { key: "camilla rossi", name: "Camilla Rossi", connected: true },
    { key: "massimiliano ciconte", name: "Massimiliano Ciconte", connected: false }
  ]);
});

test("account: scelta dal nome detto in chat", () => {
  const two = [
    { key: "camilla rossi", name: "Camilla Rossi", connected: true },
    { key: "massimiliano ciconte", name: "Massimiliano Ciconte", connected: true }
  ];
  assert.deepEqual(chooseAccount(two, "camilla"), { ok: true, key: "camilla rossi", name: "Camilla Rossi" });
  assert.deepEqual(chooseAccount(two, "Rossi Camilla"), { ok: true, key: "camilla rossi", name: "Camilla Rossi" });
  assert.deepEqual(chooseAccount(two, "Massimiliano Cicònte"), { ok: true, key: "massimiliano ciconte", name: "Massimiliano Ciconte" });

  const missing = chooseAccount(two, undefined);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "invalid");
  assert.match(missing.error, /Camilla Rossi, Massimiliano Ciconte/);

  const unknown = chooseAccount(two, "Giulia");
  assert.equal(unknown.ok, false);
  assert.equal(unknown.code, "not_found");
  assert.match(unknown.error, /Giulia/);

  // Profilo con il solo nome di battesimo: «Camilla Rossi» lo trova lo stesso.
  const short = [{ key: "camilla", name: "Camilla", connected: true }, two[1]];
  assert.deepEqual(chooseAccount(short, "Camilla Rossi"), { ok: true, key: "camilla", name: "Camilla" });

  // Due Camilla: il solo nome non basta, il nome completo sì; la corrispondenza esatta vince.
  const twins = [...two, { key: "camilla bianchi", name: "Camilla Bianchi", connected: true }];
  const ambiguous = chooseAccount(twins, "Camilla");
  assert.equal(ambiguous.ok, false);
  assert.match(ambiguous.error, /Camilla Bianchi/);
  assert.match(ambiguous.error, /Camilla Rossi/);
  assert.doesNotMatch(ambiguous.error, /Massimiliano/);
  assert.equal(chooseAccount(twins, "camilla bianchi").key, "camilla bianchi");
  assert.equal(chooseAccount([...twins, { key: "camilla", name: "Camilla", connected: true }], "Camilla").key, "camilla");

  // Un solo account: il nome si può omettere, ma se c'è deve corrispondere.
  assert.deepEqual(chooseAccount([two[1]], undefined), { ok: true, key: "massimiliano ciconte", name: "Massimiliano Ciconte" });
  assert.equal(chooseAccount([two[1]], "Camilla").ok, false);
  assert.deepEqual(chooseAccount([], undefined), { ok: true, key: "", name: "" });
  // Un account senza nome non si sceglie per nome.
  assert.equal(chooseAccount([{ key: "", name: "", connected: true }, two[0]], "Senza nome").ok, false);
});

test("MCP: ogni strumento dell'app accetta account, quelli dell'hub no", () => {
  for (const tool of AGENT_TOOLS) {
    const schema = mcpToolDefinition(tool).inputSchema;
    assert.equal(schema.additionalProperties, false, tool.name);
    if (HUB_TOOLS.has(tool.name)) {
      assert.equal("account" in schema.properties, false, tool.name);
    } else {
      assert.equal(schema.properties.account.type, "string", tool.name);
      // Lo schema interno, quello che l'app valida, resta senza account.
      assert.equal("account" in tool.inputSchema.properties, false, tool.name);
    }
  }
});

test("hub: con due account ogni azione va solo ai browser dell'account nominato", async () => {
  clock.now = Date.now();
  const agent = hub();
  const token = await pair(agent);
  await Promise.all([poll(agent, token, MAX), poll(agent, token, CAMILLA)]);

  const listed = await call(agent, 1, "studyos_list_accounts", { account: "ignorato" });
  assert.deepEqual(listed.data.items, [
    { name: "Camilla Rossi", connected: true },
    { name: "Massimiliano Ciconte", connected: true }
  ]);

  const unnamed = await call(agent, 2, "studyos_list_tasks");
  assert.equal(unnamed.ok, false);
  assert.equal(unnamed.code, "invalid");
  assert.match(unnamed.error, /Camilla Rossi, Massimiliano Ciconte/);

  const wrong = await call(agent, 3, "studyos_list_tasks", { account: "Giulia" });
  assert.equal(wrong.code, "not_found");

  const badType = await call(agent, 4, "studyos_list_tasks", { account: 7 });
  assert.equal(badType.code, "invalid");

  // Massimiliano ritira per primo, ma l'azione per Camilla arriva solo al browser di Camilla.
  const maxJob = poll(agent, token, MAX);
  await tick();
  const answer = call(agent, 5, "studyos_create_task", { title: "Planning", account: "camilla" });
  await tick();
  const camillaJob = await poll(agent, token, CAMILLA);
  assert.equal(camillaJob.type, "call");
  assert.equal(camillaJob.name, "studyos_create_task");
  assert.equal(camillaJob.args.title, "Planning");
  assert.equal("account" in camillaJob.args, false);
  assert.equal((await maxJob).type, "idle");
  await ask(agent, "/bridge/result", { method: "POST", headers: site, body: JSON.stringify({ token, id: camillaJob.id, result: { ok: true, data: { id: "task_c1" } } }) });
  const done = await answer;
  assert.equal(done.ok, true);
  assert.equal(done.data.id, "task_c1");
  assert.equal(done.data.account, "Camilla Rossi");

  // Lo stesso nome da un secondo browser è lo stesso account.
  const laptop = { id: "browser_camilla_pc", name: "camilla rossi" };
  await poll(agent, token, laptop);
  assert.equal((await call(agent, 6, "studyos_list_accounts")).data.items.length, 2);

  // Il browser di Camilla si chiude: le sue azioni falliscono subito, quelle di Massimiliano no.
  clock.now += 60_000;
  await poll(agent, token, MAX);
  const closed = await call(agent, 7, "studyos_list_tasks", { account: "Camilla Rossi" });
  assert.equal(closed.code, "not_connected");
  assert.match(closed.error, /Camilla Rossi/);
  const maxRead = call(agent, 8, "studyos_list_tasks", { account: "Massimiliano" });
  await tick();
  const maxTask = await poll(agent, token, MAX);
  assert.equal(maxTask.type, "call");
  await ask(agent, "/bridge/result", { method: "POST", headers: site, body: JSON.stringify({ token, id: maxTask.id, result: { ok: true, data: { items: [] } } }) });
  assert.equal((await maxRead).data.account, "Massimiliano Ciconte");
  clock.now = Date.now();
});

test("hub: un browser col vault chiuso tiene il nome noto, rinomina e scollegamento aggiornano gli account", async () => {
  clock.now = Date.now();
  const agent = hub();
  const token = await pair(agent);
  await poll(agent, token, MAX);
  await poll(agent, token, CAMILLA);
  // Vault chiuso: il browser non sa il nome e non lo manda; l'hub tiene quello di prima.
  await poll(agent, token, { id: CAMILLA.id });
  assert.deepEqual((await call(agent, 1, "studyos_list_accounts")).data.items.map((item) => item.name), ["Camilla Rossi", "Massimiliano Ciconte"]);

  await poll(agent, token, { id: CAMILLA.id, name: "Camilla R." });
  assert.deepEqual((await call(agent, 2, "studyos_list_accounts")).data.items.map((item) => item.name), ["Camilla R.", "Massimiliano Ciconte"]);

  // Lo snapshot ricorda i browser: dopo un riavvio dell'hub gli account restano.
  const restored = hub();
  restored.importState(agent.exportState());
  assert.deepEqual(restored.accounts().map((item) => item.name), ["Camilla R.", "Massimiliano Ciconte"]);

  const forgot = await ask(agent, "/bridge/forget", { method: "POST", headers: site, body: JSON.stringify({ token, browser: { id: CAMILLA.id } }) });
  assert.equal(forgot.status, 200);
  assert.deepEqual(agent.accounts().map((item) => item.name), ["Massimiliano Ciconte"]);
  // Rimasto un solo account, il nome si può omettere di nuovo.
  const only = call(agent, 3, "studyos_list_tasks");
  await tick();
  const job = await poll(agent, token, MAX);
  assert.equal(job.type, "call");
  await ask(agent, "/bridge/result", { method: "POST", headers: site, body: JSON.stringify({ token, id: job.id, result: { ok: true, data: { items: [] } } }) });
  const result = await only;
  assert.equal(result.ok, true);
  assert.equal("account" in result.data, false);

  const stranger = await ask(agent, "/bridge/forget", { method: "POST", headers: site, body: JSON.stringify({ token: "sbagliato", browser: { id: MAX.id } }) });
  assert.equal(stranger.status, 401);

  // I browser non più visti da 30 giorni si dimenticano.
  clock.now += 31 * 24 * 60 * 60_000;
  await poll(agent, token, CAMILLA);
  assert.deepEqual(agent.accounts().map((item) => item.name), ["Camilla Rossi"]);
  clock.now = Date.now();
});

test("hub: un'app di prima, senza dichiarazione, funziona come un account solo", async () => {
  clock.now = Date.now();
  const agent = hub();
  const token = await pair(agent);
  await poll(agent, token);
  const answer = call(agent, 1, "studyos_list_tasks");
  await tick();
  const job = await poll(agent, token);
  assert.equal(job.type, "call");
  await ask(agent, "/bridge/result", { method: "POST", headers: site, body: JSON.stringify({ token, id: job.id, result: { ok: true, data: { items: [] } } }) });
  const result = await answer;
  assert.equal(result.ok, true);
  assert.equal("account" in result.data, false);
  // I browser senza dichiarazione non finiscono nello snapshot.
  assert.deepEqual(agent.exportState().browsers, []);
});
