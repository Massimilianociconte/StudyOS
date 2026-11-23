// Quiz in parti fatti tutti insieme: domande in ordine di parte, tempo, ripresa.
import test from "node:test";
import assert from "node:assert/strict";
import { SET_QUIZ_PREFIX, resumeQuizPlay, setQuestions, setQuiz, setQuizId, setTimeLimit } from "../src/components/learn/learnStarts.ts";
import { prepareQuiz } from "../src/lib/learnSession.ts";

const stamp = { createdAt: "2026-11-01T08:00:00.000Z", updatedAt: "2026-11-01T08:00:00.000Z", archived: false, tags: [] };
const question = (id, quizId, position) => ({
  id, quizId, kind: "single", position, revision: 1, prompt: [{ type: "text", text: id }],
  options: [{ id: "o1", text: "sì", correct: true }, { id: "o2", text: "no", correct: false }], ...stamp
});
const quiz = (id, minutes) => ({ id, title: id, description: "", position: 0, revision: 1, ...(minutes ? { timeLimitMinutes: minutes } : {}), ...stamp });

test("parti insieme: una parte dopo l'altra anche in allenamento (le posizioni ripartono da 0 in ogni quiz)", () => {
  const parts = [
    [question("p1-b", "p1", 1), question("p1-a", "p1", 0)],
    [question("p2-a", "p2", 0), question("p2-b", "p2", 1)]
  ];
  const all = setQuestions(parts);
  assert.deepEqual(all.map((item) => [item.id, item.position]), [["p1-a", 0], ["p1-b", 1], ["p2-a", 2], ["p2-b", 3]]);
  assert.deepEqual(prepareQuiz(all, { seed: 1, shuffle: false }).map((item) => item.question.id), ["p1-a", "p1-b", "p2-a", "p2-b"]);
  assert.equal(parts[0][0].position, 1, "le domande salvate non cambiano");
});

test("parti insieme: tempo = somma solo se ogni parte ne ha uno; id e quiz non salvati", () => {
  assert.equal(setTimeLimit([quiz("a", 20), quiz("b", 15)]), 35);
  assert.equal(setTimeLimit([quiz("a", 20), quiz("b")]), undefined);
  assert.equal(setTimeLimit([]), undefined);
  assert.equal(setQuizId("deck:v"), "set:deck:v");
  const synthetic = setQuiz("deck:v", "Verifica", { subjectId: "anat", timeLimitMinutes: 35 });
  assert.deepEqual([synthetic.id, synthetic.title, synthetic.subjectId, synthetic.timeLimitMinutes, synthetic.deckId], ["set:deck:v", "Verifica", "anat", 35, undefined]);
  assert.ok(synthetic.id.startsWith(SET_QUIZ_PREFIX));
});

test("parti insieme in pausa: si riprende nello stesso ordine, con il tempo della simulazione e «Rifai» che non mescola le parti", () => {
  const questions = [question("p1-a", "p1", 0), question("p1-b", "p1", 1), question("p2-a", "p2", 0)];
  const run = {
    id: "run1", kind: "quiz", mode: "exam", title: "Verifica", quizId: "set:deck:v", deckIds: [], subjectIds: [],
    startedAt: "2026-11-20T08:00:00.000Z", itemIds: ["p2-a", "p1-a", "p1-b"], events: [],
    progress: { index: 1, answers: { "p2-a": ["o1"] }, checked: [], elapsedMs: 1000, seed: 7, shuffle: true, at: "2026-11-20T08:05:00.000Z" },
    ...stamp
  };
  const data = {
    own: { quizzes: [quiz("p1", 10), quiz("p2", 5)], quizQuestions: questions },
    shared: [],
    studyRuns: [run]
  };
  const play = resumeQuizPlay(data, run);
  assert.ok(play);
  assert.equal(play.quiz.id, "set:deck:v");
  assert.equal(play.quiz.timeLimitMinutes, 15);
  assert.deepEqual(play.prepared.map((item) => [item.question.id, item.question.position]), [["p2-a", 0], ["p1-a", 1], ["p1-b", 2]]);
  const training = resumeQuizPlay(data, { ...run, mode: "training", progress: { ...run.progress, shuffle: false } });
  assert.equal(training.quiz.timeLimitMinutes, undefined, "il tempo vale solo nella simulazione");
});
