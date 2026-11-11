import test from "node:test";
import assert from "node:assert/strict";
import {
  TIMER_STORAGE_KEY,
  advanceTimerState,
  defaultTimer,
  finishedSession,
  formatTimerClock,
  isTimerIdle,
  isTimerState,
  loadTimer,
  nextPhase,
  normalizeTimer,
  saveTimer,
  sessionFromBlock,
  settleTimerState,
  skipBreakState,
  startStopwatchState,
  startTimerState,
  syncTimerDurations,
  timerElapsedSeconds,
  timerRemainingSeconds,
  timerUnsavedSeconds,
  toggleTimerState
} from "../src/lib/studyTimer.ts";
import { DEFAULT_TIMER_DURATIONS, cleanTimerSettings, parseTimerInput, resolveTimerDurations } from "../src/lib/timerPrefs.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const MIN = 60_000;
const DEFAULTS = resolveTimerDurations();

/** localStorage finto: Node non ne ha uno. */
const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
};

// ---------- compatibilità con il timer di prima ----------

test("timer basato su timestamp: continua anche senza tick", () => {
  const t0 = 1_000_000;
  const timer = startTimerState("pomodoro", t0);
  assert.equal(timerRemainingSeconds(timer, t0), 25 * 60);
  assert.equal(timerRemainingSeconds(timer, t0 + 10 * MIN), 15 * 60);
  assert.equal(timerElapsedSeconds(timer, t0 + 10 * MIN), 10 * 60);
});

test("pausa e ripresa conservano il residuo", () => {
  const t0 = 0;
  const paused = toggleTimerState(startTimerState("classic", t0), 5 * MIN);
  assert.equal(paused.running, false);
  assert.equal(timerRemainingSeconds(paused, 99 * MIN), 40 * 60);
  const resumed = toggleTimerState(paused, 100 * MIN);
  assert.equal(timerRemainingSeconds(resumed, 110 * MIN), 30 * 60);
});

test("settleTimerState: allo scadere il blocco Pomodoro passa alla pausa (idempotente)", () => {
  const timer = startTimerState("pomodoro", 0);
  const settled = settleTimerState(timer, 26 * MIN);
  assert.equal(settled.phase, "short");
  assert.equal(settled.running, true);
  assert.equal(settleTimerState(settled, 26 * MIN), settled);
});

// ---------- caricamento e salvataggio ----------

test("loadTimer: storage assente, vuoto o rotto → timer predefinito", () => {
  assert.deepEqual(loadTimer(null), defaultTimer());
  assert.deepEqual(loadTimer(memoryStorage()), defaultTimer());
  assert.deepEqual(loadTimer(memoryStorage({ [TIMER_STORAGE_KEY]: "{non json" })), defaultTimer());
  assert.deepEqual(loadTimer(memoryStorage({ [TIMER_STORAGE_KEY]: "42" })), defaultTimer());
  const throwing = { getItem: () => { throw new Error("bloccato"); } };
  assert.deepEqual(loadTimer(throwing), defaultTimer());
});

test("loadTimer: lo stato salvato dalla versione precedente si carica ancora", () => {
  const old = { mode: "classic", running: false, remainingSeconds: 600, durationSeconds: 2700, label: "Classico" };
  const timer = loadTimer(memoryStorage({ [TIMER_STORAGE_KEY]: JSON.stringify(old) }));
  assert.equal(timer.kind, "pomodoro");
  assert.equal(timer.phase, "focus");
  assert.equal(timer.mode, "classic");
  assert.equal(timerRemainingSeconds(timer, 0), 600);
  assert.equal(timerElapsedSeconds(timer, 0), 2100);
  assert.equal(timer.cycle, 0);
  assert.equal(isTimerIdle(timer, 0), false, "con minuti già fatti non è un timer nuovo");
});

test("isTimerState rifiuta stati corrotti; normalizeTimer li riporta al predefinito", () => {
  const base = { mode: "pomodoro", running: false, remainingSeconds: 60, durationSeconds: 1500 };
  assert.equal(isTimerState(base), true);
  for (const bad of [
    null,
    "x",
    { ...base, mode: "turbo" },
    { ...base, running: "si" },
    { ...base, remainingSeconds: Number.NaN },
    { ...base, remainingSeconds: -5 },
    { ...base, durationSeconds: 0 },
    { ...base, durationSeconds: 99 * 60 * 60 },
    { ...base, running: true },
    { ...base, running: true, endsAt: "domani" },
    { ...base, kind: "orologio" },
    { ...base, phase: "sonno" },
    { ...base, kind: "stopwatch", running: true },
    { ...base, kind: "stopwatch", accumulatedSeconds: -1 }
  ]) {
    assert.equal(isTimerState(bad), false, JSON.stringify(bad));
    assert.deepEqual(normalizeTimer(bad), defaultTimer());
  }
});

