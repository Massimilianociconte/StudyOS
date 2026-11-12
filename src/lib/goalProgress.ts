// Obiettivi: lo stato segue il progresso (logica pura, testata con node --test). Al 100% un obiettivo
// in corso o in pausa è raggiunto; sotto il 100% un raggiunto torna in corso. Archiviato resta tale:
// è una scelta esplicita, non un effetto del progresso.
import type { Goal } from "../types";

type Status = Goal["status"];

export const GOAL_STEP = 5;

export const statusForProgress = (status: Status, progress: number): Status => {
  if (status === "archived") return status;
  if (progress >= 100) return "done";
  return status === "done" ? "active" : status;
};

/** + o − sulla scheda: progresso tra 0 e 100 e stato che segue. */
export const goalStep = (goal: Pick<Goal, "progress" | "status">, delta: number): Pick<Goal, "progress" | "status"> => {
  const progress = Math.max(0, Math.min(100, goal.progress + delta));
  return { progress, status: statusForProgress(goal.status, progress) };
};

/**
 * Dettaglio: cambiare il progresso aggiorna lo stato; scegliere «Raggiunto» porta al 100%, scegliere
 * «Attivo» o «In pausa» al 100% scende di un passo (altrimenti tornerebbe subito raggiunto).
 */
export const goalDraftWith = <T extends Pick<Goal, "progress" | "status">>(draft: T, change: { progress: number } | { status: Status }): T => {
  if ("progress" in change) return { ...draft, progress: change.progress, status: statusForProgress(draft.status, change.progress) };
  const { status } = change;
  if (status === "done") return { ...draft, status, progress: 100 };
  if (status !== "archived" && draft.progress >= 100) return { ...draft, status, progress: 100 - GOAL_STEP };
  return { ...draft, status };
};

/** Campi del dettaglio come sono salvati («Come lo misuri» non si mostra: il valore salvato resta). */
export const goalDraftOf = (goal: Goal) => ({
  title: goal.title,
  description: goal.description,
  category: goal.category,
  deadline: goal.deadline?.slice(0, 10) ?? "",
  progress: goal.progress,
  status: goal.status,
  notes: goal.notes
});

export type GoalDraft = ReturnType<typeof goalDraftOf>;

/** Il modulo è diverso da quanto salvato: chiudere chiede prima «Scartare le modifiche?». */
export const goalDraftChanged = (draft: GoalDraft, saved: GoalDraft) =>
  (Object.keys(saved) as (keyof GoalDraft)[]).some((key) => draft[key] !== saved[key]);

const isClosed = (status: Status) => status === "done" || status === "archived";

/** Passaggio tra «in corso» (attivi e in pausa) e «Raggiunti e archiviati»: la scheda cambia gruppo. */
export const goalMove = (before: Status, after: Status): "reached" | "archived" | "reopened" | null => {
  if (isClosed(before) === isClosed(after)) return null;
  if (!isClosed(after)) return "reopened";
  return after === "done" ? "reached" : "archived";
};
