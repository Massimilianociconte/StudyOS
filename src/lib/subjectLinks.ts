// Quanto è collegato a una materia: studyos_get_subject lo mostra prima di studyos_delete_subject, che
// elimina esami e argomenti e lascia il resto senza materia (azione deleteSubject dello store).
import type { StudySnapshot } from "../types";

type Collections = Pick<StudySnapshot, "exams" | "topics" | "tasks" | "events" | "sessions" | "attachments" | "notes" | "reminders" | "examPlans">;

export interface LinkedCounts {
  exams: number;
  topics: number;
  tasks: number;
  events: number;
  sessions: number;
  materials: number;
  notes: number;
  reminders: number;
  plans: number;
}

export const linkedCounts = (data: Collections, subjectId: string): LinkedCounts => {
  const examIds = new Set(data.exams.filter((item) => item.subjectId === subjectId).map((item) => item.id));
  const linked = (item: { linkedEntityType?: string; linkedEntityId?: string }) =>
    (item.linkedEntityType === "subject" && item.linkedEntityId === subjectId) || (item.linkedEntityType === "exam" && examIds.has(item.linkedEntityId ?? ""));
  return {
    exams: examIds.size,
    topics: data.topics.filter((item) => item.subjectId === subjectId).length,
    tasks: data.tasks.filter((item) => item.subjectId === subjectId).length,
    events: data.events.filter((item) => item.subjectId === subjectId).length,
    sessions: data.sessions.filter((item) => item.subjectId === subjectId).length,
    materials: data.attachments.filter(linked).length,
    notes: data.notes.filter(linked).length,
    reminders: data.reminders.filter(linked).length,
    plans: data.examPlans.filter((plan) => plan.subjectId === subjectId || examIds.has(plan.examId ?? "")).length
  };
};