test("normalizeTimer: campi facoltativi non validi vengono scartati, il resto resta", () => {
  const timer = normalizeTimer({
    mode: "pomodoro",
    running: false,
    remainingSeconds: 3000,
    durationSeconds: 1500,
    cycle: -3,
    subjectId: 7,
    title: "Capitolo 4",
    template: "inventato",
    startedAt: "ieri"
  });
  assert.equal(timer.remainingSeconds, 1500, "il residuo non supera la durata");
  assert.equal(timer.cycle, 0);
  assert.equal(timer.subjectId, undefined);
  assert.equal(timer.title, "Capitolo 4");
  assert.equal(timer.template, undefined);
  assert.equal(timer.startedAt, undefined);
});

test("saveTimer/loadTimer: andata e ritorno, anche per il cronometro in corsa", () => {
  const storage = memoryStorage();
  const timer = { ...startStopwatchState(5 * MIN, { subjectId: "s1", sessionId: "session_x" }), changedAt: 5 * MIN };
  saveTimer(timer, storage);
  assert.deepEqual(loadTimer(storage), timer);
  // Il blocco scaduto mentre l'app era chiusa NON si chiude al caricamento: lo fa lo store,
  // quando i dati sono pronti (così il blocco si salva come sessione).
  const expired = startTimerState("pomodoro", 0);
  saveTimer(expired, storage);
  const loaded = loadTimer(storage);
  assert.equal(loaded.running, true);
  assert.equal(timerRemainingSeconds(loaded, 60 * MIN), 0);
});

// ---------- cronometro ----------

test("cronometro: conta in avanti, le pause non contano, nessun limite di durata", () => {
  const t0 = 1_000_000;
  let timer = startStopwatchState(t0, { subjectId: "s1" });
  assert.equal(timer.kind, "stopwatch");
  assert.equal(timerElapsedSeconds(timer, t0 + 10 * MIN), 600);
  timer = toggleTimerState(timer, t0 + 10 * MIN); // pausa
  assert.equal(timer.running, false);
  assert.equal(timerElapsedSeconds(timer, t0 + 70 * MIN), 600);
  timer = toggleTimerState(timer, t0 + 70 * MIN); // riprende dopo un'ora
  assert.equal(timerElapsedSeconds(timer, t0 + 75 * MIN), 900);
  // Tre ore di fila: niente tetto (il vecchio timer si fermava alla durata scelta).
  assert.equal(timerElapsedSeconds(timer, t0 + 255 * MIN), 195 * 60);
});

test("cronometro: pause e riprese ripetute non accumulano errori di arrotondamento", () => {
  let timer = startStopwatchState(0);
  let now = 0;
  for (let index = 0; index < 100; index += 1) {
    now += 1_500; // 1,5 s di studio
    timer = toggleTimerState(timer, now);
    now += 10_000; // 10 s di pausa
    timer = toggleTimerState(timer, now);
  }
  assert.equal(timerElapsedSeconds(timer, now), 150);
});

test("cronometro: un lungo sonno del computer conta come tempo trascorso (timestamp), senza tick", () => {
  const timer = startStopwatchState(0);
  assert.equal(timerElapsedSeconds(timer, 8 * 60 * MIN), 8 * 60 * 60);
  // Orologio tornato indietro: mai tempo negativo.
  assert.equal(timerElapsedSeconds(timer, -5 * MIN), 0);
});

test("cronometro: l'obiettivo è solo un riferimento, il residuo arriva a zero senza fermarlo", () => {
  const timer = startStopwatchState(0, { targetMinutes: 30 });
  assert.equal(timer.durationSeconds, 30 * 60);
  assert.equal(timerRemainingSeconds(timer, 10 * MIN), 20 * 60);
  const later = settleTimerState(timer, 45 * MIN);
  assert.equal(later, timer, "il cronometro non scade");
  assert.equal(timerRemainingSeconds(timer, 45 * MIN), 0);
  assert.equal(timerElapsedSeconds(timer, 45 * MIN), 45 * 60);
});

