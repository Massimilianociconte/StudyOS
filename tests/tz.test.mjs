import test from "node:test";
import assert from "node:assert/strict";
import {
  civilAddDays,
  civilAddMonths,
  civilDateOf,
  civilDaysBetween,
  civilWeekday,
  daysInMonth,
  deviceTimeZone,
  isCivilDate,
  isValidTimeZone,
  localMidnight,
  utcToZonedParts,
  zonedToUtc
} from "../src/lib/tz.ts";

// Ogni controllo gira con il fuso del dispositivo a Roma, in UTC e a New York: il risultato con un
// fuso esplicito non deve cambiare.
const DEVICE_ZONES = ["Europe/Rome", "UTC", "America/New_York"];
const eachDeviceZone = (run) => {
  const previous = process.env.TZ;
  try {
    for (const zone of DEVICE_ZONES) {
      process.env.TZ = zone;
      run(zone);
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
};

test("zonedToUtc: ora da orologio a Roma -> istante, in qualsiasi fuso del dispositivo", () => {
  eachDeviceZone(() => {
    assert.equal(zonedToUtc([2026, 10, 19, 10, 0, 0], "Europe/Rome").toISOString(), "2026-10-19T08:00:00.000Z");
    assert.equal(zonedToUtc([2026, 10, 26, 10, 0, 0], "Europe/Rome").toISOString(), "2026-10-26T09:00:00.000Z");
    assert.equal(zonedToUtc({ year: 2026, month: 11, day: 1, hour: 10, minute: 0 }, "America/New_York").toISOString(), "2026-11-01T15:00:00.000Z");
    assert.equal(zonedToUtc([2026, 7, 1, 12, 30, 15, 250], "UTC").toISOString(), "2026-07-01T12:30:15.250Z");
  });
});

test("zonedToUtc: buco del cambio d'ora (02:30 -> 03:30) e ora ripetuta (prima delle due)", () => {
  eachDeviceZone(() => {
    // 29/3/2026: a Roma le 02:00 diventano 03:00, le 02:30 non esistono.
    const gap = zonedToUtc([2026, 3, 29, 2, 30, 0], "Europe/Rome");
    assert.equal(gap.toISOString(), "2026-03-29T01:30:00.000Z");
    assert.deepEqual([utcToZonedParts(gap, "Europe/Rome").hour, utcToZonedParts(gap, "Europe/Rome").minute], [3, 30]);
    // 25/10/2026: le 02:30 capitano due volte (00:30Z in CEST e 01:30Z in CET): si usa la prima.
    assert.equal(zonedToUtc([2026, 10, 25, 2, 30, 0], "Europe/Rome").toISOString(), "2026-10-25T00:30:00.000Z");
    // New York: 8/3/2026 buco 02:00-03:00, 1/11/2026 ora ripetuta 01:00-02:00.
    assert.equal(zonedToUtc([2026, 3, 8, 2, 30, 0], "America/New_York").toISOString(), "2026-03-08T07:30:00.000Z");
    assert.equal(zonedToUtc([2026, 11, 1, 1, 30, 0], "America/New_York").toISOString(), "2026-11-01T05:30:00.000Z");
  });
});

test("zonedToUtc senza fuso: ora locale del dispositivo, come new Date(y, m, d, h, min)", () => {
  eachDeviceZone(() => {
    assert.equal(zonedToUtc([2026, 10, 19, 10, 0, 0]).getTime(), new Date(2026, 9, 19, 10, 0, 0).getTime());
    assert.equal(zonedToUtc([2026, 3, 29, 2, 30, 0]).getTime(), new Date(2026, 2, 29, 2, 30, 0).getTime());
  });
});

test("zonedToUtc: fuso non valido -> RangeError (ics.ts lo intercetta)", () => {
  assert.throws(() => zonedToUtc([2026, 1, 1, 10, 0, 0], "W. Europe Standard Time"), RangeError);
  assert.equal(isValidTimeZone("Europe/Rome"), true);
  assert.equal(isValidTimeZone("W. Europe Standard Time"), false);
  assert.equal(isValidTimeZone(""), false);
  assert.equal(isValidTimeZone(42), false);
});

test("utcToZonedParts: parti dell'ora nel fuso, con giorno della settimana", () => {
  eachDeviceZone(() => {
    const parts = utcToZonedParts(new Date("2026-10-25T00:30:00.000Z"), "Europe/Rome");
    assert.deepEqual(parts, { year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0, millisecond: 0, weekday: 0 });
    const ny = utcToZonedParts(Date.parse("2026-01-01T03:00:00.000Z"), "America/New_York");
    assert.deepEqual([ny.year, ny.month, ny.day, ny.hour, ny.weekday], [2025, 12, 31, 22, 3]);
    assert.equal(civilDateOf(new Date("2026-11-11T23:30:00.000Z"), "Europe/Rome"), "2026-11-12");
    assert.equal(civilDateOf(new Date("2026-11-11T23:30:00.000Z"), "America/New_York"), "2026-11-11");
  });
});

test("utcToZonedParts senza fuso: getter locali del dispositivo", () => {
  eachDeviceZone(() => {
    const date = new Date(2026, 9, 25, 2, 30, 0, 125);
    const parts = utcToZonedParts(date);
    assert.deepEqual(parts, { year: 2026, month: 10, day: 25, hour: 2, minute: 30, second: 0, millisecond: 125, weekday: 0 });
    assert.equal(localMidnight("2026-10-25").getTime(), new Date(2026, 9, 25).getTime());
    assert.equal(deviceTimeZone(), process.env.TZ === "UTC" ? "UTC" : process.env.TZ);
  });
});

test("date civili: giorni, mesi (con giorno troncato), giorno della settimana, differenze", () => {
  assert.equal(civilAddDays("2026-10-24", 1), "2026-10-25");
  assert.equal(civilAddDays("2026-10-25", 1), "2026-10-26");
  assert.equal(civilAddDays("2026-12-31", 1), "2027-01-01");
  assert.equal(civilAddDays("2028-03-01", -1), "2028-02-29");
  assert.equal(civilAddMonths("2027-01-31", 1), "2027-02-28");
  assert.equal(civilAddMonths("2028-01-31", 1), "2028-02-29");
  assert.equal(civilAddMonths("2026-11-30", 3), "2027-02-28");
  assert.equal(civilAddMonths("2026-05-15", -6), "2025-11-15");
  assert.equal(civilWeekday("2026-11-02"), 1);
  assert.equal(civilWeekday("2026-11-08"), 0);
  assert.equal(civilDaysBetween("2026-10-19", "2026-10-26"), 7);
  assert.equal(civilDaysBetween("2026-03-29", "2026-03-28"), -1);
  assert.equal(daysInMonth(2027, 2), 28);
  assert.equal(daysInMonth(2028, 2), 29);
  assert.equal(daysInMonth(2026, 4), 30);
  assert.equal(isCivilDate("2026-02-29"), false);
  assert.equal(isCivilDate("2028-02-29"), true);
  assert.equal(isCivilDate("2026-13-01"), false);
  assert.equal(isCivilDate("2026-1-01"), false);
  assert.equal(isCivilDate(20261101), false);
});

test("scarti in cache: stesse parti di Intl e stesso istante anche nei giorni del cambio d'ora, nei fusi strani e nel passato", () => {
  const reference = (ms, zone) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(ms));
    const get = (type) => Number(parts.find((part) => part.type === type).value);
    return [get("year"), get("month"), get("day"), get("hour") % 24, get("minute"), get("second")];
  };
  const cases = [
    ["Europe/Rome", "2026-03-27T00:00:00Z"],
    ["Europe/Rome", "2026-10-23T00:00:00Z"],
    ["America/New_York", "2026-03-06T00:00:00Z"],
    ["Australia/Lord_Howe", "2026-04-03T00:00:00Z"],
    ["Asia/Kathmandu", "2026-01-01T00:00:00Z"],
    ["Pacific/Apia", "2011-12-28T00:00:00Z"],
    ["America/Sao_Paulo", "2018-11-02T00:00:00Z"],
    ["Europe/Rome", "1893-10-30T00:00:00Z"]
  ];
  for (const [zone, start] of cases) {
    const from = Date.parse(start);
    for (let ms = from; ms < from + 5 * 86_400_000; ms += 17 * 60_000) {
      const parts = utcToZonedParts(ms, zone);
      const wall = [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second];
      assert.deepEqual(wall, reference(ms, zone), `${zone} ${new Date(ms).toISOString()}`);
      // Da orologio a istante: si torna allo stesso orologio (la prima volta, se l'ora si ripete).
      const back = zonedToUtc([...wall, 0], zone).getTime();
      assert.deepEqual(reference(back, zone), wall, `${zone} ritorno ${new Date(ms).toISOString()}`);
      assert.ok(back <= ms - (ms % 1000), `${zone} prima delle due ${new Date(ms).toISOString()}`);
    }
  }
});
