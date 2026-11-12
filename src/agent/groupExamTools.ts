// Strumenti MCP degli appelli dei gruppi e del piano d'esame personale (spec §9). execute.ts lo carica
// con import(); le scritture sul gruppo caricano lib/groupExamSync (Supabase) solo quando servono.
// I testi scritti dai membri (note, aule, nomi, cronologia) passano da agentMemberText: nessuna email.
import { describeOverrideEntry } from "../lib/catalogOverrides";
import type { ExamPlanPatch } from "../lib/examPlans";
import { courseFromSubject } from "../lib/groupExamForm";
import {
  cleanSessionFields,
  describeHistoryEntry,
  findTwin,
  newGroupRecordId,
  sessionFromRow,
  sessionMatchesSubject,
  sessionTitle,
  sessionToFields,
  type CatalogOverride,
  type GroupExamSession,
  type GroupExamWriter,
  type GroupHistoryEntry,
  type GroupRecordKind,
  type GroupWriteResult
} from "../lib/groupExams";
import { planChanges } from "../lib/groupExamUi";
import { EXAM_PLAN_STATUS_LABEL, GROUP_EXAM_KIND_LABEL } from "../lib/labels";
import { GROUP_EXAM_TEXT } from "../lib/labels/groupExams";
import { sanitizeReminders } from "../lib/repeat";
import { groupNamesOf, useGroupExamStore } from "../store/useGroupExamStore";
import type { ExamPlan, ExamPlanStatus } from "../types";
import { agentMemberText } from "./project";
import { fail, ok, optional, page, state, text, type Args } from "./toolkit";
import type { AgentCallResult } from "./types";

/** Chi scrive sul server: lib/groupExamSync, caricato alla prima scrittura. I test lo sostituiscono. */
export const groupExamWriterLoader: { load: () => Promise<GroupExamWriter> } = {
  load: async () => (await import("../lib/groupExamSync")).groupExamWriter
};

const NOT_READ = "Gli appelli dei gruppi non sono ancora stati letti: apri StudyOS online e accedi, poi riprova.";
const NO_GROUP = "Gruppo non trovato tra quelli online: usa un groupId di studyos_list_group_exam_sessions.";
const NO_SESSION = "Appello non trovato: usa un id di studyos_list_group_exam_sessions.";
const DELETED = "L'appello è stato eliminato nel gruppo: ripristinalo dalla cronologia prima di cambiarlo.";
const CONFLICT = "Qualcuno l'ha cambiato nel frattempo: leggi data.current, rifai la modifica e riprova con la sua version.";
const DUPLICATE = "Nel gruppo c'è già un appello con lo stesso corso, giorno e tipo: è in data.existing.";
const DENIED = "Non hai il permesso per questa modifica nel gruppo.";
const GONE = "È stato eliminato nel gruppo: ripristinalo dalla cronologia prima di cambiarlo.";
const NOT_IN_GROUP = "Non trovato nel gruppo: rileggi prima di riprovare.";
const BAD_HISTORY_ID = "historyId non valido: usa quello di studyos_list_group_history.";
const NOTHING = "Niente da cambiare: indica almeno un campo.";
const NOTES_MAX = 300;
const ACTION_LABEL: Record<GroupHistoryEntry["action"], string> = {
  create: "Aggiunto",
  update: "Modificato",
  delete: "Eliminato",
  restore: "Ripristinato"
};

type FailCode = Extract<AgentCallResult, { ok: false }>["code"];
export const failWith = (code: FailCode, error: string, data?: Record<string, unknown>): AgentCallResult =>
  data ? { ok: false, code, error, data } : { ok: false, code, error };

const groups = () => useGroupExamStore.getState();
const groupNameOf = (groupId: string) => groupNamesOf(groups().groups).get(groupId) ?? "";
const subjectFor = (session: Pick<GroupExamSession, "courseId" | "courseName">) =>
  state().subjects.find((item) => !item.archived && sessionMatchesSubject(session, item));

/** null = gli appelli si possono leggere; altrimenti not_connected (mai «non c'è» per ciò che non si è letto). */
export const groupExamsReady = (): AgentCallResult | null => {
  const current = groups();
  if (!current.available) return fail("not_connected", GROUP_EXAM_TEXT.notActive);
  if (!current.ready || !current.viewerId) return fail("not_connected", NOT_READ);
  return null;
};

