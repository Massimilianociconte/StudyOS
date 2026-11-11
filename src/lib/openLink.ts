// Collegamento profondo ?apri=… (da toccare una notifica push): apre la pagina giusta all'avvio.
// Logica pura e senza dipendenze: la usano l'hook useOpenLink e i test.

/** Gli unici valori accettati: i parametri `url` che il server mette nelle notifiche. */
export type OpenTarget = "notifiche" | "condivisione" | "gruppi";

const TARGETS: readonly OpenTarget[] = ["notifiche", "condivisione", "gruppi"];

/** Il pannello Notifiche non è una sezione ma un cassetto della shell: si apre con questo evento. */
export const OPEN_NOTIFICATIONS_EVENT = "studyos:open-notifications";

export const parseOpenTarget = (search: string): OpenTarget | null => {
  const value = new URLSearchParams(search).get("apri");
  return TARGETS.find((target) => target === value) ?? null;
};

/** Percorso, query (senza `apri`) e frammento: pronto per history.replaceState. */
export const urlWithoutOpen = (href: string): string => {
  const url = new URL(href, "https://studyos.invalid/");
  url.searchParams.delete("apri");
  return `${url.pathname}${url.search}${url.hash}`;
};

export const requestOpenNotifications = () => {
  window.dispatchEvent(new Event(OPEN_NOTIFICATIONS_EVENT));
};
