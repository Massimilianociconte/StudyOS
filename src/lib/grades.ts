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

/** Esame superato con voto valido o idoneità: è una riga del libretto. */
const isRecorded = (exam: Exam) => !exam.archived && exam.status === "done" && (Boolean(exam.passFail) || isValidGrade(exam.grade));

/** «Sostenuto» con «Non ancora registrato»: superato, ma il voto manca. */
export const isDoneWithoutGrade = (exam: Exam) => !exam.archived && exam.status === "done" && !exam.passFail && !isValidGrade(exam.grade);

/** Prima il più recente (data, poi ultima modifica). */
const latestFirst = (a: Exam, b: Exam) => b.date.localeCompare(a.date) || (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "");

/**
 * Esami superati registrati nel libretto, dal più recente. Una sola riga per materia: se (dati di
 * prima) una materia ha più esami con voto, conta l'ultimo, e i suoi CFU una volta sola.
 */
export const librettoEntries = (exams: Exam[], subjects: Subject[]): LibrettoEntry[] => {
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  const latest = new Map<string, Exam>();
  for (const exam of exams.filter(isRecorded).sort(latestFirst)) if (!latest.has(exam.subjectId)) latest.set(exam.subjectId, exam);
  return [...latest.values()]
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

/**
 * L'esame che un nuovo voto della materia chiude, così la materia resta una riga sola: prima
 * quello già «Sostenuto» senza voto (il più recente), poi il primo ancora da dare. Nessuno: se ne
 * crea uno nuovo.
 */
export const examToRecord = (exams: Exam[], subjectId: string): Exam | undefined => {
  const mine = exams.filter((exam) => exam.subjectId === subjectId && !exam.archived);
  const withoutGrade = mine.filter(isDoneWithoutGrade).sort(latestFirst)[0];
  if (withoutGrade) return withoutGrade;
  return mine.filter((exam) => exam.status !== "done").sort((a, b) => a.date.localeCompare(b.date))[0];
};

/** Esami superati senza voto, uno per materia e solo per materie che nel libretto non ci sono già. */
export const missingGrades = (exams: Exam[], entries: Pick<LibrettoEntry, "subjectId">[]): Exam[] => {
  const recorded = new Set(entries.map((entry) => entry.subjectId));
  const seen = new Set<string>();
  return exams
    .filter(isDoneWithoutGrade)
    .sort(latestFirst)
    .filter((exam) => {
      if (recorded.has(exam.subjectId) || seen.has(exam.subjectId)) return false;
      seen.add(exam.subjectId);
      return true;
    });
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
    // Dalla media mostrata (arrotondata), come il pannello del voto di laurea: stessi numeri ovunque.
    base110: weighted === null ? null : round2((round2(weighted) * 110) / 30)
  };
};

/**
 * Proiezione della media se gli esami ancora da sostenere andassero secondo il voto obiettivo.
 * Una materia conta una volta (scritto e orale sono due esami ma un voto solo): vale l'obiettivo
 * del prossimo esame. Restituisce null se non c'è nulla da proiettare.
 */
export const projectedStats = (entries: LibrettoEntry[], exams: Exam[], subjects: Subject[]): GradeStats | null => {
  const done = new Set(entries.map((entry) => entry.subjectId));
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  const next = new Map<string, Exam>();
  const open = exams
    .filter((exam) => !exam.archived && exam.status !== "done" && !done.has(exam.subjectId) && isValidGrade(Math.min(MAX_GRADE, exam.targetGrade)))
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const exam of open) if (!next.has(exam.subjectId)) next.set(exam.subjectId, exam);
  const planned = [...next.values()].map((exam) => ({ cfu: Math.max(0, byId.get(exam.subjectId)?.cfu ?? 0), grade: Math.min(MAX_GRADE, exam.targetGrade), passFail: false }));
  if (!planned.length) return null;
  return gradeStats([...entries, ...planned]);
};

export const formatGrade = (entry: Pick<LibrettoEntry, "grade" | "honors" | "passFail">) =>
  entry.passFail ? "Idoneo" : entry.honors ? "30 e lode" : String(entry.grade ?? "—");

export const formatAverage = (value: number | null) => (value === null ? "—" : value.toFixed(2).replace(".", ","));
