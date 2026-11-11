import test from "node:test";
import assert from "node:assert/strict";
import {
  TASK_FILTERS,
  filterTasks,
  isOverdueTask,
  isTaskFilter,
  isUrgentTask,
  subjectFilterTarget,
  taskSummary
} from "../src/lib/taskFilters.ts";

// Mezzogiorno locale: "ieri" e "domani" non dipendono dal fuso del computer che fa girare i test.
const NOW = new Date(2026, 10, 11, 12, 0, 0);
const day = (offset, hour = 18) => new Date(2026, 10, 11 + offset, hour, 0, 0).toISOString();

const task = (id, patch = {}) => ({
  id,
  title: id,
  status: "todo",
  priority: "medium",
  estimatedMinutes: 0,
  subtasks: [],
  ...patch
});

const TASKS = [
  task("late", { dueDate: day(-2), priority: "high", estimatedMinutes: 30, subjectId: "s1" }),
  task("late-urgent", { dueDate: day(-1), priority: "urgent", estimatedMinutes: 60, subjectId: "s2" }),
  task("today", { dueDate: day(0, 9), estimatedMinutes: 15, subjectId: "s1" }),
  task("urgent", { priority: "urgent", subjectId: "s1" }),
  task("done-late", { dueDate: day(-3), status: "done", priority: "urgent", estimatedMinutes: 90, subjectId: "s1" }),
  task("nodate")
];

test("filtro attività: solo i valori del contratto sono validi", () => {
  assert.deepEqual([...TASK_FILTERS], ["all", "overdue", "urgent"]);
  for (const value of TASK_FILTERS) assert.equal(isTaskFilter(value), true, value);
  for (const value of [null, undefined, "", "late", "Urgent", 1]) assert.equal(isTaskFilter(value), false, String(value));
});

test("filtro attività: in ritardo = da fare con scadenza prima di oggi; oggi non è in ritardo, le completate mai", () => {
  assert.equal(isOverdueTask(TASKS[0], NOW), true);
  assert.equal(isOverdueTask(TASKS[1], NOW), true);
  assert.equal(isOverdueTask(TASKS[2], NOW), false, "scade oggi alle 9: non ancora in ritardo");
  assert.equal(isOverdueTask(TASKS[4], NOW), false, "completata");
  assert.equal(isOverdueTask(TASKS[5], NOW), false, "senza scadenza");
});

test("filtro attività: urgenti = da fare con priorità urgente (come nel riepilogo)", () => {
  assert.equal(isUrgentTask(TASKS[1]), true);
  assert.equal(isUrgentTask(TASKS[3]), true);
  assert.equal(isUrgentTask(TASKS[0]), false, "alta non è urgente");
  assert.equal(isUrgentTask(TASKS[4]), false, "completata");
});

test("riepilogo: conta solo le attività da fare e somma il tempo previsto", () => {
  assert.deepEqual(taskSummary(TASKS, NOW), { open: 5, overdue: 2, urgent: 2, minutes: 105 });
  assert.deepEqual(taskSummary([], NOW), { open: 0, overdue: 0, urgent: 0, minutes: 0 });
});

test("filtro attività: ogni filtro tiene ciò che il suo numero conta nel riepilogo", () => {
  const ids = (list) => list.map((item) => item.id);
  assert.deepEqual(ids(filterTasks(TASKS, "all", null, NOW)), ids(TASKS));
  assert.deepEqual(ids(filterTasks(TASKS, "overdue", null, NOW)), ["late", "late-urgent"]);
  assert.deepEqual(ids(filterTasks(TASKS, "urgent", null, NOW)), ["late-urgent", "urgent"]);
  const summary = taskSummary(TASKS, NOW);
  assert.equal(filterTasks(TASKS, "overdue", null, NOW).length, summary.overdue);
  assert.equal(filterTasks(TASKS, "urgent", null, NOW).length, summary.urgent);
});

test("filtro attività: la materia si somma al filtro", () => {
  const ids = (list) => list.map((item) => item.id);
  assert.deepEqual(ids(filterTasks(TASKS, "all", "s1", NOW)), ["late", "today", "urgent", "done-late"]);
  assert.deepEqual(ids(filterTasks(TASKS, "overdue", "s1", NOW)), ["late"]);
  assert.deepEqual(ids(filterTasks(TASKS, "urgent", "s2", NOW)), ["late-urgent"]);
});

test("filtro per materia: un id sconosciuto (materia eliminata) non filtra", () => {
  const subjects = [{ id: "s1", name: "Analisi 1" }];
  assert.equal(subjectFilterTarget(subjects, "s1")?.name, "Analisi 1");
  assert.equal(subjectFilterTarget(subjects, "gone"), null);
  assert.equal(subjectFilterTarget(subjects, null), null);
});
