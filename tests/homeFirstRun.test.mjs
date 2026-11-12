import test from "node:test";
import assert from "node:assert/strict";

const { homeLinks } = await import("../src/lib/homeFirstRun.ts");

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
