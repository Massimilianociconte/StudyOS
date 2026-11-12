import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AGENT_TOOLS, CLOUD_UNAVAILABLE, findAgentTool } from "../src/agent/catalog.ts";
import { EVENT_REMINDERS } from "../src/agent/catalogParts.ts";
import { GROUP_EXAM_TOOL_NAMES } from "../src/agent/catalogGroupExams.ts";
import { executeAgentTool } from "../src/agent/execute.ts";
import { groupExamWriterLoader } from "../src/agent/groupExamTools.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const session = (patch = {}) => ({
  id: "gexam_a",
  groupId: "g1",
  courseKey: "id:farm-spec",
  courseId: "farm-spec",
  courseName: "Farmacologia Speciale",
  date: "2027-01-12",
  kind: "preappello",
  label: "",
  time: "09:30",
  room: "Aula C03",
  notes: "Chiedere a bea@gmail.com",
  registrationOpens: null,
  registrationCloses: "2027-01-08",
  barbSessionId: null,
  source: "member",
  version: 2,
  createdBy: "u-bea",
  createdByName: "Bea",
  updatedBy: "u-ada",
  updatedByName: "Ada",
  deletedAt: null,
  deletedByName: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-02T10:00:00Z",
  ...patch
});

const seed = (sessions = [session()]) => {
  useStudyStore.setState({
    loading: false,
    locked: false,
    persistError: null,
    subjects: [{ id: "s1", name: "Farmacologia Speciale", universityCourseId: "farm-spec", archived: false, status: "active", createdAt: "", updatedAt: "", tags: [] }],
    exams: [],
    events: [{ id: "e1", title: "Appello · Farmacologia Speciale", category: "exam", start: "2027-01-12T00:00:00", end: "2027-01-13T00:00:00", allDay: true, archived: false, createdAt: "", updatedAt: "", tags: [] }],
    examPlans: [],
    reminders: [],
    studyGroups: []
  });
  useGroupExamStore.getState().setSnapshot({ viewerId: "me", groups: [{ id: "g1", name: "Farmaco" }], sessions, overrides: [] });
};

/** Finto server: risposte in coda, chiamate ricordate. */
const fakeWriter = (answers = {}) => {
  const calls = [];
  const answer = (name, fallback) => {
    const queue = answers[name] ?? [];
    const next = queue.length ? queue.shift() : fallback;
    if (next instanceof Error) throw next;
    return next;
  };
  groupExamWriterLoader.load = async () => ({
    saveSession: async (...args) => (calls.push(["saveSession", ...args]), answer("saveSession", { status: "ok", row: session({ id: args[1], version: (args[2] ?? 0) + 1, ...args[3] }) })),
    deleteSession: async (...args) => (calls.push(["deleteSession", ...args]), answer("deleteSession", { status: "ok", row: session({ deletedAt: "2026-11-12T10:00:00Z", deletedByName: "Io", version: 3 }) })),
    restore: async (...args) => (calls.push(["restore", ...args]), answer("restore", { status: "ok", row: session({ version: 4 }) })),
    listHistory: async (...args) => (calls.push(["listHistory", ...args]), answer("listHistory", [])),
    saveOverride: async () => ({ status: "invalid" }),
    deleteOverride: async () => ({ status: "invalid" })
  });
  return calls;
};

test("catalogo: otto strumenti degli appelli, effetti sul gruppo dichiarati", () => {
  assert.equal(GROUP_EXAM_TOOL_NAMES.length, 8);
  for (const name of GROUP_EXAM_TOOL_NAMES) assert.ok(findAgentTool(name), name);
  for (const name of ["studyos_create_group_exam_session", "studyos_update_group_exam_session", "studyos_delete_group_exam_session", "studyos_restore_group_change"]) {
    assert.equal(findAgentTool(name).openWorld, true, name);
    assert.equal(CLOUD_UNAVAILABLE.has(name), true, name);
  }
  assert.equal(CLOUD_UNAVAILABLE.has("studyos_list_group_history"), true);
  assert.equal(CLOUD_UNAVAILABLE.has("studyos_plan_exam"), false);
  assert.deepEqual(EVENT_REMINDERS, findAgentTool("studyos_create_event").inputSchema.properties.reminders);
  const source = readFileSync(new URL("../src/agent/execute.ts", import.meta.url), "utf8");
  assert.equal(/from "\.\/groupExamTools"/.test(source), false);
  assert.match(source, /import\("\.\/groupExamTools"\)/);
  assert.ok(AGENT_TOOLS.length >= 81);
});

