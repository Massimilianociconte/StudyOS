import test from "node:test";
import assert from "node:assert/strict";
import {
  LONG_SESSION_MINUTES,
  draftFromSession,
  editedSessionTimes,
  parseSessionMinutes,
  readSessionDraft,
  relinkSession,
  reviewedSessionTimes,
  sessionEditPatch,
  sessionLinksOf,
  sessionSourceLabel,
  sessionTopicId
} from "../src/lib/studySessions.ts";

const MIN = 60_000;
const at = (hours, minutes = 0) => Date.UTC(2026, 10, 10, hours, minutes);

test("editedSessionTimes: senza cambi restano inizio e fine", () => {
  assert.deepEqual(editedSessionTimes({ start: at(10), end: at(12), minutes: 90 }, {}), { start: at(10), end: at(12) });
  assert.deepEqual(editedSessionTimes({ start: at(10), minutes: 45 }, {}), { start: at(10), end: at(10, 45) }, "senza fine: inizio + minuti");
});

test("editedSessionTimes: meno minuti dopo un cronometro rimasto acceso spostano la fine", () => {
  // 21:00 → 06:00, nove ore senza pause: diventano 90 minuti, fine alle 22:30.
  assert.deepEqual(editedSessionTimes({ start: at(21), end: at(21) + 540 * MIN, minutes: 540 }, { minutes: 90 }), { start: at(21), end: at(22, 30) });
});

test("editedSessionTimes: le pause restano (Pomodoro 10:00 → 13:30 con 90 minuti di studio)", () => {
  const original = { start: at(10), end: at(13, 30), minutes: 90 };
  assert.deepEqual(editedSessionTimes(original, { start: at(11) }), { start: at(11), end: at(14, 30) });
  assert.deepEqual(editedSessionTimes(original, { minutes: 60 }), { start: at(10), end: at(13) });
  assert.deepEqual(editedSessionTimes(original, { start: at(9), minutes: 120 }), { start: at(9), end: at(13) });
});

test("editedSessionTimes: fine prima dell'inizio o minuti arrotondati non creano pause negative", () => {
  assert.deepEqual(editedSessionTimes({ start: at(10), end: at(9), minutes: 30 }, { minutes: 40 }), { start: at(10), end: at(10, 40) });
  assert.deepEqual(editedSessionTimes({ start: at(10), end: at(10, 29), minutes: 30 }, { minutes: 20 }), { start: at(10), end: at(10, 20) });
});

// --- Modulo di riepilogo e modifica (Timer, Cronometro, sessioni salvate) ---

const SUBJECTS = [
  { id: "an", name: "Analisi 1" },
  { id: "fi", name: "Fisica" }
];
const TOPICS = [
  { id: "lim", subjectId: "an", title: "Limiti notevoli", archived: false },
  { id: "der", subjectId: "an", title: "Derivate", archived: false },
  { id: "old", subjectId: "an", title: "Vecchio", archived: true },
  { id: "cin", subjectId: "fi", title: "Cinematica", archived: false }
];
const NOW = new Date(2026, 10, 11, 18, 0).getTime();
const draft = (extra = {}) => ({ subjectId: "an", topicId: "", title: "", notes: "", minutes: "90", template: "review", ...extra });
const ctx = { subjects: SUBJECTS, topics: TOPICS, now: NOW };

test("parseSessionMinutes: numeri interi da 1 a 960 (16 ore)", () => {
  assert.deepEqual(parseSessionMinutes("90"), { value: 90 });
  assert.deepEqual(parseSessionMinutes(" 45 "), { value: 45 });
  assert.deepEqual(parseSessionMinutes("960"), { value: 960 });
  for (const bad of ["", "0", "961", "1,5", "-3", "abc", "12 min"]) assert.deepEqual(parseSessionMinutes(bad), { invalid: true }, bad);
  assert.equal(LONG_SESSION_MINUTES, 240);
});

test("readSessionDraft: titolo scritto, poi argomento, poi tipo e materia", () => {
  const written = readSessionDraft(draft({ title: "  Cap.  4,  esercizi ", topicId: "lim", notes: " ok " }), ctx);
  assert.equal(written.ok, true);
  assert.deepEqual(written.value, { subjectId: "an", topicId: "lim", title: "Cap. 4, esercizi", notes: "ok", template: "review", minutes: 90 });
  assert.equal(readSessionDraft(draft({ topicId: "der" }), ctx).value.title, "Derivate", "senza descrizione vale l'argomento");
  assert.equal(readSessionDraft(draft(), ctx).value.title, "Ripasso · Analisi 1", "senza nulla: tipo e materia");
  assert.equal(readSessionDraft(draft({ subjectId: "" }), ctx).value.title, "Ripasso");
});

