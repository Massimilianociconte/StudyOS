import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SUBJECT_SORT,
  EXAM_DATE_LATER,
  SUBJECT_SORTS,
  mergeSubsetOrder,
  moveInList,
  sortSubjects,
  validSubjectOrder,
  validSubjectSort
} from "../src/lib/subjectSort.ts";

const subjects = [
  { id: "a", name: "Storia dell'arte", cfu: 6 },
  { id: "b", name: "analisi 2", cfu: 9 },
  { id: "c", name: "Analisi 10", cfu: 12 },
  { id: "d", name: "Zoologia", cfu: 6 },
  { id: "e", name: "Èstetica", cfu: 3 }
];
const ids = (list) => list.map((subject) => subject.id);

test("validSubjectSort accetta solo i criteri noti", () => {
  for (const mode of SUBJECT_SORTS) assert.equal(validSubjectSort(mode), mode);
  assert.equal(validSubjectSort("random"), DEFAULT_SUBJECT_SORT);
  assert.equal(validSubjectSort(undefined), DEFAULT_SUBJECT_SORT);
  assert.equal(validSubjectSort(42), DEFAULT_SUBJECT_SORT);
});

test("validSubjectOrder tiene solo id testuali senza ripetizioni", () => {
  assert.deepEqual(validSubjectOrder(["a", "b", "a", 3, "", null, "x".repeat(121), "c"]), ["a", "b", "c"]);
  assert.deepEqual(validSubjectOrder("a,b"), []);
  assert.equal(validSubjectOrder(Array.from({ length: 700 }, (_, index) => `s${index}`)).length, 500);
});

test("nome: ordine alfabetico italiano, senza maiuscole né accenti, numeri in ordine naturale", () => {
  assert.deepEqual(ids(sortSubjects(subjects, "name")), ["b", "c", "e", "a", "d"]);
});

test("CFU dal più alto e dal più basso, a parità per nome", () => {
  assert.deepEqual(ids(sortSubjects(subjects, "cfu-desc")), ["c", "b", "a", "d", "e"]);
  assert.deepEqual(ids(sortSubjects(subjects, "cfu-asc")), ["e", "a", "d", "b", "c"]);
});

test("esame più vicino: prima le date, poi la data da decidere, in fondo chi non ha esame", () => {
  const dates = { a: "2026-12-10", d: "2026-11-30", c: EXAM_DATE_LATER };
  const sorted = sortSubjects(subjects, "exam", { examDate: (id) => dates[id] });
  assert.deepEqual(ids(sorted), ["d", "a", "c", "b", "e"]);
});

test("meno avanzate prima, senza misura in fondo", () => {
  const values = { a: 80, b: 10, c: null, d: 10 };
  const sorted = sortSubjects(subjects, "progress", { progress: (id) => values[id] ?? null });
  assert.deepEqual(ids(sorted), ["b", "d", "a", "c", "e"]);
});

test("ordine proprio: segue l'elenco salvato, le materie nuove in fondo nell'ordine di arrivo", () => {
  assert.deepEqual(ids(sortSubjects(subjects, "custom", { order: ["d", "b", "zz"] })), ["d", "b", "a", "c", "e"]);
  assert.deepEqual(ids(sortSubjects(subjects, "custom")), ["a", "b", "c", "d", "e"]);
});

test("sortSubjects non cambia l'array ricevuto", () => {
  const copy = [...subjects];
  sortSubjects(subjects, "name");
  assert.deepEqual(subjects, copy);
});

test("moveInList sposta e resta nei limiti", () => {
  assert.deepEqual(moveInList(["a", "b", "c"], "a", 2), ["b", "c", "a"]);
  assert.deepEqual(moveInList(["a", "b", "c"], "c", -5), ["c", "a", "b"]);
  const same = ["a", "b"];
  assert.equal(moveInList(same, "a", 0), same);
  assert.equal(moveInList(same, "x", 1), same);
});

test("mergeSubsetOrder: le riordinate prendono i loro posti, le altre restano dove sono", () => {
  // x e y (superate o archiviate) non si toccano; a, b, c si scambiano tra i posti che avevano.
  assert.deepEqual(mergeSubsetOrder(["a", "x", "b", "y", "c"], ["c", "a", "b"]), ["c", "x", "a", "y", "b"]);
  // Una materia nuova (non ancora nell'ordine) va in fondo.
  assert.deepEqual(mergeSubsetOrder(["a", "x"], ["n", "a"]), ["n", "x", "a"]);
});
