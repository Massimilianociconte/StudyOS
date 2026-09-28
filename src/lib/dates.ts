/** Valore per <input type="datetime-local"> nell'ora LOCALE (toISOString() è in UTC: -2h in Italia). */
export const toDatetimeLocal = (value: Date) =>
  new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Converte il valore di un datetime-local in ISO; null se vuoto o non valido. */
export const fromDatetimeLocal = (value: string): string | null => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

/** Prossima mezz'ora piena: default sensato per nuovi eventi/task. */
export const nextHalfHour = (from: Date = new Date()) => {
  const date = new Date(from);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() < 30 ? 30 : 60);
  return date;
};
