// Azioni dello store per raccolte, flashcard, quiz, sessioni e richieste agli agenti.
import test from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import * as learning from "../src/store/learning.ts";

const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };
const seed = () =>
  useStudyStore.setState({
    loading: false,
    locked: false,
    subjects: [{ id: "sub_chim", name: "Chimica", ...stamp }],
    exams: [],
    topics: [],
    decks: [],
    flashcards: [],
    quizzes: [],
    quizQuestions: [],
    cardStates: [],
    studyRuns: [],
    aiAnalyses: [],
    aiRequests: []
  });
const s = () => useStudyStore.getState();

test("raccolte annidate: materia ereditata da schede e quiz, spostamenti senza cicli", async () => {
  seed();
  const root = await learning.createDeck({ title: "Chimica generale", subjectId: "sub_chim", kind: "topic" });
  const chapter = await learning.createDeck({ title: "Cap. 3 Stechiometria", parentId: root.id, kind: "chapter" });
  const card = await learning.createCard(chapter.id, { front: "Mole?", back: "6,022·10^23^ entità" });
  assert.equal(card.subjectId, "sub_chim", "materia dalla raccolta madre");
  assert.equal(card.revision, 1);
  assert.equal(card.position, 1);
  await assert.rejects(learning.updateDeck(root.id, { parentId: chapter.id }), /sé stessa/);
  await assert.rejects(learning.createDeck({ title: "" }), /title/);
  await learning.updateDeck(root.id, { subjectId: null });
  assert.equal(s().flashcards[0].subjectId, undefined, "cambio di materia riallinea le schede");
  await learning.updateDeck(root.id, { subjectId: "sub_chim" });
  assert.equal(s().flashcards[0].subjectId, "sub_chim");
  assert.ok(s().flashcards[0].updatedAt > card.updatedAt);
});

test("modifica di una scheda: la revisione sale solo col contenuto", async () => {
  seed();
  const deck = await learning.createDeck({ title: "D" });
  const card = await learning.createCard(deck.id, { front: "A", back: "B" });
  const tagged = await learning.updateCard(card.id, { tags: ["x"] });
  assert.equal(tagged.revision, 1);
  const edited = await learning.updateCard(card.id, { back: [{ type: "text", text: "C" }] });
  assert.equal(edited.revision, 2);
  await assert.rejects(learning.updateCard(card.id, { front: [{ type: "image", url: "javascript:alert(1)", alt: "x" }] }), /https/);
  assert.equal(s().flashcards[0].revision, 2, "un input non valido non scrive nulla");
});

test("ripasso: risposte, stati, sessione salvata solo alla prima risposta", async () => {
  seed();
  const deck = await learning.createDeck({ title: "D", subjectId: "sub_chim" });
  const a = await learning.createCard(deck.id, { front: "A", back: "a" });
  const b = await learning.createCard(deck.id, { front: "B", back: "b" });
  let run = learning.newRun({ kind: "flashcards", mode: "review", title: "Ripasso", deckIds: [deck.id], subjectIds: ["sub_chim"], itemIds: [a.id, b.id] });
  assert.equal(s().studyRuns.length, 0);
  run = await learning.recordCardAnswer(run, { id: a.id, deckId: deck.id, subjectId: "sub_chim", revision: 1 }, "correct", 4200);
  run = await learning.recordCardAnswer(run, { id: b.id, deckId: deck.id, revision: 1 }, "skip", 900);
  run = await learning.recordCardAnswer(run, { id: b.id, deckId: deck.id, revision: 1 }, "wrong", 3000);
  assert.equal(s().studyRuns.length, 1);
  assert.deepEqual(s().studyRuns[0].events.map((event) => event.r), ["correct", "skip", "wrong"]);
  assert.equal(s().cardStates.length, 2, "salta non crea uno stato");
  const stateB = s().cardStates.find((item) => item.id === b.id);
  assert.equal(stateB.lapses, 1);
  assert.equal(stateB.revision, 1);
  await learning.finishRun(run.id);
  assert.ok(s().studyRuns[0].endedAt);
  await learning.finishRun("run_inesistente");
  await learning.resetCardStates([b.id]);
  assert.equal(s().cardStates.length, 1);
});

test("eliminare una raccolta toglie sotto-raccolte, schede, quiz, stati propri; lo storico resta", async () => {
  seed();
  const root = await learning.createDeck({ title: "Root" });
  const child = await learning.createDeck({ title: "Child", parentId: root.id });
  const other = await learning.createDeck({ title: "Altro" });
  const card = await learning.createCard(child.id, { front: "A", back: "a" });
  const keep = await learning.createCard(other.id, { front: "K", back: "k" });
  const quiz = await learning.createQuiz({ title: "Quiz", deckId: root.id });
  const question = await learning.saveQuestion(quiz.id, { kind: "single", prompt: "?", options: [{ text: "sì", correct: true }, { text: "no", correct: false }] });
  let run = learning.newRun({ kind: "flashcards", mode: "free", title: "", deckIds: [], subjectIds: [], itemIds: [] });
  run = await learning.recordCardAnswer(run, { id: card.id }, "correct", 100);
  // stato di una scheda condivisa da un'altra persona con lo stesso id: non si tocca
  useStudyStore.setState({ cardStates: [...s().cardStates, { ...s().cardStates[0], ownerId: "u-altro", id: "card_condivisa" }] });
  const request = await learning.createAiRequest({ kind: "explain_question", style: "simple", prompt: "", targetId: question.id });
  const removed = await learning.deleteDeck(root.id);
  assert.deepEqual(removed, { decks: 2, flashcards: 1, quizzes: 1, quizQuestions: 1 });
  assert.deepEqual(s().decks.map((item) => item.id), [other.id]);
  assert.deepEqual(s().flashcards.map((item) => item.id), [keep.id]);
  assert.equal(s().quizzes.length, 0);
  assert.equal(s().quizQuestions.length, 0);
  assert.deepEqual(s().cardStates.map((item) => item.id), ["card_condivisa"]);
  assert.equal(s().studyRuns.length, 1, "storico delle sessioni conservato");
  assert.equal(s().aiRequests.find((item) => item.id === request.id).status, "cancelled");
});

