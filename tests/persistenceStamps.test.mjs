import test from "node:test";
import assert from "node:assert/strict";
import { advanceStamps, baselineFrom, diffCollections } from "../src/lib/persistence.ts";
import { normalizeCollections } from "../src/lib/collections.ts";

const NOW = Date.parse("2026-11-12T09:58:00.000Z"); // orologio di questo dispositivo, 2 minuti indietro

test("modifica con l'orologio indietro: il timbro va comunque dopo quello di prima", () => {
  // Il portatile ha scritto alle 10:00; qui l'orologio segna 09:58 e l'azione timbra «adesso».
  const before = { id: "t", updatedAt: "2026-11-12T10:00:00.000Z", title: "vecchio" };
  const base = baselineFrom(normalizeCollections({ tasks: [before] }));
  const edited = { ...before, title: "nuovo", updatedAt: "2026-11-12T09:58:00.000Z" };
  const state = normalizeCollections({ tasks: [edited] });
  const diff = diffCollections(state, base);
  const patch = advanceStamps(diff, base, state, { now: NOW });
  assert.equal(diff.puts.tasks[0].updatedAt, "2026-11-12T10:00:00.001Z");
  assert.equal(diff.puts.tasks[0].title, "nuovo");
  // Lo stato riceve lo stesso oggetto che va su disco e in coda.
  assert.equal(patch.tasks[0], diff.puts.tasks[0]);
});

test("contenuto cambiato senza toccare updatedAt: riceve un timbro nuovo", () => {
  const before = { id: "t", updatedAt: "2026-11-12T10:00:00.000Z", title: "a" };
  const base = baselineFrom(normalizeCollections({ tasks: [before] }));
  const state = normalizeCollections({ tasks: [{ ...before, title: "b" }] });
  const diff = diffCollections(state, base);
  advanceStamps(diff, base, state, { now: Date.parse("2026-11-12T11:00:00.000Z") });
  assert.equal(diff.puts.tasks[0].updatedAt, "2026-11-12T11:00:00.000Z");
});

test("timbro già avanti, entità nuove, copie dal cloud e gruppi pubblicati: nessun cambio", () => {
  const before = { id: "t", updatedAt: "2026-11-12T10:00:00.000Z", title: "a" };
  const group = { id: "g", updatedAt: "2026-11-01T10:00:00.000Z", sharedAt: "2026-11-01T10:00:00.000Z", members: [] };
  const base = baselineFrom(normalizeCollections({ tasks: [before], studyGroups: [group] }));
  const newer = { ...before, title: "b", updatedAt: "2026-11-12T10:05:00.000Z" };
  const created = { id: "n", updatedAt: "2026-11-12T09:00:00.000Z" };
  const echo = { id: "e", updatedAt: "2026-11-12T09:00:00.000Z" };
  const groupChanged = { ...group, members: [{ userId: "x" }] };
  const baseWithEcho = baselineFrom(normalizeCollections({ tasks: [before, { id: "e", updatedAt: "2026-11-12T09:30:00.000Z" }], studyGroups: [group] }));
  const state = normalizeCollections({ tasks: [newer, created, echo], studyGroups: [groupChanged] });
  const diff = diffCollections(state, baseWithEcho);
  const patch = advanceStamps(diff, baseWithEcho, state, { now: NOW, isEcho: (_key, item) => item === echo });
  assert.deepEqual(patch, {});
  assert.equal(diff.puts.tasks.find((t) => t.id === "t").updatedAt, "2026-11-12T10:05:00.000Z");
  assert.equal(diff.puts.studyGroups[0].updatedAt, "2026-11-01T10:00:00.000Z");
  void base;
});

test("stesso contenuto in un oggetto nuovo: niente timbro nuovo", () => {
  const before = { id: "t", updatedAt: "2026-11-12T10:00:00.000Z", title: "a" };
  const base = baselineFrom(normalizeCollections({ tasks: [before] }));
  const state = normalizeCollections({ tasks: [{ ...before }] });
  const diff = diffCollections(state, base);
  assert.deepEqual(advanceStamps(diff, base, state, { now: NOW }), {});
});
