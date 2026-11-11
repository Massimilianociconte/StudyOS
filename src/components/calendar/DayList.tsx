// Settimana sul telefono: un elenco giorno per giorno. EventRow serve anche all'Agenda.
import type { ReactNode } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Task } from "../../types";
import { Icon } from "../Icon";
import { SharedMark } from "../SharedMark";
import { Tag } from "../ui";
import { EVENT_CATEGORY_LABEL } from "../../lib/labels";
import { isAllDayEvent, timeLabel } from "../../lib/selectors";
import { ExamChip, TaskChip } from "./chips";
import { allDayEventLabel, defaultStartFor, eventColor, occurrenceSubject, pointerPoint, sharedOutline, sharedOutlineClass } from "./shared";
import type { CalendarOccurrence, Handlers } from "./types";

export function DayList({
  days,
  occurrences,
  tasks,
  exams,
  handlers,
  empty: emptyWeek
}: {
  days: Date[];
  occurrences: CalendarOccurrence[];
  tasks: Task[];
  exams: Exam[];
  handlers: Handlers;
  /** Al posto di sette "Nessun impegno" quando tutta la settimana è vuota. */
  empty?: ReactNode;
}) {
  const perDay = days.map((day) => {
    const dayEvents = occurrences.filter((item) => isSameDay(parseISO(item.start), day));
    const dayTasks = tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day));
    const dayExams = exams.filter((exam) => isSameDay(parseISO(exam.date), day));
    return { day, dayEvents, dayTasks, dayExams, empty: !dayEvents.length && !dayTasks.length && !dayExams.length };
  });
  if (perDay.every((entry) => entry.empty)) return <>{emptyWeek}</>;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {perDay.map(({ day, dayEvents, dayTasks, dayExams, empty }) => {
        return (
          <section key={day.toISOString()} aria-label={format(day, "EEEE d MMMM", { locale: it })}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className={`text-sm font-black capitalize ${isSameDay(day, new Date()) ? "text-[var(--accent-ink)]" : ""}`}>{format(day, "EEEE d MMMM", { locale: it })}</h3>
              <button
                type="button"
                onClick={() => handlers.onCreate(defaultStartFor(day))}
                className="grid h-11 min-w-11 place-items-center rounded-full bg-[var(--surface-soft)] px-2.5"
                aria-label={`Aggiungi un evento il ${format(day, "d MMMM", { locale: it })}`}
                title={`Aggiungi un evento il ${format(day, "d MMMM", { locale: it })}`}
              >
                <Icon name="Plus" className="h-4 w-4" />
              </button>
            </div>
            {empty ? (
              <p className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-2 text-xs font-bold text-[var(--faint)]">Nessun impegno</p>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                {dayExams.map((exam) => (
                  <li key={exam.id}>
                    <ExamChip exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} />
                  </li>
                ))}
                {dayEvents.map((item) => (
                  <li key={item.occurrenceKey}>
                    <EventRow item={item} handlers={handlers} />
                  </li>
                ))}
                {dayTasks.map((task) => (
                  <li key={task.id}>
                    <TaskChip task={task} handlers={handlers} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

export function EventRow({ item, handlers }: { item: CalendarOccurrence; handlers: Handlers }) {
  const color = eventColor(item, handlers.subjects);
  const allDay = isAllDayEvent(item);
  return (
    <button
      type="button"
      onClick={() => handlers.onEditEvent(item.id, item.sharedFrom?.ownerId)}
      onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
      onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
      onMouseLeave={handlers.onPreviewHide}
      className={`flex w-full min-w-0 items-center gap-3 rounded-[14px] px-2.5 py-2 text-left hover:bg-[var(--surface-soft)] ${item.status === "done" ? "opacity-60" : ""} ${sharedOutlineClass(item)}`}
      style={sharedOutline(item)}
    >
      {allDay ? (
        <span className="w-12 shrink-0 text-center text-xs font-black text-[var(--faint)]" title={allDayEventLabel(item)} aria-hidden="true">
          —
        </span>
      ) : (
        <span className="w-12 shrink-0 text-xs font-black tabular-nums">{timeLabel(item.start)}</span>
      )}
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="one-line-safe block text-sm font-extrabold">
          {item.recurring ? (
            <span role="img" aria-label="Si ripete">
              ↻{" "}
            </span>
          ) : null}
          {item.title}
        </span>
        <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
          {allDay ? allDayEventLabel(item) : `${timeLabel(item.start)}–${timeLabel(item.end)}`}
          {occurrenceSubject(item, handlers.subjects) ? ` · ${occurrenceSubject(item, handlers.subjects)}` : ""}
        </span>
      </span>
      {item.sharedFrom ? <SharedMark origin={item.sharedFrom} /> : null}
      <Tag className="hidden shrink-0 sm:inline-flex">{EVENT_CATEGORY_LABEL[item.category]}</Tag>
    </button>
  );
}
