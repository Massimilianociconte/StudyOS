import test from "node:test";
import assert from "node:assert/strict";
import {
  CALENDAR_VIEWS,
  STORED_CALENDAR_MODES,
  dayForNewEvent,
  filterBySubject,
  filterCalendarItems,
  hasItemsInRange,
  isCalendarSummary,
  itemMatchesSubject,
  resolveCalendarMode,
  resolveSubjectFilter,
  subjectCalendarSummary,
  subjectJumpDay
} from "../src/lib/calendarFilter.ts";
import { expandEvents } from "../src/lib/recurrence.ts";

const OLD = "2026-09-01T00:00:00.000Z";

const subject = (id, patch = {}) => ({ id, name: id, archived: false, status: "active", color: "#7CF7C8", ...patch });

const event = (id, patch = {}) => ({
  id,
  createdAt: OLD,
  updatedAt: OLD,
  archived: false,
  tags: [],
  title: id,
  description: "",
  category: "lesson",
  color: "#7CF7C8",
  priority: "medium",
  start: new Date(2026, 10, 10, 9, 0).toISOString(),
  end: new Date(2026, 10, 10, 11, 0).toISOString(),
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...patch
});

const exam = (id, subjectId, patch = {}) => ({ id, subjectId, archived: false, date: new Date(2026, 10, 12, 9, 0).toISOString(), status: "studying", ...patch });
const task = (id, patch = {}) => ({ id, archived: false, status: "todo", title: id, dueDate: new Date(2026, 10, 11, 18, 0).toISOString(), ...patch });
const session = (id, patch = {}) => ({ id, archived: false, status: "completed", start: new Date(2026, 10, 10, 15, 0).toISOString(), ...patch });

/* ------------------------------------------------------------------ */
/* Filtro per materia                                                   */
/* ------------------------------------------------------------------ */

test("itemMatchesSubject: senza filtro passa tutto, compresi eventi senza materia e di altre persone", () => {
  assert.equal(itemMatchesSubject({}, null), true);
  assert.equal(itemMatchesSubject({ subjectId: "s1" }, null), true);
  assert.equal(itemMatchesSubject({ subjectId: "s1", sharedFrom: { ownerId: "u2" } }, null), true);
});

test("itemMatchesSubject: con un filtro passano solo le voci di quella materia", () => {
  assert.equal(itemMatchesSubject({ subjectId: "s1" }, "s1"), true);
  assert.equal(itemMatchesSubject({ subjectId: "s2" }, "s1"), false);
  assert.equal(itemMatchesSubject({}, "s1"), false);
  assert.equal(itemMatchesSubject({ subjectId: null }, "s1"), false);
});

test("itemMatchesSubject: gli eventi di un'altra persona hanno le sue materie, mai le mie: esclusi col filtro", () => {
  // Stesso id per caso: la materia dell'altra persona non è la mia.
  assert.equal(itemMatchesSubject({ subjectId: "s1", sharedFrom: { ownerId: "u2" } }, "s1"), false);
});

test("filterBySubject: senza filtro restituisce lo stesso elenco (niente nuovi render)", () => {
  const items = [{ subjectId: "s1" }, { subjectId: "s2" }];
  assert.equal(filterBySubject(items, null), items);
  assert.deepEqual(filterBySubject(items, "s2"), [{ subjectId: "s2" }]);
});

test("filterCalendarItems: filtra ogni tipo mostrato dal calendario (lezioni, eventi, esami, scadenze, sessioni)", () => {
  const from = new Date(2026, 10, 9);
  const to = new Date(2026, 10, 16);
  const occurrences = expandEvents(
    [
      event("lezione", { subjectId: "s1", recurrence: "weekly", start: new Date(2026, 10, 2, 9).toISOString(), end: new Date(2026, 10, 2, 11).toISOString() }),
      event("studio", { subjectId: "s1", category: "study" }),
      event("palestra", { category: "gym" }),
      event("altra", { subjectId: "s2" })
    ],
    from,
    to
  );
  const shared = [{ ...occurrences[0], id: "condiviso", occurrenceKey: "u2:x", sharedFrom: { ownerId: "u2" } }];
  const result = filterCalendarItems(
    {
      occurrences: [...occurrences, ...shared],
      tasks: [task("t1", { subjectId: "s1" }), task("t2", { subjectId: "s2" }), task("t3")],
      exams: [exam("x1", "s1"), exam("x2", "s2")],
      sessions: [session("n1", { subjectId: "s1" }), session("n2", { subjectId: "s2" })]
    },
    "s1"
  );
  assert.deepEqual(result.occurrences.map((item) => item.id).sort(), ["lezione", "studio"]);
  assert.deepEqual(result.tasks.map((item) => item.id), ["t1"]);
  assert.deepEqual(result.exams.map((item) => item.id), ["x1"]);
  assert.deepEqual(result.sessions.map((item) => item.id), ["n1"]);
});

