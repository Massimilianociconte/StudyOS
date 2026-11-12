import test from "node:test";
import assert from "node:assert/strict";
import { urgentTasks } from "../src/lib/selectors.ts";
import { sortByPriority } from "../src/lib/taskFilters.ts";

// Mezzogiorno locale: "ieri" e "tra 3 giorni" non dipendono dal fuso del computer che fa girare i test.
const NOW = new Date(2026, 10, 12, 12, 0, 0);
const day = (offset) => new Date(2026, 10, 12 + offset, 18, 0, 0).toISOString();
const task = (id, dueOffset, priority = "medium", patch = {}) => ({
  id,
  title: id,
  status: "todo",
  priority,
  importance: 3,
  dueDate: dueOffset === undefined ? undefined : day(dueOffset),
  createdAt: "2026-11-01T10:00:00.000Z",
  subtasks: [],
  tags: [],
  ...patch
});
const ids = (list) => list.map((item) => item.id);

const LIST = [
  task("nodue", undefined),
  task("due+15", 15),
  task("overdue-15", -15),
  task("overdue-3", -3),
  task("due+3", 3),
  task("low-overdue-30", -30, "low"),
  task("high-nodue", undefined, "high")
];

test("più urgenti: una scadenza passata conta più di una vicina, e più è passata più conta", () => {
  const ranked = ids(urgentTasks(LIST, 10, NOW));
  assert.deepEqual(ranked.slice(0, 3), ["overdue-15", "low-overdue-30", "overdue-3"]);
  assert.ok(ranked.indexOf("overdue-15") < ranked.indexOf("overdue-3"), "15 giorni di ritardo prima di 3");
  assert.ok(ranked.indexOf("overdue-3") < ranked.indexOf("due+3"), "in ritardo prima di una che scade tra 3 giorni");
  assert.ok(ranked.indexOf("overdue-15") < ranked.indexOf("nodue"), "in ritardo mai dopo una senza scadenza");
});

test("più urgenti: in ritardo di un giorno conta più di una che scade oggi", () => {
  const ranked = ids(urgentTasks([task("today", 0), task("yesterday", -1)], 2, NOW));
  assert.deepEqual(ranked, ["yesterday", "today"]);
});

test("più urgenti: il ritardo ha un tetto, la priorità urgente resta in cima", () => {
  const ranked = ids(urgentTasks([task("ancient", -400), task("urgent-today", 0, "urgent")], 2, NOW));
  assert.deepEqual(ranked, ["urgent-today", "ancient"]);
});

test("più urgenti: le completate e le archiviate non ci sono, e conta il limite", () => {
  const list = [...LIST, task("done-late", -20, "urgent", { status: "done" }), task("archived-late", -20, "urgent", { status: "archived" })];
  const ranked = ids(urgentTasks(list, 3, NOW));
  assert.equal(ranked.length, 3);
  assert.ok(!ranked.includes("done-late") && !ranked.includes("archived-late"));
});

test("più urgenti: bloccate e rimandate vanno dopo tutte le altre, ma restano se non c'è altro", () => {
  const list = [
    task("blocked-urgent-late", -10, "urgent", { status: "blocked", importance: 5 }),
    task("postponed-high-today", 0, "high", { status: "postponed" }),
    task("low-nodue", undefined, "low", { importance: 1 }),
    task("doing-medium", 3, "medium", { status: "doing" })
  ];
  assert.deepEqual(ids(urgentTasks(list, 4, NOW)), ["doing-medium", "low-nodue", "blocked-urgent-late", "postponed-high-today"]);
  assert.deepEqual(ids(urgentTasks(list, 1, NOW)), ["doing-medium"], "in cima a «Cosa fare adesso» una che si può fare");
  const onHold = list.filter((item) => item.status === "blocked" || item.status === "postponed");
  assert.deepEqual(ids(urgentTasks(onHold, 4, NOW)), ["blocked-urgent-late", "postponed-high-today"], "tra loro conta il solito punteggio");
});

test("ordina per priorità: prima la priorità, e dentro la stessa priorità le in ritardo in alto", () => {
  const sorted = ids(sortByPriority(LIST));
  assert.deepEqual(sorted, ["high-nodue", "overdue-15", "overdue-3", "due+3", "due+15", "nodue", "low-overdue-30"]);
});

test("ordina per priorità: a parità di priorità e scadenza conta l'importanza, poi l'ordine di partenza", () => {
  const list = [task("a", 2, "high", { importance: 2 }), task("b", 2, "high", { importance: 5 }), task("c", 2, "high", { importance: 2 })];
  assert.deepEqual(ids(sortByPriority(list)), ["b", "a", "c"]);
});
