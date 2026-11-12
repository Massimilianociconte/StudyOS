// Promemoria del timer di un'attività (TaskTimerReminder, montato in AppShell: compare in ogni sezione).
// Le etichette condivise (valori enum, testi comuni) sono in ../labels.

const clock = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

export const TASK_TIMER_TEXT = {
  /** Timer dimenticato: ferma il timer e conta solo fino a quell'ora (con il giorno, se non è oggi). */
  countUntil: (at: Date, now: Date) => {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    if (sameDay(at, now)) return `Conta fino alle ${clock(at)}`;
    if (sameDay(at, yesterday)) return `Conta fino alle ${clock(at)} di ieri`;
    return `Conta fino alle ${clock(at)} del ${at.toLocaleDateString("it-IT", { day: "numeric", month: "short" })}`;
  },
  countUntilTitle: "Ferma il timer e conta il tempo solo fino a quell'ora"
} as const;
