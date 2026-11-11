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

/** Durata massima di una sessione scritta a mano o corretta (16 ore). */
export const SESSION_MINUTES_MAX = 960;
/** Oltre 4 ore di tempo non salvato il riepilogo lo dice chiaramente (cronometro rimasto acceso). */
export const LONG_SESSION_MINUTES = 240;

const WHOLE = /^\d+$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{2}:\d{2}$/;

/** Minuti di studio scritti nel modulo: numero intero da 1 a 960. */
export const parseSessionMinutes = (text: string): { value?: number; invalid?: true } => {
  const value = text.trim();
  if (!WHOLE.test(value)) return { invalid: true };
  const minutes = Number(value);
  return minutes >= 1 && minutes <= SESSION_MINUTES_MAX ? { value: minutes } : { invalid: true };
};

/** Campi del modulo di una sessione (riepilogo di Timer e Cronometro, modifica, studio fatto). */
export interface SessionDraft {
  /** "" = nessuna materia. */
  subjectId: string;
  /** "" = nessun argomento. */
  topicId: string;
  /** Descrizione libera; vuota = titolo dell'argomento o automatico. */
  title: string;
  notes: string;
  minutes: string;
  template: StudySession["template"];
  /** Solo quando si può cambiare l'inizio: giorno (yyyy-MM-dd) e ora (HH:mm) locali. */
  date?: string;
  time?: string;
}

/** Il modulo letto e controllato: pronto per una sessione nuova o da modificare. */
export interface SessionEdit {
  subjectId?: string;
  topicId?: string;
  title: string;
  notes: string;
  template: StudySession["template"];
  minutes: number;
  /** Nuovo inizio (epoch ms), solo se il modulo ha giorno e ora. */
  start?: number;
}

export type SessionDraftError = "minutes" | "start" | "future";

/**
 * Controlla il modulo. La materia deve esistere, l'argomento deve essere di quella materia (altrimenti
 * si toglie). Il titolo è la descrizione scritta, poi il titolo dell'argomento, poi tipo e materia.
 */
export const readSessionDraft = (
  draft: SessionDraft,
  context: { subjects: ReadonlyArray<{ id: string; name: string }>; topics: readonly TopicLike[]; now: number }
): { ok: true; value: SessionEdit } | { ok: false; error: SessionDraftError } => {
  const minutes = parseSessionMinutes(draft.minutes).value;
  if (minutes === undefined) return { ok: false, error: "minutes" };
  let start: number | undefined;
  if (draft.date !== undefined || draft.time !== undefined) {
    const day = draft.date ?? "";
    const time = draft.time ?? "";
    start = DAY.test(day) && TIME.test(time) ? new Date(`${day}T${time}`).getTime() : Number.NaN;
    if (!Number.isFinite(start)) return { ok: false, error: "start" };
    if (start > context.now) return { ok: false, error: "future" };
  }
  const subject = context.subjects.find((item) => item.id === draft.subjectId);
  const topic = subject ? context.topics.find((item) => item.id === draft.topicId && item.subjectId === subject.id) : undefined;
  const title = draft.title.trim().replace(/\s+/g, " ") || topic?.title || defaultSessionTitle(draft.template, subject?.name);
  const value: SessionEdit = { title, notes: draft.notes.trim(), template: draft.template, minutes };
  if (subject) value.subjectId = subject.id;
  if (topic) value.topicId = topic.id;
  if (start !== undefined) value.start = start;
  return { ok: true, value };
};

/**
 * Modifiche da salvare su una sessione: materia e argomento sempre presenti (undefined = tolti),
 * inizio e fine ricalcolati con `editedSessionTimes` (le pause restano).
 */
export const sessionEditPatch = (
  session: Pick<StudySession, "start" | "end" | "actualMinutes">,
  edit: SessionEdit
): Pick<StudySession, "subjectId" | "topicId" | "title" | "notes" | "template" | "actualMinutes" | "start" | "end"> => {
  const parsedStart = Date.parse(session.start);
  const parsedEnd = session.end ? Date.parse(session.end) : Number.NaN;
  const originalStart = Number.isFinite(parsedStart) ? parsedStart : (edit.start ?? Date.now());
  const times = editedSessionTimes(
    { start: originalStart, end: Number.isFinite(parsedEnd) ? parsedEnd : undefined, minutes: session.actualMinutes },
    { start: edit.start, minutes: edit.minutes }
  );
  return {
    subjectId: edit.subjectId,
    topicId: edit.subjectId ? edit.topicId : undefined,
    title: edit.title,
    notes: edit.notes,
    template: edit.template,
    actualMinutes: edit.minutes,
    start: new Date(times.start).toISOString(),
    end: new Date(times.end).toISOString()
  };
};

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Modulo precompilato da una sessione salvata. Una descrizione uguale al titolo automatico o
 * all'argomento resta vuota: cambiando materia o argomento il titolo li segue.
 */
export const draftFromSession = (
  session: Pick<StudySession, "subjectId" | "topicId" | "title" | "notes" | "template" | "actualMinutes" | "start">,
  subjects: ReadonlyArray<{ id: string; name: string }>,
  topics: readonly TopicLike[]
): SessionDraft => {
  const subject = subjects.find((item) => item.id === session.subjectId);
  const topic = subject ? topics.find((item) => item.id === session.topicId && item.subjectId === subject.id) : undefined;
  const title = session.title ?? "";
  const automatic = normalize(title) === normalize(defaultSessionTitle(session.template, subject?.name)) || (topic !== undefined && normalize(title) === normalize(topic.title));
  const start = new Date(session.start);
  const valid = Number.isFinite(start.getTime());
  return {
    subjectId: subject?.id ?? "",
    topicId: topic?.id ?? "",
    title: automatic ? "" : title,
    notes: session.notes ?? "",
    minutes: String(session.actualMinutes),
    template: session.template,
    date: valid ? `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}` : "",
    time: valid ? `${pad(start.getHours())}:${pad(start.getMinutes())}` : ""
  };
};
