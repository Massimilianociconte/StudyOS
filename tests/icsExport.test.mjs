// Esportazione .ics completa: RRULE, EXDATE, RECURRENCE-ID, VALARM, VTIMEZONE, divisioni "questa e le
// successive", tutto il giorno dal giorno dell'evento. Fusi sempre espliciti: vale in ogni fuso del dispositivo.
import test from "node:test";
import assert from "node:assert/strict";
import { buildIcs } from "../src/lib/ics.ts";
import { applyEditPlan, applyRepeatFields, planDelete, planEdit } from "../src/lib/repeat.ts";

const T0 = "2026-10-01T10:00:00.000Z";
const NOW = new Date(Date.UTC(2026, 10, 11, 9));

const base = (patch) => ({
  id: "e1",
  createdAt: T0,
  updatedAt: T0,
  archived: false,
  tags: [],
  title: "Anatomia",
  description: "",
  category: "lesson",
  color: "#7CF7C8",
  priority: "medium",
  // lunedì 2 novembre 2026, 9:00–11:00 a Roma (CET, +1)
  start: "2026-11-02T08:00:00.000Z",
  end: "2026-11-02T10:00:00.000Z",
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});

/** Serie salvata come la salva lo store: regola, impronta, proiezione e fuso. */
const series = (repeat, patch = {}) => applyRepeatFields(base({ timeZone: "Europe/Rome", repeat, ...patch }), { repeatChanged: true });

const exportOf = (events, options = {}) => buildIcs({ events, exams: [], tasks: [], subjects: [], now: NOW, timeZone: "Europe/Rome", ...options });
const lines = (text) => text.split("\r\n");
const vevents = (text) => text.split("BEGIN:VEVENT").slice(1).map((block) => block.split("END:VEVENT")[0]);

test("esporta RRULE completa con fuso dell'evento e VTIMEZONE per ogni TZID", () => {
  const text = exportOf([series({ freq: "weekly", interval: 2, byWeekday: ["MO", "WE", "FR"], end: { type: "until", date: "2026-12-18" } })]);
  const all = lines(text);
  assert.ok(all.includes("DTSTART;TZID=Europe/Rome:20261102T090000"));
  assert.ok(all.includes("DTEND;TZID=Europe/Rome:20261102T110000"));
  assert.ok(all.includes("RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;UNTIL=20261218T225959Z"));
  assert.ok(all.includes("UID:e1@studyos"));
  // Un VTIMEZONE per Europe/Rome, prima degli eventi, con le due regole del cambio d'ora.
  assert.equal(all.filter((line) => line === "BEGIN:VTIMEZONE").length, 1);
  assert.ok(all.indexOf("TZID:Europe/Rome") < all.indexOf("BEGIN:VEVENT"));
  assert.ok(all.includes("RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU"));
  assert.ok(all.includes("RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU"));
  for (const line of all) assert.ok(new TextEncoder().encode(line).length <= 75, line);
});

test("un evento con un altro fuso usa il suo (non quello del dispositivo) e porta il suo VTIMEZONE", () => {
  const ny = series({ freq: "weekly" }, { timeZone: "America/New_York", start: "2026-11-02T14:00:00.000Z", end: "2026-11-02T15:00:00.000Z" });
  const text = exportOf([ny, base({ id: "single" })]);
  const all = lines(text);
  assert.ok(all.includes("DTSTART;TZID=America/New_York:20261102T090000"));
  assert.ok(all.includes("TZID:America/New_York"));
  assert.ok(all.includes("TZID:Europe/Rome"), "l'evento senza fuso usa quello dell'esportazione");
});

test("tutto il giorno: data dell'evento, non del dispositivo (fluttuante, a mezzanotte e vecchi istanti)", () => {
  const floating = base({ id: "f", allDay: true, timeZone: "Europe/Rome", start: "2026-11-12T00:00:00", end: "2026-11-13T00:00:00" });
  const midnight = base({ id: "m", allDay: true, timeZone: "Europe/Rome", start: "2026-11-11T23:00:00.000Z", end: "2026-11-12T23:00:00.000Z" });
  const legacy = base({ id: "l", allDay: true, start: "2026-11-11T23:00:00.000Z", end: "2026-11-13T23:00:00.000Z" });
  for (const zone of ["Europe/Rome", "America/New_York", "Asia/Tokyo", "UTC"]) {
    const blocks = vevents(exportOf([floating, midnight], { timeZone: zone }));
    for (const block of blocks) {
      assert.match(block, /DTSTART;VALUE=DATE:20261112\r\n/, zone);
      assert.match(block, /DTEND;VALUE=DATE:20261113\r\n/, zone);
    }
  }
  // Vecchio evento senza fuso salvato come istanti a Roma: giorno della mezzanotte più vicina, due giorni.
  for (const zone of ["Europe/Rome", "America/New_York", "UTC"]) {
    const [block] = vevents(exportOf([legacy], { timeZone: zone }));
    assert.match(block, /DTSTART;VALUE=DATE:20261112\r\n/, zone);
    assert.match(block, /DTEND;VALUE=DATE:20261114\r\n/, zone);
  }
});

