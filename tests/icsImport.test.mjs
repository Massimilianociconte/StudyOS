// Importazione .ics: file in stile Google, Apple (con VTIMEZONE) e Outlook (fusi Windows), EXDATE,
// RECURRENCE-ID, VALARM; unione con il calendario senza doppioni (recurrence.md §7.2 caso 12).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildIcs, decodeIcsBytes, icsImportItems, mergeIcsImport, parseIcs } from "../src/lib/ics.ts";
import { importButton, previewWarnings } from "../src/lib/calendarGuide.ts";
import { publicEntity } from "../src/agent/project.ts";
import { prepareSharedWrite, sharedPushBatches, withoutProtectedKeys } from "../src/lib/sharing.ts";
import { CALENDAR_GUIDE_TEXT } from "../src/lib/labels/calendarGuide.ts";
import { applyEditPlan, applyRepeatFields, expandEvents, planDelete, planEdit } from "../src/lib/repeat.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const ics = (...rows) => ["BEGIN:VCALENDAR", "VERSION:2.0", ...rows.flat(), "END:VCALENDAR"].join("\r\n");

const ROME_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Rome",
  "X-LIC-LOCATION:Europe/Rome",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE"
];

const GOOGLE = ics(
  "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Università",
  "X-WR-TIMEZONE:Europe/Rome",
  ROME_VTIMEZONE,
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Rome:20261102T090000",
  "DTEND;TZID=Europe/Rome:20261102T110000",
  "RRULE:FREQ=WEEKLY;WKST=MO;UNTIL=20261218T225959Z;BYDAY=MO,WE",
  "EXDATE;TZID=Europe/Rome:20261209T090000",
  "DTSTAMP:20261111T100000Z",
  "UID:5f3k2j1h0g@google.com",
  "DESCRIPTION:",
  "LOCATION:Aula G21",
  "SEQUENCE:0",
  "STATUS:CONFIRMED",
  "SUMMARY:Anatomia",
  "TRANSP:OPAQUE",
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "DESCRIPTION:This is an event reminder",
  "TRIGGER:-P0DT0H30M0S",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;TZID=Europe/Rome:20261118T140000",
  "DTEND;TZID=Europe/Rome:20261118T160000",
  "DTSTAMP:20261111T100000Z",
  "UID:5f3k2j1h0g@google.com",
  "RECURRENCE-ID;TZID=Europe/Rome:20261118T090000",
  "SUMMARY:Anatomia (recupero)",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20261208",
  "DTEND;VALUE=DATE:20261209",
  "UID:holiday1@google.com",
  "SUMMARY:Immacolata",
  "TRANSP:TRANSPARENT",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "DTSTART;VALUE=DATE:20000229",
  "DTEND;VALUE=DATE:20000301",
  "RRULE:FREQ=YEARLY",
  "UID:bday@google.com",
  "SUMMARY:Compleanno di Luca",
  "END:VEVENT"
);

const APPLE = ics(
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Personale",
  "PRODID:-//Apple Inc.//macOS 15.1//EN",
  "X-WR-TIMEZONE:Europe/Rome",
  "CALSCALE:GREGORIAN",
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Rome",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "DTSTART:19810329T020000",
  "TZNAME:CEST",
  "TZOFFSETTO:+0200",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "DTSTART:19961027T030000",
  "TZNAME:CET",
  "TZOFFSETTO:+0100",
  "END:STANDARD",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "CREATED:20261001T080000Z",
  "UID:8C1F2D3E-0A1B-4C5D-9E8F-112233445566",
  "RRULE:FREQ=MONTHLY;BYDAY=-1FR",
  "DTEND;TZID=Europe/Rome:20261127T190000",
  "TRANSP:OPAQUE",
  "X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC",
  "SUMMARY:Cena di fine mese",
  "DTSTAMP:20261101T080000Z",
  "DTSTART;TZID=Europe/Rome:20261127T180000",
  "SEQUENCE:0",
  "BEGIN:VALARM",
  "X-WR-ALARMUID:A1",
  "TRIGGER:-PT1H",
  "ATTACH;VALUE=URI:Chord",
  "ACTION:AUDIO",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:9D2E3F40-1B2C-4D5E-8F90-223344556677",
  "RRULE:FREQ=MONTHLY;COUNT=5;BYDAY=1MO",
  "DTSTART;TZID=Europe/Rome:20261102T200000",
  "DTEND;TZID=Europe/Rome:20261102T210000",
  "SUMMARY:Riunione del gruppo",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:AAAA0000-1111-2222-3333-444455556666",
  "DTSTART;VALUE=DATE:20261224",
  "DTEND;VALUE=DATE:20261227",
  "SUMMARY:Vacanze di Natale",
  "BEGIN:VALARM",
  "TRIGGER:-PT15H",
  "ACTION:DISPLAY",
  "DESCRIPTION:Promemoria",
  "END:VALARM",
  "END:VEVENT"
);

const OUTLOOK = ics(
  "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN",
  "METHOD:PUBLISH",
  "X-MS-OLK-FORCEINSPECTOROPEN:TRUE",
  "BEGIN:VTIMEZONE",
  "TZID:W. Europe Standard Time",
  "BEGIN:STANDARD",
  "DTSTART:16011028T030000",
  "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "END:STANDARD",
  "BEGIN:DAYLIGHT",
  "DTSTART:16010325T020000",
  "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "END:DAYLIGHT",
  "END:VTIMEZONE",
  "BEGIN:VEVENT",
  "CLASS:PUBLIC",
  'DTEND;TZID="W. Europe Standard Time":20261103T110000',
  "DTSTAMP:20261101T090000Z",
  'DTSTART;TZID="W. Europe Standard Time":20261103T100000',
  "PRIORITY:5",
  "RRULE:FREQ=WEEKLY;COUNT=10;BYDAY=TU",
  "SEQUENCE:0",
  "SUMMARY;LANGUAGE=it:Ricevimento",
  "TRANSP:OPAQUE",
  "UID:040000008200E00074C5B7101A82E00800000000A0B1C2D3E4F5",
  "X-MICROSOFT-CDO-BUSYSTATUS:BUSY",
  "BEGIN:VALARM",
  "TRIGGER:-PT15M",
  "ACTION:DISPLAY",
  "DESCRIPTION:Reminder",
  "END:VALARM",
  "END:VEVENT",
  "BEGIN:VEVENT",
  'DTSTART;TZID="W. Europe Standard Time":20261201T000000',
  'DTEND;TZID="W. Europe Standard Time":20261202T000000',
  "SUMMARY:Giornata di orientamento",
  "UID:040000008200E00074C5B7101A82E00800000000FFFFFFFF",
  "X-MICROSOFT-CDO-ALLDAYEVENT:TRUE",
  "END:VEVENT"
);

test("Google: una serie su più giorni, EXDATE, RECURRENCE-ID, VALARM, tutto il giorno e il 29 febbraio", () => {
  const { events, warnings } = parseIcs(GOOGLE, { timeZone: "America/New_York" });
  assert.deepEqual(warnings, []);
  assert.equal(events.length, 4);
  const [master, override, holiday, birthday] = events;
  assert.equal(master.uid, "5f3k2j1h0g@google.com");
  assert.equal(master.timeZone, "Europe/Rome");
  assert.equal(master.start, "2026-11-02T08:00:00.000Z");
  assert.equal(master.end, "2026-11-02T10:00:00.000Z");
  assert.deepEqual(master.repeat, { freq: "weekly", byWeekday: ["MO", "WE"], end: { type: "until", date: "2026-12-18" } });
  assert.deepEqual(master.exdates, ["20261209T080000Z"]);
  assert.deepEqual(master.reminders, [{ minutesBefore: 30 }]);
  // R3-F1: il luogo va nel suo campo, non nella descrizione.
  assert.equal(master.location, "Aula G21");
  assert.doesNotMatch(master.description, /Luogo/);
  assert.equal(override.uid, master.uid);
  assert.equal(override.recurrenceId, "20261118T080000Z");
  assert.equal(override.start, "2026-11-18T13:00:00.000Z");
  assert.equal(holiday.allDay, true);
  assert.equal(holiday.start, "2026-12-08T00:00:00");
  assert.equal(holiday.end, "2026-12-09T00:00:00");
  assert.equal(birthday.start, "2000-02-29T00:00:00");
  assert.deepEqual(birthday.repeat, { freq: "yearly", yearlyLeap: "skip" });
});

test("Apple con VTIMEZONE: ultimo venerdì, primo lunedì per 5 volte, vacanza di 3 giorni con promemoria", () => {
  const { events, warnings } = parseIcs(APPLE, { timeZone: "UTC" });
  assert.deepEqual(warnings, []);
  assert.equal(events.length, 3);
  const [dinner, meeting, holidays] = events;
  assert.equal(dinner.start, "2026-11-27T17:00:00.000Z");
  assert.deepEqual(dinner.repeat, { freq: "monthly", monthly: { by: "weekday", nth: -1, weekday: "FR" } });
  assert.deepEqual(dinner.reminders, [{ minutesBefore: 60 }]);
  assert.deepEqual(meeting.repeat, { freq: "monthly", monthly: { by: "weekday", nth: 1, weekday: "MO" }, end: { type: "count", count: 5 } });
  assert.equal(holidays.allDay, true);
  assert.equal(holidays.end, "2026-12-27T00:00:00");
  assert.deepEqual(holidays.reminders, [{ daysBefore: 1, at: "09:00" }]);
});

test("Outlook: fuso Windows riconosciuto anche su un dispositivo a New York; tutto il giorno di Outlook", () => {
  for (const device of ["America/New_York", "Asia/Tokyo", "Europe/Rome"]) {
    const { events, warnings } = parseIcs(OUTLOOK, { timeZone: device });
    assert.deepEqual(warnings, [], device);
    const [office, day] = events;
    assert.equal(office.title, "Ricevimento");
    assert.equal(office.start, "2026-11-03T09:00:00.000Z", device);
    assert.equal(office.timeZone, "Europe/Berlin");
    assert.deepEqual(office.repeat, { freq: "weekly", byWeekday: ["TU"], end: { type: "count", count: 10 } });
    assert.deepEqual(office.reminders, [{ minutesBefore: 15 }]);
    assert.equal(day.allDay, true);
    assert.equal(day.start, "2026-12-01T00:00:00");
    assert.equal(day.end, "2026-12-02T00:00:00");
  }
});

test("fuso con un nome inventato: si usano le regole del suo VTIMEZONE e un fuso IANA equivalente", () => {
  const custom = ics(
    "BEGIN:VTIMEZONE",
    "TZID:Ora dell'Europa centrale",
    "BEGIN:STANDARD",
    "DTSTART:16011028T030000",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:16010325T020000",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "END:DAYLIGHT",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    "UID:c1",
    `DTSTART;TZID="Ora dell'Europa centrale":20260715T100000`,
    `DTEND;TZID="Ora dell'Europa centrale":20260715T110000`,
    "RRULE:FREQ=WEEKLY",
    "SUMMARY:Estate",
    "END:VEVENT"
  );
  const rome = parseIcs(custom, { timeZone: "Europe/Rome" });
  assert.deepEqual(rome.warnings, []);
  assert.equal(rome.events[0].start, "2026-07-15T08:00:00.000Z");
  assert.equal(rome.events[0].timeZone, "Europe/Rome");
  const ny = parseIcs(custom, { timeZone: "America/New_York" });
  assert.equal(ny.events[0].start, "2026-07-15T08:00:00.000Z");
  assert.equal(ny.events[0].timeZone, "Europe/Berlin");
  // Nome sconosciuto e senza VTIMEZONE: ora del dispositivo e un avviso chiaro.
  const unknown = parseIcs(ics("BEGIN:VEVENT", "UID:u", "DTSTART;TZID=Nowhere/Land:20261103T100000", "SUMMARY:X", "END:VEVENT"), { timeZone: "Europe/Rome" });
  assert.equal(unknown.events[0].start, "2026-11-03T09:00:00.000Z");
  assert.equal(unknown.warnings.length, 1);
  assert.match(unknown.warnings[0], /Nowhere\/Land/);
});

test("parti di regola non gestite: avviso che le elenca, regola originale conservata", () => {
  const { events, warnings } = parseIcs(
    ics(
      "BEGIN:VEVENT",
      "UID:p",
      "DTSTART;TZID=Europe/Rome:20261103T090000",
      "RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=2",
      "SUMMARY:Secondo giorno feriale",
      "END:VEVENT"
    ),
    { timeZone: "Europe/Rome" }
  );
  assert.equal(events[0].repeat.sourceRRule, "FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=2");
  assert.deepEqual(events[0].unsupported, ["BYDAY=MO,TU,WE,TH,FR", "BYSETPOS=2"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Secondo giorno feriale/);
  // Le parti della regola sono dette a parole, non in codice.
  assert.match(warnings[0], /giorni della settimana, la scelta per posizione/);
  assert.doesNotMatch(warnings[0], /BYSETPOS/);
});

// ------------------------------------------------------------------------------------------
// Unione con il calendario
// ------------------------------------------------------------------------------------------

const T0 = "2026-10-01T10:00:00.000Z";
const NOW = "2026-11-11T10:00:00.000Z";
let counter = 0;
const newId = () => `event_new_${++counter}`;
const merge = (events, parsed, extra = {}) =>
  mergeIcsImport({ events, exams: [], tasks: [], items: icsImportItems(parsed.events, { defaultCategory: "lesson" }), now: NOW, newId, ...extra });
const apply = (events, plan) => applyEditPlan(events, plan).events;
const window = (events, from = "2026-11-01T00:00:00Z", to = "2027-01-01T00:00:00Z") =>
  expandEvents(events, new Date(from), new Date(to)).map((item) => `${item.start} ${item.title}`);

test("import Google: serie con data esclusa e occorrenza spostata, come le crea il motore", () => {
  const parsed = parseIcs(GOOGLE, { timeZone: "Europe/Rome" });
  const plan = merge([], parsed);
  assert.equal(plan.added, 3);
  assert.equal(plan.updated, 0);
  const events = apply([], plan);
  const master = events.find((event) => event.sourceUid === "5f3k2j1h0g@google.com" && !event.seriesId);
  assert.equal(master.timeZone, "Europe/Rome");
  assert.deepEqual(master.repeat.byWeekday, ["MO", "WE"]);
  assert.equal(master.recurrence, "weekly", "proiezione per le app vecchie");
  const cancelled = events.find((event) => event.id === `${master.id}@2026-12-09`);
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.archived, true);
  assert.equal(cancelled.seriesId, master.id);
  const moved = events.find((event) => event.id === `${master.id}@2026-11-18`);
  assert.equal(moved.seriesId, master.id);
  assert.equal(moved.originalDate, "2026-11-18");
  assert.equal(moved.sourceRecurrenceId, "20261118T080000Z");
  const shown = window(events);
  assert.ok(shown.includes("2026-11-18T13:00:00.000Z Anatomia (recupero)"));
  assert.ok(!shown.includes("2026-11-18T08:00:00.000Z Anatomia"));
  assert.ok(!shown.includes("2026-12-09T08:00:00.000Z Anatomia"));
  assert.ok(shown.includes("2026-12-07T08:00:00.000Z Anatomia"));
  assert.equal(shown.filter((line) => line.endsWith(" Anatomia")).length, 12);
});

