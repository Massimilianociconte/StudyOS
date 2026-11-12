// Esito di un esame (logica pura, testata con node --test): superato con voto, idoneità, oppure
// non superato o ritirato. Un esame non superato resta aperto e non entra mai nel libretto.
// Nessuno stato nuovo nei dati: la «data da decidere» è un'etichetta dell'esame legata alla data
// passata, così smette di valere da sola appena la data cambia (anche da un'altra versione dell'app).
import { format, isValid, parseISO } from "date-fns";
import type { Exam, Subject } from "../types";
import { isValidGrade } from "./grades";

export type ExamOutcome = "grade" | "passFail" | "failed";

const DATE_TO_DECIDE = "data-da-decidere:";

/** Etichetta interna della data da decidere (di qualsiasi data). Accetta valori qualsiasi (dati altrui). */
export const isDateToDecideTag = (tag: unknown) => typeof tag === "string" && tag.startsWith(DATE_TO_DECIDE);

/** Etichette dell'esame senza quella della data da decidere (le altre restano). */
export const withoutDateToDecide = (tags: readonly string[] | undefined): string[] => (tags ?? []).filter((tag) => !isDateToDecideTag(tag));

/** Esame non superato senza una nuova data: la data passata non chiede più «com'è andata?». */
export const isDateToDecide = (exam: Pick<Exam, "status" | "date" | "tags">) =>
  exam.status !== "done" && (exam.tags ?? []).includes(`${DATE_TO_DECIDE}${exam.date}`);

/**
 * Per gli agenti (anche esami condivisi da altri, con tipi qualsiasi): etichette senza quella interna
 * e `dateToDecide` se la nuova data va ancora scelta (la data in `date` è quella passata).
 */
export const examDateOut = (exam: { status?: unknown; date?: unknown; tags?: unknown }) => {
  const tags = Array.isArray(exam.tags) ? exam.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const dateToDecide = typeof exam.date === "string" && isDateToDecide({ status: exam.status as Exam["status"], date: exam.date, tags });
  return { tags: withoutDateToDecide(tags), dateToDecide };
};

/** Stato in cui torna un esame non superato: quello di preparazione che aveva, «In preparazione» se era «Sostenuto». */
export const reopenedStatus = (exam: Pick<Exam, "status">): Exam["status"] => (exam.status === "done" ? "studying" : exam.status);

/**
 * Non superato o ritirato: l'esame resta aperto (niente voto, niente libretto). Con una nuova
 * data la prende; senza, la data passata resta ma diventa «da decidere».
 */
export const failedExamPatch = (exam: Pick<Exam, "status" | "date" | "tags">, newDate?: string): Partial<Exam> => {
  const tags = withoutDateToDecide(exam.tags);
  return {
    status: reopenedStatus(exam),
    grade: undefined,
    honors: false,
    passFail: false,
    date: newDate ?? exam.date,
    tags: newDate ? tags : [...tags, `${DATE_TO_DECIDE}${exam.date}`]
  };
};

/**
 * Giorno proposto in «Registra il voto» (yyyy-MM-dd, ora locale): quello dell'esame che verrà riusato
 * se è già passato (l'esame del 5 si registra col 5), altrimenti oggi. Un esame non superato con la
 * data da decidere non conta: quel giorno non è andato. Il giorno resta modificabile.
 */
export const recordDateFor = (reused: Pick<Exam, "status" | "date" | "tags"> | undefined, now = new Date()): string => {
  const today = format(now, "yyyy-MM-dd");
  if (!reused || isDateToDecide(reused)) return today;
  const date = parseISO(reused.date);
  if (!isValid(date)) return today;
  const day = format(date, "yyyy-MM-dd");
  return day < today ? day : today;
};

/**
 * Istante salvato in «Registra il voto» per il giorno scelto (yyyy-MM-dd, ora locale): se è il giorno
 * dell'esame registrato (o riusato) resta la sua ora, così l'esame delle 9 non diventa delle 12 (anche
 * nel file .ics); un altro giorno, o un esame senza data leggibile, va alle 12. Giorno non valido: null.
 */
