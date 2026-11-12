import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_TOOLS, HUB_TOOLS, findAgentTool } from "../src/agent/catalog.ts";
import { handleMcpRpc } from "../src/agent/mcp.ts";
import { ResultLedger } from "../src/agent/ledger.ts";
import { OauthServer, sha256Base64Url } from "../src/agent/oauth.ts";
import { choosePoller, hubCandidates, normalizePublicHub, siteFromOrigin } from "../src/agent/hubEndpoint.ts";
import { decideAgentAction, decideToolAction, normalizeAgentPolicy } from "../src/agent/policy.ts";
import { publicAttachment, publicGroup, publicPreferences } from "../src/agent/project.ts";
import { parseToolArgs } from "../src/agent/schema.ts";
import { SHARE_SCOPES, ShareUserError } from "../src/lib/sharing.ts";
import {
  agentOffers,
  findSharedByHandle,
  newSharedEntity,
  personHandle,
  planSharedCreate,
  planSharedDelete,
  planSharedUpdate,
  publicShareGrant,
  publicSharedItem,
  sharedHandle,
  sharedItemsView
} from "../src/agent/shared.ts";
import { describeAgentCall, executeAgentTool } from "../src/agent/execute.ts";
import { useSharedStore } from "../src/store/useSharedStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { TIMER_CONTROL_ACTIONS, TIMER_KINDS, TIMER_MODES, defaultTimer } from "../src/lib/studyTimer.ts";
import { expandEvents as expandRepeatEvents } from "../src/lib/repeat.ts";

const actor = { name: "Prova", source: "stdio", scopes: ["studyos:read", "studyos:write"] };
const reader = { name: "Lettore", source: "oauth", scopes: ["studyos:read"] };

const rpc = (method, params, id = 1) => handleMcpRpc({ jsonrpc: "2.0", id, method, params }, arguments[3]);

test("hub: il sito pubblicato è preferito e il tunnel accettato è solo https", () => {
  const tunnel = "https://studio-prova.trycloudflare.com";
  assert.equal(normalizePublicHub(`${tunnel}/mcp`), tunnel);
  assert.equal(normalizePublicHub("http://earn-meet-boss-mia.trycloudflare.com"), null);
  assert.equal(normalizePublicHub("https://user:secret@earn-meet-boss-mia.trycloudflare.com"), null);
  assert.equal(normalizePublicHub("https://earn-meet-boss-mia.trycloudflare.com/altro"), null);
  assert.equal(normalizePublicHub("https://a.b.trycloudflare.com"), null);
  assert.equal(normalizePublicHub("https://evil.com"), null);
  assert.equal(normalizePublicHub("https://studyos-agent.esempio.workers.dev/mcp"), "https://studyos-agent.esempio.workers.dev");
  assert.equal(normalizePublicHub("https://workers.dev"), null);
  assert.deepEqual(hubCandidates("http://localhost:5173", tunnel), ["http://127.0.0.1:47321"]);
  assert.deepEqual(hubCandidates("http://localhost:5173", tunnel, "https://studyos-agent.esempio.workers.dev"), ["http://127.0.0.1:47321"]);
  assert.deepEqual(hubCandidates("https://massimilianociconte.github.io", `${tunnel}/mcp`, "https://studyos-agent.esempio.workers.dev"), ["https://studyos-agent.esempio.workers.dev"]);
  assert.deepEqual(hubCandidates("https://massimilianociconte.github.io", `${tunnel}/mcp`, ""), [tunnel]);
  assert.deepEqual(hubCandidates("https://massimilianociconte.github.io", "", ""), []);
  assert.equal(siteFromOrigin("https://massimilianociconte.github.io"), "published");
  assert.equal(siteFromOrigin("http://localhost:5173"), "local");
  const local = { site: "local", id: "locale" };
  const published = { site: "published", id: "pubblico" };
  assert.equal(choosePoller([local, published], false)?.id, "pubblico");
  assert.equal(choosePoller([local], true), null);
  assert.equal(choosePoller([local], false)?.id, "locale");
  assert.equal(choosePoller([], false), null);
});

test("policy: le letture passano, il resto chiede, il divieto resta divieto", () => {
  const policy = normalizeAgentPolicy({ read: "allow", write: "ask", destructive: "ask", trustedWritesUntil: "nope" });
  assert.equal(decideAgentAction(policy, "read"), "allow");
  assert.equal(decideAgentAction(policy, "write"), "ask");
  assert.equal(decideAgentAction(policy, "destructive"), "ask");
  const denied = { ...policy, write: "deny", destructive: "deny" };
  const trusted = { ...denied, trustedWritesUntil: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(decideAgentAction(trusted, "write"), "deny");
  assert.equal(decideAgentAction(trusted, "destructive"), "deny");
  const open = { ...policy, trustedWritesUntil: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(decideAgentAction(open, "write"), "allow");
  assert.equal(decideAgentAction(open, "destructive"), "ask");
  const expired = { ...policy, trustedWritesUntil: new Date(Date.now() - 1000).toISOString() };
  assert.equal(decideAgentAction(expired, "write"), "ask");
});

test("policy: dare accesso ai propri dati chiede sempre a una persona, il divieto resta divieto", () => {
  const soon = new Date(Date.now() + 60_000).toISOString();
  const trusted = normalizeAgentPolicy({ read: "allow", write: "ask", destructive: "ask", trustedWritesUntil: soon });
  const open = normalizeAgentPolicy({ read: "allow", write: "allow", destructive: "allow" });
  const asking = AGENT_TOOLS.filter((tool) => tool.alwaysAsk === true).map((tool) => tool.name).sort();
  assert.deepEqual(asking, ["studyos_share_with", "studyos_update_share"]);
  // Sessione fidata o «Consenti» sulle modifiche: le condivisioni chiedono, le altre modifiche no.
  for (const policy of [trusted, open]) {
    for (const tool of AGENT_TOOLS.filter((item) => item.risk === "write")) {
      assert.equal(decideToolAction(policy, tool), tool.alwaysAsk ? "ask" : "allow", tool.name);
    }
  }
  assert.equal(decideToolAction(open, findAgentTool("studyos_revoke_share")), "allow");
  for (const name of asking) {
    assert.equal(decideToolAction({ ...trusted, write: "deny" }, findAgentTool(name)), "deny", name);
    assert.equal(decideToolAction({ ...open, write: "deny" }, findAgentTool(name)), "deny", name);
  }
  assert.equal(decideAgentAction({ ...open, read: "deny" }, "read", new Date(), { alwaysAsk: true }), "deny");
  assert.equal(decideAgentAction(open, "read", new Date(), { alwaysAsk: true }), "ask");
  assert.equal(decideAgentAction(open, "write"), "allow");
});

test("catalogo condiviso: id persona a 64 bit, effetti visibili ad altri dichiarati", () => {
  const handle = personHandle("owner-uuid-1");
  assert.match(handle, /^person_[0-9a-f]{16}$/);
  assert.equal(personHandle("owner-uuid-1"), handle);
  assert.notEqual(personHandle("owner-uuid-2"), handle);
  // FNV-1a a 64 bit: la stringa vuota dà l'offset di base.
  assert.equal(personHandle(""), "person_cbf29ce484222325");
  const shareWith = findAgentTool("studyos_share_with").inputSchema;
  assert.equal(parseToolArgs(shareWith, { personId: handle, scopes: ["calendar"] }).ok, true);
  assert.equal(parseToolArgs(shareWith, { personId: "person_0000abcd", scopes: ["calendar"] }).ok, false);
  for (const name of ["studyos_create_shared_item", "studyos_update_shared_item", "studyos_delete_shared_item", "studyos_share_with", "studyos_update_share", "studyos_revoke_share"]) {
    assert.equal(findAgentTool(name).openWorld, true, name);
  }
});

test("bundle: gli strumenti condivisi si caricano solo quando servono", () => {
  const source = readFileSync(new URL("../src/agent/execute.ts", import.meta.url), "utf8");
  assert.equal(/from "\.\/shared(?:Tools)?"/.test(source), false);
  assert.match(source, /import\("\.\/sharedTools"\)/);
});

test("catalogo: nomi unici, schemi chiusi, eliminazioni con confirm", () => {
  const names = new Set();
  for (const tool of AGENT_TOOLS) {
    assert.equal(names.has(tool.name), false, tool.name);
    names.add(tool.name);
    assert.match(tool.name, /^studyos_[a-z0-9_]+$/);
    assert.equal(findAgentTool(tool.name), tool);
    assert.equal(tool.inputSchema.additionalProperties, false);
    const empty = parseToolArgs(tool.inputSchema, {});
    if (tool.inputSchema.required?.length) assert.equal(empty.ok, false, tool.name);
    else assert.equal(empty.ok, true, tool.name);
    const extra = parseToolArgs(tool.inputSchema, { campoInatteso: true });
    assert.equal(extra.ok, false, tool.name);
    if (tool.risk === "destructive") {
      // Un'eliminazione indica solo cosa eliminare: niente campi che ne cambino l'effetto (di un
      // evento ripetuto si possono indicare anche i giorni: occurrenceDate e scope).
      const what = tool.name === "studyos_delete_event" ? ["confirm", "id", "occurrenceDate", "scope"] : ["confirm", "id"];
      assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), what, tool.name);
      assert.equal(tool.inputSchema.required.includes("confirm"), true, tool.name);
      assert.deepEqual(tool.inputSchema.properties.confirm.enum, [true], tool.name);
      assert.equal(parseToolArgs(tool.inputSchema, { id: "task_1", confirm: false }).ok, false);
      assert.equal(parseToolArgs(tool.inputSchema, { id: "task_1", confirm: true }).ok, true);
    }
  }
  assert.equal(parseToolArgs({ type: "object", additionalProperties: false, properties: { note: { type: "string", pattern: "^[a-z]+$" } } }, { note: "" }).ok, true);
  // Gemini e i function schema OpenAI rifiutano "const" e required vuoti.
  const schemas = JSON.stringify(AGENT_TOOLS.map((tool) => tool.inputSchema));
  assert.equal(schemas.includes('"const"'), false);
  assert.equal(schemas.includes('"required":[]'), false);
  assert.equal(parseToolArgs(findAgentTool("studyos_get_task").inputSchema, { id: "" }).ok, false);
});