// ---------- Pomodoro: fasi ----------

test("nextPhase: 3 pause brevi, poi la lunga, poi si ricomincia", () => {
  assert.deepEqual(nextPhase("focus", 0, 4), { phase: "short", cycle: 1 });
  assert.deepEqual(nextPhase("short", 1, 4), { phase: "focus", cycle: 1 });
  assert.deepEqual(nextPhase("focus", 2, 4), { phase: "short", cycle: 3 });
  assert.deepEqual(nextPhase("focus", 3, 4), { phase: "long", cycle: 4 });
  assert.deepEqual(nextPhase("long", 4, 4), { phase: "focus", cycle: 0 });
  assert.deepEqual(nextPhase("focus", 0, 1), { phase: "long", cycle: 1 });
});

test("advance: a fine blocco salva il blocco con inizio/fine reali e parte la pausa breve", () => {
  const t0 = new Date(2026, 10, 11, 9, 0).getTime();
  let timer = startTimerState("pomodoro", t0, { subjectId: "s1", sessionId: "session_a", title: "Cap. 4", template: "exercises" });
  timer = toggleTimerState(timer, t0 + 10 * MIN); // pausa di 5 minuti a metà
  timer = toggleTimerState(timer, t0 + 15 * MIN);
  const nothing = advanceTimerState(timer, t0 + 20 * MIN, DEFAULTS);
  assert.equal(nothing.timer, timer, "prima della fine non cambia nulla (stesso oggetto)");
  assert.equal(nothing.finishedBlock, undefined);

  const end = t0 + 30 * MIN;
  const result = advanceTimerState(timer, end + 2_000, DEFAULTS);
  assert.deepEqual(result.finishedBlock, {
    sessionId: "session_a",
    start: t0,
    end,
    actualMinutes: 25,
    plannedMinutes: 25,
    subjectId: "s1",
    title: "Cap. 4",
    template: "exercises",
    source: "pomodoro"
  });
  assert.equal(result.timer.phase, "short");
  assert.equal(result.timer.running, true);
  assert.equal(result.timer.cycle, 1);
  assert.equal(result.timer.endsAt, end + 5 * MIN, "la pausa parte da quando il blocco è finito, non da adesso");
  assert.equal(result.timer.sessionId, undefined);
  assert.equal(result.timer.subjectId, "s1", "la materia resta per il blocco successivo");
  assert.equal(timerUnsavedSeconds(result.timer, end + 3 * MIN), 0, "la pausa non è studio");
  // Di nuovo: niente secondo salvataggio.
  const again = advanceTimerState(result.timer, end + 2_000, DEFAULTS);
  assert.equal(again.timer, result.timer);
  assert.equal(again.finishedBlock, undefined);
});

test("advance: se l'app era chiusa anche durante la pausa, il blocco si salva e il timer aspetta il prossimo", () => {
  const timer = startTimerState("pomodoro", 0, { sessionId: "session_b" });
  const result = advanceTimerState(timer, 3 * 60 * MIN, DEFAULTS);
  assert.equal(result.finishedBlock.sessionId, "session_b");
  assert.equal(result.finishedBlock.end, 25 * MIN);
  assert.equal(result.breakEnded, true);
  assert.equal(result.timer.phase, "focus");
  assert.equal(result.timer.running, false);
  assert.equal(result.timer.cycle, 1);
  assert.equal(timerRemainingSeconds(result.timer, 3 * 60 * MIN), 25 * 60);
  assert.equal(isTimerIdle(result.timer, 3 * 60 * MIN), true);
});

