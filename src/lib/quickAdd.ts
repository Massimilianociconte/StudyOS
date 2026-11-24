// «Aggiungi» (montato in AppShell) si apre da qualunque vista già sul modulo richiesto: attività e
// materia sopra la pagina, evento e materiale nella loro sezione. «session» (studio pianificato) è un
// evento di tipo Studio: apre lo stesso modulo dell'evento.
export const QUICK_ADD_EVENT = "studyos:quick-add";

export type QuickAddRequest = "task" | "event" | "session" | "subject" | "material";

export const openQuickAdd = (mode?: QuickAddRequest) => {
  window.dispatchEvent(new CustomEvent(QUICK_ADD_EVENT, { detail: mode }));
};
