import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
const SCOPE = "https://massimilianociconte.github.io/StudyOS/";

const makeClient = (url, { focused = false, navigateFails = false } = {}) => {
  const calls = { focus: 0, navigated: [] };
  return {
    url,
    focused,
    calls,
    focus: async () => {
      calls.focus += 1;
    },
    navigate: async (target) => {
      if (navigateFails) throw new Error("scheda non controllata");
      calls.navigated.push(target);
    }
  };
};

/** Cache Storage finto, con le stesse regole usate da sw.js e pushLocal (ignoreSearch). */
const fakeCaches = () => {
  const stores = new Map();
  const strip = (url) => url.split("?")[0];
  const open = async (name) => {
    if (!stores.has(name)) {
      const entries = new Map();
      const matches = (url, request, options) => (options?.ignoreSearch ? strip(url) === strip(request) : url === request);
      stores.set(name, {
        entries,
        keys: async (request, options) =>
          [...entries.keys()].filter((url) => request === undefined || matches(url, request, options)).map((url) => ({ url })),
        put: async (request, response) => void entries.set(request, response),
        delete: async (request, options) => {
          let removed = false;
          for (const url of [...entries.keys()]) if (matches(url, request, options)) removed = entries.delete(url) || removed;
          return removed;
        }
      });
    }
    return stores.get(name);
  };
  return { open, stores };
};

const loadWorker = (windows = [], extra = {}) => {
  const handlers = new Map();
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: "https://massimilianociconte.github.io" },
    registration: {
      scope: SCOPE,
      showNotification: (title, options) => {
        shown.push({ title, options });
        return Promise.resolve();
      }
    },
    clients: {
      matchAll: () => Promise.resolve(windows),
      openWindow: (url) => {
        opened.push(url);
        return Promise.resolve(null);
      },
      claim: () => Promise.resolve()
    },
    addEventListener: (type, handler) => handlers.set(type, handler),
    skipWaiting: () => undefined
  };
  vm.runInNewContext(source, { self, URL, Promise, Date, console, ...extra });
  return { handlers, shown, opened };
};

const fire = async (worker, type, event) => {
  const waits = [];
  worker.handlers.get(type)({ ...event, waitUntil: (promise) => waits.push(promise) });
  await Promise.all(waits);
};

const pushWith = (payload) => ({ data: { json: () => payload } });
const clickOn = (url) => {
  const state = { closed: 0 };
  return { state, event: { notification: { close: () => (state.closed += 1), data: url === undefined ? undefined : { url } } } };
};

test("gli handler esistenti restano registrati", () => {
  const worker = loadWorker();
  for (const type of ["install", "activate", "fetch", "message", "push", "notificationclick"]) {
    assert.equal(typeof worker.handlers.get(type), "function", type);
  }
});

test("push: mostra titolo, testo, tag, icona e url dal messaggio", async () => {
  const worker = loadWorker();
  await fire(worker, "push", pushWith({ kind: "invite", title: "Invito al gruppo", body: "Giulia ti ha invitato.", url: "?apri=notifiche", tag: "group-invite:42" }));
  assert.equal(worker.shown.length, 1);
  const { title, options } = worker.shown[0];
  assert.equal(title, "Invito al gruppo");
  assert.equal(options.body, "Giulia ti ha invitato.");
  assert.equal(options.tag, "group-invite:42");
  assert.equal(options.icon, `${SCOPE}icons/studyos-192.png`);
  assert.equal(options.badge, `${SCOPE}icons/favicon-64.png`);
  assert.deepEqual({ ...options.data }, { url: "?apri=notifiche" });
});

test("push: contenuto illeggibile o assente mostra comunque una notifica", async () => {
  const unreadable = loadWorker();
  await fire(unreadable, "push", { data: { json: () => { throw new SyntaxError("json non valido"); } } });
  assert.equal(unreadable.shown[0].title, "StudyOS");
  assert.equal(unreadable.shown[0].options.body, "Hai una nuova notifica.");

  const empty = loadWorker();
  await fire(empty, "push", { data: null });
  assert.equal(empty.shown.length, 1);
  assert.equal(empty.shown[0].title, "StudyOS");

  const notAnObject = loadWorker();
  await fire(notAnObject, "push", pushWith("testo"));
  assert.equal(notAnObject.shown[0].title, "StudyOS");
});

test("push: campi mancanti o troppo lunghi", async () => {
  const worker = loadWorker();
  await fire(worker, "push", pushWith({ title: "T".repeat(500), body: 7, url: "", tag: null }));
  const { title, options } = worker.shown[0];
  assert.equal(title.length, 120);
  assert.equal(options.body, "");
  assert.equal(options.tag, "studyos");
  assert.deepEqual({ ...options.data }, { url: "./" });
});