test("readSessionDraft: materia e argomento devono esistere e stare insieme", () => {
  const other = readSessionDraft(draft({ subjectId: "fi", topicId: "lim" }), ctx).value;
  assert.equal(other.subjectId, "fi");
  assert.equal("topicId" in other, false, "argomento di un'altra materia: tolto");
  const gone = readSessionDraft(draft({ subjectId: "nope", topicId: "lim" }), ctx).value;
  assert.equal("subjectId" in gone, false);
  assert.equal("topicId" in gone, false);
  assert.equal(readSessionDraft(draft({ topicId: "old" }), ctx).value.topicId, "old", "archiviato ma della materia: resta");
});

test("readSessionDraft: errori su minuti, giorno e ora", () => {
  assert.deepEqual(readSessionDraft(draft({ minutes: "0" }), ctx), { ok: false, error: "minutes" });
  assert.deepEqual(readSessionDraft(draft({ date: "2026-11-11", time: "xx" }), ctx), { ok: false, error: "start" });
  assert.deepEqual(readSessionDraft(draft({ date: "", time: "10:00" }), ctx), { ok: false, error: "start" });
  assert.deepEqual(readSessionDraft(draft({ date: "2026-11-11", time: "19:00" }), ctx), { ok: false, error: "future" });
  const moved = readSessionDraft(draft({ date: "2026-11-10", time: "21:15" }), ctx);
  assert.equal(moved.value.start, new Date(2026, 10, 10, 21, 15).getTime());
});

test("sessionEditPatch: la fine segue inizio e minuti, le pause restano", () => {
  const session = {
    id: "s1",
    title: "Cronometro",
    subjectId: "an",
    topicId: "lim",
    template: "review",
    actualMinutes: 540,
    plannedMinutes: 540,
    start: new Date(2026, 10, 10, 21, 0).toISOString(),
    end: new Date(2026, 10, 11, 6, 0).toISOString(),
    notes: ""
  };
  const patch = sessionEditPatch(session, { subjectId: "fi", title: "Moto", notes: "rivedere", template: "exercises", minutes: 90 });
  assert.deepEqual(patch, {
    subjectId: "fi",
    topicId: undefined,
    title: "Moto",
    notes: "rivedere",
    template: "exercises",
    actualMinutes: 90,
    start: session.start,
    end: new Date(2026, 10, 10, 22, 30).toISOString()
  });
  const later = sessionEditPatch(session, { subjectId: "an", topicId: "lim", title: "x", notes: "", template: "review", minutes: 540, start: new Date(2026, 10, 10, 20, 0).getTime() });
  assert.equal(later.start, new Date(2026, 10, 10, 20, 0).toISOString());
  assert.equal(later.end, new Date(2026, 10, 11, 5, 0).toISOString());
});

test("draftFromSession: i campi del modulo, senza ripetere titoli automatici", () => {
  const base = { id: "s", subjectId: "an", template: "review", actualMinutes: 50, start: new Date(2026, 10, 11, 9, 5).toISOString(), notes: "n" };
  assert.deepEqual(draftFromSession({ ...base, title: "Cap. 4", topicId: "lim" }, SUBJECTS, TOPICS), {
    subjectId: "an",
    topicId: "lim",
    title: "Cap. 4",
    notes: "n",
    minutes: "50",
    template: "review",
    date: "2026-11-11",
    time: "09:05"
  });
  assert.equal(draftFromSession({ ...base, title: "Ripasso · Analisi 1" }, SUBJECTS, TOPICS).title, "", "titolo automatico: campo vuoto");
  assert.equal(draftFromSession({ ...base, title: "limiti  NOTEVOLI", topicId: "lim" }, SUBJECTS, TOPICS).title, "", "uguale all'argomento: campo vuoto");
  assert.equal(draftFromSession({ ...base, subjectId: undefined, title: "x" }, SUBJECTS, TOPICS).subjectId, "");
});

test("sessionEditPatch: un inizio nello stesso minuto non sposta inizio e fine (si cambiano solo le note)", () => {
  // Salvata dal timer con i secondi: il modulo mostra solo ore e minuti.
  const session = { start: new Date(2026, 10, 10, 9, 5, 42).toISOString(), end: new Date(2026, 10, 10, 10, 37, 13).toISOString(), actualMinutes: 80 };
  const draft = draftFromSession({ ...session, id: "s", title: "x", subjectId: "an", template: "review", notes: "" }, SUBJECTS, TOPICS);
  const read = readSessionDraft({ ...draft, notes: "solo note" }, { subjects: SUBJECTS, topics: TOPICS, now: Date.now() });
  assert.equal(read.ok, true);
  const patch = sessionEditPatch(session, read.value);
  assert.equal(patch.start, session.start);
  assert.equal(patch.end, session.end);
  assert.equal(patch.notes, "solo note");
  // Un minuto dopo è un cambio vero.
  const moved = sessionEditPatch(session, { ...read.value, start: new Date(2026, 10, 10, 9, 6).getTime() });
  assert.equal(moved.start, new Date(2026, 10, 10, 9, 6).toISOString());
});

