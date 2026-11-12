import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sessionFromRow } from "../src/lib/groupExams.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { applyPlanPatch, newExamPlan, normalizeExamPlan } from "../src/lib/examPlans.ts";
import { planGroupExamNotifications } from "../src/lib/groupExamNotify.ts";
import { groupExamReminderEvents } from "../src/lib/groupExamCalendar.ts";
import { missedReminders, planReminders } from "../src/lib/eventReminders.ts";
import {
  dropUnconfirmedGroupReminders,
  groupExamsConfirmed,
  planNeedsGroupPull,
  reminderSourceEvents,
  standaloneReminderEvents
} from "../src/lib/reminderSources.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const sync = source("src/lib/groupExamSync.ts");
const row = (over = {}) =>
  sessionFromRow({
    id: "gexam_a1", group_id: "gx", course_key: "nome:genetica", course_id: null, course_name: "Genetica",
    exam_date: "2027-02-01", kind: "appello", label: "", exam_time: null, room: "", notes: "",
    registration_opens: null, registration_closes: null, barb_session_id: null, source: "member", version: 1,
    created_by: "u1", created_by_name: "Bea", updated_by: "u1", updated_by_name: "Bea", deleted_at: null, deleted_by_name: null,
    created_at: "2026-11-12T10:00:00Z", updated_at: "2026-11-12T10:00:00Z", ...over
  });
const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };
const groups = [{ id: "gx", name: "Farmaco" }];

test("M1: un pull più vecchio non sostituisce né resuscita una riga più nuova", () => {
  const store = useGroupExamStore.getState();
  store.setSnapshot({ viewerId: "u-me", groups, sessions: [row()], overrides: [] });
  store.applySession(row({ version: 2, deleted_at: "2026-11-12T11:00:00Z", deleted_by_name: "Bea" }));
  store.setSnapshot({ viewerId: "u-me", groups, sessions: [row()], overrides: [] });
  const current = useGroupExamStore.getState().sessions.find((item) => item.id === "gexam_a1");
  assert.equal(current.version, 2);
  assert.ok(current.deletedAt, "la cancellazione non torna viva");
  store.reset();
});

test("M1: un altro account non eredita le righe in memoria", () => {
  const store = useGroupExamStore.getState();
  store.setSnapshot({ viewerId: "u-a", groups, sessions: [row({ version: 5 })], overrides: [] });
  store.setSnapshot({ viewerId: "u-b", groups, sessions: [row()], overrides: [] });
  assert.equal(useGroupExamStore.getState().sessions[0].version, 1);
  store.reset();
});

