// Regressioni della sincronizzazione dei dati condivisi (audit della condivisione, punti 1-3, 5, 7-10, 12).
// Solo memoria (`persistent: false`, come col vault): niente IndexedDB in Node. shareSync.ts non si
// importa in Node (supabase.ts legge import.meta.env): le sue decisioni stanno in funzioni pure di
// sharing.ts, provate qui; il resto si controlla sul sorgente.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const memoryStorage = () => {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
};
globalThis.window = {
  localStorage: memoryStorage(),
  sessionStorage: memoryStorage(),
  dispatchEvent: () => true,
  location: { origin: "https://x.github.io", pathname: "/StudyOS/" }
};
globalThis.Event ??= class {
  constructor(type) {
    this.type = type;
  }
};

const {
  SHARE_PUSH_MAX_BYTES,
  afterRowFilter,
  prepareSharedWrite,
  pushEachBatch,
  failedBatchesLast,
  rowsForEntries,
  sharedKey,
  sharedPushBatches,
  sharedPushDenied,
  sharedPushOutcome,
  supersededOutboxKeys,
  isShareNetworkError,
  ShareUserError
} = await import("../src/lib/sharing.ts");
const { useSharedStore: store } = await import("../src/store/useSharedStore.ts");
const { createViewerLifecycle } = await import("../src/lib/shareViewer.ts");
const { clearPendingShare, readPendingShare, savePendingShare } = await import("../src/lib/shareInvite.ts");
const { SHARED_PENDING_TEXT } = await import("../src/lib/labels/sharing.ts");

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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

