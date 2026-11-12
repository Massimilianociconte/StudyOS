// Appelli condivisi dei gruppi: tipi e regole pure, le stesse di supabase/group-exams.sql.
// Senza DOM, store o Supabase: lo usano lo store degli appelli, la sync, il calendario, gli agenti e i test.
import type { GroupExamKind } from "../types";
import { GROUP_EXAM_FIELD_ERROR, GROUP_EXAM_FIELD_LABEL, GROUP_EXAM_KIND_LABEL } from "./labels";

export const GROUP_EXAM_KINDS: readonly GroupExamKind[] = [
  "appello",
  "preappello",
  "prova_in_itinere",
  "scritto",
  "orale",
  "laboratorio",
  "altro"
];

export type CatalogTargetKind = "teacher" | "course" | "schedule_rule" | "contact";
export const CATALOG_TARGET_KINDS: readonly CatalogTargetKind[] = ["teacher", "course", "schedule_rule", "contact"];

/** Appello del gruppo come lo legge il client (righe del server in camelCase). */
export interface GroupExamSession {
  id: string;
  groupId: string;
  courseKey: string;
  courseId: string | null;
  courseName: string;
  /** Giorno YYYY-MM-DD, senza fuso: è il giorno ufficiale per tutti. */
  date: string;
  kind: GroupExamKind;
  label: string;
  /** HH:mm o null. */
  time: string | null;
  room: string;
  notes: string;
  registrationOpens: string | null;
  registrationCloses: string | null;
  barbSessionId: string | null;
  source: "member" | "barb";
  version: number;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  updatedByName: string;
  deletedAt: string | null;
  deletedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Correzione del gruppo a un elemento del catalogo BARB (docente, corso, regola d'orario, contatto). */
export interface CatalogOverride {
  id: string;
  groupId: string;
  targetKind: CatalogTargetKind;
  targetId: string;
  targetLabel: string;
  fields: Record<string, string>;
  version: number;
  createdBy: string;
  createdByName: string;
  updatedBy: string;
  updatedByName: string;
  deletedAt: string | null;
  deletedByName: string | null;
  createdAt: string;
  updatedAt: string;
}

export type GroupRecordKind = "exam_session" | "catalog_override";

export interface GroupHistoryEntry {
  id: number;
  groupId: string;
  recordKind: GroupRecordKind;
  recordId: string;
  action: "create" | "update" | "delete" | "restore";
  version: number;
  /** Riga com'era prima (righe del server, snake_case); null per una creazione. */
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  changedFields: string[];
  actorUserId: string;
  actorName: string;
  changedAt: string;
}

export type GroupWriteStatus = "ok" | "duplicate" | "conflict" | "gone" | "not_found" | "denied" | "invalid";

/** Esito delle funzioni di scrittura del server; `row` è la riga scritta, quella attuale o il doppione. */
export interface GroupWriteResult<T> {
  status: GroupWriteStatus;
  row?: T;
  message?: string;
  field?: string;
}

/** L'appello intero come lo manda il client al server (sempre tutti i campi). */
export interface SessionFields {
  courseId: string | null;
  courseName: string;
  date: string;
  kind: GroupExamKind;
  label: string;
  time: string | null;
  room: string;
  notes: string;
  registrationOpens: string | null;
  registrationCloses: string | null;
  barbSessionId: string | null;
  source: "member" | "barb";
}

/** Campi che chi modifica può cambiare, nell'ordine della cronologia («course» = corso e nome insieme). */
export const SESSION_EDIT_FIELDS = ["course", "date", "kind", "label", "time", "room", "notes", "registrationOpens", "registrationCloses"] as const;
export type SessionEditField = (typeof SESSION_EDIT_FIELDS)[number];

/** Chi scrive sul server. In app è lib/groupExamSync; nei test un finto. */
export interface GroupExamWriter {
  saveSession: (groupId: string, id: string, expectedVersion: number | null, fields: SessionFields) => Promise<GroupWriteResult<GroupExamSession>>;
  deleteSession: (id: string, expectedVersion: number) => Promise<GroupWriteResult<GroupExamSession>>;
  restore: (historyId: number, expectedVersion: number) => Promise<GroupWriteResult<GroupExamSession | CatalogOverride>>;
  listHistory: (query: { groupId: string; recordKind?: GroupRecordKind; recordId?: string; limit: number; beforeId?: number }) => Promise<GroupHistoryEntry[] | null>;
  saveOverride: (
    groupId: string,
    id: string,
    expectedVersion: number | null,
    targetKind: CatalogTargetKind,
    targetId: string,
    targetLabel: string,
    fields: Record<string, string | null>
  ) => Promise<GroupWriteResult<CatalogOverride>>;
  deleteOverride: (id: string, expectedVersion: number) => Promise<GroupWriteResult<CatalogOverride>>;
}

// --- Nome del corso -------------------------------------------------------------------------

/** Stesse due stringhe di translate() in studyos_course_norm (il test controlla che coincidano). */
export const ACCENT_FROM = "ÀÁÂÃÄÅàáâãäåÈÉÊËèéêëÌÍÎÏìíîïÒÓÔÕÖòóôõöÙÚÛÜùúûüÇçÑñ";
export const ACCENT_TO = "AAAAAAaaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn";

/** Esempi condivisi con scripts/supabase/group-exams-tests.sql (N1-N6). */
export const COURSE_NORM_VECTORS: ReadonlyArray<readonly [string, string]> = [
  ["Farmacologia Speciale", "farmacologia speciale"],
  ["  Biologia   Molecolare II ", "biologia molecolare ii"],
  ["Chimica – Organica (A-L)", "chimica organica a l"],
  ["Ànatomia Umana", "anatomia umana"],
  ["ÉTICA e Società", "etica e societa"],
  ["", ""]
];

/** Nome confrontabile: accenti tolti, solo lettere e cifre ASCII minuscole, spazi singoli. */
export const normalizeCourseName = (name: string): string => {
  let out = "";
  for (const char of typeof name === "string" ? name : "") {
    const index = ACCENT_FROM.indexOf(char);
    out += index >= 0 ? ACCENT_TO[index] : char;
  }
  return out.replace(/[^A-Za-z0-9]+/g, " ").toLowerCase().trim();
};

/** Chiave del corso: `barb:<id del catalogo>` se scelto dal catalogo, altrimenti `nome:<nome normalizzato>`. */
export const courseKeyOf = (courseId: string | null | undefined, courseName: string) =>
  courseId ? `barb:${courseId}` : `nome:${normalizeCourseName(courseName)}`;

// --- Controllo dei campi (specchio di studyos_exam_session_clean) ---------------------------

export const DAY_SHAPE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_SHAPE = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const CATALOG_ID_SHAPE = /^[A-Za-z0-9_.:-]{1,120}$/;
const BARB_SESSION_SHAPE = /^[A-Za-z0-9_.:-]{1,160}$/;
const SESSION_INPUT_KEYS = new Set([
  "courseId",
  "courseName",
  "date",
  "kind",
  "label",
  "time",
  "room",
  "notes",
  "registrationOpens",
  "registrationCloses",
  "barbSessionId",
  "source"
]);

/** Giorno di calendario esistente (2027-02-30 no). */
export const isDay = (value: unknown): value is string => {
  if (typeof value !== "string" || !DAY_SHAPE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};

export type CleanResult<T> = { ok: true; value: T } | { ok: false; field: string; message: string };

const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Stesse regole e stessi messaggi del server: l'interfaccia e gli agenti sbagliano prima di scrivere. */
export const cleanSessionFields = (input: unknown): CleanResult<SessionFields> => {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, field: "fields", message: GROUP_EXAM_FIELD_ERROR.fields };
  const raw = input as Record<string, unknown>;
  for (const [key, value] of Object.entries(raw)) {
    if (!SESSION_INPUT_KEYS.has(key)) return { ok: false, field: key, message: GROUP_EXAM_FIELD_ERROR.unknown };
    if (value !== null && value !== undefined && typeof value !== "string") return { ok: false, field: key, message: GROUP_EXAM_FIELD_ERROR.value };
  }
  const courseId = textOf(raw.courseId) || null;
  const courseName = textOf(raw.courseName).replace(/\s+/g, " ");
  const kind = textOf(raw.kind) as GroupExamKind;
  const label = textOf(raw.label);
  const time = textOf(raw.time) || null;
  const room = textOf(raw.room);
  const notes = textOf(raw.notes);
  const barbSessionId = textOf(raw.barbSessionId) || null;
  const source = (textOf(raw.source) || "member") as SessionFields["source"];
  const opens = textOf(raw.registrationOpens) || null;
  const closes = textOf(raw.registrationCloses) || null;
  const date = textOf(raw.date);

  if (courseId && !CATALOG_ID_SHAPE.test(courseId)) return { ok: false, field: "courseId", message: GROUP_EXAM_FIELD_ERROR.courseId };
  if (courseName.length < 2 || courseName.length > 160) return { ok: false, field: "courseName", message: GROUP_EXAM_FIELD_ERROR.courseName };
  if (!normalizeCourseName(courseName)) return { ok: false, field: "courseName", message: GROUP_EXAM_FIELD_ERROR.courseNameLetters };
  if (!isDay(date) || date < "2000-01-01" || date > "2100-12-31") return { ok: false, field: "date", message: GROUP_EXAM_FIELD_ERROR.date };
  if (!GROUP_EXAM_KINDS.includes(kind)) return { ok: false, field: "kind", message: GROUP_EXAM_FIELD_ERROR.kind };
  if (label.length > 80) return { ok: false, field: "label", message: GROUP_EXAM_FIELD_ERROR.label };
  if (time && !TIME_SHAPE.test(time)) return { ok: false, field: "time", message: GROUP_EXAM_FIELD_ERROR.time };
  if (room.length > 120) return { ok: false, field: "room", message: GROUP_EXAM_FIELD_ERROR.room };
  if (notes.length > 1000) return { ok: false, field: "notes", message: GROUP_EXAM_FIELD_ERROR.notes };
  if (opens && !isDay(opens)) return { ok: false, field: "registrationOpens", message: GROUP_EXAM_FIELD_ERROR.registrationOpens };
  if (closes && !isDay(closes)) return { ok: false, field: "registrationCloses", message: GROUP_EXAM_FIELD_ERROR.registrationCloses };
  if (opens && closes && opens > closes) return { ok: false, field: "registrationCloses", message: GROUP_EXAM_FIELD_ERROR.registrationOrder };
  if (barbSessionId && !BARB_SESSION_SHAPE.test(barbSessionId)) return { ok: false, field: "barbSessionId", message: GROUP_EXAM_FIELD_ERROR.barbSessionId };
  if (source !== "member" && source !== "barb") return { ok: false, field: "source", message: GROUP_EXAM_FIELD_ERROR.source };
  if (source === "barb" && (!barbSessionId || !courseId)) return { ok: false, field: "source", message: GROUP_EXAM_FIELD_ERROR.sourceBarb };

  return {
    ok: true,
    value: { courseId, courseName, date, kind, label, time, room, notes, registrationOpens: opens, registrationCloses: closes, barbSessionId, source }
  };
};

// --- Righe del server -----------------------------------------------------------------------

const str = (value: unknown) => (typeof value === "string" ? value : "");
const strOrNull = (value: unknown) => (typeof value === "string" && value ? value : null);
/** `date` del server: "2027-01-12" (to_jsonb) o già un giorno. */
const dayOrNull = (value: unknown) => (typeof value === "string" && isDay(value.slice(0, 10)) ? value.slice(0, 10) : null);

/** Riga di studyos_group_exam_sessions (pull, realtime, esito RPC). null se malformata: viene da altri. */
export const sessionFromRow = (row: unknown): GroupExamSession | null => {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const date = dayOrNull(r.exam_date);
  const kind = r.kind as GroupExamKind;
  const version = Number(r.version);
  if (!str(r.id) || !str(r.group_id) || !str(r.course_key) || !str(r.course_name) || !date) return null;
  if (!GROUP_EXAM_KINDS.includes(kind) || !Number.isInteger(version) || version < 1) return null;
  return {
    id: str(r.id),
    groupId: str(r.group_id),
    courseKey: str(r.course_key),
    courseId: strOrNull(r.course_id),
    courseName: str(r.course_name),
    date,
    kind,
    label: str(r.label),
    time: strOrNull(r.exam_time),
    room: str(r.room),
    notes: str(r.notes),
    registrationOpens: dayOrNull(r.registration_opens),
    registrationCloses: dayOrNull(r.registration_closes),
    barbSessionId: strOrNull(r.barb_session_id),
    source: r.source === "barb" ? "barb" : "member",
    version,
    createdBy: str(r.created_by),
    createdByName: str(r.created_by_name),
    updatedBy: str(r.updated_by),
    updatedByName: str(r.updated_by_name),
    deletedAt: strOrNull(r.deleted_at),
    deletedByName: strOrNull(r.deleted_by_name),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at)
  };
};

export const overrideFromRow = (row: unknown): CatalogOverride | null => {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const version = Number(r.version);
  const kind = r.target_kind as CatalogTargetKind;
  if (!str(r.id) || !str(r.group_id) || !str(r.target_id) || !CATALOG_TARGET_KINDS.includes(kind)) return null;
  if (!Number.isInteger(version) || version < 1) return null;
  const fields: Record<string, string> = {};
  if (r.fields && typeof r.fields === "object" && !Array.isArray(r.fields)) {
    for (const [key, value] of Object.entries(r.fields as Record<string, unknown>)) if (typeof value === "string") fields[key] = value;
  }
  return {
    id: str(r.id),
    groupId: str(r.group_id),
    targetKind: kind,
    targetId: str(r.target_id),
    targetLabel: str(r.target_label),
    fields,
    version,
    createdBy: str(r.created_by),
    createdByName: str(r.created_by_name),
    updatedBy: str(r.updated_by),
    updatedByName: str(r.updated_by_name),
    deletedAt: strOrNull(r.deleted_at),
    deletedByName: strOrNull(r.deleted_by_name),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at)
  };
};

