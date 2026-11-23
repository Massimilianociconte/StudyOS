// Avanzamento di una materia e regola «al 100% è completata». Logica pura (node --test). La usano le
// schede di Materie ed Esami, lo store (quindi l'app, gli agenti nel browser e il connettore remoto,
// che eseguono le stesse azioni) e le risposte del connettore.
//
// Tre indicatori distinti, mai mescolati:
// - Avanzamento attività (automatico): attività della materia con il loro peso; un'attività aperta
//   conta la parte di passaggi fatti, una fatta conta intera. 100% solo con ogni attività fatta.
// - Livello di preparazione (a mano): la preparazione del primo esame da sostenere.
// - Stato del ripasso: argomenti da ripassare oggi e in tutto.
// Senza dati un indicatore vale `null` («nessuna attività», «nessun esame»), mai 0%.
//
// Nessuno stato nuovo nei dati: «voto da registrare» è una materia «Completata» senza una riga nel
// libretto (voto o idoneità). Smette di valere da sola quando il voto si registra, anche altrove.
import type { Exam, StudyTopic, Subject, Task } from "../types";

type TaskLike = Pick<Task, "subjectId" | "status"> & { subtasks?: ReadonlyArray<Pick<Task["subtasks"][number], "done">>; progressWeight?: number };
type ExamLike = Pick<Exam, "subjectId" | "status" | "date" | "preparation">;
type SubjectLike = Pick<Subject, "id" | "status" | "archived">;
type TopicLike = Pick<StudyTopic, "subjectId" | "archived" | "nextReviewDate">;

/** Pesi possibili: 0 non conta, 1 normale (predefinito), 2 doppio, 3 triplo. */
export const TASK_WEIGHTS = [0, 1, 2, 3] as const;
export type TaskWeight = (typeof TASK_WEIGHTS)[number];

/** Peso di un'attività: assente o non valido = 1 (parti uguali). */
export const taskWeight = (task: { progressWeight?: unknown }): TaskWeight =>
  (TASK_WEIGHTS as readonly unknown[]).includes(task.progressWeight) ? (task.progressWeight as TaskWeight) : 1;

/** Percentuale intera: 100 solo con tutto fatto (199 attività su 200 sono il 99%, non il 100%). */
const percent = (part: number, whole: number) => {
  if (!(whole > 0) || !Number.isFinite(part)) return 0;
  if (part >= whole) return 100;
  return Math.max(0, Math.min(99, Math.round((part / whole) * 100)));
};

/**
 * Parte fatta di un'attività, da 0 a 1: fatta = 1; aperta = passaggi fatti sui passaggi (2 su 4 = 0,5).
 * Lo stato decide se è finita: un'attività aperta con tutti i passaggi spuntati vale 1 qui, ma la
 * materia arriva al 100% solo quando l'attività è segnata fatta (vedi `activityProgress`).
 */
export const taskShare = (task: TaskLike) => {
  if (task.status === "done") return 1;
  const steps = task.subtasks ?? [];
  if (!steps.length) return 0;
  return steps.filter((step) => step.done).length / steps.length;
};

/** Attività che contano per la materia: non archiviate e con peso diverso da 0. */
const countedTasks = <T extends TaskLike>(subjectId: string, tasks: readonly T[]) =>
  tasks.filter((task) => task.subjectId === subjectId && task.status !== "archived" && taskWeight(task) > 0);

export interface ActivityProgress {
  /** `null` = nessuna attività che conta (non «0%»). */
  percent: number | null;
  /** Attività che contano, fatte, aperte con qualche passaggio fatto, e quelle che non contano (peso 0). */
  counted: number;
  done: number;
  partial: number;
  excluded: number;
}

/**
 * Avanzamento delle attività della materia: somma dei pesi fatti sul totale dei pesi. Esempio: 5
 * attività dal peso uguale valgono il 20% l'una; una con 2 passaggi su 4 fatti aggiunge il 10%.
 * Il 100% vuol dire ogni attività che conta segnata fatta, non una somma che ci arriva per arrotondamento.
 */
export const activityProgress = (subjectId: string, tasks: readonly TaskLike[]): ActivityProgress => {
  const mine = tasks.filter((task) => task.subjectId === subjectId && task.status !== "archived");
  const counted = countedTasks(subjectId, mine);
  const excluded = mine.length - counted.length;
  if (!counted.length) return { percent: null, counted: 0, done: 0, partial: 0, excluded };
  const total = counted.reduce((sum, task) => sum + taskWeight(task), 0);
  const made = counted.reduce((sum, task) => sum + taskWeight(task) * taskShare(task), 0);
  const done = counted.filter((task) => task.status === "done").length;
  const partial = counted.filter((task) => task.status !== "done" && taskShare(task) > 0).length;
  const value = done === counted.length ? 100 : Math.min(99, percent(made, total));
  return { percent: value, counted: counted.length, done, partial, excluded };
};

