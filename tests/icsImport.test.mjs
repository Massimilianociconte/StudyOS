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
  assert.match(warnings[0], /BYSETPOS=2/);
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

test("store importEvents: gli eventi tolti nell'adozione staccano allegati e note", async () => {
  useStudyStore.setState({
    events: [
      { id: "old-1", title: "Anatomia", start: "2026-11-02T08:00:00.000Z", end: "2026-11-02T10:00:00.000Z", recurrence: "weekly", sourceUid: "5f3k2j1h0g@google.com#1", updatedAt: T0, createdAt: T0, archived: false, links: [], notes: "" },
      { id: "old-3", title: "Anatomia", start: "2026-11-04T08:00:00.000Z", end: "2026-11-04T10:00:00.000Z", recurrence: "weekly", sourceUid: "5f3k2j1h0g@google.com#3", updatedAt: T0, createdAt: T0, archived: false, links: [], notes: "" }
    ],
    attachments: [{ id: "a1", name: "Slide", linkedEntityType: "calendarEvent", linkedEntityId: "old-3", updatedAt: T0 }]
  });
  const items = icsImportItems(parseIcs(GOOGLE, { timeZone: "Europe/Rome" }).events, { defaultCategory: "lesson" });
  await useStudyStore.getState().importEvents(items);
  const state = useStudyStore.getState();
  assert.equal(state.events.some((event) => event.id === "old-3"), false);
  assert.equal(state.attachments[0].linkedEntityId, undefined);
});
