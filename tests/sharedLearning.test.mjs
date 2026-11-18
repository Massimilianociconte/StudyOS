// Raccolte condivise con «Può modificare»: le stesse regole della libreria propria, scrittura
// tramite useSharedStore (coda verso push_shared_rows). Solo memoria, come sharedStore.test.mjs.
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { learningSharedSources } from "../src/agent/learningShared.ts";
import { useSharedStore } from "../src/store/useSharedStore.ts";
import {
  createSharedCard,
  createSharedSubdeck,
  deleteSharedCards,
  deleteSharedDeck,
  deleteSharedQuiz,
  editableSource,
  publishSharedExplanation,
  saveSharedQuestion,
  updateSharedCard,
  updateSharedDeck
} from "../src/store/sharedLearning.ts";

const STAMP = "2026-11-10T10:00:00.000Z";
const grant = (extra) => ({
  id: "g", ownerId: "alice", ownerName: "Alice", scope: "flashcards", subjectIds: [], permission: "edit",
  granteeUserId: "bob", granteeGroupId: null, granteeName: "Bob", granteeEmail: null, createdAt: "", updatedAt: "", ...extra
});
const base = (id) => ({ id, createdAt: STAMP, updatedAt: STAMP, archived: false, tags: [] });
const ROWS = [
  ["studyDeck", { ...base("d1"), title: "Chimica", description: "", kind: "collection", position: 1, subjectId: "s1" }],
  ["studyDeck", { ...base("d2"), title: "Equilibri", description: "", kind: "chapter", position: 1, parentId: "d1" }],
  ["flashcard", { ...base("c1"), deckId: "d2", subjectId: "s1", front: [{ type: "text", text: "Kc?" }], back: [{ type: "text", text: "Rapporto" }], position: 1, revision: 1 }],
  ["quiz", { ...base("z1"), title: "Verifica", description: "", deckId: "d1", subjectId: "s1", position: 1, revision: 1 }],
  ["quizQuestion", {
    ...base("q1"), quizId: "z1", subjectId: "s1", kind: "single", prompt: [{ type: "text", text: "2+2?" }],
    options: [{ id: "a", text: "4", correct: true }, { id: "b", text: "5", correct: false }], position: 1, revision: 1
  }]
];
const row = ([type, payload]) => ({ entity_type: type, entity_id: payload.id, payload, deleted: false, updated_at: "2026-11-10T10:00:01Z" });

const store = useSharedStore;
const source = () => learningSharedSources().find((item) => item.owner?.id === "alice");
const outboxOf = (type) => store.getState().outbox.filter((entry) => entry.entityType === type);
const entityOf = (type, id) => store.getState().items.find((item) => item.entityType === type && item.entityId === id)?.entity;

beforeEach(async () => {
  store.setState({
    viewerId: "bob", persistent: false, received: [grant()], given: [], invites: [], items: [], labels: [], outbox: [], hiddenOwners: [], notice: null, syncError: null
  });
  await store.getState().applyRows("alice", ROWS.map(row));
});

test("fonte condivisa: raccolte, schede e quiz di Alice con il suo permesso", () => {
  const alice = source();
  assert.equal(alice.owner.permission, "edit");
  assert.deepEqual(alice.bundle.decks.map((deck) => deck.id).sort(), ["d1", "d2"]);
  assert.equal(alice.bundle.flashcards.length, 1);
  assert.equal(editableSource("alice")?.owner.id, "alice");
  assert.equal(editableSource("carla"), null);
});

test("scheda nuova e modificata: stesse regole della libreria, in coda verso Alice, materia dalla raccolta", async () => {
  const card = await createSharedCard(source(), "d2", { front: [{ type: "text", text: "Kp?" }], back: ["Pressioni"] });
  assert.equal(card.subjectId, "s1");
  assert.equal(card.author.kind, "person");
  assert.equal(entityOf("flashcard", card.id)?.deckId, "d2");
  const edited = await updateSharedCard(source(), "c1", { back: [{ type: "text", text: "Rapporto delle concentrazioni" }] });
  assert.equal(edited.revision, 2);
  assert.deepEqual(outboxOf("flashcard").map((entry) => entry.entityId).sort(), [card.id, "c1"].sort());
  await assert.rejects(createSharedCard(source(), "d2", { front: [], back: ["x"] }), /front/);
  await assert.rejects(createSharedCard(source(), "nessuna", { front: ["x"], back: ["y"] }), /Mazzo non trovato/);
});

test("raccolte: sotto-raccolta dentro quella di Alice, materia e madre restano sue", async () => {
  const sub = await createSharedSubdeck(source(), "d1", { title: "Acidi", subjectId: "mia", parentId: "altro" });
  assert.equal(sub.parentId, "d1");
  assert.equal(sub.subjectId, undefined);
  const renamed = await updateSharedDeck(source(), "d1", { title: "Chimica generale", subjectId: "mia", parentId: "d2" });
  assert.equal(renamed.title, "Chimica generale");
  assert.equal(renamed.subjectId, "s1");
  assert.equal(renamed.parentId, undefined);
});

test("eliminazioni: una raccolta altrui piena no, vuota sì; quiz con le sue domande", async () => {
  await assert.rejects(deleteSharedDeck(source(), "d2"), /Svuota prima/);
  await deleteSharedCards(source(), ["c1"]);
  await deleteSharedDeck(source(), "d2");
  assert.equal(entityOf("studyDeck", "d2"), undefined);
  assert.equal(outboxOf("studyDeck").find((entry) => entry.entityId === "d2")?.deleted, true);
  await deleteSharedQuiz(source(), "z1");
  assert.equal(entityOf("quiz", "z1"), undefined);
  assert.equal(entityOf("quizQuestion", "q1"), undefined);
  assert.equal(outboxOf("quizQuestion")[0]?.deleted, true);
});

test("domanda: opzioni con id stabili, revisione che sale", async () => {
  const next = await saveSharedQuestion(source(), "z1", { options: [{ id: "a", text: "4", correct: true }, { text: "22", correct: false }] }, "q1");
  assert.equal(next.revision, 2);
  assert.equal(next.options[0].id, "a");
  assert.equal(next.options.length, 2);
});

test("solo lettura: nessuna scrittura, niente in coda", async () => {
  store.setState({ received: [grant({ permission: "view" })] });
  await assert.rejects(createSharedCard(source(), "d2", { front: ["x"], back: ["y"] }), /solo vedere/);
  await assert.rejects(deleteSharedCards(source(), ["c1"]), /solo vedere/);
  assert.equal(editableSource("alice"), null);
  assert.equal(store.getState().outbox.length, 0);
});

test("spiegazione pubblicata su una scheda di Alice: va nella scheda, non nei dati personali", async () => {
  const request = { id: "r1", kind: "explain_card", targetId: "c1", targetOwnerId: "alice", result: { blocks: [{ type: "text", text: "Perché…" }] } };
  const card = await publishSharedExplanation(request);
  assert.deepEqual(card.explanation, [{ type: "text", text: "Perché…" }]);
  assert.deepEqual(entityOf("flashcard", "c1")?.explanation, [{ type: "text", text: "Perché…" }]);
  store.setState({ received: [grant({ permission: "view" })] });
  await assert.rejects(publishSharedExplanation(request), /resta tua/);
});
