import test from "node:test";
import assert from "node:assert/strict";

const {
  EXAMS_NEW_KEY,
  calendarExamEvents,
  calendarExamRef,
  calendarExamRemoval,
  examPrefillFromEvent,
  findCalendarExam,
  isNullableCalendarExamRef,
  removalEntries,
  removalFootprint,
  removalUndoPlan,
  removeCalendarExam
} = await import("../src/lib/calendarExams.ts");
const { expandEvents } = await import("../src/lib/recurrence.ts");
const { useStudyStore } = await import("../src/store/useStudyStore.ts");

// Date locali del dispositivo: i test valgono in ogni fuso (Roma, New York, UTC, Tokyo).
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (...parts) => local(...parts).toISOString();

/* ------------------------------------------------------------------ */
/* Esami segnati solo nel calendario                                   */
/* ------------------------------------------------------------------ */

const event = (patch) => ({
  id: "e1",
  title: "Esame",
  description: "",
  category: "exam",
  color: "",
  priority: "high",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  archived: false,
  tags: [],
  ...patch
});

test("calendarExamEvents: solo eventi «Esame» da oggi ai prossimi 60 giorni, in ordine", () => {
  const now = local(2026, 11, 12, 15);
  const events = [
    event({ id: "later", start: iso(2026, 12, 20, 9), end: iso(2026, 12, 20, 12) }),
    event({ id: "soon", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12) }),
    event({ id: "today", start: iso(2026, 11, 12, 9), end: iso(2026, 11, 12, 11) }),
    event({ id: "past", start: iso(2026, 11, 10, 9), end: iso(2026, 11, 10, 12) }),
    event({ id: "far", start: iso(2027, 1, 20, 9), end: iso(2027, 1, 20, 12) }),
    event({ id: "lesson", category: "lesson", start: iso(2026, 11, 18, 9), end: iso(2026, 11, 18, 11) }),
    event({ id: "gone", archived: true, start: iso(2026, 11, 19, 9), end: iso(2026, 11, 19, 11) })
  ];
  assert.deepEqual(
    calendarExamEvents(events, now).map((item) => item.id),
    ["today", "soon", "later"]
  );
  // Il sessantesimo giorno è compreso, il sessantunesimo no.
  const edge = [
    event({ id: "d60", start: iso(2027, 1, 11, 9), end: iso(2027, 1, 11, 10) }),
    event({ id: "d61", start: iso(2027, 1, 12, 9), end: iso(2027, 1, 12, 10) })
  ];
  assert.deepEqual(calendarExamEvents(edge, now).map((item) => item.id), ["d60"]);
});

test("calendarExamEvents: un appello di tutto il giorno (data senza fuso) resta nel suo giorno", () => {
  const now = local(2026, 11, 12, 8);
  const appello = event({ id: "barb", allDay: true, start: "2026-11-25T00:00:00", end: "2026-11-26T00:00:00" });
  const [item] = calendarExamEvents([appello], now);
  assert.equal(item?.id, "barb");
});

test("examPrefillFromEvent: materia dell'evento, altrimenti dal titolo; giorno e titolo", () => {
  const all = [
    { id: "chim", name: "Chimica", archived: false, status: "active" },
    { id: "chimorg", name: "Chimica organica", archived: false, status: "active" },
    { id: "old", name: "Fisica", archived: true, status: "archived" }
  ];
  const withSubject = examPrefillFromEvent(event({ title: "Scritto", subjectId: "chim", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12) }), all);
  assert.deepEqual(withSubject, { subjectId: "chim", date: iso(2026, 11, 20, 9), title: "Scritto" });
  // Il nome più lungo vince ("Chimica organica" contiene anche "Chimica").
  const byTitle = examPrefillFromEvent(event({ title: "Appello · CHIMICA ORGANICA", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12) }), all);
  assert.equal(byTitle.subjectId, "chimorg");
  // Materie archiviate non si propongono; materia sparita = nessuna scelta.
  assert.equal(examPrefillFromEvent(event({ title: "Esame di Fisica", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12) }), all).subjectId, "");
  assert.equal(examPrefillFromEvent(event({ title: "Orale", subjectId: "sparita", start: iso(2026, 11, 20, 9), end: iso(2026, 11, 20, 12) }), all).subjectId, "");
  // Tutto il giorno: alle 9 del giorno dell'appello, in ora locale.
  const allDay = examPrefillFromEvent(event({ title: "Appello", allDay: true, start: "2026-11-25T00:00:00", end: "2026-11-26T00:00:00" }), all);
  assert.equal(allDay.date, "2026-11-25T09:00");
});

