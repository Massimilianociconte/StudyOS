import test from "node:test";
import assert from "node:assert/strict";
import { pageCount, pageRangeText, splitPages, SPLIT_MAX_PARTS } from "../src/agent/pageSplit.ts";
import { withZonedDate } from "../src/agent/zonedDate.ts";

const ranges = (result) => result.parts.map((part) => [part.from, part.to, part.pages]);

/** Invarianti di ogni divisione riuscita: contigue, inclusive, somma = totale, testo coerente. */
const assertSound = (result, from, to) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.totalPages, to - from + 1);
  assert.equal(result.partCount, result.parts.length);
  assert.equal(result.parts[0].from, from);
  assert.equal(result.parts.at(-1).to, to);
  let sum = 0;
  for (const [index, part] of result.parts.entries()) {
    assert.equal(part.index, index + 1);
    assert.ok(part.pages >= 1);
    assert.equal(part.pages, part.to - part.from + 1);
    assert.equal(part.text, pageRangeText(part.from, part.to));
    if (index > 0) assert.equal(part.from, result.parts[index - 1].to + 1, "nessun buco né sovrapposizione");
    sum += part.pages;
  }
  assert.equal(sum, result.totalPages);
};

test("pagine: conteggio inclusivo e testo pronto in italiano", () => {
  assert.equal(pageCount(10, 20), 11);
  assert.equal(pageCount(7, 7), 1);
  assert.equal(pageRangeText(120, 134), "pp. 120–134 (15 pagine)");
  assert.equal(pageRangeText(10, 20), "pp. 10–20 (11 pagine)");
  assert.equal(pageRangeText(7, 7), "p. 7 (1 pagina)");
  assert.equal(pageRangeText(7, 8), "pp. 7–8 (2 pagine)");
});

test("pagine: 120–180 in 4 parti, il resto va alle prime", () => {
  const result = splitPages({ from: 120, to: 180, parts: 4 });
  assertSound(result, 120, 180);
  assert.deepEqual(ranges(result), [[120, 135, 16], [136, 150, 15], [151, 165, 15], [166, 180, 15]]);
  assert.equal(result.parts[0].text, "pp. 120–135 (16 pagine)");
  assert.equal(result.summary, "pp. 120–180 (61 pagine) in 4 parti: 16 + 15 + 15 + 15 = 61 pagine.");
});

test("pagine: off-by-one, una parte, una pagina, parti uguali alle pagine", () => {
  assert.deepEqual(ranges(splitPages({ from: 10, to: 20, parts: 1 })), [[10, 20, 11]]);
  const single = splitPages({ from: 5, to: 5, parts: 1 });
  assertSound(single, 5, 5);
  assert.equal(single.parts[0].text, "p. 5 (1 pagina)");
  assert.equal(single.summary, "p. 5 (1 pagina) in 1 parte: 1 = 1 pagine.");
  assert.deepEqual(ranges(splitPages({ from: 1, to: 3, parts: 3 })), [[1, 1, 1], [2, 2, 1], [3, 3, 1]]);
  // 1–100 in 3: 34 + 33 + 33, non 33 + 33 + 34 né 33 × 3 = 99.
  assert.deepEqual(ranges(splitPages({ from: 1, to: 100, parts: 3 })), [[1, 34, 34], [35, 67, 33], [68, 100, 33]]);
  // Pari: nessun resto.
  assert.deepEqual(ranges(splitPages({ from: 21, to: 60, parts: 4 })), [[21, 30, 10], [31, 40, 10], [41, 50, 10], [51, 60, 10]]);
});

test("pagine: più parti che pagine è un errore chiaro", () => {
  const result = splitPages({ from: 1, to: 3, parts: 4 });
  assert.equal(result.ok, false);
  assert.match(result.error, /Le pagine sono 3/);
  assert.match(result.error, /meno delle parti \(4\)/);
});

test("pagine: perPart, l'ultima parte prende il resto", () => {
  assert.deepEqual(ranges(splitPages({ from: 1, to: 100, perPart: 30 })), [[1, 30, 30], [31, 60, 30], [61, 90, 30], [91, 100, 10]]);
  assert.deepEqual(ranges(splitPages({ from: 1, to: 90, perPart: 30 })), [[1, 30, 30], [31, 60, 30], [61, 90, 30]]);
  assert.deepEqual(ranges(splitPages({ from: 40, to: 45, perPart: 50 })), [[40, 45, 6]]);
  assert.deepEqual(ranges(splitPages({ from: 9, to: 11, perPart: 1 })), [[9, 9, 1], [10, 10, 1], [11, 11, 1]]);
  const tooMany = splitPages({ from: 1, to: 1000, perPart: 1 });
  assert.equal(tooMany.ok, false);
  assert.match(tooMany.error, /oltre il massimo di 366/);
});

