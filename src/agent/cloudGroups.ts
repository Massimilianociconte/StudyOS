// Gruppi di dati del connettore remoto: ogni strumento legge dal cloud solo i tipi di entità che gli
// servono (studyos_agent_pull con p_types). Gli strumenti di sempre leggono «core» e «subjects» come
// prima; flashcard, domande e sessioni di ripasso (le collezioni che crescono di più) si leggono solo
// per gli strumenti di flashcard e quiz. Un gruppo non letto resta vuoto nello store: il confronto
// prima/dopo non può toglierne nulla, al massimo aggiungere (vedi plannedRows).
import { ENTITY_TYPES } from "../lib/collections";

export type DataGroup = "core" | "subjects" | "decks" | "cards" | "questions" | "states" | "runs" | "ai";

const LEARNING_GROUPS: Record<Exclude<DataGroup, "core">, readonly string[]> = {
  subjects: ["subject"],
  decks: ["studyDeck", "quiz"],
  cards: ["flashcard"],
  questions: ["quizQuestion"],
  states: ["flashcardState", "studyMark"],
  runs: ["studyRun"],
  ai: ["aiAnalysis", "aiRequest"]
};

const SPECIAL = new Set(Object.values(LEARNING_GROUPS).flat());

export const GROUP_TYPES: Record<DataGroup, readonly string[]> = {
  core: Object.values(ENTITY_TYPES).filter((type) => !SPECIAL.has(type)),
  ...LEARNING_GROUPS
};

const TYPE_GROUP = new Map<string, DataGroup>(
  (Object.entries(GROUP_TYPES) as [DataGroup, readonly string[]][]).flatMap(([group, types]) => types.map((type) => [type, group] as const))
);

/** Gruppo di un tipo di entità; un tipo sconosciuto (versione più nuova dell'app) va con «core». */
export const groupOfType = (type: string): DataGroup => TYPE_GROUP.get(type) ?? "core";

export const ALL_GROUPS = Object.keys(GROUP_TYPES) as DataGroup[];

const BASE: DataGroup[] = ["core", "subjects"];

/** Gruppi da leggere per uno strumento (alcuni dipendono dagli argomenti). */
export const groupsForTool = (name: string, args: Record<string, unknown>): DataGroup[] => {
  switch (name) {
    case "studyos_learning_guide":
      return [];
    case "studyos_list_decks":
      return args.includeCounts === false ? ["subjects", "decks"] : ["subjects", "decks", "cards", "states"];
    // Le domande seguono la materia dei loro quiz quando una raccolta cambia materia.
    case "studyos_save_decks":
      return ["subjects", "decks", "cards", "questions"];
    case "studyos_delete_deck":
      return ["decks", "cards", "questions", "states", "ai"];
    case "studyos_copy_deck":
      return ["subjects", "decks", "cards", "questions"];
    case "studyos_list_flashcards":
      return ["subjects", "decks", "cards", "states"];
    case "studyos_get_flashcards":
      return ["subjects", "decks", "cards", "states", "ai"];
    case "studyos_save_flashcards":
    case "studyos_find_duplicate_flashcards":
      return ["decks", "cards"];
    case "studyos_delete_flashcards":
      return ["cards", "states", "ai"];
    case "studyos_list_quizzes":
      return args.includeResults === true ? ["subjects", "decks", "questions", "runs"] : ["subjects", "decks", "questions"];
    case "studyos_get_quiz":
      return ["decks", "questions"];
    case "studyos_save_quiz":
      return ["subjects", "decks", "questions"];
    case "studyos_delete_quiz_items":
      return ["decks", "questions", "ai"];
    case "studyos_learning_stats":
      return ["subjects", "decks", "cards", "questions", "states", "runs"];
    case "studyos_list_ai_analyses":
    case "studyos_save_ai_analysis":
    case "studyos_delete_ai_analysis":
    case "studyos_finish_ai_request":
      return ["ai"];
    case "studyos_list_ai_requests":
    case "studyos_take_ai_request":
      return ["decks", "cards", "questions", "ai"];
    case "studyos_status":
    case "studyos_overview":
      return [...BASE, "states", "ai"];
    // Eliminare una materia toglie la materia anche da raccolte, schede e quiz.
    case "studyos_delete_subject":
      return [...BASE, "decks", "cards", "questions"];
    // Unire due materie sposta ogni riferimento alla materia tolta: servono tutti i gruppi.
    case "studyos_merge_subjects":
      return [...ALL_GROUPS];
    default:
      return BASE;
  }
};
