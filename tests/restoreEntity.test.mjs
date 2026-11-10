import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ShareUserError, SHARED_ENTITY_TYPES } from "../src/lib/sharing.ts";
import { COLLECTION_BY_ENTITY_TYPE } from "../src/lib/collections.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// Solo memoria: con `loading` attivo la persistenza non scrive (niente IndexedDB in Node).
const store = useStudyStore;
const OLD = "2026-11-01T10:00:00.000Z";

beforeEach(() => {
  store.setState({
    loading: true,
    events: [{ id: "e1", title: "Dopo la modifica", start: OLD, end: OLD, updatedAt: OLD }],
    tasks: [{ id: "t1", title: "Attività", updatedAt: OLD }],
    preferences: [{ id: "main", displayName: "Alice", updatedAt: OLD }],
    notifications: []
  });
});

test("ripristino: ogni tipo condivisibile ha la sua collezione personale", () => {
  for (const type of SHARED_ENTITY_TYPES) assert.ok(COLLECTION_BY_ENTITY_TYPE[type], type);
});

test("ripristino: la versione salvata torna tra i dati personali con un updatedAt nuovo", async () => {
  const before = Date.now();
  await store.getState().restoreEntity("calendarEvent", { id: "e1", title: "Prima della modifica", start: OLD, end: OLD, updatedAt: OLD });
  const events = store.getState().events;
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Prima della modifica");
  assert.ok(Date.parse(events[0].updatedAt) >= before, "updatedAt deve essere più recente: vince per LWW e arriva anche a chi ha la condivisione");
});

test("ripristino: un elemento eliminato da altri torna come nuovo", async () => {
  await store.getState().restoreEntity("task", { id: "t2", title: "Eliminata da Bob", updatedAt: OLD });
  assert.deepEqual(store.getState().tasks.map((task) => task.id).sort(), ["t1", "t2"]);
});

test("ripristino: tipi non condivisibili o senza id non scrivono nulla e dicono perché, in italiano", async () => {
  const before = { events: store.getState().events, tasks: store.getState().tasks, preferences: store.getState().preferences, notifications: store.getState().notifications };
  const attempts = [
    ["preferences", { id: "main", displayName: "Bob" }],
    ["notification", { id: "n1", kind: "x", title: "x" }],
    ["studyGroup", { id: "g1", name: "x" }],
    ["constructor", { id: "e1" }],
    ["__proto__", { id: "e1" }],
    ["calendarEvent", {}],
    ["calendarEvent", { id: "" }],
    ["calendarEvent", { id: 5 }],
    ["calendarEvent", null],
    ["calendarEvent", { id: "e1", deletedAt: "2026-11-02T10:00:00.000Z" }]
  ];
  for (const [type, payload] of attempts) {
    await assert.rejects(
      store.getState().restoreEntity(type, payload),
      (error) => error instanceof ShareUserError && error.message === "Questo elemento non si può ripristinare.",
      `${type} ${JSON.stringify(payload)}`
    );
  }
  const after = store.getState();
  assert.equal(after.events, before.events);
  assert.equal(after.tasks, before.tasks);
  assert.equal(after.preferences, before.preferences);
  assert.equal(after.notifications, before.notifications);
});
