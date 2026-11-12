import test from "node:test";
import assert from "node:assert/strict";
import {
  TIMER_KINDS,
  TIMER_STORAGE_KEY,
  advanceTimerState,
  defaultTimer,
  endTimerState,
  finishedSession,
  isTimerIdle,
  isTimerState,
  loadTimer,
  normalizeTimer,
  saveTimer,
  sessionFromBlock,
  startCountdownState,
  syncTimerDurations,
  timerElapsedSeconds,
  timerRemainingSeconds,
  toggleTimerState
} from "../src/lib/studyTimer.ts";
import {
  DEFAULT_TIMER_DURATIONS,
  TIMER_LIMITS,
  TIMER_QUICK_PICKS,
  changedTimerSettings,
  cleanTimerSettings,
  parseHoursMinutes,
  resolveTimerDurations,
  splitMinutes
} from "../src/lib/timerPrefs.ts";
import { defaultSessionTitle, matchTopic, topicsOfSubject } from "../src/lib/studySessions.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const MIN = 60_000;

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key)
  };
};

// ---------- tre modalità ----------

test("tre modalità nell'ordine del selettore; i valori salvati prima restano validi", () => {
  assert.deepEqual([...TIMER_KINDS], ["pomodoro", "timer", "stopwatch"]);
  const old = { mode: "pomodoro", kind: "stopwatch", running: false, remainingSeconds: 0, durationSeconds: 0, accumulatedSeconds: 120 };
  assert.equal(isTimerState(old), true);
  assert.equal(normalizeTimer(old).kind, "stopwatch");
  assert.equal(normalizeTimer({ mode: "pomodoro", running: false, remainingSeconds: 60, durationSeconds: 1500 }).kind, "pomodoro");
});

// ---------- durata del Timer ----------

test("durata del Timer: predefinita 60 minuti, ricordata per materia, limitata a 1 min – 10 h", () => {
  assert.equal(DEFAULT_TIMER_DURATIONS.timerMinutes, 60);
  assert.deepEqual(TIMER_LIMITS.timerMinutes, [1, 600]);
  assert.equal(resolveTimerDurations().timerMinutes, 60);
  assert.equal(resolveTimerDurations({ timerMinutes: 135 }, { timerMinutes: 45 }).timerMinutes, 135);
  assert.equal(resolveTimerDurations(undefined, { timerMinutes: 45 }).timerMinutes, 45);
  assert.equal(resolveTimerDurations({ timerMinutes: 0 }).timerMinutes, 1);
  assert.equal(resolveTimerDurations({ timerMinutes: 9999 }).timerMinutes, 600);
  assert.deepEqual(cleanTimerSettings({ timerMinutes: 90.2 }), { timerMinutes: 90 });
  assert.deepEqual([...TIMER_QUICK_PICKS], [30, 60, 90, 120]);
});

test("ore e minuti: 1 h 30, 2 h 15; vuoto o non numerico non valido; fuori dai limiti si limita", () => {
  assert.deepEqual(parseHoursMinutes("1", "30"), { value: 90 });
  assert.deepEqual(parseHoursMinutes("2", "15"), { value: 135 });
  assert.deepEqual(parseHoursMinutes("", "45"), { value: 45 });
  assert.deepEqual(parseHoursMinutes("3", ""), { value: 180 });
  assert.deepEqual(parseHoursMinutes(" 0 ", "90"), { value: 90 }, "i minuti oltre 59 valgono comunque");
  assert.deepEqual(parseHoursMinutes("", ""), { invalid: true });
  assert.deepEqual(parseHoursMinutes("uno", "10"), { invalid: true });
  assert.deepEqual(parseHoursMinutes("1,5", "0"), { invalid: true });
  assert.deepEqual(parseHoursMinutes("-1", "0"), { invalid: true });
  assert.deepEqual(parseHoursMinutes("0", "0"), { value: 1 }, "almeno 1 minuto");
  assert.deepEqual(parseHoursMinutes("12", "0"), { value: 600 }, "al massimo 10 ore");
  assert.deepEqual(splitMinutes(135), { hours: 2, minutes: 15 });
  assert.deepEqual(splitMinutes(45), { hours: 0, minutes: 45 });
});

