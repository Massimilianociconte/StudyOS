// Come si riparte: una sessione o un tentativo in pausa (dal punto salvato sulla riga, anche se è stato
// interrotto su un altro dispositivo) e il ripasso o il quiz dei soli dubbi.
import { resumePoint } from "../../lib/learnResume";
import { preparedFromIds, prepareQuiz } from "../../lib/learnSession";
import { sortByPosition } from "../../lib/learningModel";
import { LEARN_TEXT, type QuizMode } from "../../lib/labels/learn";
import type { DoubtItem } from "../../lib/learnMarks";
import type { SavedAnswer } from "../../store/learning";
import type { Quiz, QuizQuestion, StudyRun, StudyRunMode } from "../../types";
import type { QuizPlay } from "./QuizPlayer";
import type { SessionItem, SessionSpec } from "./StudySession";
import { findCard, type LearnData } from "./useLearnData";

/** Id del quiz misto sui dubbi: non è un quiz salvato, il tentativo lo porta solo come riferimento. */
export const DOUBTS_QUIZ_ID = "doubts";

/**
 * Tutte le parti di un quiz in parti fatte insieme: il tentativo porta `set:` più la chiave del gruppo
 * («set:deck:<id del mazzo>»), così ultimo e miglior punteggio e la ripresa restano del gruppo.
 */
export const SET_QUIZ_PREFIX = "set:";
export const setQuizId = (key: string) => `${SET_QUIZ_PREFIX}${key}`;

const QUIZ_MODE_OF_RUN: Partial<Record<StudyRunMode, QuizMode>> = { training: "training", exam: "exam", errors: "mistakes", random: "random" };

type Owner = { id: string; name: string };

/** Sessione di flashcard in pausa: la coda com'era, con le risposte già date fino al punto di ripresa. */
export const resumeSessionSpec = (data: LearnData, run: StudyRun): SessionSpec | null => {
  const point = resumePoint(data.studyRuns, run);
  if (!point) return null;
  const items: SessionItem[] = [];
  for (const id of point.itemIds) {
    const found = findCard(data, id);
    if (found) items.push({ card: found.card, ...(found.source.owner ? { owner: { id: found.source.owner.id, name: found.source.owner.name } } : {}) });
  }
  // Le risposte stanno in testa alla coda: ci si ferma alla prima scheda senza risposta.
  const answers: SavedAnswer[] = [];
  for (const item of items) {
    const hit = point.answered.get(item.card.id);
    if (!hit) break;
    answers.push({
      card: { id: item.card.id, deckId: item.card.deckId, subjectId: item.card.subjectId, revision: item.card.revision, ...(item.owner ? { ownerId: item.owner.id } : {}) },
      result: hit.event.r,
      runId: hit.runId,
      at: hit.event.at,
      ms: hit.event.ms ?? 0
    });
  }
  if (answers.length >= items.length) return null;
  return { title: run.title, items, deckIds: run.deckIds, subjectIds: run.subjectIds, mode: run.mode, resume: { run, answers } };
};

const allQuestions = (data: LearnData) => {
  const owners = new Map<string, Owner>();
  const questions: QuizQuestion[] = [...data.own.quizQuestions];
  const quizzes = new Map<string, { quiz: Quiz; owner?: Owner }>(data.own.quizzes.map((quiz) => [quiz.id, { quiz }]));
  for (const source of data.shared) {
    const owner = source.owner ? { id: source.owner.id, name: source.owner.name } : undefined;
    for (const question of source.bundle.quizQuestions) {
      questions.push(question);
      if (owner) owners.set(question.id, owner);
    }
    for (const quiz of source.bundle.quizzes) quizzes.set(quiz.id, { quiz, ...(owner ? { owner } : {}) });
  }
  return { questions, owners, quizzes };
};

const mixedQuiz = (id: string, title: string, now: string): Quiz => ({
  id,
  title,
  description: "",
  position: 0,
  revision: 1,
  createdAt: now,
  updatedAt: now,
  archived: false,
  tags: []
});

/** Tempo della simulazione di tutte le parti: la somma, solo se ogni parte ne ha uno. */
export const setTimeLimit = (quizzes: readonly Pick<Quiz, "timeLimitMinutes">[]): number | undefined =>
  quizzes.length && quizzes.every((quiz) => quiz.timeLimitMinutes && quiz.timeLimitMinutes > 0)
    ? quizzes.reduce((sum, quiz) => sum + (quiz.timeLimitMinutes as number), 0)
    : undefined;

/** Il quiz (non salvato) che fa tutte le parti insieme. Senza mazzo: i dubbi segnati restano della domanda. */
export const setQuiz = (key: string, title: string, options: { subjectId?: string; timeLimitMinutes?: number } = {}, now = new Date()): Quiz => ({
  ...mixedQuiz(setQuizId(key), title, now.toISOString()),
  ...(options.subjectId ? { subjectId: options.subjectId } : {}),
  ...(options.timeLimitMinutes ? { timeLimitMinutes: options.timeLimitMinutes } : {})
});

