// Logica pura della vista Esami (niente DOM, testata con node --test): esame da aprire quando
// un'altra schermata scrive `exams.editing`, bollino di rischio e collegamenti dalla scheda
// dell'esame alle altre sezioni (schema `writeUiState(key, value, scope)` + `setActiveView`).
import type { UiScope } from "./uiState";

/** Chiave condivisa tra le schermate: id dell'esame da aprire in Esami (ambito scheda), o null. */
export const EXAMS_EDITING_KEY = "exams.editing";

/**
 * Cosa fare col valore salvato in `exams.editing`: aprire l'esame se c'è ancora; se non c'è
 * più (eliminato, id sconosciuto o valore non valido) non si apre nulla e la chiave si cancella.
 */
export const resolveExamEditing = <T extends { id: string }>(value: unknown, exams: readonly T[]): { exam: T | null; clear: boolean } => {
  if (value === null || value === undefined) return { exam: null, clear: false };
  const exam = typeof value === "string" ? (exams.find((item) => item.id === value) ?? null) : null;
  return { exam, clear: exam === null };
};

export type ExamRisk = "alto" | "medio" | null;

/** "Sei indietro": meno di 10 giorni e sotto il 70%; "Un po' indietro": meno di 20 giorni e sotto il 55%. */
export const examRisk = (remainingDays: number, preparation: number): ExamRisk =>
  remainingDays < 10 && preparation < 70 ? "alto" : remainingDays < 20 && preparation < 55 ? "medio" : null;

export type UiWrite = { key: string; value: unknown; scope: UiScope };
export type ExamLinkTarget = "tasks" | "study" | "topics";

/** Chiavi da scrivere e vista da aprire per i collegamenti della scheda d'esame. */
export const examLinkPlan = (target: ExamLinkTarget, subjectId: string): { view: "tasks" | "study"; writes: UiWrite[] } => {
  if (target === "tasks") {
    return {
      view: "tasks",
      writes: [
        { key: "tasks.subject", value: subjectId, scope: "tab" },
        { key: "tasks.mode", value: "list", scope: "device" }
      ]
    };
  }
  const subject: UiWrite = { key: "study.subject", value: subjectId, scope: "device" };
  if (target === "study") return { view: "study", writes: [subject] };
  // Argomenti: stessa materia del conteggio già scelta in Studio, poi il riquadro degli argomenti aperto.
  return { view: "study", writes: [subject, { key: "study.topicsOpen", value: true, scope: "tab" }] };
};
