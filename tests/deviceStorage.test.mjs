import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const { PROFILE_STORAGE_KEYS, GETTING_STARTED_HIDDEN_KEY, clearProfileStorage } = await import("../src/lib/deviceStorage.ts");

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("cancella le chiavi del profilo e lascia sessione, id del browser e chiavi tecniche", () => {
  const storage = new Map([
    ...PROFILE_STORAGE_KEYS.map((key) => [key, "x"]),
    ["studyos-auth", "sessione"],
    ["studyos-agent-browser", "browser_abc12345"],
    ["studyos-chunk-reload", "1"],
    ["altro-sito", "resta"]
  ]);
  clearProfileStorage({ removeItem: (key) => storage.delete(key) });
  assert.deepEqual([...storage.keys()].sort(), ["altro-sito", "studyos-agent-browser", "studyos-auth", "studyos-chunk-reload"]);
});

test("storage che lancia o assente: nessun errore", () => {
  assert.doesNotThrow(() =>
    clearProfileStorage({
      removeItem: () => {
        throw new Error("SecurityError");
      }
    })
  );
  assert.doesNotThrow(() => clearProfileStorage(null));
});

test("ogni chiave è quella usata davvero nel codice (niente nomi che si perdono)", () => {
  const owners = {
    "studyos-agent-token": "src/lib/agentLocal.ts",
    "studyos-agent-policy": "src/lib/agentLocal.ts",
    "studyos-agent-audit": "src/lib/agentLocal.ts",
    "studyos-agent-hub": "src/lib/agentLocal.ts",
    "studyos-agent-secret": "src/lib/agentLocal.ts",
    "studyos-event-reminders-fired": "src/lib/eventReminders.ts"
  };
  for (const key of PROFILE_STORAGE_KEYS) {
    if (key === GETTING_STARTED_HIDDEN_KEY) continue;
    assert.ok(owners[key], `chiave senza file: ${key}`);
    assert.ok(source(owners[key]).includes(`"${key}"`), `${key} non è più in ${owners[key]}`);
  }
  assert.match(source("src/views/DashboardView.tsx"), /GETTING_STARTED_HIDDEN_KEY/);
});

test("un invito aperto prima di accedere sopravvive a un cambio di account con «sostituisci»", () => {
  for (const key of ["studyos-pending-invite", "studyos-pending-share", "studyos-pending-confirmation-email"]) {
    assert.ok(!PROFILE_STORAGE_KEYS.includes(key), `${key} non va cancellata da resetAllData`);
  }
});

test("le chiavi studyos-* del localStorage sono tutte cancellate o lasciate apposta", () => {
  // Chiavi che restano: sessione (la toglie l'uscita dall'account), id casuale del browser,
  // timer (lo azzera lo store), studyos-ui (clearUiState), studyos-local-db (database, svuotato a parte),
  // e i passi in corso dell'accesso (email da confermare, inviti aperti prima di accedere).
  const kept = new Set([
    "studyos-auth",
    "studyos-agent-browser",
    "studyos-study-timer",
    "studyos-ui",
    "studyos-local-db",
    "studyos-pending-confirmation-email",
    "studyos-pending-invite",
    "studyos-pending-share"
  ]);
  const files = [
    "src/lib/agentLocal.ts",
    "src/lib/eventReminders.ts",
    "src/components/CloudPanel.tsx",
    "src/lib/groupInvite.ts",
    "src/lib/shareInvite.ts",
    "src/lib/studyTimer.ts",
    "src/lib/uiState.ts",
    "src/lib/supabase.ts"
  ];
  for (const file of files) {
    for (const [, key] of source(file).matchAll(/"(studyos-[a-z-]+)"/g)) {
      assert.ok(kept.has(key) || PROFILE_STORAGE_KEYS.includes(key), `${key} (${file}) non è né cancellata né tra quelle che restano`);
    }
  }
});

test("il reset dello store pulisce il profilo sul dispositivo e ferma il timer", () => {
  const store = source("src/store/useStudyStore.ts");
  const reset = store.slice(store.indexOf("resetAllData: async"), store.indexOf("retryPersist: async"));
  assert.match(reset, /clearUiState\(\);/);
  assert.match(reset, /clearProfileStorage\(\);/);
  assert.match(reset, /setTimerState\(set, defaultTimer\(\)\);/, "timer fermo in memoria e nello storage (anche nelle altre schede)");
  assert.match(reset, /timerReview: false/);
});