test("changedTimerSettings: si salvano solo i valori cambiati, quelli ereditati restano ereditati", () => {
  const initial = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, stopwatchTargetMinutes: undefined, timerMinutes: 60 };
  // Materia senza durate proprie: cambia solo il blocco → si salva solo il blocco.
  assert.deepEqual(changedTimerSettings({ ...initial, focusMinutes: 50 }, initial, undefined), { focusMinutes: 50 });
  // Valori propri già salvati restano; quelli non toccati non si aggiungono.
  assert.deepEqual(changedTimerSettings({ ...initial, shortBreakMinutes: 10 }, initial, { focusMinutes: 50, timerMinutes: 90 }), {
    focusMinutes: 50,
    timerMinutes: 90,
    shortBreakMinutes: 10
  });
  // Obiettivo tolto: la chiave sparisce; niente da salvare → undefined.
  assert.equal(changedTimerSettings(initial, initial, undefined), undefined);
  assert.deepEqual(changedTimerSettings({ ...initial, stopwatchTargetMinutes: undefined }, { ...initial, stopwatchTargetMinutes: 60 }, { stopwatchTargetMinutes: 60, focusMinutes: 40 }), { focusMinutes: 40 });
});

// ---------- modello del conto alla rovescia ----------

test("Timer: conto alla rovescia dalla durata scelta, pausa e ripresa", () => {
  const t0 = 1_000_000;
  const timer = startCountdownState(t0, { minutes: 90, subjectId: "s1", sessionId: "session_t", topicId: "topic_1", title: "Capitolo 4" });
  assert.equal(timer.kind, "timer");
  assert.equal(timer.phase, "focus");
  assert.equal(timer.durationSeconds, 90 * 60);
  assert.equal(timer.topicId, "topic_1");
  assert.equal(timerRemainingSeconds(timer, t0 + 30 * MIN), 60 * 60);
  assert.equal(timerElapsedSeconds(timer, t0 + 30 * MIN), 30 * 60);
  const paused = toggleTimerState(timer, t0 + 30 * MIN);
  assert.equal(timerRemainingSeconds(paused, t0 + 300 * MIN), 60 * 60, "in pausa il tempo non scende");
  const resumed = toggleTimerState(paused, t0 + 40 * MIN);
  assert.equal(timerRemainingSeconds(resumed, t0 + 70 * MIN), 30 * 60);
  assert.equal(resumed.startedAt, t0, "l'inizio reale resta il primo avvio");
});

test("Timer: allo scadere si ferma e aspetta il riepilogo con la fine reale (anche ad app chiusa)", () => {
  const t0 = 1_000_000;
  const timer = startCountdownState(t0, { minutes: 30, sessionId: "session_t" });
  assert.deepEqual(advanceTimerState(timer, t0 + 10 * MIN, resolveTimerDurations()), { timer }, "prima della fine nulla");
  const result = advanceTimerState(timer, t0 + 5 * 60 * MIN, resolveTimerDurations());
  assert.equal(result.timerEnded, true);
  assert.equal(result.finishedBlock, undefined, "il Timer non si salva da solo");
  const ended = result.timer;
  assert.equal(ended.running, false);
  assert.equal(ended.ended, true);
  assert.equal(ended.pausedAt, t0 + 30 * MIN, "fine reale = quando è scaduto, non quando si riapre l'app");
  assert.equal(timerRemainingSeconds(ended, t0 + 6 * 60 * MIN), 0);
  assert.equal(timerElapsedSeconds(ended, t0 + 6 * 60 * MIN), 30 * 60);
  const block = finishedSession(ended, t0 + 6 * 60 * MIN);
  assert.equal(block.source, "timer");
  assert.equal(block.start, t0);
  assert.equal(block.end, t0 + 30 * MIN);
  assert.equal(block.actualMinutes, 30);
  assert.equal(block.sessionId, "session_t");
  // Finito e a zero: «Riprendi» non riparte da capo.
  assert.equal(toggleTimerState(ended, t0 + 7 * 60 * MIN), ended);
  assert.equal(isTimerIdle(ended), false);
});

