import assert from "node:assert/strict";
import test from "node:test";
import { createCloudRunner } from "../src/agent/cloudRunner.ts";
import { executeAgentTool } from "../src/agent/execute.ts";
import { auditImage } from "../src/agent/remoteAudit.ts";
import { courseKeyOf } from "../src/lib/groupExams.ts";
import { planGroupExamNotifications } from "../src/lib/groupExamNotify.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const TYPED = "chiedi a bea.private@gmail.com o ada@unimi.it e @beahandle";
const LEAKS = ["bea.private", "gmail", "ada@unimi", "@beahandle", "beahandle", "bea private", "adaunimi"];
const leaksIn = (value) => {
  const json = JSON.stringify(value);
  return LEAKS.filter((leak) => json.includes(leak));
};

const session = (patch = {}) => ({
  id: "gexam_a", groupId: "g1", courseKey: "nome:farmaco", courseId: null, courseName: "Farmaco",
  date: "2027-01-12", kind: "appello", label: "", time: "09:30", room: "Aula C03", notes: "",
  registrationOpens: null, registrationCloses: null, barbSessionId: null, source: "member", version: 1,
  createdBy: "u-bea", createdByName: "Bea", updatedBy: "u-bea", updatedByName: "Bea", deletedAt: null, deletedByName: null,
  createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", ...patch
});

const seed = (sessions, extra = {}) => {
  useStudyStore.setState({ loading: false, locked: false, persistError: null, subjects: [], exams: [], events: [], examPlans: [], reminders: [], notifications: [], studyGroups: [], groupActivities: [], groupResources: [], ...extra });
  useGroupExamStore.getState().reset();
  useGroupExamStore.getState().setSnapshot({ viewerId: "me", groups: [{ id: "g1", name: "Farmaco" }], sessions, overrides: [] });
};

const notificationsFor = (patch, plans = [], watermark = "2026-11-01T00:00:00Z") =>
  planGroupExamNotifications({
    sessions: [session(patch)],
    plans,
    subjects: [{ id: "subj_1", name: "Farmaco", archived: false }],
    me: "me",
    watermark,
    today: "2026-11-12"
  }).notifications.map((item) => ({ ...item, updatedAt: item.createdAt }));

test("NEW-1: le notifiche degli appelli arrivano oscurate, anche la ricerca", async () => {
  seed([]);
  const added = notificationsFor({ id: "gexam_n", room: TYPED, label: TYPED, createdByName: "bea.private@gmail.com", createdAt: "2026-11-05T10:00:00Z" });
  const plan = { selected: true, sessionId: "gexam_a", snapshot: { groupId: "g1", groupName: "G", courseKey: "nome:farmaco", courseName: "Farmaco", date: "2027-01-12", kind: "appello", time: "09:30", room: "Aula C03", registrationCloses: null, version: 0 } };
  const changed = notificationsFor({ room: TYPED, version: 2, updatedBy: "u-ada", updatedByName: "Ada", updatedAt: "2026-11-06T10:00:00Z" }, [{ ...plan, snapshot: { ...plan.snapshot, version: 1 } }]);
  assert.ok(added.length > 0 && changed.length > 0);
  assert.ok(leaksIn([added, changed]).length > 0, "le notifiche grezze contengono il testo dei membri (premessa)");
  useStudyStore.setState({ notifications: [...added, ...changed] });
  const listed = await executeAgentTool("studyos_list_notifications", {});
  assert.equal(listed.ok, true);
  assert.deepEqual(leaksIn(listed), []);
  const hit = await executeAgentTool("studyos_list_notifications", { query: "bea.private@gmail.co" });
  const miss = await executeAgentTool("studyos_list_notifications", { query: "bea.private@gmail.cx" });
  assert.equal(hit.data.items.length, 0);
  assert.equal(miss.data.items.length, 0);
  const marked = await executeAgentTool("studyos_mark_notifications_read", { id: added[0].id });
  assert.equal(marked.ok, true);
});

