// Logica pura della sezione Ripasso: albero delle raccolte con i conteggi, coda di una sessione,
// preparazione di un quiz (mescolato in modo riproducibile), ultimi errori di un quiz.
import { applyReview, classifyCard, reviewPriority, type CardRef } from "./srs";
import { deckDescendantIds, sortByPosition } from "./learningModel";
import { safeOptions, scoreQuestion, shuffled } from "./quizScoring";
import type { SessionFilter } from "./labels/learn";
import { blocksPlainText } from "./cardBlocks";
import type { CardBlock, Flashcard, FlashcardState, Quiz, QuizQuestion, ReviewResult, StudyDeck, StudyRun } from "../types";

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

/** Filtri della coda: quelli di «Personalizza il ripasso» più alcuni usati solo dalla logica. */
export type QueueFilter = SessionFilter | "difficult" | "doubtful" | "random";

export interface QueueOptions {
  filter: QueueFilter;
  limit: number;
  order: "priority" | "shuffle";
  seed: number;
  /** Schede già viste in questa sessione: «Continua» non le ripropone. */
  exclude?: ReadonlySet<string>;
}

/**
 * Coda di una sessione. «Consigliate»: scadute e di oggi per urgenza, poi le mai viste nell'ordine
 * della raccolta. «Da ripassare»: solo le scadute e di oggi. «Nuove»: mai viste. «Difficili o
 * dubbie»: prima quelle sbagliate più volte. «Tutte»: da ripassare, poi nuove, poi le altre per
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
  const pool = options.exclude?.size ? cards.filter((card) => !options.exclude?.has(card.id)) : cards;
  const classified = pool.map((card) => ({ card, state: states.get(card.id), info: classifyCard(states.get(card.id), now) }));
  const byUrgency = (a: (typeof classified)[number], b: (typeof classified)[number]) => reviewPriority(a.state) - reviewPriority(b.state) || inDeckOrder(a.card, b.card);
  const byLapses = (a: (typeof classified)[number], b: (typeof classified)[number]) => (b.state?.lapses ?? 0) - (a.state?.lapses ?? 0) || inDeckOrder(a.card, b.card);
  let picked: typeof classified;
  switch (options.filter) {
    case "today":
      picked = [
        ...classified.filter((item) => item.info.due).sort(byUrgency),
        ...classified.filter((item) => item.info.isNew).sort((a, b) => inDeckOrder(a.card, b.card))
      ];
      break;
    case "due":
      picked = classified.filter((item) => item.info.due).sort(byUrgency);
      break;
    case "new":
      picked = classified.filter((item) => item.info.isNew).sort((a, b) => inDeckOrder(a.card, b.card));
      break;
    case "hard":
      picked = classified.filter((item) => item.info.difficult || item.info.doubtful).sort(byLapses);
      break;
    case "difficult":
      picked = classified.filter((item) => item.info.difficult).sort(byLapses);
      break;
    case "doubtful":
      picked = classified.filter((item) => item.info.doubtful).sort((a, b) => inDeckOrder(a.card, b.card));
      break;
    case "random":
      picked = shuffled(classified, options.seed);
      break;
    default: {
      const rank = (item: (typeof classified)[number]) => (item.info.due ? 0 : item.info.isNew ? 1 : 2);
      picked = classified.slice().sort((a, b) => rank(a) - rank(b) || byUrgency(a, b));
    }
  }
  const limited = picked.slice(0, Math.max(1, Math.floor(options.limit)));
  const result = limited.map((item) => item.card);
  return options.order === "shuffle" && options.filter !== "random" ? shuffled(result, options.seed) : result;
};

/** Quante schede entrerebbero con ogni scelta di «Personalizza il ripasso» (senza limite). */
export const filterCounts = (cards: readonly Flashcard[], states: ReadonlyMap<string, FlashcardState>, now: Date) => {
  const out: Record<SessionFilter, number> & { overdue: number } = { today: 0, due: 0, new: 0, hard: 0, all: cards.length, overdue: 0 };
  for (const card of cards) {
    const info = classifyCard(states.get(card.id), now);
    if (info.due) out.due++;
    if (info.overdue) out.overdue++;
    if (info.isNew) out.new++;
    if (info.difficult || info.doubtful) out.hard++;
  }
  out.today = out.due + out.new;
  return out;
};

