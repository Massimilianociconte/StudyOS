import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { executeAgentTool } from "../src/agent/execute.ts";
import { hiddenGroupName } from "../src/agent/groupExamTools.ts";
import { agentGroupName, publicGroup } from "../src/agent/project.ts";
import { BARB_DATASET } from "../src/data/university/barb.dataset.ts";
import { GROUP_NAME_MAX } from "../src/lib/groups.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// R3-4/R3-5: un nome di gruppo più lungo di 120 caratteri (scritto prima del limite) si taglia al confine di
// una parola PRIMA di oscurare. Tagliato a metà, «bea.privata@gmail.com» diventerebbe «bea.priv» (senza «@»,
// quindi non più un indirizzo da nascondere) e arriverebbe all'agente.
const T1 = `${"x".repeat(110)} bea.privata@gmail.com`;
const T4 = `${"x".repeat(105)} bea.privata(at)gmail.com`;
const LEAKS = ["bea", "priv", "gmail", "(at", "@"];
const assertClean = (value, label) => {
  const json = JSON.stringify(value);
  for (const leak of LEAKS) assert.equal(json.includes(leak), false, `${label}: ${leak}`);
};

const session = (patch = {}) => ({
  id: "gexam_a", groupId: "g1", courseKey: "nome:farmaco", courseId: null, courseName: "Farmaco",
  date: "2027-01-12", kind: "appello", label: "", time: "09:30", room: "Aula C03", notes: "",
  registrationOpens: null, registrationCloses: null, barbSessionId: null, source: "member", version: 1,
  createdBy: "u-bea", createdByName: "Bea", updatedBy: "u-bea", updatedByName: "Bea", deletedAt: null, deletedByName: null,
  createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", ...patch
});

const teacher = BARB_DATASET.teachers.find((item) => item.email);
const correction = {
  id: "gover_t", groupId: "g1", targetKind: "teacher", targetId: teacher.id, targetLabel: teacher.displayName,
  fields: { email: "nuovo.prof@unimi.it" }, version: 1, createdBy: "u", createdByName: "Bea", updatedBy: "u", updatedByName: "Bea",
  deletedAt: null, deletedByName: null, createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z"
};

const seed = (name) => {
  useStudyStore.setState({
    loading: false, locked: false, persistError: null, subjects: [], exams: [], events: [], examPlans: [], reminders: [], notifications: [],
    groupActivities: [], groupResources: [],
    studyGroups: [{ id: "g1", name, description: "", ownerDisplayName: "Bea", archived: false, updatedAt: "2026-11-01T10:00:00Z", members: [{ displayName: "Bea", role: "owner", userId: "u1" }] }]
  });
  useGroupExamStore.getState().reset();
  useGroupExamStore.getState().setSnapshot({ viewerId: "me", groups: [{ id: "g1", name }], sessions: [session()], overrides: [correction] });
};

test("agentGroupName: al massimo 120 caratteri, tagliato al confine di una parola, poi oscurato", () => {
  assert.equal(GROUP_NAME_MAX, 120);
  assert.equal(agentGroupName(T1), "x".repeat(110));
  assert.equal(agentGroupName(T4), "x".repeat(105));
  assert.equal(agentGroupName("Farmaco bea@gmail.com"), "Farmaco [email nascosta]", "un nome corto si oscura e basta");
  assert.equal(agentGroupName(null), "");
  assert.equal(publicGroup({ id: "g", name: T1, description: "", ownerDisplayName: "", archived: false, updatedAt: "", members: [] }).name, "x".repeat(110));
  // Gli stessi tagli dell'istantanea SQL (tests/fixtures/emailVectors.json, «cuts»).
  const { cuts } = JSON.parse(readFileSync(new URL("./fixtures/emailVectors.json", import.meta.url), "utf8"));
  for (const c of cuts) assert.equal(agentGroupName(c.input), c.agent, c.name);
});

test("ogni strumento che dà il nome del gruppo lo taglia allo stesso modo", async () => {
  for (const [label, name, expected] of [["T1", T1, "x".repeat(110)], ["T4", T4, "x".repeat(105)]]) {
    seed(name);
    assert.equal(hiddenGroupName("g1"), expected, `${label}: appelli e correzioni (publicOverride)`);
    const sessions = await executeAgentTool("studyos_list_group_exam_sessions", {});
    assert.equal(sessions.ok, true, JSON.stringify(sessions));
    assert.equal(sessions.data.groups[0].name, expected);
    assert.equal(sessions.data.items[0].groupName, expected);
    assertClean(sessions.data, `${label} appelli`);
    const corrections = await executeAgentTool("studyos_list_barb_teachers", { groupId: "g1", query: teacher.displayName, limit: 5 });
    assert.equal(corrections.ok, true, JSON.stringify(corrections));
    const mine = corrections.data.items.find((item) => item.id === teacher.id);
    assert.equal(mine.corrections[0].groupName, expected, `${label}: publicCorrection`);
    const groups = await executeAgentTool("studyos_list_groups", {});
    assert.equal(groups.data.items[0].name, expected);
    assertClean(groups.data, `${label} gruppi`);
    const plan = await executeAgentTool("studyos_plan_exam", { sessionId: "gexam_a", chosen: true });
    assert.equal(plan.ok, true, JSON.stringify(plan));
    useGroupExamStore.getState().reset();
    const offline = await executeAgentTool("studyos_list_exam_plan", {});
    assert.equal(offline.data.items[0].session.groupName, expected, `${label}: copia salvata (snapshotView)`);
    assertClean(offline.data.items[0].session, `${label} copia salvata`);
  }
});

test("i punti che danno il nome di un gruppo passano da agentGroupName o hiddenGroupName", () => {
  const exams = readFileSync(new URL("../src/agent/groupExamTools.ts", import.meta.url), "utf8");
  const university = readFileSync(new URL("../src/agent/universityTools.ts", import.meta.url), "utf8");
  assert.match(exams, /const publicOverride = [\s\S]*?groupName: hiddenGroupName\(row\.groupId\)/);
  assert.match(university, /export const publicCorrection = [\s\S]*?groupName: hiddenGroupName\(row\.groupId\)/);
  for (const source of [exams, university]) assert.equal(/groupName: agentMemberText/.test(source), false);
});

test("il nome di un nuovo gruppo ha maxLength 120 nel modulo", () => {
  const view = readFileSync(new URL("../src/views/GroupsView.tsx", import.meta.url), "utf8");
  const input = view.slice(view.indexOf('<Field label="Nome del gruppo">'), view.indexOf("</Field>", view.indexOf('<Field label="Nome del gruppo">')));
  assert.match(input, /maxLength=\{GROUP_NAME_MAX\}/);
  assert.match(view, /import \{[^}]*GROUP_NAME_MAX[^}]*\} from "\.\.\/lib\/groups"/);
});