const entry = (id, extra = {}) => ({
  key: sharedKey("alice", "calendarEvent", id), ownerId: "alice", entityType: "calendarEvent", entityId: id, deleted: false, queuedAt: "2026-11-10T12:00:00.000Z", ...extra
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ids = (list) => list.map((candidate) => candidate.entityId).sort();
const later = (iso, ms) => new Date(Date.parse(iso) + ms).toISOString();

beforeEach(async () => {
  // clear() toglie anche ciò che un test ha messo da parte al blocco del vault.
  await store.getState().clear();
  store.setState({
    viewerId: "bob", persistent: false, received: [grant()], given: [], invites: [], items: [], labels: [], outbox: [], hiddenOwners: [], notice: null, syncError: null
  });
});

// ——— 1. Modifiche in coda e cambi del vault ———

test("1: vault attivato o tolto (stesso account): le modifiche in coda e gli elementi a cui puntano restano", async () => {
  await store.getState().applyRows("alice", [row("e1"), row("e2"), row("e3")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "Spostato offline", updatedAt: "x" });
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n1", title: "Nuovo offline", updatedAt: "x" });
  await store.getState().deleteSharedItem("alice", "calendarEvent", "e2");
  await store.getState().hydrate("bob", false);
  const state = store.getState();
  assert.deepEqual(state.outbox.map((candidate) => [candidate.entityId, candidate.deleted]).sort(), [["e1", false], ["e2", true], ["n1", false]]);
  // Restano solo gli elementi delle modifiche in coda (il resto si riscarica), con il contenuto modificato.
  assert.deepEqual(ids(state.items), ["e1", "n1"]);
  assert.equal(state.items.find((candidate) => candidate.entityId === "e1").entity.title, "Spostato offline");
  const { batches } = sharedPushBatches(state.outbox, state.items);
  assert.deepEqual(batches[0].rows.map((candidate) => candidate.entity_id).sort(), ["e1", "e2", "n1"]);
});

test("1: blocco e sblocco del vault: le modifiche messe da parte tornano allo stesso account, le viste non le vedono", async () => {
  await store.getState().applyRows("alice", [row("e1")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "Spostato offline", updatedAt: "x" });
  store.getState().forgetMemory();
  // Vault bloccato: niente in memoria per le viste. Una seconda chiamata (in fila) non le perde.
  assert.equal(store.getState().items.length, 0);
  assert.equal(store.getState().outbox.length, 0);
  store.getState().forgetMemory();
  await store.getState().hydrate("bob", false);
  assert.deepEqual(store.getState().outbox.map((candidate) => candidate.entityId), ["e1"]);
  assert.equal(store.getState().items[0].entity.title, "Spostato offline");
  // Riprese una volta sola.
  await store.getState().settleOutbox(store.getState().outbox);
  await store.getState().hydrate("bob", false);
  assert.equal(store.getState().outbox.length, 0);
});

test("1: un altro account non eredita le modifiche in coda, e il logout le scarta", async () => {
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n1", title: "Di Bob", updatedAt: "x" });
  await store.getState().hydrate("carol", false);
  assert.equal(store.getState().outbox.length, 0);
  assert.equal(store.getState().items.length, 0);

  await store.getState().hydrate("bob", false);
  store.setState({ received: [grant()] });
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n2", title: "Di Bob", updatedAt: "x" });
  store.getState().forgetMemory();
  await store.getState().hydrate("carol", false);
  assert.equal(store.getState().outbox.length, 0);
  await store.getState().hydrate("bob", false);
  assert.equal(store.getState().outbox.length, 0, "messe da parte per Bob, ma l'accesso di Carol le ha scartate");

  store.setState({ received: [grant()] });
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n3", title: "Di Bob", updatedAt: "x" });
  store.getState().forgetMemory();
  await store.getState().clear();
  await store.getState().hydrate("bob", false);
  assert.equal(store.getState().outbox.length, 0);
});

test("1: passaggio a una cache su disco che non risponde: le modifiche restano almeno in memoria", async () => {
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n1", title: "Nuovo", updatedAt: "x" });
  await store.getState().hydrate("bob", true);
  assert.equal(store.getState().persistent, false);
  assert.deepEqual(store.getState().outbox.map((candidate) => candidate.entityId), ["n1"]);
  assert.deepEqual(ids(store.getState().items), ["n1"]);
});

test("1: dal ciclo di chi guarda: blocco, sblocco e cambio di modalità tengono la coda", async () => {
  const state = { locked: false };
  const viewers = createViewerLifecycle({ reset: async () => {}, isLocked: () => state.locked, isPersistent: () => false, ready: () => {} });
  viewers.setViewer("bob");
  await viewers.settled();
  store.setState({ received: [grant()] });
  await store.getState().applyRows("alice", [row("e1")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "Spostato", updatedAt: "x" });
  state.locked = true;
  viewers.studyChanged({ locked: true, mode: "vault" }, { locked: false, mode: "vault" });
  await viewers.settled();
  assert.equal(store.getState().outbox.length, 0);
  state.locked = false;
  viewers.studyChanged({ locked: false, mode: "vault" }, { locked: true, mode: "vault" });
  await viewers.settled();
  assert.deepEqual(store.getState().outbox.map((candidate) => candidate.entityId), ["e1"]);
  // Vault tolto: stesso account, la coda resta.
  viewers.studyChanged({ locked: false, mode: "standard" }, { locked: false, mode: "vault" });
  await viewers.settled();
  assert.deepEqual(store.getState().outbox.map((candidate) => candidate.entityId), ["e1"]);
});

test("1: l'uscita dall'account avvisa anche delle modifiche ai dati condivisi non ancora inviate", () => {
  assert.match(SHARED_PENDING_TEXT.leave(1), /^1 modifica .* si perde\./);
  assert.match(SHARED_PENDING_TEXT.leave(3), /^3 modifiche .* si perdono\./);
  const panel = source("src/components/CloudPanel.tsx");
  assert.match(panel, /useSharedStore\(\(state\) => state\.outbox\.length\)/);
  assert.match(panel, /sync\.pendingCount > 0 \|\| sharedPending > 0/);
  assert.match(panel, /SHARED_PENDING_TEXT\.leave\(sharedPending\)/);
  // «Sincronizza ora» invia anche la coda condivisa, caricando shareSync solo allora (fuori dal bundle iniziale).
  assert.match(panel, /import\("\.\.\/lib\/shareSync"\)\.then\(\(module\) => module\.syncSharedNow\(\)\)/);
  assert.doesNotMatch(panel, /from "\.\.\/lib\/shareSync"/);
});

// ——— 2. Invio con risposta persa ———

test("2: creato, invio tentato con risposta persa, poi eliminato: parte il tombstone e il pull non lo riporta", async () => {
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n1", title: "Nuovo", updatedAt: "x" });
  const createdAt = store.getState().items[0].entity.updatedAt;
  await store.getState().markAttempted(store.getState().outbox);
  assert.equal(store.getState().outbox[0].attempted, true);
  // La risposta non arriva: niente settlePushed. Poi l'eliminazione.
  await store.getState().deleteSharedItem("alice", "calendarEvent", "n1");
  assert.deepEqual(store.getState().outbox.map((candidate) => [candidate.entityId, candidate.deleted]), [["n1", true]]);
  // La riga era stata scritta: il pull la porta, ma resta eliminata e parte il tombstone.
  await store.getState().applyRows("alice", [row("n1", { title: "Nuovo", updatedAt: createdAt })]);
  assert.equal(store.getState().items.length, 0);
  const { batches } = sharedPushBatches(store.getState().outbox, store.getState().items);
  assert.deepEqual(batches[0].rows.map((candidate) => [candidate.entity_id, candidate.deleted]), [["n1", true]]);
});

test("2: una modifica dopo l'invio tentato resta \"forse sul server\"; senza tentativo nessun tombstone", async () => {
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n1", title: "Nuovo", updatedAt: "x" });
  await store.getState().markAttempted(store.getState().outbox);
  await wait(2);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n1", title: "Nuovo bis", updatedAt: "x" });
  assert.equal(store.getState().outbox[0].attempted, true);
  await store.getState().deleteSharedItem("alice", "calendarEvent", "n1");
  assert.deepEqual(store.getState().outbox.map((candidate) => [candidate.entityId, candidate.deleted]), [["n1", true]]);

  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "n2", title: "Mai inviato", updatedAt: "x" });
  await store.getState().deleteSharedItem("alice", "calendarEvent", "n2");
  assert.ok(!store.getState().outbox.some((candidate) => candidate.entityId === "n2"));
});