test("proiezioni: niente email, inviti, file o foto", () => {
  const group = publicGroup({
    id: "g1",
    name: "Lab",
    description: "ok",
    ownerDisplayName: "M",
    archived: false,
    updatedAt: "2026-11-08T00:00:00.000Z",
    inviteCode: "SEGRETO",
    members: [{ displayName: "M", role: "owner", email: "secret@example.com", userId: "user-1" }]
  });
  const attachment = publicAttachment({
    id: "a1",
    name: "dispense",
    mimeType: "application/pdf",
    size: 10,
    addedAt: "2026-11-08T00:00:00.000Z",
    description: "",
    updatedAt: "2026-11-08T00:00:00.000Z",
    dataUrl: "data:application/pdf;base64,SEGRETOFILE"
  });
  const preferences = publicPreferences({
    displayName: "M",
    weeklyTargetMinutes: 600,
    degreeCfu: 180,
    showBarb: true,
    avatarDataUrl: "data:image/png;base64,FOTO"
  });
  const packed = JSON.stringify({ group, attachment, preferences });
  assert.equal(packed.includes("secret@example.com"), false);
  assert.equal(packed.includes("SEGRETO"), false);
  assert.equal(packed.includes("user-1"), false);
  assert.equal(packed.includes("SEGRETOFILE"), false);
  assert.equal(packed.includes("FOTO"), false);
  assert.deepEqual(group.members, [{ displayName: "M", role: "owner" }]);
});

test("execute copre ogni strumento tranne quelli che risponde l'hub", () => {
  const source = readFileSync(new URL("../src/agent/execute.ts", import.meta.url), "utf8");
  assert.deepEqual([...HUB_TOOLS].sort(), ["studyos_approval_status", "studyos_list_accounts"]);
  for (const tool of AGENT_TOOLS) {
    if (HUB_TOOLS.has(tool.name)) {
      assert.equal(source.includes(`case "${tool.name}"`), false, tool.name);
      continue;
    }
    assert.equal(source.includes(`case "${tool.name}"`), true, tool.name);
  }
});

test("MCP: initialize, elenco senza app, argomenti invalidi e vault di conferma", async () => {
  let calls = 0;
  const ledger = new ResultLedger();
  const deps = {
    actor,
    ledger,
    connected: () => true,
    invoke: async (call) => {
      calls += 1;
      return { ok: true, data: { echoed: call.name } };
    }
  };
  const offline = { ...deps, connected: () => false, invoke: async () => { throw new Error("non doveva chiamare l'app"); } };
  const init = await handleMcpRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2099-01-01" } }, deps);
  assert.equal(init.result.protocolVersion, "2025-11-25");
  const echoed = await handleMcpRpc({ jsonrpc: "2.0", id: 10, method: "initialize", params: { protocolVersion: "2025-06-18" } }, deps);
  assert.equal(echoed.result.protocolVersion, "2025-06-18");
  assert.equal(init.result.serverInfo.name, "studyos-mcp-server");
  const listed = await handleMcpRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, offline);
  assert.equal(listed.result.tools.length, AGENT_TOOLS.length);
  const invalid = await handleMcpRpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "studyos_delete_task", arguments: { id: "task_1" } } }, deps);
  assert.equal(calls, 0);
  assert.equal(invalid.result.isError, true);
  const denied = await handleMcpRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "studyos_create_task", arguments: { title: "Leggere" } } }, { ...deps, actor: reader });
  assert.equal(calls, 0);
  assert.equal(denied.result.isError, true);
  const missing = await handleMcpRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "studyos_list_tasks", arguments: {} } }, offline);
  assert.equal(missing.result.isError, true);
  const status = await handleMcpRpc({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "studyos_status", arguments: {} } }, offline);
  assert.equal(status.result.isError, false);
  assert.match(status.result.content[0].text, /non è collegato/);
  ledger.remember("call_pronta", { ok: true, data: { saved: true } });
  const approval = await handleMcpRpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "studyos_approval_status", arguments: { approvalId: "call_pronta" } } }, { ...offline, ledger });
  assert.match(approval.result.content[0].text, /"saved":true/);
  assert.equal(approval.result.isError, false);
  const pending = await handleMcpRpc({
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: { name: "studyos_list_subjects", arguments: {} }
  }, {
    ...deps,
    invoke: async () => ({ ok: true, data: { status: "pending_approval", approvalId: "call_x" } })
  });
  assert.equal(pending.result.isError, false);
  assert.equal(await handleMcpRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, deps), null);
  const unknown = await handleMcpRpc({ jsonrpc: "2.0", id: 9, method: "sconosciuto" }, deps);
  assert.equal(unknown.error.code, -32601);
});

test("MCP: server/discover e tools/list nel formato che ChatGPT usa nel 2026", async () => {
  const deps = {
    actor,
    ledger: new ResultLedger(),
    connected: () => false,
    invoke: async () => { throw new Error("la discovery non deve chiamare l'app"); }
  };
  const discovered = await handleMcpRpc({
    jsonrpc: "2.0",
    id: "discover-1",
    method: "server/discover",
    params: {
      _meta: {
        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
        "io.modelcontextprotocol/clientInfo": { name: "ChatGPT", version: "1" },
        "io.modelcontextprotocol/clientCapabilities": {}
      }
    }
  }, deps);
  assert.equal(discovered.error, undefined);
  assert.equal(discovered.result.resultType, "complete");
  assert.equal(discovered.result.supportedVersions.includes("2026-07-28"), true);
  assert.equal(discovered.result.supportedVersions.includes("2025-11-25"), true);
  assert.equal(discovered.result.capabilities.tools.listChanged, false);
  assert.equal(typeof discovered.result.ttlMs, "number");
  assert.ok(discovered.result.ttlMs >= 0);
  assert.equal(discovered.result.cacheScope, "public");
  assert.equal(discovered.result._meta["io.modelcontextprotocol/serverInfo"].name, "studyos-mcp-server");
  assert.equal(typeof discovered.result.instructions, "string");

  const listed = await handleMcpRpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, deps);
  assert.equal(listed.result.resultType, "complete");
  assert.equal(typeof listed.result.ttlMs, "number");
  assert.equal(listed.result.cacheScope, "public");
  assert.equal(listed.result.tools.length, AGENT_TOOLS.length);
  const prompts = await handleMcpRpc({ jsonrpc: "2.0", id: 4, method: "prompts/list", params: {} }, deps);
  assert.deepEqual(prompts.result.prompts, []);
  assert.equal(prompts.result.resultType, "complete");

  const called = await handleMcpRpc({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "studyos_status", arguments: {} }
  }, deps);
  assert.equal(called.result.resultType, "complete");
  assert.equal(called.result.isError, false);
});

test("OAuth: PKCE, redirect, audience, code usa e getta, refresh ruotato", async () => {
  let now = 1_700_000_000_000;
  const canonical = "http://127.0.0.1:47321/mcp";
  const oauth = new OauthServer(canonical, () => now);
  const bad = oauth.register({ client_name: "Male", redirect_uris: ["http://evil.example/callback"] });
  assert.equal(bad.ok, false);
  const created = oauth.register({
    client_name: "ChatGPT <script>",
    redirect_uris: ["https://chatgpt.com/connector/oauth/callback"],
    token_endpoint_auth_method: "none"
  });
  assert.equal(created.ok, true);
  const verifier = "a".repeat(50);
  const challenge = await sha256Base64Url(verifier);
  const query = new URLSearchParams({
    client_id: created.client.clientId,
    redirect_uri: "https://chatgpt.com/connector/oauth/callback",
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: `${canonical}/`,
    scope: "studyos:read studyos:write offline_access",
    state: "stato-1"
  });
  const begun = oauth.beginAuthorization(query);
  assert.equal(begun.ok, true);
  assert.equal(begun.redirectHost, "chatgpt.com");
  assert.equal(oauth.resultFor(begun.requestId).state, "pending");
  const wrongAudience = oauth.beginAuthorization(new URLSearchParams({ ...Object.fromEntries(query), resource: "http://evil.example/mcp" }));
  assert.equal(wrongAudience.ok, false);
  const decided = oauth.decide(begun.requestId, true, ["studyos:read", "studyos:write"]);
  assert.equal(decided.ok, true);
  const ready = oauth.resultFor(begun.requestId);
  assert.equal(ready.state, "ready");
  assert.equal(ready.redirectTo, decided.redirectTo);
  const code = new URL(decided.redirectTo).searchParams.get("code");
  assert.ok(code);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: created.client.clientId,
    redirect_uri: "https://chatgpt.com/connector/oauth/callback",
    code,
    code_verifier: verifier,
    resource: canonical
  });
  const token = await oauth.exchange(form);
  assert.equal(token.ok, true);
  const replay = await oauth.exchange(form);
  assert.equal(replay.ok, false);
  assert.equal(replay.error, "invalid_grant");
  const refresh = token.body.refresh_token;
  const refreshed = await oauth.exchange(new URLSearchParams({
    grant_type: "refresh_token",
    client_id: created.client.clientId,
    refresh_token: refresh,
    resource: canonical
  }));
  assert.equal(refreshed.ok, true);
  const reused = await oauth.exchange(new URLSearchParams({
    grant_type: "refresh_token",
    client_id: created.client.clientId,
    refresh_token: refresh,
    resource: canonical
  }));
  assert.equal(reused.ok, false);
  const again = await oauth.exchange(new URLSearchParams({
    grant_type: "refresh_token",
    client_id: created.client.clientId,
    refresh_token: refreshed.body.refresh_token,
    resource: canonical
  }));
  assert.equal(again.ok, true);
  const dumped = JSON.stringify(oauth.dump());
  assert.equal(dumped.includes(token.body.access_token), false);
  assert.equal(dumped.includes(again.body.refresh_token), false);
  const authed = await oauth.authenticate(again.body.access_token);
  assert.equal(authed?.name.startsWith("ChatGPT"), true);
  assert.deepEqual(authed.scopes, ["studyos:read", "studyos:write"]);
  oauth.revokeAll();
  assert.equal(await oauth.authenticate(again.body.access_token), null);
  void now;
});

