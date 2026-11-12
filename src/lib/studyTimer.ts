// Timer di studio basato su timestamp assoluti: Pomodoro (blocchi di studio e pause), Timer (conto
// alla rovescia di durata libera) e Cronometro. Il tempo non dipende dai tick: Pomodoro e Timer usano
// `endsAt` (epoch ms) quando sono in corsa e `remainingSeconds` quando sono in pausa; il Cronometro
// somma `accumulatedSeconds` (tratti già conclusi) e il tratto in corso da `runningSince`. Così è
// esatto anche con la scheda in background, dopo un sonno del computer o una ricarica (lo stato vive
// in localStorage). Tutto qui è puro e testabile: lo store salva lo stato e trasforma i blocchi finiti
// in sessioni. Timer e Cronometro finiti (`ended`) aspettano il riepilogo prima di diventare sessioni.
import type { StudySession, Subject } from "../types";
import { SESSION_TEMPLATE_LABEL } from "./labels";
import { createId } from "./id";
import { defaultSessionTitle } from "./studySessions";
import { DEFAULT_TIMER_DURATIONS, TIMER_LIMITS, clampTimerValue, resolveTimerDurations, type TimerDurations } from "./timerPrefs";

/** Durata di partenza (compatibilità con gli agenti): pomodoro = le durate scelte, poi 45 e 90 minuti. */
export const TIMER_MODES = ["classic", "pomodoro", "deep-focus"] as const;
export type TimerMode = (typeof TIMER_MODES)[number];
/** Modalità, nell'ordine del selettore. Gli stati salvati prima (senza "timer") restano validi. */
export const TIMER_KINDS = ["pomodoro", "timer", "stopwatch"] as const;
export type TimerKind = (typeof TIMER_KINDS)[number];
/** Fase del Pomodoro: studio, pausa breve, pausa lunga. Timer e Cronometro sono sempre "focus". */
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
  /** Pomodoro e Timer: secondi residui quando è fermo (fonte di verità se running=false). */
  remainingSeconds: number;
  /** Pomodoro e Timer: istante di fine (epoch ms) quando running=true. */
  endsAt?: number;
  /** Pomodoro: durata della fase. Timer: durata scelta. Cronometro: obiettivo in secondi (0 = nessuno). */
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
  /** "Cosa studi?": argomento della materia (StudyTopic) scelto prima di avviare. */
  topicId?: string;
  /** "Cosa studi?" scritto a mano (capitolo, lezione…): diventa il titolo della sessione. */
  title?: string;
  template?: SessionTemplate;
  /** Id della sessione che il blocco in corso diventerà: due schede o due ricariche la scrivono una volta. */
  sessionId?: string;
  /** Timer e Cronometro finiti: fermi su `pausedAt` (la fine reale), aspettano il riepilogo. */
  ended?: boolean;
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
  topicId?: string;
  title?: string;
  notes?: string;
  template?: SessionTemplate;
  source: TimerKind;
}

export interface TimerOptions {
  durations?: TimerDurations;
  subjectId?: string;
  topicId?: string;
  title?: string;
  template?: SessionTemplate;
  sessionId?: string;
  /** Cronometro: obiettivo in minuti. */
  targetMinutes?: number;
  /** Timer: durata in minuti (altrimenti quella delle durate, poi 60). */
  minutes?: number;
}

export interface TimerAdvance {
  timer: TimerState;
  /** Blocco di studio appena finito (da salvare una volta sola). */
  finishedBlock?: FinishedBlock;
  /** La pausa è finita: il timer aspetta il blocco successivo. */
  breakEnded?: boolean;
  /** Il Timer è arrivato a zero: fermo, aspetta il riepilogo. */
  timerEnded?: boolean;
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

/** Durata del Timer in secondi: limitata a 1 minuto – 10 ore, 60 minuti se manca. */
const countdownSeconds = (minutes: number | undefined) => (clampTimerValue("timerMinutes", minutes) ?? DEFAULT_TIMER_DURATIONS.timerMinutes) * 60;

const kindSeconds = (kind: TimerKind, mode: TimerMode, options: TimerOptions) =>
  kind === "stopwatch"
    ? targetSeconds(options.targetMinutes)
    : kind === "timer"
      ? countdownSeconds(options.minutes ?? options.durations?.timerMinutes)
      : focusSeconds(mode, options.durations);

/** Timer fermo e pronto: Pomodoro sul blocco di studio, Timer sulla sua durata, cronometro a zero. */
export const defaultTimer = (mode: TimerMode = "pomodoro", options: TimerOptions & { kind?: TimerKind } = {}): TimerState => {
  const kind = options.kind ?? "pomodoro";
  const duration = kindSeconds(kind, mode, options);
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
    topicId: options.topicId,
    title: options.title,
    template: options.template
  });
};

