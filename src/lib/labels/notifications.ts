// Notifiche (campanella e pannello).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

const unread = (count: number) => (count === 1 ? "1 non letta" : `${count} non lette`);

export const NOTIFICATIONS_TEXT = {
  title: "Notifiche",
  bellAria: (count: number) => (count ? `Notifiche, ${unread(count)}` : "Notifiche"),
  unreadTitle: (count: number) => (count === 1 ? "1 notifica non letta" : `${count} notifiche non lette`),
  unreadCount: unread,
  allRead: "Tutto letto",
  markAllRead: "Segna tutte come lette",
  emptyTitle: "Nessuna notifica",
  emptyBody: "Promemoria degli eventi, inviti ai gruppi e novità importanti compariranno qui.",
  open: "Apri",
  markRead: "Segna come letta",
  remove: "Elimina",
  removeAria: (title: string) => `Elimina notifica "${title}"`,
  unreadDot: "Non letta"
} as const;
