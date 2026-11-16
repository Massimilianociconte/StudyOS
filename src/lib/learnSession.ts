// Logica pura della sezione Ripasso: albero delle raccolte con i conteggi, coda di una sessione,
// preparazione di un quiz (mescolato in modo riproducibile), ultimi errori di un quiz.
import { classifyCard, reviewPriority } from "./srs";
import { deckDescendantIds, sortByPosition } from "./learningModel";
import { safeOptions, scoreQuestion, shuffled } from "./quizScoring";
import type { SessionFilter } from "./labels/learn";
import type { Flashcard, FlashcardState, Quiz, QuizQuestion, StudyDeck, StudyRun } from "../types";

export interface DeckCounts {
  /** Schede nella raccolta e nelle sotto-raccolte. */
  cards: number;
  direct: number;
  due: number;
  fresh: number;
  quizzes: number;
  subdecks: number;
}

export interface DeckNode {
  deck: StudyDeck;
  depth: number;
  counts: DeckCounts;
  children: DeckNode[];
}

/** Ordine di visita (radici e figlie per posizione): schede e raccolte in elenchi stabili. */
export const deckVisitOrder = (decks: readonly StudyDeck[]) => {
  const order = new Map<string, number>();
  const byParent = new Map<string | undefined, StudyDeck[]>();
  const known = new Set(decks.map((deck) => deck.id));
  for (const deck of decks) {
    // Madre non visibile (condivisione parziale, eliminata altrove): la raccolta sale in cima.
    const parent = deck.parentId && known.has(deck.parentId) ? deck.parentId : undefined;
    byParent.set(parent, [...(byParent.get(parent) ?? []), deck]);
  }
  const visit = (parentId: string | undefined) => {
    for (const deck of sortByPosition(byParent.get(parentId) ?? [])) {
      if (order.has(deck.id)) continue;
      order.set(deck.id, order.size);
      visit(deck.id);
    }
  };
  visit(undefined);
  for (const deck of decks) if (!order.has(deck.id)) order.set(deck.id, order.size);
  return order;
};

/** Albero delle raccolte con i conteggi aggregati (sotto-raccolte comprese). */
export const buildDeckTree = (
  decks: readonly StudyDeck[],
  cards: readonly Flashcard[],
  states: ReadonlyMap<string, FlashcardState>,
  quizzes: readonly Quiz[],
  now: Date
): DeckNode[] => {
  const known = new Set(decks.map((deck) => deck.id));
  const direct = new Map<string, { cards: number; due: number; fresh: number; quizzes: number }>();
  const bump = (deckId: string) => {
    let entry = direct.get(deckId);
    if (!entry) {
      entry = { cards: 0, due: 0, fresh: 0, quizzes: 0 };
      direct.set(deckId, entry);
    }
    return entry;
  };
  for (const card of cards) {
    const entry = bump(card.deckId);
    entry.cards++;
    const info = classifyCard(states.get(card.id), now);
    if (info.isNew) entry.fresh++;
    else if (info.due) entry.due++;
  }
  for (const quiz of quizzes) if (quiz.deckId) bump(quiz.deckId).quizzes++;
  const children = new Map<string | undefined, StudyDeck[]>();
  for (const deck of decks) {
    const parent = deck.parentId && known.has(deck.parentId) ? deck.parentId : undefined;
    children.set(parent, [...(children.get(parent) ?? []), deck]);
  }
  const seen = new Set<string>();
  const node = (deck: StudyDeck, depth: number): DeckNode => {
    const nested = depth < 12 ? build(deck.id, depth + 1) : [];
    const own = direct.get(deck.id) ?? { cards: 0, due: 0, fresh: 0, quizzes: 0 };
    const counts: DeckCounts = { cards: own.cards, direct: own.cards, due: own.due, fresh: own.fresh, quizzes: own.quizzes, subdecks: 0 };
    for (const child of nested) {
      counts.cards += child.counts.cards;
      counts.due += child.counts.due;
      counts.fresh += child.counts.fresh;
      counts.quizzes += child.counts.quizzes;
      counts.subdecks += 1 + child.counts.subdecks;
    }
    return { deck, depth, counts, children: nested };
  };
  const build = (parentId: string | undefined, depth: number): DeckNode[] =>
    sortByPosition(children.get(parentId) ?? [])
      .filter((deck) => !seen.has(deck.id) && seen.add(deck.id))
      .map((deck) => node(deck, depth));
  const roots = build(undefined, 0);
  // Genitori in ciclo (A sotto B su un dispositivo, B sotto A su un altro: vince l'ultima scrittura
  // di ogni riga) o oltre la profondità massima: nessuna radice le raggiunge. Si mostrano in cima,
  // così raccolte e schede restano visibili e si possono spostare.
  for (const deck of sortByPosition(decks)) {
    if (seen.has(deck.id)) continue;
    seen.add(deck.id);
    roots.push(node(deck, 0));
  }
  return roots;
};

/** Raccolte dell'albero in ordine piatto, con la profondità (per selettori e liste). */
export const flattenTree = (nodes: readonly DeckNode[]): DeckNode[] => nodes.flatMap((node) => [node, ...flattenTree(node.children)]);

export interface QueueOptions {
  filter: SessionFilter;
  limit: number;
  order: "priority" | "shuffle";
  seed: number;
}

