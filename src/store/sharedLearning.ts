// Modifiche alle raccolte che un'altra persona condivide con «Può modificare» (sezione «flashcards»).
// Stesse regole della libreria propria (costruttori puri di learning.ts), ma la scrittura passa da
// useSharedStore: coda, invio a push_shared_rows, controlli del server e cronologia del proprietario.
// Le tue risposte restano tue: gli stati di ripasso non si toccano qui.
import { learningSharedSources, type LearningSource } from "../agent/learningShared";
import { SHARE_GONE_TEXT } from "../lib/labels";
import type { SharedEntity } from "../lib/sharing";
import type { AiRequest, Flashcard, Quiz, QuizQuestion, StudyDeck } from "../types";
import { LearningError, buildCard, buildCardUpdate, buildDeck, buildDeckUpdate, buildQuestion, buildQuiz, buildQuizUpdate } from "./learning";
import { useSharedStore } from "./useSharedStore";

/** Campi di una raccolta che chi riceve non cambia: materia e posizione nell'albero sono del proprietario. */
const OWNER_DECK_FIELDS = ["subjectId", "parentId"] as const;

const editable = (source: LearningSource) => {
  if (!source.owner) throw new LearningError("Questa raccolta è tua: si modifica dalla libreria.");
  if (source.owner.permission !== "edit") throw new LearningError("Puoi solo vedere questa raccolta.");
  return source.owner;
};

/** Ultima copia condivisa della persona: la fonte passata dalla vista può essere di qualche istante prima. */
const current = (source: LearningSource) => {
  const owner = editable(source);
  const items = useSharedStore.getState().items.filter((item) => item.ownerId === owner.id);
  const of = <T,>(type: string) => items.filter((item) => item.entityType === type).map((item) => item.entity as unknown as T);
  return {
    owner,
    decks: of<StudyDeck>("studyDeck"),
    flashcards: of<Flashcard>("flashcard"),
    quizzes: of<Quiz>("quiz"),
    quizQuestions: of<QuizQuestion>("quizQuestion")
  };
};

const save = (ownerId: string, type: string, entity: object) => useSharedStore.getState().saveSharedItem(ownerId, type, entity as unknown as SharedEntity);
const remove = (ownerId: string, type: string, id: string) => useSharedStore.getState().deleteSharedItem(ownerId, type, id);

/** Campi di un quiz che chi riceve non cambia: raccolta e materia restano quelle scelte dal proprietario. */
const OWNER_QUIZ_FIELDS = ["subjectId", "deckId"] as const;

const withoutOwnerFields = (input: Record<string, unknown>, keys: readonly string[] = OWNER_DECK_FIELDS) => {
  const rest = { ...input };
  for (const key of keys) delete rest[key];
  return rest;
};

// ─── Raccolte ─────────────────────────────────────────────────────────────────────────────

/** Sotto-raccolta nuova dentro una raccolta condivisa (mai una radice: sotto la materia c'è solo il proprietario). */
export const createSharedSubdeck = async (source: LearningSource, parentId: string, input: Record<string, unknown>) => {
  const { owner, decks } = current(source);
  if (!decks.some((deck) => deck.id === parentId)) throw new LearningError(SHARE_GONE_TEXT);
  const deck = buildDeck(decks, { ...withoutOwnerFields(input), parentId }, new Date().toISOString());
  await save(owner.id, "studyDeck", deck);
  return deck;
};

export const updateSharedDeck = async (source: LearningSource, id: string, input: Record<string, unknown>) => {
  const { owner, decks } = current(source);
  const { next } = buildDeckUpdate(decks, id, withoutOwnerFields(input));
  await save(owner.id, "studyDeck", next);
  return next;
};

/**
 * Elimina una raccolta altrui solo se è vuota (niente sotto-raccolte, schede o quiz): una raccolta
 * piena si svuota prima, così nessuno cancella per sbaglio centinaia di schede di un altro.
 */
export const deleteSharedDeck = async (source: LearningSource, id: string) => {
  const { owner, decks, flashcards, quizzes } = current(source);
  if (!decks.some((deck) => deck.id === id)) throw new LearningError(SHARE_GONE_TEXT);
  if (decks.some((deck) => deck.parentId === id) || flashcards.some((card) => card.deckId === id) || quizzes.some((quiz) => quiz.deckId === id)) {
    throw new LearningError("Svuota prima la raccolta: si eliminano solo le raccolte condivise senza sotto-raccolte, schede o quiz.");
  }
  await remove(owner.id, "studyDeck", id);
};

