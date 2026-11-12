import { Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudyStore } from "../store/useStudyStore";
import { useNow } from "../hooks/useNow";
import { TIMER_STORAGE_KEY, formatTimerClock, isTimerIdle, timerElapsedSeconds, timerRemainingSeconds, type TimerEvent, type TimerState } from "../lib/studyTimer";
import { SESSION_FORM_TEXT, TIMER_ALERT_TEXT, TIMER_KIND_LABEL, TIMER_PHASE_LABEL, TIMER_TEXT, formatMinutes } from "../lib/labels";
import { UNDO_MS, type SessionLinks } from "../lib/studySessions";
import { playTimerBeep, primeTimerSound, showSystemNotification, vibrateTimer } from "../lib/timerAlerts";
import type { StudySession } from "../types";
import { Button } from "./ui";
import { Icon } from "./Icon";

// Riepilogo e modifica delle sessioni: caricati alla prima apertura, fuori dal bundle d'ingresso.
// Come ShareButton: si monta solo dopo che il pezzo di app è arrivato. Il watcher sta fuori dai
// ViewErrorBoundary: un import fallito dentro `lazy` farebbe cadere tutta l'app.
const loadDrawers = () => import("./StudySessionDrawers");
const TimerReviewDrawer = lazy(() => loadDrawers().then((module) => ({ default: module.TimerReviewDrawer })));
const SessionEditorDrawer = lazy(() => loadDrawers().then((module) => ({ default: module.SessionEditorDrawer })));

const BASE_TITLE = "StudyOS";

type AlertAction = "start-next" | "skip-break";

interface TimerAlert {
  title: string;
  body?: string;
  icon: string;
  action?: AlertAction;
  /** "Modifica": la sessione appena salvata (blocco Pomodoro o riepilogo). */
  sessionId?: string;
  /** "Annulla": rimette com'era (sessione eliminata, timer scartato). */
  undo?: () => void;
  /** Avvisi del timer: da un'altra sezione portano a Studio. */
  goToStudy?: boolean;
  /** Conferme brevi: spariscono da sole. */
  autoClose?: boolean;
}

/** Un avviso arrivato più tardi (app chiusa, telefono bloccato) non suona: basta quello che si vede. */
const FRESH_MS = 15_000;

/**
 * Sorveglia il timer di studio a livello di app (non solo nella vista Studio): a fine blocco
 * Pomodoro lo fa salvare come sessione e avvia la pausa, avvisa a fine pausa e quando il cronometro
 * raggiunge l'obiettivo (banner, suono, vibrazione, notifica se attivata). A fine Timer, con
 * "Termina" e alla riapertura dell'app con un Timer finito apre il riepilogo prima di salvare.
 * Mostra il tempo nel titolo della scheda e allinea il timer tra schede aperte insieme.
 */
