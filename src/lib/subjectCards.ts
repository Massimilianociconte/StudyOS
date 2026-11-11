// Calcoli puri della sezione Materie (filtro per semestre, menu "⋯" delle schede, colore della nuova
// materia): senza DOM, testabili.
import type { Subject } from "../types";
import { SEMESTER_FILTERS, SEMESTER_IDS, SEMESTER_LABEL, type SemesterId } from "./semesters";
import { SUBJECTS_TEXT } from "./labels";

export type SemesterFilter = SemesterId | "tutti";

const filterLabel = (id: SemesterId) => SEMESTER_FILTERS.find((item) => item.id === id)?.label ?? SEMESTER_LABEL[id];

/**
 * Un solo filtro per semestre, con i conteggi: "Tutte 8 · 1° semestre 4 · 2° semestre 3 · Annuali 1".
 * Compaiono solo i semestri con materie, più quello scelto (non sparisce mentre è attivo).
 */
export function semesterFilterOptions(semesters: readonly SemesterId[], selected: SemesterFilter) {
  const count = (id: SemesterId) => semesters.filter((semester) => semester === id).length;
  return [
    { id: "tutti" as SemesterFilter, label: SUBJECTS_TEXT.allSemesters, count: semesters.length },
    ...SEMESTER_IDS.filter((id) => count(id) > 0 || id === selected).map((id) => ({ id: id as SemesterFilter, label: filterLabel(id), count: count(id) }))
  ];
}

/** CFU per semestre per il sottotitolo: "1° semestre 21 CFU · 2° semestre 6 CFU". */
export function cfuBySemester(items: ReadonlyArray<{ semester: SemesterId; cfu: number }>) {
  return SEMESTER_IDS.filter((id) => items.some((item) => item.semester === id))
    .map((id) => `${SEMESTER_LABEL[id]} ${items.filter((item) => item.semester === id).reduce((sum, item) => sum + (item.cfu || 0), 0)} CFU`)
    .join(" · ");
}

export const isArchivedSubject = (subject: Pick<Subject, "status" | "archived">) => subject.status === "archived" || Boolean(subject.archived);

export type SubjectMenuItem = { kind: "status"; status: Subject["status"] } | { kind: "archive" } | { kind: "restore" } | { kind: "delete" };

const MENU_STATUSES: Subject["status"][] = ["not-started", "active", "review", "exam-ready", "completed"];

/**
 * Voci del menu "⋯" di una scheda. In corso: gli altri stati e "Archivia" (subito, con Annulla).
 * Archiviata: "Ripristina" ed "Elimina per sempre" (con la conferma sul posto).
 */
export function subjectMenuItems(subject: Pick<Subject, "status" | "archived">): SubjectMenuItem[] {
  if (isArchivedSubject(subject)) return [{ kind: "restore" }, { kind: "delete" }];
  return [...MENU_STATUSES.filter((status) => status !== subject.status).map((status) => ({ kind: "status" as const, status })), { kind: "archive" }];
}

/** Colore della nuova materia: il primo non usato dalle materie non archiviate, poi a rotazione. */
export function nextSubjectColor(subjects: ReadonlyArray<Pick<Subject, "color" | "status" | "archived">>, swatches: readonly string[]) {
  const live = subjects.filter((subject) => !isArchivedSubject(subject));
  const used = new Set(live.map((subject) => subject.color.toLowerCase()));
  return swatches.find((swatch) => !used.has(swatch.toLowerCase())) ?? swatches[live.length % swatches.length];
}