const ACTIONS = new Set(["create", "update", "delete", "restore"]);

export const historyFromRow = (row: unknown): GroupHistoryEntry | null => {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = Number(r.id);
  const recordKind = r.record_kind;
  if (!Number.isSafeInteger(id) || (recordKind !== "exam_session" && recordKind !== "catalog_override")) return null;
  if (!ACTIONS.has(str(r.action)) || !str(r.record_id) || !str(r.group_id)) return null;
  const json = (value: unknown) => (value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
  return {
    id,
    groupId: str(r.group_id),
    recordKind,
    recordId: str(r.record_id),
    action: r.action as GroupHistoryEntry["action"],
    version: Number(r.version) || 0,
    before: json(r.before),
    after: json(r.after),
    changedFields: Array.isArray(r.changed_fields) ? r.changed_fields.filter((item): item is string => typeof item === "string") : [],
    actorUserId: str(r.actor_user_id),
    actorName: str(r.actor_name),
    changedAt: str(r.changed_at)
  };
};

/** Esito della RPC: lo stato e la riga già convertita (null se assente o malformata). */
export const writeResultFrom = <T>(raw: unknown, convert: (row: unknown) => T | null): GroupWriteResult<T> => {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const status = (["ok", "duplicate", "conflict", "gone", "not_found", "denied", "invalid"] as const).find((item) => item === value.status) ?? "invalid";
  const row = value.row === undefined || value.row === null ? undefined : convert(value.row) ?? undefined;
  return { status, ...(row ? { row } : {}), ...(typeof value.message === "string" ? { message: value.message } : {}), ...(typeof value.field === "string" ? { field: value.field } : {}) };
};

// --- Elenco in memoria ----------------------------------------------------------------------

const byDate = (a: GroupExamSession, b: GroupExamSession) =>
  a.date.localeCompare(b.date) || a.courseName.localeCompare(b.courseName) || a.id.localeCompare(b.id);

/** Aggiunge o sostituisce una riga; una versione più vecchia (realtime in ritardo) non vince mai. */
export const mergeSessionRow = (list: readonly GroupExamSession[], row: GroupExamSession): GroupExamSession[] => {
  const current = list.find((item) => item.id === row.id);
  if (current && current.version > row.version) return [...list];
  return [...list.filter((item) => item.id !== row.id), row].sort(byDate);
};

export const mergeOverrideRow = (list: readonly CatalogOverride[], row: CatalogOverride): CatalogOverride[] => {
  const current = list.find((item) => item.id === row.id);
  if (current && current.version > row.version) return [...list];
  return [...list.filter((item) => item.id !== row.id), row];
};

/** Appello vivo dello stesso gruppo con stessa data, stesso tipo e stesso corso (chiave o nome). */
export const findTwin = (
  sessions: readonly GroupExamSession[],
  groupId: string,
  fields: Pick<SessionFields, "courseId" | "courseName" | "date" | "kind">,
  exceptId?: string
): GroupExamSession | undefined => {
  const key = courseKeyOf(fields.courseId, fields.courseName);
  const norm = normalizeCourseName(fields.courseName);
  return sessions.find(
    (item) =>
      item.groupId === groupId &&
      !item.deletedAt &&
      item.id !== exceptId &&
      item.date === fields.date &&
      item.kind === fields.kind &&
      (item.courseKey === key || normalizeCourseName(item.courseName) === norm)
  );
};

export const sessionToFields = (session: GroupExamSession): SessionFields => ({
  courseId: session.courseId,
  courseName: session.courseName,
  date: session.date,
  kind: session.kind,
  label: session.label,
  time: session.time,
  room: session.room,
  notes: session.notes,
  registrationOpens: session.registrationOpens,
  registrationCloses: session.registrationCloses,
  barbSessionId: session.barbSessionId,
  source: session.source
});

// --- Conflitti e cronologia -----------------------------------------------------------------

const fieldValue = (fields: SessionFields, field: SessionEditField): string =>
  field === "course" ? `${fields.courseId ?? ""}|${fields.courseName}` : String(fields[field] ?? "");

const copyField = (target: SessionFields, source: SessionFields, field: SessionEditField) => {
  if (field === "course") {
    target.courseId = source.courseId;
    target.courseName = source.courseName;
    return;
  }
  (target as unknown as Record<string, unknown>)[field] = source[field];
};

/**
 * Unione a tre: `base` è l'appello da cui ero partito, `mine` la mia modifica, `theirs` la riga attuale.
 * Campi cambiati da una parte sola: si prende quel cambio. Cambiati da entrambe in modo diverso: conflitto.
 */
export const mergeSessionEdit = (base: SessionFields, mine: SessionFields, theirs: SessionFields) => {
  const merged: SessionFields = { ...theirs };
  const conflicts: SessionEditField[] = [];
  for (const field of SESSION_EDIT_FIELDS) {
    const b = fieldValue(base, field);
    const m = fieldValue(mine, field);
    const t = fieldValue(theirs, field);
    if (m === b || m === t) continue;
    if (t === b) copyField(merged, mine, field);
    else conflicts.push(field);
  }
  return { merged, conflicts };
};

/** "2027-01-12" → "12/01/2027". */
export const formatDay = (day: string | null | undefined) => (day && DAY_SHAPE.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : "—");

const shownValue = (fields: SessionFields, field: SessionEditField): string => {
  if (field === "course") return fields.courseName;
  if (field === "kind") return GROUP_EXAM_KIND_LABEL[fields.kind];
  if (field === "date" || field === "registrationOpens" || field === "registrationCloses") return formatDay(fields[field]);
  const value = fields[field];
  return typeof value === "string" && value ? value : "—";
};

/** Righe leggibili di una modifica: «Data: 12/01/2027 → 14/01/2027». */
export const describeSessionChanges = (before: SessionFields | null, after: SessionFields | null, deletedBefore = false, deletedAfter = false): string[] => {
  const lines: string[] = [];
  if (before && after) {
    for (const field of SESSION_EDIT_FIELDS) {
      if (fieldValue(before, field) !== fieldValue(after, field)) {
        lines.push(`${GROUP_EXAM_FIELD_LABEL[field]}: ${shownValue(before, field)} → ${shownValue(after, field)}`);
      }
    }
  }
  if (deletedBefore !== deletedAfter) lines.push(deletedAfter ? "Eliminato" : "Ripristinato");
  return lines;
};

/** Righe leggibili di una voce di cronologia di un appello. */
export const describeHistoryEntry = (entry: GroupHistoryEntry): string[] => {
  const before = entry.before ? sessionFromRow(entry.before) : null;
  const after = entry.after ? sessionFromRow(entry.after) : null;
  if (entry.action === "create") return after ? [`Aggiunto: ${sessionTitle(after)} del ${formatDay(after.date)}`] : [];
  return describeSessionChanges(before ? sessionToFields(before) : null, after ? sessionToFields(after) : null, Boolean(before?.deletedAt), Boolean(after?.deletedAt));
};

/** «Preappello · Farmacologia Speciale» (con l'etichetta, se c'è). */
export const sessionTitle = (session: Pick<GroupExamSession, "kind" | "courseName" | "label">) =>
  [GROUP_EXAM_KIND_LABEL[session.kind], session.courseName, session.label].filter(Boolean).join(" · ");

/** Materia personale dello stesso corso: stesso id del catalogo o stesso nome normalizzato. */
export const sessionMatchesSubject = (
  session: Pick<GroupExamSession, "courseId" | "courseName">,
  subject: { name: string; universityCourseId?: string | null }
) =>
  (Boolean(session.courseId) && subject.universityCourseId === session.courseId) ||
  (normalizeCourseName(session.courseName) !== "" && normalizeCourseName(session.courseName) === normalizeCourseName(subject.name));

/** Id nuovo per un appello o una correzione (forma accettata dal server). */
export const newGroupRecordId = (prefix: "gexam" | "gover") => `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
