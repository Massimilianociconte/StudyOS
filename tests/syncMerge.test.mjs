import test from "node:test";
import assert from "node:assert/strict";
import { planMerge, legacySnapshotToRows, chunkBySize } from "../src/lib/syncMerge.ts";
import { normalizeCollections } from "../src/lib/collections.ts";

const task = (id, updatedAt, extra = {}) => ({ id, updatedAt, title: id, ...extra });
const local = (tasks) => normalizeCollections({ tasks });
const row = (id, updatedAt, payload, deleted = false) => ({
  entity_type: "task",
  entity_id: id,
  payload,
  deleted,
  updated_at: updatedAt
});

test("remoto più recente sovrascrive il locale", () => {
  const plan = planMerge([row("a", "2026-01-02T00:00:00Z", task("a", "2026-01-02T00:00:00Z", { title: "remote" }))], local([task("a", "2026-01-01T00:00:00Z")]), new Map());
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].entity.title, "remote");
});

test("locale più recente vince e viene riaccodato", () => {
  const plan = planMerge([row("a", "2026-01-01T00:00:00Z", task("a", "2026-01-01T00:00:00Z"))], local([task("a", "2026-01-05T00:00:00Z")]), new Map());
  assert.equal(plan.changes.length, 0);
  assert.deepEqual(plan.requeue, [{ collection: "tasks", id: "a" }]);
});

test("modifica offline in outbox non viene persa al pull (bug del vecchio motore)", () => {
  const pending = new Map([["task:a", { deleted: false }]]);
  const plan = planMerge([row("a", "2026-01-01T00:00:00Z", task("a", "2026-01-01T00:00:00Z", { title: "old" }))], local([task("a", "2026-01-03T00:00:00Z", { title: "offline edit" })]), pending);
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.requeue.length, 0);
  assert.equal(plan.dropOutbox.length, 0);
});

test("tombstone remoto elimina solo se più recente della modifica locale", () => {
  const newer = planMerge([row("a", "2026-01-05T00:00:00Z", { id: "a", deletedAt: "2026-01-05T00:00:00Z" }, true)], local([task("a", "2026-01-01T00:00:00Z")]), new Map());
  assert.deepEqual(newer.changes.map((c) => c.entity), [null]);
  const older = planMerge([row("a", "2026-01-01T00:00:00Z", { id: "a", deletedAt: "2026-01-01T00:00:00Z" }, true)], local([task("a", "2026-01-05T00:00:00Z")]), new Map());
  assert.equal(older.changes.length, 0);
  assert.deepEqual(older.requeue, [{ collection: "tasks", id: "a" }]);
});

test("eliminazione locale in attesa non viene annullata da una versione remota più vecchia", () => {
  const pending = new Map([["task:a", { deleted: true, deletedAt: "2026-01-04T00:00:00Z" }]]);
  const plan = planMerge([row("a", "2026-01-02T00:00:00Z", task("a", "2026-01-02T00:00:00Z"))], local([]), pending);
  assert.equal(plan.changes.length, 0);
  const newerRemote = planMerge([row("a", "2026-01-06T00:00:00Z", task("a", "2026-01-06T00:00:00Z"))], local([]), pending);
  assert.equal(newerRemote.changes.length, 1);
  assert.deepEqual(newerRemote.dropOutbox, ["task:a"]);
});

test("un tombstone remoto più recente chiude l'eliminazione locale ancora in coda", () => {
  const pending = new Map([["task:a", { deleted: true, deletedAt: "2026-01-04T00:00:00Z" }]]);
  const plan = planMerge([
    row("a", "2026-01-05T00:00:00Z", { id: "a", deletedAt: "2026-01-05T00:00:00Z" }, true)
  ], local([]), pending);
  assert.deepEqual(plan.dropOutbox, ["task:a"]);
});

test("righe sconosciute, legacy o malformate vengono ignorate", () => {
  const plan = planMerge(
    [
      { entity_type: "snapshot", entity_id: "main", payload: {}, deleted: false, updated_at: "2026-01-01T00:00:00Z" },
      row("b", "2026-01-01T00:00:00Z", { id: "other" })
    ],
    local([]),
    new Map()
  );
  assert.equal(plan.ignored, 2);
  assert.equal(plan.changes.length, 0);
});

test("force: il remoto vince anche se più vecchio", () => {
  const plan = planMerge([row("a", "2026-01-01T00:00:00Z", task("a", "2026-01-01T00:00:00Z"))], local([task("a", "2026-02-01T00:00:00Z")]), new Map([["task:a", { deleted: false }]]), { force: true });
  assert.equal(plan.changes.length, 1);
  assert.deepEqual(plan.dropOutbox, ["task:a"]);
});

test("migrazione snapshot legacy -> righe per-entità", () => {
  const rows = legacySnapshotToRows({ tasks: [task("a", "2026-01-01T00:00:00Z")], subjects: [{ id: "s", name: "x" }] }, "2026-01-02T00:00:00Z");
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.entity_id === "s").payload.updatedAt, "2026-01-02T00:00:00Z");
  assert.equal(rows.find((r) => r.entity_id === "s").entity_type, "subject");
});

test("chunkBySize rispetta limiti di byte e righe", () => {
  const batches = chunkBySize([5, 5, 5, 20, 1, 1], (n) => n, 10, 2);
  assert.deepEqual(batches, [[5, 5], [5], [20], [1, 1]]);
});
