// Apre l'aggiunta rapida (montata in AppShell) da qualunque vista, già sul tipo richiesto.
export const QUICK_ADD_EVENT = "studyos:quick-add";

export type QuickAddRequest = "task" | "event" | "session" | "subject" | "material";

export const openQuickAdd = (mode?: QuickAddRequest) => {
  window.dispatchEvent(new CustomEvent(QUICK_ADD_EVENT, { detail: mode }));
};