test("MCP: annotazioni coerenti con il rischio e liste lunghe accorciate in JSON valido", async () => {
  const listed = await handleMcpRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, { actor, ledger: new ResultLedger(), connected: () => false, invoke: async () => ({ ok: true, data: {} }) });
  for (const tool of listed.result.tools) {
    const source = findAgentTool(tool.name);
    assert.equal(tool.annotations.readOnlyHint, source.risk === "read", tool.name);
    if (source.risk === "destructive") assert.equal(tool.annotations.destructiveHint, true, tool.name);
    if (source.risk === "read") assert.equal(tool.annotations.destructiveHint, false, tool.name);
    assert.equal(typeof tool.annotations.title, "string", tool.name);
  }
  assert.equal(listed.result.tools.find((tool) => tool.name === "studyos_create_task").annotations.destructiveHint, false);
  assert.equal(listed.result.tools.find((tool) => tool.name === "studyos_update_task").annotations.destructiveHint, true);

  const items = Array.from({ length: 400 }, (_, index) => ({ id: `task_${index}`, title: "x".repeat(200) }));
  const long = await handleMcpRpc({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "studyos_list_tasks", arguments: {} } }, {
    actor,
    ledger: new ResultLedger(),
    connected: () => true,
    invoke: async () => ({ ok: true, data: { total: 400, count: 400, offset: 0, limit: 400, has_more: false, items } })
  });
  const parsed = JSON.parse(long.result.content[0].text);
  assert.equal(parsed.data.has_more, true);
  assert.equal(parsed.data.next_offset, parsed.data.items.length);
  assert.ok(parsed.data.items.length < 400);
  assert.ok(long.result.content[0].text.length <= 24_000);
});

test("OAuth: iss nel redirect, resource assente o radice, cursor://, loopback con porta diversa, revoca", async () => {
  const canonical = "https://studyos-agent.esempio.workers.dev/mcp";
  const oauth = new OauthServer(canonical);
  const verifier = "b".repeat(50);
  const challenge = await sha256Base64Url(verifier);
  assert.equal(oauth.register({ client_name: "Male", redirect_uris: ["javascript:alert(1)"] }).ok, false);
  assert.equal(oauth.register({ client_name: "Male", redirect_uris: ["http://evil.example/cb"] }).ok, false);
  const cursor = oauth.register({ client_name: "Cursor", redirect_uris: ["cursor://anysphere.cursor-mcp/oauth/callback"], token_endpoint_auth_method: "client_secret_post" });
  assert.equal(cursor.ok, true);
  const local = oauth.register({ client_name: "Claude Code", redirect_uris: ["http://localhost:33418/callback"] });
  assert.equal(local.ok, true);

  const start = (client, redirect, extra = {}) => oauth.beginAuthorization(new URLSearchParams({
    client_id: client.client.clientId,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "studyos:read studyos:write",
    state: "s",
    ...extra
  }));
  const noResource = start(cursor, "cursor://anysphere.cursor-mcp/oauth/callback");
  assert.equal(noResource.ok, true);
  assert.equal(start(cursor, "cursor://anysphere.cursor-mcp/oauth/callback", { resource: "https://studyos-agent.esempio.workers.dev" }).ok, true);
  assert.equal(start(cursor, "cursor://altro/oauth/callback").ok, false);
  const otherPort = start(local, "http://localhost:51234/callback");
  assert.equal(otherPort.ok, true);
  assert.equal(start(local, "http://localhost:51234/altro").ok, false);

  const decided = oauth.decide(otherPort.requestId, true, ["studyos:read"]);
  const back = new URL(decided.redirectTo);
  assert.equal(back.origin, "http://localhost:51234");
  assert.equal(back.searchParams.get("iss"), "https://studyos-agent.esempio.workers.dev");
  const token = await oauth.exchange(new URLSearchParams({
    grant_type: "authorization_code",
    client_id: local.client.clientId,
    redirect_uri: "http://localhost:51234/callback",
    code: back.searchParams.get("code"),
    code_verifier: verifier
  }));
  assert.equal(token.ok, true);
  assert.deepEqual((await oauth.authenticate(token.body.access_token)).scopes, ["studyos:read"]);
  await oauth.revokeToken(token.body.refresh_token);
  assert.equal(await oauth.authenticate(token.body.access_token), null);
  const refreshed = await oauth.exchange(new URLSearchParams({ grant_type: "refresh_token", client_id: local.client.clientId, refresh_token: token.body.refresh_token }));
  assert.equal(refreshed.ok, false);
});

// /register è aperto a tutti (registrazione dinamica): 50 registrazioni non devono bloccare per
// sempre i connettori nuovi, e /authorize non deve riempire StudyOS di richieste di consenso.
const oauthHarness = async () => {
  const clock = { now: 1_800_000_000_000 };
  const oauth = new OauthServer("https://studyos-agent.esempio.workers.dev/mcp", () => clock.now);
  const verifier = "c".repeat(50);
  const challenge = await sha256Base64Url(verifier);
  const redirect = "https://chatgpt.com/connector/oauth/callback";
  const register = (name = "Spam") => {
    const created = oauth.register({ client_name: name, redirect_uris: [redirect] });
    assert.equal(created.ok, true, JSON.stringify(created));
    clock.now += 1000;
    return created.client.clientId;
  };
  const begin = (clientId) => oauth.beginAuthorization(new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: "studyos:read"
  }));
  const connect = async (clientId) => {
    const begun = begin(clientId);
    assert.equal(begun.ok, true, JSON.stringify(begun));
    const code = new URL(oauth.decide(begun.requestId, true, ["studyos:read"]).redirectTo).searchParams.get("code");
    const token = await oauth.exchange(new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: redirect, code, code_verifier: verifier }));
    assert.equal(token.ok, true, JSON.stringify(token));
    return token.body;
  };
  const registered = (clientId) => oauth.dump().clients.some((client) => client.clientId === clientId);
  const pending = (begun) => begun.ok && oauth.pendingConsent(begun.requestId) !== null;
  return { clock, oauth, register, begin, connect, registered, pending };
};

test("OAuth: registrazione piena, si fa posto togliendo i client senza token, dal più vecchio", async () => {
  const { clock, oauth, register, begin, connect, registered } = await oauthHarness();
  const live = register("ChatGPT");
  const tokens = await connect(live);
  const waiting = register("Claude");
  const consent = begin(waiting);
  assert.equal(consent.ok, true);
  // Registrato, ma non ancora arrivato a /authorize (il client ci mette qualche secondo).
  const fresh = register("Appena registrato");
  const spam = Array.from({ length: 47 }, () => register());
  assert.equal(oauth.dump().clients.length, 50);

  // Nei primi 2 minuti dopo la registrazione nessun client si toglie: 50 registrazioni subito dopo
  // non fanno perdere il client a chi sta per autorizzarlo.
  assert.equal(oauth.register({ client_name: "Troppo presto", redirect_uris: ["https://attacker.example/cb"] }).ok, false);
  assert.equal(registered(fresh), true);
  const freshConsent = begin(fresh);
  assert.equal(freshConsent.ok, true, JSON.stringify(freshConsent));

  // Dopo 2 minuti si toglie il client senza token più vecchio; mai uno con token o con un consenso aperto.
  clock.now += 2 * 60 * 1000;
  const newcomer = register("Nuovo");
  assert.equal(registered(newcomer), true);
  assert.equal(registered(spam[0]), false);
  assert.equal(registered(spam[1]), true);
  for (let index = 0; index < 40; index += 1) register();
  assert.equal(oauth.dump().clients.length, 50);
  assert.equal(registered(live), true);
  assert.equal(registered(waiting), true);
  assert.equal(registered(fresh), true);
  assert.ok(await oauth.authenticate(tokens.access_token));
  assert.equal(oauth.decide(consent.requestId, true, ["studyos:read"]).ok, true);
  assert.equal(oauth.decide(freshConsent.requestId, true, ["studyos:read"]).ok, true);
  assert.equal(begin(spam[5]).ok, false, "un client tolto non apre più consensi");

  // Una registrazione mai usata scade dopo 24 ore; un client con token resta.
  const unused = register("Mai usato");
  clock.now += 24 * 60 * 60 * 1000 + 1;
  assert.equal(registered(unused), false);
  assert.equal(registered(live), true);
});

