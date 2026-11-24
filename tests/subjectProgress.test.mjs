import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  activityProgress,
  examProgressSubject,
  isClosedForExams,
  isGradePending,
  programToAdd,
  reviewStatus,
  stepsStatus,
  subjectProgress,
  subjectsReachingFull,
  taskDoneSubject,
  taskShare,
  taskWeight
} from "../src/lib/subjectProgress.ts";
import { recordedSubjectIds } from "../src/lib/grades.ts";
import { subjectMenuItems } from "../src/lib/subjectCards.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const OLD = "2026-11-01T10:00:00.000Z";
const base = { createdAt: OLD, updatedAt: OLD, archived: false, tags: [] };
const subject = (id, status = "active", extra = {}) => ({ ...base, id, name: `Materia ${id}`, teacher: "", color: "#7CF7C8", icon: "BookOpen", cfu: 6, semester: "", status, notes: "", ...extra });
const task = (id, subjectId, status = "todo", extra = {}) => ({ ...base, id, title: id, description: "", subjectId, status, priority: "medium", subtasks: [], notes: "", ...extra });
const steps = (...done) => done.map((value, index) => ({ id: `st${index}`, text: `Passaggio ${index + 1}`, done: value }));
const topic = (id, subjectId, nextReviewDate, extra = {}) => ({ ...base, id, subjectId, title: id, nextReviewDate, ...extra });
const exam = (id, subjectId, extra = {}) => ({ ...base, id, subjectId, date: "2026-12-15T09:00:00.000Z", program: [], preparation: 40, targetGrade: 28, status: "studying", simulations: 0, frequentQuestions: [], ...extra });

test("progresso: senza esami conta le attività (le archiviate no); 100 solo con tutto fatto", () => {
  // Senza attività né esami non c'è un numero: «nessuna attività», non 0%.
  assert.equal(subjectProgress("s1", [], []).progress, null);
  assert.equal(subjectProgress("s1", [], []).source, "none");
  assert.equal(subjectProgress("s1", [task("a", "s1", "done"), task("b", "s1"), task("x", "s1", "archived")], []).progress, 50);
  assert.equal(subjectProgress("s1", [task("a", "s1", "done"), task("b", "s1", "done"), task("c", "s2")], []).progress, 100);
  // 199 su 200 non arrotonda a 100: la barra e la regola dicono la stessa cosa.
  const many = Array.from({ length: 200 }, (_, index) => task(`t${index}`, "s1", index ? "done" : "todo"));
  assert.equal(subjectProgress("s1", many, []).progress, 99);
});

test("progresso: con un esame da sostenere vale la sua preparazione (il primo per data), non le attività", () => {
  const tasks = [task("a", "s1", "done")];
  const exams = [exam("e2", "s1", { date: "2027-02-01T09:00:00.000Z", preparation: 90 }), exam("e1", "s1", { preparation: 60 }), exam("e0", "s1", { status: "done", preparation: 100 })];
  const result = subjectProgress("s1", tasks, exams);
  assert.equal(result.progress, 60);
  assert.equal(result.exam.id, "e1");
  assert.equal(subjectProgress("s1", tasks, [exam("e1", "s1", { preparation: 99.6 })]).progress, 99);
  assert.equal(subjectProgress("s1", tasks, [exam("e1", "s1", { preparation: 100 })]).progress, 100);
  // Esame già sostenuto: si torna alle attività.
  assert.equal(subjectProgress("s1", tasks, [exam("e0", "s1", { status: "done", preparation: 10 })]).progress, 100);
});

test("avanzamento attività: 5 attività al 20% l'una, una con 2 passaggi su 4 vale il 10%", () => {
  const tasks = [
    task("a", "s1", "done"),
    task("b", "s1", "todo", { subtasks: steps(true, true, false, false) }),
    task("c", "s1"),
    task("d", "s1"),
    task("e", "s1")
  ];
  const result = activityProgress("s1", tasks);
  assert.equal(result.percent, 30);
  assert.deepEqual({ counted: result.counted, done: result.done, partial: result.partial, excluded: result.excluded }, { counted: 5, done: 1, partial: 1, excluded: 0 });
  // Fatta con i passaggi aperti: conta intera (lo stato decide), nessun doppio conteggio.
  assert.equal(taskShare(task("x", "s1", "done", { subtasks: steps(false, false) })), 1);
  assert.equal(taskShare(task("x", "s1", "todo", { subtasks: steps(true, false, false, false) })), 0.25);
  assert.equal(taskShare(task("x", "s1")), 0);
});

