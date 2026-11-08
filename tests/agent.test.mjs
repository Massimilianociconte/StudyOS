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
  assert.deepEqual(hubCandidates("http://localhost:5173", tunnel), ["http://127.0.0.1:47321"]);
  assert.deepEqual(hubCandidates("https://massimilianociconte.github.io", `${tunnel}/mcp`), ["http://127.0.0.1:47321", tunnel]);
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
      assert.equal(tool.inputSchema.required.includes("confirm"), true, tool.name);
      assert.equal(tool.inputSchema.properties.confirm.const, true, tool.name);
      assert.equal(parseToolArgs(tool.inputSchema, { id: "task_1", confirm: false }).ok, false);
      assert.equal(parseToolArgs(tool.inputSchema, { id: "task_1", confirm: true }).ok, true);
    }
  }
  assert.equal(parseToolArgs({ type: "object", additionalProperties: false, properties: { note: { type: "string", pattern: "^[a-z]+$" } } }, { note: "" }).ok, true);
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
  assert.equal(init.result.protocolVersion, "2025-06-18");
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
