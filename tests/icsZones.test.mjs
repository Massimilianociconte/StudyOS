// Fusi nei file .ics: nomi Windows (Outlook) e VTIMEZONE generati dalle regole di Intl.
// Il VTIMEZONE scritto si rilegge con lo stesso lettore usato per i file degli altri e deve dare,
// istante per istante, lo stesso scarto di Intl (anche negli anni in cui le regole sono cambiate).
import test from "node:test";
import assert from "node:assert/strict";
import { WINDOWS_ZONES, buildIcs, buildVTimezone, vtimezoneOffsets } from "../src/lib/ics.ts";
import { applyRepeatFields } from "../src/lib/repeat.ts";
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

// ------------------------------------------------------------------------------------------
// Fusi con regole che non sono «n-esimo giorno della settimana» (ricontrollo di rilascio, punto 4)
// ------------------------------------------------------------------------------------------

/** Ogni scarto letto dal VTIMEZONE è quello di Intl: a passi irregolari e attorno a ogni cambio, al secondo. */
const sameAsIntl = (zone, offsetAt, fromYear, toYear) => {
  const start = Date.UTC(fromYear, 0, 2);
  const end = Date.UTC(toYear, 11, 30);
  let previous = timeZoneOffset(start, zone);
  for (let t = start; t < end; t += 6 * 3_600_000 + 17 * 60_000) {
    const expected = timeZoneOffset(t, zone);
    assert.equal(offsetAt(t), expected, `${zone} ${new Date(t).toISOString()}`);
    if (expected !== previous) {
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
};

const ODD_ZONES = ["Asia/Jerusalem", "America/Santiago", "Africa/Cairo", "America/Nuuk", "Asia/Gaza", "Africa/Casablanca"];
const PLAIN_ZONES = ["Europe/Rome", "America/New_York", "Australia/Sydney", "Pacific/Auckland", "Asia/Beirut", "Europe/Chisinau", "Asia/Tokyo"];

test("VTIMEZONE esatto in ogni anno coperto, anche per i fusi che non seguono un n-esimo giorno (Gerusalemme, Santiago, Il Cairo…)", () => {
  for (const zone of [...ODD_ZONES, ...PLAIN_ZONES]) sameAsIntl(zone, vtimezoneOffsets(buildVTimezone(zone, 2025, 2027, 2046)), 2025, 2046);
});

test("Gerusalemme: le regole annuali sbaglierebbero il 2028 (31 marzo invece del 24), quindi date esplicite per anno", () => {
  const lines = buildVTimezone("Asia/Jerusalem", 2025, 2027, 2046);
  assert.equal(lines.filter((line) => line.startsWith("RRULE:")).length, 0, lines.join("\n"));
  assert.ok(lines.some((line) => line.startsWith("RDATE:") && line.includes("20280324T020000")), lines.join("\n"));
  assert.ok(!lines.some((line) => line.includes("20280331T")), lines.join("\n"));
  const offsetAt = vtimezoneOffsets(lines);
  assert.equal(offsetAt(Date.UTC(2028, 2, 26, 12)), 3 * 3_600_000);
  // Con i soli anni in cui le regole valgono, il VTIMEZONE resta quello di sempre.
  assert.deepEqual(buildVTimezone("Asia/Jerusalem", 2025, 2027), buildVTimezone("Asia/Jerusalem", 2025, 2027, 2027));
  assert.ok(buildVTimezone("Asia/Jerusalem", 2025, 2027).includes("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1FR"));
});

test("Roma, New York e gli altri fusi regolari: VTIMEZONE uguale a prima anche controllando vent'anni", () => {
  for (const zone of PLAIN_ZONES) assert.deepEqual(buildVTimezone(zone, 2025, 2027, 2046), buildVTimezone(zone, 2025, 2027), zone);
  const rome = buildVTimezone("Europe/Rome", 2025, 2027, 2046);
  assert.ok(rome.includes("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU"));
  assert.ok(rome.includes("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU"));
  assert.ok(!rome.some((line) => line.startsWith("RDATE")));
});

test("export: una serie senza fine controlla i suoi anni futuri; il file è giusto fino a vent'anni dopo", () => {
  const T0 = "2026-10-01T10:00:00.000Z";
  const zones = [...ODD_ZONES, "Europe/Rome", "America/New_York"];
  const events = zones.map((zone, index) =>
    applyRepeatFields(
      { id: `z${index}`, createdAt: T0, updatedAt: T0, archived: false, tags: [], title: zone, description: "", category: "lesson", color: "#7CF7C8", priority: "medium", recurrence: "none", status: "planned", checklist: [], attachmentIds: [], notes: "", links: [], timeZone: zone, start: "2026-11-16T10:00:00.000Z", end: "2026-11-16T11:00:00.000Z", repeat: { freq: "weekly" } },
      { repeatChanged: true }
    )
  );
  const text = buildIcs({ events, exams: [], tasks: [], subjects: [], now: new Date("2026-11-11T09:00:00Z"), timeZone: "Europe/Rome" });
  const blocks = text
    .replace(/\r\n[ \t]/g, "")
    .split("BEGIN:VTIMEZONE")
    .slice(1)
    .map((block) => `BEGIN:VTIMEZONE${block.split("END:VTIMEZONE")[0]}END:VTIMEZONE`);
  for (const zone of zones) sameAsIntl(zone, vtimezoneOffsets(blocks.find((block) => block.includes(`TZID:${zone}\r\n`))), 2026, 2045);
  // Con una fine, si controllano solo gli anni fino a lì: il 2026–2027 di Gerusalemme segue le regole annuali.
  const ending = events.map((event) => applyRepeatFields({ ...event, repeat: { freq: "weekly", end: { type: "until", date: "2027-06-30" } } }, { repeatChanged: true }));
  const short = buildIcs({ events: ending, exams: [], tasks: [], subjects: [], now: new Date("2026-11-11T09:00:00Z"), timeZone: "Europe/Rome" });
  const jerusalem = short.split("BEGIN:VTIMEZONE").find((block) => block.includes("TZID:Asia/Jerusalem\r\n"));
  assert.ok(jerusalem.includes("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1FR"), jerusalem);
});
