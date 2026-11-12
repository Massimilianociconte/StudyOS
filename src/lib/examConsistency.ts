// Controllo di coerenza tra appelli del gruppo, piano personale e dati personali. Sola lettura,
// deterministico (stessi dati → stesso elenco, stessi id): un agente può eseguirlo spesso e
// confrontare i risultati. Ogni problema può proporre uno strumento MCP per sistemarlo; quelli che
// eliminano o toccano il gruppo chiedono sempre conferma alla persona.
import type { CalendarEvent, Exam, ExamPlan, Subject } from "../types";
import type { CatalogOverride, GroupExamSession } from "./groupExams";
import { describeSessionChanges, formatDay, normalizeCourseName, sessionTitle } from "./groupExams";
import { OPEN_PLAN_STATUSES } from "./examPlans";
import { localDay, personalMatches } from "./groupExamCalendar";
import { GROUP_EXAM_TEXT } from "./labels";
import { CONSISTENCY_TEXT as T } from "./labels/consistency";

export type IssueSeverity = "error" | "warning" | "info";

export interface ConsistencyIssue {
  /** Stabile tra un controllo e l'altro: codice + riferimenti. */
  id: string;
  code: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  refs: Record<string, string>;
  fix?: { tool: string; args: Record<string, unknown>; needsConfirmation: boolean };
}

export interface ConsistencyReport {
  checkedAt: string;
  groupsChecked: number;
  /** false se gli appelli dei gruppi non sono stati letti (offline, tabelle mancanti): solo controlli personali. */
  groupExamsChecked: boolean;
  counts: Record<IssueSeverity, number>;
  issues: ConsistencyIssue[];
}

interface Linked {
  id: string;
  linkedEntityType?: string;
  linkedEntityId?: string;
}

export interface ConsistencyInput {
  now: Date;
  subjects: readonly Subject[];
  exams: readonly Exam[];
  events: readonly CalendarEvent[];
  plans: readonly ExamPlan[];
  links: { reminder: readonly Linked[]; note: readonly Linked[]; attachment: readonly Linked[] };
  /** Id esistenti per tipo di entità (subject, exam, calendarEvent, task, studyTopic, goal, studySession, note, attachment). */
  linkTargets: Readonly<Record<string, ReadonlySet<string>>>;
  groupExams: { ready: boolean; groupIds: readonly string[]; groupNames: ReadonlyMap<string, string>; sessions: readonly GroupExamSession[]; overrides: readonly CatalogOverride[] };
  /** Id del catalogo BARB caricato; null = non controllare le correzioni. */
  catalog: { teacher: ReadonlySet<string>; course: ReadonlySet<string>; schedule_rule: ReadonlySet<string>; contact: ReadonlySet<string> } | null;
}

const SEVERITY_ORDER: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
const DAY_MS = 86_400_000;

const dayNumber = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10))) / DAY_MS;

