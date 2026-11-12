import test from "node:test";
import assert from "node:assert/strict";
import { planMerge, legacySnapshotToRows, chunkBySize, planOrphanPuts, tieBreakStamp } from "../src/lib/syncMerge.ts";
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

// ---------- voci in coda senza entità in memoria (modifica fatta in un'altra scheda) ----------

const queuedPut = (id) => ({ key: `task:${id}`, collection: "tasks", entityType: "task", entityId: id, deleted: false, queuedAt: 1 });

test("voce in coda senza entità in memoria ma ancora su disco: si invia la riga salvata, non si scarta", () => {
  const stored = task("a", "2026-11-12T10:00:00Z", { title: "Scritta in scheda A" });
  const plan = planOrphanPuts([queuedPut("a")], new Map([["task:a", stored]]), false);
  assert.deepEqual(plan.drop, []);
  assert.equal(plan.send.length, 1);
  assert.equal(plan.send[0].row.key, "task:a");
  assert.equal(plan.send[0].entity, stored);
});

test("voce in coda senza entità né in memoria né su disco: si scarta (mai un'eliminazione cloud)", () => {
  const plan = planOrphanPuts([queuedPut("a"), queuedPut("b")], new Map([["task:b", { id: "altro" }]]), false);
  assert.deepEqual(plan.send, []);
  assert.deepEqual(plan.drop.map((row) => row.key), ["task:a", "task:b"]);
});

test("col vault la regola resta quella di prima: la voce orfana si scarta", () => {
  const plan = planOrphanPuts([queuedPut("a")], new Map([["task:a", task("a", "2026-11-12T10:00:00Z")]]), true);
  assert.deepEqual(plan.send, []);
  assert.deepEqual(plan.drop.map((row) => row.key), ["task:a"]);
});

// Primo collegamento di un account su un dispositivo: nome, foto e preferenze dell'account vincono
// sempre sulla copia del dispositivo, anche se quella è più recente. Prima la copia del dispositivo
// (di un'altra persona) veniva riaccodata e sostituiva nome e foto nell'account.
const prefs = (updatedAt, displayName) => ({ id: "main", updatedAt, displayName });
const prefsRow = (updatedAt, payload, deleted = false) => ({
  entity_type: "preferences",
  entity_id: "main",
  payload,
  deleted,
  updated_at: updatedAt
});
const ownPrefs = new Set(["preferences"]);

test("primo collegamento: le preferenze dell'account vincono su quelle più recenti del dispositivo", () => {
  const plan = planMerge(
    [prefsRow("2026-01-01T00:00:00Z", prefs("2026-01-01T00:00:00Z", "Camilla"))],
    normalizeCollections({ preferences: [prefs("2026-03-01T00:00:00Z", "Altra persona")] }),
    new Map([["preferences:main", { deleted: false }]]),
    { accountWins: ownPrefs }
  );
  assert.equal(plan.requeue.length, 0);
  assert.equal(plan.changes.length, 1);
  assert.equal(plan.changes[0].entity.displayName, "Camilla");
  assert.equal(plan.changes[0].force, true);
  assert.deepEqual(plan.dropOutbox, ["preferences:main"]);
});

test("primo collegamento: un account senza preferenze tiene quelle del dispositivo", () => {
  const plan = planMerge([], normalizeCollections({ preferences: [prefs("2026-03-01T00:00:00Z", "Io")] }), new Map(), { accountWins: ownPrefs });
  assert.equal(plan.changes.length, 0);
  assert.equal(plan.requeue.length, 0);
});

test("primo collegamento: le altre collezioni restano last-writer-wins", () => {
  const plan = planMerge([row("a", "2026-01-01T00:00:00Z", task("a", "2026-01-01T00:00:00Z"))], local([task("a", "2026-01-05T00:00:00Z")]), new Map(), { accountWins: ownPrefs });
  assert.equal(plan.changes.length, 0);
  assert.deepEqual(plan.requeue, [{ collection: "tasks", id: "a" }]);
});

test("senza accountWins le preferenze restano last-writer-wins (sync normale)", () => {
  const plan = planMerge(
    [prefsRow("2026-01-01T00:00:00Z", prefs("2026-01-01T00:00:00Z", "Vecchio"))],
    normalizeCollections({ preferences: [prefs("2026-03-01T00:00:00Z", "Nuovo")] }),
    new Map()
  );
  assert.equal(plan.changes.length, 0);
  assert.deepEqual(plan.requeue, [{ collection: "preferences", id: "main" }]);
});

test("pareggio di timbro con contenuto diverso: la copia di qui riparte 1 ms dopo", () => {
  // Il cloud rifiuta per sempre lo stesso timbro con un contenuto diverso («Conflitto cloud
  // irrisolto») e il merge non sceglie: senza un timbro nuovo la voce restava in coda per sempre.
  const remote = row("a", "2026-11-12T10:00:01Z", task("a", "2026-11-12T10:00:00.000Z", { title: "cloud" }));
  assert.equal(tieBreakStamp(task("a", "2026-11-12T10:00:00.000Z", { title: "qui" }), remote), "2026-11-12T10:00:00.001Z");
  // Microsecondi di Postgres: stesso millisecondo per il client, il server li distingue.
  const micro = row("a", "2026-11-12T10:00:01Z", task("a", "2026-11-12T10:00:00.800456+00:00"));
  assert.equal(tieBreakStamp(task("a", "2026-11-12T10:00:00.800123+00:00"), micro), "2026-11-12T10:00:00.801Z");
  // Niente pareggio: decide il merge come sempre.
  assert.equal(tieBreakStamp(task("a", "2026-11-12T09:00:00.000Z"), remote), null);
  assert.equal(tieBreakStamp(task("a", "2026-11-12T11:00:00.000Z"), remote), null);
  assert.equal(tieBreakStamp(undefined, remote), null);
  assert.equal(tieBreakStamp(task("a", "2026-11-12T10:00:00.000Z"), row("a", "2026-11-12T10:00:01Z", { id: "a", deletedAt: "2026-11-12T10:00:00.000Z" }, true)), null);
  assert.equal(tieBreakStamp(task("a", "non è una data"), row("a", "2026-11-12T10:00:01Z", task("a", "non è una data"))), null);
});
