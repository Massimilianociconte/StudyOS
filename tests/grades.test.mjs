import test from "node:test";
import assert from "node:assert/strict";

const G = await import("../src/lib/grades.ts");
const D = await import("../src/lib/graduation.ts");

const subj = (id, cfu) => ({ id, name: id, cfu, status: "active" });
const ex = (id, subjectId, o = {}) => ({
  id,
  subjectId,
  date: o.date ?? "2026-06-01T10:00:00.000Z",
  updatedAt: o.updatedAt ?? "2026-06-01T10:00:00.000Z",
  archived: o.archived ?? false,
  status: o.status ?? "done",
  grade: o.grade,
  honors: o.honors,
  passFail: o.passFail,
  targetGrade: o.targetGrade ?? 28,
  tags: o.tags ?? []
});

test("Libretto (repro): «Sostenuto» senza voto, poi «Registra un voto» aggiorna lo stesso esame", () => {
  const subjects = [subj("biochimica", 12), subj("fisiologia", 6)];
  // «Registra l'esito» → «Sostenuto» con «Non ancora registrato».
  const past = ex("past", "biochimica", { status: "done", date: "2026-10-10T09:00:00.000Z" });
  const exams = [past, ex("f", "fisiologia", { grade: 26 })];
  // Più tardi «Registra un voto» per Biochimica: si riusa l'esame sostenuto senza voto.
  assert.equal(G.examToRecord(exams, "biochimica")?.id, "past");
  const after = exams.map((exam) => (exam.id === "past" ? { ...exam, grade: 28 } : exam));
  const entries = G.librettoEntries(after, subjects);
  assert.deepEqual(entries.map((entry) => entry.subjectId).sort(), ["biochimica", "fisiologia"]);
  const stats = G.gradeStats(entries);
  assert.equal(stats.cfuEarned, 18);
  assert.equal(stats.passed, 2);
  assert.equal(stats.weighted, Math.round(((28 * 12 + 26 * 6) / 18) * 100) / 100);
});

test("Libretto: un esame sostenuto senza voto vince su un esame ancora da dare; poi il primo da dare", () => {
  const exams = [
    ex("next", "a", { status: "planning", date: "2027-01-20T09:00:00.000Z" }),
    ex("soon", "a", { status: "studying", date: "2027-01-10T09:00:00.000Z" }),
    ex("old", "a", { status: "done", date: "2026-09-01T09:00:00.000Z" }),
    ex("newer", "a", { status: "done", date: "2026-10-01T09:00:00.000Z" }),
    ex("gone", "a", { status: "done", date: "2026-11-01T09:00:00.000Z", archived: true })
  ];
  assert.equal(G.examToRecord(exams, "a")?.id, "newer");
  assert.equal(G.examToRecord(exams.filter((exam) => exam.status !== "done"), "a")?.id, "soon");
  assert.equal(G.examToRecord(exams, "b"), undefined);
  // Un esame già con voto non si riscrive: si crea un esame nuovo solo se non c'è nulla da chiudere.
  assert.equal(G.examToRecord([ex("x", "a", { grade: 27 })], "a"), undefined);
});

test("Libretto: dati vecchi con due voti per la stessa materia → una riga, l'ultimo voto, CFU una volta", () => {
  const subjects = [subj("a", 9), subj("b", 6)];
  const exams = [
    ex("a1", "a", { grade: 24, date: "2026-02-01T09:00:00.000Z" }),
    ex("a2", "a", { grade: 29, date: "2026-07-01T09:00:00.000Z" }),
    ex("b1", "b", { passFail: true })
  ];
  const entries = G.librettoEntries(exams, subjects);
  assert.equal(entries.length, 2);
  assert.equal(entries.find((entry) => entry.subjectId === "a").grade, 29);
  const stats = G.gradeStats(entries);
  assert.equal(stats.cfuEarned, 15);
  assert.equal(stats.arithmetic, 29);
  assert.equal(stats.weighted, 29);
  // Stessa data: vince quello modificato per ultimo.
  const tie = G.librettoEntries(
    [ex("t1", "a", { grade: 25, updatedAt: "2026-06-02T09:00:00.000Z" }), ex("t2", "a", { grade: 27, updatedAt: "2026-06-01T09:00:00.000Z" })],
    subjects
  );
  assert.equal(tie.length, 1);
  assert.equal(tie[0].grade, 25);
});

test("Libretto: «superati senza voto» una volta per materia e mai per una materia già nel libretto", () => {
  const subjects = [subj("a", 6), subj("b", 6), subj("c", 6)];
  const exams = [
    ex("a-graded", "a", { grade: 28 }),
    ex("a-stale", "a", { status: "done" }),
    ex("b1", "b", { status: "done", date: "2026-03-01T09:00:00.000Z" }),
    ex("b2", "b", { status: "done", date: "2026-05-01T09:00:00.000Z" }),
    ex("c-open", "c", { status: "planning" })
  ];
  const entries = G.librettoEntries(exams, subjects);
  assert.deepEqual(G.missingGrades(exams, entries).map((exam) => exam.id), ["b2"]);
});

test("Proiezione: due esami in programma della stessa materia contano una volta (il prossimo)", () => {
  const subjects = [subj("A", 6), subj("B", 12)];
  const exams = [
    ex("a", "A", { grade: 24 }),
    ex("b1", "B", { status: "planning", targetGrade: 30, date: "2027-01-10T09:00:00.000Z" }),
    ex("b2", "B", { status: "planning", targetGrade: 30, date: "2027-01-20T09:00:00.000Z" })
  ];
  const entries = G.librettoEntries(exams, subjects);
  assert.equal(G.projectedStats(entries, exams, subjects).weighted, 28);
  // Obiettivi diversi: vale quello del prossimo esame.
  const mixed = exams.map((exam) => (exam.id === "b2" ? { ...exam, targetGrade: 18 } : exam));
  assert.equal(G.projectedStats(entries, mixed, subjects).weighted, 28);
  const swapped = exams.map((exam) => (exam.id === "b1" ? { ...exam, targetGrade: 18 } : exam));
  assert.equal(G.projectedStats(entries, swapped, subjects).weighted, 20);
});

test("Voto di partenza: il riquadro e il pannello partono dalla stessa media", () => {
  let checked = 0;
  for (let a = 18; a <= 30; a++) {
    for (let b = 18; b <= 30; b++) {
      for (const ca of [3, 6, 9, 12]) {
        const s = G.gradeStats([{ cfu: ca, grade: a, passFail: false }, { cfu: 6, grade: b, passFail: false }, { cfu: 9, grade: 25, passFail: false }]);
        assert.equal(D.baseScore(s.weighted), s.base110, `${a}/${ca} ${b}/6`);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 600);
});
