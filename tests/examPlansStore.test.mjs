import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { COLLECTIONS, ENTITY_TYPES } from "../src/lib/collections.ts";
import { examPlanId, unlinkPlans } from "../src/lib/examPlans.ts";
import { sessionFromRow } from "../src/lib/groupExams.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const session = sessionFromRow({
  id: "gexam_a1", group_id: "gx", course_key: "barb:farm-spec", course_id: "farm-spec", course_name: "Farmacologia Speciale",
  exam_date: "2027-01-12", kind: "preappello", label: "", exam_time: null, room: "Aula C03", notes: "",
  registration_opens: null, registration_closes: null, barb_session_id: null, source: "member", version: 1,
  created_by: "u-bea", created_by_name: "Bea", updated_by: "u-bea", updated_by_name: "Bea", deleted_at: null, deleted_by_name: null,
  created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z"
});
const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };
const seed = (extra = {}) =>
  useStudyStore.setState({
    loading: false, locked: false, persistError: undefined,
    subjects: [{ id: "sub_farm", name: "Farmacologia Speciale", ...stamp }],
    exams: [{ id: "exam_1", subjectId: "sub_farm", date: "2027-01-12T08:00:00.000Z", ...stamp }],
    events: [{ id: "ev_1", title: "Appello · Farmacologia Speciale", start: "2027-01-12T00:00:00", end: "2027-01-13T00:00:00", allDay: true, category: "exam", recurrence: "none", ...stamp }],
    topics: [], tasks: [], sessions: [], widgets: [], attachments: [], notes: [], reminders: [], examPlans: [],
    ...extra
  });

test("examPlans è una collezione personale sincronizzata", () => {
  assert.ok(COLLECTIONS.includes("examPlans"));
  assert.equal(ENTITY_TYPES.examPlans, "examPlan");
  assert.match(source("src/lib/db.ts"), /this\.version\(8\)\.stores\(\{\s*examPlans: "id, updatedAt, sessionId"/);
  assert.match(source("src/lib/cloudSync.ts"), /const SYNC_SCHEMA = 4;/);
  assert.match(source("src/lib/backup.ts"), /examPlans: "piani d'esame"/);
  assert.match(source("src/views/SettingsView.tsx"), /examPlans: scope === "full" \? snapshot\.examPlans : \[\]/);
});

test("planExam: un piano per appello, aggiornato e non duplicato", async () => {
  seed();
  assert.equal(await useStudyStore.getState().planExam("gexam_nessuno", { selected: true }), null, "senza appello né piano non crea nulla");
  const first = await useStudyStore.getState().planExam(session.id, { selected: true, linkedEventId: "ev_1" }, session, "Farmaco");
  assert.equal(first.id, examPlanId(session.id));
  assert.equal(first.selected, true);
  assert.equal(first.snapshot.groupName, "Farmaco");
  const second = await useStudyStore.getState().planExam(session.id, { status: "registered", notes: "porta il libretto" });
  assert.equal(useStudyStore.getState().examPlans.length, 1);
  assert.equal(second.status, "registered");
  assert.equal(second.linkedEventId, "ev_1");
  assert.ok(second.updatedAt > first.updatedAt, "ogni modifica vince sulla precedente");
  await useStudyStore.getState().removeExamPlan(second.id);
  assert.deepEqual(useStudyStore.getState().examPlans, []);
});

test("eliminare materia, esame o evento toglie il collegamento dal piano", async () => {
  seed();
  await useStudyStore.getState().planExam(session.id, { selected: true, subjectId: "sub_farm", examId: "exam_1", linkedEventId: "ev_1" }, session, "Farmaco");
  await useStudyStore.getState().deleteEvent("ev_1");
  assert.equal(useStudyStore.getState().examPlans[0].linkedEventId, undefined);
  await useStudyStore.getState().deleteExam("exam_1");
  assert.equal(useStudyStore.getState().examPlans[0].examId, undefined);
  await useStudyStore.getState().deleteSubject("sub_farm");
  const plan = useStudyStore.getState().examPlans[0];
  assert.equal(plan.subjectId, undefined);
  assert.equal(plan.selected, true, "la scelta resta");
});

test("unlinkPlans: i piani non toccati restano gli stessi oggetti", () => {
  const plan = { id: "plan_x", sessionId: "x", subjectId: "s1", updatedAt: "2026-11-01T00:00:00Z" };
  const other = { id: "plan_y", sessionId: "y", subjectId: "s2", updatedAt: "2026-11-01T00:00:00Z" };
  const [changed, same] = unlinkPlans([plan, other], { subjectIds: new Set(["s1"]) }, "2026-11-12T00:00:00Z");
  assert.equal(changed.subjectId, undefined);
  assert.equal(changed.updatedAt, "2026-11-12T00:00:00Z");
  assert.equal(same, other);
});

test("promemoria autonomi: aggiungi, segna fatto, elimina", async () => {
  seed();
  const created = await useStudyStore.getState().addReminder({ title: "  Chiama la segreteria ", remindAt: "2026-11-20T09:00:00.000Z", linkedEntityType: "subject", linkedEntityId: "sub_farm" });
  assert.equal(created.title, "Chiama la segreteria");
  assert.equal(created.done, false);
  await useStudyStore.getState().updateReminder(created.id, { done: true });
  assert.equal(useStudyStore.getState().reminders[0].done, true);
  await useStudyStore.getState().deleteReminder(created.id);
  assert.deepEqual(useStudyStore.getState().reminders, []);
});
