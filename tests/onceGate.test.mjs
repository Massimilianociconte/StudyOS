import test from "node:test";
import assert from "node:assert/strict";
import { createOnceGate } from "../src/lib/onceGate.ts";

test("createOnceGate: il secondo tocco mentre il primo salva non passa", async () => {
  const gate = createOnceGate();
  const saved = [];
  // Come "Registra voto": crea la materia, poi l'esame (due attese).
  const save = async (label) => {
    if (!gate.take()) return;
    await Promise.resolve();
    await Promise.resolve();
    saved.push(label);
  };
  await Promise.all([save("primo"), save("secondo")]);
  assert.deepEqual(saved, ["primo"]);
  assert.equal(gate.taken(), true, "resta chiusa dopo il salvataggio: il modulo si sta chiudendo");
  await save("terzo");
  assert.deepEqual(saved, ["primo"]);
});

test("createOnceGate: dopo un errore del modulo (o riaprendolo) si può salvare di nuovo", () => {
  const gate = createOnceGate();
  assert.equal(gate.taken(), false);
  assert.equal(gate.take(), true);
  assert.equal(gate.take(), false);
  gate.release();
  assert.equal(gate.taken(), false);
  assert.equal(gate.take(), true);
});
