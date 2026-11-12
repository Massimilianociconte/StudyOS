import test from "node:test";
import assert from "node:assert/strict";

const { homeLinks, currentDegree, degreePatch, degreeOptionLabel } = await import("../src/lib/homeFirstRun.ts");
const { DEGREE_PROGRAMS, DEGREE_PROGRAM_IDS } = await import("../src/lib/graduation.ts");

const allEmpty = { today: true, next: true, exams: true, subjects: true, goals: true, materials: true };
const noneEmpty = { today: false, next: false, exams: false, subjects: false, goals: false, materials: false };
const ALL_SHOWN = {
  todayAdd: true,
  upcomingAdd: true,
  nextAdd: true,
  allTasks: true,
  allExams: true,
  allSubjects: true,
  allGoals: true,
  allMaterials: true
};

test("primo avvio con la guida: ogni azione una volta sola, niente «Tutti…» accanto a elenchi vuoti", () => {
  const links = homeLinks({ guideVisible: true, guideTaskPending: true, empty: allEmpty });
  assert.deepEqual(links, {
    todayAdd: true,
    upcomingAdd: false,
    nextAdd: false,
    allTasks: false,
    allExams: false,
    allSubjects: false,
    allGoals: false,
    allMaterials: false
  });
  const shown = Object.values(links).filter(Boolean).length;
  assert.equal(Object.keys(links).length - shown, 7, "sette collegamenti in meno");
});

test("guida nascosta o completata: la Home non cambia", () => {
  assert.deepEqual(homeLinks({ guideVisible: false, guideTaskPending: true, empty: allEmpty }), ALL_SHOWN);
  assert.deepEqual(homeLinks({ guideVisible: false, guideTaskPending: false, empty: noneEmpty }), ALL_SHOWN);
});

test("con la guida, i doppioni restano se l'altro non c'è", () => {
  // «Oggi» ha impegni: «Prossimi giorni» vuoto tiene il suo «Aggiungi un impegno».
  const busyToday = homeLinks({ guideVisible: true, guideTaskPending: true, empty: { ...allEmpty, today: false } });
  assert.equal(busyToday.upcomingAdd, true);
  // Passo «attività» già fatto (tutte completate): «Cosa fare adesso» tiene «Aggiungi un'attività».
  const tasksDone = homeLinks({ guideVisible: true, guideTaskPending: false, empty: allEmpty });
  assert.equal(tasksDone.nextAdd, true);
});

test("con la guida, «Tutti…» resta accanto agli elenchi pieni", () => {
  assert.deepEqual(homeLinks({ guideVisible: true, guideTaskPending: false, empty: noneEmpty }), ALL_SHOWN);
  const mixed = homeLinks({ guideVisible: true, guideTaskPending: true, empty: { ...allEmpty, exams: false, goals: false } });
  assert.equal(mixed.allExams, true);
  assert.equal(mixed.allGoals, true);
  assert.equal(mixed.allSubjects, false);
});

test("corso di laurea: valore salvato o BARB come nelle Impostazioni", () => {
  assert.equal(currentDegree("scienze-biologiche"), "scienze-biologiche");
  assert.equal(currentDegree("barb"), "barb");
  assert.equal(currentDegree(undefined), "barb");
  assert.equal(currentDegree("medicina"), "barb");
});

test("cambiare corso aggiorna CFU totali e sezione del catalogo, come nelle Impostazioni", () => {
  for (const id of DEGREE_PROGRAM_IDS) {
    assert.deepEqual(degreePatch(id), { degreeProgram: id, degreeCfu: DEGREE_PROGRAMS[id].totalCfu, showBarb: id === "barb" });
  }
});

test("nome del corso nel menu: per esteso con la classe, senza sigle interne", () => {
  assert.equal(degreeOptionLabel("scienze-biologiche"), "Scienze biologiche (L-13)");
  assert.equal(degreeOptionLabel("barb"), "Biologia applicata alla ricerca biomedica (LM-6)");
  for (const id of DEGREE_PROGRAM_IDS) assert.doesNotMatch(degreeOptionLabel(id), /BARB/);
});
