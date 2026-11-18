// Dubbi segnati: dagli id dei segni alle flashcard e domande vere (tue o condivise), raggruppate per
// materia e poi per argomento. L'argomento è la raccolta di livello «argomento» più vicina sopra
// l'elemento (come le crea l'assistente: materia → argomento → capitolo…); senza, la raccolta stessa.
// Una domanda di un quiz senza raccolta sta sotto il quiz.
import { deckPath, deckSubjectId, type DeckBundle } from "./learningModel";
import type { Flashcard, Quiz, QuizQuestion, StudyDeck, StudyMark } from "../types";

export interface MarkSource {
  bundle: DeckBundle;
  /** Chi condivide (assente = libreria propria). */
  owner?: { id: string; name: string };
}

export interface DoubtItem {
  mark: StudyMark;
  owner?: { id: string; name: string };
  card?: Flashcard;
  question?: QuizQuestion;
  quiz?: Quiz;
  /** Raccolta in cui sta (la scheda, o la raccolta del quiz). */
  deckId?: string;
  subjectId?: string;
}

export interface DoubtTopic {
  key: string;
  title: string;
  /** Raccolte sopra l'argomento («Biochimica › Metabolismo»), vuoto in cima. */
  path: string;
  cards: DoubtItem[];
  questions: DoubtItem[];
}

export interface DoubtSubject {
  key: string;
  subjectId?: string;
  ownerId?: string;
  topics: DoubtTopic[];
  cards: number;
  questions: number;
}

export const NO_SUBJECT = "none";

const byPosition = (card: Flashcard | undefined) => (card && Number.isFinite(card.position) ? card.position : 0);

/** Segni che puntano a elementi che esistono ancora (propri o condivisi), con i loro dati. */
export const resolveDoubts = (marks: readonly StudyMark[], sources: readonly MarkSource[]): DoubtItem[] => {
  if (!marks.length) return [];
  const cards = new Map<string, { card: Flashcard; source: MarkSource }>();
  const questions = new Map<string, { question: QuizQuestion; source: MarkSource }>();
  const quizzes = new Map<string, Quiz>();
  for (const source of sources) {
    for (const card of source.bundle.flashcards) cards.set(card.id, { card, source });
    for (const question of source.bundle.quizQuestions) questions.set(question.id, { question, source });
    for (const quiz of source.bundle.quizzes) quizzes.set(quiz.id, quiz);
  }
  const out: DoubtItem[] = [];
  for (const mark of marks) {
    if (mark.kind === "card") {
      const hit = cards.get(mark.id);
      if (!hit) continue;
      const { card, source } = hit;
      out.push({
        mark,
        card,
        deckId: card.deckId,
        subjectId: card.subjectId ?? deckSubjectId(source.bundle.decks, card.deckId),
        ...(source.owner ? { owner: source.owner } : {})
      });
    } else if (mark.kind === "question") {
      const hit = questions.get(mark.id);
      if (!hit) continue;
      const { question, source } = hit;
      const quiz = quizzes.get(question.quizId);
      out.push({
        mark,
        question,
        ...(quiz ? { quiz } : {}),
        ...(quiz?.deckId ? { deckId: quiz.deckId } : {}),
        subjectId: question.subjectId ?? quiz?.subjectId ?? deckSubjectId(source.bundle.decks, quiz?.deckId),
        ...(source.owner ? { owner: source.owner } : {})
      });
    }
  }
  return out;
};

/** La raccolta «argomento» di una raccolta: la più vicina sopra (o lei stessa) di livello argomento, altrimenti lei. */
export const topicDeck = (decks: readonly StudyDeck[], deckId: string): { topic: StudyDeck; above: StudyDeck[] } | null => {
  const path = deckPath(decks, deckId);
  if (!path.length) return null;
  for (let i = path.length - 1; i >= 0; i--) if (path[i].kind === "topic") return { topic: path[i], above: path.slice(0, i) };
  return { topic: path[path.length - 1], above: path.slice(0, -1) };
};

/** Raggruppa per materia, poi per argomento; i gruppi con più dubbi prima. */
export const groupDoubts = (items: readonly DoubtItem[], decks: readonly StudyDeck[]): DoubtSubject[] => {
  const subjects = new Map<string, DoubtSubject & { byTopic: Map<string, DoubtTopic> }>();
  for (const item of items) {
    const subjectKey = item.subjectId ? `${item.owner?.id ?? ""}:${item.subjectId}` : `${item.owner?.id ?? ""}:${NO_SUBJECT}`;
    let subject = subjects.get(subjectKey);
    if (!subject) {
      subject = { key: subjectKey, ...(item.subjectId ? { subjectId: item.subjectId } : {}), ...(item.owner ? { ownerId: item.owner.id } : {}), topics: [], cards: 0, questions: 0, byTopic: new Map() };
      subjects.set(subjectKey, subject);
    }
    const found = item.deckId ? topicDeck(decks, item.deckId) : null;
    const topicKey = found ? `deck:${found.topic.id}` : item.quiz ? `quiz:${item.quiz.id}` : "other";
    let topic = subject.byTopic.get(topicKey);
    if (!topic) {
      topic = {
        key: topicKey,
        title: found ? found.topic.title : item.quiz?.title ?? "",
        path: found ? found.above.map((deck) => deck.title).join(" › ") : "",
        cards: [],
        questions: []
      };
      subject.byTopic.set(topicKey, topic);
      subject.topics.push(topic);
    }
    if (item.card) {
      topic.cards.push(item);
      subject.cards++;
    } else {
      topic.questions.push(item);
      subject.questions++;
    }
  }
  const size = (entry: { cards: number | unknown[]; questions: number | unknown[] }) =>
    (Array.isArray(entry.cards) ? entry.cards.length : entry.cards) + (Array.isArray(entry.questions) ? entry.questions.length : entry.questions);
  return [...subjects.values()]
    .map(({ byTopic: _byTopic, ...subject }) => ({
      ...subject,
      topics: subject.topics
        .map((topic) => ({ ...topic, cards: [...topic.cards].sort((a, b) => byPosition(a.card) - byPosition(b.card)) }))
        .sort((a, b) => size(b) - size(a) || a.title.localeCompare(b.title, "it"))
    }))
    .sort((a, b) => size(b) - size(a));
};
