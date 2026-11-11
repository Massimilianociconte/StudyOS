import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { addDays, addMonths, differenceInCalendarDays, parseISO } from "date-fns";
import { expandEvents } from "../src/lib/recurrence.ts";
import {
  MAX_OCCURRENCES,
  ageOn,
  applyEditPlan,
  applyRepeatFields,
  countBefore,
  describeReminder,
  describeRule,
  expandEvents as expandWithRules,
  expandRule,
  legacyProjection,
  nextOccurrence,
  normalizeRepeat,
  occurrenceId,
  planDelete,
  planEdit,
  planSplit,
  reminderInstants,
  repeatLegacyKey,
  searchHits,
  validateRepeat
} from "../src/lib/repeat.ts";
import { civilAddDays, civilDateOf, localMidnight } from "../src/lib/tz.ts";
import { nextOccurrences, todayEvents, upcomingEvents } from "../src/lib/selectors.ts";
import { sharedItemsView } from "../src/agent/shared.ts";
import { CALENDAR_EVENT_FIELD_GROUPS, changedFields, sharedEditResult } from "../src/lib/sharing.ts";

// Ogni test che dipende dal fuso del dispositivo lo imposta da sé e poi lo rimette com'era.
const withTz = (zone, run) => {
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
};

const base = (patch) => ({
  id: "e1",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  archived: false,
  tags: [],
  title: "Lezione",
  description: "",
  category: "lesson",
  color: "#7CF7C8",
  priority: "medium",
  start: "2026-09-28T07:00:00.000Z",
  end: "2026-09-28T09:00:00.000Z",
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});

// ---------------------------------------------------------------------------------------
// Test 13: gli eventi già salvati (senza `timeZone` né `repeat`) si espandono esattamente come
// prima. Copia congelata di `expandEvents` com'era prima del nuovo motore, più le impronte
// dell'uscita del modulo originale, prese prima di cambiarlo (Roma e New York).
// ---------------------------------------------------------------------------------------

const legacyExpand = (events, from, to) => {
  const result = [];
  const fromMs = from.getTime();
  const toMs = to.getTime();
  const valid = (date) => !Number.isNaN(date.getTime());
  const occurrence = (event, start, durationMs, recurring) => ({
    ...event,
    start: start.toISOString(),
    end: new Date(start.getTime() + durationMs).toISOString(),
    occurrenceKey: `${event.id}@${start.toISOString()}`,
    recurring
  });
  for (const event of events) {
    if (event.archived) continue;
    const baseStart = parseISO(event.start);
    const baseEnd = parseISO(event.end);
    if (!valid(baseStart)) continue;
    const durationMs = valid(baseEnd) && baseEnd > baseStart ? baseEnd.getTime() - baseStart.getTime() : 60 * 60_000;
    const recurrence = event.recurrence ?? "none";
    if (recurrence === "none") {
      if (baseStart.getTime() < toMs && baseStart.getTime() + durationMs > fromMs) result.push(occurrence(event, baseStart, durationMs, false));
      continue;
    }
    const until = event.recurrenceUntil ? parseISO(event.recurrenceUntil) : null;
    const untilMs = until && valid(until) ? until.getTime() + 24 * 60 * 60_000 - 1 : Number.POSITIVE_INFINITY;
    const limitMs = Math.min(toMs, untilMs + 1);
    let cursor = baseStart;
    if (recurrence === "daily" || recurrence === "weekly") {
      const step = recurrence === "daily" ? 1 : 7;
      const skip = Math.max(0, Math.floor(differenceInCalendarDays(from, baseStart) / step) - 1);
      cursor = addDays(baseStart, skip * step);
      for (let i = 0; i < 1000 && cursor.getTime() < limitMs; i += 1) {
        if (cursor.getTime() + durationMs > fromMs) result.push(occurrence(event, cursor, durationMs, true));
        cursor = addDays(cursor, step);
      }
    } else {
      for (let i = 0; i < 1000 && cursor.getTime() < limitMs; i += 1) {
        if (cursor.getTime() + durationMs > fromMs) result.push(occurrence(event, cursor, durationMs, true));
        cursor = addMonths(baseStart, i + 1);
      }
    }
  }
  return result.sort((a, b) => a.start.localeCompare(b.start));
};

// Dati come li salva l'app oggi: istanti UTC, tutto il giorno da mezzanotte locale, BARB fluttuante.
const LEGACY_FIXTURES = [
  base({ id: "single" }),
  base({ id: "weekly", recurrence: "weekly" }),
  base({ id: "weekly-until", recurrence: "weekly", recurrenceUntil: "2026-12-18" }),
  base({ id: "daily-1830", recurrence: "daily", start: "2026-10-20T16:30:00.000Z", end: "2026-10-20T18:00:00.000Z", recurrenceUntil: "2027-04-10" }),
  base({ id: "daily-2330", recurrence: "daily", start: "2026-10-20T21:30:00.000Z", end: "2026-10-20T22:15:00.000Z" }),
  base({ id: "daily-0030", recurrence: "daily", start: "2026-10-19T22:30:00.000Z", end: "2026-10-19T23:00:00.000Z", recurrenceUntil: "2027-11-30" }),
  base({ id: "monthly-31", recurrence: "monthly", start: "2027-01-31T09:00:00.000Z", end: "2027-01-31T10:00:00.000Z" }),
  base({ id: "monthly-29", recurrence: "monthly", start: "2026-01-29T16:00:00.000Z", end: "2026-01-29T17:30:00.000Z" }),
  base({ id: "monthly-30-until", recurrence: "monthly", start: "2026-11-30T08:00:00.000Z", end: "2026-11-30T09:00:00.000Z", recurrenceUntil: "2027-06-30" }),
  base({ id: "allday-weekly-25oct", allDay: true, recurrence: "weekly", start: "2026-10-24T22:00:00.000Z", end: "2026-10-25T23:00:00.000Z" }),
  base({ id: "allday-single", allDay: true, start: "2026-12-07T23:00:00.000Z", end: "2026-12-08T23:00:00.000Z" }),
  base({ id: "barb-floating", allDay: true, start: "2027-02-10T00:00:00", end: "2027-02-11T00:00:00", category: "exam" }),
  base({ id: "archived", archived: true, recurrence: "weekly" }),
  base({ id: "invalid", start: "non-una-data" }),
  base({ id: "end-before-start", recurrence: "weekly", start: "2026-10-01T15:00:00.000Z", end: "2026-10-01T14:00:00.000Z" }),
  (() => {
    const event = base({ id: "missing-recurrence" });
    delete event.recurrence;
    return event;
  })(),
  base({ id: "weekly-ny", recurrence: "weekly", start: "2026-09-29T14:00:00.000Z", end: "2026-09-29T15:30:00.000Z", recurrenceUntil: "2027-06-01" }),
  base({ id: "until-dst-day", recurrence: "daily", start: "2026-10-20T21:30:00.000Z", end: "2026-10-20T22:00:00.000Z", recurrenceUntil: "2026-10-25" }),
  base({ id: "until-spring-day", recurrence: "daily", start: "2027-03-19T23:30:00.000Z", end: "2027-03-20T00:00:00.000Z", recurrenceUntil: "2027-03-28" }),
  base({ id: "until-dst-ny", recurrence: "daily", start: "2026-10-25T03:30:00.000Z", end: "2026-10-25T04:00:00.000Z", recurrenceUntil: "2026-11-01" }),
  base({ id: "weekly-old", recurrence: "weekly", start: "2019-02-04T16:00:00.000Z", end: "2019-02-04T18:00:00.000Z" })
];

// Finestre come le chiede il calendario: mesi, settimane del cambio d'ora, un giorno, due anni.
const legacyWindows = () => {
  const windows = [];
  for (let month = 0; month < 24; month += 1) windows.push([new Date(2026, 8 + month, 1), new Date(2026, 9 + month, 1)]);
  for (const [y, m, d] of [[2026, 9, 19], [2026, 9, 26], [2027, 2, 22], [2027, 2, 29], [2027, 9, 25]]) {
    windows.push([new Date(y, m, d), new Date(y, m, d + 7)]);
  }
  windows.push([new Date(2026, 9, 25), new Date(2026, 9, 26)]);
  windows.push([new Date(2026, 8, 1), new Date(2028, 8, 1)]);
  return windows;
};

const fingerprint = (expand) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        legacyWindows().map(([from, to]) =>
          expand(LEGACY_FIXTURES, from, to).map((item) => [item.id, item.occurrenceKey, item.start, item.end, item.recurring])
        )
      )
    )
    .digest("hex");

// Impronte prese dal modulo originale (recurrence.ts @ 9017394) prima di qualsiasi modifica.
const LEGACY_FINGERPRINTS = {
  "Europe/Rome": "cf14443e2482310c57cba594f3c32a57f0fa5f9ea05055ab8418344a8c4b1b8b",
  "America/New_York": "d4341df159cd7d2876ed9d4b1f9729cd69e63fd3d690e93ae79c0c7546a559d7",
  UTC: "f2a065632104dd98bce40c66adc71db6c6d782654a378266b6fcc1519f0160bf"
};

test("13. eventi già salvati: stessa espansione di prima su due anni (Roma, New York, UTC)", () => {
  for (const [zone, expected] of Object.entries(LEGACY_FINGERPRINTS)) {
    withTz(zone, () => {
      assert.equal(fingerprint(legacyExpand), expected, `copia congelata, ${zone}`);
      for (const [from, to] of legacyWindows()) {
        const now = expandEvents(LEGACY_FIXTURES, from, to).map((item) => [item.id, item.occurrenceKey, item.start, item.end, item.recurring]);
        const before = legacyExpand(LEGACY_FIXTURES, from, to).map((item) => [item.id, item.occurrenceKey, item.start, item.end, item.recurring]);
        assert.deepEqual(now, before, `${zone} ${from.toISOString()}`);
      }
      assert.equal(fingerprint(expandEvents), expected, zone);
    });
  }
});

test("13. le occorrenze conservano i campi extra (es. sharedFrom) e hanno il giorno dell'occorrenza", () => {
  withTz("Europe/Rome", () => {
    const shared = { ...base({ id: "s", recurrence: "weekly" }), sharedFrom: { ownerId: "u1" } };
    const found = expandEvents([shared], new Date(2026, 9, 5), new Date(2026, 9, 12));
    assert.equal(found.length, 1);
    assert.deepEqual(found[0].sharedFrom, { ownerId: "u1" });
    assert.equal(found[0].occurrenceDate, "2026-10-05");
  });
});

test("13. alle 02:30 col cambio d'ora: gli eventi già salvati come prima, quelli con il fuso restano alle 02:30", () => {
  withTz("Europe/Rome", () => {
    const fields = { recurrence: "daily", start: new Date(2026, 2, 27, 2, 30).toISOString(), end: new Date(2026, 2, 27, 3, 0).toISOString() };
    const hoursOf = (event) => expandWithRules([event], new Date(2026, 2, 27), new Date(2026, 3, 1)).map((item) => new Date(item.start).getHours());
    // Senza fuso né regola nuova: esattamente come prima (2, 2, 3 nel buco, poi 3, 3: dipende dalla finestra).
    assert.deepEqual(hoursOf(base({ id: "night", ...fields })), [2, 2, 3, 3, 3]);
    // Con il fuso: solo il giorno del buco è alle 3.
    assert.deepEqual(hoursOf(ruled({ id: "night", ...fields, repeat: { freq: "daily" }, timeZone: "Europe/Rome" })), [2, 2, 3, 2, 2]);
  });
});

test("13. eventi già salvati, casi limite: 02:30 al cambio d'ora, tutto il giorno fluttuanti, 'fino al' con l'ora, serie mensili molto vecchie", () => {
  const fixtures = [
    base({ id: "night-rome", recurrence: "daily", start: "2026-03-27T01:30:00.000Z", end: "2026-03-27T02:00:00.000Z" }),
    base({ id: "night-ny", recurrence: "daily", start: "2026-03-05T07:30:00.000Z", end: "2026-03-05T08:00:00.000Z" }),
    base({ id: "night-weekly", recurrence: "weekly", start: "2026-03-15T01:30:00.000Z", end: "2026-03-15T03:00:00.000Z" }),
    base({ id: "float-2359", allDay: true, start: "2027-02-10T00:00:00", end: "2027-02-10T23:59:59" }),
    base({ id: "float-same", allDay: true, start: "2026-10-25T00:00:00", end: "2026-10-25T00:00:00" }),
    base({ id: "float-daily", allDay: true, recurrence: "daily", start: "2026-10-22T00:00:00", end: "2026-10-23T00:00:00" }),
    base({ id: "float-weekly", allDay: true, recurrence: "weekly", start: "2026-03-01T00:00:00", end: "2026-03-02T00:00:00" }),
    base({ id: "until-iso", recurrence: "daily", start: "2026-10-20T21:30:00.000Z", end: "2026-10-20T22:00:00.000Z", recurrenceUntil: "2026-10-26T18:00:00.000Z" }),
    base({ id: "monthly-1930", recurrence: "monthly", start: "1930-01-31T09:00:00.000Z", end: "1930-01-31T10:00:00.000Z" }),
    base({ id: "empty-recurrence", recurrence: "", start: "2026-10-31T09:00:00.000Z", end: "2026-10-31T10:00:00.000Z" })
  ];
  const windows = [
    ...legacyWindows(),
    [new Date(2026, 2, 1), new Date(2026, 3, 1)],
    [new Date(2026, 2, 27), new Date(2026, 3, 1)],
    [new Date(2026, 2, 30), new Date(2026, 3, 6)],
    [new Date(2026, 3, 5), new Date(2026, 3, 12)],
    [new Date(2026, 2, 8), new Date(2026, 2, 15)],
    [new Date(2026, 2, 1), new Date(2027, 2, 1)]
  ];
  const shape = (items) => items.map((item) => [item.id, item.occurrenceKey, item.start, item.end, item.recurring]);
  eachDeviceZone((zone) => {
    for (const [from, to] of windows) assert.deepEqual(shape(expandEvents(fixtures, from, to)), shape(legacyExpand(fixtures, from, to)), `${zone} ${from.toISOString()}`);
  });
});

