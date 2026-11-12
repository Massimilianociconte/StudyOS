import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Notifiche di questo dispositivo quando una sessione finisce: un solo aiuto (lib/pushDevice) per
// ogni uscita e cancellazione, e la guardia per la sessione che finisce da sola.
const { turnOffPushHere, startPushSessionGuard, syncPushPrivacy, PUSH_CHANGED_EVENT, PUSH_OFF_TIMEOUT_MS } = await import("../src/lib/pushDevice.ts");

const withWindow = (t) => {
  const previous = globalThis.window;
  const target = new EventTarget();
  globalThis.window = target;
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  return target;
};

const withPermission = (t, permission) => {
  const previous = globalThis.Notification;
  globalThis.Notification = { permission };
  t.after(() => {
    if (previous === undefined) delete globalThis.Notification;
    else globalThis.Notification = previous;
  });
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test("spegnere qui: chiama disablePush, avvisa la sincronizzazione dei promemoria, non lancia mai", async (t) => {
  const target = withWindow(t);
  let changed = 0;
  target.addEventListener(PUSH_CHANGED_EVENT, () => (changed += 1));
  let disabled = 0;
  await turnOffPushHere(1000, async () => ({ disablePush: async () => void (disabled += 1) }));
  assert.equal(disabled, 1);
  assert.equal(changed, 1);
  await turnOffPushHere(1000, async () => ({ disablePush: async () => Promise.reject(new Error("rete")) }));
  await turnOffPushHere(1000, () => Promise.reject(new Error("modulo non scaricato")));
  assert.equal(changed, 3, "anche quando fallisce");
  assert.ok(PUSH_OFF_TIMEOUT_MS <= 5000, "la rete lenta non blocca l'uscita");
});

test("spegnere qui: rete appesa → si va avanti dopo il tempo massimo", async (t) => {
  withWindow(t);
  const started = Date.now();
  await turnOffPushHere(30, async () => ({ disablePush: () => new Promise(() => undefined) }));
  assert.ok(Date.now() - started < 1000);
});

test("guardia della sessione: entra → riallinea; finisce o cambia account → si segue l'account", async (t) => {
  withPermission(t, "granted");
  const calls = [];
  let emit = () => undefined;
  let stopped = false;
  const load = async () => ({
    syncPushSubscription: async () => void calls.push("sync"),
    dropPushOfEndedSession: async () => (calls.push("drop"), true),
    disablePush: async () => void calls.push("disable")
  });
  const stop = startPushSessionGuard((listener) => {
    emit = listener;
    return () => {
      stopped = true;
    };
  }, load);
  const session = (id) => ({ session: id ? { user: { id } } : null });

  emit(session(null));
  await flush();
  assert.deepEqual(calls, ["drop"], "all'avvio senza sessione: la sessione può essere finita ad app chiusa");
  emit(session("u1"));
  await flush();
  emit(session("u1"));
  await flush();
  assert.deepEqual(calls, ["drop", "sync"], "stesso account: niente di nuovo");
  emit(session(null));
  await flush();
  emit(session("u2"));
  await flush();
  assert.deepEqual(calls, ["drop", "sync", "drop", "sync"]);
  assert.equal(calls.includes("disable"), false, "la guardia non toglie mai righe con la sessione di un altro");
  stop();
  assert.equal(stopped, true);
});

test("guardia della sessione: parte sempre; push.ts solo con il permesso (anche dato dopo) o lo stato", async (t) => {
  withPermission(t, "default");
  const calls = [];
  const accounts = [];
  let emit = () => undefined;
  let loads = 0;
  const load = async () => {
    loads += 1;
    return {
      syncPushSubscription: async (options) => void calls.push(["sync", options]),
      dropPushOfEndedSession: async () => (calls.push(["drop"]), true)
    };
  };
  let hasState = false;
  startPushSessionGuard((listener) => {
    emit = listener;
    return () => undefined;
  }, load, { isPrivate: () => true, hasState: () => hasState, writeAccount: async (id) => void accounts.push(id) });
  emit({ session: { user: { id: "u1" } } });
  await flush();
  assert.equal(loads, 0, "permesso non dato e nessuno stato: push.ts non si carica");
  assert.deepEqual(accounts, ["u1"], "l'account entrato va comunque al service worker");
  // Le notifiche si accendono più tardi nella stessa pagina, poi la sessione finisce da sola.
  withPermission(t, "granted");
  emit({ session: null });
  await flush();
  assert.equal(loads, 1);
  assert.deepEqual(calls, [["drop"]], "la sessione finita è seguita anche con il permesso dato dopo l'avvio");
  emit({ session: { user: { id: "u2" } } });
  await flush();
  assert.deepEqual(calls[1], ["sync", { private: true }], "titolo nascosto con la password dell'app");
  assert.deepEqual(accounts, ["u1", "u2"], "uscito: lo scrive dropPushOfEndedSession, non la guardia");
  // Permesso tolto ma stato rimasto: si segue lo stesso (l'iscrizione va comunque annullata).
  withPermission(t, "denied");
  hasState = true;
  emit({ session: null });
  await flush();
  assert.equal(loads, 3);
  // Un modulo che non arriva non lancia.
  withPermission(t, "granted");
  let emitOffline = () => undefined;
  startPushSessionGuard((listener) => {
    emitOffline = listener;
    return () => undefined;
  }, () => Promise.reject(new Error("offline")), { writeAccount: () => Promise.reject(new Error("quota")) });
  emitOffline({ session: { user: { id: "u1" } } });
  await flush();
});

test("titolo nascosto cambiato: riscrive la riga solo se le notifiche sono accese qui", async () => {
  const calls = [];
  const load = async () => ({ updatePushPrivacy: async (value) => void calls.push(value) });
  syncPushPrivacy(true, load, () => false);
  await flush();
  assert.deepEqual(calls, [], "notifiche spente qui: niente rete");
  syncPushPrivacy(true, load, () => true);
  syncPushPrivacy(false, load, () => true);
  await flush();
  assert.deepEqual(calls, [true, false]);
  syncPushPrivacy(true, () => Promise.reject(new Error("offline")), () => true);
  await flush();
});

// ─── Ogni uscita e cancellazione passa da turnOffPushHere (sorgente) ───────

const SRC = fileURLToPath(new URL("../src", import.meta.url));
const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
const sources = new Map(walk(SRC).map((file) => [relative(SRC, file), readFileSync(file, "utf8")]));

// Dove queste chiamate non sono un'uscita o una cancellazione della persona:
// supabase.ts definisce signOut; cloudSync.ts svuota il dispositivo al cambio di account (la guardia
// della sessione, in App, riallinea le notifiche al nuovo account).
const NOT_UI_EXITS = new Set(["lib/supabase.ts", "lib/cloudSync.ts"]);
const EXIT_CALL = /\b(signOut|signOutThisDevice|resetAllData)\(/g;

test("ogni uscita e cancellazione spegne prima le notifiche di questo dispositivo", () => {
  const callers = new Set();
  for (const [file, text] of sources) {
    if (NOT_UI_EXITS.has(file)) continue;
    for (const match of text.matchAll(EXIT_CALL)) {
      callers.add(file);
      const before = text.slice(0, match.index);
      const off = before.lastIndexOf("await turnOffPushHere();");
      const line = before.split("\n").length;
      assert.notEqual(off, -1, `${file}:${line} ${match[1]}( senza turnOffPushHere prima`);
      const between = before.slice(off);
      assert.doesNotMatch(between, /=\s*async\s*\(|async function/, `${file}:${line} turnOffPushHere è in un'altra funzione`);
    }
  }
  assert.deepEqual([...callers].sort(), ["components/CloudPanel.tsx", "components/LockScreen.tsx", "views/SettingsView.tsx"]);
  const cloudPanel = sources.get("components/CloudPanel.tsx");
  assert.equal(cloudPanel.match(/await turnOffPushHere\(\);/g).length, 2, "«Esci» ed «Esci e togli i dati»");
  const settings = sources.get("views/SettingsView.tsx");
  const erase = settings.slice(settings.indexOf("await turnOffPushHere();"));
  assert.ok(erase.indexOf('if (mode !== "local")') > 0, "anche «solo questo dispositivo» e «riscarica dall'account»");
});

test("un solo aiuto: disablePush e la guardia passano solo da lib/pushDevice", () => {
  const users = (name) => [...sources].filter(([, text]) => new RegExp(`\\b${name}\\b`).test(text)).map(([file]) => file).sort();
  assert.deepEqual(users("disablePush"), ["components/PushToggle.tsx", "lib/push.ts", "lib/pushDevice.ts"], "l'interruttore spegne e basta");
  assert.deepEqual(users("syncPushSubscription"), ["lib/push.ts", "lib/pushDevice.ts"]);
  assert.deepEqual(users("dropPushOfEndedSession"), ["lib/push.ts", "lib/pushDevice.ts"]);
  assert.deepEqual(users("turnOffPushHere"), ["components/CloudPanel.tsx", "components/LockScreen.tsx", "lib/pushDevice.ts", "views/SettingsView.tsx"]);
  assert.deepEqual(users("startPushSessionGuard"), ["App.tsx", "lib/pushDevice.ts"]);
  const app = sources.get("App.tsx");
  assert.match(app, /return startPushSessionGuard\(subscribeCloudSync, undefined, \{ isPrivate: \(\) => pushPrivateOf\(useStudyStore\.getState\(\)\.settings\) \}\);/);
  assert.match(app, /syncPushPrivacy\(pushPrivate\);/);
  const device = sources.get("lib/pushDevice.ts");
  assert.doesNotMatch(device, /^import (?!type|\{ hasPushState, writePushAccount \} from "\.\/pushLocal";)/m, "nel bundle iniziale: push.ts e supabase-js solo con import()");
  assert.doesNotMatch(sources.get("lib/pushLocal.ts"), /^import (?!type)/m, "pushLocal senza dipendenze");
  assert.match(device, /import\("\.\/push"\)/);
});
