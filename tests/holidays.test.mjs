import test from "node:test";
import assert from "node:assert/strict";
import { easterSunday, holidaysInRange, italianHolidays } from "../src/lib/holidays.ts";
import { civilWeekday } from "../src/lib/tz.ts";

const find = (year, name) => italianHolidays(year).filter((item) => item.name === name);
const dateOf = (year, name) => find(year, name).map((item) => item.date)[0];

test("Pasqua con il computus gregoriano", () => {
  assert.equal(easterSunday(2024), "2024-03-31");
  assert.equal(easterSunday(2025), "2025-04-20");
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(easterSunday(2038), "2038-04-25");
  assert.equal(easterSunday(2000), "2000-04-23");
  assert.equal(easterSunday(1818), "1818-03-22");
  for (let year = 1900; year <= 2200; year += 1) {
    const easter = easterSunday(year);
    assert.equal(civilWeekday(easter), 0, `${year} domenica`);
    assert.ok(easter >= `${year}-03-22` && easter <= `${year}-04-25`, `${year} tra 22/3 e 25/4`);
  }
});

test("festività del 2026: date fisse, mobili, nazionali, ricorrenze e cambi dell'ora", () => {
  const list = italianHolidays(2026);
  const table = list.map((item) => [item.date, item.name, item.kind]);
  assert.deepEqual(table, [
    ["2026-01-01", "Capodanno", "national"],
    ["2026-01-06", "Epifania", "national"],
    ["2026-02-12", "Giovedì grasso", "celebration"],
    ["2026-02-14", "San Valentino", "celebration"],
    ["2026-02-17", "Martedì grasso", "celebration"],
    ["2026-02-18", "Mercoledì delle Ceneri", "celebration"],
    ["2026-03-08", "Festa della donna", "celebration"],
    ["2026-03-19", "Festa del papà", "celebration"],
    ["2026-03-29", "Domenica delle Palme", "celebration"],
    ["2026-03-29", "Inizia l'ora legale (lancette avanti di un'ora)", "clock"],
    ["2026-04-05", "Pasqua", "national"],
    ["2026-04-06", "Lunedì dell'Angelo (Pasquetta)", "national"],
    ["2026-04-25", "Festa della Liberazione", "national"],
    ["2026-05-01", "Festa dei lavoratori", "national"],
    ["2026-05-10", "Festa della mamma", "celebration"],
    ["2026-06-02", "Festa della Repubblica", "national"],
    ["2026-08-15", "Ferragosto", "national"],
    ["2026-10-02", "Festa dei nonni", "celebration"],
    ["2026-10-04", "San Francesco d'Assisi", "national"],
    ["2026-10-25", "Torna l'ora solare (lancette indietro di un'ora)", "clock"],
    ["2026-10-31", "Halloween", "celebration"],
    ["2026-11-01", "Ognissanti", "national"],
    ["2026-11-02", "Commemorazione dei defunti", "celebration"],
    ["2026-12-08", "Immacolata Concezione", "national"],
    ["2026-12-24", "Vigilia di Natale", "celebration"],
    ["2026-12-25", "Natale", "national"],
    ["2026-12-26", "Santo Stefano", "national"],
    ["2026-12-31", "San Silvestro", "celebration"]
  ]);
  assert.equal(list.filter((item) => item.kind === "national").length, 13);
  for (const item of list) assert.ok(typeof item.icon === "string" && item.icon.length > 0, item.name);
});

test("date mobili del 2027 e coincidenze (ora legale a Pasqua, ora solare ad Halloween)", () => {
  assert.equal(dateOf(2027, "Pasqua"), "2027-03-28");
  assert.equal(dateOf(2027, "Lunedì dell'Angelo (Pasquetta)"), "2027-03-29");
  assert.equal(dateOf(2027, "Giovedì grasso"), "2027-02-04");
  assert.equal(dateOf(2027, "Martedì grasso"), "2027-02-09");
  assert.equal(dateOf(2027, "Mercoledì delle Ceneri"), "2027-02-10");
  assert.equal(dateOf(2027, "Domenica delle Palme"), "2027-03-21");
  assert.equal(dateOf(2027, "Festa della mamma"), "2027-05-09");
  assert.equal(dateOf(2027, "Inizia l'ora legale (lancette avanti di un'ora)"), "2027-03-28");
  assert.equal(dateOf(2027, "Torna l'ora solare (lancette indietro di un'ora)"), "2027-10-31");
  assert.deepEqual(italianHolidays(2027).filter((item) => item.date === "2027-03-28").map((item) => item.kind), ["national", "clock"]);
  assert.equal(dateOf(2025, "Festa della mamma"), "2025-05-11");
  assert.equal(dateOf(2024, "Inizia l'ora legale (lancette avanti di un'ora)"), "2024-03-31");
  assert.equal(dateOf(2024, "Torna l'ora solare (lancette indietro di un'ora)"), "2024-10-27");
});

test("San Francesco d'Assisi è festa nazionale dal 2026 (L. 151/2025); prima è una ricorrenza", () => {
  assert.deepEqual(find(2026, "San Francesco d'Assisi").map((item) => item.kind), ["national"]);
  assert.deepEqual(find(2030, "San Francesco d'Assisi").map((item) => item.kind), ["national"]);
  assert.deepEqual(find(2025, "San Francesco d'Assisi").map((item) => item.kind), ["celebration"]);
  assert.equal(italianHolidays(2025).filter((item) => item.kind === "national").length, 12);
});

test("holidaysInRange: inizio compreso, fine esclusa, anche a cavallo d'anno e con Date locali", () => {
  assert.deepEqual(
    holidaysInRange("2026-12-20", "2027-01-07").map((item) => item.date),
    ["2026-12-24", "2026-12-25", "2026-12-26", "2026-12-31", "2027-01-01", "2027-01-06"]
  );
  assert.deepEqual(holidaysInRange("2026-12-25", "2026-12-26").map((item) => item.name), ["Natale"]);
  assert.deepEqual(holidaysInRange("2026-12-26", "2026-12-25"), []);
  const previous = process.env.TZ;
  try {
    for (const zone of ["Europe/Rome", "UTC", "America/New_York"]) {
      process.env.TZ = zone;
      assert.deepEqual(holidaysInRange(new Date(2026, 3, 1), new Date(2026, 3, 8)).map((item) => item.date), ["2026-04-05", "2026-04-06"], zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  assert.deepEqual(holidaysInRange("non-una-data", "2026-12-31"), []);
  assert.equal(holidaysInRange("2020-01-01", "2120-01-01").length > 0, true);
});