test("reimportare lo stesso file non duplica e non aggiorna nulla", () => {
  const parsed = parseIcs(GOOGLE, { timeZone: "Europe/Rome" });
  const first = apply([], merge([], parsed));
  const again = merge(first, parseIcs(GOOGLE, { timeZone: "America/New_York" }));
  assert.deepEqual({ added: again.added, updated: again.updated, puts: again.puts.length, deletes: again.deletes.length }, { added: 0, updated: 0, puts: 0, deletes: 0 });
});

test("una data esclusa tolta dal file si toglie anche qui; le modifiche fatte in StudyOS restano", () => {
  const first = apply([], merge([], parseIcs(GOOGLE, { timeZone: "Europe/Rome" })));
  const master = first.find((event) => event.sourceUid === "5f3k2j1h0g@google.com" && !event.seriesId);
  // L'utente cancella a mano il 25/11 in StudyOS.
  const mine = apply(first, planDelete(first, master.id, "2026-11-25", "this", { now: NOW }));
  const without = GOOGLE.replace("EXDATE;TZID=Europe/Rome:20261209T090000\r\n", "");
  const plan = merge(mine, parseIcs(without, { timeZone: "Europe/Rome" }));
  assert.deepEqual(plan.deletes, [`${master.id}@2026-12-09`]);
  assert.equal(plan.updated, 1);
  const after = apply(mine, plan);
  assert.ok(after.some((event) => event.id === `${master.id}@2026-11-25` && event.cancelled));
});

test("vecchi import divisi per giorno (uid#1, uid#3) adottati e sostituiti da una serie sola", () => {
  const old = (weekday, start) =>
    ({ id: `old-${weekday}`, createdAt: T0, updatedAt: T0, archived: false, tags: [], title: "Anatomia", description: "", category: "lesson", color: "#7CF7C8", priority: "medium", start, end: start.replace("T08", "T10"), recurrence: "weekly", recurrenceUntil: "2026-12-18", status: "planned", checklist: [], attachmentIds: [], notes: "Portare il camice", links: [], subjectId: "anat", sourceUid: `5f3k2j1h0g@google.com#${weekday}` });
  const events = [old(1, "2026-11-02T08:00:00.000Z"), old(3, "2026-11-04T08:00:00.000Z")];
  const plan = merge(events, parseIcs(GOOGLE, { timeZone: "Europe/Rome" }));
  assert.equal(plan.updated, 1);
  assert.ok(plan.deletes.includes("old-3"));
  const after = apply(events, plan);
  const series = after.filter((event) => event.title === "Anatomia" && !event.seriesId);
  assert.equal(series.length, 1);
  assert.equal(series[0].id, "old-1");
  assert.equal(series[0].sourceUid, "5f3k2j1h0g@google.com");
  assert.equal(series[0].notes, "Portare il camice");
  assert.equal(series[0].subjectId, "anat");
  assert.deepEqual(series[0].repeat.byWeekday, ["MO", "WE"]);
  // Nessun giorno due volte.
  const shown = window(after);
  assert.equal(new Set(shown).size, shown.length);
});

const LEGACY_FILE = ics(
  "X-WR-TIMEZONE:Europe/Rome",
  "BEGIN:VEVENT",
  "UID:legacy@google.com",
  "DTSTART;TZID=Europe/Rome:20261102T090000",
  "DTEND;TZID=Europe/Rome:20261102T110000",
  "RRULE:FREQ=WEEKLY;UNTIL=20261218T225959Z;BYDAY=MO,WE",
  "SUMMARY:Anatomia",
  "END:VEVENT"
);
/**
 * I vecchi import non hanno un fuso: si leggono nel fuso del dispositivo. Questi sono di chi sta a Roma
 * (lunedì alle 9), quindi il test fissa il dispositivo a Roma: a Honolulu le 8:00Z sono domenica sera.
 */
const inRome = (run) => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Rome";
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
};
const legacyEvent = (weekday, start, extra = {}) => ({
  id: `old-${weekday}`,
  createdAt: T0,
  updatedAt: T0,
  archived: false,
  tags: [],
  title: "Anatomia",
  description: "",
  category: "lesson",
  color: "#7CF7C8",
  priority: "medium",
  start,
  end: start.replace("T08", "T10"),
  recurrence: "weekly",
  recurrenceUntil: "2026-12-18",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  sourceUid: `legacy@google.com#${weekday}`,
  ...extra
});

test("adozione dei vecchi import: giorni cancellati e modificati, note, materia e liste passano alla serie tenuta", () => inRome(() => {
  let events = [
    legacyEvent(1, "2026-11-02T08:00:00.000Z", { notes: "Portare il camice", tags: ["uni"], checklist: [{ id: "c1", text: "Camice", done: false }] }),
    legacyEvent(3, "2026-11-04T08:00:00.000Z", {
      notes: "Solo il mercoledì: aula B",
      subjectId: "anat",
      tags: ["uni", "aula-b"],
      checklist: [{ id: "c2", text: "Slide", done: true }],
      links: [{ id: "l1", label: "Aula", url: "https://example.com/aula-b" }],
      attachmentIds: ["a1"],
      goalId: "goal-anatomia",
      cover: "aula-b.jpg"
    })
  ];
  events = apply(events, planDelete(events, "old-3", "2026-11-18", "this", { now: NOW }));
  events = apply(events, planEdit(events.find((event) => event.id === "old-3"), events, "2026-11-25", "this", { title: "Anatomia (recupero)" }, { now: NOW }));
  const plan = merge(events, parseIcs(LEGACY_FILE, { timeZone: "Europe/Rome" }));
  assert.deepEqual(
    plan.relinked,
    new Map([
      ["old-3", "old-1"],
      ["old-3@2026-11-18", "old-1@2026-11-18"],
      ["old-3@2026-11-25", "old-1@2026-11-25"]
    ])
  );
  assert.deepEqual(plan.warnings, []);
  const after = apply(events, plan);
  assert.equal(after.some((event) => event.id.startsWith("old-3")), false);
  const series = after.filter((event) => !event.seriesId);
  assert.equal(series.length, 1);
  const [kept] = series;
  assert.equal(kept.id, "old-1");
  assert.equal(kept.sourceUid, "legacy@google.com");
  assert.equal(kept.notes, "Portare il camice\n\nSolo il mercoledì: aula B");
  assert.equal(kept.subjectId, "anat");
  assert.deepEqual(kept.tags, ["uni", "aula-b"]);
  assert.deepEqual(kept.checklist.map((item) => item.id), ["c1", "c2"]);
  assert.deepEqual(kept.links.map((item) => item.id), ["l1"]);
  assert.deepEqual(kept.attachmentIds, ["a1"]);
  assert.equal(kept.goalId, "goal-anatomia");
  assert.equal(kept.cover, "aula-b.jpg");
  const shown = window(after);
  assert.ok(!shown.some((line) => line.startsWith("2026-11-18")), "il 18/11 resta cancellato");
  assert.ok(shown.includes("2026-11-25T08:00:00.000Z Anatomia (recupero)"));
  assert.ok(!shown.includes("2026-11-25T08:00:00.000Z Anatomia"));
  assert.ok(shown.includes("2026-11-23T08:00:00.000Z Anatomia"));
  assert.equal(new Set(shown).size, shown.length);
  // Reimportare dopo l'adozione non cambia nulla.
  const again = merge(after, parseIcs(LEGACY_FILE, { timeZone: "America/New_York" }));
  assert.deepEqual({ added: again.added, updated: again.updated, puts: again.puts.length, deletes: again.deletes.length }, { added: 0, updated: 0, puts: 0, deletes: 0 });
}));

test("adozione dei vecchi import: se una serie non si unisce senza perdere nulla, il gruppo resta com'era", () => inRome(() => {
  // Materie diverse sui due giorni: unirle ne perderebbe una.
  const subjects = [legacyEvent(1, "2026-11-02T08:00:00.000Z", { subjectId: "anat" }), legacyEvent(3, "2026-11-04T08:00:00.000Z", { subjectId: "fisio" })];
  const plan = merge(subjects, parseIcs(LEGACY_FILE, { timeZone: "Europe/Rome" }));
  assert.deepEqual({ added: plan.added, updated: plan.updated, puts: plan.puts.length, deletes: plan.deletes.length }, { added: 0, updated: 0, puts: 0, deletes: 0 });
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /«Anatomia»/);
  // Obiettivi o copertine diversi: lo stesso.
  for (const field of ["goalId", "cover"]) {
    const pair = [legacyEvent(1, "2026-11-02T08:00:00.000Z", { [field]: "uno" }), legacyEvent(3, "2026-11-04T08:00:00.000Z", { [field]: "due" })];
    const kept = merge(pair, parseIcs(LEGACY_FILE, { timeZone: "Europe/Rome" }));
    assert.equal(kept.puts.length + kept.deletes.length, 0, field);
    assert.equal(kept.warnings.length, 1, field);
  }
  // Un giorno spostato che la serie del file non ha più: resta tutto com'era.
  let moved = [legacyEvent(1, "2026-11-02T08:00:00.000Z"), legacyEvent(3, "2026-11-04T08:00:00.000Z", { recurrenceUntil: undefined })];
  moved = apply(moved, planEdit(moved.find((event) => event.id === "old-3"), moved, "2027-01-13", "this", { title: "Anatomia (gennaio)" }, { now: NOW }));
  const second = merge(moved, parseIcs(LEGACY_FILE, { timeZone: "Europe/Rome" }));
  assert.equal(second.puts.length + second.deletes.length, 0);
  assert.equal(second.warnings.length, 1);
  // Un giorno cancellato che la serie del file non ha più non conta: non si vedrebbe comunque.
  let cancelled = [legacyEvent(1, "2026-11-02T08:00:00.000Z"), legacyEvent(3, "2026-11-04T08:00:00.000Z", { recurrenceUntil: undefined })];
  cancelled = apply(cancelled, planDelete(cancelled, "old-3", "2027-01-13", "this", { now: NOW }));
  const third = merge(cancelled, parseIcs(LEGACY_FILE, { timeZone: "Europe/Rome" }));
  assert.ok(third.deletes.includes("old-3"));
  assert.ok(third.deletes.includes("old-3@2027-01-13"));
  assert.deepEqual(third.warnings, []);
}));

const SPLIT = ics(
  "X-WR-TIMEZONE:Europe/Rome",
  "BEGIN:VEVENT",
  "UID:split@google.com",
  "DTSTART;TZID=Europe/Rome:20261102T090000",
  "DTEND;TZID=Europe/Rome:20261102T100000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "SUMMARY:Fisica",
  "END:VEVENT"
);
// In Google: il 7/12 al pomeriggio, il 14/12 cancellato, il 9/11 (prima della divisione) cancellato.
const SPLIT_CHANGED = SPLIT.replace(
  "END:VEVENT\r\nEND:VCALENDAR",
  [
    "EXDATE;TZID=Europe/Rome:20261109T090000,20261214T090000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:split@google.com",
    "RECURRENCE-ID;TZID=Europe/Rome:20261207T090000",
    "DTSTART;TZID=Europe/Rome:20261207T150000",
    "DTEND;TZID=Europe/Rome:20261207T160000",
    "SUMMARY:Fisica (pomeriggio)",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n")
);
/** Serie di Google importata e divisa in StudyOS dal 23/11 ("questa e le successive"). */
const splitCalendar = () => {
  let events = apply([], merge([], parseIcs(SPLIT, { timeZone: "Europe/Rome" })));
  const master = events.find((event) => event.sourceUid === "split@google.com");
  events = apply(events, planEdit(master, events, "2026-11-23", "following", { title: "Fisica (aula nuova)" }, { now: NOW }));
  const child = events.find((event) => event.splitFrom === master.id);
  assert.ok(child);
  return { events, master, child };
};
const NOTHING = { added: 0, updated: 0, puts: 0, deletes: 0 };
const counts = (plan) => ({ added: plan.added, updated: plan.updated, puts: plan.puts.length, deletes: plan.deletes.length });
/**
 * Niente di nuovo, al più l'impronta: un altro file con gli stessi eventi scritti in altro modo (il
 * proprio export e quello di Google) aggiorna solo la metà del file, senza toccare altro.
 */
const QUIET = { added: 0, updated: 0, deletes: 0, changed: 0, warnings: 0 };
const quietCounts = (plan, events) => {
  const sameButStamp = (put) => {
    const { sourceStamp: after, ...rest } = put;
    const { sourceStamp: before, ...old } = events.find((event) => event.id === put.id) ?? {};
    return typeof after === "string" && typeof before === "string" && after.split(".")[1] === before.split(".")[1] && JSON.stringify(rest) === JSON.stringify(old);
  };
  return { added: plan.added, updated: plan.updated, deletes: plan.deletes.length, changed: plan.puts.filter((put) => !sameButStamp(put)).length, warnings: plan.warnings.length };
};

test("serie divisa in StudyOS ('questa e le successive'): le modifiche del file dopo la divisione vanno alla figlia", () => {
  const { events, master, child } = splitCalendar();
  const changed = SPLIT_CHANGED;
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    const plan = merge(events, parseIcs(changed, { timeZone: device }), { timeZone: device });
    assert.equal(plan.added, 0, device);
    const after = apply(events, plan);
    const shown = window(after);
    assert.deepEqual(
      shown.filter((line) => line.startsWith("2026-12-07")),
      ["2026-12-07T14:00:00.000Z Fisica (pomeriggio)"],
      device
    );
    assert.ok(!shown.some((line) => line.startsWith("2026-12-14")), device);
    assert.ok(!shown.some((line) => line.startsWith("2026-11-09")), device);
    assert.ok(shown.includes("2026-11-30T08:00:00.000Z Fisica (aula nuova)"), device);
    assert.ok(after.some((event) => event.id === `${child.id}@2026-12-07` && event.sourceRecurrenceId === "20261207T080000Z"), device);
    assert.ok(after.some((event) => event.id === `${child.id}@2026-12-14` && event.cancelled), device);
    // Il secondo import non cambia nulla; togliere la modifica dal file la toglie anche qui.
    const again = merge(after, parseIcs(changed, { timeZone: device }), { timeZone: device });
    assert.equal(again.puts.length + again.deletes.length, 0, device);
    const reverted = merge(after, parseIcs(SPLIT, { timeZone: device }), { timeZone: device });
    assert.deepEqual([...reverted.deletes].sort(), [`${child.id}@2026-12-07`, `${child.id}@2026-12-14`, `${master.id}@2026-11-09`].sort(), device);
  }
});