test("caso 8: UNTIL come data per tutto il giorno; mensile vecchia e regole del 29 febbraio", () => {
  const allDay = series({ freq: "weekly", end: { type: "until", date: "2026-12-14" } }, { allDay: true, start: "2026-11-02T00:00:00", end: "2026-11-03T00:00:00" });
  assert.match(exportOf([allDay]), /RRULE:FREQ=WEEKLY;UNTIL=20261214\r\n/);
  const legacyMonthly = base({ allDay: true, start: "2026-01-31T00:00:00", end: "2026-02-01T00:00:00", recurrence: "monthly", timeZone: "Europe/Rome" });
  assert.match(exportOf([legacyMonthly]), /RRULE:FREQ=MONTHLY;BYMONTHDAY=28,29,30,31;BYSETPOS=-1\r\n/);
  const birthday = series({ freq: "yearly", yearlyLeap: "mar1" }, { allDay: true, start: "2000-02-29T00:00:00", end: "2000-03-01T00:00:00" });
  assert.match(exportOf([birthday]), /RRULE:FREQ=YEARLY;BYYEARDAY=60\r\n/);
});

test("EXDATE per le occorrenze cancellate, stesso tipo di valore e TZID di DTSTART", () => {
  const weekly = series({ freq: "weekly" });
  let events = [weekly];
  events = applyEditPlan(events, planDelete(events, "e1", "2026-11-16", "this", { now: T0 })).events;
  events = applyEditPlan(events, planDelete(events, "e1", "2026-11-30", "this", { now: T0 })).events;
  const text = exportOf(events);
  assert.match(text, /EXDATE;TZID=Europe\/Rome:20261116T090000,20261130T090000\r\n/);
  assert.equal(vevents(text).length, 1, "le righe cancellate non diventano eventi");

  const allDay = series({ freq: "weekly" }, { id: "d", allDay: true, start: "2026-11-02T00:00:00", end: "2026-11-03T00:00:00" });
  const cancelled = applyEditPlan([allDay], planDelete([allDay], "d", "2026-11-09", "this", { now: T0 })).events;
  assert.match(exportOf(cancelled), /EXDATE;VALUE=DATE:20261109\r\n/);
});

test("RECURRENCE-ID per le occorrenze modificate (stesso UID), mai come evento in più", () => {
  const weekly = series({ freq: "weekly" });
  const plan = planEdit(weekly, [weekly], "2026-11-23", "this", { title: "Esercitazione", start: "2026-11-23T09:00:00.000Z", end: "2026-11-23T11:00:00.000Z" }, { now: T0 });
  const events = applyEditPlan([weekly], plan).events;
  const blocks = vevents(exportOf(events));
  assert.equal(blocks.length, 2);
  const override = blocks.find((block) => block.includes("RECURRENCE-ID"));
  assert.match(override, /UID:e1@studyos\r\n/);
  assert.match(override, /RECURRENCE-ID;TZID=Europe\/Rome:20261123T090000\r\n/);
  assert.match(override, /DTSTART;TZID=Europe\/Rome:20261123T100000\r\n/);
  assert.match(override, /SUMMARY:Esercitazione\r\n/);
  assert.doesNotMatch(override, /RRULE/);
});

