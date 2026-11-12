import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rebaseSharedEdit, sharedKey, sharedPushBatches } from "../src/lib/sharing.ts";
import { useSharedStore } from "../src/store/useSharedStore.ts";
import { SHARE_NOTICE_TEXT } from "../src/lib/labels.ts";

// S4: le modifiche a un elemento altrui erano «tutta la riga, vince il timbro più recente». Chi riceve
// sposta l'orario offline, il proprietario intanto cambia il titolo: tornati online, una delle due
// modifiche spariva per intero (rifiutata come "stale", o il vecchio titolo riscritto sopra quello
// nuovo). Ora la voce in coda ricorda la versione da cui la modifica è partita (base): le modifiche a
// campi diversi si uniscono; sullo stesso campo resta quella con il timbro più recente, con un avviso.

const grant = { id: "g", ownerId: "alice", ownerName: "Alice", scope: "calendar", subjectIds: [], permission: "edit",
  granteeUserId: "bob", granteeGroupId: null, granteeName: "Bob", granteeEmail: null, createdAt: "", updatedAt: "" };

const event = (extra = {}) => ({
  id: "e1", title: "Ripasso", start: "2026-11-12T10:00", end: "2026-11-12T11:00", allDay: false,
  createdAt: "2026-11-01T09:00:00.000Z", updatedAt: "2026-11-12T09:00:00.000Z", ...extra
});
const row = (payload, updatedAt, deleted = false) => ({ entity_type: "calendarEvent", entity_id: "e1", payload, deleted, updated_at: updatedAt });

const store = useSharedStore;
const KEY = sharedKey("alice", "calendarEvent", "e1");

beforeEach(() => {
  store.setState({
    viewerId: "bob", persistent: false, received: [grant], given: [], invites: [], items: [], labels: [], outbox: [], hiddenOwners: [], notice: null, syncError: null
  });
});

test("S4: campi diversi si uniscono; lo stesso campo va al timbro più recente e si segnala", () => {
  const base = event();
  // Orario cambiato qui, titolo cambiato dal proprietario.
  const local = event({ start: "2026-11-12T15:00", end: "2026-11-12T16:00", updatedAt: "2026-11-12T10:05:00.000Z" });
  const remote = event({ title: "Ripasso cap. 3", updatedAt: "2026-11-12T10:10:00.000Z" });
  const merged = rebaseSharedEdit("calendarEvent", base, local, remote);
  assert.equal(merged.merged.title, "Ripasso cap. 3");
  assert.equal(merged.merged.start, "2026-11-12T15:00");
  assert.equal(merged.merged.end, "2026-11-12T16:00");
  assert.equal(merged.differs, true);
  assert.deepEqual(merged.conflicts, []);

  // Stesso campo: il proprietario più recente vince, niente da inviare.
  const sameField = rebaseSharedEdit("calendarEvent", base, event({ title: "Mio", updatedAt: "2026-11-12T10:05:00.000Z" }), remote);
  assert.equal(sameField.merged.title, "Ripasso cap. 3");
  assert.equal(sameField.differs, false);
  assert.deepEqual(sameField.conflicts, ["title"]);
  // …e la modifica di qui, più recente, vince.
  const mineNewer = rebaseSharedEdit("calendarEvent", base, event({ title: "Mio", updatedAt: "2026-11-12T10:20:00.000Z" }), remote);
  assert.equal(mineNewer.merged.title, "Mio");
  assert.equal(mineNewer.differs, true);
  assert.deepEqual(mineNewer.conflicts, ["title"]);

  // Orari e «tutto il giorno» vanno insieme: se li cambiano entrambi, vince un gruppo intero.
  const both = rebaseSharedEdit(
    "calendarEvent",
    base,
    event({ start: "2026-11-12T15:00", end: "2026-11-12T16:00", updatedAt: "2026-11-12T10:05:00.000Z" }),
    event({ allDay: true, updatedAt: "2026-11-12T10:10:00.000Z" })
  );
  assert.deepEqual([both.merged.start, both.merged.end, both.merged.allDay], ["2026-11-12T10:00", "2026-11-12T11:00", true]);
  assert.deepEqual(both.conflicts, ["start", "end", "allDay"]);

  // Una modifica uguale da entrambe le parti non è un conflitto.
  const same = rebaseSharedEdit("calendarEvent", base, event({ title: "X", updatedAt: "2026-11-12T10:05:00.000Z" }), event({ title: "X", updatedAt: "2026-11-12T10:10:00.000Z" }));
  assert.equal(same.differs, false);
  assert.deepEqual(same.conflicts, []);
});

