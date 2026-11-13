import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Stato delle notifiche condiviso tra pagina e service worker (src/lib/pushLocal.ts), titolo nascosto
// con la password dell'app, dispositivi e privacy della riga (src/lib/push.ts).
const local = await import("../src/lib/pushLocal.ts");
const push = await import("../src/lib/push.ts");

const ORIGIN = "https://massimilianociconte.github.io";
const fakeCaches = () => {
  const entries = new Map();
  const strip = (url) => url.split("?")[0];
  const matches = (url, request, options) => (options?.ignoreSearch ? strip(url) === strip(request) : url === request);
  const cache = {
    keys: async (request, options) => [...entries.keys()].filter((url) => request === undefined || matches(url, request, options)).map((url) => ({ url })),
    put: async (request, response) => void entries.set(request, response),
    delete: async (request, options) => {
      let removed = false;
      for (const url of [...entries.keys()]) if (matches(url, request, options)) removed = entries.delete(url) || removed;
      return removed;
    }
  };
  return { open: async () => cache, entries };
};

test("ricordo dei promemoria comparsi: l'ultimo vince, tag con caratteri speciali, ricordi vecchi tolti", async () => {
  const caches = fakeCaches();
  const tag = "studyos-reminder-e1@2026-11-12#0d15m@1";
  const now = Date.parse("2026-11-12T09:00:00.000Z");
  await local.recordReminderShown(tag, "page", now - 60_000, caches, ORIGIN);
  await local.recordReminderShown(tag, "push", now, caches, ORIGIN);
  assert.deepEqual(await local.readReminderShown(tag, caches, ORIGIN), { at: now, by: "push" });
  assert.equal([...caches.entries.keys()].filter((url) => url.includes("reminder-shown")).length, 1, "una chiave per tag");
  assert.ok([...caches.entries.keys()][0].includes(encodeURIComponent(tag)));
  await local.recordReminderShown("studyos-reminder-vecchio", "page", now - 4 * 24 * 60 * 60_000, caches, ORIGIN);
  await local.recordReminderShown("studyos-reminder-nuovo", "page", now, caches, ORIGIN);
  assert.equal(await local.readReminderShown("studyos-reminder-vecchio", caches, ORIGIN), null, "oltre 3 giorni: tolto");
  assert.equal(await local.readReminderShown(tag, caches, null), null, "senza origine: niente");
  assert.equal(await local.readReminderShown(tag, null, ORIGIN), null, "senza Cache Storage: niente");
  await local.recordReminderShown(tag, "page", now, { open: () => Promise.reject(new Error("quota")) }, ORIGIN);
});

test("già comparso: solo se il ricordo è dell'istante del promemoria (o di poco prima)", () => {
  const at = Date.parse("2026-11-12T09:00:00.000Z");
  assert.equal(local.alreadyShown(null, at), false);
  assert.equal(local.alreadyShown({ at: at + 30_000, by: "push" }, at), true);
  assert.equal(local.alreadyShown({ at: at - 60_000, by: "push" }, at), true, "cron e orologi di poco avanti");
  assert.equal(local.alreadyShown({ at: at - 10 * 60_000, by: "push" }, at), false, "un ricordo di prima non vale");
  assert.equal(local.parseShownKey(`${ORIGIN}/__studyos__/reminder-shown/x?at=1&by=altro`), null);
  assert.equal(local.parseShownKey("non un url"), null);
});

test("titolo nascosto: solo con la password dell'app, salvo «Mostra il titolo nelle notifiche»", () => {
  assert.equal(local.pushPrivateOf(undefined), false);
  assert.equal(local.pushPrivateOf({ security: { mode: "none" } }), false);
  assert.equal(local.pushPrivateOf({ security: { mode: "vault" } }), true);
  assert.equal(local.pushPrivateOf({ security: { mode: "vault" }, pushShowTitles: false }), true);
  assert.equal(local.pushPrivateOf({ security: { mode: "vault" }, pushShowTitles: true }), false);
  assert.equal(local.PRIVATE_REMINDER_TITLE, "Promemoria StudyOS");
  const sql = readFileSync(new URL("../supabase/push-reminders.sql", import.meta.url), "utf8");
  assert.match(sql, /when v_private then 'Promemoria StudyOS'/, "stesso testo del job");
});

