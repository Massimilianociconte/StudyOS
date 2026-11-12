import test from "node:test";
import assert from "node:assert/strict";

const { EXAMS_NEW_KEY, calendarExamEvents, examPrefillFromEvent, isNullableExamPrefill } = await import("../src/lib/calendarExams.ts");

// Date locali del dispositivo: i test valgono in ogni fuso (Roma, New York, UTC, Tokyo).
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (...parts) => local(...parts).toISOString();

/* ------------------------------------------------------------------ */
/* Esami segnati solo nel calendario                                   */
/* ------------------------------------------------------------------ */

const event = (patch) => ({
  id: "e1",
  title: "Esame",
  description: "",
  category: "exam",
  color: "",
  priority: "high",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
  tags: [],
  ...patch
});

test("calendarExamEvents: solo eventi «Esame» da oggi ai prossimi 60 giorni, in ordine", () => {
  const now = local(2026, 11, 12, 15);
  const events = [
    event({ id: "later", start: iso(2026, 12, 20, 9), end: iso(2026, 12, 20, 12) }),
    event({ id: "soon", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12) }),
    event({ id: "today", start: iso(2026, 11, 12, 9), end: iso(2026, 11, 12, 11) }),
    event({ id: "past", start: iso(2026, 11, 10, 9), end: iso(2026, 11, 10, 12) }),
    event({ id: "far", start: iso(2027, 1, 20, 9), end: iso(2027, 1, 20, 12) }),
    event({ id: "lesson", category: "lesson", start: iso(2026, 11, 18, 9), end: iso(2026, 11, 18, 11) }),
    event({ id: "gone", archived: true, start: iso(2026, 11, 19, 9), end: iso(2026, 11, 19, 11) })
  ];
  assert.deepEqual(
    calendarExamEvents(events, now).map((item) => item.id),
    ["today", "soon", "later"]
  );
  // Il sessantesimo giorno è compreso, il sessantunesimo no.
  const edge = [
    event({ id: "d60", start: iso(2027, 1, 11, 9), end: iso(2027, 1, 11, 10) }),
    event({ id: "d61", start: iso(2027, 1, 12, 9), end: iso(2027, 1, 12, 10) })
  ];
  assert.deepEqual(calendarExamEvents(edge, now).map((item) => item.id), ["d60"]);
});

test("calendarExamEvents: un appello di tutto il giorno (data senza fuso) resta nel suo giorno", () => {
  const now = local(2026, 11, 12, 8);
  const appello = event({ id: "barb", allDay: true, start: "2026-11-25T00:00:00", end: "2026-11-26T00:00:00" });
  const [item] = calendarExamEvents([appello], now);
  assert.equal(item?.id, "barb");
});

test("examPrefillFromEvent: materia dell'evento, altrimenti dal titolo; giorno e titolo", () => {
  const all = [
    { id: "chim", name: "Chimica", archived: false, status: "active" },
    { id: "chimorg", name: "Chimica organica", archived: false, status: "active" },
    { id: "old", name: "Fisica", archived: true, status: "archived" }
  ];
  const withSubject = examPrefillFromEvent(event({ title: "Scritto", subjectId: "chim", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12) }), all);
  assert.deepEqual(withSubject, { subjectId: "chim", date: iso(2026, 11, 20, 9), title: "Scritto" });
  // Il nome più lungo vince ("Chimica organica" contiene anche "Chimica").
  const byTitle = examPrefillFromEvent(event({ title: "Appello · CHIMICA ORGANICA", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12) }), all);
  assert.equal(byTitle.subjectId, "chimorg");
  // Materie archiviate non si propongono; materia sparita = nessuna scelta.
  assert.equal(examPrefillFromEvent(event({ title: "Esame di Fisica", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12) }), all).subjectId, "");
  assert.equal(examPrefillFromEvent(event({ title: "Orale", subjectId: "sparita", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12) }), all).subjectId, "");
  // Tutto il giorno: alle 9 del giorno dell'appello, in ora locale.
  const allDay = examPrefillFromEvent(event({ title: "Appello", allDay: true, start: "2026-11-25T00:00:00", end: "2026-11-26T00:00:00" }), all);
  assert.equal(allDay.date, "2026-11-25T09:00");
});

test("exams.new: nome della chiave e validatore", () => {
  assert.equal(EXAMS_NEW_KEY, "exams.new");
  assert.equal(isNullableExamPrefill(null), true);
  assert.equal(isNullableExamPrefill({ subjectId: "", date: "2026-11-25T09:00", title: "Appello" }), true);
  assert.equal(isNullableExamPrefill({ subjectId: "", date: "domani", title: "Appello" }), false);
  assert.equal(isNullableExamPrefill({ subjectId: 3, date: "2026-11-25T09:00", title: "" }), false);
  assert.equal(isNullableExamPrefill("exam-1"), false);
  assert.equal(isNullableExamPrefill(undefined), false);
});
