// Navigazione di ripasso e quiz: testo grande sulla scheda, tasti delle opzioni, domande raggiungibili.
import test from "node:test";
import assert from "node:assert/strict";
import { isShortCardText, optionFromKey, quizFrontier, quizReachable } from "../src/lib/learnSession.ts";

const text = (value) => ({ type: "text", text: value });

test("scheda: testo breve grande e al centro, elenchi e testi lunghi no", () => {
  assert.equal(isShortCardText([text("Cosa abbassa un enzima?")]), true);
  assert.equal(isShortCardText([text("Michaelis-Menten:"), { type: "formula", latex: "v = \\frac{V[S]}{K_m+[S]}" }]), true);
  assert.equal(isShortCardText([text("x".repeat(141))]), false, "oltre 140 caratteri");
  assert.equal(isShortCardText([{ type: "list", items: ["a", "b"] }]), false);
  assert.equal(isShortCardText([text("a"), text("b"), text("c")]), false, "più di due blocchi");
  assert.equal(isShortCardText([]), false);
  assert.equal(isShortCardText(undefined), false);
  // Righe malformate (sync, raccolte condivise): mai un errore.
  assert.equal(isShortCardText([null]), false);
});

test("quiz: tasti 1–9 e lettere scelgono l'opzione mostrata", () => {
  assert.equal(optionFromKey("1", 4), 0);
  assert.equal(optionFromKey("4", 4), 3);
  assert.equal(optionFromKey("5", 4), -1, "oltre le opzioni");
  assert.equal(optionFromKey("a", 4), 0);
  assert.equal(optionFromKey("B", 4), 1);
  assert.equal(optionFromKey("e", 4), -1);
  assert.equal(optionFromKey("0", 4), -1);
  assert.equal(optionFromKey("Enter", 4), -1);
  assert.equal(optionFromKey("ArrowLeft", 4), -1);
  assert.equal(optionFromKey(" ", 4), -1);
});

test("quiz: in allenamento si torna alle domande fatte, non oltre la prima da fare", () => {
  const prepared = ["q1", "q2", "q3", "q4"].map((id) => ({ question: { id }, options: [] }));
  const none = new Set();
  assert.equal(quizFrontier(prepared, none), 0);
  assert.equal(quizReachable(0, prepared, none, false), true);
  assert.equal(quizReachable(1, prepared, none, false), false);
  const two = new Set(["q1", "q2"]);
  assert.equal(quizFrontier(prepared, two), 2);
  assert.deepEqual([0, 1, 2, 3].map((position) => quizReachable(position, prepared, two, false)), [true, true, true, false]);
  // Simulazione d'esame: ovunque.
  assert.deepEqual([0, 1, 2, 3].map((position) => quizReachable(position, prepared, none, true)), [true, true, true, true]);
  assert.equal(quizReachable(-1, prepared, none, true), false);
  assert.equal(quizReachable(4, prepared, none, true), false);
  // Tutte confermate: la prima da fare è l'ultima (si può rileggere tutto).
  assert.equal(quizFrontier(prepared, new Set(["q1", "q2", "q3", "q4"])), 3);
});
