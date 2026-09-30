import test from "node:test";
import assert from "node:assert/strict";
import { allDayRange, isAllDayEvent } from "../src/lib/selectors.ts";
import { expandEvents } from "../src/lib/recurrence.ts";
import { buildIcs, parseIcs } from "../src/lib/ics.ts";

const baseEvent = (patch) => ({
  id: "e1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  archived: false,
  tags: [],
  title: "Convegno",
  description: "",
  category: "other",
  color: "#7CF7C8",
  priority: "medium",
  start: new Date(2026, 9, 3, 0, 0).toISOString(),
  end: new Date(2026, 9, 4, 0, 0).toISOString(),
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});

test("isAllDayEvent: vero solo con allDay === true (eventi preesistenti restano timed)", () => {
  assert.equal(isAllDayEvent(baseEvent({ allDay: true })), true);
  assert.equal(isAllDayEvent(baseEvent({ allDay: false })), false);
  const legacy = baseEvent({});
  delete legacy.allDay;
  assert.equal(isAllDayEvent(legacy), false);
});

test("allDayRange: mezzanotte locale -> mezzanotte successiva (fine esclusiva)", () => {
  const { start, end } = allDayRange(new Date(2026, 9, 3, 15, 30));
  const startDate = new Date(start);
  const endDate = new Date(end);
  assert.deepEqual([startDate.getHours(), startDate.getMinutes(), startDate.getSeconds()], [0, 0, 0]);
  assert.equal(startDate.getFullYear(), 2026);
  assert.equal(startDate.getMonth(), 9);
  assert.equal(startDate.getDate(), 3);
  assert.equal(endDate.getTime() - startDate.getTime(), 24 * 60 * 60_000);
  assert.equal(endDate.getDate(), 4);
});

test("expandEvents: le occorrenze conservano allDay e gli all-day ordinano per primi", () => {
  const allDay = baseEvent({ id: "allday", allDay: true });
  const timed = baseEvent({
    id: "timed",
    start: new Date(2026, 9, 3, 9, 0).toISOString(),
    end: new Date(2026, 9, 3, 10, 0).toISOString()
  });
  const found = expandEvents([timed, allDay], new Date(2026, 9, 3), new Date(2026, 9, 4));
  assert.equal(found.length, 2);
  assert.equal(found[0].id, "allday");
  assert.equal(found[0].allDay, true);
  assert.equal(found[1].allDay ?? false, false);
});

test("expandEvents: serie ripetuta all-day preserva il flag su ogni occorrenza", () => {
  const found = expandEvents([baseEvent({ allDay: true, recurrence: "weekly" })], new Date(2026, 9, 3), new Date(2026, 9, 24));
  assert.ok(found.length >= 3);
  for (const occurrence of found) assert.equal(occurrence.allDay, true);
});

test("buildIcs: evento all-day esportato come VALUE=DATE con fine esclusiva", () => {
  const ics = buildIcs({ events: [baseEvent({ allDay: true })], exams: [], tasks: [], subjects: [] });
  assert.match(ics, /DTSTART;VALUE=DATE:20261003/);
  assert.match(ics, /DTEND;VALUE=DATE:20261004/);
});

test("buildIcs: evento con orario invariato (DTSTART con ora, nessun VALUE=DATE)", () => {
  const timed = baseEvent({
    start: new Date(2026, 9, 3, 9, 0).toISOString(),
    end: new Date(2026, 9, 3, 10, 0).toISOString()
  });
  const ics = buildIcs({ events: [timed], exams: [], tasks: [], subjects: [], timeZone: "Europe/Rome" });
  assert.match(ics, /DTSTART[^:\n]*:20261003T090000/);
  assert.doesNotMatch(ics, /VALUE=DATE/);
});

test("parseIcs: VEVENT con VALUE=DATE importato come allDay su mezzanotte locale", () => {
  const { events, warnings } = parseIcs(
    ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:abc123", "DTSTART;VALUE=DATE:20261003", "DTEND;VALUE=DATE:20261004", "SUMMARY:Festa", "END:VEVENT", "END:VCALENDAR"].join("\r\n")
  );
  assert.equal(warnings.length, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].allDay, true);
  const start = new Date(events[0].start);
  assert.deepEqual([start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()], [2026, 9, 3, 0]);
});

test("parseIcs: VEVENT con orario importato come evento timed", () => {
  const { events } = parseIcs(
    ["BEGIN:VCALENDAR", "VERSION:2.0", "BEGIN:VEVENT", "UID:def456", "DTSTART:20261003T090000Z", "DTEND:20261003T100000Z", "SUMMARY:Lezione", "END:VEVENT", "END:VCALENDAR"].join("\r\n")
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].allDay, false);
});