export function StudyTimerWatcher() {
  const {
    timer,
    subjects,
    loading,
    activeView,
    settleStudyTimer,
    markTimerTargetNotified,
    reloadStudyTimer,
    setActiveView,
    toggleStudyTimer,
    skipBreak,
    setTimerReviewOpen,
    restoreStudyTimer,
    restoreSession,
    updateSession,
    reviewWanted
  } = useStudyStore(
    useShallow((state) => ({
      reviewWanted: state.timerReview && state.timer.ended === true,
      timer: state.timer,
      subjects: state.subjects,
      loading: state.loading,
      activeView: state.activeView,
      settleStudyTimer: state.settleStudyTimer,
      markTimerTargetNotified: state.markTimerTargetNotified,
      reloadStudyTimer: state.reloadStudyTimer,
      setActiveView: state.setActiveView,
      toggleStudyTimer: state.toggleStudyTimer,
      skipBreak: state.skipBreak,
      setTimerReviewOpen: state.setTimerReviewOpen,
      restoreStudyTimer: state.restoreStudyTimer,
      restoreSession: state.restoreSession,
      updateSession: state.updateSession
    }))
  );
  const now = useNow(1000, timer.running).getTime();
  const [alert, setAlert] = useState<TimerAlert | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Una volta caricati restano montati: servono per l'animazione di chiusura e per i doppi tocchi.
  const [reviewMounted, setReviewMounted] = useState(false);
  const [editorMounted, setEditorMounted] = useState(false);
  if (reviewWanted && !reviewMounted) setReviewMounted(true);
  if (editingId && !editorMounted) setEditorMounted(true);

  // Scaricati alla prima richiesta. Se non arrivano (offline, scheda aperta prima di un aggiornamento)
  // non si monta niente: il riepilogo resta da fare (timer.ended), si chiude solo il foglio, e alla
  // richiesta successiva ("Rivedi e salva", "Modifica") si riprova.
  const [drawersReady, setDrawersReady] = useState(false);
  const loadingDrawers = useRef(false);
  const wantDrawers = reviewWanted || editingId !== null;
  useEffect(() => {
    if (!wantDrawers || drawersReady || loadingDrawers.current) return;
    loadingDrawers.current = true;
    loadDrawers().then(
      () => {
        loadingDrawers.current = false;
        setDrawersReady(true);
      },
      () => {
        loadingDrawers.current = false;
        const review = useStudyStore.getState().timerReview;
        setTimerReviewOpen(false);
        setEditingId(null);
        setAlert(
          review
            ? { title: SESSION_FORM_TEXT.loadFailedReview, body: SESSION_FORM_TEXT.loadFailedReviewBody, icon: "AlertTriangle", goToStudy: true }
            : { title: SESSION_FORM_TEXT.loadFailedEdit, body: SESSION_FORM_TEXT.loadFailedEditBody, icon: "AlertTriangle", autoClose: true }
        );
      }
    );
  }, [wantDrawers, drawersReady, setTimerReviewOpen]);
  const remaining = timerRemainingSeconds(timer, now);
  const elapsed = timerElapsedSeconds(timer, now);
  // Pomodoro e Timer contano alla rovescia: a zero si chiude la fase.
  const phaseDue = timer.kind !== "stopwatch" && timer.running && remaining <= 0;
  const targetDue =
    timer.kind === "stopwatch" && timer.running && timer.durationSeconds > 0 && elapsed >= timer.durationSeconds && timer.targetNotifiedSeconds !== timer.durationSeconds;

  /** Suono, vibrazione e notifica di sistema (se attivata): solo per avvisi appena successi. */
  const ring = useCallback((title: string, body: string, notes = 2) => {
    playTimerBeep(notes);
    vibrateTimer();
    void showSystemNotification(title, body);
  }, []);

  // `sound: false` quando un'altra scheda ha già avvisato (blocco salvato là) o l'avviso è vecchio.
  const announce = useCallback(
    (next: TimerAlert, notes = 2, sound = true) => {
      setAlert(next);
      if (sound) ring(next.title, next.body ?? "", notes);
    },
    [ring]
  );

  // Un'altra scheda ha cambiato il timer: si allinea subito (niente doppio salvataggio dei blocchi).
  // Anche tornando sulla scheda (o dalla cache del browser): l'evento "storage" può essersi perso.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === TIMER_STORAGE_KEY) reloadStudyTimer();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") reloadStudyTimer();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pageshow", reloadStudyTimer);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pageshow", reloadStudyTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
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

  // Riaprendo l'app con un Timer o Cronometro finito e non ancora salvato, il riepilogo è lì.
  const checkedAtStart = useRef(false);
  useEffect(() => {
    if (loading || checkedAtStart.current) return;
    checkedAtStart.current = true;
    if (useStudyStore.getState().timer.ended) setTimerReviewOpen(true);
  }, [loading, setTimerReviewOpen]);

  // Chiudere l'avviso a mano o da solo (conferme brevi).
  useEffect(() => {
    if (!alert?.autoClose) return undefined;
    const id = window.setTimeout(() => setAlert(null), UNDO_MS);
    return () => window.clearTimeout(id);
  }, [alert]);

  useEffect(() => {
    if (!phaseDue) return;
    const event: TimerEvent | null = settleStudyTimer();
    if (!event) return;
    if (event.type === "break-done") {
      announce({ title: TIMER_ALERT_TEXT.breakDone, body: TIMER_ALERT_TEXT.breakDoneBody, icon: "Zap", action: "start-next", goToStudy: true });
      return;
    }
    const studied = formatMinutes(event.minutes);
    const subject = subjects.find((item) => item.id === event.subjectId)?.name;
    if (event.type === "timer-done") {
      // Il riepilogo si apre da solo (lo store l'ha segnato): qui solo suono e notifica, se è appena finito.
      setAlert(null);
      if (Date.now() - event.endedAt <= FRESH_MS) ring(TIMER_ALERT_TEXT.timerDone(subject), TIMER_ALERT_TEXT.timerDoneBody(studied), 3);
      return;
    }
    announce(
      {
        title: TIMER_ALERT_TEXT.focusDone(subject),
        body: event.breakEnded
          ? TIMER_ALERT_TEXT.focusDoneBreakOver(studied)
          : TIMER_ALERT_TEXT.focusDoneBody(studied, TIMER_PHASE_LABEL[event.breakPhase], formatMinutes(event.breakMinutes)),
        icon: "Check",
        action: event.breakEnded ? "start-next" : "skip-break",
        sessionId: event.session?.id,
        goToStudy: true
      },
      2,
      event.session !== null
    );
    // `now` ritenta a ogni secondo finché la fase non si chiude.
  }, [phaseDue, now, settleStudyTimer, announce, ring, subjects]);

  useEffect(() => {
    if (!targetDue) return;
    markTimerTargetNotified();
    announce(
      { title: TIMER_ALERT_TEXT.targetReached, body: TIMER_ALERT_TEXT.targetReachedBody(formatMinutes(Math.floor(elapsed / 60))), icon: "Target", goToStudy: true },
      3
    );
  }, [targetDue, elapsed, markTimerTargetNotified, announce]);

  useEffect(() => {
    if (!timer.running) {
      document.title = BASE_TITLE;
      return;
    }
    const label = timer.kind === "pomodoro" ? TIMER_PHASE_LABEL[timer.phase] : TIMER_KIND_LABEL[timer.kind];
    const clock = formatTimerClock(timer.kind === "stopwatch" ? elapsed : remaining);
    document.title = `${TIMER_TEXT.tabTitle(clock, label)} · ${BASE_TITLE}`;
  }, [timer.running, timer.kind, timer.phase, elapsed, remaining]);

  useEffect(() => () => {
    document.title = BASE_TITLE;
  }, []);

  const onReviewSaved = (session: StudySession) => {
    setAlert({ title: SESSION_FORM_TEXT.saved(formatMinutes(session.actualMinutes)), icon: "Check", sessionId: session.id, autoClose: true });
  };
  const onReviewDiscarded = (previous: TimerState, studied: string) => {
    setAlert({
      title: SESSION_FORM_TEXT.discarded(studied),
      icon: "Trash2",
      autoClose: true,
      // Non si torna indietro se nel frattempo è partita un'altra sessione.
      undo: () => {
        if (!restoreStudyTimer(previous)) setAlert({ title: TIMER_TEXT.switchBlocked, icon: "Timer", autoClose: true });
      }
    });
  };
  // Come dopo Elimina: conferma con "Annulla", che rimette i valori di prima.
  const onSessionUpdated = (session: StudySession, undo: Partial<StudySession>) => {
    setAlert({ title: SESSION_FORM_TEXT.updated, icon: "Check", autoClose: true, undo: () => void updateSession(session.id, undo) });
  };
  const onSessionDeleted = (session: StudySession, links: SessionLinks) => {
    setAlert({ title: SESSION_FORM_TEXT.deleted(session.title), icon: "Trash2", autoClose: true, undo: () => void restoreSession(session, links) });
  };

  const drawers = drawersReady ? (
    <Suspense fallback={null}>
      {reviewMounted ? <TimerReviewDrawer onSaved={onReviewSaved} onDiscarded={onReviewDiscarded} /> : null}
      {editorMounted ? <SessionEditorDrawer sessionId={editingId} onClose={() => setEditingId(null)} onSaved={onSessionUpdated} onDeleted={onSessionDeleted} /> : null}
    </Suspense>
  ) : null;

  if (!alert) return drawers;

  const runAction = () => {
    primeTimerSound();
    setAlert(null);
    const current = useStudyStore.getState().timer;
    if (alert.action === "skip-break") skipBreak();
    else if (alert.action === "start-next" && isTimerIdle(current)) toggleStudyTimer();
  };
  const actionLabel = alert.action === "skip-break" ? TIMER_ALERT_TEXT.skipBreak : alert.action === "start-next" ? TIMER_ALERT_TEXT.startNext : null;
  const showGoTo = alert.goToStudy && activeView !== "study";

  return (
    <>
      {drawers}
      <aside
        className="fixed left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 mx-auto max-w-md rounded-[28px] border border-[var(--success-border)] bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] p-4 shadow-soft backdrop-blur-2xl"
        role="status"
        aria-live="assertive"
      >
        <div className="flex items-start gap-3">
          <span className="grid grid-cols-1 h-11 w-11 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
            <Icon name={alert.icon} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 self-center">
            <p className="safe-text font-black">{alert.title}</p>
            {alert.body ? <p className="safe-text text-sm text-[var(--muted)]">{alert.body}</p> : null}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setAlert(null)}>
            {TIMER_ALERT_TEXT.close}
          </Button>
          {alert.undo ? (
            <Button
              variant="soft"
              icon="RotateCcw"
              onClick={() => {
                setAlert(null);
                alert.undo?.();
              }}
            >
              {TIMER_ALERT_TEXT.undo}
            </Button>
          ) : null}
          {alert.sessionId ? (
            <Button
              variant="soft"
              icon="PenLine"
              onClick={() => {
                setEditingId(alert.sessionId ?? null);
                setAlert(null);
              }}
            >
              {TIMER_ALERT_TEXT.edit}
            </Button>
          ) : null}
          {showGoTo ? (
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
    </>
  );
}
