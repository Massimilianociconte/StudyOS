// Fusi nei file .ics: nomi Windows (Outlook) e VTIMEZONE generati dalle regole di Intl.
// Il VTIMEZONE scritto si rilegge con lo stesso lettore usato per i file degli altri e deve dare,
// istante per istante, lo stesso scarto di Intl (anche negli anni in cui le regole sono cambiate).
import test from "node:test";
import assert from "node:assert/strict";
import { WINDOWS_ZONES, buildVTimezone, vtimezoneOffsets } from "../src/lib/ics.ts";
import { isValidTimeZone, timeZoneOffset } from "../src/lib/tz.ts";

test("ogni nome Windows porta a un fuso IANA valido su questo dispositivo", () => {
  const entries = Object.entries(WINDOWS_ZONES);
  assert.ok(entries.length >= 120, `${entries.length}`);
  for (const [windows, iana] of entries) assert.ok(isValidTimeZone(iana), `${windows} -> ${iana}`);
  assert.equal(WINDOWS_ZONES["W. Europe Standard Time"], "Europe/Berlin");
  assert.equal(WINDOWS_ZONES["Eastern Standard Time"], "America/New_York");
  assert.equal(WINDOWS_ZONES["Tokyo Standard Time"], "Asia/Tokyo");
});

const ZONES = [
  ["Europe/Rome", 2025, 2028],
  // Regole cambiate nel 2007: due gruppi di anni, il primo con UNTIL.
  ["America/New_York", 2005, 2009],
  // Emisfero sud: l'ora legale scavalca l'anno.
  ["Australia/Sydney", 2025, 2027],
  // Mezz'ora di differenza.
  ["Australia/Lord_Howe", 2025, 2027],
  // Nessun cambio d'ora.
  ["Asia/Tokyo", 2026, 2027],
  // Ora legale abolita nel 2019.
  ["America/Sao_Paulo", 2017, 2021],
  ["Europe/London", 2026, 2027]
];

test("VTIMEZONE generato = scarti di Intl, prima e dopo ogni cambio d'ora", () => {
  for (const [zone, from, to] of ZONES) {
    const lines = buildVTimezone(zone, from, to);
    assert.equal(lines[0], "BEGIN:VTIMEZONE", zone);
    assert.ok(lines.includes(`TZID:${zone}`), zone);
    assert.equal(lines.at(-1), "END:VTIMEZONE", zone);
    const offsetAt = vtimezoneOffsets(lines);
    const start = Date.UTC(from, 0, 2);
    const end = Date.UTC(to, 11, 30);
    let previous = timeZoneOffset(start, zone);
    for (let t = start; t < end; t += 6 * 3_600_000 + 17 * 60_000) {
      const expected = timeZoneOffset(t, zone);
      assert.equal(offsetAt(t), expected, `${zone} ${new Date(t).toISOString()}`);
      if (expected !== previous) {
        // Cerca il cambio esatto e controlla un secondo prima e un secondo dopo.
        let lo = t - 6 * 3_600_000 - 17 * 60_000;
        let hi = t;
        while (hi - lo > 1000) {
          const mid = Math.floor((lo + hi) / 2000) * 1000;
          if (timeZoneOffset(mid, zone) === expected) hi = mid;
          else lo = mid;
        }
        assert.equal(offsetAt(hi), expected, `${zone} cambio ${new Date(hi).toISOString()}`);
        assert.equal(offsetAt(hi - 1000), previous, `${zone} prima del cambio ${new Date(hi).toISOString()}`);
      }
      previous = expected;
    }
  }
});

test("VTIMEZONE: regole annuali per gli anni uguali, UNTIL quando cambiano, nessun cambio = un solo STANDARD", () => {
  const rome = buildVTimezone("Europe/Rome", 2025, 2028);
  assert.equal(rome.filter((line) => line.startsWith("RRULE:")).length, 2);
  assert.ok(rome.includes("TZOFFSETFROM:+0100") && rome.includes("TZOFFSETTO:+0200"));
  const ny = buildVTimezone("America/New_York", 2005, 2009);
  assert.ok(ny.some((line) => /^RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU;UNTIL=2006\d{4}T\d{6}Z$/.test(line)), ny.join("\n"));
  assert.ok(ny.includes("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU"));
  const tokyo = buildVTimezone("Asia/Tokyo", 2026, 2027);
  assert.deepEqual(tokyo.filter((line) => line.startsWith("BEGIN:") && line !== "BEGIN:VTIMEZONE"), ["BEGIN:STANDARD"]);
  assert.ok(tokyo.includes("TZOFFSETTO:+0900"));
});
