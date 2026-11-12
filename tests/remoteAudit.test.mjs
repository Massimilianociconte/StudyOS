import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { AGENT_TOOLS, CLOUD_ONLY, CLOUD_UNAVAILABLE, PAGE_INSTRUCTION, findAgentTool, mcpToolDefinition } from "../src/agent/catalog.ts";
import { CLOUD_TEXT, createCloudRunner } from "../src/agent/cloudRunner.ts";
import { AGENT_SERVER_VERSION } from "../src/agent/constants.ts";
import { executeAgentTool } from "../src/agent/execute.ts";
import { ResultLedger } from "../src/agent/ledger.ts";
import { AGENT_INSTRUCTIONS, cloudInstructions, handleMcpRpc } from "../src/agent/mcp.ts";
import { auditEntryOut, auditImage, auditPage, changedFields } from "../src/agent/remoteAudit.ts";
import { parseToolArgs } from "../src/agent/schema.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const A = "a".repeat(64);
const UUID = "0b9d3a5e-6c1f-4a2b-9e8d-7f6a5b4c3d2e";

const row = (patch) => ({
  id: UUID,
  created_at: "2026-11-12T10:00:00.000+00:00",
  grant_label: "ChatGPT",
  from_app: false,
  tool: "studyos_update_task",
  entity_type: "task",
  entity_id: "task_1",
  action: "update",
  before: null,
  after: null,
  restore_of: null,
  restored_at: null,
  can_restore: true,
  total: 1,
  ...patch
});

test("registro remoto: una modifica mostra solo i campi cambiati, prima e dopo", () => {
  const entry = auditEntryOut(row({
    before: { id: "task_1", title: "Ripasso", dueDate: "2026-11-20T22:59:59.999Z", status: "todo", updatedAt: "2026-11-01T00:00:00.000Z" },
    after: { id: "task_1", title: "Ripasso cap. 3", dueDate: "2026-11-20T22:59:59.999Z", status: "doing", updatedAt: "2026-11-02T00:00:00.000Z" }
  }));
  assert.deepEqual(entry.changed, ["status", "title"]);
  assert.deepEqual(entry.before, { status: "todo", title: "Ripasso" });
  assert.deepEqual(entry.after, { status: "doing", title: "Ripasso cap. 3" });
  assert.equal(entry.title, "Ripasso cap. 3");
  assert.equal(entry.collection, "tasks");
  assert.equal(entry.itemId, "task_1");
  assert.equal(entry.connector, "ChatGPT");
  assert.equal(entry.by, "connector");
  assert.equal(entry.canRestore, true);
  assert.deepEqual(changedFields({ a: 1, updatedAt: "x" }, { a: 1, updatedAt: "y" }), []);
});

test("registro remoto: niente email, codici, token, iscrizioni push o file verso l'agente", () => {
  const secret = "secret@example.com";
  const group = auditImage("studyGroup", {
    id: "g1", name: "Lab", description: "", ownerDisplayName: "M", archived: false, updatedAt: "x", inviteCode: "SEGRETO",
    members: [{ displayName: "M", role: "owner", email: secret, userId: "user-1" }]
  });
  const invite = auditImage("groupInvite", { id: "i1", groupName: "Lab", recipientEmail: secret, code: "SEGRETO", status: "pending", fromUserId: "user-1" });
  const preferences = auditImage("preferences", { id: "p", displayName: "M", weeklyTargetMinutes: 600, degreeCfu: 180, showBarb: true, avatarDataUrl: "data:image/png;base64,FOTO" });
  const material = auditImage("attachment", {
    id: "a1", name: "Dispense", cover: "data:image/png;base64,COPERTINA", dataUrl: "data:application/pdf;base64,FILE",
    nested: { email: secret, token: "tok", pushSubscription: { endpoint: "https://push", keys: { p256dh: "k", auth: "a" } }, preview: "data:image/png;base64,ANTEPRIMA" }
  });
  const packed = JSON.stringify({ group, invite, preferences, material });
  for (const leak of [secret, "SEGRETO", "user-1", "FOTO", "COPERTINA", "FILE", "tok", "https://push", "ANTEPRIMA"]) {
    assert.equal(packed.includes(leak), false, leak);
  }
  assert.deepEqual(invite, { id: "i1", title: "Lab", status: "pending" });
  assert.deepEqual(group.members, [{ displayName: "M", role: "owner" }]);
  assert.equal(material.name, "Dispense");
});

