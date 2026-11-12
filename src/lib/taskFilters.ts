// Filtri e riepilogo della sezione Attività: senza DOM, testabili. I valori di `tasks.filter` sono il
// contratto tra le schermate ("3 in ritardo" in Statistiche o in un esame porta qui già filtrato).
import { isBefore, parseISO, startOfDay } from "date-fns";
import type { Subject, Task } from "../types";

export const TASK_FILTERS = ["all", "overdue", "urgent"] as const;
export type TaskFilter = (typeof TASK_FILTERS)[number];

export const isTaskFilter = (value: unknown): value is TaskFilter =>
  typeof value === "string" && (TASK_FILTERS as readonly string[]).includes(value);

export const isOpenTask = (task: Pick<Task, "status">) => task.status !== "done" && task.status !== "archived";

/** Da fare con la scadenza prima di oggi (una scadenza di oggi non è ancora in ritardo). */
export const isOverdueTask = (task: Pick<Task, "status" | "dueDate">, now: Date = new Date()) =>
  Boolean(task.dueDate) && isOpenTask(task) && isBefore(parseISO(task.dueDate!), startOfDay(now));

/** Da fare con priorità "Urgente": lo stesso conto del riepilogo. */
export const isUrgentTask = (task: Pick<Task, "status" | "priority">) => isOpenTask(task) && task.priority === "urgent";

export const taskSummary = (tasks: Task[], now: Date = new Date()) => {
  const open = tasks.filter(isOpenTask);
  return {
    open: open.length,
    overdue: open.filter((task) => isOverdueTask(task, now)).length,
    urgent: open.filter(isUrgentTask).length,
    minutes: open.reduce((sum, task) => sum + (task.estimatedMinutes || 0), 0)
  };
};

const PRIORITY_RANK: Record<Task["priority"], number> = { urgent: 0, high: 1, medium: 2, low: 3 };

/**
 * «Ordina per Priorità»: prima la priorità; dentro la stessa priorità la scadenza più vicina (quindi
 * le in ritardo in alto, e quelle senza scadenza in fondo), poi l'importanza. Sort stabile.
 */
export const sortByPriority = <T extends Pick<Task, "priority" | "dueDate" | "importance">>(tasks: T[]) =>
  [...tasks].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
      b.importance - a.importance
  );

/** Materia del filtro, solo se esiste ancora: un id sconosciuto (materia eliminata) non nasconde tutto. */
export const subjectFilterTarget = <T extends Pick<Subject, "id">>(subjects: T[], id: string | null) =>
  id ? subjects.find((subject) => subject.id === id) ?? null : null;

export const filterTasks = <T extends Task>(tasks: T[], filter: TaskFilter, subjectId: string | null, now: Date = new Date()) =>
  tasks.filter(
    (task) =>
      (filter === "all" || (filter === "overdue" ? isOverdueTask(task, now) : isUrgentTask(task))) &&
      (!subjectId || task.subjectId === subjectId)
  );