test("filterCalendarItems: senza filtro i gruppi restano quelli di partenza", () => {
  const groups = { occurrences: [event("a")], tasks: [task("t")], exams: [exam("x", "s1")] };
  const result = filterCalendarItems(groups, null);
  assert.equal(result.occurrences, groups.occurrences);
  assert.equal(result.tasks, groups.tasks);
  assert.equal(result.exams, groups.exams);
});

test("resolveSubjectFilter: un id salvato vale solo se la materia esiste e non è archiviata", () => {
  const subjects = [subject("s1"), subject("s2", { archived: true }), subject("s3", { status: "archived" }), subject("s4", { status: "completed" })];
  assert.equal(resolveSubjectFilter("s1", subjects), "s1");
  assert.equal(resolveSubjectFilter("s2", subjects), null);
  assert.equal(resolveSubjectFilter("s3", subjects), null);
  // Superata ma non archiviata: resta nel piano di studio, il filtro vale.
  assert.equal(resolveSubjectFilter("s4", subjects), "s4");
  assert.equal(resolveSubjectFilter("sparita", subjects), null);
  assert.equal(resolveSubjectFilter(null, subjects), null);
  assert.equal(resolveSubjectFilter("", subjects), null);
  assert.equal(resolveSubjectFilter(42, subjects), null);
  assert.equal(resolveSubjectFilter(undefined, subjects), null);
});

/* ------------------------------------------------------------------ */
/* Riepilogo per materia                                                */
/* ------------------------------------------------------------------ */

test("subjectCalendarSummary: solo materie non archiviate, le superate in fondo", () => {
  const summary = subjectCalendarSummary({
    subjects: [subject("chimica", { status: "completed" }), subject("analisi"), subject("vecchia", { archived: true }), subject("storia", { status: "archived" }), subject("fisica")],
    events: [],
    exams: [],
    tasks: []
  });
  assert.deepEqual(summary.rows.map((row) => row.subject.id), ["analisi", "fisica", "chimica"]);
  assert.equal(summary.planned, 3);
  assert.equal(summary.rows[2].completed, true);
});

test("subjectCalendarSummary: una serie ricorrente conta 1, esami e scadenze inclusi, archiviati esclusi", () => {
  const summary = subjectCalendarSummary({
    subjects: [subject("s1"), subject("s2"), subject("s3")],
    events: [
      event("lezione", { subjectId: "s1", recurrence: "weekly" }),
      event("ricevimento", { subjectId: "s1" }),
      event("archiviato", { subjectId: "s1", archived: true }),
      event("senza materia"),
      event("di s2", { subjectId: "s2", recurrence: "daily" })
    ],
    exams: [exam("x1", "s1"), exam("x2", "s1", { status: "done" }), exam("x3", "s1", { archived: true })],
    tasks: [
      task("t1", { subjectId: "s1" }),
      task("t2", { subjectId: "s1", status: "done" }),
      task("t3", { subjectId: "s1", status: "archived" }),
      task("t4", { subjectId: "s1", archived: true }),
      task("t5", { subjectId: "s1", dueDate: undefined })
    ]
  });
  const [s1, s2, s3] = summary.rows;
  assert.deepEqual(
    { events: s1.events, weekly: s1.weekly, exams: s1.exams, deadlines: s1.deadlines, items: s1.items },
    { events: 2, weekly: 1, exams: 2, deadlines: 2, items: 6 }
  );
  assert.deepEqual({ events: s2.events, weekly: s2.weekly, items: s2.items }, { events: 1, weekly: 0, items: 1 });
  assert.equal(s3.items, 0);
});

