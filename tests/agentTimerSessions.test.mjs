import test from "node:test";
import assert from "node:assert/strict";
import { findAgentTool } from "../src/agent/catalog.ts";
import { executeAgentTool } from "../src/agent/execute.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { TIMER_KINDS, defaultTimer, startCountdownState } from "../src/lib/studyTimer.ts";

const MIN = 60_000;
const OLD = "2026-01-01T00:00:00.000Z";

const seed = (extra = {}) =>
  useStudyStore.setState({
    loading: false,
    locked: false,
    persistError: null,
    subjects: [
      { id: "sub_an", name: "Analisi 1", status: "active", archived: false, timer: { timerMinutes: 90 }, updatedAt: OLD },
      { id: "sub_fi", name: "Fisica", status: "active", archived: false, updatedAt: OLD }
    ],
    topics: [
      { id: "top_lim", subjectId: "sub_an", title: "Limiti", archived: false },
      { id: "top_cin", subjectId: "sub_fi", title: "Cinematica", archived: false }
    ],
    sessions: [],
    tasks: [],
    events: [],
    exams: [],
    notes: [],
    goals: [],
    attachments: [],
    notifications: [],
    preferences: [],
    studyGroups: [],
    groupResources: [],
    timer: defaultTimer("pomodoro"),
    timerReview: false,
    ...extra
  });

test("timer MCP: kind=timer e minutes sono facoltativi, le chiamate di prima restano valide", () => {
  const control = findAgentTool("studyos_timer_control").inputSchema;
  assert.deepEqual(control.properties.kind.enum, [...TIMER_KINDS]);
  assert.ok(control.properties.kind.enum.includes("timer"));
  assert.equal(control.properties.minutes.type, "integer");
  assert.equal(control.properties.minutes.minimum, 1);
  assert.equal(control.properties.minutes.maximum, 600);
  assert.deepEqual(control.required, ["action"]);
});

test("timer MCP: avvia il Timer con i minuti scelti o con la durata ricordata della materia", async () => {
  seed();
  const explicit = await executeAgentTool("studyos_timer_control", { action: "start", kind: "timer", minutes: 75 });
  assert.equal(explicit.ok, true);
  assert.equal(explicit.data.timer.kind, "timer");
  assert.equal(explicit.data.timer.durationSeconds, 75 * 60);
  assert.equal(explicit.data.timer.running, true);
  assert.equal(explicit.data.timer.awaitingReview, false);
  useStudyStore.setState({ timer: defaultTimer("pomodoro") });

  const remembered = await executeAgentTool("studyos_timer_control", { action: "start", kind: "timer", subjectId: "sub_an" });
  assert.equal(remembered.data.timer.durationSeconds, 90 * 60, "durata ricordata per la materia");
  assert.equal(remembered.data.timer.subjectId, "sub_an");
  assert.equal(typeof remembered.data.timer.label, "string");
  useStudyStore.setState({ timer: defaultTimer("pomodoro") });

  assert.equal((await executeAgentTool("studyos_timer_control", { action: "start", kind: "orologio" })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_timer_control", { action: "start", kind: "timer", minutes: 0 })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_timer_control", { action: "start", kind: "timer", minutes: 601 })).code, "invalid");
});

test("timer MCP: lo stato dice quando il Timer è finito e aspetta il riepilogo; finish lo salva", async () => {
  const now = Date.now();
  seed({ timer: { ...startCountdownState(now - 40 * MIN, { minutes: 30, subjectId: "sub_an", topicId: "top_lim", sessionId: "session_cd" }), changedAt: now - 40 * MIN } });
  useStudyStore.getState().settleStudyTimer();
  const status = await executeAgentTool("studyos_timer_status", {});
  assert.equal(status.data.timer.kind, "timer");
  assert.equal(status.data.timer.awaitingReview, true);
  assert.equal(status.data.timer.running, false);
  assert.equal(status.data.timer.topicId, "top_lim");
  assert.equal(status.data.timer.elapsedSeconds, 30 * 60);
  const finished = await executeAgentTool("studyos_timer_control", { action: "finish" });
  assert.equal(finished.ok, true);
  assert.equal(finished.data.session.source, "timer");
  assert.equal(finished.data.session.topicId, "top_lim");
  assert.equal(finished.data.session.actualMinutes, 30);
  assert.equal(finished.data.session.end, new Date(now - 10 * MIN).toISOString());
  assert.equal(finished.data.timer.awaitingReview, false);
});

