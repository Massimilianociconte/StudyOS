// Durate del timer di studio: ogni materia può ricordare le sue (Subject.timer), le preferenze
// dell'account valgono per tutte le altre (Preferences.timer), poi i valori predefiniti.
// Si risolve campo per campo e ogni valore viene limitato: dati vecchi, sincronizzati o scritti
// a mano non possono produrre un blocco di 0 minuti o una pausa di un giorno.
import type { TimerSettings } from "../types";

export type TimerSettingKey = keyof TimerSettings;

export interface TimerDurations {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  /** Obiettivo del cronometro: avvisa al traguardo senza fermarlo. Assente = nessun obiettivo. */
  stopwatchTargetMinutes: number | undefined;
  /** Timer (conto alla rovescia): durata in minuti. */
  timerMinutes: number;
}

export const TIMER_SETTING_KEYS = [
  "focusMinutes",
  "shortBreakMinutes",
  "longBreakMinutes",
  "longBreakEvery",
  "stopwatchTargetMinutes",
  "timerMinutes"
] as const satisfies readonly TimerSettingKey[];

/** Limiti (minimo, massimo) di ogni valore. */
export const TIMER_LIMITS: Record<TimerSettingKey, readonly [number, number]> = {
  focusMinutes: [1, 240],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 60],
  longBreakEvery: [1, 12],
  stopwatchTargetMinutes: [1, 600],
  timerMinutes: [1, 600]
};

/** 25 minuti di studio, 5 di pausa, 15 di pausa lunga ogni 4 blocchi; Timer da un'ora. */
export const DEFAULT_TIMER_DURATIONS = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4, timerMinutes: 60 } as const;

/** Durate rapide per il blocco di studio (si può sempre scrivere un numero qualsiasi). */
export const FOCUS_QUICK_PICKS = [25, 45, 90] as const;

/** Durate rapide del Timer: mezz'ora, un'ora, un'ora e mezza, due ore (le altre si scrivono). */
export const TIMER_QUICK_PICKS = [30, 60, 90, 120] as const;

/** Valore numerico limitato e intero, oppure undefined se il valore non è un numero. */
export const clampTimerValue = (key: TimerSettingKey, value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const [min, max] = TIMER_LIMITS[key];
  return Math.min(max, Math.max(min, Math.round(value)));
};

const pick = (key: TimerSettingKey, ...levels: Array<TimerSettings | null | undefined>) => {
  for (const level of levels) {
    const value = clampTimerValue(key, level?.[key]);
    if (value !== undefined) return value;
  }
  return undefined;
};

/** Durate valide per una materia: materia → preferenze → predefiniti, campo per campo. */
export const resolveTimerDurations = (subject?: TimerSettings | null, preferences?: TimerSettings | null): TimerDurations => ({
  focusMinutes: pick("focusMinutes", subject, preferences) ?? DEFAULT_TIMER_DURATIONS.focusMinutes,
  shortBreakMinutes: pick("shortBreakMinutes", subject, preferences) ?? DEFAULT_TIMER_DURATIONS.shortBreakMinutes,
  longBreakMinutes: pick("longBreakMinutes", subject, preferences) ?? DEFAULT_TIMER_DURATIONS.longBreakMinutes,
  longBreakEvery: pick("longBreakEvery", subject, preferences) ?? DEFAULT_TIMER_DURATIONS.longBreakEvery,
  stopwatchTargetMinutes: pick("stopwatchTargetMinutes", subject, preferences),
  timerMinutes: pick("timerMinutes", subject, preferences) ?? DEFAULT_TIMER_DURATIONS.timerMinutes
});

/** Impostazioni da salvare: solo i valori numerici, già limitati; nessun valore → undefined. */
export const cleanTimerSettings = (settings: Partial<Record<TimerSettingKey, unknown>> | null | undefined): TimerSettings | undefined => {
  if (!settings || typeof settings !== "object") return undefined;
  const clean: TimerSettings = {};
  for (const key of TIMER_SETTING_KEYS) {
    const value = clampTimerValue(key, settings[key]);
    if (value !== undefined) clean[key] = value;
  }
  return Object.keys(clean).length ? clean : undefined;
};

/**
 * Minuti scritti in un campo del modulo. Vuoto → `empty` (campo facoltativo); fuori dai limiti
 * o non numerico → `invalid` (il modulo mostra l'errore invece di correggere da solo).
 */
export const parseTimerInput = (key: TimerSettingKey, text: string): { value?: number; empty?: true; invalid?: true } => {
  const trimmed = text.trim().replace(",", ".");
  if (!trimmed) return { empty: true };
  const value = Number(trimmed);
  const [min, max] = TIMER_LIMITS[key];
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < min || value > max) return { invalid: true };
  return { value };
};

/**
 * Durate da salvare dopo il modulo: solo i valori che la persona ha cambiato (`draft` diverso da
 * `initial`, i valori mostrati all'apertura) si scrivono sopra quelli già salvati (`existing`).
 * Un valore non toccato resta com'era: proprio se lo era, ereditato (dalle preferenze o dai
 * predefiniti) altrimenti, così un cambio delle durate generali continua ad arrivare alla materia.
 * Un valore svuotato (solo l'obiettivo può esserlo) toglie la chiave. Niente da salvare → undefined.
 */
export const changedTimerSettings = (
  draft: Partial<Record<TimerSettingKey, number | undefined>>,
  initial: Partial<Record<TimerSettingKey, number | undefined>>,
  existing: TimerSettings | null | undefined
): TimerSettings | undefined => {
  const next: Partial<Record<TimerSettingKey, unknown>> = { ...(existing ?? {}) };
  for (const key of TIMER_SETTING_KEYS) {
    if (draft[key] === initial[key]) continue;
    if (draft[key] === undefined) delete next[key];
    else next[key] = draft[key];
  }
  return cleanTimerSettings(next);
};

const WHOLE = /^\d+$/;

/**
 * Durata del Timer scritta in ore e minuti (1 h 30, 2 h 15…). Un campo vuoto vale 0, entrambi vuoti
 * o un valore non intero non sono validi; il totale si limita a 1 minuto – 10 ore.
 */
export const parseHoursMinutes = (hours: string, minutes: string): { value?: number; invalid?: true } => {
  const h = hours.trim();
  const m = minutes.trim();
  if (!h && !m) return { invalid: true };
  if ((h && !WHOLE.test(h)) || (m && !WHOLE.test(m))) return { invalid: true };
  const total = Number(h || 0) * 60 + Number(m || 0);
  const [min, max] = TIMER_LIMITS.timerMinutes;
  return { value: Math.min(max, Math.max(min, total)) };
};

/** 135 → 2 h e 15 min (per i campi ore e minuti). */
export const splitMinutes = (total: number) => ({ hours: Math.floor(total / 60), minutes: total % 60 });