test("S4: la voce in coda ricorda la versione del server da cui è partita la modifica", async () => {
  await store.getState().applyRows("alice", [row(event(), "2026-11-12T09:00:01Z")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", event({ start: "2026-11-12T15:00", end: "2026-11-12T16:00" }));
  const [entry] = store.getState().outbox;
  assert.equal(entry.baseAt, "2026-11-12T09:00:01Z");
  assert.equal(entry.base.title, "Ripasso");
  assert.equal(entry.base.start, "2026-11-12T10:00");
  // Una seconda modifica prima dell'invio parte ancora dalla stessa versione del server.
  await store.getState().saveSharedItem("alice", "calendarEvent", { ...store.getState().items[0].entity, title: "Ripasso bis" });
  assert.equal(store.getState().outbox[0].baseAt, "2026-11-12T09:00:01Z");
  assert.equal(store.getState().outbox[0].base.title, "Ripasso");
});

test("S4: invio rifiutato (stale) perché il proprietario ha cambiato il titolo: si uniscono e si rinvia", async () => {
  await store.getState().applyRows("alice", [row(event(), "2026-11-12T09:00:01Z")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", event({ start: "2026-11-12T15:00", end: "2026-11-12T16:00" }));
  const sent = [...store.getState().outbox];
  // Il proprietario ha rinominato dopo: il server risponde "stale" e la riga riletta ha il titolo nuovo.
  const fresh = row(event({ title: "Ripasso cap. 3", updatedAt: "2099-01-01T00:00:00.000Z" }), "2026-11-12T10:10:00Z");
  await store.getState().settleRejected("alice", sent, [fresh], sent);
  const [cached] = store.getState().items;
  assert.equal(cached.entity.title, "Ripasso cap. 3");
  assert.equal(cached.entity.start, "2026-11-12T15:00");
  assert.equal(cached.serverUpdatedAt, "2026-11-12T10:10:00Z");
  // Ancora in coda, con la nuova base e un queuedAt nuovo (parte alla passata dopo).
  assert.equal(store.getState().outbox.length, 1);
  const [entry] = store.getState().outbox;
  assert.notEqual(entry.queuedAt, sent[0].queuedAt);
  assert.equal(entry.baseAt, "2026-11-12T10:10:00Z");
  assert.equal(entry.base.title, "Ripasso cap. 3");
  // Il timbro supera l'ora del server della riga: il server lo accetta (studyos_recipient_newer).
  assert.ok(Date.parse(cached.entity.updatedAt) > Date.parse("2026-11-12T10:10:00Z"));
  const { batches } = sharedPushBatches(store.getState().outbox, store.getState().items);
  assert.equal(batches[0].rows[0].payload.title, "Ripasso cap. 3");
  assert.equal(batches[0].rows[0].payload.start, "2026-11-12T15:00");
  assert.equal(store.getState().notice, null);
});

test("S4: un pull con una modifica del proprietario a un altro campo non riscrive il vecchio titolo", async () => {
  await store.getState().applyRows("alice", [row(event(), "2026-11-12T09:00:01Z")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", event({ start: "2026-11-12T15:00", end: "2026-11-12T16:00" }));
  // Rinomina del proprietario con un timbro più vecchio della modifica di qui (prima: si teneva la copia di
  // qui intera e l'invio riscriveva «Ripasso» sopra «Ripasso cap. 3»).
  await store.getState().applyRows("alice", [row(event({ title: "Ripasso cap. 3", updatedAt: "2026-11-12T09:30:00.000Z" }), "2026-11-12T09:30:01Z")]);
  const [cached] = store.getState().items;
  assert.equal(cached.entity.title, "Ripasso cap. 3");
  assert.equal(cached.entity.start, "2026-11-12T15:00");
  assert.equal(store.getState().outbox.length, 1);
  assert.equal(store.getState().outbox[0].baseAt, "2026-11-12T09:30:01Z");
  // La stessa riga riletta (sovrapposizione del cursore) non tocca la modifica in coda.
  const queued = store.getState().outbox[0];
  await store.getState().applyRows("alice", [row(event({ title: "Ripasso cap. 3", updatedAt: "2026-11-12T09:30:00.000Z" }), "2026-11-12T09:30:01Z")]);
  assert.equal(store.getState().items[0].entity.start, "2026-11-12T15:00");
  assert.equal(store.getState().outbox[0], queued);
});

test("S4: la riga di partenza con il timbro del proprietario nel futuro non cancella la modifica in coda", async () => {
  // Orologio del proprietario avanti: prima la riletta della stessa versione vinceva sulla modifica di
  // qui (timbro più vecchio) e la voce usciva dalla coda prima dell'invio.
  const future = event({ updatedAt: "2099-01-01T00:00:00.000Z" });
  await store.getState().applyRows("alice", [row(future, "2026-11-12T09:00:01Z")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", { ...future, title: "Mio titolo" });
  await store.getState().applyRows("alice", [row(future, "2026-11-12T09:00:01Z")]);
  assert.equal(store.getState().items[0].entity.title, "Mio titolo");
  assert.equal(store.getState().outbox.length, 1);
});

test("S4: stesso campo cambiato da entrambi: resta il più recente e compare un avviso", async () => {
  await store.getState().applyRows("alice", [row(event(), "2026-11-12T09:00:01Z")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", event({ title: "Mio titolo" }));
  const mine = store.getState().items[0].entity.updatedAt;
  // Il proprietario, dopo, ha cambiato lo stesso campo: vince lui, la voce esce dalla coda.
  const later = new Date(Date.parse(mine) + 60_000).toISOString();
  await store.getState().applyRows("alice", [row(event({ title: "Suo titolo", updatedAt: later }), "2026-11-12T23:59:00Z")]);
  assert.equal(store.getState().items[0].entity.title, "Suo titolo");
  assert.equal(store.getState().outbox.length, 0);
  assert.equal(store.getState().notice, SHARE_NOTICE_TEXT.conflict("Alice"));
});

test("S4: rifiuto per orologio indietro senza modifiche del proprietario: si rinvia con un timbro accettato", async () => {
  await store.getState().applyRows("alice", [row(event(), "2026-11-12T09:00:01Z")]);
  await store.getState().saveSharedItem("alice", "calendarEvent", event({ title: "Mio titolo" }));
  const sent = [...store.getState().outbox];
  // La riga è ancora quella di partenza, ma il server ha un'ora più avanti di questo dispositivo.
  const same = row(event(), "2026-11-12T09:00:01Z");
  await store.getState().settleRejected("alice", sent, [same], sent);
  assert.equal(store.getState().items[0].entity.title, "Mio titolo");
  assert.ok(Date.parse(store.getState().items[0].entity.updatedAt) > Date.parse("2026-11-12T09:00:01Z"));
  assert.equal(store.getState().outbox.length, 1);
  assert.notEqual(store.getState().outbox[0].queuedAt, sent[0].queuedAt);
});

test("S4: shareSync passa al riallineamento le voci rifiutate come stale", () => {
  const source = readFileSync(new URL("../src/lib/shareSync.ts", import.meta.url), "utf8");
  const push = source.slice(source.indexOf("const pushBatch"), source.indexOf("/** Chiavi delle voci nei lotti falliti"));
  assert.match(push, /settleRejected\(\s*batch\.ownerId,\s*rejected,\s*rows,\s*rejected\.filter\(\(entry\) => reason\(entry\) === "stale"\)\s*\)/);
});

test("S4: prima dell'invio le modifiche con una base si riallineano sulla riga di adesso", () => {
  const source = readFileSync(new URL("../src/lib/shareSync.ts", import.meta.url), "utf8");
  // Proprietario che rinomina mentre chi riceve è offline: senza questa lettura l'invio (timbro più
  // recente) veniva accettato e riscriveva il vecchio titolo.
  const outbox = source.slice(source.indexOf("const pushOutbox"));
  assert.match(outbox, /await rebaseBeforePush\(gen\);[\s\S]*?sharedPushBatches\(/);
  const before = source.slice(source.indexOf("const rebaseBeforePush"), source.indexOf("const pushBatch"));
  assert.match(before, /entry\.deleted \|\| !entry\.base/);
  assert.match(before, /await fetchRows\(ownerId, entries, gen\)/);
  assert.match(before, /applyRows\(ownerId, rows\)/);
  // Un errore di rete qui non ferma l'invio; un cambio di chi guarda sì.
  assert.match(before, /if \(error instanceof ViewerChanged \|\| gen !== viewers\.generation\) throw error;/);
});