test("OAuth: «Revoca gli accessi» toglie anche i client, e i consensi aperti sono pochi e brevi", async () => {
  const { clock, oauth, register, begin, connect, registered, pending } = await oauthHarness();
  const live = register("ChatGPT");
  await connect(live);
  const spammer = register("Spam");

  // Al massimo 5 richieste aperte per client: la sesta prende il posto della più vecchia.
  const asked = Array.from({ length: 6 }, () => begin(spammer));
  assert.ok(asked.every((item) => item.ok));
  assert.equal(oauth.pendingConsent(asked[0].requestId), null);
  for (const item of asked.slice(1)) assert.ok(pending(item));

  // In tutto al massimo 20 consensi in attesa, ma /authorize non risponde mai «troppe richieste»:
  // il nuovo prende il posto del più vecchio, prima di tutto quelli di client mai usati.
  const mine = begin(live);
  const others = Array.from({ length: 4 }, () => register());
  const flood = others.flatMap((clientId) => Array.from({ length: 5 }, () => begin(clientId)));
  assert.ok(flood.every((item) => item.ok));
  assert.ok(pending(mine), "il consenso di un client già usato resta");
  for (const item of asked.slice(1)) assert.equal(pending(item), false);
  assert.equal(pending(flood[0]), false);
  assert.ok(flood.slice(1).every(pending));
  const legit = begin(register("Claude"));
  assert.ok(pending(legit), "chi si collega davvero non riceve mai 429");
  assert.ok(pending(mine));
  assert.equal(pending(flood[1]), false);

  // Scadono dopo 5 minuti: poi si può chiedere di nuovo.
  clock.now += 5 * 60 * 1000 + 1;
  assert.equal(pending(asked[5]), false);
  assert.equal(pending(legit), false);
  // Se tutti i consensi in attesa sono di client già usati, si toglie il più vecchio in assoluto.
  const used = [];
  for (let index = 0; index < 5; index += 1) {
    const clientId = register(`Usato ${index}`);
    await connect(clientId);
    used.push(clientId);
  }
  const waiting = used.slice(0, 4).flatMap((clientId) => Array.from({ length: 5 }, () => begin(clientId)));
  assert.ok(waiting.every(pending));
  const last = begin(used[4]);
  assert.ok(pending(last));
  assert.equal(pending(waiting[0]), false);
  assert.ok(waiting.slice(1).every(pending));
  const again = begin(live);
  assert.equal(again.ok, true, JSON.stringify(again));

  oauth.revokeAll();
  assert.deepEqual(oauth.dump().clients, []);
  assert.equal(registered(live), false);
  assert.equal(oauth.pendingConsent(again.requestId), null);
  assert.equal(register("Di nuovo") !== undefined, true);
});

const shareGrant = (over) => ({
  id: "s1",
  ownerId: "owner-uuid-1",
  ownerName: "Alice",
  scope: "tasks",
  subjectIds: [],
  permission: "view",
  granteeUserId: "me-uuid",
  granteeGroupId: null,
  granteeName: "Bob",
  granteeEmail: "bob@example.com",
  createdAt: "2026-11-10T00:00:00.000Z",
  updatedAt: "2026-11-10T00:00:00.000Z",
  ...over
});

const sharedEntry = (entityType, entityId, entity) => ({
  key: `owner-uuid-1:${entityType}:${entityId}`,
  ownerId: "owner-uuid-1",
  entityType,
  entityId,
  entity: { id: entityId, updatedAt: "2026-11-10T08:00:00.000Z", ...entity },
  serverUpdatedAt: "2026-11-10T08:00:00.000Z"
});

test("condivisione per agenti: id opachi, niente email, id di account o file", () => {
  const items = [
    sharedEntry("task", "task_1", { title: "Relazione", status: "todo", subjectId: "sub_bio" }),
    sharedEntry("attachment", "att_1", { name: "dispense", dataUrl: "data:application/pdf;base64,SEGRETOFILE" }),
    sharedEntry("calendarEvent", "event_1", {
      title: "Appello",
      description: "",
      start: "2026-11-12T09:00:00.000Z",
      end: "2026-11-12T11:00:00.000Z",
      recurrence: "none",
      sourceUid: "barb-exam-x"
    })
  ];
  const received = [shareGrant({ scope: "tasks" }), shareGrant({ id: "s2", scope: "materials" }), shareGrant({ id: "s3", scope: "calendar" })];
  const labels = [{ ownerId: "owner-uuid-1", id: "sub_bio", name: "Biochimica", color: "#22c55e", icon: "" }];
  const span = { from: new Date("2026-11-10T00:00:00.000Z"), to: new Date("2026-11-20T00:00:00.000Z") };
  const view = sharedItemsView(items, received, labels, span);
  const grants = received.map((entry) => publicShareGrant(entry, "received", () => "Biochimica"));
  const given = publicShareGrant(shareGrant({ ownerId: "me-uuid", granteeUserId: "friend-uuid" }), "given", () => undefined);
  const packed = JSON.stringify({ view, grants, given });
  for (const secret of ["owner-uuid-1", "me-uuid", "friend-uuid", "bob@example.com", "SEGRETOFILE", "barb-exam-x"]) {
    assert.equal(packed.includes(secret), false, secret);
  }
  assert.equal(view.length, 3);
  const event = view.find((item) => item.entityType === "calendarEvent");
  assert.equal(event.officialExam, true);
  assert.equal(event.owner, "Alice");
  assert.equal(event.canEdit, false);
  assert.equal(view.find((item) => item.entityType === "task").subjectName, "Biochimica");
  assert.match(personHandle("owner-uuid-1"), /^person_[0-9a-f]{16}$/);
  assert.equal(given.personId, personHandle("friend-uuid"));
  assert.equal(findSharedByHandle(items, sharedHandle(items[0])), items[0]);
  assert.equal(sharedItemsView(items, received, labels, { ...span, scope: "tasks" }).length, 1);
  assert.equal(sharedItemsView(items, received, labels, { ...span, personId: "person_0000000000000000" }).length, 0);
});

test("condivisione per agenti: si scrive solo con «Può modificare» e solo nei campi previsti", () => {
  const now = "2026-11-10T09:00:00.000Z";
  const entry = sharedEntry("task", "task_1", { title: "Relazione", status: "todo", subjectId: "sub_bio" });
  const viewOnly = [shareGrant({ scope: "tasks", permission: "view" })];
  const editBio = [shareGrant({ scope: "tasks", permission: "edit", subjectIds: ["sub_bio"] })];
  assert.equal(planSharedUpdate(viewOnly, entry, { status: "done" }, now).code, "denied");
  assert.equal(planSharedDelete(viewOnly, entry).code, "denied");
  const done = planSharedUpdate(editBio, entry, { status: "done" }, now);
  assert.equal(done.ok, true);
  assert.equal(done.entity.completedAt, now);
  assert.equal(done.entity.updatedAt, now);
  assert.equal(planSharedUpdate(editBio, entry, { subjectId: "sub_chim" }, now).code, "invalid");
  assert.equal(planSharedUpdate(editBio, entry, { status: "finita" }, now).code, "invalid");
  assert.equal(planSharedUpdate(editBio, entry, {}, now).code, "invalid");
  assert.equal(planSharedDelete(editBio, entry).ok, true);

  const draft = { entityType: "task", title: "Nuova", description: "", notes: "", priority: "medium", color: "#7CF7C8" };
  assert.equal(planSharedCreate(viewOnly, "owner-uuid-1", newSharedEntity(draft, "task_9", now)).code, "denied");
  // Con il filtro per materia, un'attività senza materia esce da ciò che è condiviso.
  assert.equal(planSharedCreate(editBio, "owner-uuid-1", newSharedEntity(draft, "task_9", now)).code, "denied");
  const created = planSharedCreate(editBio, "owner-uuid-1", newSharedEntity({ ...draft, subjectId: "sub_bio" }, "task_9", now));
  assert.equal(created.ok, true);
  assert.equal(created.entity.status, "todo");
  assert.equal(created.entity.id, "task_9");

  const offers = agentOffers(["barb_exams", "goals", "tasks"], "edit", ["sub_bio"], [{ id: "sub_bio", name: "Biochimica" }]);
  assert.deepEqual(offers.map((offer) => [offer.scope, offer.permission, offer.subjectIds, offer.subjectNames]), [
    ["barb_exams", "view", ["sub_bio"], ["Biochimica"]],
    ["goals", "edit", [], []],
    ["tasks", "edit", ["sub_bio"], ["Biochimica"]]
  ]);
  for (const name of ["studyos_list_shared_items", "studyos_share_with"]) {
    const schema = findAgentTool(name).inputSchema.properties;
    const scopes = schema.scope?.enum ?? schema.scopes.items.enum;
    assert.deepEqual(scopes, [...SHARE_SCOPES], name);
  }
});

