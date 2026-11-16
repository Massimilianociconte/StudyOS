// Ripasso a intervalli delle flashcard: variante di SM-2 a tre esiti (corretta, dubbia, sbagliata)
// più «salta». Deterministico: stessi dati e stesso istante danno sempre la stessa pianificazione.
// Le regole sono documentate in docs/superpowers/specs/2026-11-16-flashcards-quiz-design.md §3.
import { addDays, endOfDay, startOfDay } from "date-fns";
import type { FlashcardState, ReviewResult } from "../types";

export const SRS = {
  startEase: 2.5,
  minEase: 1.3,
  maxEase: 3,
  maxIntervalDays: 365,
  /** Una scheda sbagliata torna dopo 10 minuti. */
  relearnMinutes: 10,
  wrongEasePenalty: 0.2,
  doubtEasePenalty: 0.15,
  correctEaseBonus: 0.05,
  doubtGrowth: 1.2,
  /** Consolidata: intervallo di almeno 21 giorni e ultimo esito corretto. */
  consolidatedDays: 21,
  /** Difficile: almeno 3 errori o facilità sotto 1,8. */
  difficultLapses: 3,
  difficultEase: 1.8
} as const;

const round2 = (value: number) => Math.round(value * 100) / 100;
const clampEase = (value: number) => round2(Math.min(SRS.maxEase, Math.max(SRS.minEase, value)));

export interface CardRef {
  id: string;
  deckId?: string;
  subjectId?: string;
  revision?: number;
  /** Id dell'account che condivide la scheda (assente = propria). */
  ownerId?: string;
}

/** Stato iniziale di una scheda mai valutata (non salvato finché non c'è una risposta). */
export const emptyCardState = (card: CardRef, now: Date): FlashcardState => {
  const iso = now.toISOString();
  return {
    id: card.id,
    createdAt: iso,
    updatedAt: iso,
    archived: false,
    tags: [],
    ...(card.ownerId ? { ownerId: card.ownerId } : {}),
    ...(card.deckId ? { deckId: card.deckId } : {}),
    ...(card.subjectId ? { subjectId: card.subjectId } : {}),
    reps: 0,
    lapses: 0,
    ease: SRS.startEase,
    intervalDays: 0,
    due: iso,
    correct: 0,
    wrong: 0,
    doubt: 0
  };
};

/** Contatore sicuro: uno stato arrivato da un'altra versione o da un agente può non averlo. */
const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0);

/**
 * Applica una risposta. «Salta» restituisce lo stato invariato (nessuna scrittura).
 * Gli intervalli sono in giorni; la scadenza è un istante (ora + intervallo).
 */
export const applyReview = (previous: FlashcardState | undefined, card: CardRef, result: ReviewResult, now: Date): FlashcardState => {
  const base = previous ?? emptyCardState(card, now);
  if (result === "skip") return base;
  const iso = now.toISOString();
  const ease = Number.isFinite(base.ease) ? base.ease : SRS.startEase;
  const interval = Math.max(0, Number.isFinite(base.intervalDays) ? base.intervalDays : 0);
  const reps = count(base.reps);
  const lapses = count(base.lapses);
  let next: Pick<FlashcardState, "reps" | "lapses" | "ease" | "intervalDays" | "due">;
  if (result === "wrong") {
    next = {
      reps: 0,
      lapses: lapses + 1,
      ease: clampEase(ease - SRS.wrongEasePenalty),
      intervalDays: 0,
      due: new Date(now.getTime() + SRS.relearnMinutes * 60_000).toISOString()
    };
  } else if (result === "doubt") {
    const days = interval < 1 ? 1 : Math.min(SRS.maxIntervalDays, Math.max(1, Math.round(interval * SRS.doubtGrowth)));
    next = { reps, lapses, ease: clampEase(ease - SRS.doubtEasePenalty), intervalDays: days, due: addDays(now, days).toISOString() };
  } else {
    const nextReps = reps + 1;
    const days =
      nextReps === 1 ? 1 : nextReps === 2 ? 3 : Math.min(SRS.maxIntervalDays, Math.max(interval + 1, Math.round(Math.max(interval, 1) * ease)));
    next = { reps: nextReps, lapses, ease: clampEase(ease + SRS.correctEaseBonus), intervalDays: days, due: addDays(now, days).toISOString() };
  }
  return {
    ...base,
    ...next,
    ...(card.deckId ? { deckId: card.deckId } : {}),
    ...(card.subjectId ? { subjectId: card.subjectId } : {}),
    ...(card.ownerId ? { ownerId: card.ownerId } : {}),
    ...(card.revision !== undefined ? { revision: card.revision } : {}),
    lastResult: result,
    lastReviewedAt: iso,
    correct: count(base.correct) + (result === "correct" ? 1 : 0),
    wrong: count(base.wrong) + (result === "wrong" ? 1 : 0),
    doubt: count(base.doubt) + (result === "doubt" ? 1 : 0),
    updatedAt: iso
  };
};

