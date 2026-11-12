import test from "node:test";
import assert from "node:assert/strict";
import { configurePersistence, handOffPersistence, isPersistenceHalted, requestPersist, resetBaseline } from "../src/lib/persistence.ts";
import { normalizeCollections } from "../src/lib/collections.ts";

// Passaggio a un'altra scheda (src/lib/activeTab.ts): prima si salva tutto, poi si smette di scrivere.
// In Node non c'è IndexedDB: ogni scrittura vera fallisce (MissingAPIError), come un disco che rifiuta.
// I test sono in ordine: lo stop è definitivo per il modulo (una scheda ferma si ricarica).

const settings = { id: "settings", updatedAt: "2026-11-01T10:00:00.000Z" };
const empty = normalizeCollections({});
const withTask = normalizeCollections({ tasks: [{ id: "t1", title: "Scritta in scheda A", updatedAt: "2026-11-12T10:00:00.000Z" }] });

let current = { collections: empty, settings, locked: false };
const errors = [];
configurePersistence({ getState: () => current, onError: (message) => errors.push(message) });

test("passaggio con modifiche che non si riescono a salvare: la scheda resta attiva", async () => {
  resetBaseline(empty, settings);
  current = { collections: withTask, settings, locked: false };
  await assert.rejects(handOffPersistence());
  assert.equal(isPersistenceHalted(), false, "senza salvataggio non si cede il posto");
  assert.ok(errors.some((message) => message?.startsWith("Salvataggio non riuscito")), "l'errore resta visibile qui");
});

test("passaggio con tutto già salvato: smette di scrivere; ogni salvataggio dopo è rifiutato senza errori", async () => {
  resetBaseline(withTask, settings);
  errors.length = 0;
  await handOffPersistence();
  assert.equal(isPersistenceHalted(), true);

  // Una modifica arrivata dopo (es. dalla sync) non deve finire su disco né sembrare salvata.
  current = { collections: empty, settings, locked: false };
  await assert.rejects(requestPersist(), { name: "PersistenceHaltedError" });
  assert.deepEqual(errors.filter(Boolean), [], "niente messaggio d'errore: la scheda sta passando alla guardia");
});
