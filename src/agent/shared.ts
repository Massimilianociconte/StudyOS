// Dati di altre persone per gli agenti MCP: id opachi, proiezioni senza email né id di account e
// controlli di permesso puri (gli stessi di push_shared_rows). Niente store: i test girano senza IndexedDB.

import {
  EVENT_STATUS_LABEL,
  EXAM_STATUS_LABEL,
  GOAL_STATUS_LABEL,
  SESSION_STATUS_LABEL,
  SHARE_PERMISSION_LABEL,
  SHARE_SCOPE_LABEL,
  TASK_STATUS_LABEL
} from "../lib/labels";
import { expandEvents } from "../lib/recurrence";
import { normalizeExternalUrl } from "../lib/safeUrl";
import {
  SUBJECTLESS_SCOPES,
  VIEW_ONLY_SCOPES,
  originOf,
  safeCssColor,
  scopeCovers,
  sharedWriteError,
  type ShareContact,
  type ShareGrant,
  type ShareOffer,
  type SharePermission,
  type ShareScope,
  type SharedEntity,
  type SharedItem,
  type SharedSubjectLabel
} from "../lib/sharing";
import { taskStatusTransitionPatch } from "../lib/taskTimer";
import type { CalendarEvent, Task } from "../types";

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK64 = 0xffffffffffffffffn;

/**
 * Id stabile di una persona per l'agente, senza l'id del suo account (FNV-1a a 64 bit): con 64 bit
 * due persone tra i propri contatti non finiscono in pratica mai sullo stesso id.
 */
export const personHandle = (userId: string) => {
  let hash = FNV64_OFFSET;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= BigInt(userId.charCodeAt(index));
    hash = (hash * FNV64_PRIME) & MASK64;
  }
  return `person_${hash.toString(16).padStart(16, "0")}`;
};

/** Id di un elemento altrui per l'agente: persona, tipo e id dell'elemento. */
export const sharedHandle = (entry: Pick<SharedItem, "ownerId" | "entityType" | "entityId">) =>
  `${personHandle(entry.ownerId)}:${entry.entityType}:${entry.entityId}`;

export const findSharedByHandle = (items: readonly SharedItem[], handle: string) =>
  items.find((entry) => sharedHandle(entry) === handle);

/** Proprietario indicato da un personId, tra le persone che condividono qualcosa con me. */
export const ownerByHandle = (received: readonly ShareGrant[], handle: string) =>
  received.find((grant) => personHandle(grant.ownerId) === handle)?.ownerId;

export const contactByHandle = (people: readonly ShareContact[], handle: string) =>
  people.find((person) => personHandle(person.userId) === handle);

type SubjectName = (ownerId: string, subjectId: string) => string | undefined;

/** Una condivisione vista dall'agente: sezione, permesso, materie e nomi. Mai email, codici o id di account. */
export const publicShareGrant = (grant: ShareGrant, side: "given" | "received", subjectName: SubjectName) => ({
  id: grant.id,
  scope: grant.scope,
  scopeLabel: SHARE_SCOPE_LABEL[grant.scope],
  permission: grant.permission,
  permissionLabel: SHARE_PERMISSION_LABEL[grant.permission],
  allSubjects: grant.subjectIds.length === 0,
  subjects: grant.subjectIds.map((id) => ({ id, name: subjectName(grant.ownerId, id) ?? "Materia senza nome" })),
  ...(side === "given"
    ? {
        sharedWith: grant.granteeName || (grant.granteeGroupId ? "Gruppo" : "Persona"),
        ...(grant.granteeGroupId
          ? { groupId: grant.granteeGroupId }
          : { personId: grant.granteeUserId ? personHandle(grant.granteeUserId) : undefined })
      }
    : {
        owner: grant.ownerName || "Un'altra persona",
        personId: personHandle(grant.ownerId),
        via: grant.granteeGroupId ? "group" : "direct"
      }),
  updatedAt: grant.updatedAt
});

/** Link da dati altrui: solo quelli che si aprono senza rischi (http, https, mailto), gli altri spariscono. */
const safeLinks = (value: unknown) =>
  Array.isArray(value)
    ? value.flatMap((link) => {
        const safe = typeof link === "string" ? normalizeExternalUrl(link) : null;
        return safe ? [safe] : [];
      })
    : undefined;

/**
 * Campi di un elemento altrui che l'agente vede, per tipo: il JSON lo scrive un'altra persona, quindi
 * tutto il resto (copertine, file, cronometro, UID di import, collegamenti interni, campi sconosciuti)
 * resta fuori. Colore, link e indirizzo esterno passano a parte, già controllati.
 */