/** Primo esame da sostenere della materia (per data), se c'è. */
export const openExamOf = <E extends ExamLike>(subjectId: string, exams: readonly E[]): E | undefined =>
  exams.filter((item) => item.subjectId === subjectId && item.status !== "done").sort((a, b) => a.date.localeCompare(b.date))[0];

/**
 * Progresso della materia (la barra e la regola del 100%): la preparazione del primo esame da
 * sostenere, se c'è; altrimenti l'avanzamento delle attività. `null` senza esame né attività che contano.
 */
export const subjectProgress = <E extends ExamLike>(
  subjectId: string,
  tasks: readonly TaskLike[],
  exams: readonly E[]
): { progress: number | null; source: "exam" | "tasks" | "none"; exam?: E; activity: ActivityProgress } => {
  const activity = activityProgress(subjectId, tasks);
  const exam = openExamOf(subjectId, exams);
  if (exam) return { progress: percent(exam.preparation, 100), source: "exam", exam, activity };
  return activity.percent === null ? { progress: null, source: "none", activity } : { progress: activity.percent, source: "tasks", activity };
};

export interface ReviewStatus {
  /** Argomenti da ripassare (non archiviati) e quelli in scadenza entro oggi. */
  total: number;
  due: number;
}

/** Stato del ripasso della materia: quanti argomenti ha e quanti sono da ripassare entro oggi. */
export const reviewStatus = (subjectId: string, topics: readonly TopicLike[], now: Date = new Date()): ReviewStatus => {
  const limit = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999).getTime();
  const mine = topics.filter((topic) => topic.subjectId === subjectId && !topic.archived);
  const due = mine.filter((topic) => {
    const time = Date.parse(topic.nextReviewDate);
    return Number.isFinite(time) && time <= limit;
  }).length;
  return { total: mine.length, due };
};

/** Chiave con cui un argomento è «già nel ripasso»: stessa materia, stesso titolo (maiuscole e spazi ai lati a parte). */
export const topicKey = (subjectId: string, title: string) => `${subjectId}:${title.trim().toLowerCase()}`;

/**
 * Argomenti del programma che «Aggiungi al ripasso» aggiungerebbe: titoli non vuoti, non già tra gli
 * argomenti della materia (anche archiviati: come `addTopics` nello store), senza doppioni.
 */
export const programToAdd = (subjectId: string, program: readonly string[], topics: ReadonlyArray<Pick<StudyTopic, "subjectId" | "title">>) => {
  const known = new Set(topics.map((topic) => topicKey(topic.subjectId, topic.title)));
  const fresh: string[] = [];
  for (const raw of program) {
    const title = raw.trim();
    const key = topicKey(subjectId, title);
    if (!title || known.has(key)) continue;
    known.add(key);
    fresh.push(title);
  }
  return fresh;
};

/**
 * Stato dell'attività che segue i passaggi, per una modifica che cambia i passaggi: spuntarli tutti
 * la segna fatta; toglierne uno a un'attività fatta la riapre («Da fare»). Niente se la modifica
 * cambia anche lo stato (vince la scelta fatta) o se l'attività è archiviata. Un'attività senza
 * passaggi resta com'è.
 */
export const stepsStatus = (
  task: Pick<Task, "status" | "subtasks">,
  patch: Partial<Pick<Task, "status" | "subtasks">>
): Task["status"] | undefined => {
  if (!patch.subtasks || (patch.status !== undefined && patch.status !== task.status)) return undefined;
  if (task.status === "archived") return undefined;
  const before = task.subtasks.filter((step) => step.done).length;
  const after = patch.subtasks.filter((step) => step.done).length;
  const total = patch.subtasks.length;
  if (!total) return undefined;
  const allBefore = task.subtasks.length > 0 && before === task.subtasks.length;
  if (task.status !== "done" && after === total && !allBefore) return "done";
  if (task.status === "done" && after < before && after < total) return "todo";
  return undefined;
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
 * Aggiungere o eliminare attività ed esami, o cambiare il peso di un'attività, non conta: un'attività
 * creata già fatta in una materia nuova non la completa.
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
    .filter((subject) => {
      if (!ids.has(subject.id) || subject.archived || !OPEN_STATUSES.has(subject.status)) return false;
      const now = subjectProgress(subject.id, after.tasks, after.exams).progress;
      const was = subjectProgress(subject.id, before.tasks, before.exams).progress;
      // Senza dati prima (`null`) non era al 100%: la prima attività fatta di una materia la completa
      // solo se era l'unica, come sempre; senza dati dopo non è al 100%.
      return now === 100 && (was === null || was < 100);
    })
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