test("serie divisa: il proprio file reimportato non cambia nulla, anche più volte, alternato con il file di Google", () => {
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    let { events, child } = splitCalendar();
    // Un giorno cambiato a mano sulla figlia, poi il file di Google con le sue modifiche dopo la divisione.
    events = apply(events, planEdit(child, events, "2026-12-21", "this", { title: "Fisica (ripasso mio)" }, { now: NOW }));
    events = apply(events, merge(events, parseIcs(SPLIT_CHANGED, { timeZone: device }), { timeZone: device }));
    const expected = window(events);
    assert.ok(expected.includes("2026-12-07T14:00:00.000Z Fisica (pomeriggio)"), device);
    assert.ok(!expected.some((line) => line.startsWith("2026-12-14")), device);
    assert.ok(expected.includes("2026-12-21T08:00:00.000Z Fisica (ripasso mio)"), device);
    const own = buildIcs({ events, exams: [], tasks: [], subjects: [], timeZone: device, now: new Date(NOW) });
    const files = [own, own, SPLIT_CHANGED, own, SPLIT_CHANGED];
    for (const [index, file] of files.entries()) {
      const plan = merge(events, parseIcs(file, { timeZone: device }), { timeZone: device });
      assert.deepEqual(quietCounts(plan, events), QUIET, `${device} import ${index + 1}`);
      // Lo stesso file due volte di seguito: proprio nulla.
      if (file === files[index - 1]) assert.deepEqual(counts(plan), NOTHING, `${device} import ${index + 1}`);
      events = apply(events, plan);
    }
    assert.deepEqual(window(events), expected, device);
  }
});

test("serie divisa copiata in un altro calendario: resta una famiglia, e il file di Google non raddoppia i giorni", () => {
  // Google cancella anche il 21/12, che in StudyOS è stato cambiato a mano: la modifica resta, anche nella copia.
  const google = SPLIT_CHANGED.replace("20261109T090000,20261214T090000", "20261109T090000,20261214T090000,20261221T090000");
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    let { events, master, child } = splitCalendar();
    events = apply(events, planEdit(child, events, "2026-12-21", "this", { title: "Fisica (ripasso mio)" }, { now: NOW }));
    events = apply(events, planDelete(events, child.id, "2026-12-28", "this", { now: NOW }));
    events = apply(events, merge(events, parseIcs(google, { timeZone: device }), { timeZone: device }));
    assert.ok(window(events).includes("2026-12-21T08:00:00.000Z Fisica (ripasso mio)"), device);
    assert.ok(!window(events).some((line) => line.startsWith("2026-12-28")), device);
    const own = buildIcs({ events, exams: [], tasks: [], subjects: [], timeZone: device, now: new Date(NOW) });
    // La figlia dice chi è la madre (RFC 5545 RELATED-TO); la madre no.
    assert.equal(own.split("RELATED-TO;RELTYPE=PARENT:split@google.com").length, 2, device);
    // I giorni cambiati a mano sono segnati (il 21/12 sulla sua modifica, il 28/12 accanto alle date escluse,
    // che restano per le altre app); quelli venuti da Google no.
    assert.equal(own.split("X-STUDYOS-EDITED:TRUE").length, 2, device);
    assert.match(own, /\r\nX-STUDYOS-EDITED;TZID=Europe\/Rome:20261228T090000\r\n/, device);
    assert.match(own, /\r\nEXDATE;TZID=Europe\/Rome:20261214T090000,20261228T090000\r\n/, device);
    let copy = apply([], merge([], parseIcs(own, { timeZone: device }), { timeZone: device }));
    const copyParent = copy.find((event) => event.sourceUid === "split@google.com" && !event.seriesId);
    const copyChild = copy.find((event) => event.sourceUid === `${child.id}@studyos` && !event.seriesId);
    assert.notEqual(copyParent.id, master.id);
    assert.equal(copyChild.splitFrom, copyParent.id, device);
    assert.equal(copyChild.originalDate, "2026-11-23", device);
    assert.deepEqual(window(copy), window(events), device);
    // Nella copia appena creata i giorni cambiati a mano sono modifiche ricevute (sourceEdited), gli altri del file.
    const copyRow = (date) => copy.find((event) => event.seriesId === copyChild.id && event.originalDate === date);
    assert.equal(copyRow("2026-12-21").sourceEdited, true, device);
    assert.equal(copyRow("2026-12-28").sourceEdited, true, device);
    assert.equal(copyRow("2026-12-28").cancelled, true, device);
    assert.equal(copyRow("2026-12-07").sourceEdited, undefined, device);
    // Il file originale di Google nella copia: niente giorni doppi, niente cambia.
    const plan = merge(copy, parseIcs(google, { timeZone: device }), { timeZone: device });
    assert.deepEqual(quietCounts(plan, copy), QUIET, device);
    copy = apply(copy, plan);
    assert.deepEqual(window(copy), window(events), device);
    assert.deepEqual(counts(merge(copy, parseIcs(google, { timeZone: device }), { timeZone: device })), NOTHING, device);
    // E la copia esportata e reimportata in sé stessa non cambia, anche alternata con il file di Google.
    const again = buildIcs({ events: copy, exams: [], tasks: [], subjects: [], timeZone: device, now: new Date(NOW) });
    for (const [index, file] of [again, google, own, again, google].entries()) {
      const next = merge(copy, parseIcs(file, { timeZone: device }), { timeZone: device });
      assert.deepEqual(quietCounts(next, copy), QUIET, `${device} import ${index + 1}`);
      copy = apply(copy, next);
    }
    assert.deepEqual(window(copy), window(events), device);
    // Google senza più modifiche: i suoi giorni tornano normali anche nella copia, quelli dell'utente restano.
    copy = apply(copy, merge(copy, parseIcs(SPLIT, { timeZone: device }), { timeZone: device }));
    const shown = window(copy);
    assert.ok(shown.includes("2026-12-07T08:00:00.000Z Fisica (aula nuova)"), device);
    assert.ok(shown.includes("2026-12-14T08:00:00.000Z Fisica (aula nuova)"), device);
    assert.ok(shown.includes("2026-12-21T08:00:00.000Z Fisica (ripasso mio)"), device);
    assert.ok(!shown.some((line) => line.startsWith("2026-12-28")), device);
  }
});

// Google più recente: il 7/12 spostato di nuovo, il 14/12 tornato, il 21/12 cancellato.
const SPLIT_NEWER = SPLIT.replace(
  "END:VEVENT\r\nEND:VCALENDAR",
  [
    "EXDATE;TZID=Europe/Rome:20261221T090000",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:split@google.com",
    "RECURRENCE-ID;TZID=Europe/Rome:20261207T090000",
    "DTSTART;TZID=Europe/Rome:20261207T170000",
    "DTEND;TZID=Europe/Rome:20261207T180000",
    "SUMMARY:Fisica (sera)",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n")
);
const december = (events) => window(events).filter((line) => line >= "2026-12-07" && line < "2026-12-22");
const AFTER_NEWER = ["2026-12-07T16:00:00.000Z Fisica (sera)", "2026-12-14T08:00:00.000Z Fisica (aula nuova)"];
const AFTER_CHANGED = ["2026-12-07T14:00:00.000Z Fisica (pomeriggio)", "2026-12-21T08:00:00.000Z Fisica (aula nuova)"];
const AFTER_PLAIN = ["2026-12-07T08:00:00.000Z Fisica (aula nuova)", "2026-12-14T08:00:00.000Z Fisica (aula nuova)", "2026-12-21T08:00:00.000Z Fisica (aula nuova)"];

test("serie divisa: vale l'ultimo file, anche dopo un vecchio export di StudyOS", () => {
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    let { events } = splitCalendar();
    const step = (text) => {
      const plan = merge(events, parseIcs(text, { timeZone: device }), { timeZone: device });
      events = apply(events, plan);
      return counts(plan);
    };
    step(SPLIT_CHANGED);
    const older = buildIcs({ events, exams: [], tasks: [], subjects: [], timeZone: device, now: new Date(NOW) });
    step(SPLIT_NEWER);
    assert.deepEqual(december(events), AFTER_NEWER, device);
    step(older);
    assert.deepEqual(december(events), AFTER_CHANGED, `${device} vecchio export`);
    step(SPLIT_NEWER);
    assert.deepEqual(december(events), AFTER_NEWER, `${device} Google di nuovo`);
    assert.deepEqual(step(SPLIT_NEWER), NOTHING, device);
    assert.deepEqual(december(events), AFTER_NEWER, device);
  }
});

test("serie divisa copiata da un vecchio export: le modifiche successive di Google arrivano anche nella copia", () => {
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    let { events } = splitCalendar();
    events = apply(events, merge(events, parseIcs(SPLIT_CHANGED, { timeZone: device }), { timeZone: device }));
    const older = buildIcs({ events, exams: [], tasks: [], subjects: [], timeZone: device, now: new Date(NOW) });
    let copy = apply([], merge([], parseIcs(older, { timeZone: device }), { timeZone: device }));
    assert.deepEqual(december(copy), AFTER_CHANGED, device);
    const step = (text) => {
      const plan = merge(copy, parseIcs(text, { timeZone: device }), { timeZone: device });
      copy = apply(copy, plan);
      return counts(plan);
    };
    step(SPLIT_NEWER);
    assert.deepEqual(december(copy), AFTER_NEWER, device);
    assert.deepEqual(step(SPLIT_NEWER), NOTHING, device);
    step(SPLIT);
    assert.deepEqual(december(copy), AFTER_PLAIN, `${device} Google senza modifiche`);
  }
});

const COURSE = ics(
  "X-WR-TIMEZONE:Europe/Rome",
  "BEGIN:VEVENT",
  "UID:corso@univ.example",
  "DTSTART;TZID=Europe/Rome:20261102T090000",
  "DTEND;TZID=Europe/Rome:20261102T110000",
  "RRULE:FREQ=WEEKLY;BYDAY=MO",
  "SUMMARY:Anatomia",
  "END:VEVENT"
);
const novemberLines = (events) => window(events).filter((line) => line >= "2026-11-16" && line < "2026-12-01");

test("segno di modifica a mano in un file estraneo: non blocca i giorni contro il calendario ufficiale", () => {
  const marked = COURSE.replace(
    "RRULE:FREQ=WEEKLY;BYDAY=MO\r\n",
    "RRULE:FREQ=WEEKLY;BYDAY=MO\r\nEXDATE;TZID=Europe/Rome:20261116T090000\r\nX-STUDYOS-EDITED;TZID=Europe/Rome:20261116T090000\r\n"
  ).replace(
    "END:VEVENT\r\nEND:VCALENDAR",
    [
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:corso@univ.example",
      "RECURRENCE-ID;TZID=Europe/Rome:20261123T090000",
      "X-STUDYOS-EDITED:TRUE",
      "DTSTART;TZID=Europe/Rome:20261123T180000",
      "DTEND;TZID=Europe/Rome:20261123T190000",
      "SUMMARY:Anatomia (spostata)",
      "END:VEVENT",
      "END:VCALENDAR"
    ].join("\r\n")
  );
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    let events = apply([], merge([], parseIcs(COURSE, { timeZone: device }), { timeZone: device }));
    const official = novemberLines(events);
    events = apply(events, merge(events, parseIcs(marked, { timeZone: device }), { timeZone: device }));
    assert.deepEqual(novemberLines(events), ["2026-11-23T17:00:00.000Z Anatomia (spostata)", "2026-11-30T08:00:00.000Z Anatomia"], device);
    // La serie c'era già: i giorni segnati sono modifiche come le altre, e il file ufficiale le toglie.
    assert.ok(!events.some((event) => event.sourceEdited), device);
    events = apply(events, merge(events, parseIcs(COURSE, { timeZone: device }), { timeZone: device }));
    assert.deepEqual(novemberLines(events), official, device);
    assert.deepEqual(counts(merge(events, parseIcs(COURSE, { timeZone: device }), { timeZone: device })), NOTHING, device);
  }
});

