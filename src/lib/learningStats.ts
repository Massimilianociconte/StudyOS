// Statistiche di flashcard e quiz: calcolate dai dati locali, deterministiche, con definizioni
// dichiarate (le stesse mostrate nell'app e restituite agli agenti).
import { addDays, startOfDay, subDays } from "date-fns";
import { classifyCard } from "./srs";
import { deckDescendantIds, deckSubjectId } from "./learningModel";
import type { Flashcard, FlashcardState, Quiz, QuizQuestion, StudyDeck, StudyRun } from "../types";

export const STAT_DEFINITIONS = {
  accuracy: "Correttezza = corrette ÷ (corrette + sbagliate + dubbie). Le saltate non contano. Senza risposte non c'è un valore.",
  trend: "Tendenza = correttezza degli ultimi 14 giorni meno quella dei 14 precedenti; serve almeno 5 risposte per periodo.",
  time: "Tempo = somma dei tempi di risposta; ogni risposta conta al massimo 2 minuti (le pause non gonfiano il totale).",
  due: "Da ripassare = schede con scadenza entro la fine di oggi; in ritardo = scadenza prima di oggi.",
  difficult: "Difficile = almeno 3 errori o facilità sotto 1,8.",
  consolidated: "Consolidata = intervallo di almeno 21 giorni e ultima risposta corretta.",
  quizScore: "Punteggio di un quiz = domande corrette ÷ domande del quiz. Risposta multipla: giusta solo se l'insieme scelto coincide (niente punteggio parziale).",
  streak: "Serie = giorni consecutivi con almeno una risposta, fino a oggi (o fino a ieri se oggi non hai ancora studiato)."
} as const;

const MAX_MS_PER_ANSWER = 120_000;
const TREND_DAYS = 14;
const TREND_MIN = 5;

export interface StatsFilter {
  subjectIds?: readonly string[];
  /** Raccolte (con le sotto-raccolte). */
  deckIds?: readonly string[];
  /** Periodo delle risposte in giorni (oggi compreso); assente = tutto lo storico. */
  days?: number;
}

export interface StatsInput {
  cards: readonly Pick<Flashcard, "id" | "deckId" | "subjectId">[];
  decks: readonly Pick<StudyDeck, "id" | "parentId" | "subjectId" | "title" | "position" | "createdAt">[];
  states: readonly FlashcardState[];
  runs: readonly StudyRun[];
  quizzes: readonly Pick<Quiz, "id" | "title" | "deckId" | "subjectId">[];
  questions: readonly Pick<QuizQuestion, "id" | "quizId">[];
  now: Date;
  filter?: StatsFilter;
  /** Giorni del grafico giornaliero (predefinito 30, massimo 365). */
  chartDays?: number;
}

export interface AnswerCounts {
  correct: number;
  wrong: number;
  doubt: number;
  skip: number;
}

export interface DayPoint extends AnswerCounts {
  date: string;
  ms: number;
}

const emptyCounts = (): AnswerCounts => ({ correct: 0, wrong: 0, doubt: 0, skip: 0 });

export const accuracyOf = (counts: Pick<AnswerCounts, "correct" | "wrong" | "doubt">): number | null => {
  const total = counts.correct + counts.wrong + counts.doubt;
  return total ? counts.correct / total : null;
};

const pad2 = (value: number) => (value < 10 ? `0${value}` : String(value));
const QUARTER_HOUR = 900_000;

/**
 * Giorno locale (aaaa-mm-gg) di un istante. Tutti i fusi hanno offset e cambi d'ora multipli di 15
 * minuti: dentro uno stesso quarto d'ora UTC il giorno locale non cambia, quindi si calcola una volta
 * per quarto d'ora (le risposte di una sessione cadono in pochi quarti d'ora). Una cache per calcolo.
 */