test("subjectCalendarSummary: una serie divisa («questa e le successive») conta una volta", () => {
  const weekly = (byWeekday) => ({ recurrence: "weekly", repeat: { freq: "weekly", byWeekday }, repeatLegacy: "weekly|" });
  const summary = subjectCalendarSummary({
    subjects: [subject("s1"), subject("s2")],
    events: [
      event("lezione", { subjectId: "s1", ...weekly(["TU"]) }),
      event("lezione-dal-17", { subjectId: "s1", splitFrom: "lezione", originalDate: "2026-11-17", ...weekly(["TU"]) }),
      event("lezione-dal-24", { subjectId: "s1", splitFrom: "lezione-dal-17", originalDate: "2026-11-24", ...weekly(["TU"]) }),
      event("ricevimento", { subjectId: "s1" }),
      // Una parte spostata su un'altra materia conta là (e anche qui, per la parte che resta).
      event("esercitazione", { subjectId: "s1", recurrence: "daily" }),
      event("esercitazione-s2", { subjectId: "s2", splitFrom: "esercitazione", originalDate: "2026-11-20", recurrence: "daily" }),
      // Una madre eliminata non sposta il conto della figlia.
      event("vecchia", { subjectId: "s2", archived: true, ...weekly(["FR"]) }),
      event("vecchia-dal-20", { subjectId: "s2", splitFrom: "vecchia", ...weekly(["FR"]) })
    ],
    exams: [],
    tasks: []
  });
  const [s1, s2] = summary.rows;
  assert.deepEqual({ events: s1.events, weekly: s1.weekly }, { events: 3, weekly: 1 });
  assert.deepEqual({ events: s2.events, weekly: s2.weekly }, { events: 2, weekly: 1 });
});

test("subjectCalendarSummary: «ogni settimana» legge la regola `repeat`, non solo il campo vecchio", () => {
  const summary = subjectCalendarSummary({
    subjects: [subject("s1")],
    events: [
      // Lunedì e mercoledì, con inizio di martedì: per le app vecchie è "none", ma è settimanale.
      event("lun-mer", { subjectId: "s1", recurrence: "none", repeat: { freq: "weekly", byWeekday: ["MO", "WE"] }, repeatLegacy: "none|" }),
      event("feriali", { subjectId: "s1", recurrence: "weekly", repeat: { freq: "weekly", byWeekday: ["MO", "TU", "WE", "TH", "FR"] }, repeatLegacy: "weekly|" }),
      event("vecchio stile", { subjectId: "s1", recurrence: "weekly" }),
      // Ogni 2 settimane non è "ogni settimana".
      event("quindicinale", { subjectId: "s1", recurrence: "none", repeat: { freq: "weekly", interval: 2 }, repeatLegacy: "none|" }),
      // Un'app vecchia ha cambiato la ripetizione in "ogni giorno": vale quella.
      event("cambiato", { subjectId: "s1", recurrence: "daily", repeat: { freq: "weekly" }, repeatLegacy: "weekly|" })
    ],
    exams: [],
    tasks: []
  });
  assert.deepEqual({ events: summary.rows[0].events, weekly: summary.rows[0].weekly }, { events: 5, weekly: 3 });
});

test("subjectCalendarSummary: tre informazioni distinte (materie del piano, materie con impegni, impegni per materia)", () => {
  const summary = subjectCalendarSummary({
    subjects: [subject("s1"), subject("s2"), subject("s3"), subject("s4", { archived: true })],
    events: [event("e", { subjectId: "s4" })],
    exams: [exam("x", "s2")],
    tasks: [task("t", { subjectId: "s1" })]
  });
  assert.equal(summary.planned, 3);
  assert.equal(summary.withItems, 2);
  assert.deepEqual(summary.rows.map((row) => row.items), [1, 1, 0]);
});

/* ------------------------------------------------------------------ */
/* Periodo vuoto e giorno per un nuovo evento                           */
/* ------------------------------------------------------------------ */

