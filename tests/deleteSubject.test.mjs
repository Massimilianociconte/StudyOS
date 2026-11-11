import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { SUBJECT_REMOVE_TEXT } from "../src/lib/labels/subjects.ts";

// Solo memoria: con `loading` attivo la persistenza non scrive (niente IndexedDB in Node).
const store = useStudyStore;
const OLD = "2026-11-01T10:00:00.000Z";

beforeEach(() => {
  store.setState({
    loading: true,
    subjects: [
      { id: "s1", name: "Analisi 1", status: "archived", updatedAt: OLD },
      { id: "s2", name: "Fisica", status: "active", updatedAt: OLD }
    ],
    exams: [
      { id: "x1", subjectId: "s1", date: OLD, grade: 28, updatedAt: OLD },
      { id: "x2", subjectId: "s2", date: OLD, updatedAt: OLD }
    ],
    topics: [
      { id: "p1", subjectId: "s1", title: "Limiti", updatedAt: OLD },
      { id: "p2", subjectId: "s2", title: "Cinematica", updatedAt: OLD }
    ],
    tasks: [
      { id: "t1", subjectId: "s1", title: "Esercizi", updatedAt: OLD },
      { id: "t2", subjectId: "s2", title: "Relazione", updatedAt: OLD }
    ],
    events: [{ id: "e1", subjectId: "s1", title: "Lezione", start: OLD, end: OLD, updatedAt: OLD }],
    sessions: [{ id: "n1", subjectId: "s1", title: "Ripasso", updatedAt: OLD }],
    widgets: [{ id: "w1", subjectId: "s1", visible: true, updatedAt: OLD }],
    attachments: [
      { id: "a1", name: "Dispense", linkedEntityType: "subject", linkedEntityId: "s1", updatedAt: OLD },
      { id: "a2", name: "Tracce", linkedEntityType: "exam", linkedEntityId: "x1", updatedAt: OLD },
      { id: "a3", name: "Formulario", linkedEntityType: "subject", linkedEntityId: "s2", updatedAt: OLD }
    ],
    notes: [{ id: "o1", title: "Appunti", linkedEntityType: "studyTopic", linkedEntityId: "p1", updatedAt: OLD }],
    reminders: [{ id: "r1", title: "Iscriviti", linkedEntityType: "exam", linkedEntityId: "x1", updatedAt: OLD }]
  });
});

test("elimina materia: spariscono la materia, i suoi esami e i suoi argomenti", async () => {
  await store.getState().deleteSubject("s1");
  const state = store.getState();
  assert.deepEqual(state.subjects.map((subject) => subject.id), ["s2"]);
  assert.deepEqual(state.exams.map((exam) => exam.id), ["x2"]);
  assert.deepEqual(state.topics.map((topic) => topic.id), ["p2"]);
});

test("elimina materia: attività, eventi, sessioni e widget restano, senza materia e con updatedAt nuovo", async () => {
  await store.getState().deleteSubject("s1");
  const state = store.getState();
  for (const item of [state.tasks[0], state.events[0], state.sessions[0], state.widgets[0]]) {
    assert.equal(item.subjectId, undefined, item.id);
    assert.notEqual(item.updatedAt, OLD, `${item.id}: deve vincere per LWW anche sugli altri dispositivi`);
  }
});

test("elimina materia: materiali, note e promemoria collegati a materia, esami o argomenti si staccano", async () => {
  await store.getState().deleteSubject("s1");
  const state = store.getState();
  const [dispense, tracce] = state.attachments;
  for (const item of [dispense, tracce, state.notes[0], state.reminders[0]]) {
    assert.equal(item.linkedEntityType, undefined, item.id);
    assert.equal(item.linkedEntityId, undefined, item.id);
  }
});

test("elimina materia: i dati delle altre materie restano gli stessi oggetti (il diff non li riscrive)", async () => {
  const before = store.getState();
  await store.getState().deleteSubject("s1");
  const after = store.getState();
  assert.equal(after.subjects[0], before.subjects[1]);
  assert.equal(after.exams[0], before.exams[1]);
  assert.equal(after.tasks[1], before.tasks[1]);
  assert.equal(after.attachments[2], before.attachments[2]);
});

test("elimina materia: la conferma dice cosa si cancella, voti compresi solo se ci sono", () => {
  assert.equal(
    SUBJECT_REMOVE_TEXT.confirm("Analisi 1", 2, 1, 1),
    "Eliminare per sempre «Analisi 1»? Si cancellano anche 2 esami (voti compresi) e 1 argomento. Attività, eventi, sessioni e materiali restano, senza materia. Non si può annullare."
  );
  assert.equal(
    SUBJECT_REMOVE_TEXT.confirm("Fisica", 1, 0, 0),
    "Eliminare per sempre «Fisica»? Si cancella anche 1 esame. Attività, eventi, sessioni e materiali restano, senza materia. Non si può annullare."
  );
  assert.equal(
    SUBJECT_REMOVE_TEXT.confirm("Chimica", 0, 0, 0),
    "Eliminare per sempre «Chimica»? Attività, eventi, sessioni e materiali restano, senza materia. Non si può annullare."
  );
});