test("advance: quarto blocco → pausa lunga; dopo la pausa lunga il conto riparte; durate personali", () => {
  const durations = resolveTimerDurations({ focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20, longBreakEvery: 2 });
  let timer = startTimerState("pomodoro", 0, { durations });
  assert.equal(timer.durationSeconds, 50 * 60);
  let step = advanceTimerState(timer, 50 * MIN, durations);
  assert.equal(step.timer.phase, "short");
  assert.equal(step.timer.durationSeconds, 10 * 60);
  step = advanceTimerState(step.timer, 60 * MIN, durations);
  assert.equal(step.breakEnded, true);
  assert.equal(step.finishedBlock, undefined, "la pausa non diventa una sessione");
  timer = toggleTimerState(step.timer, 61 * MIN);
  step = advanceTimerState(timer, 111 * MIN, durations);
  assert.equal(step.timer.phase, "long");
  assert.equal(step.timer.cycle, 2);
  assert.equal(step.timer.durationSeconds, 20 * 60);
  step = advanceTimerState(step.timer, 131 * MIN, durations);
  assert.equal(step.timer.phase, "focus");
  assert.equal(step.timer.cycle, 0);
});

test("skipBreak: la pausa si salta e il blocco successivo parte subito", () => {
  const ended = advanceTimerState(startTimerState("pomodoro", 0), 25 * MIN, DEFAULTS).timer;
  const skipped = skipBreakState(ended, 27 * MIN, DEFAULTS, "session_c");
  assert.equal(skipped.phase, "focus");
  assert.equal(skipped.running, true);
  assert.equal(skipped.cycle, 1);
  assert.equal(skipped.startedAt, 27 * MIN);
  assert.equal(skipped.sessionId, "session_c");
  assert.equal(timerRemainingSeconds(skipped, 27 * MIN), 25 * 60);
  const focus = startTimerState("pomodoro", 0);
  assert.equal(skipBreakState(focus, 1 * MIN, DEFAULTS, "x"), focus, "durante lo studio non fa nulla");
});

// ---------- sessione da salvare ----------

test("finishedSession: cronometro con pause → minuti senza pause, inizio e fine reali", () => {
  const t0 = new Date(2026, 10, 11, 10, 0).getTime();
  let timer = startStopwatchState(t0, { subjectId: "s1", sessionId: "session_s" });
  timer = toggleTimerState(timer, t0 + 60 * MIN); // pausa alle 11
  timer = toggleTimerState(timer, t0 + 180 * MIN); // riprende alle 13
  timer = toggleTimerState(timer, t0 + 210 * MIN); // pausa alle 13:30
  const done = finishedSession(timer, t0 + 300 * MIN); // "Termina" alle 15
  assert.equal(done.actualMinutes, 90);
  assert.equal(done.start, t0);
  assert.equal(done.end, t0 + 210 * MIN, "in pausa la fine è l'ultima pausa, non quando si preme Termina");
  assert.equal(done.source, "stopwatch");
  assert.equal(done.sessionId, "session_s");
  assert.equal(done.subjectId, "s1");
});

test("finishedSession: a cavallo della mezzanotte inizio e fine restano veri", () => {
  const start = new Date(2026, 10, 11, 23, 50).getTime();
  const timer = startStopwatchState(start);
  const done = finishedSession(timer, start + 30 * MIN);
  assert.equal(new Date(done.start).getDate(), 11);
  assert.equal(new Date(done.end).getDate(), 12);
  assert.equal(done.actualMinutes, 30);
});

test("finishedSession: arrotondamento e minimo di 1 minuto", () => {
  const timer = startStopwatchState(0);
  assert.equal(finishedSession(timer, 59_000), null);
  assert.equal(finishedSession(timer, 60_000).actualMinutes, 1);
  assert.equal(finishedSession(timer, 89_000).actualMinutes, 1);
  assert.equal(finishedSession(timer, 90_000).actualMinutes, 2);
});

test("finishedSession: Pomodoro interrotto, scaduto, in pausa o senza inizio salvato", () => {
  const t0 = 1_000_000;
  const running = startTimerState("pomodoro", t0, { sessionId: "session_p" });
  const early = finishedSession(running, t0 + 12 * MIN);
  assert.equal(early.actualMinutes, 12);
  assert.equal(early.plannedMinutes, 25);
  assert.equal(early.end, t0 + 12 * MIN);
  const late = finishedSession(running, t0 + 90 * MIN);
  assert.equal(late.actualMinutes, 25);
  assert.equal(late.end, t0 + 25 * MIN, "oltre la fine del blocco vale la fine del blocco");
  const paused = toggleTimerState(running, t0 + 10 * MIN);
  assert.equal(finishedSession(paused, t0 + 50 * MIN).end, t0 + 10 * MIN);
  // Stato della versione precedente: nessun inizio salvato, si ricava dalla fine.
  const legacy = normalizeTimer({ mode: "pomodoro", running: false, remainingSeconds: 900, durationSeconds: 1500 });
  const fromLegacy = finishedSession(legacy, 5 * 60 * MIN);
  assert.equal(fromLegacy.actualMinutes, 10);
  assert.equal(fromLegacy.end - fromLegacy.start, 10 * MIN);
  // Pausa del Pomodoro: niente da salvare.
  const onBreak = advanceTimerState(running, t0 + 26 * MIN, DEFAULTS).timer;
  assert.equal(finishedSession(onBreak, t0 + 27 * MIN), null);
});

