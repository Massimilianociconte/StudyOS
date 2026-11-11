// RRULE <-> regola `repeat` (RFC 5545): tabella di corrispondenza e round trip (recurrence.md §7.2 caso 11).
// Ogni test passa un fuso esplicito: il risultato non dipende dal fuso del dispositivo.
import test from "node:test";
import assert from "node:assert/strict";
import { fromRRule, toRRule } from "../src/lib/ics.ts";

const ROME_9 = { startDate: "2026-11-02", allDay: false, zone: "Europe/Rome", wall: [9, 0, 0] }; // lunedì
const ALL_DAY = (startDate) => ({ startDate, allDay: true, zone: "Europe/Rome" });

test("RRULE -> repeat: settimanale ogni 2 settimane lun, mer, ven fino al 18 dicembre (fine del giorno a Roma)", () => {
  const { rule, unsupported } = fromRRule("FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;UNTIL=20261218T225959Z", ROME_9);
  assert.deepEqual(unsupported, []);
  assert.deepEqual(rule, { freq: "weekly", interval: 2, byWeekday: ["MO", "WE", "FR"], end: { type: "until", date: "2026-12-18" } });
  assert.equal(toRRule(rule, ROME_9), "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;UNTIL=20261218T225959Z");
});

test("RRULE -> repeat: UNTIL prima dell'ora dell'evento esclude quel giorno (resta compreso solo se l'occorrenza inizia entro UNTIL)", () => {
  // 18/12 alle 08:00Z = 09:00 Roma: compreso. 18/12 alle 07:59Z: l'occorrenza delle 9 è dopo, quindi fino al 17.
  assert.deepEqual(fromRRule("FREQ=DAILY;UNTIL=20261218T080000Z", ROME_9).rule.end, { type: "until", date: "2026-12-18" });
  assert.deepEqual(fromRRule("FREQ=DAILY;UNTIL=20261218T075900Z", ROME_9).rule.end, { type: "until", date: "2026-12-17" });
  // UNTIL come data (alcuni programmi la usano anche per gli eventi con orario): giorno compreso.
  assert.deepEqual(fromRRule("FREQ=DAILY;UNTIL=20261218", ROME_9).rule.end, { type: "until", date: "2026-12-18" });
});

test("caso 8: UNTIL compreso nel fuso dell'evento; tutto il giorno = data, con orario = fine del giorno locale in UTC", () => {
  const until = { freq: "weekly", end: { type: "until", date: "2026-12-14" } };
  assert.equal(toRRule(until, ALL_DAY("2026-11-02")), "FREQ=WEEKLY;UNTIL=20261214");
  assert.equal(toRRule(until, ROME_9), "FREQ=WEEKLY;UNTIL=20261214T225959Z");
  // In estate Roma è +2: fine del giorno alle 21:59:59Z.
  assert.equal(toRRule({ freq: "daily", end: { type: "until", date: "2026-07-31" } }, ROME_9), "FREQ=DAILY;UNTIL=20260731T215959Z");
  assert.equal(toRRule(until, { startDate: "2026-11-02", allDay: false, zone: "America/New_York", wall: [9, 0, 0] }), "FREQ=WEEKLY;UNTIL=20261215T045959Z");
});

test("caso 11: round trip delle regole mensili, trimestrali, semestrali e annuali", () => {
  const cases = [
    ["FREQ=MONTHLY;BYDAY=1MO", { freq: "monthly", monthly: { by: "weekday", nth: 1, weekday: "MO" } }, ALL_DAY("2026-11-02")],
    ["FREQ=MONTHLY;BYDAY=-1FR", { freq: "monthly", monthly: { by: "weekday", nth: -1, weekday: "FR" } }, ALL_DAY("2026-11-27")],
    ["FREQ=MONTHLY;BYDAY=2TU", { freq: "monthly", monthly: { by: "weekday", nth: 2, weekday: "TU" } }, ALL_DAY("2026-11-10")],
    ["FREQ=MONTHLY;INTERVAL=3", { freq: "monthly", interval: 3 }, ALL_DAY("2026-11-12")],
    ["FREQ=MONTHLY;INTERVAL=6", { freq: "monthly", interval: 6 }, ALL_DAY("2026-11-12")],
    ["FREQ=YEARLY;COUNT=5", { freq: "yearly", end: { type: "count", count: 5 } }, ALL_DAY("2026-11-12")],
    ["FREQ=MONTHLY;BYMONTHDAY=-1", { freq: "monthly", monthly: { by: "lastDay" } }, ALL_DAY("2026-01-31")],
    ["FREQ=DAILY;INTERVAL=3;COUNT=10", { freq: "daily", interval: 3, end: { type: "count", count: 10 } }, ROME_9],
    ["FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;WKST=SU", { freq: "weekly", interval: 2, byWeekday: ["MO", "WE"], wkst: "SU" }, ROME_9]
  ];
  for (const [rrule, expected, ctx] of cases) {
    const { rule, unsupported } = fromRRule(rrule, ctx);
    assert.deepEqual(unsupported, [], rrule);
    assert.deepEqual(rule, expected, rrule);
    assert.equal(toRRule(rule, ctx), rrule, rrule);
  }
});

