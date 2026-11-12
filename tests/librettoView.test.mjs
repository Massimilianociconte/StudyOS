import test from "node:test";
import assert from "node:assert/strict";
import { gaugeSpan, gradeTint, pointsToTop, sortLibretto } from "../src/lib/librettoView.ts";

const entry = (name, date, grade, extra = {}) => ({ name, date, grade, cfu: 6, honors: false, passFail: false, ...extra });

const entries = [
  entry("Inglese", "2025-01-20", undefined, { passFail: true, cfu: 3 }),
  entry("Genetica", "2025-02-24", 30, { honors: true, cfu: 9 }),
  entry("Biochimica", "2025-02-10", 28),
  entry("Cellulare", "2026-01-28", 30, { cfu: 9 }),
  entry("Immunologia", "2025-06-18", 26)
];

test("libretto: per data dal più recente", () => {
  assert.deepEqual(sortLibretto(entries, "recent").map((e) => e.name), ["Cellulare", "Immunologia", "Genetica", "Biochimica", "Inglese"]);
});

test("libretto: per voto, la lode sopra il 30 e l'idoneità in fondo", () => {
  assert.deepEqual(sortLibretto(entries, "grade").map((e) => e.name), ["Genetica", "Cellulare", "Biochimica", "Immunologia", "Inglese"]);
});

test("libretto: per CFU, a parità il voto più alto", () => {
  assert.deepEqual(sortLibretto(entries, "cfu").map((e) => e.name), ["Genetica", "Cellulare", "Biochimica", "Immunologia", "Inglese"]);
});

test("libretto: l'ordinamento non cambia l'elenco ricevuto", () => {
  const before = entries.map((e) => e.name);
  sortLibretto(entries, "grade");
  assert.deepEqual(entries.map((e) => e.name), before);
});

test("colore del voto: cresce col voto, la lode un po' di più, mai oltre il limite leggibile", () => {
  assert.equal(gradeTint(entry("a", "2025-01-01", 18)), 10);
  assert.equal(gradeTint(entry("a", "2025-01-01", 30)), 32);
  assert.equal(gradeTint(entry("a", "2025-01-01", 30, { honors: true })), 36);
  assert.equal(gradeTint(entry("a", "2025-01-01", undefined, { passFail: true })), 8);
  assert.ok(gradeTint(entry("a", "2025-01-01", 24)) > gradeTint(entry("a", "2025-01-01", 23)));
});

test("barra del voto di laurea: da 66 a 110, con la parte «fino a»", () => {
  assert.deepEqual(gaugeSpan(66, 66), { sure: 0, upTo: 0 });
  assert.deepEqual(gaugeSpan(88, 88), { sure: 50, upTo: 50 });
  assert.deepEqual(gaugeSpan(110, 110), { sure: 100, upTo: 100 });
  assert.deepEqual(gaugeSpan(40, 40), { sure: 0, upTo: 0 });
  const span = gaugeSpan(99, 100);
  assert.ok(span.upTo > span.sure);
});

test("punti che mancano al 110", () => {
  assert.equal(pointsToTop(109.45), 0.55);
  assert.equal(pointsToTop(110), null);
  assert.equal(pointsToTop(112.3), null);
});