test("sessionFromBlock: sessione completata con titolo, materia valida e origine", () => {
  const block = { sessionId: "session_z", start: 0, end: 25 * MIN, actualMinutes: 25, plannedMinutes: 25, subjectId: "s1", template: "review", source: "pomodoro" };
  const subjects = [{ id: "s1", name: "Analisi 1" }];
  const session = sessionFromBlock(block, { subjects, now: "2026-11-11T10:00:00.000Z" });
  assert.equal(session.id, "session_z");
  assert.equal(session.status, "completed");
  assert.equal(session.title, "Ripasso · Analisi 1");
  assert.equal(session.subjectId, "s1");
  assert.equal(session.source, "pomodoro");
  assert.equal(session.start, new Date(0).toISOString());
  assert.equal(session.end, new Date(25 * MIN).toISOString());
  assert.equal(session.actualMinutes, 25);
  assert.equal(session.updatedAt, "2026-11-11T10:00:00.000Z");
  // Materia eliminata nel frattempo: la sessione resta, senza materia.
  const orphan = sessionFromBlock({ ...block, subjectId: "sparita", title: "  Mio titolo " }, { subjects, now: "x", id: "session_y" });
  assert.equal(orphan.subjectId, undefined);
  assert.equal(orphan.title, "Mio titolo");
  assert.equal(orphan.id, "session_z", "l'id del blocco vince: due schede scrivono la stessa sessione");
});

test("timerUnsavedSeconds e isTimerIdle", () => {
  const idle = defaultTimer();
  assert.equal(isTimerIdle(idle, 0), true);
  assert.equal(timerUnsavedSeconds(idle, 0), 0);
  const running = startStopwatchState(0);
  assert.equal(isTimerIdle(running, 0), false);
  assert.equal(timerUnsavedSeconds(running, 2 * MIN), 120);
});

// ---------- durate per materia ----------

test("resolveTimerDurations: materia → preferenze → predefiniti, campo per campo", () => {
  assert.deepEqual(resolveTimerDurations(), { ...DEFAULT_TIMER_DURATIONS, stopwatchTargetMinutes: undefined });
  assert.deepEqual(DEFAULT_TIMER_DURATIONS, { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, timerMinutes: 60 });
  const prefs = { focusMinutes: 45, shortBreakMinutes: 10, stopwatchTargetMinutes: 120 };
  const subject = { focusMinutes: 50 };
  assert.deepEqual(resolveTimerDurations(subject, prefs), {
    focusMinutes: 50,
    shortBreakMinutes: 10,
    longBreakMinutes: 15,
    longBreakEvery: 4,
    stopwatchTargetMinutes: 120,
    timerMinutes: 60
  });
  assert.equal(resolveTimerDurations(undefined, prefs).focusMinutes, 45);
  assert.equal(resolveTimerDurations(null, null).focusMinutes, 25);
});

test("resolveTimerDurations: ogni valore è limitato; valori non numerici passano al livello dopo", () => {
  const wild = resolveTimerDurations(
    { focusMinutes: 0, shortBreakMinutes: 600, longBreakMinutes: -4, longBreakEvery: 40, stopwatchTargetMinutes: 5000 },
    { focusMinutes: 30 }
  );
  assert.deepEqual(wild, { focusMinutes: 1, shortBreakMinutes: 60, longBreakMinutes: 1, longBreakEvery: 12, stopwatchTargetMinutes: 600, timerMinutes: 60 });
  assert.equal(resolveTimerDurations({ focusMinutes: 400 }).focusMinutes, 240);
  assert.equal(resolveTimerDurations({ focusMinutes: 24.6 }).focusMinutes, 25);
  assert.equal(resolveTimerDurations({ focusMinutes: "40" }, { focusMinutes: 30 }).focusMinutes, 30);
  assert.equal(resolveTimerDurations({ focusMinutes: Number.NaN }).focusMinutes, 25);
  assert.equal(resolveTimerDurations({ stopwatchTargetMinutes: 0 }).stopwatchTargetMinutes, 1);
});

