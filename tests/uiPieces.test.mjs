import test from "node:test";
import assert from "node:assert/strict";

const { placeFloating, menuIndexForKey, FLOATING_MARGIN, FLOATING_GAP } = await import("../src/lib/uiPieces.ts");
const { quickAddDefaults, quickAddTaskDates } = await import("../src/lib/quickAdd.ts");
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

test("aggiunta rapida: l'attività parte senza scadenza, eventi e studio alla prossima mezz'ora", () => {
  const defaults = quickAddDefaults(new Date(2026, 10, 11, 10, 10));
  assert.equal(defaults.taskDue, "");
  assert.equal(defaults.start, "2026-11-11T10:30");
});

test("aggiunta rapida: date dell'attività dal campo", () => {
  const now = new Date("2026-11-11T09:00:00.000Z");
  // Campo vuoto: nessuna scadenza.
  assert.deepEqual(quickAddTaskDates("", "normal", now), { dueDate: undefined, completedAt: undefined });
  assert.deepEqual(quickAddTaskDates("  ", "timer", now), { dueDate: undefined, completedAt: undefined });
  // Già fatta senza data: fatta adesso, sempre senza scadenza.
  assert.deepEqual(quickAddTaskDates("", "completed", now), { dueDate: undefined, completedAt: now.toISOString() });
  // Data scelta: diventa la scadenza (e, se già fatta, anche il momento in cui l'hai fatta).
  const picked = new Date("2026-11-12T09:00").toISOString();
  assert.deepEqual(quickAddTaskDates("2026-11-12T09:00", "normal", now), { dueDate: picked, completedAt: undefined });
  assert.deepEqual(quickAddTaskDates("2026-11-12T09:00", "completed", now), { dueDate: picked, completedAt: picked });
  // Data non valida: errore, non un'attività senza scadenza.
  assert.equal(quickAddTaskDates("non è una data", "normal", now), null);
});

test("testi comuni: nome accessibile dell'aiuto e nome unico degli appelli ufficiali", () => {
  assert.equal(UI_TEXT.helpAria("Password dell'app"), "Aiuto: Password dell'app");
  assert.equal(UI_TEXT.moreActions, "Altre azioni");
  assert.equal(OFFICIAL_EXAMS_ADD_LABEL, "Aggiungi appelli ufficiali");
});
