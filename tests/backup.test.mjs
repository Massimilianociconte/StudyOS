import test from "node:test";
import assert from "node:assert/strict";
import { inferBackupScope } from "../src/lib/backup.ts";
import { normalizeCollections } from "../src/lib/collections.ts";

const snap = (data) => ({ version: 1, exportedAt: "x", ...normalizeCollections(data) });

test("backup parziali vecchi (senza scope) riconosciuti -> merge invece di cancellare tutto", () => {
  assert.equal(inferBackupScope({ format: "studyos.backup", version: 1 }, snap({ tasks: [{ id: "t" }] })), "tasks");
  assert.equal(inferBackupScope({ format: "studyos.backup", version: 1 }, snap({ events: [{ id: "e" }] })), "calendar");
  assert.equal(inferBackupScope({ format: "studyos.backup", version: 1 }, snap({ tasks: [{ id: "t" }], events: [{ id: "e" }] })), "full");
  assert.equal(inferBackupScope({ format: "studyos.backup", version: 1, scope: "subjects" }, snap({})), "subjects");
});

test("normalizeCollections scarta elementi senza id e collezioni mancanti", () => {
  const result = normalizeCollections({ tasks: [{ id: "a" }, null, { title: "no id" }], subjects: "bad" });
  assert.equal(result.tasks.length, 1);
  assert.deepEqual(result.subjects, []);
  assert.deepEqual(result.widgets, []);
});
