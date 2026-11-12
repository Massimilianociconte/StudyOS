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

const LATER = "2026-11-13T09:00:00Z";
const planOf = () => applyPlanPatch(newExamPlan(session(), "Farmaco", "2026-11-12T10:00:00Z"), { selected: true }, session(), "Farmaco", "2026-11-12T10:00:00Z");

test("appello scelto: cambiato o eliminato da altri", () => {
  const plan = planOf();
  const changed = planGroupExamNotifications({ ...base, plans: [plan], watermark: "2026-11-12T10:00:00Z", sessions: [session({ version: 2, exam_date: "2027-01-14", updated_at: LATER, updated_by: "u-ada", updated_by_name: "Ada" })] });
  assert.deepEqual(changed.notifications.map((item) => [item.id, item.body]), [["notif-gexam-gexam_a1-v2", "Preappello · Farmacologia Speciale: Data: 12/01/2027 → 14/01/2027 · da Ada"]]);
  const notes = planGroupExamNotifications({ ...base, plans: [plan], watermark: "2026-11-12T10:00:00Z", sessions: [session({ version: 2, notes: "porta il libretto", updated_at: LATER, updated_by: "u-ada" })] });
  assert.deepEqual(notes.notifications, [], "solo data, tipo, ora, aula e iscrizioni avvisano");
  const deleted = planGroupExamNotifications({ ...base, plans: [plan], watermark: "2026-11-12T10:00:00Z", sessions: [session({ version: 2, updated_at: LATER, deleted_at: "2026-11-13T00:00:00Z", deleted_by_name: "Olga", updated_by: "u-olga" })] });
  assert.deepEqual(deleted.notifications.map((item) => item.id), ["notif-gexam-gexam_a1-deleted"]);
});

test("una notifica tolta dalla persona non torna al ciclo dopo (M1)", () => {
  const plan = planOf();
  const sessions = [session({ version: 2, exam_date: "2027-01-14", updated_at: LATER, updated_by: "u-ada", updated_by_name: "Ada" })];
  const first = planGroupExamNotifications({ ...base, plans: [plan], watermark: "2026-11-12T10:00:00Z", sessions });
  assert.equal(first.notifications.length, 1);
  assert.equal(first.watermark, LATER, "il segno avanza fino all'ultima modifica vista");
  const again = planGroupExamNotifications({ ...base, plans: [plan], watermark: first.watermark, sessions });
  assert.deepEqual(again.notifications, [], "stessa riga, stesso segno: niente di nuovo");
  const gone = [session({ version: 3, updated_at: "2026-11-14T00:00:00Z", deleted_at: "2026-11-14T00:00:00Z", deleted_by_name: "Olga", updated_by: "u-olga" })];
  const deleted = planGroupExamNotifications({ ...base, plans: [plan], watermark: first.watermark, sessions: gone });
  assert.equal(deleted.notifications.length, 1);
  assert.deepEqual(planGroupExamNotifications({ ...base, plans: [plan], watermark: deleted.watermark, sessions: gone }).notifications, []);
});

test("segni con formati di data diversi si confrontano come istanti", () => {
  const plan = planOf();
  const result = planGroupExamNotifications({ ...base, plans: [plan], watermark: "2026-11-13T09:00:00.000Z", sessions: [session({ version: 2, exam_date: "2027-01-14", updated_at: "2026-11-13T10:00:00+01:00", updated_by: "u-ada" })] });
  assert.deepEqual(result.notifications, [], "10:00+01:00 è le 09:00Z: non è più nuovo del segno");
});

test("gruppo vuoto al primo avvio: il segno esiste e il primo appello aggiunto avvisa (M2)", () => {
  const first = planGroupExamNotifications({ ...base, sessions: [], watermark: undefined });
  assert.ok(first.watermark, "il segno non è vuoto");
  const next = planGroupExamNotifications({ ...base, sessions: [session()], watermark: first.watermark });
  assert.deepEqual(next.notifications.map((item) => item.id), ["notif-gexam-new-gexam_a1"]);
});
