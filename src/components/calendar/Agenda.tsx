// Agenda: eventi, scadenze ed esami delle prossime due settimane, giorno per giorno. Le festività stanno
// in cima al loro giorno ma non contano: con nient'altro nel periodo resta lo stato vuoto.
import type { ReactNode } from "react";
import { addDays, eachDayOfInterval, format, isSameDay, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Task } from "../../types";
import { Button, EmptyState } from "../ui";
import { daysUntil } from "../../lib/selectors";
import { todayYmd } from "../../lib/datePicker";
import type { Holiday } from "../../lib/holidays";
import { CALENDAR_TEXT, CALENDAR_VIEW_TEXT } from "../../lib/labels";
import { holidaysByDay, overdueForAgenda } from "../../lib/calendarRender";
import { HolidayChip, HolidaysNote, useEventTheme } from "./bars";
import { ExamChip, TaskChip } from "./chips";
import { EventRow, eventsByListDay } from "./DayList";
import { defaultStartFor } from "./shared";
import type { CalendarOccurrence, Handlers } from "./types";

export function Agenda({
  from,
  to,
  occurrences,
  tasks,
  exams,
  holidays = [],
  handlers,
  empty
}: {
  from: Date;
  to: Date;
  occurrences: CalendarOccurrence[];
  tasks: Task[];
  exams: Exam[];
  /** Festività del periodo (vuoto con "Festività" spento). */
  holidays?: Holiday[];
  handlers: Handlers;
  /** Stato vuoto al posto di quello generico (es. con il filtro per materia). */
  empty?: ReactNode;
}) {
  const theme = useEventTheme();
  // In ritardo: solo se l'Agenda parte da oggi; lo stesso elenco decide anche lo stato vuoto.
  const overdue = overdueForAgenda(tasks, from);
  const days = eachDayOfInterval({ start: from, end: addDays(to, -1) });
  // Un evento su più giorni è una voce sola ("ven 3 – dom 5"), nel primo giorno mostrato.
  const events = eventsByListDay(occurrences, days);
  const holidaysOn = holidaysByDay(holidays);
  const sections = days.map((day) => {
    const ymd = todayYmd(day);
    return {
      day,
      events: events.get(ymd) ?? [],
      tasks: tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day)),
      exams: exams.filter((exam) => isSameDay(parseISO(exam.date), day)),
      holidays: holidaysOn.get(ymd) ?? []
    };
  });
  const hasItems = (section: (typeof sections)[number]) => section.events.length > 0 || section.tasks.length > 0 || section.exams.length > 0;

  if (!sections.some(hasItems) && !overdue.length) {
    return (
      <>
        {empty ?? (
          <EmptyState
            icon="CalendarDays"
            title={CALENDAR_VIEW_TEXT.agendaEmptyTitle}
            body={CALENDAR_VIEW_TEXT.agendaEmptyBody}
            action={
              <Button variant="primary" icon="Plus" onClick={() => handlers.onCreate(defaultStartFor(from))}>
                {CALENDAR_TEXT.newEvent}
              </Button>
            }
          />
        )}
        <HolidaysNote holidays={holidays} />
      </>
    );
  }

  const dayTitle = (day: Date) => {
    const diff = daysUntil(day);
    const base = format(day, "EEEE d MMMM", { locale: it });
    return diff === 0 ? CALENDAR_VIEW_TEXT.todayTitle(base) : diff === 1 ? CALENDAR_VIEW_TEXT.tomorrowTitle(base) : base;
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {overdue.length ? (
        <section aria-label={CALENDAR_VIEW_TEXT.overdueGroup}>
          <h3 className="mb-1.5 text-xs font-black uppercase text-[var(--danger-text)]">{CALENDAR_VIEW_TEXT.overdue(overdue.length)}</h3>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-1 sm:grid-cols-2">
            {overdue.map((task) => (
              <li key={task.id}>
                <TaskChip task={task} handlers={handlers} roomy />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {sections
        .filter((section) => hasItems(section) || section.holidays.length)
        .map((section) => (
          <section
            key={section.day.toISOString()}
            aria-label={dayTitle(section.day)}
            className="grid grid-cols-[minmax(0,1fr)] gap-1 md:grid-cols-[180px_minmax(0,1fr)] md:gap-4"
          >
            <h3 className={`pt-2 text-sm font-black capitalize ${isSameDay(section.day, new Date()) ? "text-[var(--accent-ink)]" : ""}`}>{dayTitle(section.day)}</h3>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-0.5">
              {section.holidays.length ? (
                <li className="flex flex-wrap gap-1 px-2.5 py-1">
                  {section.holidays.map((holiday) => (
                    <HolidayChip key={holiday.name} holiday={holiday} theme={theme} />
                  ))}
                </li>
              ) : null}
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
                    <TaskChip key={task.id} task={task} handlers={handlers} roomy />
                  ))}
                </li>
              ) : null}
            </ul>
          </section>
        ))}
    </div>
  );
}
