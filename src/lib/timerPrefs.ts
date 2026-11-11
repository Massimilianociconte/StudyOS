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
}

export const TIMER_SETTING_KEYS = ["focusMinutes", "shortBreakMinutes", "longBreakMinutes", "longBreakEvery", "stopwatchTargetMinutes"] as const satisfies readonly TimerSettingKey[];

/** Limiti (minimo, massimo) di ogni valore. */
export const TIMER_LIMITS: Record<TimerSettingKey, readonly [number, number]> = {
  focusMinutes: [1, 240],
  shortBreakMinutes: [1, 60],
  longBreakMinutes: [1, 60],
  longBreakEvery: [1, 12],
  stopwatchTargetMinutes: [1, 600]
};

/** 25 minuti di studio, 5 di pausa, 15 di pausa lunga ogni 4 blocchi. */
export const DEFAULT_TIMER_DURATIONS = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 } as const;

/** Durate rapide per il blocco di studio (si può sempre scrivere un numero qualsiasi). */
export const FOCUS_QUICK_PICKS = [25, 45, 90] as const;

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
  stopwatchTargetMinutes: pick("stopwatchTargetMinutes", subject, preferences)
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