test("sessioni MCP: create accetta argomento e origine; l'argomento deve essere della materia", async () => {
  seed();
  const schema = findAgentTool("studyos_create_session").inputSchema;
  assert.ok(schema.properties.topicId);
  assert.deepEqual(schema.properties.source.enum, ["pomodoro", "timer", "stopwatch", "manual"]);
  assert.deepEqual(schema.required, ["title"]);

  const created = await executeAgentTool("studyos_create_session", { title: "Limiti notevoli", subjectId: "sub_an", topicId: "top_lim", source: "manual", status: "completed", actualMinutes: 40 });
  assert.equal(created.ok, true);
  const session = useStudyStore.getState().sessions.find((item) => item.id === created.data.id);
  assert.equal(session.topicId, "top_lim");
  assert.equal(session.source, "manual");

  const fromTopic = await executeAgentTool("studyos_create_session", { title: "Moto", topicId: "top_cin", status: "completed", actualMinutes: 20 });
  assert.equal(useStudyStore.getState().sessions.find((item) => item.id === fromTopic.data.id).subjectId, "sub_fi", "senza materia vale quella dell'argomento");

  assert.equal((await executeAgentTool("studyos_create_session", { title: "x", subjectId: "sub_an", topicId: "top_cin" })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_create_session", { title: "x", topicId: "top_nope" })).code, "not_found");

  const plain = await executeAgentTool("studyos_create_session", { title: "Vecchio stile", status: "completed", actualMinutes: 30 });
  const old = useStudyStore.getState().sessions.find((item) => item.id === plain.data.id);
  assert.equal("topicId" in old, false);
  assert.equal("source" in old, false);
});

test("sessioni MCP: update cambia materia, argomento, inizio e minuti; la fine segue", async () => {
  seed({
    sessions: [
      {
        id: "session_1",
        title: "Cronometro",
        subjectId: "sub_an",
        topicId: "top_lim",
        template: "review",
        plannedMinutes: 540,
        actualMinutes: 540,
        start: "2026-11-10T21:00:00.000Z",
        end: "2026-11-11T06:00:00.000Z",
        topics: [],
        perceivedDifficulty: 3,
        focusLevel: 4,
        notes: "",
        attachmentIds: [],
        status: "completed",
        source: "stopwatch",
        archived: false,
        tags: [],
        createdAt: OLD,
        updatedAt: OLD
      }
    ]
  });
  const schema = findAgentTool("studyos_update_session").inputSchema;
  for (const key of ["topicId", "subjectId", "start", "source"]) assert.ok(schema.properties[key], key);
  assert.deepEqual(schema.required, ["id"]);

  // Cronometro rimasto acceso: 540 minuti diventano 90, la fine si sposta (nessuna pausa nel mezzo).
  assert.equal((await executeAgentTool("studyos_update_session", { id: "session_1", actualMinutes: 90 })).ok, true);
  let session = useStudyStore.getState().sessions[0];
  assert.equal(session.actualMinutes, 90);
  assert.equal(session.end, "2026-11-10T22:30:00.000Z");

  assert.equal((await executeAgentTool("studyos_update_session", { id: "session_1", start: "2026-11-10T20:00:00.000Z" })).ok, true);
  session = useStudyStore.getState().sessions[0];
  assert.equal(session.start, "2026-11-10T20:00:00.000Z");
  assert.equal(session.end, "2026-11-10T21:30:00.000Z", "spostando l'inizio la durata resta");

  // Cambiando materia l'argomento dell'altra materia si stacca.
  assert.equal((await executeAgentTool("studyos_update_session", { id: "session_1", subjectId: "sub_fi" })).ok, true);
  session = useStudyStore.getState().sessions[0];
  assert.equal(session.subjectId, "sub_fi");
  assert.equal(session.topicId, undefined);

  assert.equal((await executeAgentTool("studyos_update_session", { id: "session_1", topicId: "top_cin" })).ok, true);
  assert.equal(useStudyStore.getState().sessions[0].topicId, "top_cin");
  assert.equal((await executeAgentTool("studyos_update_session", { id: "session_1", topicId: "top_lim" })).code, "invalid", "argomento di un'altra materia");
  assert.equal((await executeAgentTool("studyos_update_session", { id: "session_1", topicId: "" })).ok, true);
  assert.equal(useStudyStore.getState().sessions[0].topicId, undefined, "stringa vuota toglie l'argomento");
  assert.equal((await executeAgentTool("studyos_update_session", { id: "session_1", subjectId: "" })).ok, true);
  assert.equal(useStudyStore.getState().sessions[0].subjectId, undefined, "stringa vuota toglie la materia");
  assert.equal((await executeAgentTool("studyos_update_session", { id: "session_1", start: "ieri" })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_update_session", { id: "session_1", subjectId: "sub_nope" })).code, "not_found");
  // Le chiamate di prima funzionano come prima.
  assert.equal((await executeAgentTool("studyos_update_session", { id: "session_1", notes: "ok", focusLevel: 5 })).ok, true);
  assert.equal(useStudyStore.getState().sessions[0].notes, "ok");
});

test("sessioni MCP: una sessione fatta non inizia né finisce nel futuro (come nei moduli dell'app)", async () => {
  seed();
  const now = Date.now();
  const at = (minutes) => new Date(now + minutes * MIN).toISOString();
  const create = (args) => executeAgentTool("studyos_create_session", { title: "Ripasso", status: "completed", ...args });
  assert.equal((await create({ actualMinutes: 30, start: at(60) })).code, "invalid", "inizio nel futuro");
  assert.equal((await create({ actualMinutes: 60, start: at(-30) })).code, "invalid", "finirebbe tra mezz'ora");
  assert.equal(useStudyStore.getState().sessions.length, 0);
  const ended = await create({ actualMinutes: 30, start: at(-30) });
  assert.equal(ended.ok, true, "finisce adesso");
  // Senza inizio una sessione fatta è appena finita: è iniziata tanti minuti fa quanti ne dura.
  const before = Date.now();
  const justDone = await create({ actualMinutes: 40 });
  assert.equal(justDone.ok, true);
  const started = Date.parse(justDone.data.start);
  assert.ok(started <= before - 40 * MIN + 1000 && started >= before - 41 * MIN, justDone.data.start);
  // Pianificata (o saltata): può stare nel futuro.
  assert.equal((await executeAgentTool("studyos_create_session", { title: "Domani", start: at(24 * 60) })).ok, true);
  // Aggiornando una sessione fatta vale la stessa regola.
  const id = ended.data.id;
  assert.equal((await executeAgentTool("studyos_update_session", { id, actualMinutes: 90 })).code, "invalid");
  assert.equal((await executeAgentTool("studyos_update_session", { id, start: at(10) })).code, "invalid");
  assert.equal(useStudyStore.getState().sessions.find((item) => item.id === id).actualMinutes, 30, "niente salvato");
  assert.equal((await executeAgentTool("studyos_update_session", { id, actualMinutes: 20 })).ok, true);
  const planned = useStudyStore.getState().sessions.find((item) => item.title === "Domani");
  assert.equal((await executeAgentTool("studyos_update_session", { id: planned.id, status: "completed" })).code, "invalid", "domani non è ancora fatta");
});

test("preferenze MCP: obiettivo settimanale di almeno un'ora, come in Impostazioni", async () => {
  seed();
  assert.equal(findAgentTool("studyos_update_preferences").inputSchema.properties.weeklyTargetMinutes.minimum, 60);
  for (const value of [0, 59, -60, 90.5]) {
    assert.equal((await executeAgentTool("studyos_update_preferences", { weeklyTargetMinutes: value })).code, "invalid", String(value));
  }
  const saved = await executeAgentTool("studyos_update_preferences", { weeklyTargetMinutes: 60 });
  assert.equal(saved.ok, true);
  assert.equal(saved.data.preferences.weeklyTargetMinutes, 60);
});
