import assert from "node:assert/strict";
import test from "node:test";
import { findAgentTool } from "../src/agent/catalog.ts";
import { EXTRA_TOOL_NAMES } from "../src/agent/catalogExtras.ts";
import { executeAgentTool } from "../src/agent/execute.ts";
import { retag, tagSummary } from "../src/lib/itemTags.ts";
import { linkedCounts } from "../src/lib/subjectLinks.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const base = { createdAt: "2026-11-01T10:00:00.000Z", updatedAt: "2026-11-01T10:00:00.000Z", archived: false, tags: [] };

const seed = (patch = {}) => {
  useStudyStore.setState({
    loading: false,
    locked: false,
    persistError: null,
    subjects: [{ ...base, id: "s1", name: "Chimica", teacher: "", cfu: 6, semester: "1", status: "active", color: "#336699", notes: "" }],
    exams: [{ ...base, id: "x1", subjectId: "s1", title: "Chimica", date: "2027-01-12T09:00:00.000Z" }],
    topics: [{ ...base, id: "t1", subjectId: "s1", title: "Acidi" }],
    tasks: [{ ...base, id: "k1", title: "Esercizi", subjectId: "s1", tags: ["Lab"] }],
    events: [{ ...base, id: "e1", title: "Lezione", subjectId: "s1", start: "2027-01-10T09:00:00.000Z", end: "2027-01-10T11:00:00.000Z", allDay: false, category: "lesson" }],
    sessions: [],
    attachments: [],
    goals: [],
    notes: [{ ...base, id: "n1", title: "Appunti", body: "", linkedEntityType: "exam", linkedEntityId: "x1" }],
    reminders: [{ ...base, id: "r1", title: "Ripasso", remindAt: "2027-01-11T08:00:00.000Z", done: false, linkedEntityType: "subject", linkedEntityId: "s1" }],
    examPlans: [],
    ...patch
  });
  useGroupExamStore.getState().reset();
};

test("catalogo: otto strumenti, eliminazioni con confirm", () => {
  assert.equal(EXTRA_TOOL_NAMES.length, 8);
  for (const name of EXTRA_TOOL_NAMES) assert.ok(findAgentTool(name), name);
  assert.equal(findAgentTool("studyos_delete_subject").risk, "destructive");
  assert.equal(findAgentTool("studyos_create_reminder").additive, true);
  assert.equal(findAgentTool("studyos_check_consistency").risk, "read");
});

test("collegamenti di una materia: contati prima, sciolti dopo l'eliminazione", async () => {
  seed();
  assert.deepEqual(linkedCounts(useStudyStore.getState(), "s1"), { exams: 1, topics: 1, tasks: 1, events: 1, sessions: 0, materials: 0, notes: 1, reminders: 1, plans: 0 });
  const read = await executeAgentTool("studyos_get_subject", { id: "s1" });
  assert.equal(read.data.item.linkedCounts.exams, 1);
  const done = await executeAgentTool("studyos_delete_subject", { id: "s1", confirm: true });
  assert.equal(done.ok, true);
  assert.deepEqual(done.data.removed, { exams: 1, topics: 1 });
  const after = useStudyStore.getState();
  assert.equal(after.subjects.length, 0);
  assert.equal(after.exams.length, 0);
  assert.equal(after.tasks[0].subjectId, undefined);
  assert.equal(after.reminders[0].linkedEntityId, undefined);
  assert.equal((await executeAgentTool("studyos_delete_subject", { id: "s1", confirm: true })).code, "not_found");
});

test("etichette: niente doppioni (maiuscole ignorate), tolte e riassunte", () => {
  assert.deepEqual(retag(["Lab", "Urgente"], ["lab", " Ripasso  finale "], ["urgente"]), ["Lab", "Ripasso finale"]);
  assert.deepEqual(tagSummary({ task: [{ tags: ["Lab"] }, { tags: ["lab", "Altro"] }, { tags: ["Lab"], archived: true }], note: [{ tags: ["Altro"] }] }), [
    { label: "Altro", count: 2, byType: { task: 1, note: 1 } },
    { label: "Lab", count: 2, byType: { task: 2 } }
  ]);
});

