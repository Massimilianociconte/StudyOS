import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { ShareUserError, sharedKey, sharedPushBatches } from "../src/lib/sharing.ts";
import { readUiState } from "../src/lib/uiState.ts";
import { sharedOfTypes, useSharedStore } from "../src/store/useSharedStore.ts";
import { ViewerChanged, createViewerLifecycle } from "../src/lib/shareViewer.ts";

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
  // Testo già pronto per l'utente (in italiano), marcato: le viste lo mostrano così com'è.
  const refused = (cause) => cause instanceof ShareUserError && /solo vedere/.test(cause.message);
  await assert.rejects(store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "x", updatedAt: "x" }), refused);
  await assert.rejects(store.getState().deleteSharedItem("alice", "calendarEvent", "e1"), refused);
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
  // Inviata la scrittura (rifiutata dal server), l'elemento non più condiviso sparisce anche dalla cache.
  await store.getState().settleOutbox(store.getState().outbox);
  assert.equal(store.getState().outbox.length, 0);
  assert.equal(store.getState().items.length, 0);
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

test("eliminare un elemento mai arrivato al server: via cache e coda, nessun tombstone", async () => {
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "nuovo", title: "Creato offline", updatedAt: "x" });
  assert.equal(store.getState().outbox.length, 1);
  await store.getState().deleteSharedItem("alice", "calendarEvent", "nuovo");
  assert.equal(store.getState().items.length, 0);
  assert.equal(store.getState().outbox.length, 0);
  // Un elemento che il server conosce (anche con una modifica in coda) si elimina con un tombstone.
  await store.getState().applyRows("alice", [row("e1")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "modificato", updatedAt: "x" });
  await store.getState().deleteSharedItem("alice", "calendarEvent", "e1");
  assert.deepEqual(store.getState().outbox.map((entry) => [entry.entityId, entry.deleted]), [["e1", true]]);
  // Creato e già inviato (coda svuotata, non ancora riletto dal server): serve il tombstone.
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "inviato", title: "x", updatedAt: "x" });
  await store.getState().settleOutbox(store.getState().outbox.filter((entry) => entry.entityId === "inviato"));
  await store.getState().deleteSharedItem("alice", "calendarEvent", "inviato");
  assert.ok(store.getState().outbox.some((entry) => entry.entityId === "inviato" && entry.deleted));
});

test("dopo logout o blocco del vault, le risposte in ritardo non riempiono la memoria", async () => {
  await store.getState().applyRows("alice", [row("e1")]);
  store.getState().forgetMemory();
  assert.equal(store.getState().viewerId, null);
  await store.getState().applyRows("alice", [row("e1")]);
  await store.getState().reconcile("alice", ["calendarEvent"], new Set());
  await store.getState().setShares([], [grant()], []);
  assert.equal(store.getState().items.length, 0);
  assert.equal(store.getState().received.length, 0);
  await store.getState().clear();
  assert.equal(store.getState().viewerId, null);
  await store.getState().applyRows("alice", [row("e1")]);
  await store.getState().setShares([], [grant()], []);
  assert.equal(store.getState().items.length, 0);
  assert.equal(store.getState().received.length, 0);
});

test("reset: clear() azzera anche le persone nascoste, in memoria e nel dispositivo", async () => {
  store.getState().toggleOwner("dario");
  assert.deepEqual(readUiState("sharing.hiddenOwners", "device"), ["dario"]);
  await store.getState().clear();
  assert.deepEqual(store.getState().hiddenOwners, []);
  assert.deepEqual(readUiState("sharing.hiddenOwners", "device"), []);
  assert.equal(store.getState().availability, "off");
});

// Node non ha IndexedDB: con `persistent: true` ogni accesso a Dexie fallisce, come quota piena o archivio bloccato.
test("archivio non disponibile: le scritture riescono in memoria e la cache passa alla sola memoria", async () => {
  store.setState({ persistent: true });
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n1", title: "Nuovo", updatedAt: "x" });
  assert.equal(store.getState().items.length, 1);
  assert.equal(store.getState().outbox.length, 1);
  assert.equal(store.getState().persistent, false);
  assert.match(store.getState().syncError, /memoria/);

  store.setState({ persistent: true, syncError: null });
  await store.getState().applyRows("alice", [row("e1")]);
  assert.equal(store.getState().items.length, 2);
  assert.equal(store.getState().persistent, false);
  assert.ok(store.getState().syncError);

  store.setState({ persistent: true, syncError: null });
  await store.getState().deleteSharedItem("alice", "calendarEvent", "e1");
  assert.ok(store.getState().outbox.some((entry) => entry.entityId === "e1" && entry.deleted));
  assert.equal(store.getState().persistent, false);

  store.setState({ persistent: true, syncError: null });
  await store.getState().setShares([], [grant()], []);
  assert.equal(store.getState().received.length, 1);
  assert.equal(store.getState().persistent, false);
  assert.ok(store.getState().syncError);
});

