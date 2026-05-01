import { useMemo } from "react";
import { useStudyStore } from "../store/useStudyStore";
import { formatElapsedSeconds, taskElapsedSeconds, taskReminderDue, taskReminderIntervalMinutes } from "../lib/taskTimer";
import { useNow } from "../hooks/useNow";
import { Button, Pill } from "./ui";
import { Icon } from "./Icon";

export function TaskTimerReminder() {
  const { tasks, updateTask, setActiveView } = useStudyStore();
  const hasRunningTask = tasks.some((task) => task.status === "doing" && task.timerStartedAt);
  const now = useNow(1000, hasRunningTask);

  const task = useMemo(
    () => tasks.find((item) => taskReminderDue(item, now)) ?? null,
    [now, tasks]
  );

  if (!task) return null;

  const elapsedSeconds = taskElapsedSeconds(task, now);
  const interval = taskReminderIntervalMinutes(task);

  return (
    <aside
      className="fixed bottom-[calc(6rem+env(safe-area-inset-bottom))] right-3 z-50 w-[min(430px,calc(100vw-1.5rem))] rounded-[28px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_88%,transparent)] p-4 shadow-soft backdrop-blur-2xl md:bottom-5 md:right-5"
      role="status"
      aria-live="polite"
    >
      <div className="mb-3 flex items-start gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
          <Icon name="Timer" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase text-[var(--faint)]">Promemoria timer</p>
          <h3 className="two-line-safe text-lg font-black">{task.title}</h3>
          <p className="safe-text mt-1 text-sm font-bold text-[var(--muted)]">
            In corso da {formatElapsedSeconds(elapsedSeconds)}. Controlla se continuare, mettere in pausa o completare.
          </p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        <Pill>{interval} min reminder</Pill>
        <Pill>{task.estimatedMinutes} min stimati</Pill>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => updateTask(task.id, { timerLastReminderAt: now.toISOString() })}>
          Continua
        </Button>
        <Button variant="soft" icon="Pause" onClick={() => updateTask(task.id, { status: "todo" })}>
          Pausa
        </Button>
        <Button
          variant="primary"
          icon="Check"
          onClick={async () => {
            await updateTask(task.id, { status: "done" });
            setActiveView("tasks");
          }}
        >
          Completa
        </Button>
      </div>
    </aside>
  );
}