/** Appello per gli agenti (spec §9.3): nomi e non id degli account, testi dei membri senza email. */
export const publicSession = (session: GroupExamSession, plans: readonly ExamPlan[] = state().examPlans) => {
  const plan = plans.find((item) => item.sessionId === session.id);
  const subject = subjectFor(session);
  const notes = agentMemberText(session.notes);
  return {
    id: session.id,
    groupId: session.groupId,
    groupName: agentMemberText(groupNameOf(session.groupId)),
    courseName: agentMemberText(session.courseName),
    courseId: session.courseId,
    date: session.date,
    kind: session.kind,
    kindLabel: GROUP_EXAM_KIND_LABEL[session.kind],
    label: agentMemberText(session.label),
    time: session.time,
    room: agentMemberText(session.room),
    notes: notes.slice(0, NOTES_MAX),
    ...(notes.length > NOTES_MAX ? { truncated: true } : {}),
    registrationOpens: session.registrationOpens,
    registrationCloses: session.registrationCloses,
    source: session.source,
    version: session.version,
    addedBy: agentMemberText(session.createdByName),
    updatedBy: agentMemberText(session.updatedByName),
    updatedAt: session.updatedAt,
    deleted: Boolean(session.deletedAt),
    ...(session.deletedAt ? { deletedBy: agentMemberText(session.deletedByName ?? "") } : {}),
    ...(subject ? { mySubjectId: subject.id } : {}),
    ...(plan ? { myPlan: { chosen: plan.selected, status: plan.status, statusLabel: EXAM_PLAN_STATUS_LABEL[plan.status] } } : {})
  };
};

const publicOverride = (row: CatalogOverride) => ({
  id: row.id,
  groupId: row.groupId,
  groupName: agentMemberText(groupNameOf(row.groupId)),
  targetKind: row.targetKind,
  targetId: row.targetId,
  targetLabel: agentMemberText(row.targetLabel),
  version: row.version,
  deleted: Boolean(row.deletedAt)
});

const isSession = (row: GroupExamSession | CatalogOverride): row is GroupExamSession => "courseKey" in row;
const publicRecord = (row: GroupExamSession | CatalogOverride) => (isSession(row) ? publicSession(row) : publicOverride(row));

const publicHistory = (entry: GroupHistoryEntry) => {
  const row = entry.after ?? entry.before;
  const session = entry.recordKind === "exam_session" && row ? sessionFromRow(row) : null;
  const title = session ? sessionTitle(session) : typeof row?.target_label === "string" ? row.target_label : "";
  const changes = entry.recordKind === "exam_session" ? describeHistoryEntry(entry) : describeOverrideEntry(entry);
  return {
    historyId: String(entry.id),
    recordKind: entry.recordKind,
    recordId: entry.recordId,
    action: entry.action,
    actionLabel: ACTION_LABEL[entry.action],
    version: entry.version,
    title: agentMemberText(title),
    changes: changes.map((line) => agentMemberText(line)),
    by: agentMemberText(entry.actorName),
    at: entry.changedAt,
    restorable: entry.action !== "create"
  };
};

/** Rete, sessione o tabelle mancanti: lib/groupExamSync lancia con i testi di GROUP_EXAM_TEXT. */
const thrown = (error: unknown): AgentCallResult =>
  fail("not_connected", error instanceof Error && error.message === GROUP_EXAM_TEXT.notActive ? GROUP_EXAM_TEXT.notActive : GROUP_EXAM_TEXT.offline);

/** Esito non riuscito del server → risposta MCP (spec §9.4). */
const writeFailure = <T>(result: GroupWriteResult<T>, project: (row: T) => Record<string, unknown>): AgentCallResult => {
  const row = result.row;
  switch (result.status) {
    case "conflict":
      return failWith("conflict", CONFLICT, row ? { current: project(row) } : undefined);
    case "duplicate":
      return failWith("invalid", result.message || DUPLICATE, row ? { existing: project(row) } : undefined);
    case "gone":
      return failWith("not_found", result.message || GONE, row ? { current: project(row) } : undefined);
    case "not_found":
      return fail("not_found", result.message || NOT_IN_GROUP);
    case "denied":
      return fail("denied", result.message || DENIED);
    case "invalid":
      return failWith("invalid", result.message || "Dati non validi.", result.field ? { field: result.field } : undefined);
    default:
      return fail("failed", "Il server non ha confermato la modifica: rileggi gli appelli prima di riprovare.");
  }
};

/** Scrittura sul gruppo con la risposta MCP di spec §9.4 (la usa anche universityTools). */
export const groupWrite = async <T>(
  run: (writer: GroupExamWriter) => Promise<GroupWriteResult<T>>,
  project: (row: T) => Record<string, unknown>,
  done: (row: T) => Record<string, unknown> | Promise<Record<string, unknown>>
): Promise<AgentCallResult> => {
  let result: GroupWriteResult<T>;
  try {
    result = await run(await groupExamWriterLoader.load());
  } catch (error) {
    return thrown(error);
  }
  if (result.status !== "ok" || !result.row) return writeFailure(result, project);
  return ok(await done(result.row));
};