// ─── Flashcard ────────────────────────────────────────────────────────────────────────────

export const createSharedCard = async (source: LearningSource, deckId: string, input: Record<string, unknown>) => {
  const { owner, decks, flashcards } = current(source);
  const card = buildCard(decks, flashcards, deckId, input, new Date().toISOString());
  await save(owner.id, "flashcard", card);
  return card;
};

export const updateSharedCard = async (source: LearningSource, id: string, input: Record<string, unknown>) => {
  const { owner, flashcards } = current(source);
  const next = buildCardUpdate(flashcards, id, input);
  await save(owner.id, "flashcard", next);
  return next;
};

export const deleteSharedCards = async (source: LearningSource, ids: readonly string[]) => {
  const { owner } = current(source);
  for (const id of ids) await remove(owner.id, "flashcard", id);
};

// ─── Quiz ─────────────────────────────────────────────────────────────────────────────────

export const createSharedQuiz = async (source: LearningSource, input: Record<string, unknown>) => {
  const { owner, decks, quizzes } = current(source);
  if (typeof input.deckId !== "string" || !decks.some((deck) => deck.id === input.deckId)) throw new LearningError(SHARE_GONE_TEXT);
  const quiz = buildQuiz(decks, quizzes, { ...withoutOwnerFields(input, ["subjectId"]), deckId: input.deckId }, new Date().toISOString());
  await save(owner.id, "quiz", quiz);
  return quiz;
};

export const updateSharedQuiz = async (source: LearningSource, id: string, input: Record<string, unknown>) => {
  const { owner, decks, quizzes } = current(source);
  const next = buildQuizUpdate(decks, quizzes, id, withoutOwnerFields(input, OWNER_QUIZ_FIELDS));
  await save(owner.id, "quiz", next);
  return next;
};

/** Il quiz con le sue domande (un quiz ne ha poche: niente soglia come per le raccolte). */
export const deleteSharedQuiz = async (source: LearningSource, id: string) => {
  const { owner, quizQuestions } = current(source);
  for (const question of quizQuestions.filter((item) => item.quizId === id)) await remove(owner.id, "quizQuestion", question.id);
  await remove(owner.id, "quiz", id);
};

export const saveSharedQuestion = async (source: LearningSource, quizId: string, input: Record<string, unknown>, id?: string) => {
  const { owner, quizzes, quizQuestions } = current(source);
  const { next } = buildQuestion(quizzes, quizQuestions, quizId, input, id, new Date().toISOString());
  await save(owner.id, "quizQuestion", next);
  return next;
};

export const deleteSharedQuestions = async (source: LearningSource, ids: readonly string[]) => {
  const { owner } = current(source);
  for (const id of ids) await remove(owner.id, "quizQuestion", id);
};

// ─── Spiegazioni ─────────────────────────────────────────────────────────────────────────

/** Persona che condivide con te le raccolte con «Può modificare» (null se non c'è o puoi solo vedere). */
export const editableSource = (ownerId: string | undefined): LearningSource | null => {
  if (!ownerId) return null;
  const source = learningSharedSources().find((item) => item.owner?.id === ownerId);
  return source?.owner?.permission === "edit" ? source : null;
};

/** «Pubblica nella raccolta» per una scheda o una domanda altrui: la spiegazione la vedranno tutti. */
export const publishSharedExplanation = async (request: AiRequest) => {
  const source = editableSource(request.targetOwnerId);
  if (!source) throw new LearningError("Puoi solo vedere questa raccolta: la spiegazione resta tua.");
  if (!request.result || !request.targetId) throw new LearningError("Spiegazione non trovata.");
  const blocks = request.result.blocks;
  const { flashcards, quizQuestions } = current(source);
  if (flashcards.some((card) => card.id === request.targetId)) return updateSharedCard(source, request.targetId, { explanation: blocks });
  const question = quizQuestions.find((item) => item.id === request.targetId);
  if (question) return saveSharedQuestion(source, question.quizId, { explanation: blocks }, question.id);
  throw new LearningError("La scheda non esiste più.");
};
