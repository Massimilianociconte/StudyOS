// Piano d'esame personale sopra gli appelli del gruppo: scelto sì/no, stato, note, promemoria e
// collegamenti ai propri dati. È un dato personale (collezione `examPlans`, sync personale): il gruppo
// non lo vede. Il voto resta sull'esame personale collegato (libretto), non qui.
import type { EventReminder, ExamPlan, ExamPlanSnapshot, ExamPlanStatus } from "../types";
import type { GroupExamSession } from "./groupExams";
import { GROUP_EXAM_KINDS, courseKeyOf, isDay } from "./groupExams";

export const EXAM_PLAN_STATUSES: readonly ExamPlanStatus[] = ["planned", "registered", "taken", "passed", "failed", "withdrawn", "skipped"];

/** Stati in cui l'appello è ancora davanti (contano per promemoria e controlli). */
export const OPEN_PLAN_STATUSES: ReadonlySet<ExamPlanStatus> = new Set(["planned", "registered"]);

/** Un piano per appello e per persona: id deterministico, così due dispositivi non ne creano due. */
export const examPlanId = (sessionId: string) => `plan_${sessionId}`;

export const planSnapshot = (session: GroupExamSession, groupName: string): ExamPlanSnapshot => ({
  groupId: session.groupId,
  groupName,
  courseKey: session.courseKey,
  courseName: session.courseName,
  date: session.date,
  kind: session.kind,
  time: session.time,
  room: session.room,
  registrationCloses: session.registrationCloses,
  version: session.version
});

export const newExamPlan = (session: GroupExamSession, groupName: string, now: string): ExamPlan => ({
  id: examPlanId(session.id),
  createdAt: now,
  updatedAt: now,
  archived: false,
  tags: [],
  sessionId: session.id,
  selected: false,
  status: "planned",
  notes: "",
  reminders: [],
  remindRegistration: true,
  dismissedMatches: [],
  snapshot: planSnapshot(session, groupName)
});

export interface ExamPlanPatch {
  selected?: boolean;
  status?: ExamPlanStatus;
  notes?: string;
  reminders?: EventReminder[];
  remindRegistration?: boolean;
  /** null = togli il collegamento. */
  subjectId?: string | null;
  examId?: string | null;
  linkedEventId?: string | null;
  /** Ho visto le modifiche dell'appello: la copia salvata si aggiorna. */
  acknowledge?: boolean;
  /** `event:<id>` o `exam:<id>` da non proporre più come doppione. */
  dismissMatch?: string;
}

/**
 * Applica una modifica al piano. La copia (`snapshot`) si aggiorna quando si sceglie l'appello o si
 * conferma di aver visto le modifiche: serve offline e per dire «è cambiato da quando l'hai scelto».
 */
export const applyPlanPatch = (plan: ExamPlan, patch: ExamPlanPatch, session: GroupExamSession | undefined, groupName: string, now: string): ExamPlan => {
  const next: ExamPlan = { ...plan, updatedAt: now };
  if (patch.selected !== undefined) next.selected = patch.selected;
  if (patch.status !== undefined && EXAM_PLAN_STATUSES.includes(patch.status)) next.status = patch.status;
  if (patch.notes !== undefined) next.notes = patch.notes.slice(0, 2000);
  if (patch.reminders !== undefined) next.reminders = patch.reminders.slice(0, 10);
  if (patch.remindRegistration !== undefined) next.remindRegistration = patch.remindRegistration;
  for (const key of ["subjectId", "examId", "linkedEventId"] as const) {
    if (patch[key] === null) delete next[key];
    else if (typeof patch[key] === "string") next[key] = patch[key] as string;
  }
  if (patch.dismissMatch && !next.dismissedMatches.includes(patch.dismissMatch)) {
    next.dismissedMatches = [...next.dismissedMatches, patch.dismissMatch].slice(-50);
  }
  const chosenNow = patch.selected === true && !plan.selected;
  if (session && (chosenNow || patch.acknowledge)) next.snapshot = planSnapshot(session, groupName);
  return next;
};

