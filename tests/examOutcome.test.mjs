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

test("Registra il voto: l'idoneità è femminile e il pulsante dice cosa registra", async () => {
  const { GRADE_TEXT } = await import("../src/lib/labels/career.ts");
  assert.equal(GRADE_TEXT.saved("Biochimica", "idoneità", true, false), "Biochimica: idoneità registrata nel libretto.");
  assert.equal(GRADE_TEXT.saved("Biochimica", "idoneità", true, true), "Biochimica: idoneità aggiornata nel libretto.");
  assert.equal(GRADE_TEXT.saved("Biochimica", "28", false, false), "Biochimica: 28 registrato nel libretto.");
  assert.equal(GRADE_TEXT.saved("Biochimica", "30 e lode", false, true), "Biochimica: 30 e lode aggiornato nel libretto.");
  assert.equal(GRADE_TEXT.recordButton("passFail"), "Registra idoneità");
  assert.equal(GRADE_TEXT.recordButton("grade"), "Registra voto");
});

test("Esito: con voto, idoneità e non superato", () => {
  assert.deepEqual(O.outcomeOf(exam({ status: "done", grade: 28 })), "grade");
  assert.deepEqual(O.outcomeOf(exam({ status: "done", passFail: true })), "passFail");
  assert.deepEqual(O.outcomeOf(exam({ status: "done" })), "grade");
  assert.deepEqual(O.outcomeOf(null), "grade");
});

test("Registra il voto: lo stesso giorno dell'esame tiene la sua ora, un altro giorno va alle 12", () => {
  // Ore locali: vale in qualsiasi fuso di chi esegue i test.
  const nine = new Date(2026, 10, 5, 9, 0).toISOString();
  // Esame delle 9 del 5 novembre registrato col 5: resta alle 9 (anche nel file .ics).
  assert.equal(O.recordInstantFor("2026-11-05", { date: nine }), nine);
  // Giorno diverso: le 12 di quel giorno, come prima.
  assert.equal(O.recordInstantFor("2026-11-06", { date: nine }), new Date(2026, 10, 6, 12, 0).toISOString());
  // Nessun esame da riusare (materia nuova): le 12.
  assert.equal(O.recordInstantFor("2026-11-05"), new Date(2026, 10, 5, 12, 0).toISOString());
  assert.equal(O.recordInstantFor("2026-11-05", null), new Date(2026, 10, 5, 12, 0).toISOString());
  // Esame alle 23:30: il giorno è quello locale, non quello in UTC.
  const late = new Date(2026, 10, 5, 23, 30).toISOString();
  assert.equal(O.recordInstantFor("2026-11-05", { date: late }), late);
  // Data dell'esame illeggibile: le 12.
  assert.equal(O.recordInstantFor("2026-11-05", { date: "non una data" }), new Date(2026, 10, 5, 12, 0).toISOString());
  // Giorno scelto non valido (o vuoto): niente data, il modulo chiede di sceglierla.
  assert.equal(O.recordInstantFor("", { date: nine }), null);
  assert.equal(O.recordInstantFor("2026-13-40"), null);
});

test("Chiudere il modulo chiede prima solo se qualcosa è cambiato dall'apertura", () => {
  // Modulo del voto (GradeDrawer).
  const grade = { subjectId: "fisio", newName: "", newCfu: "6", date: "2026-11-05", grade: "", honors: false, outcome: "grade", newDate: "" };
  assert.equal(O.examDraftChanged({ ...grade }, grade), false);
  assert.equal(O.examDraftChanged({ ...grade, grade: "28" }, grade), true);
  assert.equal(O.examDraftChanged({ ...grade, honors: true }, grade), true);
  assert.equal(O.examDraftChanged({ ...grade, outcome: "failed" }, grade), true);
  assert.equal(O.examDraftChanged({ ...grade, newDate: "2026-12-01T09:00" }, grade), true);
  // Tornato com'era: niente da chiedere.
  const changed = { ...grade, grade: "28" };
  assert.equal(O.examDraftChanged({ ...changed, grade: "" }, grade), false);
  // Modulo dell'esame (Esami): anche numeri, copertina e campo assente.
  const examDraft = { subjectId: "fisio", date: "2026-11-05T09:00", preparation: 40, targetGrade: 28, status: "planning", program: "", frequentQuestions: "", cover: undefined, grade: "", honors: false, passFail: false };
  assert.equal(O.examDraftChanged({ ...examDraft }, examDraft), false);
  assert.equal(O.examDraftChanged({ ...examDraft, preparation: 45 }, examDraft), true);
  assert.equal(O.examDraftChanged({ ...examDraft, program: "Glicolisi" }, examDraft), true);
  assert.equal(O.examDraftChanged({ ...examDraft, cover: "data:image/png;base64,AAAA" }, examDraft), true);
  assert.equal(O.examDraftChanged({ ...examDraft, date: "2026-11-05T10:00" }, examDraft), true);
  const { cover: _cover, ...withoutCover } = examDraft;
  assert.equal(O.examDraftChanged(withoutCover, examDraft), false);
});