test("registro remoto: creazione ed eliminazione con l'elemento intero, testi lunghi accorciati", () => {
  const long = "x".repeat(400);
  const created = auditEntryOut(row({ action: "create", after: { id: "t2", title: "Nuova", description: long }, tool: "studyos_create_task" }));
  assert.equal(created.after.title, "Nuova");
  assert.equal(created.after.description.length, 301);
  assert.deepEqual(created.after.truncated, ["description"]);
  assert.equal("before" in created, false);
  const deleted = auditEntryOut(row({ action: "delete", before: { id: "t3", title: "Vecchia" }, after: { id: "t3", deletedAt: "x" }, restored_at: "2026-11-12T11:00:00Z", can_restore: false }));
  assert.equal(deleted.before.title, "Vecchia");
  assert.equal("after" in deleted, false);
  assert.equal(deleted.title, "Vecchia");
  assert.equal(deleted.restoredAt, "2026-11-12T11:00:00Z");
  const fromApp = auditEntryOut(row({ from_app: true, restore_of: UUID, grant_label: "" }));
  assert.equal(fromApp.by, "app");
  assert.equal(fromApp.connector, undefined);
  assert.equal(fromApp.restoreOf, UUID);
});

test("registro remoto: pagina con il totale del server", () => {
  const rows = [row({ total: "45" }), row({ id: "x", total: "45" })];
  const page = auditPage(rows, 20, 2);
  assert.equal(page.total, 45);
  assert.equal(page.count, 2);
  assert.equal(page.has_more, true);
  assert.equal(page.next_offset, 22);
  const last = auditPage([], 45, 20);
  assert.equal(last.has_more, false);
  assert.equal(last.items.length, 0);
});

// Supabase finto: pull, push con registro, elenco e ripristino come in supabase/agent.sql.
const fakeCloud = ({ legacy = false, noAudit = false } = {}) => {
  const calls = [];
  const rows = [];
  const audit = [];
  let restoreReply = null;
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const missing = () => reply(404, { code: "PGRST202", message: "Could not find the function" });
  const fetch = async (url, init) => {
    const fn = String(url).split("/rest/v1/rpc/")[1];
    const body = JSON.parse(init.body);
    calls.push({ fn, body });
    if (body.p_secret !== A) return reply(403, { code: "28000", message: "revocato" });
    if (fn === "studyos_agent_pull") return reply(200, body.p_offset ? [] : rows.map((item) => ({ ...item })));
    if (fn === "studyos_agent_push") {
      if (legacy && "p_tool" in body) return missing();
      return reply(200, body.p_rows.map((item) => {
        audit.push({ tool: body.p_tool ?? "", entity_id: item.entity_id });
        rows.push({ ...item, updated_at: new Date().toISOString() });
        return { entity_type: item.entity_type, entity_id: item.entity_id, accepted: true };
      }));
    }
    if (fn === "studyos_agent_audit_list") {
      if (noAudit) return missing();
      return reply(200, [row({ before: { id: "task_1", title: "A", email: "x@y.z" }, after: { id: "task_1", title: "B" }, total: 1 })]);
    }
    if (fn === "studyos_agent_restore") {
      if (noAudit) return missing();
      return reply(200, restoreReply);
    }
    return reply(404, { message: "?" });
  };
  return { fetch, calls, audit, setRestore: (value) => { restoreReply = value; } };
};

const runnerOn = (cloud) => createCloudRunner({ url: "http://cloud.test", key: "sb_publishable_prova", fetch: cloud.fetch });
const rome = { secret: A, timeZone: "Europe/Rome" };