export type CardStatus = "new" | "overdue" | "due" | "difficult" | "doubtful" | "consolidated" | "learning";

export const CARD_STATUS_LABEL: Record<CardStatus, string> = {
  new: "Nuova",
  overdue: "In ritardo",
  due: "Da ripassare oggi",
  difficult: "Difficile",
  doubtful: "Dubbia",
  consolidated: "Consolidata",
  learning: "In apprendimento"
};

export interface CardClass {
  /** Stato principale, nell'ordine: nuova, in ritardo, oggi, difficile, dubbia, consolidata, in apprendimento. */
  status: CardStatus;
  isNew: boolean;
  /** Da ripassare entro la fine di oggi (comprese quelle in ritardo). */
  due: boolean;
  /** Scadenza prima dell'inizio di oggi. */
  overdue: boolean;
  difficult: boolean;
  doubtful: boolean;
  consolidated: boolean;
}

export const isAnswered = (state: FlashcardState | undefined): state is FlashcardState =>
  Boolean(state) && (state as FlashcardState).correct + (state as FlashcardState).wrong + (state as FlashcardState).doubt > 0;

// Inizio e fine di «oggi» per l'ultimo istante chiesto: classifyCard gira su migliaia di schede con lo
// stesso now (CPU del Worker). La classe di Date fa parte della chiave: sul connettore remoto ogni fuso
// ha la sua (withZonedDate), e lo stesso istante può cadere in giorni diversi.
let lastBounds: { ms: number; kind: unknown; start: number; end: number } | null = null;
const todayBounds = (now: Date) => {
  const ms = now.getTime();
  if (lastBounds && lastBounds.ms === ms && lastBounds.kind === now.constructor) return lastBounds;
  lastBounds = { ms, kind: now.constructor, start: startOfDay(now).getTime(), end: endOfDay(now).getTime() };
  return lastBounds;
};

/** Classificazione di una scheda («oggi» = giorno locale). */
export const classifyCard = (state: FlashcardState | undefined, now: Date): CardClass => {
  if (!isAnswered(state)) {
    return { status: "new", isNew: true, due: false, overdue: false, difficult: false, doubtful: false, consolidated: false };
  }
  const dueTime = Date.parse(state.due);
  const today = todayBounds(now);
  const due = Number.isFinite(dueTime) ? dueTime <= today.end : true;
  const overdue = Number.isFinite(dueTime) ? dueTime < today.start : false;
  const difficult = state.lapses >= SRS.difficultLapses || state.ease < SRS.difficultEase;
  const doubtful = state.lastResult === "doubt";
  const consolidated = state.intervalDays >= SRS.consolidatedDays && state.lastResult === "correct";
  const status: CardStatus = overdue ? "overdue" : due ? "due" : difficult ? "difficult" : doubtful ? "doubtful" : consolidated ? "consolidated" : "learning";
  return { status, isNew: false, due, overdue, difficult, doubtful, consolidated };
};

/** Ordine di una sessione di ripasso: in ritardo da più tempo prima, poi oggi, poi le nuove (nell'ordine della raccolta). */
export const reviewPriority = (state: FlashcardState | undefined) => (isAnswered(state) ? Date.parse(state.due) || 0 : Number.MAX_SAFE_INTEGER);
