// Agenda: eventi, scadenze ed esami delle prossime due settimane, giorno per giorno.
import type { ReactNode } from "react";
import { addDays, eachDayOfInterval, format, isBefore, isSameDay, parseISO, startOfDay } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Task } from "../../types";
import { Button, EmptyState } from "../ui";
import { daysUntil } from "../../lib/selectors";
import { ExamChip, TaskChip } from "./chips";
import { EventRow } from "./DayList";
import { defaultStartFor } from "./shared";
import type { CalendarOccurrence, Handlers } from "./types";

export function Agenda({
  from,
  to,
  occurrences,
  tasks,
  exams,
  handlers,
  empty
}: {
  from: Date;
  to: Date;
  occurrences: CalendarOccurrence[];
  tasks: Task[];
  exams: Exam[];
  handlers: Handlers;
  /** Stato vuoto al posto di quello generico (es. con il filtro per materia). */
  empty?: ReactNode;
}) {
  const overdue = tasks
    .filter((task) => task.status !== "done" && task.dueDate && isBefore(parseISO(task.dueDate), startOfDay(new Date())))
    .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
  const days = eachDayOfInterval({ start: from, end: addDays(to, -1) });
  const sections = days
    .map((day) => ({
      day,
      events: occurrences.filter((item) => isSameDay(parseISO(item.start), day)),
      tasks: tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day)),
      exams: exams.filter((exam) => isSameDay(parseISO(exam.date), day))
    }))
    .filter((section) => section.events.length || section.tasks.length || section.exams.length);

  if (!sections.length && !overdue.length) {
    if (empty) return <>{empty}</>;
    return (
      <EmptyState
        icon="CalendarDays"
        title="Niente in programma"
        body="In queste due settimane non hai eventi, scadenze o esami: quello che aggiungi comparirà qui, giorno per giorno."
        action={
          <Button variant="primary" icon="Plus" onClick={() => handlers.onCreate(defaultStartFor(from))}>
            Nuovo evento
          </Button>
        }
      />
    );
  }

  const dayTitle = (day: Date) => {
    const diff = daysUntil(day);
    const base = format(day, "EEEE d MMMM", { locale: it });
    return diff === 0 ? `Oggi · ${base}` : diff === 1 ? `Domani · ${base}` : base;
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {overdue.length && isSameDay(from, startOfDay(new Date())) ? (
        <section aria-label="Attività in ritardo">
          <h3 className="mb-1.5 text-xs font-black uppercase text-[var(--danger-text)]">In ritardo · {overdue.length}</h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 sm:grid-cols-2">
            {overdue.map((task) => (
              <li key={task.id}>
                <TaskChip task={task} handlers={handlers} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sections.map((section) => (
        <section key={section.day.toISOString()} aria-label={dayTitle(section.day)} className="grid grid-cols-[minmax(0,1fr)] gap-1 md:grid-cols-[180px_minmax(0,1fr)] md:gap-4">
          <h3 className={`pt-2 text-sm font-black capitalize ${isSameDay(section.day, new Date()) ? "text-[var(--accent-ink)]" : ""}`}>{dayTitle(section.day)}</h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
            {section.exams.map((exam) => (
              <li key={exam.id} className="px-2.5 py-1">
                <ExamChip exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} />
              </li>
            ))}
            {section.events.map((item) => (
              <li key={item.occurrenceKey}>
                <EventRow item={item} handlers={handlers} />
              </li>
            ))}
            {section.tasks.length ? (
              <li className="grid grid-cols-[minmax(0,1fr)] gap-1 px-2.5 py-1 sm:grid-cols-2">
                {section.tasks.map((task) => (
                  <TaskChip key={task.id} task={task} handlers={handlers} />
                ))}
              </li>
            ) : null}
          </ul>
        </section>
      ))}
    </div>
  );
}
