import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { persistedCollections, resetBaseline, setPersistenceSuspended, setVaultSession, whenPersisted } from "../src/lib/persistence.ts";
import { deriveVaultKey } from "../src/lib/crypto.ts";
import { collectionTable, dataTables, db } from "../src/lib/db.ts";
import { pickCollections } from "../src/lib/collections.ts";
import { defaultSettings } from "../src/data/defaults.ts";
import { VAULT_BUSY_TEXT } from "../src/lib/labels.ts";

// Revisione A6 (alta): «Blocca» premuto mentre «Togli la password» decifra i file dei materiali
// svuotava la memoria e la base salvata; la riscrittura copiava allora tabelle vuote, toglieva il
// record del vault e lasciava i salvataggi sospesi: tutti i dati di questo dispositivo persi.
// In Node non c'è IndexedDB: transazione e tabelle sono finte e registrano le scritture.

const task = (id, title, updatedAt) => ({
  id, title, status: "todo", priority: "medium", importance: "medium", subtaskIds: [], tags: [], createdAt: updatedAt, updatedAt
});

const vaultSettings = () => ({ ...defaultSettings(), security: { ...defaultSettings().security, mode: "vault" } });

const fakeDisk = () => {
  const writes = { tables: new Map(), vaultCleared: false, vaultPut: 0, settingsPut: 0, tablesCleared: 0 };
  const patched = [];
  const patch = (target, name, value) => {
    target[name] = value;
    patched.push([target, name]);
  };
  patch(db, "transaction", async (_mode, _tables, scope) => scope());
  patch(db.settings, "put", async () => {
    writes.settingsPut += 1;
  });
  patch(db.vault, "put", async () => {
    writes.vaultPut += 1;
  });
  patch(db.vault, "get", async () => undefined);
  patch(db.syncOutbox, "bulkPut", async () => undefined);
  patch(db.vault, "clear", async () => {
    writes.vaultCleared = true;
  });
  for (const table of dataTables) {
    patch(table, "clear", async () => {
      writes.tablesCleared += 1;
    });
    patch(table, "bulkPut", async (rows) => {
      writes.tables.set(table.name, [...(writes.tables.get(table.name) ?? []), ...rows]);
    });
    patch(table, "bulkDelete", async () => undefined);
  }
  return {
    writes,
    patch,
    restore: () => {
      for (const [target, name] of patched.reverse()) delete target[name];
    }
  };
};

const startUnlocked = async (tasks) => {
  const settings = vaultSettings();
  useStudyStore.setState({ loading: false, locked: false, settings, tasks });
  setVaultSession(true, await deriveVaultKey("prova", undefined, 1_000));
  setPersistenceSuspended(false);
  resetBaseline(pickCollections(useStudyStore.getState()), settings);
  return settings;
};

// I file dei materiali si decifrano prima di togliere il vault (secondi, su un telefono): è la finestra
// in cui la persona preme «Blocca».
const duringFileStep = (disk, step) => {
  globalThis.indexedDB = {};
  disk.patch(db.attachmentFiles, "toCollection", () => ({
    primaryKeys: async () => {
      await step();
      return [];
    }
  }));
};

test("Blocca durante «Togli la password»: rifiutato con un messaggio, i dati finiscono in chiaro", async () => {
  await startUnlocked([task("t1", "Prima", "2026-11-12T08:00:00.000Z"), task("t2", "Seconda", "2026-11-12T08:00:00.000Z")]);
  const disk = fakeDisk();
  let lockError;
  let busyDuring = false;
  try {
    duringFileStep(disk, async () => {
      busyDuring = useStudyStore.getState().vaultBusy;
      await useStudyStore.getState().lockVault().catch((error) => {
        lockError = error;
      });
    });
    await useStudyStore.getState().disableVault("prova");
    await whenPersisted();
    assert.equal(busyDuring, true, "durante il cambio lo stato lo dice (pulsanti Blocca disattivati)");
    assert.equal(lockError?.message, VAULT_BUSY_TEXT.lock, "il blocco è rifiutato con un messaggio semplice");
    const state = useStudyStore.getState();
    assert.equal(state.locked, false);
    assert.equal(state.vaultBusy, false, "a fine cambio i pulsanti tornano attivi");
    assert.equal(state.settings.security.mode, "standard");
    assert.deepEqual(state.tasks.map((t) => t.id), ["t1", "t2"]);
    assert.deepEqual(
      (disk.writes.tables.get(collectionTable("tasks").name) ?? []).map((t) => t.id).sort(),
      ["t1", "t2"],
      "le attività sono scritte in chiaro prima di togliere il vault"
    );
    assert.equal(disk.writes.vaultCleared, true);
  } finally {
    delete globalThis.indexedDB;
    disk.restore();
  }
});

