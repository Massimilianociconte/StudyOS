// Azioni su raccolte, flashcard, quiz, ripasso e richieste agli agenti. Scrivono nello store
// principale (collezioni sincronizzate) e salvano con retryPersist, come gli strumenti MCP.
// Le schede delle raccolte condivise da altri si modificano da useSharedStore (vedi sharedLearning).
import { createId } from "../lib/id";
import { laterStamp } from "../lib/collections";
import { thisDevice } from "../lib/learnDevice";
import { applyReview, type CardRef } from "../lib/srs";
import {
  appendRunEvent,
  cardSizeError,
  copyDeckTree,
  subtreeHeight,
  deckDescendantIds,
  deckSubjectId,
  isOpenRequest,
  LEARNING_LIMITS,
  newAiRequest,
  nextPosition,
  normalizeCardFields,
  normalizeDeckFields,
  normalizeQuestionFields,
  normalizeQuizFields,
  parentError,
  touchesContent,
  type DeckBundle
} from "../lib/learningModel";
import type {
  AiRequest,
  ContentAuthor,
  Flashcard,
  FlashcardState,
  Quiz,
  QuizQuestion,
  ReviewResult,
  StudyDeck,
  RunProgress,
  StudyMark,
  StudyMarkKind,
  StudyRun,
  StudyRunEvent,
  StudyRunMode
} from "../types";
import { useStudyStore } from "./useStudyStore";

type Learning = Pick<
  ReturnType<typeof useStudyStore.getState>,
  "decks" | "flashcards" | "quizzes" | "quizQuestions" | "cardStates" | "studyRuns" | "aiAnalyses" | "aiRequests" | "studyMarks"
>;

const state = () => useStudyStore.getState();

export class LearningError extends Error {}

/** Applica una modifica alle collezioni di studio e la salva (IndexedDB, poi cloud se attivo). */
export const commitLearning = async (patch: (current: Learning) => Partial<Learning>) => {
  const current = state();
  if (current.locked || current.loading) throw new LearningError("Workspace bloccato: sblocca StudyOS e riprova.");
  useStudyStore.setState(patch(current));
  await state().retryPersist();
};

const PERSON: ContentAuthor = { kind: "person" };

const base = (prefix: string, now: string) => ({ id: createId(prefix), createdAt: now, updatedAt: now, archived: false });

const must = <T>(result: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!result.ok) throw new LearningError(result.error);
  return result.value;
};

// ─── Raccolte ─────────────────────────────────────────────────────────────────────────────

/** Raccolta nuova (pura): le stesse regole per la libreria propria e per una condivisa con «Può modificare». */
export const buildDeck = (decks: readonly StudyDeck[], input: Record<string, unknown>, now: string): StudyDeck => {
  const fields = must(normalizeDeckFields(input, false));
  const problem = parentError(decks, undefined, fields.parentId);
  if (problem) throw new LearningError(problem);
  const siblings = decks.filter((deck) => (deck.parentId ?? undefined) === fields.parentId);
  return {
    ...base("deck", now),
    title: fields.title as string,
    description: fields.description ?? "",
    kind: fields.kind ?? "collection",
    position: fields.position ?? nextPosition(siblings),
    tags: fields.tags ?? [],
    ...(fields.parentId ? { parentId: fields.parentId } : {}),
    ...(fields.subjectId ? { subjectId: fields.subjectId } : {}),
    ...(fields.color ? { color: fields.color } : {}),
    ...(fields.icon ? { icon: fields.icon } : {}),
    ...(fields.source ? { source: fields.source } : {}),
    ...(fields.meta ? { meta: fields.meta } : {}),
    author: PERSON
  };
};

export const createDeck = async (input: Record<string, unknown>): Promise<StudyDeck> => {
  const deck = buildDeck(state().decks, input, new Date().toISOString());
  await commitLearning((current) => ({ decks: [...current.decks, deck] }));
  return deck;
};

/** Schede e quiz copiano la materia della raccolta: dopo un cambio di materia o di madre si riallineano. */
const resubject = (current: Learning, decks: StudyDeck[], touched: Set<string>, now: string): Partial<Learning> => {
  if (!touched.size) return { decks };
  const subjectOf = (deckId: string | undefined) => deckSubjectId(decks, deckId);
  const fix = <T extends { subjectId?: string; updatedAt: string }>(item: T, deckId: string | undefined): T => {
    if (!deckId || !touched.has(deckId)) return item;
    const subjectId = subjectOf(deckId);
    if ((item.subjectId ?? undefined) === subjectId) return item;
    const { subjectId: _old, ...rest } = item;
    return { ...(rest as T), ...(subjectId ? { subjectId } : {}), updatedAt: laterStamp(item.updatedAt, Date.parse(now)) };
  };
  const quizzes = current.quizzes.map((quiz) => fix(quiz, quiz.deckId));
  const quizDeck = new Map(quizzes.map((quiz) => [quiz.id, quiz.deckId]));
  return {
    decks,
    flashcards: current.flashcards.map((card) => fix(card, card.deckId)),
    quizzes,
    quizQuestions: current.quizQuestions.map((question) => fix(question, quizDeck.get(question.quizId)))
  };
};

