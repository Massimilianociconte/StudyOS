import test from "node:test";
import assert from "node:assert/strict";

const { createScrollLock, createLayerStack, lockStyles, scrollbarWidthOf, applyStyles, canScrollToward } = await import(
  "../src/lib/scrollLock.ts"
);

const fakeEnv = () => {
  const calls = [];
  return {
    calls,
    lock: () => {
      calls.push("lock");
      return () => calls.push("unlock");
    }
  };
};

test("createScrollLock: il primo blocca, l'ultimo sblocca (finestre annidate)", () => {
  const env = fakeEnv();
  const lock = createScrollLock(env);
  const editor = lock.acquire();
  const picker = lock.acquire();
  assert.deepEqual(env.calls, ["lock"]);
  assert.equal(lock.count, 2);
  picker();
  assert.deepEqual(env.calls, ["lock"], "il selettore si chiude: il modulo sotto resta bloccato");
  editor();
  assert.deepEqual(env.calls, ["lock", "unlock"]);
  assert.equal(lock.count, 0);
});

test("createScrollLock: rilasci in ordine diverso e rilascio doppio non sbloccano prima del tempo", () => {
  const env = fakeEnv();
  const lock = createScrollLock(env);
  const a = lock.acquire();
  const b = lock.acquire();
  a();
  a();
  assert.equal(lock.count, 1);
  assert.deepEqual(env.calls, ["lock"]);
  b();
  assert.deepEqual(env.calls, ["lock", "unlock"]);
  // Si può bloccare di nuovo dopo lo sblocco.
  const c = lock.acquire();
  c();
  assert.deepEqual(env.calls, ["lock", "unlock", "lock", "unlock"]);
});

test("createLayerStack: solo l'ultimo aperto è in cima, anche togliendo quelli sotto", () => {
  const stack = createLayerStack();
  const drawer = stack.push("drawer");
  const picker = stack.push("picker");
  assert.equal(stack.isTop(picker), true);
  assert.equal(stack.isTop(drawer), false);
  assert.equal(stack.top(), "picker");
  stack.remove(drawer);
  assert.equal(stack.isTop(picker), true);
  stack.remove(picker);
  assert.equal(stack.top(), undefined);
  assert.equal(stack.size, 0);
  // Rimuovere due volte non tocca gli altri.
  const again = stack.push("again");
  stack.remove(picker);
  assert.equal(stack.isTop(again), true);
});

test("scrollbarWidthOf: larghezza della barra di scorrimento, mai negativa", () => {
  assert.equal(scrollbarWidthOf(1280, 1265), 15);
  assert.equal(scrollbarWidthOf(375, 375), 0);
  assert.equal(scrollbarWidthOf(375, 380), 0);
});

test("lockStyles: blocca html, lascia body senza scorrimento proprio e compensa la barra", () => {
  const desktop = lockStyles({ scrollbarWidth: 15, bodyPaddingRight: 4 });
  assert.equal(desktop.html.overflow, "hidden");
  assert.equal(desktop.html["overscroll-behavior"], "none");
  // body "visible": con overflow-x hidden diventerebbe un contenitore di scorrimento e i pezzi sticky salterebbero.
  assert.equal(desktop.body.overflow, "visible");
  assert.equal(desktop.body["padding-right"], "19px");
  const phone = lockStyles({ scrollbarWidth: 0, bodyPaddingRight: 0 });
  assert.equal(phone.body["padding-right"], undefined, "niente compensazione con le barre sovrapposte (telefono)");
});

const fakeStyle = (initial = {}) => {
  const values = new Map(Object.entries(initial).map(([key, value]) => [key, Array.isArray(value) ? value : [value, ""]]));
  return {
    values,
    style: {
      getPropertyValue: (name) => values.get(name)?.[0] ?? "",
      getPropertyPriority: (name) => values.get(name)?.[1] ?? "",
      setProperty: (name, value, priority = "") => values.set(name, [value, priority]),
      removeProperty: (name) => values.delete(name)
    }
  };
};

test("applyStyles: applica e rimette esattamente i valori in linea di prima", () => {
  const target = fakeStyle({ overflow: "scroll", "padding-right": ["2px", "important"] });
  const restore = applyStyles(target, { overflow: "hidden", "padding-right": "17px", "overscroll-behavior": "none", width: undefined });
  assert.deepEqual(target.values.get("overflow"), ["hidden", ""]);
  assert.deepEqual(target.values.get("padding-right"), ["17px", ""]);
  assert.equal(target.values.has("width"), false, "undefined non scrive nulla");
  restore();
  assert.deepEqual(target.values.get("overflow"), ["scroll", ""]);
  assert.deepEqual(target.values.get("padding-right"), ["2px", "important"]);
  assert.equal(target.values.has("overscroll-behavior"), false, "una proprietà che non c'era viene tolta");
});

const box = (patch = {}) => ({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400, scrollLeft: 0, scrollWidth: 300, clientWidth: 300, ...patch });

test("canScrollToward: un pannello scorre solo se ha ancora spazio in quella direzione", () => {
  // Dito verso l'alto (dy < 0) = il contenuto scende.
  assert.equal(canScrollToward(box(), 0, -20), true);
  assert.equal(canScrollToward(box({ scrollTop: 600 }), 0, -20), false, "in fondo: niente rimbalzo della pagina sotto");
  // Dito verso il basso = il contenuto sale.
  assert.equal(canScrollToward(box(), 0, 20), false, "in cima: niente rimbalzo");
  assert.equal(canScrollToward(box({ scrollTop: 10 }), 0, 20), true);
  // Gesto orizzontale: conta l'asse prevalente.
  assert.equal(canScrollToward(box(), -30, 5), false, "niente da scorrere in orizzontale");
  assert.equal(canScrollToward(box({ scrollWidth: 900 }), -30, 5), true);
  assert.equal(canScrollToward(box({ scrollWidth: 900, scrollLeft: 600 }), -30, 5), false);
  // Nessun contenuto in più: mai.
  assert.equal(canScrollToward(box({ scrollHeight: 400 }), 0, -20), false);
});
