import test from "node:test";
import assert from "node:assert/strict";
import { sessionFromRow } from "../src/lib/groupExams.ts";
import { applyPlanPatch, examPlanId, isEmptyPlan, newExamPlan, normalizeExamPlan } from "../src/lib/examPlans.ts";
import { groupExamEvents, groupExamReminderEvents, localDay, personalMatches, sessionIdOfEventId } from "../src/lib/groupExamCalendar.ts";

const NOW = "2026-11-12T10:00:00.000Z";
const session = (over = {}) =>
  sessionFromRow({
    id: "gexam_a1", group_id: "gx", course_key: "barb:farm-spec", course_id: "farm-spec", course_name: "Farmacologia Speciale",
    exam_date: "2027-01-12", kind: "preappello", label: "", exam_time: "09:30", room: "Aula C03", notes: "",
    registration_opens: null, registration_closes: "2027-01-05", barb_session_id: null, source: "member", version: 1,
    created_by: "u-bea", created_by_name: "Bea", updated_by: "u-bea", updated_by_name: "Bea", deleted_at: null,
    deleted_by_name: null, created_at: NOW, updated_at: NOW, ...over
  });
const subject = (over = {}) => ({ id: "sub_farm", name: "Farmacologia speciale", universityCourseId: undefined, color: "#e11d48", archived: false, status: "active", ...over });
const groupNames = new Map([["gx", "Farmaco"]]);
const chosen = (over = {}) => applyPlanPatch(newExamPlan(session(), "Farmaco", NOW), { selected: true, ...over }, session(), "Farmaco", NOW);

test("piano: id deterministico, copia aggiornata quando si sceglie o si conferma", () => {
  const plan = newExamPlan(session(), "Farmaco", NOW);
  assert.equal(plan.id, examPlanId("gexam_a1"));
  assert.equal(plan.id, "plan_gexam_a1");
  assert.equal(plan.selected, false);
  assert.ok(isEmptyPlan(plan));
  const picked = applyPlanPatch(plan, { selected: true }, session({ version: 2, room: "Aula G24" }), "Farmaco", NOW);
  assert.equal(picked.snapshot.version, 2);
  assert.equal(picked.snapshot.room, "Aula G24");
  const noted = applyPlanPatch(picked, { notes: "portare la calcolatrice" }, session({ version: 3, exam_date: "2027-01-14" }), "Farmaco", NOW);
  assert.equal(noted.snapshot.version, 2, "senza conferma la copia resta quella di quando l'ho scelto");
  const seen = applyPlanPatch(noted, { acknowledge: true }, session({ version: 3, exam_date: "2027-01-14" }), "Farmaco", NOW);
  assert.equal(seen.snapshot.date, "2027-01-14");
  const unlinked = applyPlanPatch({ ...seen, subjectId: "s1" }, { subjectId: null, dismissMatch: "event:e1" }, undefined, "Farmaco", NOW);
  assert.equal(unlinked.subjectId, undefined);
  assert.deepEqual(unlinked.dismissedMatches, ["event:e1"]);
  assert.equal(applyPlanPatch(seen, { status: "boh" }, undefined, "Farmaco", NOW).status, "planned");
});

test("piano dal cloud: campi mancanti con i default, forma sbagliata scartata", () => {
  const plan = normalizeExamPlan({ id: "plan_x", sessionId: "x", snapshot: { date: "2027-01-12" } });
  assert.equal(plan.selected, false);
  assert.equal(plan.remindRegistration, true);
  assert.deepEqual(plan.reminders, []);
  assert.equal(normalizeExamPlan({ id: "plan_x" }), null);
});

