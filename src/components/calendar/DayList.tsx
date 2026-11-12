// Settimana sul telefono: un elenco giorno per giorno. EventRow serve anche all'Agenda.
// Un evento su più giorni è una voce sola, nel primo giorno mostrato, con il periodo ("ven 3 – dom 5").
import type { ReactNode } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Task } from "../../types";
import { Icon } from "../Icon";
import { SharedMark } from "../SharedMark";
import { Tag } from "../ui";
import { capitalizeFirst } from "../../lib/labels";
import { CALENDAR_VIEW_TEXT } from "../../lib/labels/calendar";
import { isAllDayEvent, timeLabel } from "../../lib/selectors";
import { todayYmd } from "../../lib/datePicker";
import { eventTypeLabel } from "../../lib/eventColors";
import type { Holiday } from "../../lib/holidays";
import { continuedFrom, holidaysByDay, listDayOf, occasionText, spanText } from "../../lib/calendarRender";
import { HolidayChip, HolidaysNote, TypeIcon, useEventPaint, useEventTheme } from "./bars";
import { ExamChip, TaskChip } from "./chips";
import { allDayEventLabel, defaultStartFor, editOccurrence, occurrenceSubject, pointerPoint, sharedOutline, sharedOutlineClass } from "./shared";
import type { CalendarOccurrence, Handlers } from "./types";

/** Le voci di ogni giorno di un elenco: una voce su più giorni compare una volta sola. */
export const eventsByListDay = (occurrences: readonly CalendarOccurrence[], days: readonly Date[]) => {
  const byDay = new Map<string, CalendarOccurrence[]>();
  if (!days.length) return byDay;
  const firstDay = todayYmd(days[0]);
  const lastDay = todayYmd(days[days.length - 1]);
  for (const item of occurrences) {
    const day = listDayOf(item, firstDay, lastDay);
    if (!day) continue;
    const list = byDay.get(day) ?? [];
    list.push(item);
    byDay.set(day, list);
  }
  return byDay;
};