test("Bloccato a metà per altra via: la riscrittura non scrive nulla e il vault resta", async () => {
  await startUnlocked([task("t1", "Prima", "2026-11-12T08:00:00.000Z")]);
  const disk = fakeDisk();
  try {
    // Stesso effetto di un blocco che non passa da lockVault (memoria e base svuotate, chiave tolta).
    duringFileStep(disk, async () => {
      setPersistenceSuspended(true);
      setVaultSession(true, null);
      resetBaseline(pickCollections({ ...useStudyStore.getState(), tasks: [] }), useStudyStore.getState().settings);
      useStudyStore.setState({ locked: true, tasks: [] });
    });
    await assert.rejects(useStudyStore.getState().disableVault("prova"), { message: VAULT_BUSY_TEXT.interrupted });
    await whenPersisted();
    assert.equal(disk.writes.vaultCleared, false, "il record cifrato resta: è l'unica copia");
    assert.equal(disk.writes.tablesCleared, 0);
    assert.equal(disk.writes.settingsPut, 0, "la modalità resta «vault»");
    assert.equal(persistedCollections().tasks.length, 0);
    assert.equal(useStudyStore.getState().vaultBusy, false);
  } finally {
    delete globalThis.indexedDB;
    disk.restore();
    useStudyStore.setState({ locked: false });
  }
});

test("Un secondo cambio di password mentre il primo è in corso è rifiutato", async () => {
  await startUnlocked([task("t1", "Prima", "2026-11-12T08:00:00.000Z")]);
  const disk = fakeDisk();
  const errors = [];
  let nested = false;
  try {
    duringFileStep(disk, async () => {
      if (nested) return;
      nested = true;
      await useStudyStore.getState().disableVault("prova").catch((error) => errors.push(error.message));
      await useStudyStore.getState().enableVault("un'altra password").catch((error) => errors.push(error.message));
    });
    await useStudyStore.getState().disableVault("prova");
    await whenPersisted();
    assert.deepEqual(errors, [VAULT_BUSY_TEXT.switching, VAULT_BUSY_TEXT.switching]);
    assert.equal(useStudyStore.getState().settings.security.mode, "standard");
  } finally {
    delete globalThis.indexedDB;
    disk.restore();
  }
});

test("Attivare la password: rifiutato se è già attiva o se StudyOS è bloccato, senza scrivere", async () => {
  const disk = fakeDisk();
  try {
    await startUnlocked([task("t1", "Prima", "2026-11-12T08:00:00.000Z")]);
    await assert.rejects(useStudyStore.getState().enableVault("una password nuova"), { message: VAULT_BUSY_TEXT.alreadyOn });
    useStudyStore.setState({ settings: defaultSettings(), locked: true });
    await assert.rejects(useStudyStore.getState().enableVault("una password nuova"), { message: VAULT_BUSY_TEXT.interrupted });
    assert.equal(disk.writes.vaultPut, 0);
    assert.equal(disk.writes.tablesCleared, 0);
  } finally {
    disk.restore();
    useStudyStore.setState({ locked: false });
  }
});

test("I pulsanti Blocca e quelli della password si fermano durante il cambio", () => {
  const shell = readFileSync(new URL("../src/components/AppShell.tsx", import.meta.url), "utf8");
  const lockButtons = shell.match(/lockVault\(\)\.catch/g) ?? [];
  assert.ok(lockButtons.length >= 3);
  assert.equal((shell.match(/disabled=\{vaultBusy\}/g) ?? []).length, lockButtons.length, "ogni pulsante Blocca è disattivato durante il cambio");
  const settings = readFileSync(new URL("../src/views/SettingsView.tsx", import.meta.url), "utf8");
  assert.match(settings, /Blocca ora[\s\S]{0,40}<\/Button>/);
  assert.ok((settings.match(/disabled=\{vaultBusy\}/g) ?? []).length >= 3, "Blocca ora, Proteggi e Togli la password");
});
