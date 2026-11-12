import test from "node:test";
import assert from "node:assert/strict";
import { dueTopics, reviewUndoPatch, reviewableTopics, scheduleReview, subjectPause } from "../src/lib/review.ts";
import { selectableSubjects } from "../src/lib/selectors.ts";

const subject = (id, patch = {}) => ({ id, name: `Materia ${id}`, status: "active", archived: false, ...patch });
const topic = (id, subjectId, patch = {}) => ({ id, subjectId, nextReviewDate: "2026-09-28T22:00:00.000Z", archived: false, ...patch });

test("ripasso: gli argomenti di una materia superata o archiviata non sono da ripassare", () => {
  const subjects = [
    subject("attiva"),
    subject("pronta", { status: "exam-ready" }),
    subject("superata", { status: "completed" }),
    subject("archiviata", { status: "archived" }),
    subject("vecchia", { archived: true })
  ];
  const topics = [
    topic("a", "attiva"),
    topic("b", "pronta"),
    topic("c", "superata"),
    topic("d", "archiviata"),
    topic("e", "vecchia"),
    topic("f", "attiva", { archived: true }),
    // Materia che qui non c'è (dati parziali): meglio un ripasso in più che uno nascosto.
    topic("g", "sparita")
  ];
  const now = new Date(2026, 8, 29, 10, 0);
  assert.deepEqual(reviewableTopics(topics, subjects).map((item) => item.id), ["a", "b", "g"]);
  assert.deepEqual(dueTopics(reviewableTopics(topics, subjects), now).map((item) => item.id), ["a", "b", "g"]);
});

test("ripasso: «in pausa» segue la stessa regola dei menu di scelta della materia", () => {
  const statuses = ["not-started", "active", "review", "exam-ready", "completed", "archived"];
  for (const status of statuses) {
    for (const archived of [false, true]) {
      const item = subject("x", { status, archived });
      const selectable = selectableSubjects([item]).includes(item);
      assert.equal(subjectPause(item) === null, selectable, `${status} archived=${archived}`);
    }
  }
  assert.equal(subjectPause(subject("x", { status: "completed" })), "completed");
  assert.equal(subjectPause(subject("x", { status: "archived" })), "archived");
  assert.equal(subjectPause(subject("x", { status: "completed", archived: true })), "archived");
});

test("ripasso: «Annulla» rimette intervallo, facilità, ripassi fatti e data di prima", () => {
  const before = {
    id: "t",
    subjectId: "s",
    title: "Cinematica",
    intervalDays: 60,
    ease: 2.6,
    completedReviews: 7,
    memorization: 5,
    nextReviewDate: "2026-09-29T22:00:00.000Z",
    lastReviewedAt: "2026-07-31T08:00:00.000Z",
    notes: "",
    questions: []
  };
  const undo = reviewUndoPatch(before);
  const rated = { ...before, ...scheduleReview(before, "again", new Date(2026, 8, 30, 9, 0)) };
  assert.equal(rated.intervalDays, 1);
  assert.notEqual(rated.ease, before.ease);
  assert.deepEqual({ ...rated, ...undo }, before);

  // Mai ripassato: «Annulla» toglie di nuovo intervallo, facilità e data dell'ultimo ripasso.
  const fresh = { ...before, intervalDays: undefined, ease: undefined, completedReviews: 0, memorization: 1, lastReviewedAt: undefined };
  const restored = { ...fresh, ...scheduleReview(fresh, "good"), ...reviewUndoPatch(fresh) };
  assert.equal(restored.intervalDays, undefined);
  assert.equal(restored.ease, undefined);
  assert.equal(restored.lastReviewedAt, undefined);
  assert.equal(restored.completedReviews, 0);
});
