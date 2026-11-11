import test from "node:test";
import assert from "node:assert/strict";

const reminders = await import("../src/lib/eventReminders.ts");
const { EVENT_REMINDER_TEXT } = await import("../src/lib/labels.ts");

// Date locali del dispositivo: i test valgono in ogni fuso (Roma, New York, UTC).
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (...parts) => local(...parts).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

const event = (patch) => ({
  id: "e1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  archived: false,
  tags: [],
  title: "Lezione",
  description: "",
  category: "lesson",
  color: "",
  priority: "medium",
  start: iso(2026, 11, 12, 10),
  end: iso(2026, 11, 12, 11),
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});

const NOW = local(2026, 11, 12, 9);

test("planReminders: nessun promemoria, nessun piano (uscita rapida)", () => {
  assert.deepEqual(reminders.planReminders([event({}), event({ id: "e2", reminders: [] })], NOW), []);
});

test("planReminders: un promemoria nelle prossime 48 ore, con chiave e istante", () => {
  const plan = reminders.planReminders([event({ reminders: [{ minutesBefore: 15 }] })], NOW);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].at, local(2026, 11, 12, 9, 45).getTime());
  assert.equal(plan[0].startMs, local(2026, 11, 12, 10).getTime());
  assert.equal(plan[0].eventId, "e1");
  assert.equal(plan[0].title, "Lezione");
  assert.equal(plan[0].allDay, false);
  assert.match(plan[0].key, /^e1@2026-11-12#/);
  assert.ok(plan[0].key.endsWith(`@${plan[0].at}`));
});

test("planReminders: oltre 48 ore o già passati da più di mezz'ora restano fuori", () => {
  const far = event({ id: "far", start: iso(2026, 11, 15, 10), end: iso(2026, 11, 15, 11), reminders: [{ minutesBefore: 10 }] });
  const late = event({ id: "late", start: iso(2026, 11, 12, 8, 50), end: iso(2026, 11, 12, 10), reminders: [{ minutesBefore: 40 }] });
  const grace = event({ id: "grace", start: iso(2026, 11, 12, 9, 10), end: iso(2026, 11, 12, 10), reminders: [{ minutesBefore: 20 }] });
  const plan = reminders.planReminders([far, late, grace], NOW);
  assert.deepEqual(
    plan.map((item) => item.eventId),
    ["grace"]
  );
});

test("planReminders: un promemoria di giorni prima entra quando il suo istante è vicino", () => {
  const exam = event({ id: "exam", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12), reminders: [{ daysBefore: 7, at: "18:00" }] });
  const plan = reminders.planReminders([exam], NOW);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].at, local(2026, 11, 13, 18).getTime());
});

test("planReminders: le serie danno un promemoria per occorrenza, chiavi diverse", () => {
  const daily = event({ id: "daily", recurrence: "daily", start: iso(2026, 11, 10, 18), end: iso(2026, 11, 10, 19), reminders: [{ minutesBefore: 30 }] });
  const plan = reminders.planReminders([daily], NOW);
  assert.deepEqual(
    plan.map((item) => item.at),
    [local(2026, 11, 12, 17, 30).getTime(), local(2026, 11, 13, 17, 30).getTime()]
  );
  assert.notEqual(plan[0].key, plan[1].key);
  assert.ok(plan.every((item) => item.eventId === "daily"));
});

test("planReminders: due promemoria dello stesso evento, chiavi diverse, in ordine", () => {
  const plan = reminders.planReminders([event({ reminders: [{ minutesBefore: 5 }, { minutesBefore: 30 }] })], NOW);
  assert.deepEqual(
    plan.map((item) => item.at),
    [local(2026, 11, 12, 9, 30).getTime(), local(2026, 11, 12, 9, 55).getTime()]
  );
  assert.notEqual(plan[0].key, plan[1].key);
});

test("planReminders: saltati, fatti, archiviati, condivisi e già finiti non avvisano", () => {
  const list = [
    event({ id: "done", status: "done", reminders: [{ minutesBefore: 15 }] }),
    event({ id: "skipped", status: "skipped", reminders: [{ minutesBefore: 15 }] }),
    event({ id: "archived", archived: true, reminders: [{ minutesBefore: 15 }] }),
    event({ id: "shared", sharedFrom: { ownerId: "u2" }, reminders: [{ minutesBefore: 15 }] }),
    // Promemoria all'ora scelta dopo la fine dell'evento: l'evento è finito, niente avviso.
    event({ id: "over", start: iso(2026, 11, 12, 7), end: iso(2026, 11, 12, 8), reminders: [{ at: "08:45" }] })
  ];
  assert.deepEqual(reminders.planReminders(list, NOW), []);
});