export const recordInstantFor = (day: string, reused?: Pick<Exam, "date"> | null): string | null => {
  const noon = new Date(`${day}T12:00`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || Number.isNaN(noon.getTime()) || format(noon, "yyyy-MM-dd") !== day) return null;
  const original = reused ? parseISO(reused.date) : null;
  if (original && isValid(original) && format(original, "yyyy-MM-dd") === day) return original.toISOString();
  return noon.toISOString();
};

/**
 * Modulo dell'esame o del voto diverso da com'era all'apertura: chiudere (✕, Esc, tocco fuori,
 * Indietro) chiede prima «Scartare le modifiche?». Un campo assente vale come vuoto (undefined).
 */
export const examDraftChanged = <T extends object>(draft: T, saved: T): boolean => {
  const before = saved as Record<string, unknown>;
  const after = draft as Record<string, unknown>;
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].some((key) => after[key] !== before[key]);
};

/** Esito da cui parte il modulo: idoneità se l'esame è registrato così, altrimenti con voto. */
export const outcomeOf = (exam: Pick<Exam, "passFail"> | null | undefined): ExamOutcome => (exam?.passFail ? "passFail" : "grade");

/** «Sostenuto» con idoneità o con un voto valido (18–30): l'esame è superato e la materia è chiusa. */
export const isPassingResult = (exam: Pick<Exam, "status" | "grade" | "passFail">) =>
  exam.status === "done" && (Boolean(exam.passFail) || isValidGrade(exam.grade));

/** Il pezzo di negozio che serve a `markSubjectPassed` (useStudyStore lo ha). */
export interface SubjectPassStore {
  getState: () => {
    subjects: ReadonlyArray<Pick<Subject, "id" | "status">>;
    updateSubject: (id: string, patch: Partial<Subject>) => Promise<void>;
  };
}

/**
 * Materia di un esame superato: diventa «Superata» (esce dai selettori delle materie attive e dagli
 * appelli da aggiungere). Una materia già superata o archiviata resta com'è. Stessa regola in
 * «Registra il voto» e nel modulo dell'esame. Restituisce true se l'ha cambiata.
 */
export const markSubjectPassed = async (store: SubjectPassStore, subjectId: string): Promise<boolean> => {
  const state = store.getState();
  const subject = state.subjects.find((item) => item.id === subjectId);
  if (!subject || subject.status === "completed" || subject.status === "archived") return false;
  await state.updateSubject(subjectId, { status: "completed" });
  return true;
};

const FORM_MINUTE = "yyyy-MM-dd'T'HH:mm";
/** Giorno e ora locali al minuto ("yyyy-MM-ddTHH:mm"), o null se la data non si legge. */
const localMinute = (value: string | undefined) => {
  if (!value) return null;
  // parseISO: una sola data ("2026-12-15") è la mezzanotte locale, come nella scheda dell'esame
  // (`new Date` la leggerebbe in UTC: 01:00 a Roma, il giorno prima in America).
  const parsed = parseISO(value);
  const date = isValid(parsed) ? parsed : new Date(value);
  return isValid(date) ? format(date, FORM_MINUTE) : null;
};

/**
 * «Giorno e ora dell'esame» nel modulo (ora locale): l'ora salvata così com'è, anche 00:xx (un esame
 * scritto da un agente con la sola data). Senza data (esame nuovo): tra una settimana alle 9.
 */
export const examFormDate = (date?: string, now = new Date()): string =>
  localMinute(date) ?? format(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 9, 0), FORM_MINUTE);

/**
 * Stesso giorno e stessa ora al minuto: un modulo salvato senza toccare la data la lascia com'era
 * (secondi e formato compresi), così la «data da decidere», che la cita per intero, resta valida.
 */
export const sameExamMinute = (a: string | undefined, b: string | undefined) => {
  const minute = localMinute(a);
  return minute !== null && minute === localMinute(b);
};
