import type { Subject } from "../types";
import type { BarbCourse, SemesterId } from "./university/types";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { resolveBarbCourse } from "./university/examSessions";

export type { SemesterId } from "./university/types";
export const SEMESTER_IDS = ["primo", "secondo", "annuale", "non-definito"] as const;
export const SEMESTER_LABEL: Record<SemesterId, string> = {
  primo: "1° semestre", secondo: "2° semestre", annuale: "Annuale", "non-definito": "Da definire"
};
export const SEMESTER_SHORT: Record<SemesterId, string> = {
  primo: "1° sem", secondo: "2° sem", annuale: "Annuale", "non-definito": "Da definire"
};
export const SEMESTER_TONE: Record<SemesterId, string> = {
  primo: "var(--accent)", secondo: "var(--accent-2)", annuale: "var(--warning)", "non-definito": "var(--faint)"
};
export const SEMESTER_FILTERS = [{ id: "tutti", label: "Tutti" }, ...SEMESTER_IDS.map((id) => ({ id, label: id === "annuale" ? "Annuali" : SEMESTER_LABEL[id] }))];

/** Legacy personal labels may include a year. Unknown text is never guessed. */
export function parseSubjectSemester(value?: string): SemesterId {
  const text = (value ?? "").trim().toLowerCase().normalize("NFKC");
  if (/^(primo|1\s*[°ºo]?\s*(semestre|sem)|i\s+semestre|first\s+semester)\b/.test(text)) return "primo";
  if (/^(secondo|2\s*[°ºo]?\s*(semestre|sem)|ii\s+semestre|second\s+semester)\b/.test(text)) return "secondo";
  if (/^(annuale|annuali|annual)\b/.test(text)) return "annuale";
  return "non-definito";
}

/** Explicit user choice wins; linked official courses otherwise use the verified catalog.
 * Legacy imported display strings cannot override a newer official correction. */
export function subjectSemester(subject: Pick<Subject, "name" | "semester" | "semesterOverride" | "universityCourseId">, courses: BarbCourse[] = BARB_DATASET.courses): SemesterId {
  if (subject.semesterOverride && SEMESTER_IDS.includes(subject.semesterOverride)) return subject.semesterOverride;
  return resolveBarbCourse(subject, courses)?.semester ?? parseSubjectSemester(subject.semester);
}
