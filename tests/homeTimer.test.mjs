import test from "node:test";
import assert from "node:assert/strict";

const { homeTimerSummary } = await import("../src/lib/homeTimer.ts");
const { defaultTimer, startTimerState, startStopwatchState, startCountdownState, toggleTimerState, endTimerState } = await import("../src/lib/studyTimer.ts");

// Date locali del dispositivo: i test valgono in ogni fuso (Roma, New York, UTC, Tokyo).
const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const iso = (...parts) => local(...parts).toISOString();

/* ------------------------------------------------------------------ */
/* Home: timer in corso                                                */
/* ------------------------------------------------------------------ */

const subjects = [
  { id: "chim", name: "Chimica" },
  { id: "bio", name: "Biologia" }
];

test("homeTimerSummary: timer mai avviato = niente scheda", () => {
  assert.equal(homeTimerSummary(defaultTimer("pomodoro", { subjectId: "chim" }), subjects, Date.now()), null);
});

test("homeTimerSummary: Pomodoro in corso con materia e tempo che manca", () => {
  const start = local(2026, 11, 12, 10).getTime();
  const timer = startTimerState("pomodoro", start, { subjectId: "chim", durations: { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, timerMinutes: 60 } });
  const now = start + (6 * 60 + 18) * 1000;
  const summary = homeTimerSummary(timer, subjects, now);
  assert.equal(summary.state, "running");
  assert.equal(summary.text, "Pomodoro · Chimica · 18:42");
  // Il tempo sta a parte: con un nome lungo si accorcia la materia, non l'orologio.
  assert.equal(summary.lead, "Pomodoro · Chimica");
  assert.equal(summary.tail, "18:42");
  assert.equal(summary.icon, "Timer");
});

test("homeTimerSummary: cronometro conta in avanti, materia sconosciuta omessa", () => {
  const start = local(2026, 11, 12, 10).getTime();
  const timer = startStopwatchState(start, { subjectId: "sparita" });
  const summary = homeTimerSummary(timer, subjects, start + 65_000);
  assert.equal(summary.text, "Cronometro · 01:05");
  assert.equal(summary.state, "running");
});

test("homeTimerSummary: in pausa e finito da salvare lo dicono", () => {
  const start = local(2026, 11, 12, 10).getTime();
  const running = startCountdownState(start, { subjectId: "bio", minutes: 30 });
  const paused = toggleTimerState(running, start + 120_000);
  const summary = homeTimerSummary(paused, subjects, start + 600_000);
  assert.equal(summary.state, "paused");
  assert.equal(summary.text, "Timer · Biologia · 28:00 · In pausa");
  assert.equal(summary.tail, "28:00 · In pausa");
  const ended = endTimerState(running, start + 300_000);
  const done = homeTimerSummary(ended, subjects, start + 900_000);
  assert.equal(done.state, "ended");
  assert.match(done.text, /^Timer · Biologia · .* · Da salvare$/);
});

test("homeTimerSummary: durante la pausa del Pomodoro mostra la pausa", () => {
  const start = local(2026, 11, 12, 10).getTime();
  const timer = { ...startTimerState("pomodoro", start, { subjectId: "chim" }), phase: "short", durationSeconds: 300, endsAt: start + 300_000 };
  const summary = homeTimerSummary(timer, subjects, start + 60_000);
  assert.equal(summary.text, "Pausa breve · Chimica · 04:00");
  assert.equal(summary.icon, "Coffee");
});
