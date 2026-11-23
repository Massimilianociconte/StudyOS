// Connettore remoto alla pari (1.12.0, supabase/agent-parity.sql): stessi strumenti del connettore
// principale, gruppi e dati condivisi letti con le funzioni del segreto, condivisioni confermate
// nell'app, timer dell'account nel cloud. Supabase finto con le funzioni nuove.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AGENT_TOOLS, CLOUD_DEFERRED, CLOUD_ONLY, CLOUD_UNAVAILABLE, mcpToolDefinition } from "../src/agent/catalog.ts";
import { CLOUD_DEFERRED as APP_DEFERRED } from "../src/agent/cloudDeferred.ts";
import { CLOUD_TEXT, GROUP_TABLE_TOOLS, createCloudRunner, plannedRows, sharedTypesFor } from "../src/agent/cloudRunner.ts";
import { ResultLedger } from "../src/agent/ledger.ts";
import { cloudInstructions, handleMcpRpc } from "../src/agent/mcp.ts";
import { COLLECTIONS } from "../src/lib/collections.ts";
import { parseOpenTarget } from "../src/lib/openLink.ts";
import { GROUP_COLLECTIONS } from "../src/lib/syncScope.ts";
import { timerCloudPlan } from "../src/lib/timerCloudPlan.ts";
import { useSharedStore } from "../src/store/useSharedStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const A = "a".repeat(64);
const B = "b".repeat(64);
const ADA = "0b9d3a5e-6c1f-4a2b-9e8d-7f6a5b4c3d2e";
const BEA = "1c8e4b6f-7d2a-4b3c-8f9e-6a5b4c3d2e1f";
const CARLO = "2d7f5c8a-9e3b-4c4d-9a1f-5b4c3d2e1f0a";
const grant = (secret) => ({ secret, timeZone: "Europe/Rome" });
const AT = "2026-11-20T10:00:00.000Z";

