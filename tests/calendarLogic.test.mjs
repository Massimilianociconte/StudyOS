import test from "node:test";
import assert from "node:assert/strict";
import { expandEvents } from "../src/lib/recurrence.ts";
import { studyStreak } from "../src/lib/selectors.ts";
import { attachmentKind, formatHours, formatMinutes } from "../src/lib/labels.ts";

const event = (patch) => ({
  id: "e1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  archived: false,
  tags: [],
  title: "Lezione",
  description: "",
  category: "lesson",
  color: "#7CF7C8",
  priority: "medium",
  start: new Date(2026, 8, 28, 9, 0).toISOString(),
  end: new Date(2026, 8, 28, 11, 0).toISOString(),
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});

test("evento singolo: incluso solo se si sovrappone all'intervallo", () => {
  const items = [event({})];
  assert.equal(expandEvents(items, new Date(2026, 8, 28), new Date(2026, 8, 29)).length, 1);
  assert.equal(expandEvents(items, new Date(2026, 8, 29), new Date(2026, 9, 5)).length, 0);
});

test("ricorrenza settimanale: stessa ora locale ogni settimana, durata preservata", () => {
  const items = [event({ recurrence: "weekly" })];
  const found = expandEvents(items, new Date(2026, 9, 5), new Date(2026, 9, 26));
  assert.equal(found.length, 3);
  for (const occurrence of found) {
    const start = new Date(occurrence.start);
    assert.equal(start.getDay(), 1); // lunedì
    assert.equal(start.getHours(), 9); // anche dopo il cambio dell'ora di fine ottobre
    assert.equal(new Date(occurrence.end).getTime() - start.getTime(), 2 * 60 * 60_000);
    assert.equal(occurrence.recurring, true);
  }
  assert.equal(new Set(found.map((item) => item.occurrenceKey)).size, 3);
});

test("ricorrenza: rispetta la data di fine e non genera occorrenze prima dell'inizio", () => {
  const items = [event({ recurrence: "weekly", recurrenceUntil: "2026-10-12" })];
  const found = expandEvents(items, new Date(2026, 8, 1), new Date(2026, 11, 31));
  assert.deepEqual(
    found.map((item) => new Date(item.start).getDate()),
    [28, 5, 12]
  );
});

test("ricorrenza giornaliera e mensile", () => {
  const daily = expandEvents([event({ recurrence: "daily" })], new Date(2026, 9, 1), new Date(2026, 9, 4));
  assert.equal(daily.length, 3);
  const monthly = expandEvents([event({ recurrence: "monthly" })], new Date(2026, 8, 1), new Date(2027, 0, 1));
  assert.deepEqual(
    monthly.map((item) => new Date(item.start).getMonth()),
    [8, 9, 10, 11]
  );
});

test("eventi archiviati o con data non valida vengono ignorati", () => {
  const items = [event({ archived: true }), event({ id: "bad", start: "non-una-data" })];
  assert.equal(expandEvents(items, new Date(2026, 0, 1), new Date(2027, 0, 1)).length, 0);
});

const session = (daysAgo, now) => {
  const start = new Date(now);
  start.setDate(start.getDate() - daysAgo);
  start.setHours(15, 0, 0, 0);
  return { start: start.toISOString(), status: "completed", actualMinutes: 30 };
};

test("streak: resta vivo se oggi non si è ancora studiato", () => {
  const now = new Date(2026, 8, 29, 8, 0);
  const sessions = [1, 2, 3].map((days) => session(days, now));
  assert.equal(studyStreak(sessions, now), 3);
  assert.equal(studyStreak([...sessions, session(0, now)], now), 4);
  assert.equal(studyStreak([session(2, now), session(3, now)], now), 0);
});

test("formattazione italiana di durate e ore", () => {
  assert.equal(formatMinutes(45), "45 min");
  assert.equal(formatMinutes(120), "2 h");
  assert.equal(formatMinutes(835), "13 h 55 min");
  assert.equal(formatHours(50), "0,8");
});

test("tipo di allegato riconosciuto da mime, nome e URL", () => {
  assert.equal(attachmentKind({ mimeType: "application/pdf", name: "x" }), "pdf");
  assert.equal(attachmentKind({ mimeType: "text/uri-list", name: "Video", externalUrl: "https://youtu.be/abc" }), "video");
  assert.equal(attachmentKind({ mimeType: "text/uri-list", name: "Sito", externalUrl: "https://example.com" }), "link");
  assert.equal(attachmentKind({ mimeType: "image/png", name: "a.png" }), "image");
});
