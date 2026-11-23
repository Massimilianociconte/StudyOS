// Logica pura della sezione Ripasso: albero, coda della sessione, quiz mescolati, ultimi errori.
import test from "node:test";
import assert from "node:assert/strict";
import { buildDeckTree, buildQueue, cardsInDecks, clockText, filterCounts, flattenTree, answeredQuestions, lastMistakes, latestMistakes, nextDueDay, nextWaits, percent, prepareQuiz, reviewAnswers, waitLabel } from "../src/lib/learnSession.ts";

const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };
const now = new Date("2026-11-16T10:00:00");
const deck = (id, parentId, position = 1) => ({ id, title: id, description: "", kind: "topic", position, ...(parentId ? { parentId } : {}), ...stamp });
const card = (id, deckId, position) => ({ id, deckId, front: [{ type: "text", text: id }], back: [{ type: "text", text: "b" }], position, revision: 1, ...stamp });
const state = (id, patch) => ({
  id, ownerId: "", reps: 2, lapses: 0, ease: 2.5, intervalDays: 3, due: "2026-11-20T08:00:00.000Z", lastResult: "correct",
  lastReviewedAt: "2026-11-10T08:00:00.000Z", correct: 2, wrong: 0, doubt: 0, revision: 1, ...stamp, ...patch
});

const decks = [deck("root", undefined, 1), deck("child", "root", 1), deck("leaf", "child", 1), deck("other", undefined, 2), deck("orphan", "missing", 3)];
const cards = [card("c1", "root", 1), card("c2", "child", 1), card("c3", "leaf", 1), card("c4", "leaf", 2), card("c5", "other", 1)];
const states = new Map([
  ["c2", state("c2", { due: "2026-11-14T08:00:00.000Z" })],
  ["c3", state("c3", { due: "2026-11-16T18:00:00.000Z", lastResult: "doubt" })],
  ["c5", state("c5", { lapses: 4, ease: 1.6 })]
]);

test("albero: conteggi aggregati, orfane in cima, ordine di visita", () => {
  const tree = buildDeckTree(decks, cards, states, [{ id: "q1", deckId: "leaf", title: "Q", description: "", position: 1, revision: 1, ...stamp }], now);
  assert.deepEqual(tree.map((node) => node.deck.id), ["root", "other", "orphan"]);
  assert.deepEqual(tree[0].counts, { cards: 4, direct: 1, due: 2, fresh: 2, quizzes: 1, subdecks: 2 });
  assert.deepEqual(flattenTree(tree).map((node) => [node.deck.id, node.depth]), [["root", 0], ["child", 1], ["leaf", 2], ["other", 0], ["orphan", 0]]);
  assert.deepEqual(cardsInDecks(cards, decks, ["child"]).map((item) => item.id), ["c2", "c3", "c4"]);
  assert.equal(cardsInDecks(cards, decks, []).length, 5);
});

test("coda: da ripassare per urgenza, nuove nell'ordine della raccolta, limite e mescolamento riproducibile", () => {
  const opts = (filter, extra = {}) => ({ filter, limit: 50, order: "priority", seed: 7, ...extra });
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("due")).map((item) => item.id), ["c2", "c3"]);
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("new")).map((item) => item.id), ["c1", "c4"]);
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("difficult")).map((item) => item.id), ["c5"]);
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("doubtful")).map((item) => item.id), ["c3"]);
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("all")).map((item) => item.id), ["c2", "c3", "c1", "c4", "c5"]);
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("all", { limit: 2 })).map((item) => item.id), ["c2", "c3"]);
  const a = buildQueue(cards, states, decks, now, opts("random", { seed: 3 })).map((item) => item.id);
  const b = buildQueue(cards, states, decks, now, opts("random", { seed: 3 })).map((item) => item.id);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), ["c1", "c2", "c3", "c4", "c5"]);
});

test("coda consigliata: prima le scadute per urgenza, poi le nuove; difficili o dubbie; schede già viste escluse", () => {
  const opts = (filter, extra = {}) => ({ filter, limit: 50, order: "priority", seed: 7, ...extra });
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("today")).map((item) => item.id), ["c2", "c3", "c1", "c4"]);
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("today", { limit: 3 })).map((item) => item.id), ["c2", "c3", "c1"]);
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("hard")).map((item) => item.id), ["c5", "c3"]);
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("today", { exclude: new Set(["c2", "c1"]) })).map((item) => item.id), ["c3", "c4"]);
  assert.deepEqual(buildQueue(cards, states, decks, now, opts("all", { exclude: new Set(["c2", "c3", "c1", "c4"]) })).map((item) => item.id), ["c5"]);
  const shuffledToday = buildQueue(cards, states, decks, now, opts("today", { order: "shuffle", seed: 5 })).map((item) => item.id);
  assert.deepEqual([...shuffledToday].sort(), ["c1", "c2", "c3", "c4"]);
  assert.deepEqual(filterCounts(cards, states, now), { today: 4, due: 2, new: 2, hard: 2, all: 5, overdue: 1 });
});