const dayKeyer = () => {
  const cache = new Map<number, string>();
  return (value: Date | number) => {
    const bucket = Math.floor((typeof value === "number" ? value : value.getTime()) / QUARTER_HOUR);
    let key = cache.get(bucket);
    if (key === undefined) {
      const date = new Date(bucket * QUARTER_HOUR);
      key = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
      cache.set(bucket, key);
    }
    return key;
  };
};

const add = (target: AnswerCounts, result: string) => {
  if (result === "correct" || result === "wrong" || result === "doubt" || result === "skip") target[result]++;
};

export const learningStats = (input: StatsInput) => {
  const { now, filter } = input;
  const dayKey = dayKeyer();
  const decks = input.decks as StudyDeck[];
  const deckById = new Map(decks.map((deck) => [deck.id, deck]));
  let deckScope: Set<string> | null = null;
  if (filter?.deckIds?.length) {
    deckScope = new Set<string>();
    for (const id of filter.deckIds) for (const inner of deckDescendantIds(decks, id)) deckScope.add(inner);
  }
  const subjectScope = filter?.subjectIds?.length ? new Set(filter.subjectIds) : null;
  // Materia per raccolta, una volta per chiamata: schede ed eventi la chiedono migliaia di volte.
  const deckSubjects = new Map<string, string | undefined>();
  const subjectOfDeck = (deckId: string | undefined) => {
    if (!deckId) return undefined;
    if (!deckSubjects.has(deckId)) deckSubjects.set(deckId, deckSubjectId(decks, deckId));
    return deckSubjects.get(deckId);
  };
  const subjectOfCard = (card: Pick<Flashcard, "deckId" | "subjectId">) => card.subjectId ?? subjectOfDeck(card.deckId);
  const cards = input.cards.filter(
    (card) => (!deckScope || deckScope.has(card.deckId)) && (!subjectScope || subjectScope.has(subjectOfCard(card) ?? ""))
  );
  const cardById = new Map(cards.map((card) => [card.id, card]));
  const stateById = new Map(input.states.map((state) => [state.id, state]));

  // Schede: stato attuale.
  const totals = { total: cards.length, new: 0, studied: 0, due: 0, overdue: 0, difficult: 0, doubtful: 0, consolidated: 0, learning: 0 };
  const perDeck = new Map<string, { cards: number; studied: number; due: number; difficult: number; answers: AnswerCounts }>();
  const perSubject = new Map<string, { cards: number; studied: number; due: number; answers: AnswerCounts }>();
  const forecast = new Map<string, number>();
  const todayStart = startOfDay(now);
  const forecastEnd = addDays(todayStart, 7).getTime();
  for (const card of cards) {
    const state = stateById.get(card.id);
    const info = classifyCard(state, now);
    const deck = perDeck.get(card.deckId) ?? { cards: 0, studied: 0, due: 0, difficult: 0, answers: emptyCounts() };
    const subjectId = subjectOfCard(card) ?? "";
    const subject = perSubject.get(subjectId) ?? { cards: 0, studied: 0, due: 0, answers: emptyCounts() };
    deck.cards++;
    subject.cards++;
    if (info.isNew) totals.new++;
    else {
      totals.studied++;
      deck.studied++;
      subject.studied++;
    }
    if (info.due) {
      totals.due++;
      deck.due++;
      subject.due++;
    }
    if (info.overdue) totals.overdue++;
    if (info.difficult) {
      totals.difficult++;
      deck.difficult++;
    }
    if (info.doubtful) totals.doubtful++;
    if (info.consolidated) totals.consolidated++;
    if (info.status === "learning") totals.learning++;
    if (state && !info.isNew) {
      const due = Date.parse(state.due);
      if (Number.isFinite(due) && due >= todayStart.getTime() && due < forecastEnd) {
        const key = dayKey(due);
        forecast.set(key, (forecast.get(key) ?? 0) + 1);
      }
    }
    perDeck.set(card.deckId, deck);
    perSubject.set(subjectId, subject);
  }

  // Risposte nel periodo.
  const from = filter?.days ? subDays(todayStart, Math.max(1, Math.floor(filter.days)) - 1).getTime() : -Infinity;
  const chartDays = Math.min(365, Math.max(1, Math.floor(input.chartDays ?? filter?.days ?? 30)));
  const chartFrom = subDays(todayStart, chartDays - 1).getTime();
  const daily = new Map<string, DayPoint>();
  for (let i = 0; i < chartDays; i++) {
    const date = dayKey(addDays(subDays(todayStart, chartDays - 1), i));
    daily.set(date, { date, ...emptyCounts(), ms: 0 });
  }
  const answers = emptyCounts();
  const trendNow = emptyCounts();
  const trendBefore = emptyCounts();
  const trendNowFrom = subDays(todayStart, TREND_DAYS - 1).getTime();
  const trendBeforeFrom = subDays(todayStart, 2 * TREND_DAYS - 1).getTime();
  const activeDays = new Set<string>();
  const cardHistory = new Map<string, AnswerCounts>();
  let timeMs = 0;
  let sessions = 0;
  for (const run of input.runs) {
    if (run.kind !== "flashcards") continue;
    let counted = false;
    for (const event of run.events) {
      const card = cardById.get(event.i);
      if (!card) continue;
      const at = Date.parse(event.at);
      if (!Number.isFinite(at)) continue;
      if (event.r !== "skip") activeDays.add(dayKey(at));
      if (at >= trendNowFrom) add(trendNow, event.r);
      else if (at >= trendBeforeFrom) add(trendBefore, event.r);
      if (at < from) continue;
      counted = true;
      add(answers, event.r);
      const ms = Math.min(MAX_MS_PER_ANSWER, Math.max(0, event.ms ?? 0));
      timeMs += ms;
      const history = cardHistory.get(card.id) ?? emptyCounts();
      add(history, event.r);
      cardHistory.set(card.id, history);
      add((perDeck.get(card.deckId) as { answers: AnswerCounts }).answers, event.r);
      add((perSubject.get(subjectOfCard(card) ?? "") as { answers: AnswerCounts }).answers, event.r);
      if (at >= chartFrom) {
        const point = daily.get(dayKey(at));
        if (point) {
          add(point, event.r);
          point.ms += ms;
        }
      }
    }
    if (counted) sessions++;
  }

  const accNow = trendNow.correct + trendNow.wrong + trendNow.doubt >= TREND_MIN ? accuracyOf(trendNow) : null;
  const accBefore = trendBefore.correct + trendBefore.wrong + trendBefore.doubt >= TREND_MIN ? accuracyOf(trendBefore) : null;
  const trend = accNow !== null && accBefore !== null ? { current: accNow, previous: accBefore, delta: accNow - accBefore } : null;

  // Quiz: tentativi conclusi nel periodo, nello stesso ambito.
  const quizById = new Map(input.quizzes.map((quiz) => [quiz.id, quiz]));
  const quizInScope = (quiz: Pick<Quiz, "deckId" | "subjectId"> | undefined) => {
    if (!quiz) return false;
    if (deckScope && (!quiz.deckId || !deckScope.has(quiz.deckId))) return false;
    if (subjectScope && !subjectScope.has(quiz.subjectId ?? subjectOfDeck(quiz.deckId) ?? "")) return false;
    return true;
  };
  const questionQuiz = new Map(input.questions.map((question) => [question.id, question.quizId]));
  const perQuiz = new Map<string, { attempts: number; scores: number[]; lastScore: number | null; lastAt: string }>();
  const missed = new Map<string, { quizId: string; wrong: number; total: number }>();
  const allScores: number[] = [];
  let lastScore: number | null = null;
  let lastAt = "";
  for (const run of input.runs) {
    if (run.kind !== "quiz" || !run.endedAt) continue;
    const started = Date.parse(run.startedAt);
    if (!Number.isFinite(started) || started < from) continue;
    for (const event of run.events) {
      const quizId = questionQuiz.get(event.i);
      if (!quizId || !quizInScope(quizById.get(quizId))) continue;
      const at = Date.parse(event.at);
      if (Number.isFinite(at) && event.r !== "skip") activeDays.add(dayKey(at));
      const item = missed.get(event.i) ?? { quizId, wrong: 0, total: 0 };
      item.total++;
      if (event.r === "wrong" || event.r === "skip") item.wrong++;
      missed.set(event.i, item);
    }
    if (run.quizId && quizInScope(quizById.get(run.quizId)) && typeof run.score === "number") {
      const entry = perQuiz.get(run.quizId) ?? { attempts: 0, scores: [], lastScore: null, lastAt: "" };
      entry.attempts++;
      entry.scores.push(run.score);
      if (run.endedAt > entry.lastAt) {
        entry.lastAt = run.endedAt;
        entry.lastScore = run.score;
      }
      perQuiz.set(run.quizId, entry);
      allScores.push(run.score);
      if (run.endedAt > lastAt) {
        lastAt = run.endedAt;
        lastScore = run.score;
      }
    }
  }
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

  // Serie di giorni.
  let streakDays = 0;
  let cursor = activeDays.has(dayKey(now)) ? todayStart : subDays(todayStart, 1);
  while (activeDays.has(dayKey(cursor))) {
    streakDays++;
    cursor = subDays(cursor, 1);
  }

  const hardest = [...cardHistory.entries()]
    .map(([cardId, counts]) => {
      const total = counts.correct + counts.wrong + counts.doubt;
      return { cardId, deckId: cardById.get(cardId)?.deckId ?? "", ...counts, total, errorRate: total ? (counts.wrong + counts.doubt) / total : 0 };
    })
    .filter((item) => item.total >= 2 && item.errorRate > 0)
    .sort((a, b) => b.errorRate - a.errorRate || b.wrong - a.wrong || a.cardId.localeCompare(b.cardId))
    .slice(0, 10);

  return {
    definitions: STAT_DEFINITIONS,
    cards: totals,
    answers: { ...answers, total: answers.correct + answers.wrong + answers.doubt, accuracy: accuracyOf(answers) },
    timeMs,
    sessions,
    trend,
    streakDays,
    daily: [...daily.values()],
    forecast: Array.from({ length: 7 }, (_, i) => {
      const date = dayKey(addDays(todayStart, i));
      return { date, due: forecast.get(date) ?? 0 };
    }),
    decks: [...perDeck.entries()]
      .map(([deckId, value]) => ({ deckId, title: deckById.get(deckId)?.title ?? "", ...value, accuracy: accuracyOf(value.answers) }))
      .sort((a, b) => b.cards - a.cards || a.title.localeCompare(b.title, "it")),
    subjects: [...perSubject.entries()]
      .map(([subjectId, value]) => ({ subjectId: subjectId || null, ...value, accuracy: accuracyOf(value.answers) }))
      .sort((a, b) => b.cards - a.cards),
    hardest,
    quiz: {
      attempts: allScores.length,
      avgScore: mean(allScores),
      bestScore: allScores.length ? Math.max(...allScores) : null,
      lastScore,
      perQuiz: [...perQuiz.entries()]
        .map(([quizId, value]) => ({ quizId, title: quizById.get(quizId)?.title ?? "", attempts: value.attempts, avgScore: mean(value.scores), lastScore: value.lastScore, lastAt: value.lastAt }))
        .sort((a, b) => b.lastAt.localeCompare(a.lastAt)),
      missed: [...missed.entries()]
        .map(([questionId, value]) => ({ questionId, ...value, errorRate: value.total ? value.wrong / value.total : 0 }))
        .filter((item) => item.wrong > 0)
        .sort((a, b) => b.errorRate - a.errorRate || b.wrong - a.wrong || a.questionId.localeCompare(b.questionId))
        .slice(0, 10)
    }
  };
};

export type LearningStats = ReturnType<typeof learningStats>;