test("avanzamento attività: tutti i passaggi spuntati senza la task fatta non arrivano al 100%", () => {
  const result = activityProgress("s1", [task("a", "s1", "todo", { subtasks: steps(true, true) })]);
  assert.equal(result.percent, 99);
  assert.equal(activityProgress("s1", [task("a", "s1", "done", { subtasks: steps(true, true) })]).percent, 100);
});

test("avanzamento attività: pesi, attività che non contano e attività di altre materie o senza materia", () => {
  assert.equal(taskWeight({}), 1);
  assert.equal(taskWeight({ progressWeight: 0 }), 0);
  assert.equal(taskWeight({ progressWeight: 3 }), 3);
  assert.equal(taskWeight({ progressWeight: 7 }), 1);
  assert.equal(taskWeight({ progressWeight: "2" }), 1);
  const tasks = [
    task("a", "s1", "done", { progressWeight: 3 }),
    task("b", "s1"),
    task("r", "s1", "todo", { progressWeight: 0 }),
    task("o", "s2", "done"),
    task("n", undefined, "done")
  ];
  const result = activityProgress("s1", tasks);
  assert.equal(result.percent, 75);
  assert.equal(result.excluded, 1);
  // Solo attività che non contano: niente numero, e la barra non è 0% né 100%.
  const onlyReview = activityProgress("s1", [task("r", "s1", "done", { progressWeight: 0 })]);
  assert.equal(onlyReview.percent, null);
  assert.equal(onlyReview.excluded, 1);
  assert.equal(subjectProgress("s1", [task("r", "s1", "done", { progressWeight: 0 })], []).progress, null);
});

test("passaggi e stato: tutti spuntati = fatta, uno tolto = riaperta, lo stato scelto vince", () => {
  const open = task("a", "s1", "todo", { subtasks: steps(true, false) });
  assert.equal(stepsStatus(open, { subtasks: steps(true, true) }), "done");
  // Il modulo dell'attività rimanda lo stato com'è a ogni salvataggio: non blocca la chiusura.
  assert.equal(stepsStatus(open, { status: "todo", subtasks: steps(true, true) }), "done");
  assert.equal(stepsStatus(open, { status: "doing", subtasks: steps(true, true) }), undefined);
  assert.equal(stepsStatus(open, { subtasks: steps(true, false) }), undefined);
  assert.equal(stepsStatus(open, { title: "x" }), undefined);
  const done = task("a", "s1", "done", { subtasks: steps(true, true) });
  assert.equal(stepsStatus(done, { subtasks: steps(true, false) }), "todo");
  assert.equal(stepsStatus(done, { status: "done", subtasks: steps(true, false) }), "todo");
  // Un passaggio nuovo, ancora da fare, non riapre una task fatta (nessun passaggio tolto).
  assert.equal(stepsStatus(done, { subtasks: [...steps(true, true), { id: "n", text: "Nuovo", done: false }] }), undefined);
  // Riaperta di proposito con i passaggi già tutti spuntati: modificarli non la richiude.
  const reopened = task("a", "s1", "todo", { subtasks: steps(true, true) });
  assert.equal(stepsStatus(reopened, { subtasks: [{ id: "st0", text: "Rinominato", done: true }, { id: "st1", text: "Passaggio 2", done: true }] }), undefined);
  assert.equal(stepsStatus(task("a", "s1", "archived", { subtasks: steps(false) }), { subtasks: steps(true) }), undefined);
  assert.equal(stepsStatus(task("a", "s1"), { subtasks: [] }), undefined);
});

test("ripasso: argomenti in tutto e da ripassare entro oggi (archiviati e altre materie esclusi)", () => {
  const now = new Date(2026, 10, 23, 10, 0);
  const topics = [
    topic("t1", "s1", new Date(2026, 10, 20).toISOString()),
    topic("t2", "s1", new Date(2026, 10, 23, 22, 0).toISOString()),
    topic("t3", "s1", new Date(2026, 10, 25).toISOString()),
    topic("t4", "s1", new Date(2026, 10, 20).toISOString(), { archived: true }),
    topic("t5", "s2", new Date(2026, 10, 20).toISOString())
  ];
  assert.deepEqual(reviewStatus("s1", topics, now), { total: 3, due: 2 });
  assert.deepEqual(reviewStatus("s3", topics, now), { total: 0, due: 0 });
});

test("programma al ripasso: conta solo i titoli nuovi, come li aggiunge lo store", () => {
  const topics = [{ subjectId: "s1", title: "Cuore" }, { subjectId: "s2", title: "Rene" }];
  assert.deepEqual(programToAdd("s1", ["  cuore ", "Rene", "Rene", "", "Polmone"], topics), ["Rene", "Polmone"]);
  assert.deepEqual(programToAdd("s1", ["Cuore"], topics), []);
});