test("Termina prima: Timer e Cronometro si fermano e aspettano il riepilogo; Riprendi annulla la fine", () => {
  const t0 = 2_000_000;
  const countdown = startCountdownState(t0, { minutes: 60 });
  const early = endTimerState(countdown, t0 + 20 * MIN);
  assert.equal(early.ended, true);
  assert.equal(early.running, false);
  assert.equal(early.pausedAt, t0 + 20 * MIN);
  assert.equal(timerElapsedSeconds(early, t0 + 90 * MIN), 20 * 60);
  const again = toggleTimerState(early, t0 + 25 * MIN);
  assert.equal(again.ended, undefined);
  assert.equal(again.running, true);
  assert.equal(timerRemainingSeconds(again, t0 + 25 * MIN), 40 * 60);

  const stopwatch = endTimerState(toggleTimerState(defaultTimer("pomodoro", { kind: "stopwatch" }), t0), t0 + 45 * MIN);
  assert.equal(stopwatch.ended, true);
  assert.equal(timerElapsedSeconds(stopwatch, t0 + 600 * MIN), 45 * 60, "dopo Termina il cronometro non conta più");
  assert.equal(finishedSession(stopwatch, t0 + 600 * MIN).end, t0 + 45 * MIN);
  // Il Pomodoro non passa dal riepilogo: endTimerState non lo tocca.
  const pomodoro = toggleTimerState(defaultTimer(), t0);
  assert.equal(endTimerState(pomodoro, t0 + MIN), pomodoro);
});

test("Timer: stato salvato e ricaricato, controlli di validità", () => {
  const storage = memoryStorage();
  const timer = { ...startCountdownState(5 * MIN, { minutes: 135, subjectId: "s1", topicId: "t1", sessionId: "session_x" }), changedAt: 5 * MIN };
  saveTimer(timer, storage);
  assert.deepEqual(loadTimer(storage), timer);
  const ended = { ...endTimerState(timer, 10 * MIN), changedAt: 10 * MIN };
  saveTimer(ended, storage);
  assert.deepEqual(loadTimer(storage), ended);
  const base = { mode: "pomodoro", kind: "timer", running: false, remainingSeconds: 60, durationSeconds: 3600 };
  assert.equal(isTimerState(base), true);
  for (const bad of [
    { ...base, running: true },
    { ...base, durationSeconds: 0 },
    { ...base, durationSeconds: 601 * 60 },
    { ...base, phase: "short" }
  ]) assert.equal(isTimerState(bad), false, JSON.stringify(bad));
  const cleaned = normalizeTimer({ ...base, topicId: 4, ended: "si" });
  assert.equal(cleaned.topicId, undefined);
  assert.equal(cleaned.ended, undefined);
  assert.equal(normalizeTimer({ ...base, ended: true }).ended, true);
});

test("Timer fermo: prende la durata della materia; quello avviato tiene la sua", () => {
  const durations = resolveTimerDurations({ timerMinutes: 135 });
  const idle = defaultTimer("pomodoro", { kind: "timer" });
  assert.equal(idle.durationSeconds, 60 * 60);
  const synced = syncTimerDurations(idle, durations, 0);
  assert.equal(synced.durationSeconds, 135 * 60);
  assert.equal(timerRemainingSeconds(synced, 0), 135 * 60);
  const running = startCountdownState(0, { minutes: 30 });
  assert.equal(syncTimerDurations(running, durations, MIN), running);
});

test("sessionFromBlock: il Timer salva origine, argomento e note", () => {
  const block = { sessionId: "session_t", start: 0, end: 90 * MIN, actualMinutes: 90, plannedMinutes: 90, subjectId: "s1", topicId: "topic_1", title: "Limiti", notes: "rifare es. 3", source: "timer" };
  const session = sessionFromBlock(block, { subjects: [{ id: "s1", name: "Analisi 1" }], now: "2026-11-11T10:00:00.000Z" });
  assert.equal(session.source, "timer");
  assert.equal(session.topicId, "topic_1");
  assert.equal(session.title, "Limiti");
  assert.equal(session.notes, "rifare es. 3");
  const plain = sessionFromBlock({ ...block, topicId: undefined, notes: undefined }, { subjects: [], now: "x" });
  assert.equal("topicId" in plain, false, "nessuna chiave vuota nel JSON");
  assert.equal(plain.notes, "");
});

// ---------- cosa studi ----------

const TOPICS = [
  { id: "t1", subjectId: "s1", title: "Limiti", archived: false },
  { id: "t2", subjectId: "s1", title: "Derivate", archived: false },
  { id: "t3", subjectId: "s2", title: "Cinematica", archived: false },
  { id: "t4", subjectId: "s1", title: "Integrali", archived: true }
];

