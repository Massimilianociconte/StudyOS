import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reminderSourceEvents, standaloneReminderEvents, STANDALONE_REMINDER_PREFIX } from "../src/lib/reminderSources.ts";
import { planReminders } from "../src/lib/eventReminders.ts";
import { sessionFromRow } from "../src/lib/groupExams.ts";
import { applyPlanPatch, newExamPlan } from "../src/lib/examPlans.ts";

const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };

test("promemoria autonomi: solo quelli da fare, come eventi di un istante", () => {
  const reminders = [
    { id: "r1", title: "Chiama la segreteria", remindAt: "2026-11-20T09:00:00.000Z", done: false, ...stamp },
    { id: "r2", title: "Fatto", remindAt: "2026-11-20T09:00:00.000Z", done: true, ...stamp },
    { id: "r3", title: "Data rotta", remindAt: "domani", done: false, ...stamp }
  ];
  const events = standaloneReminderEvents(reminders);
  assert.deepEqual(events.map((event) => event.id), [`${STANDALONE_REMINDER_PREFIX}r1`]);
  const plan = planReminders(events, new Date("2026-11-20T08:00:00.000Z"));
  assert.ok(plan.some((item) => item.title === "Chiama la segreteria"));
});

test("sorgenti: eventi personali + appelli scelti + promemoria autonomi", () => {
  const session = sessionFromRow({
    id: "gexam_a1", group_id: "gx", course_key: "nome:genetica", course_id: null, course_name: "Genetica", exam_date: "2027-01-12",
    kind: "appello", label: "", exam_time: null, room: "", notes: "", registration_opens: null, registration_closes: "2027-01-05",
    barb_session_id: null, source: "member", version: 1, created_by: "u", created_by_name: "Bea", updated_by: "u", updated_by_name: "Bea",
    deleted_at: null, deleted_by_name: null, created_at: "", updated_at: ""
  });
  const plan = applyPlanPatch(newExamPlan(session, "Bio", "2026-11-12T10:00:00Z"), { selected: true }, session, "Bio", "2026-11-12T10:00:00Z");
  const own = { id: "e1", title: "Lezione", start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T10:00:00.000Z", allDay: false, recurrence: "none", reminders: [{ minutesBefore: 10 }], ...stamp };
  const all = reminderSourceEvents({ events: [own], examPlans: [plan], reminders: [], groupSessions: [session] });
  assert.deepEqual(all.map((event) => event.id), ["e1", "gexam-reg:gexam_a1"]);
});

test("il watcher pianifica sulle sorgenti, non solo sugli eventi", () => {
  const watcher = readFileSync(new URL("../src/components/calendar/EventReminderWatcher.tsx", import.meta.url), "utf8");
  assert.match(watcher, /reminderSourceEvents\(/);
  assert.match(watcher, /planReminders\(sources, now\)/);
  assert.match(watcher, /missedReminders\(sources, now\)/);
  assert.match(watcher, /\}, \[sources, ready, wake, addNotification\]\);/);
});

test("i promemoria push (app chiusa) usano le stesse sorgenti e seguono appelli e piano", () => {
  const push = readFileSync(new URL("../src/lib/pushReminderSync.ts", import.meta.url), "utf8");
  assert.match(push, /const events = reminderSourceEvents\(\{ events: store\.events, examPlans: store\.examPlans, reminders: store\.reminders,/);
  assert.match(push, /pushReminderRows\(events, now\)/);
  assert.match(push, /state\.examPlans !== previous\.examPlans/);
  assert.match(push, /useGroupExamStore\.subscribe\(/);
});
