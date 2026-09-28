import test from "node:test";
import assert from "node:assert/strict";
import { baselineFrom, diffCollections } from "../src/lib/persistence.ts";
import { normalizeCollections } from "../src/lib/collections.ts";

test("diff per riferimento: solo entità nuove/modificate/rimosse", () => {
  const a = { id: "a", updatedAt: "1" };
  const b = { id: "b", updatedAt: "1" };
  const c = { id: "c", updatedAt: "1" };
  const base = baselineFrom(normalizeCollections({ tasks: [a, b, c] }));
  const bChanged = { ...b, updatedAt: "2" };
  const d = { id: "d", updatedAt: "1" };
  const diff = diffCollections(normalizeCollections({ tasks: [a, bChanged, d] }), base);
  assert.deepEqual(diff.puts.tasks.map((x) => x.id), ["b", "d"]);
  assert.deepEqual(diff.deletes.tasks, ["c"]);
  assert.equal(diff.count, 3);
  assert.equal(diff.puts.subjects, undefined);
});

test("nessuna modifica -> diff vuoto (niente riscritture inutili)", () => {
  const state = normalizeCollections({ tasks: [{ id: "a", updatedAt: "1" }], subjects: [{ id: "s", updatedAt: "1" }] });
  assert.equal(diffCollections(state, baselineFrom(state)).count, 0);
});
