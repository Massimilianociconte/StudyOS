// Apre il Calendario con la guida «Importa o esporta» già aperta (es. dai primi passi in Home), come
// settingsJump per Impostazioni: una richiesta nella scheda, letta una volta sola dal Calendario.
import type { GuideDirection } from "./calendarGuide";

const KEY = "studyos-calendar-jump";

/** Da chiamare prima di passare alla vista Calendario. */
export const requestCalendarTransfer = (direction: GuideDirection) => {
  try {
    sessionStorage.setItem(KEY, direction);
  } catch {
    // storage non disponibile: il Calendario si apre senza la guida
  }
};

/** Letta una sola volta da CalendarView, quando la guida è montata. Un valore estraneo non apre nulla. */
export const takeCalendarTransfer = (): GuideDirection | null => {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return value === "import" || value === "export" ? value : null;
  } catch {
    return null;
  }
};
