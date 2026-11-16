// Raccolte di flashcard e quiz che altre persone condividono (sezione «flashcards»): righe originali
// lette da useSharedStore. Sul connettore remoto lo store condiviso è vuoto: nessuna fonte.
import { SCOPE_ENTITY_TYPES, typeAccess, type SharePermission } from "../lib/sharing";
import type { DeckBundle } from "../lib/learningModel";
import { useSharedStore } from "../store/useSharedStore";
import type { Flashcard, Quiz, QuizQuestion, StudyDeck } from "../types";

export interface LearningOwner {
  id: string;
  name: string;
  permission: SharePermission;
  subjectNames?: Map<string, string>;
}

export interface LearningSource {
  /** Assente = libreria propria. */
  owner?: LearningOwner;
  bundle: DeckBundle;
}

export const LEARNING_ENTITY_TYPES = SCOPE_ENTITY_TYPES.flashcards;

let cache: { items: unknown; received: unknown; labels: unknown; sources: LearningSource[] } | null = null;

/** Una fonte per ogni persona che condivide raccolte con te (calcolata una volta per versione dello store). */
export const learningSharedSources = (): LearningSource[] => {
  const shared = useSharedStore.getState();
  if (cache && cache.items === shared.items && cache.received === shared.received && cache.labels === shared.labels) return cache.sources;
  const byOwner = new Map<string, DeckBundle>();
  for (const item of shared.items) {
    if (!LEARNING_ENTITY_TYPES.includes(item.entityType)) continue;
    let bundle = byOwner.get(item.ownerId);
    if (!bundle) {
      bundle = { decks: [], flashcards: [], quizzes: [], quizQuestions: [] };
      byOwner.set(item.ownerId, bundle);
    }
    const entity = item.entity as unknown;
    if (item.entityType === "studyDeck") bundle.decks.push(entity as StudyDeck);
    else if (item.entityType === "flashcard") bundle.flashcards.push(entity as Flashcard);
    else if (item.entityType === "quiz") bundle.quizzes.push(entity as Quiz);
    else bundle.quizQuestions.push(entity as QuizQuestion);
  }
  const sources: LearningSource[] = [];
  for (const [ownerId, bundle] of byOwner) {
    const grant = shared.received.find((item) => item.ownerId === ownerId);
    const permission = typeAccess(shared.received, ownerId, "flashcard");
    if (!permission) continue;
    const subjectNames = new Map(shared.labels.filter((label) => label.ownerId === ownerId).map((label) => [label.id, label.name]));
    sources.push({ owner: { id: ownerId, name: grant?.ownerName ?? "", permission, subjectNames }, bundle });
  }
  cache = { items: shared.items, received: shared.received, labels: shared.labels, sources };
  return sources;
};