test("copia aggiornata da un export più recente: segue le nuove modifiche a mano dell'originale, Google no", () => {
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    const exportOf = (events) => buildIcs({ events, exams: [], tasks: [], subjects: [], timeZone: device, now: new Date(NOW) });
    const into = (events, text) => apply(events, merge(events, parseIcs(text, { timeZone: device }), { timeZone: device }));
    const seriesOf = (events) => events.find((event) => !event.seriesId);
    let original = into([], COURSE);
    original = apply(original, planEdit(seriesOf(original), original, "2026-11-23", "this", { title: "Anatomia (aula B)" }, { now: NOW }));
    original = apply(original, planDelete(original, seriesOf(original).id, "2026-11-30", "this", { now: NOW }));
    let copy = into([], exportOf(original));
    assert.deepEqual(novemberLines(copy), ["2026-11-16T08:00:00.000Z Anatomia", "2026-11-23T08:00:00.000Z Anatomia (aula B)"], device);
    // Più tardi, nell'originale: il 23/11 cambiato di nuovo, il 16/11 cambiato per la prima volta.
    original = apply(original, planEdit(seriesOf(original), original, "2026-11-23", "this", { title: "Anatomia (aula C)" }, { now: NOW }));
    original = apply(original, planEdit(seriesOf(original), original, "2026-11-16", "this", { title: "Anatomia (laboratorio)" }, { now: NOW }));
    const newer = exportOf(original);
    copy = into(copy, newer);
    const refreshed = ["2026-11-16T08:00:00.000Z Anatomia (laboratorio)", "2026-11-23T08:00:00.000Z Anatomia (aula C)"];
    assert.deepEqual(novemberLines(copy), refreshed, device);
    assert.deepEqual(counts(merge(copy, parseIcs(newer, { timeZone: device }), { timeZone: device })), NOTHING, `${device} di nuovo`);
    assert.deepEqual(counts(merge(copy, parseIcs(exportOf(copy), { timeZone: device }), { timeZone: device })), NOTHING, `${device} proprio export`);
    // Il file ufficiale (senza segni) non tocca le modifiche ricevute con la copia (23/11, 30/11); il 16/11
    // è arrivato su una serie che c'era già, quindi è una modifica come le altre e segue il file.
    copy = into(copy, COURSE);
    assert.deepEqual(novemberLines(copy), ["2026-11-16T08:00:00.000Z Anatomia", "2026-11-23T08:00:00.000Z Anatomia (aula C)"], device);
    // Le modifiche fatte a mano nella copia vincono su ogni file, anche su un export più recente dell'originale.
    copy = apply(copy, planEdit(seriesOf(copy), copy, "2026-12-07", "this", { title: "Anatomia (mia)" }, { now: NOW }));
    const mine = planEdit(seriesOf(copy), copy, "2026-11-23", "this", { title: "Anatomia (aula mia)" }, { now: NOW });
    // Come la salva l'editor (c3626fe): un giorno ricevuto cambiato a mano perde sourceRecurrenceId.
    const handMade = (row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "sourceRecurrenceId"));
    copy = apply(copy, { ...mine, puts: mine.puts.map((row) => (row.seriesId ? handMade(row) : row)) });
    original = apply(original, planEdit(seriesOf(original), original, "2026-11-23", "this", { title: "Anatomia (aula D)" }, { now: NOW }));
    for (const file of [exportOf(original), COURSE]) {
      copy = into(copy, file);
      const shown = window(copy);
      assert.ok(shown.includes("2026-11-23T08:00:00.000Z Anatomia (aula mia)"), device);
      assert.ok(shown.includes("2026-12-07T08:00:00.000Z Anatomia (mia)"), device);
      assert.ok(!shown.some((line) => line.startsWith("2026-11-30")), device);
    }
  }
});

test("X-STUDYOS-EDITED su un giorno modificato conta solo con il valore TRUE", () => {
  const change = (value) =>
    parseIcs(
      COURSE.replace(
        "END:VEVENT\r\nEND:VCALENDAR",
        [
          "END:VEVENT",
          "BEGIN:VEVENT",
          "UID:corso@univ.example",
          "RECURRENCE-ID;TZID=Europe/Rome:20261123T090000",
          ...(value === undefined ? [] : [`X-STUDYOS-EDITED:${value}`]),
          "DTSTART;TZID=Europe/Rome:20261123T180000",
          "SUMMARY:Anatomia (spostata)",
          "END:VEVENT",
          "END:VCALENDAR"
        ].join("\r\n")
      )
    ).events.find((event) => event.recurrenceId).edited;
  assert.equal(change("TRUE"), true);
  assert.equal(change("true"), true);
  for (const value of ["FALSE", "1", "", undefined]) assert.equal(change(value), undefined, String(value));
});

const COURSE_VEVENT = COURSE.split("\r\n").slice(COURSE.split("\r\n").indexOf("BEGIN:VEVENT"), COURSE.split("\r\n").indexOf("END:VEVENT") + 1);
const courseChild = (extra, rows = []) =>
  ics(
    "X-WR-TIMEZONE:Europe/Rome",
    ...COURSE_VEVENT,
    "BEGIN:VEVENT",
    "UID:altro@studyos",
    "RELATED-TO;RELTYPE=PARENT:corso@univ.example",
    ...extra,
    "SUMMARY:Anatomia",
    "END:VEVENT",
    ...rows
  );
const lessonsOn = (events, date) => window(events).filter((line) => line.startsWith(date));
/** Avviso: il file ha una parte di una tua serie che non si collega (resta un evento a sé). */
const APART = (title) =>
  `«${title}»: questo file ha una parte di una serie che hai già, ma non combacia con la tua: è stata aggiunta a parte. Se vedi giorni doppi, elimina quella che non ti serve.`;

test("la tua serie ripetuta com'è più una parte nuova (RELATED-TO): la serie non si divide e il segno non vale", () => {
  const marked = courseChild(
    [
      "DTSTART;TZID=Europe/Rome:20261123T090000",
      "DTEND;TZID=Europe/Rome:20261123T110000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO",
      "EXDATE;TZID=Europe/Rome:20261130T090000",
      "X-STUDYOS-EDITED;TZID=Europe/Rome:20261130T090000"
    ],
    [
      "BEGIN:VEVENT",
      "UID:altro@studyos",
      "RECURRENCE-ID;TZID=Europe/Rome:20261207T090000",
      "X-STUDYOS-EDITED:TRUE",
      "DTSTART;TZID=Europe/Rome:20261207T180000",
      "DTEND;TZID=Europe/Rome:20261207T190000",
      "SUMMARY:Anatomia (spostata)",
      "END:VEVENT"
    ]
  );
  const once = courseChild(["DTSTART;TZID=Europe/Rome:20261130T090000", "DTEND;TZID=Europe/Rome:20261130T110000", "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1"]);
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    for (const [label, file] of [["segnata", marked], ["COUNT=1", once]]) {
      let events = apply([], merge([], parseIcs(COURSE, { timeZone: device }), { timeZone: device }));
      const mondays = window(events).filter((line) => line.startsWith("2026-12-"));
      assert.equal(mondays.length, 4, device);
      const plan = merge(events, parseIcs(file, { timeZone: device }), { timeZone: device });
      assert.equal(plan.added, 1, `${device} ${label}`);
      assert.deepEqual(plan.warnings, [APART("Anatomia")], `${device} ${label}`);
      events = apply(events, plan);
      // Il file dice che la tua serie continua: la parte nuova resta a sé, e i suoi giorni segnati non sono "a mano".
      assert.ok(!events.some((event) => event.splitFrom), `${device} ${label}`);
      assert.ok(!events.some((event) => event.sourceEdited), `${device} ${label}`);
      const yours = ["2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"];
      for (const date of yours) assert.ok(lessonsOn(events, date).includes(`${date}T08:00:00.000Z Anatomia`), `${device} ${label} ${date}`);
      // Il calendario ufficiale, due volte: la tua serie resta intera e non cambia più.
      for (let index = 0; index < 2; index += 1) events = apply(events, merge(events, parseIcs(COURSE, { timeZone: device }), { timeZone: device }));
      for (const date of yours) assert.ok(lessonsOn(events, date).includes(`${date}T08:00:00.000Z Anatomia`), `${device} ${label} ${date}`);
      assert.deepEqual(counts(merge(events, parseIcs(COURSE, { timeZone: device }), { timeZone: device })), NOTHING, `${device} ${label}`);
    }
  }
});

test("R3 residuo (revisione finale). Serie importata prima come vecchio import (uid#1): gli stessi controlli sulle parti nuove", () => {
  const markedRows = [
    "BEGIN:VEVENT",
    "UID:altro@studyos",
    "RECURRENCE-ID;TZID=Europe/Rome:20261207T090000",
    "X-STUDYOS-EDITED:TRUE",
    "DTSTART;TZID=Europe/Rome:20261207T180000",
    "DTEND;TZID=Europe/Rome:20261207T190000",
    "SUMMARY:Anatomia (spostata)",
    "END:VEVENT"
  ];
  const markedPart = [
    "DTSTART;TZID=Europe/Rome:20261123T090000",
    "DTEND;TZID=Europe/Rome:20261123T110000",
    "RRULE:FREQ=WEEKLY;BYDAY=MO",
    "EXDATE;TZID=Europe/Rome:20261130T090000",
    "X-STUDYOS-EDITED;TZID=Europe/Rome:20261130T090000"
  ];
  // La tua serie, importata prima di R3 come una serie per giorno della settimana.
  const old = () => [legacyEvent(1, "2026-11-02T08:00:00.000Z", { sourceUid: "corso@univ.example#1", recurrenceUntil: undefined, timeZone: "Europe/Rome" })];
  const restated = courseChild(markedPart, markedRows).replace("RRULE:FREQ=WEEKLY;BYDAY=MO\r\n", "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261122T225959Z\r\n");
  const unchanged = courseChild(markedPart, markedRows);
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    const into = (events, text) => merge(events, parseIcs(text, { timeZone: device }), { timeZone: device });
    // 4a: la serie nel file finisce prima della parte nuova: si divide con l'avviso, ma i segni del file non valgono.
    let events = old();
    let plan = into(events, restated);
    assert.equal(plan.warnings.length, 1, device);
    assert.match(plan.warnings[0], /divide una serie che hai già/, device);
    events = apply(events, plan);
    assert.ok(events.some((event) => event.splitFrom), device);
    assert.ok(!events.some((event) => event.sourceEdited), `${device}: 4a, segni di un file estraneo`);
    // Il calendario ufficiale riporta i giorni della parte nuova come li dice lui.
    for (let index = 0; index < 2; index += 1) events = apply(events, into(events, COURSE));
    for (const date of ["2026-11-30", "2026-12-07"]) assert.deepEqual(lessonsOn(events, date), [`${date}T08:00:00.000Z Anatomia`], `${device} 4a ${date}`);
    // 4b: la serie nel file continua: la parte nuova resta a sé, con l'avviso, e i suoi segni non valgono.
    events = old();
    plan = into(events, unchanged);
    assert.deepEqual(plan.warnings, [APART("Anatomia")], `${device} 4b`);
    events = apply(events, plan);
    assert.ok(!events.some((event) => event.splitFrom), `${device} 4b`);
    assert.ok(!events.some((event) => event.sourceEdited), `${device}: 4b, segni di un file estraneo`);
  }
});

test("copia aggiornata dopo una divisione fatta nell'originale: la parte nuova si collega, con un avviso, e Google non raddoppia i giorni", () => {
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    const exportOf = (events) => buildIcs({ events, exams: [], tasks: [], subjects: [], timeZone: device, now: new Date(NOW) });
    const into = (events, text) => merge(events, parseIcs(text, { timeZone: device }), { timeZone: device });
    let original = apply([], into([], COURSE));
    let copy = apply([], into([], exportOf(original)));
    const series = original.find((event) => !event.seriesId);
    original = apply(original, planEdit(series, original, "2026-11-23", "following", { title: "Anatomia (secondo modulo)" }, { now: NOW }));
    const newer = exportOf(original);
    const plan = into(copy, newer);
    assert.deepEqual(
      plan.warnings,
      ["«Anatomia»: questo file divide una serie che hai già. Dal 23 novembre 2026 i giorni li decide la parte nuova, e importare di nuovo il calendario ufficiale non lo annulla. Per tornare indietro elimina la parte nuova."],
      device
    );
    copy = apply(copy, plan);
    const copyParent = copy.find((event) => event.sourceUid === "corso@univ.example" && !event.seriesId);
    assert.ok(copy.some((event) => event.splitFrom === copyParent.id), device);
    assert.deepEqual(window(copy), window(original), device);
    // Di nuovo lo stesso file: niente da fare e nessun avviso.
    const again = into(copy, newer);
    assert.deepEqual(counts(again), NOTHING, device);
    assert.deepEqual(again.warnings, [], device);
    // Il calendario ufficiale (serie senza fine) nella copia: un giorno solo per lunedì, come nell'originale.
    copy = apply(copy, into(copy, COURSE));
    original = apply(original, into(original, COURSE));
    assert.deepEqual(lessonsOn(copy, "2026-11-30"), ["2026-11-30T08:00:00.000Z Anatomia (secondo modulo)"], device);
    assert.deepEqual(window(copy), window(original), device);
  }
});

test("RELATED-TO verso una serie che non è nel file: non divide le serie che hai già", () => {
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    const mine = apply([], merge([], parseIcs(SPLIT, { timeZone: device }), { timeZone: device }));
    const only = ics(
      "BEGIN:VEVENT",
      "UID:altro@studyos",
      "RELATED-TO;RELTYPE=PARENT:split@google.com",
      "DTSTART;TZID=Europe/Rome:20261130T090000",
      "DTEND;TZID=Europe/Rome:20261130T100000",
      "RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=1",
      "SUMMARY:Altro",
      "END:VEVENT"
    );
    const plan = merge(mine, parseIcs(only, { timeZone: device }), { timeZone: device });
    assert.equal(plan.added, 1, device);
    assert.equal(plan.updated, 0, device);
    assert.deepEqual(plan.warnings, [APART("Fisica")], device);
    const after = apply(mine, plan);
    assert.ok(!after.some((event) => event.splitFrom), device);
    const mondays = (events) => window(events).filter((line) => line.startsWith("2026-12-") && line.endsWith(" Fisica"));
    assert.equal(mondays(mine).length, 4, device);
    assert.equal(mondays(after).length, 4, device);
  }
});

