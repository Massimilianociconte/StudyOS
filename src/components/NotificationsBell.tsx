import { useEffect, useRef, useState, type ComponentType } from "react";
import { useStudyStore } from "../store/useStudyStore";
import { cloudConfigured } from "../lib/cloudSyncState";
import { useCloudSession } from "../hooks/useCloudSession";
import { Icon } from "./Icon";
import { NOTIFICATIONS_TEXT } from "../lib/labels/notifications";

export const unreadNotifications = (notifications: ReturnType<typeof useStudyStore.getState>["notifications"]) =>
  notifications.filter((item) => !item.archived && !item.readAt);

/**
 * Campanella notifiche con badge di non lette e micro-animazione discreta
 * (disattivata automaticamente con prefers-reduced-motion).
 */
export function NotificationsBell({ onOpen }: { onOpen: () => void }) {
  const notifications = useStudyStore((state) => state.notifications);
  const unread = unreadNotifications(notifications).length;

  // Recapito inviti e gruppi in tempo reale: se il cloud condiviso è attivo, gli inviti di altri
  // utenti e le novità della bacheca arrivano senza dover aprire la sezione Gruppi. Si riparte a
  // ogni accesso o cambio di account; all'uscita i segnali dell'account di prima si fermano.
  const session = useCloudSession();
  const sessionUserId = session?.user.id;
  const hadUser = useRef(false);
  useEffect(() => {
    // groupSync porta con sé supabase-js: import dinamico, solo se il cloud è configurato, così
    // resta fuori dal caricamento iniziale (come il motore di sync in App).
    if (!cloudConfigured) return;
    const leaving = hadUser.current && !sessionUserId;
    hadUser.current = Boolean(sessionUserId);
    void import("../lib/groupSync")
      .then((module): unknown => (leaving ? module.stopSharedMailbox() : module.ensureSharedMailbox()))
      .catch(() => undefined);
  }, [sessionUserId]);

  // Promemoria degli eventi: il watcher arriva a parte, quando la pagina è libera (fuori dal bundle
  // d'ingresso). Se il pezzo non arriva (offline, versione vecchia) non si monta niente.
  const [ReminderWatcher, setReminderWatcher] = useState<ComponentType | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void import("./calendar/EventReminderWatcher").then(
        (module) => {
          if (!cancelled) setReminderWatcher(() => module.EventReminderWatcher);
        },
        () => undefined
      );
    };
    if (typeof window.requestIdleCallback === "function") {
      const handle = window.requestIdleCallback(load, { timeout: 5000 });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }
    const handle = window.setTimeout(load, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, []);

  return (
    <>
      {ReminderWatcher ? <ReminderWatcher /> : null}
      <button
        type="button"
        onClick={onOpen}
        aria-label={NOTIFICATIONS_TEXT.bellAria(unread)}
        title={unread ? NOTIFICATIONS_TEXT.unreadTitle(unread) : NOTIFICATIONS_TEXT.title}
        className="relative grid h-11 w-11 shrink-0 grid-cols-1 place-items-center rounded-full bg-[var(--surface-strong)] text-[var(--text)] hover:bg-[var(--surface)]"
      >
        <span className={unread ? "motion-safe:animate-[bell-nudge_2.4s_ease-in-out_infinite]" : undefined}>
          <Icon name="Bell" className="h-4.5 w-4.5" />
        </span>
        {unread ? (
          <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 grid-cols-1 place-items-center rounded-full bg-[var(--accent-3)] px-1 text-[11px] font-black text-[#10131d]">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
    </>
  );
}
