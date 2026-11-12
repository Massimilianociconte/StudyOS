// Attività ed esami come piccole voci del calendario (fascia in alto, Mese, Agenda, elenco del telefono).
// Gli eventi di tutto il giorno o su più giorni sono barre (bars.tsx).
import { isBefore, parseISO } from "date-fns";
import type { Exam, Task } from "../../types";
import { Icon } from "../Icon";
import { PRIORITY_TONE } from "../../lib/labels";
import { CALENDAR_VIEW_TEXT } from "../../lib/labels/calendar";
import { subjectColor, subjectName } from "../../lib/selectors";
import { examTimeLabel } from "../../lib/calendarExams";
import { EVENT_TYPE_COLORS, eventColorStyle, eventTypeIcon } from "../../lib/eventColors";
import { safeCssColor } from "../../lib/sharing";
import { useEventTheme } from "./bars";
import { pointerPoint } from "./shared";
import type { Handlers, Subjects } from "./types";

/**
 * Nelle griglie (Settimana, Mese) la voce è fitta: area di tocco di 26 px (WCAG 2.5.8) che non copre il
 * titolo accanto né la voce sopra. Negli elenchi (telefono, Agenda) `roomy`: riga e area di 44 px.
 */
export function TaskChip({ task, handlers, roomy = false }: { task: Task; handlers: Handlers; roomy?: boolean }) {
  const done = task.status === "done";
  const overdue = !done && task.dueDate ? isBefore(parseISO(task.dueDate), new Date()) : false;
  return (
    <div
      className={`flex min-w-0 items-center bg-[var(--surface-soft)] font-bold hover:bg-[var(--surface)] ${
        roomy ? "min-h-11 gap-3 rounded-[12px] px-3 py-1 text-xs" : "gap-1.5 rounded-[10px] px-1.5 py-1 text-[11px]"
      } ${done ? "opacity-55" : ""}`}
      title={task.title}
    >
      <button
        type="button"
        aria-label={done ? CALENDAR_VIEW_TEXT.markTodo(task.title) : CALENDAR_VIEW_TEXT.markDone(task.title)}
        onClick={(event) => {
          event.stopPropagation();
          handlers.onToggleTask(task.id);
        }}
        // L'area (::after) parte dal bordo interno: 14 − 3 + 2 × 7,5 = 26 px; 20 − 3 + 2 × 13,5 = 44 px.
        // Fuori dal cerchio sporge quanto lo spazio prima del titolo (6 e 12 px), non oltre.
        className={`relative grid shrink-0 place-items-center rounded-full border-[1.5px] after:absolute after:content-[''] ${
          roomy ? "h-5 w-5 after:-inset-[13.5px]" : "h-3.5 w-3.5 after:-inset-[7.5px]"
        }`}
        style={{ borderColor: PRIORITY_TONE[task.priority], background: done ? PRIORITY_TONE[task.priority] : "transparent" }}
      >
        {done ? <Icon name="Check" className={`${roomy ? "h-3 w-3" : "h-2.5 w-2.5"} text-[#10131d]`} /> : null}
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

/**
 * Esame come voce: con l'ora davanti, se ne ha una (un esame con la sola data è a mezzanotte e non la
 * mostra). Negli elenchi (telefono, Agenda) `roomy`: riga di 44 px come le attività.
 */
export function ExamChip({ exam, subjects, onOpen, roomy = false }: { exam: Exam; subjects: Subjects; onOpen: (id: string) => void; roomy?: boolean }) {
  // Stile della tipologia Esame (come gli eventi d'esame), con il pallino della materia.
  const style = eventColorStyle(EVENT_TYPE_COLORS.exam, useEventTheme());
  const name = subjectName(subjects, exam.subjectId);
  const time = examTimeLabel(exam.date);
  return (
    <button
      type="button"
      className={`flex w-full min-w-0 items-center text-left font-black hover:brightness-110 ${
        roomy ? "min-h-11 gap-2 rounded-[12px] px-3 py-1 text-xs" : "gap-1.5 rounded-[10px] px-1.5 py-1 text-[11px]"
      }`}
      style={{ background: style.background, color: style.text, boxShadow: `inset 3px 0 0 ${style.border}` }}
      title={CALENDAR_VIEW_TEXT.examTitle(name, exam.preparation)}
      onClick={(event) => {
        // Nella cella del mese e nella griglia oraria il click crea un evento: aprire un esame non deve farlo.
        event.stopPropagation();
        onOpen(exam.id);
      }}
    >
      <Icon name={eventTypeIcon("exam")} className={`${roomy ? "h-3.5 w-3.5" : "h-3 w-3"} shrink-0`} />
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: safeCssColor(subjectColor(subjects, exam.subjectId)) || "var(--accent)" }} />
      {/* Nome accessibile = testo visibile ("14:30 Esame · Analisi"), poi l'azione detta solo a voce. */}
      {time ? <span className="shrink-0 tabular-nums">{time}</span> : null}
      <span className="min-w-0 truncate">{CALENDAR_VIEW_TEXT.exam(name)}</span>
      <span className="sr-only">, {CALENDAR_VIEW_TEXT.openAction}</span>
    </button>
  );
}
