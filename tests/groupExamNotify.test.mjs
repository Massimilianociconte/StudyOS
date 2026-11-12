import test from "node:test";
import assert from "node:assert/strict";
import { sessionFromRow } from "../src/lib/groupExams.ts";
import { applyPlanPatch, newExamPlan } from "../src/lib/examPlans.ts";
import { planGroupExamNotifications } from "../src/lib/groupExamNotify.ts";

const session = (over = {}) =>
  sessionFromRow({
    id: "gexam_a1", group_id: "gx", course_key: "barb:farm-spec", course_id: "farm-spec", course_name: "Farmacologia Speciale",
    exam_date: "2027-01-12", kind: "preappello", label: "", exam_time: null, room: "Aula C03", notes: "",
    registration_opens: null, registration_closes: null, barb_session_id: null, source: "member", version: 1,
    created_by: "u-bea", created_by_name: "Bea", updated_by: "u-bea", updated_by_name: "Bea", deleted_at: null, deleted_by_name: null,
    created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z", ...over
  });
const subjects = [{ id: "sub_farm", name: "Farmacologia Speciale", archived: false }];
const base = { plans: [], subjects, me: "u-me", today: "2026-11-12" };

test("primo avvio: nessun «nuovo appello» per quelli che c'erano già", () => {
  const result = planGroupExamNotifications({ ...base, sessions: [session()], watermark: undefined });
  assert.deepEqual(result.notifications, []);
  assert.equal(result.watermark, "2026-11-12T10:00:00Z");
});

test("nuovo appello di un altro membro per una mia materia", () => {
  const result = planGroupExamNotifications({ ...base, sessions: [session(), session({ id: "gexam_x", course_name: "Genetica", course_key: "nome:genetica", course_id: null })], watermark: "2026-11-11T00:00:00Z" });
  assert.deepEqual(result.notifications.map((item) => item.id), ["notif-gexam-new-gexam_a1"]);
  assert.equal(result.notifications[0].body, "Preappello · Farmacologia Speciale, 12/01/2027 · da Bea");
  assert.deepEqual(planGroupExamNotifications({ ...base, me: "u-bea", sessions: [session()], watermark: "2026-11-11T00:00:00Z" }).notifications, [], "le mie aggiunte non mi avvisano");
});

test("appello scelto: cambiato o eliminato da altri", () => {
  const plan = applyPlanPatch(newExamPlan(session(), "Farmaco", "2026-11-12T10:00:00Z"), { selected: true }, session(), "Farmaco", "2026-11-12T10:00:00Z");
  const changed = planGroupExamNotifications({ ...base, plans: [plan], watermark: "2026-11-12T10:00:00Z", sessions: [session({ version: 2, exam_date: "2027-01-14", updated_by: "u-ada", updated_by_name: "Ada" })] });
  assert.deepEqual(changed.notifications.map((item) => [item.id, item.body]), [["notif-gexam-gexam_a1-v2", "Preappello · Farmacologia Speciale: Data: 12/01/2027 → 14/01/2027 · da Ada"]]);
  const notes = planGroupExamNotifications({ ...base, plans: [plan], watermark: "2026-11-12T10:00:00Z", sessions: [session({ version: 2, notes: "porta il libretto", updated_by: "u-ada" })] });
  assert.deepEqual(notes.notifications, [], "solo data, tipo, ora, aula e iscrizioni avvisano");
  const deleted = planGroupExamNotifications({ ...base, plans: [plan], watermark: "2026-11-12T10:00:00Z", sessions: [session({ version: 2, deleted_at: "2026-11-13T00:00:00Z", deleted_by_name: "Olga", updated_by: "u-olga" })] });
  assert.deepEqual(deleted.notifications.map((item) => item.id), ["notif-gexam-gexam_a1-deleted"]);
});