/** Raccolta modificata (pura) e i campi cambiati. */
export const buildDeckUpdate = (decks: readonly StudyDeck[], id: string, input: Record<string, unknown>) => {
  const fields = must(normalizeDeckFields(input, true));
  const existing = decks.find((deck) => deck.id === id);
  if (!existing) throw new LearningError("Mazzo non trovato.");
  if ("parentId" in fields) {
    const problem = parentError(decks, id, fields.parentId);
    if (problem) throw new LearningError(problem);
  }
  const next: StudyDeck = { ...existing, ...fields, updatedAt: laterStamp(existing.updatedAt) };
  for (const key of Object.keys(fields) as (keyof StudyDeck)[]) if (next[key] === undefined) delete next[key];
  return { next, fields };
};

export const updateDeck = async (id: string, input: Record<string, unknown>) => {
  const { next, fields } = buildDeckUpdate(state().decks, id, input);
  const now = new Date().toISOString();
  await commitLearning((current) => {
    const nextDecks = current.decks.map((deck) => (deck.id === id ? next : deck));
    const moved = "subjectId" in fields || "parentId" in fields ? deckDescendantIds(nextDecks, id) : new Set<string>();
    return resubject(current, nextDecks, moved, now);
  });
  return next;
};

/** Elimina la raccolta con sotto-raccolte, schede, quiz, domande e i tuoi stati di ripasso. Lo storico delle sessioni resta. */
export const deleteDeck = async (id: string) => {
  const { decks } = state();
  if (!decks.some((deck) => deck.id === id)) throw new LearningError("Mazzo non trovato.");
  const gone = deckDescendantIds(decks, id);
  const now = new Date().toISOString();
  let removed = { decks: 0, flashcards: 0, quizzes: 0, quizQuestions: 0 };
  await commitLearning((current) => {
    const goneCards = new Set(current.flashcards.filter((card) => gone.has(card.deckId)).map((card) => card.id));
    const goneQuizzes = new Set(current.quizzes.filter((quiz) => quiz.deckId && gone.has(quiz.deckId)).map((quiz) => quiz.id));
    const goneQuestions = new Set(current.quizQuestions.filter((question) => goneQuizzes.has(question.quizId)).map((question) => question.id));
    removed = { decks: gone.size, flashcards: goneCards.size, quizzes: goneQuizzes.size, quizQuestions: goneQuestions.size };
    return {
      decks: current.decks.filter((deck) => !gone.has(deck.id)),
      flashcards: current.flashcards.filter((card) => !goneCards.has(card.id)),
      quizzes: current.quizzes.filter((quiz) => !goneQuizzes.has(quiz.id)),
      quizQuestions: current.quizQuestions.filter((question) => !goneQuestions.has(question.id)),
      cardStates: current.cardStates.filter((item) => item.ownerId || !goneCards.has(item.id)),
      studyMarks: current.studyMarks.filter((item) => item.ownerId || !(goneCards.has(item.id) || goneQuestions.has(item.id))),
      aiRequests: cancelOpenFor(current.aiRequests, new Set([...goneCards, ...goneQuestions]), now)
    };
  });
  return removed;
};

const cancelOpenFor = (requests: AiRequest[], targets: Set<string>, now: string) =>
  requests.map((request) =>
    request.targetId && !request.targetOwnerId && targets.has(request.targetId) && isOpenRequest(request, new Date(now))
      ? { ...request, status: "cancelled" as const, error: "Contenuto eliminato", updatedAt: laterStamp(request.updatedAt) }
      : request
  );

/** Copia indipendente (anche di una raccolta condivisa da un'altra persona). */
export const duplicateDeck = async (source: DeckBundle, rootId: string, options: { parentId?: string; subjectId?: string | null; title?: string } = {}) => {
  const now = new Date().toISOString();
  const { decks } = state();
  if (options.parentId) {
    // La copia porta con sé tutti i suoi livelli: contano tutti per la profondità massima.
    const problem = parentError(decks, undefined, options.parentId, subtreeHeight(source.decks, rootId));
    if (problem) throw new LearningError(problem);
  }
  const siblings = decks.filter((deck) => (deck.parentId ?? undefined) === options.parentId);
  const copy = copyDeckTree(source, rootId, { newId: createId, now, ...options, position: nextPosition(siblings) });
  if (!copy.decks.length) throw new LearningError("Mazzo da copiare non trovato.");
  await commitLearning((current) => ({
    decks: [...current.decks, ...copy.decks],
    flashcards: [...current.flashcards, ...copy.flashcards],
    quizzes: [...current.quizzes, ...copy.quizzes],
    quizQuestions: [...current.quizQuestions, ...copy.quizQuestions]
  }));
  return copy;
};

