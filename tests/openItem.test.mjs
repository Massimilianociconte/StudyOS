import test from "node:test";
import assert from "node:assert/strict";
import { linkedItem, openItemPlan, searchKindEntity } from "../src/lib/openItem.ts";
import { allDayFirstDate } from "../src/lib/repeat.ts";

const data = {
  tasks: [{ id: "t1", title: "Esercizi" }],
  events: [
    { id: "e1", title: "Lezione", start: "2026-10-23T08:00:00.000Z", end: "2026-10-23T10:00:00.000Z" },
    { id: "e2", title: "Laboratorio", start: "2026-10-05T08:00:00.000Z", end: "2026-10-05T10:00:00.000Z", repeat: { freq: "weekly", interval: 1 } },
    { id: "e2@2026-10-12", title: "Laboratorio spostato", seriesId: "e2", originalDate: "2026-10-12", start: "2026-10-13T09:00:00.000Z", end: "2026-10-13T11:00:00.000Z" },
    { id: "e3", title: "Compleanno di Anna", occasion: { kind: "birthday" }, allDay: true, start: "2026-03-02T00:00:00.000Z", end: "2026-03-03T00:00:00.000Z" },
    { id: "e3@2027-03-02", title: "Festa di Anna", seriesId: "e3", originalDate: "2027-03-02", allDay: true, start: "2027-03-02T00:00:00.000Z", end: "2027-03-03T00:00:00.000Z" },
    { id: "e4", title: "Ferie", category: "vacation", allDay: true, start: "2026-08-10T00:00:00.000Z", end: "2026-08-15T00:00:00.000Z" }
  ],
  subjects: [{ id: "s1", name: "Fisica" }],
  exams: [{ id: "x1", subjectId: "s1" }],
  attachments: [{ id: "a1", name: "Dispense.pdf" }],
  sessions: [{ id: "n1", title: "Ripasso serale" }],
  topics: [{ id: "p1", title: "Cinematica", subjectId: "s1" }],
  goals: [{ id: "g1", title: "Finire il programma" }]
};

test("apri elemento: un'attività apre il suo modulo in Attività", () => {
  assert.deepEqual(openItemPlan("task", "t1", data), { view: "tasks", writes: [["tasks.editing", "t1", "tab"]] });
});

test("apri elemento: un evento porta il calendario al suo giorno e lo apre", () => {
  assert.deepEqual(openItemPlan("calendarEvent", "e1", data), {
    view: "calendar",
    writes: [
      ["calendar.cursor", "2026-10-23T08:00:00.000Z", "tab"],
      ["calendar.editingEvent", "e1", "tab"],
      ["calendar.editingDate", null, "tab"]
    ]
  });
});

test("apri elemento: una serie si apre tutta, dal suo primo giorno", () => {
  const plan = openItemPlan("calendarEvent", "e2", data);
  assert.deepEqual(plan.writes, [
    ["calendar.cursor", "2026-10-05T08:00:00.000Z", "tab"],
    ["calendar.editingEvent", "e2", "tab"],
    ["calendar.editingDate", null, "tab"]
  ]);
});

test("apri elemento: un giorno cambiato da solo si apre come quel giorno della serie, dove ora si trova", () => {
  const plan = openItemPlan("calendarEvent", "e2@2026-10-12", data);
  assert.deepEqual(plan.writes, [
    ["calendar.cursor", "2026-10-13T09:00:00.000Z", "tab"],
    ["calendar.editingEvent", "e2@2026-10-12", "tab"],
    ["calendar.editingDate", "2026-10-12", "tab"]
  ]);
});

test("apri elemento: ricorrenze e vacanze si aprono nel loro modulo, per tutta la serie (come dal calendario)", () => {
  const row = openItemPlan("calendarEvent", "e3@2027-03-02", data);
  assert.deepEqual(row.writes.slice(1), [
    ["calendar.editingEvent", "e3", "tab"],
    ["calendar.editingDate", null, "tab"]
  ]);
  const vacation = openItemPlan("calendarEvent", "e4", data);
  assert.deepEqual(vacation.writes.slice(1), [
    ["calendar.editingEvent", "e4", "tab"],
    ["calendar.editingDate", null, "tab"]
  ]);
});

