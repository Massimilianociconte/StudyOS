// Punteggio dei quiz: deterministico e dichiarato. Risposta singola = 1 punto se l'opzione scelta
// è quella corretta; multipla = 1 punto solo se l'insieme scelto coincide con quello corretto
// (nessun punteggio parziale). Non data = 0, contata a parte. «Dubbia» non cambia il punteggio.
import type { QuizOption, QuizQuestion } from "../types";

export type QuestionOutcome = "correct" | "wrong" | "skip";

export const QUIZ_LIMITS = { minOptions: 2, maxOptions: 10, optionText: 1000, feedback: 1000, mistakes: 2000 } as const;

/**
 * Opzioni già salvate (sync, raccolte condivise con «Può modificare»): solo quelle con id e testo,
 * mai un errore. Chi riceve può scrivere direttamente nelle righe del proprietario.
 */
export const safeOptions = (value: unknown): QuizOption[] => {
  if (!Array.isArray(value)) return [];
  const out: QuizOption[] = [];
  const seen = new Set<string>();
  for (const item of value.slice(0, QUIZ_LIMITS.maxOptions)) {
    if (!item || typeof item !== "object") continue;
    const option = item as Record<string, unknown>;
    if (typeof option.id !== "string" || !option.id || seen.has(option.id) || typeof option.text !== "string") continue;
    seen.add(option.id);
    out.push({
      id: option.id,
      text: option.text.slice(0, QUIZ_LIMITS.optionText),
      correct: option.correct === true,
      ...(typeof option.feedback === "string" && option.feedback ? { feedback: option.feedback.slice(0, QUIZ_LIMITS.feedback) } : {})
    });
  }
  return out;
};

export const correctOptionIds = (question: Pick<QuizQuestion, "options">) =>
  question.options.filter((option) => option.correct).map((option) => option.id);

export const scoreQuestion = (question: Pick<QuizQuestion, "options" | "kind">, chosen: readonly string[] | undefined): QuestionOutcome => {
  const picked = new Set((chosen ?? []).filter((id) => question.options.some((option) => option.id === id)));
  if (picked.size === 0) return "skip";
  const right = new Set(correctOptionIds(question));
  if (question.kind === "single" && picked.size !== 1) return "wrong";
  if (picked.size !== right.size) return "wrong";
  for (const id of picked) if (!right.has(id)) return "wrong";
  return "correct";
};

export interface AttemptScore {
  total: number;
  correct: number;
  wrong: number;
  skipped: number;
  flagged: number;
  /** Corrette ÷ domande (0–1); null se il quiz non ha domande. */
  score: number | null;
}

export const scoreAttempt = (
  questions: readonly Pick<QuizQuestion, "id" | "options" | "kind">[],
  answers: ReadonlyMap<string, readonly string[]> | Record<string, readonly string[]>,
  flagged: ReadonlySet<string> = new Set()
): AttemptScore => {
  const get = (id: string) => (answers instanceof Map ? answers.get(id) : (answers as Record<string, readonly string[]>)[id]);
  let correct = 0;
  let wrong = 0;
  let skipped = 0;
  for (const question of questions) {
    const outcome = scoreQuestion(question, get(question.id));
    if (outcome === "correct") correct++;
    else if (outcome === "wrong") wrong++;
    else skipped++;
  }
  const total = questions.length;
  return { total, correct, wrong, skipped, flagged: questions.filter((q) => flagged.has(q.id)).length, score: total ? correct / total : null };
};

/** Controlli di coerenza di una domanda (già normalizzata nei tipi). Restituisce l'errore o null. */
export const questionError = (question: Pick<QuizQuestion, "kind" | "options">): string | null => {
  const { options } = question;
  if (options.length < QUIZ_LIMITS.minOptions || options.length > QUIZ_LIMITS.maxOptions) {
    return `options: da ${QUIZ_LIMITS.minOptions} a ${QUIZ_LIMITS.maxOptions} opzioni`;
  }
  const ids = new Set(options.map((option) => option.id));
  if (ids.size !== options.length) return "options: id delle opzioni ripetuti";
  const texts = new Set(options.map((option) => option.text.trim().toLowerCase()));
  if (texts.size !== options.length) return "options: testi delle opzioni ripetuti";
  const right = options.filter((option) => option.correct).length;
  if (question.kind === "single" && right !== 1) return `kind single: serve esattamente 1 opzione corretta (ne hai ${right})`;
  if (question.kind === "multiple" && right < 1) return "kind multiple: serve almeno 1 opzione corretta";
  return null;
};

/** Generatore deterministico (mulberry32): stesso seme, stesso ordine. */
export const seededRandom = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** Mescola una copia (Fisher-Yates) con un seme: le correzioni usano gli id, mai le posizioni. */
export const shuffled = <T>(items: readonly T[], seed: number): T[] => {
  const random = seededRandom(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

export const optionLetter = (index: number) => String.fromCharCode(65 + index);

export type { QuizOption };