test("attese: etichette leggibili e tra quanto torna una scheda con ogni risposta", () => {
  assert.equal(waitLabel(10 * 60_000), "10 min");
  assert.equal(waitLabel(20_000), "1 min");
  assert.equal(waitLabel(60 * 60_000), "1 ora");
  assert.equal(waitLabel(5 * 3_600_000), "5 ore");
  assert.equal(waitLabel(86_400_000), "1 giorno");
  assert.equal(waitLabel(3 * 86_400_000), "3 giorni");
  assert.equal(waitLabel(60 * 86_400_000), "2 mesi");
  assert.equal(waitLabel(400 * 86_400_000), "1 anno");
  // Mai vista: sbagliata 10 minuti, dubbia e corretta 1 giorno.
  assert.deepEqual(nextWaits(undefined, { id: "c1" }, now), { wrong: "10 min", doubt: "1 giorno", correct: "1 giorno" });
  // Due risposte giuste, intervallo 3 giorni, facilità 2,5: corretta 8 giorni, dubbia 4.
  assert.deepEqual(nextWaits(states.get("c2"), { id: "c2" }, now), { wrong: "10 min", doubt: "4 giorni", correct: "8 giorni" });
});

test("prossima scadenza: il primo giorno futuro e quante schede scadono quel giorno", () => {
  const later = new Map([
    ["a", state("a", { due: "2026-11-18T08:00:00.000Z" })],
    ["b", state("b", { due: "2026-11-18T15:00:00.000Z" })],
    ["c", state("c", { due: "2026-11-25T08:00:00.000Z" })],
    ["d", state("d", { due: "2026-11-10T08:00:00.000Z" })]
  ]);
  const next = nextDueDay(["a", "b", "c", "d", "nuova"], later, now);
  assert.equal(next.count, 2);
  assert.equal(next.day.toISOString(), "2026-11-18T08:00:00.000Z");
  assert.equal(nextDueDay(["d", "nuova"], later, now), null);
});

test("quiz: opzioni mescolate con id stabili, ripasso degli errori, punteggio delle risposte", () => {
  const q = (id, kind, options) => ({ id, quizId: "quiz", kind, prompt: [{ type: "text", text: id }], options, position: Number(id.slice(1)), revision: 1, ...stamp });
  const questions = [
    q("q1", "single", [{ id: "o1", text: "a", correct: true }, { id: "o2", text: "b", correct: false }, { id: "o3", text: "c", correct: false }]),
    q("q2", "multiple", [{ id: "o1", text: "a", correct: true }, { id: "o2", text: "b", correct: true }, { id: "o3", text: "c", correct: false }]),
    q("q3", "single", [{ id: "o1", text: "a", correct: false }, { id: "o2", text: "b", correct: true }])
  ];
  const one = prepareQuiz(questions, { seed: 11 });
  const two = prepareQuiz(questions, { seed: 11 });
  assert.deepEqual(one.map((item) => item.question.id), two.map((item) => item.question.id));
  assert.deepEqual(one[0].options.map((option) => option.id).sort(), one[0].question.options.map((option) => option.id).sort());
  const plain = prepareQuiz(questions, { seed: 1, shuffle: false });
  assert.deepEqual(plain.map((item) => item.question.id), ["q1", "q2", "q3"]);
  const review = reviewAnswers(plain, new Map([["q1", ["o1"]], ["q2", ["o1"]]]));
  assert.deepEqual(review.map((item) => item.outcome), ["correct", "wrong", "skip"]);

  const runs = [
    { id: "r1", kind: "quiz", quizId: "quiz", itemIds: ["q1", "q2", "q3"], events: [{ i: "q1", r: "wrong" }], endedAt: "2026-11-10T08:00:00.000Z", ...stamp },
    { id: "r2", kind: "quiz", quizId: "quiz", itemIds: ["q1", "q2", "q3"], events: [{ i: "q1", r: "correct" }, { i: "q2", r: "wrong" }], endedAt: "2026-11-12T08:00:00.000Z", ...stamp }
  ];
  assert.deepEqual([...lastMistakes(runs, "quiz")].sort(), ["q2", "q3"]);
  assert.deepEqual(prepareQuiz(questions, { seed: 1, only: lastMistakes(runs, "quiz"), shuffle: false }).map((item) => item.question.id), ["q2", "q3"]);
  assert.equal(lastMistakes(runs, "altro").size, 0);
});

