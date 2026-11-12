// Pezzi della sezione Attività senza DOM, testabili: i passaggi dell'editor.
import type { Task } from "../types";

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