// ─── Flashcard ────────────────────────────────────────────────────────────────────────────

/** Scheda nuova (pura): la materia viene dalla raccolta. */
export const buildCard = (decks: readonly StudyDeck[], flashcards: readonly Flashcard[], deckId: string, input: Record<string, unknown>, now: string): Flashcard => {
  const fields = must(normalizeCardFields(input, false));
  if (!decks.some((deck) => deck.id === deckId)) throw new LearningError("Mazzo non trovato.");
  const problem = cardSizeError({ front: fields.front ?? [], back: fields.back ?? [], explanation: fields.explanation });
  if (problem) throw new LearningError(problem);
  const subjectId = deckSubjectId(decks, deckId);
  return {
    ...base("card", now),
    tags: fields.tags ?? [],
    deckId,
    ...(subjectId ? { subjectId } : {}),
    front: fields.front ?? [],
    back: fields.back ?? [],
    ...(fields.explanation ? { explanation: fields.explanation } : {}),
    ...(fields.title ? { title: fields.title } : {}),
    ...(fields.difficulty ? { difficulty: fields.difficulty } : {}),
    ...(fields.sources ? { sources: fields.sources } : {}),
    ...(fields.externalRef ? { externalRef: fields.externalRef } : {}),
    position: fields.position ?? nextPosition(flashcards.filter((item) => item.deckId === deckId)),
    author: PERSON,
    revision: 1
  };
};

export const createCard = async (deckId: string, input: Record<string, unknown>): Promise<Flashcard> => {
  const { decks, flashcards } = state();
  const card = buildCard(decks, flashcards, deckId, input, new Date().toISOString());
  await commitLearning((current) => ({ flashcards: [...current.flashcards, card] }));
  return card;
};

/** Scheda modificata (pura): la revisione sale solo se cambia il contenuto. */
export const buildCardUpdate = (flashcards: readonly Flashcard[], id: string, input: Record<string, unknown>): Flashcard => {
  const fields = must(normalizeCardFields(input, true));
  const existing = flashcards.find((card) => card.id === id);
  if (!existing) throw new LearningError("Scheda non trovata.");
  const next: Flashcard = {
    ...existing,
    ...fields,
    revision: touchesContent(fields) ? (existing.revision ?? 1) + 1 : existing.revision ?? 1,
    updatedAt: laterStamp(existing.updatedAt)
  };
  for (const key of Object.keys(fields) as (keyof Flashcard)[]) if (next[key] === undefined) delete next[key];
  const problem = cardSizeError(next);
  if (problem) throw new LearningError(problem);
  return next;
};

export const updateCard = async (id: string, input: Record<string, unknown>) => {
  const next = buildCardUpdate(state().flashcards, id, input);
  await commitLearning((current) => ({ flashcards: current.flashcards.map((card) => (card.id === id ? next : card)) }));
  return next;
};

export const moveCards = async (ids: readonly string[], deckId: string) => {
  const { decks } = state();
  if (!decks.some((deck) => deck.id === deckId)) throw new LearningError("Mazzo non trovato.");
  const set = new Set(ids);
  const subjectId = deckSubjectId(decks, deckId);
  await commitLearning((current) => {
    let position = nextPosition(current.flashcards.filter((card) => card.deckId === deckId));
    return {
      flashcards: current.flashcards.map((card) => {
        if (!set.has(card.id) || card.deckId === deckId) return card;
        const { subjectId: _old, ...rest } = card;
        return { ...rest, deckId, ...(subjectId ? { subjectId } : {}), position: position++, updatedAt: laterStamp(card.updatedAt) };
      }),
      cardStates: current.cardStates.map((item) => (set.has(item.id) && !item.ownerId ? { ...item, deckId, ...(subjectId ? { subjectId } : {}) } : item))
    };
  });
};

export const deleteCards = async (ids: readonly string[]) => {
  const set = new Set(ids);
  const now = new Date().toISOString();
  await commitLearning((current) => ({
    flashcards: current.flashcards.filter((card) => !set.has(card.id)),
    cardStates: current.cardStates.filter((item) => item.ownerId || !set.has(item.id)),
    studyMarks: current.studyMarks.filter((item) => item.ownerId || !set.has(item.id)),
    aiRequests: cancelOpenFor(current.aiRequests, set, now)
  }));
};

// ─── Quiz ─────────────────────────────────────────────────────────────────────────────────