test("M2: pull, notifiche e scritture sono legati all'account e alla generazione che li ha avviati", () => {
  assert.match(sync, /let generation = 0;/);
  assert.match(sync, /const current = \(owner: number\) => running && owner === generation/);
  assert.match(sync, /const viewer = me;/);
  assert.match(sync, /store\.setSnapshot\(\{ viewerId: viewer,/);
  assert.match(sync, /seenKey\(viewer\)/);
  assert.match(sync, /generation \+= 1;/);
});

test("M3: i gruppi lasciati spariscono subito, prima di ogni pull", () => {
  assert.match(sync, /store\.setGroups\(groups\)/);
  assert.match(sync, /const dropLeftGroups = /);
  const subscribeAt = sync.indexOf("useStudyStore.subscribe(");
  assert.ok(sync.indexOf("dropLeftGroups()", subscribeAt) > subscribeAt, "anche dal cambio di studyGroups");
});

test("M4: la notifica porta l'istante dell'evento (una lettura o eliminazione fatta dopo vince)", () => {
  const session = row({ id: "gexam_n", version: 2, created_by: "u9", updated_by: "u9", updated_by_name: "Carlo", updated_at: "2026-11-12T12:00:00Z", room: "Aula 2" });
  const plan = applyPlanPatch(newExamPlan(row({ id: "gexam_n" }), "Farmaco", "2026-11-12T10:30:00Z"), { selected: true }, undefined, "Farmaco", "2026-11-12T10:30:00Z");
  const result = planGroupExamNotifications({ sessions: [session], plans: [plan], subjects: [], me: "u-me", watermark: "2026-11-12T10:00:00.000Z", today: "2026-11-12" });
  assert.equal(result.notifications.length, 1);
  assert.equal(result.notifications[0].createdAt, "2026-11-12T12:00:00Z");
  const deleted = planGroupExamNotifications({
    sessions: [{ ...session, version: 3, deletedAt: "2026-11-12T13:00:00Z", deletedByName: "Carlo", updatedAt: "2026-11-12T13:00:00Z" }],
    plans: [plan], subjects: [], me: "u-me", watermark: "2026-11-12T10:00:00.000Z", today: "2026-11-12"
  });
  assert.equal(deleted.notifications[0].createdAt, "2026-11-12T13:00:00Z");
});

test("M4/(a)/(c): segno sempre salvato, solo dopo la sync personale, today locale", () => {
  assert.doesNotMatch(sync, /result\.watermark &&/);
  assert.match(sync, /createdAt: item\.createdAt/);
  assert.match(sync, /reminderSyncReady\(/);
  assert.match(sync, /state\.examPlans !== previous\.examPlans/);
  assert.match(sync, /today: localToday\(\)/);
});

test("M5: un piano malformato dal cloud non entra nello store né cade il calcolo dei promemoria", async () => {
  assert.equal(normalizeExamPlan({ id: "plan_bad", sessionId: "x", selected: true, updatedAt: "2026-11-12T10:00:00Z" }), null);
  const clean = normalizeExamPlan({ id: "plan_ok", sessionId: "y", selected: true, updatedAt: "2026-11-12T10:00:00Z", snapshot: { groupId: "gx", courseName: "Genetica", date: "2027-02-01" } });
  assert.ok(Array.isArray(clean.reminders));
  // La pull dal cloud passa da applyRemoteChanges (tocca IndexedDB: cablaggio controllato sul sorgente).
  const store = source("src/store/useStudyStore.ts");
  assert.match(store, /key === "examPlans" && entity\) \{\s*const clean = normalizeExamPlan\(entity\);\s*if \(!clean\) continue;/);
});

test("M5: reminderSourceEvents non lancia con un piano rotto", () => {
  const broken = { id: "p", sessionId: "s", selected: true, status: "planned", remindRegistration: true };
  assert.doesNotThrow(() => reminderSourceEvents({ events: [], examPlans: [broken], reminders: [], groupSessions: [] }));
});

test("M5: notify non ferma il realtime", () => {
  assert.match(sync, /try \{\s*await notify\(\);\s*\} catch \{/);
});

test("M6: finché gli appelli non sono confermati non si pianifica dalla copia salvata", () => {
  const session = row({ registration_closes: "2027-01-05" });
  const plan = applyPlanPatch(newExamPlan(session, "Farmaco", "2026-11-12T10:00:00Z"), { selected: true }, session, "Farmaco", "2026-11-12T10:00:00Z");
  assert.equal(groupExamsConfirmed({ ready: false, available: true, viewerId: null }, "u-me"), false);
  assert.equal(groupExamsConfirmed({ ready: true, available: true, viewerId: "u-altro" }, "u-me"), false);
  assert.equal(groupExamsConfirmed({ ready: true, available: true, viewerId: "u-me" }, "u-me"), true);
  assert.equal(groupExamsConfirmed({ ready: true, available: false, viewerId: null }, "u-me"), true, "senza tabelle si usa la copia");
  assert.equal(planNeedsGroupPull([plan], { ready: false, available: true, viewerId: null }, "u-me"), true);
  assert.equal(planNeedsGroupPull([{ ...plan, selected: false }], { ready: false, available: true, viewerId: null }, "u-me"), false);
  const events = groupExamReminderEvents([], [plan]);
  const missed = [{ key: "a", at: 1, eventId: events[0].id, title: "t", startMs: 2, allDay: true }, { key: "b", at: 1, eventId: "ev_x", title: "t", startMs: 2, allDay: false }];
  assert.deepEqual(dropUnconfirmedGroupReminders(missed, false).map((item) => item.key), ["b"]);
  assert.deepEqual(dropUnconfirmedGroupReminders(missed, true).length, 2);
  const push = source("src/lib/pushReminderSync.ts");
  assert.match(push, /planNeedsGroupPull\(store\.examPlans,/);
  const watcher = source("src/components/calendar/EventReminderWatcher.tsx");
  assert.match(watcher, /dropUnconfirmedGroupReminders\(/);
});

test("M7: un promemoria autonomo scaduto ad app chiusa arriva nella campanella", () => {
  const reminders = [{ id: "r1", title: "Chiama la segreteria", remindAt: "2026-11-20T09:00:00.000Z", done: false, ...stamp }];
  const events = standaloneReminderEvents(reminders);
  const now = new Date("2026-11-20T11:00:00.000Z");
  assert.equal(missedReminders(events, now).length, 1);
  assert.equal(planReminders(events, now).length, 0, "non anche come promemoria vivo: una volta sola");
  assert.equal(missedReminders(events, new Date("2026-11-22T11:00:00.000Z")).length, 0, "oltre le 24 ore no");
  assert.equal(planReminders(events, new Date("2026-11-20T09:05:00.000Z")).length, 1);
});

test("L2: un piano collegato a un mio evento non avvisa due volte", () => {
  const session = row();
  const plan = applyPlanPatch(newExamPlan(session, "Farmaco", "2026-11-12T10:00:00Z"), { selected: true, linkedEventId: "ev_1", reminders: [{ minutesBefore: 60 }] }, session, "Farmaco", "2026-11-12T10:00:00Z");
  const own = { id: "ev_1", title: "Genetica", start: "2027-02-01T00:00:00", end: "2027-02-02T00:00:00", allDay: true, recurrence: "none", reminders: [{ minutesBefore: 60 }], ...stamp };
  assert.equal(groupExamReminderEvents([session], [plan], [own]).filter((event) => event.id === "gexam:gexam_a1").length, 0);
  assert.equal(groupExamReminderEvents([session], [plan], []).filter((event) => event.id === "gexam:gexam_a1").length, 1);
});

test("L1/L3: errori distinti e pagine con cursore", () => {
  assert.match(sync, /GROUP_EXAM_TEXT\.actionFailed/);
  assert.match(sync, /\.gt\("id", last\)/);
  assert.doesNotMatch(sync, /\.range\(/);
});
