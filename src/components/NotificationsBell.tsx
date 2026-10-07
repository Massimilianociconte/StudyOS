import { useEffect } from "react";
import { useStudyStore } from "../store/useStudyStore";
import { cloudConfigured } from "../lib/cloudSyncState";
import { Icon } from "./Icon";

export const unreadNotifications = (notifications: ReturnType<typeof useStudyStore.getState>["notifications"]) =>
  notifications.filter((item) => !item.archived && !item.readAt);

/**
 * Campanella notifiche con badge di non lette e micro-animazione discreta
 * (disattivata automaticamente con prefers-reduced-motion).
 */
export function NotificationsBell({ onOpen }: { onOpen: () => void }) {
  const notifications = useStudyStore((state) => state.notifications);
  const unread = unreadNotifications(notifications).length;

  // Recapito inviti: se il cloud condiviso è attivo, gli inviti di altri utenti
  // compaiono qui senza dover aprire la sezione Gruppi.
  useEffect(() => {
    // groupSync porta con sé supabase-js: import dinamico, solo se il cloud è configurato, così
    // resta fuori dal caricamento iniziale (come il motore di sync in App).
    if (!cloudConfigured) return;
    void import("../lib/groupSync").then((module) => module.ensureSharedMailbox()).catch(() => undefined);
  }, []);

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={unread ? `Notifiche, ${unread} non lette` : "Notifiche"}
      title={unread ? `${unread} notifiche non lette` : "Notifiche"}
      className="relative grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--surface-strong)] text-[var(--text)] hover:bg-[var(--surface)]"
    >
      <span className={unread ? "motion-safe:animate-[bell-nudge_2.4s_ease-in-out_infinite]" : undefined}>
        <Icon name="Bell" className="h-4.5 w-4.5" />
      </span>
      {unread ? (
        <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-[var(--accent-3)] px-1 text-[11px] font-black text-[#10131d]">
          {unread > 9 ? "9+" : unread}
        </span>
      ) : null}
    </button>
  );
}
