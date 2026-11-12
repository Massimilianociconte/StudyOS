// Piano d'esame personale sopra gli appelli del gruppo: scelto sì/no, stato, note, promemoria e
// collegamenti ai propri dati. È un dato personale (collezione `examPlans`, sync personale): il gruppo
// non lo vede. Il voto resta sull'esame personale collegato (libretto), non qui.
import type { EventReminder, ExamPlan, ExamPlanSnapshot, ExamPlanStatus } from "../types";
import type { GroupExamSession } from "./groupExams";

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

/** Il piano letto dal cloud o da un backup: campi mancanti con i valori di default, mai un errore. */
export const normalizeExamPlan = (value: unknown): ExamPlan | null => {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<ExamPlan>;
  if (typeof raw.id !== "string" || typeof raw.sessionId !== "string" || !raw.snapshot || typeof raw.snapshot !== "object") return null;
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
    snapshot: raw.snapshot as ExamPlanSnapshot
  };
};
