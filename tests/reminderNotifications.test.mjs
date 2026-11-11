import test from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { planMerge } from "../src/lib/syncMerge.ts";
import { COLLECTIONS, ENTITY_TYPES } from "../src/lib/collections.ts";
import { notificationIdOf } from "../src/lib/eventReminders.ts";
import { isReminderNotificationId } from "../src/lib/reminderIds.ts";

// Due dispositivi dello stesso account (portatile e telefono) e la sync last-writer-wins.
// Solo memoria: con `loading` attivo lo store non scrive su IndexedDB (assente in Node).
const store = useStudyStore;
const HOUR = 60 * 60 * 1000;
const AT = Date.now() - 13 * HOUR; // il promemoria era ieri sera
const ID = notificationIdOf(`exam@2026-11-13#1d0m1800@${AT}`);
const reminder = { id: ID, kind: "system", title: "Esame", body: "Domani alle 09:00", linkView: "calendar", createdAt: new Date(AT).toISOString() };

/** Esegue `act` su un dispositivo con queste notifiche e ne restituisce le notifiche dopo. */
async function onDevice(notifications, act) {
  store.setState({ loading: true, notifications: structuredClone(notifications) });
  await act(store.getState());
  return store.getState().notifications;
}

const rowOf = (entity) => ({ entity_type: ENTITY_TYPES.notifications, entity_id: entity.id, payload: entity, deleted: false, updated_at: entity.updatedAt });
const tombstoneOf = (id, deletedAt) => ({ entity_type: ENTITY_TYPES.notifications, entity_id: id, payload: { id, deletedAt }, deleted: true, updated_at: deletedAt });

/** Pull: il piano di merge vero (syncMerge) applicato alle notifiche locali. */
function pull(local, rows) {
  const collections = Object.fromEntries(COLLECTIONS.map((key) => [key, []]));
  const plan = planMerge(rows, { ...collections, notifications: local }, new Map());
  const byId = new Map(local.map((item) => [item.id, item]));
  for (const change of plan.changes) {
    if (change.entity) byId.set(change.id, change.entity);
    else byId.delete(change.id);
  }
  return { notifications: [...byId.values()], plan };
}

const only = (list) => {
  assert.equal(list.length, 1);
  return list[0];
};

test("promemoria: la notifica recuperata è datata all'ora del promemoria, mai nel futuro", async () => {
  const [entry] = await onDevice([], (state) => state.addNotification(reminder));
  assert.equal(entry.createdAt, new Date(AT).toISOString());
  assert.equal(entry.updatedAt, entry.createdAt);
  const before = Date.now();
  const [future] = await onDevice([], (state) => state.addNotification({ ...reminder, createdAt: new Date(Date.now() + HOUR).toISOString() }));
  assert.ok(Date.parse(future.createdAt) >= before && Date.parse(future.createdAt) <= Date.now(), "nel futuro: adesso");
  const [bad] = await onDevice([], (state) => state.addNotification({ ...reminder, createdAt: "non una data" }));
  assert.ok(Date.parse(bad.createdAt) >= before, "non valida: adesso");
  const [plain] = await onDevice([], (state) => state.addNotification({ kind: "system", title: "Altro" }));
  assert.ok(Date.parse(plain.createdAt) >= before, "senza createdAt: adesso, come prima");
});

test("promemoria: Elimina archivia (l'id resta); le altre notifiche si tolgono come prima", async () => {
  assert.ok(isReminderNotificationId(ID));
  const other = { id: "notif-share-1", kind: "share", title: "Condivisione", body: "", createdAt: new Date(AT).toISOString() };
  const after = await onDevice([], async (state) => {
    await state.addNotification(reminder);
    await state.addNotification(other);
    await state.deleteNotification(ID);
    await state.deleteNotification("notif-share-1");
  });
  const entry = only(after);
  assert.equal(entry.id, ID);
  assert.equal(entry.archived, true);
  assert.ok(Date.parse(entry.updatedAt) > AT, "l'eliminazione è più recente del promemoria");
  // Un nuovo recupero dello stesso promemoria non la rimette.
  const again = await onDevice(after, (state) => state.addNotification(reminder));
  assert.equal(only(again).archived, true);
});

test("sync, eliminata sul portatile: il telefono che la recupera non la fa tornare (in entrambi gli ordini)", async () => {
  // Portatile: avvisato ieri sera, poi eliminato dalla campanella.
  const laptop = await onDevice([], async (state) => {
    await state.addNotification(reminder);
    await state.deleteNotification(ID);
  });

  // Ordine 1: il telefono recupera il promemoria perso prima di scaricare.
  const phoneFirst = await onDevice([], (state) => state.addNotification(reminder));
  const phoneAfterPull = pull(phoneFirst, laptop.map(rowOf));
  assert.equal(only(phoneAfterPull.notifications).archived, true, "vince l'eliminazione, più recente");
  // Se il telefono ha spinto prima la sua copia, il portatile la scarta e rimanda la sua.
  const laptopAfterPull = pull(laptop, phoneFirst.map(rowOf));
  assert.equal(only(laptopAfterPull.notifications).archived, true);
  assert.deepEqual(laptopAfterPull.plan.requeue.map((item) => item.id), [ID]);

  // Ordine 2: il telefono scarica prima, poi recupera: trova l'id e non aggiunge niente.
  const phonePulled = pull([], laptop.map(rowOf)).notifications;
  const phoneThen = await onDevice(phonePulled, (state) => state.addNotification(reminder));
  assert.equal(only(phoneThen).archived, true);
  assert.equal(only(phoneThen).updatedAt, only(laptop).updatedAt, "nessuna nuova scrittura");
});

test("sync, letta sul portatile: il recupero sul telefono non la rende di nuovo non letta (in entrambi gli ordini)", async () => {
  const laptop = await onDevice([], async (state) => {
    await state.addNotification(reminder);
    await state.markNotificationRead(ID);
  });
  assert.ok(only(laptop).readAt);

  const phoneFirst = await onDevice([], (state) => state.addNotification(reminder));
  assert.ok(only(pull(phoneFirst, laptop.map(rowOf)).notifications).readAt, "telefono: vince la lettura");
  assert.ok(only(pull(laptop, phoneFirst.map(rowOf)).notifications).readAt, "portatile: resta letta");

  const phonePulled = pull([], laptop.map(rowOf)).notifications;
  const phoneThen = await onDevice(phonePulled, (state) => state.addNotification(reminder));
  assert.ok(only(phoneThen).readAt);
});

test("sync, eliminata da una versione vecchia dell'app (tombstone): il recupero più vecchio perde", async () => {
  const phone = await onDevice([], (state) => state.addNotification(reminder));
  const deletedAt = new Date(AT + HOUR).toISOString();
  assert.deepEqual(pull(phone, [tombstoneOf(ID, deletedAt)]).notifications, []);
});
