// Modello di raccolte, flashcard, quiz, sessioni e richieste agli agenti: funzioni pure usate
// dallo store (editor, studio), dagli strumenti MCP e dal connettore remoto nel Worker.
import { CARD_LIMITS, contentChars, normalizeBlocks, normalizeSources, safeBlocks } from "./cardBlocks";
import { questionError, QUIZ_LIMITS } from "./quizScoring";
import type {
  AiRequest,
  AiRequestStyle,
  CardBlock,
  ContentAuthor,
  DeckKind,
  Flashcard,
  Quiz,
  QuizOption,
  QuizQuestion,
  SourceRef,
  StudyDeck,
  StudyRun,
  StudyRunEvent
} from "../types";

export const LEARNING_LIMITS = {
  deckTitle: 200,
  description: 4000,
  /** Profondità massima della catena di raccolte (materia esclusa). */
  deckDepth: 8,
  cardTitle: 200,
  externalRef: 200,
  tags: 20,
  tag: 40,
  metaKeys: 20,
  metaKey: 60,
  metaValue: 500,
  decksPerCall: 50,
  cardsPerCall: 100,
  questionsPerCall: 60,
  /** Eventi per riga di sessione: oltre si continua in una riga nuova. */
  runEvents: 400,
  aiPrompt: 2000,
  requestDays: 14,
  leaseMinutes: 15,
  agentName: 80,
  error: 500,
  analysisTitle: 200,
  analysisSummary: 4000,
  analysisSections: 12,
  analysisBody: 6000
} as const;

export const DECK_KINDS: readonly DeckKind[] = ["collection", "topic", "chapter", "paragraph", "subtopic"];

export const DECK_KIND_LABEL: Record<DeckKind, string> = {
  collection: "Mazzo",
  topic: "Argomento",
  chapter: "Capitolo",
  paragraph: "Paragrafo",
  subtopic: "Sottoargomento"
};

export const AI_STYLES: readonly AiRequestStyle[] = ["simple", "deep", "example", "analogy", "diagram", "doubt", "custom"];

export const AI_STYLE_LABEL: Record<AiRequestStyle, string> = {
  simple: "Più semplice",
  deep: "Più approfondita",
  example: "Con un esempio",
  analogy: "Con un'analogia",
  diagram: "Con uno schema",
  doubt: "Ho un dubbio preciso",
  custom: "Richiesta libera"
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const okR = <T>(value: T): Result<T> => ({ ok: true, value });
const errR = <T>(error: string): Result<T> => ({ ok: false, error });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const has = (input: Record<string, unknown>, key: string) => Object.hasOwn(input, key) && input[key] !== undefined;

const cleanString = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim().slice(0, max) : "");

export const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const tag = cleanString(item, LEARNING_LIMITS.tag);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= LEARNING_LIMITS.tags) break;
  }
  return out;
};

const difficultyOf = (value: unknown): Flashcard["difficulty"] | undefined | null => {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5 ? (value as Flashcard["difficulty"]) : null;
};

export const normalizeAuthor = (value: unknown, fallback: ContentAuthor): ContentAuthor => {
  if (!isRecord(value)) return fallback;
  const kind = value.kind === "person" ? "person" : value.kind === "agent" ? "agent" : fallback.kind;
  const name = cleanString(value.name, LEARNING_LIMITS.agentName) || fallback.name;
  const model = cleanString(value.model, LEARNING_LIMITS.agentName) || fallback.model;
  return { kind, ...(name ? { name } : {}), ...(model ? { model } : {}) };
};

// ─── Gerarchia delle raccolte ─────────────────────────────────────────────────────────────

const byPosition = <T extends { position: number; title?: string; createdAt: string }>(a: T, b: T) =>
  a.position - b.position || (a.title ?? "").localeCompare(b.title ?? "", "it") || a.createdAt.localeCompare(b.createdAt);

