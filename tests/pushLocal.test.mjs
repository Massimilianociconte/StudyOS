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
