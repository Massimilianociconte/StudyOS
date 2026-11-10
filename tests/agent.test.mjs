import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_TOOLS, findAgentTool } from "../src/agent/catalog.ts";
import { handleMcpRpc } from "../src/agent/mcp.ts";
import { ResultLedger } from "../src/agent/ledger.ts";
import { OauthServer, sha256Base64Url } from "../src/agent/oauth.ts";
import { choosePoller, hubCandidates, normalizePublicHub, siteFromOrigin } from "../src/agent/hubEndpoint.ts";
import { decideAgentAction, normalizeAgentPolicy } from "../src/agent/policy.ts";
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
  sharedHandle,
  sharedItemsView
} from "../src/agent/shared.ts";
import { describeAgentCall, executeAgentTool } from "../src/agent/execute.ts";
import { useSharedStore } from "../src/store/useSharedStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

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
      // Un'eliminazione indica solo cosa eliminare: niente campi che ne cambino l'effetto.
      assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["confirm", "id"], tool.name);
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

test("execute copre ogni strumento tranne lo stato di conferma", () => {
  const source = readFileSync(new URL("../src/agent/execute.ts", import.meta.url), "utf8");
  for (const tool of AGENT_TOOLS) {
    if (tool.name === "studyos_approval_status") continue;
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
  assert.match(personHandle("owner-uuid-1"), /^person_[0-9a-f]{8}$/);
  assert.equal(given.personId, personHandle("friend-uuid"));
  assert.equal(findSharedByHandle(items, sharedHandle(items[0])), items[0]);
  assert.equal(sharedItemsView(items, received, labels, { ...span, scope: "tasks" }).length, 1);
  assert.equal(sharedItemsView(items, received, labels, { ...span, personId: "person_00000000" }).length, 0);
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
  assert.equal(describeAgentCall("studyos_update_shared_item", { id: handle, status: "done" }), "Modificare un elemento condiviso con te: «Relazione di Alice»");
  assert.equal(describeAgentCall("studyos_share_with", { personId: alice, scopes: ["calendar"] }), "Condividere Calendario: «Alice»");
  assert.equal(describeAgentCall("studyos_revoke_share", { id: "s1", confirm: true }), "Togliere una condivisione: «Attività · Alice»");

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
  assert.equal((await executeAgentTool("studyos_create_shared_item", { personId: "person_00000000", entityType: "task", title: "X" })).code, "not_found");

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
  assert.equal(overview.data.sharedTodayEvents.length, 1);
  assert.equal(overview.data.sharedTodayEvents[0].owner, "Alice");
  assert.equal((await executeAgentTool("studyos_list_shared_items", {})).data.total, 2);

  useSharedStore.setState({ hiddenOwners: ["owner-uuid-1"] });
  assert.equal((await executeAgentTool("studyos_list_shared_items", {})).data.total, 0);
  assert.equal((await executeAgentTool("studyos_overview", {})).data.sharedTodayEvents, undefined);
  const handle = sharedHandle(task);
  assert.equal((await executeAgentTool("studyos_update_shared_item", { id: handle, title: "Altro" })).code, "not_found");
  assert.equal((await executeAgentTool("studyos_delete_shared_item", { id: handle, confirm: true })).code, "not_found");
  assert.equal(describeAgentCall("studyos_delete_shared_item", { id: handle, confirm: true }), "Eliminare un elemento condiviso con te");
  assert.equal(useSharedStore.getState().items.length, 2);
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

  // shareSync non si carica in Node (niente import.meta.env): l'errore tecnico non arriva all'agente.
  useSharedStore.setState({ given: [shareGrant({ id: "g1", ownerId: "me-uuid", granteeUserId: "owner-uuid-1", granteeName: "Alice" })] });
  const shared = await executeAgentTool("studyos_share_with", { personId: personHandle("owner-uuid-1"), scopes: ["calendar"], permission: "view" });
  assert.equal(shared.ok, false);
  assert.equal(shared.code, "failed");
  assert.match(shared.error, /^Condivisione non salvata\. /);
  assert.equal(/undefined|Cannot|import\.meta/.test(shared.error), false, shared.error);

  // Regole controllate prima del server.
  assert.equal((await executeAgentTool("studyos_share_with", { personId: "person_00000000", scopes: ["calendar"] })).code, "not_found");
  assert.equal((await executeAgentTool("studyos_update_share", { id: "s1", permission: "edit" })).code, "not_found");
  useSharedStore.setState({ given: [shareGrant({ id: "g2", ownerId: "me-uuid", scope: "barb_exams", granteeUserId: "owner-uuid-1" })] });
  assert.equal((await executeAgentTool("studyos_update_share", { id: "g2", permission: "edit" })).code, "invalid");
  useSharedStore.setState({ received: [shareGrant({ id: "via-group", granteeUserId: null, granteeGroupId: "group-1" })] });
  assert.equal((await executeAgentTool("studyos_revoke_share", { id: "via-group", confirm: true })).code, "denied");
  useSharedStore.setState({ viewerId: null });
  assert.equal((await executeAgentTool("studyos_list_shares", {})).code, "not_connected");
});