test("candidate: solo un'attività appena segnata fatta o un esame con preparazione o stato cambiati", () => {
  assert.equal(taskDoneSubject(task("a", "s1"), task("a", "s1", "done")), "s1");
  assert.equal(taskDoneSubject(task("a", "s1", "done"), task("a", "s1", "done")), undefined);
  assert.equal(taskDoneSubject(task("a", "s1", "done"), task("a", "s1")), undefined);
  assert.equal(taskDoneSubject(task("a", undefined), task("a", undefined, "done")), undefined);
  assert.equal(examProgressSubject(exam("e", "s1"), exam("e", "s1", { preparation: 100 })), "s1");
  // Lo stato da solo non è progresso: «Sostenuto» col voto, o un esame riaperto, cambiano solo cosa misura la barra.
  assert.equal(examProgressSubject(exam("e", "s1"), exam("e", "s1", { status: "done" })), undefined);
  assert.equal(examProgressSubject(exam("e", "s1"), exam("e", "s1", { status: "done", preparation: 100, grade: 28 })), undefined);
  assert.equal(examProgressSubject(exam("e", "s1", { status: "done", preparation: 100 }), exam("e", "s1", { preparation: 100 })), undefined);
  assert.equal(examProgressSubject(exam("e", "s1"), exam("e", "s1", { date: "2027-01-10T09:00:00.000Z" })), undefined);
});

test("regola: conta il passaggio da sotto 100 a 100, non il livello", () => {
  const subjects = [subject("s1"), subject("s2")];
  const before = { tasks: [task("a", "s1", "done"), task("b", "s1"), task("c", "s2", "done")], exams: [] };
  const after = { tasks: [task("a", "s1", "done"), task("b", "s1", "done"), task("c", "s2", "done")], exams: [] };
  assert.deepEqual(subjectsReachingFull(subjects, ["s1"], before, after), ["s1"]);
  // s2 era già al 100%: una materia rimessa «In corso» a mano non torna completata da sola.
  assert.deepEqual(subjectsReachingFull(subjects, ["s2"], before, after), []);
  // Solo le candidate: caricare o sincronizzare dati già al 100% non cambia niente.
  assert.deepEqual(subjectsReachingFull(subjects, [], before, after), []);
  assert.deepEqual(subjectsReachingFull(subjects, [undefined], before, after), []);
});

test("regola: solo materie aperte; archiviate e già completate restano come sono", () => {
  const before = { tasks: [task("a", "s1")], exams: [] };
  const after = { tasks: [task("a", "s1", "done")], exams: [] };
  for (const status of ["not-started", "active", "review", "exam-ready"]) {
    assert.deepEqual(subjectsReachingFull([subject("s1", status)], ["s1"], before, after), ["s1"], status);
  }
  assert.deepEqual(subjectsReachingFull([subject("s1", "completed")], ["s1"], before, after), []);
  assert.deepEqual(subjectsReachingFull([subject("s1", "archived")], ["s1"], before, after), []);
  assert.deepEqual(subjectsReachingFull([subject("s1", "active", { archived: true })], ["s1"], before, after), []);
});

test("regola: da «nessuna attività che conta» al 100%; e i passaggi parziali non bastano", () => {
  const before = { tasks: [task("r", "s1", "done", { progressWeight: 0 }), task("a", "s1", "todo")], exams: [] };
  const after = { tasks: [task("r", "s1", "done", { progressWeight: 0 }), task("a", "s1", "done")], exams: [] };
  assert.deepEqual(subjectsReachingFull([subject("s1")], ["s1"], before, after), ["s1"]);
  const partial = { tasks: [task("a", "s1", "todo", { subtasks: steps(true, true) })], exams: [] };
  assert.deepEqual(subjectsReachingFull([subject("s1")], ["s1"], before, partial), []);
});

test("regola: la preparazione dell'esame al 100% completa la materia anche con attività aperte", () => {
  const tasks = [task("a", "s1")];
  const before = { tasks, exams: [exam("e1", "s1", { preparation: 90 })] };
  const after = { tasks, exams: [exam("e1", "s1", { preparation: 100 })] };
  assert.deepEqual(subjectsReachingFull([subject("s1")], ["s1"], before, after), ["s1"]);
  // Ultima attività fatta, ma l'esame è al 60%: la materia non è al 100%.
  const withExam = { exams: [exam("e1", "s1", { preparation: 60 })] };
  assert.deepEqual(subjectsReachingFull([subject("s1")], ["s1"], { ...withExam, tasks }, { ...withExam, tasks: [task("a", "s1", "done")] }), []);
});

