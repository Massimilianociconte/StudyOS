// Sessioni di studio: cosa si è studiato (argomento della materia o testo libero) e i controlli dei
// moduli che creano, riepilogano o modificano una sessione. Funzioni pure, testate con node --test
// (tests/timerCountdown.test.mjs, tests/studySessions.test.mjs).
import type { StudySession, StudyTopic } from "../types";
import { SESSION_TEMPLATE_LABEL } from "./labels";

/** Origini di una sessione salvata (StudySession.source; assente = vecchia o aggiunta a mano). */
export const SESSION_SOURCE_VALUES = ["pomodoro", "timer", "stopwatch", "manual"] as const satisfies ReadonlyArray<NonNullable<StudySession["source"]>>;

type TopicLike = Pick<StudyTopic, "id" | "subjectId" | "title" | "archived">;

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLocaleLowerCase("it");

/** Argomenti da proporre per una materia: non archiviati, in ordine alfabetico. Senza materia nessuno. */
export const topicsOfSubject = <T extends TopicLike>(topics: readonly T[], subjectId: string | undefined | null): T[] =>
  subjectId
    ? topics.filter((topic) => topic.subjectId === subjectId && !topic.archived).sort((a, b) => a.title.localeCompare(b.title, "it"))
    : [];

/** Argomento della materia con lo stesso titolo del testo scritto (maiuscole e spazi non contano). */
export const matchTopic = <T extends TopicLike>(text: string, topics: readonly T[], subjectId: string | undefined | null): T | undefined => {
  const wanted = normalize(text);
  if (!wanted) return undefined;
  return topicsOfSubject(topics, subjectId).find((topic) => normalize(topic.title) === wanted);
};

const MINUTE = 60_000;

/**
 * Inizio e fine dopo aver cambiato l'inizio o i minuti di una sessione (epoch ms). Le pause restano
 * quelle di prima (fine − inizio − minuti, mai negative): spostare l'inizio sposta anche la fine,
 * togliere minuti accorcia la fine (il caso tipico: il cronometro rimasto acceso dopo lo studio).
 * Senza cambi restano inizio e fine salvati.
 */
export const editedSessionTimes = (
  original: { start: number; end?: number; minutes: number },
  change: { start?: number; minutes?: number }
): { start: number; end: number } => {
  const end = original.end ?? original.start + original.minutes * MINUTE;
  const start = change.start ?? original.start;
  const minutes = change.minutes ?? original.minutes;
  if (start === original.start && minutes === original.minutes) return { start, end };
  const pauses = Math.max(0, end - original.start - original.minutes * MINUTE);
  return { start, end: start + minutes * MINUTE + pauses };
};

/** Titolo di una sessione senza descrizione: tipo di sessione e materia ("Ripasso · Analisi 1"). */
export const defaultSessionTitle = (template: StudySession["template"], subjectName?: string) =>
  `${SESSION_TEMPLATE_LABEL[template] ?? SESSION_TEMPLATE_LABEL["new-topic"]}${subjectName ? ` · ${subjectName}` : ""}`;
