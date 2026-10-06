import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { AppNotification } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { writeUiState } from "../lib/uiState";
import { Button, Drawer, EmptyState } from "./ui";
import { Icon } from "./Icon";

const KIND_ICON: Record<AppNotification["kind"], string> = {
  invite: "Mail",
  group: "Users",
  system: "Info"
};

export const formatNotificationTime = (iso: string) => {
  const date = parseISO(iso);
  if (Number.isNaN(date.getTime())) return "";
  return format(date, "d MMM · HH:mm", { locale: it });
};

/**
 * Pannello notifiche: lettura singola/totale, apertura del contenuto collegato,
 * eliminazione. Lo stato vive nelle entità sincronizzate (stesso su ogni dispositivo).
 */
export function NotificationsPanel({ onClose }: { onClose: () => void }) {
  const { notifications, markNotificationRead, markAllNotificationsRead, deleteNotification, setActiveView } = useStudyStore();
  const visible = [...notifications].filter((item) => !item.archived).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = visible.filter((item) => !item.readAt).length;

  const openLinked = async (item: AppNotification) => {
    if (!item.readAt) await markNotificationRead(item.id);
    if (item.linkGroupId) writeUiState("groups.open", item.linkGroupId, "tab");
    if (item.linkView) setActiveView(item.linkView);
    onClose();
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title="Notifiche"
      eyebrow={unread ? `${unread} non ${unread === 1 ? "letta" : "lette"}` : "Tutto letto"}
      footer={
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="soft" icon="CheckCheck" onClick={() => void markAllNotificationsRead()} disabled={!unread}>
            Segna tutte come lette
          </Button>
        </div>
      }
    >
      {visible.length === 0 ? (
        <EmptyState icon="Bell" title="Nessuna notifica" body="Inviti ai gruppi e novità importanti compariranno qui." />
      ) : (
        <ul className="grid grid-cols-1 gap-2">
          {visible.map((item) => (
            <li
              key={item.id}
              className={`quiet-panel flex min-w-0 items-start gap-3 p-3 ${item.readAt ? "opacity-70" : ""}`}
            >
              <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${item.readAt ? "bg-[var(--surface-strong)] text-[var(--muted)]" : "bg-[var(--accent)] text-[#10131d]"}`}>
                <Icon name={KIND_ICON[item.kind]} className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="safe-text text-sm font-extrabold">{item.title}</p>
                {item.body ? <p className="safe-text mt-0.5 text-xs text-[var(--muted)]">{item.body}</p> : null}
                <p className="mt-1 text-[11px] font-bold text-[var(--faint)]">{formatNotificationTime(item.createdAt)}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {item.linkView ? (
                    <button
                      type="button"
                      onClick={() => void openLinked(item)}
                      className="inline-flex min-h-8 items-center gap-1 rounded-full bg-[var(--surface-strong)] px-3 text-xs font-black hover:bg-[var(--surface)]"
                    >
                      Apri <Icon name="ChevronRight" className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  {!item.readAt ? (
                    <button
                      type="button"
                      onClick={() => void markNotificationRead(item.id)}
                      className="inline-flex min-h-8 items-center rounded-full px-3 text-xs font-black text-[var(--muted)] hover:text-[var(--text)]"
                    >
                      Segna come letta
                    </button>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void deleteNotification(item.id)}
                    className="inline-flex min-h-8 items-center rounded-full px-3 text-xs font-black text-[var(--danger-text)] hover:bg-[var(--danger-bg)]"
                    aria-label={`Elimina notifica "${item.title}"`}
                  >
                    Elimina
                  </button>
                </div>
              </div>
              {!item.readAt ? <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--accent)]" aria-label="Non letta" /> : null}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