const SECRET = "c".repeat(64);
const grant = { secret: SECRET, timeZone: "Europe/Rome" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const fakeCloud = (handlers) => {
  const fetch = async (url, init) => {
    const fn = String(url).split("/rest/v1/rpc/")[1];
    const body = JSON.parse(init.body);
    if (handlers[fn]) return reply(200, handlers[fn](body));
    if (fn === "studyos_agent_pull") return reply(200, []);
    if (fn === "studyos_agent_push") return reply(200, body.p_rows.map((row) => ({ entity_type: row.entity_type, entity_id: row.entity_id, accepted: true })));
    return reply(404, { code: "PGRST202", message: fn });
  };
  return createCloudRunner({ url: "http://cloud.test/", key: "sb_publishable_x", fetch });
};

test("NEW-1 (remoto): elenco, ripristino e conflitto di una notifica non portano il testo dei membri", async () => {
  const [note] = notificationsFor({ id: "gexam_n", label: TYPED, room: TYPED, createdAt: "2026-11-05T10:00:00Z" });
  const payload = { ...note, title: TYPED, body: note.body };
  const runner = fakeCloud({
    studyos_agent_pull: (body) => (body.p_offset ? [] : [{ entity_type: "notification", entity_id: payload.id, payload, deleted: false, updated_at: "2026-11-05T10:00:00Z" }]),
    studyos_agent_restore_call: (body) =>
      body.mode === "conflict"
        ? { status: "conflict", items: 1, conflicts: [{ auditId: "a", entityType: "notification", entityId: payload.id, current: payload, currentDeleted: false }] }
        : { status: "restored", items: 1, changes: [{ auditId: "x", entityType: "notification", entityId: payload.id, action: "update", item: payload }] }
  });
  const listed = await runner.run(grant, "studyos_list_notifications", {});
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.ok(listed.data.items.length > 0);
  assert.deepEqual(leaksIn(listed), []);
  const restored = await runner.run(grant, "studyos_restore_change", { id: "0b9d3a5e-6c1f-4a2b-9e8d-7f6a5b4c3d2e" });
  assert.deepEqual(leaksIn(restored), []);
  assert.ok(restored.data.item || restored.data.title);
  assert.deepEqual(leaksIn(auditImage("notification", payload)), []);
});

test("NEW-1: nel registro, gruppi, risorse e attività vanno oscurati", () => {
  for (const type of ["groupResource", "groupActivity", "groupInvite"]) {
    assert.deepEqual(leaksIn(auditImage(type, { id: "x", title: TYPED, text: TYPED, groupName: TYPED, status: "ok" })), [], type);
  }
  const group = auditImage("studyGroup", { id: "g1", name: TYPED, description: TYPED, ownerDisplayName: TYPED, archived: false, updatedAt: "x", members: [{ displayName: TYPED, role: "member" }] });
  assert.deepEqual(leaksIn(group), []);
});

test("NEW-2: il controllo di coerenza non mostra la chiave del corso grezza; stabile tra le chiamate", async () => {
  const name = `Chimica ${TYPED}`;
  const key = courseKeyOf(null, name);
  seed([
    session({ id: "gexam_1", courseKey: key, courseName: name, date: "2027-01-12" }),
    session({ id: "gexam_2", courseKey: key, courseName: name, date: "2027-02-12" })
  ]);
  for (const id of ["gexam_1", "gexam_2"]) assert.equal((await executeAgentTool("studyos_plan_exam", { sessionId: id, chosen: true })).ok, true);
  const first = await executeAgentTool("studyos_check_consistency", {});
  const issue = first.data.items.find((item) => item.code === "two_selected_same_course");
  assert.ok(issue);
  assert.deepEqual(leaksIn(first.data), []);
  assert.ok(issue.id.includes(issue.refs.courseKey));
  const second = await executeAgentTool("studyos_check_consistency", {});
  assert.equal(second.data.items.find((item) => item.code === "two_selected_same_course").id, issue.id);
});

test("NEW-3: bacheca, gruppi ed elenco dei gruppi non portano il testo dei membri", async () => {
  seed([], {
    studyGroups: [{ id: "g1", name: `G ${TYPED}`, description: TYPED, ownerDisplayName: TYPED, archived: false, updatedAt: "2026-11-01T10:00:00Z", members: [{ displayName: TYPED, role: "member", userId: "u1" }] }],
    groupActivities: [{ id: "act1", groupId: "g1", actorDisplayName: TYPED, text: `ha aggiunto l'appello «Appello · Chimica ${TYPED}»`, createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z" }],
    groupResources: [{ id: "res1", groupId: "g1", kind: "note", title: TYPED, body: TYPED, pinned: false, addedByDisplayName: TYPED, updatedAt: "2026-11-05T10:00:00Z", createdAt: "2026-11-05T10:00:00Z" }]
  });
  const board = await executeAgentTool("studyos_list_group_board", { groupId: "g1" });
  assert.equal(board.ok, true, JSON.stringify(board));
  assert.equal(board.data.activities.length, 1);
  assert.deepEqual(leaksIn(board), []);
  const groups = await executeAgentTool("studyos_list_groups", {});
  assert.deepEqual(leaksIn(groups), []);
  const oracle = await executeAgentTool("studyos_list_groups", { query: "bea.private@gmail.co" });
  assert.equal(oracle.data.items.length, 0);
  const summary = await executeAgentTool("studyos_mark_notifications_read", { id: "res1" });
  assert.deepEqual(leaksIn(summary), []);
});

test("LOW-1: il filtro subjectId non conferma un nome grezzo indovinato", async () => {
  const name = "Chimica bea.private@gmail.com";
  seed([session({ courseKey: courseKeyOf(null, name), courseName: name })], {
    subjects: [
      { id: "s_guess", name: "chimica bea private gmail com", archived: false, teacher: "", cfu: 6, semester: "", status: "active", color: "#000" },
      { id: "s_plain", name: "Chimica", archived: false, teacher: "", cfu: 6, semester: "", status: "active", color: "#000" }
    ]
  });
  const guess = await executeAgentTool("studyos_list_group_exam_sessions", { subjectId: "s_guess" });
  assert.equal(guess.data.items.length, 0);
  assert.equal(guess.data.items.length === 0 && (await executeAgentTool("studyos_list_group_exam_sessions", {})).data.items[0].mySubjectId, undefined);
});

test("LOW-1: il collegamento normale per nome resta", async () => {
  seed([session({ courseName: "Farmaco", courseKey: "nome:farmaco" })], {
    subjects: [{ id: "s1", name: "Farmaco", archived: false, teacher: "", cfu: 6, semester: "", status: "active", color: "#000" }]
  });
  const listed = await executeAgentTool("studyos_list_group_exam_sessions", { subjectId: "s1" });
  assert.equal(listed.data.items.length, 1);
  assert.equal(listed.data.items[0].mySubjectId, "s1");
});