test("matchTopic: un argomento della materia con lo stesso titolo (maiuscole e spazi non contano)", () => {
  assert.equal(matchTopic("  limiti ", TOPICS, "s1")?.id, "t1");
  assert.equal(matchTopic("Cinematica", TOPICS, "s1"), undefined, "solo gli argomenti della materia scelta");
  assert.equal(matchTopic("Integrali", TOPICS, "s1"), undefined, "gli archiviati non si propongono");
  assert.equal(matchTopic("Capitolo 4", TOPICS, "s1"), undefined, "testo libero");
  assert.equal(matchTopic("Limiti", TOPICS, undefined), undefined, "senza materia niente argomento");
  assert.deepEqual(topicsOfSubject(TOPICS, "s1").map((topic) => topic.id), ["t2", "t1"], "in ordine alfabetico, senza archiviati");
  assert.deepEqual(topicsOfSubject(TOPICS, undefined), []);
});

test("defaultSessionTitle: tipo di sessione e materia, come le sessioni salvate dal timer", () => {
  assert.equal(defaultSessionTitle("review", "Analisi 1"), "Ripasso · Analisi 1");
  assert.equal(defaultSessionTitle("new-topic"), "Nuovo argomento");
});

// ---------- store ----------

const store = useStudyStore;
const OLD = "2026-11-01T10:00:00.000Z";
const seedStore = (extra = {}) =>
  store.setState({
    loading: false,
    locked: false,
    subjects: [
      { id: "s1", name: "Analisi 1", status: "active", archived: false, timer: { timerMinutes: 90 }, updatedAt: OLD },
      { id: "s2", name: "Fisica", status: "active", archived: false, updatedAt: OLD }
    ],
    topics: TOPICS,
    sessions: [],
    preferences: [],
    timer: defaultTimer(),
    ...extra
  });

test("store: il Timer fermo usa la durata ricordata della materia e parte da lì", () => {
  seedStore();
  store.getState().setTimerKind("timer");
  store.getState().setTimerSubject("s1");
  assert.equal(store.getState().timer.kind, "timer");
  assert.equal(store.getState().timer.durationSeconds, 90 * 60);
  store.getState().toggleStudyTimer();
  const timer = store.getState().timer;
  assert.equal(timer.running, true);
  assert.ok(timer.sessionId);
  assert.ok(timer.endsAt >= Date.now() + 89 * MIN);
});

test("store: startCountdown con minuti espliciti (agenti) non cambia la durata ricordata", () => {
  seedStore();
  store.getState().startCountdown(25, "s2");
  const timer = store.getState().timer;
  assert.equal(timer.kind, "timer");
  assert.equal(timer.subjectId, "s2");
  assert.equal(timer.durationSeconds, 25 * 60);
  assert.equal(store.getState().subjects.find((subject) => subject.id === "s2").timer, undefined);
  store.getState().startCountdown(5000);
  assert.equal(store.getState().timer.durationSeconds, 600 * 60, "limitato a 10 ore");
});

test("store: argomento scelto e cambio di materia (l'argomento di un'altra materia si stacca)", () => {
  seedStore();
  store.getState().setTimerSubject("s1");
  store.getState().setTimerDetails({ title: "Limiti", topicId: "t1" });
  assert.equal(store.getState().timer.topicId, "t1");
  store.getState().setTimerSubject("s2");
  assert.equal(store.getState().timer.topicId, undefined);
  // Il nome dell'argomento scelto se ne va con l'argomento (il testo scritto a mano invece resta).
  assert.equal(store.getState().timer.title, "", "«Limiti» non passa a un'altra materia");
  store.getState().setTimerDetails({ title: "Limiti notevoli" });
  store.getState().setTimerSubject("s1");
  assert.equal(store.getState().timer.title, "Limiti notevoli", "il testo scritto resta");
  store.getState().setTimerDetails({ topicId: "inventato" });
  assert.equal(store.getState().timer.topicId, undefined, "argomento sconosciuto o di un'altra materia ignorato");
});