test("cleanTimerSettings: tiene solo valori validi (limitati e interi), vuoto → undefined", () => {
  assert.deepEqual(cleanTimerSettings({ focusMinutes: 50.4, shortBreakMinutes: "x", longBreakEvery: 99, extra: 1 }), { focusMinutes: 50, longBreakEvery: 12 });
  assert.equal(cleanTimerSettings({}), undefined);
  assert.equal(cleanTimerSettings(null), undefined);
  assert.equal(cleanTimerSettings({ stopwatchTargetMinutes: undefined }), undefined);
});

test("formatTimerClock: minuti e secondi, ore solo quando servono", () => {
  assert.equal(formatTimerClock(0), "00:00");
  assert.equal(formatTimerClock(25 * 60), "25:00");
  assert.equal(formatTimerClock(59 * 60 + 59), "59:59");
  assert.equal(formatTimerClock(3600), "1:00:00");
  assert.equal(formatTimerClock(3 * 3600 + 5 * 60 + 9), "3:05:09");
  assert.equal(formatTimerClock(-4), "00:00");
});

test("parseTimerInput: vuoto, valido, fuori dai limiti o non intero", () => {
  assert.deepEqual(parseTimerInput("focusMinutes", "  "), { empty: true });
  assert.deepEqual(parseTimerInput("focusMinutes", "50"), { value: 50 });
  assert.deepEqual(parseTimerInput("focusMinutes", "0"), { invalid: true });
  assert.deepEqual(parseTimerInput("shortBreakMinutes", "61"), { invalid: true });
  assert.deepEqual(parseTimerInput("longBreakEvery", "2,5"), { invalid: true });
  assert.deepEqual(parseTimerInput("stopwatchTargetMinutes", "dieci"), { invalid: true });
});

test("syncTimerDurations: il blocco non avviato prende la nuova durata, quello iniziato no", () => {
  const durations = resolveTimerDurations({ focusMinutes: 40, stopwatchTargetMinutes: 90 });
  const idle = defaultTimer();
  const synced = syncTimerDurations(idle, durations, 0);
  assert.equal(synced.durationSeconds, 40 * 60);
  assert.equal(timerRemainingSeconds(synced, 0), 40 * 60);
  assert.equal(syncTimerDurations(synced, durations, 0), synced);
  const running = startTimerState("pomodoro", 0);
  assert.equal(syncTimerDurations(running, durations, MIN), running);
  // Il cronometro prende il nuovo obiettivo anche mentre corre, e l'avviso può ripartire.
  const stopwatch = { ...startStopwatchState(0, { targetMinutes: 30 }), targetNotifiedSeconds: 1800 };
  const retargeted = syncTimerDurations(stopwatch, durations, MIN);
  assert.equal(retargeted.durationSeconds, 90 * 60);
  assert.equal(retargeted.targetNotifiedSeconds, undefined);
  assert.equal(timerElapsedSeconds(retargeted, 10 * MIN), 600);
});

// ---------- store: azioni del timer ----------
// `loading: false` perché il salvataggio dei blocchi aspetta i dati caricati; in Node IndexedDB
// non c'è e la scrittura fallisce in silenzio (resta in persistError), come nei test degli agenti.

const store = useStudyStore;
const OLD = "2026-11-01T10:00:00.000Z";

const seedStore = (extra = {}) =>
  store.setState({
    loading: false,
    locked: false,
    subjects: [
      { id: "s1", name: "Analisi 1", status: "active", archived: false, timer: { focusMinutes: 50 }, updatedAt: OLD },
      { id: "s2", name: "Fisica", status: "active", archived: false, updatedAt: OLD }
    ],
    sessions: [],
    preferences: [],
    timer: defaultTimer(),
    ...extra
  });