test("archivio non disponibile all'avvio: hydrate resta in memoria e lo segnala, senza il vault no", async () => {
  await store.getState().hydrate("bob", true);
  assert.equal(store.getState().viewerId, "bob");
  assert.equal(store.getState().persistent, false);
  assert.match(store.getState().syncError, /memoria/);
  await store.getState().hydrate("bob", false);
  assert.equal(store.getState().persistent, false);
  assert.equal(store.getState().syncError, null);
});

// H3: dopo un invio accettato la riga esiste sul server, anche se qui l'elemento sembrava "mai arrivato".
test("creato ed eliminato mentre il suo invio era in corso: tombstone dopo l'accettazione, il pull non lo riporta", async () => {
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n1", title: "Nuovo", updatedAt: "x" });
  const createdAt = store.getState().items[0].entity.updatedAt;
  const sent = [...store.getState().outbox];
  // Durante l'invio: senza versione del server, l'eliminazione non accoda nulla.
  await store.getState().deleteSharedItem("alice", "calendarEvent", "n1");
  assert.equal(store.getState().outbox.length, 0);
  await wait(5);
  await store.getState().settlePushed(sent, sent);
  assert.deepEqual(store.getState().outbox.map((entry) => [entry.entityId, entry.deleted]), [["n1", true]]);
  assert.equal(store.getState().items.length, 0);
  // La riga appena creata torna col pull: resta eliminata, e il prossimo invio la elimina sul server.
  await store.getState().applyRows("alice", [row("n1", { updatedAt: createdAt })]);
  assert.equal(store.getState().items.length, 0);
  const { batches } = sharedPushBatches(store.getState().outbox, store.getState().items);
  assert.deepEqual(batches[0].rows.map((entry) => [entry.entity_id, entry.deleted, Object.keys(entry.payload).sort()]), [["n1", true, ["deletedAt", "id"]]]);
});

test("creato e inviato, poi modificato ed eliminato prima del pull: l'eliminazione accoda il tombstone", async () => {
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n2", title: "Nuovo", updatedAt: "x" });
  const sent = [...store.getState().outbox];
  await store.getState().settlePushed(sent, sent);
  assert.equal(store.getState().outbox.length, 0);
  assert.notEqual(store.getState().items[0].serverUpdatedAt, "");
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n2", title: "Modificato", updatedAt: "x" });
  await store.getState().deleteSharedItem("alice", "calendarEvent", "n2");
  assert.equal(store.getState().items.length, 0);
  assert.deepEqual(store.getState().outbox.map((entry) => [entry.entityId, entry.deleted]), [["n2", true]]);
});

test("fine invio: le voci rifiutate non diventano note al server, le modifiche fatte durante l'invio restano in coda", async () => {
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "r1", title: "Rifiutato", updatedAt: "x" });
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "a1", title: "Accettato", updatedAt: "x" });
  const sent = [...store.getState().outbox];
  await wait(5);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "a1", title: "Accettato bis", updatedAt: "x" });
  await store.getState().settlePushed(sent, sent.filter((entry) => entry.entityId === "a1"));
  const byId = Object.fromEntries(store.getState().items.map((entry) => [entry.entityId, entry]));
  assert.equal(byId.r1.serverUpdatedAt, "");
  assert.notEqual(byId.a1.serverUpdatedAt, "");
  assert.deepEqual(store.getState().outbox.map((entry) => [entry.entityId, entry.deleted]), [["a1", false]]);
  // Un elemento già noto al server conserva la sua versione.
  await store.getState().applyRows("alice", [row("e1")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "modificato", updatedAt: "x" });
  const edit = store.getState().outbox.filter((entry) => entry.entityId === "e1");
  await store.getState().settlePushed(edit, edit);
  assert.equal(store.getState().items.find((entry) => entry.entityId === "e1").serverUpdatedAt, "2026-11-10T10:00:01Z");
});

test("fine invio dopo logout o blocco del vault: nessun effetto", async () => {
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n3", title: "Nuovo", updatedAt: "x" });
  const sent = [...store.getState().outbox];
  store.getState().forgetMemory();
  await store.getState().settlePushed(sent, sent);
  assert.equal(store.getState().outbox.length, 0);
  assert.equal(store.getState().items.length, 0);
});

// In Node ogni accesso al disco fallisce: un tentativo di scrittura lascerebbe l'avviso dell'archivio.
test("vault attivato durante un aggiornamento: da hydrate(…, false) in poi nessuna scrittura su disco", async () => {
  store.setState({ persistent: true, syncError: null });
  const errors = [];
  const unsubscribe = store.subscribe((state) => {
    if (state.syncError) errors.push(state.syncError);
  });
  const shares = store.getState().setShares([], [grant()], []);
  const hydrate = store.getState().hydrate("bob", false);
  assert.equal(store.getState().persistent, false);
  await Promise.all([shares, hydrate]);
  unsubscribe();
  assert.deepEqual(errors, []);
  assert.equal(store.getState().persistent, false);
});