/** «10 min», «1 giorno», «3 giorni», «2 mesi», «1 anno»: tra quanto torna una scheda. */
export const waitLabel = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 ora" : `${hours} ore`;
  const days = Math.round(hours / 24);
  if (days < 45) return days === 1 ? "1 giorno" : `${days} giorni`;
  const months = Math.round(days / 30);
  if (months < 12) return months === 1 ? "1 mese" : `${months} mesi`;
  const years = Math.round(days / 365);
  return years === 1 ? "1 anno" : `${years} anni`;
};

/** Tra quanto torna la scheda con ogni risposta (stessa regola che la salva). */
export const nextWaits = (state: FlashcardState | undefined, card: CardRef, now: Date): Record<Exclude<ReviewResult, "skip">, string> => {
  const wait = (result: Exclude<ReviewResult, "skip">) => waitLabel(Date.parse(applyReview(state, card, result, now).due) - now.getTime());
  return { wrong: wait("wrong"), doubt: wait("doubt"), correct: wait("correct") };
};

/** Prima scadenza futura e quante schede scadono quel giorno (per «Sei in pari»). */
export const nextDueDay = (cardIds: Iterable<string>, states: ReadonlyMap<string, FlashcardState>, now: Date): { day: Date; count: number } | null => {
  const dues: number[] = [];
  for (const id of cardIds) {
    const state = states.get(id);
    const due = state ? Date.parse(state.due) : NaN;
    if (Number.isFinite(due) && due > now.getTime()) dues.push(due);
  }
  if (!dues.length) return null;
  const first = new Date(Math.min(...dues));
  const start = new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime();
  const end = start + 86_400_000;
  return { day: first, count: dues.filter((due) => due >= start && due < end).length };
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

/**
 * Domande di un tentativo ripreso: l'ordine salvato (itemIds) e le opzioni mescolate con lo stesso
 * seme di prepareQuiz (la posizione originale resta quella del seme). Le domande sparite nel frattempo
 * si saltano, quelle modificate si mostrano come sono ora.
 */
export const preparedFromIds = (questions: readonly QuizQuestion[], itemIds: readonly string[], options: { seed: number; shuffle: boolean }): PreparedQuestion[] => {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const out: PreparedQuestion[] = [];
  itemIds.forEach((id, index) => {
    const raw = byId.get(id);
    if (!raw) return;
    const safe = safeOptions(raw.options);
    const question = { ...raw, options: safe };
    out.push({ question, options: options.shuffle ? shuffled(safe, options.seed + index + 1) : safe });
  });
  return out;
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

// ─── Navigazione di ripasso e quiz ───────────────────────────────────────────────────────

const SHORT_TEXT = 140;

/** Testo breve (uno o due blocchi di testo o formula): sulla scheda va grande e al centro. */
export const isShortCardText = (blocks: readonly CardBlock[] | undefined) =>
  Array.isArray(blocks) &&
  blocks.length > 0 &&
  blocks.length <= 2 &&
  blocks.every((block) => block && (block.type === "text" || block.type === "formula")) &&
  blocksPlainText(blocks).length <= SHORT_TEXT;

/** Tasto → opzione del quiz: 1–9 oppure la lettera mostrata (A, B, …). -1 se non è un'opzione. */
export const optionFromKey = (key: string, count: number) => {
  if (key.length !== 1) return -1;
  const digit = key >= "1" && key <= "9" ? Number(key) - 1 : -1;
  const lower = key.toLowerCase();
  const letter = lower >= "a" && lower <= "z" ? lower.charCodeAt(0) - 97 : -1;
  const index = digit >= 0 ? digit : letter;
  return index >= 0 && index < count ? index : -1;
};

/** Prima domanda dell'allenamento non ancora confermata (o saltata); le precedenti si possono rivedere. */
export const quizFrontier = (prepared: readonly PreparedQuestion[], checked: ReadonlySet<string>) => {
  const index = prepared.findIndex((item) => !checked.has(item.question.id));
  return index < 0 ? prepared.length - 1 : index;
};

/** Dove si può andare: in simulazione ovunque, in allenamento fino alla prima domanda da fare. */
export const quizReachable = (position: number, prepared: readonly PreparedQuestion[], checked: ReadonlySet<string>, exam: boolean) =>
  position >= 0 && position < prepared.length && (exam || position <= quizFrontier(prepared, checked));