export const sortByPosition = <T extends { position: number; title?: string; createdAt: string }>(items: readonly T[]) => items.slice().sort(byPosition);

export const deckChildren = (decks: readonly StudyDeck[], parentId: string | undefined) =>
  sortByPosition(decks.filter((deck) => (deck.parentId ?? undefined) === parentId));

/** Id della raccolta e di tutte le sue discendenti (resiste ai cicli). */
export const deckDescendantIds = (decks: readonly StudyDeck[], rootId: string): Set<string> => {
  const byParent = new Map<string, string[]>();
  for (const deck of decks) {
    if (!deck.parentId) continue;
    const list = byParent.get(deck.parentId) ?? [];
    list.push(deck.id);
    byParent.set(deck.parentId, list);
  }
  const out = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift() as string;
    for (const child of byParent.get(id) ?? []) {
      if (!out.has(child)) {
        out.add(child);
        queue.push(child);
      }
    }
  }
  return out;
};

/** Catena dalla radice alla raccolta (al massimo deckDepth + 1 passi, resiste ai cicli). */
/**
 * Posizione di ogni raccolta nell'array, calcolata una volta per array (gli elenchi dello store
 * non cambiano sul posto: ogni modifica crea un array nuovo). Gli strumenti degli agenti e le
 * statistiche chiedono la materia di migliaia di schede: senza indice ogni domanda rifaceva una
 * mappa di tutte le raccolte. Un array allungato (push durante la costruzione) o una posizione che
 * non corrisponde più ricostruiscono l'indice.
 */
type DeckIndex = { length: number; at: Map<string, number> };
const deckIndexes = new WeakMap<readonly StudyDeck[], DeckIndex>();

const buildDeckIndex = (decks: readonly StudyDeck[]) => {
  const at = new Map<string, number>();
  decks.forEach((deck, i) => at.set(deck.id, i));
  const index = { length: decks.length, at };
  deckIndexes.set(decks, index);
  return index;
};

/** Raccolta per id (l'ultima con quell'id, come una Map costruita dall'elenco). */
export const deckById = (decks: readonly StudyDeck[], id: string): StudyDeck | undefined => {
  let index = deckIndexes.get(decks);
  if (!index || index.length !== decks.length) index = buildDeckIndex(decks);
  const at = index.at.get(id);
  if (at === undefined) return undefined;
  const deck = decks[at];
  if (deck?.id === id) return deck;
  const rebuilt = buildDeckIndex(decks).at.get(id);
  return rebuilt === undefined ? undefined : decks[rebuilt];
};

export const deckPath = (decks: readonly StudyDeck[], id: string): StudyDeck[] => {
  const out: StudyDeck[] = [];
  const seen = new Set<string>();
  let current = deckById(decks, id);
  while (current && !seen.has(current.id) && out.length <= LEARNING_LIMITS.deckDepth + 1) {
    seen.add(current.id);
    out.unshift(current);
    current = current.parentId ? deckById(decks, current.parentId) : undefined;
  }
  return out;
};

/** Spostare `id` sotto `parentId` creerebbe un ciclo o supererebbe la profondità massima? */
/**
 * Problema nello spostare (o mettere) una raccolta sotto `parentId`, o null. `height`: livelli
 * della raccolta da mettere, quando arriva da fuori (una copia, anche da un altro account).
 */
export const parentError = (decks: readonly StudyDeck[], id: string | undefined, parentId: string | undefined, height?: number): string | null => {
  if (!parentId) return null;
  const byId = new Map(decks.map((deck) => [deck.id, deck]));
  if (!byId.has(parentId)) return "parentId: raccolta madre non trovata";
  if (id && deckDescendantIds(decks, id).has(parentId)) return "parentId: una raccolta non può stare dentro sé stessa o una sua sotto-raccolta";
  const depthAbove = deckPath(decks, parentId).length;
  const below = height ?? (id ? subtreeHeight(decks, id) : 1);
  if (depthAbove + below > LEARNING_LIMITS.deckDepth) return `parentId: al massimo ${LEARNING_LIMITS.deckDepth} livelli di raccolte`;
  return null;
};

