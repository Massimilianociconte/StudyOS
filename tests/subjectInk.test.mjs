import test from "node:test";
import assert from "node:assert/strict";
import { DARK_INK, LIGHT_INK, inkOn } from "../src/lib/subjectInk.ts";
import { contrastRatio } from "../src/lib/eventColors.ts";

const SWATCHES = ["#7CF7C8", "#9FB7FF", "#F7A8C4", "#FFD37C", "#C8A2FF", "#7FE3F5", "#FFAE7C", "#A6E3A1"];

test("icona della materia: scura sui colori proposti (chiari), come prima", () => {
  for (const swatch of SWATCHES) assert.equal(inkOn(swatch), DARK_INK, swatch);
  assert.equal(inkOn("#7CF7C8", "#172333"), "#172333");
});

test("icona della materia: bianca su un colore scuro scelto a mano, sempre leggibile", () => {
  for (const color of ["#1f2937", "#000", "#3b0764", "#14532d", "#7f1d1d"]) {
    assert.equal(inkOn(color), LIGHT_INK, color);
    assert.ok(contrastRatio(color, inkOn(color)) >= 3, color);
  }
});

test("icona della materia: l'inchiostro scelto ha sempre il contrasto più alto dei due", () => {
  for (let value = 0; value <= 255; value += 15) {
    const hex = `#${value.toString(16).padStart(2, "0").repeat(3)}`;
    const ink = inkOn(hex);
    const other = ink === DARK_INK ? LIGHT_INK : DARK_INK;
    assert.ok(contrastRatio(hex, ink) >= contrastRatio(hex, other), hex);
  }
});

test("icona della materia: senza un colore valido resta l'inchiostro scuro", () => {
  assert.equal(inkOn(""), DARK_INK);
  assert.equal(inkOn(undefined), DARK_INK);
  assert.equal(inkOn("var(--accent)"), DARK_INK);
  assert.equal(inkOn("red; background:url(x)"), DARK_INK);
});