/** Mette l'appello nel piano: con la materia indicata o, se il piano non ne ha una, quella dello stesso corso. */
const choosePlan = (session: GroupExamSession, subjectId?: string) => {
  const existing = state().examPlans.find((plan) => plan.sessionId === session.id);
  const subject = existing?.subjectId ? undefined : (subjectId ?? subjectFor(session)?.id);
  return state().planExam(session.id, { selected: true, ...(subject ? { subjectId: subject } : {}) }, session, groupNameOf(session.groupId));
};

export const listGroupExamSessions = (args: Args): AgentCallResult => {
  const blocked = groupExamsReady();
  if (blocked) return blocked;
  const current = groups();
  const groupId = optional(args.groupId);
  if (groupId && !current.groups.some((group) => group.id === groupId)) return fail("not_found", NO_GROUP);
  const subjectId = optional(args.subjectId);
  const subject = subjectId ? state().subjects.find((item) => item.id === subjectId) : undefined;
  if (subjectId && !subject) return fail("not_found", "Materia non trovata.");
  const from = optional(args.from);
  const to = optional(args.to);
  const query = text(args.query).trim().toLocaleLowerCase("it");
  const plans = state().examPlans;
  const chosen = new Set(plans.filter((plan) => plan.selected).map((plan) => plan.sessionId));
  const items = current.sessions.filter(
    (session) =>
      (!session.deletedAt || args.includeDeleted === true) &&
      (!groupId || session.groupId === groupId) &&
      (!subject || sessionMatchesSubject(session, subject)) &&
      (!from || session.date >= from) &&
      (!to || session.date <= to) &&
      (args.onlyChosen !== true || chosen.has(session.id)) &&
      (!query || agentMemberText(`${session.courseName} ${session.label} ${session.room}`).toLocaleLowerCase("it").includes(query))
  );
  const listed = page(items, args);
  return ok({
    groups: current.groups.map((group) => ({ groupId: group.id, name: agentMemberText(group.name) })),
    ...listed,
    items: listed.items.map((session) => publicSession(session, plans))
  });
};

export const createGroupExamSession = async (args: Args): Promise<AgentCallResult> => {
  const blocked = groupExamsReady();
  if (blocked) return blocked;
  const groupId = text(args.groupId);
  if (!groups().groups.some((group) => group.id === groupId)) return fail("not_found", NO_GROUP);
  const subjectId = optional(args.subjectId);
  const subject = subjectId ? state().subjects.find((item) => item.id === subjectId) : undefined;
  if (subjectId && !subject) return fail("not_found", "Materia non trovata.");
  const course = subject ? courseFromSubject(subject) : { courseId: text(args.courseId), courseName: text(args.courseName) };
  if (!course.courseName.trim()) return failWith("invalid", "Indica subjectId oppure courseName.", { field: "courseName" });
  const cleaned = cleanSessionFields({
    courseId: course.courseId,
    courseName: course.courseName,
    date: text(args.date),
    kind: text(args.kind),
    label: text(args.label),
    time: text(args.time),
    room: text(args.room),
    notes: text(args.notes),
    registrationOpens: text(args.registrationOpens),
    registrationCloses: text(args.registrationCloses),
    source: "member"
  });
  if (!cleaned.ok) return failWith("invalid", cleaned.message, { field: cleaned.field });
  const choose = args.choose === true;
  const answerTwin = async (twin: GroupExamSession) => {
    if (choose && !twin.deletedAt) await choosePlan(twin, subject?.id);
    return ok({ created: false, duplicate: true, session: publicSession(twin) });
  };
  const twin = findTwin(groups().sessions, groupId, cleaned.value);
  if (twin) return answerTwin(twin);
  let result: GroupWriteResult<GroupExamSession>;
  try {
    result = await (await groupExamWriterLoader.load()).saveSession(groupId, newGroupRecordId("gexam"), null, cleaned.value);
  } catch (error) {
    return thrown(error);
  }
  if (result.status === "duplicate" && result.row) {
    useGroupExamStore.getState().applySession(result.row);
    return answerTwin(result.row);
  }
  if (result.status !== "ok" || !result.row) return writeFailure(result, publicSession);
  useGroupExamStore.getState().applySession(result.row);
  if (choose) await choosePlan(result.row, subject?.id);
  return ok({ created: true, session: publicSession(result.row) });
};