test("troppi giorni esclusi: si leggono i più vicini a oggi, e l'avviso dice quanti ne sono stati letti", () => {
  const stamp = (ms) => `${new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const day = 86_400_000;
  // Serie giornaliera dal 2023 con 1200 date escluse fino al 15/4/2026: contano le più recenti.
  const recent = Array.from({ length: 1200 }, (_, index) => stamp(Date.UTC(2023, 0, 2, 9) + index * day));
  const plan = merge([], parseIcs(ics("BEGIN:VEVENT", "UID:recent", "DTSTART:20230101T090000Z", "RRULE:FREQ=DAILY", `EXDATE:${recent.join(",")}`, "SUMMARY:Recenti", "END:VEVENT")), { timeZone: "UTC" });
  const rows = plan.puts.filter((event) => event.seriesId).map((event) => event.originalDate).sort();
  assert.equal(rows.length, 1000);
  assert.deepEqual([rows[0], rows.at(-1)], ["2023-07-21", "2026-04-15"]);
  assert.equal(window(apply([], plan), "2026-04-10T00:00:00Z", "2026-04-16T00:00:00Z").length, 0);
  assert.deepEqual(plan.warnings, ["«Recenti» ha troppi giorni esclusi o modificati: sono stati letti solo i 1000 più vicini a oggi."]);
  // Il limite del file (20.000 righe): la 21ª serie non ne legge nessuno, e l'avviso lo dice.
  const series = Array.from({ length: 21 }, (_, index) => [
    "BEGIN:VEVENT",
    `UID:s${index}`,
    "DTSTART:20200101T090000Z",
    "RRULE:FREQ=DAILY",
    `EXDATE:${Array.from({ length: 1000 }, (_, offset) => stamp(Date.UTC(2020, 0, 1, 9) + offset * day)).join(",")}`,
    `SUMMARY:Serie ${index + 1}`,
    "END:VEVENT"
  ]);
  const full = merge([], parseIcs(ics(...series)), { timeZone: "UTC" });
  assert.equal(full.puts.filter((event) => event.seriesId).length, 20_000);
  assert.deepEqual(full.warnings, ["«Serie 21»: il file ha troppi giorni esclusi o modificati in tutto, e per questa serie non ne è stato letto nessuno."]);
});

/**
 * Quanto cresce il tempo di CPU con un input 8 volte più grande (lineare ≈ ×8, al quadrato ≈ ×64).
 * Un tetto in millisecondi non regge: con 6 suite in parallelo il codice lineare arriva ai tempi di
 * quello quadratico a macchina scarica. Anche il rapporto dei tempi "a orologio" salta sotto carico
 * (l'input grande viene interrotto più spesso: fino a ×60 su codice lineare). Il tempo di CPU del
 * processo invece non conta le attese: piccolo e grande si alternano e vale il più veloce di 3 per
 * ciascuno. Sopra il limite si rimisura (fino a 3 volte); al doppio del limite è una regressione.
 */
const growth = (runSmall, runLarge, limit) => {
  const elapsed = (run) => {
    const started = process.cpuUsage();
    run();
    const used = process.cpuUsage(started);
    return (used.user + used.system) / 1000;
  };
  let ratio = Infinity;
  for (let round = 0; round < 3; round += 1) {
    let small = Infinity;
    let large = Infinity;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      small = Math.min(small, elapsed(runSmall));
      large = Math.min(large, elapsed(runLarge));
    }
    ratio = large / Math.max(small, 0.1);
    if (ratio < limit || ratio >= 2 * limit) break;
  }
  return ratio;
};

test("regole con un numero di ripetizioni e date sparse: un'espansione sola, veloce", () => {
  const stamp = (ms) => `${new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 8)}`;
  const file = (count) =>
    ics(
      ...Array.from({ length: 20 }, (_, index) => [
        "BEGIN:VEVENT",
        `UID:w${index}`,
        "DTSTART:19400101T090000Z",
        `RRULE:FREQ=MONTHLY;BYDAY=2MO;COUNT=${Math.min(count, 999)}`,
        ...Array.from({ length: count }, (_, offset) => `EXDATE;VALUE=DATE:${stamp(Date.UTC(1940, 0, 1) + offset * 40 * 86_400_000)}`),
        `SUMMARY:Mensile ${index + 1}`,
        "END:VEVENT"
      ])
    );
  const small = file(125);
  const text = file(1000);
  let plan;
  // Misurato (tempo di CPU, Mac a 15 core): ×7.5–8.0 (7 → 55 ms); con 6 suite in parallelo ×7.5–8.4
  // (11 → 94 ms). Togliendo l'espansione unica delle regole con COUNT (un'espansione per ogni data
  // esclusa): ×56 (104 → 5860 ms). Limite 20: più del doppio sopra il lineare, quasi tre volte sotto.
  const ratio = growth(
    () => merge([], parseIcs(small), { timeZone: "UTC" }),
    () => {
      plan = merge([], parseIcs(text), { timeZone: "UTC" });
    },
    20
  );
  assert.ok(ratio < 20, `crescita ×${ratio.toFixed(1)} con un input 8 volte più grande`);
  assert.equal(plan.added, 20);
  assert.deepEqual(plan.warnings, []);
  // Le date escluse che sono davvero secondi lunedì entro le 999 volte diventano righe.
  const rows = plan.puts.filter((event) => event.seriesId);
  assert.ok(rows.length > 0 && rows.every((event) => event.cancelled && event.originalDate <= "2023-04-10"), `${rows.length}`);
});

test("file ostile: 18.000 date escluse si leggono e si uniscono in tempo lineare, con un limite di righe", () => {
  const datesOf = (count) => {
    const dates = [];
    const day = new Date(Date.UTC(1975, 0, 1, 9));
    while (dates.length < count) {
      dates.push(`${day.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`);
      day.setUTCDate(day.getUTCDate() + 1);
    }
    return dates;
  };
  const flood = (dates) => [
    "BEGIN:VEVENT",
    "UID:flood",
    "DTSTART:19750101T090000Z",
    "RRULE:FREQ=DAILY",
    `EXDATE:${dates.join(",")}`,
    // Le stesse date anche come "cambiate a mano": il confronto delle due liste non cresce al quadrato.
    `X-STUDYOS-EDITED:${dates.join(",")}`,
    "SUMMARY:Flood",
    "END:VEVENT"
  ];
  const dates = datesOf(18000);
  // Una serie settimanale con date escluse sparse in migliaia di anni: niente espansione enorme.
  const sparse = Array.from({ length: 1500 }, (_, index) => `${String(1000 + index * 5).padStart(4, "0")}0105T090000Z`);
  const text = ics(flood(dates), "BEGIN:VEVENT", "UID:sparse", "DTSTART:10000105T090000Z", "RRULE:FREQ=WEEKLY", `EXDATE:${sparse.join(",")}`, "SUMMARY:Sparse", "END:VEVENT");
  assert.ok(text.length > 580_000, `${text.length}`);
  const parsed = parseIcs(text, { timeZone: "Europe/Rome" });
  const plan = merge([], parsed, { timeZone: "Europe/Rome" });
  // Tempo lineare: 2.250 contro 18.000 date (vedi `growth`). Misurato (tempo di CPU, Mac a 15 core):
  // ×5.0–5.9 (13 → 75 ms); con 6 suite in parallelo ×5.0–5.9 (21 → 120 ms). Rimettendo `includes` al
  // posto dei Set nel confronto delle due liste: in lettura ×36 (45 → 1640 ms), in lettura e unione
  // ×36 (52 → 1850 ms), solo nell'unione ×18–20 (28 → 530 ms). Limite 12.
  const run = (file) => () => merge([], parseIcs(file, { timeZone: "Europe/Rome" }), { timeZone: "Europe/Rome" });
  const ratio = growth(run(ics(flood(datesOf(2250)))), run(ics(flood(dates))), 12);
  assert.ok(ratio < 12, `crescita ×${ratio.toFixed(1)} con un input 8 volte più grande`);
  // Si leggono le 2000 più vicine a oggi (il doppio delle righe che l'unione tiene per una serie).
  assert.equal(parsed.events.find((event) => event.uid === "flood").exdates.length, 2000);
  assert.equal(parsed.events.find((event) => event.uid === "flood").editedExdates.length, 2000);
  assert.equal(plan.added, 2);
  assert.ok(plan.puts.length <= 2 + 2 * 1000, `${plan.puts.length} righe`);
  assert.ok(plan.puts.filter((event) => event.seriesId).length >= 1000);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /«Flood» e «Sparse»/);
});

test("fusi con le virgole protette (Outlook: «Amsterdam\\, Berlino\\, Roma»): riconosciuti", () => {
  const zone = "(UTC+01:00) Amsterdam\\, Berlino\\, Berna\\, Roma\\, Stoccolma\\, Vienna";
  const vtimezone = [
    "BEGIN:VTIMEZONE",
    `TZID:${zone}`,
    "BEGIN:STANDARD",
    "DTSTART:16011028T030000",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
    "TZOFFSETFROM:+0200",
    "TZOFFSETTO:+0100",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    "DTSTART:16010325T020000",
    "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
    "TZOFFSETFROM:+0100",
    "TZOFFSETTO:+0200",
    "END:DAYLIGHT",
    "END:VTIMEZONE"
  ];
  // Il parametro di Outlook ha le virgole normali tra virgolette; qualcuno lo scrive protetto come il testo.
  for (const param of [`"${zone.replace(/\\,/g, ",")}"`, `"${zone}"`]) {
    const parsed = parseIcs(ics(vtimezone, "BEGIN:VEVENT", "UID:x", `DTSTART;TZID=${param}:20261103T100000`, "SUMMARY:Ricevimento", "END:VEVENT"), { timeZone: "America/New_York" });
    assert.deepEqual(parsed.warnings, [], param);
    assert.equal(parsed.events[0].start, "2026-11-03T09:00:00.000Z", param);
    assert.equal(parsed.events[0].timeZone, "Europe/Berlin", param);
  }
});

test("anni prima del 100, intervalli non validi e durate di millenni", () => {
  const ancient = parseIcs(ics("BEGIN:VEVENT", "UID:a", "DTSTART:00010101T090000Z", "SUMMARY:Antico", "END:VEVENT"), { timeZone: "Europe/Rome" });
  assert.equal(ancient.events[0].start, "0001-01-01T09:00:00.000Z");
  const invalid = parseIcs(ics("BEGIN:VEVENT", "UID:b", "DTSTART:20261102T090000Z", "RRULE:FREQ=WEEKLY;INTERVAL=0", "SUMMARY:x", "END:VEVENT"), { timeZone: "Europe/Rome" });
  assert.match(invalid.warnings.join(" "), /un intervallo non valido/);
  const tooLong = parseIcs(ics("BEGIN:VEVENT", "UID:c", "DTSTART:20261102T090000Z", "RRULE:FREQ=WEEKLY;INTERVAL=500", "SUMMARY:x", "END:VEVENT"), { timeZone: "Europe/Rome" });
  assert.match(tooLong.warnings.join(" "), /un intervallo troppo lungo/);
  const forever = parseIcs(
    ics(
      "BEGIN:VEVENT",
      "UID:d",
      "DTSTART;VALUE=DATE:20261102",
      "DTEND;VALUE=DATE:99991231",
      "SUMMARY:Eterno",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:e",
      "DTSTART:20261102T090000Z",
      "DURATION:P99999D",
      "SUMMARY:Lunghissimo",
      "END:VEVENT"
    ),
    { timeZone: "Europe/Rome" }
  );
  assert.equal(forever.events[0].end, "2027-11-03T00:00:00");
  assert.equal(forever.events[1].end, "2027-11-03T09:00:00.000Z");
  assert.equal(forever.warnings.length, 1);
  assert.match(forever.warnings[0], /«Eterno» e «Lunghissimo»/);
});

test("compleanni e anniversari: tipo, anno e persona tornano uguali in un altro account", () => {
  const birthday = applyRepeatFields(
    { id: "b", createdAt: T0, updatedAt: T0, archived: false, tags: [], title: "Compleanno di Anna", description: "", category: "other", color: "#7CF7C8", priority: "medium", recurrence: "none", status: "planned", checklist: [], attachmentIds: [], notes: "", links: [], allDay: true, start: "2026-03-14T00:00:00", end: "2026-03-15T00:00:00", repeat: { freq: "yearly" }, occasion: { kind: "birthday", birthYear: 2000, person: "Anna, la cugina" } },
    { repeatChanged: true }
  );
  const text = buildIcs({ events: [birthday], exams: [], tasks: [], subjects: [], timeZone: "Europe/Rome", now: new Date(NOW) });
  assert.ok(text.includes("X-STUDYOS-OCCASION;KIND=BIRTHDAY;YEAR=2000:Anna\\, la cugina"));
  const fresh = apply([], merge([], parseIcs(text, { timeZone: "America/New_York" })));
  assert.deepEqual(fresh[0].occasion, { kind: "birthday", birthYear: 2000, person: "Anna, la cugina" });
  // Un valore strano non entra.
  const odd = parseIcs(ics("BEGIN:VEVENT", "UID:o", "DTSTART;VALUE=DATE:20260314", "X-STUDYOS-OCCASION;KIND=PARTY;YEAR=abc:x", "SUMMARY:x", "END:VEVENT"));
  assert.equal(odd.events[0].occasion, undefined);
});

test("R3-F1 + N6 (revisione finale). Luogo e colore scelto: esportati e reimportati uguali, anche su un giorno cambiato", () => {
  const base = { createdAt: T0, updatedAt: T0, archived: false, tags: [], description: "Portare il camice", category: "lesson", priority: "medium", recurrence: "none", status: "planned", checklist: [], attachmentIds: [], notes: "", links: [], timeZone: "Europe/Rome" };
  let events = [
    applyRepeatFields(
      { ...base, id: "loc", title: "Anatomia", location: "Aula G21, via Celoria 26; piano 2", color: "#ff6347", colorCustom: true, start: "2026-11-02T08:00:00.000Z", end: "2026-11-02T10:00:00.000Z", repeat: { freq: "weekly", byWeekday: ["MO"], end: { type: "count", count: 4 } } },
      { repeatChanged: true }
    ),
    { ...base, id: "hex", title: "Ricevimento", color: "#3a7bd5", colorCustom: true, start: "2026-11-04T15:00:00.000Z", end: "2026-11-04T16:00:00.000Z" },
    { ...base, id: "auto", title: "Seminario", color: "#7CF7C8", start: "2026-11-05T15:00:00.000Z", end: "2026-11-05T16:00:00.000Z" }
  ];
  // Un giorno della serie in un'altra aula.
  events = apply(events, planEdit(events[0], events, "2026-11-16", "this", { location: "Aula Magna" }, { now: T0 }));
  const text = buildIcs({ events, exams: [], tasks: [], subjects: [], timeZone: "Europe/Rome", now: new Date(NOW) });
  assert.ok(text.includes("LOCATION:Aula G21\\, via Celoria 26\\; piano 2"));
  assert.ok(text.includes("LOCATION:Aula Magna"));
  assert.ok(text.includes("COLOR:tomato"), "un colore con un nome CSS va in COLOR (RFC 7986)");
  assert.ok(text.includes("X-STUDYOS-COLOR:#3a7bd5"), "gli altri con il valore esatto");
  assert.equal((text.match(/COLOR:/g) ?? []).length, 3, "il colore della tipologia non si esporta (serie, giorno cambiato, ricevimento)");
  assert.ok(!/Luogo/.test(text));
  for (const device of ["Europe/Rome", "America/New_York"]) {
    // Stesso calendario: niente da cambiare.
    const again = merge(events, parseIcs(text, { timeZone: device }), { timeZone: device });
    assert.deepEqual(counts(again), NOTHING, device);
    // Un altro account: stessi luoghi e colori, la descrizione senza il luogo dentro.
    const fresh = apply([], merge([], parseIcs(text, { timeZone: device }), { timeZone: device }));
    const series = fresh.find((event) => event.title === "Anatomia" && !event.seriesId);
    assert.equal(series.location, "Aula G21, via Celoria 26; piano 2", device);
    assert.equal(series.description, "Portare il camice", device);
    assert.deepEqual([series.color, series.colorCustom], ["#ff6347", true], device);
    const row = fresh.find((event) => event.seriesId === series.id && event.originalDate === "2026-11-16");
    assert.equal(row.location, "Aula Magna", device);
    const hex = fresh.find((event) => event.title === "Ricevimento");
    assert.deepEqual([hex.color, hex.colorCustom, hex.location], ["#3a7bd5", true, undefined], device);
    const auto = fresh.find((event) => event.title === "Seminario");
    assert.equal(auto.colorCustom, undefined, device);
    assert.deepEqual(counts(merge(fresh, parseIcs(text, { timeZone: device }), { timeZone: device })), NOTHING, `${device}: secondo import`);
  }
  // Un file estraneo: LOCATION nel suo campo, COLOR con un nome, valori strani ignorati.
  const foreign = parseIcs(
    ics(
      "BEGIN:VEVENT", "UID:f1", "DTSTART:20261102T080000Z", "DTEND:20261102T090000Z", "SUMMARY:Lab", "LOCATION:Edificio 3", "DESCRIPTION:Note", "COLOR:DarkOrange", "END:VEVENT",
      "BEGIN:VEVENT", "UID:f2", "DTSTART:20261103T080000Z", "DTEND:20261103T090000Z", "SUMMARY:Altro", "COLOR:url(javascript:alert(1))", "X-STUDYOS-COLOR:red;background:url(x)", "END:VEVENT"
    )
  );
  assert.deepEqual([foreign.events[0].location, foreign.events[0].description, foreign.events[0].color], ["Edificio 3", "Note", "#ff8c00"]);
  assert.deepEqual([foreign.events[1].location, foreign.events[1].color], [undefined, undefined]);
  const [lab] = apply([], merge([], foreign));
  assert.deepEqual([lab.location, lab.color, lab.colorCustom], ["Edificio 3", "#ff8c00", true]);
  // Il file cambia luogo: l'evento si aggiorna.
  const moved = merge([lab], parseIcs(ics("BEGIN:VEVENT", "UID:f1", "DTSTART:20261102T080000Z", "DTEND:20261102T090000Z", "SUMMARY:Lab", "LOCATION:Edificio 4", "DESCRIPTION:Note", "COLOR:DarkOrange", "END:VEVENT")));
  assert.equal(moved.updated, 1);
  assert.equal(apply([lab], moved)[0].location, "Edificio 4");
});

test("una serie salvata in UTC, esportata da un altro fuso e reimportata ovunque, resta uguale (giorno cancellato compreso)", () => {
  let events = [
    applyRepeatFields(
      { id: "u", createdAt: T0, updatedAt: T0, archived: false, tags: [], title: "Lab", description: "", category: "lab", color: "#7CF7C8", priority: "medium", recurrence: "none", status: "planned", checklist: [], attachmentIds: [], notes: "", links: [], timeZone: "UTC", start: "2026-03-23T02:30:00.000Z", end: "2026-03-23T03:30:00.000Z", repeat: { freq: "daily", end: { type: "count", count: 10 } } },
      { repeatChanged: true }
    )
  ];
  events = apply(events, planDelete(events, "u", "2026-03-29", "this", { now: NOW }));
  const shown = (list) => window(list, "2026-03-20T00:00:00Z", "2026-04-10T00:00:00Z");
  assert.equal(shown(events).length, 9);
  for (const exportZone of ["Europe/Rome", "America/New_York", "UTC"]) {
    const text = buildIcs({ events, exams: [], tasks: [], subjects: [], timeZone: exportZone, now: new Date(NOW) });
    assert.ok(text.includes("DTSTART;TZID=UTC:20260323T023000"), exportZone);
    assert.ok(text.includes("EXDATE;TZID=UTC:20260329T023000"), exportZone);
    assert.ok(text.includes("BEGIN:VTIMEZONE\r\nTZID:UTC"), exportZone);
    for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
      const items = icsImportItems(parseIcs(text, { timeZone: device }).events, { defaultCategory: "lesson" });
      const plan = mergeIcsImport({ events, exams: [], tasks: [], items, now: NOW, newId, timeZone: device });
      assert.deepEqual({ added: plan.added, updated: plan.updated, puts: plan.puts.length, deletes: plan.deletes.length }, { added: 0, updated: 0, puts: 0, deletes: 0 }, `${exportZone} -> ${device}`);
      const fresh = apply([], mergeIcsImport({ events: [], exams: [], tasks: [], items, now: NOW, newId, timeZone: device }));
      assert.equal(fresh.find((event) => !event.seriesId).timeZone, "UTC", `${exportZone} -> ${device}`);
      assert.deepEqual(shown(fresh), shown(events), `${exportZone} -> ${device}`);
    }
  }
});

test("caso 12: esporta, reimporta nello stesso calendario: niente doppioni; esami e scadenze riconosciuti", () => {
  const weekly = applyRepeatFields(
    { id: "e1", createdAt: T0, updatedAt: T0, archived: false, tags: [], title: "Anatomia", description: "Aula G21", notes: "Portare il camice", category: "lesson", color: "#7CF7C8", priority: "medium", start: "2026-11-02T08:00:00.000Z", end: "2026-11-02T10:00:00.000Z", recurrence: "none", status: "planned", checklist: [], attachmentIds: [], links: [], timeZone: "Europe/Rome", repeat: { freq: "weekly", byWeekday: ["MO", "WE"] }, reminders: [{ minutesBefore: 15 }] },
    { repeatChanged: true }
  );
  let events = [weekly, { ...weekly, id: "solo", title: "Seminario", repeat: undefined, repeatLegacy: undefined, recurrence: "none", recurrenceUntil: undefined, reminders: undefined }];
  events = apply(events, planDelete(events, "e1", "2026-11-09", "this", { now: T0 }));
  events = apply(events, planEdit(events.find((e) => e.id === "e1"), events, "2026-11-11", "this", { title: "Esercitazione", start: "2026-11-11T13:00:00.000Z", end: "2026-11-11T15:00:00.000Z" }, { now: T0 }));
  events = apply(events, planEdit(events.find((e) => e.id === "e1"), events, "2026-11-23", "following", { title: "Anatomia (aula nuova)" }, { now: T0 }));
  const exams = [{ id: "x1", subjectId: "s1", date: "2027-01-20T08:00:00.000Z", archived: false }];
  const tasks = [{ id: "t1", title: "Relazione", dueDate: "2026-11-30T17:00:00.000Z", status: "todo" }];
  const text = buildIcs({ events, exams, tasks, subjects: [{ id: "s1", name: "Anatomia" }], timeZone: "Europe/Rome", now: new Date(NOW) });
  for (const device of ["Europe/Rome", "America/New_York", "UTC"]) {
    const plan = mergeIcsImport({ events, exams, tasks, items: icsImportItems(parseIcs(text, { timeZone: device }).events, { defaultCategory: "lesson" }), now: NOW, newId });
    assert.deepEqual({ added: plan.added, updated: plan.updated, puts: plan.puts.length, deletes: plan.deletes.length }, { added: 0, updated: 0, puts: 0, deletes: 0 }, device);
  }
  // In un calendario vuoto (un altro account): stesse occorrenze, stessi titoli.
  const fresh = apply([], mergeIcsImport({ events: [], exams: [], tasks: [], items: icsImportItems(parseIcs(text, { timeZone: "America/New_York" }).events, { defaultCategory: "lesson" }), now: NOW, newId }));
  const ownEvents = window(events).sort();
  const imported = window(fresh.filter((event) => !/^(Esame|Scadenza):/.test(event.title))).sort();
  assert.deepEqual(imported, ownEvents);
  // E un secondo import nell'altro account non duplica.
  const second = mergeIcsImport({ events: fresh, exams: [], tasks: [], items: icsImportItems(parseIcs(text, { timeZone: "UTC" }).events, { defaultCategory: "lesson" }), now: NOW, newId });
  assert.equal(second.added + second.updated + second.puts.length + second.deletes.length, 0);
});

test("una RECURRENCE-ID senza la sua serie diventa un evento singolo, deduplicato con uid e data", () => {
  const lone = ics(
    "BEGIN:VEVENT",
    "UID:lonely@example.com",
    "RECURRENCE-ID:20261118T080000Z",
    "DTSTART:20261118T130000Z",
    "DTEND:20261118T140000Z",
    "SUMMARY:Solo questa",
    "END:VEVENT"
  );
  const first = merge([], parseIcs(lone, { timeZone: "Europe/Rome" }));
  assert.equal(first.added, 1);
  const events = apply([], first);
  assert.equal(events[0].sourceUid, "lonely@example.com");
  assert.equal(events[0].sourceRecurrenceId, "20261118T080000Z");
  assert.equal(events[0].seriesId, undefined);
  assert.equal(merge(events, parseIcs(lone, { timeZone: "Europe/Rome" })).added, 0);
});

// ------------------------------------------------------------------------------------------
// Reimportare un file non cambiato tiene le modifiche fatte qui (ricontrollo di rilascio, punto 2)
// ------------------------------------------------------------------------------------------

const COURSE_FILE = (...rows) => ics("X-WR-TIMEZONE:Europe/Rome", ...rows);
const lesson = (uid, title, day, extra = []) => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  `DTSTART;TZID=Europe/Rome:202611${day}T090000`,
  `DTEND;TZID=Europe/Rome:202611${day}T100000`,
  `SUMMARY:${title}`,
  ...extra,
  "END:VEVENT"
];
const TWO_LESSONS = COURSE_FILE(lesson("a@g", "Anatomia", "02"), lesson("b@g", "Chimica", "03", ["RRULE:FREQ=WEEKLY;COUNT=4"]));
const reimport = (events, text) => merge(events, parseIcs(text, { timeZone: "Europe/Rome" }), { timeZone: "Europe/Rome" });
const editedLocally = (events) =>
  events.map((event) =>
    event.sourceUid === "a@g" ? { ...event, title: "Anatomia (aula cambiata da me)", location: "Aula 5" } : event.sourceUid === "b@g" && !event.seriesId ? { ...event, title: "Chimica (mia)" } : event
  );

test("ogni evento importato ricorda com'era nel file (un testo), le righe dei giorni no", () => {
  const first = apply([], reimport([], COURSE_FILE(lesson("b@g", "Chimica", "03", ["RRULE:FREQ=WEEKLY;COUNT=4", "EXDATE;TZID=Europe/Rome:20261110T090000"]))));
  const master = first.find((event) => !event.seriesId);
  assert.equal(typeof master.sourceStamp, "string");
  assert.ok(master.sourceStamp.length > 4);
  const row = first.find((event) => event.seriesId);
  assert.ok(row && !("sourceStamp" in row));
});

test("le modifiche fatte qui restano se il file non è cambiato dall'ultimo import: nessuna novità", () => {
  const mine = editedLocally(apply([], reimport([], TWO_LESSONS)));
  const plan = reimport(mine, TWO_LESSONS);
  assert.deepEqual(counts(plan), NOTHING);
  assert.equal(plan.editsReplaced, 0);
  assert.deepEqual(plan.warnings, []);
  // Anche più volte di seguito.
  assert.deepEqual(counts(reimport(mine, TWO_LESSONS)), NOTHING);
});

test("se il file è cambiato si aggiorna, e l'anteprima dice quanti eventi modificati qui vengono sostituiti", () => {
  const mine = editedLocally(apply([], reimport([], TWO_LESSONS)));
  const changed = COURSE_FILE(lesson("a@g", "Anatomia (aula G21)", "02"), lesson("b@g", "Chimica (laboratorio)", "03", ["RRULE:FREQ=WEEKLY;COUNT=4"]));
  const plan = reimport(mine, changed);
  assert.equal(plan.updated, 2);
  assert.equal(plan.editsReplaced, 2);
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /^2 eventi che avevi modificato qui sono cambiati nel file/);
  assert.match(plan.warnings[0], /«Anatomia \(aula cambiata da me\)» e «Chimica \(mia\)»/);
  assert.match(plan.warnings[0], /vengono sostituite da quelle del file/);
  const after = apply(mine, plan);
  const anatomy = after.find((event) => event.sourceUid === "a@g");
  assert.equal(anatomy.title, "Anatomia (aula G21)");
  assert.equal(anatomy.location, undefined);
  // Dopo l'aggiornamento, nuove modifiche qui restano con lo stesso file.
  const again = after.map((event) => (event.id === anatomy.id ? { ...event, title: "Anatomia (di nuovo mia)" } : event));
  assert.deepEqual(counts(reimport(again, changed)), NOTHING);
});

test("file cambiato ed evento mai toccato qui: si aggiorna senza avviso; un solo evento lo dice al singolare", () => {
  const first = apply([], reimport([], TWO_LESSONS));
  const changed = COURSE_FILE(lesson("a@g", "Anatomia (aula G21)", "02"), lesson("b@g", "Chimica", "03", ["RRULE:FREQ=WEEKLY;COUNT=4"]));
  const clean = reimport(first, changed);
  assert.deepEqual([clean.updated, clean.editsReplaced, clean.warnings.length], [1, 0, 0]);
  // Chimica è cambiata solo qui (il file no): resta com'è; Anatomia è cambiata in entrambi.
  const one = reimport(editedLocally(first), changed);
  assert.deepEqual([one.updated, one.editsReplaced], [1, 1]);
  assert.match(one.warnings[0], /^«Anatomia \(aula cambiata da me\)» è cambiato nel file/);
  assert.equal(apply(editedLocally(first), one).find((event) => event.sourceUid === "b@g" && !event.seriesId).title, "Chimica (mia)");
});

test("una divisione fatta qui («questa e le successive») non conta come modifica sostituita", () => {
  const first = apply([], reimport([], TWO_LESSONS));
  const chem = first.find((event) => event.sourceUid === "b@g" && !event.seriesId);
  const split = apply(first, planEdit(chem, first, "2026-11-17", "following", { title: "Chimica (aula nuova)" }, { now: NOW }));
  const changed = COURSE_FILE(lesson("a@g", "Anatomia", "02"), lesson("b@g", "Chimica (orario nuovo)", "03", ["RRULE:FREQ=WEEKLY;COUNT=4"]));
  const plan = reimport(split, changed);
  assert.deepEqual([plan.updated, plan.editsReplaced], [1, 0]);
  const shown = window(apply(split, plan)).filter((line) => line.includes("Chimica"));
  assert.deepEqual(shown, [
    "2026-11-03T08:00:00.000Z Chimica (orario nuovo)",
    "2026-11-10T08:00:00.000Z Chimica (orario nuovo)",
    "2026-11-17T08:00:00.000Z Chimica (aula nuova)",
    "2026-11-24T08:00:00.000Z Chimica (aula nuova)"
  ]);
});

/** Calendario importato prima di questa versione: nessuna impronta. */
const withoutStamps = (events) =>
  events.map((event) => {
    const copy = { ...event };
    delete copy.sourceStamp;
    return copy;
  });

test("vecchi import senza impronta, uguali al file: l'impronta si scrive senza contarli come aggiornati", () => {
  const old = withoutStamps(apply([], reimport([], TWO_LESSONS)));
  const plan = reimport(old, TWO_LESSONS);
  assert.deepEqual([plan.added, plan.updated, plan.deletes.length, plan.editsReplaced, plan.warnings.length], [0, 0, 0, 0, 0]);
  // Solo le due serie, uguali a prima tranne l'impronta (nemmeno updatedAt cambia).
  assert.equal(plan.puts.length, 2);
  for (const put of plan.puts) {
    assert.equal(typeof put.sourceStamp, "string");
    const { sourceStamp, ...rest } = put;
    assert.deepEqual(rest, old.find((event) => event.id === put.id));
  }
  assert.equal(importButton(plan), "remember");
  // Da qui in poi le modifiche fatte qui restano con lo stesso file.
  const stamped = apply(old, plan);
  assert.deepEqual(counts(reimport(stamped, TWO_LESSONS)), NOTHING);
  const mine = editedLocally(stamped);
  const again = reimport(mine, TWO_LESSONS);
  assert.deepEqual(counts(again), NOTHING);
  assert.equal(importButton(again), "nothing");
});

test("vecchi import senza impronta e diversi dal file: vince il file, e l'anteprima dice chiaro che non si sa chi li ha cambiati", () => {
  const old = withoutStamps(apply([], reimport([], TWO_LESSONS)));
  const plan = reimport(editedLocally(old), TWO_LESSONS);
  assert.deepEqual([plan.updated, plan.editsReplaced], [2, 0]);
  assert.equal(importButton(plan), "import");
  assert.equal(plan.warnings.length, 1);
  assert.match(plan.warnings[0], /^2 eventi qui sono diversi dal file e StudyOS non sa se li hai cambiati tu \(«Anatomia \(aula cambiata da me\)» e «Chimica \(mia\)»\): se importi, tornano come nel file\./);
  assert.match(plan.warnings[0], /Da questa importazione in poi, le modifiche che fai qui restano finché l'evento non cambia nel file\.$/);
  // Il testo fisso dell'anteprima non promette di tenerle: rimanda agli avvisi.
  assert.match(CALENDAR_GUIDE_TEXT.previewNoDuplicates, /tranne dove un avviso/);
  const after = apply(editedLocally(old), plan);
  assert.equal(after.find((event) => event.sourceUid === "a@g").title, "Anatomia");
  assert.ok(after.filter((event) => !event.seriesId).every((event) => typeof event.sourceStamp === "string"));
  assert.deepEqual(counts(reimport(editedLocally(after), TWO_LESSONS)), NOTHING);
  // Un evento solo: al singolare.
  const one = reimport(old.map((event) => (event.sourceUid === "a@g" ? { ...event, title: "Anatomia (mia)" } : event)), TWO_LESSONS);
  assert.match(one.warnings[0], /^«Anatomia \(mia\)» qui è diverso dal file e StudyOS non sa se l'hai cambiato tu: se importi, torna com'è nel file\./);
});

test("impronta uguale su ogni dispositivo: ore senza fuso e ore in UTC non dipendono dal fuso del telefono", () => {
  const files = {
    floating: ics(["BEGIN:VEVENT", "UID:f@x", "DTSTART:20261105T090000", "DTEND:20261105T100000", "SUMMARY:Senza fuso", "RRULE:FREQ=WEEKLY;UNTIL=20261203T090000", "END:VEVENT"]),
    utc: ics(["BEGIN:VEVENT", "UID:u@x", "DTSTART:20261105T090000Z", "DTEND:20261105T100000Z", "SUMMARY:In UTC", "END:VEVENT"]),
    allDay: ics(["BEGIN:VEVENT", "UID:d@x", "DTSTART;VALUE=DATE:20261207", "DTEND;VALUE=DATE:20261211", "SUMMARY:Gita", "END:VEVENT"])
  };
  for (const [label, text] of Object.entries(files)) {
    const inRome = apply([], merge([], parseIcs(text, { timeZone: "Europe/Rome" }), { timeZone: "Europe/Rome" }));
    const mine = inRome.map((event) => (event.seriesId ? event : { ...event, title: `${event.title} (mia)` }));
    for (const zone of ["America/New_York", "Pacific/Kiritimati", "Asia/Tokyo"]) {
      const plan = merge(mine, parseIcs(text, { timeZone: zone }), { timeZone: zone });
      assert.deepEqual(counts(plan), NOTHING, `${label} ${zone}`);
      assert.equal(plan.editsReplaced, 0, `${label} ${zone}`);
    }
  }
});

test("le modifiche sostituite comprendono «saltato»: l'avviso lo dice", () => {
  const plan = reimport(editedLocally(apply([], reimport([], TWO_LESSONS))), COURSE_FILE(lesson("a@g", "Anatomia (aula G21)", "02")));
  assert.match(plan.warnings.find((warning) => warning.includes("sostituite")), /promemoria e lo stato «saltato»\)/);
});

test("l'impronta resta privata e non passa alle parti divise né ai giorni modificati", () => {
  const first = apply([], reimport([], TWO_LESSONS));
  const chem = first.find((event) => event.sourceUid === "b@g" && !event.seriesId);
  assert.equal(typeof chem.sourceStamp, "string");
  // Mai agli agenti. Con una condivisione viaggia come gli altri campi: il server conserva solo le sue chiavi
  // protette, e toglierla farebbe perdere l'impronta al proprietario quando chi riceve modifica l'evento.
  assert.equal("sourceStamp" in publicEntity(chem), false);
  assert.equal(withoutProtectedKeys(chem).sourceStamp, chem.sourceStamp);
  // «Solo questa»: la riga non la eredita; «questa e le successive»: la figlia nemmeno.
  const row = planEdit(chem, first, "2026-11-10", "this", { title: "Chimica (spostata)" }, { now: NOW }).puts.find((event) => event.seriesId);
  assert.ok(row && !("sourceStamp" in row));
  const split = planEdit(chem, first, "2026-11-17", "following", { title: "Chimica II" }, { now: NOW }).puts;
  const child = split.find((event) => event.splitFrom);
  assert.ok(child && !("sourceStamp" in child));
  assert.equal(split.find((event) => event.id === chem.id).sourceStamp, chem.sourceStamp);
  // Una modifica a mano non la cambia (la scrive solo l'importazione).
  const all = planEdit(chem, first, "2026-11-03", "all", { title: "Chimica generale", sourceStamp: "x.y" }, { now: NOW }).puts.find((event) => event.id === chem.id);
  assert.equal(all.sourceStamp, chem.sourceStamp);
});

test("condivisione: la modifica di chi riceve tiene l'impronta del proprietario, e il suo prossimo import non la annulla", () => {
  const owner = apply([], reimport([], TWO_LESSONS));
  const anatomy = owner.find((event) => event.sourceUid === "a@g");
  // Chi riceve cambia la descrizione: scrittura preparata e inviata come fa l'app.
  const edited = prepareSharedWrite(anatomy, { ...anatomy, description: "Portare il camice" }, NOW);
  const item = { key: `owner:calendarEvent:${anatomy.id}`, ownerId: "owner", entityType: "calendarEvent", entityId: anatomy.id, entity: edited, serverUpdatedAt: NOW };
  const entry = { key: item.key, ownerId: "owner", entityType: "calendarEvent", entityId: anatomy.id, deleted: false, queuedAt: NOW };
  const sent = sharedPushBatches([entry], [item]).batches[0].rows[0].payload;
  assert.equal(sent.sourceStamp, anatomy.sourceStamp);
  // Il server (studyos_recipient_payload) tiene le chiavi nuove non protette e quelle protette salvate.
  const serverProtected = new RegExp(/v_protected constant text := '([^']+)'/.exec(readFileSync(new URL("../supabase/sharing.sql", import.meta.url), "utf8"))[1]);
  const stored = {
    ...Object.fromEntries(Object.entries(sent).filter(([key]) => !serverProtected.test(key))),
    ...Object.fromEntries(Object.entries(anatomy).filter(([key]) => serverProtected.test(key)))
  };
  assert.equal(stored.sourceStamp, anatomy.sourceStamp);
  // Il proprietario reimporta lo stesso file: la modifica di chi riceve resta.
  const synced = owner.map((event) => (event.id === anatomy.id ? stored : event));
  const plan = reimport(synced, TWO_LESSONS);
  assert.deepEqual([counts(plan), plan.warnings], [NOTHING, []]);
  assert.equal(apply(synced, plan).find((event) => event.id === anatomy.id).description, "Portare il camice");
});

test("fuso con nome inventato (Outlook «Customized Time Zone»): se le sue regole cambiano, l'evento si aggiorna", () => {
  const zone = (standardAt, daylightAt, standard, daylight) => [
    "BEGIN:VTIMEZONE",
    "TZID:Customized Time Zone",
    "BEGIN:STANDARD",
    `DTSTART:19701025T${standardAt}`,
    `TZOFFSETFROM:${daylight}`,
    `TZOFFSETTO:${standard}`,
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "END:STANDARD",
    "BEGIN:DAYLIGHT",
    `DTSTART:19700329T${daylightAt}`,
    `TZOFFSETFROM:${standard}`,
    `TZOFFSETTO:${daylight}`,
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "END:DAYLIGHT",
    "END:VTIMEZONE"
  ];
  const outlook = (rules) =>
    ics(
      "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN",
      rules,
      "BEGIN:VEVENT",
      "UID:o1@outlook",
      "SUMMARY:Riunione",
      'DTSTART;TZID="Customized Time Zone":20261120T090000',
      'DTEND;TZID="Customized Time Zone":20261120T100000',
      "END:VEVENT"
    );
  const rome = outlook(zone("030000", "020000", "+0100", "+0200"));
  const london = outlook(zone("020000", "010000", "+0000", "+0100"));
  const first = apply([], reimport([], rome));
  assert.equal(first[0].start, "2026-11-20T08:00:00.000Z");
  // Su un altro dispositivo lo stesso file non cambia nulla (l'impronta non dipende dal fuso del telefono).
  for (const device of ["America/New_York", "Asia/Tokyo"]) assert.deepEqual(counts(merge(first, parseIcs(rome, { timeZone: device }), { timeZone: device })), NOTHING, device);
  const plan = reimport(first, london);
  assert.equal(plan.updated, 1);
  const after = apply(first, plan);
  assert.equal(after[0].start, "2026-11-20T09:00:00.000Z");
  assert.deepEqual(counts(reimport(after, london)), NOTHING);
});

test("stesso evento scritto in altro modo (regola in altro ordine, X-WR-TIMEZONE nuovo): le modifiche fatte qui restano", () => {
  const physics = (zone, rule) =>
    ics(`X-WR-TIMEZONE:${zone}`, "BEGIN:VEVENT", "UID:h@x", "DTSTART;TZID=Europe/Rome:20261104T090000", "DTEND;TZID=Europe/Rome:20261104T100000", `RRULE:${rule}`, "SUMMARY:Fisica", "END:VEVENT");
  const original = physics("Europe/Rome", "FREQ=WEEKLY;COUNT=6");
  const series = (events) => events.find((event) => event.sourceUid === "h@x" && !event.seriesId);
  const mine = (events) => events.map((event) => (event === series(events) ? { ...event, title: "Fisica (mia)" } : event));
  const halves = (event) => event.sourceStamp.split(".");
  for (const [label, reworded] of [
    ["regola in altro ordine", physics("Europe/Rome", "COUNT=6;FREQ=WEEKLY")],
    ["X-WR-TIMEZONE nuovo", physics("Europe/Berlin", "FREQ=WEEKLY;COUNT=6")]
  ]) {
    const first = apply([], reimport([], original));
    // Senza modifiche qui: si aggiorna solo la metà del file dell'impronta, e non conta come aggiornato.
    const plan = reimport(first, reworded);
    assert.deepEqual([plan.added, plan.updated, plan.deletes.length, plan.editsReplaced, plan.warnings.length, plan.puts.length], [0, 0, 0, 0, 0, 1], label);
    const { sourceStamp, ...rest } = plan.puts[0];
    const { sourceStamp: before, ...unchanged } = series(first);
    assert.deepEqual(rest, unchanged, label);
    assert.notEqual(sourceStamp.split(".")[0], before.split(".")[0], label);
    assert.equal(sourceStamp.split(".")[1], before.split(".")[1], label);
    const refreshed = apply(first, plan);
    assert.deepEqual(counts(reimport(refreshed, reworded)), NOTHING, label);
    assert.deepEqual(counts(reimport(mine(refreshed), reworded)), NOTHING, label);
    // Modificato qui prima del file riscritto: la modifica resta, nessun avviso, solo l'impronta cambia.
    const edited = mine(first);
    const quiet = reimport(edited, reworded);
    assert.deepEqual([quiet.added, quiet.updated, quiet.deletes.length, quiet.editsReplaced, quiet.warnings.length], [0, 0, 0, 0, 0], label);
    assert.equal(importButton(quiet), "remember", label);
    const kept = apply(edited, quiet);
    assert.equal(series(kept).title, "Fisica (mia)", label);
    assert.deepEqual(halves(series(kept)), [halves(plan.puts[0])[0], halves(series(first))[1]], label);
    assert.deepEqual(counts(reimport(kept, reworded)), NOTHING, label);
    // Il file cambia davvero (altra regola): vince il file, e lo si dice.
    const changed = reimport(kept, physics("Europe/Rome", "FREQ=WEEKLY;COUNT=8"));
    assert.deepEqual([changed.updated, changed.editsReplaced], [1, 1], label);
    assert.equal(series(apply(kept, changed)).title, "Fisica", label);
  }
});

test("il proprio export con le modifiche fatte qui, poi il file di Google invariato: le modifiche restano, senza avvisi", () => {
  const mine = editedLocally(apply([], reimport([], TWO_LESSONS)));
  const own = buildIcs({ events: mine, exams: [], tasks: [], subjects: [], timeZone: "Europe/Rome", now: new Date(NOW) });
  // Il file dice com'è l'evento adesso: cambia solo la metà del file dell'impronta.
  const back = reimport(mine, own);
  assert.deepEqual(quietCounts(back, mine), QUIET);
  let events = apply(mine, back);
  const google = reimport(events, TWO_LESSONS);
  assert.deepEqual([quietCounts(google, events), google.editsReplaced], [QUIET, 0]);
  events = apply(events, google);
  const anatomy = events.find((event) => event.sourceUid === "a@g");
  assert.deepEqual([anatomy.title, anatomy.location], ["Anatomia (aula cambiata da me)", "Aula 5"]);
  assert.equal(events.find((event) => event.sourceUid === "b@g" && !event.seriesId).title, "Chimica (mia)");
  // Google cambia davvero: vince il file, e l'avviso dice che le modifiche fatte qui vengono sostituite.
  const changed = reimport(events, COURSE_FILE(lesson("a@g", "Anatomia (aula G21)", "02"), lesson("b@g", "Chimica (laboratorio)", "03", ["RRULE:FREQ=WEEKLY;COUNT=4"])));
  assert.deepEqual([changed.updated, changed.editsReplaced], [2, 2]);
});

// ------------------------------------------------------------------------------------------
// File ostili da 5 MB e file troppo grandi (ricontrollo di rilascio, punti 5 e 10)
// ------------------------------------------------------------------------------------------

const FIVE_MB = 5 * 1024 * 1024;
const wrapped = (body) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${body}END:VCALENDAR\r\n`;
/** Lettura e unione come nell'anteprima, con il tempo impiegato. */
const timed = (text) => {
  const started = performance.now();
  const parsed = parseIcs(text, { timeZone: "Europe/Rome", now: NOW });
  const plan = merge([], parsed, { timeZone: "Europe/Rome" });
  return { parsed, plan, elapsed: performance.now() - started, warnings: [...parsed.warnings, ...plan.warnings] };
};
// Tetto largo per una macchina carica (test in parallelo): da soli stanno sotto il mezzo secondo, prima
// di questa correzione 12 s (fusi inventati), 5 s (fusi sconosciuti) e 4,6 s (300.000 date escluse).
const CEILING_MS = 4000;

test("file ostile: migliaia di fusi inventati, ognuno con il suo VTIMEZONE, su date escluse: veloce, pochi avvisi", () => {
  let zones = "";
  let exdates = "";
  for (let index = 0; zones.length + exdates.length < FIVE_MB - 2000; index += 1) {
    const minutes = String(index % 60).padStart(2, "0");
    zones += `BEGIN:VTIMEZONE\r\nTZID:Z${index}\r\nBEGIN:STANDARD\r\nTZOFFSETFROM:+01${minutes}\r\nTZOFFSETTO:+01${minutes}\r\nDTSTART:19700101T000000\r\nEND:STANDARD\r\nEND:VTIMEZONE\r\n`;
    exdates += `EXDATE;TZID=Z${index}:20261103T090000\r\n`;
  }
  const { parsed, elapsed, warnings } = timed(wrapped(`${zones}BEGIN:VEVENT\r\nUID:c\r\nDTSTART;TZID=Europe/Rome:20261102T090000\r\nRRULE:FREQ=DAILY\r\n${exdates}SUMMARY:c\r\nEND:VEVENT\r\n`));
  assert.ok(elapsed < CEILING_MS, `${Math.round(elapsed)} ms`);
  assert.equal(parsed.events.length, 1);
  assert.ok(warnings.length <= 3, warnings.join("\n"));
  assert.match(warnings.find((warning) => warning.includes("fusi orari")), /^I fusi orari «Z\d+», «Z\d+», «Z\d+» e altri [\d.]+ non sono stati riconosciuti/);
});

test("file ostile: date escluse ognuna con un fuso sconosciuto diverso: veloce, un avviso solo", () => {
  let exdates = "";
  for (let index = 0; exdates.length < FIVE_MB - 2000; index += 1) exdates += `EXDATE;TZID=Nowhere/Zone${index}:20261103T090000\r\n`;
  const { elapsed, warnings } = timed(wrapped(`BEGIN:VEVENT\r\nUID:c2\r\nDTSTART;TZID=Europe/Rome:20261102T090000\r\nRRULE:FREQ=DAILY\r\n${exdates}SUMMARY:c\r\nEND:VEVENT\r\n`));
  assert.ok(elapsed < CEILING_MS, `${Math.round(elapsed)} ms`);
  assert.equal(warnings.filter((warning) => warning.includes("fus")).length, 1, warnings.join("\n"));
});

test("file ostile: una riga EXDATE con 300.000 date: si leggono le più vicine a oggi, veloce", () => {
  const values = [];
  for (let day = Date.UTC(2026, 10, 3); values.length * 16 < FIVE_MB - 400; day += 86_400_000) values.push(`${new Date(day).toISOString().slice(0, 10).replace(/-/g, "")}T090000`);
  const { parsed, plan, elapsed, warnings } = timed(wrapped(`BEGIN:VEVENT\r\nUID:e\r\nDTSTART;TZID=Europe/Rome:20261102T090000\r\nRRULE:FREQ=DAILY\r\nEXDATE;TZID=Europe/Rome:${values.join(",")}\r\nSUMMARY:Tante\r\nEND:VEVENT\r\n`));
  assert.ok(elapsed < CEILING_MS, `${Math.round(elapsed)} ms`);
  assert.ok(values.length > 300_000);
  assert.equal(parsed.events[0].exdates.length, 2000);
  const rows = plan.puts.filter((event) => event.seriesId).map((event) => event.originalDate).sort();
  assert.deepEqual([rows.length, rows[0], rows.at(-1)], [1000, "2026-11-03", "2029-07-29"]);
  assert.deepEqual(warnings, ["«Tante» ha troppi giorni esclusi o modificati: sono stati letti solo i 1000 più vicini a oggi."]);
});

test("file ostile: tante serie con migliaia di date escluse: c'è un tetto per tutto il file, e l'avviso lo dice", () => {
  const stamp = (ms) => `${new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`;
  const series = Array.from({ length: 30 }, (_, index) => [
    "BEGIN:VEVENT",
    `UID:t${index}`,
    "DTSTART:20200101T090000Z",
    "RRULE:FREQ=DAILY",
    `EXDATE:${Array.from({ length: 2000 }, (_, offset) => stamp(Date.UTC(2020, 0, 1, 9) + offset * 86_400_000)).join(",")}`,
    `SUMMARY:Serie ${index + 1}`,
    "END:VEVENT"
  ]);
  const { parsed, elapsed, warnings } = timed(ics(...series));
  assert.ok(elapsed < CEILING_MS, `${Math.round(elapsed)} ms`);
  assert.equal(parsed.events.reduce((sum, event) => sum + (event.exdates?.length ?? 0), 0), 40_000);
  assert.ok(warnings.some((warning) => /^«Serie 21», «Serie 22», «Serie 23» e altri 7 eventi: il file ha troppi giorni esclusi/.test(warning)), warnings.join("\n"));
});

test("anteprima: avvisi senza doppioni, al più 20, poi «e altri N avvisi»", () => {
  const many = Array.from({ length: 45 }, (_, index) => `Avviso ${index % 30}`);
  assert.deepEqual(previewWarnings(many), { shown: Array.from({ length: 20 }, (_, index) => `Avviso ${index}`), more: 10 });
  assert.deepEqual(previewWarnings(["a", "a", "b"]), { shown: ["a", "b"], more: 0 });
  assert.match(CALENDAR_GUIDE_TEXT.moreWarnings(10), /^…e altri 10 avvisi\.?$/);
  assert.match(CALENDAR_GUIDE_TEXT.moreWarnings(1), /^…e un altro avviso\.?$/);
});

/** Un VEVENT al giorno `day` (YYYYMMDD) delle 9, titolo `title`; `extra` righe in più. */
const dayEvent = (uid, day, title, extra = []) => ["BEGIN:VEVENT", `UID:${uid}`, `DTSTART:${day}T090000Z`, `DTEND:${day}T100000Z`, `SUMMARY:${title}`, ...extra, "END:VEVENT"];
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");

test("file con più di 2000 eventi: si leggono i 2000 più vicini a oggi, prima i prossimi e poi i più recenti", () => {
  const today = Date.parse(NOW);
  // 1500 passati (dal più vecchio), poi 900 futuri: nel file prima i vecchi.
  const past = Array.from({ length: 1500 }, (_, index) => dayEvent(`p${index}`, dayOf(today - (1500 - index) * 86_400_000), `Passato ${1500 - index}`));
  const future = Array.from({ length: 900 }, (_, index) => dayEvent(`f${index}`, dayOf(today + (index + 1) * 86_400_000), `Futuro ${index + 1}`));
  // Una serie iniziata nel 2010 e ancora in corso conta come «prossima».
  const ongoing = dayEvent("serie", "20100104", "Serie in corso", ["RRULE:FREQ=WEEKLY"]);
  const parsed = parseIcs(ics(...past, ongoing, ...future), { timeZone: "UTC", now: NOW });
  assert.equal(parsed.events.length, 2000);
  const titles = new Set(parsed.events.map((event) => event.title));
  assert.ok(titles.has("Serie in corso"));
  assert.ok(titles.has("Futuro 900") && titles.has("Futuro 1"));
  assert.ok(titles.has("Passato 1") && titles.has("Passato 1099"));
  assert.ok(!titles.has("Passato 1100") && !titles.has("Passato 1500"));
  // Nell'ordine del file.
  assert.equal(parsed.events[0].title, "Passato 1099");
  assert.deepEqual(parsed.warnings, [
    "Il file ha più di 2000 eventi: sono stati letti i 2000 più vicini a oggi (prima i prossimi, poi i più recenti). Se ti servono anche gli altri, importa un calendario alla volta."
  ]);
  // Solo futuri, più di 2000: i 2000 più vicini, nessun passato.
  const far = Array.from({ length: 2100 }, (_, index) => dayEvent(`x${index}`, dayOf(today + (2100 - index) * 86_400_000), `Tra ${2100 - index}`));
  const onlyFuture = parseIcs(ics(dayEvent("old", "20200101", "Vecchio"), ...far), { timeZone: "UTC", now: NOW });
  const kept = new Set(onlyFuture.events.map((event) => event.title));
  assert.ok(kept.has("Tra 1") && kept.has("Tra 2000") && !kept.has("Tra 2001") && !kept.has("Vecchio"));
});

// ------------------------------------------------------------------------------------------
// Store
// ------------------------------------------------------------------------------------------

beforeEach(() => {
  useStudyStore.setState({ loading: true, events: [], exams: [], tasks: [], attachments: [], notes: [], reminders: [] });
});

test("store importEvents: crea serie e righe, il secondo import non cambia nulla e lascia gli stessi oggetti", async () => {
  const items = icsImportItems(parseIcs(GOOGLE, { timeZone: "Europe/Rome" }).events, { defaultCategory: "lesson" });
  assert.deepEqual(await useStudyStore.getState().importEvents(items), { added: 3, updated: 0 });
  const before = useStudyStore.getState().events;
  assert.equal(before.filter((event) => event.seriesId).length, 2);
  assert.deepEqual(await useStudyStore.getState().importEvents(items), { added: 0, updated: 0 });
  assert.equal(useStudyStore.getState().events, before);
});

test("store importEvents: adottando i vecchi import, allegati, note e promemoria passano alla serie tenuta", async () => {
  useStudyStore.setState({
    events: [
      { id: "old-1", title: "Anatomia", start: "2026-11-02T08:00:00.000Z", end: "2026-11-02T10:00:00.000Z", recurrence: "weekly", sourceUid: "5f3k2j1h0g@google.com#1", updatedAt: T0, createdAt: T0, archived: false, links: [], notes: "" },
      { id: "old-3", title: "Anatomia", start: "2026-11-04T08:00:00.000Z", end: "2026-11-04T10:00:00.000Z", recurrence: "weekly", sourceUid: "5f3k2j1h0g@google.com#3", updatedAt: T0, createdAt: T0, archived: false, links: [], notes: "" }
    ],
    attachments: [
      { id: "a1", name: "Slide", linkedEntityType: "calendarEvent", linkedEntityId: "old-3", updatedAt: T0 },
      { id: "a2", name: "Altro", linkedEntityType: "calendarEvent", linkedEntityId: "altro", updatedAt: T0 }
    ],
    notes: [{ id: "n1", title: "Appunti", linkedEntityType: "calendarEvent", linkedEntityId: "old-3", updatedAt: T0 }],
    reminders: [{ id: "r1", title: "Ripasso", linkedEntityType: "calendarEvent", linkedEntityId: "old-3", updatedAt: T0 }]
  });
  const items = icsImportItems(parseIcs(GOOGLE, { timeZone: "Europe/Rome" }).events, { defaultCategory: "lesson" });
  await useStudyStore.getState().importEvents(items);
  const state = useStudyStore.getState();
  assert.equal(state.events.some((event) => event.id === "old-3"), false);
  assert.equal(state.attachments[0].linkedEntityType, "calendarEvent");
  assert.equal(state.attachments[0].linkedEntityId, "old-1");
  assert.equal(state.attachments[1].linkedEntityId, "altro");
  assert.equal(state.notes[0].linkedEntityId, "old-1");
  assert.equal(state.reminders[0].linkedEntityId, "old-1");
});

// ------------------------------------------------------------------------------------------
// Righe piegate dentro un carattere (ricontrollo di rilascio, punto 7): si uniscono prima di leggere l'UTF-8
// ------------------------------------------------------------------------------------------

test("riga piegata in mezzo a un carattere di più byte (è, emoji): si uniscono i byte, poi si legge il testo", () => {
  const encoder = new TextEncoder();
  const head = encoder.encode("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:fold\r\nDTSTART:20261102T090000Z\r\nSUMMARY:Caff");
  const e = encoder.encode("è"); // 2 byte: la piega cade tra i due
  const smile = encoder.encode("😀"); // 4 byte: piega dopo il primo, con un a capo solo (LF) e un tab
  const tail = encoder.encode(" ok\r\nDESCRIPTION:a\nb\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n");
  const bytes = new Uint8Array([...encoder.encode("﻿"), ...head, e[0], 13, 10, 32, e[1], 32, smile[0], 10, 9, ...smile.slice(1), ...tail]);
  const text = decodeIcsBytes(bytes);
  assert.ok(!text.includes("�") && !text.startsWith("﻿"), text);
  const [event] = parseIcs(text, { timeZone: "Europe/Rome" }).events;
  assert.equal(event.title, "Caffè 😀 ok");
  // Un a capo senza spazio dopo non è una piega: resta una riga a sé (qui "b", che non è una proprietà).
  assert.equal(event.description, "a");
  // Leggere il testo prima e unire dopo dava caratteri rotti: è il caso che questa funzione evita.
  assert.ok(new TextDecoder().decode(bytes).includes("�"));
});