test("connettore remoto: la push porta il nome dello strumento per il registro", async () => {
  const cloud = fakeCloud();
  const created = await runnerOn(cloud).run(rome, "studyos_create_task", { title: "Ripasso" });
  assert.equal(created.ok, true, JSON.stringify(created));
  const push = cloud.calls.find((call) => call.fn === "studyos_agent_push");
  assert.equal(push.body.p_tool, "studyos_create_task");
  assert.deepEqual(cloud.audit.map((item) => item.tool), ["studyos_create_task"]);
});

test("connettore remoto: con agent.sql di prima la push riparte senza p_tool e resta così", async () => {
  const cloud = fakeCloud({ legacy: true });
  const runner = runnerOn(cloud);
  assert.equal((await runner.run(rome, "studyos_create_task", { title: "Uno" })).ok, true);
  assert.equal((await runner.run(rome, "studyos_create_task", { title: "Due" })).ok, true);
  const pushes = cloud.calls.filter((call) => call.fn === "studyos_agent_push");
  assert.deepEqual(pushes.map((call) => "p_tool" in call.body), [true, false, false]);
  assert.equal(cloud.audit.length, 2);
});

test("connettore remoto: studyos_list_audit legge il registro del server, con le date nel fuso della persona", async () => {
  const cloud = fakeCloud();
  const result = await runnerOn(cloud).run(rome, "studyos_list_audit", { limit: 20, offset: 0, itemId: "task_1", tool: "studyos_update_task", since: "2026-11-12T08:00:00" });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.source, "server");
  assert.equal(result.data.items[0].title, "B");
  assert.equal(JSON.stringify(result.data).includes("x@y.z"), false);
  const call = cloud.calls.at(-1);
  assert.equal(call.fn, "studyos_agent_audit_list");
  assert.equal(call.body.p_entity_id, "task_1");
  assert.equal(call.body.p_tool, "studyos_update_task");
  // 08:00 a Roma (novembre, +01:00) = 07:00 UTC.
  assert.equal(call.body.p_since, "2026-11-12T07:00:00.000Z");
  assert.equal(call.body.p_until, null);
  assert.equal(cloud.calls.some((item) => item.fn === "studyos_agent_pull"), false, "il registro non rilegge i dati");

  const missing = await runnerOn(fakeCloud({ noAudit: true })).run(rome, "studyos_list_audit", {});
  assert.equal(missing.ok, false);
  assert.equal(missing.error, CLOUD_TEXT.auditMissing);
});

test("connettore remoto: studyos_restore_change dice cosa è successo, anche in conflitto", async () => {
  const cloud = fakeCloud();
  const runner = runnerOn(cloud);
  const bad = await runner.run(rome, "studyos_restore_change", { id: "task_1", confirm: true });
  assert.equal(bad.code, "invalid");
  assert.equal(cloud.calls.length, 0, "un id che non è un uuid non arriva al cloud");

  cloud.setRestore({ status: "restored", auditId: UUID, entityType: "task", entityId: "task_1", action: "update", item: { id: "task_1", title: "A", cover: "data:image/png;base64,X" } });
  const restored = await runner.run(rome, "studyos_restore_change", { id: UUID.toUpperCase(), confirm: true });
  assert.equal(restored.ok, true);
  assert.equal(restored.data.collection, "tasks");
  assert.equal(restored.data.item.title, "A");
  assert.equal("cover" in restored.data.item, false);
  assert.equal(cloud.calls.at(-1).body.p_audit_id, UUID);

  cloud.setRestore({ status: "conflict", entityType: "task", entityId: "task_1", current: { id: "task_1", title: "Cambiata in app" }, currentDeleted: false });
  const conflict = await runner.run(rome, "studyos_restore_change", { id: UUID, confirm: true });
  assert.equal(conflict.ok, false);
  assert.equal(conflict.error, CLOUD_TEXT.restoreConflict);
  assert.equal(conflict.data.status, "conflict");
  assert.equal(conflict.data.current.title, "Cambiata in app");

  cloud.setRestore({ status: "already_restored", entityType: "task", entityId: "task_1", restoredAt: "2026-11-12T10:00:00Z" });
  assert.equal((await runner.run(rome, "studyos_restore_change", { id: UUID, confirm: true })).error, CLOUD_TEXT.restoreDone);
  cloud.setRestore({ status: "not_found" });
  assert.equal((await runner.run(rome, "studyos_restore_change", { id: UUID, confirm: true })).code, "not_found");

  const revoked = await runner.run({ secret: "b".repeat(64), timeZone: "Europe/Rome" }, "studyos_restore_change", { id: UUID, confirm: true });
  assert.equal(revoked.code, "denied");
});

