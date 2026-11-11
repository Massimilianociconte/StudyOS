import test from "node:test";
import assert from "node:assert/strict";
import { editedSessionTimes } from "../src/lib/studySessions.ts";

const MIN = 60_000;
const at = (hours, minutes = 0) => Date.UTC(2026, 10, 10, hours, minutes);

test("editedSessionTimes: senza cambi restano inizio e fine", () => {
  assert.deepEqual(editedSessionTimes({ start: at(10), end: at(12), minutes: 90 }, {}), { start: at(10), end: at(12) });
  assert.deepEqual(editedSessionTimes({ start: at(10), minutes: 45 }, {}), { start: at(10), end: at(10, 45) }, "senza fine: inizio + minuti");
});

test("editedSessionTimes: meno minuti dopo un cronometro rimasto acceso spostano la fine", () => {
  // 21:00 → 06:00, nove ore senza pause: diventano 90 minuti, fine alle 22:30.
  assert.deepEqual(editedSessionTimes({ start: at(21), end: at(21) + 540 * MIN, minutes: 540 }, { minutes: 90 }), { start: at(21), end: at(22, 30) });
});

test("editedSessionTimes: le pause restano (Pomodoro 10:00 → 13:30 con 90 minuti di studio)", () => {
  const original = { start: at(10), end: at(13, 30), minutes: 90 };
  assert.deepEqual(editedSessionTimes(original, { start: at(11) }), { start: at(11), end: at(14, 30) });
  assert.deepEqual(editedSessionTimes(original, { minutes: 60 }), { start: at(10), end: at(13) });
  assert.deepEqual(editedSessionTimes(original, { start: at(9), minutes: 120 }), { start: at(9), end: at(13) });
});

test("editedSessionTimes: fine prima dell'inizio o minuti arrotondati non creano pause negative", () => {
  assert.deepEqual(editedSessionTimes({ start: at(10), end: at(9), minutes: 30 }, { minutes: 40 }), { start: at(10), end: at(10, 40) });
  assert.deepEqual(editedSessionTimes({ start: at(10), end: at(10, 29), minutes: 30 }, { minutes: 20 }), { start: at(10), end: at(10, 20) });
});
