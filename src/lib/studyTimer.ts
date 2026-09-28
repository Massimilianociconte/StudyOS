// Timer di studio basato su timestamp assoluti.
// Prima il conto alla rovescia decrementava lo store ogni secondo solo mentre la vista
// Studio era montata: cambiando pagina il timer si fermava, in background i browser
// rallentano setInterval (drift) e ogni tick ri-renderizzava l'intera app.
// Ora: `endsAt` (epoch ms) quando è in corsa, `remainingSeconds` quando è in pausa;
// il tempo residuo si calcola al render. Lo stato sopravvive al reload (localStorage).

export type TimerMode = "classic" | "pomodoro" | "deep-focus";

export interface TimerState {
  mode: TimerMode;
  running: boolean;
  /** Secondi residui quando il timer è in pausa (fonte di verità se running=false). */
  remainingSeconds: number;
  /** Istante di fine (epoch ms) quando running=true. */
  endsAt?: number;
  durationSeconds: number;
  label: string;
  linkedTaskId?: string;
}

export const TIMER_DURATIONS: Record<TimerMode, number> = {
  classic: 45 * 60,
  pomodoro: 25 * 60,
  "deep-focus": 90 * 60
};

export const TIMER_LABELS: Record<TimerMode, string> = {
  classic: "Classico",
  pomodoro: "Pomodoro",
  "deep-focus": "Deep focus"
};

const STORAGE_KEY = "studyos-study-timer";

export const defaultTimer = (mode: TimerMode = "pomodoro"): TimerState => ({
  mode,
  running: false,
  remainingSeconds: TIMER_DURATIONS[mode],
  durationSeconds: TIMER_DURATIONS[mode],
  label: TIMER_LABELS[mode]
});

export const timerRemainingSeconds = (timer: TimerState, now: number = Date.now()) => {
  if (!timer.running || timer.endsAt === undefined) return Math.max(0, Math.round(timer.remainingSeconds));
  return Math.max(0, Math.ceil((timer.endsAt - now) / 1000));
};

export const timerElapsedSeconds = (timer: TimerState, now: number = Date.now()) =>
  Math.max(0, timer.durationSeconds - timerRemainingSeconds(timer, now));

export const startTimerState = (mode: TimerMode, now: number = Date.now()): TimerState => ({
  mode,
  running: true,
  durationSeconds: TIMER_DURATIONS[mode],
  remainingSeconds: TIMER_DURATIONS[mode],
  endsAt: now + TIMER_DURATIONS[mode] * 1000,
  label: TIMER_LABELS[mode]
});

export const toggleTimerState = (timer: TimerState, now: number = Date.now()): TimerState => {
  if (timer.running) {
    return { ...timer, running: false, remainingSeconds: timerRemainingSeconds(timer, now), endsAt: undefined };
  }
  const remaining = timer.remainingSeconds > 0 ? timer.remainingSeconds : timer.durationSeconds;
  return { ...timer, running: true, remainingSeconds: remaining, endsAt: now + remaining * 1000 };
};

/** Se il timer è arrivato a zero lo ferma (idempotente). */
export const settleTimerState = (timer: TimerState, now: number = Date.now()): TimerState => {
  if (!timer.running || timerRemainingSeconds(timer, now) > 0) return timer;
  return { ...timer, running: false, remainingSeconds: 0, endsAt: undefined };
};

const isTimerState = (value: unknown): value is TimerState => {
  if (!value || typeof value !== "object") return false;
  const timer = value as TimerState;
  return (
    (timer.mode === "classic" || timer.mode === "pomodoro" || timer.mode === "deep-focus") &&
    typeof timer.running === "boolean" &&
    typeof timer.remainingSeconds === "number" &&
    typeof timer.durationSeconds === "number"
  );
};

export const loadTimer = (): TimerState => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultTimer();
    const parsed = JSON.parse(raw) as unknown;
    return isTimerState(parsed) ? settleTimerState(parsed) : defaultTimer();
  } catch {
    return defaultTimer();
  }
};

export const saveTimer = (timer: TimerState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(timer));
  } catch {
    // storage non disponibile (modalità privata): il timer resta solo in memoria
  }
};
