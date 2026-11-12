import test from "node:test";
import assert from "node:assert/strict";
import { examSlotKey, groupExamSlots, slotDifference, slotTwins } from "../src/lib/barbExamSlots.ts";
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

test("Appelli ufficiali: prove diverse nello stesso giorno e ora restano appelli diversi", () => {
  // Inglese B2, 1 dicembre: il test online e il test «tentativi successivi» in aula sono due prove.
  const online = { ...base, id: "online", officialId: "200", type: "Test", time: null, component: "TEST ACCERTAMENTO LINGUA INGLESE", location: "Online", registrationCloses: "2026-11-24" };
  const aula = { ...base, id: "aula", officialId: "201", type: "Test", time: null, component: "TEST TENTATIVI SUCCESSIVI INGLESE LIVELLI B2 E C1", location: "Aula 700", registrationCloses: "2026-11-25" };
  assert.notEqual(examSlotKey(online), examSlotKey(aula));
  const slots = groupExamSlots([online, aula], new Set(), barbExamSourceUid);
  assert.deepEqual(slots.map((slot) => slot.sessions.map((session) => session.id)), [["aula"], ["online"]]);
  // La stessa prova scritta con maiuscole o spazi diversi resta un appello solo.
  const again = { ...online, id: "online-2", officialId: "202", component: "  test accertamento   lingua inglese " };
  assert.equal(examSlotKey(online), examSlotKey(again));
  assert.equal(groupExamSlots([online, again], new Set(), barbExamSourceUid).length, 1);
  // Import: due prove, due eventi; riaprendo, ognuna è «Già nel calendario» solo per sé.
  const all = [online, aula];
  const first = prepareBarbExamImport(all, [course], [subject], [], all);
  assert.equal(first.events.length, 2);
  const afterOnline = groupExamSlots(all, new Set([barbExamSourceUid(online)]), barbExamSourceUid);
  assert.deepEqual(afterOnline.map((slot) => [slot.session.id, slot.imported]), [["aula", false], ["online", true]]);
  const reopened = prepareBarbExamImport(all, [course], [subject], [{ sourceUid: barbExamSourceUid(online) }], all);
  assert.equal(reopened.events.length, 1);
  assert.equal(reopened.events[0].sourceUid, barbExamSourceUid(aula));
  // Righe gemelle (stesso insegnamento, giorno, tipo e ora): ognuna dice prova, aula e chiusura.
  const other = { ...online, id: "dsa", officialId: "203", time: "09:00", component: "SESSIONE DEDICATA" };
  const grouped = groupExamSlots([online, aula, other], new Set(), barbExamSourceUid);
  const twins = slotTwins(grouped[0], grouped);
  assert.deepEqual(twins.map((slot) => slot.session.id), ["aula", "online"]);
  assert.deepEqual(slotDifference(online, twins.map((slot) => slot.session)), { component: online.component, location: "Online", registrationCloses: "2026-11-24", sourceCourseCode: null });
});

test("Iscrizioni dello stesso appello: si distingue solo ciò che cambia", () => {
  // Anatomia, 22 gennaio: due commissioni, stessa aula e chiusura. La commissione è già nel nome.
  const amadeo = { ...a, commission: "AMADEO ALIDA", location: "Aula 107", registrationCloses: "2027-01-20", component: "ORALE" };
  const cappelletti = { ...b, commission: "CAPPELLETTI GRAZIELLA", location: "Aula 107", registrationCloses: "2027-01-20", component: "ORALE" };
  assert.deepEqual(slotDifference(cappelletti, [amadeo, cappelletti]), { component: null, location: null, registrationCloses: null, sourceCourseCode: null });
  // Tutto uguale tranne l'elenco: resta il codice dell'elenco.
  assert.deepEqual(slotDifference(b, [a, b]), { component: null, location: null, registrationCloses: null, sourceCourseCode: "FBG" });
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
