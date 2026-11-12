import test from "node:test";
import assert from "node:assert/strict";
import { daySpanOf } from "../src/lib/calendarRender.ts";
import { draftFromEvent, draftPatch, editorChanges } from "../src/lib/eventEditor.ts";
import {
  nextOccasion,
  occasionChanges,
  occasionDraftFromEvent,
  occasionStartYear,
  vacationChanges,
  vacationDraftFromEvent
} from "../src/lib/occasionForms.ts";
import { draggedTimes, occurrenceEditCalls, simulateOccurrenceEdit } from "../src/lib/occurrenceEdit.ts";
import { findOccurrence, occurrenceTarget, startDayOf } from "../src/lib/occurrenceLookup.ts";
import { allDayDays, allDaySpan, allDayTimes, applyRepeatFields, expandEvents, isOccurrenceRow, normalizeRepeat } from "../src/lib/repeat.ts";
import { localMidnight, zonedToUtc } from "../src/lib/tz.ts";

// Un tutto il giorno è un insieme di date nel fuso dell'evento: salvato da un dispositivo a Roma, chi
// lo apre da qualunque fuso (TZ di chi esegue: vedi package.json e le corse con TZ=…) vede e salva gli
// stessi giorni che mostra la griglia. Gli eventi qui sono salvati come li salva un dispositivo a Roma.
const ROME = "Europe/Rome";
const NOW = "2026-11-11T12:00:00.000Z";
const DAY = 86_400_000;

const base = (patch) => ({
  id: "s",
  createdAt: NOW,
  updatedAt: NOW,
  archived: false,
  tags: [],
  title: "Lezione",
  description: "",
  category: "lesson",
  color: "#3B82F6",
  priority: "medium",
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  allDay: true,
  timeZone: ROME,
  ...patch
});
/** Evento di tutto il giorno dal giorno `first` al giorno `last` compreso, salvato a Roma. */
const romeAllDay = (first, last, patch = {}) => base({ ...allDayTimes(first, last, ROME), ...patch });
const romeSeries = (first, last, repeat, patch = {}) => applyRepeatFields(romeAllDay(first, last, { repeat, ...patch }), { repeatChanged: true });

/** Giorni come li disegna la griglia: "11-16" o "11-16..11-17". */
const grid = (events, from = "2026-11-01", to = "2026-12-02") =>
  expandEvents(events, localMidnight(from), localMidnight(to))
    .map((item) => {
      const span = daySpanOf(item);
      return span.startDay === span.endDay ? span.startDay.slice(5) : `${span.startDay.slice(5)}..${span.endDay.slice(5)}`;
    })
    .join(" ");

/** Modulo completo aperto su un giorno della serie: bozza, modifica e campi cambiati (come EventEditor). */
const editorDiff = (item, series, mutate) => {
  const initial = draftFromEvent(item, { repeat: normalizeRepeat(series) });
  const before = draftPatch(initial);
  const patch = draftPatch(mutate({ ...initial }));
  return { initial, changes: editorChanges(before, patch), patch };
};

/** Salvataggio con la portata scelta, come lo store (stesse chiamate, stesso ordine). */
const save = (events, item, scope, changes, shown = item) => {
  const target = occurrenceTarget(item);
  const series = events.find((event) => event.id === target.seriesId && !isOccurrenceRow(event));
  const { calls } = occurrenceEditCalls({ item, series, scope, changes, shown });
  return simulateOccurrenceEdit(events, target.seriesId, target.date, calls, NOW).events;
};

test("allDaySpan / allDayDays / allDayTimes: i giorni nel fuso dell'evento, mai in quello del dispositivo", () => {
  const stored = romeAllDay("2026-12-08", "2026-12-08");
  assert.equal(stored.start, "2026-12-07T23:00:00.000Z");
  assert.equal(stored.end, "2026-12-08T23:00:00.000Z");
  assert.deepEqual(allDayDays(stored), { first: "2026-12-08", last: "2026-12-08" });
  assert.deepEqual(allDaySpan(stored.start, stored.end, ROME), { date: "2026-12-08", days: 1 });
  // Più giorni, a cavallo del cambio dell'ora (un giorno di 25 ore resta un giorno).
  assert.deepEqual(allDayDays(romeAllDay("2026-10-24", "2026-10-26")), { first: "2026-10-24", last: "2026-10-26" });
  // Fluttuante (righe del motore): la data scritta.
  assert.deepEqual(allDayDays({ start: "2026-11-16T00:00:00", end: "2026-11-18T00:00:00", timeZone: ROME }), { first: "2026-11-16", last: "2026-11-17" });
  // Istanti alla mezzanotte di un altro fuso (dati vecchi): la mezzanotte più vicina, un giorno resta un giorno.
  const london = { start: zonedToUtc([2026, 12, 8], "Europe/London").toISOString(), end: zonedToUtc([2026, 12, 9], "Europe/London").toISOString(), timeZone: ROME };
  assert.deepEqual(allDayDays(london), { first: "2026-12-08", last: "2026-12-08" });
  // Un'occorrenza espansa sta alla mezzanotte del dispositivo dei suoi giorni (anche a 13 ore da Roma).
  const [occurrence] = expandEvents([stored], localMidnight("2026-12-01"), localMidnight("2026-12-31"));
  assert.equal(occurrence.start, localMidnight("2026-12-08").toISOString());
  assert.deepEqual(allDayDays(occurrence), { first: "2026-12-08", last: "2026-12-08" });
  // Il giorno di un inizio salvato o di una modifica: nel fuso della serie.
  assert.equal(startDayOf(stored.start, true, ROME), "2026-12-08");
  assert.equal(startDayOf("2026-12-08", true, ROME), "2026-12-08");
});

