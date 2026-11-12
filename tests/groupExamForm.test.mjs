import assert from "node:assert/strict";
import test from "node:test";
import {
  changedSessionFields,
  draftFromBarb,
  emptyDraft,
  fieldText,
  fieldsFromDraft,
  resolveConflict,
  saveSession,
  sessionDraftFromEvent
} from "../src/lib/groupExamForm.ts";
import { sessionToFields } from "../src/lib/groupExams.ts";

const session = (patch = {}) => ({
  id: "gexam_a",
  groupId: "g1",
  courseKey: "id:farm-spec",
  courseId: "farm-spec",
  courseName: "Farmacologia Speciale",
  date: "2027-01-12",
  kind: "preappello",
  label: "",
  time: "09:30",
  room: "Aula C03",
  notes: "",
  registrationOpens: null,
  registrationCloses: null,
  barbSessionId: null,
  source: "member",
  version: 1,
  createdBy: "u-bea",
  createdByName: "Bea",
  updatedBy: "u-bea",
  updatedByName: "Bea",
  deletedAt: null,
  deletedByName: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  ...patch
});

/** Finto writer: risponde con le risposte in coda e ricorda le chiamate. */
const fakeWriter = (...answers) => {
  const calls = [];
  return {
    calls,
    saveSession: async (groupId, id, expectedVersion, fields) => {
      calls.push({ groupId, id, expectedVersion, fields });
      return answers.shift();
    }
  };
};

test("una bozza da un appello BARB prende tipo, ora, sede e iscrizioni", () => {
  const draft = draftFromBarb(
    { id: "farm-spec:2027-01-12:written", courseId: "farm-spec", date: "2027-01-12", type: "written", time: "09:30", location: "Aula G24", notes: null, registrationOpens: "2026-12-01", registrationCloses: "2027-01-08T23:59:00", component: "Modulo A" },
    "Farmacologia Speciale"
  );
  assert.equal(draft.kind, "scritto");
  assert.equal(draft.time, "09:30");
  assert.equal(draft.room, "Aula G24");
  assert.equal(draft.registrationCloses, "2027-01-08");
  assert.equal(draft.source, "barb");
  assert.equal(draft.barbSessionId, "farm-spec:2027-01-12:written");
  assert.equal(draft.notes, "Modulo A");
  const fields = fieldsFromDraft(draft);
  assert.equal(fields.ok, true);

  const odd = draftFromBarb({ id: "id con spazi", courseId: "farm-spec", date: "2027-01-12", type: "boh", time: null, location: null, notes: null, registrationOpens: null, registrationCloses: null }, "Farmacologia");
  assert.equal(odd.kind, "appello");
  assert.equal(odd.source, "member");
  assert.equal(odd.barbSessionId, "");
});

test("una bozza da un mio evento d'esame: giorno, ora e materia", () => {
  const subjects = [{ id: "s1", name: "Farmacologia Speciale", universityCourseId: "farm-spec" }];
  const allDay = sessionDraftFromEvent({ id: "e1", title: "Appello · Farmacologia Speciale", start: "2027-01-12T00:00:00", allDay: true, subjectId: "s1", description: "Porta il libretto" }, subjects);
  assert.equal(allDay.date, "2027-01-12");
  assert.equal(allDay.time, "");
  assert.equal(allDay.subjectId, "s1");
  assert.equal(allDay.courseId, "farm-spec");
  assert.equal(allDay.notes, "Porta il libretto");
  const timed = sessionDraftFromEvent({ id: "e2", title: "Appello · Chimica", start: "2027-02-03T10:15:00", allDay: false, description: "" }, subjects);
  assert.equal(timed.courseName, "Chimica");
  assert.equal(timed.time, "10:15");
  assert.equal(emptyDraft("2027-03-01").date, "2027-03-01");
});

test("i campi sbagliati si fermano prima di scrivere, con il messaggio del server", () => {
  const result = fieldsFromDraft({ ...emptyDraft(), courseName: "Farmacologia", date: "2027-02-30" });
  assert.equal(result.ok, false);
  assert.equal(result.field, "date");
});

