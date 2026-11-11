// Timer di studio basato su timestamp assoluti: Pomodoro (blocchi di studio e pause) e Cronometro.
// Il tempo non dipende dai tick: il Pomodoro usa `endsAt` (epoch ms) quando è in corsa e
// `remainingSeconds` quando è in pausa; il Cronometro somma `accumulatedSeconds` (tratti già
// conclusi) e il tratto in corso da `runningSince`. Così è esatto anche con la scheda in
// background, dopo un sonno del computer o una ricarica (lo stato vive in localStorage).
// Tutto qui è puro e testabile: lo store salva lo stato e trasforma i blocchi finiti in sessioni.
import type { StudySession, Subject } from "../types";
import { SESSION_TEMPLATE_LABEL } from "./labels";
import { createId } from "./id";
import { TIMER_LIMITS, resolveTimerDurations, type TimerDurations } from "./timerPrefs";

/** Durata di partenza (compatibilità con gli agenti): pomodoro = le durate scelte, poi 45 e 90 minuti. */
export const TIMER_MODES = ["classic", "pomodoro", "deep-focus"] as const;
export type TimerMode = (typeof TIMER_MODES)[number];
export const TIMER_KINDS = ["pomodoro", "stopwatch"] as const;
export type TimerKind = (typeof TIMER_KINDS)[number];
/** Fase del Pomodoro: studio, pausa breve, pausa lunga. Il cronometro è sempre "focus". */
export const TIMER_PHASES = ["focus", "short", "long"] as const;
export type TimerPhase = (typeof TIMER_PHASES)[number];
/** Azioni di `studyos_timer_control` (catalogo ed esecuzione leggono la stessa costante). */
export const TIMER_CONTROL_ACTIONS = ["start", "toggle", "reset", "finish"] as const;
export type TimerControlAction = (typeof TIMER_CONTROL_ACTIONS)[number];

export const TIMER_PRESET_MINUTES: Record<TimerMode, number> = { classic: 45, pomodoro: 25, "deep-focus": 90 };

export const TIMER_STORAGE_KEY = "studyos-study-timer";

type SessionTemplate = StudySession["template"];

export interface TimerState {
  mode: TimerMode;
  kind: TimerKind;
  phase: TimerPhase;
  running: boolean;
  /** Pomodoro: secondi residui quando è fermo (fonte di verità se running=false). */
  remainingSeconds: number;
  /** Pomodoro: istante di fine (epoch ms) quando running=true. */
  endsAt?: number;
  /** Pomodoro: durata della fase. Cronometro: obiettivo in secondi (0 = nessuno). */
  durationSeconds: number;
  /** Blocchi di studio finiti nel giro in corso (si azzera dopo la pausa lunga). */
  cycle: number;
  /** Cronometro: secondi contati nei tratti già conclusi (le pause non contano). */
  accumulatedSeconds: number;
  /** Cronometro: inizio del tratto in corso (epoch ms). */
  runningSince?: number;
  /** Primo avvio del blocco o della sessione: inizio reale della sessione salvata. */
  startedAt?: number;
  /** Ultima pausa: fine reale se si termina mentre il timer è fermo. */
  pausedAt?: number;
  subjectId?: string;
  title?: string;
  template?: SessionTemplate;
  /** Id della sessione che il blocco in corso diventerà: due schede o due ricariche la scrivono una volta. */
  sessionId?: string;
  /** Cronometro: obiettivo (secondi) per cui l'avviso è già partito. */
  targetNotifiedSeconds?: number;
  /** Ultima modifica (epoch ms): tra due schede vince lo stato più recente. */
  changedAt?: number;
}

/** Blocco di studio concluso, pronto per diventare una sessione. */
export interface FinishedBlock {
  sessionId?: string;
  start: number;
  end: number;
  actualMinutes: number;
  plannedMinutes: number;
  subjectId?: string;
  title?: string;
  template?: SessionTemplate;
  source: "pomodoro" | "stopwatch";
}

export interface TimerOptions {
  durations?: TimerDurations;
  subjectId?: string;
  title?: string;
  template?: SessionTemplate;
  sessionId?: string;
  /** Cronometro: obiettivo in minuti. */
  targetMinutes?: number;
}

export interface TimerAdvance {
  timer: TimerState;
  /** Blocco di studio appena finito (da salvare una volta sola). */
  finishedBlock?: FinishedBlock;
  /** La pausa è finita: il timer aspetta il blocco successivo. */
  breakEnded?: boolean;
}

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const includes = <T extends string>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);