test("click: porta in primo piano la scheda aperta e la fa navigare", async () => {
  const client = makeClient(`${SCOPE}?x=1`);
  const worker = loadWorker([makeClient("https://altro.example/"), client]);
  const { state, event } = clickOn("?apri=notifiche");
  await fire(worker, "notificationclick", event);
  assert.equal(state.closed, 1);
  assert.equal(client.calls.focus, 1);
  assert.deepEqual(client.calls.navigated, [`${SCOPE}?apri=notifiche`]);
  assert.deepEqual(worker.opened, []);
});

test("click: senza scheda aperta ne apre una nell'ambito dell'app", async () => {
  const worker = loadWorker([makeClient("https://altro.example/")]);
  const { state, event } = clickOn("?apri=condivisione");
  await fire(worker, "notificationclick", event);
  assert.equal(state.closed, 1);
  assert.deepEqual(worker.opened, [`${SCOPE}?apri=condivisione`]);
});

test("click: preferisce la scheda già in primo piano", async () => {
  const back = makeClient(SCOPE);
  const front = makeClient(`${SCOPE}?v=2`, { focused: true });
  const worker = loadWorker([back, front]);
  await fire(worker, "notificationclick", clickOn("?apri=gruppi").event);
  assert.equal(front.calls.navigated.length, 1);
  assert.equal(back.calls.navigated.length, 0);
});

test("click: un indirizzo fuori dall'app ripiega sulla pagina iniziale", async () => {
  for (const hostile of ["https://evil.example/x", "//evil.example/x", "javascript:alert(1)", "/altrove/"]) {
    const worker = loadWorker();
    await fire(worker, "notificationclick", clickOn(hostile).event);
    assert.deepEqual(worker.opened, [SCOPE], hostile);
  }
  const noData = loadWorker();
  await fire(noData, "notificationclick", clickOn(undefined).event);
  assert.deepEqual(noData.opened, [SCOPE]);
});

test("click: se la scheda non si lascia navigare si apre una nuova finestra", async () => {
  const client = makeClient(SCOPE, { navigateFails: true });
  const worker = loadWorker([client]);
  await fire(worker, "notificationclick", clickOn("?apri=gruppi").event);
  assert.equal(client.calls.focus, 1);
  assert.deepEqual(worker.opened, [`${SCOPE}?apri=gruppi`]);
});

// ─── Promemoria e account (Cache Storage condiviso con la pagina, src/lib/pushLocal.ts) ─────

const local = await import("../src/lib/pushLocal.ts");
const ORIGIN = "https://massimilianociconte.github.io";
const ACCOUNT_A = "504b3482-7f1b-4add-bfbc-7b3effbf21d7";
const ACCOUNT_B = "fc0191e0-6663-4a43-b060-131e397f02cc";
const reminder = (tag, account = ACCOUNT_A) => pushWith({ kind: "reminder", title: "Lezione", body: "Tra 15 minuti · 10:00", url: "?apri=calendario", tag, account });

test("promemoria dalla push: si ricorda, la pagina lo ritrova e non lo ripete", async () => {
  const caches = fakeCaches();
  const worker = loadWorker([], { caches, Response });
  const before = Date.now();
  await fire(worker, "push", reminder("studyos-reminder-e1@2026-11-12#0d15m@1"));
  assert.equal(worker.shown.length, 1);
  assert.equal(worker.shown[0].options.silent, undefined, "la prima notifica suona");
  const record = await local.readReminderShown("studyos-reminder-e1@2026-11-12#0d15m@1", caches, ORIGIN);
  assert.equal(record.by, "push");
  assert.ok(record.at >= before);
  assert.equal(local.alreadyShown(record, before), true, "la pagina (EventReminderWatcher) mostra solo la campanella");
  assert.equal(await local.readReminderShown("studyos-reminder-altro", caches, ORIGIN), null);
});

test("promemoria già mostrato dalla scheda aperta: la push lo sostituisce in silenzio (una notifica)", async () => {
  const caches = fakeCaches();
  await local.recordReminderShown("studyos-reminder-e2", "page", Date.now(), caches, ORIGIN);
  const worker = loadWorker([], { caches, Response });
  await fire(worker, "push", reminder("studyos-reminder-e2"));
  assert.equal(worker.shown.length, 1, "deve comparire qualcosa (userVisibleOnly), con lo stesso tag");
  assert.equal(worker.shown[0].options.tag, "studyos-reminder-e2");
  assert.equal(worker.shown[0].options.silent, true);
  assert.equal((await local.readReminderShown("studyos-reminder-e2", caches, ORIGIN)).by, "page", "resta il ricordo della pagina");
  // Mostrato dalla pagina molto prima (oltre 2 ore): non conta più.
  await local.recordReminderShown("studyos-reminder-e3", "page", Date.now() - 3 * 60 * 60_000, caches, ORIGIN);
  await fire(worker, "push", reminder("studyos-reminder-e3"));
  assert.equal(worker.shown[1].options.silent, undefined);
});

