import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { outboxWriter, resetBaseline, setPersistenceSuspended, setVaultSession, whenPersisted } from "../src/lib/persistence.ts";
import { newerCopy } from "../src/lib/syncMerge.ts";
import { dataTables, db } from "../src/lib/db.ts";
import { pickCollections } from "../src/lib/collections.ts";
import { defaultSettings } from "../src/data/defaults.ts";

// P15: senza Web Locks (contesto non sicuro, Safari vecchio) ogni scheda è attiva. La scheda A salva
// X = V2 e la mette in coda; la scheda B ha ancora V1 in memoria (uguale al cloud), invia V1 per la
// voce di A, il server la accetta (stesso timbro, stesso contenuto) e B toglie la voce: V2 non parte.
// Ora la voce porta chi l'ha scritta; per le voci di un'altra pagina si invia la copia più recente tra
// memoria e disco.

const task = (id, title, updatedAt) => ({
  id, title, status: "todo", priority: "medium", importance: "medium", subtaskIds: [], tags: [], createdAt: "2026-11-12T08:00:00.000Z", updatedAt
});

test("P15: tra memoria e disco si invia la copia più recente; a parità, quella in memoria", () => {
  const v1 = task("x", "V1", "2026-11-12T08:00:00.000Z");
  const v2 = task("x", "V2", "2026-11-12T09:00:00.000Z");
  assert.equal(newerCopy("x", v1, v2), v2);
  assert.equal(newerCopy("x", v2, v1), v2);
  assert.equal(newerCopy("x", v1, { ...v1, title: "stesso timbro" }), v1);
  // Una riga su disco non valida (altra entità, senza timbro, assente) non sostituisce mai la memoria.
  assert.equal(newerCopy("x", v1, undefined), v1);
  assert.equal(newerCopy("x", v1, { ...v2, id: "y" }), v1);
  assert.equal(newerCopy("x", v1, "testo"), v1);
});

test("P15: le voci accodate da un salvataggio portano l'identità di questa pagina", async () => {
  const settings = defaultSettings();
  useStudyStore.setState({ loading: false, locked: false, settings, tasks: [task("t1", "Prima", "2026-11-12T08:00:00.000Z")] });
  setVaultSession(false, null);
  setPersistenceSuspended(false);
  resetBaseline(pickCollections(useStudyStore.getState()), settings);
  const queued = [];
  const patched = [];
  const patch = (target, name, value) => {
    target[name] = value;
    patched.push([target, name]);
  };
  patch(db, "transaction", async (_mode, _tables, scope) => scope());
  patch(db.settings, "put", async () => undefined);
  patch(db.syncOutbox, "bulkPut", async (rows) => void queued.push(...rows));
  for (const table of dataTables) {
    patch(table, "bulkPut", async () => undefined);
    patch(table, "bulkDelete", async () => undefined);
  }
  try {
    await useStudyStore.getState().updateTask("t1", { title: "Dopo" });
    await whenPersisted();
  } finally {
    for (const [target, name] of patched.reverse()) delete target[name];
  }
  assert.equal(typeof outboxWriter(), "string");
  assert.ok(outboxWriter().length > 0);
  assert.deepEqual(queued.map((row) => [row.key, row.writer]), [["task:t1", outboxWriter()]]);
});

test("P15: push legge dal disco le voci non scritte da questa pagina (senza vault) e invia la più recente", () => {
  const source = readFileSync(new URL("../src/lib/cloudSync.ts", import.meta.url), "utf8");
  const push = source.slice(source.indexOf("const push = async"), source.indexOf("const firstSync"));
  assert.match(push, /row\.writer !== outboxWriter\(\)/);
  assert.match(push, /await readStoredRows\(/);
  assert.match(push, /newerCopy\(row\.entityId, /);
});

test("P15 (revisione): la lettura dal disco serve solo senza Web Locks, e legge a blocchi", () => {
  // Con Web Locks una sola scheda è attiva: le voci di un'altra pagina vengono da prima del
  // ricaricamento e la memoria le ha già lette dal disco. Prima: una get per voce a ogni invio
  // (migliaia alla prima sync di un account grande).
  const source = readFileSync(new URL("../src/lib/cloudSync.ts", import.meta.url), "utf8");
  const push = source.slice(source.indexOf("const push = async"), source.indexOf("const firstSync"));
  assert.match(push, /const foreign = vault \|\| singleActiveTab\(\) \? \[\] : queued\.filter/);
  assert.match(source, /const singleActiveTab = \(\) => typeof navigator !== "undefined" && typeof navigator\.locks\?\.request === "function";/);
  const read = source.slice(source.indexOf("const readStoredRows"), source.indexOf("const breakTie"));
  assert.match(read, /\.bulkGet\(/);
  assert.doesNotMatch(read, /Promise\.all/);
});