test("13. differenza voluta: un evento ripetuto più lungo del passo si vede in ogni finestra in cui è in corso", () => {
  // Ogni giorno alle 08:00Z per 50 ore: il 10/11 alle 07:00Z sono in corso quelli dell'8 e del 9.
  const long = base({ id: "long", recurrence: "daily", start: "2026-11-02T08:00:00.000Z", end: "2026-11-04T10:00:00.000Z" });
  const window = [utc("2026-11-10T07:00:00Z"), utc("2026-11-10T07:30:00Z")];
  eachDeviceZone((zone) => {
    assert.deepEqual(iso(expandEvents([long], ...window)), ["2026-11-08T08:00:00.000Z", "2026-11-09T08:00:00.000Z"], zone);
    // Prima si saltava quello dell'8 (dipendeva da dove iniziava la finestra).
    assert.deepEqual(iso(legacyExpand([long], ...window)), ["2026-11-09T08:00:00.000Z"], zone);
  });
});

// ---------------------------------------------------------------------------------------
// Nuovo motore: casi 1–17 di docs/plans/2026-11-11-ux-audit/recurrence.md §7.2
// ---------------------------------------------------------------------------------------

const DEVICE_ZONES = ["Europe/Rome", "UTC", "America/New_York"];
const eachDeviceZone = (run) => {
  for (const zone of DEVICE_ZONES) withTz(zone, () => run(zone));
};

/** Evento con regola nuova, come lo salva l'app aggiornata (regola, impronta e proiezione). */
const ruled = (patch) => {
  const event = base({ recurrence: "none", ...patch });
  return applyRepeatFields(event, { repeatChanged: true, timeZone: patch.timeZone ?? "Europe/Rome" });
};

const iso = (items) => items.map((item) => item.start);
const utc = (value) => new Date(value);

test("1. settimanale alle 10 a Roma dal 19/10/2026: 08:00Z poi 09:00Z, uguale da Roma, UTC e New York", () => {
  const event = ruled({ id: "w", start: "2026-10-19T08:00:00.000Z", end: "2026-10-19T09:30:00.000Z", timeZone: "Europe/Rome", repeat: { freq: "weekly" } });
  eachDeviceZone((zone) => {
    const found = expandWithRules([event], utc("2026-10-18T00:00:00Z"), utc("2026-11-03T00:00:00Z"));
    assert.deepEqual(iso(found), ["2026-10-19T08:00:00.000Z", "2026-10-26T09:00:00.000Z", "2026-11-02T09:00:00.000Z"], zone);
    assert.deepEqual(found.map((item) => Date.parse(item.end) - Date.parse(item.start)), [90, 90, 90].map((min) => min * 60_000));
    assert.deepEqual(found.map((item) => item.occurrenceDate), ["2026-10-19", "2026-10-26", "2026-11-02"]);
    const rule = expandRule({ freq: "weekly" }, "2026-10-19T10:00", "Europe/Rome", utc("2026-10-18T00:00:00Z"), utc("2026-11-03T00:00:00Z"));
    assert.deepEqual(rule.map((item) => item.start.toISOString()), iso(found));
  });
});

test("2. buco e ora ripetuta: 02:30 del 29/3 -> 03:30 CEST; 02:30 del 25/10 -> 00:30Z (la prima)", () => {
  eachDeviceZone((zone) => {
    const spring = expandRule({ freq: "daily" }, "2026-03-28T02:30", "Europe/Rome", utc("2026-03-28T00:00:00Z"), utc("2026-03-31T00:00:00Z"));
    assert.deepEqual(spring.map((item) => item.start.toISOString()), ["2026-03-28T01:30:00.000Z", "2026-03-29T01:30:00.000Z", "2026-03-30T00:30:00.000Z"], zone);
    const autumn = expandRule({ freq: "daily" }, "2026-10-24T02:30", "Europe/Rome", utc("2026-10-24T00:00:00Z"), utc("2026-10-27T00:00:00Z"));
    assert.deepEqual(autumn.map((item) => item.start.toISOString()), ["2026-10-24T00:30:00.000Z", "2026-10-25T00:30:00.000Z", "2026-10-26T01:30:00.000Z"], zone);
  });
});

