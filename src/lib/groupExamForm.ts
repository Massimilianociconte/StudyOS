// Modulo dell'appello del gruppo senza React: bozza come testo, bozze da BARB e dai miei eventi,
// salvataggio con doppioni, unione automatica e conflitti. Lo usano GroupExamForm e i test.
import type { CalendarEvent, GroupExamKind, Subject } from "../types";
import type { BarbExamSession } from "./university/examTypes";
import { GROUP_EXAM_KIND_LABEL } from "./labels";
import {
  SESSION_EDIT_FIELDS,
  cleanSessionFields,
  findTwin,
  formatDay,
  isDay,
  mergeSessionEdit,
  sessionMatchesSubject,
  sessionToFields,
  type CleanResult,
  type GroupExamSession,
  type GroupExamWriter,
  type GroupWriteResult,
  type SessionEditField,
  type SessionFields
} from "./groupExams";
import { localDay } from "./groupExamCalendar";

/** Il modulo com'è sullo schermo: solo testo ("" = vuoto). */
export interface SessionDraft {
  /** Materia personale scelta; "" = corso scritto a mano. */
  subjectId: string;
  courseId: string;
  courseName: string;
  date: string;
  kind: GroupExamKind;
  label: string;
  time: string;
  room: string;
  notes: string;
  registrationOpens: string;
  registrationCloses: string;
  barbSessionId: string;
  source: "member" | "barb";
}

export const emptyDraft = (date = ""): SessionDraft => ({
  subjectId: "",
  courseId: "",
  courseName: "",
  date,
  kind: "appello",
  label: "",
  time: "",
  room: "",
  notes: "",
  registrationOpens: "",
  registrationCloses: "",
  barbSessionId: "",
  source: "member"
});

type SubjectLike = Pick<Subject, "id" | "name"> & { universityCourseId?: string | null };

export const courseFromSubject = (subject: SubjectLike) => ({
  subjectId: subject.id,
  courseId: subject.universityCourseId ?? "",
  courseName: subject.name
});

export const draftFromSession = (session: GroupExamSession, subjects: readonly SubjectLike[]): SessionDraft => ({
  subjectId: subjects.find((subject) => sessionMatchesSubject(session, subject))?.id ?? "",
  courseId: session.courseId ?? "",
  courseName: session.courseName,
  date: session.date,
  kind: session.kind,
  label: session.label,
  time: session.time ?? "",
  room: session.room,
  notes: session.notes,
  registrationOpens: session.registrationOpens ?? "",
  registrationCloses: session.registrationCloses ?? "",
  barbSessionId: session.barbSessionId ?? "",
  source: session.source
});

/** Tipi BARB (lib/university) → tipi dell'appello del gruppo. */
const BARB_KIND: Record<string, GroupExamKind> = {
  written: "scritto",
  oral: "orale",
  practical: "laboratorio",
  partial: "prova_in_itinere",
  exam: "appello"
};
/** Stessa forma dell'id BARB accettata dal server (barb_session_id). */
const BARB_ID_SHAPE = /^[A-Za-z0-9_.:-]{1,160}$/;
const dayOf = (value: string | null | undefined) => (value && isDay(value.slice(0, 10)) ? value.slice(0, 10) : "");
const hourOf = (value: string | null | undefined) => (value && /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : "");

/** «Aggiungi al gruppo» da un appello ufficiale: corso, data, tipo, ora, sede e iscrizioni già scritti. */
export const draftFromBarb = (session: BarbExamSession, courseName: string): SessionDraft => {
  const barbSessionId = BARB_ID_SHAPE.test(session.id) ? session.id : "";
  return {
    ...emptyDraft(dayOf(session.date)),
    courseId: session.courseId,
    courseName,
    kind: BARB_KIND[session.type ?? ""] ?? "appello",
    time: hourOf(session.time),
    room: (session.location ?? "").slice(0, 120),
    notes: [session.component, session.notes].filter(Boolean).join(" · ").slice(0, 1000),
    registrationOpens: dayOf(session.registrationOpens),
    registrationCloses: dayOf(session.registrationCloses),
    barbSessionId,
    source: barbSessionId ? "barb" : "member"
  };
};

/** Ora locale HH:mm di un istante; per le date flottanti «…T10:15:00» l'ora scritta. */
const localTime = (value: string) => {
  const floating = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})(:\d{2})?$/.exec(value);
  if (floating) return floating[1];
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

/** «Condividi con il gruppo» da un mio evento d'esame: il mio evento non cambia. */
export const sessionDraftFromEvent = (
  event: Pick<CalendarEvent, "title" | "start" | "allDay" | "subjectId" | "description">,
  subjects: readonly SubjectLike[]
): SessionDraft => {
  const subject = subjects.find((item) => item.id === event.subjectId);
  return {
    ...emptyDraft(localDay(event.start) ?? ""),
    ...(subject ? courseFromSubject(subject) : { courseName: event.title.replace(/^Appello · /, "").slice(0, 160) }),
    time: event.allDay ? "" : localTime(event.start),
    notes: (event.description ?? "").slice(0, 1000)
  };
};

/** Bozza → campi puliti, con le stesse regole e gli stessi messaggi del server. */
export const fieldsFromDraft = (draft: SessionDraft): CleanResult<SessionFields> =>
  cleanSessionFields({
    courseId: draft.courseId || null,
    courseName: draft.courseName,
    date: draft.date,
    kind: draft.kind,
    label: draft.label,
    time: draft.time || null,
    room: draft.room,
    notes: draft.notes,
    registrationOpens: draft.registrationOpens || null,
    registrationCloses: draft.registrationCloses || null,
    barbSessionId: draft.barbSessionId || null,
    // Un corso scritto a mano non è più l'appello BARB da cui si era partiti.
    source: draft.source === "barb" && draft.barbSessionId && draft.courseId ? "barb" : "member"
  });

