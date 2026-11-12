import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_TAB_LOCK, TAKEOVER_TIMEOUT_MS, startActiveTab } from "../src/lib/activeTab.ts";

// ---------- finti navigator.locks e BroadcastChannel (stesso profilo, più schede) ----------

const abortError = () => Object.assign(new Error("aborted"), { name: "AbortError" });
// Come il gestore dei blocchi del browser: callback e rifiuti arrivano come task, in ordine.
const task = (fn) => setImmediate(fn);
const settle = async (rounds = 12) => {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

const createLockHub = () => {
  let holder = null;
  const queue = [];
  const names = [];

  const run = (entry, lock) => {
    Promise.resolve()
      .then(() => entry.callback(lock))
      .then(entry.resolve, entry.reject);
  };
  const grant = (entry) => {
    holder = entry;
    task(() => run(entry, { name: ACTIVE_TAB_LOCK }));
  };
  const processQueue = () => {
    if (!holder && queue.length) grant(queue.shift());
  };

  return {
    holderTab: () => holder?.tab ?? null,
    names,
    forTab: (tab) => ({
      request: (name, options, callback) =>
        new Promise((resolve, reject) => {
          names.push(name);
          const entry = { tab, callback, resolve, reject };
          if (options.steal) {
            if (holder) {
              const old = holder;
              holder = null;
              task(() => old.reject(abortError()));
            }
            grant(entry);
            return;
          }
          if (options.ifAvailable && (holder || queue.length)) {
            task(() => run(entry, null));
            return;
          }
          options.signal?.addEventListener("abort", () => {
            const index = queue.indexOf(entry);
            if (index < 0) return; // già concesso: abort non fa nulla
            queue.splice(index, 1);
            task(() => reject(abortError()));
          });
          queue.push(entry);
          processQueue();
        }),
      // Come navigator.locks.query(): richieste in attesa di tutte le schede dell'origine.
      query: async () => ({
        held: holder ? [{ name: ACTIVE_TAB_LOCK }] : [],
        pending: queue.map(() => ({ name: ACTIVE_TAB_LOCK }))
      })
    }),
    /** Una richiesta in coda creata da fuori (per il test del controllo ripetuto). */
    enqueueFrom: (tab) => {
      const entry = { tab, callback: () => new Promise(() => undefined), resolve: () => undefined, reject: () => undefined };
      queue.push(entry);
      processQueue();
    },
    // La pagina si ricarica o si chiude: i suoi blocchi spariscono senza rifiuti.
    dropTab: (tab) => {
      if (holder?.tab === tab) holder = null;
      for (let index = queue.length - 1; index >= 0; index -= 1) if (queue[index].tab === tab) queue.splice(index, 1);
      processQueue();
    }
  };
};

const createChannelHub = () => {
  const members = new Set();
  return {
    open: () => {
      const listeners = [];
      const channel = {
        postMessage: (data) => {
          for (const other of members) if (other !== channel) task(() => other.listeners.forEach((listener) => listener({ data })));
        },
        addEventListener: (_type, listener) => listeners.push(listener),
        listeners
      };
      members.add(channel);
      return channel;
    }
  };
};

const createTimers = () => {
  let now = 0;
  const pending = new Set();
  return {
    setTimeout: (fn, ms) => {
      const timer = { fn, at: now + ms };
      pending.add(timer);
      return timer;
    },
    clearTimeout: (timer) => pending.delete(timer),
    advance: (ms) => {
      now += ms;
      for (const timer of [...pending].sort((a, b) => a.at - b.at)) {
        if (timer.at > now) continue;
        pending.delete(timer);
        timer.fn();
      }
    }
  };
};

const createWorld = () => ({ locks: createLockHub(), channels: createChannelHub(), timers: createTimers() });

/** Una scheda: `log` registra cosa chiede il controllore (montare l'app, guardia, salvare, fermarsi, ricaricare). */
const openTab = (world, name, { reason, handOff, frozen = false, noLocks = false } = {}) => {
  const log = [];
  const hooks = {
    activate: () => log.push("activate"),
    showGuard: (view) => log.push(`guard:${view.reason}:${view.phase}`),
    handOff: async () => {
      log.push("handOff");
      await handOff?.();
      log.push("saved");
    },
    halt: () => log.push("halt"),
    leave: () => {
      log.push("leave");
      world.locks.dropTab(name);
    }
  };
  const env = {
    locks: noLocks ? undefined : world.locks.forTab(name),
    // Scheda congelata sullo sfondo: non riceve messaggi.
    channel: frozen ? null : world.channels.open(),
    setTimeout: world.timers.setTimeout,
    clearTimeout: world.timers.clearTimeout
  };
  const controller = startActiveTab(env, hooks, reason);
  return { name, log, controller };
};

// ---------- decisione all'avvio ----------

test("una sola scheda: prende il blocco e apre l'app, nessuna guardia", async () => {
  const world = createWorld();
  const a = openTab(world, "A");
  await settle();
  assert.deepEqual(a.log, ["activate"]);
  assert.equal(world.locks.holderTab(), "A");
  assert.deepEqual([...new Set(world.locks.names)], [ACTIVE_TAB_LOCK]);
});

test("seconda scheda: blocco occupato → solo la guardia (niente app, niente salvataggi)", async () => {
  const world = createWorld();
  const a = openTab(world, "A");
  await settle();
  const b = openTab(world, "B");
  await settle();
  assert.deepEqual(b.log, ["guard:elsewhere:idle"]);
  assert.deepEqual(a.log, ["activate"]);
  assert.equal(world.locks.holderTab(), "A");
});

test("dopo un passaggio la guardia dice che StudyOS è passato a un'altra scheda", async () => {
  const world = createWorld();
  openTab(world, "A");
  await settle();
  const b = openTab(world, "B", { reason: "moved" });
  await settle();
  assert.deepEqual(b.log, ["guard:moved:idle"]);
});

test("browser senza navigator.locks: si apre come oggi, senza guardia", async () => {
  const world = createWorld();
  const a = openTab(world, "A", { noLocks: true });
  const b = openTab(world, "B", { noLocks: true });
  await settle();
  assert.deepEqual(a.log, ["activate"]);
  assert.deepEqual(b.log, ["activate"]);
});

test("se la richiesta del blocco fallisce subito (es. contesto non sicuro) l'app si apre come oggi", async () => {
  const log = [];
  startActiveTab(
    { locks: { request: () => Promise.reject(new Error("SecurityError")) }, channel: null, setTimeout, clearTimeout },
    { activate: () => log.push("activate"), showGuard: () => log.push("guard"), handOff: async () => undefined, halt: () => undefined, leave: () => undefined }
  );
  await settle();
  assert.deepEqual(log, ["activate"]);
});

// ---------- «Usa questa scheda» ----------

test("Usa questa scheda: l'attiva salva tutto, poi lascia; la nuova apre l'app dopo il salvataggio", async () => {
  const world = createWorld();
  let finishSave;
  const a = openTab(world, "A", { handOff: () => new Promise((resolve) => (finishSave = resolve)) });
  await settle();
  const b = openTab(world, "B");
  await settle();

  b.controller.takeOver();
  await settle();
  assert.deepEqual(b.log, ["guard:elsewhere:idle", "guard:elsewhere:waiting"]);
  assert.deepEqual(a.log, ["activate", "handOff"]);
  // Finché l'altra scheda non ha finito di salvare, questa non apre l'app.
  assert.equal(world.locks.holderTab(), "A");

  finishSave();
  await settle();
  assert.deepEqual(a.log, ["activate", "handOff", "saved", "leave"]);
  assert.ok(!a.log.includes("halt"), "un passaggio normale salva: non si ferma senza salvare");
  assert.deepEqual(b.log, ["guard:elsewhere:idle", "guard:elsewhere:waiting", "activate"]);
  assert.equal(world.locks.holderTab(), "B");

  // Il conto alla rovescia dei 3 s non riporta la guardia dopo che l'app è aperta.
  world.timers.advance(TAKEOVER_TIMEOUT_MS);
  assert.equal(b.log.at(-1), "activate");
});

test("un messaggio di passaggio senza nessuna richiesta in coda non fa nulla (è solo un indizio)", async () => {
  const world = createWorld();
  const a = openTab(world, "A");
  await settle();
  // Qualsiasi pagina della stessa origine (es. un altro repo su *.github.io) può mandarlo.
  world.channels.open().postMessage({ type: "studyos:takeover" });
  await settle();
  world.timers.advance(TAKEOVER_TIMEOUT_MS);
  await settle();
  assert.deepEqual(a.log, ["activate"], "niente salvataggio forzato, niente ricaricamento");
  assert.equal(world.locks.holderTab(), "A");
});

test("la richiesta in coda arrivata un attimo dopo il messaggio vale comunque", async () => {
  const world = createWorld();
  const a = openTab(world, "A");
  await settle();
  world.channels.open().postMessage({ type: "studyos:takeover" });
  await settle();
  assert.deepEqual(a.log, ["activate"]);
  world.locks.enqueueFrom("B");
  world.timers.advance(TAKEOVER_TIMEOUT_MS);
  await settle();
  assert.deepEqual(a.log, ["activate", "handOff", "saved", "leave"]);
  assert.equal(world.locks.holderTab(), "B");
});

test("la scheda appena attivata a sua volta cede il posto alla successiva", async () => {
  const world = createWorld();
  const a = openTab(world, "A");
  await settle();
  const b = openTab(world, "B");
  await settle();
  b.controller.takeOver();
  await settle();
  // A si è ricaricata: ora mostra la guardia «passato a un'altra scheda».
  const a2 = openTab(world, "A", { reason: "moved" });
  await settle();
  assert.deepEqual(a2.log, ["guard:moved:idle"]);
  a2.controller.takeOver();
  await settle();
  assert.deepEqual(b.log.slice(-4), ["activate", "handOff", "saved", "leave"]);
  assert.equal(a2.log.at(-1), "activate");
  assert.equal(world.locks.holderTab(), "A");
  assert.equal(a.log.at(-1), "leave");
});

test("salvataggio non riuscito: l'attiva resta com'è; dopo ~3 s l'altra offre «Usa comunque qui»", async () => {
  const world = createWorld();
  const a = openTab(world, "A", { handOff: () => Promise.reject(new Error("quota")) });
  await settle();
  const b = openTab(world, "B");
  await settle();
  b.controller.takeOver();
  await settle();
  assert.deepEqual(a.log, ["activate", "handOff"]);
  assert.equal(world.locks.holderTab(), "A");
  world.timers.advance(TAKEOVER_TIMEOUT_MS - 1);
  assert.equal(b.log.at(-1), "guard:elsewhere:waiting");
  world.timers.advance(1);
  assert.equal(b.log.at(-1), "guard:elsewhere:slow");
});

test("una scheda in guardia non risponde alle richieste di passaggio", async () => {
  const world = createWorld();
  const a = openTab(world, "A");
  await settle();
  const b = openTab(world, "B");
  const c = openTab(world, "C");
  await settle();
  c.controller.takeOver();
  await settle();
  assert.deepEqual(b.log, ["guard:elsewhere:idle"]);
  assert.equal(c.log.at(-1), "activate");
  assert.equal(a.log.at(-1), "leave");
});

test("premere due volte «Usa questa scheda» chiede il passaggio una volta sola", async () => {
  const world = createWorld();
  const a = openTab(world, "A");
  await settle();
  const b = openTab(world, "B");
  await settle();
  b.controller.takeOver();
  b.controller.takeOver();
  await settle();
  assert.equal(a.log.filter((entry) => entry === "handOff").length, 1);
  assert.equal(b.log.filter((entry) => entry === "activate").length, 1);
});

// ---------- scheda che non risponde: «Usa comunque qui» ----------

test("scheda congelata: dopo 3 s «Usa comunque qui» prende il blocco; la vecchia si ferma senza salvare", async () => {
  const world = createWorld();
  const a = openTab(world, "A", { frozen: true });
  await settle();
  const b = openTab(world, "B");
  await settle();
  b.controller.takeOver();
  await settle();
  assert.deepEqual(a.log, ["activate"], "congelata: non ha ricevuto nulla");
  world.timers.advance(TAKEOVER_TIMEOUT_MS);
  assert.equal(b.log.at(-1), "guard:elsewhere:slow");

  b.controller.force();
  await settle();
  assert.equal(world.locks.holderTab(), "B");
  assert.deepEqual(b.log.filter((entry) => entry === "activate"), ["activate"]);
  // La vecchia scheda smette subito di scrivere (prima di tutto) e passa alla guardia senza salvare.
  assert.deepEqual(a.log, ["activate", "halt", "leave"]);
});

test("Usa comunque qui proprio mentre arriva il blocco: questa scheda non si ferma da sola", async () => {
  const world = createWorld();
  const a = openTab(world, "A", { frozen: true });
  await settle();
  const b = openTab(world, "B");
  await settle();
  b.controller.takeOver();
  await settle();
  world.timers.advance(TAKEOVER_TIMEOUT_MS);
  // A si chiude: il blocco va alla richiesta in coda di B, ma la callback non è ancora partita.
  world.locks.dropTab("A");
  b.controller.force();
  await settle();
  assert.equal(world.locks.holderTab(), "B");
  assert.ok(!b.log.includes("halt"), b.log.join(","));
  assert.ok(!b.log.includes("leave"), b.log.join(","));
  assert.equal(b.log.filter((entry) => entry === "activate").length, 1);
});

test("una scheda a cui hanno preso il blocco più tardi si ferma anche lei", async () => {
  const world = createWorld();
  openTab(world, "A", { frozen: true });
  await settle();
  const b = openTab(world, "B", { frozen: true });
  await settle();
  b.controller.force();
  await settle();
  const c = openTab(world, "C");
  await settle();
  c.controller.force();
  await settle();
  assert.deepEqual(b.log, ["guard:elsewhere:idle", "activate", "halt", "leave"]);
  assert.equal(world.locks.holderTab(), "C");
});
