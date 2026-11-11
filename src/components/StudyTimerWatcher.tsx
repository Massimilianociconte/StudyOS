import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudyStore } from "../store/useStudyStore";
import { useNow } from "../hooks/useNow";
import { TIMER_STORAGE_KEY, formatTimerClock, isTimerIdle, timerElapsedSeconds, timerRemainingSeconds, type TimerEvent } from "../lib/studyTimer";
import { TIMER_ALERT_TEXT, TIMER_KIND_LABEL, TIMER_PHASE_LABEL, TIMER_TEXT, formatMinutes } from "../lib/labels";
import { playTimerBeep, primeTimerSound, showSystemNotification, vibrateTimer } from "../lib/timerAlerts";
import { Button } from "./ui";
import { Icon } from "./Icon";

const BASE_TITLE = "StudyOS";

type AlertAction = "start-next" | "skip-break";

interface TimerAlert {
  title: string;
  body: string;
  icon: string;
  action?: AlertAction;
}

/**
 * Sorveglia il timer di studio a livello di app (non solo nella vista Studio): a fine blocco
 * Pomodoro lo fa salvare come sessione e avvia la pausa, avvisa a fine pausa e quando il
 * cronometro raggiunge l'obiettivo (banner, suono, vibrazione, notifica se attivata), mostra il
 * tempo nel titolo della scheda e allinea il timer tra schede aperte insieme.
 */
export function StudyTimerWatcher() {
  const { timer, subjects, activeView, settleStudyTimer, markTimerTargetNotified, reloadStudyTimer, setActiveView, toggleStudyTimer, skipBreak } = useStudyStore(
    useShallow((state) => ({
      timer: state.timer,
      subjects: state.subjects,
      activeView: state.activeView,
      settleStudyTimer: state.settleStudyTimer,
      markTimerTargetNotified: state.markTimerTargetNotified,
      reloadStudyTimer: state.reloadStudyTimer,
      setActiveView: state.setActiveView,
      toggleStudyTimer: state.toggleStudyTimer,
      skipBreak: state.skipBreak
    }))
  );
  const now = useNow(1000, timer.running).getTime();
  const [alert, setAlert] = useState<TimerAlert | null>(null);
  const remaining = timerRemainingSeconds(timer, now);
  const elapsed = timerElapsedSeconds(timer, now);
  const phaseDue = timer.kind === "pomodoro" && timer.running && remaining <= 0;
  const targetDue =
    timer.kind === "stopwatch" && timer.running && timer.durationSeconds > 0 && elapsed >= timer.durationSeconds && timer.targetNotifiedSeconds !== timer.durationSeconds;

  const announce = useCallback((next: TimerAlert, notes = 2) => {
    setAlert(next);
    playTimerBeep(notes);
    vibrateTimer();
    void showSystemNotification(next.title, next.body);
  }, []);

  // Un'altra scheda ha cambiato il timer: si allinea subito (niente doppio salvataggio dei blocchi).
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === TIMER_STORAGE_KEY) reloadStudyTimer();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [reloadStudyTimer]);

  // Il suono si può usare solo dopo un gesto: il primo tocco o tasto nell'app lo sblocca.
  useEffect(() => {
    const prime = () => primeTimerSound();
    window.addEventListener("pointerdown", prime, { passive: true });
    window.addEventListener("keydown", prime);
    return () => {
      window.removeEventListener("pointerdown", prime);
      window.removeEventListener("keydown", prime);
    };
  }, []);

  useEffect(() => {
    if (!phaseDue) return;
    const event: TimerEvent | null = settleStudyTimer();
    if (!event) return;
    if (event.type === "break-done") {
      announce({ title: TIMER_ALERT_TEXT.breakDone, body: TIMER_ALERT_TEXT.breakDoneBody, icon: "Zap", action: "start-next" });
      return;
    }
    const studied = formatMinutes(event.minutes);
    const subject = subjects.find((item) => item.id === event.subjectId)?.name;
    announce({
      title: TIMER_ALERT_TEXT.focusDone(subject),
      body: event.breakEnded
        ? TIMER_ALERT_TEXT.focusDoneBreakOver(studied)
        : TIMER_ALERT_TEXT.focusDoneBody(studied, TIMER_PHASE_LABEL[event.breakPhase], formatMinutes(event.breakMinutes)),
      icon: "Check",
      action: event.breakEnded ? "start-next" : "skip-break"
    });
    // `now` ritenta a ogni secondo finché la fase non si chiude.
  }, [phaseDue, now, settleStudyTimer, announce, subjects]);

  useEffect(() => {
    if (!targetDue) return;
    markTimerTargetNotified();
    announce({ title: TIMER_ALERT_TEXT.targetReached, body: TIMER_ALERT_TEXT.targetReachedBody(formatMinutes(Math.floor(elapsed / 60))), icon: "Target" }, 3);
  }, [targetDue, elapsed, markTimerTargetNotified, announce]);

  useEffect(() => {
    if (!timer.running) {
      document.title = BASE_TITLE;
      return;
    }
    const label = timer.kind === "stopwatch" ? TIMER_KIND_LABEL.stopwatch : TIMER_PHASE_LABEL[timer.phase];
    const clock = formatTimerClock(timer.kind === "stopwatch" ? elapsed : remaining);
    document.title = `${TIMER_TEXT.tabTitle(clock, label)} · ${BASE_TITLE}`;
  }, [timer.running, timer.kind, timer.phase, elapsed, remaining]);

  useEffect(() => () => {
    document.title = BASE_TITLE;
  }, []);

  if (!alert) return null;

  const runAction = () => {
    primeTimerSound();
    setAlert(null);
    const current = useStudyStore.getState().timer;
    if (alert.action === "skip-break") skipBreak();
    else if (alert.action === "start-next" && isTimerIdle(current)) toggleStudyTimer();
  };
  const actionLabel = alert.action === "skip-break" ? TIMER_ALERT_TEXT.skipBreak : alert.action === "start-next" ? TIMER_ALERT_TEXT.startNext : null;

  return (
    <aside
      className="fixed left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 mx-auto max-w-md rounded-[28px] border border-[var(--success-border)] bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] p-4 shadow-soft backdrop-blur-2xl"
      role="status"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <span className="grid grid-cols-1 h-11 w-11 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
          <Icon name={alert.icon} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="safe-text font-black">{alert.title}</p>
          <p className="safe-text text-sm text-[var(--muted)]">{alert.body}</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => setAlert(null)}>
          {TIMER_ALERT_TEXT.close}
        </Button>
        {activeView !== "study" ? (
          <Button
            variant={actionLabel ? "soft" : "primary"}
            onClick={() => {
              setAlert(null);
              setActiveView("study");
            }}
          >
            {TIMER_ALERT_TEXT.goToStudy}
          </Button>
        ) : null}
        {actionLabel ? (
          <Button variant="primary" icon={alert.action === "skip-break" ? "SkipForward" : "Zap"} onClick={runAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
