import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { findAgentTool } from "../src/agent/catalog.ts";
import { describeAgentCall, executeAgentTool } from "../src/agent/execute.ts";
import { parseToolArgs } from "../src/agent/schema.ts";
import { expandEvents } from "../src/lib/recurrence.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

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

// Ogni lunedì alle 10 a Roma; il 16 novembre è stato spostato a martedì e rinominato.
const SERIES = event({ id: "s", recurrence: "weekly", repeat: { freq: "weekly" }, repeatLegacy: "weekly|", timeZone: "Europe/Rome" });
const ROW = event({
  id: "s@2026-11-16",
  seriesId: "s",
  originalDate: "2026-11-16",
  title: "Spostata",
  start: "2026-11-17T09:00:00.000Z",
  end: "2026-11-17T10:00:00.000Z"
});
// Senza fuso: il 4 novembre alle 15 dell'ora locale, in qualsiasi fuso giri il test.
const ONCE = event({ id: "once", title: "Ricevimento", start: new Date(2026, 10, 4, 15).toISOString(), end: new Date(2026, 10, 4, 16).toISOString() });

beforeEach(() => {
  useStudyStore.setState({
    loading: false,
    locked: false,
    persistError: null,
    subjects: [],
    tasks: [],
    events: [SERIES, ROW, ONCE],
    exams: [],
    sessions: [],
    topics: [],
    notes: [],
    goals: [],
    attachments: [],
    notifications: [],
    reminders: [],
    preferences: [],
    studyGroups: [],
    groupResources: []
  });
});

const events = () => useStudyStore.getState().events;
const byId = (id) => events().find((item) => item.id === id);
const days = () =>
  expandEvents(events(), new Date("2026-11-01T00:00:00.000Z"), new Date("2026-12-01T00:00:00.000Z"))
    .filter((item) => item.recurring)
    .map((item) => `${item.occurrenceDate} ${item.title}`);

test("catalogo eventi: campi nuovi solo facoltativi, Vacanza tra le tipologie, chiamate di prima valide", () => {
  const create = findAgentTool("studyos_create_event").inputSchema;
  const update = findAgentTool("studyos_update_event").inputSchema;
  const remove = findAgentTool("studyos_delete_event").inputSchema;
  for (const schema of [create, update]) {
    assert.ok(schema.properties.category.enum.includes("vacation"));
    for (const key of ["repeat", "occasion", "reminders", "color", "colorCustom", "location"]) assert.ok(schema.properties[key], key);
  }
  assert.deepEqual(create.required, ["title", "start"]);
  assert.deepEqual(update.required, ["id"]);
  for (const schema of [update, remove]) {
    assert.deepEqual(schema.properties.scope.enum, ["this", "following", "all"]);
    assert.equal(schema.properties.occurrenceDate.format, "date");
  }
  // Un'eliminazione dice solo cosa eliminare: l'evento, ed eventualmente quali giorni.
  assert.deepEqual(Object.keys(remove.properties).sort(), ["confirm", "id", "occurrenceDate", "scope"]);
  assert.equal(parseToolArgs(remove, { id: "s", confirm: true }).ok, true);
  assert.equal(parseToolArgs(remove, { id: "s", confirm: true, occurrenceDate: "2026-11-09", scope: "this" }).ok, true);
  assert.equal(parseToolArgs(remove, { id: "s", confirm: true, scope: "tutto" }).ok, false);
  assert.equal(parseToolArgs(update, { id: "s", repeat: { freq: "weekly", byWeekday: ["MO", "WE"], end: { type: "count", count: 10 } } }).ok, true);
  assert.equal(parseToolArgs(update, { id: "s", repeat: { freq: "weekly", altro: 1 } }).ok, false);
  assert.equal(parseToolArgs(create, { title: "Mare", start: "2026-08-01", allDay: true, category: "vacation", color: "javascript:x" }).ok, false);
});

test("list_events: ogni occorrenza con id della serie, giorno, regola; i giorni modificati restano indirizzabili", async () => {
  const listed = await executeAgentTool("studyos_list_events", { from: "2026-11-01T00:00:00.000Z", to: "2026-11-24T00:00:00.000Z" });
  assert.equal(listed.ok, true);
  const items = listed.data.items;
  const recurring = items.filter((item) => item.recurring);
  assert.deepEqual(
    recurring.map((item) => item.occurrenceDate),
    ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"]
  );
  for (const item of recurring) {
    assert.equal(item.id, "s", "l'id della riga (serie@giorno) non è un id valido per gli strumenti");
    assert.equal(item.seriesId, "s");
    assert.deepEqual(item.repeat, { freq: "weekly" });
  }
  const moved = recurring.find((item) => item.occurrenceDate === "2026-11-16");
  assert.equal(moved.title, "Spostata");
  assert.equal(moved.start, ROW.start);
  const once = items.find((item) => item.id === "once");
  assert.equal(once.recurring, false);
  assert.equal("occurrenceDate" in once, false);
  assert.equal("seriesId" in once, false);
  assert.equal("repeat" in once, false);
});

