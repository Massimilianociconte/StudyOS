// Regole pure delle schermate degli appelli: chi può eliminare, cosa è cambiato dal mio piano, testi
// composti. Senza React: le usano riquadro, elenchi, agenti e test.
import type { ExamPlan, StudyGroup } from "../types";
import { GROUP_EXAM_FIELD_LABEL, GROUP_EXAM_KIND_LABEL } from "./labels";
import { formatDay, type GroupExamSession, type GroupHistoryEntry } from "./groupExams";

/** Chi l'ha aggiunto, il proprietario o un amministratore del gruppo (come la regola del server). */
export const canDeleteSession = (
  session: Pick<GroupExamSession, "createdBy">,
  viewerId: string | null,
  group: Pick<StudyGroup, "ownerId" | "members"> | undefined
) =>
  Boolean(viewerId) &&
  (session.createdBy === viewerId ||
    group?.ownerId === viewerId ||
    Boolean(group?.members.some((member) => member.userId === viewerId && (member.role === "owner" || member.role === "admin"))));

/** «Data: 12/01/2027 → 14/01/2027» per ogni campo cambiato da quando l'ho scelto (solo se scelto). */
export const planChanges = (
  plan: Pick<ExamPlan, "selected" | "snapshot">,
  session: Pick<GroupExamSession, "courseName" | "date" | "kind" | "time" | "room" | "registrationCloses" | "version" | "deletedAt"> | undefined
): string[] => {
  if (!session || session.deletedAt || !plan.selected || session.version === plan.snapshot.version) return [];
  const before = plan.snapshot;
  const lines: string[] = [];
  const add = (label: string, from: string, to: string) => {
    if (from !== to) lines.push(`${label}: ${from} → ${to}`);
  };
  add(GROUP_EXAM_FIELD_LABEL.course, before.courseName, session.courseName);
  add(GROUP_EXAM_FIELD_LABEL.date, formatDay(before.date), formatDay(session.date));
  add(GROUP_EXAM_FIELD_LABEL.kind, GROUP_EXAM_KIND_LABEL[before.kind], GROUP_EXAM_KIND_LABEL[session.kind]);
  add(GROUP_EXAM_FIELD_LABEL.time, before.time ?? "—", session.time ?? "—");
  add(GROUP_EXAM_FIELD_LABEL.room, before.room || "—", session.room || "—");
  add(GROUP_EXAM_FIELD_LABEL.registrationCloses, formatDay(before.registrationCloses), formatDay(session.registrationCloses));
  return lines;
};

/** «dal 01/12/2026 al 08/01/2027», «fino al …», «dal …» o "". */
export const registrationText = (opens: string | null, closes: string | null) => {
  if (opens && closes) return `dal ${formatDay(opens)} al ${formatDay(closes)}`;
  if (closes) return `fino al ${formatDay(closes)}`;
  if (opens) return `dal ${formatDay(opens)}`;
  return "";
};

/** Ultima eliminazione di ogni appello: la voce da ripristinare in «Eliminati di recente». */
export const lastDeletions = (history: readonly Pick<GroupHistoryEntry, "id" | "recordKind" | "recordId" | "action">[]) => {
  const out = new Map<string, (typeof history)[number]>();
  for (const entry of history) {
    if (entry.action !== "delete" || entry.recordKind !== "exam_session") continue;
    const current = out.get(entry.recordId);
    if (!current || entry.id > current.id) out.set(entry.recordId, entry);
  }
  return out;
};
