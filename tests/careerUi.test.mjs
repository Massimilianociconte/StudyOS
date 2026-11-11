import test from "node:test";
import assert from "node:assert/strict";

const { CAREER_TEXT, CAREER_HELP } = await import("../src/lib/labels.ts");
const { DEGREE_PROGRAMS, DEGREE_PROGRAM_IDS } = await import("../src/lib/graduation.ts");

test("Libretto: il corso di laurea si legge (nome, livello, CFU) e si cambia solo in Impostazioni", () => {
  for (const id of DEGREE_PROGRAM_IDS) {
    const info = DEGREE_PROGRAMS[id];
    const text = CAREER_TEXT.rulesOf(info.name, info.level, info.totalCfu);
    assert.ok(text.includes(info.name), text);
    assert.ok(text.includes(info.level), text);
    assert.ok(text.includes(`${info.totalCfu} CFU`), text);
  }
  assert.equal(CAREER_TEXT.changeInSettings, "Cambia in Impostazioni");
});

test("Libretto: ogni riquadro ha un aiuto con titolo e spiegazione", () => {
  for (const key of ["weighted", "arithmetic", "cfu", "base", "basis", "passFail", "honors"]) {
    assert.ok(CAREER_HELP[key].title.length > 0, key);
    assert.ok(CAREER_HELP[key].text.length > 0, key);
  }
});