test("riga del dispositivo: private nello stato, riscritta quando cambia, colonna mancante tollerata", () => {
  const state = push.parsePushState(JSON.stringify({ endpoint: "https://fcm.googleapis.com/x", userId: "u", at: 1, private: true }));
  assert.equal(state.private, true);
  assert.equal(push.parsePushState(JSON.stringify({ endpoint: "https://e", userId: "u", at: 1 })).private, undefined);
  const now = 1000;
  const base = { endpoint: "https://e", userId: "u", at: now, private: false };
  assert.equal(push.shouldRefresh(base, "https://e", "u", now), false);
  assert.equal(push.shouldRefresh(base, "https://e", "u", now, false), false);
  assert.equal(push.shouldRefresh(base, "https://e", "u", now, true), true, "password accesa: si riscrive");
  assert.equal(push.shouldRefresh({ ...base, private: undefined }, "https://e", "u", now, false), true, "stato di prima");
  assert.equal(push.isMissingPrivateColumn({ code: "PGRST204", message: "Could not find the 'private' column" }), true);
  assert.equal(push.isMissingPrivateColumn({ code: "42703", message: 'column "private" does not exist' }), true);
  assert.equal(push.isMissingPrivateColumn({ code: "42501", message: "private" }), false);
  assert.equal(push.isMissingPrivateColumn(null), false);
});

test("dispositivi: solo il tipo di browser dall'host, mai l'endpoint", () => {
  assert.equal(push.pushDeviceKindOf("https://fcm.googleapis.com/fcm/send/abc"), "chrome");
  assert.equal(push.pushDeviceKindOf("https://updates.push.services.mozilla.com/wpush/v2/x"), "firefox");
  assert.equal(push.pushDeviceKindOf("https://web.push.apple.com/abc"), "safari");
  assert.equal(push.pushDeviceKindOf("https://wns2-par02p.notify.windows.com/w/?token=x"), "edge");
  assert.equal(push.pushDeviceKindOf("https://push.example.org/x"), "other");
  assert.equal(push.pushDeviceKindOf("rotto"), "other");
  const source = readFileSync(new URL("../src/lib/push.ts", import.meta.url), "utf8");
  assert.match(source, /\.select\("id, endpoint, last_seen_at"\)\s*\.eq\("user_id", cloud\.userId\)/);
  assert.match(source, /\.delete\(\)\.eq\("user_id", cloud\.userId\)\.eq\("id", id\)/, "«Rimuovi» toglie la riga sul server, anche di un dispositivo perso");
  assert.match(source, /if \(here && removed\.includes\(here\)\) await disablePush\(\)/, "questo dispositivo: spento anche qui");
  const toggle = readFileSync(new URL("../src/components/PushToggle.tsx", import.meta.url), "utf8");
  assert.match(toggle, /pushLabels\.deviceRemove\b/);
  assert.match(toggle, /min-h-11 min-w-11/, "tocco di almeno 44 px");
  assert.match(toggle, /userId && vaultOn \?/, "«Mostra il titolo nelle notifiche» solo con la password dell'app");
  assert.match(toggle, /updateSettings\(\{ pushShowTitles: !showTitles \}\)/);
  assert.match(toggle, /enablePush\(\{ private: pushPrivateOf\(useStudyStore\.getState\(\)\.settings\) \}\)/);
});

// ─── Revisione finale (L-5): lo svuotamento del dispositivo pulisce anche la cache delle notifiche ───