test("voto da registrare: completata senza voto né idoneità nel libretto", () => {
  const exams = [exam("e1", "s2", { status: "done", grade: 28 }), exam("e2", "s3", { status: "done", passFail: true }), exam("e3", "s4", { status: "done" })];
  const recorded = recordedSubjectIds(exams);
  assert.deepEqual([...recorded].sort(), ["s2", "s3"]);
  assert.equal(isGradePending(subject("s1", "completed"), recorded), true);
  assert.equal(isGradePending(subject("s2", "completed"), recorded), false);
  assert.equal(isGradePending(subject("s3", "completed"), recorded), false);
  // «Sostenuto» senza voto: il voto manca ancora.
  assert.equal(isGradePending(subject("s4", "completed"), recorded), true);
  assert.equal(isGradePending(subject("s1", "active"), recorded), false);
  assert.equal(isGradePending(subject("s1", "completed", { archived: true }), recorded), false);
});

test("menu della scheda: «Registra il voto» anche per le completate col voto da registrare", () => {
  assert.deepEqual(subjectMenuItems(subject("s1", "completed"), true), [{ kind: "status", status: "active" }, { kind: "complete" }, { kind: "other" }, { kind: "archive" }]);
  assert.deepEqual(subjectMenuItems(subject("s1", "completed"), false), [{ kind: "status", status: "active" }, { kind: "other" }, { kind: "archive" }]);
});

test("appelli: una completata col voto da registrare può ancora aggiungere l'appello, una superata no", () => {
  const recorded = new Set(["s2"]);
  assert.equal(isClosedForExams(subject("s1", "completed"), recorded), false);
  assert.equal(isClosedForExams(subject("s2", "completed"), recorded), true);
  assert.equal(isClosedForExams(subject("s1", "archived"), recorded), true);
  assert.equal(isClosedForExams(subject("s1", "active", { archived: true }), recorded), true);
  // Senza l'elenco dei voti ogni completata è chiusa, come prima.
  assert.equal(isClosedForExams(subject("s1", "completed")), true);
});

// Nello store: la regola vale per ogni chiamante (schermate e agenti) e scrive tutto in un salvataggio.
const store = useStudyStore;
beforeEach(() => {
  store.setState({
    loading: true,
    subjects: [subject("s1"), subject("s2", "active")],
    tasks: [task("a", "s1", "done"), task("b", "s1"), task("c", "s2", "done"), task("d", "s2")],
    exams: [exam("e2", "s2", { preparation: 80 })],
    notifications: []
  });
});

test("store: l'ultima attività fatta completa la materia e avvisa nelle notifiche", async () => {
  await store.getState().toggleTask("b");
  const s1 = store.getState().subjects.find((item) => item.id === "s1");
  assert.equal(s1.status, "completed");
  assert.notEqual(s1.updatedAt, OLD);
  const [notice] = store.getState().notifications;
  assert.equal(notice.kind, "system");
  assert.equal(notice.linkView, "subjects");
  assert.match(notice.title, /Materia s1.*100%/);
  // Rimessa «In corso» a mano: un'altra attività già fatta non la ricompleta.
  await store.getState().updateSubject("s1", { status: "active" });
  await store.getState().updateTask("a", { title: "Capitolo 1" });
  assert.equal(store.getState().subjects.find((item) => item.id === "s1").status, "active");
});

test("store: con updateTask (come fanno gli agenti) e con la preparazione dell'esame al 100%", async () => {
  await store.getState().updateTask("b", { status: "done" });
  assert.equal(store.getState().subjects.find((item) => item.id === "s1").status, "completed");
  // s2 ha un esame all'80%: l'ultima attività fatta non basta.
  await store.getState().updateTask("d", { status: "done" });
  assert.equal(store.getState().subjects.find((item) => item.id === "s2").status, "active");
  await store.getState().updateExam("e2", { preparation: 100 });
  assert.equal(store.getState().subjects.find((item) => item.id === "s2").status, "completed");
  assert.equal(store.getState().notifications.length, 2);
});

test("store: aggiungere un'attività già fatta in una materia vuota non la completa", async () => {
  store.setState({ subjects: [subject("s3")], tasks: [], exams: [] });
  await store.getState().addTask({ title: "Lezione 1", subjectId: "s3", status: "done" });
  assert.equal(store.getState().subjects[0].status, "active");
  assert.equal(store.getState().notifications.length, 0);
});

