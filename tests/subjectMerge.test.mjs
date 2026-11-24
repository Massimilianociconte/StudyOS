// Unione di materie doppie e blocco dei doppioni certi nello store (app, agenti e connettore remoto).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import { useSharedStore } from "../src/store/useSharedStore.ts";
import { COLLECTIONS, pickCollections } from "../src/lib/collections.ts";
import { baselineFrom, diffCollections } from "../src/lib/persistence.ts";
import { mergeSubjectNotes, mergedSubject, repointSubject } from "../src/lib/subjectMerge.ts";
import { SubjectDuplicateError } from "../src/lib/subjectIdentity.ts";

const store = useStudyStore;
const OLD = "2026-11-01T10:00:00.000Z";
const base = { createdAt: OLD, updatedAt: OLD, archived: false, tags: [] };

// Come l'account reale: la materia del catalogo ha gli eventi, il doppione dell'agente esami e attività,
// e le note di monitoraggio sono copiate in tutte e due.
const MONITOR = "=== MONITORAGGIO ===\nStudio concluso.\n=== FINE MONITORAGGIO ===";
const KEEP = {
  ...base,
  id: "anat-barb",
  name: "Anatomia dell'uomo",
  teacher: "Cappelletti Graziella",
  color: "#7CF7C8",
  icon: "barb:c39",
  cfu: 6,
  semester: "1° semestre 2026/2027",
  status: "active",
  universityCourseId: "c39",
  tags: ["barb"],
  notes: `Scheda ufficiale: https://example.org\n\n${MONITOR}`
};
const DROP = {
  ...base,
  id: "anat-agent",
  name: "Anatomia Umana",
  teacher: "Graziella Cappelletti",
  color: "#7CF7C8",
  icon: "BookOpen",
  cfu: 0,
  semester: "1° semestre 2026–27",
  status: "review",
  targetGrade: 28,
  tags: ["parziale"],
  notes: `PARZIALE 23/11/2026 ore 09:00.\n\n${MONITOR}`
};
const OTHER = { ...base, id: "pat", name: "Patologia", teacher: "", color: "#9FB7FF", icon: "BookOpen", cfu: 6, semester: "", status: "active", notes: "" };

const fixture = () => ({
  loading: true,
  subjects: [KEEP, DROP, OTHER],
  exams: [{ ...base, id: "x1", subjectId: "anat-agent", date: "2026-11-23T08:00:00.000Z", preparation: 100, status: "studying", program: [] }],
  topics: [{ ...base, id: "p1", subjectId: "anat-agent", title: "Neurogenesi" }],
  tasks: [
    { ...base, id: "t1", subjectId: "anat-agent", title: "Quiz", status: "todo" },
    { ...base, id: "t2", subjectId: "pat", title: "Altro", status: "todo" }
  ],
  events: [{ ...base, id: "e1", subjectId: "anat-barb", title: "Lezione", start: OLD, end: OLD }],
  sessions: [{ ...base, id: "n1", subjectId: "anat-agent", title: "Ripasso" }],
  widgets: [{ ...base, id: "w1", subjectId: "anat-agent", visible: true }],
  attachments: [{ ...base, id: "a1", name: "Dispense", linkedEntityType: "subject", linkedEntityId: "anat-agent" }],
  notes: [{ ...base, id: "o1", title: "Appunti", linkedEntityType: "subject", linkedEntityId: "anat-agent" }],
  reminders: [{ ...base, id: "r1", title: "Iscriviti", linkedEntityType: "exam", linkedEntityId: "x1" }],
  examPlans: [{ ...base, id: "pl1", subjectId: "anat-agent", examId: "x1" }],
  decks: [{ ...base, id: "d1", subjectId: "anat-agent", title: "Mazzo" }],
  flashcards: [{ ...base, id: "f1", subjectId: "anat-agent", deckId: "d1" }],
  quizzes: [{ ...base, id: "q1", subjectId: "anat-agent", title: "Quiz" }],
  quizQuestions: [{ ...base, id: "qq1", subjectId: "anat-agent", quizId: "q1" }],
  cardStates: [{ ...base, id: "cs1", subjectId: "anat-agent", cardId: "f1" }],
  studyRuns: [{ ...base, id: "sr1", subjectIds: ["anat-agent", "anat-barb", "pat"] }],
  aiAnalyses: [{ ...base, id: "ai1", scope: { subjectIds: ["anat-agent"], deckIds: [] }, sections: [{ title: "x", refs: [{ type: "subject", id: "anat-agent" }, { type: "deck", id: "d1" }] }] }],
  aiRequests: [{ ...base, id: "ar1", scope: { subjectIds: ["anat-agent"], deckIds: [] } }],
  studyMarks: [{ ...base, id: "sm1", subjectId: "anat-agent" }],
  goals: [],
  tags: [],
  preferences: [],
  notifications: [],
  studyGroups: [],
  groupInvites: [],
  groupResources: [],
  groupActivities: []
});

beforeEach(() => {
  store.setState(fixture());
  useSharedStore.setState({ given: [] });
});