test("S1. Moduli: compleanno, vacanza ed evento salvati a Roma mostrano e salvano gli stessi giorni da ogni fuso", () => {
  const birthday = romeSeries("2026-03-15", "2026-03-15", { freq: "yearly" }, {
    id: "b",
    title: "Compleanno di Anna",
    category: "personal",
    occasion: { kind: "birthday", person: "Anna", birthYear: 2000 }
  });
  const vacation = romeAllDay("2027-01-02", "2027-01-06", { id: "v", title: "Sci", category: "vacation" });
  const trip = romeAllDay("2026-12-08", "2026-12-08", { id: "g", title: "Immacolata gita", category: "personal" });
  assert.equal(grid([birthday, vacation, trip], "2026-12-01", "2027-04-01"), "12-08 01-02..01-06 03-15");

  // Ricorrenza: il 15/3, e cambiare solo l'anno non sposta il giorno.
  const occasion = occasionDraftFromEvent(birthday);
  assert.deepEqual([occasion.day, occasion.month], [15, 3]);
  assert.deepEqual(nextOccasion(occasion, "2026-11-12"), { date: "2027-03-15", age: 27 });
  const yearOnly = occasionChanges(birthday, occasion, { ...occasion, year: "2001" }, { today: "2026-11-12", baseYear: occasionStartYear(birthday) });
  assert.equal(yearOnly.start, undefined, "stesso giorno: inizio invariato");
  assert.equal(yearOnly.end, undefined);
  // Il 16/3: mezzanotte a Roma, il giorno che tutti vedono.
  const moved = occasionChanges(birthday, occasion, { ...occasion, day: 16 }, { today: "2026-11-12", baseYear: occasionStartYear(birthday) });
  assert.deepEqual(allDayDays({ ...birthday, ...moved }), { first: "2026-03-16", last: "2026-03-16" });
  assert.equal(moved.start, zonedToUtc([2026, 3, 16], ROME).toISOString());
  // L'anno della ricorrenza: quello del suo primo giorno a Roma (il 1° gennaio non è il 31 dicembre prima).
  assert.equal(occasionStartYear(romeSeries("2026-01-01", "2026-01-01", { freq: "yearly" })), 2026);

  // Vacanza: dal 2 al 6 gennaio; allungata di un giorno arriva al 7, e parte sempre il 2.
  const holiday = vacationDraftFromEvent(vacation);
  assert.deepEqual([holiday.first, holiday.last], ["2027-01-02", "2027-01-06"]);
  const longer = vacationChanges(vacation, holiday, { ...holiday, last: "2027-01-07" });
  assert.deepEqual(longer, { end: zonedToUtc([2027, 1, 8], ROME).toISOString() });
  assert.equal(grid([{ ...vacation, ...longer }], "2027-01-01", "2027-01-31"), "01-02..01-07");

  // Evento di un giorno: si apre come 8–8 dicembre e allungato di un giorno è 8–9 (non 7–8 o 8–9–10).
  const draft = draftFromEvent(trip);
  assert.deepEqual([draft.start, draft.end, draft.timeZone], ["2026-12-08T00:00", "2026-12-08T00:00", ROME]);
  const changes = editorChanges(draftPatch(draft), draftPatch({ ...draft, end: "2026-12-09T00:00" }));
  assert.equal(changes.start, trip.start, "il primo giorno resta quello salvato");
  assert.equal(grid([{ ...trip, ...changes }], "2026-12-01", "2026-12-31"), "12-08..12-09");
  // Riaperto dopo il salvataggio: gli stessi giorni.
  const reopened = draftFromEvent({ ...trip, ...changes });
  assert.deepEqual([reopened.start, reopened.end], ["2026-12-08T00:00", "2026-12-09T00:00"]);
});

