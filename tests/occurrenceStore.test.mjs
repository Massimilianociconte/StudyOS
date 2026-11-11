import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { expandEvents } from "../src/lib/recurrence.ts";

// Solo memoria: con `loading` attivo la persistenza non scrive (niente IndexedDB in Node).
const store = useStudyStore;
const OLD = "2026-11-01T10:00:00.000Z";

const event = (patch) => ({
  id: "e1",
  createdAt: OLD,
  updatedAt: OLD,
  archived: false,
  tags: [],
  title: "Lezione",
  description: "",
  category: "lesson",
  color: "#7CF7C8",
  priority: "medium",
  start: "2026-11-02T09:00:00.000Z",
  end: "2026-11-02T10:00:00.000Z",
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});

// Serie salvata dall'app aggiornata: ogni lunedì alle 10 a Roma.
const SERIES = event({
  id: "s",
  subjectId: "sub1",
  recurrence: "weekly",
  repeat: { freq: "weekly" },
  repeatLegacy: "weekly|",
  timeZone: "Europe/Rome",
  sourceUid: "uid-s"
});
const OTHER = event({ id: "other", title: "Altro", start: "2026-11-03T09:00:00.000Z", end: "2026-11-03T10:00:00.000Z" });

let notifications = 0;
let unsubscribe;

beforeEach(() => {
  unsubscribe?.();
  store.setState({
    loading: true,
    events: [SERIES, OTHER],
    attachments: [{ id: "a1", name: "Slide", linkedEntityType: "calendarEvent", linkedEntityId: "s", updatedAt: OLD }],
    notes: [],
    reminders: []
  });
  notifications = 0;
  unsubscribe = store.subscribe(() => {
    notifications += 1;
  });
});

const ids = () => store.getState().events.map((item) => item.id).sort();
const byId = (id) => store.getState().events.find((item) => item.id === id);
const shown = (from, to) => expandEvents(store.getState().events, new Date(from), new Date(to));