test("2: segnate come tentate solo le voci inviate; una seconda volta non cambia la coda", async () => {
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "a", title: "A", updatedAt: "x" });
  const sent = [...store.getState().outbox];
  await wait(2);
  // Modificata durante l'invio: un'altra voce (queuedAt diverso), non ancora tentata.
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "a", title: "A bis", updatedAt: "x" });
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "b", title: "B", updatedAt: "x" });
  await store.getState().markAttempted(sent);
  assert.deepEqual(store.getState().outbox.map((candidate) => [candidate.entityId, Boolean(candidate.attempted)]), [["a", false], ["b", false]]);
  await store.getState().markAttempted(store.getState().outbox);
  const outbox = store.getState().outbox;
  assert.ok(outbox.every((candidate) => candidate.attempted));
  await store.getState().markAttempted(outbox);
  assert.equal(store.getState().outbox, outbox);
});

test("2: un tombstone rifiutato perché la riga non c'è (o è già eliminata) non dice che il permesso è stato tolto", () => {
  const tombstone = entry("e1", { deleted: true, deletedAt: "2026-11-10T12:00:00.000Z" });
  const edit = entry("e2");
  const denied = () => "denied";
  const missing = rowsForEntries("alice", [tombstone], []);
  assert.equal(missing[0].deleted, true);
  assert.equal(sharedPushDenied([tombstone], denied, missing), false);
  assert.equal(sharedPushDenied([tombstone], denied, [row("e1", { deletedAt: "2026-11-10T11:00:00.000Z" }, true)]), false);
  // La riga è ancora lì e visibile: il permesso non c'è davvero.
  assert.equal(sharedPushDenied([tombstone], denied, [row("e1")]), true);
  assert.equal(sharedPushDenied([edit], denied, [row("e2")]), true);
  assert.equal(sharedPushDenied([edit], () => "stale", [row("e2")]), false);
});

// ——— 3. Orologi diversi ———