test("store: allo scadere del Timer nessuna sessione automatica, si apre il riepilogo", () => {
  const now = Date.now();
  seedStore({ timer: { ...startCountdownState(now - 40 * MIN, { minutes: 30, subjectId: "s1", sessionId: "session_cd" }), changedAt: now - 40 * MIN } });
  const event = store.getState().settleStudyTimer();
  assert.equal(event.type, "timer-done");
  assert.equal(event.minutes, 30);
  assert.equal(event.endedAt, now - 10 * MIN);
  assert.equal(store.getState().sessions.length, 0);
  assert.equal(store.getState().timer.ended, true);
  assert.equal(store.getState().timerReview, true);
  assert.equal(store.getState().settleStudyTimer(), null, "una volta sola");
  // "Termina e salva" (agenti) salva comunque la sessione con la fine reale.
  const result = store.getState().finishStudyTimer();
  assert.equal(result.status, "saved");
  assert.equal(result.session.source, "timer");
  assert.equal(result.session.end, new Date(now - 10 * MIN).toISOString());
  assert.equal(store.getState().timerReview, false);
  assert.equal(store.getState().timer.kind, "timer", "il Timer resta pronto per la prossima");
  assert.equal(isTimerIdle(store.getState().timer), true);
});

test("store: Termina (Timer e Cronometro) ferma e apre il riepilogo; sotto il minuto no", () => {
  seedStore({ timer: startCountdownState(Date.now() - 30_000, { minutes: 30 }) });
  assert.equal(store.getState().endStudyTimer().status, "too-short");
  assert.equal(store.getState().timer.running, true);
  seedStore({ timer: startCountdownState(Date.now() - 12 * MIN, { minutes: 30 }) });
  assert.equal(store.getState().endStudyTimer().status, "review");
  assert.equal(store.getState().timer.ended, true);
  assert.equal(store.getState().timerReview, true);
  store.getState().setTimerReviewOpen(false);
  assert.equal(store.getState().timerReview, false);
  store.getState().toggleStudyTimer();
  assert.equal(store.getState().timer.running, true, "Riprendi continua il Timer finito prima del tempo");
  assert.equal(store.getState().timer.ended, undefined);
});

test("store: addSession conserva origine e argomento (aggiunta a mano)", async () => {
  seedStore();
  await store.getState().addSession({ title: "Biblioteca", subjectId: "s1", topicId: "t1", source: "manual", status: "completed", actualMinutes: 60 });
  const [session] = store.getState().sessions;
  assert.equal(session.source, "manual");
  assert.equal(session.topicId, "t1");
  await store.getState().addSession({ title: "Vecchio stile" });
  assert.equal("source" in store.getState().sessions[0], false);
  assert.equal("topicId" in store.getState().sessions[0], false);
});

test("store: Salva dal riepilogo usa i campi corretti; i minuti corretti spostano la fine", () => {
  const now = Date.now();
  // Cronometro rimasto acceso 9 ore: nel riepilogo diventano 90 minuti.
  const started = { ...defaultTimer("pomodoro", { kind: "stopwatch", subjectId: "s1" }), running: true, startedAt: now - 540 * MIN, runningSince: now - 540 * MIN, sessionId: "session_rev" };
  seedStore({ timer: started });
  assert.equal(store.getState().endStudyTimer().status, "review");
  const result = store.getState().saveTimerReview({ subjectId: "s2", topicId: "t3", title: "Moto rettilineo", notes: "rifare es. 4", template: "exercises", minutes: 90 });
  assert.equal(result.status, "saved");
  const [session] = store.getState().sessions;
  assert.equal(session.id, "session_rev");
  assert.equal(session.subjectId, "s2");
  assert.equal(session.topicId, "t3");
  assert.equal(session.title, "Moto rettilineo");
  assert.equal(session.notes, "rifare es. 4");
  assert.equal(session.template, "exercises");
  assert.equal(session.source, "stopwatch");
  assert.equal(session.actualMinutes, 90);
  assert.equal(Date.parse(session.end) - Date.parse(session.start), 90 * MIN);
  assert.equal(store.getState().timerReview, false);
  assert.equal(isTimerIdle(store.getState().timer), true);
  assert.equal(store.getState().timer.kind, "stopwatch");
  // Un argomento di un'altra materia non si salva; senza riepilogo aperto non c'è niente da salvare.
  assert.equal(store.getState().saveTimerReview({ title: "x", notes: "", template: "review", minutes: 5 }).status, "idle");
  seedStore({ timer: { ...startCountdownState(now - 40 * MIN, { minutes: 30, subjectId: "s1", sessionId: "session_cd2" }) } });
  store.getState().endStudyTimer();
  store.getState().saveTimerReview({ subjectId: "s1", topicId: "t3", title: "Limiti", notes: "", template: "review", minutes: 30 });
  assert.equal("topicId" in store.getState().sessions[0], false);
  assert.equal(store.getState().sessions[0].end, new Date(now - 10 * MIN).toISOString(), "fine reale del Timer");
});

