// Promemoria degli eventi mentre l'app è aperta. Caricato a parte dalla campanella (NotificationsBell),
// fuori dal bundle d'ingresso: non disegna niente, mette un timer per ogni promemoria delle prossime
// 48 ore e, quando scatta, aggiunge una notifica in app (che apre il calendario) e, se il permesso è
// stato dato, una notifica di sistema. Le chiavi già avvisate restano sul dispositivo.
import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudyStore } from "../../store/useStudyStore";
import { EVENT_REMINDER_TEXT } from "../../lib/labels";
import {
  FIRED_STORAGE_KEY,
  REMINDER_GRACE_MS,
  notificationIdOf,
  parseFired,
  planReminders,
  pruneFired,
  reminderWhenText,
  type PlannedReminder
} from "../../lib/eventReminders";
import { systemNotificationState } from "../../lib/timerAlerts";

/** Si ripianifica anche da solo ogni tanto (timer rallentati in background, giorno che cambia). */
const REPLAN_MS = 10 * 60_000;

// Ripiego se il localStorage non c'è (navigazione privata): nella stessa sessione non si ripete.
const firedHere = new Set<string>();

const readFired = (): Record<string, number> => {
  try {
    return parseFired(window.localStorage.getItem(FIRED_STORAGE_KEY));
  } catch {
    return {};
  }
};

const writeFired = (fired: Record<string, number>) => {
  try {
    window.localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify(fired));
  } catch {
    // spazio pieno o storage bloccato: resta il ripiego in memoria
  }
};

async function showSystemReminder(key: string, title: string, body: string) {
  if (systemNotificationState() !== "granted") return;
  const options = { body, tag: `studyos-reminder-${key}`, icon: "./icons/studyos-192.png" };
  try {
    // Su Android la notifica passa dal service worker; altrove basta il costruttore.
    const registration = await navigator.serviceWorker?.getRegistration();
    if (registration) {
      await registration.showNotification(title, options);
      return;
    }
    new Notification(title, options);
  } catch {
    // rifiutata dal sistema: resta la notifica in app
  }
}

export function EventReminderWatcher() {
  const { events, ready, addNotification } = useStudyStore(
    useShallow((state) => ({ events: state.events, ready: !state.loading && !state.locked, addNotification: state.addNotification }))
  );
  // Tornando sulla scheda (o dal sonno del computer) i timer possono essere in ritardo: si ripianifica.
  const [wake, setWake] = useState(0);
  useEffect(() => {
    const bump = () => setWake((count) => count + 1);
    const onVisible = () => {
      if (document.visibilityState === "visible") bump();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", bump);
    window.addEventListener("pageshow", bump);
    const interval = window.setInterval(bump, REPLAN_MS);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", bump);
      window.removeEventListener("pageshow", bump);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!ready) return undefined;
    const plan = planReminders(events, new Date());
    if (!plan.length) return undefined;
    const fire = (item: PlannedReminder) => {
      const nowMs = Date.now();
      // Un timer scattato molto in ritardo (computer in pausa) non avvisa: ci pensa il nuovo piano.
      if (nowMs - item.at > REMINDER_GRACE_MS || firedHere.has(item.key)) return;
      const fired = readFired();
      if (fired[item.key]) return;
      firedHere.add(item.key);
      writeFired(pruneFired({ ...fired, [item.key]: nowMs }, nowMs));
      const title = item.title.trim() || EVENT_REMINDER_TEXT.untitled;
      const body = reminderWhenText(item.startMs, item.allDay, new Date(nowMs));
      void addNotification({ id: notificationIdOf(item.key), kind: "system", title, body, linkView: "calendar" }).catch(() => undefined);
      void showSystemReminder(item.key, title, body);
    };
    const timers = plan.map((item) => window.setTimeout(() => fire(item), Math.max(0, item.at - Date.now())));
    return () => timers.forEach((id) => window.clearTimeout(id));
  }, [events, ready, wake, addNotification]);

  return null;
}
