import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { AUTH_STORAGE_KEYS, SIGN_OUT_TIMEOUT_MS, signOutThisDevice } = await import("../src/lib/deviceSignOut.ts");

/** Dispositivo finto: storage con la sessione salvata, stato della sync con la sessione in memoria. */
const device = ({ configured = true, signOut } = {}) => {
  const storage = new Map([
    ["studyos-auth", "{\"access_token\":\"x\"}"],
    ["studyos-auth-user", "{}"],
    ["studyos-auth-code-verifier", "v"],
    ["studyos-other", "resta"]
  ]);
  const timers = [];
  const log = [];
  let session = "sessione";
  const env = {
    configured,
    signOut: async () => {
      log.push("signOut");
      return signOut();
    },
    removeItem: (key) => {
      log.push(`remove:${key}`);
      storage.delete(key);
    },
    dropSession: () => {
      log.push("dropSession");
      session = null;
    },
    schedule: (fn, ms) => timers.push({ fn, ms }),
    timeoutMs: 50
  };
  return {
    env,
    storage,
    log,
    timers,
    get session() {
      return session;
    }
  };
};

const noSessionLeft = (fake) => {
  for (const key of AUTH_STORAGE_KEYS) assert.equal(fake.storage.has(key), false, key);
  assert.equal(fake.storage.get("studyos-other"), "resta", "solo le chiavi della sessione");
  assert.equal(fake.session, null, "niente sessione nello stato della sync");
};

test("collegato e online: esce dall'account e non serve ricaricare", async () => {
  const fake = device({ signOut: async () => ({ localOnly: false }) });
  assert.equal(await signOutThisDevice(fake.env), "signed-out");
  noSessionLeft(fake);
  assert.equal(fake.log[0], "signOut", "prima l'uscita, poi la pulizia");
});

test("offline: supabase-js non toglie la sessione, la si toglie qui e si ricarica", async () => {
  const fake = device({ signOut: async () => ({ localOnly: true }) });
  assert.equal(await signOutThisDevice(fake.env), "removed-here");
  noSessionLeft(fake);
});

test("errore del server o libreria non scaricata: la sessione va via lo stesso", async () => {
  for (const failure of [new Error("500"), new TypeError("Failed to fetch dynamically imported module")]) {
    const fake = device({
      signOut: async () => {
        throw failure;
      }
    });
    assert.equal(await signOutThisDevice(fake.env), "removed-here");
    noSessionLeft(fake);
  }
});

test("rete che non risponde: dopo il tempo massimo la sessione si toglie solo qui", async () => {
  const fake = device({ signOut: () => new Promise(() => undefined) });
  const running = signOutThisDevice(fake.env);
  assert.equal(fake.timers.length, 1);
  assert.equal(fake.timers[0].ms, 50);
  fake.timers[0].fn();
  assert.equal(await running, "removed-here");
  noSessionLeft(fake);
  assert.ok(SIGN_OUT_TIMEOUT_MS >= 5000 && SIGN_OUT_TIMEOUT_MS <= 15000, "attesa ragionevole sulla schermata di blocco");
});

test("senza account nell'app: niente supabase-js, nessuna rete", async () => {
  const fake = device({
    configured: false,
    signOut: async () => {
      throw new Error("non deve essere chiamato");
    }
  });
  assert.equal(await signOutThisDevice(fake.env), "none");
  assert.ok(!fake.log.includes("signOut"));
  noSessionLeft(fake);
});

test("le chiavi tolte sono quelle della sessione di supabase.ts", () => {
  const source = readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
  const key = source.match(/AUTH_STORAGE_KEY = "([^"]+)"/)?.[1];
  assert.equal(key, AUTH_STORAGE_KEYS[0]);
  assert.deepEqual(AUTH_STORAGE_KEYS, [key, `${key}-code-verifier`, `${key}-user`]);
});

test("schermata di blocco: esce solo da questo dispositivo, prima di cancellare, con supabase-js caricato a parte", () => {
  const source = readFileSync(new URL("../src/components/LockScreen.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from "\.\.\/lib\/supabase"/, "nessun import statico: supabase-js resta fuori dal bundle iniziale");
  assert.match(source, /import\("\.\.\/lib\/supabase"\)\.then\(\(module\) => module\.signOut\("local"\)\)/, "scope local: mai gli altri dispositivi");
  const erase = source.slice(source.indexOf("const erase"));
  assert.ok(erase.indexOf("signOutThisDevice(") < erase.indexOf("resetAllData("), "uscita prima della cancellazione");
});

test("cancella anche dall'account: svuota qui, poi il server elimina tutto (anche ciò che qui non c'era), poi la sync", () => {
  const view = readFileSync(new URL("../src/views/SettingsView.tsx", import.meta.url), "utf8");
  const erase = view.slice(view.indexOf("const eraseData"));
  const reset = erase.indexOf("resetAllData({ propagate: alsoCloud })");
  const server = erase.indexOf("eraseAccountData()");
  const sync = erase.indexOf("requestSync()");
  assert.ok(reset >= 0 && reset < server && server < sync, "ordine: svuota, server, sync");
  assert.match(erase, /erased === "failed"\s*\?\s*SETTINGS_TEXT\.erase\.accountUnreachable/);
  const client = readFileSync(new URL("../src/lib/supabase.ts", import.meta.url), "utf8");
  assert.match(client, /rpc\("erase_studyos_account_items"\)/);
  assert.match(client, /PGRST202"\) return "missing"/, "progetto senza la funzione: restano le eliminazioni di qui");
  const sql = readFileSync(new URL("../supabase/schema.sql", import.meta.url), "utf8");
  assert.match(sql, /create or replace function public\.erase_studyos_account_items\(\)/);
  assert.match(sql, /revoke all on function public\.erase_studyos_account_items\(\) from anon;/);
});
