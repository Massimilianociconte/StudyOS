// Strumenti personali in più: eliminare una materia, etichette, promemoria autonomi e controllo di
// coerenza (spec §9–10). Dati personali dallo store; appelli dei gruppi dallo store in memoria.
import { addDays } from "date-fns";
import { contactTargetId, scheduleRuleTargetId } from "../lib/catalogOverrides";
import { checkConsistency, type ConsistencyInput, type ConsistencyIssue, type IssueSeverity } from "../lib/examConsistency";
import { normalizeCourseName } from "../lib/groupExams";
import { tagSummary, type TaggableType } from "../lib/itemTags";
import { linkedCounts } from "../lib/subjectLinks";
import { groupNamesOf, useGroupExamStore } from "../store/useGroupExamStore";
import type { Reminder } from "../types";
import { agentMemberText } from "./project";
import { CLOUD_UNAVAILABLE } from "./catalog";
import { fail, instant, isRemoteRuntime, ok, optional, page, state, text, type Args } from "./toolkit";
import type { AgentCallResult } from "./types";

const NOTHING = "Niente da cambiare: indica almeno un campo.";
const NO_REMINDER = "Promemoria non trovato: usa un id di studyos_list_reminders.";

export const deleteSubjectTool = async (args: Args): Promise<AgentCallResult> => {
  const id = text(args.id);
  const subject = state().subjects.find((item) => item.id === id);
  if (!subject) return fail("not_found", "Materia non trovata.");
  const counts = linkedCounts(state(), id);
  await state().deleteSubject(id);
  return ok({
    id,
    deleted: true,
    name: subject.name,
    removed: { exams: counts.exams, topics: counts.topics },
    unlinked: { tasks: counts.tasks, events: counts.events, sessions: counts.sessions, materials: counts.materials, notes: counts.notes, reminders: counts.reminders, plans: counts.plans }
  });
};

const taggable = (type: TaggableType): ReadonlyArray<{ id: string }> => {
  const current = state();
  return type === "task" ? current.tasks : type === "material" ? current.attachments : type === "note" ? current.notes : current.events;
};

export const listTags = (args: Args): AgentCallResult => {
  const current = state();
  const query = text(args.query).trim().toLocaleLowerCase("it");
  const items = tagSummary({ task: current.tasks, material: current.attachments, note: current.notes, event: current.events }).filter(
    (tag) => !query || tag.label.toLocaleLowerCase("it").includes(query)
  );
  return ok(page(items, args));
};

const strings = (value: unknown) => (Array.isArray(value) ? value.map(text).filter(Boolean) : []);

