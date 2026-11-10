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
  await store.getState().restoreEntity("calendarEvent", { id: "e1", title: "Prima della modifica", start: OLD, end: OLD, updatedAt: OLD }, "e1");
  const events = store.getState().events;
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Prima della modifica");
  assert.ok(Date.parse(events[0].updatedAt) >= before, "updatedAt deve essere più recente: vince per LWW e arriva anche a chi ha la condivisione");
});

test("ripristino: un elemento eliminato da altri torna come nuovo, in fondo all'elenco", async () => {
  await store.getState().restoreEntity("task", { id: "t2", title: "Eliminata da Bob", updatedAt: OLD }, "t2");
  assert.deepEqual(store.getState().tasks.map((task) => task.id), ["t1", "t2"]);
});

test("ripristino: un elemento che esiste già si sostituisce al suo posto, non in fondo", async () => {
  store.setState({
    events: [
      { id: "a", title: "A", start: OLD, end: OLD, updatedAt: OLD },
      { id: "e1", title: "Dopo la modifica", start: OLD, end: OLD, updatedAt: OLD },
      { id: "b", title: "B", start: OLD, end: OLD, updatedAt: OLD }
    ]
  });
  const [a, , b] = store.getState().events;
  await store.getState().restoreEntity("calendarEvent", { id: "e1", title: "Prima della modifica", start: OLD, end: OLD, updatedAt: OLD }, "e1");
  const events = store.getState().events;
  assert.deepEqual(events.map((event) => event.id), ["a", "e1", "b"]);
  assert.equal(events[1].title, "Prima della modifica");
  // Gli altri elementi non si toccano (stesso oggetto: il diff di persistenza non li riscrive).
  assert.equal(events[0], a);
  assert.equal(events[2], b);
});

test("ripristino: se l'altra persona ha l'orologio avanti, il ripristino resta più recente della copia locale", async () => {
  const ahead = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  store.setState({ events: [{ id: "e1", title: "Dopo la modifica", start: OLD, end: OLD, updatedAt: ahead }] });
  await store.getState().restoreEntity("calendarEvent", { id: "e1", title: "Prima della modifica", start: OLD, end: OLD, updatedAt: OLD }, "e1");
  const [restored] = store.getState().events;
  assert.equal(restored.title, "Prima della modifica");
  assert.ok(Date.parse(restored.updatedAt) > Date.parse(ahead), "altrimenti il ripristino perde per LWW e non arriva a nessuno");
});

test("ripristino: tipi non condivisibili, senza id o con un id diverso non scrivono nulla e dicono perché, in italiano", async () => {
  const before = { events: store.getState().events, tasks: store.getState().tasks, preferences: store.getState().preferences, notifications: store.getState().notifications };
  const attempts = [
    ["preferences", { id: "main", displayName: "Bob" }, "main"],
    ["notification", { id: "n1", kind: "x", title: "x" }, "n1"],
    ["studyGroup", { id: "g1", name: "x" }, "g1"],
    ["constructor", { id: "e1" }, "e1"],
    ["__proto__", { id: "e1" }, "e1"],
    ["calendarEvent", {}, "e1"],
    ["calendarEvent", { id: "" }, ""],
    ["calendarEvent", { id: 5 }, "5"],
    ["calendarEvent", null, "e1"],
    ["calendarEvent", { id: "e1", deletedAt: "2026-11-02T10:00:00.000Z" }, "e1"],
    // Tipo e contenuto validi, ma la versione è di un altro elemento: il negozio è il confine di fiducia.
    ["calendarEvent", { id: "e1", title: "Sovrascrive e1" }, "e2"],
    ["task", { id: "t1", title: "Sovrascrive t1" }, "altro"],
    // Senza l'id dell'elemento non si ripristina.
    ["calendarEvent", { id: "e1", title: "Senza entityId" }, undefined],
    ["calendarEvent", { id: "e1", title: "Senza entityId" }, null]
  ];
  for (const [type, payload, entityId] of attempts) {
    await assert.rejects(
      store.getState().restoreEntity(type, payload, entityId),
      (error) => error instanceof ShareUserError && error.message === "Questo elemento non si può ripristinare.",
      `${type} ${JSON.stringify(payload)} ${String(entityId)}`
    );
  }
  const after = store.getState();
  assert.equal(after.events, before.events);
  assert.equal(after.tasks, before.tasks);
  assert.equal(after.preferences, before.preferences);
  assert.equal(after.notifications, before.notifications);
});
