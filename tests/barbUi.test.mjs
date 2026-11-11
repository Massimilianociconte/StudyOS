import test from "node:test";
import assert from "node:assert/strict";

const { NO_BARB_FILTER, toggleSemesterFilter, toggleMineFilter, isMineFilterActive, isBarbSemesterFilter, BARB_TABS, isBarbTab } = await import("../src/lib/barbUi.ts");

test("riquadro del semestre: filtra per quel semestre e lascia com'è «Solo le mie materie»", () => {
  assert.deepEqual(toggleSemesterFilter(NO_BARB_FILTER, "primo"), { semester: "primo", myPlanOnly: false });
  assert.deepEqual(toggleSemesterFilter({ semester: "secondo", myPlanOnly: true }, "primo"), { semester: "primo", myPlanOnly: true });
});

test("riquadro del semestre: un secondo tocco torna a tutti i semestri", () => {
  assert.deepEqual(toggleSemesterFilter({ semester: "primo", myPlanOnly: true }, "primo"), { semester: "tutti", myPlanOnly: true });
});

test("pillola «Nelle tue materie»: solo le mie materie di quel semestre", () => {
  assert.deepEqual(toggleMineFilter(NO_BARB_FILTER, "secondo"), { semester: "secondo", myPlanOnly: true });
  assert.deepEqual(toggleMineFilter(NO_BARB_FILTER, "tutti"), { semester: "tutti", myPlanOnly: true });
  // Da un altro semestre si passa direttamente al nuovo.
  assert.deepEqual(toggleMineFilter({ semester: "primo", myPlanOnly: true }, "secondo"), { semester: "secondo", myPlanOnly: true });
});

test("pillola «Nelle tue materie»: un secondo tocco toglie entrambi i filtri", () => {
  assert.deepEqual(toggleMineFilter({ semester: "secondo", myPlanOnly: true }, "secondo"), NO_BARB_FILTER);
  assert.deepEqual(toggleMineFilter({ semester: "tutti", myPlanOnly: true }, "tutti"), NO_BARB_FILTER);
});

test("pillola attiva solo se semestre e «Solo le mie» coincidono", () => {
  assert.equal(isMineFilterActive({ semester: "primo", myPlanOnly: true }, "primo"), true);
  assert.equal(isMineFilterActive({ semester: "primo", myPlanOnly: false }, "primo"), false);
  assert.equal(isMineFilterActive({ semester: "tutti", myPlanOnly: true }, "primo"), false);
});

test("validatore del semestre salvato (barb.semester)", () => {
  for (const value of ["tutti", "primo", "secondo", "annuale", "non-definito"]) assert.equal(isBarbSemesterFilter(value), true);
  assert.equal(isBarbSemesterFilter("terzo"), false);
  assert.equal(isBarbSemesterFilter(null), false);
});

test("barb.tab: i valori salvati di prima restano validi", () => {
  assert.deepEqual([...BARB_TABS], ["corsi", "calendario", "docenti", "aule", "fonti", "condivisi"]);
  for (const value of BARB_TABS) assert.equal(isBarbTab(value), true);
  assert.equal(isBarbTab("appelli"), false);
});