test("divisione 'questa e le successive': la madre finisce prima, la figlia è un evento con la sua regola", () => {
  const weekly = series({ freq: "weekly" });
  const plan = planEdit(weekly, [weekly], "2026-11-16", "following", { title: "Anatomia (aula nuova)" }, { now: "2026-11-11T10:00:00.000Z" });
  const events = applyEditPlan([weekly], plan).events;
  const blocks = vevents(exportOf(events));
  assert.equal(blocks.length, 2);
  const parent = blocks.find((block) => block.includes("UID:e1@studyos\r\n"));
  const child = blocks.find((block) => block.includes("UID:e1~2026-11-16@studyos"));
  assert.match(parent, /RRULE:FREQ=WEEKLY;UNTIL=20261115T225959Z\r\n/);
  assert.match(child, /DTSTART;TZID=Europe\/Rome:20261116T090000\r\n/);
  assert.match(child, /RRULE:FREQ=WEEKLY\r\n/);
  assert.match(child, /SUMMARY:Anatomia \(aula nuova\)/);

  // Una madre vecchia (arrivata da un altro dispositivo senza la nuova fine) si ferma comunque alla figlia.
  const stale = events.map((event) => (event.id === "e1" ? weekly : event));
  const staleParent = vevents(exportOf(stale)).find((block) => block.includes("UID:e1@studyos\r\n"));
  assert.match(staleParent, /RRULE:FREQ=WEEKLY;UNTIL=20261115T225959Z\r\n/);
  // Con un conteggio la madre tiene solo le occorrenze prima della figlia.
  const counted = series({ freq: "weekly", end: { type: "count", count: 10 } });
  const child2 = { ...counted, id: "e1~2026-11-16", splitFrom: "e1", originalDate: "2026-11-16", start: "2026-11-16T08:00:00.000Z", end: "2026-11-16T10:00:00.000Z" };
  const countedParent = vevents(exportOf([counted, child2])).find((block) => block.includes("UID:e1@studyos\r\n"));
  assert.match(countedParent, /RRULE:FREQ=WEEKLY;COUNT=2\r\n/);
});

test("VALARM per i promemoria, anche per i tutto il giorno (il giorno prima alle 9)", () => {
  const timed = series({ freq: "weekly" }, { reminders: [{ minutesBefore: 15 }, { daysBefore: 1 }, { minutesBefore: 90 }] });
  const text = exportOf([timed]);
  assert.match(text, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Anatomia\r\nTRIGGER:-PT15M\r\nEND:VALARM/);
  assert.match(text, /TRIGGER:-P1D\r\n/);
  assert.match(text, /TRIGGER:-PT1H30M\r\n/);
  const allDay = base({ id: "b", allDay: true, timeZone: "Europe/Rome", start: "2026-11-12T00:00:00", end: "2026-11-13T00:00:00", reminders: [{ daysBefore: 1, at: "09:00" }, { at: "08:00" }] });
  const allDayText = exportOf([allDay]);
  assert.match(allDayText, /TRIGGER:-PT15H\r\n/);
  assert.match(allDayText, /TRIGGER:PT8H\r\n/);
});

test("sourceRRule importata si esporta così com'è; la fine segue la regola attuale", () => {
  const source = "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,14;UNTIL=20261218T225959Z";
  const imported = series({ freq: "weekly", byWeekday: ["MO"], end: { type: "until", date: "2026-12-18" }, sourceRRule: source }, { sourceUid: "x@google.com" });
  const text = exportOf([imported]);
  assert.ok(lines(text).includes(`RRULE:${source}`));
  assert.ok(lines(text).includes("UID:x@google.com"));
  // Fine cambiata (divisione): stesse parti, nuova fine.
  const ended = series({ freq: "weekly", byWeekday: ["MO"], end: { type: "until", date: "2026-11-15" }, sourceRRule: source });
  assert.ok(lines(exportOf([ended])).includes("RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9,14;UNTIL=20261115T225959Z"));
  // Regola cambiata davvero: la sourceRRule non vale più, si scrive la regola nuova.
  const changed = series({ freq: "daily", sourceRRule: source });
  assert.ok(lines(exportOf([changed])).includes("RRULE:FREQ=DAILY"));
});

test("si esportano solo i propri eventi: niente eventi di altri, righe orfane o archiviati; festività mai", () => {
  const shared = { ...base({ id: "s" }), sharedFrom: { ownerId: "u2", ownerName: "Giulia" } };
  const orphan = { ...base({ id: "missing@2026-11-09" }), seriesId: "missing", originalDate: "2026-11-09" };
  const archived = base({ id: "a", archived: true });
  const text = exportOf([shared, orphan, archived]);
  assert.equal(vevents(text).length, 0);
  assert.doesNotMatch(text, /Natale|Capodanno|BEGIN:VTIMEZONE/);
});

test("un evento singolo con la sua occorrenza cancellata non si esporta; modificata vale la modifica", () => {
  const single = base({ id: "one", timeZone: "Europe/Rome" });
  const cancelled = { ...single, id: "one@2026-11-02", seriesId: "one", originalDate: "2026-11-02", cancelled: true, archived: true };
  assert.equal(vevents(exportOf([single, cancelled])).length, 0);
  const moved = { ...single, id: "one@2026-11-02", seriesId: "one", originalDate: "2026-11-02", title: "Spostato", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z" };
  const [block] = vevents(exportOf([single, moved]));
  assert.match(block, /SUMMARY:Spostato/);
  assert.match(block, /DTSTART;TZID=Europe\/Rome:20261102T100000/);
  assert.doesNotMatch(block, /RECURRENCE-ID/);
});
