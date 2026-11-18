// Dubbi segnati (segno reversibile su flashcard e domande, gruppi per materia e argomento) e
// sessioni o quiz in pausa da riprendere esattamente da dove si erano fermati, anche altrove.
import test from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import * as learning from "../src/store/learning.ts";
import { groupDoubts, resolveDoubts, topicDeck } from "../src/lib/learnMarks.ts";
import { isResumable, pausedRuns, resumePoint } from "../src/lib/learnResume.ts";
import { prepareQuiz, preparedFromIds } from "../src/lib/learnSession.ts";
import { COLLECTIONS, ENTITY_TYPES } from "../src/lib/collections.ts";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };
const seed = () =>
  useStudyStore.setState({
    loading: false,
    locked: false,
    subjects: [{ id: "sub_bio", name: "Biochimica", ...stamp }],
    exams: [],
    topics: [],
    decks: [],
    flashcards: [],
    quizzes: [],
    quizQuestions: [],
    cardStates: [],
    studyRuns: [],
    aiAnalyses: [],
    aiRequests: [],
    studyMarks: []
  });
const s = () => useStudyStore.getState();
const option = (text, correct = false) => ({ text, correct });

test("i dubbi sono una collezione sincronizzata a sé", () => {
  assert.ok(COLLECTIONS.includes("studyMarks"));
  assert.equal(ENTITY_TYPES.studyMarks, "studyMark");
  assert.match(source("src/lib/db.ts"), /this\.version\(10\)\.stores\(\{\s*studyMarks: "id, updatedAt, kind"/);
  assert.match(source("src/lib/cloudSync.ts"), /const SYNC_SCHEMA = 6;/);
  assert.match(source("src/views/SettingsView.tsx"), /studyMarks: scope === "full" \? snapshot\.studyMarks : \[\]/);
  assert.match(source("src/data/defaults.ts"), /studyMarks: \[\]/);
});

test("dubbio su una flashcard: si segna, si toglie, resta uno solo", async () => {
  seed();
  const deck = await learning.createDeck({ title: "Glicolisi", subjectId: "sub_bio" });
  const card = await learning.createCard(deck.id, { front: "PFK-1?", back: "Regola la glicolisi" });
  const target = { kind: "card", id: card.id, deckId: deck.id, subjectId: card.subjectId };
  assert.equal(await learning.toggleMark(target), true);
  assert.equal(await learning.toggleMark(target, true), true, "segnare di nuovo non duplica");
  assert.equal(s().studyMarks.length, 1);
  assert.equal(s().studyMarks[0].id, card.id);
  assert.equal(s().studyMarks[0].subjectId, "sub_bio");
  assert.equal(await learning.toggleMark(target), false, "reversibile");
  assert.equal(s().studyMarks.length, 0);
});

test("eliminare scheda, domanda, quiz o raccolta toglie i loro dubbi (non quelli altrui)", async () => {
  seed();
  const deck = await learning.createDeck({ title: "D", subjectId: "sub_bio" });
  const a = await learning.createCard(deck.id, { front: "A", back: "a" });
  const b = await learning.createCard(deck.id, { front: "B", back: "b" });
  const quiz = await learning.createQuiz({ title: "Q", deckId: deck.id });
  const question = await learning.saveQuestion(quiz.id, { prompt: "?", options: [option("x", true), option("y")] });
  await learning.toggleMark({ kind: "card", id: a.id });
  await learning.toggleMark({ kind: "card", id: b.id });
  await learning.toggleMark({ kind: "question", id: question.id, quizId: quiz.id });
  await learning.toggleMark({ kind: "card", id: "card_altrui", ownerId: "acc_2" });
  await learning.deleteCards([a.id]);
  assert.deepEqual(s().studyMarks.map((mark) => mark.id).sort(), [b.id, "card_altrui", question.id].sort());
  await learning.deleteQuiz(quiz.id);
  assert.deepEqual(s().studyMarks.map((mark) => mark.id).sort(), [b.id, "card_altrui"].sort());
  await learning.deleteDeck(deck.id);
  assert.deepEqual(s().studyMarks.map((mark) => mark.id), ["card_altrui"], "il segno su una scheda condivisa resta");
  await learning.clearMarks(["card_altrui"]);
  assert.equal(s().studyMarks.length, 0);
});

test("dubbi raggruppati per materia e argomento (la raccolta «argomento» creata dall'assistente)", async () => {
  seed();
  const root = await learning.createDeck({ title: "Biochimica", subjectId: "sub_bio" });
  const metabolism = await learning.createDeck({ title: "Metabolismo", parentId: root.id, kind: "topic" });
  const glycolysis = await learning.createDeck({ title: "Glicolisi", parentId: metabolism.id, kind: "chapter" });
  const enzymes = await learning.createDeck({ title: "Enzimi", parentId: root.id, kind: "chapter" });
  const loose = await learning.createDeck({ title: "Sparse" });
  const c1 = await learning.createCard(glycolysis.id, { front: "1", back: "1" });
  const c2 = await learning.createCard(metabolism.id, { front: "2", back: "2" });
  const c3 = await learning.createCard(enzymes.id, { front: "3", back: "3" });
  const c4 = await learning.createCard(loose.id, { front: "4", back: "4" });
  const quiz = await learning.createQuiz({ title: "Prova", deckId: glycolysis.id });
  const q1 = await learning.saveQuestion(quiz.id, { prompt: "?", options: [option("x", true), option("y")] });
  const free = await learning.createQuiz({ title: "Libero", subjectId: "sub_bio" });
  const q2 = await learning.saveQuestion(free.id, { prompt: "?", options: [option("x", true), option("y")] });
  for (const card of [c1, c2, c3, c4]) await learning.toggleMark({ kind: "card", id: card.id });
  await learning.toggleMark({ kind: "question", id: q1.id, quizId: quiz.id });
  await learning.toggleMark({ kind: "question", id: q2.id, quizId: free.id });
  await learning.toggleMark({ kind: "card", id: "card_sparita" });

  assert.equal(topicDeck(s().decks, glycolysis.id).topic.id, metabolism.id, "capitolo sotto un argomento");
  assert.equal(topicDeck(s().decks, enzymes.id).topic.id, enzymes.id, "senza argomento: la raccolta stessa");

  const items = resolveDoubts(s().studyMarks, [{ bundle: { decks: s().decks, flashcards: s().flashcards, quizzes: s().quizzes, quizQuestions: s().quizQuestions } }]);
  assert.equal(items.length, 6, "il segno di una scheda che non esiste più si ignora");
  const groups = groupDoubts(items, s().decks);
  const bio = groups.find((group) => group.subjectId === "sub_bio");
  assert.equal(bio.cards, 3);
  assert.equal(bio.questions, 2);
  assert.equal(bio.topics[0].title, "Metabolismo", "l'argomento con più dubbi prima");
  assert.equal(bio.topics[0].path, "Biochimica");
  assert.deepEqual(bio.topics[0].cards.map((item) => item.card.id).sort(), [c1.id, c2.id].sort());
  assert.deepEqual(bio.topics[0].questions.map((item) => item.question.id), [q1.id]);
  assert.ok(bio.topics.some((topic) => topic.key === `quiz:${free.id}` && topic.title === "Libero"), "quiz senza raccolta: sotto il quiz");
  const none = groups.find((group) => !group.subjectId);
  assert.equal(none.cards, 1);
});

test("flashcard in pausa: si riprende dalla prima scheda senza risposta, poi si chiude", async () => {
  seed();
  const deck = await learning.createDeck({ title: "D" });
  const cards = [];
  for (const front of ["A", "B", "C"]) cards.push(await learning.createCard(deck.id, { front, back: front }));
  let run = learning.newRun({ kind: "flashcards", mode: "review", title: "Ripasso", deckIds: [], subjectIds: [], itemIds: cards.map((card) => card.id) });
  const ref = (card) => ({ id: card.id, deckId: card.deckId, revision: card.revision });
  run = (await learning.answerCard(run, ref(cards[0]), "correct", 1000, 1)).run;
  run = (await learning.answerCard(run, ref(cards[1]), "skip", 500, 2)).run;
  const stored = s().studyRuns.find((item) => item.id === run.id);
  assert.ok(isResumable(stored), "aperta e con un punto di ripresa");
  assert.equal(stored.progress.index, 2);
  const point = resumePoint(s().studyRuns, stored);
  assert.equal(point.index, 2, "la prima senza risposta (la saltata conta come vista)");
  assert.equal(point.done, 2);
  assert.equal(point.total, 3);
  assert.equal(point.answered.get(cards[0].id).event.r, "correct");
  assert.equal(pausedRuns(s().studyRuns).length, 1);

  await learning.finishRun(run.id);
  const ended = s().studyRuns.find((item) => item.id === run.id);
  assert.ok(ended.endedAt);
  assert.equal(ended.progress, undefined, "chiusa: niente più punto di ripresa");
  assert.equal(pausedRuns(s().studyRuns).length, 0);
});

test("una sessione vecchia senza punto di ripresa non compare tra quelle da riprendere", async () => {
  seed();
  const deck = await learning.createDeck({ title: "D" });
  const card = await learning.createCard(deck.id, { front: "A", back: "a" });
  const other = await learning.createCard(deck.id, { front: "B", back: "b" });
  const run = learning.newRun({ kind: "flashcards", mode: "review", title: "R", deckIds: [], subjectIds: [], itemIds: [card.id, other.id] });
  await learning.answerCard(run, { id: card.id, deckId: deck.id }, "correct", 100);
  assert.equal(pausedRuns(s().studyRuns).length, 0);
});

test("quiz in pausa: risposte, domande confermate e tempo si salvano senza eventi; poi il tentativo vero", async () => {
  seed();
  const quiz = await learning.createQuiz({ title: "Metabolismo", timeLimitMinutes: 10 });
  const questions = [];
  for (const text of ["Q1", "Q2", "Q3"]) questions.push(await learning.saveQuestion(quiz.id, { prompt: text, options: [option("giusta", true), option("no"), option("nemmeno")] }));
  const seedValue = 4242;
  const prepared = prepareQuiz(s().quizQuestions, { seed: seedValue, shuffle: true });
  const run = learning.newRun({ kind: "quiz", mode: "exam", title: quiz.title, quizId: quiz.id, deckIds: [], subjectIds: [], itemIds: prepared.map((item) => item.question.id) });
  const first = prepared[0];
  await learning.saveRunProgress(run, { index: 1, seed: seedValue, shuffle: true, answers: { [first.question.id]: [first.options[0].id] }, checked: [], elapsedMs: 61_000 });
  const stored = s().studyRuns.find((item) => item.id === run.id);
  assert.ok(isResumable(stored));
  assert.deepEqual(stored.events, [], "nessun evento: le statistiche non vedono un tentativo a metà");
  assert.equal(stored.progress.elapsedMs, 61_000);
  const point = resumePoint(s().studyRuns, stored);
  assert.equal(point.index, 1);
  assert.equal(point.done, 1);

  // Stesse domande e stesso ordine delle risposte, anche se nel frattempo una domanda è sparita.
  const again = preparedFromIds(s().quizQuestions, stored.itemIds, { seed: seedValue, shuffle: true });
  assert.deepEqual(
    again.map((item) => item.options.map((opt) => opt.id)),
    prepared.map((item) => item.options.map((opt) => opt.id))
  );
  const withoutSecond = preparedFromIds(
    s().quizQuestions.filter((question) => question.id !== prepared[1].question.id),
    stored.itemIds,
    { seed: seedValue, shuffle: true }
  );
  assert.equal(withoutSecond.length, 2);
  assert.deepEqual(withoutSecond[1].options.map((opt) => opt.id), prepared[2].options.map((opt) => opt.id), "la terza conserva il suo ordine");

  const events = prepared.map(({ question }, index) => ({ i: question.id, r: index === 0 ? "correct" : "skip", at: new Date().toISOString() }));
  const saved = await learning.saveQuizAttempt(stored, events);
  assert.equal(saved.progress, undefined);
  assert.ok(saved.endedAt);
  assert.equal(s().studyRuns.length, 1, "la stessa riga, non una nuova");
  assert.equal(pausedRuns(s().studyRuns).length, 0);
});

test("scartare: il quiz a metà sparisce, la sessione di flashcard si chiude e tiene le risposte", async () => {
  seed();
  const quiz = await learning.createQuiz({ title: "Q" });
  const question = await learning.saveQuestion(quiz.id, { prompt: "?", options: [option("x", true), option("y")] });
  const quizRun = learning.newRun({ kind: "quiz", mode: "training", title: "Q", quizId: quiz.id, deckIds: [], subjectIds: [], itemIds: [question.id] });
  await learning.saveRunProgress(quizRun, { index: 0, seed: 1, shuffle: false, answers: {}, checked: [] });
  await learning.discardRun(quizRun.id);
  assert.equal(s().studyRuns.length, 0);

  const deck = await learning.createDeck({ title: "D" });
  const a = await learning.createCard(deck.id, { front: "A", back: "a" });
  const b = await learning.createCard(deck.id, { front: "B", back: "b" });
  const run = learning.newRun({ kind: "flashcards", mode: "review", title: "R", deckIds: [], subjectIds: [], itemIds: [a.id, b.id] });
  await learning.answerCard(run, { id: a.id, deckId: deck.id }, "wrong", 100, 1);
  await learning.discardRun(run.id);
  const ended = s().studyRuns.find((item) => item.id === run.id);
  assert.ok(ended.endedAt);
  assert.equal(ended.events.length, 1, "la risposta data resta nello storico");
  assert.equal(pausedRuns(s().studyRuns).length, 0);
});

test("un tentativo già chiuso altrove non si riapre salvando il punto di ripresa", async () => {
  seed();
  const quiz = await learning.createQuiz({ title: "Q" });
  const question = await learning.saveQuestion(quiz.id, { prompt: "?", options: [option("x", true), option("y")] });
  const run = learning.newRun({ kind: "quiz", mode: "training", title: "Q", quizId: quiz.id, deckIds: [], subjectIds: [], itemIds: [question.id] });
  await learning.saveRunProgress(run, { index: 0, answers: {} });
  await learning.saveQuizAttempt(s().studyRuns[0], [{ i: question.id, r: "correct", at: new Date().toISOString() }]);
  await learning.saveRunProgress(run, { index: 0, answers: {} });
  assert.equal(s().studyRuns[0].progress, undefined);
  assert.ok(s().studyRuns[0].endedAt);
});