// ——— Chi guarda (shareViewer.ts, usato da shareSync.ts) ———

/** Ciclo di vita con agganci finti: `ready` registra la generazione per cui parte la prima passata. */
const viewerLifecycle = (overrides = {}) => {
  const state = { locked: false, ready: [] };
  const viewers = createViewerLifecycle({
    reset: async () => {},
    isLocked: () => state.locked,
    isPersistent: () => false,
    ready: () => state.ready.push(viewers.generation),
    ...overrides
  });
  return { viewers, state };
};

// H1: ogni cambio di chi guarda fa salire la generazione; ciò che era partito prima si ferma.
test("H1: dopo un cambio di account la passata vecchia si ferma e la nuova parte solo a store caricato", async () => {
  const { viewers, state } = viewerLifecycle();
  viewers.setViewer("bob");
  assert.equal(viewers.isHydrated(viewers.generation), false);
  await viewers.settled();
  assert.equal(store.getState().viewerId, "bob");
  assert.deepEqual(state.ready, [1]);
  assert.equal(viewers.isHydrated(1), true);

  // Una passata di Bob in corso (risposta del server in arrivo) quando entra Carol.
  const gen = viewers.generation;
  viewers.setViewer("carol");
  assert.throws(() => viewers.still(gen), ViewerChanged);
  assert.equal(viewers.isHydrated(viewers.generation), false);
  await viewers.settled();
  assert.equal(store.getState().viewerId, "carol");
  assert.deepEqual(state.ready, [1, 2]);
  assert.doesNotThrow(() => viewers.still(viewers.generation));
  // Stessa sessione rinotificata: nessun cambio.
  viewers.setViewer("carol");
  assert.equal(viewers.generation, 2);
});

test("H1: cambi rapidi in fila, solo l'ultimo avvia la passata e lo store è del suo account", async () => {
  // Ogni cambio aspetta (Realtime da fermare): il secondo arriva mentre il primo carica.
  const { viewers, state } = viewerLifecycle({ reset: () => wait(5) });
  viewers.setViewer("bob");
  viewers.setViewer("carol");
  await viewers.settled();
  assert.equal(store.getState().viewerId, "carol");
  assert.deepEqual(state.ready, [2]);
  assert.equal(viewers.isHydrated(1), false);
  // Logout: via i dati altrui, nessuna passata.
  viewers.setViewer(null);
  await viewers.settled();
  assert.equal(store.getState().viewerId, null);
  assert.equal(store.getState().availability, "off");
  assert.deepEqual(state.ready, [2]);
});

test("H1: blocco del vault, memoria svuotata subito e niente passata fino allo sblocco", async () => {
  const { viewers, state } = viewerLifecycle();
  viewers.setViewer("bob");
  await viewers.settled();
  await store.getState().applyRows("alice", [row("e1")]);
  const gen = viewers.generation;
  state.locked = true;
  viewers.studyChanged({ locked: true, mode: "vault" }, { locked: false, mode: "vault" });
  // Subito, prima della fila: le viste non mostrano più dati altrui.
  assert.equal(store.getState().items.length, 0);
  assert.throws(() => viewers.still(gen), ViewerChanged);
  await viewers.settled();
  assert.equal(store.getState().viewerId, null);
  assert.deepEqual(state.ready, [1]);
  // Una risposta in ritardo della passata di prima non rimette nulla in memoria.
  await store.getState().applyRows("alice", [row("e1")]);
  assert.equal(store.getState().items.length, 0);
  state.locked = false;
  viewers.studyChanged({ locked: false, mode: "vault" }, { locked: true, mode: "vault" });
  await viewers.settled();
  assert.equal(store.getState().viewerId, "bob");
  assert.deepEqual(state.ready, [1, 3]);
});

// H2: resetAllData → useSharedStore.clear() con l'account ancora collegato (la sessione non cambia).
test("H2: dopo il reset locale la condivisione si ricarica senza ricaricare la pagina", async () => {
  const { viewers, state } = viewerLifecycle();
  const unwatch = viewers.watch();
  try {
    viewers.setViewer("bob");
    await viewers.settled();
    await store.getState().applyRows("alice", [row("e1")]);
    assert.equal(store.getState().items.length, 1);
    await store.getState().clear();
    await viewers.settled();
    assert.equal(store.getState().viewerId, "bob");
    assert.equal(store.getState().items.length, 0);
    assert.deepEqual(state.ready, [1, 2]);

    // Col vault bloccato no: ci pensa lo sblocco.
    state.locked = true;
    await store.getState().clear();
    await viewers.settled();
    assert.equal(store.getState().viewerId, null);
    assert.deepEqual(state.ready, [1, 2]);
    state.locked = false;

    // Logout vero: clear() senza account, nessun nuovo caricamento.
    viewers.setViewer(null);
    await viewers.settled();
    assert.equal(store.getState().viewerId, null);
    assert.deepEqual(state.ready, [1, 2]);
  } finally {
    unwatch();
  }
});