test("update_event con occurrenceDate: solo quel giorno, da lì in poi, tutta la serie", async () => {
  const one = await executeAgentTool("studyos_update_event", { id: "s", occurrenceDate: "2026-11-09", scope: "this", title: "Recupero" });
  assert.equal(one.ok, true);
  assert.equal(byId("s@2026-11-09").title, "Recupero");
  assert.equal(byId("s").title, "Lezione");

  const following = await executeAgentTool("studyos_update_event", { id: "s", occurrenceDate: "2026-11-23", scope: "following", title: "Esercitazione" });
  assert.equal(following.ok, true);
  const child = events().find((item) => item.splitFrom === "s");
  assert.ok(child, "la serie si divide");
  assert.equal(child.title, "Esercitazione");
  assert.deepEqual(days(), ["2026-11-02 Lezione", "2026-11-09 Recupero", "2026-11-16 Spostata", "2026-11-23 Esercitazione", "2026-11-30 Esercitazione"]);
});

test("update_event «all» da un giorno: la serie cambia ora ma non giorno (anche con allDay=false ripetuto)", async () => {
  const moved = await executeAgentTool("studyos_update_event", {
    id: "s",
    occurrenceDate: "2026-11-23",
    scope: "all",
    start: "2026-11-23T10:00:00.000Z",
    allDay: false
  });
  assert.equal(moved.ok, true);
  assert.equal(byId("s").start, "2026-11-02T10:00:00.000Z");
  assert.equal(byId("s").end, "2026-11-02T11:00:00.000Z");
  // Senza scope vale «all», come prima.
  assert.equal((await executeAgentTool("studyos_update_event", { id: "s", occurrenceDate: "2026-11-09", title: "Analisi" })).ok, true);
  assert.equal(byId("s").title, "Analisi");
});

test("update_event: errori chiari per giorni, portate e regole che non vanno", async () => {
  assert.equal((await executeAgentTool("studyos_update_event", { id: "s", occurrenceDate: "2026-11-10", scope: "this", title: "x" })).code, "not_found");
  assert.equal((await executeAgentTool("studyos_update_event", { id: "once", occurrenceDate: "2026-11-04", scope: "this", title: "x" })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_update_event", { id: "s", scope: "this", title: "x" })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_update_event", { id: "s", occurrenceDate: "2026-11-09", scope: "this", repeat: { freq: "daily" } })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_update_event", { id: "s", repeat: { freq: "weekly", interval: 500 } })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_update_event", { id: "s", occasion: { kind: "nope" } })).code, "invalid");
  assert.deepEqual(days().slice(0, 2), ["2026-11-02 Lezione", "2026-11-09 Lezione"], "niente è cambiato");
});

test("update_event: regola nuova, promemoria, colore scelto e luogo", async () => {
  const updated = await executeAgentTool("studyos_update_event", {
    id: "s",
    repeat: { freq: "weekly", byWeekday: ["MO", "WE"] },
    reminders: [{ minutesBefore: 30 }, { minutesBefore: -5 }],
    color: "#3b82f6",
    location: "Aula 3"
  });
  assert.equal(updated.ok, true);
  const series = byId("s");
  assert.deepEqual(series.repeat, { freq: "weekly", byWeekday: ["MO", "WE"] });
  assert.deepEqual(series.reminders, [{ minutesBefore: 30 }]);
  assert.equal(series.color, "#3B82F6");
  assert.equal(series.colorCustom, true);
  assert.equal(series.location, "Aula 3");
  // Di nuovo il colore della tipologia; luogo vuoto = tolto.
  assert.equal((await executeAgentTool("studyos_update_event", { id: "s", colorCustom: false, location: "" })).ok, true);
  assert.equal(byId("s").colorCustom, false);
  assert.equal(byId("s").location, undefined);
});

