import test from "node:test";
import assert from "node:assert/strict";

const { resolveExamEditing, examRisk, examLinkPlan, EXAMS_EDITING_KEY } = await import("../src/lib/examsUi.ts");
const { isNullableString } = await import("../src/lib/uiState.ts");

const exams = [
  { id: "e1", subjectId: "s1" },
  { id: "e2", subjectId: "s2" }
];

test("exams.editing: nome della chiave e validatore (stringa o null)", () => {
  assert.equal(EXAMS_EDITING_KEY, "exams.editing");
  assert.equal(isNullableString("e1"), true);
  assert.equal(isNullableString(null), true);
  assert.equal(isNullableString(42), false);
});

test("exams.editing: niente da aprire con null o assente", () => {
  assert.deepEqual(resolveExamEditing(null, exams), { exam: null, clear: false });
  assert.deepEqual(resolveExamEditing(undefined, exams), { exam: null, clear: false });
});

test("exams.editing: un id esistente apre quell'esame", () => {
  const result = resolveExamEditing("e2", exams);
  assert.equal(result.exam, exams[1]);
  assert.equal(result.clear, false);
});

test("exams.editing: un id sconosciuto (esame eliminato) si ignora e si cancella", () => {
  assert.deepEqual(resolveExamEditing("sparito", exams), { exam: null, clear: true });
  assert.deepEqual(resolveExamEditing("", exams), { exam: null, clear: true });
  // Con l'elenco vuoto anche un id valido prima non apre nulla.
  assert.deepEqual(resolveExamEditing("e1", []), { exam: null, clear: true });
});

test("exams.editing: un valore non stringa si cancella", () => {
  assert.deepEqual(resolveExamEditing(7, exams), { exam: null, clear: true });
});

test("bollino di rischio: meno di 10 giorni e sotto il 70% → alto", () => {
  assert.equal(examRisk(9, 69), "alto");
  assert.equal(examRisk(0, 0), "alto");
  assert.equal(examRisk(9, 70), null);
});

test("bollino di rischio: meno di 20 giorni e sotto il 55% → medio", () => {
  assert.equal(examRisk(10, 54), "medio");
  assert.equal(examRisk(19, 54), "medio");
  assert.equal(examRisk(12, 60), null);
  assert.equal(examRisk(19, 55), null);
  assert.equal(examRisk(20, 0), null);
});

test("collegamento Attività: filtro per materia (scheda) ed elenco, poi la vista Attività", () => {
  assert.deepEqual(examLinkPlan("tasks", "s1"), {
    view: "tasks",
    writes: [
      { key: "tasks.subject", value: "s1", scope: "tab" },
      { key: "tasks.mode", value: "list", scope: "device" }
    ]
  });
});

test("collegamento Studio: materia del timer già scelta (dispositivo), poi la vista Studio", () => {
  assert.deepEqual(examLinkPlan("study", "s2"), {
    view: "study",
    writes: [{ key: "study.subject", value: "s2", scope: "device" }]
  });
});

test("collegamento argomenti: materia dell'esame scelta in Studio (dispositivo), poi gli argomenti da ripassare", () => {
  assert.deepEqual(examLinkPlan("topics", "s2"), {
    view: "study",
    writes: [
      { key: "study.subject", value: "s2", scope: "device" },
      { key: "study.topicsOpen", value: true, scope: "tab" }
    ]
  });
});

test("giorni all'esame: il giorno stesso dice «Oggi», non «0 giorni»", async () => {
  const { EXAMS_TEXT } = await import("../src/lib/labels/exams.ts");
  // Riquadro della scheda (Esami e Home): numero grande e parola sotto.
  assert.deepEqual(EXAMS_TEXT.countdown(0), { value: "Oggi", unit: "" });
  assert.deepEqual(EXAMS_TEXT.countdown(1), { value: "1", unit: "giorno" });
  assert.deepEqual(EXAMS_TEXT.countdown(12), { value: "12", unit: "giorni" });
  // In riga, dopo la data (scheda con copertina): come in Statistiche.
  assert.equal(EXAMS_TEXT.countdownInline(0), "oggi");
  assert.equal(EXAMS_TEXT.countdownInline(1), "domani");
  assert.equal(EXAMS_TEXT.countdownInline(12), "12 giorni");
});
