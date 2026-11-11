// Attività ed esami come piccole voci del calendario (fascia in alto, Mese, Agenda, elenco del telefono).
// Gli eventi di tutto il giorno o su più giorni sono barre (bars.tsx).
import { isBefore, parseISO } from "date-fns";
import type { Exam, Task } from "../../types";
import { Icon } from "../Icon";
import { CALENDAR_VIEW_TEXT, PRIORITY_TONE } from "../../lib/labels";
import { subjectColor, subjectName } from "../../lib/selectors";
import { EVENT_TYPE_COLORS, eventColorStyle, eventTypeIcon } from "../../lib/eventColors";
import { safeCssColor } from "../../lib/sharing";
import { useEventTheme } from "./bars";
import { pointerPoint } from "./shared";
import type { Handlers, Subjects } from "./types";

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
        aria-label={done ? CALENDAR_VIEW_TEXT.markTodo(task.title) : CALENDAR_VIEW_TEXT.markDone(task.title)}        onClick={(event) => {
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
        aria-label={CALENDAR_VIEW_TEXT.openTask(task.title)}
        className={`min-w-0 flex-1 truncate text-left ${done ? "line-through" : ""} ${overdue ? "text-[var(--danger-text)]" : ""}`}
      >
        {task.title}
      </button>
    </div>
  );
}

export function ExamChip({ exam, subjects, onOpen }: { exam: Exam; subjects: Subjects; onOpen: (id: string) => void }) {
  // Stile della tipologia Esame (come gli eventi d'esame), con il pallino della materia.
  const style = eventColorStyle(EVENT_TYPE_COLORS.exam, useEventTheme());
  const name = subjectName(subjects, exam.subjectId);
  return (
    <button
      type="button"
      className="flex w-full min-w-0 items-center gap-1.5 rounded-[10px] px-1.5 py-1 text-left text-[11px] font-black hover:brightness-110"
      style={{ background: style.background, color: style.text, boxShadow: `inset 3px 0 0 ${style.border}` }}
      title={CALENDAR_VIEW_TEXT.examTitle(name, exam.preparation)}
      onClick={(event) => {
        // Nella cella del mese e nella griglia oraria il click crea un evento: aprire un esame non deve farlo.
        event.stopPropagation();
        onOpen(exam.id);
      }}
    >
      <Icon name={eventTypeIcon("exam")} className="h-3 w-3 shrink-0" />
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: safeCssColor(subjectColor(subjects, exam.subjectId)) || "var(--accent)" }} />
      {/* Nome accessibile = testo visibile ("Esame · Analisi"), poi l'azione detta solo a voce. */}
      <span className="min-w-0 truncate">{CALENDAR_VIEW_TEXT.exam(name)}</span>
      <span className="sr-only">, {CALENDAR_VIEW_TEXT.openAction}</span>
    </button>
  );
}