test("store: Salva dal riepilogo non fa finire la sessione nel futuro", () => {
  const now = Date.now();
  // Cronometro avviato 30 minuti fa e appena terminato: 45 minuti finirebbero tra un quarto d'ora.
  const started = { ...defaultTimer("pomodoro", { kind: "stopwatch", subjectId: "s1" }), running: true, startedAt: now - 30 * MIN, runningSince: now - 30 * MIN, sessionId: "session_late" };
  seedStore({ timer: started });
  assert.equal(store.getState().endStudyTimer().status, "review");
  const edit = { subjectId: "s1", title: "Limiti", notes: "", template: "review" };
  assert.equal(store.getState().saveTimerReview({ ...edit, minutes: 45 }).status, "future");
  assert.equal(store.getState().sessions.length, 0);
  assert.equal(store.getState().timer.ended, true, "il riepilogo resta da salvare");
  assert.equal(store.getState().timerReview, true);
  const saved = store.getState().saveTimerReview({ ...edit, minutes: 30 });
  assert.equal(saved.status, "saved");
  assert.ok(Date.parse(saved.session.end) <= Date.now());
});

test("store: restoreSession rimette la sessione eliminata (Annulla) con updatedAt nuovo", async () => {
  seedStore();
  await store.getState().addSession({ title: "Da eliminare", status: "completed", actualMinutes: 30, source: "manual" });
  const [session] = store.getState().sessions;
  const old = { ...session, updatedAt: OLD };
  store.setState({ sessions: [old] });
  await store.getState().deleteSession(old.id);
  assert.equal(store.getState().sessions.length, 0);
  await store.getState().restoreSession(old);
  const [restored] = store.getState().sessions;
  // Con l'updatedAt di prima la cancellazione già inviata al cloud vincerebbe per LWW e la sync la toglierebbe di nuovo.
  assert.ok(Date.parse(restored.updatedAt) > Date.parse(OLD), "updatedAt più recente");
  const { updatedAt: _restoredAt, ...rest } = restored;
  const { updatedAt: _oldAt, ...expected } = old;
  assert.deepEqual(rest, expected, "gli altri campi restano quelli di prima");
  await store.getState().restoreSession(old);
  assert.equal(store.getState().sessions.length, 1, "niente doppioni");
});

test("store: Elimina e poi Annulla rimettono anche obiettivi, file, note e promemoria collegati", async () => {
  const linked = (id) => ({ id, title: id, linkedEntityType: "studySession", linkedEntityId: "sx", createdAt: OLD, updatedAt: OLD });
  seedStore({
    sessions: [{ id: "sx", title: "Studio", status: "completed", actualMinutes: 40, start: OLD, attachmentIds: ["a1"], createdAt: OLD, updatedAt: OLD }],
    goals: [{ id: "g1", title: "Ore", linkedSessionIds: ["sx"], createdAt: OLD, updatedAt: OLD }],
    attachments: [linked("a1")],
    notes: [linked("n1"), linked("n2")],
    reminders: [linked("r1")]
  });
  const session = store.getState().sessions[0];
  const links = await store.getState().deleteSession("sx");
  assert.deepEqual(links, { goalIds: ["g1"], attachmentIds: ["a1"], noteIds: ["n1", "n2"], reminderIds: ["r1"] });
  assert.deepEqual(store.getState().goals[0].linkedSessionIds, []);
  assert.equal(store.getState().notes[0].linkedEntityId, undefined);
  // Nel frattempo una nota è stata eliminata: non torna.
  store.setState({ notes: store.getState().notes.filter((note) => note.id !== "n2") });
  await store.getState().restoreSession(session, links);
  const state = store.getState();
  assert.deepEqual(state.goals[0].linkedSessionIds, ["sx"]);
  assert.equal(state.attachments[0].linkedEntityId, "sx");
  assert.deepEqual(state.notes.map((note) => [note.id, note.linkedEntityType, note.linkedEntityId]), [["n1", "studySession", "sx"]]);
  assert.equal(state.reminders[0].linkedEntityId, "sx");
  for (const item of [state.goals[0], state.attachments[0], state.notes[0], state.reminders[0]]) {
    assert.ok(Date.parse(item.updatedAt) > Date.parse(OLD), `${item.id}: updatedAt nuovo`);
  }
});

