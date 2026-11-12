import test from "node:test";
import assert from "node:assert/strict";
import { hoursThatAddUp } from "../src/lib/studyStats.ts";
import { formatHours } from "../src/lib/labels.ts";

const total = (minutes) => minutes.reduce((sum, value) => sum + value, 0);
const sum = (hours) => Math.round(hours.reduce((acc, value) => acc + value, 0) * 10) / 10;
const shown = (hours) => formatHours(hours * 60);

test("Statistiche: le ore per materia sommano al totale della settimana (1,3 h, non 0,8 + 0,4)", () => {
  const minutes = [50, 25];
  const hours = hoursThatAddUp(minutes);
  assert.equal(formatHours(total(minutes)), "1,3");
  assert.deepEqual(hours.map(shown), ["0,9", "0,4"]);
  assert.equal(sum(hours), 1.3);
});

test("Statistiche: somma giusta per ogni combinazione, ogni riga a meno di 6 minuti dal vero", () => {
  for (let a = 0; a <= 120; a += 7) {
    for (let b = 1; b <= 120; b += 11) {
      for (const c of [0, 3, 25, 61]) {
        const minutes = [a, b, c];
        const hours = hoursThatAddUp(minutes);
        assert.equal(formatHours(sum(hours) * 60), formatHours(total(minutes)), JSON.stringify(minutes));
        hours.forEach((value, index) => assert.ok(Math.abs(value * 60 - minutes[index]) < 6, JSON.stringify(minutes)));
      }
    }
  }
  assert.deepEqual(hoursThatAddUp([]), []);
  assert.deepEqual(hoursThatAddUp([0, 0]), [0, 0]);
});