test("exams.new: solo { eventId, occurrenceStart }, niente contenuti", () => {
  assert.equal(EXAMS_NEW_KEY, "exams.new");
  const start = iso(2026, 11, 20, 9);
  assert.equal(isNullableCalendarExamRef(null), true);
  assert.equal(isNullableCalendarExamRef({ eventId: "e1", occurrenceStart: start }), true);
  assert.equal(isNullableCalendarExamRef({ eventId: "s@2026-11-25", occurrenceStart: "2026-11-25T00:00:00" }), true);
  assert.deepEqual(calendarExamRef(event({ id: "e1", start, end: start })), { eventId: "e1", occurrenceStart: start });
  // Un titolo o una materia in più: stato UI con contenuti, si rifiuta.
  assert.equal(isNullableCalendarExamRef({ eventId: "e1", occurrenceStart: start, title: "Esame Chimica" }), false);
  // La forma vecchia (titolo, data, materia) non passa più.
  assert.equal(isNullableCalendarExamRef({ subjectId: "", date: start, title: "Appello" }), false);
  assert.equal(isNullableCalendarExamRef({ eventId: "", occurrenceStart: start }), false);
  assert.equal(isNullableCalendarExamRef({ eventId: "e1", occurrenceStart: "domani" }), false);
  assert.equal(isNullableCalendarExamRef({ eventId: 3, occurrenceStart: start }), false);
  assert.equal(isNullableCalendarExamRef({ eventId: "e1" }), false);
  assert.equal(isNullableCalendarExamRef(["e1", start]), false);
  assert.equal(isNullableCalendarExamRef("e1"), false);
  assert.equal(isNullableCalendarExamRef(undefined), false);
});

/* ------------------------------------------------------------------ */
/* L'esame prende il posto dell'evento                                 */
/* ------------------------------------------------------------------ */

const OLD = "2026-11-01T10:00:00.000Z";
const SINGLE = event({ id: "x1", title: "Esame Chimica", subjectId: "chim", start: iso(2026, 11, 20, 10, 30), end: iso(2026, 11, 20, 12, 30), recurrence: "none", createdAt: OLD, updatedAt: OLD });
// Esame che si ripete ogni lunedì alle 10 a Roma (per esempio una prova in itinere settimanale).
const SERIES = event({
  id: "s",
  title: "Prova in itinere",
  start: "2026-11-02T09:00:00.000Z",
  end: "2026-11-02T10:00:00.000Z",
  recurrence: "weekly",
  repeat: { freq: "weekly" },
  repeatLegacy: "weekly|",
  timeZone: "Europe/Rome",
  createdAt: OLD,
  updatedAt: OLD
});
const occurrencesOf = (events, id) =>
  expandEvents(events, local(2026, 11, 1), local(2026, 12, 15))
    .filter((item) => item.id === id || item.seriesId === id)
    .map((item) => item.occurrenceDate);

test("findCalendarExam: stesso id e stesso inizio, altrimenti niente", () => {
  const ref = calendarExamRef(SINGLE);
  assert.equal(findCalendarExam([SINGLE, SERIES], ref)?.id, "x1");
  // Evento eliminato o spostato: il modulo si apre vuoto.
  assert.equal(findCalendarExam([SERIES], ref), null);
  assert.equal(findCalendarExam([{ ...SINGLE, start: iso(2026, 11, 21, 10, 30) }], ref), null);
  assert.equal(findCalendarExam([{ ...SINGLE, archived: true }], ref), null);
  // Un giorno della serie.
  const day = expandEvents([SERIES], local(2026, 11, 15), local(2026, 11, 18))[0];
  assert.equal(findCalendarExam([SERIES], calendarExamRef(day))?.occurrenceDate, "2026-11-16");
});

test("calendarExamRemoval: evento singolo con deleteEvent, giorno di una serie con deleteOccurrence", () => {
  const [single] = expandEvents([SINGLE], local(2026, 11, 19), local(2026, 11, 22));
  assert.deepEqual(calendarExamRemoval(single), { kind: "event", id: "x1" });
  const day = expandEvents([SERIES], local(2026, 11, 15), local(2026, 11, 18))[0];
  assert.deepEqual(calendarExamRemoval(day), { kind: "occurrence", seriesId: "s", date: "2026-11-16" });
  // Giorno già modificato (riga `serie@giorno`): si toglie lo stesso giorno della serie.
  const row = { id: "s@2026-11-16", seriesId: "s", originalDate: "2026-11-16", occurrenceDate: "2026-11-17", recurring: true };
  assert.deepEqual(calendarExamRemoval(row), { kind: "occurrence", seriesId: "s", date: "2026-11-16" });
});

