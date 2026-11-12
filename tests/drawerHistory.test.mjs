import test from "node:test";
import assert from "node:assert/strict";

const { createDrawerHistory, DRAWER_STATE_KEY } = await import("../src/lib/drawerHistory.ts");

/**
 * Cronologia del browser finta: `push` taglia l'avanti come pushState, `go` è asincrono come
 * history.go (arriva con `traversals()`), Indietro/Avanti dell'utente arrivano subito con popstate.
 * Indice 0 = la pagina prima dell'app, indice 1 = l'app senza finestre aperte.
 */
const fakeBrowser = () => {
  const states = [{ page: "prima" }, null];
  let index = 1;
  const queued = [];
  const timers = [];
  const goes = [];
  let history = null;
  const traverse = (delta) => {
    const next = Math.max(0, Math.min(states.length - 1, index + delta));
    if (next === index) return;
    index = next;
    history.popstate(states[index]);
  };
  const env = {
    push: (id) => {
      states.splice(index + 1);
      states.push({ [DRAWER_STATE_KEY]: id });
      index += 1;
    },
    go: (delta) => {
      goes.push(delta);
      queued.push(delta);
    },
    current: () => states[index]?.[DRAWER_STATE_KEY] ?? null,
    schedule: (fn) => timers.push(fn)
  };
  return {
    env,
    attach(value) {
      history = value;
      return value;
    },
    back: () => traverse(-1),
    forward: () => traverse(1),
    traversals: () => {
      while (queued.length) traverse(queued.shift());
    },
    timers: () => timers.splice(0).forEach((fn) => fn()),
    replaceState: (state) => {
      states[index] = state;
    },
    get index() {
      return index;
    },
    get length() {
      return states.length;
    },
    goes
  };
};

const setup = () => {
  const browser = fakeBrowser();
  const history = browser.attach(createDrawerHistory(browser.env));
  return { browser, history };
};

/** Un drawer che si chiude davvero quando lo chiede Indietro (come fa React chiamando onClose). */
const closingDrawer = (history, log, name) => {
  const drawer = { token: null, calls: 0 };
  drawer.token = history.open(() => {
    drawer.calls += 1;
    log.push(name);
  });
  return drawer;
};

test("apertura: una voce nella cronologia, senza cambiare indirizzo; ✕ la toglie", () => {
  const { browser, history } = setup();
  const log = [];
  const drawer = closingDrawer(history, log, "A");
  assert.equal(browser.index, 2, "una voce in più");
  assert.match(browser.env.current(), /\S/);
  history.close(drawer.token);
  assert.deepEqual(browser.goes, [-1]);
  browser.traversals();
  assert.equal(browser.index, 1, "la voce del drawer è stata tolta");
  assert.deepEqual(log, [], "chiusura con ✕: onClose non richiamato da Indietro");
  assert.equal(history.size, 0);
});

test("Indietro chiude il drawer aperto e non esce dall'app", () => {
  const { browser, history } = setup();
  const log = [];
  const drawer = closingDrawer(history, log, "A");
  browser.back();
  assert.deepEqual(log, ["A"]);
  assert.equal(browser.index, 1, "si resta nell'app");
  history.close(drawer.token); // React chiude il drawer
  assert.deepEqual(browser.goes, [], "la voce era già andata: nessun altro Indietro");
  assert.equal(browser.index, 1);
});

test("chiusura rifiutata (conferma «Scartare le modifiche?»): la voce torna, il prossimo Indietro funziona", () => {
  const { browser, history } = setup();
  const log = [];
  const drawer = closingDrawer(history, log, "A");
  browser.back();
  assert.equal(browser.index, 1);
  history.settle(drawer.token); // il drawer è ancora aperto dopo il disegno successivo
  assert.equal(browser.index, 2, "voce rimessa");
  browser.back();
  assert.deepEqual(log, ["A", "A"]);
  history.close(drawer.token);
  assert.equal(browser.index, 1);
  assert.deepEqual(browser.goes, []);
});

test("chiusura rifiutata senza nuovo disegno: il controllo di riserva rimette la voce", () => {
  const { browser, history } = setup();
  const log = [];
  closingDrawer(history, log, "A");
  browser.back();
  browser.timers();
  assert.equal(browser.index, 2);
});

test("onBack che restituisce false (Esc disattivato): la voce torna subito", () => {
  const { browser, history } = setup();
  let calls = 0;
  history.open(() => {
    calls += 1;
    return false;
  });
  browser.back();
  assert.equal(calls, 1);
  assert.equal(browser.index, 2, "rimessa senza aspettare");
  browser.back();
  assert.equal(calls, 2);
});

test("settle non fa nulla se la voce c'è già o il drawer è chiuso", () => {
  const { browser, history } = setup();
  const log = [];
  const drawer = closingDrawer(history, log, "A");
  history.settle(drawer.token);
  assert.equal(browser.length, 3, "nessuna voce doppia");
  history.close(drawer.token);
  browser.traversals();
  history.settle(drawer.token);
  assert.equal(browser.index, 1);
});

