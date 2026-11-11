import test from "node:test";
import assert from "node:assert/strict";
import { linkedUiChange } from "../src/lib/uiLinks.ts";

const isFilter = (value) => value === "all" || value === "overdue" || value === "urgent";

test("collegamenti: niente di nuovo nello stato salvato, niente da applicare", () => {
  assert.deepEqual(linkedUiChange("all", "all", isFilter), { seen: "all", apply: false });
  assert.deepEqual(linkedUiChange(undefined, undefined, isFilter), { seen: undefined, apply: false });
});

test("collegamenti: un valore valido scritto da un'altra schermata si applica una volta", () => {
  const first = linkedUiChange("overdue", "all", isFilter);
  assert.deepEqual(first, { seen: "overdue", apply: true });
  // Al controllo successivo lo stesso valore è già visto: non si riapplica (l'utente può averlo cambiato).
  assert.deepEqual(linkedUiChange("overdue", first.seen, isFilter), { seen: "overdue", apply: false });
});

test("collegamenti: un valore non valido si ricorda come visto ma non si applica", () => {
  assert.deepEqual(linkedUiChange("late", "all", isFilter), { seen: "late", apply: false });
  assert.deepEqual(linkedUiChange(undefined, "all", isFilter), { seen: undefined, apply: false });
});

test("collegamenti: null è valido quando il validatore lo accetta (es. «chiudi l'elemento aperto»)", () => {
  const nullable = (value) => value === null || typeof value === "string";
  assert.deepEqual(linkedUiChange(null, "t1", nullable), { seen: null, apply: true });
  assert.deepEqual(linkedUiChange("t2", null, nullable), { seen: "t2", apply: true });
});