const ACCOUNT_A = "504b3482-7f1b-4add-bfbc-7b3effbf21d7";
const ACCOUNT_B = "fc0191e0-6663-4a43-b060-131e397f02cc";
const session = (id) => JSON.stringify({ access_token: "x", user: { id } });

const filled = async () => {
  const caches = fakeCaches();
  const now = Date.now();
  await local.writePushAccount(ACCOUNT_A, caches, ORIGIN);
  await local.recordReminderShown("studyos-reminder-e1@2026-11-12#0d15m@1", "push", now, caches, ORIGIN);
  await local.recordReminderShown("studyos-reminder-e2", "page", now, caches, ORIGIN);
  return caches;
};
const keysOf = (caches) => [...caches.entries.keys()];

test("svuotamento: via i promemoria comparsi e l'account di prima; resta solo l'account entrato adesso", async () => {
  const signedIn = await filled();
  assert.equal(keysOf(signedIn).length, 3);
  await local.resetPushLocal(session(ACCOUNT_B), signedIn, ORIGIN);
  assert.deepEqual(keysOf(signedIn), [`${ORIGIN}/__studyos__/push-account?account=${ACCOUNT_B}`], "cambio di account con «solo il nuovo»");
  assert.equal(await local.readReminderShown("studyos-reminder-e2", signedIn, ORIGIN), null);

  const same = await filled();
  await local.resetPushLocal(session(ACCOUNT_A), same, ORIGIN);
  assert.equal(await local.readPushAccount(same, ORIGIN), ACCOUNT_A, "«Cancella tutti i dati» con l'account ancora entrato: il filtro resta");
  assert.equal(keysOf(same).length, 1);

  const signedOut = await filled();
  await local.resetPushLocal(null, signedOut, ORIGIN);
  assert.equal(await local.readPushAccount(signedOut, ORIGIN), null, "nessuna sessione: nessun account (l'id di prima non resta)");
  assert.ok(!keysOf(signedOut).some((url) => url.includes(ACCOUNT_A)));
  assert.equal(keysOf(signedOut).length, 1);

  const unreadable = await filled();
  await local.resetPushLocal("{rotto", unreadable, ORIGIN);
  assert.equal(await local.readPushAccount(unreadable, ORIGIN), ACCOUNT_A, "sessione illeggibile: l'account resta com'è");
  assert.equal(keysOf(unreadable).length, 1, "i promemoria comparsi vanno via lo stesso");

  // Mai un errore: senza Cache Storage, senza origine o con lo storage che fallisce.
  await local.resetPushLocal(null, null, ORIGIN);
  await local.resetPushLocal(null, signedIn, null);
  await local.resetPushLocal(session(ACCOUNT_A), { open: () => Promise.reject(new Error("quota")) }, ORIGIN);
});

test("svuotamento: resetAllData pulisce la cache delle notifiche con la sessione salvata adesso", () => {
  assert.equal(local.storedAuthUserId(session(ACCOUNT_A)), ACCOUNT_A);
  assert.equal(local.storedAuthUserId(null), null);
  assert.equal(local.storedAuthUserId("{rotto"), undefined);
  assert.equal(push.storedAuthUserId, local.storedAuthUserId, "push.ts usa la stessa funzione");
  const store = readFileSync(new URL("../src/store/useStudyStore.ts", import.meta.url), "utf8");
  const reset = store.slice(store.indexOf("resetAllData: async"), store.indexOf("retryPersist: async"));
  assert.match(reset, /clearProfileStorage\(\);\s*(?:\/\/[^\n]*\n\s*)*await resetPushLocal\(readStoredAuth\(\)\);/, "dopo la pulizia del profilo, in ogni svuotamento");
  assert.match(store, /localStorage\.getItem\(AUTH_STORAGE_KEYS\[0\]\)/, "la chiave della sessione di supabase-js");
  assert.match(store, /^import \{ resetPushLocal \} from "\.\.\/lib\/pushLocal";$/m, "pushLocal è già nel bundle iniziale, senza dipendenze");
});