/** Secondi trascorsi: studio (o pausa) del blocco Pomodoro o del Timer, tempo totale del cronometro. */
export const timerElapsedSeconds = (timer: TimerState, now: number = Date.now()): number => {
  if (timer.kind === "stopwatch") {
    const stretch = timer.running && timer.runningSince !== undefined ? Math.max(0, (now - timer.runningSince) / 1000) : 0;
    // Il piccolo margine evita che 0,1 + 0,2 diventi 0,299… e perda un secondo.
    return Math.max(0, Math.floor(timer.accumulatedSeconds + stretch + 1e-6));
  }
  return Math.max(0, timer.durationSeconds - timerRemainingSeconds(timer, now));
};

/** Secondi che mancano: alla fine della fase (Pomodoro), del Timer o all'obiettivo (cronometro, 0 se non c'è). */
export const timerRemainingSeconds = (timer: TimerState, now: number = Date.now()): number => {
  if (timer.kind === "stopwatch") {
    return timer.durationSeconds > 0 ? Math.max(0, timer.durationSeconds - timerElapsedSeconds(timer, now)) : 0;
  }
  if (!timer.running || timer.endsAt === undefined) return Math.min(timer.durationSeconds, Math.max(0, Math.round(timer.remainingSeconds)));
  return Math.min(timer.durationSeconds, Math.max(0, Math.ceil((timer.endsAt - now) / 1000)));
};

/** 25:00, 59:59, 1:05:09 (le ore compaiono solo quando servono). */
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

/**
 * Avviso con un'azione del timer («Salta la pausa», «Avvia il prossimo blocco») che non vale più: il
 * timer ha cambiato modalità o fase da quando è comparso (Pomodoro terminato, Cronometro avviato,
 * pausa finita) o il prossimo blocco è già partito. Il pulsante non farebbe niente: l'avviso si chiude.
 */
export const timerAlertStale = (
  action: "skip-break" | "start-next",
  at: { kind: TimerKind; phase: TimerPhase },
  timer: TimerState,
  now: number = Date.now()
) => timer.kind !== at.kind || timer.phase !== at.phase || (action === "start-next" && !isTimerIdle(timer, now));

/** Avvia un blocco di studio Pomodoro (`mode` sceglie la durata se non è "pomodoro"). */
export const startTimerState = (mode: TimerMode, now: number = Date.now(), options: TimerOptions = {}): TimerState => {
  const base = defaultTimer(mode, options);
  return compact({ ...base, running: true, startedAt: now, endsAt: now + base.durationSeconds * 1000, sessionId: options.sessionId });
};

/** Avvia il Timer: conto alla rovescia di `minutes` (1 minuto – 10 ore). */
export const startCountdownState = (now: number = Date.now(), options: TimerOptions & { mode?: TimerMode } = {}): TimerState => {
  const base = defaultTimer(options.mode ?? "pomodoro", { ...options, kind: "timer" });
  return compact({ ...base, running: true, startedAt: now, endsAt: now + base.durationSeconds * 1000, sessionId: options.sessionId });
};

/** Avvia il cronometro (conta in avanti, `targetMinutes` è solo un traguardo). */
export const startStopwatchState = (now: number = Date.now(), options: TimerOptions & { mode?: TimerMode } = {}): TimerState => {
  const base = defaultTimer(options.mode ?? "pomodoro", { ...options, kind: "stopwatch" });
  return compact({ ...base, running: true, startedAt: now, runningSince: now, sessionId: options.sessionId });
};

/** Timer arrivato a zero: fermo sulla fine reale `end` (anche se l'app era chiusa), aspetta il riepilogo. */
const countdownEnded = (timer: TimerState, end: number): TimerState =>
  compact({ ...timer, running: false, remainingSeconds: 0, endsAt: undefined, pausedAt: end, ended: true });

