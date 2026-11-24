// Unione di due materie che sono la stessa (doppione): tutto ciò che puntava a quella da togliere passa a
// quella che resta, poi la prima sparisce. Logica pura (node --test); l'azione `mergeSubjects` dello
// store la applica in un colpo solo, per l'app, gli agenti nel browser e il connettore remoto.
//
// Non passa da `deleteSubject`, che elimina esami e argomenti: qui niente si perde. I riferimenti si
// cercano per forma, in ogni collezione, così una collezione nuova con `subjectId` è già coperta:
// - `subjectId` uguale all'id tolto;
// - `subjectIds` (elenchi, anche dentro `scope`);
// - `{ type: "subject", id }` (riferimenti delle analisi AI);
// - `linkedEntityType: "subject"` con `linkedEntityId` (materiali, note, promemoria).
// Gli oggetti non toccati restano gli stessi (stesso riferimento): il diff non li riscrive nel cloud.
import type { CollectionKey, CollectionsState } from "./collections";
import { COLLECTIONS } from "./collections";
import { GROUP_COLLECTIONS } from "./syncScope";
import type { Subject } from "../types";

/** Collezioni che non si toccano: dati dei gruppi (sono anche di altre persone) e notifiche. */
const SKIP: ReadonlySet<CollectionKey> = new Set<CollectionKey>([...GROUP_COLLECTIONS, "subjects", "notifications"]);

type Json = unknown;

const isPlainObject = (value: Json): value is Record<string, Json> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * `value` con l'id `from` sostituito da `to` in ogni riferimento a una materia. Stesso oggetto (stesso
 * riferimento) se non c'era niente da cambiare.
 */
export const repointSubject = <T>(value: T, from: string, to: string): T => {
  const visit = (node: Json): Json => {
    if (Array.isArray(node)) {
      let changed = false;
      const next = node.map((item) => {
        const result = visit(item);
        if (result !== item) changed = true;
        return result;
      });
      return changed ? next : node;
    }
    if (!isPlainObject(node)) return node;
    let changed = false;
    const next: Record<string, Json> = {};
    const linksSubject = node.linkedEntityType === "subject";
    const isSubjectRef = node.type === "subject";
    for (const [key, item] of Object.entries(node)) {
      let result: Json = item;
      if (key === "subjectId" && item === from) result = to;
      else if (key === "subjectIds" && Array.isArray(item) && item.includes(from)) result = [...new Set(item.map((id) => (id === from ? to : id)))];
      else if (key === "linkedEntityId" && linksSubject && item === from) result = to;
      else if (key === "id" && isSubjectRef && item === from) result = to;
      else if (typeof item === "object" && item !== null) result = visit(item);
      if (result !== item) changed = true;
      next[key] = result;
    }
    return changed ? next : node;
  };
  return visit(value) as T;
};

const STATUS_RANK: Record<Subject["status"], number> = { "not-started": 0, active: 1, review: 2, "exam-ready": 3, completed: 4, archived: -1 };

const archivedSubject = (subject: Subject) => subject.archived || subject.status === "archived";

/**
 * Note unite senza ripetere i paragrafi già presenti in quella che resta (un agente le aveva copiate in
 * tutte e due). I paragrafi nuovi vanno in fondo, sotto il nome della materia da cui vengono.
 */
export const mergeSubjectNotes = (keep: string, drop: string, dropName: string): string => {
  const paragraphs = (text: string) => text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const squash = (text: string) => text.replace(/\s+/g, " ").trim();
  const known = new Set(paragraphs(keep).map(squash));
  const fresh = paragraphs(drop).filter((part) => !known.has(squash(part)));
  if (!fresh.length) return keep;
  const head = keep.trim() ? `${keep.trimEnd()}\n\n` : "";
  return `${head}— Da «${dropName}» —\n${fresh.join("\n\n")}`;
};

/**
 * Campi della materia che resta: i suoi, con quelli vuoti presi dall'altra (CFU 0 conta come vuoto), lo
 * stato più avanti dei due (tra quelle non archiviate), le etichette di entrambe e le note unite.
 * `name`: uno dei due nomi, scelto da chi unisce (di solito quello del catalogo).
 */
