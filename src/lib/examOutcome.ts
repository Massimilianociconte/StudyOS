// Esito di un esame (logica pura, testata con node --test): superato con voto, idoneità, oppure
// non superato o ritirato. Un esame non superato resta aperto e non entra mai nel libretto.
// Nessuno stato nuovo nei dati: la «data da decidere» è un'etichetta dell'esame legata alla data
// passata, così smette di valere da sola appena la data cambia (anche da un'altra versione dell'app).
import type { Exam } from "../types";

export type ExamOutcome = "grade" | "passFail" | "failed";

const DATE_TO_DECIDE = "data-da-decidere:";

const isDateTag = (tag: string) => tag.startsWith(DATE_TO_DECIDE);

/** Etichette dell'esame senza quella della data da decidere (le altre restano). */
export const withoutDateToDecide = (tags: readonly string[] | undefined): string[] => (tags ?? []).filter((tag) => !isDateTag(tag));

/** Esame non superato senza una nuova data: la data passata non chiede più «com'è andata?». */
export const isDateToDecide = (exam: Pick<Exam, "status" | "date" | "tags">) =>
  exam.status !== "done" && (exam.tags ?? []).includes(`${DATE_TO_DECIDE}${exam.date}`);

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

/** Esito da cui parte il modulo: idoneità se l'esame è registrato così, altrimenti con voto. */
export const outcomeOf = (exam: Pick<Exam, "passFail"> | null | undefined): ExamOutcome => (exam?.passFail ? "passFail" : "grade");
