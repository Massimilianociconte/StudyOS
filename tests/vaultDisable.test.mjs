import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { resetBaseline, setPersistenceSuspended, setVaultSession, whenPersisted } from "../src/lib/persistence.ts";
import { deriveVaultKey } from "../src/lib/crypto.ts";
import { collectionTable, dataTables, db } from "../src/lib/db.ts";
import { pickCollections } from "../src/lib/collections.ts";
import { defaultSettings } from "../src/data/defaults.ts";

// P8: «Togli la password» riscrive tutte le tabelle in chiaro. Prima prendeva i dati PRIMA della
// scrittura e poi rimetteva in memoria quella copia: una modifica arrivata nel frattempo (pull dal
// cloud, sessione salvata dal Pomodoro) spariva, e il cursore cloud andava avanti lo stesso.
// In Node non c'è IndexedDB: transazione e tabelle sono finte e registrano le scritture.

const task = (id, title, updatedAt) => ({
  id, title, status: "todo", priority: "medium", importance: "medium", subtaskIds: [], tags: [], createdAt: updatedAt, updatedAt
});

test("P8: disattivare la password non perde le modifiche arrivate durante la riscrittura", async () => {
  const settings = { ...defaultSettings(), security: { ...defaultSettings().security, mode: "vault" } };
  const t1 = task("t1", "Prima", "2026-11-12T08:00:00.000Z");
  useStudyStore.setState({ loading: false, locked: false, settings, tasks: [t1] });
  setVaultSession(true, await deriveVaultKey("prova", undefined, 1_000));
  setPersistenceSuspended(false);
  resetBaseline(pickCollections(useStudyStore.getState()), settings);

  const tableWrites = new Map();
  const outbox = [];
  const record = (name) => (rows) => {
    tableWrites.set(name, [...(tableWrites.get(name) ?? []), ...(Array.isArray(rows) ? rows : [rows])]);
  };
  const patched = [];
  const patch = (target, name, value) => {
    target[name] = value;
    patched.push([target, name]);
  };
  patch(db, "transaction", async (_mode, _tables, scope) => scope());
  patch(db.settings, "put", async () => undefined);
  patch(db.vault, "put", async () => undefined);
  patch(db.syncOutbox, "bulkPut", async (rows) => void outbox.push(...rows));
  let during = null;
  patch(db.vault, "clear", async () => {
    // A metà della riscrittura: arriva un pull dal cloud e si salva una modifica fatta qui.
    if (during) return;
    during = Promise.all([
      useStudyStore.getState().applyRemoteChanges([
        { collection: "tasks", id: "t2", entity: task("t2", "Dal cloud", "2026-11-12T09:00:00.000Z"), stamp: Date.parse("2026-11-12T09:00:00.000Z") }
      ]),
      useStudyStore.getState().updateTask("t1", { title: "Modificata qui" })
    ]);
  });
  for (const table of dataTables) {
    patch(table, "clear", async () => undefined);
    patch(table, "bulkPut", record(table.name));
    patch(table, "bulkDelete", async () => undefined);
  }
  try {
    await useStudyStore.getState().disableVault("prova");
    assert.ok(during, "la modifica è arrivata durante la riscrittura");
    await during;
    await whenPersisted();

    const state = useStudyStore.getState();
    assert.equal(state.settings.security.mode, "standard");
    assert.deepEqual(state.tasks.map((item) => [item.id, item.title]).sort(), [["t1", "Modificata qui"], ["t2", "Dal cloud"]]);
    // Su disco, in chiaro, ci sono entrambe le modifiche.
    const written = new Map((tableWrites.get(collectionTable("tasks").name) ?? []).map((item) => [item.id, item.title]));
    assert.equal(written.get("t1"), "Modificata qui");
    assert.equal(written.get("t2"), "Dal cloud");
    // La modifica fatta qui va al cloud; quella arrivata dal cloud no (niente eco).
    assert.deepEqual([...new Set(outbox.map((row) => row.key))], ["task:t1"]);
  } finally {
    for (const [target, name] of patched.reverse()) delete target[name];
  }
});

test("P8: attivare e togliere la password copiano ciò che è su disco, dentro la stessa operazione esclusiva", () => {
  const source = readFileSync(new URL("../src/store/useStudyStore.ts", import.meta.url), "utf8");
  const body = (name) => {
    const start = source.indexOf(`${name}: async`);
    assert.ok(start > 0, name);
    return source.slice(start, source.indexOf("\n    },\n", start));
  };
  for (const name of ["enableVault", "disableVault"]) {
    const text = body(name);
    // Niente copia dello stato presa prima dell'attesa e poi rimessa in memoria o nella base.
    assert.doesNotMatch(text, /pickCollections\(get\(\)\)/, name);
    assert.match(text, /runExclusive\(async \(\) => \{[\s\S]*persistedCollections\(\)[\s\S]*setVaultSession\([\s\S]*\}\);\s*await commit\(\);/, name);
  }
});
