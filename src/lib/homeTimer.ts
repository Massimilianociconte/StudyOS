// Riassunto del timer di studio per la Home («Pomodoro · Chimica · 18:42»). Puro: legge lo stato del
// timer dello store senza cambiarlo; la Home lo ridisegna ogni secondo solo mentre il timer corre.
import type { Subject } from "../types";
import { TIMER_KIND_LABEL, TIMER_PHASE_LABEL } from "./labels";
import { HOME_TIMER_TEXT } from "./labels/home";
import { formatTimerClock, isTimerIdle, timerElapsedSeconds, timerRemainingSeconds, type TimerState } from "./studyTimer";

export interface HomeTimerSummary {
  state: "running" | "paused" | "ended";
  /** Icona come nell'anello di Studio: modalità, o la tazza durante la pausa del Pomodoro. */
  icon: string;
  /** Modalità e materia: si accorcia per prima se lo spazio non basta. */
  lead: string;
  /** Tempo (e stato se fermo): resta sempre leggibile. */
  tail: string;
  text: string;
}

const KIND_ICON: Record<TimerState["kind"], string> = { pomodoro: "Timer", timer: "Hourglass", stopwatch: "Clock" };

/** null se il timer non è mai partito (niente da mostrare: resta «Inizia a studiare»). */
export const homeTimerSummary = (timer: TimerState, subjects: ReadonlyArray<Pick<Subject, "id" | "name">>, now: number): HomeTimerSummary | null => {
  if (isTimerIdle(timer, now)) return null;
  const onBreak = timer.kind === "pomodoro" && timer.phase !== "focus";
  const label = onBreak ? TIMER_PHASE_LABEL[timer.phase] : TIMER_KIND_LABEL[timer.kind];
  const subject = subjects.find((item) => item.id === timer.subjectId)?.name ?? "";
  const clock = formatTimerClock(timer.kind === "stopwatch" ? timerElapsedSeconds(timer, now) : timerRemainingSeconds(timer, now));
  const state = timer.ended ? "ended" : timer.running ? "running" : "paused";
  const status = state === "ended" ? HOME_TIMER_TEXT.ended : state === "paused" ? HOME_TIMER_TEXT.paused : "";
  const lead = [label, subject].filter(Boolean).join(" · ");
  const tail = [clock, status].filter(Boolean).join(" · ");
  return { state, icon: onBreak ? "Coffee" : KIND_ICON[timer.kind], lead, tail, text: `${lead} · ${tail}` };
};