test("hasItemsInRange: eventi, scadenze ed esami nel periodo [from, to)", () => {
  const from = new Date(2026, 10, 9);
  const to = new Date(2026, 10, 16);
  assert.equal(hasItemsInRange({ occurrences: [], tasks: [], exams: [] }, from, to), false);
  assert.equal(hasItemsInRange({ occurrences: [event("e")] }, from, to), true);
  assert.equal(hasItemsInRange({ tasks: [task("t")] }, from, to), true);
  assert.equal(hasItemsInRange({ exams: [exam("x", "s1")] }, from, to), true);
  // Fuori periodo, o attività senza scadenza: niente.
  assert.equal(hasItemsInRange({ tasks: [task("t", { dueDate: new Date(2026, 10, 16, 0, 0).toISOString() })] }, from, to), false);
  assert.equal(hasItemsInRange({ tasks: [task("t", { dueDate: undefined })] }, from, to), false);
  assert.equal(hasItemsInRange({ exams: [exam("x", "s1", { date: new Date(2026, 10, 8, 23, 59).toISOString() })] }, from, to), false);
  // Evento iniziato prima e che finisce dentro il periodo: c'è.
  assert.equal(
    hasItemsInRange({ occurrences: [event("lungo", { start: new Date(2026, 10, 8, 22).toISOString(), end: new Date(2026, 10, 9, 2).toISOString() })] }, from, to),
    true
  );
});

test("dayForNewEvent: oggi se è nel periodo mostrato, altrimenti il primo giorno del periodo", () => {
  const from = new Date(2026, 10, 9);
  const to = new Date(2026, 10, 16);
  assert.equal(dayForNewEvent(from, to, new Date(2026, 10, 11, 15, 30)).getTime(), new Date(2026, 10, 11).getTime());
  assert.equal(dayForNewEvent(from, to, new Date(2026, 10, 20, 8)).getTime(), from.getTime());
  assert.equal(dayForNewEvent(from, to, new Date(2026, 10, 2, 8)).getTime(), from.getTime());
});

/* ------------------------------------------------------------------ */
/* Viste: da 7 a 4, valori salvati di prima ancora validi               */
/* ------------------------------------------------------------------ */

test("viste nel selettore: Giorno, Settimana, Mese, Agenda", () => {
  assert.deepEqual([...CALENDAR_VIEWS], ["day", "week", "month", "agenda"]);
  for (const old of ["day", "week", "month", "agenda", "exam", "semester", "focus"]) assert.ok(STORED_CALENDAR_MODES.includes(old), old);
});

test("resolveCalendarMode: le 4 viste restano com'erano", () => {
  for (const view of CALENDAR_VIEWS) assert.deepEqual(resolveCalendarMode(view, false), { mode: view, dayFocus: false });
  assert.deepEqual(resolveCalendarMode("day", true), { mode: "day", dayFocus: true });
  // L'opzione "Solo 8–19" riguarda solo Giorno, ma resta ricordata per quando ci si torna.
  assert.deepEqual(resolveCalendarMode("week", true), { mode: "week", dayFocus: true });
});

test("resolveCalendarMode: \"Giornata di studio\" salvata diventa Giorno con l'opzione attiva", () => {
  assert.deepEqual(resolveCalendarMode("focus", false), { mode: "day", dayFocus: true });
  assert.deepEqual(resolveCalendarMode("focus", undefined), { mode: "day", dayFocus: true });
});

test("resolveCalendarMode: Esami e Per materia restano validi come riepiloghi", () => {
  assert.deepEqual(resolveCalendarMode("exam", false), { mode: "exam", dayFocus: false });
  assert.deepEqual(resolveCalendarMode("semester", false), { mode: "semester", dayFocus: false });
  assert.equal(isCalendarSummary("exam"), true);
  assert.equal(isCalendarSummary("semester"), true);
  for (const view of CALENDAR_VIEWS) assert.equal(isCalendarSummary(view), false);
});

test("resolveCalendarMode: valori sconosciuti o rotti tornano a Settimana", () => {
  for (const bad of [undefined, null, "", "year", 3, {}]) assert.deepEqual(resolveCalendarMode(bad, "sì"), { mode: "week", dayFocus: false });
});

/* ------------------------------------------------------------------ */
/* Riepilogo per materia: dove porta il calendario                      */
/* ------------------------------------------------------------------ */