test("condivisione per agenti: un cambio di stato chiude il cronometro del proprietario e non lo avvia mai", () => {
  const now = "2026-11-10T10:00:00.000Z";
  const edit = [shareGrant({ scope: "tasks", permission: "edit" })];
  const running = sharedEntry("task", "task_r", {
    title: "Laboratorio",
    status: "doing",
    timerStartedAt: "2026-11-10T09:30:00.000Z",
    timerAccumulatedSeconds: 600,
    timerLastReminderAt: "2026-11-10T09:30:00.000Z"
  });
  // Come l'app del proprietario: il tempo già contato (10 min) più quello in corso (30 min) resta.
  const done = planSharedUpdate(edit, running, { status: "done" }, now);
  assert.equal(done.ok, true);
  assert.equal(done.entity.status, "done");
  assert.equal(done.entity.timerStartedAt, undefined);
  assert.equal(done.entity.timerAccumulatedSeconds, 2400);
  assert.equal(done.entity.actualMinutes, 40);
  assert.equal(done.entity.completedAt, now);
  const blocked = planSharedUpdate(edit, running, { status: "blocked" }, now);
  assert.equal(blocked.entity.timerStartedAt, undefined);
  assert.equal(blocked.entity.actualMinutes, 40);
  // Riaprire un'attività completata toglie il completamento.
  const reopened = planSharedUpdate(edit, sharedEntry("task", "task_d", { title: "Fatta", status: "done", completedAt: now }), { status: "todo" }, now);
  assert.equal(reopened.entity.completedAt, undefined);
  // Chi riceve non avvia mai il cronometro del proprietario.
  const todo = sharedEntry("task", "task_t", { title: "Relazione", status: "todo" });
  const started = planSharedUpdate(edit, todo, { status: "doing" }, now);
  assert.equal(started.ok, false);
  assert.equal(started.code, "denied");
  assert.match(started.error, /cronometro/);
  // Già «In corso»: si può lasciare com'è, il cronometro continua.
  const kept = planSharedUpdate(edit, running, { status: "doing", title: "Laboratorio 2" }, now);
  assert.equal(kept.ok, true);
  assert.equal(kept.entity.timerStartedAt, "2026-11-10T09:30:00.000Z");
  assert.equal(kept.entity.title, "Laboratorio 2");
  // Solo i campi indicati cambiano: il resto dell'ultima copia resta.
  assert.equal(kept.entity.timerAccumulatedSeconds, 600);
});

test("condivisione per agenti: niente copertine, file, colori o link pericolosi dai dati altrui", () => {
  const items = [
    sharedEntry("task", "task_c", {
      title: "Con copertina",
      status: "doing",
      cover: "data:image/png;base64,COPERTINA",
      timerStartedAt: "2026-11-10T09:00:00.000Z",
      timerAccumulatedSeconds: 77,
      timerLastReminderAt: "2026-11-10T09:00:00.000Z"
    }),
    sharedEntry("calendarEvent", "event_c", {
      title: "Colorato",
      description: "",
      start: "2026-11-12T09:00:00.000Z",
      end: "2026-11-12T10:00:00.000Z",
      color: "url(https://tracker.example/pixel)",
      cover: "data:image/png;base64,FOTOEVENTO",
      links: ["javascript:alert(1)", "https://example.org/ok", "data:text/html,PAYLOAD", 42]
    }),
    sharedEntry("calendarEvent", "event_h", { title: "Esadecimale", start: "2026-11-13T09:00:00.000Z", end: "2026-11-13T10:00:00.000Z", color: "#22c55e" }),
    // Dati altrui malformati: non si mostrano come occorrenze e non bloccano l'elenco.
    sharedEntry("calendarEvent", "event_bad", { title: "Rotto", start: 42, end: null, recurrence: "weekly", recurrenceUntil: 7 }),
    sharedEntry("attachment", "att_l", { name: "Link", externalUrl: "javascript:alert(2)", mimeType: "text/uri-list" }),
    sharedEntry("attachment", "att_ok", { name: "Dispense", externalUrl: "https://example.org/dispense" })
  ];
  const received = [
    shareGrant({ scope: "tasks" }),
    shareGrant({ id: "s2", scope: "calendar" }),
    shareGrant({ id: "s3", scope: "materials" })
  ];
  const span = { from: new Date("2026-11-10T00:00:00.000Z"), to: new Date("2026-11-20T00:00:00.000Z") };
  const view = sharedItemsView(items, received, [], span);
  const packed = JSON.stringify(view);
  for (const secret of ["COPERTINA", "FOTOEVENTO", "tracker.example", "javascript:", "PAYLOAD", "timerStartedAt", "timerAccumulatedSeconds", "timerLastReminderAt"]) {
    assert.equal(packed.includes(secret), false, secret);
  }
  const colored = view.find((item) => item.title === "Colorato");
  assert.deepEqual(colored.links, ["https://example.org/ok"]);
  assert.equal(colored.color, undefined);
  assert.equal(view.find((item) => item.title === "Esadecimale").color, "#22c55e");
  assert.equal(view.some((item) => item.title === "Rotto"), false);
  assert.equal(view.find((item) => item.name === "Link").externalUrl, undefined);
  assert.equal(view.find((item) => item.name === "Dispense").externalUrl, "https://example.org/dispense");
});

test("condivisione per agenti: solo i campi previsti e, a ogni profondità, niente file o link pericolosi", () => {
  const subtasks = Array.from({ length: 40 }, (_, index) => ({ id: `st_${index}`, text: `Passo ${index}`, done: false }));
  subtasks[0] = { id: "st_0", text: "data:text/html;base64,NIDIFICATO", done: false };
  subtasks[1] = { id: "st_1", text: "Allegato", done: false, extra: { dataUrl: "data:image/png;base64,PROFONDO", note: "ok" } };
  subtasks[2] = { id: "st_2", text: "  JaVa\tScript:alert(3)", done: false };
  const task = sharedEntry("task", "task_m", {
    title: "Profondo",
    status: "todo",
    notes: "Data: 12 novembre, aula 3",
    description: "javascript:alert(4)",
    subtasks,
    website: "javascript:alert(1)",
    secretField: "SEGRETO",
    attachmentIds: ["att_privato"],
    nested: { deeper: { dataUrl: "data:application/pdf;base64,ANNIDATO" } }
  });
  const exam = sharedEntry("exam", "exam_m", {
    date: "2026-12-01T09:00:00.000Z",
    status: "studying",
    program: ["Enzimi", "data:text/html,PROGRAMMA", "file:///etc/passwd", "File: capitolo 3"],
    cover: "data:image/png;base64,COPERTINA"
  });
  const received = [shareGrant({ scope: "tasks" }), shareGrant({ id: "s2", scope: "progress" })];
  const span = { from: new Date("2026-11-10T00:00:00.000Z"), to: new Date("2026-11-20T00:00:00.000Z") };
  const view = sharedItemsView([task, exam], received, [], span);
  const packed = JSON.stringify(view);
  for (const secret of ["data:", "NIDIFICATO", "PROFONDO", "ANNIDATO", "PROGRAMMA", "COPERTINA", "dataUrl", "JaVa", "javascript", "file://", "website", "secretField", "SEGRETO", "att_privato", "nested"]) {
    assert.equal(packed.includes(secret), false, secret);
  }
  const item = view.find((entry) => entry.entityType === "task");
  assert.equal(item.title, "Profondo");
  // Testo normale che comincia con una parola e i due punti: resta.
  assert.equal(item.notes, "Data: 12 novembre, aula 3");
  assert.equal(item.description, undefined);
  // Negli elenchi le liste lunghe si accorciano, con il totale.
  assert.equal(item.subtasks.length, 20);
  assert.equal(item.subtasksCount, 40);
  assert.deepEqual(item.subtasks[0], { id: "st_0", done: false });
  assert.deepEqual(item.subtasks[1], { id: "st_1", text: "Allegato", done: false, extra: { note: "ok" } });
  assert.equal(item.subtasks[3].text, "Passo 3");
  assert.deepEqual(view.find((entry) => entry.entityType === "exam").program, ["Enzimi", "File: capitolo 3"]);
  // Nel dettaglio la lista è intera, con gli stessi filtri.
  const full = publicSharedItem(task, received, [], false);
  assert.equal(full.subtasks.length, 40);
  assert.equal(full.subtasksCount, undefined);
  assert.equal(JSON.stringify(full).includes("data:"), false);
});

const seedApp = (shared = {}) => {
  useStudyStore.setState({
    loading: false,
    locked: false,
    persistError: null,
    subjects: [],
    tasks: [],
    events: [],
    exams: [],
    sessions: [],
    topics: [],
    notes: [],
    goals: [],
    attachments: [],
    notifications: [],
    preferences: [],
    studyGroups: [],
    groupResources: []
  });
  useSharedStore.setState({
    availability: "ready",
    viewerId: "me-uuid",
    persistent: false,
    given: [],
    received: [],
    invites: [],
    items: [],
    labels: [],
    outbox: [],
    hiddenOwners: [],
    notice: null,
    syncError: null,
    ...shared
  });
};