test("pagine: proprietà su molte divisioni casuali (contigue, somma, differenza al massimo 1)", () => {
  let seed = 42;
  const random = (max) => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return 1 + (seed % max);
  };
  for (let round = 0; round < 500; round += 1) {
    const from = random(900);
    const to = from + random(400) - 1;
    const total = to - from + 1;
    const parts = Math.min(total, random(40));
    const result = splitPages({ from, to, parts });
    assertSound(result, from, to);
    assert.equal(result.partCount, parts);
    const sizes = result.parts.map((part) => part.pages);
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, "parti bilanciate");
    assert.deepEqual(sizes, [...sizes].sort((a, b) => b - a), "le parti più lunghe vengono prima");
    const perPart = random(60);
    const byPage = splitPages({ from, to, perPart });
    if (Math.ceil(total / perPart) > SPLIT_MAX_PARTS) continue;
    assertSound(byPage, from, to);
    assert.ok(byPage.parts.slice(0, -1).every((part) => part.pages === perPart));
    assert.ok(byPage.parts.at(-1).pages <= perPart);
  }
});

test("pagine: una parte per giorno tra due date, con fine settimana saltati", () => {
  const result = splitPages({ from: 120, to: 180, startDate: "2026-11-16", endDate: "2026-11-19" });
  assertSound(result, 120, 180);
  assert.deepEqual(result.parts.map((part) => [part.date, part.weekday, part.from, part.to]), [
    ["2026-11-16", "lunedì", 120, 135],
    ["2026-11-17", "martedì", 136, 150],
    ["2026-11-18", "mercoledì", 151, 165],
    ["2026-11-19", "giovedì", 166, 180]
  ]);
  const weekdays = splitPages({ from: 1, to: 50, startDate: "2026-11-20", endDate: "2026-11-24", skipWeekdays: ["SA", "SU"] });
  assertSound(weekdays, 1, 50);
  assert.deepEqual(weekdays.parts.map((part) => part.date), ["2026-11-20", "2026-11-23", "2026-11-24"]);
  assert.deepEqual(weekdays.parts.map((part) => part.pages), [17, 17, 16]);
  const only = splitPages({ from: 1, to: 60, startDate: "2026-11-16", endDate: "2026-11-29", days: ["MO", "WE", "FR"] });
  assert.deepEqual(only.parts.map((part) => part.date), ["2026-11-16", "2026-11-18", "2026-11-20", "2026-11-23", "2026-11-25", "2026-11-27"]);
  assert.ok(only.parts.every((part) => part.pages === 10));
});

test("pagine: date attraverso i cambi d'ora di Europe/Rome, uguali in ogni fuso", async () => {
  const spring = () => splitPages({ from: 1, to: 40, startDate: "2026-03-27", endDate: "2026-03-30" });
  const autumn = () => splitPages({ from: 201, to: 230, startDate: "2026-10-24", endDate: "2026-10-26" });
  const springExpected = [
    ["2026-03-27", "venerdì", 1, 10],
    ["2026-03-28", "sabato", 11, 20],
    ["2026-03-29", "domenica", 21, 30],
    ["2026-03-30", "lunedì", 31, 40]
  ];
  const autumnExpected = [
    ["2026-10-24", "sabato", 201, 210],
    ["2026-10-25", "domenica", 211, 220],
    ["2026-10-26", "lunedì", 221, 230]
  ];
  const shape = (result) => result.parts.map((part) => [part.date, part.weekday, part.from, part.to]);
  // Come sul connettore remoto: Date diventa quella del fuso della persona.
  const zones = [null, "Europe/Rome", "Pacific/Kiritimati", "America/Los_Angeles"];
  for (const zone of zones) {
    const run = (fn) => (zone ? withZonedDate(zone, async () => fn()) : Promise.resolve(fn()));
    assert.deepEqual(shape(await run(spring)), springExpected, zone ?? "locale");
    assert.deepEqual(shape(await run(autumn)), autumnExpected, zone ?? "locale");
  }
  // Fine settimana saltati intorno al cambio d'ora: il lunedì dopo resta lunedì.
  const skip = splitPages({ from: 1, to: 20, startDate: "2026-03-27", endDate: "2026-03-31", skipWeekdays: ["SA", "SU"] });
  assert.deepEqual(skip.parts.map((part) => part.date), ["2026-03-27", "2026-03-30", "2026-03-31"]);
});