/** Timer arrivato a zero (finito, non solo fermo): non può riprendere. */
export const isCountdownOver = (timer: TimerState) =>
  timer.kind === "timer" && !timer.running && timer.startedAt !== undefined && timer.remainingSeconds <= 0;

/**
 * Pausa ↔ ripresa (tutte le modalità, anche durante la pausa del Pomodoro). Riprendere un Timer o
 * un Cronometro finiti (`ended`) annulla la fine; un Timer arrivato a zero non riparte da capo.
 */
export const toggleTimerState = (timer: TimerState, now: number = Date.now(), options: { sessionId?: string } = {}): TimerState => {
  if (isCountdownOver(timer)) return timer;
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
    return compact({ ...timer, running: true, runningSince: now, startedAt, pausedAt: undefined, sessionId, ended: undefined });
  }
  const remaining = timer.remainingSeconds > 0 ? timer.remainingSeconds : timer.durationSeconds;
  return compact({ ...timer, running: true, remainingSeconds: remaining, endsAt: now + remaining * 1000, startedAt, pausedAt: undefined, sessionId, ended: undefined });
};

/**
 * "Termina" di Timer e Cronometro: il tempo si ferma adesso e la sessione aspetta il riepilogo.
 * Il Pomodoro non passa di qui (i suoi blocchi si salvano da soli); un timer mai avviato o già
 * finito resta com'è.
 */
