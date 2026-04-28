import type { StudySnapshot } from "../types";

const legacySubjectNames = new Set(["Analisi II", "Sistemi Operativi", "Economia", "Progetto tesi"]);
const legacyTaskTitles = new Set([
  "Correggere simulazione Economia",
  "Scheda serie numeriche",
  "Pulire appunti su scheduling",
  "Bibliografia tesi: 6 fonti",
  "Test QA StudyOS"
]);
const legacyEventTitles = new Set([
  "Deep focus Analisi II",
  "Lezione Sistemi Operativi",
  "Consegna outline tesi",
  "Ripasso Economia"
]);
const legacySessionTitles = new Set(["Serie numeriche", "Memoria virtuale"]);
const legacyTopicTitles = new Set(["Criteri di convergenza", "Scheduling CPU"]);
const legacyGoalTitles = new Set(["18 ore di studio questa settimana", "Economia pronta per orale"]);
const legacyTagLabels = new Set(["urgente", "orale", "scritto", "difficile", "da-rivedere", "memoria", "laboratorio"]);

export const stripLegacyMockData = (snapshot: StudySnapshot) => {
  const removedSubjectIds = new Set(
    snapshot.subjects.filter((subject) => legacySubjectNames.has(subject.name)).map((subject) => subject.id)
  );

  const next: StudySnapshot = {
    ...snapshot,
    subjects: snapshot.subjects.filter((subject) => !removedSubjectIds.has(subject.id)),
    exams: snapshot.exams.filter((exam) => !removedSubjectIds.has(exam.subjectId)),
    events: snapshot.events.filter(
      (event) => !legacyEventTitles.has(event.title) && !removedSubjectIds.has(event.subjectId ?? "")
    ),
    tasks: snapshot.tasks.filter(
      (task) => !legacyTaskTitles.has(task.title) && !removedSubjectIds.has(task.subjectId ?? "")
    ),
    sessions: snapshot.sessions.filter(
      (session) => !legacySessionTitles.has(session.title) && !removedSubjectIds.has(session.subjectId ?? "")
    ),
    topics: snapshot.topics.filter(
      (topic) => !legacyTopicTitles.has(topic.title) && !removedSubjectIds.has(topic.subjectId)
    ),
    goals: snapshot.goals.filter((goal) => !legacyGoalTitles.has(goal.title)),
    tags: snapshot.tags.filter((tag) => !legacyTagLabels.has(tag.label)),
    widgets: []
  };

  const changed = JSON.stringify(snapshot) !== JSON.stringify(next);
  return { snapshot: next, changed };
};
