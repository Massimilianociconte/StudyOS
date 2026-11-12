// Pezzi della sezione Attività senza DOM, testabili: i passaggi dell'editor, le pillole dell'aggiunta rapida.
import { format } from "date-fns";
import { it } from "date-fns/locale";
import type { Subject, Task } from "../types";
import { PRIORITY_LABEL } from "./labels";
import { QUICK_TASK_TEXT, TASKS_TEXT } from "./labels/tasks";

/** "Priorità media" invece di "Media": fuori da un campo etichettato il valore da solo non si capisce. */
export const priorityText = (priority: Task["priority"]) =>
  priority === "urgent" ? PRIORITY_LABEL.urgent : `Priorità ${PRIORITY_LABEL[priority].toLowerCase()}`;

export type QuickTaskChoice = { subjectId: string; priority: Task["priority"]; dueDate: string };
export type QuickTaskChip = { id: "subject" | "priority" | "due"; label: string; color?: string };

const civilDay = (value: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return date.getDate() === Number(match[3]) ? date : null;
};

/**
 * Le scelte di «Dettagli» diverse da quelle di base, da mostrare accanto all'aggiunta rapida: prima
 * valevano anche a pannello chiuso senza che si vedessero. La materia di base è quella del filtro
 * attivo (già visibile nel filtro): toglierla con il filtro attivo è una scelta e si vede.
 */
export const quickTaskChips = (
  choice: QuickTaskChoice,
  defaultSubjectId: string,
  subjects: Pick<Subject, "id" | "name" | "color">[]
): QuickTaskChip[] => {
  const chips: QuickTaskChip[] = [];
  if (choice.subjectId !== defaultSubjectId) {
    const subject = subjects.find((item) => item.id === choice.subjectId);
    if (subject) chips.push({ id: "subject", label: subject.name, color: subject.color });
    else chips.push({ id: "subject", label: choice.subjectId ? QUICK_TASK_TEXT.deletedSubject : TASKS_TEXT.noSubject });
  }
  if (choice.priority !== "medium") chips.push({ id: "priority", label: priorityText(choice.priority) });
  const due = civilDay(choice.dueDate);
  if (due) chips.push({ id: "due", label: QUICK_TASK_TEXT.due(format(due, "d MMM", { locale: it })) });
  return chips;
};

export type TaskStep = Task["subtasks"][number];

/** Nuovo passaggio in fondo; un testo vuoto non aggiunge nulla (stesso elenco). */
export const addStep = (steps: TaskStep[], text: string, id: string): TaskStep[] => {
  const clean = text.trim();
  return clean ? [...steps, { id, text: clean, done: false }] : steps;
};

export const toggleStep = (steps: TaskStep[], id: string): TaskStep[] =>
  steps.map((step) => (step.id === id ? { ...step, done: !step.done } : step));

/** Il testo resta com'è mentre si scrive (spazi compresi): si pulisce al salvataggio. */
export const renameStep = (steps: TaskStep[], id: string, text: string): TaskStep[] =>
  steps.map((step) => (step.id === id ? { ...step, text } : step));

export const removeStep = (steps: TaskStep[], id: string): TaskStep[] => steps.filter((step) => step.id !== id);

/** Al salvataggio: testi senza spazi ai lati; un passaggio svuotato sparisce. */
export const cleanSteps = (steps: TaskStep[]): TaskStep[] =>
  steps.map((step) => ({ ...step, text: step.text.trim() })).filter((step) => step.text);

export const stepsDone = (steps: TaskStep[]) => ({ done: steps.filter((step) => step.done).length, total: steps.length });

/**
 * Pillola tolta (anche con Invio): quale pillola prende il focus tra le `remaining` rimaste. La
 * successiva prende il posto di quella tolta; tolta l'ultima, quella prima; nessuna = null (il campo).
 */
export const chipFocusAfterRemove = (removedIndex: number, remaining: number): number | null =>
  remaining > 0 ? Math.min(removedIndex, remaining - 1) : null;

/** Bozza dell'editor diversa da com'era all'apertura (stessa forma: basta confrontare il JSON). */
export const draftChanged = <T>(initial: T, draft: T) => JSON.stringify(initial) !== JSON.stringify(draft);

/**
 * Esc, ✕, tocco fuori o «Annulla» nell'editor: senza modifiche chiude; con modifiche chiede
 * «Scartare le modifiche?» sul posto; una nuova richiesta mentre chiede torna a modificare.
 */
export const editorCloseRequest = (changed: boolean, asking: boolean): "close" | "ask" | "keep" =>
  !changed ? "close" : asking ? "keep" : "ask";