test("removalFootprint: solo l'evento tolto (con le sue righe), la riga annullata e i collegati", () => {
  const linkedToX1 = { id: "a1", name: "Slide", linkedEntityType: "calendarEvent", linkedEntityId: "x1", updatedAt: OLD };
  const linkedToSeries = { id: "a2", name: "Programma", linkedEntityType: "calendarEvent", linkedEntityId: "s", updatedAt: OLD };
  const free = { id: "a3", name: "Altro", updatedAt: OLD };
  const note = { id: "n1", title: "N", body: "b", linkedEntityType: "calendarEvent", linkedEntityId: "x1", updatedAt: OLD };
  const state = { events: [SINGLE, SERIES, event({ id: "other", start: SINGLE.start, end: SINGLE.end })], attachments: [linkedToX1, linkedToSeries, free], notes: [note] };
  assert.deepEqual(removalFootprint(state, { kind: "event", id: "x1" }), { events: ["x1"], attachments: ["a1"], notes: ["n1"] });
  // Un giorno della serie: solo la riga `serie@giorno`; la serie resta, i suoi allegati restano collegati.
  assert.deepEqual(removalFootprint(state, { kind: "occurrence", seriesId: "s", date: "2026-11-16" }), { events: ["s@2026-11-16"], attachments: [], notes: [] });
  // Una serie tolta per intero si porta via le sue righe (e i loro collegati).
  const row = { ...SERIES, id: "s@2026-11-23", seriesId: "s", originalDate: "2026-11-23", title: "Spostata" };
  const withRow = { ...state, events: [...state.events, row], notes: [{ ...note, id: "n2", linkedEntityId: "s@2026-11-23" }] };
  assert.deepEqual(removalFootprint(withRow, { kind: "event", id: "s" }), { events: ["s", "s@2026-11-23"], attachments: ["a2"], notes: ["n2"] });
});

test("removalUndoPlan: rimette solo ciò che la rimozione ha cambiato, e solo se nessuno l'ha toccato dopo", () => {
  const attachment = { id: "a1", name: "Slide", linkedEntityType: "calendarEvent", linkedEntityId: "x1", updatedAt: OLD };
  const before = { events: [SINGLE, SERIES], attachments: [attachment], notes: [] };
  const LATER = "2026-11-12T08:00:00.000Z";
  const row = { ...SERIES, id: "s@2026-11-16", seriesId: "s", originalDate: "2026-11-16", cancelled: true, archived: true, updatedAt: LATER };
  const unlinked = { ...attachment, linkedEntityType: undefined, linkedEntityId: undefined, updatedAt: LATER };
  const after = { events: [row, SERIES], attachments: [unlinked], notes: [] };
  const entries = removalEntries(before, after, { events: ["x1", "s@2026-11-16", "s"], attachments: ["a1"], notes: [] });
  // La serie non è cambiata: non è una voce dell'Annulla.
  assert.deepEqual(
    entries.map((entry) => [entry.key, entry.id]),
    [
      ["events", "x1"],
      ["events", "s@2026-11-16"],
      ["attachments", "a1"]
    ]
  );
  const plan = removalUndoPlan(entries, after);
  assert.deepEqual(
    plan.restore.map((version) => [version.entityType, version.entityId, version.complete, version.payload.updatedAt]),
    [
      ["calendarEvent", "x1", true, OLD],
      ["attachment", "a1", true, OLD]
    ]
  );
  assert.deepEqual(plan.remove, ["s@2026-11-16"]);
  assert.equal(plan.skipped, 0);
  // Dopo la rimozione: l'evento torna da un altro dispositivo, l'allegato viene modificato, la riga anche.
  const NEWER = "2026-11-12T09:00:00.000Z";
  const later = {
    events: [{ ...row, updatedAt: NEWER }, SERIES, { ...SINGLE, title: "Esame Chimica (dal telefono)", updatedAt: NEWER }],
    attachments: [{ ...unlinked, name: "Slide v2", updatedAt: NEWER }],
    notes: []
  };
  assert.deepEqual(removalUndoPlan(entries, later), { restore: [], remove: [], skipped: 3 });
});