export const tagItems = async (args: Args): Promise<AgentCallResult> => {
  const type = text(args.type) as TaggableType;
  const ids = [...new Set(strings(args.ids))];
  const add = strings(args.add);
  const remove = strings(args.remove);
  if (!add.length && !remove.length) return fail("invalid", "Indica add o remove.");
  const known = new Set(taggable(type).map((item) => item.id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length) return { ok: false, code: "not_found", error: `Elementi non trovati: ${missing.slice(0, 5).join(", ")}.`, data: { missing } };
  const changed = await state().retagItems(type, ids, add, remove);
  return ok({ type, changed, unchanged: ids.length - changed });
};

const publicReminder = (item: Reminder) => ({
  id: item.id,
  title: item.title,
  remindAt: item.remindAt,
  done: item.done,
  ...(item.linkedEntityType && item.linkedEntityId ? { linkedType: item.linkedEntityType, linkedId: item.linkedEntityId } : {})
});

export const listReminders = (args: Args): AgentCallResult => {
  const from = optional(args.from) ? instant(args.from) : null;
  const to = optional(args.to) ? instant(args.to) : null;
  const end = to ? addDays(to, 1).getTime() : null;
  const items = state()
    .reminders.filter((item) => !item.archived && (args.includeDone === true || !item.done) && Number.isFinite(Date.parse(item.remindAt)))
    .filter((item) => {
      const at = Date.parse(item.remindAt);
      return (!from || at >= from.getTime()) && (end === null || at < end);
    })
    .sort((a, b) => Date.parse(a.remindAt) - Date.parse(b.remindAt));
  return ok(page(items.map(publicReminder), args));
};

type LinkableType = "subject" | "exam" | "calendarEvent" | "task" | "note";

const linkExists = (type: LinkableType, id: string) => {
  const current = state();
  const list: ReadonlyArray<{ id: string }> =
    type === "subject" ? current.subjects : type === "exam" ? current.exams : type === "calendarEvent" ? current.events : type === "task" ? current.tasks : current.notes;
  return list.some((item) => item.id === id);
};

export const createReminderTool = async (args: Args): Promise<AgentCallResult> => {
  const title = text(args.title).trim();
  if (!title) return fail("invalid", "title è obbligatorio.");
  const at = instant(args.remindAt);
  if (!at) return fail("invalid", "remindAt deve essere una data ISO 8601.");
  const linkedType = optional(args.linkedType) as LinkableType | undefined;
  const linkedId = optional(args.linkedId);
  if (Boolean(linkedType) !== Boolean(linkedId)) return fail("invalid", "linkedType e linkedId vanno indicati insieme.");
  if (linkedType && linkedId && !linkExists(linkedType, linkedId)) return fail("not_found", "Elemento da collegare non trovato.");
  const created = await state().addReminder({
    title: title.slice(0, 200),
    remindAt: at.toISOString(),
    ...(linkedType && linkedId ? { linkedEntityType: linkedType, linkedEntityId: linkedId } : {})
  });
  return ok({ reminder: publicReminder(created) });
};

export const updateReminderTool = async (args: Args): Promise<AgentCallResult> => {
  const current = state().reminders.find((item) => item.id === text(args.id));
  if (!current) return fail("not_found", NO_REMINDER);
  const patch: Partial<Pick<Reminder, "title" | "remindAt" | "done">> = {};
  if (args.title !== undefined) {
    const title = text(args.title).trim();
    if (!title) return fail("invalid", "title non può essere vuoto.");
    patch.title = title.slice(0, 200);
  }
  if (args.remindAt !== undefined) {
    const at = instant(args.remindAt);
    if (!at) return fail("invalid", "remindAt deve essere una data ISO 8601.");
    patch.remindAt = at.toISOString();
  }
  if (typeof args.done === "boolean") patch.done = args.done;
  if (!Object.keys(patch).length) return fail("invalid", NOTHING);
  await state().updateReminder(current.id, patch);
  return ok({ reminder: publicReminder({ ...current, ...patch }) });
};

export const deleteReminderTool = async (args: Args): Promise<AgentCallResult> => {
  const current = state().reminders.find((item) => item.id === text(args.id));
  if (!current) return fail("not_found", NO_REMINDER);
  await state().deleteReminder(current.id);
  return ok({ id: current.id, deleted: true });
};

const SEVERITY_RANK: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
/** Problemi che riguardano solo i dati del gruppo (scope=groups); gli altri sono personali. */
const GROUP_CODES = new Set(["duplicate_session", "possible_duplicate", "same_session_other_group", "override_target_missing"]);

/** Id del catalogo BARB per controllare le correzioni; null se non si carica (le correzioni non si controllano). */
const catalogIds = async (): Promise<ConsistencyInput["catalog"]> => {
  try {
    const { BARB_DATASET } = await import("../data/university/barb.dataset");
    return {
      teacher: new Set(BARB_DATASET.teachers.map((item) => item.id)),
      course: new Set(BARB_DATASET.courses.map((item) => item.id)),
      schedule_rule: new Set(BARB_DATASET.courses.flatMap((course) => course.schedule.map((rule) => scheduleRuleTargetId(course.id, rule.id)))),
      contact: new Set(BARB_DATASET.contacts.map((contact) => contactTargetId(contact.label)))
    };
  } catch {
    return null;
  }
};

const FIX_IN_APP = "Questa correzione si fa nell'app StudyOS: il connettore remoto non ha lo strumento.";

/**
 * Chiave del corso senza il testo grezzo: per `nome:` la stessa regola del server sullo snapshot
 * (nome oscurato, poi normalizzato). Stabile tra una chiamata e l'altra.
 */
const safeCourseKey = (key: string, sessions: ReadonlyArray<{ courseKey: string; courseName: string }>) => {
  if (!key.startsWith("nome:")) return key;
  const hit = sessions.find((session) => session.courseKey === key);
  return hit ? `nome:${normalizeCourseName(agentMemberText(hit.courseName))}` : "nome:";
};

/**
 * Suffisso che distingue due chiavi che oscurate sono uguali: l'id (già pubblico) del primo appello con quella
 * chiave grezza. Mai derivato dal nome, così non permette di verificare un nome indovinato.
 */
const keySuffix = (raw: string, sessions: ReadonlyArray<{ id: string; courseKey: string }>, position: number) => {
  const ids = sessions.filter((session) => session.courseKey === raw).map((session) => session.id).sort();
  return ids[0] ?? String(position + 1);
};

/** Chiave sicura per ogni chiave grezza degli esiti; con due chiavi che coincidono si aggiunge un suffisso. */
const safeKeyMap = (issues: readonly ConsistencyIssue[], sessions: ReadonlyArray<{ id: string; courseKey: string; courseName: string }>) => {
  const rawKeys = [...new Set(issues.flatMap((issue) => (issue.refs.courseKey ? [issue.refs.courseKey] : [])))];
  const byText = new Map<string, string[]>();
  for (const raw of rawKeys) {
    const safe = safeCourseKey(raw, sessions);
    byText.set(safe, [...(byText.get(safe) ?? []), raw]);
  }
  const map = new Map<string, string>();
  for (const [safe, raws] of byText) {
    raws.forEach((raw, position) => map.set(raw, raws.length > 1 ? `${safe}~${keySuffix(raw, sessions, position)}` : safe));
  }
  return map;
};

const publicIssue = (issue: ConsistencyIssue, keys: ReadonlyMap<string, string>) => {
  const { fix, ...raw } = issue;
  const rawKey = raw.refs.courseKey;
  const safeKey = rawKey ? keys.get(rawKey) : undefined;
  const rest = rawKey && safeKey !== undefined ? { ...raw, id: raw.id.split(rawKey).join(safeKey), refs: { ...raw.refs, courseKey: safeKey } } : raw;
  const base = { ...rest, title: agentMemberText(issue.title), detail: agentMemberText(issue.detail) };
  if (!fix) return base;
  // Sul connettore remoto i suggerimenti con strumenti che non ci sono vanno fatti nell'app.
  return isRemoteRuntime() && CLOUD_UNAVAILABLE.has(fix.tool) ? { ...base, fixInApp: FIX_IN_APP } : { ...base, fix };
};

export const checkConsistencyTool = async (args: Args): Promise<AgentCallResult> => {
  const current = state();
  const groups = useGroupExamStore.getState();
  const ids = (items: ReadonlyArray<{ id: string }>) => new Set(items.map((item) => item.id));
  const read = groups.ready && groups.available && Boolean(groups.viewerId);
  const input = {
    now: new Date(),
    subjects: current.subjects,
    exams: current.exams,
    events: current.events,
    plans: current.examPlans,
    links: { reminder: current.reminders, note: current.notes, attachment: current.attachments },
    linkTargets: {
      subject: ids(current.subjects),
      exam: ids(current.exams),
      calendarEvent: ids(current.events),
      task: ids(current.tasks),
      studyTopic: ids(current.topics),
      goal: ids(current.goals),
      studySession: ids(current.sessions),
      note: ids(current.notes),
      attachment: ids(current.attachments)
    },
    groupExams: { ready: read, groupIds: groups.groups.map((group) => group.id), groupNames: groupNamesOf(groups.groups), sessions: groups.sessions, overrides: groups.overrides },
    catalog: read && groups.overrides.length ? await catalogIds() : null
  } satisfies ConsistencyInput;
  const report = checkConsistency(input);
  // Corrispondenze con i dati personali (doppioni, esame superato): sul nome oscurato, così un agente non
  // conferma un nome grezzo. duplicate_session resta sui nomi veri (due corsi diversi non si fondono).
  const redacted = groups.sessions.map((session) =>
    agentMemberText(session.courseName) !== session.courseName ? { ...session, courseName: agentMemberText(session.courseName) } : session
  );
  const matchedByName = new Set(["unlinked_personal_duplicate", "passed_but_selected_future"]);
  const rawIssues = report.issues;
  const reportIssues = redacted.some((session, index) => session !== groups.sessions[index])
    ? [...rawIssues.filter((issue) => !matchedByName.has(issue.code)), ...checkConsistency({ ...input, groupExams: { ...input.groupExams, sessions: redacted } }).issues.filter((issue) => matchedByName.has(issue.code))].sort(
        (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.code.localeCompare(b.code) || a.id.localeCompare(b.id)
      )
    : rawIssues;
  const scope = text(args.scope) || "all";
  const min = SEVERITY_RANK[(text(args.minSeverity) || "info") as IssueSeverity] ?? 2;
  const issues = reportIssues.filter((issue) => SEVERITY_RANK[issue.severity] <= min && (scope === "all" || (scope === "groups") === GROUP_CODES.has(issue.code)));
  const keys = safeKeyMap(issues, groups.sessions);
  return ok({
    checkedAt: report.checkedAt,
    groupsChecked: report.groupsChecked,
    groupExamsChecked: report.groupExamsChecked,
    counts: { error: issues.filter((i) => i.severity === "error").length, warning: issues.filter((i) => i.severity === "warning").length, info: issues.filter((i) => i.severity === "info").length },
    ...page(issues.map((issue) => publicIssue(issue, keys)), args)
  });
};