test("3. mensile dal 31 gennaio: day salta, lastDay usa l'ultimo, clampDay come oggi", () => {
  const from = utc("2027-01-01T00:00:00Z");
  const to = utc("2027-08-01T00:00:00Z");
  const run = (monthly) => expandRule({ freq: "monthly", monthly }, "2027-01-31T10:00", "Europe/Rome", from, to).map((item) => item.date);
  assert.deepEqual(run({ by: "day" }), ["2027-01-31", "2027-03-31", "2027-05-31", "2027-07-31"]);
  assert.deepEqual(run(undefined), ["2027-01-31", "2027-03-31", "2027-05-31", "2027-07-31"]);
  assert.deepEqual(run({ by: "lastDay" }).slice(0, 4), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30"]);
  assert.deepEqual(run({ by: "clampDay" }), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31", "2027-06-30", "2027-07-31"]);
  eachDeviceZone((zone) => {
    const legacy = base({ id: "m", recurrence: "monthly", start: new Date(2027, 0, 31, 10).toISOString(), end: new Date(2027, 0, 31, 11).toISOString() });
    const clamp = { ...legacy, repeat: { freq: "monthly", monthly: { by: "clampDay" } }, repeatLegacy: "monthly|" };
    assert.deepEqual(iso(expandWithRules([clamp], from, to)), iso(legacyExpand([legacy], from, to)), zone);
  });
});

test("4. nato il 29/2/2000: feb28 -> 28/2/2027 e 29/2/2028; skip solo bisestili; età 27", () => {
  const birthday = (yearlyLeap) =>
    ruled({
      id: `b-${yearlyLeap}`,
      title: "Compleanno di Anna",
      category: "personal",
      allDay: true,
      start: "2000-02-29T00:00:00",
      end: "2000-03-01T00:00:00",
      repeat: { freq: "yearly", ...(yearlyLeap ? { yearlyLeap } : {}) },
      occasion: { kind: "birthday", birthYear: 2000 }
    });
  eachDeviceZone((zone) => {
    const from = new Date(2027, 0, 1);
    const to = new Date(2030, 0, 1);
    const dates = (event) => expandWithRules([event], from, to).map((item) => [item.occurrenceDate, civilDateOf(new Date(item.start))]);
    assert.deepEqual(dates(birthday(undefined)), [["2027-02-28", "2027-02-28"], ["2028-02-29", "2028-02-29"], ["2029-02-28", "2029-02-28"]], zone);
    assert.deepEqual(dates(birthday("feb28")).map(([date]) => date), ["2027-02-28", "2028-02-29", "2029-02-28"]);
    assert.deepEqual(dates(birthday("mar1")).map(([date]) => date), ["2027-03-01", "2028-02-29", "2029-03-01"]);
    assert.deepEqual(dates(birthday("skip")).map(([date]) => date), ["2028-02-29"]);
  });
  assert.equal(ageOn(2000, "2027-02-28"), 27);
  assert.equal(ageOn(2000, "2000-02-29"), 0);
  assert.equal(ageOn(2030, "2027-02-28"), null);
  assert.equal(ageOn(undefined, "2027-02-28"), null);
});

test("5. n-esimo giorno della settimana: 1MO -> 2/11, 7/12, 4/1; -1FR -> 27/11, 25/12, 29/1", () => {
  const from = utc("2026-11-01T00:00:00Z");
  const to = utc("2027-02-01T00:00:00Z");
  const first = expandRule({ freq: "monthly", monthly: { by: "weekday", nth: 1, weekday: "MO" } }, "2026-11-02T09:00", "Europe/Rome", from, to);
  assert.deepEqual(first.map((item) => item.date), ["2026-11-02", "2026-12-07", "2027-01-04"]);
  const last = expandRule({ freq: "monthly", monthly: { by: "weekday", nth: -1, weekday: "FR" } }, "2026-11-27T09:00", "Europe/Rome", from, to);
  assert.deepEqual(last.map((item) => item.date), ["2026-11-27", "2026-12-25", "2027-01-29"]);
});

test("6. lun, mer, ven ogni 2 settimane dal 2/11 -> 2, 4, 6, 16, 18, 20; WKST con inizio di mercoledì", () => {
  const from = utc("2026-11-01T00:00:00Z");
  const to = utc("2026-11-23T00:00:00Z");
  const found = expandRule({ freq: "weekly", interval: 2, byWeekday: ["MO", "WE", "FR"] }, "2026-11-02T10:00", "Europe/Rome", from, to);
  assert.deepEqual(found.map((item) => item.date), ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-16", "2026-11-18", "2026-11-20"]);
  // Come l'esempio WKST di RFC 5545 §3.3.10, spostato su mercoledì 4/11/2026 (BYDAY=WE,SU;INTERVAL=2;COUNT=4).
  const wide = utc("2026-12-31T00:00:00Z");
  const monday = expandRule({ freq: "weekly", interval: 2, byWeekday: ["WE", "SU"], end: { type: "count", count: 4 } }, "2026-11-04T10:00", "Europe/Rome", from, wide);
  assert.deepEqual(monday.map((item) => item.date), ["2026-11-04", "2026-11-08", "2026-11-18", "2026-11-22"]);
  const sunday = expandRule({ freq: "weekly", interval: 2, byWeekday: ["WE", "SU"], wkst: "SU", end: { type: "count", count: 4 } }, "2026-11-04T10:00", "Europe/Rome", from, wide);
  assert.deepEqual(sunday.map((item) => item.date), ["2026-11-04", "2026-11-15", "2026-11-18", "2026-11-29"]);
});

test("7. COUNT: 6 volte lun, mer, ven finisce venerdì 13/11; un inizio di martedì conta come la prima", () => {
  const from = utc("2026-11-01T00:00:00Z");
  const to = utc("2026-12-31T00:00:00Z");
  const six = expandRule({ freq: "weekly", byWeekday: ["MO", "WE", "FR"], end: { type: "count", count: 6 } }, "2026-11-02T10:00", "Europe/Rome", from, to);
  assert.deepEqual(six.map((item) => item.date), ["2026-11-02", "2026-11-04", "2026-11-06", "2026-11-09", "2026-11-11", "2026-11-13"]);
  const tuesday = expandRule({ freq: "weekly", byWeekday: ["MO", "WE"], end: { type: "count", count: 3 } }, "2026-11-03T10:00", "Europe/Rome", from, to);
  assert.deepEqual(tuesday.map((item) => item.date), ["2026-11-03", "2026-11-04", "2026-11-09"]);
  // Il conteggio parte sempre dal primo giorno, anche se la finestra comincia dopo.
  const later = expandRule({ freq: "daily", end: { type: "count", count: 5 } }, "2026-11-02T10:00", "Europe/Rome", utc("2026-11-05T00:00:00Z"), to);
  assert.deepEqual(later.map((item) => item.date), ["2026-11-05", "2026-11-06"]);
});

test("8. 'fino al' è compreso, nel fuso dell'evento, da qualsiasi fuso del dispositivo", () => {
  const event = ruled({ id: "u", start: "2026-10-19T21:30:00.000Z", end: "2026-10-19T22:00:00.000Z", timeZone: "Europe/Rome", repeat: { freq: "weekly", end: { type: "until", date: "2026-11-02" } } });
  eachDeviceZone((zone) => {
    const found = expandWithRules([event], utc("2026-10-01T00:00:00Z"), utc("2026-12-01T00:00:00Z"));
    assert.deepEqual(found.map((item) => item.occurrenceDate), ["2026-10-19", "2026-10-26", "2026-11-02"], zone);
    assert.equal(found.at(-1).start, "2026-11-02T22:30:00.000Z");
  });
});

test("9. occorrenze modificate e cancellate: nascoste, spostate (anche fuori finestra o dopo la fine), orfane, uguali", () => {
  const series = ruled({ id: "s", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", timeZone: "Europe/Rome", repeat: { freq: "weekly", end: { type: "until", date: "2026-11-16" } } });
  const cancelled = { ...base({ id: occurrenceId("s", "2026-11-09"), seriesId: "s", originalDate: "2026-11-09", start: "2026-11-09T09:00:00.000Z", end: "2026-11-09T10:00:00.000Z" }), cancelled: true, archived: true };
  const moved = base({ id: occurrenceId("s", "2026-11-16"), seriesId: "s", originalDate: "2026-11-16", title: "Spostata", start: "2026-11-20T15:00:00.000Z", end: "2026-11-20T16:00:00.000Z" });
  const orphan = base({ id: occurrenceId("gone", "2026-11-02"), seriesId: "gone", originalDate: "2026-11-02", title: "Orfana" });
  const notAnInstance = base({ id: occurrenceId("s", "2026-11-03"), seriesId: "s", originalDate: "2026-11-03", title: "Martedì", start: "2026-11-03T09:00:00.000Z", end: "2026-11-03T10:00:00.000Z" });
  const events = [series, cancelled, moved, orphan, notAnInstance];
  eachDeviceZone(() => {
    const all = expandWithRules(events, utc("2026-11-01T00:00:00Z"), utc("2026-12-01T00:00:00Z"));
    assert.deepEqual(all.map((item) => [item.id, item.occurrenceDate, item.start]), [
      ["s", "2026-11-02", "2026-11-02T09:00:00.000Z"],
      ["s@2026-11-16", "2026-11-16", "2026-11-20T15:00:00.000Z"]
    ]);
    assert.equal(all[1].recurring, true);
    assert.equal(all[1].title, "Spostata");
    // La finestra del nuovo giorno la mostra, quella del giorno originale no.
    assert.deepEqual(expandWithRules(events, utc("2026-11-20T00:00:00Z"), utc("2026-11-21T00:00:00Z")).map((item) => item.id), ["s@2026-11-16"]);
    assert.deepEqual(expandWithRules(events, utc("2026-11-16T00:00:00Z"), utc("2026-11-17T00:00:00Z")).map((item) => item.id), []);
  });
  // Due righe con lo stesso id (due dispositivi): ne resta una, la più recente.
  const older = { ...moved, title: "Vecchia", updatedAt: "2026-11-01T00:00:00.000Z" };
  const newer = { ...moved, title: "Nuova", updatedAt: "2026-11-05T00:00:00.000Z" };
  const twice = expandWithRules([series, newer, older], utc("2026-11-01T00:00:00Z"), utc("2026-12-01T00:00:00Z"));
  assert.deepEqual(twice.map((item) => item.title), ["Lezione", "Lezione", "Nuova"]);
});

test("9. le occorrenze modificate si legano alla serie dello stesso proprietario (liste condivise miste)", () => {
  const owned = (ownerId, patch) => ({ ...patch, sharedFrom: { ownerId } });
  const seriesA = owned("A", ruled({ id: "x", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", repeat: { freq: "weekly" } }));
  const seriesB = owned("B", ruled({ id: "x", title: "Di B", start: "2026-11-02T15:00:00.000Z", end: "2026-11-02T16:00:00.000Z", repeat: { freq: "weekly" } }));
  const cancelA = owned("A", { ...base({ id: "x@2026-11-09", seriesId: "x", originalDate: "2026-11-09" }), cancelled: true, archived: true });
  const found = expandWithRules([seriesA, seriesB, cancelA], utc("2026-11-09T00:00:00Z"), utc("2026-11-10T00:00:00Z"));
  assert.deepEqual(found.map((item) => [item.sharedFrom.ownerId, item.title]), [["B", "Di B"]]);
  const grouped = expandWithRules([seriesA, seriesB, cancelA], utc("2026-11-09T00:00:00Z"), utc("2026-11-10T00:00:00Z"), { groupKey: () => "" });
  assert.equal(grouped.length, 0, "con un solo gruppo la cancellata vale per entrambe le serie con id x");
});

const allStarts = (events, from = utc("2026-01-01T00:00:00Z"), to = utc("2028-01-01T00:00:00Z")) => iso(expandWithRules(events, from, to));

test("10. divisione: COUNT=10 diviso alla terza -> madre COUNT=2, figlia COUNT=8, stesse date", () => {
  const series = ruled({ id: "c", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", repeat: { freq: "weekly", end: { type: "count", count: 10 } } });
  const plan = planSplit(series, [], "2026-11-16", {}, { now: "2026-11-11T12:00:00.000Z", timeZone: "Europe/Rome" });
  const parent = plan.puts.find((item) => item.id === "c");
  const child = plan.puts.find((item) => item.id !== "c");
  assert.deepEqual(parent.repeat.end, { type: "count", count: 2 });
  assert.deepEqual(child.repeat.end, { type: "count", count: 8 });
  assert.equal(child.splitFrom, "c");
  assert.equal(child.originalDate, "2026-11-16");
  assert.equal(child.sourceUid, undefined);
  assert.equal(child.seriesId, undefined);
  assert.deepEqual(allStarts([parent, child]), allStarts([series]));
  // Proiezione per le app vecchie: la madre finisce all'ultima data prima della divisione.
  assert.deepEqual([parent.recurrence, parent.recurrenceUntil], ["weekly", "2026-11-09"]);
  assert.deepEqual([child.recurrence, child.recurrenceUntil], ["weekly", "2027-01-04"]);
});

test("10. divisione: l'unione delle date non cambia (molte regole, ogni punto di divisione)", () => {
  const rules = [
    { freq: "daily", interval: 3, end: { type: "count", count: 12 } },
    { freq: "weekly", byWeekday: ["MO", "WE", "FR"], end: { type: "until", date: "2026-12-18" } },
    { freq: "weekly", interval: 2, byWeekday: ["TU", "TH"] },
    { freq: "monthly", monthly: { by: "weekday", nth: -1, weekday: "FR" }, end: { type: "count", count: 9 } },
    { freq: "monthly", interval: 3, monthly: { by: "lastDay" } },
    { freq: "yearly", end: { type: "count", count: 3 } }
  ];
  const window = [utc("2026-10-01T00:00:00Z"), utc("2029-12-31T00:00:00Z")];
  rules.forEach((repeat, index) => {
    const series = ruled({ id: `p${index}`, start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", timeZone: "Europe/Rome", repeat });
    const original = expandWithRules([series], ...window);
    for (const occurrence of original.slice(1, 12)) {
      const plan = planSplit(series, [], occurrence.occurrenceDate, {}, { now: "2026-11-11T12:00:00.000Z", timeZone: "Europe/Rome" });
      assert.deepEqual(iso(expandWithRules(plan.puts, ...window)), iso(original), `regola ${index} divisa il ${occurrence.occurrenceDate}`);
      // Madre vecchia (scritta prima della divisione) + figlia: nessun doppione.
      const child = plan.puts.find((item) => item.splitFrom === series.id);
      assert.deepEqual(iso(expandWithRules([series, child], ...window)), iso(original), `madre vecchia, regola ${index}`);
    }
  });
});

test("14. impronta diversa (un'app vecchia ha messo 'none'): la regola nuova si ignora", () => {
  const event = ruled({ id: "l", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", repeat: { freq: "weekly", byWeekday: ["MO", "WE", "FR"] } });
  assert.equal(event.repeatLegacy, "weekly|");
  const touchedByOldApp = { ...event, recurrence: "none" };
  assert.equal(normalizeRepeat(touchedByOldApp), null);
  assert.equal(expandWithRules([touchedByOldApp], utc("2026-11-01T00:00:00Z"), utc("2026-12-01T00:00:00Z")).length, 1);
  const weeklyByOldApp = { ...event, recurrenceUntil: "2026-11-20" };
  assert.deepEqual(normalizeRepeat(weeklyByOldApp), { freq: "weekly", end: { type: "until", date: "2026-11-20" } });
  // Al salvataggio successivo la regola ignorata sparisce.
  const saved = applyRepeatFields(touchedByOldApp, { timeZone: "Europe/Rome" });
  assert.equal("repeat" in saved, false);
  assert.equal("repeatLegacy" in saved, false);
  assert.equal(saved.recurrence, "none");
});

test("normalizeRepeat: i campi vecchi diventano una regola (mensile = clampDay)", () => {
  assert.equal(normalizeRepeat({ recurrence: "none" }), null);
  assert.equal(normalizeRepeat({}), null);
  assert.deepEqual(normalizeRepeat({ recurrence: "daily" }), { freq: "daily" });
  assert.deepEqual(normalizeRepeat({ recurrence: "weekly", recurrenceUntil: "2026-12-18" }), { freq: "weekly", end: { type: "until", date: "2026-12-18" } });
  assert.deepEqual(normalizeRepeat({ recurrence: "monthly" }), { freq: "monthly", monthly: { by: "clampDay" } });
  assert.deepEqual(normalizeRepeat({ recurrence: "monthly", recurrenceUntil: "non-una-data" }), { freq: "monthly", monthly: { by: "clampDay" } });
  assert.equal(repeatLegacyKey({ recurrence: "weekly", recurrenceUntil: "2026-12-18" }), "weekly|2026-12-18");
  assert.equal(repeatLegacyKey({}), "none|");
  // Senza impronta la regola vale (scritta da chi conosce `repeat`).
  assert.deepEqual(normalizeRepeat({ recurrence: "weekly", repeat: { freq: "weekly", interval: 2 } }), { freq: "weekly", interval: 2 });
});

test("legacyProjection: le app vecchie vedono al massimo un sottoinsieme delle date vere", () => {
  const none = { recurrence: "none", recurrenceUntil: undefined };
  assert.deepEqual(legacyProjection(null, "2026-11-02"), none);
  assert.deepEqual(legacyProjection({ freq: "daily" }, "2026-11-02"), { recurrence: "daily", recurrenceUntil: undefined });
  assert.deepEqual(legacyProjection({ freq: "daily", interval: 7 }, "2026-11-02"), { recurrence: "weekly", recurrenceUntil: undefined });
  assert.deepEqual(legacyProjection({ freq: "daily", interval: 2 }, "2026-11-02"), none);
  assert.deepEqual(legacyProjection({ freq: "weekly", byWeekday: ["MO", "WE", "FR"], end: { type: "until", date: "2026-12-18" } }, "2026-11-02"), { recurrence: "weekly", recurrenceUntil: "2026-12-18" });
  assert.deepEqual(legacyProjection({ freq: "weekly", byWeekday: ["TU", "TH"] }, "2026-11-02"), none);
  assert.deepEqual(legacyProjection({ freq: "weekly", interval: 2 }, "2026-11-02"), none);
  assert.deepEqual(legacyProjection({ freq: "monthly" }, "2026-11-12"), { recurrence: "monthly", recurrenceUntil: undefined });
  assert.deepEqual(legacyProjection({ freq: "monthly" }, "2027-01-31"), none);
  assert.deepEqual(legacyProjection({ freq: "monthly", monthly: { by: "lastDay" } }, "2027-01-31"), { recurrence: "monthly", recurrenceUntil: undefined });
  assert.deepEqual(legacyProjection({ freq: "monthly", monthly: { by: "clampDay" } }, "2027-01-31"), { recurrence: "monthly", recurrenceUntil: undefined });
  assert.deepEqual(legacyProjection({ freq: "monthly", monthly: { by: "weekday", nth: 2, weekday: "TU" } }, "2026-11-10"), none);
  assert.deepEqual(legacyProjection({ freq: "monthly", interval: 3 }, "2026-11-12"), none);
  assert.deepEqual(legacyProjection({ freq: "yearly" }, "2026-11-12"), none);
  assert.deepEqual(legacyProjection({ freq: "daily", end: { type: "count", count: 5 } }, "2026-11-02"), { recurrence: "daily", recurrenceUntil: "2026-11-06" });
});

test("15. validateRepeat rifiuta intervalli e conteggi fuori misura e giorni inventati; massimo 1000 occorrenze", () => {
  for (const interval of [0, -1, 1e9, 1.5, Number.NaN, "2"]) assert.equal(validateRepeat({ freq: "daily", interval }).ok, false, `interval ${interval}`);
  for (const count of [0, 1e9, 1000, 2.5]) assert.equal(validateRepeat({ freq: "daily", end: { type: "count", count } }).ok, false, `count ${count}`);
  for (const byWeekday of [["XX"], ["mo"], [3], "MO", []]) assert.equal(validateRepeat({ freq: "weekly", byWeekday }).ok, false, JSON.stringify(byWeekday));
  assert.equal(validateRepeat({ freq: "hourly" }).ok, false);
  assert.equal(validateRepeat(null).ok, false);
  assert.equal(validateRepeat({ freq: "weekly", end: { type: "until", date: "2026-02-30" } }).ok, false);
  assert.equal(validateRepeat({ freq: "monthly", monthly: { by: "weekday", nth: 5, weekday: "MO" } }).ok, false);
  assert.equal(validateRepeat({ freq: "daily", byWeekday: ["MO"] }).ok, false);
  assert.equal(validateRepeat({ freq: "weekly", wkst: "XX" }).ok, false);
  assert.deepEqual(validateRepeat({ freq: "weekly", interval: 2, byWeekday: ["FR", "MO", "MO"], end: { type: "count", count: 999 }, extra: "?" }), {
    ok: true,
    rule: { freq: "weekly", interval: 2, byWeekday: ["MO", "FR"], end: { type: "count", count: 999 } }
  });
  const forever = ruled({ id: "f", repeat: { freq: "daily" } });
  assert.equal(expandWithRules([forever], utc("2026-01-01T00:00:00Z"), utc("2036-01-01T00:00:00Z")).length, MAX_OCCURRENCES);
  assert.equal(MAX_OCCURRENCES, 1000);
});

test("15. una serie condivisa con una regola ostile (intervallo 0, COUNT 1e9) non si espande all'infinito", () => {
  const hostile = {
    ...base({ id: "evil", recurrence: "daily", start: "2026-01-01T09:00:00.000Z", end: "2026-01-01T10:00:00.000Z" }),
    repeat: { freq: "daily", interval: 0, end: { type: "count", count: 1e9 } },
    repeatLegacy: "daily|",
    timeZone: "Mars/Olympus",
    sharedFrom: { ownerId: "stranger" }
  };
  const started = Date.now();
  const found = expandWithRules([hostile], utc("2026-01-01T00:00:00Z"), utc("2046-01-01T00:00:00Z"));
  assert.equal(found.length, MAX_OCCURRENCES);
  assert.ok(Date.now() - started < 2000);
  // Regola non valida: vale la vecchia `recurrence` (qui giornaliera), con il fuso del dispositivo.
  assert.equal(found[1].occurrenceDate > found[0].occurrenceDate, true);
  const hugeInterval = { ...hostile, repeat: { freq: "weekly", interval: 1e9, byWeekday: ["MO", "XX"] }, recurrence: "none", repeatLegacy: "none|" };
  assert.equal(expandWithRules([hugeInterval], utc("2026-01-01T00:00:00Z"), utc("2046-01-01T00:00:00Z")).length, 1);
});

test("16. tutto il giorno: settimanale dal 25/10 (giorno di 25 ore) dà giorni interi; compleanno stesso giorno ovunque", () => {
  const weekly = ruled({ id: "a", allDay: true, start: "2026-10-25T00:00:00", end: "2026-10-26T00:00:00", repeat: { freq: "weekly" } });
  eachDeviceZone((zone) => {
    const found = expandWithRules([weekly], new Date(2026, 9, 20), new Date(2026, 10, 20));
    assert.deepEqual(found.map((item) => item.occurrenceDate), ["2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15"], zone);
    for (const item of found) {
      assert.equal(civilDateOf(new Date(item.start)), item.occurrenceDate);
      assert.equal(new Date(item.start).getHours(), 0);
      assert.equal(new Date(item.end).getHours(), 0, `fine a mezzanotte, ${zone}`);
      assert.equal(civilDateOf(new Date(item.end)), civilDateOf(new Date(Date.parse(item.start) + 36 * 3_600_000)));
    }
    const birthday = ruled({ id: "b", allDay: true, start: "1999-11-12T00:00:00", end: "1999-11-13T00:00:00", repeat: { freq: "yearly" }, occasion: { kind: "birthday", birthYear: 1999 } });
    const next = expandWithRules([birthday], new Date(2026, 10, 1), new Date(2026, 11, 1));
    assert.deepEqual(next.map((item) => civilDateOf(new Date(item.start))), ["2026-11-12"], zone);
  });
  // Un tutto il giorno con fuso (non fluttuante) resta nel suo giorno anche visto da New York.
  const romeAllDay = ruled({ id: "r", allDay: true, start: "2026-11-11T23:00:00.000Z", end: "2026-11-12T23:00:00.000Z", timeZone: "Europe/Rome", repeat: { freq: "weekly", end: { type: "count", count: 2 } } });
  withTz("America/New_York", () => {
    const found = expandWithRules([romeAllDay], new Date(2026, 10, 1), new Date(2026, 11, 1));
    assert.deepEqual(found.map((item) => civilDateOf(new Date(item.start))), ["2026-11-12", "2026-11-19"]);
  });
});

test("17. promemoria: 15 minuti prima di un evento con orario; 1 giorno prima alle 9 per un tutto il giorno, nel fuso dell'evento", () => {
  eachDeviceZone((zone) => {
    const timed = { start: "2026-11-12T09:00:00.000Z", end: "2026-11-12T10:00:00.000Z", timeZone: "Europe/Rome", reminders: [{ minutesBefore: 15 }, { minutesBefore: 0 }] };
    assert.deepEqual(reminderInstants(timed).map((date) => date.toISOString()), ["2026-11-12T08:45:00.000Z", "2026-11-12T09:00:00.000Z"], zone);
    const allDay = { start: "2026-11-12T00:00:00", end: "2026-11-13T00:00:00", allDay: true, timeZone: "Europe/Rome", occurrenceDate: "2026-11-12", reminders: [{ daysBefore: 1, at: "09:00" }, { daysBefore: 0, at: "08:30" }] };
    assert.deepEqual(reminderInstants(allDay).map((date) => date.toISOString()), ["2026-11-11T08:00:00.000Z", "2026-11-12T07:30:00.000Z"], zone);
    // Prima del cambio d'ora: 1 giorno prima alle 9 resta alle 9 da orologio.
    const dst = { ...allDay, start: "2026-10-26T00:00:00", occurrenceDate: "2026-10-26", reminders: [{ daysBefore: 1, at: "09:00" }] };
    assert.deepEqual(reminderInstants(dst).map((date) => date.toISOString()), ["2026-10-25T08:00:00.000Z"]);
    // Valori ostili ignorati.
    assert.deepEqual(reminderInstants({ ...timed, reminders: [{ minutesBefore: -5 }, { at: "25:99" }, { minutesBefore: 1e12 }, "x"] }), []);
  });
  withTz("America/New_York", () => {
    const floating = { start: "2026-11-12T00:00:00", end: "2026-11-13T00:00:00", allDay: true, reminders: [{ daysBefore: 1, at: "09:00" }] };
    assert.deepEqual(reminderInstants(floating).map((date) => date.toISOString()), ["2026-11-11T14:00:00.000Z"]);
  });
});

test("describeRule: frasi in italiano dalla regola", () => {
  assert.equal(describeRule(null), "Non si ripete");
  assert.equal(describeRule({ freq: "daily" }), "Ogni giorno");
  assert.equal(describeRule({ freq: "daily", interval: 3 }), "Ogni 3 giorni");
  assert.equal(describeRule({ freq: "weekly" }, "2026-11-10"), "Ogni settimana il martedì");
  assert.equal(describeRule({ freq: "weekly" }, "2026-11-08"), "Ogni settimana la domenica");
  assert.equal(describeRule({ freq: "weekly", interval: 2, byWeekday: ["MO", "WE", "FR"], end: { type: "until", date: "2026-12-18" } }, "2026-11-02"), "Ogni 2 settimane lun, mer, ven, fino al 18 dicembre");
  assert.equal(describeRule({ freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"] }, "2026-11-02"), "Ogni giorno feriale (lun–ven)");
  assert.equal(describeRule({ freq: "monthly" }, "2026-11-12"), "Ogni mese il 12");
  assert.equal(describeRule({ freq: "monthly" }, "2026-11-08"), "Ogni mese l'8");
  assert.equal(describeRule({ freq: "monthly" }, "2026-11-01"), "Ogni mese il 1°");
  assert.equal(describeRule({ freq: "monthly", monthly: { by: "clampDay" } }, "2027-01-31"), "Ogni mese il 31 (o l'ultimo giorno del mese)");
  assert.equal(describeRule({ freq: "monthly", monthly: { by: "lastDay" } }, "2027-01-31"), "Ogni mese l'ultimo giorno");
  assert.equal(describeRule({ freq: "monthly", monthly: { by: "weekday", nth: 2, weekday: "TU" } }, "2026-11-10"), "Ogni mese il secondo martedì");
  assert.equal(describeRule({ freq: "monthly", monthly: { by: "weekday", nth: -1, weekday: "SU" } }, "2026-11-29"), "Ogni mese l'ultima domenica");
  assert.equal(describeRule({ freq: "monthly", interval: 3 }, "2026-11-12"), "Ogni 3 mesi il 12");
  assert.equal(describeRule({ freq: "monthly", interval: 6 }, "2026-11-12"), "Ogni 6 mesi il 12");
  assert.equal(describeRule({ freq: "yearly" }, "2026-11-12"), "Ogni anno il 12 novembre");
  assert.equal(describeRule({ freq: "yearly" }, "2026-03-08"), "Ogni anno l'8 marzo");
  assert.equal(describeRule({ freq: "yearly", interval: 2 }, "2026-05-01"), "Ogni 2 anni il 1° maggio");
  assert.equal(describeRule({ freq: "yearly" }, "2000-02-29"), "Ogni anno il 29 febbraio (il 28 febbraio negli anni non bisestili)");
  assert.equal(describeRule({ freq: "yearly", yearlyLeap: "skip" }, "2000-02-29"), "Ogni anno il 29 febbraio (solo negli anni bisestili)");
  assert.equal(describeRule({ freq: "weekly", end: { type: "count", count: 10 } }, "2026-11-10"), "Ogni settimana il martedì, per 10 volte");
  assert.equal(describeRule({ freq: "daily", end: { type: "count", count: 1 } }), "Ogni giorno, per 1 volta");
  assert.equal(describeRule({ freq: "daily", end: { type: "until", date: "2027-01-08" } }, "2026-11-10"), "Ogni giorno, fino all'8 gennaio 2027");
});

test("describeReminder: frasi dei promemoria", () => {
  assert.equal(describeReminder({ minutesBefore: 0 }), "All'ora dell'evento");
  assert.equal(describeReminder({ minutesBefore: 15 }), "15 minuti prima");
  assert.equal(describeReminder({ minutesBefore: 60 }), "1 ora prima");
  assert.equal(describeReminder({ minutesBefore: 120 }), "2 ore prima");
  assert.equal(describeReminder({ minutesBefore: 1440 }), "1 giorno prima");
  assert.equal(describeReminder({ daysBefore: 1, at: "09:00" }), "1 giorno prima alle 9:00");
  assert.equal(describeReminder({ daysBefore: 2, at: "18:30" }), "2 giorni prima alle 18:30");
  assert.equal(describeReminder({ daysBefore: 0, at: "08:00" }), "Il giorno stesso alle 8:00");
});

test("countBefore e nextOccurrence", () => {
  const rule = { freq: "weekly", byWeekday: ["MO", "WE", "FR"] };
  assert.equal(countBefore(rule, "2026-11-02", "2026-11-02"), 0);
  assert.equal(countBefore(rule, "2026-11-02", "2026-11-09"), 3);
  assert.equal(countBefore(rule, "2026-11-02", "2026-11-10"), 4);
  assert.equal(countBefore({ ...rule, end: { type: "count", count: 2 } }, "2026-11-02", "2026-12-01"), 2);
  assert.equal(countBefore(null, "2026-11-02", "2026-12-01"), 1);
  const birthday = ruled({ id: "b", allDay: true, start: "1999-04-20T00:00:00", end: "1999-04-21T00:00:00", repeat: { freq: "yearly" }, occasion: { kind: "birthday", birthYear: 1999 } });
  withTz("Europe/Rome", () => {
    const next = nextOccurrence(birthday, new Date(2026, 10, 11, 15));
    assert.equal(next.occurrenceDate, "2027-04-20");
    assert.equal(nextOccurrence(birthday, new Date(2027, 3, 20, 15)).occurrenceDate, "2027-04-20", "oggi conta ancora");
    assert.equal(nextOccurrence(base({ id: "past", start: "2020-01-01T09:00:00.000Z", end: "2020-01-01T10:00:00.000Z" }), new Date(2026, 0, 1)), null);
  });
});

// ---------------------------------------------------------------------------------------
// Piani di modifica ed eliminazione (puri)
// ---------------------------------------------------------------------------------------

const NOW = "2026-11-11T12:00:00.000Z";
const weeklySeries = (patch = {}) =>
  ruled({ id: "s", subjectId: "sub1", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", timeZone: "Europe/Rome", sourceUid: "uid-1", repeat: { freq: "weekly" }, ...patch });

test("planEdit 'this': riga separata con id prevedibile, materia della serie, nessuna regola", () => {
  const series = weeklySeries();
  const plan = planEdit(series, [], "2026-11-16", "this", { title: "Aula cambiata", start: "2026-11-16T10:00:00.000Z", end: "2026-11-16T11:00:00.000Z" }, { now: NOW });
  assert.deepEqual(plan.deletes, []);
  assert.equal(plan.puts.length, 1);
  const [row] = plan.puts;
  assert.equal(row.id, "s@2026-11-16");
  assert.equal(row.seriesId, "s");
  assert.equal(row.originalDate, "2026-11-16");
  assert.equal(row.subjectId, "sub1");
  assert.equal(row.title, "Aula cambiata");
  assert.equal(row.start, "2026-11-16T10:00:00.000Z");
  assert.equal(row.recurrence, "none");
  assert.equal(row.repeat, undefined);
  assert.equal(row.repeatLegacy, undefined);
  assert.equal(row.sourceUid, undefined);
  assert.equal(row.archived, false);
  assert.equal(row.updatedAt, NOW);
  // Seconda modifica della stessa occorrenza: stessa riga.
  const again = planEdit(series, [row], "2026-11-16", "this", { notes: "porta il libro" }, { now: NOW });
  assert.equal(again.puts[0].id, "s@2026-11-16");
  assert.equal(again.puts[0].title, "Aula cambiata");
  assert.equal(again.puts[0].notes, "porta il libro");
  // Non è un'occorrenza: nessun cambiamento.
  assert.deepEqual(planEdit(series, [], "2026-11-17", "this", { title: "x" }, { now: NOW }), { puts: [], deletes: [] });
  // Chi riceve una serie condivisa crea la riga con links vuoti.
  assert.deepEqual(planEdit({ ...series, links: ["https://a.it"] }, [], "2026-11-16", "this", { title: "x" }, { now: NOW, recipient: true }).puts[0].links, []);
});

test("planEdit 'all': orario spostato da un'occorrenza, materia riscritta nelle righe, le altre restano uguali", () => {
  const series = weeklySeries();
  const moved = planEdit(series, [], "2026-11-16", "this", { title: "Spostata" }, { now: NOW }).puts[0];
  const plan = planEdit(series, [moved], "2026-11-16", "all", { start: "2026-11-16T10:30:00.000Z", end: "2026-11-16T12:00:00.000Z", subjectId: "sub2" }, { now: NOW });
  const next = plan.puts.find((item) => item.id === "s");
  assert.equal(next.start, "2026-11-02T10:30:00.000Z");
  assert.equal(next.end, "2026-11-02T12:00:00.000Z");
  assert.equal(next.subjectId, "sub2");
  assert.equal(next.sourceUid, "uid-1");
  assert.deepEqual(plan.puts.find((item) => item.id === "s@2026-11-16").subjectId, "sub2");
  // Senza cambio di materia le righe non si toccano.
  const titleOnly = planEdit(series, [moved], "2026-11-16", "all", { title: "Analisi" }, { now: NOW });
  assert.deepEqual(titleOnly.puts.map((item) => item.id), ["s"]);
  // Cambio di regola: le righe che non sono più occorrenze si eliminano.
  const tuesday = planEdit(series, [moved], "2026-11-16", "all", { repeat: { freq: "weekly", byWeekday: ["TU"] } }, { now: NOW });
  assert.deepEqual(tuesday.deletes, ["s@2026-11-16"]);
  // "Solo questa" con un cambio di materia: la materia è della serie.
  const subject = planEdit(series, [moved], "2026-11-23", "this", { subjectId: "sub3", title: "Una" }, { now: NOW });
  assert.deepEqual(subject.puts.map((item) => [item.id, item.subjectId]).sort(), [["s", "sub3"], ["s@2026-11-16", "sub3"], ["s@2026-11-23", "sub3"]]);
});

test("planEdit 'all': una serie salvata senza il campo allDay e una modifica con allDay false non è un cambio", () => {
  // Eventi vecchi e creati dall'agente non hanno il campo: assente vale false, come nel modulo.
  const series = weeklySeries();
  assert.equal("allDay" in series, false);
  const plan = planEdit(series, [], "2026-11-16", "all", { allDay: false, start: "2026-11-16T09:00:00.000Z", end: "2026-11-16T10:00:00.000Z", title: "X" }, { now: NOW });
  const next = plan.puts.find((item) => item.id === "s");
  assert.equal(next.start, "2026-11-02T09:00:00.000Z", "la serie resta dal 2 novembre");
  assert.equal(next.end, "2026-11-02T10:00:00.000Z");
  assert.equal(next.title, "X");
  // Con un'ora diversa la serie si sposta solo di ora, non al giorno aperto.
  const later = planEdit(series, [], "2026-11-16", "all", { allDay: false, start: "2026-11-16T11:00:00.000Z", end: "2026-11-16T12:00:00.000Z" }, { now: NOW });
  assert.equal(later.puts.find((item) => item.id === "s").start, "2026-11-02T11:00:00.000Z");
});

test("planEdit 'following' alla prima occorrenza = tutta la serie; poi divide e sposta le righe successive", () => {
  const series = weeklySeries();
  const first = planEdit(series, [], "2026-11-02", "following", { title: "Tutte" }, { now: NOW });
  assert.deepEqual(first.puts.map((item) => [item.id, item.title]), [["s", "Tutte"]]);
  const cancelled = planDelete([series], "s", "2026-11-23", "this", { now: NOW }).puts[0];
  const modified = planEdit(series, [], "2026-11-30", "this", { title: "Diversa" }, { now: NOW }).puts[0];
  const early = planEdit(series, [], "2026-11-09", "this", { title: "Prima" }, { now: NOW }).puts[0];
  const plan = planEdit(series, [cancelled, modified, early], "2026-11-16", "following", { title: "Nuova aula" }, { now: NOW });
  const parent = plan.puts.find((item) => item.id === "s");
  const child = plan.puts.find((item) => item.splitFrom === "s");
  assert.deepEqual(parent.repeat.end, { type: "until", date: "2026-11-15" });
  assert.equal(parent.title, "Lezione");
  assert.equal(child.title, "Nuova aula");
  assert.equal(child.start, "2026-11-16T09:00:00.000Z");
  assert.deepEqual(plan.deletes.sort(), ["s@2026-11-23", "s@2026-11-30"]);
  assert.deepEqual(plan.puts.filter((item) => item.seriesId).map((item) => [item.id, item.seriesId, item.title]).sort(), [
    [`${child.id}@2026-11-23`, child.id, "Lezione"],
    [`${child.id}@2026-11-30`, child.id, "Diversa"]
  ]);
  const shown = expandWithRules([...plan.puts, early], utc("2026-11-01T00:00:00Z"), utc("2026-12-08T00:00:00Z"));
  assert.deepEqual(shown.map((item) => [item.occurrenceDate, item.title]), [
    ["2026-11-02", "Lezione"],
    ["2026-11-09", "Prima"],
    ["2026-11-16", "Nuova aula"],
    ["2026-11-30", "Diversa"],
    ["2026-12-07", "Nuova aula"]
  ]);
  // Ora diversa da qui in poi: le occorrenze modificate si perdono (come Google), le cancellate restano.
  const later = planEdit(series, [cancelled, modified], "2026-11-16", "following", { start: "2026-11-16T14:00:00.000Z", end: "2026-11-16T15:00:00.000Z" }, { now: NOW });
  const laterChild = later.puts.find((item) => item.splitFrom === "s");
  assert.equal(laterChild.start, "2026-11-16T14:00:00.000Z");
  assert.deepEqual(later.puts.filter((item) => item.seriesId).map((item) => [item.id, item.cancelled]), [[`${laterChild.id}@2026-11-23`, true]]);
});

test("planDelete: solo questa, questa e le successive, tutta la serie (con o senza le serie figlie)", () => {
  const series = weeklySeries();
  const one = planDelete([series], "s", "2026-11-16", "this", { now: NOW });
  assert.deepEqual(one.deletes, []);
  assert.equal(one.puts[0].id, "s@2026-11-16");
  assert.equal(one.puts[0].cancelled, true);
  assert.equal(one.puts[0].archived, true);
  assert.equal(one.puts[0].subjectId, "sub1");

  const modified = planEdit(series, [], "2026-11-30", "this", { title: "Diversa" }, { now: NOW }).puts[0];
  const following = planDelete([series, modified], "s", "2026-11-16", "following", { now: NOW });
  assert.deepEqual(following.deletes, ["s@2026-11-30"]);
  assert.deepEqual(following.puts.map((item) => [item.id, item.repeat.end]), [["s", { type: "until", date: "2026-11-15" }]]);
  assert.deepEqual(planDelete([series], "s", "2026-11-02", "following", { now: NOW }), { puts: [], deletes: ["s"] });

  const split = planSplit(series, [], "2026-11-16", { title: "Figlia" }, { now: NOW, timeZone: "Europe/Rome" });
  const child = split.puts.find((item) => item.splitFrom === "s");
  const childOverride = planEdit(child, [], "2026-11-23", "this", { title: "x" }, { now: NOW }).puts[0];
  const events = [...split.puts, childOverride, modified, base({ id: "other" })];
  assert.deepEqual(planDelete(events, "s", "2026-11-09", "all", { now: NOW }).deletes.sort(), ["s", "s@2026-11-30"]);
  assert.deepEqual(planDelete(events, child.id, "2026-11-23", "all", { now: NOW, includeSplits: true }).deletes.sort(), [child.id, `${child.id}@2026-11-23`, "s", "s@2026-11-30"].sort());
  // Un evento singolo: "solo questa" lo elimina. Senza fuso il suo giorno è quello del dispositivo
  // (a Honolulu le 09:00Z del 28 sono ancora il 27).
  const single = base({ id: "single" });
  assert.deepEqual(planDelete([single], "single", civilDateOf(new Date(single.start)), "this", { now: NOW }), { puts: [], deletes: ["single"] });
});

test("applyRepeatFields: salva regola, impronta, fuso e proiezione; senza regola non tocca nulla", () => {
  const saved = applyRepeatFields(base({ id: "n", start: "2026-11-02T09:00:00.000Z", repeat: { freq: "weekly", byWeekday: ["MO", "WE"], end: { type: "count", count: 4 } } }), { repeatChanged: true, timeZone: "Europe/Rome" });
  assert.deepEqual(saved.repeat, { freq: "weekly", byWeekday: ["MO", "WE"], end: { type: "count", count: 4 } });
  assert.equal(saved.recurrence, "weekly");
  assert.equal(saved.recurrenceUntil, "2026-11-11");
  assert.equal(saved.repeatLegacy, "weekly|2026-11-11");
  assert.equal(saved.timeZone, "Europe/Rome");
  const plain = base({ id: "p" });
  assert.equal(applyRepeatFields(plain, { timeZone: "Europe/Rome" }), plain);
  const removed = applyRepeatFields({ ...saved, repeat: undefined }, { repeatChanged: true, timeZone: "Europe/Rome" });
  assert.equal("repeat" in removed, false);
  assert.equal(removed.recurrence, "none");
  assert.equal(removed.recurrenceUntil, undefined);
});

// ---------------------------------------------------------------------------------------
// Selettori, agenti e condivisione
// ---------------------------------------------------------------------------------------

test("nextOccurrences: ricorrenze entro un anno (anche a 5 mesi), una per serie, con l'età; upcomingEvents resta a 120 giorni", () => {
  withTz("Europe/Rome", () => {
    const now = new Date(2026, 10, 11, 15);
    const birthday = ruled({ id: "anna", title: "Anna", category: "personal", allDay: true, start: "1999-04-20T00:00:00", end: "1999-04-21T00:00:00", repeat: { freq: "yearly" }, occasion: { kind: "birthday", birthYear: 1999 } });
    const wedding = ruled({ id: "nozze", title: "Nozze", category: "personal", allDay: true, start: "2016-11-20T00:00:00", end: "2016-11-21T00:00:00", repeat: { freq: "yearly" }, occasion: { kind: "anniversary", birthYear: 2016 } });
    const today = ruled({ id: "oggi", title: "Oggi", category: "personal", allDay: true, start: "2001-11-11T00:00:00", end: "2001-11-12T00:00:00", repeat: { freq: "yearly" }, occasion: { kind: "birthday" } });
    const lesson = ruled({ id: "lezione", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", repeat: { freq: "weekly" } });
    const found = nextOccurrences([lesson, birthday, wedding, today], now);
    assert.deepEqual(found.map((item) => [item.id, item.occurrenceDate, item.age]), [
      ["oggi", "2026-11-11", undefined],
      ["nozze", "2026-11-20", 10],
      ["anna", "2027-04-20", 28]
    ]);
    // Quest'anno le nozze sono cancellate: la prossima è oltre l'anno, quindi non compare.
    const skipped = planDelete([wedding], "nozze", "2026-11-20", "this", { now: NOW }).puts[0];
    assert.deepEqual(nextOccurrences([birthday, wedding, skipped], now).map((item) => item.id), ["anna"]);
    assert.deepEqual(nextOccurrences([birthday], now, 30), []);
    assert.equal(upcomingEvents([birthday], 6).length, 0, "120 giorni non bastano: per questo nextOccurrences");
  });
});

test("todayEvents e upcomingEvents: per i dati vecchi stessa uscita di prima", () => {
  withTz("Europe/Rome", () => {
    const today = new Date();
    const at = (days, hour) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hour).toISOString();
    const events = [
      base({ id: "w", recurrence: "weekly", start: at(-14, 9), end: at(-14, 10) }),
      base({ id: "d", recurrence: "daily", start: at(-3, 18), end: at(-3, 19), recurrenceUntil: undefined }),
      base({ id: "one", start: at(5, 11), end: at(5, 12) })
    ];
    const shape = (items) => items.map((item) => [item.id, item.start, item.end, item.recurring]);
    const legacyToday = legacyExpand(events, new Date(today.getFullYear(), today.getMonth(), today.getDate()), new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1));
    assert.deepEqual(shape(todayEvents(events)), shape(legacyToday));
    const legacyUpcoming = legacyExpand(events, new Date(today.getFullYear(), today.getMonth(), today.getDate()), new Date(today.getFullYear(), today.getMonth(), today.getDate() + 120)).slice(0, 6);
    assert.deepEqual(shape(upcomingEvents(events)), shape(legacyUpcoming));
  });
});

test("agenti: una serie altrui con regola ostile resta limitata; le righe cancellate valgono per il loro proprietario", () => {
  const entry = (ownerId, id, entity) => ({
    key: `${ownerId}:calendarEvent:${id}`,
    ownerId,
    entityType: "calendarEvent",
    entityId: id,
    entity: { id, updatedAt: "2026-11-10T08:00:00.000Z", title: "Lezione", description: "", ...entity },
    serverUpdatedAt: "2026-11-10T08:00:00.000Z"
  });
  const grant = (ownerId) => ({ id: `g-${ownerId}`, ownerId, ownerName: ownerId, scope: "calendar", subjectIds: [], permission: "view", granteeUserId: "me", granteeGroupId: null, createdAt: NOW, updatedAt: NOW });
  const hostile = entry("owner-a", "evil", {
    start: "2026-01-01T09:00:00.000Z",
    end: "2026-01-01T10:00:00.000Z",
    recurrence: "none",
    repeat: { freq: "daily", interval: 0, end: { type: "count", count: 1e9 } },
    repeatLegacy: "none|"
  });
  const series = (ownerId) =>
    entry(ownerId, "x", { start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", recurrence: "weekly", repeat: { freq: "weekly" }, repeatLegacy: "weekly|", timeZone: "Europe/Rome" });
  const cancelled = entry("owner-a", "x@2026-11-09", { start: "2026-11-09T09:00:00.000Z", end: "2026-11-09T10:00:00.000Z", seriesId: "x", originalDate: "2026-11-09", cancelled: true, archived: true });
  const items = [hostile, series("owner-a"), series("owner-b"), cancelled];
  const view = sharedItemsView(items, [grant("owner-a"), grant("owner-b")], [], { from: utc("2026-01-01T00:00:00Z"), to: utc("2046-01-01T00:00:00Z") });
  assert.equal(view.filter((item) => item.title === "Lezione" && item.start.startsWith("2026-01-01")).length, 1, "regola non valida: vale recurrence none");
  const week = sharedItemsView(items, [grant("owner-a"), grant("owner-b")], [], { from: utc("2026-11-09T00:00:00Z"), to: utc("2026-11-10T00:00:00Z") });
  assert.deepEqual(week.map((item) => item.owner), ["owner-b"]);
  const shown = sharedItemsView([series("owner-a")], [grant("owner-a")], [], { from: utc("2026-11-02T00:00:00Z"), to: utc("2026-11-03T00:00:00Z") })[0];
  assert.deepEqual(shown.repeat, { freq: "weekly" });
  assert.equal(shown.timeZone, "Europe/Rome");
  assert.equal("repeatLegacy" in shown, false);
});

test("condivisione: i campi della ripetizione si mandano insieme", () => {
  const before = { start: "a", end: "b", allDay: false, recurrence: "weekly", recurrenceUntil: undefined, repeat: { freq: "weekly" }, repeatLegacy: "weekly|", timeZone: "Europe/Rome", title: "x" };
  const after = { ...before, repeat: { freq: "weekly", byWeekday: ["MO", "WE"] } };
  assert.deepEqual(Object.keys(changedFields(before, after, CALENDAR_EVENT_FIELD_GROUPS)).sort(), ["recurrence", "recurrenceUntil", "repeat", "repeatLegacy", "timeZone"]);
  const moved = { ...before, start: "c" };
  assert.deepEqual(Object.keys(changedFields(before, moved, CALENDAR_EVENT_FIELD_GROUPS)).sort(), ["allDay", "end", "start"]);
  // Modifica dal dettaglio di un elemento altrui: con l'inizio partono anche fine e tutto il giorno.
  const latest = { ...before, end: "z" };
  assert.equal(sharedEditResult("calendarEvent", before, { start: "c" }, latest)?.end, "b");
});

// ---------------------------------------------------------------------------------------
// Revisione: chiavi stabili tra fusi, divisioni ordinate, eliminazione delle successive, velocità
// ---------------------------------------------------------------------------------------

const viewIn = (zone, events, window) => withTz(zone, () => expandWithRules(events, ...window).map((item) => [item.start, item.title, item.occurrenceDate]));

test("B1. 'solo questa' su una serie senza fuso: si fissa il fuso del dispositivo e la riga vale per la stessa occorrenza ovunque", () => {
  // Salvata prima del nuovo motore: ogni lunedì alle 00:30 di Roma (domenica sera a New York).
  const legacy = base({ id: "L", recurrence: "weekly", start: "2026-11-15T23:30:00.000Z", end: "2026-11-16T00:30:00.000Z" });
  const window = [utc("2026-11-14T00:00:00Z"), utc("2026-12-16T00:00:00Z")];
  let events = [legacy];
  withTz("Europe/Rome", () => {
    const before = iso(expandWithRules([legacy], ...window));
    const edit = planEdit(legacy, events, "2026-11-23", "this", { title: "Spostata" }, { now: NOW });
    assert.equal(edit.puts.find((item) => item.id === "L")?.timeZone, "Europe/Rome", "il fuso si fissa sulla serie nello stesso salvataggio");
    events = applyEditPlan(events, edit).events;
    const removal = planDelete(events, "L", "2026-11-30", "this", { now: NOW });
    assert.deepEqual(removal.puts.map((item) => item.id), ["L@2026-11-30"], "già fissato: la serie non si riscrive");
    events = applyEditPlan(events, removal).events;
    // Fissare il fuso non sposta nessuna occorrenza sul dispositivo che modifica.
    assert.deepEqual(iso(expandWithRules([events.find((item) => item.id === "L")], ...window)), before);
  });
  const expected = [
    ["2026-11-15T23:30:00.000Z", "Lezione", "2026-11-16"],
    ["2026-11-22T23:30:00.000Z", "Spostata", "2026-11-23"],
    ["2026-12-06T23:30:00.000Z", "Lezione", "2026-12-07"],
    ["2026-12-13T23:30:00.000Z", "Lezione", "2026-12-14"]
  ];
  for (const zone of DEVICE_ZONES) assert.deepEqual(viewIn(zone, events, window), expected, zone);
});

test("B1. tutto il giorno senza fuso (mezzanotte di Roma in UTC): l'occorrenza cancellata resta nascosta in ogni fuso", () => {
  const allDay = base({ id: "A", allDay: true, recurrence: "daily", recurrenceUntil: "2026-11-20", start: "2026-11-15T23:00:00.000Z", end: "2026-11-16T23:00:00.000Z" });
  const window = [utc("2026-11-10T00:00:00Z"), utc("2026-11-30T00:00:00Z")];
  let events = [allDay];
  withTz("Europe/Rome", () => {
    const before = expandWithRules([allDay], ...window).map((item) => [item.start, item.end]);
    const plan = planDelete(events, "A", "2026-11-18", "this", { now: NOW });
    assert.equal(plan.puts.find((item) => item.id === "A")?.timeZone, "Europe/Rome");
    events = applyEditPlan(events, plan).events;
    const after = expandWithRules([events.find((item) => item.id === "A")], ...window).map((item) => [item.start, item.end]);
    assert.deepEqual(after, before, "stessi giorni interi a Roma");
  });
  for (const zone of DEVICE_ZONES) {
    const dates = withTz(zone, () => expandWithRules(events, ...window).map((item) => item.occurrenceDate));
    assert.deepEqual(dates, ["2026-11-16", "2026-11-17", "2026-11-19", "2026-11-20"], zone);
  }
});

const splitFixture = () => {
  const parent = weeklySeries({ id: "P" });
  // Un dispositivo: "questa e le successive" dal 30/11 con un orario nuovo.
  const late = planEdit(parent, [parent], "2026-11-30", "following", { start: "2026-11-30T10:00:00.000Z", end: "2026-11-30T11:00:00.000Z" }, { now: NOW });
  // Un altro (prima di ricevere la prima divisione): dal 16/11 con una regola senza fine.
  const early = planEdit(parent, [parent], "2026-11-16", "following", { repeat: { freq: "weekly", byWeekday: ["MO", "WE"] } }, { now: NOW });
  return {
    lateParent: late.puts.find((item) => item.id === "P"),
    earlyParent: early.puts.find((item) => item.id === "P"),
    lateChild: late.puts.find((item) => item.splitFrom === "P"),
    earlyChild: early.puts.find((item) => item.splitFrom === "P")
  };
};

const SPLIT_EXPECTED = [
  ["2026-11-02", "P", "2026-11-02T09:00:00.000Z"],
  ["2026-11-09", "P", "2026-11-09T09:00:00.000Z"],
  ["2026-11-16", "P~2026-11-16", "2026-11-16T09:00:00.000Z"],
  ["2026-11-18", "P~2026-11-16", "2026-11-18T09:00:00.000Z"],
  ["2026-11-23", "P~2026-11-16", "2026-11-23T09:00:00.000Z"],
  ["2026-11-25", "P~2026-11-16", "2026-11-25T09:00:00.000Z"],
  ["2026-11-30", "P~2026-11-30", "2026-11-30T10:00:00.000Z"],
  ["2026-12-07", "P~2026-11-30", "2026-12-07T10:00:00.000Z"],
  ["2026-12-14", "P~2026-11-30", "2026-12-14T10:00:00.000Z"]
];

test("B2. due divisioni della stessa serie, in tutti e due gli ordini: ogni figlia si ferma dove parte la successiva", () => {
  const { lateParent, earlyParent, lateChild, earlyChild } = splitFixture();
  const window = [utc("2026-11-01T00:00:00Z"), utc("2026-12-15T00:00:00Z")];
  for (const parent of [lateParent, earlyParent]) {
    for (const events of [[parent, lateChild, earlyChild], [earlyChild, lateChild, parent], [lateChild, parent, earlyChild]]) {
      eachDeviceZone((zone) => {
        const shown = expandWithRules(events, ...window).map((item) => [item.occurrenceDate, item.id, item.start]);
        assert.deepEqual(shown, SPLIT_EXPECTED, zone);
      });
    }
  }
  // Stesso dispositivo, una dopo l'altra: prima dal 30/11, poi dal 16/11 sulla madre già fermata.
  // La seconda assorbe la prima (regola 1): dal 16/11 vale solo la regola nuova, senza fine.
  let events = [weeklySeries({ id: "P" })];
  events = applyEditPlan(events, planEdit(events[0], events, "2026-11-30", "following", { start: "2026-11-30T10:00:00.000Z", end: "2026-11-30T11:00:00.000Z" }, { now: NOW })).events;
  const parent = events.find((item) => item.id === "P");
  events = applyEditPlan(events, planEdit(parent, events, "2026-11-16", "following", { repeat: { freq: "weekly", byWeekday: ["MO", "WE"] } }, { now: NOW })).events;
  assert.deepEqual(events.map((item) => item.id).sort(), ["P", "P~2026-11-16"]);
  assert.deepEqual(expandWithRules(events, ...window).map((item) => [item.occurrenceDate, item.id, item.start]), [
    ...SPLIT_EXPECTED.slice(0, 6),
    ...["2026-11-30", "2026-12-02", "2026-12-07", "2026-12-09", "2026-12-14"].map((date) => [date, "P~2026-11-16", `${date}T09:00:00.000Z`])
  ]);
  // I piani non toccano giorni che l'espansione nasconde (dopo l'inizio della figlia successiva).
  const all = [lateParent, lateChild, earlyChild];
  assert.deepEqual(planEdit(earlyChild, all, "2026-12-02", "this", { title: "x" }, { now: NOW }), { puts: [], deletes: [] });
  assert.deepEqual(planDelete(all, earlyChild.id, "2026-12-02", "this", { now: NOW }), { puts: [], deletes: [] });
  assert.equal(planEdit(earlyChild, all, "2026-11-25", "this", { title: "x" }, { now: NOW }).puts.length, 1);
});

test("S3. 'questa e le successive' elimina sempre anche le serie figlie e sorelle che partono dopo", () => {
  const parent = weeklySeries({ id: "P" });
  const split = planEdit(parent, [parent], "2026-11-30", "following", { title: "Nuovo titolo" }, { now: NOW });
  const child = split.puts.find((item) => item.splitFrom === "P");
  const childRow = planDelete(split.puts, child.id, "2026-12-07", "this", { now: NOW }).puts[0];
  const events = [...split.puts, childRow, base({ id: "other" })];
  const plan = planDelete(events, "P", "2026-11-09", "following", { now: NOW });
  assert.deepEqual(plan.deletes.sort(), [child.id, childRow.id].sort());
  const window = [utc("2026-11-01T00:00:00Z"), utc("2026-12-31T00:00:00Z")];
  assert.deepEqual(expandWithRules(applyEditPlan(events, plan).events, ...window).filter((item) => item.id !== "other").map((item) => item.occurrenceDate), ["2026-11-02"]);
  // Dalla figlia di mezzo: va via anche la sorella che parte dopo.
  const { lateParent, lateChild, earlyChild } = splitFixture();
  const family = [lateParent, lateChild, earlyChild];
  const fromMiddle = planDelete(family, earlyChild.id, "2026-11-23", "following", { now: NOW });
  assert.deepEqual(fromMiddle.deletes, [lateChild.id]);
  assert.deepEqual(expandWithRules(applyEditPlan(family, fromMiddle).events, ...window).map((item) => item.occurrenceDate), ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-18"]);
});

test("una riga con un inizio illeggibile non nasconde l'occorrenza della serie", () => {
  const series = weeklySeries({ id: "S" });
  const broken = base({ id: "S@2026-11-16", seriesId: "S", originalDate: "2026-11-16", title: "Rotta", start: "non-una-data" });
  const found = expandWithRules([series, broken], utc("2026-11-16T00:00:00Z"), utc("2026-11-17T00:00:00Z"));
  assert.deepEqual(found.map((item) => [item.id, item.title]), [["S", "Lezione"]]);
});

test("S2. 50 serie COUNT=999 con 30 occorrenze modificate ciascuna: un mese si espande in molto meno di 200 ms", () => {
  withTz("Europe/Rome", () => {
    const series = Array.from({ length: 50 }, (_, index) =>
      ruled({
        id: `c${index}`,
        start: new Date(Date.UTC(2024, 8, 2 + (index % 5), 7)).toISOString(),
        end: new Date(Date.UTC(2024, 8, 2 + (index % 5), 8)).toISOString(),
        timeZone: "Europe/Rome",
        repeat: { freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"], end: { type: "count", count: 999 } }
      })
    );
    const rows = series.flatMap((item) =>
      Array.from({ length: 30 }, (_, k) => {
        const date = new Date(Date.UTC(2025, 0, 6 + k * 7)).toISOString().slice(0, 10);
        return base({ id: occurrenceId(item.id, date), seriesId: item.id, originalDate: date, start: `${date}T10:00:00.000Z`, end: `${date}T11:00:00.000Z` });
      })
    );
    const events = [...series, ...rows];
    const window = [new Date(2026, 10, 1), new Date(2026, 11, 7)];
    assert.equal(expandWithRules(events, ...window).length, 50 * 25);
    let best = Number.POSITIVE_INFINITY;
    for (let run = 0; run < 3; run += 1) {
      const started = performance.now();
      expandWithRules(events, ...window);
      best = Math.min(best, performance.now() - started);
    }
    console.log(`# S2 benchmark: ${best.toFixed(1)} ms per call`);
    assert.ok(best < 200, `${best.toFixed(1)} ms`);
  });
});

// ---------------------------------------------------------------------------------------
// Revisione 2: le divisioni tengono la loro fine dopo modifiche, eliminazioni e fusi
// ---------------------------------------------------------------------------------------

const permutations = (list) =>
  list.length <= 1 ? [list] : list.flatMap((item, index) => permutations([...list.slice(0, index), ...list.slice(index + 1)]).map((rest) => [item, ...rest]));
const shownSeries = (events, window) => expandWithRules(events, ...window).map((item) => [item.occurrenceDate, item.id, item.start]);
const at = (dates, id, time) => dates.map((date) => [date, id, `${date}T${time}.000Z`]);

/** Il dispositivo che ha diviso dal 16/11 divide ancora la figlia dal 23/11 (solo l'orario), senza sapere del 30/11. */
const grandchildFixture = () => {
  const { lateParent, earlyParent, lateChild, earlyChild } = splitFixture();
  const plan = planEdit(earlyChild, [earlyParent, earlyChild], "2026-11-23", "following", { start: "2026-11-23T13:00:00.000Z", end: "2026-11-23T14:00:00.000Z" }, { now: NOW });
  return {
    lateParent,
    earlyParent,
    lateChild,
    middle: plan.puts.find((item) => item.id === earlyChild.id),
    grandchild: plan.puts.find((item) => item.splitFrom === earlyChild.id)
  };
};

test("B2 (a). una nipote fatta su un altro dispositivo si ferma dove parte la sorella della madre, in ogni ordine e fuso", () => {
  const { lateParent, earlyParent, lateChild, middle, grandchild } = grandchildFixture();
  assert.equal(grandchild.id, "P~2026-11-16~2026-11-23");
  assert.deepEqual(grandchild.repeat, { freq: "weekly", byWeekday: ["MO", "WE"] });
  const window = [utc("2026-11-01T00:00:00Z"), utc("2026-12-15T00:00:00Z")];
  const expected = [
    ...at(["2026-11-02", "2026-11-09"], "P", "09:00:00"),
    ...at(["2026-11-16", "2026-11-18"], "P~2026-11-16", "09:00:00"),
    ...at(["2026-11-23", "2026-11-25"], grandchild.id, "13:00:00"),
    ...at(["2026-11-30", "2026-12-07", "2026-12-14"], "P~2026-11-30", "10:00:00")
  ];
  for (const parent of [lateParent, earlyParent]) {
    for (const events of permutations([parent, lateChild, middle, grandchild])) {
      eachDeviceZone((zone) => assert.deepEqual(shownSeries(events, window), expected, `${zone} ${events.map((item) => item.id).join(", ")}`));
    }
  }
  // I piani vedono lo stesso taglio: dal 30/11 i giorni non sono più della nipote.
  const family = [lateParent, lateChild, middle, grandchild];
  assert.deepEqual(planEdit(grandchild, family, "2026-12-02", "this", { title: "x" }, { now: NOW }), { puts: [], deletes: [] });
  assert.deepEqual(planDelete(family, grandchild.id, "2026-12-02", "this", { now: NOW }), { puts: [], deletes: [] });
  assert.equal(planEdit(grandchild, family, "2026-11-25", "this", { title: "x" }, { now: NOW }).puts.length, 1);
});

test("B2 (b). eliminare una divisione non fa ricomparire la sorella prima né la madre: la loro fine si salva", () => {
  const { lateParent, earlyParent, lateChild, earlyChild } = splitFixture();
  const window = [utc("2026-11-01T00:00:00Z"), utc("2027-01-01T00:00:00Z")];
  for (const parent of [lateParent, earlyParent]) {
    const family = [parent, lateChild, earlyChild];
    // "Questa e le successive" (o "tutte") dalla prima lezione del 30/11.
    for (const scope of ["following", "all"]) {
      const plan = planDelete(family, lateChild.id, "2026-11-30", scope, { now: NOW });
      assert.deepEqual(plan.deletes, [lateChild.id], scope);
      assert.deepEqual(plan.puts.map((item) => [item.id, item.repeat]), [[earlyChild.id, { freq: "weekly", byWeekday: ["MO", "WE"], end: { type: "until", date: "2026-11-29" } }]], scope);
      eachDeviceZone((zone) =>
        assert.deepEqual(
          expandWithRules(applyEditPlan(family, plan).events, ...window).map((item) => item.occurrenceDate),
          ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-18", "2026-11-23", "2026-11-25"],
          `${scope} ${zone}`
        )
      );
    }
    // Tutta la serie del 16/11: la madre resta ferma al 15/11 (si riscrive solo se la sua regola andava oltre).
    const plan = planDelete(family, earlyChild.id, "2026-11-18", "all", { now: NOW });
    const parentPut = plan.puts.find((item) => item.id === "P");
    if (parent === lateParent) assert.deepEqual(parentPut?.repeat.end, { type: "until", date: "2026-11-15" });
    else assert.equal(parentPut, undefined, "già ferma al 15/11: non si riscrive");
    const after = applyEditPlan(family, plan).events;
    assert.equal(after.find((item) => item.id === lateChild.id), lateChild, "le altre serie restano lo stesso oggetto");
    eachDeviceZone((zone) =>
      assert.deepEqual(
        expandWithRules(after, ...window).map((item) => item.occurrenceDate),
        ["2026-11-02", "2026-11-09", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"],
        zone
      )
    );
  }
  // Il caso di s3.mjs: dalla nipote in giù resta tutto fermo dopo aver tolto la sorella della madre.
  const { lateParent: p, lateChild: late, middle, grandchild } = grandchildFixture();
  const family = [p, late, middle, grandchild];
  const plan = planDelete(family, late.id, "2026-11-30", "following", { now: NOW });
  assert.deepEqual(plan.puts.map((item) => [item.id, item.repeat.end]), [[grandchild.id, { type: "until", date: "2026-11-29" }]]);
  assert.deepEqual(expandWithRules(applyEditPlan(family, plan).events, ...window).map((item) => item.occurrenceDate), ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-18", "2026-11-23", "2026-11-25"]);
});

test("B2 (b). dividere una serie fermata da una sorella della madre: la figlia nuova finisce lì, salvato", () => {
  const { lateParent, lateChild, middle, grandchild } = grandchildFixture();
  const family = [lateParent, lateChild, middle, grandchild];
  const plan = planEdit(grandchild, family, "2026-11-25", "following", { start: "2026-11-25T15:00:00.000Z", end: "2026-11-25T16:00:00.000Z" }, { now: NOW });
  const child = plan.puts.find((item) => item.splitFrom === grandchild.id);
  assert.deepEqual(child.repeat, { freq: "weekly", byWeekday: ["MO", "WE"], end: { type: "until", date: "2026-11-29" } });
  assert.equal(plan.deletes.includes(lateChild.id), false, "la sorella della madre non è nata da questa serie");
  const window = [utc("2026-11-01T00:00:00Z"), utc("2026-12-15T00:00:00Z")];
  const after = applyEditPlan(family, plan).events;
  assert.deepEqual(shownSeries(after, window).slice(4), [
    ["2026-11-23", grandchild.id, "2026-11-23T13:00:00.000Z"],
    ["2026-11-25", child.id, "2026-11-25T15:00:00.000Z"],
    ...at(["2026-11-30", "2026-12-07", "2026-12-14"], "P~2026-11-30", "10:00:00")
  ]);
  // Anche se poi la sorella della madre sparisce, la figlia nuova non va oltre.
  const removed = applyEditPlan(after, planDelete(after, lateChild.id, "2026-11-30", "all", { now: NOW })).events;
  assert.deepEqual(expandWithRules(removed, ...window).map((item) => item.occurrenceDate).slice(-2), ["2026-11-23", "2026-11-25"]);
});

test("Regola 1. 'questa e le successive' con una regola nuova assorbe le divisioni successive e le loro righe; senza, le lascia (R1-S1)", () => {
  const window = [utc("2026-11-01T00:00:00Z"), utc("2026-12-15T00:00:00Z")];
  // Il flusso della revisione su un solo dispositivo: 30/11 nuovo orario, 16/11 lun e mer, 23/11 nuovo orario.
  let events = [weeklySeries({ id: "P" })];
  events = applyEditPlan(events, planEdit(events[0], events, "2026-11-30", "following", { start: "2026-11-30T10:00:00.000Z", end: "2026-11-30T11:00:00.000Z" }, { now: NOW })).events;
  events = applyEditPlan(events, planDelete(events, "P~2026-11-30", "2026-12-07", "this", { now: NOW })).events;
  const step2 = planEdit(events.find((item) => item.id === "P"), events, "2026-11-16", "following", { repeat: { freq: "weekly", byWeekday: ["MO", "WE"] } }, { now: NOW });
  assert.deepEqual(step2.deletes.sort(), ["P~2026-11-30", "P~2026-11-30@2026-12-07"]);
  // La lezione cancellata del 7/12 resta cancellata: la riga passa alla serie nuova.
  assert.deepEqual(step2.puts.filter((item) => item.seriesId).map((item) => [item.id, item.cancelled]), [["P~2026-11-16@2026-12-07", true]]);
  events = applyEditPlan(events, step2).events;
  const middle = events.find((item) => item.id === "P~2026-11-16");
  events = applyEditPlan(events, planEdit(middle, events, "2026-11-23", "following", { start: "2026-11-23T13:00:00.000Z", end: "2026-11-23T14:00:00.000Z" }, { now: NOW })).events;
  const expected = [
    ...at(["2026-11-02", "2026-11-09"], "P", "09:00:00"),
    ...at(["2026-11-16", "2026-11-18"], "P~2026-11-16", "09:00:00"),
    ...at(["2026-11-23", "2026-11-25", "2026-11-30", "2026-12-02", "2026-12-09", "2026-12-14"], "P~2026-11-16~2026-11-23", "13:00:00")
  ];
  for (const list of permutations(events)) eachDeviceZone((zone) => assert.deepEqual(shownSeries(list, window), expected, zone));

  // Solo il titolo, dopo una divisione con un orario suo: la divisione resta (stessi giorni, stessa
  // ora) e prende il titolo; la parte nuova si ferma dove parte lei.
  let renamed = [weeklySeries({ id: "P" })];
  renamed = applyEditPlan(renamed, planEdit(renamed[0], renamed, "2026-11-30", "following", { start: "2026-11-30T10:00:00.000Z", end: "2026-11-30T11:00:00.000Z" }, { now: NOW })).events;
  const title = planEdit(renamed.find((item) => item.id === "P"), renamed, "2026-11-16", "following", { title: "Nuovo" }, { now: NOW });
  assert.deepEqual(title.deletes, []);
  assert.deepEqual(title.puts.find((item) => item.id === "P~2026-11-16").repeat, { freq: "weekly", end: { type: "until", date: "2026-11-29" } });
  assert.deepEqual(title.puts.find((item) => item.id === "P~2026-11-30").repeat, { freq: "weekly" });
  assert.deepEqual(
    expandWithRules(applyEditPlan(renamed, title).events, ...window).map((item) => [item.occurrenceDate, item.title, item.start]),
    [
      ["2026-11-02", "Lezione", "2026-11-02T09:00:00.000Z"],
      ["2026-11-09", "Lezione", "2026-11-09T09:00:00.000Z"],
      ...["2026-11-16", "2026-11-23"].map((date) => [date, "Nuovo", `${date}T09:00:00.000Z`]),
      ...["2026-11-30", "2026-12-07", "2026-12-14"].map((date) => [date, "Nuovo", `${date}T10:00:00.000Z`])
    ]
  );
  // Con il conteggio: 10 volte, divise 4 + 6; il nuovo titolo dal 16/11 vale per tutte le 8 rimaste.
  let counted = [weeklySeries({ id: "C", repeat: { freq: "weekly", end: { type: "count", count: 10 } } })];
  counted = applyEditPlan(counted, planEdit(counted[0], counted, "2026-11-30", "following", { start: "2026-11-30T10:00:00.000Z", end: "2026-11-30T11:00:00.000Z" }, { now: NOW })).events;
  counted = applyEditPlan(counted, planEdit(counted.find((item) => item.id === "C"), counted, "2026-11-16", "following", { title: "Nuovo" }, { now: NOW })).events;
  const all = expandWithRules(counted, utc("2026-11-01T00:00:00Z"), utc("2027-03-01T00:00:00Z"));
  assert.equal(all.length, 10);
  assert.deepEqual([all.filter((item) => item.title === "Nuovo").length, all.at(-1).occurrenceDate], [8, "2027-01-04"]);
});

test("R1-S1 (revisione finale). Rinominare dal 16/11 una serie passata a lun e ven dal 30/11: restano le 16 date, venerdì compresi", () => {
  const window = [utc("2026-11-01T00:00:00Z"), utc("2027-01-09T00:00:00Z")];
  const view = (list) => expandWithRules(list, ...window).map((item) => [item.occurrenceDate, item.title]);
  let events = [weeklySeries({ id: "P" })];
  events = applyEditPlan(events, planEdit(events[0], events, "2026-11-30", "following", { repeat: { freq: "weekly", byWeekday: ["MO", "FR"] } }, { now: NOW })).events;
  const before = view(events);
  assert.equal(before.length, 16);
  eachDeviceZone((zone) => {
    const plan = planEdit(events.find((item) => item.id === "P"), events, "2026-11-16", "following", { title: "Nuovo" }, { now: NOW });
    assert.deepEqual(plan.deletes, [], zone);
    const after = applyEditPlan(events, plan).events;
    assert.deepEqual(view(after).map(([date]) => date), before.map(([date]) => date), zone);
    assert.deepEqual(view(after).filter(([date]) => date >= "2026-11-16").map(([, title]) => title), Array(14).fill("Nuovo"), zone);
    assert.deepEqual(after.find((item) => item.id === "P~2026-11-30").repeat, { freq: "weekly", byWeekday: ["MO", "FR"] }, zone);
  });
  // Con una regola nuova dal 16/11 la divisione si assorbe: i venerdì spariscono (lo dice scopeImpact).
  const ruledPlan = planEdit(events.find((item) => item.id === "P"), events, "2026-11-16", "following", { repeat: { freq: "weekly", byWeekday: ["MO", "WE"] } }, { now: NOW });
  assert.deepEqual(ruledPlan.deletes, ["P~2026-11-30"]);
});

test("R1-S1 (revisione finale). Una divisione spostata al martedì (o alla domenica) resta lì quando si rinomina da prima", () => {
  // Divisa dal 30/11 e spostata al martedì (o alla domenica), poi fermata con "elimina i successivi".
  for (const [moved, stop, lastShown] of [
    ["2026-12-01", "2027-01-12", "2027-01-05"],
    ["2026-11-29", "2027-01-10", "2027-01-03"]
  ]) {
    let events = [weeklySeries({ id: "P" })];
    events = applyEditPlan(events, planEdit(events[0], events, "2026-11-30", "following", { start: `${moved}T09:00:00.000Z`, end: `${moved}T10:00:00.000Z` }, { now: NOW })).events;
    events = applyEditPlan(events, planDelete(events, "P~2026-11-30", stop, "following", { now: NOW })).events;
    const shown = (list) => expandWithRules(list, utc("2026-11-10T00:00:00Z"), utc("2027-06-01T00:00:00Z")).map((item) => [item.occurrenceDate, item.title]);
    const before = shown(events);
    assert.deepEqual([before.length, before.at(-1)[0]], [8, lastShown], moved);
    const renamed = applyEditPlan(events, planEdit(events.find((item) => item.id === "P"), events, "2026-11-16", "following", { title: "Nuovo" }, { now: NOW })).events;
    eachDeviceZone((zone) => {
      assert.deepEqual(shown(renamed), before.map(([date]) => [date, "Nuovo"]), `${moved} ${zone}`);
    });
    assert.deepEqual(renamed.find((item) => item.id === "P~2026-11-16").repeat, { freq: "weekly", end: { type: "until", date: "2026-11-29" } }, moved);
    assert.equal(renamed.find((item) => item.id === "P~2026-11-30").start, `${moved}T09:00:00.000Z`, moved);
  }
});

test("R1-S1 (revisione finale). Nuovo orario dal 16/11: lo prende la parte successiva con la stessa ora, non quella con un orario suo", () => {
  const window = [utc("2026-11-01T00:00:00Z"), utc("2027-01-01T00:00:00Z")];
  const view = (list) => expandWithRules(list, ...window).map((item) => [item.occurrenceDate, item.title, item.start.slice(11, 16)]);
  // Serie alle 9; dal 30/11 solo il titolo (A, stessa ora); dal 14/12 della parte A un orario suo (B, alle 10).
  let events = [weeklySeries({ id: "P" })];
  events = applyEditPlan(events, planEdit(events[0], events, "2026-11-30", "following", { title: "A" }, { now: NOW })).events;
  const a = events.find((item) => item.id === "P~2026-11-30");
  events = applyEditPlan(events, planEdit(a, events, "2026-12-14", "following", { title: "B", start: "2026-12-14T10:00:00.000Z", end: "2026-12-14T11:00:00.000Z" }, { now: NOW })).events;
  // Righe: in A il 7/12 rinominato; in B il 21/12 annullato e il 28/12 rinominato.
  events = applyEditPlan(events, planEdit(events.find((item) => item.id === a.id), events, "2026-12-07", "this", { title: "Esercitazione A" }, { now: NOW })).events;
  const b = events.find((item) => item.id === "P~2026-11-30~2026-12-14");
  events = applyEditPlan(events, planDelete(events, b.id, "2026-12-21", "this", { now: NOW })).events;
  events = applyEditPlan(events, planEdit(b, events, "2026-12-28", "this", { title: "Esercitazione B" }, { now: NOW })).events;
  eachDeviceZone((zone) => {
    const plan = planEdit(events.find((item) => item.id === "P"), events, "2026-11-16", "following", { title: "Nuovo", start: "2026-11-16T12:00:00.000Z", end: "2026-11-16T13:30:00.000Z" }, { now: NOW });
    assert.deepEqual(plan.deletes, [`${a.id}@2026-12-07`], `${zone}: la riga modificata di A si perde con l'ora nuova`);
    const after = applyEditPlan(events, plan).events;
    assert.deepEqual(
      view(after),
      [
        ["2026-11-02", "Lezione", "09:00"],
        ["2026-11-09", "Lezione", "09:00"],
        ["2026-11-16", "Nuovo", "12:00"],
        ["2026-11-23", "Nuovo", "12:00"],
        ["2026-11-30", "Nuovo", "12:00"],
        ["2026-12-07", "Nuovo", "12:00"],
        ["2026-12-14", "Nuovo", "10:00"],
        ["2026-12-28", "Esercitazione B", "10:00"]
      ],
      zone
    );
    const end = (id) => {
      const item = after.find((event) => event.id === id);
      return Date.parse(item.end) - Date.parse(item.start);
    };
    assert.deepEqual([end(a.id), end(b.id)], [90 * 60_000, 60 * 60_000], zone);
  });
  // Solo l'ora, senza altri campi: la parte con un orario suo non si riscrive.
  const timeOnly = planEdit(events.find((item) => item.id === "P"), events, "2026-11-16", "following", { start: "2026-11-16T12:00:00.000Z", end: "2026-11-16T13:00:00.000Z" }, { now: NOW });
  assert.deepEqual(timeOnly.puts.map((item) => item.id).filter((id) => id.startsWith("P~2026-11-30")), [a.id]);
});

test("R1-S1 (revisione finale). Anche la sorella di un antenato che ferma la parte modificata prende il titolo", () => {
  const window = [utc("2026-11-01T00:00:00Z"), utc("2026-12-15T00:00:00Z")];
  let events = [weeklySeries({ id: "P" })];
  const edit = (id, date, patch) => {
    events = applyEditPlan(events, planEdit(events.find((item) => item.id === id), events, date, "following", patch, { now: NOW })).events;
  };
  // R dal 30/11, poi P dal 9/11 (si ferma a R), poi la parte del 9/11 dal 16/11: R è la sorella della sua madre.
  edit("P", "2026-11-30", { title: "R" });
  edit("P", "2026-11-09", { title: "Q" });
  edit("P~2026-11-09", "2026-11-16", { title: "E" });
  edit("P~2026-11-09~2026-11-16", "2026-11-23", { title: "Z" });
  eachDeviceZone((zone) =>
    assert.deepEqual(
      expandWithRules(events, ...window).map((item) => [item.occurrenceDate, item.title]),
      [["2026-11-02", "Lezione"], ["2026-11-09", "Q"], ["2026-11-16", "E"], ["2026-11-23", "Z"], ["2026-11-30", "Z"], ["2026-12-07", "Z"], ["2026-12-14", "Z"]],
      zone
    )
  );
});

test("R2-A (R1-S1). rinominando dal 16/11 la divisione successiva resta, con le sue cancellate e le sue modifiche", () => {
  const window = [utc("2026-11-01T00:00:00Z"), utc("2027-01-01T00:00:00Z")];
  const view = (events) => expandWithRules(events, ...window).map((item) => [item.occurrenceDate, item.title, item.start.slice(11, 16)]);
  // Divisione dal 30/11 con solo il titolo (stessa ora) o con un orario nuovo.
  for (const [label, splitPatch, time] of [
    ["stessa ora", { title: "B" }, "09:00"],
    ["ora nuova", { title: "B", start: "2026-11-30T10:00:00.000Z", end: "2026-11-30T11:00:00.000Z" }, "10:00"]
  ]) {
    eachDeviceZone((zone) => {
      let events = [weeklySeries({ id: "P" })];
      events = applyEditPlan(events, planDelete(events, "P", "2026-11-23", "this", { now: NOW })).events;
      events = applyEditPlan(events, planEdit(events.find((item) => item.id === "P"), events, "2026-11-30", "following", splitPatch, { now: NOW })).events;
      const split = events.find((item) => item.id === "P~2026-11-30");
      events = applyEditPlan(events, planDelete(events, split.id, "2026-12-07", "this", { now: NOW })).events;
      events = applyEditPlan(events, planEdit(split, events, "2026-12-14", "this", { title: "Esercitazione" }, { now: NOW })).events;
      // Rinomina dal 16/11, solo il titolo.
      const plan = planEdit(events.find((item) => item.id === "P"), events, "2026-11-16", "following", { title: "C" }, { now: NOW });
      // Si sposta solo la cancellata del 23/11 (alla parte nuova); la divisione e le sue righe restano.
      assert.deepEqual(plan.deletes, ["P@2026-11-23"], `${label} ${zone}`);
      const after = applyEditPlan(events, plan).events;
      assert.deepEqual(
        view(after),
        [
          ["2026-11-02", "Lezione", "09:00"],
          ["2026-11-09", "Lezione", "09:00"],
          ["2026-11-16", "C", "09:00"],
          ["2026-11-30", "C", time],
          ["2026-12-14", "Esercitazione", time],
          ["2026-12-21", "C", time],
          ["2026-12-28", "C", time]
        ],
        `${label} ${zone}`
      );
      const ids = plan.puts.map((item) => item.id);
      assert.equal(new Set(ids).size, ids.length);
    });
  }
});

test("R2-B (R1-S1). rinominando una parte, quella dopo (da un altro dispositivo, fermata) resta com'era", () => {
  const window = [utc("2026-11-01T00:00:00Z"), utc("2027-03-01T00:00:00Z")];
  // Due dispositivi: A divide dal 30/11 e poi elimina "questa e le successive" dal 14/12 (fine 13/12);
  // B, senza saperlo, divide dal 16/11 con lun e mer senza fine.
  const parent = weeklySeries({ id: "P" });
  let a = applyEditPlan([parent], planEdit(parent, [parent], "2026-11-30", "following", { start: "2026-11-30T10:00:00.000Z", end: "2026-11-30T11:00:00.000Z" }, { now: NOW })).events;
  a = applyEditPlan(a, planDelete(a, "P~2026-11-30", "2026-12-14", "following", { now: NOW })).events;
  const b = planEdit(parent, [parent], "2026-11-16", "following", { repeat: { freq: "weekly", byWeekday: ["MO", "WE"] } }, { now: NOW }).puts;
  const merged = [...a, ...b.filter((item) => item.id !== "P")];
  const middle = merged.find((item) => item.id === "P~2026-11-16");
  const shown = (list) => expandWithRules(list, ...window).map((item) => [item.occurrenceDate, item.start.slice(11, 16)]);
  eachDeviceZone((zone) => {
    const before = shown(merged);
    assert.equal(before.at(-1)[0], "2026-12-07", zone);
    // Rinomina dal 23/11: lun e mer fino al 29/11 (dove parte la parte di A), poi i lunedì di A alle 10.
    const plan = planEdit(middle, merged, "2026-11-23", "following", { title: "C" }, { now: NOW });
    assert.deepEqual(plan.puts.find((item) => item.splitFrom === middle.id).repeat, { freq: "weekly", byWeekday: ["MO", "WE"], end: { type: "until", date: "2026-11-29" } }, zone);
    const after = applyEditPlan(merged, plan).events;
    assert.deepEqual(shown(after), before, zone);
    assert.deepEqual(before.filter(([date]) => date >= "2026-11-23"), [["2026-11-23", "09:00"], ["2026-11-25", "09:00"], ["2026-11-30", "10:00"], ["2026-12-07", "10:00"]], zone);
    assert.equal(after.find((item) => item.id === "P~2026-11-30").title, "C", zone);
    // Dalla prima occorrenza (tutta la parte): la regola resta senza fine, le date restano quelle.
    const first = planEdit(middle, merged, "2026-11-16", "following", { title: "C" }, { now: NOW });
    assert.deepEqual(first.puts.find((item) => item.id === middle.id).repeat, { freq: "weekly", byWeekday: ["MO", "WE"] }, zone);
    assert.deepEqual(shown(applyEditPlan(merged, first).events), before, zone);
  });
});

test("S4. tutto il giorno salvato a Roma e fissato da Londra, New York o Tokyo: un giorno per occorrenza, stessa data per tutti", () => {
  // Salvato prima del nuovo motore a Roma: ogni lunedì dal 23/11, mezzanotte di Roma in UTC.
  const old = base({ id: "W", allDay: true, recurrence: "weekly", start: "2026-11-22T23:00:00.000Z", end: "2026-11-23T23:00:00.000Z" });
  const window = [utc("2026-11-20T00:00:00Z"), utc("2026-12-16T00:00:00Z")];
  const days = (zone, events) =>
    withTz(zone, () =>
      expandWithRules(events, ...window).map((item) => {
        assert.equal(Date.parse(item.start), localMidnight(item.occurrenceDate).getTime(), `${zone} ${item.occurrenceDate}: da mezzanotte`);
        assert.equal(Date.parse(item.end), localMidnight(civilAddDays(item.occurrenceDate, 1)).getTime(), `${zone} ${item.occurrenceDate}: un giorno`);
        return [item.occurrenceDate, item.title];
      })
    );
  for (const zone of ["Europe/London", "America/New_York", "Asia/Tokyo"]) {
    let events = [old];
    withTz(zone, () => {
      // Prima di fissare: il giorno dell'occorrenza è quello della mezzanotte più vicina, come dopo.
      assert.deepEqual(expandWithRules(events, ...window).map((item) => item.occurrenceDate), ["2026-11-23", "2026-11-30", "2026-12-07", "2026-12-14"], zone);
      const edit = planEdit(old, events, "2026-11-30", "this", { title: "Spostata" }, { now: NOW });
      assert.equal(edit.puts.find((item) => item.id === "W")?.timeZone, zone);
      events = applyEditPlan(events, edit).events;
      events = applyEditPlan(events, planDelete(events, "W", "2026-12-07", "this", { now: NOW })).events;
    });
    for (const reader of ["Europe/Rome", zone]) {
      assert.deepEqual(days(reader, events), [["2026-11-23", "Lezione"], ["2026-11-30", "Spostata"], ["2026-12-14", "Lezione"]], `${zone} -> ${reader}`);
    }
  }
  // Divisione da Londra e "questa e le successive" eliminata da Tokyo: stessi giorni a Roma.
  const split = withTz("Europe/London", () => applyEditPlan([old], planEdit(old, [old], "2026-11-30", "following", { title: "Nuova" }, { now: NOW })).events);
  assert.deepEqual(days("Europe/Rome", split), [["2026-11-23", "Lezione"], ["2026-11-30", "Nuova"], ["2026-12-07", "Nuova"], ["2026-12-14", "Nuova"]]);
  const cut = withTz("Asia/Tokyo", () => applyEditPlan([old], planDelete([old], "W", "2026-12-07", "following", { now: NOW })).events);
  assert.deepEqual(days("Europe/Rome", cut), [["2026-11-23", "Lezione"], ["2026-11-30", "Lezione"]]);
});

test("N3 (revisione finale). Ricerca: ogni serie una volta, un giorno cambiato solo se la serie non c'è già, niente giorni annullati", () => {
  let events = [weeklySeries({ id: "P", title: "Anatomia" }), weeklySeries({ id: "Q", title: "Fisica", sourceUid: "uid-2" })];
  // Anatomia: il 16/11 spostato alle 11, il 23/11 annullato. Fisica: il 16/11 rinominato «Esercitazione di anatomia».
  events = applyEditPlan(events, planEdit(events[0], events, "2026-11-16", "this", { start: "2026-11-16T10:00:00.000Z", end: "2026-11-16T11:00:00.000Z" }, { now: NOW })).events;
  events = applyEditPlan(events, planDelete(events, "P", "2026-11-23", "this", { now: NOW })).events;
  events = applyEditPlan(events, planEdit(events.find((item) => item.id === "Q"), events, "2026-11-16", "this", { title: "Esercitazione di anatomia" }, { now: NOW })).events;
  events = [...events, weeklySeries({ id: "old", title: "Anatomia (vecchia)", archived: true, sourceUid: "uid-3" })];
  const find = (word) => searchHits(events, (item) => String(item.title).toLowerCase().includes(word)).map((item) => item.id);
  // «anatomia»: la serie una volta (non il giorno spostato né quello annullato), più il giorno di Fisica rinominato.
  assert.deepEqual(find("anatomia"), ["P", "Q@2026-11-16"]);
  assert.deepEqual(find("fisica"), ["Q"]);
  assert.deepEqual(find("esercitazione"), ["Q@2026-11-16"]);
});
