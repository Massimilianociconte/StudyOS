import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { sharedKey, sharedPushBatches } from "../src/lib/sharing.ts";
import { sharedOfTypes, useSharedStore } from "../src/store/useSharedStore.ts";

// Solo memoria (`persistent: false`, come col vault attivo): niente IndexedDB in Node.
// La persistenza su Dexie è provata a parte, su un database v5 reale.
const grant = (extra) => ({
  id: "g", ownerId: "alice", ownerName: "Alice", scope: "calendar", subjectIds: [], permission: "edit",
  granteeUserId: "bob", granteeGroupId: null, granteeName: "Bob", granteeEmail: null, createdAt: "", updatedAt: "", ...extra
});

const row = (id, extra = {}, deleted = false) => ({
  entity_type: "calendarEvent",
  entity_id: id,
  payload: deleted ? { id, deletedAt: extra.deletedAt } : { id, title: id, updatedAt: "2026-11-10T10:00:00.000Z", ...extra },
  deleted,
  updated_at: "2026-11-10T10:00:01Z"
});

const store = useSharedStore;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(() => {
  store.setState({
    viewerId: "bob", persistent: false, received: [grant()], given: [], invites: [], items: [], labels: [], outbox: [], hiddenOwners: [], notice: null, syncError: null
  });
});

test("salvataggio: cache aggiornata subito, voce in coda, collegamenti del proprietario intatti", async () => {
  await store.getState().applyRows("alice", [row("e1", { attachmentIds: ["att-alice"] })]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "Spostato", updatedAt: "x", attachmentIds: ["att-bob"] });
  const [cached] = store.getState().items;
  assert.equal(cached.entity.title, "Spostato");
  assert.deepEqual(cached.entity.attachmentIds, ["att-alice"]);
  assert.equal(cached.serverUpdatedAt, "2026-11-10T10:00:01Z");
  assert.equal(store.getState().outbox.length, 1);
  assert.equal(store.getState().outbox[0].key, sharedKey("alice", "calendarEvent", "e1"));
  const { batches } = sharedPushBatches(store.getState().outbox, store.getState().items);
  assert.equal(batches[0].rows[0].payload.title, "Spostato");
});

test("scritture non consentite: errore e niente in cache né in coda", async () => {
  store.setState({ received: [grant({ permission: "view" })] });
  await store.getState().applyRows("alice", [row("e1")]);
  await assert.rejects(store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "x", updatedAt: "x" }), /solo vedere/);
  await assert.rejects(store.getState().deleteSharedItem("alice", "calendarEvent", "e1"), /solo vedere/);
  assert.equal(store.getState().items.length, 1);
  assert.equal(store.getState().items[0].entity.title, "e1");
  assert.equal(store.getState().outbox.length, 0);
});

test("eliminazione: via dalla cache, tombstone ridotto in coda", async () => {
  await store.getState().applyRows("alice", [row("e1")]);
  await store.getState().deleteSharedItem("alice", "calendarEvent", "e1");
  assert.equal(store.getState().items.length, 0);
  const { batches } = sharedPushBatches(store.getState().outbox, store.getState().items);
  assert.deepEqual(Object.keys(batches[0].rows[0].payload).sort(), ["deletedAt", "id"]);
  assert.equal(batches[0].rows[0].deleted, true);
});

test("righe del server: una eliminazione in coda non torna in vita con una riga più vecchia", async () => {
  await store.getState().applyRows("alice", [row("e1")]);
  await store.getState().deleteSharedItem("alice", "calendarEvent", "e1");
  await store.getState().applyRows("alice", [row("e1", { updatedAt: "2000-01-01T00:00:00.000Z" })]);
  assert.equal(store.getState().items.length, 0);
  // Una modifica del proprietario successiva all'eliminazione vince (stessa regola delle modifiche in coda).
  await store.getState().applyRows("alice", [row("e1", { updatedAt: "2999-01-01T00:00:00.000Z" })]);
  assert.equal(store.getState().items.length, 1);
});

test("coda: si svuota solo ciò che è stato inviato, una modifica successiva resta", async () => {
  await store.getState().applyRows("alice", [row("e1"), row("e2")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "uno", updatedAt: "x" });
  const sent = [...store.getState().outbox];
  await wait(5);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "uno bis", updatedAt: "x" });
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e2", title: "due", updatedAt: "x" });
  await store.getState().settleOutbox(sent);
  assert.deepEqual(store.getState().outbox.map((entry) => entry.entityId).sort(), ["e1", "e2"]);
  await store.getState().settleOutbox(store.getState().outbox);
  assert.equal(store.getState().outbox.length, 0);
});

test("revoca: via gli elementi non più condivisi, restano quelli con scritture in coda", async () => {
  await store.getState().applyRows("alice", [row("e1"), row("e2")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e2", title: "in coda", updatedAt: "x" });
  await store.getState().setShares([], [], []);
  assert.deepEqual(store.getState().items.map((entry) => entry.entityId), ["e2"]);
});

test("viste: gli elementi delle persone nascoste non compaiono", async () => {
  await store.getState().applyRows("alice", [row("e1")]);
  await store.getState().applyRows("dario", [row("e1")]);
  assert.equal(sharedOfTypes(store.getState(), ["calendarEvent"]).length, 2);
  store.getState().toggleOwner("dario");
  assert.deepEqual(sharedOfTypes(store.getState(), ["calendarEvent"]).map((entry) => entry.ownerId), ["alice"]);
  assert.equal(sharedOfTypes(store.getState(), ["task"]).length, 0);
  store.getState().toggleOwner("dario");
  assert.equal(sharedOfTypes(store.getState(), ["calendarEvent"]).length, 2);
});

test("vault bloccato: la memoria si svuota, disponibilità e persone nascoste restano", () => {
  store.setState({ availability: "ready", hiddenOwners: ["dario"] });
  store.getState().forgetMemory();
  assert.equal(store.getState().items.length, 0);
  assert.equal(store.getState().received.length, 0);
  assert.equal(store.getState().viewerId, null);
  assert.equal(store.getState().availability, "ready");
  assert.deepEqual(store.getState().hiddenOwners, ["dario"]);
});