test("duplicare una raccolta crea una copia indipendente nella libreria", async () => {
  seed();
  const bundle = {
    decks: [{ id: "deck_x", title: "Di Bea", description: "", kind: "topic", position: 1, subjectId: "sub_bea", ...stamp }],
    flashcards: [{ id: "card_x", deckId: "deck_x", subjectId: "sub_bea", front: [{ type: "text", text: "F" }], back: [{ type: "text", text: "B" }], position: 1, revision: 4, ...stamp }],
    quizzes: [],
    quizQuestions: []
  };
  const copy = await learning.duplicateDeck(bundle, "deck_x", { subjectId: "sub_chim", title: "Di Bea (copia)" });
  assert.equal(s().decks.length, 1);
  assert.equal(s().decks[0].title, "Di Bea (copia)");
  assert.equal(s().decks[0].subjectId, "sub_chim");
  assert.notEqual(s().flashcards[0].id, "card_x");
  assert.equal(s().flashcards[0].revision, 1);
  assert.equal(copy.flashcards.length, 1);
  await assert.rejects(learning.duplicateDeck(bundle, "deck_nessuno"), /non trovata/);
});

test("quiz: domande con id di opzione stabili, revisione e tentativo salvato", async () => {
  seed();
  const quiz = await learning.createQuiz({ title: "Acidi e basi", timeLimitMinutes: 20 });
  const q = await learning.saveQuestion(quiz.id, {
    kind: "multiple",
    prompt: "Quali sono acidi forti?",
    options: [
      { text: "HCl", correct: true },
      { text: "CH3COOH", correct: false, feedback: "Acido debole" },
      { text: "HNO3", correct: true }
    ],
    explanation: "Si dissociano completamente."
  });
  assert.deepEqual(q.options.map((option) => option.id), ["o1", "o2", "o3"]);
  const reordered = await learning.saveQuestion(quiz.id, { options: [{ text: "HNO3", correct: true }, { text: "HCl", correct: true }, { text: "CH3COOH", correct: false }] }, q.id);
  assert.deepEqual(reordered.options.map((option) => option.id), ["o3", "o1", "o2"], "riordinare non cambia gli id");
  assert.equal(reordered.revision, 2);
  await assert.rejects(learning.saveQuestion(quiz.id, { kind: "single" }, q.id), /esattamente 1/);
  const run = learning.newRun({ kind: "quiz", mode: "exam", title: quiz.title, quizId: quiz.id, deckIds: [], subjectIds: [], itemIds: [q.id] });
  const saved = await learning.saveQuizAttempt(run, [{ i: q.id, r: "correct", c: ["o1", "o3"], at: new Date().toISOString() }]);
  assert.equal(saved.score, 1);
  assert.equal(s().studyRuns.length, 1);
  await learning.deleteQuiz(quiz.id);
  assert.equal(s().quizQuestions.length, 0);
});

test("richieste: annullare, pubblicare la spiegazione nella scheda", async () => {
  seed();
  const deck = await learning.createDeck({ title: "D" });
  const card = await learning.createCard(deck.id, { front: "A", back: "a" });
  const request = await learning.createAiRequest({ kind: "explain_card", style: "example", prompt: "con un esempio", targetId: card.id });
  assert.equal(request.status, "pending");
  await assert.rejects(learning.publishExplanation(request.id), /non trovata/);
  useStudyStore.setState({
    aiRequests: s().aiRequests.map((item) => ({ ...item, status: "completed", result: { blocks: [{ type: "text", text: "Esempio: …" }], agent: { kind: "agent", name: "Claude" } } }))
  });
  const published = await learning.publishExplanation(request.id);
  assert.deepEqual(published.explanation, [{ type: "text", text: "Esempio: …" }]);
  assert.equal(published.revision, 2);
  const other = await learning.createAiRequest({ kind: "analysis", style: "deep", prompt: "" });
  await learning.cancelAiRequest(other.id);
  assert.equal(s().aiRequests.find((item) => item.id === other.id).status, "cancelled");
  await learning.deleteAiRequest(other.id);
  assert.equal(s().aiRequests.length, 1);
});

test("eliminare una materia lascia raccolte e schede, senza materia", async () => {
  seed();
  const deck = await learning.createDeck({ title: "D", subjectId: "sub_chim" });
  await learning.createCard(deck.id, { front: "A", back: "a" });
  await s().deleteSubject("sub_chim");
  assert.equal(s().decks.length, 1);
  assert.equal(s().decks[0].subjectId, undefined);
  assert.equal(s().flashcards[0].subjectId, undefined);
});

test("workspace bloccato: nessuna scrittura", async () => {
  seed();
  useStudyStore.setState({ locked: true });
  await assert.rejects(learning.createDeck({ title: "D" }), /bloccato/);
  useStudyStore.setState({ locked: false });
});