export const mergedSubject = (keep: Subject, drop: Subject, now: string, name?: string): Subject => {
  const open = [keep, drop].filter((subject) => !archivedSubject(subject));
  const status = open.length ? open.reduce((best, subject) => (STATUS_RANK[subject.status] > STATUS_RANK[best.status] ? subject : best)).status : keep.status;
  const blankSemester = (value: string | undefined) => !value || !value.trim() || value === "Semestre";
  return {
    ...keep,
    name: name && (name === keep.name || name === drop.name) ? name : keep.name,
    teacher: keep.teacher.trim() ? keep.teacher : drop.teacher,
    cfu: keep.cfu > 0 ? keep.cfu : drop.cfu,
    semester: blankSemester(keep.semester) ? drop.semester : keep.semester,
    semesterOverride: keep.semesterOverride ?? drop.semesterOverride,
    universityCourseId: keep.universityCourseId ?? drop.universityCourseId,
    icon: keep.icon && keep.icon !== "BookOpen" ? keep.icon : drop.icon || keep.icon,
    cover: keep.cover ?? drop.cover,
    targetGrade: keep.targetGrade ?? drop.targetGrade,
    examDate: keep.examDate ?? drop.examDate,
    timer: keep.timer ?? drop.timer,
    tags: [...new Set([...(keep.tags ?? []), ...(drop.tags ?? [])])],
    notes: mergeSubjectNotes(keep.notes ?? "", drop.notes ?? "", drop.name),
    status,
    archived: open.length ? false : keep.archived,
    updatedAt: now
  };
};

/** Perché due materie non si possono unire (testo per la persona), o `null` se si può. */
export const mergeBlocker = (keep: Subject | undefined, drop: Subject | undefined, sharedSubjectIds: ReadonlySet<string> = new Set()): string | null => {
  if (!keep || !drop) return "Materia non trovata.";
  if (keep.id === drop.id) return "Scegli due materie diverse.";
  if (keep.universityCourseId && drop.universityCourseId && keep.universityCourseId !== drop.universityCourseId)
    return "Sono due insegnamenti diversi del corso di laurea: non si possono unire.";
  if (sharedSubjectIds.has(drop.id))
    return `«${drop.name}» è condivisa con altre persone: togli prima la condivisione, oppure tieni questa materia e unisci l'altra.`;
  return null;
};

export type MovedCounts = Partial<Record<CollectionKey, number>>;

export interface SubjectMergePlan {
  /** Collezioni cambiate (solo quelle con qualcosa di diverso), compresa `subjects` senza la materia tolta. */
  next: Partial<CollectionsState>;
  /** Quanti oggetti passano alla materia che resta, per collezione. */
  moved: MovedCounts;
  subject: Subject;
}

/**
 * Tutte le collezioni dopo l'unione di `dropId` in `keepId`. Lancia un errore con il motivo se l'unione
 * non si può fare (vedi `mergeBlocker`).
 */
export const planSubjectMerge = (
  state: CollectionsState,
  keepId: string,
  dropId: string,
  options: { now: string; name?: string; sharedSubjectIds?: ReadonlySet<string> }
): SubjectMergePlan => {
  const keep = state.subjects.find((subject) => subject.id === keepId);
  const drop = state.subjects.find((subject) => subject.id === dropId);
  const blocker = mergeBlocker(keep, drop, options.sharedSubjectIds);
  if (blocker || !keep || !drop) throw new Error(blocker ?? "Materia non trovata.");
  const subject = mergedSubject(keep, drop, options.now, options.name);
  const next: Partial<CollectionsState> = {
    subjects: state.subjects.filter((item) => item.id !== dropId).map((item) => (item.id === keepId ? subject : item))
  };
  const moved: MovedCounts = {};
  for (const key of COLLECTIONS) {
    if (SKIP.has(key)) continue;
    const items = state[key] as unknown as Array<{ updatedAt: string }>;
    let count = 0;
    const updated = items.map((item) => {
      const result = repointSubject(item, dropId, keepId);
      if (result === item) return item;
      count += 1;
      return { ...result, updatedAt: options.now };
    });
    if (count) {
      (next as Record<string, unknown>)[key] = updated;
      moved[key] = count;
    }
  }
  return { next, moved, subject };
};