// Revisione finale (L-2): una push di un altro account non si scarta più in silenzio (con userVisibleOnly
// il browser mostrerebbe il suo avviso o toglierebbe l'iscrizione): compare il testo generico, stesso tag.
const isGeneric = (item, tag) =>
  item.title === local.GENERIC_PUSH_TITLE && item.options.body === local.GENERIC_PUSH_BODY && item.options.tag === tag
    && item.options.data.url === "./" && item.options.silent === undefined;

test("account: la push di un altro account mostra solo il testo generico; uscito → generico; mai scritto → come prima", async () => {
  const caches = fakeCaches();
  const worker = loadWorker([], { caches, Response });
  await fire(worker, "push", reminder("studyos-reminder-a", ACCOUNT_B));
  assert.equal(worker.shown.length, 1, "nessun account scritto dalla pagina: si mostra");
  assert.equal(worker.shown[0].title, "Lezione");
  await local.writePushAccount(ACCOUNT_A, caches, ORIGIN);
  assert.equal(await local.readPushAccount(caches, ORIGIN), ACCOUNT_A);
  await fire(worker, "push", reminder("studyos-reminder-b", ACCOUNT_B));
  assert.equal(worker.shown.length, 2, "account diverso: compare comunque una notifica");
  assert.ok(isGeneric(worker.shown[1], "studyos-reminder-b"), JSON.stringify(worker.shown[1]));
  assert.equal(await local.readReminderShown("studyos-reminder-b", caches, ORIGIN), null, "il promemoria dell'altro account non conta come mostrato");
  await fire(worker, "push", pushWith({ kind: "invite", title: "Invito a un gruppo", body: "Ada ti invita nel gruppo Visite", url: "?apri=notifiche", tag: "group-invite:9", account: ACCOUNT_B }));
  assert.ok(isGeneric(worker.shown[2], "group-invite:9"), "né il nome né il gruppo dell'altro account");
  await fire(worker, "push", reminder("studyos-reminder-c", ACCOUNT_A));
  assert.equal(worker.shown.length, 4);
  assert.equal(worker.shown[3].title, "Lezione");
  await fire(worker, "push", pushWith({ kind: "invite", title: "Invito", body: "", url: "?apri=notifiche", tag: "group-invite:1" }));
  assert.equal(worker.shown.length, 5, "senza account nel messaggio (Worker vecchio): si mostra");
  assert.equal(worker.shown[4].title, "Invito");
  await local.writePushAccount(null, caches, ORIGIN);
  assert.equal(await local.readPushAccount(caches, ORIGIN), null);
  await fire(worker, "push", reminder("studyos-reminder-d", ACCOUNT_A));
  assert.equal(worker.shown.length, 6, "uscito da questo dispositivo: solo il testo generico");
  assert.ok(isGeneric(worker.shown[5], "studyos-reminder-d"));
  assert.equal([...caches.stores.get(local.PUSH_LOCAL_CACHE).entries.keys()].filter((url) => url.includes("push-account")).length, 1, "una sola chiave dell'account");
});

test("testo generico: stesso testo nel service worker, in pushLocal e in studyos_push_notify", () => {
  assert.equal(local.GENERIC_PUSH_TITLE, "StudyOS");
  assert.equal(local.GENERIC_PUSH_BODY, "Hai una nuova notifica.");
  assert.ok(source.includes(`const PUSH_FALLBACK = { title: "${local.GENERIC_PUSH_TITLE}", body: "${local.GENERIC_PUSH_BODY}", url: "./", tag: "studyos" };`));
  const people = readFileSync(new URL("../supabase/people.sql", import.meta.url), "utf8");
  assert.ok(people.includes(`jsonb_build_object('title', '${local.GENERIC_PUSH_TITLE}', 'body', '${local.GENERIC_PUSH_BODY}')`));
});

test("senza Cache Storage o con lo storage che fallisce: la notifica compare lo stesso", async () => {
  const plain = loadWorker();
  await fire(plain, "push", reminder("studyos-reminder-x"));
  assert.equal(plain.shown.length, 1);
  const broken = loadWorker([], { caches: { open: () => Promise.reject(new Error("quota")) }, Response });
  await fire(broken, "push", reminder("studyos-reminder-y"));
  assert.equal(broken.shown.length, 1);
});

test("activate tiene la cache condivisa con la pagina", () => {
  assert.match(source, /key !== CACHE_NAME && key !== PUSH_LOCAL_CACHE/);
  assert.match(source, /const PUSH_LOCAL_CACHE = "studyos-push-local-v1";/);
  assert.equal(local.PUSH_LOCAL_CACHE, "studyos-push-local-v1");
});
