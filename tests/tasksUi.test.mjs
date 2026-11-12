import test from "node:test";
import assert from "node:assert/strict";
import { addStep, cleanSteps, removeStep, renameStep, stepsDone, toggleStep } from "../src/lib/tasksUi.ts";

const STEPS = [
  { id: "s1", text: "Leggere il capitolo", done: true },
  { id: "s2", text: "Esercizi 1-5", done: false }
];

test("passaggi: aggiungere toglie gli spazi e ignora un testo vuoto", () => {
  assert.deepEqual(addStep(STEPS, "  Ripasso  ", "s3"), [...STEPS, { id: "s3", text: "Ripasso", done: false }]);
  assert.equal(addStep(STEPS, "   ", "s3"), STEPS);
  assert.equal(addStep(STEPS, "", "s3"), STEPS);
});

test("passaggi: spuntare cambia solo quel passaggio, senza toccare l'elenco di partenza", () => {
  const next = toggleStep(STEPS, "s2");
  assert.deepEqual(next.map((step) => step.done), [true, true]);
  assert.equal(STEPS[1].done, false);
  assert.deepEqual(toggleStep(next, "s1").map((step) => step.done), [false, true]);
  assert.deepEqual(toggleStep(STEPS, "nessuno"), STEPS);
});

test("passaggi: rinominare tiene il testo com'è mentre scrivi; togliere lo elimina", () => {
  assert.equal(renameStep(STEPS, "s2", "Esercizi 1-10 ")[1].text, "Esercizi 1-10 ");
  assert.equal(renameStep(STEPS, "s2", "")[1].text, "");
  assert.deepEqual(removeStep(STEPS, "s1"), [STEPS[1]]);
});

test("passaggi: al salvataggio i testi si puliscono e quelli rimasti vuoti spariscono", () => {
  const steps = [{ id: "a", text: " Uno ", done: false }, { id: "b", text: "   ", done: true }, { id: "c", text: "Tre", done: true }];
  assert.deepEqual(cleanSteps(steps), [{ id: "a", text: "Uno", done: false }, { id: "c", text: "Tre", done: true }]);
});

test("passaggi: il conto dei fatti è quello delle righe dell'elenco", () => {
  assert.deepEqual(stepsDone(STEPS), { done: 1, total: 2 });
  assert.deepEqual(stepsDone([]), { done: 0, total: 0 });
});