test("strumenti condivisi: elenco, permessi e conferma con il nome di chi condivide", async () => {
  const task = sharedEntry("task", "task_1", { title: "Relazione", status: "todo", subjectId: "sub_bio" });
  const labels = [{ ownerId: "owner-uuid-1", id: "sub_bio", name: "Biochimica", color: "url(https://x)", icon: "" }];
  seedApp({ received: [shareGrant({ scope: "tasks", permission: "view" })], items: [task], labels });
  const handle = sharedHandle(task);
  const alice = personHandle("owner-uuid-1");

  const shares = await executeAgentTool("studyos_list_shares", {});
  assert.equal(shares.ok, true);
  assert.equal(shares.data.received[0].personId, alice);
  assert.equal(shares.data.received[0].owner, "Alice");
  const packed = JSON.stringify(shares);
  for (const secret of ["owner-uuid-1", "me-uuid", "bob@example.com", "@"]) assert.equal(packed.includes(secret), false, secret);

  const listed = await executeAgentTool("studyos_list_shared_items", { scope: "tasks" });
  assert.equal(listed.ok, true);
  assert.equal(listed.data.total, 1);
  assert.equal(listed.data.items[0].id, handle);
  assert.equal(listed.data.items[0].canEdit, false);

  // La conferma in StudyOS dice di chi è l'elemento, mai un id.
  assert.equal(await describeAgentCall("studyos_update_shared_item", { id: handle, status: "done" }), "Modificare un elemento condiviso con te: «Relazione di Alice»");
  assert.equal(await describeAgentCall("studyos_share_with", { personId: alice, scopes: ["calendar"] }), "Condividere Calendario: «Alice»");
  assert.equal(await describeAgentCall("studyos_revoke_share", { id: "s1", confirm: true }), "Togliere una condivisione: «Attività · Alice»");
  // Il registro salvato sul dispositivo (anche col vault) non tiene titoli o nomi di altre persone.
  assert.equal(await describeAgentCall("studyos_update_shared_item", { id: handle, status: "done" }, { audit: true }), "Modificare un elemento condiviso con te");
  assert.equal(await describeAgentCall("studyos_share_with", { personId: alice, scopes: ["calendar"] }, { audit: true }), "Condividere Calendario");
  assert.equal(await describeAgentCall("studyos_revoke_share", { id: "s1", confirm: true }, { audit: true }), "Togliere una condivisione");

  const denied = await executeAgentTool("studyos_update_shared_item", { id: handle, status: "done" });
  assert.deepEqual(denied, { ok: false, code: "denied", error: "Puoi solo vedere questo elemento." });
  assert.equal((await executeAgentTool("studyos_delete_shared_item", { id: handle, confirm: true })).code, "denied");
  assert.equal(useSharedStore.getState().outbox.length, 0);

  useSharedStore.setState({ received: [shareGrant({ scope: "tasks", permission: "edit" })] });
  const updated = await executeAgentTool("studyos_update_shared_item", { id: handle, status: "done", notes: "Fatto ieri" });
  assert.equal(updated.ok, true);
  const saved = useSharedStore.getState().items[0].entity;
  assert.equal(saved.status, "done");
  assert.equal(saved.notes, "Fatto ieri");
  assert.equal(saved.title, "Relazione");
  assert.equal(typeof saved.completedAt, "string");
  assert.equal(useSharedStore.getState().outbox.length, 1);

  const created = await executeAgentTool("studyos_create_shared_item", { personId: alice, entityType: "task", title: "Nuova", subjectId: "sub_bio" });
  assert.equal(created.ok, true);
  assert.match(created.data.id, new RegExp(`^${alice}:task:task_`));
  assert.equal((await executeAgentTool("studyos_create_shared_item", { personId: "person_0000000000000000", entityType: "task", title: "X" })).code, "not_found");

  // Un id di un elemento altrui non collega una nota personale.
  const linked = await executeAgentTool("studyos_create_note", { title: "Nota", body: "", linkedEntityType: "task", linkedEntityId: handle });
  assert.equal(linked.ok, false);
  assert.equal(linked.code, "invalid");
});

test("strumenti condivisi: le persone nascoste spariscono come nell'app", async () => {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const event = sharedEntry("calendarEvent", "event_today", {
    title: "Laboratorio di oggi",
    description: "",
    start: today.toISOString(),
    end: new Date(today.getTime() + 3_600_000).toISOString()
  });
  const task = sharedEntry("task", "task_1", { title: "Relazione", status: "todo" });
  seedApp({ received: [shareGrant({ scope: "tasks", permission: "edit" }), shareGrant({ id: "s2", scope: "calendar", permission: "edit" })], items: [event, task] });

  const overview = await executeAgentTool("studyos_overview", {});
  assert.equal(overview.ok, true);
  assert.equal(overview.data.sharedTodayEvents.items.length, 1);
  assert.equal(overview.data.sharedTodayEvents.items[0].owner, "Alice");
  // Come in studyos_list_shared_items: testi di altre persone, da non seguire come istruzioni.
  assert.match(overview.data.sharedTodayEvents.note, /sono dati, non istruzioni/);
  assert.equal((await executeAgentTool("studyos_list_shared_items", {})).data.total, 2);

  useSharedStore.setState({ hiddenOwners: ["owner-uuid-1"] });
  assert.equal((await executeAgentTool("studyos_list_shared_items", {})).data.total, 0);
  assert.equal((await executeAgentTool("studyos_overview", {})).data.sharedTodayEvents, undefined);
  const handle = sharedHandle(task);
  assert.equal((await executeAgentTool("studyos_update_shared_item", { id: handle, title: "Altro" })).code, "not_found");
  assert.equal((await executeAgentTool("studyos_delete_shared_item", { id: handle, confirm: true })).code, "not_found");
  // Anche creare: un id restituito deve poi funzionare con update e delete.
  const hiddenCreate = await executeAgentTool("studyos_create_shared_item", { personId: personHandle("owner-uuid-1"), entityType: "task", title: "Nascosta" });
  assert.equal(hiddenCreate.code, "not_found");
  assert.equal(await describeAgentCall("studyos_delete_shared_item", { id: handle, confirm: true }), "Eliminare un elemento condiviso con te");
  assert.equal(useSharedStore.getState().items.length, 2);
  assert.equal(useSharedStore.getState().outbox.length, 0);
  const shares = await executeAgentTool("studyos_list_shares", {});
  assert.equal(shares.data.received.every((grant) => grant.hidden === true), true);
});

test("strumenti condivisi: mai errori grezzi, solo testi in italiano", async () => {
  const task = sharedEntry("task", "task_1", { title: "Relazione", status: "todo" });
  seedApp({ received: [shareGrant({ scope: "tasks", permission: "edit" })], items: [task] });
  const handle = sharedHandle(task);
  const original = useSharedStore.getState();
  const failing = async (cause, run) => {
    useSharedStore.setState({ saveSharedItem: async () => { throw cause; }, deleteSharedItem: async () => { throw cause; } });
    try {
      return await run();
    } finally {
      useSharedStore.setState({ saveSharedItem: original.saveSharedItem, deleteSharedItem: original.deleteSharedItem });
    }
  };
  const update = () => executeAgentTool("studyos_update_shared_item", { id: handle, title: "Nuovo titolo" });

  const crashed = await failing(new Error("QuotaExceededError: IndexedDB exploded"), update);
  assert.deepEqual(crashed, { ok: false, code: "failed", error: "Modifiche non salvate. Riprova tra poco." });
  const offline = await failing(new TypeError("Failed to fetch"), update);
  assert.equal(offline.code, "failed");
  assert.match(offline.error, /^Modifiche non salvate\. Server cloud non raggiungibile/);
  const refused = await failing(new ShareUserError("Puoi solo vedere questo elemento."), () => executeAgentTool("studyos_delete_shared_item", { id: handle, confirm: true }));
  assert.deepEqual(refused, { ok: false, code: "denied", error: "Elemento non eliminato. Puoi solo vedere questo elemento." });

  // Il server rifiuta con un errore tecnico (iniettato): all'agente arriva solo il testo in italiano.
  useSharedStore.setState({ given: [shareGrant({ id: "g1", ownerId: "me-uuid", granteeUserId: "owner-uuid-1", granteeName: "Alice" })] });
  const { shareSyncLoader } = await import("../src/agent/sharedTools.ts");
  const realLoader = shareSyncLoader.load;
  const calls = [];
  const serverWith = (cause) => async () => {
    const run = async (...args) => {
      calls.push(args);
      if (cause) throw cause;
    };
    return { shareWith: run, updateShare: run, revokeShare: run };
  };
  const shareWithAlice = () => executeAgentTool("studyos_share_with", { personId: personHandle("owner-uuid-1"), scopes: ["calendar"], permission: "view" });
  try {
    const raw = new Error('duplicate key value violates unique constraint "studyos_shares_pkey"');
    shareSyncLoader.load = serverWith(raw);
    assert.deepEqual(await shareWithAlice(), { ok: false, code: "failed", error: "Condivisione non salvata. Riprova tra poco." });
    const update = await executeAgentTool("studyos_update_share", { id: "g1", permission: "edit" });
    assert.equal(update.code, "failed");
    assert.equal(update.error.includes("duplicate"), false, update.error);
    const revoke = await executeAgentTool("studyos_revoke_share", { id: "g1", confirm: true });
    assert.equal(revoke.code, "failed");
    assert.equal(revoke.error.includes("studyos_shares"), false, revoke.error);
    assert.equal(calls.length, 3);

    // Un testo pensato per l'utente passa; un problema di rete diventa il messaggio dell'app.
    shareSyncLoader.load = serverWith(new ShareUserError("Questa persona non riceve più condivisioni."));
    assert.deepEqual(await shareWithAlice(), { ok: false, code: "failed", error: "Condivisione non salvata. Questa persona non riceve più condivisioni." });
    shareSyncLoader.load = serverWith(new TypeError("Failed to fetch"));
    assert.match((await shareWithAlice()).error, /^Condivisione non salvata\. Server cloud non raggiungibile/);
    // La condivisione non c'è più (tolta altrove): il server non tocca nessuna riga e l'agente non dice ok.
    shareSyncLoader.load = serverWith(new ShareUserError("Questa condivisione non c'è più."));
    assert.deepEqual(await executeAgentTool("studyos_update_share", { id: "g1", permission: "edit" }), {
      ok: false, code: "failed", error: "Permessi non aggiornati. Questa condivisione non c'è più."
    });
    assert.deepEqual(await executeAgentTool("studyos_revoke_share", { id: "g1", confirm: true }), {
      ok: false, code: "failed", error: "Condivisione non tolta. Questa condivisione non c'è più."
    });
    // Il modulo non si carica (offline, chunk mancante): errore generico, mai il messaggio tecnico.
    shareSyncLoader.load = async () => { throw new TypeError("Failed to fetch dynamically imported module: /assets/shareSync.js"); };
    const offline = await shareWithAlice();
    assert.equal(offline.code, "failed");
    assert.equal(/dynamically|assets|\.js/.test(offline.error), false, offline.error);

    calls.length = 0;
    shareSyncLoader.load = serverWith(null);
    const done = await shareWithAlice();
    assert.equal(done.ok, true);
    assert.equal(done.data.sharedWith, "Alice");
    assert.deepEqual(calls[0][0], { userId: "owner-uuid-1", name: "Alice" });
    assert.deepEqual(calls[0][1].map((offer) => [offer.scope, offer.permission]), [["calendar", "view"]]);
  } finally {
    shareSyncLoader.load = realLoader;
  }

  // Regole controllate prima del server.
  assert.equal((await executeAgentTool("studyos_share_with", { personId: "person_0000000000000000", scopes: ["calendar"] })).code, "not_found");
  assert.equal((await executeAgentTool("studyos_update_share", { id: "s1", permission: "edit" })).code, "not_found");
  useSharedStore.setState({ given: [shareGrant({ id: "g2", ownerId: "me-uuid", scope: "barb_exams", granteeUserId: "owner-uuid-1" })] });
  assert.equal((await executeAgentTool("studyos_update_share", { id: "g2", permission: "edit" })).code, "invalid");
  useSharedStore.setState({ received: [shareGrant({ id: "via-group", granteeUserId: null, granteeGroupId: "group-1" })] });
  assert.equal((await executeAgentTool("studyos_revoke_share", { id: "via-group", confirm: true })).code, "denied");
  useSharedStore.setState({ viewerId: null });
  assert.equal((await executeAgentTool("studyos_list_shares", {})).code, "not_connected");
});

