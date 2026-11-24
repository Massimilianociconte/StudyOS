import test from "node:test";
import assert from "node:assert/strict";

const { placeFloating, menuIndexForKey, FLOATING_MARGIN, FLOATING_GAP } = await import("../src/lib/uiPieces.ts");
const { UI_TEXT } = await import("../src/lib/labels.ts");
const { OFFICIAL_EXAMS_ADD_LABEL } = await import("../src/lib/labels/exams.ts");

const phone = { width: 375, height: 812 };
const rect = (left, top, size = 24) => ({ left, top, right: left + size, bottom: top + size });

test("placeFloating: sotto il pulsante, allineato all'inizio, se c'è posto", () => {
  const position = placeFloating(rect(40, 100), { width: 200, height: 120 }, phone);
  assert.deepEqual(position, { side: "bottom", top: 100 + 24 + FLOATING_GAP, left: 40 });
});

test("placeFloating: a 375 px resta dentro lo schermo con 16 px di margine", () => {
  // "?" vicino al bordo destro, fumetto largo 320 px centrato sul pulsante: andrebbe fuori a destra.
  const right = placeFloating(rect(340, 100), { width: 320, height: 120 }, phone, { align: "center" });
  assert.equal(right.left, 375 - FLOATING_MARGIN - 320);
  assert.ok(right.left + 320 <= 375 - FLOATING_MARGIN);
  // Vicino al bordo sinistro: non va sotto i 16 px.
  const left = placeFloating(rect(4, 100), { width: 320, height: 120 }, phone, { align: "center" });
  assert.equal(left.left, FLOATING_MARGIN);
  // Più largo dello schermo (il CSS lo limita a 100vw - 32px): parte comunque dal margine.
  assert.equal(placeFloating(rect(100, 100), { width: 600, height: 120 }, phone).left, FLOATING_MARGIN);
});

test("placeFloating: allineato alla fine (menu sotto un pulsante a destra)", () => {
  const position = placeFloating(rect(300, 60, 44), { width: 208, height: 150 }, phone, { align: "end" });
  assert.equal(position.left, 344 - 208);
  assert.equal(position.side, "bottom");
});

test("placeFloating: sopra se sotto manca spazio, poi tenuto dentro in verticale", () => {
  const above = placeFloating(rect(40, 700), { width: 200, height: 150 }, phone);
  assert.equal(above.side, "top");
  assert.equal(above.top, 700 - FLOATING_GAP - 150);
  // Più alto dello spazio da entrambe le parti: lato con più spazio, mai oltre il margine.
  const tall = placeFloating(rect(40, 300), { width: 200, height: 900 }, phone);
  assert.equal(tall.side, "bottom");
  assert.equal(tall.top, FLOATING_MARGIN);
});

test("menuIndexForKey: frecce in giro continuo, Home/End, altri tasti ignorati", () => {
  assert.equal(menuIndexForKey("ArrowDown", 0, 3), 1);
  assert.equal(menuIndexForKey("ArrowDown", 2, 3), 0);
  assert.equal(menuIndexForKey("ArrowUp", 0, 3), 2);
  assert.equal(menuIndexForKey("ArrowUp", 2, 3), 1);
  assert.equal(menuIndexForKey("ArrowDown", -1, 3), 0);
  assert.equal(menuIndexForKey("ArrowUp", -1, 3), 2);
  assert.equal(menuIndexForKey("Home", 2, 3), 0);
  assert.equal(menuIndexForKey("End", 0, 3), 2);
  assert.equal(menuIndexForKey("a", 0, 3), null);
  assert.equal(menuIndexForKey("Enter", 0, 3), null);
  assert.equal(menuIndexForKey("ArrowDown", 0, 0), null);
});

test("testi comuni: nome accessibile dell'aiuto e nome unico degli appelli ufficiali", () => {
  assert.equal(UI_TEXT.helpAria("Password dell'app"), "Aiuto: Password dell'app");
  assert.equal(UI_TEXT.moreActions, "Altre azioni");
  assert.equal(OFFICIAL_EXAMS_ADD_LABEL, "Aggiungi appelli ufficiali");
});

const { listboxIndexForKey, typeaheadIndex } = await import("../src/lib/uiPieces.ts");

test("tendina: frecce senza giro, voci non disponibili saltate, Home/End, Pagina su/giù", () => {
  const disabled = [true, false, false, true, false];
  assert.equal(listboxIndexForKey("ArrowDown", -1, disabled), 1, "si parte dalla prima disponibile");
  assert.equal(listboxIndexForKey("ArrowDown", 2, disabled), 4, "salta la voce non disponibile");
  assert.equal(listboxIndexForKey("ArrowDown", 4, disabled), 4, "in fondo resta lì");
  assert.equal(listboxIndexForKey("ArrowUp", 1, disabled), 1, "in cima resta lì");
  assert.equal(listboxIndexForKey("ArrowUp", -1, disabled), 4);
  assert.equal(listboxIndexForKey("Home", 4, disabled), 1);
  assert.equal(listboxIndexForKey("End", 1, disabled), 4);
  assert.equal(listboxIndexForKey("PageDown", 1, disabled, 2), 4);
  assert.equal(listboxIndexForKey("PageUp", 4, disabled, 8), 1);
  assert.equal(listboxIndexForKey("a", 1, disabled), null);
  assert.equal(listboxIndexForKey("ArrowDown", -1, [true, true]), null, "nessuna voce disponibile");
});

test("tendina: lettere per saltare alla voce, accenti e maiuscole non contano", () => {
  const labels = ["Nessuna materia", "Anatomia", "Analisi", "Fisiologia", "Àrte"];
  const none = labels.map(() => false);
  assert.equal(typeaheadIndex(labels, none, 0, "a"), 1);
  assert.equal(typeaheadIndex(labels, none, 1, "a"), 2, "la stessa lettera passa alla voce dopo");
  assert.equal(typeaheadIndex(labels, none, 2, "aa"), 4, "anche ripetuta; «À» vale «a»");
  assert.equal(typeaheadIndex(labels, none, 1, "anal"), 2, "più lettere: la prima che comincia così");
  assert.equal(typeaheadIndex(labels, none, 1, "ana"), 1, "la voce attiva resta se va ancora bene");
  assert.equal(typeaheadIndex(labels, [false, true, false, false, false], -1, "a"), 2, "salta le non disponibili");
  assert.equal(typeaheadIndex(labels, none, 0, "z"), null);
  assert.equal(typeaheadIndex(labels, none, 0, " "), null);
});
