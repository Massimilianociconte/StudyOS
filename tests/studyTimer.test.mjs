import test from "node:test";
import assert from "node:assert/strict";
import { startTimerState, timerRemainingSeconds, toggleTimerState, settleTimerState, timerElapsedSeconds } from "../src/lib/studyTimer.ts";

test("timer basato su timestamp: continua anche senza tick", () => {
  const t0 = 1_000_000;
  const timer = startTimerState("pomodoro", t0);
  assert.equal(timerRemainingSeconds(timer, t0), 25 * 60);
  assert.equal(timerRemainingSeconds(timer, t0 + 10 * 60_000), 15 * 60);
  assert.equal(timerElapsedSeconds(timer, t0 + 10 * 60_000), 10 * 60);
});

test("pausa e ripresa conservano il residuo", () => {
  const t0 = 0;
  const paused = toggleTimerState(startTimerState("classic", t0), 5 * 60_000);
  assert.equal(paused.running, false);
  assert.equal(timerRemainingSeconds(paused, 99 * 60_000), 40 * 60);
  const resumed = toggleTimerState(paused, 100 * 60_000);
  assert.equal(timerRemainingSeconds(resumed, 110 * 60_000), 30 * 60);
});

test("allo scadere il timer si ferma a zero", () => {
  const timer = startTimerState("pomodoro", 0);
  const settled = settleTimerState(timer, 26 * 60_000);
  assert.equal(settled.running, false);
  assert.equal(settled.remainingSeconds, 0);
  assert.equal(settleTimerState(settled, 30 * 60_000), settled);
});