const seedTimerApp = () => {
  seedApp();
  useStudyStore.setState({
    subjects: [{ id: "sub_an", name: "Analisi 1", status: "active", archived: false, timer: { focusMinutes: 50, stopwatchTargetMinutes: 90 }, updatedAt: "2026-01-01T00:00:00.000Z" }],
    timer: defaultTimer("pomodoro")
  });
};

test("timer MCP: le enum del catalogo sono le costanti del timer, argomenti nuovi solo facoltativi", () => {
  const control = findAgentTool("studyos_timer_control").inputSchema;
  assert.deepEqual(control.properties.action.enum, [...TIMER_CONTROL_ACTIONS]);
  assert.deepEqual(control.properties.mode.enum, [...TIMER_MODES]);
  assert.deepEqual(control.properties.kind.enum, [...TIMER_KINDS]);
  assert.ok(control.properties.subjectId);
  assert.deepEqual(control.required, ["action"]);
  for (const old of ["start", "toggle", "reset"]) assert.ok(control.properties.action.enum.includes(old), old);
  assert.deepEqual(Object.keys(findAgentTool("studyos_timer_status").inputSchema.properties ?? {}), []);
});

test("timer MCP: start, stato compatibile e arrotondamenti dell'app", async () => {
  seedTimerApp();
  assert.equal((await executeAgentTool("studyos_timer_control", { action: "start" })).code, "invalid", "start senza mode resta un errore");
  const started = await executeAgentTool("studyos_timer_control", { action: "start", mode: "classic" });
  assert.equal(started.ok, true);
  const timer = started.data.timer;
  for (const key of ["mode", "running", "remainingSeconds", "durationSeconds", "label", "kind", "phase", "elapsedSeconds", "subjectId"]) assert.ok(key in timer, key);
  assert.equal(timer.mode, "classic");
  assert.equal(timer.running, true);
  assert.equal(timer.durationSeconds, 45 * 60);
  assert.equal(timer.kind, "pomodoro");
  assert.equal(timer.phase, "focus");
  assert.equal(timer.subjectId, null);
  assert.equal(typeof timer.label, "string");

  // 1499,5 s rimasti: l'app mostra 25:00, quindi 1500 (non 1499 come con Math.round).
  const current = useStudyStore.getState().timer;
  useStudyStore.setState({ timer: { ...current, endsAt: Date.now() + 1_499_500 } });
  assert.equal((await executeAgentTool("studyos_timer_status", {})).data.timer.remainingSeconds, 1500);

  const toggled = await executeAgentTool("studyos_timer_control", { action: "toggle" });
  assert.equal(toggled.data.timer.running, false);
  const reset = await executeAgentTool("studyos_timer_control", { action: "reset", mode: "deep-focus" });
  assert.equal(reset.data.timer.mode, "deep-focus");
  assert.equal(reset.data.timer.running, false);
  assert.equal(reset.data.timer.remainingSeconds, 90 * 60);
});

test("timer MCP: cronometro con materia, finish salva il tempo vero, niente perdite in silenzio", async () => {
  seedTimerApp();
  assert.equal((await executeAgentTool("studyos_timer_control", { action: "start", kind: "stopwatch", subjectId: "sub_nope" })).code, "not_found");
  const started = await executeAgentTool("studyos_timer_control", { action: "start", kind: "stopwatch", subjectId: "sub_an" });
  assert.equal(started.data.timer.kind, "stopwatch");
  assert.equal(started.data.timer.subjectId, "sub_an");
  assert.equal(started.data.timer.durationSeconds, 90 * 60, "obiettivo della materia");

  assert.equal((await executeAgentTool("studyos_timer_control", { action: "finish" })).code, "invalid", "meno di un minuto non si salva");

  const now = Date.now();
  const timer = useStudyStore.getState().timer;
  useStudyStore.setState({ timer: { ...timer, runningSince: now - 5 * 60_000 - 400, startedAt: now - 5 * 60_000 - 400 } });
  const status = await executeAgentTool("studyos_timer_status", {});
  assert.equal(status.data.timer.elapsedSeconds, 300, "per difetto, come in app");

  const blocked = await executeAgentTool("studyos_timer_control", { action: "start", mode: "pomodoro" });
  assert.equal(blocked.code, "invalid", "start non cancella 5 minuti non salvati");
  assert.equal(useStudyStore.getState().timer.kind, "stopwatch");

  const finished = await executeAgentTool("studyos_timer_control", { action: "finish" });
  assert.equal(finished.ok, true);
  assert.equal(finished.data.session.actualMinutes, 5);
  assert.equal(finished.data.session.subjectId, "sub_an");
  assert.equal(finished.data.session.source, "stopwatch");
  assert.equal(finished.data.session.status, "completed");
  assert.equal(finished.data.timer.running, false);
  assert.equal(useStudyStore.getState().sessions.length, 1);

  const idle = await executeAgentTool("studyos_timer_control", { action: "finish" });
  assert.equal(idle.ok, true);
  assert.equal(idle.data.session, null);
  assert.equal(useStudyStore.getState().sessions.length, 1);

  const pomodoro = await executeAgentTool("studyos_timer_control", { action: "start", kind: "pomodoro" });
  assert.equal(pomodoro.data.timer.durationSeconds, 50 * 60, "kind=pomodoro senza mode usa la durata della materia");
  useStudyStore.setState({ timer: defaultTimer("pomodoro") });
});

// ---------------------------------------------------------------------------------------
// Revisione finale: elementi condivisi cercati dopo l'espansione (S1), serie altrui spostate
// dall'agente come nel calendario (S4), sessioni con origine e argomento (N8).
// ---------------------------------------------------------------------------------------

// Ogni lunedì alle 10 a Roma dal 2 novembre, nel calendario di Alice; il 16 spostato al 17 e rinominato.
const sharedSeries = () =>
  sharedEntry("calendarEvent", "lez", {
    title: "Lezione",
    description: "",
    category: "lesson",
    priority: "medium",
    status: "planned",
    start: "2026-11-02T09:00:00.000Z",
    end: "2026-11-02T10:00:00.000Z",
    recurrence: "weekly",
    repeat: { freq: "weekly", byWeekday: ["MO"] },
    repeatLegacy: "weekly|",
    timeZone: "Europe/Rome",
    tags: [],
    checklist: [],
    attachmentIds: [],
    links: [],
    notes: ""
  });
const sharedMovedRow = () =>
  sharedEntry("calendarEvent", "lez@2026-11-16", {
    ...sharedSeries().entity,
    id: "lez@2026-11-16",
    title: "Spostata",
    seriesId: "lez",
    originalDate: "2026-11-16",
    start: "2026-11-17T09:00:00.000Z",
    end: "2026-11-17T10:00:00.000Z",
    recurrence: "none",
    repeat: undefined,
    repeatLegacy: undefined
  });