test("store: da fermo il timer parte con le durate della materia scelta", () => {
  seedStore();
  store.getState().setTimerSubject("s1");
  assert.equal(store.getState().timer.subjectId, "s1");
  assert.equal(store.getState().timer.durationSeconds, 50 * 60, "il blocco pronto mostra già la durata della materia");
  const before = Date.now();
  store.getState().toggleStudyTimer();
  const timer = store.getState().timer;
  assert.equal(timer.running, true);
  assert.equal(timer.kind, "pomodoro");
  assert.ok(timer.sessionId?.startsWith("session_"));
  assert.ok(timer.endsAt >= before + 50 * MIN && timer.endsAt <= Date.now() + 50 * MIN);
  assert.ok(timer.changedAt >= before);
  store.getState().setTimerSubject("non-esiste");
  assert.equal(store.getState().timer.subjectId, undefined, "una materia sconosciuta non entra nel timer");
});

test("store: a fine blocco una sola sessione, anche ripetendo o da una seconda scheda", () => {
  const now = Date.now();
  const durations = resolveTimerDurations({ focusMinutes: 50 });
  const running = { ...startTimerState("pomodoro", now - 51 * MIN, { durations, subjectId: "s1", sessionId: "session_blk", template: "review" }), changedAt: now - 51 * MIN };
  seedStore({ timer: running });
  const event = store.getState().settleStudyTimer();
  assert.equal(event.type, "focus-done");
  assert.equal(event.minutes, 50);
  assert.equal(event.breakPhase, "short");
  assert.equal(event.breakMinutes, 5);
  const [session] = store.getState().sessions;
  assert.equal(store.getState().sessions.length, 1);
  assert.equal(session.id, "session_blk");
  assert.equal(session.status, "completed");
  assert.equal(session.source, "pomodoro");
  assert.equal(session.subjectId, "s1");
  assert.equal(session.actualMinutes, 50);
  assert.equal(session.title, "Ripasso · Analisi 1");
  assert.equal(session.start, new Date(now - 51 * MIN).toISOString());
  assert.equal(session.end, new Date(now - MIN).toISOString());
  assert.equal(store.getState().timer.phase, "short");
  assert.equal(store.getState().settleStudyTimer(), null, "chiamato di nuovo non fa nulla");
  // Un'altra scheda con lo stato vecchio (stesso blocco): nessun doppione.
  store.setState({ timer: running });
  const again = store.getState().settleStudyTimer();
  assert.equal(again.type, "focus-done");
  assert.equal(again.session, null);
  assert.equal(store.getState().sessions.length, 1);
});

test("store: le pause non diventano sessioni", () => {
  const now = Date.now();
  const onBreak = advanceTimerState(startTimerState("pomodoro", now - 40 * MIN, { sessionId: "session_x" }), now - 15 * MIN, DEFAULTS).timer;
  seedStore({ timer: onBreak });
  const event = store.getState().settleStudyTimer();
  assert.deepEqual(event, { type: "break-done" });
  assert.equal(store.getState().sessions.length, 0);
  assert.equal(store.getState().timer.phase, "focus");
  assert.equal(store.getState().timer.running, false);
  assert.equal(store.getState().timer.cycle, 1);
});

test("store: con i dati non ancora caricati il blocco aspetta (niente sessione persa)", () => {
  const running = startTimerState("pomodoro", Date.now() - 30 * MIN, { sessionId: "session_wait" });
  seedStore({ timer: running, loading: true });
  assert.equal(store.getState().settleStudyTimer(), null);
  assert.equal(store.getState().timer, running);
  store.setState({ loading: false });
  assert.equal(store.getState().settleStudyTimer().type, "focus-done");
  assert.equal(store.getState().sessions[0].id, "session_wait");
});

test("store: Termina e salva del cronometro salva e azzera in un colpo", () => {
  const now = Date.now();
  seedStore({ timer: startStopwatchState(now - 20 * MIN, { subjectId: "s2", sessionId: "session_sw", title: "Esercizi cap. 2" }) });
  const result = store.getState().finishStudyTimer();
  assert.equal(result.status, "saved");
  assert.equal(result.session.id, "session_sw");
  assert.equal(result.session.source, "stopwatch");
  assert.equal(result.session.actualMinutes, 20);
  assert.equal(result.session.title, "Esercizi cap. 2");
  assert.equal(store.getState().sessions.length, 1);
  const timer = store.getState().timer;
  assert.equal(timer.kind, "stopwatch");
  assert.equal(isTimerIdle(timer), true);
  assert.equal(timer.subjectId, "s2", "la materia resta per la prossima sessione");
  assert.equal(store.getState().finishStudyTimer().status, "idle");
});

