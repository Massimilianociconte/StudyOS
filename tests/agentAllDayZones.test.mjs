import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { executeAgentTool } from "../src/agent/execute.ts";
import { daySpanOf } from "../src/lib/calendarRender.ts";
import { allDayDays, allDayTimes, applyRepeatFields, expandEvents, isOccurrenceRow, normalizeRepeat } from "../src/lib/repeat.ts";
import { localMidnight } from "../src/lib/tz.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// L'agente scrive i tutto il giorno come date nel fuso dell'evento, come l'app (vedi allDayZones):
// una serie salvata a Roma, cambiata da un dispositivo in qualunque fuso (TZ di chi esegue; corse con
// TZ=Pacific/Auckland, Pacific/Kiritimati, America/New_York, Asia/Tokyo…), tiene i suoi giorni.
const ROME = "Europe/Rome";
const NOW = "2026-11-11T12:00:00.000Z";

const base = (patch) => ({
  id: "s",
  createdAt: NOW,
  updatedAt: NOW,
  archived: false,
  tags: [],
  title: "Lezione",
  description: "",
  category: "lesson",
  color: "#3B82F6",
  priority: "medium",
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  allDay: true,
  timeZone: ROME,
  ...patch
});
const romeAllDay = (first, last, patch = {}) => base({ ...allDayTimes(first, last, ROME), ...patch });
/** Ogni lunedì da lunedì 2 novembre, tutto il giorno, salvata a Roma. */
const MONDAYS = applyRepeatFields(romeAllDay("2026-11-02", "2026-11-02", { repeat: { freq: "weekly", byWeekday: ["MO"] } }), { repeatChanged: true });

const reset = (events) =>
  useStudyStore.setState({
    loading: false,
    locked: false,
    persistError: null,
    subjects: [],
    tasks: [],
    events,
    exams: [],
    sessions: [],
    topics: [],
    notes: [],
    goals: [],
    attachments: [],
    notifications: [],
    reminders: [],
    preferences: [],
    studyGroups: [],
    groupResources: []
  });

beforeEach(() => reset([MONDAYS]));

const events = () => useStudyStore.getState().events;
const byId = (id) => events().find((item) => item.id === id);
const masters = () => events().filter((item) => !isOccurrenceRow(item));

/** Giorni come li disegna la griglia, con il titolo: "11-16 agent" o "12-08..12-10 Mare". */
const grid = (from = "2026-11-01", to = "2026-12-01") =>
  expandEvents(events(), localMidnight(from), localMidnight(to))
    .map((item) => {
      const span = daySpanOf(item);
      return `${span.startDay === span.endDay ? span.startDay.slice(5) : `${span.startDay.slice(5)}..${span.endDay.slice(5)}`} ${item.title}`;
    })
    .join(" | ");

const update = async (args) => {
  const result = await executeAgentTool("studyos_update_event", args);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result;
};

test("agente, tutto il giorno: «Solo questo» cambia o sposta quel giorno, a Roma, da qualunque fuso", async () => {
  await update({ id: "s", occurrenceDate: "2026-11-16", scope: "this", start: "2026-11-16", title: "agent" });
  assert.equal(grid(), "11-02 Lezione | 11-09 Lezione | 11-16 agent | 11-23 Lezione | 11-30 Lezione");
  assert.deepEqual(allDayDays(byId("s@2026-11-16")), { first: "2026-11-16", last: "2026-11-16" });

  reset([MONDAYS]);
  await update({ id: "s", occurrenceDate: "2026-11-16", scope: "this", start: "2026-11-17", title: "agent" });
  assert.equal(grid(), "11-02 Lezione | 11-09 Lezione | 11-17 agent | 11-23 Lezione | 11-30 Lezione");
});