export const subtreeHeight = (decks: readonly StudyDeck[], id: string, seen = new Set<string>()): number => {
  if (seen.has(id)) return 0;
  seen.add(id);
  let max = 0;
  for (const deck of decks) if (deck.parentId === id) max = Math.max(max, subtreeHeight(decks, deck.id, seen));
  return 1 + max;
};

/** Materia di una raccolta: la sua, altrimenti quella della prima antenata che ne ha una. */
export const deckSubjectId = (decks: readonly StudyDeck[], id: string | undefined): string | undefined => {
  if (!id) return undefined;
  const path = deckPath(decks, id);
  for (let i = path.length - 1; i >= 0; i--) if (path[i].subjectId) return path[i].subjectId;
  return undefined;
};

export const nextPosition = (items: readonly { position: number }[]) => items.reduce((max, item) => Math.max(max, Number.isFinite(item.position) ? item.position : 0), 0) + 1;

// ─── Normalizzazione degli input (editor e agenti) ───────────────────────────────────────

export type DeckFields = Pick<StudyDeck, "title" | "description" | "kind" | "position" | "tags"> &
  Partial<Pick<StudyDeck, "parentId" | "subjectId" | "color" | "icon" | "source" | "meta">>;

/** Campi di una raccolta. `partial` = modifica: solo i campi presenti. Le relazioni le controlla il chiamante. */
export const normalizeDeckFields = (input: Record<string, unknown>, partial: boolean): Result<Partial<DeckFields>> => {
  const out: Partial<DeckFields> = {};
  if (!partial || has(input, "title")) {
    const title = cleanString(input.title, LEARNING_LIMITS.deckTitle + 1);
    if (!title) return errR("title: nome della raccolta mancante");
    if (title.length > LEARNING_LIMITS.deckTitle) return errR(`title: massimo ${LEARNING_LIMITS.deckTitle} caratteri`);
    out.title = title;
  }
  if (!partial || has(input, "description")) {
    const description = typeof input.description === "string" ? input.description.trim() : "";
    if (description.length > LEARNING_LIMITS.description) return errR(`description: massimo ${LEARNING_LIMITS.description} caratteri`);
    out.description = description;
  }
  if (!partial || has(input, "kind")) {
    const kind = input.kind ?? "collection";
    if (!DECK_KINDS.includes(kind as DeckKind)) return errR(`kind: uno tra ${DECK_KINDS.join(", ")}`);
    out.kind = kind as DeckKind;
  }
  if (has(input, "parentId")) out.parentId = typeof input.parentId === "string" && input.parentId ? input.parentId : undefined;
  if (has(input, "subjectId")) out.subjectId = typeof input.subjectId === "string" && input.subjectId ? input.subjectId : undefined;
  if (has(input, "color")) {
    const color = cleanString(input.color, 20);
    if (color && !/^#[0-9a-f]{6}$/i.test(color)) return errR("color: colore esadecimale #rrggbb");
    out.color = color || undefined;
  }
  if (has(input, "icon")) out.icon = cleanString(input.icon, 40) || undefined;
  if (has(input, "source")) {
    if (input.source === null) out.source = undefined;
    else {
      const sources = normalizeSources(input.source, "source");
      if (!sources.ok) return errR(sources.error);
      out.source = sources.sources[0];
    }
  }
  if (has(input, "meta")) {
    if (input.meta === null) out.meta = undefined;
    else if (!isRecord(input.meta)) return errR("meta: oggetto chiave → testo");
    else {
      const entries = Object.entries(input.meta);
      if (entries.length > LEARNING_LIMITS.metaKeys) return errR(`meta: massimo ${LEARNING_LIMITS.metaKeys} chiavi`);
      const meta: Record<string, string> = {};
      for (const [key, value] of entries) {
        const k = cleanString(key, LEARNING_LIMITS.metaKey);
        if (!k) continue;
        if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") return errR(`meta.${k}: solo testo, numeri o sì/no`);
        meta[k] = cleanString(String(value), LEARNING_LIMITS.metaValue);
      }
      out.meta = meta;
    }
  }
  if (has(input, "position")) {
    if (typeof input.position !== "number" || !Number.isFinite(input.position)) return errR("position: numero");
    out.position = input.position;
  }
  if (!partial || has(input, "tags")) out.tags = normalizeTags(input.tags);
  return okR(out);
};

export type CardFields = Pick<Flashcard, "front" | "back"> &
  Partial<Pick<Flashcard, "title" | "explanation" | "difficulty" | "sources" | "externalRef" | "position" | "tags">>;

export const normalizeExternalRef = (value: unknown): Result<string | undefined> => {
  if (value === undefined || value === null || value === "") return okR(undefined);
  if (typeof value !== "string") return errR("externalRef: testo");
  const ref = value.trim();
  if (!ref || ref.length > LEARNING_LIMITS.externalRef) return errR(`externalRef: da 1 a ${LEARNING_LIMITS.externalRef} caratteri`);
  return okR(ref);
};

/** Campi di una flashcard (fronte e retro obbligatori alla creazione). */
export const normalizeCardFields = (input: Record<string, unknown>, partial: boolean): Result<Partial<CardFields>> => {
  const out: Partial<CardFields> = {};
  for (const side of ["front", "back"] as const) {
    if (!partial || has(input, side)) {
      const blocks = normalizeBlocks(input[side], side);
      if (!blocks.ok) return errR(blocks.error);
      out[side] = blocks.blocks;
    }
  }
  if (has(input, "explanation")) {
    const blocks = normalizeBlocks(input.explanation, "explanation", { required: false });
    if (!blocks.ok) return errR(blocks.error);
    out.explanation = blocks.blocks.length ? blocks.blocks : undefined;
  }
  if (has(input, "title")) out.title = cleanString(input.title, LEARNING_LIMITS.cardTitle) || undefined;
  if (has(input, "difficulty")) {
    const difficulty = difficultyOf(input.difficulty);
    if (difficulty === null) return errR("difficulty: intero da 1 a 5");
    out.difficulty = difficulty;
  }
  if (has(input, "sources")) {
    const sources = normalizeSources(input.sources);
    if (!sources.ok) return errR(sources.error);
    out.sources = sources.sources.length ? sources.sources : undefined;
  }
  if (has(input, "externalRef")) {
    const ref = normalizeExternalRef(input.externalRef);
    if (!ref.ok) return errR(ref.error);
    out.externalRef = ref.value;
  }
  if (has(input, "position")) {
    if (typeof input.position !== "number" || !Number.isFinite(input.position)) return errR("position: numero");
    out.position = input.position;
  }
  if (has(input, "tags")) out.tags = normalizeTags(input.tags);
  return okR(out);
};

/** Controllo del peso complessivo dopo l'unione con la versione salvata. */
export const cardSizeError = (card: Pick<Flashcard, "front" | "back" | "explanation">) =>
  contentChars(card.front, card.back, card.explanation) > CARD_LIMITS.cardChars ? `scheda troppo grande (massimo ${CARD_LIMITS.cardChars / 1000} kB di contenuto)` : null;

export type QuestionFields = Pick<QuizQuestion, "kind" | "prompt" | "options"> &
  Partial<Pick<QuizQuestion, "explanation" | "mistakes" | "difficulty" | "sources" | "externalRef" | "position" | "tags">>;

const OPTION_ID = /^[A-Za-z0-9_-]{1,40}$/;

/**
 * Opzioni di una domanda. Senza id: si riusa l'id dell'opzione salvata con lo stesso testo
 * (non già preso da un'altra opzione), altrimenti un id nuovo o1, o2… che non coincide con
 * nessun id salvato prima: una risposta registrata resta legata al suo testo anche quando
 * l'ordine cambia, un'opzione nuova entra in mezzo o una vecchia viene tolta.
 */
export const normalizeOptions = (value: unknown, previous: readonly QuizOption[] = []): Result<QuizOption[]> => {
  if (!Array.isArray(value)) return errR("options: elenco di opzioni");
  if (value.length < QUIZ_LIMITS.minOptions || value.length > QUIZ_LIMITS.maxOptions) {
    return errR(`options: da ${QUIZ_LIMITS.minOptions} a ${QUIZ_LIMITS.maxOptions} opzioni`);
  }
  const parsed: { id: string; text: string; correct: boolean; feedback: string }[] = [];
  const explicit = new Set<string>();
  for (const [i, item] of value.entries()) {
    if (!isRecord(item)) return errR(`options[${i}]: oggetto con text e correct`);
    const textValue = cleanString(item.text, QUIZ_LIMITS.optionText + 1);
    if (!textValue) return errR(`options[${i}].text: testo mancante`);
    if (textValue.length > QUIZ_LIMITS.optionText) return errR(`options[${i}].text: massimo ${QUIZ_LIMITS.optionText} caratteri`);
    if (typeof item.correct !== "boolean") return errR(`options[${i}].correct: true o false`);
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (id && !OPTION_ID.test(id)) return errR(`options[${i}].id: lettere, numeri, - o _ (massimo 40)`);
    if (id && explicit.has(id)) return errR(`options[${i}].id: ripetuto (${id})`);
    if (id) explicit.add(id);
    parsed.push({ id, text: textValue, correct: item.correct, feedback: cleanString(item.feedback, QUIZ_LIMITS.feedback) });
  }
  const used = new Set(explicit);
  // Prima passata: stesso testo di un'opzione salvata (gli id espliciti hanno la precedenza).
  for (const option of parsed) {
    if (option.id) continue;
    const key = option.text.trim().toLowerCase();
    const match = previous.find((saved) => saved.text.trim().toLowerCase() === key && !used.has(saved.id));
    if (match) {
      option.id = match.id;
      used.add(match.id);
    }
  }
  // Seconda passata: id nuovi, mai uno già usato da questa domanda.
  const taken = new Set([...used, ...previous.map((saved) => saved.id)]);
  let n = 1;
  for (const option of parsed) {
    if (option.id) continue;
    while (taken.has(`o${n}`)) n++;
    option.id = `o${n}`;
    taken.add(option.id);
  }
  return okR(parsed.map(({ id, text: optionText, correct, feedback }) => ({ id, text: optionText, correct, ...(feedback ? { feedback } : {}) })));
};

export const normalizeQuestionFields = (input: Record<string, unknown>, partial: boolean, previous?: QuizQuestion): Result<Partial<QuestionFields>> => {
  const out: Partial<QuestionFields> = {};
  if (!partial || has(input, "kind")) {
    const kind = input.kind ?? "single";
    if (kind !== "single" && kind !== "multiple") return errR("kind: single o multiple");
    out.kind = kind;
  }
  if (!partial || has(input, "prompt")) {
    const blocks = normalizeBlocks(input.prompt, "prompt");
    if (!blocks.ok) return errR(blocks.error);
    out.prompt = blocks.blocks;
  }
  if (!partial || has(input, "options")) {
    const options = normalizeOptions(input.options, previous?.options);
    if (!options.ok) return errR(options.error);
    out.options = options.value;
  }
  if (has(input, "explanation")) {
    const blocks = normalizeBlocks(input.explanation, "explanation", { required: false });
    if (!blocks.ok) return errR(blocks.error);
    out.explanation = blocks.blocks.length ? blocks.blocks : undefined;
  }
  if (has(input, "mistakes")) {
    const mistakes = typeof input.mistakes === "string" ? input.mistakes.trim() : "";
    if (mistakes.length > QUIZ_LIMITS.mistakes) return errR(`mistakes: massimo ${QUIZ_LIMITS.mistakes} caratteri`);
    out.mistakes = mistakes || undefined;
  }
  if (has(input, "difficulty")) {
    const difficulty = difficultyOf(input.difficulty);
    if (difficulty === null) return errR("difficulty: intero da 1 a 5");
    out.difficulty = difficulty;
  }
  if (has(input, "sources")) {
    const sources = normalizeSources(input.sources);
    if (!sources.ok) return errR(sources.error);
    out.sources = sources.sources.length ? sources.sources : undefined;
  }
  if (has(input, "externalRef")) {
    const ref = normalizeExternalRef(input.externalRef);
    if (!ref.ok) return errR(ref.error);
    out.externalRef = ref.value;
  }
  if (has(input, "position")) {
    if (typeof input.position !== "number" || !Number.isFinite(input.position)) return errR("position: numero");
    out.position = input.position;
  }
  if (has(input, "tags")) out.tags = normalizeTags(input.tags);
  // Coerenza tra tipo e opzioni giuste, sulla domanda risultante.
  const kind = out.kind ?? previous?.kind;
  const options = out.options ?? previous?.options;
  if (kind && options) {
    const problem = questionError({ kind, options });
    if (problem) return errR(problem);
  }
  return okR(out);
};

export type QuizFields = Pick<Quiz, "title" | "description" | "position" | "tags"> &
  Partial<Pick<Quiz, "deckId" | "subjectId" | "difficulty" | "timeLimitMinutes" | "sources" | "externalRef">>;

export const normalizeQuizFields = (input: Record<string, unknown>, partial: boolean): Result<Partial<QuizFields>> => {
  const out: Partial<QuizFields> = {};
  if (!partial || has(input, "title")) {
    const title = cleanString(input.title, LEARNING_LIMITS.deckTitle + 1);
    if (!title) return errR("title: nome del quiz mancante");
    if (title.length > LEARNING_LIMITS.deckTitle) return errR(`title: massimo ${LEARNING_LIMITS.deckTitle} caratteri`);
    out.title = title;
  }
  if (!partial || has(input, "description")) {
    const description = typeof input.description === "string" ? input.description.trim() : "";
    if (description.length > LEARNING_LIMITS.description) return errR(`description: massimo ${LEARNING_LIMITS.description} caratteri`);
    out.description = description;
  }
  if (has(input, "deckId")) out.deckId = typeof input.deckId === "string" && input.deckId ? input.deckId : undefined;
  if (has(input, "subjectId")) out.subjectId = typeof input.subjectId === "string" && input.subjectId ? input.subjectId : undefined;
  if (has(input, "difficulty")) {
    const difficulty = difficultyOf(input.difficulty);
    if (difficulty === null) return errR("difficulty: intero da 1 a 5");
    out.difficulty = difficulty;
  }
  if (has(input, "timeLimitMinutes")) {
    const minutes = input.timeLimitMinutes;
    if (minutes === null || minutes === undefined) out.timeLimitMinutes = undefined;
    else if (typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 1 || minutes > 600) return errR("timeLimitMinutes: da 1 a 600");
    else out.timeLimitMinutes = minutes;
  }
  if (has(input, "sources")) {
    const sources = normalizeSources(input.sources);
    if (!sources.ok) return errR(sources.error);
    out.sources = sources.sources.length ? sources.sources : undefined;
  }
  if (has(input, "externalRef")) {
    const ref = normalizeExternalRef(input.externalRef);
    if (!ref.ok) return errR(ref.error);
    out.externalRef = ref.value;
  }
  if (has(input, "position")) {
    if (typeof input.position !== "number" || !Number.isFinite(input.position)) return errR("position: numero");
    out.position = input.position;
  }
  if (!partial || has(input, "tags")) out.tags = normalizeTags(input.tags);
  return okR(out);
};

// ─── Confronto per l'idempotenza ──────────────────────────────────────────────────────────

const stable = (value: unknown): string => JSON.stringify(value, (_key, item) => (isRecord(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));

/** I campi indicati sono già uguali a quelli salvati? (rimandare lo stesso lotto non riscrive) */
export const sameFields = (current: object, fields: object) =>
  Object.entries(fields).every(([key, value]) => stable((current as Record<string, unknown>)[key] ?? null) === stable(value ?? null));

/** Campi che cambiano il contenuto (fanno salire la revisione). */
export const CONTENT_KEYS = new Set(["front", "back", "explanation", "prompt", "options", "kind", "title", "mistakes"]);
export const touchesContent = (fields: object) => Object.keys(fields).some((key) => CONTENT_KEYS.has(key));

// ─── Copia di una raccolta ────────────────────────────────────────────────────────────────

export interface DeckBundle {
  decks: StudyDeck[];
  flashcards: Flashcard[];
  quizzes: Quiz[];
  quizQuestions: QuizQuestion[];
}

/**
 * Copia indipendente di una raccolta con sotto-raccolte, schede, quiz e domande (id nuovi,
 * revisione 1, nessun progresso). Serve a «Duplica» (anche dalle raccolte condivise).
 */
export const copyDeckTree = (
  source: DeckBundle,
  rootId: string,
  options: { newId: (prefix: string) => string; now: string; parentId?: string; subjectId?: string | null; title?: string; position?: number }
): DeckBundle => {
  const ids = deckDescendantIds(source.decks, rootId);
  const deckMap = new Map<string, string>();
  for (const id of ids) deckMap.set(id, options.newId("deck"));
  const base = { createdAt: options.now, updatedAt: options.now, archived: false };
  const subject = (value: string | undefined) => (options.subjectId === null ? undefined : options.subjectId ?? value);
  const decks = source.decks
    .filter((deck) => ids.has(deck.id))
    .map((deck): StudyDeck => {
      const isRoot = deck.id === rootId;
      // externalRef è unica nell'account: la copia non la eredita, o le scritture dell'agente finirebbero lì.
      const { parentId: _parent, subjectId: _subject, externalRef: _ref, ...rest } = deck;
      const parentId = isRoot ? options.parentId : deck.parentId ? deckMap.get(deck.parentId) : undefined;
      const subjectId = subject(deck.subjectId);
      return {
        ...rest,
        ...base,
        id: deckMap.get(deck.id) as string,
        ...(parentId ? { parentId } : {}),
        ...(subjectId ? { subjectId } : {}),
        ...(isRoot && options.title ? { title: options.title } : {}),
        ...(isRoot && options.position !== undefined ? { position: options.position } : {}),
        tags: [...(deck.tags ?? [])]
      };
    });
  const flashcards = source.flashcards
    .filter((card) => ids.has(card.deckId))
    .map((card): Flashcard => {
      const { subjectId: _subject, ...rest } = card;
      const subjectId = subject(card.subjectId);
      return { ...rest, ...base, id: options.newId("card"), deckId: deckMap.get(card.deckId) as string, ...(subjectId ? { subjectId } : {}), revision: 1, tags: [...(card.tags ?? [])] };
    });
  const quizMap = new Map<string, string>();
  const quizzes = source.quizzes
    .filter((quiz) => quiz.deckId && ids.has(quiz.deckId))
    .map((quiz): Quiz => {
      const id = options.newId("quiz");
      quizMap.set(quiz.id, id);
      const { subjectId: _subject, externalRef: _ref, ...rest } = quiz;
      const subjectId = subject(quiz.subjectId);
      return { ...rest, ...base, id, deckId: deckMap.get(quiz.deckId as string), ...(subjectId ? { subjectId } : {}), revision: 1, tags: [...(quiz.tags ?? [])] };
    });
  const quizQuestions = source.quizQuestions
    .filter((question) => quizMap.has(question.quizId))
    .map((question): QuizQuestion => {
      const { subjectId: _subject, ...rest } = question;
      const subjectId = subject(question.subjectId);
      return {
        ...rest,
        ...base,
        id: options.newId("qq"),
        quizId: quizMap.get(question.quizId) as string,
        ...(subjectId ? { subjectId } : {}),
        revision: 1,
        options: question.options.map((option) => ({ ...option })),
        tags: [...(question.tags ?? [])]
      };
    });
  return { decks, flashcards, quizzes, quizQuestions };
};

// ─── Sessioni di studio ───────────────────────────────────────────────────────────────────

/**
 * Aggiunge una risposta alla sessione. Oltre LEARNING_LIMITS.runEvents eventi la sessione
 * continua in una riga nuova (`continuesId`): lo storico non si sovrascrive mai.
 */
export const appendRunEvent = (run: StudyRun, event: StudyRunEvent, newId: () => string, now: string): { run: StudyRun; next?: StudyRun } => {
  if (run.events.length < LEARNING_LIMITS.runEvents) return { run: { ...run, events: [...run.events, event], updatedAt: now } };
  const next: StudyRun = {
    ...run,
    id: newId(),
    createdAt: now,
    updatedAt: now,
    continuesId: run.id,
    startedAt: event.at,
    endedAt: undefined,
    itemIds: [],
    events: [event]
  };
  return { run: { ...run, endedAt: run.endedAt ?? event.at, updatedAt: now }, next };
};

// ─── Richieste agli agenti ────────────────────────────────────────────────────────────────

export type RequestView = AiRequest["status"];

/** Stato effettivo adesso: scadute oltre expiresAt; una presa con lease scaduto torna in attesa. */
export const requestStatusAt = (request: AiRequest, now: Date): RequestView => {
  if (request.status === "pending" || request.status === "claimed") {
    if (Date.parse(request.expiresAt) <= now.getTime()) return "expired";
    if (request.status === "claimed" && request.leaseUntil && Date.parse(request.leaseUntil) <= now.getTime()) return "pending";
  }
  return request.status;
};

export const isOpenRequest = (request: AiRequest, now: Date) => {
  const status = requestStatusAt(request, now);
  return status === "pending" || status === "claimed";
};

export const newAiRequest = (
  fields: Pick<AiRequest, "kind" | "style" | "prompt"> & Partial<Pick<AiRequest, "targetId" | "targetOwnerId" | "scope">>,
  id: string,
  now: Date
): AiRequest => {
  const iso = now.toISOString();
  return {
    id,
    createdAt: iso,
    updatedAt: iso,
    archived: false,
    tags: [],
    kind: fields.kind,
    style: fields.style,
    prompt: fields.prompt.trim().slice(0, LEARNING_LIMITS.aiPrompt),
    ...(fields.targetId ? { targetId: fields.targetId } : {}),
    ...(fields.targetOwnerId ? { targetOwnerId: fields.targetOwnerId } : {}),
    ...(fields.scope ? { scope: fields.scope } : {}),
    status: "pending",
    expiresAt: new Date(now.getTime() + LEARNING_LIMITS.requestDays * 86_400_000).toISOString(),
    attempts: 0
  };
};

/** Hash del token di presa (SHA-256, esadecimale): nel dato resta solo l'hash. */
export const hashClaimToken = async (token: string) => {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const newClaimToken = () => {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
};

/** Blocchi di una spiegazione già salvata (risultato di una richiesta), puliti. */
export const resultBlocks = (request: AiRequest): CardBlock[] => safeBlocks(request.result?.blocks);

export type { SourceRef };