/** Toglie le chiavi undefined: lo stato salvato e ricaricato resta identico (JSON le perde). */
const compact = <T extends object>(value: T): T => {
  for (const key of Object.keys(value) as Array<keyof T>) if (value[key] === undefined) delete value[key];
  return value;
};

const focusSeconds = (mode: TimerMode, durations?: TimerDurations) =>
  (mode === "pomodoro" && durations ? durations.focusMinutes : TIMER_PRESET_MINUTES[mode]) * 60;

const targetSeconds = (minutes: number | undefined) => (finite(minutes) && minutes > 0 ? Math.round(minutes) * 60 : 0);

/** Timer fermo e pronto: Pomodoro sul blocco di studio, o cronometro a zero. */
export const defaultTimer = (mode: TimerMode = "pomodoro", options: TimerOptions & { kind?: TimerKind } = {}): TimerState => {
  const kind = options.kind ?? "pomodoro";
  const duration = kind === "stopwatch" ? targetSeconds(options.targetMinutes) : focusSeconds(mode, options.durations);
  return compact({
    mode,
    kind,
    phase: "focus",
    running: false,
    remainingSeconds: duration,
    durationSeconds: duration,
    cycle: 0,
    accumulatedSeconds: 0,
    subjectId: options.subjectId,
    title: options.title,
    template: options.template
  });
};

/** Secondi trascorsi: studio (o pausa) del blocco Pomodoro in corso, tempo totale del cronometro. */
export const timerElapsedSeconds = (timer: TimerState, now: number = Date.now()): number => {
  if (timer.kind === "stopwatch") {
    const stretch = timer.running && timer.runningSince !== undefined ? Math.max(0, (now - timer.runningSince) / 1000) : 0;
    // Il piccolo margine evita che 0,1 + 0,2 diventi 0,299… e perda un secondo.
    return Math.max(0, Math.floor(timer.accumulatedSeconds + stretch + 1e-6));
  }
  return Math.max(0, timer.durationSeconds - timerRemainingSeconds(timer, now));
};

/** Secondi che mancano: alla fine della fase (Pomodoro) o all'obiettivo (cronometro, 0 se non c'è). */
export const timerRemainingSeconds = (timer: TimerState, now: number = Date.now()): number => {
  if (timer.kind === "stopwatch") {
    return timer.durationSeconds > 0 ? Math.max(0, timer.durationSeconds - timerElapsedSeconds(timer, now)) : 0;
  }
  if (!timer.running || timer.endsAt === undefined) return Math.min(timer.durationSeconds, Math.max(0, Math.round(timer.remainingSeconds)));
  return Math.min(timer.durationSeconds, Math.max(0, Math.ceil((timer.endsAt - now) / 1000)));
};

/** 25:00, 59:59, 1:05:09 (le ore compaiono solo nel cronometro lungo). */
export const formatTimerClock = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const rest = String(total % 60).padStart(2, "0");
  return hours ? `${hours}:${minutes}:${rest}` : `${minutes}:${rest}`;
};

/** Secondi di studio non ancora salvati (le pause del Pomodoro non sono studio). */
export const timerUnsavedSeconds = (timer: TimerState, now: number = Date.now()) =>
  timer.phase === "focus" ? timerElapsedSeconds(timer, now) : 0;

/** Timer nuovo: mai avviato in questo blocco, niente da salvare o scartare. */
export const isTimerIdle = (timer: TimerState, now: number = Date.now()) =>
  !timer.running && timer.phase === "focus" && timer.startedAt === undefined && timerElapsedSeconds(timer, now) === 0;

/** Avvia un blocco di studio Pomodoro (`mode` sceglie la durata se non è "pomodoro"). */
export const startTimerState = (mode: TimerMode, now: number = Date.now(), options: TimerOptions = {}): TimerState => {
  const base = defaultTimer(mode, options);
  return compact({ ...base, running: true, startedAt: now, endsAt: now + base.durationSeconds * 1000, sessionId: options.sessionId });
};

/** Avvia il cronometro (conta in avanti, `targetMinutes` è solo un traguardo). */
export const startStopwatchState = (now: number = Date.now(), options: TimerOptions & { mode?: TimerMode } = {}): TimerState => {
  const base = defaultTimer(options.mode ?? "pomodoro", { ...options, kind: "stopwatch" });
  return compact({ ...base, running: true, startedAt: now, runningSince: now, sessionId: options.sessionId });
};

