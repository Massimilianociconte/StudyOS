import test from "node:test";
import assert from "node:assert/strict";
import { minutesThatAddUp } from "../src/lib/studyStats.ts";
import { formatMinutes } from "../src/lib/labels.ts";

const total = (minutes) => minutes.reduce((sum, value) => sum + value, 0);

test("Statistiche: righe in minuti come le schede delle materie, e sommano al totale", () => {
  // 50 e 25 minuti: «50 min» e «25 min» (come «50 min di studio» sulla scheda), non 0,9 + 0,4 h.
  const rows = minutesThatAddUp([50, 25]);
  assert.deepEqual(rows.map(formatMinutes), ["50 min", "25 min"]);
  assert.equal(total(rows), 75);
  assert.equal(formatMinutes(total(rows)), "1 h 15 min");
});

test("Statistiche: minuti con decimali (cronometro) sommano comunque al totale arrotondato", () => {
  for (let a = 0; a <= 120; a += 7.5) {
    for (let b = 0.5; b <= 120; b += 11.25) {
      for (const c of [0, 0.5, 25.5, 61.4]) {
        const minutes = [a, b, c];
        const rows = minutesThatAddUp(minutes);
        assert.equal(total(rows), Math.round(total(minutes)), JSON.stringify(minutes));
        rows.forEach((value, index) => {
          assert.ok(Number.isInteger(value));
          assert.ok(Math.abs(value - minutes[index]) < 1, JSON.stringify(minutes));
        });
      }
    }
  }
  assert.deepEqual(minutesThatAddUp([]), []);
  assert.deepEqual(minutesThatAddUp([0, 0]), [0, 0]);
  assert.deepEqual(minutesThatAddUp([-5, 10]), [0, 10]);
});
