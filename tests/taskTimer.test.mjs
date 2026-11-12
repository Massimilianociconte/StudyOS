import test from "node:test";
import assert from "node:assert/strict";
import {
  editedMinutesPatch,
  isTaskTimerRunning,
  normalizeTaskPatch,
  taskElapsedSeconds,
  taskMinutesFieldValue
} from "../src/lib/taskTimer.ts";

const T0 = new Date("2026-11-12T09:00:00Z");
const at = (minutes) => new Date(T0.getTime() + minutes * 60_000);

const task = (patch = {}) => ({
  id: "t",
  title: "Esercizi",
  description: "",
  status: "doing",
  priority: "medium",
  subtasks: [],
  tags: [],
  notes: "",
  estimatedMinutes: 45,
  energy: "medium",
  difficulty: 2,
  importance: 3,
  ...patch
});

// «Inizio ora» dall'aggiunta rapida: in corso, 0 minuti, timer partito alle 9.
const started = task({ actualMinutes: 0, timerAccumulatedSeconds: 0, timerStartedAt: T0.toISOString(), timerLastReminderAt: T0.toISOString() });
// Ripresa dopo una pausa a 10 minuti, ripartita alle 9:10.
const resumed = task({ actualMinutes: 10, timerAccumulatedSeconds: 600, timerStartedAt: at(10).toISOString(), timerLastReminderAt: at(10).toISOString() });

const save = (current, patch, now) => ({ ...current, ...normalizeTaskPatch(current, patch, now) });

test("timer attività: salvare senza toccare i minuti (vecchio editor che li rimanda) non azzera il timer", () => {
  assert.equal(taskElapsedSeconds(started, at(40)), 2400);
  const after = save(started, { title: "Esercizi 1-10", status: "doing", actualMinutes: 0 }, at(40));
  assert.equal(taskElapsedSeconds(after, at(40)), 2400);
  assert.equal(after.timerStartedAt, started.timerStartedAt, "il timer non riparte");
  assert.equal(after.timerLastReminderAt, started.timerLastReminderAt);
  assert.equal(isTaskTimerRunning(after), true);
});

test("timer attività: un'attività ripresa dopo una pausa tiene i minuti di prima e quelli di adesso", () => {
  assert.equal(taskElapsedSeconds(resumed, at(40)), 2400);
  const after = save(resumed, { title: "y", status: "doing", actualMinutes: 10 }, at(40));
  assert.equal(taskElapsedSeconds(after, at(40)), 2400);
  assert.equal(taskElapsedSeconds(after, at(41)), 2460, "continua a contare");
});

test("timer attività: senza minuti nella modifica il timer che corre resta com'è", () => {
  const after = save(started, { title: "Altro titolo", status: "doing" }, at(40));
  assert.equal(after.timerStartedAt, started.timerStartedAt);
  assert.equal(taskElapsedSeconds(after, at(40)), 2400);
});

test("editor: il campo «Tempo impiegato» parte dai minuti misurati finora quando il timer corre", () => {
  assert.equal(taskMinutesFieldValue(started, at(40)), "40");
  assert.equal(taskMinutesFieldValue(resumed, at(40)), "40");
  assert.equal(taskMinutesFieldValue(task({ status: "todo", actualMinutes: 25 }), at(40)), "25");
  assert.equal(taskMinutesFieldValue(task({ status: "todo" }), at(40)), "");
});

test("editor: i minuti si mandano solo se il campo è cambiato", () => {
  assert.deepEqual(editedMinutesPatch("40", "40"), {});
  assert.deepEqual(editedMinutesPatch("40", " 40 "), {});
  assert.deepEqual(editedMinutesPatch("", ""), {});
  assert.deepEqual(editedMinutesPatch("40", "25"), { actualMinutes: 25, timerAccumulatedSeconds: 1500 });
  assert.deepEqual(editedMinutesPatch("", "50"), { actualMinutes: 50, timerAccumulatedSeconds: 3000 });
  assert.deepEqual(editedMinutesPatch("40", ""), { actualMinutes: undefined });
});

test("editor: minuti corretti a mano con il timer che corre: il timer continua da quei minuti", () => {
  const after = save(started, { status: "doing", ...editedMinutesPatch("40", "25") }, at(40));
  assert.equal(isTaskTimerRunning(after), true);
  assert.equal(taskElapsedSeconds(after, at(40)), 1500);
  assert.equal(taskElapsedSeconds(after, at(42)), 1620);
  assert.equal(after.actualMinutes, 25);
});

test("editor: riportare a 0 un timer partito per sbaglio funziona anche se 0 è il valore salvato", () => {
  const after = save(started, { status: "doing", ...editedMinutesPatch("40", "0") }, at(40));
  assert.equal(isTaskTimerRunning(after), true);
  assert.equal(taskElapsedSeconds(after, at(40)), 0);
  assert.equal(taskElapsedSeconds(after, at(41)), 60);
});

test("editor: segnare come fatta senza toccare i minuti registra il tempo misurato", () => {
  const after = save(started, { status: "done", ...editedMinutesPatch("40", "40") }, at(40));
  assert.equal(isTaskTimerRunning(after), false);
  assert.equal(after.actualMinutes, 40);
  assert.equal(taskElapsedSeconds(after, at(50)), 2400);
});

test("timer attività: il vecchio editor che rimanda 0 mentre la segni fatta non cancella il tempo", () => {
  const after = save(started, { status: "done", actualMinutes: 0 }, at(40));
  assert.equal(after.actualMinutes, 40);
});

test("editor: minuti corretti mentre la segni fatta: vale il numero scritto", () => {
  const after = save(started, { status: "done", ...editedMinutesPatch("40", "30") }, at(40));
  assert.equal(after.actualMinutes, 30);
  assert.equal(taskElapsedSeconds(after, at(50)), 1800);
});

test("editor: mettere «In corso» un'attività ferma fa partire il timer dai minuti già fatti", () => {
  const paused = task({ status: "todo", actualMinutes: 30, timerAccumulatedSeconds: 1830 });
  const after = save(paused, { status: "doing" }, at(0));
  assert.equal(isTaskTimerRunning(after), true);
  assert.equal(taskElapsedSeconds(after, at(1)), 1890);
  const edited = save(paused, { status: "doing", ...editedMinutesPatch("30", "50") }, at(0));
  assert.equal(taskElapsedSeconds(edited, at(1)), 3060);
});