const SESSION_TEXT_KEYS = ["label", "time", "room", "notes", "registrationOpens", "registrationCloses", "courseName", "courseId", "date", "kind"] as const;

export const updateGroupExamSession = async (args: Args): Promise<AgentCallResult> => {
  const blocked = groupExamsReady();
  if (blocked) return blocked;
  const current = groups().sessions.find((item) => item.id === text(args.id));
  if (!current) return fail("not_found", NO_SESSION);
  if (current.deletedAt) return failWith("not_found", DELETED, { current: publicSession(current) });
  if (Number(args.expectedVersion) !== current.version) return failWith("conflict", CONFLICT, { current: publicSession(current) });
  const next: Record<string, unknown> = { ...sessionToFields(current) };
  let changed = false;
  for (const key of SESSION_TEXT_KEYS) {
    if (args[key] === undefined) continue;
    next[key] = text(args[key]);
    changed = true;
  }
  if (!changed) return fail("invalid", NOTHING);
  // Senza corso del catalogo non è più l'appello ufficiale di BARB.
  if (!text(next.courseId) && next.source === "barb") {
    next.source = "member";
    next.barbSessionId = null;
  }
  const cleaned = cleanSessionFields(next);
  if (!cleaned.ok) return failWith("invalid", cleaned.message, { field: cleaned.field });
  const twin = findTwin(groups().sessions, current.groupId, cleaned.value, current.id);
  if (twin) return failWith("invalid", DUPLICATE, { existing: publicSession(twin) });
  return groupWrite(
    (writer) => writer.saveSession(current.groupId, current.id, current.version, cleaned.value),
    publicSession,
    (row) => {
      useGroupExamStore.getState().applySession(row);
      return { updated: true, session: publicSession(row) };
    }
  );
};

export const deleteGroupExamSession = async (args: Args): Promise<AgentCallResult> => {
  const blocked = groupExamsReady();
  if (blocked) return blocked;
  const current = groups().sessions.find((item) => item.id === text(args.id));
  if (!current) return fail("not_found", NO_SESSION);
  if (current.deletedAt) return ok({ deleted: true, alreadyDeleted: true, session: publicSession(current) });
  if (args.expectedVersion !== undefined && Number(args.expectedVersion) !== current.version) {
    return failWith("conflict", CONFLICT, { current: publicSession(current) });
  }
  return groupWrite(
    (writer) => writer.deleteSession(current.id, current.version),
    publicSession,
    (row) => {
      useGroupExamStore.getState().applySession(row);
      return { deleted: true, session: publicSession(row) };
    }
  );
};

export const listGroupHistory = async (args: Args): Promise<AgentCallResult> => {
  const blocked = groupExamsReady();
  if (blocked) return blocked;
  const groupId = text(args.groupId);
  if (!groups().groups.some((group) => group.id === groupId)) return fail("not_found", NO_GROUP);
  const limit = Number(args.limit ?? 20);
  const beforeId = optional(args.beforeId) ? Number(args.beforeId) : undefined;
  if (beforeId !== undefined && !Number.isSafeInteger(beforeId)) return fail("invalid", BAD_HISTORY_ID);
  const recordKind = optional(args.recordKind) as GroupRecordKind | undefined;
  const recordId = optional(args.recordId);
  let entries: GroupHistoryEntry[] | null;
  try {
    const writer = await groupExamWriterLoader.load();
    entries = await writer.listHistory({
      groupId,
      limit,
      ...(recordKind ? { recordKind } : {}),
      ...(recordId ? { recordId } : {}),
      ...(beforeId !== undefined ? { beforeId } : {})
    });
  } catch (error) {
    return thrown(error);
  }
  if (!entries) return fail("not_connected", GROUP_EXAM_TEXT.offline);
  const items = entries.map(publicHistory);
  const more = items.length === limit;
  return ok({ groupId, count: items.length, has_more: more, ...(more ? { next_beforeId: items[items.length - 1].historyId } : {}), items });
};

export const restoreGroupChange = async (args: Args): Promise<AgentCallResult> => {
  const blocked = groupExamsReady();
  if (blocked) return blocked;
  const historyId = Number(text(args.historyId));
  if (!Number.isSafeInteger(historyId) || historyId < 1) return fail("invalid", BAD_HISTORY_ID);
  return groupWrite(
    (writer) => writer.restore(historyId, Number(args.expectedVersion)),
    publicRecord,
    (row) => {
      if (isSession(row)) useGroupExamStore.getState().applySession(row);
      else useGroupExamStore.getState().applyOverride(row);
      return { restored: publicRecord(row) };
    }
  );
};

