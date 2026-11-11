// "Senza data · N": le Attività ancora da fare senza una data, da mettere in un giorno del calendario.
import type { Task } from "../../types";
import { DateField } from "../DatePicker";
import { Drawer } from "../ui";
import { safeCssColor } from "../../lib/sharing";
import { subjectColor, subjectName } from "../../lib/selectors";
import { CALENDAR_VIEW_TEXT, DATE_PICKER_TEXT } from "../../lib/labels";
import type { Subjects } from "./types";

/**
 * Elenco nel Drawer: ogni attività si apre toccandone il titolo; "Scegli la data" la mette in quel
 * giorno (scadenza alle 18:00) e la toglie dall'elenco.
 */
export function UndatedTasksDrawer({
  open,
  onClose,
  tasks,
  subjects,
  onPlace,
  onOpenTask
}: {
  open: boolean;
  onClose: () => void;
  tasks: Task[];
  subjects: Subjects;
  /** Giorno scelto ("YYYY-MM-DD"). */
  onPlace: (taskId: string, day: string) => void;
  onOpenTask: (taskId: string) => void;
}) {
  return (
    <Drawer open={open} onClose={onClose} title={CALENDAR_VIEW_TEXT.undatedTitle}>
      <p className="mb-3 text-sm font-bold text-[var(--muted)]">{tasks.length ? CALENDAR_VIEW_TEXT.undatedIntro : CALENDAR_VIEW_TEXT.undatedEmpty}</p>
      <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
        {tasks.map((task) => (
          <li key={task.id} className="grid grid-cols-1 gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3 sm:grid-cols-[minmax(0,1fr)_220px] sm:items-end">
            <button
              type="button"
              onClick={() => onOpenTask(task.id)}
              aria-label={CALENDAR_VIEW_TEXT.undatedOpen(task.title)}
              className="flex min-h-11 min-w-0 items-center gap-2 rounded-[12px] text-left hover:underline"
            >
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: safeCssColor(subjectColor(subjects, task.subjectId)) || "var(--accent)" }} />
              <span className="min-w-0">
                <span className="two-line-safe block text-sm font-black">{task.title}</span>
                <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{subjectName(subjects, task.subjectId)}</span>
              </span>
            </button>
            <DateField value="" label={DATE_PICKER_TEXT.chooseDate} onChange={(day) => (day ? onPlace(task.id, day) : undefined)} />
          </li>
        ))}
      </ul>
    </Drawer>
  );
}