test("3: la modifica di chi riceve usa l'ora attuale anche con l'orologio del proprietario avanti", () => {
  // Un timbro «versione + 1 ms» nel futuro verrebbe accettato e poi riportato a now() dal trigger del
  // server: il dispositivo del proprietario ripubblicherebbe la sua copia sopra, senza avviso. Finché il
  // server non lo gestisce, la modifica perde subito ("stale") e chi la fa lo vede.
  const ahead = new Date(Date.now() + 5 * 60_000).toISOString();
  const now = new Date().toISOString();
  assert.equal(prepareSharedWrite({ id: "e1", updatedAt: ahead }, { id: "e1", title: "x" }, now).updatedAt, now);
  assert.equal(prepareSharedWrite({ id: "e1", updatedAt: "2026-11-10T10:00:00.000Z" }, { id: "e1" }, "2026-11-10T12:00:00.000Z").updatedAt, "2026-11-10T12:00:00.000Z");
  assert.equal(prepareSharedWrite(undefined, { id: "n1" }, "2026-11-10T12:00:00.000Z").updatedAt, "2026-11-10T12:00:00.000Z");
});

// ——— 5. Voci rifiutate ———

test("5: esito di un lotto: accettate e rifiutate, una voce senza risposta conta come rifiutata", () => {
  const entries = [entry("a"), entry("b"), entry("c")];
  const outcome = sharedPushOutcome("alice", entries, [
    { entity_type: "calendarEvent", entity_id: "a", accepted: true, reason: null },
    { entity_type: "calendarEvent", entity_id: "b", accepted: false, reason: "stale" }
  ]);
  assert.deepEqual(ids(outcome.accepted), ["a"]);
  assert.deepEqual(ids(outcome.rejected), ["b", "c"]);
  assert.equal(outcome.reason(entries[1]), "stale");
  assert.equal(outcome.reason(entries[2]), null);
  const rows = rowsForEntries("alice", outcome.rejected, [row("b", { title: "Server" }), { ...row("b"), entity_type: "task" }]);
  assert.deepEqual(rows.map((candidate) => [candidate.entity_id, candidate.deleted, candidate.payload.title ?? null]), [["b", false, "Server"], ["c", true, null]]);
});

test("5: una voce rifiutata esce dalla coda solo con la riga riletta; se la rilettura non arriva resta in coda", async () => {
  await store.getState().applyRows("alice", [row("e1", { title: "Del server" }), row("e2")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "Rifiutata", updatedAt: "x" });
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e2", title: "Accettata", updatedAt: "x" });
  const sent = [...store.getState().outbox];
  const { accepted, rejected } = sharedPushOutcome("alice", sent, [
    { entity_type: "calendarEvent", entity_id: "e1", accepted: false, reason: "denied" },
    { entity_type: "calendarEvent", entity_id: "e2", accepted: true, reason: null }
  ]);
  await store.getState().settlePushed(accepted, accepted);
  // Rilettura fallita: la modifica rifiutata resta in coda (la prossima passata riprova), non sembra salvata.
  assert.deepEqual(store.getState().outbox.map((candidate) => candidate.entityId), ["e1"]);
  // Rilettura riuscita: esce dalla coda e la cache mostra la versione del server, anche se la mia era più recente.
  await store.getState().settleRejected("alice", rejected, rowsForEntries("alice", rejected, [row("e1", { title: "Del server" })]));
  assert.equal(store.getState().outbox.length, 0);
  assert.equal(store.getState().items.find((candidate) => candidate.entityId === "e1").entity.title, "Del server");
  assert.equal(store.getState().items.find((candidate) => candidate.entityId === "e2").entity.title, "Accettata");
});

