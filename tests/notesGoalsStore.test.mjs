import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// Solo memoria: con `loading` attivo la persistenza non scrive (niente IndexedDB in Node).
const store = useStudyStore;
const OLD = "2026-11-01T10:00:00.000Z";
const note = { id: "o1", createdAt: OLD, updatedAt: OLD, archived: false, tags: [], title: "Appunti", body: "Capitolo 4", linkedEntityType: "task", linkedEntityId: "t1" };
const goal = { id: "g1", createdAt: OLD, updatedAt: OLD, archived: false, tags: [], title: "Finire Fisica", description: "", category: "study", startDate: OLD, progress: 40, metric: "%", linkedTaskIds: [], linkedSessionIds: [], status: "active", notes: "" };

beforeEach(() => {
  store.setState({
    loading: true,
    notes: [note, { ...note, id: "o2", title: "Altra" }],
    goals: [goal, { ...goal, id: "g2", title: "Correre" }]
  });
});

test("note: la modifica cambia titolo e testo, con updatedAt nuovo, e lascia il collegamento", async () => {
  await store.getState().updateNote("o1", { title: "Appunti cap. 4", body: "Esercizi 1-10" });
  const [edited, other] = store.getState().notes;
  assert.equal(edited.title, "Appunti cap. 4");
  assert.equal(edited.body, "Esercizi 1-10");
  assert.equal(edited.linkedEntityId, "t1");
  assert.notEqual(edited.updatedAt, OLD);
  assert.equal(other.updatedAt, OLD);
});

test("note: Elimina toglie solo quella nota", async () => {
  await store.getState().deleteNote("o1");
  assert.deepEqual(store.getState().notes.map((item) => item.id), ["o2"]);
});

test("note: «Annulla» dopo Elimina la riporta uguale, con updatedAt nuovo (vince sulla cancellazione già sincronizzata)", async () => {
  await store.getState().deleteNote("o1");
  const written = await store.getState().restoreEntities([{ entityType: "note", entityId: "o1", payload: note, complete: true }]);
  assert.equal(written, 1);
  const restored = store.getState().notes.find((item) => item.id === "o1");
  assert.equal(restored.title, "Appunti");
  assert.equal(restored.linkedEntityId, "t1");
  assert.notEqual(restored.updatedAt, OLD);
});

test("obiettivi: Elimina toglie solo quell'obiettivo; «Annulla» lo riporta", async () => {
  await store.getState().deleteGoal("g1");
  assert.deepEqual(store.getState().goals.map((item) => item.id), ["g2"]);
  await store.getState().restoreEntities([{ entityType: "goal", entityId: "g1", payload: goal, complete: true }]);
  const restored = store.getState().goals.find((item) => item.id === "g1");
  assert.equal(restored.title, "Finire Fisica");
  assert.equal(restored.progress, 40);
});
