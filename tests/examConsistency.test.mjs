import test from "node:test";
import assert from "node:assert/strict";
import { sessionFromRow, overrideFromRow } from "../src/lib/groupExams.ts";
import { applyPlanPatch, newExamPlan } from "../src/lib/examPlans.ts";
import { checkConsistency } from "../src/lib/examConsistency.ts";

const NOW = new Date("2027-01-03T10:00:00.000Z");
const session = (over = {}) =>
  sessionFromRow({
    id: "gexam_a1", group_id: "gx", course_key: "barb:farm-spec", course_id: "farm-spec", course_name: "Farmacologia Speciale",
    exam_date: "2027-01-12", kind: "preappello", label: "", exam_time: null, room: "Aula C03", notes: "",
    registration_opens: null, registration_closes: "2027-01-05", barb_session_id: null, source: "member", version: 1,
    created_by: "u", created_by_name: "Bea", updated_by: "u", updated_by_name: "Bea", deleted_at: null, deleted_by_name: null,
    created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z", ...over
  });
const plan = (s, patch = {}) => applyPlanPatch(newExamPlan(s, "Farmaco", "2026-11-12T10:00:00Z"), { selected: true, ...patch }, s, "Farmaco", "2026-11-12T10:00:00Z");
const base = (over = {}) => ({
  now: NOW,
  subjects: [{ id: "sub_farm", name: "Farmacologia Speciale", archived: false }],
  exams: [],
  events: [],
  plans: [],
  links: { reminder: [], note: [], attachment: [] },
  linkTargets: { subject: new Set(["sub_farm"]), exam: new Set(), calendarEvent: new Set() },
  groupExams: { ready: true, groupIds: ["gx"], groupNames: new Map([["gx", "Farmaco"], ["gy", "Bio"]]), sessions: [], overrides: [] },
  catalog: null,
  ...over
});
const codes = (report) => report.issues.map((issue) => issue.code);
const withGroup = (sessions, extra = {}) => base({ ...extra, groupExams: { ...base().groupExams, sessions } });

test("tutto in ordine: nessun problema", () => {
  const report = checkConsistency(base());
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.counts, { error: 0, warning: 0, info: 0 });
  assert.equal(report.groupExamsChecked, true);
});

test("doppioni nel gruppo: certo, probabile, in un altro gruppo", () => {
  const twin = session({ id: "gexam_a2", course_key: "nome:farmacologia speciale", course_id: null, created_at: "2026-11-13T10:00:00Z" });
  const near = session({ id: "gexam_a3", exam_date: "2027-01-13", created_at: "2026-11-14T10:00:00Z" });
  const other = session({ id: "gexam_g1", group_id: "gy", created_at: "2026-11-15T10:00:00Z" });
  const report = checkConsistency(withGroup([session(), twin, near, other]));
  const dup = report.issues.find((issue) => issue.code === "duplicate_session");
  assert.equal(dup.severity, "error");
  assert.deepEqual(dup.refs, { keep: "gexam_a1", remove: "gexam_a2" });
  assert.deepEqual(dup.fix, { tool: "studyos_delete_group_exam_session", args: { id: "gexam_a2", expectedVersion: 1, confirm: true }, needsConfirmation: true });
  assert.ok(codes(report).includes("possible_duplicate"));
  assert.ok(codes(report).includes("same_session_other_group"));
  assert.equal(report.issues[0].code, "duplicate_session", "gli errori vengono prima");
});

test("scelto ma eliminato, cambiato, non più raggiungibile", () => {
  const live = session({ version: 3, exam_date: "2027-01-14" });
  const chosenEarlier = plan(session());
  let report = checkConsistency(withGroup([live], { plans: [chosenEarlier] }));
  const changed = report.issues.find((issue) => issue.code === "selected_changed");
  assert.match(changed.detail, /Data: 12\/01\/2027 → 14\/01\/2027/);
  assert.deepEqual(changed.fix.args, { sessionId: "gexam_a1", acknowledgeChanges: true });
  report = checkConsistency(withGroup([session({ deleted_at: "2027-01-01T00:00:00Z", deleted_by_name: "Olga", version: 2 })], { plans: [chosenEarlier] }));
  assert.deepEqual(codes(report), ["selected_deleted"]);
  assert.match(report.issues[0].detail, /Olga/);
  report = checkConsistency(withGroup([], { plans: [chosenEarlier] }));
  assert.deepEqual(codes(report), ["orphan_plan"]);
  report = checkConsistency(base({ plans: [chosenEarlier], groupExams: { ...base().groupExams, ready: false } }));
  assert.deepEqual(codes(report), [], "senza appelli letti non si dice che manca");
  assert.equal(report.groupExamsChecked, false);
});