test("delete_event con occurrenceDate: un giorno, da lì in poi, tutta la serie", async () => {
  assert.equal((await executeAgentTool("studyos_delete_event", { id: "s", confirm: true, occurrenceDate: "2026-11-09", scope: "this" })).ok, true);
  assert.deepEqual(days().slice(0, 3), ["2026-11-02 Lezione", "2026-11-16 Spostata", "2026-11-23 Lezione"]);
  assert.equal((await executeAgentTool("studyos_delete_event", { id: "s", confirm: true, occurrenceDate: "2026-11-23", scope: "following" })).ok, true);
  assert.deepEqual(days(), ["2026-11-02 Lezione", "2026-11-16 Spostata"]);
  assert.equal((await executeAgentTool("studyos_delete_event", { id: "s", confirm: true, occurrenceDate: "2026-11-24", scope: "this" })).code, "not_found");
  assert.equal((await executeAgentTool("studyos_delete_event", { id: "s", confirm: true, scope: "following" })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_delete_event", { id: "s", confirm: true, occurrenceDate: "2026-11-02", scope: "all" })).ok, true);
  assert.deepEqual(days(), []);
  assert.deepEqual(events().map((item) => item.id), ["once"]);
  // Senza occurrenceDate: come prima.
  assert.equal((await executeAgentTool("studyos_delete_event", { id: "once", confirm: true })).ok, true);
  assert.deepEqual(events(), []);
});

test("delete_event: la conferma dice quali giorni", async () => {
  assert.match(await describeAgentCall("studyos_delete_event", { id: "s", confirm: true, occurrenceDate: "2026-11-09", scope: "this" }), /solo il 2026-11-09.*«Lezione»/);
  assert.match(await describeAgentCall("studyos_delete_event", { id: "s", confirm: true, occurrenceDate: "2026-11-09", scope: "following" }), /dal 2026-11-09 in poi.*«Lezione»/);
  assert.match(await describeAgentCall("studyos_delete_event", { id: "s", confirm: true, occurrenceDate: "2026-11-09" }), /tutta la serie.*«Lezione»/);
  assert.equal(await describeAgentCall("studyos_delete_event", { id: "once", confirm: true }), "Eliminare un evento: «Ricevimento»");
});

test("create_event: compleanno ogni anno, vacanza, colore e promemoria", async () => {
  const birthday = await executeAgentTool("studyos_create_event", {
    title: "Compleanno di Giulia",
    start: "2026-03-14",
    allDay: true,
    category: "personal",
    occasion: { kind: "birthday", person: "Giulia", birthYear: 2001 },
    reminders: [{ at: "09:00" }],
    recurrence: "none"
  });
  assert.equal(birthday.ok, true);
  const saved = byId(birthday.data.id);
  assert.deepEqual(saved.repeat, { freq: "yearly" }, "una ricorrenza senza regola si ripete ogni anno");
  assert.deepEqual(saved.occasion, { kind: "birthday", birthYear: 2001, person: "Giulia" });
  assert.deepEqual(saved.reminders, [{ at: "09:00" }]);
  assert.equal(saved.allDay, true);

  const trip = await executeAgentTool("studyos_create_event", {
    title: "Mare",
    start: "2026-08-01",
    allDay: true,
    category: "vacation",
    location: "Sardegna",
    color: "#FACC15",
    repeat: { freq: "monthly", interval: 500 }
  });
  assert.equal(trip.code, "invalid", "regola non valida");
  const ok = await executeAgentTool("studyos_create_event", { title: "Mare", start: "2026-08-01", allDay: true, category: "vacation", location: "Sardegna", color: "#FACC15" });
  assert.equal(ok.ok, true);
  const vacation = byId(ok.data.id);
  assert.equal(vacation.category, "vacation");
  assert.equal(vacation.location, "Sardegna");
  assert.equal(vacation.colorCustom, true);
  assert.equal(vacation.repeat, undefined);

  // Più giorni: end è l'ultimo giorno compreso; spostando start i giorni restano gli stessi.
  const long = await executeAgentTool("studyos_create_event", { title: "Montagna", start: "2026-12-27", end: "2026-12-31", allDay: true, category: "vacation" });
  assert.equal(byId(long.data.id).start, new Date(2026, 11, 27).toISOString());
  assert.equal(byId(long.data.id).end, new Date(2027, 0, 1).toISOString());
  assert.equal((await executeAgentTool("studyos_update_event", { id: long.data.id, start: "2026-12-28" })).ok, true);
  assert.equal(byId(long.data.id).end, new Date(2027, 0, 2).toISOString());
  // Fine esclusiva a mezzanotte (come nei file .ics): un solo giorno.
  const single = await executeAgentTool("studyos_create_event", { title: "Gita", start: "2026-12-05", end: "2026-12-06T00:00:00", allDay: true });
  assert.equal(byId(single.data.id).end, new Date(2026, 11, 6).toISOString());
  assert.equal((await executeAgentTool("studyos_create_event", { title: "No", start: "2026-12-05", end: "2026-12-01", allDay: true })).code, "invalid");

  const plain = await executeAgentTool("studyos_create_event", { title: "Studio", start: "2026-11-05T15:00:00.000Z", repeat: { freq: "daily", end: { type: "count", count: 3 } }, recurrence: "none" });
  assert.equal(plain.ok, true);
  assert.deepEqual(byId(plain.data.id).repeat, { freq: "daily", end: { type: "count", count: 3 } }, "repeat vince su recurrence");
  assert.equal(byId(plain.data.id).colorCustom, undefined, "senza colore resta quello della tipologia");
});