/**
 * Coda di una sessione. «Da ripassare»: scadute e di oggi, prima quelle in ritardo da più tempo.
 * «Nuove»: mai viste, nell'ordine della raccolta. «Tutte»: da ripassare, poi nuove, poi le altre per
 * scadenza. «A caso»: tutte mescolate.
 */
export const buildQueue = (
  cards: readonly Flashcard[],
  states: ReadonlyMap<string, FlashcardState>,
  decks: readonly StudyDeck[],
  now: Date,
  options: QueueOptions
): Flashcard[] => {
  const order = deckVisitOrder(decks);
  const inDeckOrder = (a: Flashcard, b: Flashcard) =>
    (order.get(a.deckId) ?? 0) - (order.get(b.deckId) ?? 0) || a.position - b.position || a.createdAt.localeCompare(b.createdAt);
  const classified = cards.map((card) => ({ card, state: states.get(card.id), info: classifyCard(states.get(card.id), now) }));
  let picked: typeof classified;
  switch (options.filter) {
    case "due":
      picked = classified.filter((item) => item.info.due).sort((a, b) => reviewPriority(a.state) - reviewPriority(b.state) || inDeckOrder(a.card, b.card));
      break;
    case "new":
      picked = classified.filter((item) => item.info.isNew).sort((a, b) => inDeckOrder(a.card, b.card));
      break;
    case "difficult":
      picked = classified.filter((item) => item.info.difficult).sort((a, b) => (b.state?.lapses ?? 0) - (a.state?.lapses ?? 0) || inDeckOrder(a.card, b.card));
      break;
    case "doubtful":
      picked = classified.filter((item) => item.info.doubtful).sort((a, b) => inDeckOrder(a.card, b.card));
      break;
    case "random":
      picked = shuffled(classified, options.seed);
      break;
    default: {
      const rank = (item: (typeof classified)[number]) => (item.info.due ? 0 : item.info.isNew ? 1 : 2);
      picked = classified.slice().sort((a, b) => rank(a) - rank(b) || reviewPriority(a.state) - reviewPriority(b.state) || inDeckOrder(a.card, b.card));
    }
  }
  const limited = picked.slice(0, Math.max(1, Math.floor(options.limit)));
  const result = limited.map((item) => item.card);
  return options.order === "shuffle" && options.filter !== "random" ? shuffled(result, options.seed) : result;
};

/** Schede di alcune raccolte (con le sotto-raccolte); nessuna raccolta scelta = tutte. */
export const cardsInDecks = (cards: readonly Flashcard[], decks: readonly StudyDeck[], deckIds: readonly string[]) => {
  if (!deckIds.length) return cards.slice();
  const scope = new Set<string>();
  for (const id of deckIds) for (const inner of deckDescendantIds(decks, id)) scope.add(inner);
  return cards.filter((card) => scope.has(card.deckId));
};

export interface PreparedQuestion {
  question: QuizQuestion;
  /** Opzioni nell'ordine mostrato (mescolate); gli id restano quelli salvati. */
  options: QuizQuestion["options"];
}

/** Domande sbagliate o lasciate vuote nell'ultimo tentativo concluso di un quiz. */
export const lastMistakes = (runs: readonly StudyRun[], quizId: string): Set<string> => {
  const last = runs
    .filter((run) => run.kind === "quiz" && run.quizId === quizId && run.endedAt)
    .sort((a, b) => (a.endedAt as string).localeCompare(b.endedAt as string))
    .at(-1);
  if (!last) return new Set();
  const right = new Set(last.events.filter((event) => event.r === "correct").map((event) => event.i));
  return new Set(last.itemIds.filter((id) => !right.has(id)));
};

/** Domande di un tentativo: ordine e opzioni mescolati con lo stesso seme (riproducibile). */
export const prepareQuiz = (questions: readonly QuizQuestion[], options: { seed: number; only?: ReadonlySet<string>; limit?: number; shuffle?: boolean }): PreparedQuestion[] => {
  const base = sortByPosition(questions.filter((question) => !options.only || options.only.has(question.id)));
  const ordered = options.shuffle === false ? base : shuffled(base, options.seed);
  return ordered.slice(0, options.limit ?? ordered.length).map((raw, index) => {
    // Le opzioni malformate (righe scritte fuori dall'app) restano fuori da domanda, punteggio e revisione.
    const safe = safeOptions(raw.options);
    const question = { ...raw, options: safe };
    return { question, options: options.shuffle === false ? safe : shuffled(safe, options.seed + index + 1) };
  });
};

export interface QuizReview {
  questionId: string;
  outcome: "correct" | "wrong" | "skip";
  chosen: string[];
}

/** Esito di ogni domanda di un tentativo (le non date valgono come «skip», 0 punti). */
export const reviewAnswers = (prepared: readonly PreparedQuestion[], answers: ReadonlyMap<string, readonly string[]>): QuizReview[] =>
  prepared.map(({ question }) => {
    const chosen = [...(answers.get(question.id) ?? [])];
    return { questionId: question.id, outcome: scoreQuestion(question, chosen), chosen };
  });

/** 0,756 → «76%»; null → «—». */
export const percent = (value: number | null | undefined) => (value === null || value === undefined || !Number.isFinite(value) ? "—" : `${Math.round(value * 100)}%`);

/** Secondi rimasti come «12:05». */
export const clockText = (seconds: number) => {
  const safe = Math.max(0, Math.floor(seconds));
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
};