test("pagine: startDate senza endDate dà i giorni utili alle parti in ordine", () => {
  const result = splitPages({ from: 1, to: 45, perPart: 15, startDate: "2026-11-20", skipWeekdays: ["SA", "SU"] });
  assertSound(result, 1, 45);
  assert.deepEqual(result.parts.map((part) => [part.date, part.text]), [
    ["2026-11-20", "pp. 1–15 (15 pagine)"],
    ["2026-11-23", "pp. 16–30 (15 pagine)"],
    ["2026-11-24", "pp. 31–45 (15 pagine)"]
  ]);
  const byParts = splitPages({ from: 300, to: 301, parts: 2, startDate: "2026-12-31" });
  assert.deepEqual(byParts.parts.map((part) => part.date), ["2026-12-31", "2027-01-01"]);
});

test("pagine: etichette in ordine, troppe etichette sono un errore", () => {
  const result = splitPages({ from: 1, to: 30, parts: 3, labels: ["Cap. 1", " Cap. 2 ", ""] });
  assert.deepEqual(result.parts.map((part) => part.label), ["Cap. 1", "Cap. 2", undefined]);
  const fewer = splitPages({ from: 1, to: 30, parts: 3, labels: ["Cap. 1"] });
  assert.equal(fewer.parts[0].label, "Cap. 1");
  assert.equal("label" in fewer.parts[1], false);
  const many = splitPages({ from: 1, to: 30, parts: 2, labels: ["a", "b", "c"] });
  assert.equal(many.ok, false);
  assert.match(many.error, /labels ha 3 etichette ma le parti sono 2/);
});

test("pagine: argomenti sbagliati spiegano cosa correggere", () => {
  const cases = [
    [{ from: 0, to: 10, parts: 2 }, /da 1 a/],
    [{ from: 1.5, to: 10, parts: 2 }, /interi/],
    [{ from: 20, to: 10, parts: 2 }, /to \(10\) deve essere uguale o successivo a from \(20\)/],
    [{ from: 1, to: 10 }, /Indica parts, perPart oppure startDate ed endDate/],
    [{ from: 1, to: 10, parts: 2, perPart: 5 }, /non tutti e due/],
    [{ from: 1, to: 10, parts: 0 }, /parts deve essere un intero/],
    [{ from: 1, to: 10, endDate: "2026-11-20" }, /endDate richiede startDate/],
    [{ from: 1, to: 10, parts: 2, startDate: "2026-11-20", endDate: "2026-11-22" }, /non passare anche parts o perPart/],
    [{ from: 1, to: 10, startDate: "2026-11-22", endDate: "2026-11-20" }, /deve essere uguale o successiva/],
    [{ from: 1, to: 10, startDate: "2026-02-30", endDate: "2026-03-02" }, /startDate deve essere una data/],
    [{ from: 1, to: 1000, startDate: "2026-01-01", endDate: "2027-01-02" }, /al massimo 366 giorni/],
    [{ from: 1, to: 2, startDate: "2026-11-16", endDate: "2026-11-20" }, /Le pagine sono 2 .* e i giorni utili 5/],
    [{ from: 1, to: 10, startDate: "2026-11-21", endDate: "2026-11-22", skipWeekdays: ["SA", "SU"] }, /Nessun giorno utile/],
    [{ from: 1, to: 10, parts: 2, skipWeekdays: ["SA"] }, /valgono solo con startDate/],
    [{ from: 1, to: 10, parts: 2, startDate: "2026-11-20", days: ["SA"], skipWeekdays: ["SA"] }, /non resta nessun giorno/],
    [{ from: 1, to: 10, parts: 2, startDate: "2026-11-20", days: ["XX"] }, /days accetta solo/]
  ];
  for (const [input, message] of cases) {
    const result = splitPages(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    assert.match(result.error, message, JSON.stringify(input));
  }
});
