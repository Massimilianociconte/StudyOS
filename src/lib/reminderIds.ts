// Id delle notifiche in app dei promemoria. Modulo a parte e minuscolo: lo usa anche lo store (nel
// bundle d'ingresso) senza tirarsi dietro la logica dei promemoria, che si carica dopo.

const REMINDER_NOTIFICATION_PREFIX = "notif-reminder-";

/** Id stabile della notifica in app: un secondo avviso della stessa chiave non la duplica. */
export const notificationIdOf = (key: string) => `${REMINDER_NOTIFICATION_PREFIX}${key.replace(/[^A-Za-z0-9_-]/g, "-")}`;

/** Notifica di un promemoria: "Elimina" la archivia invece di toglierla (vedi deleteNotification). */
export const isReminderNotificationId = (id: string) => typeof id === "string" && id.startsWith(REMINDER_NOTIFICATION_PREFIX);