export function DayList({
  days,
  occurrences,
  tasks,
  exams,
  holidays = [],
  handlers,
  empty: emptyWeek
}: {
  days: Date[];
  occurrences: CalendarOccurrence[];
  tasks: Task[];
  exams: Exam[];
  /** Festività del periodo: in cima al loro giorno; non contano per lo stato vuoto. */
  holidays?: Holiday[];
  handlers: Handlers;
  /** Al posto di sette "Nessun impegno" quando tutta la settimana è vuota. */
  empty?: ReactNode;
}) {
  const theme = useEventTheme();
  const events = eventsByListDay(occurrences, days);
  const holidaysOn = holidaysByDay(holidays);
  const perDay = days.map((day) => {
    const ymd = todayYmd(day);
    const dayEvents = events.get(ymd) ?? [];
    const dayTasks = tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day));
    const dayExams = exams.filter((exam) => isSameDay(parseISO(exam.date), day));
    const dayHolidays = holidaysOn.get(ymd) ?? [];
    return { day, dayEvents, dayTasks, dayExams, dayHolidays, empty: !dayEvents.length && !dayTasks.length && !dayExams.length };
  });
  if (perDay.every((entry) => entry.empty))
    return (
      <>
        {emptyWeek}
        <HolidaysNote holidays={holidays} />
      </>
    );
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {perDay.map(({ day, dayEvents, dayTasks, dayExams, dayHolidays, empty }) => {
        // «Lunedì 9 novembre», come la Home: maiuscola solo all'inizio, il mese resta minuscolo.
        const dayLabel = capitalizeFirst(format(day, "EEEE d MMMM", { locale: it }));
        return (
          <section key={day.toISOString()} aria-label={dayLabel}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className={`text-sm font-black ${isSameDay(day, new Date()) ? "text-[var(--accent-ink)]" : ""}`}>{dayLabel}</h3>
              <button
                type="button"
                onClick={() => handlers.onCreate(defaultStartFor(day))}
                className="grid h-11 min-w-11 grid-cols-1 place-items-center rounded-full bg-[var(--surface-soft)] px-2.5"
                aria-label={CALENDAR_VIEW_TEXT.addOn(format(day, "d MMMM", { locale: it }))}
                title={CALENDAR_VIEW_TEXT.addOn(format(day, "d MMMM", { locale: it }))}
              >
                <Icon name="Plus" className="h-4 w-4" />
              </button>
            </div>
            {dayHolidays.length ? (
              <div className="mb-1.5 flex flex-wrap gap-1">
                {dayHolidays.map((holiday) => (
                  <HolidayChip key={holiday.name} holiday={holiday} theme={theme} />
                ))}
              </div>
            ) : null}
            {empty ? (
              <p className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-2 text-xs font-bold text-[var(--faint)]">{CALENDAR_VIEW_TEXT.noItems}</p>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                {dayExams.map((exam) => (
                  <li key={exam.id}>
                    <ExamChip exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} roomy />
                  </li>
                ))}
                {dayEvents.map((item) => (
                  <li key={item.occurrenceKey}>
                    <EventRow item={item} handlers={handlers} listDay={todayYmd(day)} />
                  </li>
                ))}
                {dayTasks.map((task) => (
                  <li key={task.id}>
                    <TaskChip task={task} handlers={handlers} roomy />
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

/**
 * Un evento in un elenco. `listDay` (YYYY-MM-DD): il giorno sotto cui compare; se l'evento è cominciato
 * prima (la sera prima, oltre la mezzanotte) si dice «continua» con il giorno e l'ora d'inizio.
 */
export function EventRow({ item, handlers, listDay }: { item: CalendarOccurrence; handlers: Handlers; listDay?: string }) {
  const paint = useEventPaint()(item, handlers.subjects);
  const allDay = isAllDayEvent(item);
  // Su più giorni: il periodo al posto di "Tutto il giorno" o dell'orario.
  const range = spanText(item);
  const occasion = occasionText(item);
  const subject = occurrenceSubject(item, handlers.subjects);
  const from = listDay ? continuedFrom(item, listDay) : null;
  const when = from
    ? CALENDAR_VIEW_TEXT.continuedFrom(format(parseISO(item.start), "EEE d MMM", { locale: it }), timeLabel(item.start), timeLabel(item.end))
    : range ?? (allDay ? allDayEventLabel(item) : `${timeLabel(item.start)}–${timeLabel(item.end)}`);
  return (
    <button
      type="button"
      onClick={() => editOccurrence(handlers, item)}
      onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
      onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
      onMouseLeave={handlers.onPreviewHide}
      className={`flex w-full min-w-0 items-center gap-3 rounded-[14px] px-2.5 py-2 text-left hover:bg-[var(--surface-soft)] ${item.status === "done" ? "opacity-75" : ""} ${sharedOutlineClass(item)}`}
      style={sharedOutline(item)}
    >
      {allDay ? (
        <span className="w-12 shrink-0 text-center text-xs font-black text-[var(--faint)]" title={allDayEventLabel(item)} aria-hidden="true">
          —
        </span>
      ) : from ? (
        // Il giorno e l'ora d'inizio sono nella riga sotto il titolo ("Dal mer 11 nov, 23:17–00:17").
        <span className="w-12 shrink-0 text-[11px] font-black text-[var(--muted)]" aria-hidden="true">
          {CALENDAR_VIEW_TEXT.continues}
        </span>
      ) : (
        <span className="w-12 shrink-0 text-xs font-black tabular-nums">{timeLabel(item.start)}</span>
      )}
      {/* Tipologia: icona sul colore della tipologia (o della materia). */}
      <span
        className="grid h-8 w-8 shrink-0 grid-cols-1 place-items-center rounded-[10px]"
        style={{ background: paint.style.background, color: paint.style.text, boxShadow: `inset 0 0 0 1px ${paint.style.border}` }}
      >
        <TypeIcon paint={paint} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="one-line-safe block text-sm font-extrabold">
          {item.recurring ? (
            <span role="img" aria-label={CALENDAR_VIEW_TEXT.recurring}>
              ↻{" "}
            </span>
          ) : null}
          {item.title}
        </span>
        <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
          {when}
          {occasion ? ` · ${occasion}` : ""}
          {subject ? ` · ${subject}` : ""}
        </span>
      </span>
      {item.sharedFrom ? <SharedMark origin={item.sharedFrom} /> : null}
      <Tag className="hidden shrink-0 sm:inline-flex">{eventTypeLabel(paint.type)}</Tag>
    </button>
  );
}
