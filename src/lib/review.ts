// Ripasso a intervalli crescenti (active recall), variante semplificata di SM-2.
// Dopo ogni ripasso lo studente valuta quanto ricordava: l'intervallo fino al prossimo
// ripasso cresce con la facilità dell'argomento e si azzera quando non ricordava.
import { addDays, endOfDay, parseISO, startOfDay } from "date-fns";
import type { StudyTopic } from "../types";

export type ReviewRating = "again" | "hard" | "good" | "easy";

export const REVIEW_RATINGS: ReviewRating[] = ["again", "hard", "good", "easy"];

export const REVIEW_RATING_LABEL: Record<ReviewRating, string> = {
  again: "Non ricordavo",
  hard: "Difficile",
  good: "Bene",
  easy: "Facile"
};

const DEFAULT_EASE = 2.5;
const MIN_EASE = 1.3;
const MAX_INTERVAL_DAYS = 365;

type ReviewInput = Pick<StudyTopic, "completedReviews" | "intervalDays" | "ease">;

export interface ReviewOutcome {
  intervalDays: number;
  ease: number;
  completedReviews: number;
  memorization: StudyTopic["memorization"];
  nextReviewDate: string;
  lastReviewedAt: string;
}

const MEMORIZATION: Record<ReviewRating, StudyTopic["memorization"]> = { again: 1, hard: 2, good: 4, easy: 5 };

/** Calcola il prossimo ripasso. La data è la mezzanotte locale del giorno previsto. */
export const scheduleReview = (topic: ReviewInput, rating: ReviewRating, now: Date = new Date()): ReviewOutcome => {
  const previous = Math.max(0, topic.intervalDays ?? 0);
  const baseEase = topic.ease ?? DEFAULT_EASE;
  let ease = baseEase;
  let interval: number;

  switch (rating) {
    case "again":
      ease = baseEase - 0.2;
      interval = 1;
      break;
    case "hard":
      ease = baseEase - 0.15;
      interval = Math.max(1, Math.round(previous * 1.2));
      break;
    case "good":
      interval = previous === 0 ? 1 : previous === 1 ? 3 : Math.round(previous * baseEase);
      break;
    case "easy":
      ease = baseEase + 0.15;
      interval = previous === 0 ? 3 : Math.round(Math.max(previous + 1, previous * baseEase * 1.3));
      break;
  }

  ease = Math.round(Math.max(MIN_EASE, ease) * 100) / 100;
  interval = Math.min(MAX_INTERVAL_DAYS, Math.max(1, interval));
  return {
    intervalDays: interval,
    ease,
    completedReviews: (topic.completedReviews ?? 0) + 1,
    memorization: MEMORIZATION[rating],
    nextReviewDate: addDays(startOfDay(now), interval).toISOString(),
    lastReviewedAt: now.toISOString()
  };
};

/** Argomenti da ripassare entro oggi (scaduti inclusi), dal più urgente. */
export const dueTopics = <T extends Pick<StudyTopic, "nextReviewDate" | "archived">>(topics: T[], now: Date = new Date()) => {
  const limit = endOfDay(now).getTime();
  return topics
    .filter((topic) => {
      if (topic.archived) return false;
      const time = parseISO(topic.nextReviewDate).getTime();
      return Number.isFinite(time) && time <= limit;
    })
    .sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate));
};

/** Anteprima dell'intervallo per il pulsante di valutazione (es. "3 g"). */
export const previewInterval = (topic: ReviewInput, rating: ReviewRating) => {
  const days = scheduleReview(topic, rating).intervalDays;
  if (days < 30) return `${days} g`;
  if (days < 365) return `${Math.round(days / 30)} mesi`;
  return "1 anno";
};