test("catalogo 1.8.0: registro e ripristino sul remoto, dividi pagine ovunque", () => {
  assert.equal(AGENT_SERVER_VERSION, "1.8.0");
  assert.equal(CLOUD_UNAVAILABLE.has("studyos_list_audit"), false);
  assert.deepEqual([...CLOUD_ONLY], ["studyos_restore_change"]);
  const restore = findAgentTool("studyos_restore_change");
  assert.equal(restore.risk, "destructive");
  assert.equal(parseToolArgs(restore.inputSchema, { id: UUID }).ok, false, "serve confirm=true");
  assert.equal(parseToolArgs(restore.inputSchema, { id: UUID, confirm: true }).ok, true);
  const split = findAgentTool("studyos_split_pages");
  assert.equal(split.risk, "read");
  assert.match(split.description, /10–20 = 11 pagine/);
  assert.equal(parseToolArgs(split.inputSchema, { from: 120, to: 180, parts: 4 }).ok, true);
  assert.equal(parseToolArgs(split.inputSchema, { from: 0, to: 180, parts: 4 }).ok, false);
  const audit = findAgentTool("studyos_list_audit");
  assert.match(mcpToolDefinition(audit, { cloud: true }).description, /registro del server/);
  assert.match(mcpToolDefinition(audit).description, /questo browser/);
  assert.equal(PAGE_INSTRUCTION, "Conta le pagine includendo prima e ultima (10–20 = 11 pagine). Per dividere un intervallo usa studyos_split_pages invece di calcolare.");
  assert.ok(AGENT_INSTRUCTIONS.includes(PAGE_INSTRUCTION));
  assert.ok(cloudInstructions("Camilla").includes(PAGE_INSTRUCTION));
  assert.match(cloudInstructions("Camilla"), /studyos_restore_change la annulla, solo se Camilla lo chiede/);
});

test("MCP: il ripristino non è sul connettore principale; sul remoto sì, con il registro", async () => {
  const actor = { name: "Prova", source: "oauth", scopes: ["studyos:read", "studyos:write"] };
  const invoked = [];
  const local = { actor, ledger: new ResultLedger(), connected: () => true, invoke: async (call) => (invoked.push(call.name), { ok: true, data: {} }) };
  const rpc = (method, params, deps) => handleMcpRpc({ jsonrpc: "2.0", id: 1, method, params }, deps);
  const localTools = (await rpc("tools/list", {}, local)).result.tools.map((tool) => tool.name);
  assert.equal(localTools.includes("studyos_restore_change"), false);
  assert.ok(localTools.includes("studyos_split_pages"));
  assert.ok(localTools.includes("studyos_list_audit"));
  const refused = await rpc("tools/call", { name: "studyos_restore_change", arguments: { id: UUID, confirm: true } }, local);
  assert.equal(refused.result.isError, true);
  assert.equal(invoked.length, 0);

  const ran = [];
  const remote = { ...local, cloud: { account: "Camilla", run: async (name, args) => (ran.push({ name, args }), { ok: true, data: { name } }) } };
  const remoteTools = (await rpc("tools/list", {}, remote)).result.tools;
  const names = remoteTools.map((tool) => tool.name);
  for (const name of ["studyos_list_audit", "studyos_restore_change", "studyos_split_pages"]) assert.ok(names.includes(name), name);
  assert.equal(remoteTools.length, AGENT_TOOLS.filter((tool) => !CLOUD_UNAVAILABLE.has(tool.name)).length);
  const called = await rpc("tools/call", { name: "studyos_restore_change", arguments: { id: UUID, confirm: true } }, remote);
  assert.equal(called.result.isError, false);
  assert.deepEqual(ran.at(-1), { name: "studyos_restore_change", args: { id: UUID, confirm: true } });
  const readOnly = { ...remote, actor: { ...actor, scopes: ["studyos:read"] } };
  const denied = await rpc("tools/call", { name: "studyos_restore_change", arguments: { id: UUID, confirm: true } }, readOnly);
  assert.equal(denied.result.isError, true);
  assert.equal(ran.length, 1, "un connettore di sola lettura non ripristina");
  const init = await rpc("initialize", { protocolVersion: "2025-06-18" }, remote);
  assert.equal(init.result.serverInfo.version, "1.8.0");
});