test("tag_items: id sconosciuti rifiutati, poi aggiunte e rimozioni", async () => {
  seed();
  const missing = await executeAgentTool("studyos_tag_items", { type: "task", ids: ["k1", "ghost"], add: ["Esame"] });
  assert.equal(missing.code, "not_found");
  assert.deepEqual(missing.data.missing, ["ghost"]);
  const done = await executeAgentTool("studyos_tag_items", { type: "task", ids: ["k1"], add: ["Esame"], remove: ["lab"] });
  assert.equal(done.data.changed, 1);
  assert.deepEqual(useStudyStore.getState().tasks[0].tags, ["Esame"]);
  const tags = await executeAgentTool("studyos_list_tags", {});
  assert.deepEqual(tags.data.items, [{ label: "Esame", count: 1, byType: { task: 1 } }]);
  assert.equal((await executeAgentTool("studyos_tag_items", { type: "task", ids: ["k1"] })).code, "invalid");
});

test("promemoria autonomi: crea, elenca, segna fatto, elimina", async () => {
  seed();
  const bad = await executeAgentTool("studyos_create_reminder", { title: "Iscrizione", remindAt: "2027-01-08T09:00:00+01:00", linkedType: "exam", linkedId: "nope" });
  assert.equal(bad.code, "not_found");
  const made = await executeAgentTool("studyos_create_reminder", { title: "Iscrizione", remindAt: "2027-01-08T09:00:00+01:00", linkedType: "exam", linkedId: "x1" });
  assert.equal(made.ok, true);
  assert.equal(made.data.reminder.remindAt, "2027-01-08T08:00:00.000Z");
  const listed = await executeAgentTool("studyos_list_reminders", {});
  assert.deepEqual(listed.data.items.map((item) => item.title), ["Iscrizione", "Ripasso"]);
  await executeAgentTool("studyos_update_reminder", { id: made.data.reminder.id, done: true });
  const open = await executeAgentTool("studyos_list_reminders", {});
  assert.deepEqual(open.data.items.map((item) => item.title), ["Ripasso"]);
  const all = await executeAgentTool("studyos_list_reminders", { includeDone: true });
  assert.equal(all.data.total, 2);
  const removed = await executeAgentTool("studyos_delete_reminder", { id: "r1", confirm: true });
  assert.equal(removed.ok, true);
  assert.equal(useStudyStore.getState().reminders.some((item) => item.id === "r1"), false);
});

const groupSession = (id, patch = {}) => ({
  id,
  groupId: "g1",
  courseKey: "name:chimica",
  courseId: null,
  courseName: "Chimica",
  date: "2027-01-12",
  kind: "appello",
  label: "",
  time: null,
  room: "",
  notes: "",
  registrationOpens: null,
  registrationCloses: null,
  barbSessionId: null,
  source: "member",
  version: 1,
  createdBy: "u1",
  createdByName: "Ada",
  updatedBy: "u1",
  updatedByName: "Ada",
  deletedAt: null,
  deletedByName: null,
  createdAt: `2026-11-0${id === "a" ? 1 : 2}T10:00:00Z`,
  updatedAt: "2026-11-02T10:00:00Z",
  ...patch
});

test("controllo di coerenza: ambito, gravità minima, appelli non letti", async () => {
  // Senza esami personali: l'esame x1 dello stesso giorno sarebbe un doppione da collegare (info).
  seed({ exams: [], notes: [], reminders: [{ ...base, id: "r9", title: "Orfano", remindAt: "2027-01-11T08:00:00.000Z", done: false, linkedEntityType: "task", linkedEntityId: "ghost" }] });
  const offline = await executeAgentTool("studyos_check_consistency", {});
  assert.equal(offline.data.groupExamsChecked, false);
  assert.deepEqual(offline.data.items.map((issue) => issue.code), ["orphan_link"]);

  useGroupExamStore.getState().setSnapshot({ viewerId: "me", groups: [{ id: "g1", name: "Gruppo di bea@gmail.com" }], sessions: [groupSession("a"), groupSession("b")], overrides: [] });
  const all = await executeAgentTool("studyos_check_consistency", {});
  assert.equal(all.data.groupExamsChecked, true);
  assert.deepEqual(all.data.items.map((issue) => issue.code), ["duplicate_session", "orphan_link"]);
  assert.equal(all.data.items[0].fix.tool, "studyos_delete_group_exam_session");
  assert.equal(JSON.stringify(all.data).includes("@"), false);
  const groups = await executeAgentTool("studyos_check_consistency", { scope: "groups" });
  assert.deepEqual(groups.data.items.map((issue) => issue.code), ["duplicate_session"]);
  const personal = await executeAgentTool("studyos_check_consistency", { scope: "personal" });
  assert.deepEqual(personal.data.items.map((issue) => issue.code), ["orphan_link"]);
  const errors = await executeAgentTool("studyos_check_consistency", { minSeverity: "error" });
  assert.deepEqual(errors.data.items.map((issue) => issue.code), ["duplicate_session"]);
  useGroupExamStore.getState().reset();
});
