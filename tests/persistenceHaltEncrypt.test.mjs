import test from "node:test";
import assert from "node:assert/strict";
import { configurePersistence, haltPersistence, requestPersist, resetBaseline, setVaultSession } from "../src/lib/persistence.ts";
import { deriveVaultKey } from "../src/lib/crypto.ts";
import { db } from "../src/lib/db.ts";
import { normalizeCollections } from "../src/lib/collections.ts";

// Scheda congelata tra la cifratura e la scrittura: quando riparte ha già perso il blocco
// (src/lib/activeTab.ts). Col vault quella scrittura sostituirebbe l'intera copia salvata.

test("col vault: lo stop arrivato durante la cifratura impedisce la scrittura", async () => {
  const settings = { id: "settings", updatedAt: "2026-11-01T10:00:00.000Z" };
  const withTask = normalizeCollections({ tasks: [{ id: "t1", title: "Scritta in scheda B", updatedAt: "2026-11-12T10:00:00.000Z" }] });
  const errors = [];
  configurePersistence({ getState: () => ({ collections: withTask, settings, locked: false }), onError: (message) => errors.push(message) });
  resetBaseline(normalizeCollections({}), settings);
  setVaultSession(true, await deriveVaultKey("prova", undefined, 1_000));

  const subtle = globalThis.crypto.subtle;
  const encrypt = subtle.encrypt;
  const transaction = db.transaction;
  let encrypted = false;
  let transactions = 0;
  subtle.encrypt = async (...args) => {
    haltPersistence(); // l'altra scheda prende il blocco mentre questa cifra
    const result = await encrypt.apply(subtle, args);
    encrypted = true;
    return result;
  };
  db.transaction = (...args) => {
    transactions += 1;
    return transaction.apply(db, args);
  };
  try {
    await assert.rejects(requestPersist(), { name: "PersistenceHaltedError" });
    assert.equal(encrypted, true, "lo stop è arrivato a metà, dopo il controllo iniziale");
    assert.equal(transactions, 0, "nessuna transazione aperta dopo lo stop");
    assert.deepEqual(errors.filter(Boolean), []);
  } finally {
    delete subtle.encrypt;
    delete db.transaction;
  }
});