/** Piano senza nulla di personale: si può togliere (nessuna scelta, note, promemoria o collegamento). */
export const isEmptyPlan = (plan: ExamPlan) =>
  !plan.selected && plan.status === "planned" && !plan.notes && !plan.reminders.length && !plan.subjectId && !plan.examId && !plan.linkedEventId && !plan.dismissedMatches.length;

/** Copia dell'appello letta da fuori: ricostruita campo per campo; null se manca gruppo, corso o giorno valido. */
const normalizeSnapshot = (value: unknown): ExamPlanSnapshot | null => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (item: unknown) => (typeof item === "string" ? item : "");
  const textOrNull = (item: unknown) => (typeof item === "string" && item ? item : null);
  const courseName = text(raw.courseName);
  const groupId = text(raw.groupId);
  if (!groupId || !courseName.trim() || !isDay(raw.date)) return null;
  const version = Number(raw.version);
  return {
    groupId,
    groupName: text(raw.groupName),
    courseKey: text(raw.courseKey) || courseKeyOf(null, courseName),
    courseName,
    date: raw.date,
    kind: GROUP_EXAM_KINDS.includes(raw.kind as ExamPlanSnapshot["kind"]) ? (raw.kind as ExamPlanSnapshot["kind"]) : "appello",
    time: textOrNull(raw.time),
    room: text(raw.room),
    registrationCloses: isDay(raw.registrationCloses) ? raw.registrationCloses : null,
    version: Number.isInteger(version) && version >= 0 ? version : 0
  };
};

/** Il piano letto dal cloud o da un backup: campi mancanti con i valori di default, mai un errore. */
export const normalizeExamPlan = (value: unknown): ExamPlan | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ExamPlan>;
  if (typeof raw.id !== "string" || typeof raw.sessionId !== "string") return null;
  const snapshot = normalizeSnapshot(raw.snapshot);
  if (!snapshot) return null;
  return {
    ...raw,
    id: raw.id,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : "",
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : "",
    archived: raw.archived === true,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [],
    sessionId: raw.sessionId,
    selected: raw.selected === true,
    status: EXAM_PLAN_STATUSES.includes(raw.status as ExamPlanStatus) ? (raw.status as ExamPlanStatus) : "planned",
    notes: typeof raw.notes === "string" ? raw.notes : "",
    reminders: Array.isArray(raw.reminders) ? raw.reminders : [],
    remindRegistration: raw.remindRegistration !== false,
    dismissedMatches: Array.isArray(raw.dismissedMatches) ? raw.dismissedMatches.filter((item): item is string => typeof item === "string") : [],
    snapshot
  };
};

/**
 * Toglie dai piani i collegamenti a materie, esami ed eventi che spariscono (eliminazioni nello store).
 * La scelta resta; i piani non toccati restano gli stessi oggetti (il diff non li riscrive).
 */
export const unlinkPlans = (
  plans: readonly ExamPlan[],
  gone: { subjectIds?: ReadonlySet<string>; examIds?: ReadonlySet<string>; eventIds?: ReadonlySet<string> },
  now: string
): ExamPlan[] =>
  plans.map((plan) => {
    const dropSubject = Boolean(plan.subjectId && gone.subjectIds?.has(plan.subjectId));
    const dropExam = Boolean(plan.examId && gone.examIds?.has(plan.examId));
    const dropEvent = Boolean(plan.linkedEventId && gone.eventIds?.has(plan.linkedEventId));
    if (!dropSubject && !dropExam && !dropEvent) return plan;
    const next: ExamPlan = { ...plan, updatedAt: now };
    if (dropSubject) delete next.subjectId;
    if (dropExam) delete next.examId;
    if (dropEvent) delete next.linkedEventId;
    return next;
  });
