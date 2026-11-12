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

const loadWorker = (windows = []) => {
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
  vm.runInNewContext(source, { self, URL, Promise, Date, console });
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
