import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// Notifiche di questo dispositivo quando una sessione finisce: un solo aiuto (lib/pushDevice) per
// ogni uscita e cancellazione, e la guardia per la sessione che finisce da sola.
const { turnOffPushHere, startPushSessionGuard, PUSH_CHANGED_EVENT, PUSH_OFF_TIMEOUT_MS } = await import("../src/lib/pushDevice.ts");

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

test("guardia della sessione: senza permesso non segue niente; un modulo che non arriva non lancia", async (t) => {
  withPermission(t, "default");
  let subscribed = false;
  startPushSessionGuard(() => {
    subscribed = true;
    return () => undefined;
  });
  assert.equal(subscribed, false);
  withPermission(t, "granted");
  let emit = () => undefined;
  startPushSessionGuard((listener) => {
    emit = listener;
    return () => undefined;
  }, () => Promise.reject(new Error("offline")));
  emit({ session: null });
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
  assert.match(app, /return startPushSessionGuard\(subscribeCloudSync\);/);
  const device = sources.get("lib/pushDevice.ts");
  assert.doesNotMatch(device, /^import (?!type)/m, "nel bundle iniziale: push.ts e supabase-js solo con import()");
  assert.match(device, /import\("\.\/push"\)/);
});