test("addEvent copia i campi nuovi, scrive la proiezione per le app vecchie e fissa il fuso", async () => {
  await store.getState().addEvent({
    title: "Compleanno di Anna",
    category: "personal",
    allDay: true,
    start: "1999-04-20T00:00:00",
    end: "1999-04-21T00:00:00",
    repeat: { freq: "yearly" },
    occasion: { kind: "birthday", birthYear: 1999, person: "Anna" },
    reminders: [{ daysBefore: 1, at: "09:00" }],
    timeZone: "Europe/Rome"
  });
  const created = store.getState().events[0];
  assert.deepEqual(created.repeat, { freq: "yearly" });
  assert.deepEqual(created.occasion, { kind: "birthday", birthYear: 1999, person: "Anna" });
  assert.deepEqual(created.reminders, [{ daysBefore: 1, at: "09:00" }]);
  assert.equal(created.timeZone, "Europe/Rome");
  assert.equal(created.recurrence, "none");
  assert.equal(created.repeatLegacy, "none|");
  assert.equal(created.category, "personal");

  await store.getState().addEvent({ title: "Vecchio stile", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", recurrence: "weekly" });
  const legacy = store.getState().events[0];
  assert.equal(legacy.recurrence, "weekly");
  assert.equal("repeat" in legacy, false);
  assert.equal(typeof legacy.timeZone, "string", "il fuso si prende alla creazione");
  // Una regola non valida non si salva: restano i campi vecchi.
  await store.getState().addEvent({ title: "Ostile", start: "2026-11-02T09:00:00.000Z", end: "2026-11-02T10:00:00.000Z", recurrence: "daily", repeat: { freq: "daily", interval: 0 } });
  assert.equal("repeat" in store.getState().events[0], false);
  assert.equal(store.getState().events[0].recurrence, "daily");
});

test("editOccurrence 'this': una riga nuova, un solo aggiornamento, gli altri oggetti restano gli stessi", async () => {
  const before = store.getState().events;
  await store.getState().editOccurrence("s", "2026-11-16", "this", { title: "Aula 3", start: "2026-11-16T10:00:00.000Z", end: "2026-11-16T11:00:00.000Z" });
  assert.equal(notifications, 1);
  assert.deepEqual(ids(), ["other", "s", "s@2026-11-16"]);
  assert.equal(byId("s"), before[0]);
  assert.equal(byId("other"), before[1]);
  const row = byId("s@2026-11-16");
  assert.equal(row.subjectId, "sub1");
  assert.equal(row.seriesId, "s");
  assert.deepEqual(
    shown("2026-11-15T00:00:00Z", "2026-11-24T00:00:00Z").map((item) => [item.id, item.title, item.start]),
    [["s@2026-11-16", "Aula 3", "2026-11-16T10:00:00.000Z"], ["s", "Lezione", "2026-11-23T09:00:00.000Z"]]
  );
  // Giorno che non è un'occorrenza: nulla cambia.
  await store.getState().editOccurrence("s", "2026-11-17", "this", { title: "x" });
  assert.equal(notifications, 1);
});

test("editOccurrence 'following': madre fermata, figlia con la modifica, righe successive spostate", async () => {
  await store.getState().deleteOccurrence("s", "2026-11-30", "this");
  await store.getState().editOccurrence("s", "2026-11-16", "following", { title: "Nuova aula" });
  assert.equal(notifications, 2);
  const parent = byId("s");
  assert.deepEqual(parent.repeat.end, { type: "until", date: "2026-11-15" });
  assert.equal(parent.recurrenceUntil, "2026-11-15");
  assert.equal(parent.sourceUid, "uid-s");
  const child = store.getState().events.find((item) => item.splitFrom === "s");
  assert.equal(child.title, "Nuova aula");
  assert.equal(child.sourceUid, undefined);
  assert.equal(byId("s@2026-11-30"), undefined);
  assert.equal(byId(`${child.id}@2026-11-30`).cancelled, true);
  assert.deepEqual(
    shown("2026-11-01T00:00:00Z", "2026-12-08T00:00:00Z").map((item) => [item.occurrenceDate, item.title]).filter(([, title]) => title !== "Altro"),
    [["2026-11-02", "Lezione"], ["2026-11-09", "Lezione"], ["2026-11-16", "Nuova aula"], ["2026-11-23", "Nuova aula"], ["2026-12-07", "Nuova aula"]]
  );
});

test("editOccurrence 'all' con un cambio di materia: serie e righe nello stesso salvataggio", async () => {
  await store.getState().editOccurrence("s", "2026-11-16", "this", { title: "Spostata" });
  const other = byId("other");
  await store.getState().editOccurrence("s", "2026-11-23", "all", { subjectId: "sub2", start: "2026-11-23T10:00:00.000Z", end: "2026-11-23T11:00:00.000Z" });
  assert.equal(notifications, 2);
  assert.equal(byId("s").subjectId, "sub2");
  assert.equal(byId("s").start, "2026-11-02T10:00:00.000Z");
  assert.equal(byId("s@2026-11-16").subjectId, "sub2");
  assert.equal(byId("other"), other);
});

test("deleteOccurrence: solo questa (riga cancellata), questa e le successive, tutta la serie con le righe e i collegamenti", async () => {
  await store.getState().deleteOccurrence("s", "2026-11-09", "this");
  const cancelled = byId("s@2026-11-09");
  assert.equal(cancelled.cancelled, true);
  assert.equal(cancelled.archived, true);
  assert.deepEqual(shown("2026-11-01T00:00:00Z", "2026-11-17T00:00:00Z").filter((item) => item.id !== "other").map((item) => item.occurrenceDate), ["2026-11-02", "2026-11-16"]);

  await store.getState().deleteOccurrence("s", "2026-11-23", "following");
  assert.deepEqual(byId("s").repeat.end, { type: "until", date: "2026-11-22" });

  await store.getState().deleteOccurrence("s", "2026-11-02", "all");
  assert.equal(notifications, 3);
  assert.deepEqual(ids(), ["other"]);
  assert.equal(store.getState().attachments[0].linkedEntityId, undefined, "l'allegato si stacca");
});

test("deleteOccurrence 'all' con includeSplits: anche le serie figlie e le loro righe", async () => {
  await store.getState().editOccurrence("s", "2026-11-16", "following", { title: "Figlia" });
  const child = store.getState().events.find((item) => item.splitFrom === "s");
  await store.getState().editOccurrence(child.id, "2026-11-23", "this", { title: "Riga della figlia" });
  await store.getState().deleteOccurrence("s", "2026-11-02", "all");
  assert.deepEqual(ids(), [child.id, `${child.id}@2026-11-23`, "other"].sort(), "senza opzione la figlia resta");
  await store.getState().deleteOccurrence(child.id, "2026-11-16", "all", { includeSplits: true });
  assert.deepEqual(ids(), ["other"]);
});

test("updateEvent: la materia della serie passa alle righe; un cambio dai campi vecchi fa vincere la ripetizione vecchia", async () => {
  await store.getState().editOccurrence("s", "2026-11-16", "this", { title: "Spostata" });
  await store.getState().updateEvent("s", { subjectId: "sub9" });
  assert.equal(byId("s@2026-11-16").subjectId, "sub9");
  assert.deepEqual(byId("s").repeat, { freq: "weekly" }, "stessi campi vecchi: la regola resta");
  await store.getState().updateEvent("s", { recurrence: "daily" });
  assert.equal("repeat" in byId("s"), false);
  assert.equal(byId("s").recurrence, "daily");
  await store.getState().updateEvent("s", { repeat: { freq: "weekly", byWeekday: ["MO", "WE"] } });
  assert.deepEqual(byId("s").repeat, { freq: "weekly", byWeekday: ["MO", "WE"] });
  assert.equal(byId("s").recurrence, "weekly");
  assert.equal(byId("s").repeatLegacy, "weekly|");
});

test("updateEvent: un modulo che rimanda la regola mostrata non annulla il cambio di un'app vecchia", async () => {
  // Un'app vecchia ha portato la serie lun/mer a "ogni giorno": l'impronta non torna più.
  store.setState({ events: [{ ...SERIES, repeat: { freq: "weekly", byWeekday: ["MO", "WE"] }, recurrence: "daily" }, OTHER] });
  await store.getState().updateEvent("s", { title: "Rinominata", repeat: { freq: "daily" }, recurrence: "daily" });
  assert.equal(byId("s").title, "Rinominata");
  assert.equal(byId("s").recurrence, "daily");
  assert.equal("repeat" in byId("s"), false, "vale ogni giorno, come l'ha lasciata l'app vecchia");
  // Una regola scelta davvero vince e riscrive proiezione e impronta.
  await store.getState().updateEvent("s", { repeat: { freq: "weekly", byWeekday: ["TU", "TH"] } });
  assert.deepEqual(byId("s").repeat, { freq: "weekly", byWeekday: ["TU", "TH"] });
  assert.equal(byId("s").recurrence, "none", "martedì e giovedì non partono dal lunedì d'inizio: le app vecchie vedono solo la prima");
  assert.equal(byId("s").repeatLegacy, "none|");
  // Regola vuota = non si ripete più.
  await store.getState().updateEvent("s", { repeat: undefined });
  assert.equal("repeat" in byId("s"), false);
  assert.equal(byId("s").recurrence, "none");
});

test("editOccurrence 'following' con il conteggio: il modulo che rimanda la stessa regola divide le volte", async () => {
  const rule = { freq: "weekly", end: { type: "count", count: 6 } };
  store.setState({ events: [{ ...SERIES, repeat: rule }, OTHER] });
  await store.getState().editOccurrence("s", "2026-11-16", "following", { title: "Dopo", repeat: rule });
  assert.deepEqual(byId("s").repeat.end, { type: "count", count: 2 });
  const child = store.getState().events.find((item) => item.splitFrom === "s");
  assert.deepEqual(child.repeat.end, { type: "count", count: 4 });
  assert.equal(shown("2026-11-01T00:00:00Z", "2027-01-31T00:00:00Z").filter((item) => item.id !== "other").length, 6);
});

test("addEvent scarta promemoria e ricorrenze non validi", async () => {
  await store.getState().addEvent({
    title: "Dati strani",
    start: "2026-11-02T09:00:00.000Z",
    end: "2026-11-02T10:00:00.000Z",
    reminders: [{ minutesBefore: -5 }, { minutesBefore: 15 }],
    occasion: { kind: "inventato" },
    timeZone: "Non/Esiste"
  });
  const created = store.getState().events[0];
  assert.deepEqual(created.reminders, [{ minutesBefore: 15 }]);
  assert.equal("occasion" in created, false);
  assert.notEqual(created.timeZone, "Non/Esiste");
});

test("deleteEvent di una serie elimina anche le sue righe (non le altre serie)", async () => {
  await store.getState().editOccurrence("s", "2026-11-16", "this", { title: "Spostata" });
  await store.getState().deleteEvent("s");
  assert.deepEqual(ids(), ["other"]);
});
