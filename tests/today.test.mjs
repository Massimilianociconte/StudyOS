import test from "node:test";
import assert from "node:assert/strict";
import { dayWatcher, localDayKey } from "../src/lib/dates.ts";
import { periodRange, studyTotals } from "../src/lib/studyStats.ts";

test("localDayKey: il giorno del calendario locale", () => {
  assert.equal(localDayKey(new Date(2026, 10, 15, 23, 59, 59)), "2026-11-15");
  assert.equal(localDayKey(new Date(2026, 10, 16, 0, 0)), "2026-11-16");
  assert.equal(localDayKey(new Date(2026, 0, 5, 12)), "2026-01-05");
});

test("dayWatcher: avvisa una volta sola quando cambia il giorno (domenica sera → lunedì)", () => {
  let clock = new Date(2026, 10, 15, 23, 58);
  const days = [];
  const check = dayWatcher(localDayKey(clock), (day) => days.push(day), () => clock);
  check();
  clock = new Date(2026, 10, 15, 23, 59, 30);
  check();
  assert.deepEqual(days, [], "stesso giorno: nessun ridisegno");
  clock = new Date(2026, 10, 16, 0, 0, 20);
  check();
  check();
  clock = new Date(2026, 10, 16, 0, 1);
  check();
  assert.deepEqual(days, ["2026-11-16"]);
  // Il computer è rimasto spento due giorni: un avviso solo, con il giorno nuovo.
  clock = new Date(2026, 10, 18, 9, 0);
  check();
  assert.deepEqual(days, ["2026-11-16", "2026-11-18"]);
});

test("a mezzanotte di domenica la settimana e l'oggi ripartono (i totali da ricalcolare)", () => {
  const sunday = new Date(2026, 10, 15, 23, 59);
  const monday = new Date(2026, 10, 16, 0, 1);
  const sessions = [{ id: "s", status: "completed", actualMinutes: 60, start: new Date(2026, 10, 15, 21).toISOString(), archived: false }];
  assert.deepEqual([studyTotals(sessions, sunday).today, studyTotals(sessions, sunday).week], [60, 60]);
  assert.deepEqual([studyTotals(sessions, monday).today, studyTotals(sessions, monday).week], [0, 0]);
  assert.notEqual(periodRange("week", sunday).start.getTime(), periodRange("week", monday).start.getTime());
});