const fakeCloud = (options = {}) => {
  const users = new Map([[A, ADA], [B, CARLO]]);
  const calls = [];
  const pushed = [];
  const requests = new Map();
  const timers = new Map();
  let seq = 0;
  let gate = null;
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, init) => {
    const fn = String(url).split("/rest/v1/rpc/")[1];
    const body = JSON.parse(init.body);
    calls.push({ fn, body });
    const me = users.get(body.p_secret);
    if (!me) return reply(403, { code: "28000", message: "Collegamento dell'assistente non valido o revocato." });
    if ((options.missing ?? []).includes(fn)) return reply(404, { code: "PGRST202", message: `Could not find the function public.${fn}` });
    switch (fn) {
      case "studyos_agent_pull":
        if (gate) await gate;
        return reply(200, me === ADA && !body.p_since ? [{ entity_type: "subject", entity_id: "sub_1", payload: { id: "sub_1", name: "Chimica", color: "#123456", createdAt: AT, updatedAt: AT, archived: false, tags: [] }, deleted: false, updated_at: AT }] : []);
      case "studyos_agent_push":
        if (options.pushFails) return reply(503, { message: "cloud non raggiungibile" });
        pushed.push(...body.p_rows.map((row) => ({ ...row, me })));
        return reply(200, body.p_rows.map((row) => ({ entity_type: row.entity_type, entity_id: row.entity_id, accepted: true })));
      case "studyos_agent_groups":
        return reply(200, me === ADA
          ? {
              me,
              groups: [{ id: "g1", name: "Chimica insieme", description: "", owner_id: ADA, owner_display_name: "Ada", created_at: AT, updated_at: AT }],
              members: [
                { group_id: "g1", user_id: ADA, display_name: "Ada", role: "owner", joined_at: AT },
                { group_id: "g1", user_id: BEA, display_name: "Bea", role: "member", joined_at: AT }
              ],
              resources: [{ id: "res_1", group_id: "g1", kind: "note", title: "Appunti", body: "x", pinned: false, added_by_user_id: BEA, added_by_display_name: "Bea", created_at: AT, updated_at: AT }],
              activities: []
            }
          : { me, groups: [], members: [], resources: [], activities: [] });
      case "studyos_agent_add_group_resource":
        return reply(200, { status: options.resourceStatus ?? "ok", updated_at: "2026-11-20T10:05:00.000Z" });
      case "studyos_agent_log_group_activity":
      case "studyos_agent_delete_group_resource":
        return reply(200, true);
      case "studyos_agent_sharing":
        return reply(200, me === ADA
          ? {
              me,
              shares: [{ id: "sh1", owner_id: BEA, owner_name: "Bea", scope: "tasks", subject_ids: [], permission: "view", grantee_user_id: ADA, grantee_group_id: null, grantee_name: "Ada", created_at: AT, updated_at: AT }],
              invites: [],
              labels: [],
              items: body.p_types && !body.p_types.includes("task") ? [] : [{ owner_id: BEA, entity_type: "task", entity_id: "t_bea", payload: { id: "t_bea", title: "Esercizi di Bea", status: "todo", priority: "medium", createdAt: AT, updatedAt: AT, archived: false, tags: [] }, deleted: false, updated_at: AT, id: "1" }]
            }
          : { me, shares: [], invites: [], labels: [], items: [] });
      case "studyos_agent_request_create": {
        if (options.tooMany) return reply(400, { code: "54000", message: "Troppe richieste in attesa: confermale o rifiutale in StudyOS." });
        const id = `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
        requests.set(id, { me, status: options.requestStatus ?? "pending", tool: body.p_tool, args: body.p_args, summary: body.p_summary, risk: body.p_risk, result: options.requestResult ?? null });
        return reply(200, id);
      }
      case "studyos_agent_request_status": {
        const row = requests.get(body.p_id);
        if (!row || row.me !== me) return reply(200, null);
        return reply(200, { status: row.status, tool: row.tool, result: row.result });
      }
      case "studyos_agent_timer_get": {
        const state = timers.get(me) ?? null;
        // Un dispositivo cambia il timer dopo la lettura dell'hub.
        options.afterTimerGet?.(me, timers);
        return reply(200, state);
      }
      case "studyos_agent_timer_put": {
        // Come agent-parity.sql: si scrive solo se la riga ha ancora il changedAt letto (null = nessuna riga).
        const current = timers.get(me);
        const expected = body.p_expected;
        if (expected === null || expected === undefined) {
          if (!current) timers.set(me, body.p_state);
        } else if (current && Math.floor(current.changedAt) === expected && body.p_state.changedAt > expected) {
          timers.set(me, body.p_state);
        }
        return reply(200, timers.get(me) ?? null);
      }
      case "studyos_agent_group_snapshot":
        return reply(200, { groups: me === ADA ? [{ id: "g1", name: "Chimica insieme" }] : [], sessions: [], overrides: [] });
      case "studyos_agent_save_group_exam_session":
        return reply(200, {
          status: "ok",
          row: {
            id: body.p_id, group_id: body.p_group_id, course_key: "name:chimica", course_norm: "chimica", course_id: null,
            course_name: body.p_fields.courseName, exam_date: body.p_fields.date, kind: body.p_fields.kind, label: "", exam_time: null, room: "", notes: "",
            registration_opens: null, registration_closes: null, barb_session_id: null, source: "member", version: 1,
            created_by_name: "Ada", updated_by_name: "Ada", deleted_at: null, deleted_by_name: null, created_at: AT, updated_at: AT, mine: true
          }
        });
      default:
        return reply(404, { message: "funzione sconosciuta" });
    }
  };
  return {
    fetch,
    calls,
    pushed,
    requests,
    timers,
    names: () => calls.map((call) => call.fn),
    hold: () => {
      let open;
      gate = new Promise((resolve) => {
        open = resolve;
      });
      return () => {
        gate = null;
        open();
      };
    }
  };
};

const runnerOn = (cloud) => createCloudRunner({ url: "http://cloud.test/", key: "sb_publishable_prova", fetch: cloud.fetch, sleep: async () => undefined });

test("catalogo: sul remoto tutti gli strumenti del principale, più il ripristino dal registro del server", async () => {
  assert.equal(CLOUD_UNAVAILABLE.size, 0);
  assert.equal(APP_DEFERRED, CLOUD_DEFERRED, "un elenco solo, per hub e app");
  assert.deepEqual([...CLOUD_DEFERRED].sort(), ["studyos_create_shared_item", "studyos_delete_shared_item", "studyos_revoke_share", "studyos_share_with", "studyos_update_share", "studyos_update_shared_item"]);
  const actor = { name: "Prova", source: "oauth", scopes: ["studyos:read", "studyos:write"] };
  const local = { actor, ledger: new ResultLedger(), connected: () => true, invoke: async () => ({ ok: true, data: {} }) };
  const remote = { ...local, cloud: { account: "Ada", run: async () => ({ ok: true, data: {} }) } };
  const rpc = (deps) => handleMcpRpc({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }, deps);
  const main = (await rpc(local)).result.tools.map((tool) => tool.name);
  const cloud = (await rpc(remote)).result.tools.map((tool) => tool.name);
  assert.deepEqual(cloud.filter((name) => !CLOUD_ONLY.has(name)), main);
  assert.equal(cloud.length, AGENT_TOOLS.length);
  for (const tool of AGENT_TOOLS) {
    const remoteDef = mcpToolDefinition(tool, { cloud: true });
    assert.equal(/la conferma nell'app StudyOS/.test(remoteDef.description), CLOUD_DEFERRED.has(tool.name), tool.name);
    assert.ok(!("account" in (remoteDef.inputSchema.properties ?? {})), tool.name);
    // Sul remoto solo le condivisioni chiedono conferma nell'app.
    if (!CLOUD_DEFERRED.has(tool.name)) assert.doesNotMatch(remoteDef.description, /conferma in StudyOS/, tool.name);
  }
  assert.match(mcpToolDefinition(AGENT_TOOLS.find((tool) => tool.name === "studyos_delete_note")).description, /e la conferma in StudyOS/, "sul principale resta");
  assert.match(mcpToolDefinition(AGENT_TOOLS.find((tool) => tool.name === "studyos_add_group_resource"), { cloud: true }).description, /non viene salvata/);
  // Il deposito delle condivisioni dei dati personali rimanda a studyos_list_shared_items, che ora c'è.
  assert.match(mcpToolDefinition(AGENT_TOOLS.find((tool) => tool.name === "studyos_list_tasks"), { cloud: true }).description, /studyos_list_shared_items/);
  const instructions = cloudInstructions("Ada");
  assert.match(instructions, /pending_approval/);
  assert.match(instructions, /timer di studio è quello dell'account/);
  assert.doesNotMatch(instructions, /servono il connettore principale/);
});

test("MCP remoto: studyos_list_accounts risponde l'account dell'indirizzo, senza chiamare il cloud", async () => {
  let ran = 0;
  const deps = {
    actor: { name: "Prova", source: "oauth", scopes: ["studyos:read"] },
    ledger: new ResultLedger(),
    connected: () => false,
    invoke: async () => ({ ok: true, data: {} }),
    cloud: { account: "Ada", run: async () => ((ran += 1), { ok: true, data: {} }) }
  };
  const reply = await handleMcpRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "studyos_list_accounts", arguments: {} } }, deps);
  assert.deepEqual(JSON.parse(reply.result.content[0].text), { ok: true, data: { items: [{ name: "Ada", connected: true }], count: 1 } });
  assert.equal(ran, 0);
});

test("gruppi: elenco e bacheca dalle tabelle dei gruppi, senza email; store vuoto dopo", async () => {
  const cloud = fakeCloud();
  const runner = runnerOn(cloud);
  const groups = await runner.run(grant(A), "studyos_list_groups", {});
  assert.equal(groups.ok, true, JSON.stringify(groups));
  assert.match(JSON.stringify(groups.data), /Chimica insieme/);
  assert.doesNotMatch(JSON.stringify(groups.data), /@/);
  const board = await runner.run(grant(A), "studyos_list_group_board", { groupId: "g1" });
  assert.equal(board.ok, true, JSON.stringify(board));
  assert.match(JSON.stringify(board.data), /Appunti/);
  assert.equal(useStudyStore.getState().studyGroups.length, 0, "nessun gruppo resta nello store");
  // Un altro account non vede i gruppi di Ada.
  const other = await runner.run(grant(B), "studyos_list_groups", {});
  assert.doesNotMatch(JSON.stringify(other), /Chimica insieme/);
  assert.equal(cloud.pushed.length, 0, "i gruppi non finiscono nel cloud personale");
});

test("bacheca: pubblica con la funzione del segreto, autore l'account; rifiuto = errore, nessuna attività", async () => {
  const cloud = fakeCloud();
  const runner = runnerOn(cloud);
  const added = await runner.run(grant(A), "studyos_add_group_resource", { groupId: "g1", kind: "note", title: "Formulario", body: "pV = nRT" });
  assert.equal(added.ok, true, JSON.stringify(added));
  assert.equal(added.data.shared, true);
  const published = cloud.calls.find((call) => call.fn === "studyos_agent_add_group_resource");
  assert.equal(published.body.p_resource.group_id, "g1");
  assert.equal(published.body.p_resource.title, "Formulario");
  assert.ok(!("added_by_user_id" in published.body.p_resource), "l'autore lo decide il database");
  assert.ok(cloud.names().includes("studyos_agent_log_group_activity"));
  assert.equal(cloud.pushed.filter((row) => row.entity_type === "groupResource" || row.entity_type === "groupActivity").length, 0);

  const refusing = fakeCloud({ resourceStatus: "denied" });
  const refused = await runnerOn(refusing).run(grant(A), "studyos_add_group_resource", { groupId: "g1", kind: "note", title: "Formulario" });
  assert.equal(refused.ok, false);
  assert.equal(refused.error, CLOUD_TEXT.resourceNotSaved);
  assert.ok(!refusing.names().includes("studyos_agent_log_group_activity"));
});

test("appelli dei gruppi: creati con la funzione del segreto, il piano personale nel cloud", async () => {
  const cloud = fakeCloud();
  const runner = runnerOn(cloud);
  const created = await runner.run(grant(A), "studyos_create_group_exam_session", { groupId: "g1", date: "2027-01-12", kind: "appello", courseName: "Chimica", choose: true });
  assert.equal(created.ok, true, JSON.stringify(created));
  const saved = cloud.calls.find((call) => call.fn === "studyos_agent_save_group_exam_session");
  assert.equal(saved.body.p_group_id, "g1");
  assert.equal(saved.body.p_expected_version, null);
  assert.equal(saved.body.p_fields.courseName, "Chimica");
  assert.ok(cloud.pushed.some((row) => row.entity_type === "examPlan"), "l'appello entra nel piano d'esame");
});

test("dati condivisi: letti per la chiamata e tolti subito dopo; un altro account non li vede", async () => {
  const cloud = fakeCloud();
  const runner = runnerOn(cloud);
  const listed = await runner.run(grant(A), "studyos_list_shared_items", {});
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.match(JSON.stringify(listed.data), /Esercizi di Bea/);
  assert.equal(cloud.calls.find((call) => call.fn === "studyos_agent_sharing").body.p_types, null);
  assert.equal(useSharedStore.getState().items.length, 0);
  assert.equal(useSharedStore.getState().viewerId, null);
  const shares = await runner.run(grant(A), "studyos_list_shares", {});
  assert.equal(shares.ok, true, JSON.stringify(shares));
  assert.equal(shares.data.received.length, 1);
  const other = await runner.run(grant(B), "studyos_list_shared_items", {});
  assert.doesNotMatch(JSON.stringify(other), /Esercizi di Bea/);
  // Strumenti che non li usano non li chiedono.
  const before = cloud.calls.length;
  await runner.run(grant(A), "studyos_list_tasks", {});
  assert.ok(!cloud.calls.slice(before).some((call) => call.fn === "studyos_agent_sharing"));
});

test("dati in più facoltativi: senza agent-parity.sql panoramica e stato rispondono, i gruppi dicono di eseguirlo", async () => {
  const cloud = fakeCloud({ missing: ["studyos_agent_sharing", "studyos_agent_groups", "studyos_agent_timer_get"] });
  const runner = runnerOn(cloud);
  assert.equal((await runner.run(grant(A), "studyos_overview", {})).ok, true);
  assert.equal((await runner.run(grant(A), "studyos_status", {})).ok, true);
  const groups = await runner.run(grant(A), "studyos_list_groups", {});
  assert.equal(groups.code, "not_connected");
  assert.equal(groups.error, CLOUD_TEXT.parityMissing);
  assert.equal((await runner.run(grant(A), "studyos_timer_status", {})).error, CLOUD_TEXT.parityMissing);
});

test("condivisioni: richiesta da confermare nell'app, poi l'esito con studyos_approval_status", async () => {
  const cloud = fakeCloud();
  const runner = runnerOn(cloud);
  const asked = await runner.run(grant(A), "studyos_share_with", { personId: "person_x", scopes: ["tasks"] });
  assert.equal(asked.ok, true, JSON.stringify(asked));
  assert.equal(asked.data.status, "pending_approval");
  assert.match(asked.data.approvalId, /^req_[0-9a-f-]{36}$/);
  assert.equal(asked.data.message, CLOUD_TEXT.pending);
  const [id, row] = [...cloud.requests.entries()][0];
  assert.equal(row.tool, "studyos_share_with");
  assert.equal(row.risk, "write");
  assert.ok(row.summary.length > 0);
  assert.ok(!cloud.names().includes("studyos_agent_pull"), "nessun dato letto: l'esecuzione la fa l'app");

  const still = await runner.run(grant(A), "studyos_approval_status", { approvalId: asked.data.approvalId });
  assert.equal(still.data.status, "pending_approval");
  row.status = "running";
  const running = await runner.run(grant(A), "studyos_approval_status", { approvalId: asked.data.approvalId });
  assert.equal(running.data.status, "pending_approval");
  assert.equal(running.data.message, CLOUD_TEXT.running, "confermata: l'app la sta eseguendo");
  row.status = "done";
  row.result = { ok: true, data: { shared: true } };
  assert.deepEqual(await runner.run(grant(A), "studyos_approval_status", { approvalId: asked.data.approvalId }), { ok: true, data: { shared: true } });
  row.status = "expired";
  row.result = null;
  assert.equal((await runner.run(grant(A), "studyos_approval_status", { approvalId: `req_${id}` })).error, CLOUD_TEXT.approvalExpired);
  row.status = "denied";
  assert.equal((await runner.run(grant(A), "studyos_approval_status", { approvalId: id })).error, CLOUD_TEXT.approvalDenied);
  // L'id di un altro account, o inventato, non dice niente.
  assert.equal((await runner.run(grant(B), "studyos_approval_status", { approvalId: asked.data.approvalId })).code, "not_found");
  assert.equal((await runner.run(grant(A), "studyos_approval_status", { approvalId: "req_inventato" })).code, "not_found");
  const removal = await runner.run(grant(A), "studyos_revoke_share", { shareId: "sh1", confirm: true });
  assert.equal(removal.data.status, "pending_approval");
  assert.equal([...cloud.requests.values()].at(-1).risk, "destructive");
});

test("condivisioni: troppe richieste aperte = errore del database; l'attesa non blocca gli altri account", async () => {
  const busy = fakeCloud({ tooMany: true });
  const refused = await runnerOn(busy).run(grant(A), "studyos_share_with", { personId: "person_x", scopes: ["tasks"] });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /Troppe richieste/);

  const cloud = fakeCloud();
  const runner = runnerOn(cloud);
  const release = cloud.hold();
  const slow = runner.run(grant(B), "studyos_list_tasks", {});
  const asked = await runner.run(grant(A), "studyos_share_with", { personId: "person_x", scopes: ["tasks"] });
  assert.equal(asked.data.status, "pending_approval", "fuori dalla coda delle esecuzioni");
  release();
  assert.equal((await slow).ok, true);
});

test("timer: quello dell'account nel cloud; leggere non salva, controllarlo sì; cambiato altrove = niente salvato", async () => {
  const cloud = fakeCloud();
  const runner = runnerOn(cloud);
  const status = await runner.run(grant(A), "studyos_timer_status", {});
  assert.equal(status.ok, true, JSON.stringify(status));
  assert.ok(!cloud.names().includes("studyos_agent_timer_put"));
  const started = await runner.run(grant(A), "studyos_timer_control", { action: "start", mode: "pomodoro" });
  assert.equal(started.ok, true, JSON.stringify(started));
  const saved = cloud.timers.get(ADA);
  assert.equal(saved.running, true);
  assert.equal(typeof saved.changedAt, "number");
  assert.equal(useStudyStore.getState().timer.running, false, "lo store torna al timer vuoto");
  const read = await runner.run(grant(A), "studyos_timer_status", {});
  assert.equal(read.data.timer.running, true);
  assert.equal(cloud.timers.get(CARLO), undefined, "l'altro account ha il suo timer");

  // Cronometro avviato 20 minuti fa: «finish» salva la sessione, ma il timer intanto è cambiato su un dispositivo.
  const since = Date.now() - 20 * 60_000;
  const running = { mode: "pomodoro", kind: "stopwatch", phase: "focus", running: true, remainingSeconds: 0, durationSeconds: 0, cycle: 0, accumulatedSeconds: 0, runningSince: since, startedAt: since, sessionId: "session_sw", changedAt: since };
  // La pausa arriva dopo la lettura dell'hub con un changedAt più vecchio dell'orologio dell'hub (un
  // dispositivo con l'orologio indietro): vince lo stesso, perché la riga non è più quella letta.
  const conflicting = fakeCloud({
    afterTimerGet: (me, timers) => timers.set(me, { ...running, running: false, changedAt: since + 1 })
  });
  conflicting.timers.set(ADA, running);
  const blocked = await runnerOn(conflicting).run(grant(A), "studyos_timer_control", { action: "finish" });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, CLOUD_TEXT.timerConflict);
  assert.equal(conflicting.pushed.length, 0, "nessuna sessione salvata");
  assert.equal(conflicting.timers.get(ADA).running, false, "la pausa resta");

  const free = fakeCloud();
  free.timers.set(ADA, running);
  const finished = await runnerOn(free).run(grant(A), "studyos_timer_control", { action: "finish" });
  assert.equal(finished.ok, true, JSON.stringify(finished));
  assert.ok(free.pushed.some((row) => row.entity_type === "studySession" && row.entity_id === "session_sw"));
  const put = free.calls.find((call) => call.fn === "studyos_agent_timer_put");
  assert.equal(put.body.p_expected, since, "scrive solo sullo stato letto");

  // Nessuna riga nel cloud: si crea solo se intanto non l'ha creata un dispositivo.
  const fresh = fakeCloud();
  await runnerOn(fresh).run(grant(A), "studyos_timer_control", { action: "start", mode: "pomodoro" });
  assert.equal(fresh.calls.find((call) => call.fn === "studyos_agent_timer_put").body.p_expected, null);
});

test("timer: se le sessioni non arrivano al cloud il timer torna com'era, così «finish» si può ripetere", async () => {
  const since = Date.now() - 20 * 60_000;
  const running = { mode: "pomodoro", kind: "stopwatch", phase: "focus", running: true, remainingSeconds: 0, durationSeconds: 0, cycle: 0, accumulatedSeconds: 0, runningSince: since, startedAt: since, sessionId: "session_sw", changedAt: since };
  const cloud = fakeCloud({ pushFails: true });
  cloud.timers.set(ADA, running);
  const lost = await runnerOn(cloud).run(grant(A), "studyos_timer_control", { action: "finish" });
  assert.equal(lost.ok, false);
  const puts = cloud.calls.filter((call) => call.fn === "studyos_agent_timer_put");
  assert.equal(puts.length, 2, "scrittura e ripristino");
  const back = cloud.timers.get(ADA);
  assert.equal(back.running, true, "il cronometro corre ancora");
  assert.equal(back.sessionId, "session_sw");
  assert.ok(back.changedAt > puts[0].body.p_state.changedAt, "più recente dello stato scritto, che sostituisce");
  assert.equal(puts[1].body.p_expected, Math.floor(puts[0].body.p_state.changedAt));
});

test("app: una modifica del timer è sempre dopo lo stato attuale, anche con l'orologio indietro", () => {
  const ahead = Date.now() + 3_600_000;
  useStudyStore.setState({ timer: { mode: "pomodoro", kind: "pomodoro", phase: "focus", running: false, remainingSeconds: 1500, durationSeconds: 1500, cycle: 0, accumulatedSeconds: 0, changedAt: ahead } });
  useStudyStore.getState().toggleStudyTimer();
  const after = useStudyStore.getState().timer;
  assert.equal(after.running, true);
  assert.ok(after.changedAt > ahead, "vince sullo stato adottato da un dispositivo con l'orologio avanti");
  useStudyStore.getState().toggleStudyTimer();
  assert.ok(useStudyStore.getState().timer.changedAt > after.changedAt);
  useStudyStore.getState().resetStudyTimer("pomodoro");
});

test("plannedRows non scrive mai gruppi, bacheca e attività nel cloud personale", () => {
  const empty = Object.fromEntries(COLLECTIONS.map((key) => [key, []]));
  const after = { ...empty };
  for (const key of GROUP_COLLECTIONS) after[key] = [{ id: `${key}_1`, createdAt: AT, updatedAt: AT }];
  assert.deepEqual(plannedRows(empty, after, () => undefined), []);
});

test("tipi dei dati condivisi per strumento", () => {
  assert.deepEqual(sharedTypesFor("studyos_list_shares", ["core"]), []);
  assert.equal(sharedTypesFor("studyos_list_shared_items", ["core"]), null);
  assert.deepEqual(sharedTypesFor("studyos_overview", ["core"]), ["calendarEvent"]);
  assert.deepEqual(sharedTypesFor("studyos_list_decks", ["subjects", "decks"]), ["studyDeck", "flashcard", "quiz", "quizQuestion"]);
  assert.equal(sharedTypesFor("studyos_list_tasks", ["core", "subjects"]), undefined);
  assert.ok(GROUP_TABLE_TOOLS.has("studyos_list_shares"), "persone dei gruppi e gruppi destinatari");
});

test("app: timer del cloud adottato se più recente, inviato solo se è di questo account", () => {
  const timer = (changedAt) => ({ mode: "pomodoro", kind: "pomodoro", phase: "focus", running: false, remainingSeconds: 1500, durationSeconds: 1500, cycle: 0, accumulatedSeconds: 0, changedAt });
  assert.deepEqual(timerCloudPlan(timer(1), timer(2), "u1", "u1"), { action: "adopt", owner: "u1" });
  assert.deepEqual(timerCloudPlan(timer(2), timer(1), "u1", "u1"), { action: "push", owner: "u1" });
  assert.deepEqual(timerCloudPlan(timer(2), null, null, "u1"), { action: "push", owner: "u1" });
  // Timer di un altro account su questo dispositivo: non va nel cloud, nemmeno al controllo dopo.
  const first = timerCloudPlan(timer(2), null, "u0", "u1");
  assert.deepEqual(first, { action: "none", owner: "u0" });
  assert.deepEqual(timerCloudPlan(timer(2), null, first.owner, "u1"), { action: "none", owner: "u0" });
  // Il cloud dell'account ha un timer più recente: diventa quello di questo dispositivo.
  assert.deepEqual(timerCloudPlan(timer(2), timer(3), "u0", "u1"), { action: "adopt", owner: "u1" });
  assert.deepEqual(timerCloudPlan(timer(2), timer(2), "u1", "u1"), { action: "none", owner: "u1" });
  assert.equal(parseOpenTarget("?apri=agenti"), "agenti");
});

test("SQL: richieste solo per gli strumenti differiti, email mai all'hub, tabelle nuove nella cancellazione", () => {
  const parity = read("../supabase/agent-parity.sql");
  const deferred = parity.match(/select p_tool in \(([^)]*)\)/)[1].match(/'([a-z_]+)'/g).map((item) => item.slice(1, -1)).sort();
  assert.deepEqual(deferred, [...CLOUD_DEFERRED].sort());
  const sharing = parity.slice(parity.indexOf("create or replace function public.studyos_agent_sharing"), parity.indexOf("$$;", parity.indexOf("create or replace function public.studyos_agent_sharing")));
  assert.doesNotMatch(sharing, /_email/);
  assert.match(parity, /r\.status = 'running' and r\.decided_at <= now\(\) - interval '15 minutes'/);
  assert.match(parity, /'url', '\?apri=agenti'/);
  const verify = read("../supabase/verify.sql");
  for (const fn of ["studyos_agent_groups(text)", "studyos_agent_sharing(text,integer,text[])", "studyos_agent_request_create(text,text,jsonb,text,text)", "studyos_agent_timer_put(text,jsonb,bigint)"]) {
    assert.ok(verify.includes(`public.${fn}`), fn);
  }
  // Un permesso scollegato: le richieste in attesa non si eseguono né si mostrano.
  const decide = parity.slice(parity.indexOf("create or replace function public.studyos_agent_request_decide"), parity.indexOf("$$;", parity.indexOf("create or replace function public.studyos_agent_request_decide")));
  assert.match(decide, /set status = 'expired'[\s\S]*g\.revoked_at is null[\s\S]*return false/);
  assert.match(parity, /create policy studyos_agent_requests_select_own[\s\S]{0,400}g\.revoked_at is null/);
  // Timer del connettore: scrittura condizionale sullo stato letto, la firma vecchia tolta.
  assert.match(parity, /drop function if exists public\.studyos_agent_timer_put\(text, jsonb\);/);
  assert.match(parity, /where t\.user_id = v_user and t\.changed_at = p_expected/);
  // L'app rifiuta senza eseguire con una sola chiamata (claim(false)), mai claim(true) e poi un errore.
  const link = read("../src/lib/agentLink.ts");
  const remote = link.slice(link.indexOf("export const handleRemoteRequest"));
  assert.doesNotMatch(remote.slice(0, remote.indexOf("const handleConsent")), /claim\(true\)\) await close\(\{ ok: false/);
  const push = read("../worker/push.ts");
  assert.match(push, /const KINDS = new Set\(\[[^\]]*"agent"/);
});
