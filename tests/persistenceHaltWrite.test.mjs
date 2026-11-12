import test from "node:test";
import assert from "node:assert/strict";
import { configurePersistence, haltPersistence, requestPersist, resetBaseline, setVaultSession } from "../src/lib/persistence.ts";
import { deriveVaultKey } from "../src/lib/crypto.ts";
import { db } from "../src/lib/db.ts";
import { normalizeCollections } from "../src/lib/collections.ts";

// Lo stop (blocco preso da un'altra scheda) arriva a transazione già aperta: la copia cifrata
// non va scritta. Lanciare dentro la transazione la annulla tutta (anche le impostazioni).
// In Node non c'è IndexedDB: transazione e tabelle sono finte e registrano le scritture.

test("col vault: lo stop arrivato a metà transazione non sostituisce la copia salvata", async () => {
  const before = { id: "settings", updatedAt: "2026-11-01T10:00:00.000Z" };
  const after = { ...before, updatedAt: "2026-11-12T10:00:00.000Z" };
  const withTask = normalizeCollections({ tasks: [{ id: "t1", title: "Scritta in scheda B", updatedAt: "2026-11-12T10:00:00.000Z" }] });
  const errors = [];
  configurePersistence({ getState: () => ({ collections: withTask, settings: after, locked: false }), onError: (message) => errors.push(message) });
  resetBaseline(normalizeCollections({}), before);
  setVaultSession(true, await deriveVaultKey("prova", undefined, 1_000));

  const writes = [];
  db.transaction = async (_mode, _tables, scope) => scope();
  db.settings.put = async () => {
    writes.push("settings");
    haltPersistence(); // la scheda si congela qui e intanto perde il blocco
  };
  db.vault.put = async () => writes.push("vault");
  db.syncOutbox.bulkPut = async () => writes.push("outbox");
  try {
    await assert.rejects(requestPersist(), { name: "PersistenceHaltedError" });
    assert.deepEqual(writes, ["settings"], "niente copia cifrata né outbox dopo lo stop");
    assert.deepEqual(errors.filter(Boolean), []);
  } finally {
    delete db.transaction;
    delete db.settings.put;
    delete db.vault.put;
    delete db.syncOutbox.bulkPut;
  }
});
