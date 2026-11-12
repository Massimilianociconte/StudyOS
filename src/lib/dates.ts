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

const pad2 = (value: number) => String(value).padStart(2, "0");

/** Giorno del calendario locale ("2026-11-16"): cambia a mezzanotte (e con il fuso del dispositivo). */
export const localDayKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;

/**
 * Controllo del giorno per le viste che restano aperte (vedi `useToday`): `check()` chiama `onChange`
 * solo quando il giorno locale è cambiato dall'ultima volta, altrimenti non fa niente.
 */
export const dayWatcher = (initial: string, onChange: (day: string) => void, now: () => Date = () => new Date()) => {
  let current = initial;
  return () => {
    const day = localDayKey(now());
    if (day === current) return;
    current = day;
    onChange(day);
  };
};
