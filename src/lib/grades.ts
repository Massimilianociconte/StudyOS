// Libretto universitario: voti degli esami superati, media aritmetica e ponderata sui CFU,
// CFU acquisiti e base di laurea in centodecimi (convenzione italiana: media × 110 / 30).
import type { Exam, Subject } from "../types";

export const MIN_GRADE = 18;
export const MAX_GRADE = 30;

export interface LibrettoEntry {
  examId: string;
  subjectId: string;
  name: string;
  cfu: number;
  date: string;
  grade?: number;
  honors: boolean;
  passFail: boolean;
}

export interface GradeStats {
  /** Esami superati (con voto o idoneità). */
  passed: number;
  /** Esami con voto numerico. */
  graded: number;
  arithmetic: number | null;
  weighted: number | null;
  cfuEarned: number;
  base110: number | null;
}

export const isValidGrade = (grade: unknown): grade is number =>
  typeof grade === "number" && Number.isInteger(grade) && grade >= MIN_GRADE && grade <= MAX_GRADE;

/** Esami superati registrati nel libretto, dal più recente. */
export const librettoEntries = (exams: Exam[], subjects: Subject[]): LibrettoEntry[] => {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  return exams
    .filter((exam) => !exam.archived && exam.status === "done" && (exam.passFail || isValidGrade(exam.grade)))
    .map((exam) => {
      const subject = byId.get(exam.subjectId);
      return {
        examId: exam.id,
        subjectId: exam.subjectId,
        name: subject?.name ?? "Materia eliminata",
        cfu: Math.max(0, subject?.cfu ?? 0),
        date: exam.date,
        grade: exam.passFail ? undefined : exam.grade,
        honors: Boolean(exam.honors && exam.grade === MAX_GRADE && !exam.passFail),
        passFail: Boolean(exam.passFail)
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export const gradeStats = (entries: Pick<LibrettoEntry, "cfu" | "grade" | "passFail">[]): GradeStats => {
  const graded = entries.filter((entry) => !entry.passFail && isValidGrade(entry.grade));
  const weightedCfu = graded.reduce((sum, entry) => sum + entry.cfu, 0);
  const arithmetic = graded.length ? graded.reduce((sum, entry) => sum + (entry.grade as number), 0) / graded.length : null;
  const weighted = weightedCfu > 0 ? graded.reduce((sum, entry) => sum + (entry.grade as number) * entry.cfu, 0) / weightedCfu : null;
  return {
    passed: entries.length,
    graded: graded.length,
    arithmetic: arithmetic === null ? null : round2(arithmetic),
    weighted: weighted === null ? null : round2(weighted),
    cfuEarned: entries.reduce((sum, entry) => sum + entry.cfu, 0),
    base110: weighted === null ? null : round2((weighted * 110) / 30)
  };
};

/**
 * Proiezione della media se gli esami ancora da sostenere andassero secondo il voto obiettivo.
 * Restituisce null se non c'è nulla da proiettare.
 */
export const projectedStats = (entries: LibrettoEntry[], exams: Exam[], subjects: Subject[]): GradeStats | null => {
  const done = new Set(entries.map((entry) => entry.subjectId));
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  const planned = exams
    .filter((exam) => !exam.archived && exam.status !== "done" && !done.has(exam.subjectId) && isValidGrade(Math.min(MAX_GRADE, exam.targetGrade)))
    .map((exam) => ({ cfu: Math.max(0, byId.get(exam.subjectId)?.cfu ?? 0), grade: Math.min(MAX_GRADE, exam.targetGrade), passFail: false }));
  if (!planned.length) return null;
  return gradeStats([...entries, ...planned]);
};

export const formatGrade = (entry: Pick<LibrettoEntry, "grade" | "honors" | "passFail">) =>
  entry.passFail ? "Idoneo" : entry.honors ? "30 e lode" : String(entry.grade ?? "—");

export const formatAverage = (value: number | null) => (value === null ? "—" : value.toFixed(2).replace(".", ","));