const valueOf = (fields: SessionFields, field: SessionEditField) =>
  field === "course" ? `${fields.courseId ?? ""}|${fields.courseName}` : String(fields[field] ?? "");

export const changedSessionFields = (before: SessionFields, after: SessionFields): SessionEditField[] =>
  SESSION_EDIT_FIELDS.filter((field) => valueOf(before, field) !== valueOf(after, field));

/** Valore leggibile di un campo («12/01/2027», «Preappello», «—»). */
export const fieldText = (fields: SessionFields, field: SessionEditField): string => {
  if (field === "course") return fields.courseName;
  if (field === "kind") return GROUP_EXAM_KIND_LABEL[fields.kind];
  if (field === "date" || field === "registrationOpens" || field === "registrationCloses") return formatDay(fields[field]);
  const value = fields[field];
  return typeof value === "string" && value ? value : "—";
};

export type SaveOutcome =
  | { kind: "saved"; session: GroupExamSession; mergedFrom?: { name: string; fields: SessionEditField[] } }
  | { kind: "duplicate"; twin: GroupExamSession }
  | {
      kind: "conflict";
      base: SessionFields;
      mine: SessionFields;
      current: GroupExamSession;
      theirs: SessionFields;
      merged: SessionFields;
      conflicts: SessionEditField[];
    }
  | { kind: "gone"; current?: GroupExamSession }
  | { kind: "error"; message: string; field?: string };

const SAVE_FAILED = "Non sono riuscito a salvare l'appello. Riprova.";

interface SaveInput {
  groupId: string;
  id: string;
  /** L'appello da cui ero partito (null = nuovo). */
  base: GroupExamSession | null;
  mine: SessionFields;
  /** Appelli in memoria, per il doppione prima di scrivere. */
  sessions: readonly GroupExamSession[];
}

const write = async (
  writer: Pick<GroupExamWriter, "saveSession">,
  input: SaveInput,
  expected: number | null,
  fields: SessionFields
): Promise<GroupWriteResult<GroupExamSession>> => {
  try {
    return await writer.saveSession(input.groupId, input.id, expected, fields);
  } catch (error) {
    // Rete assente o funzione mancante: il writer lancia un errore con il testo da mostrare.
    return { status: "invalid", message: error instanceof Error && error.message ? error.message : SAVE_FAILED };
  }
};

const outcomeOf = (result: GroupWriteResult<GroupExamSession>): SaveOutcome => {
  if (result.status === "ok" && result.row) return { kind: "saved", session: result.row };
  if (result.status === "duplicate" && result.row) return { kind: "duplicate", twin: result.row };
  if (result.status === "gone") return { kind: "gone", ...(result.row ? { current: result.row } : {}) };
  return { kind: "error", message: result.message ?? SAVE_FAILED, ...(result.field ? { field: result.field } : {}) };
};

/**
 * Salva un appello. Prima il doppione in memoria; poi la scrittura con la versione di partenza. Su
 * `conflict` si uniscono le modifiche: campi diversi → nuovo salvataggio (una volta sola) sulla
 * versione attuale; stesso campo → `conflict` da far scegliere.
 */
export const saveSession = async (writer: Pick<GroupExamWriter, "saveSession">, input: SaveInput): Promise<SaveOutcome> => {
  const twin = findTwin(input.sessions, input.groupId, input.mine, input.id);
  if (twin) return { kind: "duplicate", twin };
  const first = await write(writer, input, input.base ? input.base.version : null, input.mine);
  if (first.status !== "conflict" || !first.row) return outcomeOf(first);
  const current = first.row;
  // Creazione già arrivata al server (risposta persa): l'id è casuale, quindi la riga è la mia.
  if (!input.base) return { kind: "saved", session: current };
  const base = sessionToFields(input.base);
  const theirs = sessionToFields(current);
  const { merged, conflicts } = mergeSessionEdit(base, input.mine, theirs);
  if (conflicts.length) return { kind: "conflict", base, mine: input.mine, current, theirs, merged, conflicts };
  const second = await write(writer, input, current.version, merged);
  if (second.status === "ok" && second.row) {
    return { kind: "saved", session: second.row, mergedFrom: { name: current.updatedByName, fields: changedSessionFields(base, theirs) } };
  }
  if (second.status === "conflict" && second.row) {
    const again = sessionToFields(second.row);
    const next = mergeSessionEdit(base, input.mine, again);
    return { kind: "conflict", base, mine: input.mine, current: second.row, theirs: again, merged: next.merged, conflicts: next.conflicts.length ? next.conflicts : changedSessionFields(merged, again) };
  }
  return outcomeOf(second);
};

/** Scelte del pannello dei conflitti → campi da salvare (sopra l'unione automatica). */
export const resolveConflict = (
  outcome: Extract<SaveOutcome, { kind: "conflict" }>,
  choices: Partial<Record<SessionEditField, "mine" | "theirs">>
): SessionFields => {
  const resolved: SessionFields = { ...outcome.merged };
  for (const field of outcome.conflicts) {
    const source = choices[field] === "theirs" ? outcome.theirs : outcome.mine;
    if (field === "course") {
      resolved.courseId = source.courseId;
      resolved.courseName = source.courseName;
    } else {
      (resolved as unknown as Record<string, unknown>)[field] = source[field];
    }
  }
  return resolved;
};