const snapshotView = (plan: ExamPlan) => ({
  id: plan.sessionId,
  groupId: plan.snapshot.groupId,
  groupName: agentMemberText(plan.snapshot.groupName),
  courseName: agentMemberText(plan.snapshot.courseName),
  date: plan.snapshot.date,
  kind: plan.snapshot.kind,
  kindLabel: GROUP_EXAM_KIND_LABEL[plan.snapshot.kind],
  time: plan.snapshot.time,
  room: agentMemberText(plan.snapshot.room),
  registrationCloses: plan.snapshot.registrationCloses,
  version: plan.snapshot.version,
  stale: true
});

const publicPlan = (plan: ExamPlan, session: GroupExamSession | undefined) => ({
  sessionId: plan.sessionId,
  chosen: plan.selected,
  status: plan.status,
  statusLabel: EXAM_PLAN_STATUS_LABEL[plan.status],
  notes: plan.notes,
  reminders: plan.reminders,
  remindRegistration: plan.remindRegistration,
  ...(plan.subjectId ? { subjectId: plan.subjectId } : {}),
  ...(plan.examId ? { examId: plan.examId } : {}),
  ...(plan.linkedEventId ? { linkedEventId: plan.linkedEventId } : {}),
  dismissedMatches: plan.dismissedMatches,
  session: session ? publicSession(session) : snapshotView(plan),
  changes: planChanges(plan, session).map((line) => agentMemberText(line))
});

const LINKS = {
  subjectId: { missing: "Materia non trovata.", exists: (id: string) => state().subjects.some((item) => item.id === id) },
  examId: { missing: "Esame non trovato.", exists: (id: string) => state().exams.some((item) => item.id === id) },
  linkedEventId: { missing: "Evento non trovato: usa un id di studyos_list_events.", exists: (id: string) => state().events.some((item) => item.id === id) }
} as const;

export const planExamTool = async (args: Args): Promise<AgentCallResult> => {
  const sessionId = text(args.sessionId);
  const session = groups().sessions.find((item) => item.id === sessionId);
  const existing = state().examPlans.find((plan) => plan.sessionId === sessionId);
  if (!session && !existing) return groupExamsReady() ?? fail("not_found", NO_SESSION);
  if (args.chosen === true && !session) return fail("not_connected", NOT_READ);
  if (args.chosen === true && session?.deletedAt) return fail("invalid", "L'appello è stato eliminato nel gruppo: non si può scegliere.");
  const patch: ExamPlanPatch = {};
  if (typeof args.chosen === "boolean") patch.selected = args.chosen;
  if (args.status !== undefined) patch.status = args.status as ExamPlanStatus;
  if (args.notes !== undefined) patch.notes = text(args.notes);
  if (args.reminders !== undefined) patch.reminders = sanitizeReminders(args.reminders);
  if (typeof args.remindRegistration === "boolean") patch.remindRegistration = args.remindRegistration;
  for (const key of ["subjectId", "examId", "linkedEventId"] as const) {
    if (args[key] === undefined) continue;
    const id = text(args[key]);
    if (id && !LINKS[key].exists(id)) return fail("not_found", LINKS[key].missing);
    patch[key] = id || null;
  }
  if (args.acknowledgeChanges === true) patch.acknowledge = true;
  if (optional(args.dismissMatch)) patch.dismissMatch = text(args.dismissMatch);
  if (!Object.keys(patch).length) return fail("invalid", NOTHING);
  if (patch.selected === true && session && patch.subjectId === undefined && !existing?.subjectId) {
    const subject = subjectFor(session);
    if (subject) patch.subjectId = subject.id;
  }
  const plan = await state().planExam(sessionId, patch, session, session ? groupNameOf(session.groupId) : undefined);
  if (!plan) return fail("not_found", NO_SESSION);
  return ok({ plan: publicPlan(plan, session) });
};

export const listExamPlan = (args: Args): AgentCallResult => {
  const sessions = new Map(groups().sessions.map((session) => [session.id, session]));
  const from = optional(args.from);
  const to = optional(args.to);
  const rows = state()
    .examPlans.filter((plan) => !plan.archived && (plan.selected || args.includeNotChosen === true))
    .map((plan) => {
      const session = sessions.get(plan.sessionId);
      return { plan, session, date: session?.date ?? plan.snapshot.date };
    })
    .filter((row) => (!from || row.date >= from) && (!to || row.date <= to))
    .sort((a, b) => a.date.localeCompare(b.date) || a.plan.sessionId.localeCompare(b.plan.sessionId));
  const listed = page(rows, args);
  return ok({
    groupExamsRead: groups().ready && groups().available,
    ...listed,
    items: listed.items.map((row) => publicPlan(row.plan, row.session))
  });
};
