import test from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// Solo memoria: con `loading` attivo la persistenza non scrive (niente IndexedDB in Node).
const store = useStudyStore;
const OLD = "2026-11-01T10:00:00.000Z";

test("materie: una nuova va in fondo, come dopo una ricarica (ordine degli id)", async () => {
  store.setState({
    loading: true,
    subjects: [
      { id: "subject_aaa_1", name: "Analisi 1", status: "active", updatedAt: OLD },
      { id: "subject_aab_2", name: "Fisica", status: "active", updatedAt: OLD }
    ]
  });
  // Tutte le vie passano da qui: Materie, Aggiungi, libretto, BARB, agenti.
  const first = await store.getState().addSubject({ name: "Chimica" });
  await new Promise((resolve) => setTimeout(resolve, 2));
  const second = await store.getState().addSubject({ name: "Genetica" });
  const ids = store.getState().subjects.map((subject) => subject.id);
  assert.deepEqual(ids, ["subject_aaa_1", "subject_aab_2", first, second]);
  // La ricarica legge per id: lo stesso ordine.
  assert.deepEqual([...ids].sort(), ids);
});
