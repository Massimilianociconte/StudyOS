// Attività ed esami come piccole voci del calendario (fascia in alto, Mese, Agenda, elenco del telefono)
// e gli eventi di tutto il giorno nella griglia oraria.
import { isBefore, parseISO } from "date-fns";
import type { Exam, Task } from "../../types";
import { Icon } from "../Icon";
import { SharedMark } from "../SharedMark";
import { CALENDAR_TEXT, PRIORITY_TONE } from "../../lib/labels";
import { subjectColor, subjectName } from "../../lib/selectors";
import { allDayEventLabel, eventColor, pointerPoint, sharedOutline, sharedOutlineClass } from "./shared";
import type { CalendarOccurrence, Handlers, Subjects } from "./types";

export function TaskChip({ task, handlers }: { task: Task; handlers: Handlers }) {
  const done = task.status === "done";
  const overdue = !done && task.dueDate ? isBefore(parseISO(task.dueDate), new Date()) : false;
  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 rounded-[10px] bg-[var(--surface-soft)] px-1.5 py-1 text-[11px] font-bold hover:bg-[var(--surface)] ${done ? "opacity-55" : ""}`}
      title={task.title}
    >
      <button
        type="button"
        aria-label={done ? `Segna "${task.title}" come da fare` : `Segna "${task.title}" come fatta`}
        onClick={(event) => {
          event.stopPropagation();
          handlers.onToggleTask(task.id);
        }}
        className="relative grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full border-[1.5px] after:absolute after:-inset-4 after:content-['']"
        style={{ borderColor: PRIORITY_TONE[task.priority], background: done ? PRIORITY_TONE[task.priority] : "transparent" }}
      >
        {done ? <Icon name="Check" className="h-2.5 w-2.5 text-[#10131d]" /> : null}
      </button>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          handlers.onEditTask(task.id);
        }}
        onMouseEnter={(event) => handlers.onPreviewTask(task, pointerPoint(event))}
        onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
        onMouseLeave={handlers.onPreviewHide}
        aria-label={`Apri l'attività "${task.title}"`}
        className={`min-w-0 flex-1 truncate text-left ${done ? "line-through" : ""} ${overdue ? "text-[var(--danger-text)]" : ""}`}
      >
        {task.title}
      </button>
    </div>
  );
}

export function AllDayChip({ item, handlers }: { item: CalendarOccurrence; handlers: Handlers }) {
  const color = eventColor(item, handlers.subjects);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        handlers.onEditEvent(item.id, item.sharedFrom?.ownerId);
      }}
      onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
      onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
      onMouseLeave={handlers.onPreviewHide}
      className={`flex min-w-0 items-center gap-1.5 rounded-[10px] px-1.5 py-1 text-left text-[11px] font-black hover:brightness-110 ${
        item.status === "done" ? "opacity-60" : ""
      } ${sharedOutlineClass(item)}`}
      style={{ background: `color-mix(in srgb, ${color} 26%, var(--bg-2))`, ...sharedOutline(item) }}
      title={`${allDayEventLabel(item)} · ${item.title}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {item.sharedFrom ? <SharedMark origin={item.sharedFrom} compact /> : null}
      <span className="min-w-0 truncate">
        {item.recurring ? (
          <span role="img" aria-label="Si ripete">
            ↻{" "}
          </span>
        ) : null}
        {item.title}
      </span>
    </button>
  );
}

export function ExamChip({ exam, subjects, onOpen }: { exam: Exam; subjects: Subjects; onOpen: (id: string) => void }) {
  const color = subjectColor(subjects, exam.subjectId);
  const name = subjectName(subjects, exam.subjectId);
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-1.5 rounded-[10px] px-1.5 py-1 text-left text-[11px] font-black hover:brightness-110"
      style={{ background: `color-mix(in srgb, ${color} 26%, var(--bg-2))` }}
      title={`Esame di ${name} · preparazione al ${exam.preparation}%`}
      aria-label={CALENDAR_TEXT.openExamAria(name)}
      onClick={(event) => {
        // Nella cella del mese e nella griglia oraria il click crea un evento: aprire un esame non deve farlo.
        event.stopPropagation();
        onOpen(exam.id);
      }}
    >
      <Icon name="GraduationCap" className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">Esame · {name}</span>
    </button>
  );
}