test("store: sotto il minuto Termina non salva e non ferma il timer", () => {
  const running = startStopwatchState(Date.now() - 30_000);
  seedStore({ timer: running });
  assert.equal(store.getState().finishStudyTimer().status, "too-short");
  assert.equal(store.getState().timer, running);
  assert.equal(store.getState().sessions.length, 0);
});

test("store: Termina durante la pausa chiude il Pomodoro senza salvare la pausa", () => {
  const now = Date.now();
  const onBreak = advanceTimerState(startTimerState("pomodoro", now - 27 * MIN), now - 2 * MIN, DEFAULTS).timer;
  seedStore({ timer: onBreak });
  assert.equal(store.getState().finishStudyTimer().status, "ended");
  assert.equal(store.getState().sessions.length, 0);
  const timer = store.getState().timer;
  assert.equal(timer.phase, "focus");
  assert.equal(timer.cycle, 0);
  assert.equal(isTimerIdle(timer), true);
});

test("store: salta la pausa e il blocco riparte subito", () => {
  const now = Date.now();
  const onBreak = advanceTimerState(startTimerState("pomodoro", now - 27 * MIN), now - 2 * MIN, DEFAULTS).timer;
  seedStore({ timer: onBreak });
  store.getState().skipBreak();
  const timer = store.getState().timer;
  assert.equal(timer.phase, "focus");
  assert.equal(timer.running, true);
  assert.equal(timer.cycle, 1);
  assert.ok(timer.sessionId);
});

test("store: Scarta e Annulla riportano il timer com'era", () => {
  const running = startStopwatchState(Date.now() - 5 * MIN, { sessionId: "session_undo" });
  seedStore({ timer: running });
  const previous = store.getState().timer;
  store.getState().resetStudyTimer();
  assert.equal(isTimerIdle(store.getState().timer), true);
  assert.equal(store.getState().timer.kind, "stopwatch");
  assert.equal(store.getState().restoreStudyTimer(previous), true);
  assert.equal(store.getState().timer.startedAt, running.startedAt);
  assert.equal(store.getState().timer.running, true);
  // Se nel frattempo è partita un'altra sessione, Annulla non la sovrascrive.
  store.getState().resetStudyTimer();
  store.getState().toggleStudyTimer();
  assert.equal(store.getState().restoreStudyTimer(previous), false);
});

test("store: modalità e impostazioni del timer (materia, generali) aggiornano il timer fermo", async () => {
  seedStore({ timer: defaultTimer("pomodoro", { subjectId: "s2" }) });
  store.getState().setTimerKind("stopwatch");
  assert.equal(store.getState().timer.kind, "stopwatch");
  assert.equal(store.getState().timer.subjectId, "s2");
  store.getState().setTimerKind("pomodoro");
  await store.getState().saveTimerSettings({ subjectId: "s2", subject: { focusMinutes: 40 } });
  assert.deepEqual(store.getState().subjects.find((subject) => subject.id === "s2").timer, { focusMinutes: 40 });
  assert.equal(store.getState().timer.durationSeconds, 40 * 60);
  await store.getState().saveTimerSettings({ defaults: { focusMinutes: 30, stopwatchTargetMinutes: 60 } });
  assert.deepEqual(store.getState().preferences.find((item) => item.id === "main").timer, { focusMinutes: 30, stopwatchTargetMinutes: 60 });
  store.getState().setTimerSubject(null);
  assert.equal(store.getState().timer.durationSeconds, 30 * 60, "senza materia valgono le durate generali");
  await store.getState().saveTimerSettings({ subjectId: "s2", subject: null });
  assert.equal(store.getState().subjects.find((subject) => subject.id === "s2").timer, undefined);
  store.getState().setTimerDetails({ title: "Cap. 3", template: "exercises" });
  assert.equal(store.getState().timer.title, "Cap. 3");
  assert.equal(store.getState().timer.template, "exercises");
});

test("store: l'obiettivo del cronometro avvisa una volta", () => {
  seedStore({ timer: startStopwatchState(Date.now() - 70 * MIN, { targetMinutes: 60 }) });
  store.getState().markTimerTargetNotified();
  assert.equal(store.getState().timer.targetNotifiedSeconds, 3600);
  assert.equal(store.getState().timer.running, true, "il cronometro non si ferma");
});