const SHARED_FIELDS: Record<string, readonly string[]> = {
  calendarEvent: ["title", "description", "category", "priority", "start", "end", "allDay", "recurrence", "recurrenceUntil", "status", "checklist", "notes"],
  task: ["title", "description", "priority", "dueDate", "status", "subtasks", "notes", "estimatedMinutes", "actualMinutes", "completedAt", "energy", "difficulty", "importance"],
  studySession: ["title", "template", "plannedMinutes", "actualMinutes", "start", "end", "topics", "perceivedDifficulty", "focusLevel", "status", "notes"],
  studyTopic: ["title", "firstStudiedAt", "comprehension", "memorization", "difficulty", "nextReviewDate", "completedReviews", "lastReviewedAt", "questions", "notes"],
  exam: ["date", "program", "preparation", "targetGrade", "status", "simulations", "frequentQuestions", "grade", "honors", "passFail"],
  attachment: ["name", "mimeType", "size", "addedAt", "description"],
  note: ["title", "body"],
  goal: ["title", "description", "category", "startDate", "deadline", "progress", "metric", "status", "notes"]
};

const COMMON_FIELDS = ["subjectId", "tags", "archived", "createdAt", "updatedAt"];

/** Chiavi mai inviate a nessuna profondità: file incorporati, copertine, cronometro, UID di import. */
const NEVER_KEYS = /^(?:cover|dataUrl|sourceUid|timer[A-Z]\w*|__proto__)$|DataUrl$/;

/**
 * Testi che un client aprirebbe come script o file (data:, javascript:, vbscript:, file://, blob:).
 * Come i browser, si ignorano spazi iniziali e tab o a capo nello schema; «Data: 12 novembre» resta.
 */
const UNSAFE_TEXT = /^(?:(?:java|vb)script:|data:(?:[a-z]+\/[\w.+-]+)?[;,]|file:\/\/|blob:(?:https?:|null\/))/i;
const unsafeText = (value: string) => UNSAFE_TEXT.test(value.replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+/, ""));

const BRIEF_TEXT = 300;
const BRIEF_ITEMS = 20;
const MAX_DEPTH = 4;

/**
 * Copia pulita di un valore altrui, a ogni profondità: via file, link pericolosi e chiavi nascoste;
 * negli elenchi (`brief`) testi e liste lunghe si accorciano. Oltre MAX_DEPTH livelli non passa nulla.
 */
const scrub = (value: unknown, brief: boolean, depth: number): unknown => {
  if (typeof value === "string") {
    if (unsafeText(value)) return undefined;
    return brief && value.length > BRIEF_TEXT ? `${value.slice(0, BRIEF_TEXT)}…` : value;
  }
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean" || value === null) return value;
  if (depth >= MAX_DEPTH || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    return (brief ? value.slice(0, BRIEF_ITEMS) : value).flatMap((item) => {
      const clean = scrub(item, brief, depth + 1);
      return clean === undefined ? [] : [clean];
    });
  }
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (NEVER_KEYS.test(key)) continue;
    const clean = scrub(item, brief, depth + 1);
    if (clean !== undefined) output[key] = clean;
  }
  return output;
};

/**
 * Un elemento altrui: solo i campi previsti per il suo tipo, ripuliti a ogni profondità, colori solo
 * esadecimali, link solo sicuri, id opaco al posto della chiave interna. `brief` (elenchi) accorcia
 * testi e liste lunghe e ne dà il totale (`<campo>Count`).
 */
export const publicSharedItem = (
  entry: SharedItem,
  received: readonly ShareGrant[],
  labels: readonly SharedSubjectLabel[],
  brief = true
) => {
  const origin = originOf(received, entry, labels);
  const entity = entry.entity;
  const output: Record<string, unknown> = {};
  for (const key of [...COMMON_FIELDS, ...listed(SHARED_FIELDS, entry.entityType)]) {
    if (!Object.hasOwn(entity, key)) continue;
    const value = entity[key];
    const clean = scrub(value, brief, 1);
    if (clean === undefined) continue;
    output[key] = clean;
    if (brief && Array.isArray(value) && value.length > BRIEF_ITEMS) output[`${key}Count`] = value.length;
  }
  const externalUrl = typeof entity.externalUrl === "string" ? normalizeExternalUrl(entity.externalUrl) : null;
  return {
    ...output,
    id: sharedHandle(entry),
    entityType: entry.entityType,
    owner: origin.ownerName,
    personId: personHandle(entry.ownerId),
    canEdit: origin.canEdit,
    subjectName: origin.subjectName,
    color: safeCssColor(entity.color) || undefined,
    links: safeLinks(entity.links),
    externalUrl: externalUrl ?? undefined,
    ...(String(entity.sourceUid ?? "").startsWith("barb-exam-") ? { officialExam: true } : {})
  };
};

