// Dati della sezione Ripasso: collezioni proprie (store principale), raccolte condivise da altre
// persone (useSharedStore) e mappa degli stati di ripasso per id della scheda.
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { learningSharedSources, type LearningSource } from "../../agent/learningShared";
import { useSharedStore } from "../../store/useSharedStore";
import { useStudyStore } from "../../store/useStudyStore";
import type { DeckBundle } from "../../lib/learningModel";
import type { Flashcard, StudyDeck } from "../../types";

export function useLearnData() {
  const data = useStudyStore(
    useShallow((state) => ({
      decks: state.decks,
      flashcards: state.flashcards,
      quizzes: state.quizzes,
      quizQuestions: state.quizQuestions,
      cardStates: state.cardStates,
      studyRuns: state.studyRuns,
      aiAnalyses: state.aiAnalyses,
      aiRequests: state.aiRequests,
      subjects: state.subjects,
      locked: state.locked,
      loading: state.loading
    }))
  );
  const sharedVersion = useSharedStore(useShallow((state) => ({ items: state.items, received: state.received, labels: state.labels })));
  // learningSharedSources memorizza per versione dello store: la dipendenza è la versione stessa.
  const shared = useMemo<LearningSource[]>(() => learningSharedSources(), [sharedVersion.items, sharedVersion.received, sharedVersion.labels]);
  const states = useMemo(() => new Map(data.cardStates.map((item) => [item.id, item])), [data.cardStates]);
  const own = useMemo<DeckBundle>(
    () => ({ decks: data.decks, flashcards: data.flashcards, quizzes: data.quizzes, quizQuestions: data.quizQuestions }),
    [data.decks, data.flashcards, data.quizzes, data.quizQuestions]
  );
  return { ...data, own, shared, states };
}

export type LearnData = ReturnType<typeof useLearnData>;

/** Fonte (propria o condivisa) di una raccolta, di una scheda o di un quiz. */
export const sourceOfDeck = (data: Pick<LearnData, "own" | "shared">, deckId: string): LearningSource | null => {
  if (data.own.decks.some((deck) => deck.id === deckId)) return { bundle: data.own };
  return data.shared.find((source) => source.bundle.decks.some((deck) => deck.id === deckId)) ?? null;
};

export const findCard = (data: Pick<LearnData, "own" | "shared">, cardId: string): { card: Flashcard; source: LearningSource } | null => {
  const own = data.own.flashcards.find((card) => card.id === cardId);
  if (own) return { card: own, source: { bundle: data.own } };
  for (const source of data.shared) {
    const card = source.bundle.flashcards.find((item) => item.id === cardId);
    if (card) return { card, source };
  }
  return null;
};

export const errorText = (failure: unknown) => (failure instanceof Error ? failure.message : String(failure));

export interface LearnUnion {
  decks: StudyDeck[];
  cards: Flashcard[];
  /** Persona che condivide la scheda (assente = tua). */
  ownerOfCard: Map<string, { id: string; name: string }>;
  ownerOfDeck: Map<string, { id: string; name: string }>;
}

/** Libreria propria più le raccolte condivise, in un solo elenco (gli id non si ripetono tra account). */
export const unionOf = (data: Pick<LearnData, "own" | "shared">): LearnUnion => {
  const decks = [...data.own.decks];
  const cards = [...data.own.flashcards];
  const ownerOfCard = new Map<string, { id: string; name: string }>();
  const ownerOfDeck = new Map<string, { id: string; name: string }>();
  for (const source of data.shared) {
    if (!source.owner) continue;
    const owner = { id: source.owner.id, name: source.owner.name };
    for (const deck of source.bundle.decks) {
      decks.push(deck);
      ownerOfDeck.set(deck.id, owner);
    }
    for (const card of source.bundle.flashcards) {
      cards.push(card);
      ownerOfCard.set(card.id, owner);
    }
  }
  return { decks, cards, ownerOfCard, ownerOfDeck };
};