const NOW = new Date(2026, 10, 12, 15, 0);
const ymd = (date) => (date ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}` : null);
const jump = (input) => ymd(subjectJumpDay({ subjectId: "s1", events: [], exams: [], tasks: [], now: NOW, ...input }));

test("subjectJumpDay: la prossima voce della materia, anche oltre la settimana mostrata (1 impegno il 20)", () => {
  const events = [
    event("e1", { subjectId: "s1", start: new Date(2026, 10, 20, 9).toISOString(), end: new Date(2026, 10, 20, 11).toISOString() }),
    event("e2", { subjectId: "s2", start: new Date(2026, 10, 13, 9).toISOString(), end: new Date(2026, 10, 13, 11).toISOString() })
  ];
  assert.equal(jump({ events }), "2026-11-20");
});

test("subjectJumpDay: la voce più vicina tra eventi, esami e scadenze", () => {
  const events = [event("e1", { subjectId: "s1", start: new Date(2026, 10, 30, 9).toISOString(), end: new Date(2026, 10, 30, 10).toISOString() })];
  const exams = [exam("x1", "s1", { date: new Date(2026, 11, 15, 9).toISOString() })];
  const tasks = [task("t1", { subjectId: "s1", dueDate: new Date(2026, 10, 25, 18).toISOString() })];
  assert.equal(jump({ events, exams, tasks }), "2026-11-25");
  assert.equal(jump({ events, exams }), "2026-11-30");
  assert.equal(jump({ exams }), "2026-12-15");
});

test("subjectJumpDay: una serie conta dalla sua prossima volta, non dal primo giorno", () => {
  // Ogni lunedì da settembre: il prossimo lunedì dopo giovedì 12 novembre è il 16.
  const events = [
    event("w", { subjectId: "s1", recurrence: "weekly", start: new Date(2026, 8, 7, 9).toISOString(), end: new Date(2026, 8, 7, 11).toISOString() })
  ];
  assert.equal(jump({ events }), "2026-11-16");
});

test("subjectJumpDay: le voci di oggi (anche già passate nell'ora) e quelle in corso portano a oggi", () => {
  const morning = event("m", { subjectId: "s1", start: new Date(2026, 10, 12, 8).toISOString(), end: new Date(2026, 10, 12, 9).toISOString() });
  assert.equal(jump({ events: [morning] }), "2026-11-12");
  const trip = event("t", { subjectId: "s1", start: new Date(2026, 10, 10, 9).toISOString(), end: new Date(2026, 10, 14, 9).toISOString() });
  assert.equal(jump({ events: [trip] }), "2026-11-12");
});

test("subjectJumpDay: senza voci future, l'ultima passata; senza voci, null", () => {
  const events = [
    event("a", { subjectId: "s1", start: new Date(2026, 9, 1, 9).toISOString(), end: new Date(2026, 9, 1, 10).toISOString() }),
    event("b", { subjectId: "s1", start: new Date(2026, 9, 20, 9).toISOString(), end: new Date(2026, 9, 20, 10).toISOString() })
  ];
  const tasks = [task("t", { subjectId: "s1", dueDate: new Date(2026, 9, 5, 18).toISOString() })];
  assert.equal(jump({ events, tasks }), "2026-10-20");
  assert.equal(jump({ tasks }), "2026-10-05");
  // Una serie finita: la sua ultima volta.
  const ended = event("w", {
    subjectId: "s1",
    recurrence: "weekly",
    recurrenceUntil: "2026-10-26",
    start: new Date(2026, 8, 7, 9).toISOString(),
    end: new Date(2026, 8, 7, 10).toISOString()
  });
  assert.equal(jump({ events: [ended] }), "2026-10-26");
  assert.equal(jump({}), null);
});

test("subjectJumpDay: voci archiviate, di altre materie o giorni annullati non contano", () => {
  const events = [
    event("arch", { subjectId: "s1", archived: true, start: new Date(2026, 10, 14, 9).toISOString(), end: new Date(2026, 10, 14, 10).toISOString() }),
    event("other", { subjectId: "s2", start: new Date(2026, 10, 15, 9).toISOString(), end: new Date(2026, 10, 15, 10).toISOString() })
  ];
  const exams = [exam("x", "s1", { archived: true, date: new Date(2026, 10, 16, 9).toISOString() })];
  const tasks = [task("t", { subjectId: "s1", status: "archived", dueDate: new Date(2026, 10, 17, 18).toISOString() })];
  assert.equal(jump({ events, exams, tasks }), null);
});
