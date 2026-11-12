// «Apri» di una notifica: le chiavi di `uiState` da scrivere prima di cambiare sezione, così si arriva
// sulla scheda o sul giorno giusti. La sezione già aperta le legge con useLinkedUiState (stesse chiavi
// e validatori di GroupsView, SharingView e CalendarView). Senza DOM né store: testabile.
import type { AppNotification, AppView } from "../types";
import type { UiScope } from "./uiState";
import { isReminderNotificationId } from "./reminderIds";
import { GROUP_EXAM_NOTIFICATION_PREFIX } from "./groupExamNotify";

const SHARE_INVITE_PREFIX = "notif-share-invite-";

/** Id della notifica «… ti invita a condividere» (lo stesso che usa shareSync quando la crea). */
export const shareInviteNotificationId = (inviteId: string) => `${SHARE_INVITE_PREFIX}${inviteId}`;

export type NotificationJump = {
  view: AppView | null;
  writes: Array<readonly [key: string, value: unknown, scope: UiScope]>;
};

/**
 * Giorno dell'evento scritto nell'id del promemoria (chiave `famiglia@YYYY-MM-DD#1d0m0900@ms`, con
 * `@` e `#` diventati `-`): mezzogiorno locale di quel giorno, lontano dai cambi d'ora. null se manca.
 */
export const reminderEventDay = (id: string): string | null => {
  const match = /-(\d{4})-(\d{2})-(\d{2})-\d+d\d+m\d*-\d+$/.exec(id);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(year, month - 1, day, 12);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date.toISOString() : null;
};

export const notificationJump = (item: Pick<AppNotification, "id" | "linkView" | "linkGroupId" | "createdAt">): NotificationJump => {
  const writes: NotificationJump["writes"] = [];
  if (item.linkGroupId) writes.push(["groups.open", item.linkGroupId, "tab"]);
  // Appello del gruppo nuovo, cambiato o eliminato → scheda «Appelli» del gruppo.
  if (item.id.startsWith(GROUP_EXAM_NOTIFICATION_PREFIX)) writes.push(["groups.detailTab", "appelli", "tab"]);
  // Invito a condividere → «Inviti»; «… condivide con te» → «Condivisi con me» (non l'ultima scheda usata).
  if (item.linkView === "sharing") writes.push(["sharing.tab", item.id.startsWith(SHARE_INVITE_PREFIX) ? "invites" : "received", "tab"]);
  // Promemoria: il Calendario si apre sul giorno dell'evento (un avviso «7 giorni prima» scatta in
  // un'altra settimana), anche se si stava guardando un altro mese. Id vecchio: il giorno dell'avviso.
  if (item.linkView === "calendar" && isReminderNotificationId(item.id)) {
    const day = reminderEventDay(item.id) ?? (Number.isNaN(Date.parse(item.createdAt)) ? null : item.createdAt);
    if (day) writes.push(["calendar.cursor", day, "tab"]);
  }
  return { view: item.linkView ?? null, writes };
};