export const endTimerState = (timer: TimerState, now: number = Date.now()): TimerState => {
  if (timer.kind === "pomodoro" || timer.ended || isTimerIdle(timer, now)) return timer;
  // Timer già scaduto ma non ancora chiuso: la fine è quando è scaduto, non adesso.
  if (timer.kind === "timer" && timer.running && timer.endsAt !== undefined && now >= timer.endsAt) return countdownEnded(timer, timer.endsAt);
  const stopped = timer.running ? toggleTimerState(timer, now) : timer;
  return compact({ ...stopped, ended: true, pausedAt: stopped.pausedAt ?? now });
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
 * Fa avanzare il timer arrivato alla fine della fase. Pomodoro: a fine blocco restituisce il blocco
 * da salvare e fa partire la pausa da quando il blocco è finito (anche se l'app era chiusa); se nel
 * frattempo è finita anche la pausa, il timer aspetta fermo il blocco successivo, che non parte mai
 * da solo. Timer: si ferma sulla fine reale e aspetta il riepilogo (nessuna sessione automatica).
 * Senza nulla da fare restituisce lo stesso oggetto.
 */
export const advanceTimerState = (timer: TimerState, now: number, durations: TimerDurations): TimerAdvance => {
  if (timer.kind === "stopwatch" || !timer.running || timer.endsAt === undefined || now < timer.endsAt) return { timer };
  const end = timer.endsAt;
  if (timer.kind === "timer") return { timer: countdownEnded(timer, end), timerEnded: true };
  if (timer.phase !== "focus") return { timer: focusReady(timer, durations), breakEnded: true };

  const minutes = Math.max(1, Math.round(timer.durationSeconds / 60));
  const finishedBlock = compact<FinishedBlock>({
    sessionId: timer.sessionId,
    start: timer.startedAt ?? end - timer.durationSeconds * 1000,
    end,
    actualMinutes: minutes,
    plannedMinutes: minutes,
    subjectId: timer.subjectId,
    topicId: timer.topicId,
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
 * Durate cambiate (impostazioni o materia): il blocco Pomodoro o il Timer non ancora avviati prendono
 * la nuova durata, il cronometro il nuovo obiettivo (l'avviso può ripartire). Un blocco già iniziato
 * tiene la sua durata: le nuove valgono dal prossimo. Nulla da cambiare → stesso oggetto.
 */
export const syncTimerDurations = (timer: TimerState, durations: TimerDurations, now: number = Date.now()): TimerState => {
  if (timer.kind === "stopwatch") {
    const target = targetSeconds(durations.stopwatchTargetMinutes);
    if (target === timer.durationSeconds) return timer;
    return compact({ ...timer, durationSeconds: target, remainingSeconds: target, targetNotifiedSeconds: undefined });
  }
  if (!isTimerIdle(timer, now)) return timer;
  const seconds = timer.kind === "timer" ? countdownSeconds(durations.timerMinutes) : focusSeconds(timer.mode, durations);
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
  | { type: "break-done" }
  /** Il Timer è arrivato a zero: nessuna sessione ancora, si apre il riepilogo. */
  | { type: "timer-done"; minutes: number; subjectId?: string; endedAt: number };

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
 * Sessione da salvare con "Termina e salva" o dal riepilogo: minuti senza le pause, inizio dal primo
 * avvio e fine reale (ultima pausa o fine se il timer è fermo, fine del blocco se Pomodoro o Timer
 * sono già scaduti). null durante le pause del Pomodoro (non sono studio) o sotto il minuto.
 */
export const finishedSession = (timer: TimerState, now: number = Date.now()): FinishedBlock | null => {
  if (timer.phase !== "focus") return null;
  const elapsed = timerElapsedSeconds(timer, now);
  if (elapsed < 60) return null;
  const end = timer.running
    ? timer.kind !== "stopwatch" && timer.endsAt !== undefined
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
    topicId: timer.topicId,
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
  return compact<StudySession>({
    id: block.sessionId ?? id ?? createId("session"),
    createdAt: now,
    updatedAt: now,
    archived: false,
    tags: [],
    title: block.title?.trim() || defaultSessionTitle(template, subject?.name),
    subjectId: subject?.id,
    // L'argomento vale solo con la sua materia (lo store lo controlla quando lo si sceglie).
    topicId: subject ? block.topicId : undefined,
    template,
    plannedMinutes: block.plannedMinutes,
    actualMinutes: block.actualMinutes,
    start: new Date(block.start).toISOString(),
    end: new Date(block.end).toISOString(),
    topics: [],
    perceivedDifficulty: 3,
    focusLevel: 4,
    notes: block.notes?.trim() ?? "",
    attachmentIds: [],
    status: "completed",
    source: block.source
  });
};

const MAX_POMODORO_SECONDS = TIMER_LIMITS.focusMinutes[1] * 60;
const MAX_TARGET_SECONDS = TIMER_LIMITS.stopwatchTargetMinutes[1] * 60;
const MAX_COUNTDOWN_SECONDS = TIMER_LIMITS.timerMinutes[1] * 60;

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
  const kind = timer.kind ?? "pomodoro";
  if (kind === "pomodoro") {
    if (timer.durationSeconds <= 0 || timer.durationSeconds > MAX_POMODORO_SECONDS) return false;
    return !timer.running || finite(timer.endsAt);
  }
  if (timer.phase !== undefined && timer.phase !== "focus") return false;
  if (kind === "timer") {
    if (timer.durationSeconds <= 0 || timer.durationSeconds > MAX_COUNTDOWN_SECONDS) return false;
    return !timer.running || finite(timer.endsAt);
  }
  if (timer.durationSeconds > MAX_TARGET_SECONDS) return false;
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
    phase: kind === "pomodoro" ? (raw.phase ?? "focus") : "focus",
    running: raw.running,
    remainingSeconds: Math.min(raw.remainingSeconds, raw.durationSeconds),
    endsAt: kind !== "stopwatch" && raw.running ? raw.endsAt : undefined,
    durationSeconds: raw.durationSeconds,
    cycle: finite(raw.cycle) && raw.cycle >= 0 ? Math.floor(raw.cycle) : 0,
    accumulatedSeconds: kind === "stopwatch" ? (raw.accumulatedSeconds ?? 0) : 0,
    runningSince: kind === "stopwatch" && raw.running ? raw.runningSince : undefined,
    startedAt: optionalNumber(raw.startedAt),
    pausedAt: raw.running ? undefined : optionalNumber(raw.pausedAt),
    subjectId: optionalText(raw.subjectId),
    topicId: optionalText(raw.topicId),
    title: typeof raw.title === "string" ? raw.title : undefined,
    template: typeof raw.template === "string" && Object.hasOwn(SESSION_TEMPLATE_LABEL, raw.template) ? raw.template : undefined,
    sessionId: optionalText(raw.sessionId),
    ended: raw.ended === true && !raw.running && kind !== "pomodoro" ? true : undefined,
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