test("5: rilettura di una riga non più visibile toglie l'elemento; una modifica fatta durante l'invio resta in coda", async () => {
  await store.getState().applyRows("alice", [row("e1"), row("e2")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e1", title: "Rifiutata", updatedAt: "x" });
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e2", title: "Rifiutata", updatedAt: "x" });
  const sent = [...store.getState().outbox];
  await wait(2);
  await store.getState().saveSharedItem("alice", "calendarEvent", { id: "e2", title: "Modificata durante l'invio", updatedAt: "x" });
  await store.getState().settleRejected("alice", sent, rowsForEntries("alice", sent, [row("e2")]));
  assert.ok(!store.getState().items.some((candidate) => candidate.entityId === "e1"));
  assert.deepEqual(store.getState().outbox.map((candidate) => candidate.entityId), ["e2"]);
  assert.equal(store.getState().items.find((candidate) => candidate.entityId === "e2").entity.title, "Modificata durante l'invio");
});

test("5: shareSync toglie dalla coda solo le accettate e le rifiutate dopo la rilettura", () => {
  const sync = source("src/lib/shareSync.ts");
  const push = sync.slice(sync.indexOf("const pushBatch"), sync.indexOf("const pushOutbox"));
  assert.match(push, /settlePushed\(accepted, accepted\)/);
  assert.ok(push.indexOf("refetchRows(") < push.indexOf("settleRejected("));
  assert.ok(push.indexOf("markAttempted(") < push.indexOf('rpc("push_shared_rows"'), "tentate prima dell'invio");
});

// ——— 7. Voci superate dal server ———

test("7: una modifica in coda superata da una versione del server uguale o più recente esce dalla coda", async () => {
  await store.getState().applyRows("alice", [row("e1"), row("e2"), row("e3")]);
  for (const id of ["e1", "e2", "e3"]) await store.getState().saveSharedItem("alice", "calendarEvent", { id, title: `mia ${id}`, updatedAt: "x" });
  const stamp = (id) => store.getState().items.find((candidate) => candidate.entityId === id).entity.updatedAt;
  await store.getState().applyRows("alice", [
    row("e1", { title: "del proprietario", updatedAt: later(stamp("e1"), 1000) }),
    row("e2", { title: "stessa ora", updatedAt: stamp("e2") }),
    row("e3", { title: "più vecchia", updatedAt: "2026-11-10T10:00:00.000Z" })
  ]);
  const state = store.getState();
  assert.deepEqual(state.outbox.map((candidate) => candidate.entityId), ["e3"]);
  assert.equal(state.items.find((candidate) => candidate.entityId === "e1").entity.title, "del proprietario");
  assert.equal(state.items.find((candidate) => candidate.entityId === "e3").entity.title, "mia e3");
  const { batches } = sharedPushBatches(state.outbox, state.items);
  assert.deepEqual(batches.flatMap((batch) => batch.rows.map((candidate) => candidate.payload.title)), ["mia e3"]);
});

test("7: un'eliminazione in coda esce se il server ha già eliminato, o se il proprietario ha modificato dopo", async () => {
  await store.getState().applyRows("alice", [row("e1"), row("e2"), row("e3")]);
  for (const id of ["e1", "e2", "e3"]) await store.getState().deleteSharedItem("alice", "calendarEvent", id);
  const deletedAt = store.getState().outbox[0].deletedAt;
  await store.getState().applyRows("alice", [
    row("e1", { deletedAt: "2026-11-10T11:00:00.000Z" }, true),
    row("e2", { title: "rimesso dal proprietario", updatedAt: later(deletedAt, 1000) }),
    row("e3", { updatedAt: "2026-11-10T10:00:00.000Z" })
  ]);
  assert.deepEqual(store.getState().outbox.map((candidate) => candidate.entityId), ["e3"]);
  assert.deepEqual(ids(store.getState().items), ["e2"]);
});

test("7: voci superate, funzione pura (stessa regola di mergeSharedRows)", () => {
  const items = [{ key: sharedKey("alice", "calendarEvent", "e1"), ownerId: "alice", entityType: "calendarEvent", entityId: "e1", entity: { id: "e1", updatedAt: "2026-11-10T12:00:00.000Z" }, serverUpdatedAt: "z" }];
  const outbox = [entry("e1")];
  assert.deepEqual([...supersededOutboxKeys(items, "alice", [row("e1", { updatedAt: "2026-11-10T11:59:59.999Z" })], outbox)], []);
  assert.deepEqual([...supersededOutboxKeys(items, "alice", [row("e1", { updatedAt: "2026-11-10T12:00:00.000Z" })], outbox)], [outbox[0].key]);
  // Pagine sovrapposte: vale anche una riga più nuova seguita da una più vecchia.
  assert.equal(supersededOutboxKeys(items, "alice", [row("e1", { updatedAt: "2026-11-10T13:00:00.000Z" }), row("e1")], outbox).size, 1);
  assert.equal(supersededOutboxKeys(items, "dario", [row("e1", { updatedAt: "2026-11-10T13:00:00.000Z" })], outbox).size, 0);
});

// ——— 8. Lotti e errori dell'invio ———

test("8: lotti divisi anche per byte (900 KB come i dati personali), una riga grande va da sola", () => {
  assert.equal(SHARE_PUSH_MAX_BYTES, 900_000);
  const big = "x".repeat(400_000);
  const items = ["a", "b", "c", "d"].map((id) => ({
    key: sharedKey("alice", "note", id), ownerId: "alice", entityType: "note", entityId: id, entity: { id, body: id === "d" ? "y".repeat(950_000) : big, updatedAt: "u" }, serverUpdatedAt: "z"
  }));
  const outbox = items.map((item, index) => ({ key: item.key, ownerId: "alice", entityType: "note", entityId: item.entityId, deleted: false, queuedAt: String(index) }));
  outbox.push({ key: sharedKey("dario", "note", "t"), ownerId: "dario", entityType: "note", entityId: "t", deleted: true, deletedAt: "2026-11-10T12:00:00.000Z", queuedAt: "9" });
  const { batches } = sharedPushBatches(outbox, items);
  assert.deepEqual(batches.map((batch) => [batch.ownerId, batch.entries.map((candidate) => candidate.entityId)]), [
    ["alice", ["a", "b"]],
    ["alice", ["c"]],
    ["alice", ["d"]],
    ["dario", ["t"]]
  ]);
  for (const batch of batches) assert.equal(batch.entries.length, batch.rows.length);
  // Il limite di righe resta.
  assert.deepEqual(sharedPushBatches(outbox.slice(0, 2), items, 1, Infinity).batches.map((batch) => batch.rows.length), [1, 1]);
});

test("8: un lotto che fallisce non ferma gli altri; senza rete ci si ferma; un cambio di account esce subito", async () => {
  const sent = [];
  const rules = { abort: (error) => error.message === "abort", offline: isShareNetworkError };
  const pushing = (failures) => async (batch) => {
    sent.push(batch);
    if (failures[batch]) throw failures[batch];
  };
  const tooBig = new ShareUserError("Il server ha risposto con un errore. Riprova tra poco.");
  await assert.rejects(pushEachBatch(["a", "b", "c"], pushing({ a: tooBig }), rules), (error) => error === tooBig);
  assert.deepEqual(sent, ["a", "b", "c"]);

  sent.length = 0;
  const offline = new ShareUserError("Server cloud non raggiungibile: controlla la connessione. I dati condivisi si aggiornano da soli appena torna.");
  await assert.rejects(pushEachBatch(["a", "b", "c"], pushing({ a: offline }), rules), (error) => error === offline);
  assert.deepEqual(sent, ["a"]);
  assert.equal(isShareNetworkError(new TypeError("Failed to fetch")), true);
  assert.equal(isShareNetworkError(tooBig), false);

  sent.length = 0;
  await assert.rejects(pushEachBatch(["a", "b"], pushing({ a: new Error("abort"), b: tooBig }), rules), /abort/);
  assert.deepEqual(sent, ["a"]);
  await pushEachBatch([], pushing({}), rules);
});

test("8: i lotti falliti nella passata prima partono per ultimi, così un lotto che scade sempre non blocca gli altri", () => {
  const batch = (...keys) => ({ entries: keys.map((key) => ({ key })) });
  const a = batch("alice:x:1", "alice:x:2");
  const b = batch("bob:x:1");
  const c = batch("carla:x:1");
  assert.deepEqual(failedBatchesLast([a, b, c], new Set()), [a, b, c]);
  assert.deepEqual(failedBatchesLast([a, b, c], new Set(["alice:x:2"])), [b, c, a]);
  assert.deepEqual(failedBatchesLast([a, b, c], new Set(["alice:x:1", "carla:x:1"])), [b, a, c]);
  // Chiavi non più in coda: nessun effetto.
  assert.deepEqual(failedBatchesLast([a, b], new Set(["dario:x:9"])), [a, b]);
});

test("8: un invio non riuscito non ferma il pull: condivisioni e righe arrivano, poi si mostra l'errore", () => {
  const sync = source("src/lib/shareSync.ts");
  const pass = sync.slice(sync.indexOf("const syncOnce"), sync.indexOf("export const syncSharedNow"));
  const push = pass.indexOf("await pushOutbox(gen);");
  assert.ok(push > 0);
  assert.match(pass.slice(push, pass.indexOf("pullShares(")), /catch \(error\) \{[\s\S]*pushFailure = error;/);
  assert.match(pass, /showError\(pushFailure === null \? null : errorText\(pushFailure\)\)/);
});

// ——— 9. Pull per (updated_at, id) ———

test("9: il pull pagina per (updated_at, id), non per posizione", () => {
  assert.equal(
    afterRowFilter({ updatedAt: "2026-11-10T10:00:01.123456+00:00", id: "0b6c" }),
    'updated_at.gt."2026-11-10T10:00:01.123456+00:00",and(updated_at.eq."2026-11-10T10:00:01.123456+00:00",id.gt."0b6c")'
  );
  // Virgolette e barre tolte: nessun valore esce dal filtro.
  assert.equal(afterRowFilter({ updatedAt: 'a"b', id: "c\\d" }), 'updated_at.gt."ab",and(updated_at.eq."ab",id.gt."cd")');
  const sync = source("src/lib/shareSync.ts");
  const pull = sync.slice(sync.indexOf("const pullRows"), sync.indexOf("const visibleKeys"));
  assert.doesNotMatch(pull, /\.range\(/);
  assert.match(pull, /\.select\(PULL_COLUMNS\)/);
  assert.match(pull, /query\.or\(afterRowFilter\(after\)\)/);
  assert.match(sync, /const PULL_COLUMNS = `id, \$\{ROW_COLUMNS\}`/);
});

// ——— 10. Notifiche con l'ora del server ———

test("10: le notifiche di condivisione e invito hanno l'ora del server, non quella del dispositivo", () => {
  const sync = source("src/lib/shareSync.ts");
  const notify = sync.slice(sync.indexOf("const notifyNew"), sync.indexOf("// ——— Realtime"));
  assert.match(notify, /createdAt: grant\.createdAt/);
  assert.match(notify, /createdAt: invite\.createdAt/);
});

// ——— 12. Invito da link e uscita dall'account ———

test("12: l'invito aperto da link non passa all'account successivo", async () => {
  const left = [];
  const viewers = createViewerLifecycle({
    reset: async () => {},
    isLocked: () => false,
    isPersistent: () => false,
    ready: () => {},
    accountLeft: () => {
      left.push(viewers.viewer);
      clearPendingShare();
    }
  });
  const token = "c".repeat(64);
  // Aperto prima di accedere: resta per l'accesso.
  savePendingShare(token);
  viewers.setViewer("bob");
  assert.deepEqual(left, []);
  assert.equal(readPendingShare()?.token, token);
  viewers.setViewer("bob");
  assert.deepEqual(left, []);
  // Logout (anche involontario): via.
  viewers.setViewer(null);
  assert.deepEqual(left, [null]);
  assert.equal(readPendingShare(), null);
  // Cambio diretto di account: via anche lì.
  viewers.setViewer("carol");
  savePendingShare(token);
  viewers.setViewer("dario");
  assert.deepEqual(left, [null, "dario"]);
  assert.equal(readPendingShare(), null);
  await viewers.settled();

  assert.match(source("src/lib/shareSync.ts"), /accountLeft: \(\) => clearPendingShare\(\)/);
  // Uscita da Impostazioni → Account: anche quando la pagina si ricarica prima che la sessione cambi.
  const panel = source("src/components/CloudPanel.tsx");
  const keep = panel.slice(panel.indexOf("const leaveKeepingData"), panel.indexOf("const leaveRemovingData"));
  assert.ok(keep.indexOf("clearPendingShare()") > 0 && keep.indexOf("clearPendingShare()") < keep.indexOf("window.location.reload()"));
  const remove = panel.slice(panel.indexOf("const leaveRemovingData"), panel.indexOf("const handleForcePull"));
  assert.ok(remove.indexOf("clearPendingShare()") > remove.indexOf("signOutThisDevice("));
});
