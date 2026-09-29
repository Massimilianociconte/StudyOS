import test from "node:test";
import assert from "node:assert/strict";
import {
  averageNeededFor,
  averageNeededOnRemaining,
  baseScore,
  projectGraduation,
  sbHonorsPoints,
  sbThesisPoints
} from "../src/lib/graduation.ts";

test("base: media ponderata × 110 / 30", () => {
  assert.equal(baseScore(27), 99);
  assert.equal(baseScore(30), 110);
  assert.equal(baseScore(26.5), 97.17);
});

test("Scienze biologiche: tabella ufficiale della prova finale", () => {
  const table = { 18: 2, 19: 2, 20: 3, 21: 3, 22: 4, 23: 4, 24: 5, 25: 5, 26: 6, 27: 6, 28: 7, 29: 7, 30: 8 };
  for (const [grade, points] of Object.entries(table)) assert.equal(sbThesisPoints(Number(grade)), points, `voto ${grade}`);
  assert.equal(sbThesisPoints(17), 0);
});

test("Scienze biologiche: lodi 2 → 0,2; 3 → 0,4; 4 o più → 1", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 7].map(sbHonorsPoints), [0, 0, 0.2, 0.4, 1, 1]);
});

test("Scienze biologiche: proiezione con prova finale, lodi ed Erasmus facoltativo", () => {
  const result = projectGraduation({ program: "scienze-biologiche", weightedAverage: 27, honors: 3, thesis: 28, abroad: true });
  assert.equal(result.base, 99);
  assert.equal(result.total, 106.4); // 99 + 7 + 0,4
  assert.equal(result.totalMax, 107.4); // + fino a 1 per l'Erasmus
  assert.equal(result.capped, 106.4);
  const top = projectGraduation({ program: "scienze-biologiche", weightedAverage: 29.5, honors: 5, thesis: 30, abroad: false });
  assert.equal(top.total, 117.17); // 108,17 + 8 + 1
  assert.equal(top.capped, 110);
  assert.ok(top.notes.some((note) => note.includes("si ferma a 4")));
});

test("BARB: punti tesi 1–9, estero entro i 9 (linee guida) e lettura del manifesto", () => {
  const result = projectGraduation({ program: "barb", weightedAverage: 27, honors: 4, thesis: 7, abroad: false });
  assert.equal(result.total, 106); // 99 + 7, le lodi non contano
  const abroad = projectGraduation({ program: "barb", weightedAverage: 27, honors: 0, thesis: 7, abroad: true });
  assert.equal(abroad.total, 107);
  assert.equal(abroad.manifestoTotal, 107);
  const full = projectGraduation({ program: "barb", weightedAverage: 27, honors: 0, thesis: 9, abroad: true });
  assert.equal(full.total, 108); // già a 9: nessun punto in più secondo le linee guida
  assert.equal(full.manifestoTotal, 109); // il manifesto lo somma a parte
  assert.equal(projectGraduation({ program: "barb", weightedAverage: 27, honors: 0, thesis: 12, abroad: false }).total, 108);
});

test("proiezione: senza media non c'è stima; media necessaria per 110", () => {
  assert.equal(projectGraduation({ program: "barb", weightedAverage: null, honors: 0, thesis: 7, abroad: false }), null);
  assert.equal(averageNeededFor(110, 8), 27.82); // (110 − 8) × 30 / 110
  // 60 CFU a 27 già registrati, 30 CFU in programma: per una media di 28 servono 30.
  assert.equal(averageNeededOnRemaining(27 * 60, 60, 30, 28), 30);
  assert.equal(averageNeededOnRemaining(27 * 60, 60, 0, 28), null);
});