/** Quiz nuovo (puro). */
export const buildQuiz = (decks: readonly StudyDeck[], quizzes: readonly Quiz[], input: Record<string, unknown>, now: string): Quiz => {
  const fields = must(normalizeQuizFields(input, false));
  if (fields.deckId && !decks.some((deck) => deck.id === fields.deckId)) throw new LearningError("Mazzo non trovato.");
  const subjectId = fields.subjectId ?? deckSubjectId(decks, fields.deckId);
  return {
    ...base("quiz", now),
    tags: fields.tags ?? [],
    title: fields.title as string,
    description: fields.description ?? "",
    ...(fields.deckId ? { deckId: fields.deckId } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(fields.difficulty ? { difficulty: fields.difficulty } : {}),
    ...(fields.timeLimitMinutes ? { timeLimitMinutes: fields.timeLimitMinutes } : {}),
    ...(fields.sources ? { sources: fields.sources } : {}),
    ...(fields.externalRef ? { externalRef: fields.externalRef } : {}),
    position: fields.position ?? nextPosition(quizzes.filter((item) => item.deckId === fields.deckId)),
    author: PERSON,
    revision: 1
  };
};

export const createQuiz = async (input: Record<string, unknown>): Promise<Quiz> => {
  const { decks, quizzes } = state();
  const quiz = buildQuiz(decks, quizzes, input, new Date().toISOString());
  await commitLearning((current) => ({ quizzes: [...current.quizzes, quiz] }));
  return quiz;
};

/** Quiz modificato (puro). */
export const buildQuizUpdate = (decks: readonly StudyDeck[], quizzes: readonly Quiz[], id: string, input: Record<string, unknown>): Quiz => {
  const fields = must(normalizeQuizFields(input, true));
  const existing = quizzes.find((quiz) => quiz.id === id);
  if (!existing) throw new LearningError("Quiz non trovato.");
  if (fields.deckId && !decks.some((deck) => deck.id === fields.deckId)) throw new LearningError("Mazzo non trovato.");
  const next: Quiz = { ...existing, ...fields, revision: touchesContent(fields) ? existing.revision + 1 : existing.revision, updatedAt: laterStamp(existing.updatedAt) };
  // Spostato in una raccolta: la materia è quella della raccolta (anche nessuna). Tolto da ogni
  // raccolta: resta la materia che aveva, salvo una scelta esplicita.
  if (fields.deckId && !("subjectId" in fields)) next.subjectId = deckSubjectId(decks, fields.deckId);
  for (const key of Object.keys(next) as (keyof Quiz)[]) if (next[key] === undefined) delete next[key];
  return next;
};

/** Domande allineate alla materia del loro quiz (come fa resubject per le raccolte). */
const alignQuestions = (questions: readonly QuizQuestion[], quiz: Quiz, now: string) =>
  questions.map((question) => {
    if (question.quizId !== quiz.id || (question.subjectId ?? undefined) === (quiz.subjectId ?? undefined)) return question;
    const { subjectId: _old, ...rest } = question;
    return { ...rest, ...(quiz.subjectId ? { subjectId: quiz.subjectId } : {}), updatedAt: laterStamp(question.updatedAt, Date.parse(now)) };
  });

export const updateQuiz = async (id: string, input: Record<string, unknown>) => {
  const { quizzes, decks } = state();
  const next = buildQuizUpdate(decks, quizzes, id, input);
  const now = new Date().toISOString();
  await commitLearning((current) => ({
    quizzes: current.quizzes.map((quiz) => (quiz.id === id ? next : quiz)),
    quizQuestions: alignQuestions(current.quizQuestions, next, now)
  }));
  return next;
};

export const deleteQuiz = async (id: string) => {
  const now = new Date().toISOString();
  await commitLearning((current) => {
    const gone = new Set(current.quizQuestions.filter((question) => question.quizId === id).map((question) => question.id));
    return {
      quizzes: current.quizzes.filter((quiz) => quiz.id !== id),
      quizQuestions: current.quizQuestions.filter((question) => question.quizId !== id),
      studyMarks: current.studyMarks.filter((item) => item.ownerId || !gone.has(item.id)),
      aiRequests: cancelOpenFor(current.aiRequests, gone, now)
    };
  });
};

/** Domanda nuova o modificata (pura). */
export const buildQuestion = (
  quizzes: readonly Quiz[],
  quizQuestions: readonly QuizQuestion[],
  quizId: string,
  input: Record<string, unknown>,
  id: string | undefined,
  now: string
): { next: QuizQuestion; previous?: QuizQuestion } => {
  const quiz = quizzes.find((item) => item.id === quizId);
  if (!quiz) throw new LearningError("Quiz non trovato.");
  const previous = id ? quizQuestions.find((question) => question.id === id) : undefined;
  if (id && !previous) throw new LearningError("Domanda non trovata.");
  const fields = must(normalizeQuestionFields(input, Boolean(previous), previous));
  const next: QuizQuestion = previous
    ? { ...previous, ...fields, revision: touchesContent(fields) ? previous.revision + 1 : previous.revision, updatedAt: laterStamp(previous.updatedAt) }
    : {
        ...base("qq", now),
        tags: fields.tags ?? [],
        quizId,
        ...(quiz.subjectId ? { subjectId: quiz.subjectId } : {}),
        kind: fields.kind ?? "single",
        prompt: fields.prompt ?? [],
        options: fields.options ?? [],
        ...(fields.explanation ? { explanation: fields.explanation } : {}),
        ...(fields.mistakes ? { mistakes: fields.mistakes } : {}),
        ...(fields.difficulty ? { difficulty: fields.difficulty } : {}),
        ...(fields.sources ? { sources: fields.sources } : {}),
        ...(fields.externalRef ? { externalRef: fields.externalRef } : {}),
        position: fields.position ?? nextPosition(quizQuestions.filter((question) => question.quizId === quizId)),
        revision: 1
      };
  for (const key of Object.keys(next) as (keyof QuizQuestion)[]) if (next[key] === undefined) delete next[key];
  return { next, ...(previous ? { previous } : {}) };
};

export const saveQuestion = async (quizId: string, input: Record<string, unknown>, id?: string): Promise<QuizQuestion> => {
  const { quizzes, quizQuestions } = state();
  const { next, previous } = buildQuestion(quizzes, quizQuestions, quizId, input, id, new Date().toISOString());
  await commitLearning((current) => ({
    quizQuestions: previous ? current.quizQuestions.map((question) => (question.id === next.id ? next : question)) : [...current.quizQuestions, next]
  }));
  return next;
};

export const deleteQuestions = async (ids: readonly string[]) => {
  const set = new Set(ids);
  const now = new Date().toISOString();
  await commitLearning((current) => ({
    quizQuestions: current.quizQuestions.filter((question) => !set.has(question.id)),
    studyMarks: current.studyMarks.filter((item) => item.ownerId || !set.has(item.id)),
    aiRequests: cancelOpenFor(current.aiRequests, set, now)
  }));
};

// ─── Sessioni di ripasso e tentativi di quiz ─────────────────────────────────────────────

export interface RunStart {
  kind: StudyRun["kind"];
  mode: StudyRunMode;
  title: string;
  deckIds: string[];
  subjectIds: string[];
  itemIds: string[];
  quizId?: string;
}

/** Sessione in memoria: diventa una riga solo con la prima risposta (niente sessioni vuote salvate). */
export const newRun = (start: RunStart, now = new Date()): StudyRun => {
  const iso = now.toISOString();
  return {
    ...base("run", iso),
    tags: [],
    kind: start.kind,
    mode: start.mode,
    title: start.title.slice(0, 200),
    ...(start.quizId ? { quizId: start.quizId } : {}),
    deckIds: start.deckIds.slice(0, 50),
    subjectIds: start.subjectIds.slice(0, 50),
    itemIds: start.itemIds.slice(0, 2000),
    startedAt: iso,
    events: []
  };
};

/**
 * Risposta salvata in una sessione di ripasso: tornando indietro si può cambiare (changeCardAnswer).
 * Riga e istante identificano l'evento; gli stati dicono da dove ripartire.
 */
export interface SavedAnswer {
  card: CardRef;
  result: ReviewResult;
  /** Riga della sessione che contiene l'evento (la continuazione, oltre 400 risposte). */
  runId: string;
  at: string;
  ms: number;
  /** Stato di ripasso prima della risposta (assente: scheda mai valutata). */
  before?: FlashcardState;
  /** Stato scritto dalla risposta (assente con «salta», che non lo tocca). */
  after?: FlashcardState;
}

const answerEvent = (card: CardRef, result: ReviewResult, iso: string, ms: number): StudyRunEvent => ({
  i: card.id,
  r: result,
  at: iso,
  ...(ms > 0 ? { ms: Math.min(3_600_000, Math.round(ms)) } : {}),
  ...(card.revision ? { v: card.revision } : {})
});

const appendToRun = (runs: readonly StudyRun[], run: StudyRun, event: StudyRunEvent, iso: string) => {
  const stored = runs.find((item) => item.id === run.id) ?? run;
  const { run: updated, next } = appendRunEvent(stored, event, () => createId("run"), iso);
  const list = runs.some((item) => item.id === run.id) ? runs.map((item) => (item.id === run.id ? updated : item)) : [...runs, updated];
  return { runs: next ? [...list, next] : list, latest: next ?? updated };
};

/** Punto di ripresa sulla riga della sessione (le altre righe della catena non lo portano). */
const withProgress = (runs: readonly StudyRun[], runId: string, progress: RunProgress): StudyRun[] => {
  const previousId = runs.find((item) => item.id === runId)?.continuesId;
  return runs.map((item) => (item.id === runId ? { ...item, progress } : item.id === previousId ? stripProgress(item) : item));
};

const stripProgress = (run: StudyRun): StudyRun => {
  if (!run.progress) return run;
  const { progress: _progress, ...rest } = run;
  return rest;
};

const putState = (states: readonly FlashcardState[], state: FlashcardState) =>
  states.some((item) => item.id === state.id) ? states.map((item) => (item.id === state.id ? state : item)) : [...states, state];

/**
 * Registra una risposta a una flashcard: evento nella sessione e nuovo stato di ripasso (salvo
 * «salta»). Restituisce la sessione aggiornata (o la continuazione oltre 400) e la risposta salvata.
 */
export const answerCard = async (
  run: StudyRun,
  card: CardRef,
  result: ReviewResult,
  ms: number,
  /** Posizione da cui riprendere se la sessione si interrompe (di solito la scheda dopo). */
  resumeAt?: number
): Promise<{ run: StudyRun; saved: SavedAnswer }> => {
  const now = new Date();
  const iso = now.toISOString();
  const event = answerEvent(card, result, iso, ms);
  let latest = run;
  let saved: SavedAnswer = { card, result, runId: run.id, at: iso, ms: event.ms ?? 0 };
  await commitLearning((current) => {
    const appended = appendToRun(current.studyRuns, run, event, iso);
    latest = appended.latest;
    const runs = resumeAt === undefined ? appended.runs : withProgress(appended.runs, appended.latest.id, { at: iso, index: resumeAt, device: thisDevice() });
    latest = runs.find((item) => item.id === appended.latest.id) ?? latest;
    const patch: Partial<Learning> = { studyRuns: runs };
    const previous = current.cardStates.find((item) => item.id === card.id);
    saved = { ...saved, runId: appended.latest.id, ...(previous ? { before: previous } : {}) };
    if (result !== "skip") {
      const nextState: FlashcardState = { ...applyReview(previous, card, result, now), updatedAt: laterStamp(previous?.updatedAt, now.getTime()) };
      patch.cardStates = putState(current.cardStates, nextState);
      saved = { ...saved, after: nextState };
    }
    return patch;
  });
  return { run: latest, saved };
};

/** Come answerCard, restituisce solo la sessione aggiornata. */
export const recordCardAnswer = async (run: StudyRun, card: CardRef, result: ReviewResult, ms: number): Promise<StudyRun> => (await answerCard(run, card, result, ms)).run;

/**
 * Cambia una risposta già data nella sessione (si è tornati alla scheda): l'evento prende il posto
 * di quello di prima, così le statistiche contano una sola risposta per quella volta. Lo stato di
 * ripasso riparte da com'era prima della risposta, se nessun altro l'ha cambiato nel frattempo
 * (un altro dispositivo, un'altra sessione); altrimenti la nuova risposta vale sullo stato attuale.
 * Se l'evento non c'è più (riga tolta altrove), la risposta si aggiunge alla sessione.
 */
export const changeCardAnswer = async (run: StudyRun, saved: SavedAnswer, result: ReviewResult, extraMs = 0): Promise<{ run: StudyRun; saved: SavedAnswer }> => {
  const now = new Date();
  const iso = now.toISOString();
  const { card } = saved;
  const event = answerEvent(card, result, iso, saved.ms + Math.max(0, extraMs));
  let latest = run;
  let next: SavedAnswer = { card, result, runId: saved.runId, at: iso, ms: event.ms ?? 0 };
  await commitLearning((current) => {
    const row = current.studyRuns.find((item) => item.id === saved.runId);
    const position = row ? row.events.findIndex((item) => item.i === card.id && item.at === saved.at) : -1;
    let runs: StudyRun[];
    if (row && position >= 0) {
      const events = row.events.slice();
      events[position] = event;
      const updated: StudyRun = { ...row, events, updatedAt: laterStamp(row.updatedAt, now.getTime()) };
      runs = current.studyRuns.map((item) => (item.id === row.id ? updated : item));
      latest = runs.find((item) => item.id === run.id) ?? run;
    } else {
      const appended = appendToRun(current.studyRuns, run, event, iso);
      runs = appended.runs;
      latest = appended.latest;
      next = { ...next, runId: appended.latest.id };
    }
    const patch: Partial<Learning> = { studyRuns: runs };
    const stored = current.cardStates.find((item) => item.id === card.id);
    // Lo stato è ancora quello scritto dalla risposta di prima: si riparte da prima di quella risposta.
    const ours = Boolean(saved.after && stored && stored.updatedAt === saved.after.updatedAt);
    const base = ours ? saved.before : stored;
    next = { ...next, ...(base ? { before: base } : {}) };
    if (result !== "skip") {
      const nextState: FlashcardState = { ...applyReview(base, card, result, now), updatedAt: laterStamp(stored?.updatedAt, now.getTime()) };
      patch.cardStates = putState(current.cardStates, nextState);
      next = { ...next, after: nextState };
    } else if (ours) {
      // «Salta» al posto di una risposta: la scheda torna com'era (mai valutata: niente stato).
      patch.cardStates = saved.before
        ? putState(current.cardStates, { ...saved.before, updatedAt: laterStamp(stored?.updatedAt, now.getTime()) })
        : current.cardStates.filter((item) => item.id !== card.id);
    }
    return patch;
  });
  return { run: latest, saved: next };
};

/** Chiude la sessione (se è stata salvata: almeno una risposta). */
export const finishRun = async (runId: string, score?: number) => {
  if (!state().studyRuns.some((item) => item.id === runId)) return;
  const iso = new Date().toISOString();
  await commitLearning((current) => ({
    studyRuns: current.studyRuns.map((item) =>
      item.id === runId && (!item.endedAt || item.progress)
        ? { ...stripProgress(item), endedAt: item.endedAt ?? iso, ...(score !== undefined ? { score } : {}), updatedAt: laterStamp(item.updatedAt) }
        : item
    )
  }));
};

/**
 * Mette in pausa una sessione o un tentativo: salva il punto di ripresa sulla riga (che si
 * sincronizza con gli altri dispositivi). Un tentativo di quiz senza riga la crea qui: le risposte
 * stanno nel punto di ripresa, gli eventi si scrivono solo alla fine (le statistiche non li vedono).
 */
export const saveRunProgress = async (run: StudyRun, progress: Omit<RunProgress, "at">) => {
  const iso = new Date().toISOString();
  let saved = run;
  await commitLearning((current) => {
    const stored = current.studyRuns.find((item) => item.id === run.id);
    if (stored?.endedAt) return {};
    const base = stored ?? run;
    saved = { ...base, progress: { ...progress, at: iso, device: thisDevice() }, updatedAt: laterStamp(base.updatedAt) };
    return { studyRuns: stored ? current.studyRuns.map((item) => (item.id === run.id ? saved : item)) : [...current.studyRuns, saved] };
  });
  return saved;
};

/**
 * Si riprende una sessione o un tentativo in pausa: lo segna come ripreso (quante volte, quando, e
 * se almeno una volta su un dispositivo diverso da quello dell'interruzione). Il segno resta anche a
 * sessione chiusa, così la si riconosce nello storico. Restituisce la riga aggiornata.
 */
export const markResumed = async (run: StudyRun): Promise<StudyRun> => {
  const iso = new Date().toISOString();
  let saved = run;
  await commitLearning((current) => {
    const stored = current.studyRuns.find((item) => item.id === run.id);
    if (!stored || stored.endedAt || !stored.progress) return {};
    const device = stored.progress.device;
    const away = Boolean(device && device.id !== thisDevice().id);
    const from = away ? device?.name : stored.resumed?.from;
    const elsewhere = away || Boolean(stored.resumed?.elsewhere);
    saved = {
      ...stored,
      resumed: { count: (stored.resumed?.count ?? 0) + 1, at: iso, ...(elsewhere ? { elsewhere } : {}), ...(from ? { from } : {}) },
      updatedAt: laterStamp(stored.updatedAt)
    };
    return { studyRuns: current.studyRuns.map((item) => (item.id === run.id ? saved : item)) };
  });
  return saved;
};

/**
 * Scarta una sessione in pausa. Un quiz (niente eventi salvati) sparisce; una sessione di flashcard
 * si chiude: le risposte già date restano nello storico, come il ripasso che hanno aggiornato.
 */
export const discardRun = async (runId: string) => {
  const iso = new Date().toISOString();
  await commitLearning((current) => {
    const stored = current.studyRuns.find((item) => item.id === runId);
    if (!stored) return {};
    if (stored.kind === "quiz" && !stored.events.length) return { studyRuns: current.studyRuns.filter((item) => item.id !== runId) };
    return { studyRuns: current.studyRuns.map((item) => (item.id === runId ? { ...stripProgress(item), endedAt: item.endedAt ?? iso, updatedAt: laterStamp(item.updatedAt) } : item)) };
  });
};

/**
 * Tentativo di quiz concluso, anche in simulazione d'esame. Punteggio deterministico su tutte le
 * risposte: corrette ÷ domande del tentativo (una domanda senza risposta vale come sbagliata);
 * nessun punteggio se il tentativo non ha domande. La prima riga porta il punteggio; oltre
 * LEARNING_LIMITS.runEvents risposte il resto va in righe di continuazione senza punteggio
 * (`continuesId`), che le statistiche leggono come risposte ma non come tentativi.
 */
export const saveQuizAttempt = async (run: StudyRun, events: StudyRunEvent[]) => {
  const iso = new Date().toISOString();
  const limit = LEARNING_LIMITS.runEvents;
  const total = new Set([...run.itemIds, ...events.map((event) => event.i)]).size;
  const right = new Set(events.filter((event) => event.r === "correct").map((event) => event.i)).size;
  const stored = state().studyRuns.find((item) => item.id === run.id);
  const saved: StudyRun = {
    ...stripProgress(run),
    // Ripreso: il segno sta sulla riga salvata (markResumed), anche se il lettore ha la copia di prima.
    ...(stored?.resumed && !run.resumed ? { resumed: stored.resumed } : {}),
    events: events.slice(0, limit),
    endedAt: iso,
    ...(total ? { score: Math.min(1, right / total) } : {}),
    updatedAt: laterStamp(stored?.updatedAt ?? run.updatedAt)
  };
  const { score: _score, resumed: _resumed, ...rest } = saved;
  const rows: StudyRun[] = [saved];
  for (let start = limit; start < events.length; start += limit) {
    rows.push({ ...rest, id: createId("run"), createdAt: iso, updatedAt: iso, continuesId: rows[rows.length - 1].id, itemIds: [], startedAt: events[start].at, events: events.slice(start, start + limit) });
  }
  await commitLearning((current) => ({ studyRuns: [...current.studyRuns.filter((item) => item.id !== run.id), ...rows] }));
  return saved;
};

/** Azzera il ripasso di alcune schede (tornano nuove). Lo storico resta. */
export const resetCardStates = async (cardIds: readonly string[]) => {
  const set = new Set(cardIds);
  await commitLearning((current) => ({ cardStates: current.cardStates.filter((item) => !set.has(item.id)) }));
};

// ─── Richieste agli agenti e analisi ─────────────────────────────────────────────────────

export const createAiRequest = async (fields: Parameters<typeof newAiRequest>[0]) => {
  const request = newAiRequest(fields, createId("aireq"), new Date());
  await commitLearning((current) => ({ aiRequests: [...current.aiRequests, request] }));
  return request;
};

export const cancelAiRequest = async (id: string) => {
  await commitLearning((current) => ({
    aiRequests: current.aiRequests.map((request) =>
      request.id === id && isOpenRequest(request, new Date()) ? { ...request, status: "cancelled" as const, updatedAt: laterStamp(request.updatedAt) } : request
    )
  }));
};

export const deleteAiRequest = async (id: string) => {
  await commitLearning((current) => ({ aiRequests: current.aiRequests.filter((request) => request.id !== id) }));
};

/** «Pubblica nella raccolta»: la spiegazione personale diventa la spiegazione della scheda (tua). */
export const publishExplanation = async (requestId: string) => {
  const { aiRequests, flashcards, quizQuestions } = state();
  const request = aiRequests.find((item) => item.id === requestId);
  if (!request?.result || !request.targetId) throw new LearningError("Spiegazione non trovata.");
  if (request.targetOwnerId) throw new LearningError("La flashcard è di un'altra persona: pubblica la spiegazione dal mazzo condiviso.");
  const blocks = request.result.blocks;
  if (flashcards.some((card) => card.id === request.targetId)) return updateCard(request.targetId, { explanation: blocks });
  const question = quizQuestions.find((item) => item.id === request.targetId);
  if (question) return saveQuestion(question.quizId, { explanation: blocks }, question.id);
  throw new LearningError("La flashcard o la domanda non esiste più.");
};

export const archiveAnalysis = async (id: string, archived: boolean) => {
  await commitLearning((current) => ({
    aiAnalyses: current.aiAnalyses.map((item) =>
      item.id === id ? { ...item, status: archived ? ("archived" as const) : ("active" as const), updatedAt: laterStamp(item.updatedAt) } : item
    )
  }));
};

export const deleteAnalysis = async (id: string) => {
  await commitLearning((current) => ({ aiAnalyses: current.aiAnalyses.filter((item) => item.id !== id) }));
};

// ─── Dubbi segnati ───────────────────────────────────────────────────────────────────────

export interface MarkTarget {
  kind: StudyMarkKind;
  /** Id della flashcard o della domanda (è anche l'id del segno). */
  id: string;
  ownerId?: string;
  deckId?: string;
  quizId?: string;
  subjectId?: string;
}

/** Segno nuovo (puro): copia materia, raccolta e quiz per raggruppare anche gli elementi altrui. */
export const buildMark = (target: MarkTarget, now: string): StudyMark => ({
  id: target.id,
  createdAt: now,
  updatedAt: now,
  archived: false,
  tags: [],
  kind: target.kind,
  ...(target.ownerId ? { ownerId: target.ownerId } : {}),
  ...(target.deckId ? { deckId: target.deckId } : {}),
  ...(target.quizId ? { quizId: target.quizId } : {}),
  ...(target.subjectId ? { subjectId: target.subjectId } : {})
});

/** Segna o toglie il dubbio su una flashcard o una domanda. `on` assente = inverte. Restituisce lo stato nuovo. */
export const toggleMark = async (target: MarkTarget, on?: boolean): Promise<boolean> => {
  const marked = state().studyMarks.some((item) => item.id === target.id);
  const next = on ?? !marked;
  if (next === marked) return marked;
  await commitLearning((current) => ({
    studyMarks: next ? [...current.studyMarks.filter((item) => item.id !== target.id), buildMark(target, new Date().toISOString())] : current.studyMarks.filter((item) => item.id !== target.id)
  }));
  return next;
};

/** Toglie il dubbio a più elementi insieme (un argomento chiarito). */
export const clearMarks = async (ids: readonly string[]) => {
  const set = new Set(ids);
  if (!state().studyMarks.some((item) => set.has(item.id))) return;
  await commitLearning((current) => ({ studyMarks: current.studyMarks.filter((item) => !set.has(item.id)) }));
};