test("reviewedSessionTimes: minuti invariati = misurati; corretti = fine spostata con le sole pause vere", () => {
  // Cronometro acceso 540 minuti e 0,4 secondi (millisecondi tra avvio e "Termina"), senza pause.
  const block = { start: at(21), end: at(21) + 540 * MIN + 400, actualMinutes: 540 };
  assert.deepEqual(reviewedSessionTimes(block, 540 * 60, 540), { start: block.start, end: block.end }, "invariati: inizio e fine veri");
  assert.deepEqual(reviewedSessionTimes(block, 540 * 60, 90), { start: at(21), end: at(22, 30) }, "il resto dell'arrotondamento non è una pausa");
  // 52 minuti e 40 secondi di studio con 10 minuti di pausa: corretti a 45, la pausa resta.
  const paused = { start: at(9), end: at(9) + (52 * 60 + 40) * 1000 + 10 * MIN, actualMinutes: 53 };
  assert.deepEqual(reviewedSessionTimes(paused, 52 * 60 + 40, 45), { start: at(9), end: at(9, 55) });
});

test("sessionSourceLabel e sessionTopicId: valori da dati condivisi non diventano etichette o argomenti", () => {
  assert.equal(sessionSourceLabel("timer"), "Timer");
  assert.equal(sessionSourceLabel("stopwatch"), "Cronometro");
  for (const value of ["constructor", "__proto__", "toString", "", 42, null, undefined, {}, ["timer"]]) {
    assert.equal(sessionSourceLabel(value), undefined, String(value));
  }
  assert.equal(sessionTopicId({ topicId: "lim" }), "lim");
  for (const value of [42, "", null, undefined, { id: "lim" }]) assert.equal(sessionTopicId({ topicId: value }), undefined);
  const odd = { id: "s", title: "x", subjectId: "an", topicId: 42, template: "review", actualMinutes: 5, start: new Date().toISOString(), notes: "" };
  assert.equal(draftFromSession(odd, SUBJECTS, TOPICS).topicId, "");
});

test("sessionLinksOf e relinkSession: Annulla rimette obiettivi, file, note e promemoria ancora liberi", () => {
  const OLD = "2026-01-01T00:00:00.000Z";
  const NOW = "2026-11-11T10:00:00.000Z";
  const linked = (id) => ({ id, linkedEntityType: "studySession", linkedEntityId: "s1", updatedAt: OLD });
  const before = {
    goals: [
      { id: "g1", linkedSessionIds: ["s0", "s1"], updatedAt: OLD },
      { id: "g2", linkedSessionIds: ["s0"], updatedAt: OLD }
    ],
    attachments: [linked("a1"), { id: "a2", linkedEntityType: "task", linkedEntityId: "t1", updatedAt: OLD }],
    notes: [linked("n1"), linked("n2")],
    reminders: [linked("r1")]
  };
  const links = sessionLinksOf(before, "s1");
  assert.deepEqual(links, { goalIds: ["g1"], attachmentIds: ["a1"], noteIds: ["n1", "n2"], reminderIds: ["r1"] });

  // Dopo Elimina tutto è scollegato; nel frattempo n2 è stata eliminata e r1 collegato a un'attività.
  const unlink = (item) => ({ ...item, linkedEntityType: undefined, linkedEntityId: undefined, updatedAt: "2026-11-11T09:59:00.000Z" });
  const after = {
    goals: [{ ...before.goals[0], linkedSessionIds: ["s0"] }, before.goals[1]],
    attachments: [unlink(before.attachments[0]), before.attachments[1]],
    notes: [unlink(before.notes[0])],
    reminders: [{ ...unlink(before.reminders[0]), linkedEntityType: "task", linkedEntityId: "t9" }]
  };
  const restored = relinkSession(after, "s1", links, NOW);
  assert.deepEqual(restored.goals[0], { id: "g1", linkedSessionIds: ["s0", "s1"], updatedAt: NOW });
  assert.equal(restored.goals[1], after.goals[1], "obiettivo non collegato: stesso oggetto");
  assert.deepEqual(restored.attachments[0], { id: "a1", linkedEntityType: "studySession", linkedEntityId: "s1", updatedAt: NOW });
  assert.equal(restored.attachments[1], after.attachments[1]);
  assert.deepEqual(restored.notes, [{ id: "n1", linkedEntityType: "studySession", linkedEntityId: "s1", updatedAt: NOW }], "la nota eliminata non torna");
  assert.equal(restored.reminders, after.reminders, "collegato ad altro: resta com'è");
  // Niente da rimettere: stesse liste.
  const none = relinkSession(after, "s1", { goalIds: [], attachmentIds: [], noteIds: [], reminderIds: [] }, NOW);
  for (const key of ["goals", "attachments", "notes", "reminders"]) assert.equal(none[key], after[key]);
  // Già ricollegato (doppio Annulla): niente doppioni.
  const twice = relinkSession(restored, "s1", links, NOW);
  assert.deepEqual(twice.goals[0].linkedSessionIds, ["s0", "s1"]);
  assert.equal(twice.goals, restored.goals);
});