/** Pausa ↔ ripresa (entrambe le modalità, anche durante la pausa del Pomodoro). */
export const toggleTimerState = (timer: TimerState, now: number = Date.now(), options: { sessionId?: string } = {}): TimerState => {
  if (timer.running) {
    if (timer.kind === "stopwatch") {
      const stretch = timer.runningSince !== undefined ? Math.max(0, (now - timer.runningSince) / 1000) : 0;
      return compact({ ...timer, running: false, accumulatedSeconds: timer.accumulatedSeconds + stretch, runningSince: undefined, pausedAt: now });
    }
    return compact({ ...timer, running: false, remainingSeconds: timerRemainingSeconds(timer, now), endsAt: undefined, pausedAt: now });
  }
  // Uno stato della versione precedente non ha l'inizio: si ricava dai minuti già fatti.
  const startedAt = timer.startedAt ?? now - timerElapsedSeconds(timer, now) * 1000;
  const sessionId = timer.sessionId ?? (timer.phase === "focus" ? options.sessionId : undefined);
  if (timer.kind === "stopwatch") {
    return compact({ ...timer, running: true, runningSince: now, startedAt, pausedAt: undefined, sessionId });
  }
  const remaining = timer.remainingSeconds > 0 ? timer.remainingSeconds : timer.durationSeconds;
  return compact({ ...timer, running: true, remainingSeconds: remaining, endsAt: now + remaining * 1000, startedAt, pausedAt: undefined, sessionId });
};

/** Fase successiva: dopo `longBreakEvery` blocchi la pausa lunga, dopo la pausa lunga si riparte da 0. */
export const nextPhase = (phase: TimerPhase, cycle: number, longBreakEvery: number): { phase: TimerPhase; cycle: number } => {
  if (phase === "focus") {
    const done = cycle + 1;
    return { phase: done >= longBreakEvery ? "long" : "short", cycle: done };
  }
  return { phase: "focus", cycle: phase === "long" ? 0 : cycle };
};

/** Blocco di studio pronto (fermo) dopo una pausa. */
const focusReady = (timer: TimerState, durations: TimerDurations): TimerState => {
  const seconds = focusSeconds(timer.mode, durations);
  return compact({
    ...timer,
    phase: "focus",
    cycle: nextPhase(timer.phase, timer.cycle, durations.longBreakEvery).cycle,
    running: false,
    durationSeconds: seconds,
    remainingSeconds: seconds,
    endsAt: undefined,
    startedAt: undefined,
    pausedAt: undefined,
    sessionId: undefined
  });
};

/**
 * Fa avanzare il Pomodoro arrivato alla fine della fase. A fine blocco restituisce il blocco da
 * salvare e fa partire la pausa da quando il blocco è finito (anche se l'app era chiusa); se nel
 * frattempo è finita anche la pausa, il timer aspetta fermo il blocco successivo. Il blocco
 * successivo non parte mai da solo. Senza nulla da fare restituisce lo stesso oggetto.
 */
export const advanceTimerState = (timer: TimerState, now: number, durations: TimerDurations): TimerAdvance => {
  if (timer.kind !== "pomodoro" || !timer.running || timer.endsAt === undefined || now < timer.endsAt) return { timer };
  const end = timer.endsAt;
  if (timer.phase !== "focus") return { timer: focusReady(timer, durations), breakEnded: true };

  const minutes = Math.max(1, Math.round(timer.durationSeconds / 60));
  const finishedBlock = compact<FinishedBlock>({
    sessionId: timer.sessionId,
    start: timer.startedAt ?? end - timer.durationSeconds * 1000,
    end,
    actualMinutes: minutes,
    plannedMinutes: minutes,
    subjectId: timer.subjectId,
    title: timer.title,
    template: timer.template,
    source: "pomodoro"
  });
  const next = nextPhase("focus", timer.cycle, durations.longBreakEvery);
  const breakSeconds = (next.phase === "long" ? durations.longBreakMinutes : durations.shortBreakMinutes) * 60;
  const onBreak = compact<TimerState>({
    ...timer,
    phase: next.phase,
    cycle: next.cycle,
    running: true,
    startedAt: end,
    endsAt: end + breakSeconds * 1000,
    durationSeconds: breakSeconds,
    remainingSeconds: breakSeconds,
    pausedAt: undefined,
    sessionId: undefined
  });
  if (now < end + breakSeconds * 1000) return { timer: onBreak, finishedBlock };
  return { timer: focusReady(onBreak, durations), finishedBlock, breakEnded: true };
};

