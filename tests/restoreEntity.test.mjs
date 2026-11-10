import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ShareUserError, SHARED_ENTITY_TYPES } from "../src/lib/sharing.ts";
import { RESTORE_TEXT } from "../src/lib/labels.ts";
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
  await store.getState().restoreEntity({ entityType: "calendarEvent", payload: { id: "e1", title: "Prima della modifica", start: OLD, end: OLD, updatedAt: OLD }, entityId: "e1" });
  const events = store.getState().events;
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Prima della modifica");
  assert.ok(Date.parse(events[0].updatedAt) >= before, "updatedAt deve essere più recente: vince per LWW e arriva anche a chi ha la condivisione");
});

test("ripristino: un elemento eliminato da altri torna come nuovo, in fondo all'elenco", async () => {
  await store.getState().restoreEntity({ entityType: "task", payload: { id: "t2", title: "Eliminata da Bob", updatedAt: OLD }, entityId: "t2", complete: true });
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
  await store.getState().restoreEntity({ entityType: "calendarEvent", payload: { id: "e1", title: "Prima della modifica", start: OLD, end: OLD, updatedAt: OLD }, entityId: "e1" });
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
  await store.getState().restoreEntity({ entityType: "calendarEvent", payload: { id: "e1", title: "Prima della modifica", start: OLD, end: OLD, updatedAt: OLD }, entityId: "e1" });
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
      store.getState().restoreEntity({ entityType: type, payload, entityId }),
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

test("ripristino: copertina, file e UID restano quelli attuali del proprietario (la cronologia delle modifiche non li ha)", async () => {
  store.setState({
    events: [{ id: "e1", title: "Dopo la modifica", start: OLD, end: OLD, updatedAt: OLD, cover: "data:image/png;base64,AAAA", sourceUid: "barb-exam-1" }],
    attachments: [{ id: "a1", name: "Dopo", mimeType: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERi0=", updatedAt: OLD }]
  });
  // Versioni di una modifica: senza chiavi protette (sharing.sql le toglie).
  await store.getState().restoreEntity({ entityType: "calendarEvent", payload: { id: "e1", title: "Prima della modifica", start: OLD, end: OLD, updatedAt: OLD }, entityId: "e1" });
  await store.getState().restoreEntity({ entityType: "attachment", payload: { id: "a1", name: "Prima", mimeType: "application/pdf", updatedAt: OLD }, entityId: "a1" });
  const [event] = store.getState().events;
  const [attachment] = store.getState().attachments;
  assert.equal(event.title, "Prima della modifica");
  assert.equal(event.cover, "data:image/png;base64,AAAA");
  assert.equal(event.sourceUid, "barb-exam-1");
  assert.equal(attachment.name, "Prima");
  assert.equal(attachment.dataUrl, "data:application/pdf;base64,JVBERi0=");
  // Una versione vecchia con le sue chiavi (salvata prima della regola) non riporta un file superato.
  await store.getState().restoreEntity({ entityType: "attachment", payload: { id: "a1", name: "Vecchia", mimeType: "application/pdf", dataUrl: "data:vecchio", updatedAt: OLD }, entityId: "a1" });
  assert.equal(store.getState().attachments[0].dataUrl, "data:application/pdf;base64,JVBERi0=");
  // Eliminato da altri: nessuna copia locale, la versione (un'eliminazione) porta il suo file.
  await store.getState().restoreEntity({ entityType: "attachment", payload: { id: "a2", name: "Eliminato", mimeType: "application/pdf", dataUrl: "data:a2", updatedAt: OLD }, entityId: "a2", complete: true });
  assert.equal(store.getState().attachments.find((entry) => entry.id === "a2").dataUrl, "data:a2");
});

test("ripristino di più elementi insieme: un salvataggio solo, le versioni non valide si saltano", async () => {
  let writes = 0;
  const unsubscribe = store.subscribe((state, previous) => {
    if (state.events !== previous.events || state.tasks !== previous.tasks) writes += 1;
  });
  const count = await store.getState().restoreEntities([
    { entityType: "calendarEvent", payload: { id: "e1", title: "Prima", start: OLD, end: OLD, updatedAt: OLD }, entityId: "e1" },
    { entityType: "task", payload: { id: "t2", title: "Eliminata da Bob", updatedAt: OLD }, entityId: "t2", complete: true },
    { entityType: "task", payload: { id: "t1", title: "Punta altrove" }, entityId: "altro" },
    { entityType: "preferences", payload: { id: "main", displayName: "Bob" }, entityId: "main" }
  ]);
  unsubscribe();
  assert.equal(count, 2);
  assert.equal(writes, 1);
  assert.equal(store.getState().events[0].title, "Prima");
  assert.deepEqual(store.getState().tasks.map((task) => task.id), ["t1", "t2"]);
  assert.equal(store.getState().tasks[0].title, "Attività");
  assert.equal(store.getState().preferences[0].displayName, "Alice");
  assert.equal(await store.getState().restoreEntities([{ entityType: "preferences", payload: { id: "main" }, entityId: "main" }]), 0);
});

test("ripristino: la versione di una modifica non riscrive senza file un elemento sparito nel frattempo", async () => {
  // Il controllo ha visto l'allegato tra i miei dati; poi la sync ha applicato l'eliminazione di Bob.
  store.setState({ attachments: [{ id: "a1", name: "Rinominato da Bob", mimeType: "application/pdf", dataUrl: "data:file", updatedAt: OLD }] });
  const edit = { entityType: "attachment", entityId: "a1", payload: { id: "a1", name: "Appunti.pdf", mimeType: "application/pdf", updatedAt: OLD } };
  store.setState({ attachments: [] });
  let writes = 0;
  const unsubscribe = store.subscribe(() => {
    writes += 1;
  });
  assert.equal(await store.getState().restoreEntities([edit]), 0);
  await assert.rejects(store.getState().restoreEntity(edit), (error) => error instanceof ShareUserError && error.message === RESTORE_TEXT.notHere);
  unsubscribe();
  assert.equal(writes, 0, "nessun allegato senza file, e niente da inviare");
  assert.deepEqual(store.getState().attachments, []);
  // Con l'eliminazione salvata dopo, il file torna.
  assert.equal(await store.getState().restoreEntities([{ ...edit, protectedFrom: { id: "a1", name: "Rinominato da Bob", dataUrl: "data:file" } }]), 1);
  assert.deepEqual(
    store.getState().attachments.map(({ name, dataUrl }) => [name, dataUrl]),
    [["Appunti.pdf", "data:file"]]
  );
});

test("ripristino: obiettivi, note, sessioni e argomenti (senza file) tornano anche se non ci sono più", async () => {
  store.setState({ goals: [], notes: [] });
  const count = await store.getState().restoreEntities([
    { entityType: "goal", entityId: "g1", payload: { id: "g1", title: "Prima", updatedAt: OLD } },
    { entityType: "note", entityId: "n1", payload: { id: "n1", title: "Prima", updatedAt: OLD } }
  ]);
  assert.equal(count, 2);
  assert.deepEqual(store.getState().goals.map((goal) => goal.title), ["Prima"]);
  assert.deepEqual(store.getState().notes.map((note) => note.title), ["Prima"]);
});

test("ripristino di un'eliminazione: il file della versione completa una copia attuale che l'ha perso", async () => {
  store.setState({ attachments: [{ id: "a1", name: "Guscio", mimeType: "application/pdf", updatedAt: OLD }] });
  await store.getState().restoreEntity({
    entityType: "attachment",
    entityId: "a1",
    payload: { id: "a1", name: "Appunti.pdf", mimeType: "application/pdf", dataUrl: "data:file", updatedAt: OLD },
    complete: true
  });
  assert.deepEqual(store.getState().attachments.map(({ name, dataUrl }) => [name, dataUrl]), [["Appunti.pdf", "data:file"]]);
});
