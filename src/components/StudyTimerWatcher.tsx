import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useStudyStore } from "../store/useStudyStore";
import { useNow } from "../hooks/useNow";
import { timerRemainingSeconds } from "../lib/studyTimer";
import { Button } from "./ui";
import { Icon } from "./Icon";

const BASE_TITLE = "StudyOS";

const formatClock = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;

/**
 * Sorveglia il timer di studio a livello di app (non solo nella vista Studio):
 * lo ferma allo scadere, mostra un avviso e il tempo residuo nel titolo della scheda.
 */
export function StudyTimerWatcher() {
  const { timer, settleStudyTimer, setActiveView, activeView } = useStudyStore(
    useShallow((state) => ({
      timer: state.timer,
      settleStudyTimer: state.settleStudyTimer,
      setActiveView: state.setActiveView,
      activeView: state.activeView
    }))
  );
  const now = useNow(1000, timer.running);
  const [finishedLabel, setFinishedLabel] = useState<string | null>(null);
  const remaining = timerRemainingSeconds(timer, now.getTime());

  useEffect(() => {
    if (timer.running && remaining <= 0) {
      settleStudyTimer();
      setFinishedLabel(timer.label);
    }
  }, [remaining, timer.running, timer.label, settleStudyTimer]);

  useEffect(() => {
    document.title = timer.running ? `${formatClock(remaining)} · ${timer.label} · ${BASE_TITLE}` : BASE_TITLE;
  }, [remaining, timer.running, timer.label]);

  useEffect(() => () => {
    document.title = BASE_TITLE;
  }, []);

  if (!finishedLabel) return null;

  return (
    <aside
      className="fixed left-3 right-3 top-[max(0.75rem,env(safe-area-inset-top))] z-50 mx-auto max-w-md rounded-[28px] border border-[var(--success-border)] bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] p-4 shadow-soft backdrop-blur-2xl"
      role="status"
      aria-live="assertive"
    >
      <div className="flex items-start gap-3">
        <span className="grid grid-cols-1 h-11 w-11 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
          <Icon name="Timer" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase text-[var(--faint)]">Timer completato</p>
          <p className="font-black">{finishedLabel}: tempo scaduto.</p>
          <p className="text-sm text-[var(--muted)]">Registra la sessione nella vista Studio o fai una pausa.</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={() => setFinishedLabel(null)}>
          Chiudi
        </Button>
        {activeView !== "study" ? (
          <Button
            variant="primary"
            icon="Check"
            onClick={() => {
              setFinishedLabel(null);
              setActiveView("study");
            }}
          >
            Vai a Studio
          </Button>
        ) : null}
      </div>
    </aside>
  );
}