/**
 * Domande di tutte le parti, una parte dopo l'altra: le posizioni ripartono da 0 in ogni quiz, quindi
 * si rinumerano, altrimenti l'ordine del quiz (allenamento) alternerebbe la prima di ogni parte.
 */
export const setQuestions = (parts: readonly (readonly QuizQuestion[])[]): QuizQuestion[] =>
  parts.flatMap((questions) => sortByPosition(questions)).map((question, index) => ({ ...question, position: index }));

/** Tentativo di quiz in pausa: stesse domande, stesso ordine delle risposte, risposte date e posizione. */
export const resumeQuizPlay = (data: LearnData, run: StudyRun): QuizPlay | null => {
  const point = resumePoint(data.studyRuns, run);
  if (!point || !run.progress) return null;
  const { questions, owners, quizzes } = allQuestions(data);
  const seed = run.progress.seed ?? 0;
  const shuffle = run.progress.shuffle ?? false;
  const prepared = preparedFromIds(questions, point.itemIds, { seed, shuffle });
  if (!prepared.length) return null;
  const known = run.quizId ? quizzes.get(run.quizId) : undefined;
  let quiz = known?.quiz ?? mixedQuiz(run.quizId ?? DOUBTS_QUIZ_ID, run.title, run.startedAt);
  // Quiz in parti in simulazione: il tempo è la somma di quello delle parti, come all'avvio.
  if (!known && run.quizId?.startsWith(SET_QUIZ_PREFIX) && run.mode === "exam") {
    const parts = [...new Set(prepared.map((item) => item.question.quizId))].map((id) => quizzes.get(id)?.quiz);
    const minutes = parts.every(Boolean) ? setTimeLimit(parts as Quiz[]) : undefined;
    if (minutes) quiz = { ...quiz, timeLimitMinutes: minutes };
  }
  return {
    quiz,
    // Quiz misto: le posizioni seguono l'ordine del tentativo («Rifai» non mescola le parti tra loro).
    prepared: known ? prepared : prepared.map((item, index) => ({ ...item, question: { ...item.question, position: index } })),
    mode: QUIZ_MODE_OF_RUN[run.mode] ?? "training",
    seed,
    shuffle,
    resume: run,
    ...(known?.owner ? { owner: known.owner } : {}),
    ...(!known ? { ownerOf: owners } : {})
  };
};

/** Ripasso delle sole flashcard segnate come dubbio (nell'ordine dei gruppi). */
export const doubtsSessionSpec = (items: readonly DoubtItem[]): SessionSpec | null => {
  const cards = items.filter((item): item is DoubtItem & { card: NonNullable<DoubtItem["card"]> } => Boolean(item.card));
  if (!cards.length) return null;
  return {
    title: LEARN_TEXT.doubtsSessionTitle,
    items: cards.map((item) => ({ card: item.card, ...(item.owner ? { owner: item.owner } : {}) })),
    deckIds: [...new Set(cards.map((item) => item.card.deckId))].slice(0, 50),
    subjectIds: [...new Set(cards.map((item) => item.subjectId).filter((id): id is string => Boolean(id)))],
    mode: "custom"
  };
};

/** Sessione su schede scelte (per esempio «le più difficili» in Andamento), nell'ordine dato. */
export const cardsSessionSpec = (data: LearnData, cardIds: readonly string[], title: string): SessionSpec | null => {
  const items: SessionItem[] = [];
  for (const id of cardIds) {
    const found = findCard(data, id);
    if (found) items.push({ card: found.card, ...(found.source.owner ? { owner: { id: found.source.owner.id, name: found.source.owner.name } } : {}) });
  }
  if (!items.length) return null;
  return {
    title,
    items,
    deckIds: [...new Set(items.map((item) => item.card.deckId))].slice(0, 50),
    subjectIds: [...new Set(items.map((item) => item.card.subjectId).filter((id): id is string => Boolean(id)))],
    mode: "custom"
  };
};

/** Quiz in allenamento sulle sole domande segnate come dubbio, anche di quiz diversi. */
export const doubtsQuizPlay = (items: readonly DoubtItem[], now = new Date()): QuizPlay | null => {
  const picked = items.filter((item) => item.question);
  if (!picked.length) return null;
  const seed = now.getTime() % 100_000;
  const prepared = prepareQuiz(
    picked.map((item) => item.question as QuizQuestion),
    { seed, shuffle: false }
  );
  if (!prepared.length) return null;
  const ownerOf = new Map<string, Owner>();
  for (const item of picked) if (item.owner && item.question) ownerOf.set(item.question.id, item.owner);
  return { quiz: mixedQuiz(DOUBTS_QUIZ_ID, LEARN_TEXT.doubtsQuizTitle, now.toISOString()), prepared, mode: "training", seed, shuffle: false, ownerOf };
};
