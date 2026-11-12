import type { Task } from "../types";

const safeDateMs = (value?: string) => {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : undefined;
};

const localDayMs = (value?: string) => {
  const time = safeDateMs(value);
  if (time === undefined) return undefined;
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
};

export const isTaskTimerRunning = (task: Task) => task.status === "doing" && Boolean(task.timerStartedAt);

export const taskHasTrackedTime = (task: Task) =>
  task.timerStartedAt !== undefined || task.timerAccumulatedSeconds !== undefined || task.actualMinutes !== undefined;

export const taskElapsedSeconds = (task: Task, now: Date = new Date()) => {
  const base = task.timerAccumulatedSeconds ?? (task.actualMinutes ?? 0) * 60;
  if (!isTaskTimerRunning(task)) return Math.max(0, Math.round(base));

  const startedAt = safeDateMs(task.timerStartedAt);
  if (!startedAt) return Math.max(0, Math.round(base));

  return Math.max(0, Math.round(base + (now.getTime() - startedAt) / 1000));
};

export const secondsToTaskMinutes = (seconds: number) => Math.max(0, Math.round(seconds / 60));

export const formatElapsedSeconds = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
  return `${remainingSeconds}s`;
};

export const taskReminderIntervalMinutes = (task: Task) => {
  if (task.difficulty >= 4 || task.estimatedMinutes >= 90 || task.energy === "high") return 60;
  if (task.difficulty >= 3 || task.estimatedMinutes >= 45) return 45;
  return 30;
};

export const taskReminderDue = (task: Task, now: Date = new Date()) => {
  if (!isTaskTimerRunning(task)) return false;
  const lastReminder = safeDateMs(task.timerLastReminderAt ?? task.timerStartedAt);
  if (!lastReminder) return false;
  return now.getTime() - lastReminder >= taskReminderIntervalMinutes(task) * 60_000;
};

export const isTaskCompletedLate = (task: Task) => {
  const dueDay = localDayMs(task.dueDate);
  const completedDay = localDayMs(task.completedAt);
  if (dueDay === undefined || completedDay === undefined) return false;
  return completedDay > dueDay;
};

export const taskStatusTransitionPatch = (
  task: Task,
  status: Task["status"],
  now: Date = new Date()
): Partial<Task> => {
  if (status === task.status) return { status };

  const nowIso = now.toISOString();
  const elapsedSeconds = taskElapsedSeconds(task, now);
  const hasTrackedTime = taskHasTrackedTime(task);

  if (status === "doing") {
    return {
      status,
      timerStartedAt: nowIso,
      timerAccumulatedSeconds: task.timerAccumulatedSeconds ?? (task.actualMinutes ?? 0) * 60,
      timerLastReminderAt: nowIso,
      completedAt: undefined
    };
  }

  const patch: Partial<Task> = {
    status,
    timerStartedAt: undefined
  };

  if (task.status === "doing" || task.timerStartedAt) {
    patch.timerAccumulatedSeconds = elapsedSeconds;
    patch.actualMinutes = secondsToTaskMinutes(elapsedSeconds);
    patch.timerLastReminderAt = undefined;
  }

  if (status === "done") {
    patch.completedAt = task.completedAt ?? nowIso;
    patch.timerLastReminderAt = undefined;
    if (hasTrackedTime) {
      patch.timerAccumulatedSeconds = elapsedSeconds;
      patch.actualMinutes = secondsToTaskMinutes(elapsedSeconds);
    }
  } else if (task.status === "done") {
    patch.completedAt = undefined;
  }

  return patch;
};

/** Valore iniziale del campo «Tempo impiegato»: con il timer che corre, i minuti misurati finora. */
export const taskMinutesFieldValue = (task: Task, now: Date = new Date()) => {
  if (isTaskTimerRunning(task)) return String(secondsToTaskMinutes(taskElapsedSeconds(task, now)));
  return task.actualMinutes === undefined ? "" : String(task.actualMinutes);
};

const fieldMinutes = (value: string) => (value.trim() === "" ? undefined : Number(value.trim().replace(",", ".")));

/**
 * Minuti da mandare con la modifica: niente se il campo non è cambiato, così salvare un'attività in
 * corso non tocca il timer. Una correzione porta anche `timerAccumulatedSeconds`: è il segno che i
 * minuti sono stati scritti a mano (vedi normalizeTaskPatch). Il numero va già controllato.
 */
export const editedMinutesPatch = (initial: string, draft: string): Partial<Task> => {
  const before = fieldMinutes(initial);
  const after = fieldMinutes(draft);
  if (before === after) return {};
  if (after === undefined) return { actualMinutes: undefined };
  return { actualMinutes: after, timerAccumulatedSeconds: Math.max(0, Math.round(after * 60)) };
};

export const normalizeTaskPatch = (
  task: Task,
  patch: Partial<Task>,
  now: Date = new Date()
): Partial<Task> => {
  const nowIso = now.toISOString();
  const nextStatus = patch.status ?? task.status;
  const running = isTaskTimerRunning(task);
  let normalized: Partial<Task> = { ...patch };

  if (patch.status && patch.status !== task.status) {
    normalized = { ...normalized, ...taskStatusTransitionPatch(task, patch.status, now) };
  }

  // Con il timer che corre, i minuti salvati rimandati tali e quali (senza `timerAccumulatedSeconds`,
  // vedi editedMinutesPatch) non sono una correzione: azzeravano il timer a ogni salvataggio.
  const echo = running && patch.actualMinutes === task.actualMinutes && !("timerAccumulatedSeconds" in patch);

  if ("actualMinutes" in patch && !echo) {
    if (typeof patch.actualMinutes === "number" && Number.isFinite(patch.actualMinutes)) {
      const seconds = Math.max(0, Math.round(patch.actualMinutes * 60));
      normalized.actualMinutes = patch.actualMinutes;
      normalized.timerAccumulatedSeconds = seconds;
      if (nextStatus === "doing") {
        // Il timer continua dai minuti scritti; i promemoria tengono il loro ritmo se correva già.
        normalized.timerStartedAt = nowIso;
        if (!running) normalized.timerLastReminderAt = nowIso;
      }
    } else if (nextStatus !== "doing") {
      normalized.timerAccumulatedSeconds = undefined;
    }
  }

  if (nextStatus === "doing" && !task.timerStartedAt && !normalized.timerStartedAt) {
    normalized.timerStartedAt = nowIso;
    normalized.timerAccumulatedSeconds = normalized.timerAccumulatedSeconds ?? (task.actualMinutes ?? 0) * 60;
    normalized.timerLastReminderAt = normalized.timerLastReminderAt ?? nowIso;
    normalized.completedAt = undefined;
  }

  if (nextStatus !== "doing" && task.timerStartedAt && !normalized.timerStartedAt) {
    const elapsedSeconds = taskElapsedSeconds(task, now);
    normalized.timerStartedAt = undefined;
    normalized.timerAccumulatedSeconds = normalized.timerAccumulatedSeconds ?? elapsedSeconds;
    normalized.actualMinutes = normalized.actualMinutes ?? secondsToTaskMinutes(elapsedSeconds);
  }

  return normalized;
};
