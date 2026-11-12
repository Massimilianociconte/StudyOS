import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LocalResetError, clearAllLocalData, localResetGuard, noteLocalReset } from "../src/lib/persistence.ts";
import { db } from "../src/lib/db.ts";

// P10: «Svuota dispositivo» cancella cursore e flag di migrazione per riscaricare tutto. Una prima
// sync già in volo li riscriveva alla fine (cursore = ultima riga vista, migrated = adesso): la passata
// successiva faceva solo un pull degli ultimi secondi e il dispositivo restava vuoto.

test("P10: dopo uno svuotamento del dispositivo la passata in volo non può più scrivere i suoi segni", async () => {
  const guard = localResetGuard();
  guard();
  const patched = [];
  const patch = (target, name, value) => {
    target[name] = value;
    patched.push([target, name]);
  };
  const fakeTable = { clear: async () => undefined };
  patch(db, "transaction", async (_mode, _tables, scope) => scope());
  for (const table of [db.vault, db.syncOutbox, db.sharedItems, db.sharedOutbox, ...(await import("../src/lib/db.ts")).dataTables]) {
    patch(table, "clear", fakeTable.clear);
  }
  patch(db.meta, "filter", () => ({ delete: async () => 0 }));
  try {
    await clearAllLocalData();
  } finally {
    for (const [target, name] of patched.reverse()) delete target[name];
  }
  assert.throws(guard, LocalResetError);
  // Una passata nuova parte dallo stato svuotato.
  const next = localResetGuard();
  next();
  noteLocalReset();
  assert.throws(next, LocalResetError);
});

test("P10: cursore, migrazione, unione, schema e ultima sync si scrivono solo se il dispositivo non è stato svuotato", () => {
  const source = readFileSync(new URL("../src/lib/cloudSync.ts", import.meta.url), "utf8");
  const writes = [...source.matchAll(/await setMeta\(metaKeys\.(cursor|migrated|merged|schema|lastSync)\(/g)];
  assert.ok(writes.length >= 5, "scritture dei segni della sync");
  for (const write of writes) {
    const before = source.slice(Math.max(0, write.index - 400), write.index);
    assert.match(before, /assertNoLocalReset\(\);[^;]*;?\s*(?:[^\n]*\n\s*){0,4}$/, `controllo prima di setMeta(${write[1]})`);
  }
  // La guardia della passata si prende dopo bindUser (che può svuotare il dispositivo da sé).
  assert.match(source, /await bindUser\(userId\);\s*passGuard = localResetGuard\(\);/);
  // Un reset a metà non è un errore: si ripete la passata, che riparte da zero.
  assert.match(source, /error instanceof LocalResetError\) \{\n[^\n]*\n\s*rerun = true;\n\s*return;/);
  // «Svuota dispositivo»: il segno è preso prima di cancellare cursore e migrazione.
  assert.match(source, /export const resetCloudDeviceState = async \(\) => \{[\s\S]*?noteLocalReset\(\);[\s\S]*?deleteMeta\(metaKeys\.cursor/);
});
