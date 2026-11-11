import test from "node:test";
import assert from "node:assert/strict";
import { findOccurrence, occurrenceTarget } from "../src/lib/occurrenceLookup.ts";

const base = (patch = {}) => ({
  id: "s1",
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  archived: false,
  tags: [],
  title: "Lezione",
  description: "",
  category: "lesson",
  color: "#3B82F6",
  priority: "medium",
  start: "2026-11-02T09:00:00.000Z",
  end: "2026-11-02T10:00:00.000Z",
  recurrence: "weekly",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  timeZone: "Europe/Rome",
  repeat: { freq: "weekly" },
  repeatLegacy: "weekly|",
  ...patch
});

test("ritrova l'occorrenza di una serie in un giorno, o la riga modificata di quel giorno", () => {
  const series = base();
  const row = {
    ...base(),
    id: "s1@2026-11-16",
    seriesId: "s1",
    originalDate: "2026-11-16",
    recurrence: "none",
    repeat: undefined,
    repeatLegacy: undefined,
    title: "Spostata",
    start: "2026-11-16T14:00:00.000Z",
    end: "2026-11-16T15:00:00.000Z"
  };
  const events = [series, row];
  const found = findOccurrence(events, "s1", "2026-11-09");
  assert.equal(found.id, "s1");
  assert.equal(found.occurrenceDate, "2026-11-09");
  assert.equal(found.start, "2026-11-09T09:00:00.000Z");
  // Il giorno con la riga: si apre la riga (anche cercando l'id della serie).
  assert.equal(findOccurrence(events, "s1", "2026-11-16").id, "s1@2026-11-16");
  assert.equal(findOccurrence(events, "s1@2026-11-16", "2026-11-16").title, "Spostata");
  // Un giorno che non è un'occorrenza: niente.
  assert.equal(findOccurrence(events, "s1", "2026-11-10"), null);
  assert.equal(findOccurrence(events, "s1", "nope"), null);
  assert.equal(findOccurrence(events, "missing", "2026-11-09"), null);
});

test("serie e giorno da passare allo store", () => {
  assert.deepEqual(occurrenceTarget({ id: "s1", occurrenceDate: "2026-11-09" }), { seriesId: "s1", date: "2026-11-09", row: false });
  assert.deepEqual(occurrenceTarget({ id: "s1@2026-11-16", seriesId: "s1", originalDate: "2026-11-16", occurrenceDate: "2026-11-16" }), {
    seriesId: "s1",
    date: "2026-11-16",
    row: true
  });
});