test("B1. Serie di tutto il giorno salvata a Roma, modificata da un altro fuso: i giorni e la regola restano quelli", () => {
  const series = romeSeries("2026-11-02", "2026-11-02", { freq: "weekly", byWeekday: ["MO"] });
  const events = [series];
  assert.equal(grid(events), "11-02 11-09 11-16 11-23 11-30");
  const item = findOccurrence(events, "s", "2026-11-16");
  // Il modulo si apre sul lunedì 16, l'ultimo giorno diventa martedì 17.
  const { initial, changes, patch } = editorDiff(item, series, (draft) => ({ ...draft, end: "2026-11-17T00:00" }));
  assert.deepEqual([initial.start, initial.end], ["2026-11-16T00:00", "2026-11-16T00:00"]);
  const expected = {
    this: "11-02 11-09 11-16..11-17 11-23 11-30",
    following: "11-02 11-09 11-16..11-17 11-23..11-24 11-30..12-01",
    all: "11-02..11-03 11-09..11-10 11-16..11-17 11-23..11-24 11-30..12-01"
  };
  for (const scope of ["this", "following", "all"]) {
    const after = save(events, item, scope, changes, patch);
    assert.equal(grid(after), expected[scope], scope);
    // La regola resta "ogni lunedì" e la serie parte ancora lunedì 2 (non domenica 1).
    for (const part of after.filter((event) => !isOccurrenceRow(event))) assert.deepEqual(normalizeRepeat(part).byWeekday, ["MO"], `${scope} ${part.id}`);
    assert.equal(grid(after, "2026-11-01", "2026-11-03").split(" ")[0].slice(0, 5), "11-02", scope);
    // Riaperto, il giorno mostra gli stessi giorni della griglia.
    const reopened = draftFromEvent(findOccurrence(after, "s", "2026-11-16") ?? findOccurrence(after, "s~2026-11-16", "2026-11-16"));
    assert.deepEqual([reopened.start, reopened.end], ["2026-11-16T00:00", "2026-11-17T00:00"], scope);
  }
});

test("B1. Trascinare un giorno di una serie di tutto il giorno: un giorno dopo, sempre di un giorno, da ogni fuso", () => {
  const series = romeSeries("2026-11-02", "2026-11-02", { freq: "weekly", byWeekday: ["MO"] });
  const events = [series];
  const item = findOccurrence(events, "s", "2026-11-16");
  // Il calendario passa il giorno d'arrivo a mezzanotte del dispositivo: lo scarto è di un giorno (± il cambio d'ora).
  const delta = localMidnight("2026-11-17").getTime() - Date.parse(item.start);
  const moved = draggedTimes(item, delta);
  assert.deepEqual(moved, allDayTimes("2026-11-17", "2026-11-17", ROME), "mezzanotte a Roma, non del dispositivo");
  const expected = {
    this: "11-02 11-09 11-17 11-23 11-30",
    following: "11-02 11-09 11-17 11-24 12-01",
    all: "11-03 11-10 11-17 11-24 12-01"
  };
  for (const scope of ["this", "following", "all"]) {
    const after = save(events, item, scope, moved);
    assert.equal(grid(after, "2026-11-01", "2026-12-03"), expected[scope], scope);
    // La regola segue il giorno: "ogni martedì" (dal 17 con "Questo e i successivi", per tutta la serie con "Tutti").
    const moving = { this: null, following: "s~2026-11-16", all: "s" }[scope];
    if (moving) assert.deepEqual(normalizeRepeat(after.find((event) => event.id === moving)).byWeekday, ["TU"], scope);
  }
  // Un evento singolo di più giorni salvato a Roma: si sposta di due giorni e resta di tre giorni.
  const trip = romeAllDay("2026-12-08", "2026-12-10", { id: "g" });
  const [shown] = expandEvents([trip], localMidnight("2026-12-01"), localMidnight("2026-12-31"));
  const later = draggedTimes(trip, localMidnight("2026-12-10").getTime() - Date.parse(shown.start));
  assert.equal(grid([{ ...trip, ...later }], "2026-12-01", "2026-12-31"), "12-10..12-12");
  // Con orario: gli istanti spostati.
  assert.deepEqual(draggedTimes({ start: "2026-11-16T08:00:00.000Z", end: "2026-11-16T09:00:00.000Z" }, DAY), { start: "2026-11-17T08:00:00.000Z", end: "2026-11-17T09:00:00.000Z" });
});

test("B1. Una modifica scritta a mezzanotte del dispositivo (agente, app vecchia) si legge con la mezzanotte più vicina nel fuso della serie", () => {
  // Fino a 12 ore da Roma: lo stesso giorno. (Oltre, solo i moduli e il trascinamento, che scrivono a Roma.)
  const series = romeSeries("2026-11-02", "2026-11-02", { freq: "weekly", byWeekday: ["MO"] });
  const item = findOccurrence([series], "s", "2026-11-16");
  for (const zone of ["Europe/London", "America/New_York", "Europe/Athens", "Asia/Tokyo"]) {
    const changes = { start: zonedToUtc([2026, 11, 16], zone).toISOString(), end: zonedToUtc([2026, 11, 18], zone).toISOString(), allDay: true };
    const after = save([series], item, "all", changes);
    assert.equal(grid(after), "11-02..11-03 11-09..11-10 11-16..11-17 11-23..11-24 11-30..12-01", zone);
    assert.deepEqual(normalizeRepeat(after.find((event) => event.id === "s")).byWeekday, ["MO"], zone);
  }
});