test("store: registrare il voto su un esame a preparazione 0 con le attività fatte non è «voto da registrare»", async () => {
  store.setState({ subjects: [subject("s4")], tasks: [task("a", "s4", "done")], exams: [exam("e4", "s4", { preparation: 0 })] });
  // Come «Registra il voto» e studyos_record_grade: l'esame da sostenere diventa «Sostenuto» col voto.
  await store.getState().updateExam("e4", { status: "done", grade: 28, preparation: 100 });
  assert.equal(store.getState().subjects[0].status, "active");
  assert.equal(store.getState().notifications.length, 0);
});

test("store: un esame non superato riaperto (resta al 100%) non completa la materia", async () => {
  store.setState({ subjects: [subject("s5")], tasks: [], exams: [exam("e5", "s5", { status: "done", preparation: 100 })] });
  await store.getState().updateExam("e5", { status: "studying", grade: undefined, passFail: false });
  assert.equal(store.getState().subjects[0].status, "active");
  assert.equal(store.getState().notifications.length, 0);
});

test("store: materia rimessa «In corso» col voto già registrato si completa senza avviso «voto da registrare»", async () => {
  store.setState({ subjects: [subject("s6")], tasks: [task("a", "s6")], exams: [exam("e6", "s6", { status: "done", grade: 30 })] });
  await store.getState().toggleTask("a");
  assert.equal(store.getState().subjects[0].status, "completed");
  assert.equal(store.getState().notifications.length, 0);
});

test("store: spuntare l'ultimo passaggio chiude l'attività (con completedAt) e può completare la materia", async () => {
  store.setState({ subjects: [subject("s7")], tasks: [task("a", "s7", "todo", { subtasks: steps(true, false) })], exams: [] });
  await store.getState().updateTask("a", { subtasks: steps(true, true) });
  const [saved] = store.getState().tasks;
  assert.equal(saved.status, "done");
  assert.ok(saved.completedAt);
  assert.equal(store.getState().subjects[0].status, "completed");
  // Un passaggio tolto riapre l'attività; la materia resta come l'ha lasciata la regola (non torna indietro da sola).
  await store.getState().updateTask("a", { subtasks: steps(true, false) });
  assert.equal(store.getState().tasks[0].status, "todo");
  assert.equal(store.getState().tasks[0].completedAt, undefined);
});

test("store: il peso si salva solo se diverso da 1; riaprire un'attività ricalcola subito", async () => {
  store.setState({ subjects: [subject("s8")], tasks: [], exams: [] });
  await store.getState().addTask({ title: "Ripasso", subjectId: "s8", progressWeight: 0 });
  await store.getState().addTask({ title: "Capitolo", subjectId: "s8", progressWeight: 1 });
  const [chapter, review] = store.getState().tasks;
  assert.equal(review.progressWeight, 0);
  assert.equal("progressWeight" in chapter, false);
  await store.getState().toggleTask(chapter.id);
  assert.equal(activityProgress("s8", store.getState().tasks).percent, 100);
  await store.getState().toggleTask(chapter.id);
  assert.equal(activityProgress("s8", store.getState().tasks).percent, 0);
});

test("esame passato senza esito: niente preparazione in corso, niente completamento da solo", () => {
  const now = new Date(2026, 10, 24, 10, 0);
  const past = exam("e-parziale", "s1", { date: new Date(2026, 10, 23, 9, 0).toISOString(), preparation: 100 });
  const next = exam("e-orale", "s1", { date: new Date(2027, 0, 22, 9, 30).toISOString(), preparation: 10 });
  const today = exam("e-oggi", "s1", { date: new Date(2026, 10, 24, 18, 0).toISOString(), preparation: 60 });
  const tasks = [task("a", "s1", "done")];
  // Solo l'esame passato: la barra non c'è (null), l'esito è da registrare; le attività al 100% non completano.
  const pending = subjectProgress("s1", tasks, [past], now);
  assert.deepEqual([pending.progress, pending.source, pending.exam, pending.pendingExam?.id], [null, "pending", undefined, "e-parziale"]);
  // Con l'orale davanti si prepara quello; l'esame di oggi conta ancora come da preparare.
  assert.equal(subjectProgress("s1", tasks, [past, next], now).exam.id, "e-orale");
  assert.equal(subjectProgress("s1", tasks, [past, next, today], now).exam.id, "e-oggi");
  // Non superato con la data da decidere: resta da preparare anche se la data è passata.
  const toDecide = { ...past, tags: [`data-da-decidere:${past.date}`] };
  assert.equal(subjectProgress("s1", tasks, [toDecide], now).exam.id, "e-parziale");
});
