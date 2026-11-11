import { fromDatetimeLocal, nextHalfHour, toDatetimeLocal } from "./dates";

// Apre l'aggiunta rapida (montata in AppShell) da qualunque vista, già sul tipo richiesto.
export const QUICK_ADD_EVENT = "studyos:quick-add";

export type QuickAddRequest = "task" | "event" | "session" | "subject" | "material";

export const openQuickAdd = (mode?: QuickAddRequest) => {
  window.dispatchEvent(new CustomEvent(QUICK_ADD_EVENT, { detail: mode }));
};

export type QuickAddTaskCreate = "normal" | "timer" | "completed";

/**
 * Valori iniziali dei campi data: un'attività parte senza scadenza (prima riceveva la mezz'ora
 * successiva e finiva subito "in scadenza oggi"); eventi e tempo di studio alla prossima mezz'ora.
 */
export const quickAddDefaults = (now: Date = new Date()) => ({
  taskDue: "",
  start: toDatetimeLocal(nextHalfHour(now))
});

/**
 * Date di un'attività rapida dal campo data (datetime-local). Vuoto = senza scadenza; se è già
 * fatta, fatta adesso. null = data non valida.
 */
export const quickAddTaskDates = (
  value: string,
  create: QuickAddTaskCreate,
  now: Date = new Date()
): { dueDate?: string; completedAt?: string } | null => {
  const picked = value.trim() ? fromDatetimeLocal(value.trim()) : undefined;
  if (picked === null) return null;
  return {
    dueDate: picked,
    completedAt: create === "completed" ? (picked ?? now.toISOString()) : undefined
  };
};
