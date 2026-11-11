import test from "node:test";
import assert from "node:assert/strict";
import { planDelete, planEdit } from "../src/lib/repeat.ts";

// Serie importata da un file .ics: ogni lunedì alle 10 a Roma, il 16 novembre cambiato nel file
// (RECURRENCE-ID). Una riga con sourceRecurrenceId è del file: la reimportazione la riscrive.
const SERIES = {
  id: "s",
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
  sourceUid: "uid-1"
};
const IMPORTED = {
  ...SERIES,
  id: "s@2026-11-16",
  seriesId: "s",
  originalDate: "2026-11-16",
  recurrence: "none",
  repeat: undefined,
  repeatLegacy: undefined,
  title: "Lezione (aula 2)",
  sourceRecurrenceId: "20261116T090000Z"
};
const NOW = { now: "2026-11-11T12:00:00.000Z" };

test("un giorno importato cambiato a mano diventa dell'utente: la reimportazione non lo riscrive", () => {
  const plan = planEdit(SERIES, [SERIES, IMPORTED], "2026-11-16", "this", { title: "Recupero" }, NOW);
  const row = plan.puts.find((item) => item.id === IMPORTED.id);
  assert.equal(row.title, "Recupero");
  assert.equal("sourceRecurrenceId" in row, false);
  // Il file resta riconoscibile: la serie e la riga tengono sourceUid.
  assert.equal(row.sourceUid, "uid-1");
});

test("un giorno importato eliminato a mano resta eliminato", () => {
  const plan = planDelete([SERIES, IMPORTED], "s", "2026-11-16", "this", NOW);
  const row = plan.puts.find((item) => item.id === IMPORTED.id);
  assert.equal(row.cancelled, true);
  assert.equal("sourceRecurrenceId" in row, false);
});

test("una riga fatta dall'utente non cambia per questo", () => {
  const own = { ...IMPORTED, sourceRecurrenceId: undefined, title: "Mia" };
  delete own.sourceRecurrenceId;
  const plan = planEdit(SERIES, [SERIES, own], "2026-11-16", "this", { title: "Mia 2" }, NOW);
  assert.equal(plan.puts.find((item) => item.id === own.id).title, "Mia 2");
});
