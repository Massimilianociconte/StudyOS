// Sessioni di ripasso e tentativi di quiz in pausa: quali si possono riprendere e da dove.
// Una sessione si riprende finché non è chiusa (niente endedAt) e ha un punto di ripresa (progress):
// la riga è sincronizzata, quindi si riprende anche da un altro dispositivo dello stesso account.
import type { StudyRun, StudyRunEvent } from "../types";

/** Si può riprendere: non chiusa e con un punto di ripresa. */
export const isResumable = (run: StudyRun) => !run.endedAt && Boolean(run.progress);

/** La catena di righe di una sessione lunga (oltre 400 risposte), dalla prima all'ultima. */
export const runChain = (runs: readonly StudyRun[], last: StudyRun): StudyRun[] => {
  const byId = new Map(runs.map((run) => [run.id, run]));
  const chain: StudyRun[] = [last];
  const seen = new Set([last.id]);
  let current = last;
  while (current.continuesId && !seen.has(current.continuesId)) {
    const previous = byId.get(current.continuesId);
    if (!previous) break;
    chain.unshift(previous);
    seen.add(previous.id);
    current = previous;
  }
  return chain;
};

export interface ResumePoint {
  /** Schede o domande nell'ordine della sessione. */
  itemIds: string[];
  /** Flashcard: ultima risposta data a ogni scheda, con la riga che la contiene. */
  answered: Map<string, { event: StudyRunEvent; runId: string }>;
  /** Dove riprendere: la prima scheda senza risposta (flashcard) o la posizione salvata (quiz). */
  index: number;
  /** Quante sono già fatte. */
  done: number;
  total: number;
}

/** Punto di ripresa di una sessione o di un tentativo (null se non si può riprendere). */
export const resumePoint = (runs: readonly StudyRun[], run: StudyRun): ResumePoint | null => {
  if (!isResumable(run) || !run.progress) return null;
  const chain = runChain(runs, run);
  const itemIds = chain[0].itemIds;
  if (!itemIds.length) return null;
  if (run.kind === "quiz") {
    const answers = run.progress.answers ?? {};
    const done = itemIds.filter((id) => (answers[id] ?? []).length).length;
    const index = Math.max(0, Math.min(itemIds.length - 1, Math.floor(run.progress.index) || 0));
    return { itemIds, answered: new Map(), index, done, total: itemIds.length };
  }
  const answered = new Map<string, { event: StudyRunEvent; runId: string }>();
  for (const row of chain) for (const event of row.events) answered.set(event.i, { event, runId: row.id });
  const frontier = itemIds.findIndex((id) => !answered.has(id));
  if (frontier < 0) return null;
  return { itemIds, answered, index: frontier, done: itemIds.filter((id) => answered.has(id)).length, total: itemIds.length };
};

/** Sessioni di flashcard in pausa su una sola raccolta, per raccolta (la più recente). */
export const pausedByDeck = (runs: readonly StudyRun[]): Map<string, { run: StudyRun; point: ResumePoint }> => {
  const out = new Map<string, { run: StudyRun; point: ResumePoint }>();
  for (const entry of pausedRuns(runs)) {
    const [deckId] = entry.run.deckIds;
    if (entry.run.kind === "flashcards" && entry.run.deckIds.length === 1 && !out.has(deckId)) out.set(deckId, entry);
  }
  return out;
};

/** Sessioni e tentativi in pausa, il più recente prima. Le righe di una stessa catena contano una volta. */
export const pausedRuns = (runs: readonly StudyRun[]): { run: StudyRun; point: ResumePoint }[] =>
  runs
    .filter(isResumable)
    .map((run) => ({ run, point: resumePoint(runs, run) }))
    .filter((entry): entry is { run: StudyRun; point: ResumePoint } => entry.point !== null)
    .sort((a, b) => (b.run.progress?.at ?? "").localeCompare(a.run.progress?.at ?? ""));