test("formati: percentuali e orologio", () => {
  assert.equal(percent(0.756), "76%");
  assert.equal(percent(null), "—");
  assert.equal(clockText(725), "12:05");
  assert.equal(clockText(-3), "0:00");
});

test("quiz: opzioni malformate (righe scritte fuori dall'app) restano fuori da domanda, punteggio e revisione", () => {
  const question = {
    id: "q1", quizId: "z", kind: "single", position: 1, revision: 1, createdAt: "", updatedAt: "", archived: false, tags: [], prompt: [],
    options: [{ id: "a", text: "4", correct: true }, "x", null, { id: 3, text: "n" }, { id: "b", text: { bad: 1 } }, { id: "a", text: "doppia" }, { id: "c", text: "5", correct: "true" }]
  };
  const [prepared] = prepareQuiz([question], { seed: 1, shuffle: false });
  assert.deepEqual(prepared.options.map((option) => option.id), ["a", "c"]);
  assert.deepEqual(prepared.question.options.map((option) => [option.id, option.correct]), [["a", true], ["c", false]]);
  const [noList] = prepareQuiz([{ ...question, options: "x" }], { seed: 1 });
  assert.deepEqual(noList.options, []);
  assert.equal(reviewAnswers([prepared], new Map([["q1", ["a"]]]))[0].outcome, "correct");
});

test("ultimi errori: un tentativo oltre 400 risposte continua in altre righe e si legge tutto", () => {
  const ended = "2026-11-20T08:00:00.000Z";
  const runs = [
    // Prima riga del tentativo (con le domande) e la continuazione: stesso quiz, stessa fine, niente domande.
    { id: "head", kind: "quiz", quizId: "big", itemIds: ["q1", "q2", "q3", "q4"], events: [{ i: "q1", r: "correct" }, { i: "q2", r: "wrong" }], endedAt: ended, score: 0.5, ...stamp },
    { id: "tail", kind: "quiz", quizId: "big", continuesId: "head", itemIds: [], events: [{ i: "q3", r: "correct" }, { i: "q4", r: "skip" }], endedAt: ended, ...stamp }
  ];
  assert.deepEqual([...lastMistakes(runs, "big")].sort(), ["q2", "q4"]);
  assert.deepEqual([...lastMistakes([...runs].reverse(), "big")].sort(), ["q2", "q4"], "l'ordine delle righe non conta");
});

test("errori delle parti insieme: l'ultima risposta a ogni domanda, in qualunque tentativo; le mai fatte non contano", () => {
  const runs = [
    { id: "p1", kind: "quiz", quizId: "parte1", itemIds: ["a", "b"], events: [{ i: "a", r: "wrong" }, { i: "b", r: "wrong" }], endedAt: "2026-11-10T08:00:00.000Z", ...stamp },
    { id: "all", kind: "quiz", quizId: "set:deck:v", itemIds: ["a", "c"], events: [{ i: "a", r: "correct" }, { i: "c", r: "skip" }], endedAt: "2026-11-12T08:00:00.000Z", ...stamp },
    { id: "open", kind: "quiz", quizId: "parte1", itemIds: ["b"], events: [{ i: "b", r: "correct" }], ...stamp }
  ];
  assert.deepEqual([...latestMistakes(runs, ["a", "b", "c", "d"])].sort(), ["b", "c"], "b: l'unica risposta conclusa è sbagliata; il tentativo aperto non conta");
});

test("domande fatte: risposte (giuste o sbagliate) in tentativi conclusi di qualunque quiz, anche tutte le parti insieme", () => {
  const runs = [
    { id: "all", kind: "quiz", quizId: "set:deck:v", itemIds: ["a", "b", "c"], events: [{ i: "a", r: "correct" }, { i: "b", r: "wrong" }, { i: "c", r: "skip" }], endedAt: "2026-11-12T08:00:00.000Z", ...stamp },
    { id: "open", kind: "quiz", quizId: "parte", itemIds: ["d"], events: [{ i: "d", r: "correct" }], ...stamp },
    { id: "cards", kind: "flashcards", itemIds: ["e"], events: [{ i: "e", r: "correct" }], endedAt: "2026-11-12T08:00:00.000Z", ...stamp }
  ];
  assert.deepEqual([...answeredQuestions(runs)].sort(), ["a", "b"], "saltate, tentativi aperti e flashcard non contano");
});