/**
 * Durate cambiate (impostazioni o materia): il blocco Pomodoro non ancora avviato prende la nuova
 * durata, il cronometro il nuovo obiettivo (l'avviso può ripartire). Un blocco già iniziato tiene la
 * sua durata: le nuove valgono dal prossimo. Nulla da cambiare → stesso oggetto.
 */
export const syncTimerDurations = (timer: TimerState, durations: TimerDurations, now: number = Date.now()): TimerState => {
  if (timer.kind === "stopwatch") {
    const target = targetSeconds(durations.stopwatchTargetMinutes);
    if (target === timer.durationSeconds) return timer;
    return compact({ ...timer, durationSeconds: target, remainingSeconds: target, targetNotifiedSeconds: undefined });
  }
  if (!isTimerIdle(timer, now)) return timer;
  const seconds = focusSeconds(timer.mode, durations);
  if (seconds === timer.durationSeconds && seconds === timer.remainingSeconds) return timer;
  return { ...timer, durationSeconds: seconds, remainingSeconds: seconds };
};

/** Cosa è successo chiudendo una fase (per l'avviso). */
export type TimerEvent =
  | {
      type: "focus-done";
      /** Sessione appena salvata; null se un'altra scheda l'aveva già salvata. */
      session: StudySession | null;
      minutes: number;
      subjectId?: string;
      breakPhase: TimerPhase;
      breakMinutes: number;
      /** Anche la pausa è già finita (app chiusa a lungo). */
      breakEnded: boolean;
    }
  | { type: "break-done" };

/** Esito di "Termina e salva". */
export type TimerFinish =
  | { status: "saved"; session: StudySession }
  /** Pausa del Pomodoro: il giro finisce, nulla da salvare (i blocchi finiti sono già salvati). */
  | { status: "ended" }
  | { status: "too-short" }
  | { status: "idle" };

/** Solo lo stato dopo l'avanzamento (compatibilità): il blocco finito va salvato da chi chiama. */
export const settleTimerState = (timer: TimerState, now: number = Date.now(), durations: TimerDurations = resolveTimerDurations()) =>
  advanceTimerState(timer, now, durations).timer;

/** Salta la pausa: il blocco di studio successivo parte subito. */
export const skipBreakState = (timer: TimerState, now: number, durations: TimerDurations, sessionId?: string): TimerState => {
  if (timer.kind !== "pomodoro" || timer.phase === "focus") return timer;
  const ready = focusReady(timer, durations);
  return compact({ ...ready, running: true, startedAt: now, endsAt: now + ready.durationSeconds * 1000, sessionId });
};

/**
 * Sessione da salvare con "Termina e salva": minuti senza le pause, inizio dal primo avvio e fine
 * reale (ultima pausa se il timer è fermo, fine del blocco se il Pomodoro è già scaduto).
 * null durante le pause del Pomodoro (non sono studio) o sotto il minuto.
 */
export const finishedSession = (timer: TimerState, now: number = Date.now()): FinishedBlock | null => {
  if (timer.phase !== "focus") return null;
  const elapsed = timerElapsedSeconds(timer, now);
  if (elapsed < 60) return null;
  const end = timer.running
    ? timer.kind === "pomodoro" && timer.endsAt !== undefined
      ? Math.min(now, timer.endsAt)
      : now
    : (timer.pausedAt ?? now);
  const actualMinutes = Math.max(1, Math.round(elapsed / 60));
  return compact<FinishedBlock>({
    sessionId: timer.sessionId,
    start: timer.startedAt ?? end - elapsed * 1000,
    end,
    actualMinutes,
    plannedMinutes: timer.durationSeconds > 0 ? Math.max(1, Math.round(timer.durationSeconds / 60)) : actualMinutes,
    subjectId: timer.subjectId,
    title: timer.title,
    template: timer.template,
    source: timer.kind
  });
};

/** StudySession completata da un blocco finito. L'id del blocco vince: niente doppioni tra schede. */
export const sessionFromBlock = (
  block: FinishedBlock,
  { subjects, now, id }: { subjects: ReadonlyArray<Pick<Subject, "id" | "name">>; now: string; id?: string }
): StudySession => {
  const subject = block.subjectId ? subjects.find((item) => item.id === block.subjectId) : undefined;
  const template = block.template ?? "new-topic";
  return {
    id: block.sessionId ?? id ?? createId("session"),
    createdAt: now,
    updatedAt: now,
    archived: false,
    tags: [],
    title: block.title?.trim() || `${SESSION_TEMPLATE_LABEL[template]}${subject ? ` · ${subject.name}` : ""}`,
    subjectId: subject?.id,
    template,
    plannedMinutes: block.plannedMinutes,
    actualMinutes: block.actualMinutes,
    start: new Date(block.start).toISOString(),
    end: new Date(block.end).toISOString(),
    topics: [],
    perceivedDifficulty: 3,
    focusLevel: 4,
    notes: "",
    attachmentIds: [],
    status: "completed",
    source: block.source
  };
};