export interface SharedItemsFilter {
  scope?: ShareScope;
  personId?: string;
  query?: string;
  /** Finestra per gli eventi del calendario (ripetuti espansi); gli altri tipi non si filtrano per data. */
  from: Date;
  to: Date;
}

const searchable = (entity: SharedEntity) =>
  ["title", "name", "description", "body", "notes"]
    .map((key) => (typeof entity[key] === "string" ? (entity[key] as string) : ""))
    .join(" ")
    .toLocaleLowerCase("it");

/** Evento altrui pronto per l'espansione: senza inizio e fine leggibili non si mostra (come nel calendario). */
const occurrenceSource = (entry: SharedItem) => {
  const { start, end, recurrenceUntil } = entry.entity;
  if (typeof start !== "string" || typeof end !== "string" || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return null;
  return {
    ...(entry.entity as unknown as CalendarEvent),
    recurrenceUntil: typeof recurrenceUntil === "string" ? recurrenceUntil : undefined,
    sharedEntry: entry
  };
};

/** Elementi altrui per l'agente: prima le occorrenze degli eventi nella finestra, poi il resto. */
export const sharedItemsView = (
  items: readonly SharedItem[],
  received: readonly ShareGrant[],
  labels: readonly SharedSubjectLabel[],
  filter: SharedItemsFilter
) => {
  const query = (filter.query ?? "").trim().toLocaleLowerCase("it");
  const matches = items.filter(
    (entry) =>
      (!filter.scope || scopeCovers(filter.scope, entry.entityType, entry.entity)) &&
      (!filter.personId || personHandle(entry.ownerId) === filter.personId) &&
      (!query || searchable(entry.entity).includes(query))
  );
  const events = matches.flatMap((entry) => {
    const source = entry.entityType === "calendarEvent" ? occurrenceSource(entry) : null;
    return source ? [source] : [];
  });
  const occurrences = expandEvents(events, filter.from, filter.to).map((occurrence) => ({
    ...publicSharedItem(occurrence.sharedEntry, received, labels),
    start: occurrence.start,
    end: occurrence.end,
    recurring: occurrence.recurring
  }));
  const others = matches.filter((entry) => entry.entityType !== "calendarEvent").map((entry) => publicSharedItem(entry, received, labels));
  return [...occurrences, ...others];
};

/** Campi che un agente può cambiare negli elementi altrui: come il dettaglio nell'app, niente collegamenti interni. */
export const SHARED_EDITABLE: Record<string, readonly string[]> = {
  calendarEvent: ["title", "start", "end", "allDay", "category", "description", "notes", "priority", "status"],
  task: ["title", "description", "dueDate", "status", "priority", "notes"],
  studySession: ["title", "start", "end", "plannedMinutes", "status", "notes"],
  studyTopic: ["title", "nextReviewDate", "notes"],
  exam: ["date", "status", "preparation"],
  attachment: ["name", "description"],
  note: ["title", "body"],
  goal: ["title", "deadline", "progress", "status", "notes"]
};

const STATUS_VALUES: Record<string, readonly string[]> = {
  calendarEvent: Object.keys(EVENT_STATUS_LABEL),
  task: Object.keys(TASK_STATUS_LABEL),
  studySession: Object.keys(SESSION_STATUS_LABEL),
  exam: Object.keys(EXAM_STATUS_LABEL),
  goal: Object.keys(GOAL_STATUS_LABEL)
};

const listed = (table: Record<string, readonly string[]>, key: string) => (Object.hasOwn(table, key) ? table[key] : []);

interface DraftBase {
  title: string;
  description: string;
  notes: string;
  priority: Task["priority"];
  subjectId?: string;
  color: string;
}

export type SharedDraft = DraftBase &
  (
    | { entityType: "calendarEvent"; start: string; end: string; allDay: boolean; category: CalendarEvent["category"] }
    | { entityType: "task"; dueDate?: string }
  );

/** Evento o attività completi, con gli stessi valori iniziali dell'app. */
export const newSharedEntity = (draft: SharedDraft, id: string, now: string): { entityType: string; entity: SharedEntity } => {
  const common = {
    id,
    createdAt: now,
    updatedAt: now,
    archived: false,
    tags: [] as string[],
    title: draft.title,
    description: draft.description,
    notes: draft.notes,
    priority: draft.priority,
    subjectId: draft.subjectId,
    attachmentIds: [] as string[]
  };
  if (draft.entityType === "calendarEvent") {
    const event: CalendarEvent = {
      ...common,
      category: draft.category,
      color: draft.color,
      start: draft.start,
      end: draft.end,
      allDay: draft.allDay || undefined,
      recurrence: "none",
      status: "planned",
      checklist: [],
      links: []
    };
    return { entityType: "calendarEvent", entity: event as unknown as SharedEntity };
  }
  const task: Task = {
    ...common,
    dueDate: draft.dueDate,
    status: "todo",
    subtasks: [],
    estimatedMinutes: 45,
    energy: "medium",
    difficulty: 2,
    importance: 3
  };
  return { entityType: "task", entity: task as unknown as SharedEntity };
};

export type SharedPlan =
  | { ok: true; entityType: string; entity: SharedEntity }
  | { ok: false; code: "invalid" | "denied"; error: string };

export const planSharedCreate = (
  received: readonly ShareGrant[],
  ownerId: string,
  created: { entityType: string; entity: SharedEntity }
): SharedPlan => {
  const error = sharedWriteError(received, ownerId, created.entityType, undefined, created.entity);
  return error ? { ok: false, code: "denied", error } : { ok: true, ...created };
};

/**
 * Modifica di un elemento altrui: solo i campi di SHARED_EDITABLE e solo con "Può modificare".
 * `entry` è l'ultima copia nello store: si cambiano solo i campi indicati, il resto (anche ciò che il
 * proprietario ha cambiato nel frattempo) resta. Un cambio di stato di un'attività fa ciò che farebbe
 * l'app del proprietario (cronometro chiuso e tempo salvato, completamento), ma chi riceve non avvia
 * mai il suo cronometro: "doing" passa solo se è già lo stato attuale.
 */
export const planSharedUpdate = (
  received: readonly ShareGrant[],
  entry: SharedItem,
  patch: Record<string, unknown>,
  now: string
): SharedPlan => {
  const allowed = listed(SHARED_EDITABLE, entry.entityType);
  const keys = Object.keys(patch);
  if (!keys.length) return { ok: false, code: "invalid", error: "Nessun campo da cambiare." };
  if (keys.some((key) => !allowed.includes(key))) {
    return { ok: false, code: "invalid", error: `Su questo elemento puoi cambiare solo: ${allowed.join(", ")}.` };
  }
  const statuses = listed(STATUS_VALUES, entry.entityType);
  if (patch.status !== undefined && !statuses.includes(String(patch.status))) {
    return { ok: false, code: "invalid", error: `Stato non valido. Valori ammessi: ${statuses.join(", ")}.` };
  }
  if (entry.entityType === "task" && patch.status === "doing" && entry.entity.status !== "doing") {
    return {
      ok: false,
      code: "denied",
      error: "Non puoi mettere «In corso» un'attività di un'altra persona: partirebbe il suo cronometro. Usa un altro stato."
    };
  }
  const next = { ...entry.entity, ...patch, id: entry.entityId, updatedAt: now } as SharedEntity;
  if (entry.entityType === "task" && typeof patch.status === "string") {
    Object.assign(next, taskStatusTransitionPatch(entry.entity as unknown as Task, patch.status as Task["status"], new Date(now)));
  }
  const error = sharedWriteError(received, entry.ownerId, entry.entityType, entry.entity, next);
  return error ? { ok: false, code: "denied", error } : { ok: true, entityType: entry.entityType, entity: next };
};

export const planSharedDelete = (received: readonly ShareGrant[], entry: SharedItem): SharedPlan => {
  const error = sharedWriteError(received, entry.ownerId, entry.entityType, entry.entity, null);
  return error ? { ok: false, code: "denied", error } : { ok: true, entityType: entry.entityType, entity: entry.entity };
};

/** Offerte come quelle del pannello Condividi: appelli sempre in sola lettura, obiettivi senza materie. */
export const agentOffers = (
  scopes: readonly ShareScope[],
  permission: SharePermission,
  subjectIds: readonly string[],
  subjects: readonly { id: string; name: string }[]
): ShareOffer[] =>
  scopes.map((scope) => {
    const ids = SUBJECTLESS_SCOPES.has(scope) ? [] : [...subjectIds];
    return {
      scope,
      permission: VIEW_ONLY_SCOPES.has(scope) ? "view" : permission,
      subjectIds: ids,
      subjectNames: ids.map((id) => subjects.find((subject) => subject.id === id)?.name ?? "")
    };
  });