test("elenco: nessun id di account, note dei membri senza email, gruppi disponibili", async () => {
  seed();
  const result = await executeAgentTool("studyos_list_group_exam_sessions", {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.data.groups, [{ groupId: "g1", name: "Farmaco" }]);
  const [item] = result.data.items;
  assert.equal(item.id, "gexam_a");
  assert.equal(item.addedBy, "Bea");
  assert.equal(item.notes, "Chiedere a [email nascosta]");
  assert.equal(item.mySubjectId, "s1");
  assert.equal(JSON.stringify(result.data).includes("u-bea"), false);
  assert.equal(JSON.stringify(result.data).includes("@"), false);
});

test("creazione: il doppione in memoria non scrive; uno nuovo si scrive e si sceglie", async () => {
  seed();
  let calls = fakeWriter();
  const twin = await executeAgentTool("studyos_create_group_exam_session", { groupId: "g1", subjectId: "s1", date: "2027-01-12", kind: "preappello" });
  assert.equal(twin.ok, true);
  assert.equal(twin.data.created, false);
  assert.equal(twin.data.duplicate, true);
  assert.equal(calls.length, 0);

  calls = fakeWriter();
  const made = await executeAgentTool("studyos_create_group_exam_session", { groupId: "g1", subjectId: "s1", date: "2027-02-03", kind: "scritto", time: "10:00", choose: true });
  assert.equal(made.ok, true);
  assert.equal(made.data.created, true);
  assert.equal(calls[0][0], "saveSession");
  assert.equal(calls[0][3], null);
  assert.equal(calls[0][4].courseId, "farm-spec");
  const plan = useStudyStore.getState().examPlans.find((item) => item.sessionId === made.data.session.id);
  assert.equal(plan.selected, true);
  assert.equal(plan.subjectId, "s1");
});

test("modifica: versione vecchia → conflict con la riga attuale; giusta → scrive", async () => {
  seed();
  const calls = fakeWriter();
  const stale = await executeAgentTool("studyos_update_group_exam_session", { id: "gexam_a", expectedVersion: 1, room: "Aula G24" });
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "conflict");
  assert.equal(stale.data.current.version, 2);
  assert.equal(calls.length, 0);
  const done = await executeAgentTool("studyos_update_group_exam_session", { id: "gexam_a", expectedVersion: 2, room: "Aula G24", label: "" });
  assert.equal(done.ok, true);
  assert.equal(calls[0][3], 2);
  assert.equal(calls[0][4].room, "Aula G24");
  assert.equal(calls[0][4].time, "09:30");
});

test("esiti del server: conflitto, permesso, rete", async () => {
  seed();
  fakeWriter({ saveSession: [{ status: "conflict", row: session({ version: 3, room: "Aula B" }) }] });
  const conflict = await executeAgentTool("studyos_update_group_exam_session", { id: "gexam_a", expectedVersion: 2, room: "Aula G24" });
  assert.equal(conflict.code, "conflict");
  assert.equal(conflict.data.current.room, "Aula B");
  fakeWriter({ deleteSession: [{ status: "denied", message: "Può eliminarlo chi l'ha aggiunto o chi gestisce il gruppo." }] });
  const denied = await executeAgentTool("studyos_delete_group_exam_session", { id: "gexam_a", confirm: true });
  assert.equal(denied.code, "denied");
  fakeWriter({ deleteSession: [new Error("Serve la connessione per cambiare gli appelli del gruppo.")] });
  const offline = await executeAgentTool("studyos_delete_group_exam_session", { id: "gexam_a", confirm: true });
  assert.equal(offline.code, "not_connected");
});

test("eliminazione senza expectedVersion: vale la versione letta ora", async () => {
  seed();
  const calls = fakeWriter();
  const result = await executeAgentTool("studyos_delete_group_exam_session", { id: "gexam_a", confirm: true });
  assert.equal(result.ok, true);
  assert.deepEqual(calls[0], ["deleteSession", "gexam_a", 2]);
});

test("piano: scelta con materia automatica, collegamento tolto con \"\", modifiche viste", async () => {
  seed();
  const chosen = await executeAgentTool("studyos_plan_exam", { sessionId: "gexam_a", chosen: true, linkedEventId: "e1" });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.data.plan.chosen, true);
  assert.equal(chosen.data.plan.subjectId, "s1");
  assert.equal(chosen.data.plan.linkedEventId, "e1");
  const unlinked = await executeAgentTool("studyos_plan_exam", { sessionId: "gexam_a", linkedEventId: "" });
  assert.equal(unlinked.data.plan.linkedEventId, undefined);
  const missing = await executeAgentTool("studyos_plan_exam", { sessionId: "gexam_a", subjectId: "nope" });
  assert.equal(missing.code, "not_found");
  useGroupExamStore.getState().applySession(session({ version: 3, date: "2027-01-14" }));
  const listed = await executeAgentTool("studyos_list_exam_plan", {});
  assert.deepEqual(listed.data.items[0].changes, ["Data: 12/01/2027 → 14/01/2027"]);
  await executeAgentTool("studyos_plan_exam", { sessionId: "gexam_a", acknowledgeChanges: true });
  const after = await executeAgentTool("studyos_list_exam_plan", {});
  assert.deepEqual(after.data.items[0].changes, []);
});

test("senza appelli letti: not_connected, mai «non c'è»", async () => {
  seed();
  useGroupExamStore.getState().setUnavailable();
  const result = await executeAgentTool("studyos_list_group_exam_sessions", {});
  assert.equal(result.code, "not_connected");
  useGroupExamStore.getState().reset();
  const empty = await executeAgentTool("studyos_list_group_exam_sessions", {});
  assert.equal(empty.code, "not_connected");
});
