import test from "node:test";
import assert from "node:assert/strict";
import { examSlotKey, groupExamSlots } from "../src/lib/barbExamSlots.ts";
import { prepareBarbExamImport } from "../src/lib/barbExamImport.ts";
import { barbExamSourceUid } from "../src/lib/university/examSessions.ts";

const course = { id: "fisio", name: "Fisiologia", semester: "primo" };
const subject = { id: "s1", name: course.name, universityCourseId: course.id, status: "active", archived: false, color: "#123456" };
const base = {
  courseId: course.id,
  date: "2027-01-18",
  type: "oral",
  time: "09:30",
  location: null,
  notes: null,
  registrationOpens: null,
  registrationCloses: null,
  provenance: { sourceUrl: "https://work.unimi.it/foProssimiEsami/pdf/FBG", retrievedAt: "2026-10-05T10:00:00Z", lastVerifiedAt: "2026-10-05T10:00:00Z" }
};
// Stesso appello pubblicato con due iscrizioni (due corsi di laurea), più un altro appello.
const a = { ...base, id: "a", officialId: "100", sourceCourseCode: "F92" };
const b = { ...base, id: "b", officialId: "101", sourceCourseCode: "FBG" };
const c = { ...base, id: "c", officialId: "102", date: "2027-02-10" };

test("Appelli ufficiali: le iscrizioni dello stesso giorno, tipo e ora sono un appello solo", () => {
  assert.equal(examSlotKey(a), examSlotKey(b));
  assert.notEqual(examSlotKey(a), examSlotKey(c));
  const slots = groupExamSlots([c, b, a], new Set(), barbExamSourceUid);
  assert.equal(slots.length, 2);
  assert.deepEqual(slots[0].sessions.map((session) => session.id), ["a", "b"]);
  assert.equal(slots[0].session.id, "a");
  assert.equal(slots[0].imported, false);
  // Già nel calendario se lo è una qualsiasi delle sue iscrizioni.
  const imported = groupExamSlots([a, b, c], new Set([barbExamSourceUid(b)]), barbExamSourceUid);
  assert.deepEqual(imported.map((slot) => slot.imported), [true, false]);
  // Insegnamenti diversi nello stesso giorno e ora restano appelli diversi.
  assert.equal(groupExamSlots([a, { ...b, courseId: "altro" }], new Set(), barbExamSourceUid).length, 2);
});

test("Import: «Seleziona tutti» con due iscrizioni dello stesso appello aggiunge un evento solo", () => {
  const all = [a, b, c];
  const first = prepareBarbExamImport([a, b, c], [course], [subject], [], all);
  assert.equal(first.events.length, 2);
  assert.equal(first.skipped, 1);
  // Un appello già importato con l'altra iscrizione non si aggiunge di nuovo.
  const again = prepareBarbExamImport([b], [course], [subject], [{ sourceUid: barbExamSourceUid(a) }], all);
  assert.equal(again.events.length, 0);
  assert.equal(again.skipped, 1);
});
