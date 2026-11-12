import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_UNAVAILABLE } from "../src/agent/catalog.ts";
import { GROUP_SNAPSHOT_TOOLS, createCloudRunner } from "../src/agent/cloudRunner.ts";
import { AGENT_SERVER_VERSION } from "../src/agent/constants.ts";
import { AGENT_INSTRUCTIONS, cloudInstructions } from "../src/agent/mcp.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";

const SECRET = "c".repeat(64);
const grant = { secret: SECRET, timeZone: "Europe/Rome" };

/** Riga dello snapshot come la manda il server: senza id degli account, con `mine`. */
const sessionRow = (patch = {}) => ({
  id: "gexam_a",
  group_id: "g1",
  course_key: "name:chimica",
  course_norm: "chimica",
  course_id: null,
  course_name: "Chimica",
  exam_date: "2027-01-12",
  kind: "appello",
  label: "",
  exam_time: "09:30",
  room: "Aula 1",
  notes: "scrivere a bea@gmail.com",
  registration_opens: null,
  registration_closes: null,
  barb_session_id: null,
  source: "member",
  version: 2,
  created_by_name: "Bea",
  updated_by_name: "Bea",
  deleted_at: null,
  deleted_by_name: null,
  created_at: "2026-11-01T10:00:00Z",
  updated_at: "2026-11-01T10:00:00Z",
  mine: false,
  ...patch
});

const fakeCloud = ({ missing = false } = {}) => {
  const calls = [];
  const pushed = [];
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (url, init) => {
    const fn = String(url).split("/rest/v1/rpc/")[1];
    const body = JSON.parse(init.body);
    calls.push(fn);
    if (body.p_secret !== SECRET) return reply(403, { code: "28000", message: "revocato" });
    if (fn === "studyos_agent_pull") return reply(200, []);
    if (fn === "studyos_agent_push") {
      pushed.push(...body.p_rows);
      return reply(200, body.p_rows.map((row) => ({ entity_type: row.entity_type, entity_id: row.entity_id, accepted: true })));
    }
    if (fn === "studyos_agent_group_snapshot") {
      if (missing) return reply(404, { code: "PGRST202", message: "funzione mancante" });
      return reply(200, { groups: [{ id: "g1", name: "Chimica insieme" }], sessions: [sessionRow()], overrides: [] });
    }
    return reply(404, { message: "funzione sconosciuta" });
  };
  return { fetch, calls, pushed };
};

const runnerOn = (cloud) => createCloudRunner({ url: "http://cloud.test/", key: "sb_publishable_prova", fetch: cloud.fetch });

test("1.9.0: istruzioni e strumenti che leggono lo snapshot dei gruppi", () => {
  assert.equal(AGENT_SERVER_VERSION, "1.9.0");
  assert.match(AGENT_INSTRUCTIONS, /studyos_check_consistency/);
  assert.match(cloudInstructions("Ada"), /Appelli dei gruppi/);
  assert.equal(GROUP_SNAPSHOT_TOOLS.size, 7);
  for (const name of GROUP_SNAPSHOT_TOOLS) assert.equal(CLOUD_UNAVAILABLE.has(name), false, name);
});

test("remoto: appelli dallo snapshot, store svuotato dopo; gli altri strumenti non lo chiedono", async () => {
  const cloud = fakeCloud();
  const runner = runnerOn(cloud);
  const result = await runner.run(grant, "studyos_list_group_exam_sessions", {});
  assert.equal(result.ok, true);
  assert.equal(result.data.items[0].id, "gexam_a");
  assert.equal(result.data.items[0].notes, "scrivere a [email nascosta]");
  assert.ok(cloud.calls.includes("studyos_agent_group_snapshot"));
  assert.equal(useGroupExamStore.getState().ready, false);
  cloud.calls.length = 0;
  await runner.run(grant, "studyos_list_tasks", {});
  assert.equal(cloud.calls.includes("studyos_agent_group_snapshot"), false);
});

test("remoto: scegliere un appello scrive il piano personale nel cloud", async () => {
  const cloud = fakeCloud();
  const result = await runnerOn(cloud).run(grant, "studyos_plan_exam", { sessionId: "gexam_a", chosen: true });
  assert.equal(result.ok, true);
  const row = cloud.pushed.find((item) => item.entity_type === "examPlan");
  assert.equal(row.entity_id, "plan_gexam_a");
  assert.equal(row.payload.selected, true);
});

test("remoto: script non eseguito → not_connected; le scritture sul gruppo non ci sono", async () => {
  const cloud = fakeCloud({ missing: true });
  const runner = runnerOn(cloud);
  const result = await runner.run(grant, "studyos_list_group_exam_sessions", {});
  assert.equal(result.code, "not_connected");
  assert.equal(result.error, "Gli appelli del gruppo non sono ancora attivi.");
  const write = await runner.run(grant, "studyos_create_group_exam_session", { groupId: "g1", date: "2027-01-12", kind: "appello", courseName: "Chimica" });
  assert.equal(write.code, "invalid");
  assert.equal(useGroupExamStore.getState().available, true);
});