test("un doppione nel gruppo si trova prima di scrivere", async () => {
  const writer = fakeWriter();
  const mine = sessionToFields(session({ id: "x" }));
  const outcome = await saveSession(writer, { groupId: "g1", id: "gexam_new", base: null, mine, sessions: [session()] });
  assert.equal(outcome.kind, "duplicate");
  assert.equal(outcome.twin.id, "gexam_a");
  assert.equal(writer.calls.length, 0);
});

test("modifiche a campi diversi si uniscono e si salvano di nuovo sulla versione attuale", async () => {
  const base = session();
  const current = session({ room: "Aula G24", version: 2, updatedByName: "Ada" });
  const mine = { ...sessionToFields(base), time: "10:00" };
  const writer = fakeWriter({ status: "conflict", row: current }, { status: "ok", row: session({ room: "Aula G24", time: "10:00", version: 3 }) });
  const outcome = await saveSession(writer, { groupId: "g1", id: base.id, base, mine, sessions: [current] });
  assert.equal(outcome.kind, "saved");
  assert.deepEqual(outcome.mergedFrom, { name: "Ada", fields: ["room"] });
  assert.equal(writer.calls[0].expectedVersion, 1);
  assert.equal(writer.calls[1].expectedVersion, 2);
  assert.equal(writer.calls[1].fields.room, "Aula G24");
  assert.equal(writer.calls[1].fields.time, "10:00");
});

test("lo stesso campo cambiato da entrambi è un conflitto: si sceglie campo per campo", async () => {
  const base = session();
  const current = session({ date: "2027-01-13", version: 2, updatedByName: "Ada" });
  const mine = { ...sessionToFields(base), date: "2027-01-14", room: "Aula B" };
  const writer = fakeWriter({ status: "conflict", row: current });
  const outcome = await saveSession(writer, { groupId: "g1", id: base.id, base, mine, sessions: [current] });
  assert.equal(outcome.kind, "conflict");
  assert.deepEqual(outcome.conflicts, ["date"]);
  assert.equal(fieldText(outcome.mine, "date"), "14/01/2027");
  assert.equal(fieldText(outcome.theirs, "date"), "13/01/2027");
  assert.equal(resolveConflict(outcome, {}).date, "2027-01-14");
  assert.equal(resolveConflict(outcome, { date: "theirs" }).date, "2027-01-13");
  assert.equal(resolveConflict(outcome, { date: "theirs" }).room, "Aula B");
});

test("eliminato nel frattempo, permesso negato, rete assente", async () => {
  const base = session();
  const gone = await saveSession(fakeWriter({ status: "gone", row: session({ deletedAt: "2026-11-02T10:00:00Z", deletedByName: "Olga" }) }), {
    groupId: "g1", id: base.id, base, mine: sessionToFields(base), sessions: []
  });
  assert.equal(gone.kind, "gone");
  assert.equal(gone.current.deletedByName, "Olga");
  const denied = await saveSession(fakeWriter({ status: "denied", message: "Solo i membri del gruppo possono aggiungere appelli." }), {
    groupId: "g1", id: base.id, base, mine: sessionToFields(base), sessions: []
  });
  assert.deepEqual(denied, { kind: "error", message: "Solo i membri del gruppo possono aggiungere appelli." });
  const offline = await saveSession({ saveSession: async () => { throw new Error("Serve la connessione per cambiare gli appelli del gruppo."); } }, {
    groupId: "g1", id: base.id, base, mine: sessionToFields(base), sessions: []
  });
  assert.equal(offline.kind, "error");
  assert.match(offline.message, /connessione/);
});

test("una creazione ripetuta dopo un errore di rete ritrova la propria riga", async () => {
  const mine = sessionToFields(session());
  const outcome = await saveSession(fakeWriter({ status: "conflict", row: session({ id: "gexam_mine" }) }), { groupId: "g1", id: "gexam_mine", base: null, mine, sessions: [] });
  assert.equal(outcome.kind, "saved");
  assert.equal(outcome.session.id, "gexam_mine");
});

test("campi cambiati tra due versioni", () => {
  const a = sessionToFields(session());
  const b = { ...a, courseName: "Farmacologia speciale II", room: "Aula B" };
  assert.deepEqual(changedSessionFields(a, b), ["course", "room"]);
});