test("calendario: tutti gli appelli, solo le mie materie, o solo quelli scelti", () => {
  const other = session({ id: "gexam_b1", course_key: "nome:genetica", course_id: null, course_name: "Genetica" });
  const base = { sessions: [session(), other], plans: [], groupNames, subjects: [subject()], events: [] };
  assert.deepEqual(groupExamEvents({ ...base, mode: "all" }).map((event) => event.id), ["gexam:gexam_a1", "gexam:gexam_b1"]);
  assert.deepEqual(groupExamEvents({ ...base, mode: "subjects" }).map((event) => event.id), ["gexam:gexam_a1"]);
  assert.deepEqual(groupExamEvents({ ...base, mode: "off" }), []);
  const withPlan = groupExamEvents({ ...base, plans: [{ ...chosen(), sessionId: "gexam_b1", id: "plan_gexam_b1" }], mode: "off" });
  assert.deepEqual(withPlan.map((event) => event.id), ["gexam:gexam_b1"]);
  const [event] = groupExamEvents({ ...base, mode: "subjects" });
  assert.equal(event.allDay, true);
  assert.equal(event.start, "2027-01-12T00:00:00");
  assert.equal(event.end, "2027-01-13T00:00:00");
  assert.equal(event.subjectId, "sub_farm");
  assert.equal(event.title, "Preappello · Farmacologia Speciale");
  assert.equal(event.groupExam.groupName, "Farmaco");
  assert.equal(sessionIdOfEventId(event.id), "gexam_a1");
  assert.equal(sessionIdOfEventId("event_123"), null);
});

test("calendario: eliminato solo se scelto, collegato a un mio evento non si ripete, offline dalla copia", () => {
  const deleted = session({ deleted_at: NOW, version: 2 });
  assert.deepEqual(groupExamEvents({ sessions: [deleted], plans: [], groupNames, subjects: [], events: [], mode: "all" }), []);
  const [shown] = groupExamEvents({ sessions: [deleted], plans: [chosen()], groupNames, subjects: [], events: [], mode: "all" });
  assert.equal(shown.groupExam.deleted, true);
  const linked = chosen({ linkedEventId: "event_mio" });
  assert.deepEqual(groupExamEvents({ sessions: [session()], plans: [linked], groupNames, subjects: [], events: [{ id: "event_mio" }], mode: "all" }), []);
  const [offline] = groupExamEvents({ sessions: [], plans: [chosen()], groupNames: new Map(), subjects: [], events: [], mode: "all" });
  assert.equal(offline.groupExam.stale, true);
  assert.equal(offline.groupExam.groupName, "Farmaco");
  assert.equal(offline.start, "2027-01-12T00:00:00");
});

test("promemoria: appello scelto e chiusura iscrizioni finché non sono iscritto", () => {
  const plan = chosen({ reminders: [{ daysBefore: 1, at: "18:00" }] });
  const events = groupExamReminderEvents([session()], [plan]);
  assert.deepEqual(events.map((event) => event.id), ["gexam:gexam_a1", "gexam-reg:gexam_a1"]);
  assert.equal(events[1].start, "2027-01-05T00:00:00");
  assert.equal(events[1].title, "Chiusura iscrizioni · Preappello · Farmacologia Speciale");
  const registered = applyPlanPatch(plan, { status: "registered" }, undefined, "Farmaco", NOW);
  assert.deepEqual(groupExamReminderEvents([session()], [registered]).map((event) => event.id), ["gexam:gexam_a1"]);
  assert.deepEqual(groupExamReminderEvents([session({ deleted_at: NOW })], [plan]), []);
  assert.deepEqual(groupExamReminderEvents([session()], [{ ...plan, selected: false }]), []);
});

test("doppioni personali: stesso corso e giorno, mai uniti da soli", () => {
  const myEvent = { id: "e1", title: "Appello · Farmacologia Speciale", category: "exam", start: "2027-01-12T00:00:00", end: "2027-01-13T00:00:00", allDay: true, recurrence: "none", archived: false, subjectId: "sub_farm" };
  const myExam = { id: "x1", subjectId: "sub_farm", date: "2027-01-12T08:00:00.000Z", archived: false };
  const otherDay = { ...myEvent, id: "e2", start: "2027-01-13T00:00:00" };
  const data = { events: [myEvent, otherDay], exams: [myExam], subjects: [subject()] };
  assert.deepEqual(personalMatches(session(), data).map((match) => match.key), ["event:e1", "exam:x1"]);
  const plan = applyPlanPatch(chosen({ linkedEventId: "e1" }), { dismissMatch: "exam:x1" }, undefined, "Farmaco", NOW);
  assert.deepEqual(personalMatches(session(), data, plan), []);
  assert.equal(localDay("2027-01-12T00:00:00"), "2027-01-12");
});
