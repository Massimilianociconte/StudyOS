// Esito di un esame (logica pura, testata con node --test): superato con voto, idoneità, oppure
// non superato o ritirato. Un esame non superato resta aperto e non entra mai nel libretto.
// Nessuno stato nuovo nei dati: la «data da decidere» è un'etichetta dell'esame legata alla data
// passata, così smette di valere da sola appena la data cambia (anche da un'altra versione dell'app).
import { format, isValid, parseISO } from "date-fns";
import type { Exam } from "../types";

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

/** Esito da cui parte il modulo: idoneità se l'esame è registrato così, altrimenti con voto. */
export const outcomeOf = (exam: Pick<Exam, "passFail"> | null | undefined): ExamOutcome => (exam?.passFail ? "passFail" : "grade");
