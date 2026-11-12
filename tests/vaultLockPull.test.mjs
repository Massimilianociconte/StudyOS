import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { PersistenceDiscardedError, resetBaseline, setPersistenceSuspended, setVaultSession, whenPersisted } from "../src/lib/persistence.ts";
import { deriveVaultKey } from "../src/lib/crypto.ts";
import { db } from "../src/lib/db.ts";
import { pickCollections } from "../src/lib/collections.ts";
import { defaultSettings } from "../src/data/defaults.ts";

// P9: il blocco del vault a metà pull. lockVault salva e poi svuota la memoria; una pagina del pull
// applicata tra il suo salvataggio e lo svuotamento finiva in un salvataggio che, sospeso, non
// scriveva nulla ma «riusciva»: il pull avanzava il cursore oltre righe mai salvate nel vault.
// In Node non c'è IndexedDB: transazione e tabelle sono finte.

const task = (id, title, updatedAt) => ({
  id, title, status: "todo", priority: "medium", importance: "medium", subtaskIds: [], tags: [], createdAt: updatedAt, updatedAt
});

test("P9: modifiche cloud applicate mentre il vault si blocca non risultano salvate", async () => {
  const settings = { ...defaultSettings(), security: { ...defaultSettings().security, mode: "vault" } };
  const t1 = task("t1", "Prima", "2026-11-12T08:00:00.000Z");
  useStudyStore.setState({ loading: false, locked: false, settings, tasks: [t1] });
  setVaultSession(true, await deriveVaultKey("prova", undefined, 1_000));
  setPersistenceSuspended(false);
  resetBaseline(pickCollections(useStudyStore.getState()), settings);

  const vaultWrites = [];
  const patched = [];
  const patch = (target, name, value) => {
    target[name] = value;
    patched.push([target, name]);
  };
  patch(db, "transaction", async (_mode, _tables, scope) => scope());
  patch(db.settings, "put", async () => undefined);
  patch(db.syncOutbox, "bulkPut", async () => undefined);
  let applied = null;
  patch(db.vault, "put", async (record) => {
    vaultWrites.push(record);
    // Il salvataggio di lockVault è già partito: arriva l'ultima pagina del pull.
    if (applied) return;
    applied = useStudyStore.getState().applyRemoteChanges([
      { collection: "tasks", id: "t2", entity: task("t2", "Dal cloud", "2026-11-12T09:00:00.000Z"), stamp: Date.parse("2026-11-12T09:00:00.000Z") }
    ]);
    applied.catch(() => undefined);
  });
  try {
    // Una modifica da salvare: il blocco scrive il vault e intanto arriva la pagina.
    useStudyStore.setState({ tasks: [{ ...t1, title: "Da salvare", updatedAt: "2026-11-12T08:10:00.000Z" }] });
    await useStudyStore.getState().lockVault();
    assert.ok(applied, "la pagina è arrivata durante il salvataggio del blocco");
    assert.equal(useStudyStore.getState().locked, true);
    // Il salvataggio sospeso non deve far credere al pull che le righe siano nel vault.
    await assert.rejects(applied, PersistenceDiscardedError);
    await whenPersisted();
    assert.equal(vaultWrites.length, 1, "dopo il blocco non si scrive più nulla");
  } finally {
    for (const [target, name] of patched.reverse()) delete target[name];
    useStudyStore.setState({ locked: false, tasks: [] });
    setPersistenceSuspended(false);
    setVaultSession(false, null);
    resetBaseline(pickCollections(useStudyStore.getState()), useStudyStore.getState().settings);
  }
});

test("P9: un salvataggio senza nulla da scartare resta riuscito anche se poi il vault si blocca", async () => {
  const settings = { ...defaultSettings(), security: { ...defaultSettings().security, mode: "vault" } };
  useStudyStore.setState({ loading: false, locked: false, settings, tasks: [task("t1", "Prima", "2026-11-12T08:00:00.000Z")] });
  setVaultSession(true, await deriveVaultKey("prova", undefined, 1_000));
  setPersistenceSuspended(false);
  resetBaseline(pickCollections(useStudyStore.getState()), settings);
  const patched = [];
  const patch = (target, name, value) => {
    target[name] = value;
    patched.push([target, name]);
  };
  patch(db, "transaction", async (_mode, _tables, scope) => scope());
  patch(db.settings, "put", async () => undefined);
  patch(db.syncOutbox, "bulkPut", async () => undefined);
  patch(db.vault, "put", async () => undefined);
  try {
    const edit = useStudyStore.getState().updateTask("t1", { title: "Salvata" });
    await useStudyStore.getState().lockVault();
    await edit;
    assert.equal(useStudyStore.getState().locked, true);
  } finally {
    for (const [target, name] of patched.reverse()) delete target[name];
    useStudyStore.setState({ locked: false, tasks: [] });
    setPersistenceSuspended(false);
    setVaultSession(false, null);
  }
});

test("P9: il pull ricontrolla il workspace dopo ogni attesa e prima di avanzare cursore o migrazione", () => {
  const source = readFileSync(new URL("../src/lib/cloudSync.ts", import.meta.url), "utf8");
  const between = (from, to) => {
    const start = source.indexOf(from);
    assert.ok(start >= 0, from);
    return source.slice(start, source.indexOf(to, start));
  };
  // Blocco durante la lettura della coda: il merge non deve girare sullo stato vuoto.
  assert.match(between("const mergeRows", "const pull ="), /await db\.syncOutbox\.toArray\(\);[\s\S]*?assertStoreReady\(\);[\s\S]*?planMerge\(/);
  assert.match(between("const mergeRows", "const pull ="), /applyRemoteChanges\([\s\S]*?\);\s*assertStoreReady\(\);/);
  assert.match(between("const pull =", "const readStoredRows"), /assertStoreReady\(\);\s*(?:assertSameSession\(userId\);\s*)?(?:[^\n]*\n\s*)?if \(maxSeen\) await setMeta\(metaKeys\.cursor/);
  assert.match(between("const firstSync", "const bindUser"), /assertStoreReady\(\);[^]*?await setMeta\(metaKeys\.merged/);
  // La scrittura dell'outbox si annulla anche con il workspace bloccato, non solo con la scheda ferma.
  assert.match(between("const outboxTransaction", "const schedule"), /!storeReady\(\)/);
});