test("iscrizioni in chiusura, già superato, due scelti", () => {
  const s = session();
  let report = checkConsistency(withGroup([s], { plans: [plan(s)] }));
  assert.deepEqual(codes(report), ["registration_closing"]);
  report = checkConsistency(withGroup([s], { plans: [plan(s, { status: "registered" })] }));
  assert.deepEqual(codes(report), []);
  const passed = { id: "x0", subjectId: "sub_farm", date: "2026-06-10T08:00:00Z", grade: 28, archived: false };
  report = checkConsistency(withGroup([s], { plans: [plan(s, { status: "registered" })], exams: [passed] }));
  assert.ok(codes(report).includes("passed_but_selected_future"));
  const oral = session({ id: "gexam_o1", kind: "orale", exam_date: "2027-01-20", registration_closes: null });
  report = checkConsistency(withGroup([s, oral], { plans: [plan(s, { status: "registered" }), plan(oral)] }));
  assert.ok(codes(report).includes("two_selected_same_course"));
});

test("collegamenti rotti e doppioni personali", () => {
  const s = session({ registration_closes: null });
  const myEvent = { id: "e1", title: "Appello · Farmacologia Speciale", category: "exam", start: "2027-01-12T00:00:00", end: "2027-01-13T00:00:00", allDay: true, recurrence: "none", archived: false, subjectId: "sub_farm" };
  let report = checkConsistency(withGroup([s], { events: [myEvent] }));
  const match = report.issues.find((issue) => issue.code === "unlinked_personal_duplicate");
  assert.deepEqual(match.fix.args, { sessionId: "gexam_a1", chosen: true, linkedEventId: "e1" });
  report = checkConsistency(withGroup([s], { plans: [plan(s, { linkedEventId: "gone", examId: "gone", subjectId: "gone" })] }));
  assert.deepEqual(codes(report).sort(), ["linked_event_missing", "orphan_plan_exam", "orphan_plan_subject"]);
  const moved = { ...myEvent, start: "2027-01-13T00:00:00", end: "2027-01-14T00:00:00" };
  report = checkConsistency(withGroup([s], { events: [moved], plans: [plan(s, { linkedEventId: "e1" })] }));
  assert.deepEqual(codes(report), ["linked_event_mismatch"]);
  report = checkConsistency(base({ exams: [{ id: "x9", subjectId: "nope", date: "2027-02-01T08:00:00Z", archived: false }], links: { reminder: [{ id: "r1", linkedEntityType: "exam", linkedEntityId: "x404" }], note: [], attachment: [] } }));
  assert.deepEqual(codes(report).sort(), ["orphan_exam_subject", "orphan_link"]);
});

test("correzioni per elementi spariti dal catalogo; id stabili", () => {
  const override = overrideFromRow({ id: "gover_1", group_id: "gx", target_kind: "teacher", target_id: "unimi-ex-docente", target_label: "Ex docente", fields: { office: "Studio 3" }, version: 2, created_by: "u", created_by_name: "Bea", updated_by: "u", updated_by_name: "Bea", deleted_at: null, deleted_by_name: null, created_at: "", updated_at: "" });
  const catalog = { teacher: new Set(["unimi-mario-rossi"]), course: new Set(), schedule_rule: new Set(), contact: new Set() };
  const input = base({ catalog, groupExams: { ...base().groupExams, overrides: [override] } });
  const first = checkConsistency(input);
  assert.deepEqual(codes(first), ["override_target_missing"]);
  assert.equal(first.issues[0].fix.needsConfirmation, true);
  assert.deepEqual(checkConsistency(input).issues.map((issue) => issue.id), first.issues.map((issue) => issue.id));
});
