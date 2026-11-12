import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { countOutbox, discardable, isStuck, parkedRow, stuckItems, stuckSnapshot } from "../src/lib/stuckOutbox.ts";
import { normalizeCollections } from "../src/lib/collections.ts";

// P12: una voce che non partirà mai (elemento oltre il limite del cloud) restava in coda per sempre:
// il cambio di account falliva a ogni tentativo («modifiche cloud in attesa») e «Esci e togli i dati
// da qui» non faceva nulla. Ora la voce è segnata come ferma, contata a parte, e la persona la vede
// e può scaricarne una copia o toglierla dalla coda. Finché c'è, cambio account e uscita con
// svuotamento restano fermi con un messaggio chiaro (altrimenti l'elemento si perderebbe).

const row = (key, queuedAt, extra = {}) => {
  const [entityType, entityId] = key.split(":");
  const collection = { task: "tasks", note: "notes", attachment: "attachments" }[entityType];
  return { key, collection, entityType, entityId, deleted: false, queuedAt, ...extra };
};

test("P12: la voce troppo grande si segna come ferma solo se è ancora quella valutata", () => {
  const evaluated = row("note:n1", 10);
  const parked = parkedRow(evaluated, evaluated, 1_500_000);
  assert.deepEqual(parked, { ...evaluated, parked: "too-large", parkedSize: 1_500_000 });
  assert.ok(isStuck(parked));
  // Una modifica nuova ha riaccodato la voce (queuedAt diverso): si rivaluta alla prossima passata.
  assert.equal(parkedRow(row("note:n1", 11), evaluated, 1_500_000), null);
  // Già segnata uguale: nessuna scrittura.
  assert.equal(parkedRow(parked, evaluated, 1_500_000), null);
  // Le eliminazioni non sono mai troppo grandi; voce già partita: niente.
  assert.equal(parkedRow(row("note:n1", 10, { deleted: true }), evaluated, 1_500_000), null);
  assert.equal(parkedRow(undefined, evaluated, 1_500_000), null);
});

test("P12: le voci ferme non contano tra le modifiche da inviare", () => {
  const rows = [row("task:t1", 1), row("note:n1", 2, { parked: "too-large", parkedSize: 2_000_000 }), row("task:t2", 3)];
  assert.deepEqual(countOutbox(rows), { pending: 2, stuck: 1 });
  assert.deepEqual(countOutbox([]), { pending: 0, stuck: 0 });
});

test("P12: elenco, copia e scarto lavorano solo sulle voci ferme e ancora uguali", () => {
  const collections = normalizeCollections({
    notes: [{ id: "n1", title: "Appunti enormi", body: "x", createdAt: "2026-11-12T08:00:00.000Z", updatedAt: "2026-11-12T08:00:00.000Z" }],
    tasks: [{ id: "t1", title: "Normale", status: "todo", priority: "medium", importance: "medium", subtaskIds: [], tags: [], createdAt: "2026-11-12T08:00:00.000Z", updatedAt: "2026-11-12T08:00:00.000Z" }]
  });
  const rows = [row("task:t1", 1), row("note:n1", 2, { parked: "too-large", parkedSize: 2_000_000 })];
  const items = stuckItems(rows, collections);
  assert.deepEqual(items, [
    { key: "note:n1", collection: "notes", id: "n1", queuedAt: 2, title: "Appunti enormi", size: 2_000_000, reason: "too-large", here: true }
  ]);
  const snapshot = stuckSnapshot(items, collections, "2026-11-12T10:00:00.000Z");
  assert.equal(snapshot.version, 1);
  assert.deepEqual(snapshot.notes.map((note) => note.id), ["n1"]);
  assert.deepEqual(snapshot.tasks, []);
  // Scarto: solo se la voce è ancora ferma con lo stesso queuedAt (una modifica nuova la rimette in gioco).
  assert.equal(discardable(rows[1], items[0]), true);
  assert.equal(discardable(row("note:n1", 5), items[0]), false);
  assert.equal(discardable({ ...rows[1], queuedAt: 9 }, items[0]), false);
  assert.equal(discardable(undefined, items[0]), false);
});

