import test from "node:test";
import assert from "node:assert/strict";

const O = await import("../src/lib/examOutcome.ts");
const G = await import("../src/lib/grades.ts");

const PAST = "2026-10-10T07:00:00.000Z";
const exam = (o = {}) => ({
  id: "x",
  subjectId: "fisio",
  date: o.date ?? PAST,
  updatedAt: PAST,
  archived: false,
  status: o.status ?? "reviewing",
  preparation: 80,
  targetGrade: 27,
  tags: o.tags ?? [],
  program: [],
  frequentQuestions: [],
  simulations: 0,
  grade: o.grade,
  honors: o.honors,
  passFail: o.passFail
});

test("Non superato: l'esame resta aperto nello stato di preparazione e non entra nel libretto", () => {
  const open = exam({ status: "reviewing" });
  const patch = O.failedExamPatch(open);
  const after = { ...open, ...patch };
  assert.equal(after.status, "reviewing");
  assert.equal(after.grade, undefined);
  assert.equal(after.passFail, false);
  assert.equal(after.honors, false);
  assert.equal(after.date, PAST);
  assert.equal(G.librettoEntries([after], [{ id: "fisio", name: "Fisiologia", cfu: 9 }]).length, 0);
  // Un esame già «Sostenuto» senza voto torna «In preparazione».
  assert.equal(O.failedExamPatch(exam({ status: "done" })).status, "studying");
});

test("Non superato senza nuova data: la data passata non chiede più l'esito, la data è da decidere", () => {
  const after = { ...exam(), ...O.failedExamPatch(exam()) };
  assert.equal(O.isDateToDecide(after), true);
  // Non è un enum nuovo: un'etichetta (stringa) dell'esame, legata a quella data.
  assert.ok(after.tags.every((tag) => typeof tag === "string"));
  // Cambiata la data (da qui, da un agente, da un'altra versione dell'app): non vale più.
  assert.equal(O.isDateToDecide({ ...after, date: "2027-02-14T08:00:00.000Z" }), false);
  // Registrato poi un esito: non è più da decidere.
  assert.equal(O.isDateToDecide({ ...after, status: "done", grade: 27 }), false);
  // Un secondo «Non superato» non duplica l'etichetta.
  const again = { ...after, ...O.failedExamPatch(after) };
  assert.equal(again.tags.length, 1);
});

test("Non superato con nuova data: la data cambia e niente «da decidere»", () => {
  const next = "2027-01-20T08:00:00.000Z";
  const after = { ...exam({ tags: ["altro"] }), ...O.failedExamPatch(exam({ tags: ["altro"] }), next) };
  assert.equal(after.date, next);
  assert.equal(O.isDateToDecide(after), false);
  assert.deepEqual(after.tags, ["altro"]);
});

test("Le etichette dell'utente restano; quella della data da decidere si toglie", () => {
  const marked = { ...exam({ tags: ["orale"] }), ...O.failedExamPatch(exam({ tags: ["orale"] })) };
  assert.deepEqual(O.withoutDateToDecide(marked.tags), ["orale"]);
  assert.deepEqual(O.withoutDateToDecide(undefined), []);
});

test("Registra il voto: il giorno proposto è quello dell'esame riusato, se è già passato", () => {
  // Ore locali: il giorno si legge come lo vede chi studia, in qualsiasi fuso.
  const now = new Date(2026, 10, 12, 10, 0);
  const at = (day, hour = 9) => new Date(2026, 10, day, hour, 0).toISOString();
  // «Superata» su una materia con l'esame del 5 novembre: si propone il 5, non oggi.
  assert.equal(O.recordDateFor(exam({ status: "ready", date: at(5) }), now), "2026-11-05");
  // Esame di oggi (anche più tardi): oggi.
  assert.equal(O.recordDateFor(exam({ status: "ready", date: at(12, 15) }), now), "2026-11-12");
  // Esame ancora da fare o nessun esame da riusare: oggi.
  assert.equal(O.recordDateFor(exam({ status: "planning", date: at(20) }), now), "2026-11-12");
  assert.equal(O.recordDateFor(undefined, now), "2026-11-12");
  // Non superato con la data da decidere: quel giorno non l'ha superato, si propone oggi.
  const failed = { ...exam({ status: "ready", date: at(5) }), ...O.failedExamPatch(exam({ status: "ready", date: at(5) })) };
  assert.equal(O.recordDateFor(failed, now), "2026-11-12");
  // Data illeggibile: oggi.
  assert.equal(O.recordDateFor(exam({ date: "non una data" }), now), "2026-11-12");
});

test("Esito: con voto, idoneità e non superato", () => {
  assert.deepEqual(O.outcomeOf(exam({ status: "done", grade: 28 })), "grade");
  assert.deepEqual(O.outcomeOf(exam({ status: "done", passFail: true })), "passFail");
  assert.deepEqual(O.outcomeOf(exam({ status: "done" })), "grade");
  assert.deepEqual(O.outcomeOf(null), "grade");
});
