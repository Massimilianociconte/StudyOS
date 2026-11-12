import test from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// Solo memoria: con `loading` attivo la persistenza non scrive (niente IndexedDB in Node).

// Nome e foto si correggono anche quando la copia salvata ha l'orario avanti (orologio di un altro
// dispositivo): il cloud accetta solo un timbro più recente, e con «adesso» la correzione veniva
// rifiutata e al pull tornava il nome di prima.
test("updatePreferences: la modifica ha un timbro dopo quello della copia che sostituisce", async () => {
  const ahead = new Date(Date.now() + 60 * 60_000).toISOString();
  useStudyStore.setState({
    loading: true,
    locked: false,
    preferences: [{ id: "main", createdAt: ahead, updatedAt: ahead, archived: false, tags: [], displayName: "Copia di un altro account", avatarDataUrl: "data:image/png;base64,AAAA" }]
  });
  await useStudyStore.getState().updatePreferences({ displayName: "Camilla", avatarDataUrl: "" });
  const saved = useStudyStore.getState().preferences.find((item) => item.id === "main");
  assert.equal(saved.displayName, "Camilla");
  assert.equal(saved.avatarDataUrl, "");
  assert.ok(Date.parse(saved.updatedAt) > Date.parse(ahead));
});

test("updatePreferences: senza copia salvata il timbro è adesso", async () => {
  useStudyStore.setState({ loading: true, locked: false, preferences: [] });
  const before = Date.now();
  await useStudyStore.getState().updatePreferences({ displayName: "Camilla" });
  const saved = useStudyStore.getState().preferences.find((item) => item.id === "main");
  assert.equal(saved.displayName, "Camilla");
  assert.ok(Date.parse(saved.updatedAt) >= before && Date.parse(saved.updatedAt) <= Date.now());
});