test("store: addSession con un id già salvato non crea un doppione (doppio tocco su Salva)", async () => {
  seedStore();
  const fields = { id: "session_manual_1", title: "Biblioteca", status: "completed", actualMinutes: 60, source: "manual" };
  await Promise.all([store.getState().addSession(fields), store.getState().addSession(fields)]);
  assert.deepEqual(store.getState().sessions.map((session) => session.id), ["session_manual_1"]);
  await store.getState().addSession({ title: "Senza id" });
  assert.equal(store.getState().sessions.length, 2);
  assert.notEqual(store.getState().sessions[0].id, "session_manual_1");
});

test("store: il previsto di un cronometro senza obiettivo segue i minuti corretti", () => {
  const now = Date.now();
  const started = { ...defaultTimer("pomodoro", { kind: "stopwatch", subjectId: "s1" }), durationSeconds: 0, running: true, startedAt: now - 540 * MIN, runningSince: now - 540 * MIN, sessionId: "session_pl" };
  seedStore({ timer: started });
  store.getState().endStudyTimer();
  store.getState().saveTimerReview({ subjectId: "s1", title: "Limiti", notes: "", template: "review", minutes: 90 });
  const [session] = store.getState().sessions;
  assert.equal(session.actualMinutes, 90);
  assert.equal(session.plannedMinutes, 90);
});

test("store: una scheda rimasta indietro non salva né azzera sopra lo stato più recente", () => {
  const storage = memoryStorage();
  globalThis.localStorage = storage;
  try {
    const now = Date.now();
    const stale = { ...startCountdownState(now - 40 * MIN, { minutes: 30, subjectId: "s1", sessionId: "session_stale" }), changedAt: now - 5 * MIN };
    seedStore({ timer: stale });
    store.getState().endStudyTimer();
    const ended = store.getState().timer;
    // Un'altra scheda ha già salvato e avviato un cronometro, ma questa non ha ricevuto l'evento.
    const newer = { ...defaultTimer("pomodoro", { kind: "stopwatch", subjectId: "s2" }), running: true, startedAt: now, runningSince: now, sessionId: "session_y", changedAt: (ended.changedAt ?? now) + 1000 };
    storage.setItem(TIMER_STORAGE_KEY, JSON.stringify(newer));
    assert.equal(store.getState().saveTimerReview({ subjectId: "s1", title: "x", notes: "", template: "review", minutes: 30 }).status, "idle");
    assert.equal(store.getState().sessions.length, 0, "niente sessione salvata sopra quella dell'altra scheda");
    assert.equal(store.getState().timer.sessionId, "session_y");
    assert.equal(store.getState().timerReview, false);
    // Azzera: stessa regola, il cronometro dell'altra scheda resta.
    store.setState({ timer: { ...newer, changedAt: newer.changedAt - 2000 } });
    assert.equal(store.getState().resetStudyTimer(), false, "non ha azzerato: niente «Sessione scartata» né «Annulla»");
    assert.equal(store.getState().timer.running, true);
    assert.equal(JSON.parse(storage.getItem(TIMER_STORAGE_KEY)).sessionId, "session_y");
    // Allineata, la stessa scheda azzera davvero.
    assert.equal(store.getState().resetStudyTimer(), true);
    assert.equal(store.getState().timer.running, false);
  } finally {
    delete globalThis.localStorage;
  }
});

test("store: il timer vecchio in localStorage si carica come prima (kind assente = Pomodoro)", () => {
  const storage = memoryStorage({ [TIMER_STORAGE_KEY]: JSON.stringify({ mode: "classic", running: false, remainingSeconds: 600, durationSeconds: 2700 }) });
  assert.equal(loadTimer(storage).kind, "pomodoro");
});