test("S1 (revisione finale). elementi condivisi con query: si cerca nelle date come si vedono, con il loro giorno", () => {
  const items = [sharedSeries(), sharedMovedRow()];
  const received = [shareGrant({ scope: "calendar" })];
  const span = { from: new Date("2026-11-15T12:00:00.000Z"), to: new Date("2026-11-19T00:00:00.000Z") };
  const view = (query) => sharedItemsView(items, received, [], { ...span, query }).map((item) => `${item.occurrenceDate} ${item.title} ${item.start.slice(0, 10)}`);
  assert.deepEqual(view(), ["2026-11-16 Spostata 2026-11-17"]);
  assert.deepEqual(view("Lezione"), []);
  assert.deepEqual(view("spostata"), ["2026-11-16 Spostata 2026-11-17"]);
  // Un evento singolo non ha occurrenceDate.
  const single = sharedEntry("calendarEvent", "once", { ...sharedSeries().entity, id: "once", title: "Ricevimento", start: "2026-11-16T15:00:00.000Z", end: "2026-11-16T16:00:00.000Z", recurrence: "none", repeat: undefined, repeatLegacy: undefined });
  assert.equal("occurrenceDate" in sharedItemsView([single], received, [], span)[0], false);
});

test("S4 (revisione finale). serie altrui spostata dall'agente: la regola segue il giorno e le date prima restano", async () => {
  const seed = (items = [sharedSeries()]) => seedApp({ received: [shareGrant({ scope: "calendar", permission: "edit" })], items });
  const handle = sharedHandle(sharedSeries());
  const saved = (id = "lez") => useSharedStore.getState().items.find((item) => item.entityId === id).entity;
  const romeDays = () =>
    expandRepeatEvents([saved()], new Date("2026-11-01T00:00:00.000Z"), new Date("2026-11-29T00:00:00.000Z")).map((item) =>
      new Date(item.start).toLocaleDateString("sv-SE", { timeZone: "Europe/Rome" })
    );

  // Con occurrenceDate (il lunedì 16, letto dall'elenco) al martedì 17: tutta la serie un giorno dopo, dal 3.
  seed();
  const moved = await executeAgentTool("studyos_update_shared_item", { id: handle, occurrenceDate: "2026-11-16", start: "2026-11-17T09:00:00.000Z" });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  assert.deepEqual(saved().repeat, { freq: "weekly", byWeekday: ["TU"] });
  assert.equal(saved().recurrence, "weekly");
  assert.equal(saved().start, "2026-11-03T09:00:00.000Z");
  assert.equal(saved().end, "2026-11-03T10:00:00.000Z");
  assert.deepEqual(romeDays(), ["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"]);

  // Senza occurrenceDate, l'inizio di una data dopo la prima: rifiutato (le date prima sparirebbero).
  seed();
  const later = await executeAgentTool("studyos_update_shared_item", { id: handle, start: "2026-11-17T09:00:00.000Z" });
  assert.equal(later.code, "invalid", JSON.stringify(later));
  assert.match(later.error, /occurrenceDate/);
  assert.equal(saved().start, "2026-11-02T09:00:00.000Z");
  assert.equal(useSharedStore.getState().outbox.length, 0);

  // Senza occurrenceDate, la prima data al martedì: la regola segue, come trascinandola.
  seed();
  assert.equal((await executeAgentTool("studyos_update_shared_item", { id: handle, start: "2026-11-03T09:00:00.000Z" })).ok, true);
  assert.deepEqual(saved().repeat, { freq: "weekly", byWeekday: ["TU"] });
  assert.deepEqual(romeDays(), ["2026-11-03", "2026-11-10", "2026-11-17", "2026-11-24"]);

  // Solo l'ora, da un giorno dopo: la regola resta e la serie tiene il suo primo giorno.
  seed();
  assert.equal((await executeAgentTool("studyos_update_shared_item", { id: handle, occurrenceDate: "2026-11-16", start: "2026-11-16T10:00:00.000Z" })).ok, true);
  assert.deepEqual(saved().repeat, { freq: "weekly", byWeekday: ["MO"] });
  assert.equal(saved().start, "2026-11-02T10:00:00.000Z");
  assert.equal(saved().end, "2026-11-02T11:00:00.000Z");

  // Un giorno che non è della serie, o occurrenceDate su un evento che non si ripete.
  seed();
  assert.equal((await executeAgentTool("studyos_update_shared_item", { id: handle, occurrenceDate: "2026-11-17", start: "2026-11-17T09:00:00.000Z" })).code, "not_found");
  const once = sharedEntry("calendarEvent", "once", { ...sharedSeries().entity, id: "once", recurrence: "none", repeat: undefined, repeatLegacy: undefined });
  seed([once]);
  assert.equal((await executeAgentTool("studyos_update_shared_item", { id: sharedHandle(once), occurrenceDate: "2026-11-02", start: "2026-11-03T09:00:00.000Z" })).code, "invalid");
  // Il giorno già spostato da solo (riga): si sposta solo lui, anche con il suo occurrenceDate.
  seed([sharedSeries(), sharedMovedRow()]);
  const row = await executeAgentTool("studyos_update_shared_item", { id: sharedHandle(sharedMovedRow()), occurrenceDate: "2026-11-16", start: "2026-11-18T09:00:00.000Z" });
  assert.equal(row.ok, true, JSON.stringify(row));
  assert.equal(saved("lez@2026-11-16").start, "2026-11-18T09:00:00.000Z");
  assert.equal(saved("lez@2026-11-16").repeat, undefined);
  assert.equal(saved().start, "2026-11-02T09:00:00.000Z");
});

test("N8 (revisione finale). sessioni condivise: origine e argomento si vedono e si cambiano con gli stessi controlli dell'app", async () => {
  const session = (id, over) =>
    sharedEntry("studySession", id, { title: "Ripasso", template: "pomodoro", start: "2026-11-10T09:00:00.000Z", status: "completed", notes: "", topics: [], attachmentIds: [], ...over });
  const good = session("ses_1", { source: "timer", topicId: "top_1" });
  const odd = session("ses_2", { title: "Strana", source: "<script>", topicId: 42 });
  const received = [shareGrant({ scope: "study", permission: "edit" })];
  const span = { from: new Date("2026-11-01T00:00:00.000Z"), to: new Date("2026-12-01T00:00:00.000Z") };
  const view = sharedItemsView([good, odd], received, [], span);
  const shownGood = view.find((item) => item.title === "Ripasso");
  const shownOdd = view.find((item) => item.title === "Strana");
  assert.equal(shownGood.source, "timer");
  assert.equal(shownGood.topicId, "top_1");
  assert.equal("source" in shownOdd, false);
  assert.equal("topicId" in shownOdd, false);

  const now = "2026-11-10T09:00:00.000Z";
  assert.equal(planSharedUpdate(received, good, { source: "manual" }, now).entity.source, "manual");
  assert.equal(planSharedUpdate(received, good, { source: "altro" }, now).code, "invalid");
  assert.equal(planSharedUpdate(received, good, { topicId: "top_2" }, now).entity.topicId, "top_2");
  assert.equal(planSharedUpdate(received, good, { topicId: 7 }, now).code, "invalid");
  assert.equal(planSharedUpdate(received, good, { topicId: "" }, now).entity.topicId, undefined);

  seedApp({ received, items: [good] });
  const updated = await executeAgentTool("studyos_update_shared_item", { id: sharedHandle(good), source: "manual", topicId: "" });
  assert.equal(updated.ok, true, JSON.stringify(updated));
  const saved = useSharedStore.getState().items[0].entity;
  assert.equal(saved.source, "manual");
  assert.equal(saved.topicId, undefined);
  assert.equal((await executeAgentTool("studyos_update_shared_item", { id: sharedHandle(good), source: "altro" })).code, "invalid");
  assert.ok(/topicId/.test(findAgentTool("studyos_update_shared_item").description));
});

test("bacheca del gruppo: i link degli altri membri passano dagli stessi filtri dei dati condivisi", async () => {
  seedApp();
  const stamp = { createdAt: "2026-11-10T08:00:00.000Z", updatedAt: "2026-11-10T08:00:00.000Z", archived: false, tags: [] };
  const resource = (id, url, kind = "link") => ({ ...stamp, id, groupId: "g1", kind, title: id, url, body: "", pinned: false, addedByUserId: "u2", addedByDisplayName: "Bea" });
  useStudyStore.setState({
    studyGroups: [{ ...stamp, id: "g1", name: "Biochimica", description: "", ownerDisplayName: "Bea", members: [] }],
    groupResources: [
      resource("ok", "https://unimi.it/dispense"),
      resource("senza-schema", "www.esempio.it/appunti"),
      resource("script", "javascript:alert(document.cookie)"),
      resource("dati", "data:text/html;base64,PHNjcmlwdD4="),
      resource("file", "file:///etc/passwd"),
      resource("nota", undefined, "note")
    ]
  });
  const board = await executeAgentTool("studyos_list_group_board", { groupId: "g1" });
  assert.equal(board.ok, true, JSON.stringify(board));
  const urls = Object.fromEntries(board.data.resources.map((item) => [item.id, item.url]));
  assert.deepEqual(urls, {
    ok: "https://unimi.it/dispense",
    "senza-schema": "https://www.esempio.it/appunti",
    script: undefined,
    dati: undefined,
    file: undefined,
    nota: undefined
  });
  const packed = JSON.stringify(board);
  for (const unsafe of ["javascript:", "data:", "file:"]) assert.equal(packed.includes(unsafe), false, unsafe);
});