test("agente, tutto il giorno: «Tutti» resta di lunedì dal 2 novembre; spostata al martedì, la regola segue", async () => {
  await update({ id: "s", occurrenceDate: "2026-11-16", scope: "all", start: "2026-11-16", title: "agent" });
  assert.deepEqual(allDayDays(byId("s")), { first: "2026-11-02", last: "2026-11-02" });
  assert.deepEqual(normalizeRepeat(byId("s")).byWeekday, ["MO"]);
  assert.equal(grid(), "11-02 agent | 11-09 agent | 11-16 agent | 11-23 agent | 11-30 agent");

  reset([MONDAYS]);
  await update({ id: "s", occurrenceDate: "2026-11-16", scope: "all", start: "2026-11-17" });
  assert.deepEqual(allDayDays(byId("s")), { first: "2026-11-03", last: "2026-11-03" });
  assert.deepEqual(normalizeRepeat(byId("s")).byWeekday, ["TU"]);

  // Senza occurrenceDate: tutta la serie, dalla prima data.
  reset([MONDAYS]);
  await update({ id: "s", start: "2026-11-03" });
  assert.deepEqual(allDayDays(byId("s")), { first: "2026-11-03", last: "2026-11-03" });
  assert.deepEqual(normalizeRepeat(byId("s")).byWeekday, ["TU"]);
  assert.equal(grid(), "11-03 Lezione | 11-10 Lezione | 11-17 Lezione | 11-24 Lezione");
});

test("agente, tutto il giorno: «Questo e i successivi» al martedì: la parte nuova parte martedì 17, prima restano i lunedì", async () => {
  await update({ id: "s", occurrenceDate: "2026-11-16", scope: "following", start: "2026-11-17", title: "agent" });
  const part = masters().find((item) => item.splitFrom === "s");
  assert.ok(part, "la serie si divide");
  assert.deepEqual(allDayDays(part), { first: "2026-11-17", last: "2026-11-17" });
  assert.deepEqual(normalizeRepeat(part).byWeekday, ["TU"]);
  assert.equal(grid(), "11-02 Lezione | 11-09 Lezione | 11-17 agent | 11-24 agent");
});

test("agente, tutto il giorno: «Questo e i successivi» con una regola nuova senza il lunedì: riprende martedì 17 e il 16 sparisce (e si dice)", async () => {
  const result = await update({ id: "s", occurrenceDate: "2026-11-16", scope: "following", repeat: { freq: "weekly", byWeekday: ["TU", "TH"] } });
  const part = masters().find((item) => item.splitFrom === "s");
  assert.deepEqual(allDayDays(part), { first: "2026-11-17", last: "2026-11-17" });
  assert.equal(result.data.seriesStart, part.start);
  assert.deepEqual(result.data.removedDates, ["2026-11-16"]);
  assert.equal(grid(), "11-02 Lezione | 11-09 Lezione | 11-17 Lezione | 11-19 Lezione | 11-24 Lezione | 11-26 Lezione");
});

test("agente, tutto il giorno: un evento singolo (e una vacanza di tre giorni) spostato tiene i suoi giorni a Roma", async () => {
  reset([romeAllDay("2026-12-08", "2026-12-08", { id: "e" }), romeAllDay("2026-12-08", "2026-12-10", { id: "v", title: "Mare", category: "vacation" })]);
  await update({ id: "e", start: "2026-12-09" });
  assert.deepEqual(allDayDays(byId("e")), { first: "2026-12-09", last: "2026-12-09" });
  await update({ id: "v", start: "2026-12-09" });
  assert.deepEqual(allDayDays(byId("v")), { first: "2026-12-09", last: "2026-12-11" });
  await update({ id: "v", end: "2026-12-12" });
  assert.deepEqual(allDayDays(byId("v")), { first: "2026-12-09", last: "2026-12-12" });
  // Un istante con offset vale il suo giorno nel fuso dell'evento (mezzanotte di Roma = quel giorno).
  await update({ id: "e", start: "2026-12-14T00:00:00+01:00" });
  assert.deepEqual(allDayDays(byId("e")), { first: "2026-12-14", last: "2026-12-14" });
  assert.equal(grid("2026-12-01", "2026-12-31"), "12-09..12-12 Mare | 12-14 Lezione");
});