test("mensile vecchia (giorno o l'ultimo del mese): BYMONTHDAY=28..D;BYSETPOS=-1 e ritorno", () => {
  const clamp = { freq: "monthly", monthly: { by: "clampDay" } };
  assert.equal(toRRule(clamp, ALL_DAY("2026-01-31")), "FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1");
  assert.equal(toRRule(clamp, ALL_DAY("2026-01-30")), "FREQ=MONTHLY;BYMONTHDAY=28,29,30;BYSETPOS=-1");
  assert.equal(toRRule(clamp, ALL_DAY("2026-01-29")), "FREQ=MONTHLY;BYMONTHDAY=28,29;BYSETPOS=-1");
  // Fino al 28 ogni mese ha quel giorno: basta la regola semplice.
  assert.equal(toRRule(clamp, ALL_DAY("2026-01-12")), "FREQ=MONTHLY");
  assert.deepEqual(fromRRule("FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1", ALL_DAY("2026-01-31")), { rule: clamp, unsupported: [] });
});

test("ricorrenza del 29 febbraio: 28 febbraio, 1° marzo o solo negli anni bisestili", () => {
  const leap = ALL_DAY("2000-02-29");
  assert.equal(toRRule({ freq: "yearly" }, leap), "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1");
  assert.equal(toRRule({ freq: "yearly", yearlyLeap: "feb28" }, leap), "FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1");
  assert.equal(toRRule({ freq: "yearly", yearlyLeap: "mar1" }, leap), "FREQ=YEARLY;BYYEARDAY=60");
  assert.equal(toRRule({ freq: "yearly", yearlyLeap: "skip" }, leap), "FREQ=YEARLY");
  assert.deepEqual(fromRRule("FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=-1", leap).rule, { freq: "yearly", yearlyLeap: "feb28" });
  assert.deepEqual(fromRRule("FREQ=YEARLY;BYYEARDAY=60", leap).rule, { freq: "yearly", yearlyLeap: "mar1" });
  assert.deepEqual(fromRRule("FREQ=YEARLY", leap).rule, { freq: "yearly", yearlyLeap: "skip" });
  // Un giorno qualsiasi: BYMONTH/BYMONTHDAY uguali all'inizio sono solo ridondanti.
  assert.deepEqual(fromRRule("FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=12", ALL_DAY("2026-11-12")), { rule: { freq: "yearly" }, unsupported: [] });
});

test("giorni feriali scritti come DAILY;BYDAY diventano una sola serie settimanale", () => {
  assert.deepEqual(fromRRule("FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR", ROME_9), {
    rule: { freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"] },
    unsupported: []
  });
  // BYDAY con BYSETPOS su un solo giorno = "primo / ultimo lunedì".
  assert.deepEqual(fromRRule("FREQ=MONTHLY;BYDAY=MO;BYSETPOS=1", ALL_DAY("2026-11-02")).rule, { freq: "monthly", monthly: { by: "weekday", nth: 1, weekday: "MO" } });
});

test("parti non gestite: si tengono in sourceRRule e si elencano (BYSETPOS, BYHOUR)", () => {
  const setpos = fromRRule("FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=2", ALL_DAY("2026-11-03"));
  assert.deepEqual(setpos.unsupported, ["BYDAY=MO,TU,WE,TH,FR", "BYSETPOS=2"]);
  assert.equal(setpos.rule.freq, "monthly");
  assert.equal(setpos.rule.sourceRRule, "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=2");

  const hours = fromRRule("FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,14;UNTIL=20261218T225959Z", ROME_9);
  assert.deepEqual(hours.unsupported, ["BYHOUR=9,14"]);
  assert.deepEqual(hours.rule, {
    freq: "weekly",
    byWeekday: ["MO"],
    end: { type: "until", date: "2026-12-18" },
    sourceRRule: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,14;UNTIL=20261218T225959Z"
  });
  // Più di 999 volte: si tiene il massimo e si segnala.
  const many = fromRRule("FREQ=DAILY;COUNT=5000", ROME_9);
  assert.deepEqual(many.rule.end, { type: "count", count: 999 });
  assert.deepEqual(many.unsupported, ["COUNT=5000"]);
});

test("regole impossibili da approssimare: nessuna ripetizione, solo la prima data", () => {
  assert.deepEqual(fromRRule("FREQ=HOURLY;INTERVAL=2", ROME_9), { rule: null, unsupported: ["FREQ=HOURLY"] });
  assert.deepEqual(fromRRule("FREQ=DAILY;INTERVAL=150", ROME_9), { rule: null, unsupported: ["INTERVAL=150"] });
  assert.deepEqual(fromRRule("", ROME_9), { rule: null, unsupported: [] });
});

test("le regole importate sono valide per il motore (validateRepeat) anche con dati strani", async () => {
  const { validateRepeat } = await import("../src/lib/repeat.ts");
  for (const value of [
    "FREQ=WEEKLY;BYDAY=XX,MO",
    "FREQ=MONTHLY;BYDAY=5MO",
    "FREQ=MONTHLY;BYDAY=-2FR",
    "FREQ=YEARLY;BYMONTH=1,7",
    "FREQ=WEEKLY;COUNT=0",
    "FREQ=WEEKLY;UNTIL=garbage",
    "FREQ=MONTHLY;BYMONTHDAY=15",
    "freq=weekly;byday=mo,we"
  ]) {
    const { rule } = fromRRule(value, ALL_DAY("2026-11-02"));
    if (rule) assert.equal(validateRepeat(rule).ok, true, value);
  }
  assert.deepEqual(fromRRule("freq=weekly;byday=mo,we", ALL_DAY("2026-11-02")).rule, { freq: "weekly", byWeekday: ["MO", "WE"] });
});