export const checkConsistency = (input: ConsistencyInput): ConsistencyReport => {
  const issues: ConsistencyIssue[] = [];
  const add = (issue: Omit<ConsistencyIssue, "id">) => {
    const refs = Object.entries(issue.refs).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`);
    issues.push({ id: `${issue.code}:${refs.join(",")}`, ...issue });
  };
  // `toISOString()` ha sempre «.sssZ»: localDay lo legge come istante e dà il giorno LOCALE (non quello UTC).
  const today = localDay(input.now.toISOString()) ?? "";
  const subjectIds = new Set(input.subjects.map((subject) => subject.id));
  const eventById = new Map(input.events.map((event) => [event.id, event]));
  const examById = new Map(input.exams.map((exam) => [exam.id, exam]));
  const { ready, sessions, overrides, groupNames } = input.groupExams;
  const live = sessions.filter((session) => !session.deletedAt);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));
  const planBySession = new Map(input.plans.map((plan) => [plan.sessionId, plan]));
  const titleOf = (session: GroupExamSession) => sessionTitle(session);

  // --- Dati personali (sempre) -------------------------------------------------------------
  for (const exam of input.exams) {
    if (!subjectIds.has(exam.subjectId)) {
      add({ code: "orphan_exam_subject", severity: "warning", title: T.orphanExamSubject, detail: T.orphanExamSubjectDetail(formatDay(localDay(exam.date))), refs: { examId: exam.id } });
    }
  }
  for (const [kind, list] of Object.entries(input.links) as Array<[keyof ConsistencyInput["links"], readonly Linked[]]>) {
    for (const item of list) {
      if (!item.linkedEntityType || !item.linkedEntityId) continue;
      const targets = input.linkTargets[item.linkedEntityType];
      if (targets && !targets.has(item.linkedEntityId)) {
        add({ code: "orphan_link", severity: "info", title: T.orphanLink(T.linkKind[kind]), detail: T.orphanLinkDetail, refs: { [`${kind}Id`]: item.id, target: `${item.linkedEntityType}:${item.linkedEntityId}` } });
      }
    }
  }
  for (const plan of input.plans) {
    const title = sessionTitle({ kind: plan.snapshot.kind, courseName: plan.snapshot.courseName, label: "" });
    if (plan.subjectId && !subjectIds.has(plan.subjectId)) {
      add({ code: "orphan_plan_subject", severity: "info", title: T.orphanPlanSubject(title), detail: T.orphanLinkDetail, refs: { sessionId: plan.sessionId }, fix: { tool: "studyos_plan_exam", args: { sessionId: plan.sessionId, subjectId: "" }, needsConfirmation: false } });
    }
    if (plan.examId && !examById.has(plan.examId)) {
      add({ code: "orphan_plan_exam", severity: "warning", title: T.orphanPlanExam(title), detail: T.orphanLinkDetail, refs: { sessionId: plan.sessionId }, fix: { tool: "studyos_plan_exam", args: { sessionId: plan.sessionId, examId: "" }, needsConfirmation: false } });
    }
    if (plan.linkedEventId && !eventById.has(plan.linkedEventId)) {
      add({ code: "linked_event_missing", severity: "warning", title: T.linkedEventMissing(title), detail: T.linkedEventMissingDetail, refs: { sessionId: plan.sessionId }, fix: { tool: "studyos_plan_exam", args: { sessionId: plan.sessionId, linkedEventId: "" }, needsConfirmation: false } });
    }
  }

  // --- Appelli dei gruppi (solo se letti) ----------------------------------------------------
  if (ready) {
    // Doppioni sicuri (stesso giorno, tipo e corso nello stesso gruppo) e probabili (un giorno di distanza).
    for (let i = 0; i < live.length; i += 1) {
      for (let j = i + 1; j < live.length; j += 1) {
        const [a, b] = [live[i], live[j]].sort((x, y) => x.createdAt.localeCompare(y.createdAt) || x.id.localeCompare(y.id));
        const sameCourse = a.courseKey === b.courseKey || normalizeCourseName(a.courseName) === normalizeCourseName(b.courseName);
        if (!sameCourse || a.kind !== b.kind) continue;
        if (a.groupId === b.groupId && a.date === b.date) {
          add({ code: "duplicate_session", severity: "error", title: T.duplicateSession(titleOf(a), formatDay(a.date)), detail: T.duplicateSessionDetail, refs: { keep: a.id, remove: b.id }, fix: { tool: "studyos_delete_group_exam_session", args: { id: b.id, expectedVersion: b.version, confirm: true }, needsConfirmation: true } });
        } else if (a.groupId === b.groupId && Math.abs(dayNumber(a.date) - dayNumber(b.date)) === 1) {
          add({ code: "possible_duplicate", severity: "warning", title: T.possibleDuplicate(titleOf(a)), detail: T.possibleDuplicateDetail(formatDay(a.date), formatDay(b.date)), refs: { a: a.id, b: b.id } });
        } else if (a.groupId !== b.groupId && a.date === b.date) {
          const names = [groupNames.get(a.groupId) ?? GROUP_EXAM_TEXT.someGroup, groupNames.get(b.groupId) ?? GROUP_EXAM_TEXT.someGroup].join(", ");
          add({ code: "same_session_other_group", severity: "info", title: T.otherGroup(titleOf(a)), detail: T.otherGroupDetail(names), refs: { a: a.id, b: b.id } });
        }
      }
    }

    const selectedByCourse = new Map<string, GroupExamSession[]>();
    for (const plan of input.plans) {
      const session = sessionById.get(plan.sessionId);
      const planTitle = session ? titleOf(session) : sessionTitle({ kind: plan.snapshot.kind, courseName: plan.snapshot.courseName, label: "" });
      if (!session) {
        if (plan.selected) {
          add({ code: "orphan_plan", severity: "warning", title: T.orphanPlan(planTitle), detail: T.orphanPlanDetail, refs: { sessionId: plan.sessionId }, fix: { tool: "studyos_plan_exam", args: { sessionId: plan.sessionId, chosen: false }, needsConfirmation: false } });
        }
        continue;
      }
      if (!plan.selected) continue;
      if (session.deletedAt) {
        add({ code: "selected_deleted", severity: "warning", title: T.selectedDeleted(planTitle), detail: T.selectedDeletedDetail(session.deletedByName ?? GROUP_EXAM_TEXT.someMember), refs: { sessionId: session.id }, fix: { tool: "studyos_plan_exam", args: { sessionId: session.id, chosen: false }, needsConfirmation: false } });
        continue;
      }
      if (session.version > plan.snapshot.version) {
        const before = { courseId: null, courseName: plan.snapshot.courseName, date: plan.snapshot.date, kind: plan.snapshot.kind, label: "", time: plan.snapshot.time, room: plan.snapshot.room, notes: "", registrationOpens: null, registrationCloses: plan.snapshot.registrationCloses, barbSessionId: null, source: "member" as const };
        const after = { ...before, courseName: session.courseName, date: session.date, kind: session.kind, time: session.time, room: session.room, registrationCloses: session.registrationCloses };
        const changes = describeSessionChanges(before, after);
        if (changes.length) {
          add({ code: "selected_changed", severity: "info", title: T.selectedChanged(planTitle), detail: T.selectedChangedDetail(changes.join("; ")), refs: { sessionId: session.id, version: String(session.version) }, fix: { tool: "studyos_plan_exam", args: { sessionId: session.id, acknowledgeChanges: true }, needsConfirmation: false } });
        }
      }
      if (plan.examId) {
        const exam = examById.get(plan.examId);
        const examDay = exam ? localDay(exam.date) : null;
        if (exam && examDay !== session.date) {
          const subject = input.subjects.find((item) => item.id === exam.subjectId);
          add({ code: "exam_date_mismatch", severity: "warning", title: T.examDateMismatch(subject?.name ?? session.courseName), detail: T.examDateMismatchDetail(formatDay(examDay), formatDay(session.date)), refs: { examId: exam.id, sessionId: session.id } });
        }
      }
      if (plan.linkedEventId) {
        const event = eventById.get(plan.linkedEventId);
        const eventDay = event ? localDay(event.start) : null;
        if (event && eventDay !== session.date) {
          add({ code: "linked_event_mismatch", severity: "warning", title: T.linkedEventMismatch(planTitle), detail: T.linkedEventMismatchDetail(formatDay(eventDay), formatDay(session.date)), refs: { eventId: event.id, sessionId: session.id } });
        }
      }
      if (OPEN_PLAN_STATUSES.has(plan.status) && session.date >= today) {
        const passed = input.exams.some((exam) => (exam.grade !== undefined || exam.passFail === true) && input.subjects.some((subject) => subject.id === exam.subjectId && (plan.subjectId ? subject.id === plan.subjectId : normalizeCourseName(subject.name) === normalizeCourseName(session.courseName))));
        if (passed) {
          add({ code: "passed_but_selected_future", severity: "info", title: T.passedButSelected(planTitle), detail: T.passedButSelectedDetail, refs: { sessionId: session.id }, fix: { tool: "studyos_plan_exam", args: { sessionId: session.id, chosen: false }, needsConfirmation: false } });
        }
        const list = selectedByCourse.get(session.courseKey) ?? [];
        list.push(session);
        selectedByCourse.set(session.courseKey, list);
      }
      if (plan.status === "planned" && session.registrationCloses && session.registrationCloses >= today && dayNumber(session.registrationCloses) - dayNumber(today) <= 3) {
        add({ code: "registration_closing", severity: "warning", title: T.registrationClosing(planTitle, formatDay(session.registrationCloses)), detail: T.registrationClosingDetail, refs: { sessionId: session.id } });
      }
    }
    for (const [courseKey, list] of selectedByCourse) {
      if (list.length < 2) continue;
      const days = [...list].sort((a, b) => a.date.localeCompare(b.date)).map((item) => formatDay(item.date)).join(", ");
      add({ code: "two_selected_same_course", severity: "info", title: T.twoSelected(list[0].courseName), detail: T.twoSelectedDetail(days), refs: { courseKey } });
    }

    // Miei dati che sembrano lo stesso appello e non sono collegati (si propone, mai si unisce da solo).
    for (const session of live) {
      if (session.date < today) continue;
      const matches = personalMatches(session, { events: input.events, exams: input.exams, subjects: input.subjects }, planBySession.get(session.id));
      if (!matches.length) continue;
      const what = matches.map((match) => (match.type === "event" ? GROUP_EXAM_TEXT.matchEvent(match.title) : GROUP_EXAM_TEXT.matchExam(match.title))).join(", ");
      const first = matches[0];
      add({
        code: "unlinked_personal_duplicate",
        severity: "info",
        title: T.unlinkedDuplicate(titleOf(session)),
        detail: T.unlinkedDuplicateDetail(what),
        refs: { sessionId: session.id, match: first.key },
        fix: { tool: "studyos_plan_exam", args: { sessionId: session.id, chosen: true, ...(first.type === "event" ? { linkedEventId: first.id } : { examId: first.id }) }, needsConfirmation: false }
      });
    }

    if (input.catalog) {
      for (const override of overrides) {
        if (override.deletedAt || override.targetId.startsWith("nuovo:")) continue;
        const known = input.catalog[override.targetKind];
        if (!known.has(override.targetId)) {
          add({ code: "override_target_missing", severity: "info", title: T.overrideMissing(override.targetLabel || GROUP_EXAM_TEXT.someItem), detail: T.overrideMissingDetail, refs: { overrideId: override.id }, fix: { tool: "studyos_delete_catalog_override", args: { id: override.id, expectedVersion: override.version, confirm: true }, needsConfirmation: true } });
        }
      }
    }
  }

  issues.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.code.localeCompare(b.code) || a.id.localeCompare(b.id));
  const counts: Record<IssueSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const issue of issues) counts[issue.severity] += 1;
  return { checkedAt: input.now.toISOString(), groupsChecked: ready ? input.groupExams.groupIds.length : 0, groupExamsChecked: ready, counts, issues };
};