test("app: studyos_split_pages e il registro di questo browser", async () => {
  useStudyStore.setState({ loading: false, locked: false });
  const split = await executeAgentTool("studyos_split_pages", { from: 120, to: 180, parts: 4 });
  assert.equal(split.ok, true, JSON.stringify(split));
  assert.deepEqual(split.data.parts.map((part) => part.text), ["pp. 120–135 (16 pagine)", "pp. 136–150 (15 pagine)", "pp. 151–165 (15 pagine)", "pp. 166–180 (15 pagine)"]);
  assert.equal(split.data.totalPages, 61);
  const wrong = await executeAgentTool("studyos_split_pages", { from: 1, to: 3, parts: 4 });
  assert.equal(wrong.code, "invalid");
  const local = await executeAgentTool("studyos_list_audit", { limit: 20, offset: 0 });
  assert.equal(local.ok, true);
  assert.equal(local.data.source, "browser");
  assert.ok(Array.isArray(local.data.items));
  assert.equal((await executeAgentTool("studyos_list_audit", { itemId: "task_1" })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_restore_change", { id: UUID, confirm: true })).code, "invalid");
});

test("SQL: registro scritto dalla push, RLS di sola lettura, ripristino e verifica", () => {
  const sql = read("../supabase/agent.sql");
  const verify = read("../supabase/agent-verify.sql");
  assert.match(sql, /create table if not exists public\.studyos_agent_audit/);
  assert.match(sql, /drop function if exists public\.studyos_agent_push\(text, text, jsonb\);/);
  assert.match(sql, /p_tool text default ''/);
  assert.match(sql, /insert into public\.studyos_agent_audit/);
  assert.match(sql, /for select to authenticated using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.match(sql, /grant select on public\.studyos_agent_audit to authenticated;/);
  assert.doesNotMatch(sql, /grant (insert|update|delete|all)[^;]*studyos_agent_audit/);
  assert.match(sql, /interval '90 days'/);
  assert.match(sql, /offset 2000 limit 1/);
  for (const fn of ["studyos_agent_audit_list", "studyos_agent_restore", "studyos_agent_audit_own", "studyos_agent_restore_own"]) {
    assert.match(sql, new RegExp(`create or replace function public\\.${fn}\\(`), fn);
  }
  // Ogni security definer fissa il search_path.
  const definers = sql.split("create or replace function").slice(1).filter((body) => /security definer/.test(body.split("as $$")[0]));
  assert.ok(definers.length >= 10);
  for (const body of definers) assert.match(body.split("as $$")[0], /set search_path = public/);
  for (const column of ["audit_table_ready", "audit_rpc_ready", "audit_internal_private_ready", "audit_entries"]) assert.match(verify, new RegExp(column));
  assert.match(verify, /studyos_agent_push\(text,text,jsonb,text\)/);
  assert.match(read("../supabase/README.md"), /agent-audit-check\.sql/);
});
