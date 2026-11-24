// Aggiungere un insegnamento del catalogo (BARB) quando la persona ha già una materia personale uguale o
// simile: si collega quella, non se ne crea un'altra. Logica pura (node --test), usata dal pulsante
// «Aggiungi alle mie materie» di BARB e da studyos_add_barb_courses.
//
// - Stesso nome (a meno di maiuscole e accenti) di una sola materia non collegata: si collega quella.
// - Probabile doppione (vedi subjectIdentity) o più materie con lo stesso nome: decide la persona.
// - Nessuna somiglianza: materia nuova.
import type { Subject } from "../types";
import { subjectMatches } from "./subjectIdentity";

export type CatalogLinkChoice<S> = { kind: "new" } | { kind: "link"; subject: S } | { kind: "choose"; candidates: S[] };

export const catalogLinkChoice = <S extends { id: string; name: string; teacher?: string; universityCourseId?: string }>(
  course: { name: string; teacher?: string },
  subjects: readonly S[]
): CatalogLinkChoice<S> => {
  // Le materie già collegate a un altro insegnamento sono un'altra cosa per definizione.
  const free = subjects.filter((subject) => !subject.universityCourseId);
  const matches = subjectMatches({ name: course.name, teacher: course.teacher }, free, { minLevel: "likely" });
  const same = matches.filter((match) => match.level === "same");
  if (same.length === 1) return { kind: "link", subject: same[0].subject };
  if (matches.length) return { kind: "choose", candidates: matches.map((match) => match.subject) };
  return { kind: "new" };
};

/** Campi dell'insegnamento: quelli con cui il pulsante di BARB crea una materia nuova. */
export interface CatalogSubjectFields {
  universityCourseId: string;
  teacher: string;
  cfu: number;
  semester: string;
  icon: string;
  color: string;
  tags: string[];
  notes: string;
}

const blankSemester = (value: string | undefined) => !value || !value.trim() || value === "Semestre";

/**
 * Modifica che collega `subject` all'insegnamento: il collegamento sempre, gli altri campi solo dove la
 * materia non ha ancora niente (quello che la persona ha scritto resta). Le righe del catalogo che mancano
 * nelle note vanno in fondo.
 */
export const catalogLinkPatch = (subject: Subject, fields: CatalogSubjectFields): Partial<Subject> => {
  const notes = subject.notes ?? "";
  const missing = fields.notes
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !notes.includes(line));
  return {
    universityCourseId: fields.universityCourseId,
    teacher: subject.teacher.trim() ? subject.teacher : fields.teacher,
    cfu: subject.cfu > 0 ? subject.cfu : fields.cfu,
    semester: blankSemester(subject.semester) ? fields.semester : subject.semester,
    icon: !subject.icon || subject.icon === "BookOpen" ? fields.icon : subject.icon,
    tags: [...new Set([...(subject.tags ?? []), ...fields.tags])],
    ...(missing.length ? { notes: notes.trim() ? `${notes.trimEnd()}\n\n${missing.join("\n")}` : missing.join("\n") } : {})
  };
};