test("apri elemento: un tutto il giorno porta al suo primo giorno nel suo fuso (la data che la ricerca mostra)", () => {
  const plan = openItemPlan("calendarEvent", "e4", data);
  assert.deepEqual(plan.writes[0], ["calendar.cursor", allDayFirstDate(data.events[5]).toISOString(), "tab"]);
  assert.ok(!Number.isNaN(Date.parse(plan.writes[0][1])), "il calendario accetta solo date leggibili");
});

test("apri elemento: materia, esame e obiettivo con le chiavi delle loro sezioni", () => {
  assert.deepEqual(openItemPlan("subject", "s1", data), { view: "subjects", writes: [["subjects.open", "s1", "tab"]] });
  assert.deepEqual(openItemPlan("exam", "x1", data), { view: "exams", writes: [["exams.editing", "x1", "tab"]] });
  assert.deepEqual(openItemPlan("goal", "g1", data), { view: "goals", writes: [["goals.open", "g1", "tab"]] });
});

test("apri elemento: un materiale si ritrova per nome, senza filtri di tipo o materia che lo nascondano", () => {
  assert.deepEqual(openItemPlan("attachment", "a1", data), {
    view: "materials",
    writes: [
      ["materials.query", "Dispense.pdf", "tab"],
      ["materials.kind", "all", "device"],
      ["materials.subject", "", "device"]
    ]
  });
});

test("apri elemento: un argomento apre gli argomenti della sua materia; una sessione porta a Studio", () => {
  assert.deepEqual(openItemPlan("studyTopic", "p1", data), {
    view: "study",
    writes: [
      ["study.topicsFilter", "s1", "tab"],
      ["study.topicsOpen", true, "tab"]
    ]
  });
  assert.deepEqual(openItemPlan("studySession", "n1", data), { view: "study", writes: [] });
});

test("apri elemento: un elemento che non c'è più, un tipo sconosciuto o un id che è di un altro tipo non portano da nessuna parte", () => {
  assert.equal(openItemPlan("task", "nope", data), null);
  assert.equal(openItemPlan("task", "s1", data), null);
  assert.equal(openItemPlan("constructor", "t1", data), null);
  assert.equal(openItemPlan(undefined, "t1", data), null);
  assert.equal(openItemPlan("task", undefined, data), null);
  // Le note si aprono sul posto (Drawer), non in una sezione.
  assert.equal(openItemPlan("note", "o1", data), null);
});

test("ricerca: ogni tipo di risultato è un tipo di elemento", () => {
  assert.deepEqual(
    ["task", "event", "subject", "exam", "material", "session", "topic", "goal", "note"].map(searchKindEntity),
    ["task", "calendarEvent", "subject", "exam", "attachment", "studySession", "studyTopic", "goal", "note"]
  );
});

test("nota collegata: tipo e nome dell'elemento, o null se non c'è più", () => {
  assert.deepEqual(linkedItem("task", "t1", data), { kind: "Attività", title: "Esercizi" });
  assert.deepEqual(linkedItem("calendarEvent", "e1", data), { kind: "Evento", title: "Lezione" });
  assert.deepEqual(linkedItem("subject", "s1", data), { kind: "Materia", title: "Fisica" });
  assert.deepEqual(linkedItem("exam", "x1", data), { kind: "Esame", title: "Fisica" });
  assert.deepEqual(linkedItem("attachment", "a1", data), { kind: "Materiale", title: "Dispense.pdf" });
  assert.deepEqual(linkedItem("studySession", "n1", data), { kind: "Sessione di studio", title: "Ripasso serale" });
  assert.deepEqual(linkedItem("studyTopic", "p1", data), { kind: "Argomento", title: "Cinematica" });
  assert.deepEqual(linkedItem("goal", "g1", data), { kind: "Obiettivo", title: "Finire il programma" });
  assert.equal(linkedItem("task", "gone", data), null);
  assert.equal(linkedItem("toString", "t1", data), null);
  assert.equal(linkedItem(undefined, undefined, data), null);
});