test("P12: push segna le voci troppo grandi, i conteggi le tengono a parte, cambio account e uscita le nominano", () => {
  const sync = readFileSync(new URL("../src/lib/cloudSync.ts", import.meta.url), "utf8");
  const push = sync.slice(sync.indexOf("const push = async"), sync.indexOf("const firstSync"));
  assert.match(push, /parkedRow\(/);
  assert.match(sync, /const refreshPendingCount = async \(\) => \{[\s\S]*?countOutbox\([\s\S]*?stuckCount/);
  const bind = sync.slice(sync.indexOf("const bindUser"), sync.indexOf("const syncOnce"));
  assert.match(bind, /countOutbox\(/);
  assert.match(bind, /ACCOUNT_TEXT\.switchStuck\(/);
  assert.match(sync, /export const discardStuck = /);
  assert.match(sync, /export const listStuck = /);

  const panel = readFileSync(new URL("../src/components/CloudPanel.tsx", import.meta.url), "utf8");
  // «Togli i dati da qui» resta fermo anche con elementi fermi, e la persona li vede lì.
  assert.match(panel, /const leaveRemovingData = async \(\) => \{\s*if \(sync\.pendingCount > 0 \|\| sync\.stuckCount\) return;/);
  assert.match(panel, /disabled=\{busy \|\| sync\.pendingCount > 0 \|\| Boolean\(sync\.stuckCount\)\}/);
  assert.match(panel, /<StuckItems\b/);
  const labels = readFileSync(new URL("../src/lib/labels/account.ts", import.meta.url), "utf8");
  assert.match(labels, /stuckDiscardWarning/);
});

test("P12 (revisione): il conteggio dopo ogni salvataggio non legge tutta la coda", () => {
  // refreshPendingCount gira dopo ogni salvataggio locale: con toArray() una lunga coda offline si
  // leggeva per intero a ogni modifica. Senza voci ferme basta count(); solo push le segna.
  const sync = readFileSync(new URL("../src/lib/cloudSync.ts", import.meta.url), "utf8");
  const count = sync.slice(sync.indexOf("const refreshPendingCount"), sync.indexOf("const storeReady"));
  assert.match(count, /if \(stuckSeen === 0\) \{\s*const pending = await db\.syncOutbox\.count\(\);/);
  assert.match(count, /stuckSeen = stuck;/);
  assert.match(sync, /let stuckSeen = -1;/);
  const push = sync.slice(sync.indexOf("const push = async"), sync.indexOf("const firstSync"));
  assert.match(push, /if \(oversized\.length\) \{\s*\/\/[\s\S]*?stuckSeen = -1;/);
});

test("P12 (revisione): testo chiaro, quali elementi si fermano, copia protetta come la copia di sicurezza", async () => {
  const { ACCOUNT_TEXT } = await import("../src/lib/labels/account.ts");
  // «scaricane una copia o toglili» faceva credere che scaricare bastasse: sblocca solo «Togli dalla coda».
  assert.doesNotMatch(ACCOUNT_TEXT.stuckBlocks, / o toglil/);
  assert.match(ACCOUNT_TEXT.stuckBlocks, /scaricane una copia, poi toglili dalla coda/);
  // Quali elementi finiscono qui.
  assert.match(ACCOUNT_TEXT.stuckWhich(900), /oltre 900 KB/);
  // Con la password dell'app la copia in chiaro va detta chiaramente; si può proteggere.
  assert.match(ACCOUNT_TEXT.stuckCopyPlainVault, /non è protetta/);
  assert.match(ACCOUNT_TEXT.stuckProtect, /password/);

  const panel = readFileSync(new URL("../src/components/CloudPanel.tsx", import.meta.url), "utf8");
  const stuck = panel.slice(panel.indexOf("function StuckItems"), panel.indexOf("type Mode ="));
  // Stessa cifratura della copia di sicurezza; proposta già attiva con la password dell'app.
  assert.match(stuck, /createBackupEnvelope\([^)]*protect \? passphrase : undefined, "items"\)/);
  assert.match(stuck, /useState\(\s*\(\) => vaultOn \|\| useStudyStore\.getState\(\)\.settings\.security\.backupEncryptionDefault/);
  assert.match(stuck, /passphrase\.length < 8/);
  assert.match(stuck, /ACCOUNT_TEXT\.stuckWhich\(CLOUD_ITEM_MAX_KB\)/);
  assert.match(stuck, /vaultOn \? ACCOUNT_TEXT\.stuckCopyPlainVault : ACCOUNT_TEXT\.stuckCopyPlain/);
});
