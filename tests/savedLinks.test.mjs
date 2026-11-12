import test from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";

test("link salvato: niente etichetta «link» aggiunta dall'app (le etichette sono di chi studia)", async () => {
  // Solo memoria: con `loading` attivo la persistenza non scrive (niente IndexedDB in Node).
  useStudyStore.setState({ loading: true, attachments: [] });
  await useStudyStore.getState().addExternalAttachment("https://example.org/slide", "Slide");
  const [saved] = useStudyStore.getState().attachments;
  assert.equal(saved.externalUrl, "https://example.org/slide");
  assert.deepEqual(saved.tags, []);
});
