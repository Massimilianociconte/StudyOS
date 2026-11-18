// Etichette di sessioni e quiz interrotti e ripresi: il punto di ripresa ricorda il dispositivo,
// riprendere segna la riga («Ripresa», «Ripresa da iPhone · Safari») e il segno resta nello storico.
import test from "node:test";
import assert from "node:assert/strict";
import { useStudyStore } from "../src/store/useStudyStore.ts";
import * as learning from "../src/store/learning.ts";
import { describeDevice, setThisDeviceForTests } from "../src/lib/learnDevice.ts";
import { pauseText, pauseWhen, pauseWhere, resumedLabel } from "../src/lib/learnResumeTag.ts";
import { pausedByDeck } from "../src/lib/learnResume.ts";

const MAC = { id: "dev-mac", name: "Mac · Chrome", kind: "computer" };
const PHONE = { id: "dev-phone", name: "iPhone · Safari", kind: "phone" };

const seed = () =>
  useStudyStore.setState({
    loading: false,
    locked: false,
    subjects: [],
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
const runOf = (id) => s().studyRuns.find((item) => item.id === id);
const option = (text, correct = false) => ({ text, correct });

test("nome e tipo del dispositivo vengono solo dal browser", () => {
  const ua = {
    iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    ipad: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    android: "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
    androidTablet: "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Safari/537.36",
    mac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
    linux: "Mozilla/5.0 (X11; Linux x86_64; rv:133.0) Gecko/20100101 Firefox/133.0"
  };
  assert.deepEqual(describeDevice({ userAgent: ua.iphone, maxTouchPoints: 5 }), { name: "iPhone · Safari", kind: "phone" });
  assert.deepEqual(describeDevice({ userAgent: ua.ipad, platform: "MacIntel", maxTouchPoints: 5 }), { name: "iPad · Safari", kind: "tablet" }, "iPadOS si presenta come un Mac, con lo schermo touch");
  assert.deepEqual(describeDevice({ userAgent: ua.ipad, platform: "MacIntel", maxTouchPoints: 0 }), { name: "Mac · Safari", kind: "computer" });
  assert.deepEqual(describeDevice({ userAgent: ua.android }), { name: "Android · Chrome", kind: "phone" });
  assert.deepEqual(describeDevice({ userAgent: ua.androidTablet }), { name: "tablet Android · Samsung Internet", kind: "tablet" });
  assert.deepEqual(describeDevice({ userAgent: ua.mac, platform: "MacIntel" }), { name: "Mac · Chrome", kind: "computer" });
  assert.deepEqual(describeDevice({ userAgent: ua.windows, platform: "Win32" }), { name: "PC Windows · Edge", kind: "computer" });
  assert.deepEqual(describeDevice({ userAgent: ua.linux }), { name: "computer Linux · Firefox", kind: "computer" });
  assert.deepEqual(describeDevice({}), { name: "un altro dispositivo", kind: "computer" });
});

test("il punto di ripresa ricorda su quale dispositivo ci si è fermati", async () => {
  seed();
  setThisDeviceForTests(MAC);
  const deck = await learning.createDeck({ title: "D" });
  const a = await learning.createCard(deck.id, { front: "A", back: "A" });
  const b = await learning.createCard(deck.id, { front: "B", back: "B" });
  const run = learning.newRun({ kind: "flashcards", mode: "review", title: "R", deckIds: [deck.id], subjectIds: [], itemIds: [a.id, b.id] });
  await learning.answerCard(run, { id: a.id, deckId: deck.id }, "correct", 100, 1);
  assert.deepEqual(runOf(run.id).progress.device, MAC);

  const quiz = await learning.createQuiz({ title: "Q" });
  const question = await learning.saveQuestion(quiz.id, { prompt: "?", options: [option("x", true), option("y")] });
  const quizRun = learning.newRun({ kind: "quiz", mode: "training", title: "Q", quizId: quiz.id, deckIds: [], subjectIds: [], itemIds: [question.id] });
  setThisDeviceForTests(PHONE);
  await learning.saveRunProgress(quizRun, { index: 0, answers: {} });
  assert.deepEqual(runOf(quizRun.id).progress.device, PHONE);
  setThisDeviceForTests(null);
});

test("riprendere segna la riga: stesso dispositivo «Ripresa», un altro «Ripresa da …»", async () => {
  seed();
  setThisDeviceForTests(MAC);
  const deck = await learning.createDeck({ title: "D" });
  const cards = [];
  for (const front of ["A", "B", "C"]) cards.push(await learning.createCard(deck.id, { front, back: front }));
  const run = learning.newRun({ kind: "flashcards", mode: "review", title: "R", deckIds: [deck.id], subjectIds: [], itemIds: cards.map((card) => card.id) });
  await learning.answerCard(run, { id: cards[0].id, deckId: deck.id }, "correct", 100, 1);
  assert.equal(resumedLabel(runOf(run.id)), null, "mai ripresa: nessuna etichetta");

  // Più tardi, sullo stesso Mac.
  const first = await learning.markResumed(runOf(run.id));
  assert.equal(first.resumed.count, 1);
  assert.equal(first.resumed.elsewhere, undefined);
  assert.equal(resumedLabel(first), "Ripresa");
  assert.deepEqual(first.progress.device, MAC, "il punto di ripresa resta quello dell'interruzione");

  // Si ferma di nuovo sul Mac e riparte dall'iPhone.
  await learning.answerCard(first, { id: cards[1].id, deckId: deck.id }, "wrong", 100, 2);
  setThisDeviceForTests(PHONE);
  const second = await learning.markResumed(runOf(run.id));
  assert.equal(second.resumed.count, 2);
  assert.equal(second.resumed.elsewhere, true);
  assert.equal(second.resumed.from, "Mac · Chrome");
  assert.equal(resumedLabel(second), "Ripresa da Mac · Chrome");

  // Chiusa: il segno resta nello storico, il punto di ripresa no.
  await learning.finishRun(run.id);
  const ended = runOf(run.id);
  assert.equal(ended.progress, undefined);
  assert.equal(ended.resumed.count, 2);
  assert.equal(resumedLabel(ended), "Ripresa da Mac · Chrome");

  // Una sessione già chiusa non si segna.
  const again = await learning.markResumed(ended);
  assert.equal(again.resumed.count, 2);
  setThisDeviceForTests(null);
});

test("il quiz ripreso tiene il segno anche se il lettore salva la copia di prima", async () => {
  seed();
  setThisDeviceForTests(PHONE);
  const quiz = await learning.createQuiz({ title: "Q" });
  const question = await learning.saveQuestion(quiz.id, { prompt: "?", options: [option("x", true), option("y")] });
  const run = learning.newRun({ kind: "quiz", mode: "training", title: "Q", quizId: quiz.id, deckIds: [], subjectIds: [], itemIds: [question.id] });
  const paused = await learning.saveRunProgress(run, { index: 0, answers: {} });
  setThisDeviceForTests(MAC);
  await learning.markResumed(paused);
  const saved = await learning.saveQuizAttempt(paused, [{ i: question.id, r: "correct", at: new Date().toISOString() }]);
  assert.equal(saved.resumed.count, 1);
  assert.equal(saved.resumed.from, "iPhone · Safari");
  assert.equal(runOf(run.id).resumed.elsewhere, true);
  setThisDeviceForTests(null);
});

test("quando e dove: testi brevi, ora locale", () => {
  const now = new Date(2026, 10, 18, 20, 0);
  const at = (...parts) => new Date(...parts).toISOString();
  assert.equal(pauseWhen(at(2026, 10, 18, 19, 59, 40), now), "adesso");
  assert.equal(pauseWhen(at(2026, 10, 18, 19, 48), now), "12 min fa");
  assert.equal(pauseWhen(at(2026, 10, 18, 9, 5), now), "oggi alle 9:05");
  assert.equal(pauseWhen(at(2026, 10, 17, 18, 30), now), "ieri alle 18:30");
  assert.equal(pauseWhen(at(2026, 10, 16, 18, 30), now), "lunedì alle 18:30");
  assert.equal(pauseWhen(at(2026, 10, 3, 18, 30), now), "il 3 nov, 18:30");
  assert.equal(pauseWhen(at(2025, 10, 3, 18, 30), now), "il 3 nov 2025, 18:30");
  assert.equal(pauseWhen(undefined, now), "");
  assert.equal(pauseWhen("non una data", now), "");

  const progress = { at: at(2026, 10, 17, 18, 30), index: 0, device: PHONE };
  assert.deepEqual(pauseWhere({ progress }, MAC), { here: false, name: "iPhone · Safari", kind: "phone" });
  assert.deepEqual(pauseWhere({ progress }, PHONE), { here: true, name: "iPhone · Safari", kind: "phone" });
  assert.equal(pauseWhere({ progress: { at: progress.at, index: 0 } }, MAC), null, "pause di prima: dispositivo sconosciuto");
  assert.equal(pauseText({ kind: "flashcards", progress }, MAC, now), "Interrotta ieri alle 18:30 su iPhone · Safari");
  assert.equal(pauseText({ kind: "quiz", progress }, PHONE, now), "Interrotto ieri alle 18:30 su questo dispositivo");
  assert.equal(pauseText({ kind: "quiz", progress: { at: progress.at, index: 0 } }, PHONE, now), "Interrotto ieri alle 18:30");
});

test("raccolte con una sessione in pausa: solo flashcard su una raccolta, la più recente", () => {
  const base = { events: [], subjectIds: [], itemIds: ["c1"], startedAt: "2026-11-18T08:00:00.000Z", createdAt: "x", updatedAt: "x", archived: false, title: "", mode: "review" };
  const runs = [
    { ...base, id: "old", kind: "flashcards", deckIds: ["d1"], progress: { at: "2026-11-17T08:00:00.000Z", index: 0 } },
    { ...base, id: "new", kind: "flashcards", deckIds: ["d1"], progress: { at: "2026-11-18T08:00:00.000Z", index: 0 } },
    { ...base, id: "many", kind: "flashcards", deckIds: ["d1", "d2"], progress: { at: "2026-11-18T09:00:00.000Z", index: 0 } },
    { ...base, id: "quiz", kind: "quiz", deckIds: ["d3"], progress: { at: "2026-11-18T09:00:00.000Z", index: 0, answers: {} } },
    { ...base, id: "closed", kind: "flashcards", deckIds: ["d4"], endedAt: "2026-11-18T09:00:00.000Z", progress: { at: "2026-11-18T09:00:00.000Z", index: 0 } }
  ];
  const map = pausedByDeck(runs);
  assert.deepEqual([...map.keys()], ["d1"]);
  assert.equal(map.get("d1").run.id, "new");
});
