import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sessionFromRow } from "../src/lib/groupExams.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";
import { applyPlanPatch, newExamPlan } from "../src/lib/examPlans.ts";
import { reminderSourceEvents } from "../src/lib/reminderSources.ts";
import { plannedReminderWhenText } from "../src/lib/eventReminders.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const row = (over = {}) =>
  sessionFromRow({
    id: "gexam_a1", group_id: "gx", course_key: "nome:genetica", course_id: null, course_name: "Genetica",
    exam_date: "2027-02-01", kind: "appello", label: "", exam_time: null, room: "", notes: "",
    registration_opens: null, registration_closes: "2027-01-25", barb_session_id: null, source: "member", version: 1,
    created_by: "u1", created_by_name: "Bea", updated_by: "u1", updated_by_name: "Bea", deleted_at: null, deleted_by_name: null,
    created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z", ...over
  });
const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };
const groups = [{ id: "gx", name: "Farmaco" }];

test("N1: con gli appelli non confermati restano i promemoria personali e autonomi, non quelli degli appelli", () => {
  const session = row();
  const plan = applyPlanPatch(newExamPlan(session, "Farmaco", "2026-11-12T10:00:00Z"), { selected: true }, session, "Farmaco", "2026-11-12T10:00:00Z");
  const own = { id: "e1", title: "Lezione", start: "2026-11-20T09:00:00.000Z", end: "2026-11-20T10:00:00.000Z", allDay: false, recurrence: "none", reminders: [{ minutesBefore: 10 }], ...stamp };
  const reminders = [{ id: "r1", title: "Chiama", remindAt: "2026-11-20T09:00:00.000Z", done: false, ...stamp }];
  const base = { events: [own], examPlans: [plan], reminders, groupSessions: [] };
  assert.deepEqual(reminderSourceEvents({ ...base, groupConfirmed: false }).map((event) => event.id), ["e1", "reminder:r1"]);
  assert.deepEqual(reminderSourceEvents(base).map((event) => event.id), ["e1", "gexam-reg:gexam_a1", "reminder:r1"]);
  const push = source("src/lib/pushReminderSync.ts");
  assert.doesNotMatch(push, /planNeedsGroupPull\([^)]*\)\) return "waiting"/);
  assert.match(push, /groupConfirmed/);
  assert.match(push, /allDeletes\.filter\(/);
});

test("N2: una riga creata durante un pull non sparisce quando il pull arriva senza di lei", () => {
  const store = useGroupExamStore.getState();
  store.reset();
  store.setSnapshot({ viewerId: "u-me", groups, sessions: [row()], overrides: [] });
  store.beginPull();
  store.applySession(row({ id: "gexam_new", exam_date: "2027-03-01" }));
  store.applySession(row({ id: "gexam_del", version: 2, deleted_at: "2026-11-12T11:00:00Z" }));
  store.setSnapshot({ viewerId: "u-me", groups, sessions: [row()], overrides: [] });
  const ids = useGroupExamStore.getState().sessions.map((item) => item.id);
  assert.ok(ids.includes("gexam_new"), "la riga creata dopo l'inizio del pull resta");
  assert.ok(!ids.includes("gexam_del"), "una cancellazione assente dal pull non torna");
  // Il pull dopo (nuovo giro) senza di lei la toglie davvero: cancellazione vera sul server.
  store.beginPull();
  store.setSnapshot({ viewerId: "u-me", groups, sessions: [row()], overrides: [] });
  assert.ok(!useGroupExamStore.getState().sessions.some((item) => item.id === "gexam_new"));
  store.reset();
  assert.match(source("src/lib/groupExamSync.ts"), /store\.beginPull\(\)/);
});

test("N3: un promemoria autonomo scaduto non dice «iniziato alle»", () => {
  const now = new Date("2026-11-20T11:00:00");
  const item = { key: "k", at: new Date("2026-11-20T09:00:00").getTime(), eventId: "reminder:r1", title: "Chiama", startMs: new Date("2026-11-20T09:00:00").getTime(), allDay: false };
  const text = plannedReminderWhenText(item, now);
  assert.equal(text, "Scaduto alle 09:00");
  const event = { ...item, eventId: "ev_1" };
  assert.equal(plannedReminderWhenText(event, now), "Iniziato alle 09:00");
  assert.match(source("src/components/calendar/EventReminderWatcher.tsx"), /plannedReminderWhenText\(item,/);
});