test("planReminders: tutto il giorno parte dalla mezzanotte del giorno", () => {
  const allDay = event({ id: "day", allDay: true, start: iso(2026, 11, 13), end: iso(2026, 11, 14), reminders: [{ daysBefore: 1, at: "20:00" }] });
  const plan = reminders.planReminders([allDay], NOW);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].at, local(2026, 11, 12, 20).getTime());
  assert.equal(plan[0].allDay, true);
  assert.equal(plan[0].startMs, local(2026, 11, 13).getTime());
});

test("planReminders: un'occorrenza modificata usa i suoi promemoria", () => {
  const series = event({ id: "s", recurrence: "daily", start: iso(2026, 11, 10, 18), end: iso(2026, 11, 10, 19), reminders: [{ minutesBefore: 30 }] });
  const moved = event({
    id: "s@2026-11-12",
    seriesId: "s",
    originalDate: "2026-11-12",
    start: iso(2026, 11, 12, 20),
    end: iso(2026, 11, 12, 21),
    reminders: [{ minutesBefore: 10 }]
  });
  const plan = reminders.planReminders([series, moved], NOW);
  assert.equal(plan[0].at, local(2026, 11, 12, 19, 50).getTime());
  assert.equal(plan[0].eventId, "s");
});

test("parseFired e pruneFired: dati rovinati ignorati, vecchi tolti", () => {
  assert.deepEqual(reminders.parseFired(null), {});
  assert.deepEqual(reminders.parseFired("not json"), {});
  assert.deepEqual(reminders.parseFired("[1,2]"), {});
  assert.deepEqual(reminders.parseFired(JSON.stringify({ a: 5, b: "x", c: -1, d: Number.MAX_SAFE_INTEGER })), { a: 5, d: Number.MAX_SAFE_INTEGER });
  const now = NOW.getTime();
  assert.deepEqual(reminders.pruneFired({ old: now - 8 * 24 * HOUR, fresh: now - HOUR }, now), { fresh: now - HOUR });
});

test("notificationIdOf: stabile e senza caratteri strani", () => {
  const id = reminders.notificationIdOf("e1@2026-11-12#0d15m@1763000000000");
  assert.equal(id, reminders.notificationIdOf("e1@2026-11-12#0d15m@1763000000000"));
  assert.match(id, /^notif-reminder-[A-Za-z0-9_-]+$/);
});

test("reminderWhenText: adesso, tra minuti, iniziato, oggi, domani, giorno", () => {
  const at = (h, min = 0, d = 12) => local(2026, 11, d, h, min).getTime();
  assert.equal(reminders.reminderWhenText(at(9), false, NOW), EVENT_REMINDER_TEXT.now);
  assert.equal(reminders.reminderWhenText(at(9, 15), false, NOW), EVENT_REMINDER_TEXT.inMinutes(15));
  assert.equal(reminders.reminderWhenText(at(8, 50), false, NOW), EVENT_REMINDER_TEXT.started("08:50"));
  assert.equal(reminders.reminderWhenText(at(14, 30), false, NOW), EVENT_REMINDER_TEXT.todayAt("14:30"));
  assert.equal(reminders.reminderWhenText(at(8, 0, 13), false, NOW), EVENT_REMINDER_TEXT.tomorrowAt("08:00"));
  assert.equal(reminders.reminderWhenText(at(8, 0, 14), false, NOW), EVENT_REMINDER_TEXT.dayAt("Sabato 14 novembre", "08:00"));
  assert.equal(reminders.reminderWhenText(local(2026, 11, 12).getTime(), true, NOW), EVENT_REMINDER_TEXT.today);
  assert.equal(reminders.reminderWhenText(local(2026, 11, 13).getTime(), true, NOW), EVENT_REMINDER_TEXT.tomorrow);
  assert.equal(reminders.reminderWhenText(local(2026, 11, 20).getTime(), true, NOW), "Venerdì 20 novembre");
});
