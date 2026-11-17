import test from "node:test";
import assert from "node:assert/strict";
import {
  configurePersistence,
  haltPersistence,
  requestPersist,
  resetBaseline,
  rewriteLocalCopy,
  setPersistenceSuspended,
  setVaultSession
} from "../src/lib/persistence.ts";
import { deriveVaultKey } from "../src/lib/crypto.ts";
import { db } from "../src/lib/db.ts";
import { COLLECTIONS, normalizeCollections } from "../src/lib/collections.ts";

// Il browser può svuotare IndexedDB con la scheda aperta (dati del sito cancellati, spazio liberato):
// Dexie riapre da solo un database vuoto, mentre memoria e baseline dicono «già salvato». Il diff non
// riscrive nulla e la prima sync segnava il dispositivo come allineato: dopo un ricaricamento restava
// vuoto (incidente Opera, 2026-11-16). rewriteLocalCopy rimette su disco la copia salvata, senza coda.
// In Node non c'è IndexedDB: transazione e tabelle sono finte e registrano le scritture.

const settings = { id: "settings", updatedAt: "2026-11-16T10:00:00.000Z", security: { mode: "none" } };
const saved = normalizeCollections({
  subjects: [{ id: "s1", name: "Biochimica", updatedAt: "2026-11-10T10:00:00.000Z" }],
  tasks: [
    { id: "t1", title: "Ripassare gli enzimi", updatedAt: "2026-11-10T10:00:00.000Z" },
    { id: "t2", title: "Esercizi", updatedAt: "2026-11-11T10:00:00.000Z" }
  ],
  flashcards: [{ id: "f1", deckId: "d1", updatedAt: "2026-11-12T10:00:00.000Z" }]
});

let state;
const writes = [];
const errors = [];
configurePersistence({ getState: () => state, onError: (message) => errors.push(message) });

const fake = () => {
  writes.length = 0;
  db.transaction = async (_mode, _tables, scope) => scope();
  db.settings.put = async (row) => writes.push(["settings", row.id]);
  db.vault.put = async () => writes.push(["vault"]);
  db.syncOutbox.bulkPut = async (rows) => writes.push(["outbox", rows.length]);
  for (const key of COLLECTIONS) {
    db[key].bulkPut = async (rows) => writes.push([key, rows.map((row) => row.id).join(",")]);
    db[key].bulkDelete = async (ids) => writes.push([`${key}-`, ids.join(",")]);
  }
};
const restore = () => {
  for (const name of ["transaction"]) delete db[name];
  delete db.settings.put;
  delete db.vault.put;
  delete db.syncOutbox.bulkPut;
  for (const key of COLLECTIONS) {
    delete db[key].bulkPut;
    delete db[key].bulkDelete;
  }
};

test("disco svuotato sotto la scheda: il salvataggio normale non vede nulla, la riscrittura rimette tutto senza coda", async () => {
  fake();
  try {
    state = { collections: saved, settings, locked: false };
    resetBaseline(saved, settings);
    setVaultSession(false, null);
    setPersistenceSuspended(false);

    // Il diff confronta con la baseline in memoria: per lui è tutto già su disco.
    await requestPersist();
    assert.deepEqual(writes, [], "nessuna scrittura: il buco che lasciava il dispositivo vuoto");

    await rewriteLocalCopy();
    assert.deepEqual(writes, [
      ["settings", "settings"],
      ["subjects", "s1"],
      ["tasks", "t1,t2"],
      ["flashcards", "f1"]
    ].sort((a, b) => COLLECTIONS.indexOf(a[0]) - COLLECTIONS.indexOf(b[0])));
    assert.ok(!writes.some(([what]) => what === "outbox"), "niente voci in coda: sono già nel cloud o le accoda la prima sync");
    assert.deepEqual(errors.filter(Boolean), []);
  } finally {
    restore();
  }
});

test("modifiche non ancora salvate: prima il loro salvataggio con la coda, poi la copia salvata", async () => {
  fake();
  try {
    resetBaseline(saved, settings);
    const added = { id: "t3", title: "Nuova", updatedAt: "2026-11-16T22:30:00.000Z" };
    state = { collections: { ...saved, tasks: [...saved.tasks, added] }, settings, locked: false };

    await rewriteLocalCopy();
    assert.deepEqual(writes.slice(0, 2), [["tasks", "t3"], ["outbox", 1]], "la modifica nuova passa dal salvataggio normale");
    assert.deepEqual(writes.find(([what], index) => index > 1 && what === "tasks"), ["tasks", "t1,t2,t3"]);
  } finally {
    restore();
  }
});

test("workspace bloccato o salvataggio sospeso: nessuna scrittura (lo stato in memoria è vuoto)", async () => {
  fake();
  try {
    resetBaseline(saved, settings);
    state = { collections: normalizeCollections({}), settings, locked: true };
    await rewriteLocalCopy();
    state = { collections: normalizeCollections({}), settings, locked: false };
    setPersistenceSuspended(true);
    await rewriteLocalCopy();
    assert.deepEqual(writes, []);
  } finally {
    setPersistenceSuspended(false);
    restore();
  }
});

test("col vault: riscrive impostazioni e copia cifrata, non le tabelle in chiaro", async () => {
  fake();
  try {
    const vaultSettings = { ...settings, security: { mode: "vault" } };
    state = { collections: saved, settings: vaultSettings, locked: false };
    resetBaseline(saved, vaultSettings);
    setVaultSession(true, await deriveVaultKey("prova", undefined, 1_000));
    await rewriteLocalCopy();
    assert.deepEqual(writes, [["settings", "settings"], ["vault"]]);
  } finally {
    setVaultSession(false, null);
    restore();
  }
});

test("scheda fermata (blocco preso da un'altra scheda): niente riscrittura", async () => {
  fake();
  try {
    state = { collections: saved, settings, locked: false };
    resetBaseline(saved, settings);
    haltPersistence();
    await assert.rejects(rewriteLocalCopy(), { name: "PersistenceHaltedError" });
    assert.deepEqual(writes, []);
  } finally {
    restore();
  }
});