test("removeCalendarExam: un evento arrivato durante il salvataggio sopravvive ad Annulla", async () => {
  const store = useStudyStore;
  const note = { id: "n1", title: "Appunti", body: "v1", tags: [], archived: false, createdAt: OLD, updatedAt: OLD };
  store.setState({ loading: true, events: [SINGLE], attachments: [], notes: [note], reminders: [] });
  const pending = removeCalendarExam(store, calendarExamRef(SINGLE));
  // Stesso giro di un'unione dalla sync o di un'altra scheda, mentre la rimozione salva.
  const REMOTE = "2026-11-12T08:00:00.000Z";
  const remote = event({ id: "remote1", title: "Evento da altro dispositivo", start: SINGLE.start, end: SINGLE.end, updatedAt: REMOTE });
  store.setState((state) => ({
    events: [remote, ...state.events],
    notes: state.notes.map((item) => ({ ...item, body: "v2 remota", updatedAt: REMOTE }))
  }));
  const undo = await pending;
  assert.equal(await undo(), 1);
  const state = store.getState();
  assert.equal(state.events.some((item) => item.id === "x1"), true);
  assert.equal(state.events.some((item) => item.id === "remote1"), true);
  assert.equal(state.notes[0].body, "v2 remota");
  assert.equal(state.notes[0].updatedAt, REMOTE);
});

test("removeCalendarExam: una nota collegata modificata dopo la rimozione non torna indietro", async () => {
  const store = useStudyStore;
  const note = { id: "n1", title: "Appunti", body: "v1", tags: [], archived: false, createdAt: OLD, updatedAt: OLD, linkedEntityType: "calendarEvent", linkedEntityId: "x1" };
  store.setState({ loading: true, events: [SINGLE], attachments: [], notes: [note], reminders: [] });
  const undo = await removeCalendarExam(store, calendarExamRef(SINGLE));
  assert.equal(store.getState().notes[0].linkedEntityId, undefined);
  const EDITED = "2026-11-12T08:30:00.000Z";
  store.setState((state) => ({ notes: state.notes.map((item) => ({ ...item, body: "v2", updatedAt: EDITED })) }));
  // L'evento torna; la nota, cambiata dopo, resta com'è (staccata, v2): niente versione vecchia più recente.
  assert.equal(await undo(), 1);
  const state = store.getState();
  assert.equal(state.events.some((item) => item.id === "x1"), true);
  assert.equal(state.notes[0].body, "v2");
  assert.equal(state.notes[0].updatedAt, EDITED);
  assert.equal(state.notes[0].linkedEntityId, undefined);
});

test("removeCalendarExam: toglie quell'occorrenza dal negozio e Annulla la rimette", async () => {
  const store = useStudyStore;
  store.setState({
    loading: true,
    events: [SINGLE, SERIES],
    attachments: [{ id: "a1", name: "Slide", linkedEntityType: "calendarEvent", linkedEntityId: "x1", updatedAt: OLD }],
    notes: [],
    reminders: []
  });
  const seriesBefore = occurrencesOf(store.getState().events, "s");

  // Evento singolo: deleteEvent, l'allegato si stacca; Annulla rimette evento e collegamento.
  const undoSingle = await removeCalendarExam(store, calendarExamRef(SINGLE));
  assert.equal(typeof undoSingle, "function");
  assert.equal(store.getState().events.some((item) => item.id === "x1"), false);
  assert.equal(store.getState().attachments[0].linkedEntityId, undefined);
  assert.equal(await undoSingle(), 2);
  const back = store.getState().events.find((item) => item.id === "x1");
  assert.equal(back?.title, "Esame Chimica");
  assert.equal(back?.start, SINGLE.start);
  assert.equal(store.getState().attachments[0].linkedEntityId, "x1");

  // Un giorno della serie: solo quel giorno sparisce, la serie resta; Annulla lo rimette.
  const day = expandEvents(store.getState().events, local(2026, 11, 15), local(2026, 11, 18)).find((item) => item.id === "s");
  const undoDay = await removeCalendarExam(store, calendarExamRef(day));
  const without = occurrencesOf(store.getState().events, "s");
  assert.deepEqual(without, seriesBefore.filter((date) => date !== "2026-11-16"));
  assert.equal(await undoDay(), 1);
  assert.deepEqual(occurrencesOf(store.getState().events, "s"), seriesBefore);
  assert.equal(store.getState().events.some((item) => item.id === "s@2026-11-16"), false);

  // Già tolto: niente da fare, niente Annulla.
  store.setState({ events: [SERIES] });
  assert.equal(await removeCalendarExam(store, calendarExamRef(SINGLE)), null);
});
