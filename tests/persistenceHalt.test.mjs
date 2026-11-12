import test from "node:test";
import assert from "node:assert/strict";
import { configurePersistence, haltPersistence, isPersistenceHalted, requestPersist, resetBaseline, whenPersisted } from "../src/lib/persistence.ts";
import { normalizeCollections } from "../src/lib/collections.ts";

// Blocco preso da un'altra scheda («Usa comunque qui»): questa smette SUBITO di scrivere, senza
// salvare quello che ha in memoria (l'altra scheda ha già caricato i dati dal disco).
// In Node ogni scrittura vera fallirebbe con «Salvataggio non riuscito»: se quel messaggio non
// compare, la persistenza non ha nemmeno provato a scrivere.

test("stop immediato: le modifiche in memoria non vengono scritte e nessun salvataggio riparte", async () => {
  const settings = { id: "settings", updatedAt: "2026-11-01T10:00:00.000Z" };
  const empty = normalizeCollections({});
  const errors = [];
  configurePersistence({
    getState: () => ({
      collections: normalizeCollections({ tasks: [{ id: "t1", title: "Scritta in scheda B", updatedAt: "2026-11-12T10:00:00.000Z" }] }),
      settings,
      locked: false
    }),
    onError: (message) => errors.push(message)
  });
  resetBaseline(empty, settings);

  haltPersistence();
  assert.equal(isPersistenceHalted(), true);
  await assert.rejects(requestPersist(), { name: "PersistenceHaltedError" });
  await assert.rejects(requestPersist(), { name: "PersistenceHaltedError" });
  await whenPersisted();
  assert.deepEqual(errors.filter(Boolean), []);
});