const MAX_POMODORO_SECONDS = TIMER_LIMITS.focusMinutes[1] * 60;
const MAX_TARGET_SECONDS = TIMER_LIMITS.stopwatchTargetMinutes[1] * 60;

/** Stato salvato plausibile: tipi giusti, durate nei limiti, un timer in corsa sa quando finisce. */
export const isTimerState = (value: unknown): value is TimerState => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const timer = value as Record<string, unknown>;
  if (!includes(TIMER_MODES, timer.mode) || typeof timer.running !== "boolean") return false;
  if (!finite(timer.remainingSeconds) || timer.remainingSeconds < 0) return false;
  if (!finite(timer.durationSeconds) || timer.durationSeconds < 0) return false;
  if (timer.kind !== undefined && !includes(TIMER_KINDS, timer.kind)) return false;
  if (timer.phase !== undefined && !includes(TIMER_PHASES, timer.phase)) return false;
  if (timer.accumulatedSeconds !== undefined && (!finite(timer.accumulatedSeconds) || timer.accumulatedSeconds < 0)) return false;
  if ((timer.kind ?? "pomodoro") === "pomodoro") {
    if (timer.durationSeconds <= 0 || timer.durationSeconds > MAX_POMODORO_SECONDS) return false;
    return !timer.running || finite(timer.endsAt);
  }
  if (timer.durationSeconds > MAX_TARGET_SECONDS || (timer.phase !== undefined && timer.phase !== "focus")) return false;
  return !timer.running || finite(timer.runningSince);
};

/** Stato salvato → stato valido: i campi facoltativi non validi si scartano; stato rotto → predefinito. */
export const normalizeTimer = (value: unknown): TimerState => {
  if (!isTimerState(value)) return defaultTimer();
  const raw = value as TimerState & Record<string, unknown>;
  const kind = raw.kind ?? "pomodoro";
  const optionalNumber = (field: unknown) => (finite(field) ? field : undefined);
  const optionalText = (field: unknown) => (typeof field === "string" && field ? field : undefined);
  return compact<TimerState>({
    mode: raw.mode,
    kind,
    phase: kind === "stopwatch" ? "focus" : (raw.phase ?? "focus"),
    running: raw.running,
    remainingSeconds: Math.min(raw.remainingSeconds, raw.durationSeconds),
    endsAt: kind === "pomodoro" && raw.running ? raw.endsAt : undefined,
    durationSeconds: raw.durationSeconds,
    cycle: finite(raw.cycle) && raw.cycle >= 0 ? Math.floor(raw.cycle) : 0,
    accumulatedSeconds: kind === "stopwatch" ? (raw.accumulatedSeconds ?? 0) : 0,
    runningSince: kind === "stopwatch" && raw.running ? raw.runningSince : undefined,
    startedAt: optionalNumber(raw.startedAt),
    pausedAt: raw.running ? undefined : optionalNumber(raw.pausedAt),
    subjectId: optionalText(raw.subjectId),
    title: typeof raw.title === "string" ? raw.title : undefined,
    template: typeof raw.template === "string" && Object.hasOwn(SESSION_TEMPLATE_LABEL, raw.template) ? raw.template : undefined,
    sessionId: optionalText(raw.sessionId),
    targetNotifiedSeconds: optionalNumber(raw.targetNotifiedSeconds),
    changedAt: optionalNumber(raw.changedAt)
  });
};

type TimerStorage = Pick<Storage, "getItem" | "setItem">;

const browserStorage = (): TimerStorage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** Stato salvato (anche dalla versione precedente). Un blocco scaduto mentre l'app era chiusa lo chiude lo store. */
export const loadTimer = (storage: TimerStorage | null = browserStorage()): TimerState => {
  try {
    const raw = storage?.getItem(TIMER_STORAGE_KEY);
    return raw ? normalizeTimer(JSON.parse(raw)) : defaultTimer();
  } catch {
    return defaultTimer();
  }
};

export const saveTimer = (timer: TimerState, storage: TimerStorage | null = browserStorage()) => {
  try {
    storage?.setItem(TIMER_STORAGE_KEY, JSON.stringify(timer));
  } catch {
    // storage non disponibile (modalità privata): il timer resta solo in memoria
  }
};
