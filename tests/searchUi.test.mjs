import test from "node:test";
import assert from "node:assert/strict";

const { searchPanelBox, searchOptionId, nextSearchIndex, SEARCH_GUTTER } = await import("../src/lib/searchUi.ts");

/* ------------------------------------------------------------------ */
/* Ricerca: pannello dei risultati e combobox                          */
/* ------------------------------------------------------------------ */

test("searchPanelBox: sui telefoni il pannello è largo quanto lo schermo meno 16 px per lato", () => {
  // Campo di 177 px che parte a 24 px dal bordo, schermo da 375.
  assert.deepEqual(searchPanelBox({ left: 24 }, 375), { left: SEARCH_GUTTER - 24, width: 375 - 2 * SEARCH_GUTTER });
  assert.equal(SEARCH_GUTTER, 16);
  // Il pannello comincia sempre a 16 px dal bordo dello schermo, ovunque sia il campo.
  const box = searchPanelBox({ left: 60 }, 390);
  assert.equal(60 + box.left, 16);
  assert.equal(box.width, 358);
});

test("searchPanelBox: da 640 px in su resta largo quanto il campo (null = posizione di sempre)", () => {
  assert.equal(searchPanelBox({ left: 120 }, 640), null);
  assert.equal(searchPanelBox({ left: 300 }, 1280), null);
  // Misura non ancora disponibile: niente posizione inventata.
  assert.equal(searchPanelBox({ left: 0 }, 0), null);
});

test("searchOptionId: id stabile per aria-activedescendant", () => {
  assert.equal(searchOptionId("ricerca", 0), "ricerca-option-0");
  assert.equal(searchOptionId("ricerca", 11), "ricerca-option-11");
});

test("nextSearchIndex: frecce che girano in tondo, altri tasti ignorati", () => {
  assert.equal(nextSearchIndex(0, "ArrowDown", 3), 1);
  assert.equal(nextSearchIndex(2, "ArrowDown", 3), 0);
  assert.equal(nextSearchIndex(0, "ArrowUp", 3), 2);
  assert.equal(nextSearchIndex(1, "ArrowUp", 3), 0);
  assert.equal(nextSearchIndex(1, "a", 3), null);
  assert.equal(nextSearchIndex(0, "ArrowDown", 0), null);
});
