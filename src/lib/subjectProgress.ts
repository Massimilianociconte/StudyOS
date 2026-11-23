// Progresso di una materia (la barra della scheda in Materie) e regola «al 100% è completata».
// Logica pura (node --test). La usano la scheda, lo store (quindi l'app, gli agenti nel browser e il
// connettore remoto, che eseguono le stesse azioni) e le risposte del connettore.
//
// Nessuno stato nuovo nei dati: «voto da registrare» è una materia «Completata» senza una riga nel
// libretto (voto o idoneità). Smette di valere da sola quando il voto si registra, anche altrove.
import type { Exam, Subject, Task } from "../types";

type TaskLike = Pick<Task, "subjectId" | "status">;
type ExamLike = Pick<Exam, "subjectId" | "status" | "date" | "preparation">;
type SubjectLike = Pick<Subject, "id" | "status" | "archived">;

/** Percentuale intera: 100 solo con tutto fatto (199 attività su 200 sono il 99%, non il 100%). */
const percent = (part: number, whole: number) => {
  if (!(whole > 0) || !Number.isFinite(part)) return 0;
  if (part >= whole) return 100;
  return Math.max(0, Math.min(99, Math.round((part / whole) * 100)));
};

/**
 * Progresso della materia: la preparazione del primo esame non ancora sostenuto, se c'è; altrimenti
 * le attività fatte su quelle della materia (le archiviate non contano). Senza esami né attività: 0.
 */
export const subjectProgress = <E extends ExamLike>(subjectId: string, tasks: readonly TaskLike[], exams: readonly E[]): { progress: number; exam?: E } => {
  const exam = exams.filter((item) => item.subjectId === subjectId && item.status !== "done").sort((a, b) => a.date.localeCompare(b.date))[0];
  if (exam) return { progress: percent(exam.preparation, 100), exam };
  const mine = tasks.filter((task) => task.subjectId === subjectId && task.status !== "archived");
  return { progress: percent(mine.filter((task) => task.status === "done").length, mine.length) };
};

/** Stati da cui una materia passa da sola a «Completata» (non le archiviate, non quelle già completate). */
const OPEN_STATUSES = new Set<Subject["status"]>(["not-started", "active", "review", "exam-ready"]);

/** Materia di un'attività appena segnata fatta (prima non lo era). */
export const taskDoneSubject = (before: TaskLike | undefined, after: TaskLike | undefined) =>
  after?.subjectId && after.status === "done" && before?.status !== "done" ? after.subjectId : undefined;

/**
 * Materia di un esame ancora da sostenere a cui è cambiata la preparazione. Lo stato da solo non
 * conta: un esame «Sostenuto» esce dal calcolo e la barra passa alle attività, quindi registrare il
 * voto (o riaprire un esame non superato, che resta al 100%) non è un progresso.
 */
export const examProgressSubject = (before: ExamLike | undefined, after: ExamLike | undefined) =>
  after && after.status !== "done" && before?.preparation !== after.preparation ? after.subjectId : undefined;

/**
 * Materie che una modifica porta al 100%: tra le candidate (quelle di un'attività segnata fatta o di
 * un esame da sostenere con la preparazione cambiata), quelle aperte il cui progresso passa da sotto
 * 100 a 100.
 * Conta il passaggio, non il livello: una materia già al 100% rimessa «In corso» a mano resta com'è
 * finché un'altra modifica non la riporta al 100%; caricare i dati o sincronizzarli non cambia niente.
 * Aggiungere o eliminare attività ed esami non conta: un'attività creata già fatta in una materia
 * nuova non la completa.
 */
export const subjectsReachingFull = (
  subjects: readonly SubjectLike[],
  candidates: Iterable<string | undefined>,
  before: { tasks: readonly TaskLike[]; exams: readonly ExamLike[] },
  after: { tasks: readonly TaskLike[]; exams: readonly ExamLike[] }
): string[] => {
  const ids = new Set([...candidates].filter((id): id is string => Boolean(id)));
  if (!ids.size) return [];
  return subjects
    .filter(
      (subject) =>
        ids.has(subject.id) &&
        !subject.archived &&
        OPEN_STATUSES.has(subject.status) &&
        subjectProgress(subject.id, after.tasks, after.exams).progress === 100 &&
        subjectProgress(subject.id, before.tasks, before.exams).progress < 100
    )
    .map((subject) => subject.id);
};

/** «Completata» senza voto né idoneità nel libretto: il voto è da registrare. `recorded` da `recordedSubjectIds`. */
export const isGradePending = (subject: SubjectLike, recorded: ReadonlySet<string>) =>
  subject.status === "completed" && !subject.archived && !recorded.has(subject.id);

/**
 * Materia chiusa per gli appelli: archiviata, oppure completata con il voto già registrato. Una
 * materia completata col voto da registrare può ancora aggiungere l'appello (l'esame può mancare).
 * Senza `recorded` ogni completata conta come chiusa (come prima di questa regola).
 */
export const isClosedForExams = (subject: SubjectLike, recorded?: ReadonlySet<string>) =>
  subject.archived || subject.status === "archived" || (subject.status === "completed" && (!recorded || recorded.has(subject.id)));