test("unione: l'id tolto non resta da nessuna parte, nessun oggetto si perde", async () => {
  const before = pickCollections(store.getState());
  const counts = Object.fromEntries(COLLECTIONS.map((key) => [key, before[key].length]));
  const result = await store.getState().mergeSubjects("anat-barb", "anat-agent");
  const after = pickCollections(store.getState());
  assert.ok(!JSON.stringify(after).includes("anat-agent"), "nessun riferimento alla materia tolta");
  for (const key of COLLECTIONS) assert.equal(after[key].length, key === "subjects" ? counts[key] - 1 : counts[key], key);
  assert.deepEqual(after.aiAnalyses[0].sections[0].refs, [{ type: "subject", id: "anat-barb" }, { type: "deck", id: "d1" }]);
  assert.deepEqual(after.studyRuns[0].subjectIds, ["anat-barb", "pat"], "senza ripetere la materia che resta");
  assert.equal(after.exams[0].subjectId, "anat-barb");
  assert.equal(after.attachments[0].linkedEntityId, "anat-barb");
  assert.equal(result.moved.tasks, 1);
  assert.equal(result.moved.exams, 1);
});

test("unione: per il cloud una sola eliminazione e solo le righe spostate", async () => {
  const base0 = baselineFrom(pickCollections(store.getState()));
  await store.getState().mergeSubjects("anat-barb", "anat-agent");
  const diff = diffCollections(pickCollections(store.getState()), base0);
  assert.deepEqual(diff.deletes, { subjects: ["anat-agent"] });
  assert.deepEqual(diff.puts.subjects.map((item) => item.id), ["anat-barb"]);
  assert.equal(diff.puts.tasks.length, 1, "l'attività di Patologia non si riscrive");
  assert.equal(diff.puts.events, undefined, "l'evento era già della materia che resta");
  for (const items of Object.values(diff.puts)) for (const item of items) assert.notEqual(item.updatedAt, OLD, item.id);
});

test("unione: i campi vuoti si completano, le note non si ripetono, lo stato più avanti vince", () => {
  const merged = mergedSubject(KEEP, DROP, "2026-11-24T10:00:00.000Z");
  assert.equal(merged.name, "Anatomia dell'uomo");
  assert.equal(merged.cfu, 6);
  assert.equal(merged.universityCourseId, "c39");
  assert.equal(merged.icon, "barb:c39");
  assert.equal(merged.targetGrade, 28);
  assert.equal(merged.status, "review");
  assert.deepEqual(merged.tags, ["barb", "parziale"]);
  assert.equal(merged.notes.split(MONITOR).length, 2, "il blocco copiato in tutte e due resta una volta");
  assert.ok(merged.notes.includes("— Da «Anatomia Umana» —\nPARZIALE 23/11/2026"));
  assert.equal(mergedSubject(KEEP, DROP, "x", "Anatomia Umana").name, "Anatomia Umana", "si può tenere l'altro nome");
  assert.equal(mergedSubject(KEEP, DROP, "x", "Nome inventato").name, "Anatomia dell'uomo");
  assert.equal(mergeSubjectNotes("a", "a", "X"), "a");
});

test("unione rifiutata: insegnamenti diversi, materia data in condivisione", async () => {
  store.setState({ subjects: [KEEP, { ...DROP, universityCourseId: "c40" }, OTHER] });
  await assert.rejects(() => store.getState().mergeSubjects("anat-barb", "anat-agent"), /insegnamenti diversi/);
  store.setState({ subjects: [KEEP, DROP, OTHER] });
  useSharedStore.setState({ given: [{ id: "g1", subjectIds: ["anat-agent"] }] });
  await assert.rejects(() => store.getState().mergeSubjects("anat-barb", "anat-agent"), /condivisa/);
  assert.equal(store.getState().subjects.length, 3, "niente cambiato");
});

test("timer in corso sulla materia tolta: passa a quella che resta", async () => {
  store.setState({ timer: { ...store.getState().timer, subjectId: "anat-agent" } });
  await store.getState().mergeSubjects("anat-barb", "anat-agent");
  assert.equal(store.getState().timer.subjectId, "anat-barb");
});

test("repoint: stesso oggetto se non c'è niente da cambiare; solo i riferimenti a una materia", () => {
  const item = { id: "t", subjectId: "x", nested: { list: [1, 2] } };
  assert.equal(repointSubject(item, "a", "b"), item);
  // Un mazzo o un'entità con lo stesso id per caso non cambiano.
  const refs = { refs: [{ type: "deck", id: "a" }], linkedEntityType: "exam", linkedEntityId: "a", id: "a" };
  assert.equal(repointSubject(refs, "a", "b"), refs);
});

test("doppioni certi: lo store non crea né rinomina una materia uguale a un'altra", async () => {
  await assert.rejects(() => store.getState().addSubject({ name: "  anatomia DELL'UOMO" }), (error) => error instanceof SubjectDuplicateError && error.existingId === "anat-barb");
  await assert.rejects(() => store.getState().addSubject({ name: "Altro", universityCourseId: "c39" }), /già collegato/);
  await assert.rejects(() => store.getState().updateSubject("pat", { name: "Anatomia Umana" }), SubjectDuplicateError);
  // Un doppione già salvato si può ancora modificare (senza cambiare nome) e la creazione normale funziona.
  await store.getState().updateSubject("anat-agent", { name: "Anatomia Umana", cfu: 6 });
  const id = await store.getState().addSubject({ name: "Istologia" });
  assert.ok(store.getState().subjects.some((subject) => subject.id === id));
});