test("drawer annidati: Indietro chiude solo quello in cima", () => {
  const { browser, history } = setup();
  const log = [];
  const a = closingDrawer(history, log, "A");
  const b = closingDrawer(history, log, "B");
  assert.equal(browser.index, 3);
  browser.back();
  assert.deepEqual(log, ["B"]);
  history.close(b.token);
  assert.deepEqual(browser.goes, []);
  browser.back();
  assert.deepEqual(log, ["B", "A"]);
  history.close(a.token);
  assert.equal(browser.index, 1);
  assert.deepEqual(browser.goes, []);
});

test("annidati: ✕ su quello in cima toglie solo la sua voce", () => {
  const { browser, history } = setup();
  const log = [];
  closingDrawer(history, log, "A");
  const b = closingDrawer(history, log, "B");
  history.close(b.token);
  browser.traversals();
  assert.equal(browser.index, 2);
  assert.deepEqual(log, []);
  browser.back();
  assert.deepEqual(log, ["A"]);
});

test("annidati: due Indietro veloci chiudono un drawer ciascuno", () => {
  const { browser, history } = setup();
  const log = [];
  const a = closingDrawer(history, log, "A");
  const b = closingDrawer(history, log, "B");
  browser.back();
  browser.back(); // prima che React abbia chiuso B
  assert.deepEqual(log, ["B", "A"]);
  history.close(b.token);
  history.close(a.token);
  assert.deepEqual(browser.goes, []);
  assert.equal(browser.index, 1);
});

test("un drawer, due Indietro veloci: il primo lo chiude, il secondo fa il normale Indietro", () => {
  const { browser, history } = setup();
  const log = [];
  const drawer = closingDrawer(history, log, "A");
  browser.back();
  browser.back();
  assert.deepEqual(log, ["A"], "onClose una volta sola");
  assert.equal(browser.index, 0, "la seconda pressione va alla pagina di prima");
  history.close(drawer.token);
  assert.deepEqual(browser.goes, []);
});

test("il padre si chiude prima del figlio: nessun Indietro a metà, poi le due voci insieme", () => {
  const { browser, history } = setup();
  const log = [];
  const a = closingDrawer(history, log, "A");
  const b = closingDrawer(history, log, "B");
  history.close(a.token);
  assert.deepEqual(browser.goes, [], "la voce di A è sotto quella di B");
  history.close(b.token);
  assert.deepEqual(browser.goes, [-2]);
  browser.traversals();
  assert.equal(browser.index, 1);
});

test("chiudere e aprire nello stesso istante: il nuovo drawer aspetta l'Indietro in corso", () => {
  const { browser, history } = setup();
  const log = [];
  const a = closingDrawer(history, log, "A");
  history.close(a.token);
  closingDrawer(history, log, "B");
  assert.equal(browser.index, 2, "la voce di B non è ancora stata aggiunta");
  browser.traversals();
  assert.equal(browser.index, 2, "dopo l'Indietro di A arriva la voce di B");
  assert.deepEqual(log, [], "l'Indietro di A non chiude B");
  browser.back();
  assert.deepEqual(log, ["B"]);
});

test("una navigazione già avvenuta: alla chiusura nessun Indietro", () => {
  const { browser, history } = setup();
  const log = [];
  const drawer = closingDrawer(history, log, "A");
  browser.replaceState({ altro: true });
  history.close(drawer.token);
  assert.deepEqual(browser.goes, []);
});

test("Avanti su una voce di un drawer già chiuso: si torna indietro, nessun drawer si chiude", () => {
  const { browser, history } = setup();
  const log = [];
  closingDrawer(history, log, "A");
  const b = closingDrawer(history, log, "B");
  history.close(b.token);
  browser.traversals();
  assert.equal(browser.index, 2);
  browser.forward();
  assert.deepEqual(log, [], "A resta aperto");
  browser.traversals();
  assert.equal(browser.index, 2);
  browser.back();
  assert.deepEqual(log, ["A"]);
});

test("voci di un caricamento precedente (pagina ricaricata con un drawer aperto) contano come pagina", () => {
  const { browser, history } = setup();
  browser.replaceState({ [DRAWER_STATE_KEY]: "vecchio:1" });
  const log = [];
  closingDrawer(history, log, "A");
  browser.back();
  assert.deepEqual(log, ["A"]);
});

test("se l'Indietro chiesto non arriva, dopo un po' le aperture non restano in attesa", () => {
  const { browser, history } = setup();
  const log = [];
  const a = closingDrawer(history, log, "A");
  history.close(a.token);
  closingDrawer(history, log, "B");
  assert.equal(browser.length, 3);
  browser.timers(); // nessun popstate: scade l'attesa
  assert.equal(browser.env.current() !== null, true);
  assert.equal(history.size, 1);
});
