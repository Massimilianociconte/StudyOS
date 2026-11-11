// Importazione .ics: file in stile Google, Apple (con VTIMEZONE) e Outlook (fusi Windows), EXDATE,
// RECURRENCE-ID, VALARM; unione con il calendario senza doppioni (recurrence.md §7.2 caso 12).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildIcs, icsImportItems, mergeIcsImport, parseIcs } from "../src/lib/ics.ts";
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
  assert.match(master.description, /Luogo: Aula G21/);
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

test("adozione dei vecchi import: giorni cancellati e modificati, note, materia e liste passano alla serie tenuta", () => {
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
});

test("adozione dei vecchi import: se una serie non si unisce senza perdere nulla, il gruppo resta com'era", () => {
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
});

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
    for (const [index, file] of [own, own, SPLIT_CHANGED, own, SPLIT_CHANGED].entries()) {
      const plan = merge(events, parseIcs(file, { timeZone: device }), { timeZone: device });
      assert.deepEqual(counts(plan), NOTHING, `${device} import ${index + 1}`);
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
    // Nella copia i giorni cambiati a mano sono dell'utente (senza sourceRecurrenceId), gli altri del file.
    const copyRow = (date) => copy.find((event) => event.seriesId === copyChild.id && event.originalDate === date);
    assert.equal(copyRow("2026-12-21").sourceRecurrenceId, undefined, device);
    assert.equal(copyRow("2026-12-28").sourceRecurrenceId, undefined, device);
    assert.equal(copyRow("2026-12-28").cancelled, true, device);
    assert.ok(copyRow("2026-12-07").sourceRecurrenceId, device);
    // Il file originale di Google nella copia: niente giorni doppi, niente cambia.
    const plan = merge(copy, parseIcs(google, { timeZone: device }), { timeZone: device });
    assert.deepEqual(counts(plan), NOTHING, device);
    copy = apply(copy, plan);
    assert.deepEqual(window(copy), window(events), device);
    // E la copia esportata e reimportata in sé stessa non cambia, anche alternata con il file di Google.
    const again = buildIcs({ events: copy, exams: [], tasks: [], subjects: [], timeZone: device, now: new Date(NOW) });
    for (const [index, file] of [again, google, own, again, google].entries()) {
      const next = merge(copy, parseIcs(file, { timeZone: device }), { timeZone: device });
      assert.deepEqual(counts(next), NOTHING, `${device} import ${index + 1}`);
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

test("regole con un numero di ripetizioni e date sparse: un'espansione sola, veloce", () => {
  const stamp = (ms) => `${new Date(ms).toISOString().replace(/[-:]/g, "").slice(0, 8)}`;
  const series = Array.from({ length: 20 }, (_, index) => [
    "BEGIN:VEVENT",
    `UID:w${index}`,
    "DTSTART:19400101T090000Z",
    "RRULE:FREQ=MONTHLY;BYDAY=2MO;COUNT=999",
    ...Array.from({ length: 1000 }, (_, offset) => `EXDATE;VALUE=DATE:${stamp(Date.UTC(1940, 0, 1) + offset * 40 * 86_400_000)}`),
    `SUMMARY:Mensile ${index + 1}`,
    "END:VEVENT"
  ]);
  const text = ics(...series);
  const started = performance.now();
  const plan = merge([], parseIcs(text), { timeZone: "UTC" });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `${Math.round(elapsed)} ms`);
  assert.equal(plan.added, 20);
  assert.deepEqual(plan.warnings, []);
  // Le date escluse che sono davvero secondi lunedì entro le 999 volte diventano righe.
  const rows = plan.puts.filter((event) => event.seriesId);
  assert.ok(rows.length > 0 && rows.every((event) => event.cancelled && event.originalDate <= "2023-04-10"), `${rows.length}`);
});

test("file ostile: 18.000 date escluse si leggono e si uniscono in meno di un secondo, con un limite di righe", () => {
  const dates = [];
  const day = new Date(Date.UTC(1975, 0, 1, 9));
  while (dates.length < 18000) {
    dates.push(`${day.toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`);
    day.setUTCDate(day.getUTCDate() + 1);
  }
  // Una serie settimanale con date escluse sparse in migliaia di anni: niente espansione enorme.
  const sparse = Array.from({ length: 1500 }, (_, index) => `${String(1000 + index * 5).padStart(4, "0")}0105T090000Z`);
  const text = ics(
    "BEGIN:VEVENT",
    "UID:flood",
    "DTSTART:19750101T090000Z",
    "RRULE:FREQ=DAILY",
    `EXDATE:${dates.join(",")}`,
    "SUMMARY:Flood",
    "END:VEVENT",
    "BEGIN:VEVENT",
    "UID:sparse",
    "DTSTART:10000105T090000Z",
    "RRULE:FREQ=WEEKLY",
    `EXDATE:${sparse.join(",")}`,
    "SUMMARY:Sparse",
    "END:VEVENT"
  );
  assert.ok(text.length > 290_000, `${text.length}`);
  const started = performance.now();
  const parsed = parseIcs(text, { timeZone: "Europe/Rome" });
  const plan = merge([], parsed, { timeZone: "Europe/Rome" });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 1000, `${Math.round(elapsed)} ms`);
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
