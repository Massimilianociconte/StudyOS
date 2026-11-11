// Mese: un riquadro per giorno; si trascinano gli eventi da un giorno all'altro.
import { useRef, useState } from "react";
import { format, isSameDay, isSameMonth, parseISO, startOfDay } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Task } from "../../types";
import { SharedMark } from "../SharedMark";
import { isAllDayEvent, timeLabel } from "../../lib/selectors";
import { ExamChip, TaskChip } from "./chips";
import { allDayEventLabel, canDrag, defaultStartFor, eventColor, pointerPoint, sharedOutline, sharedOutlineClass } from "./shared";
import type { CalendarOccurrence, Handlers } from "./types";

export function MonthGrid({
  days,
  month,
  occurrences,
  tasks,
  exams,
  handlers,
  onPickDay
}: {
  days: Date[];
  month: Date;
  occurrences: CalendarOccurrence[];
  tasks: Task[];
  exams: Exam[];
  handlers: Handlers;
  onPickDay: (day: Date) => void;
}) {
  const [dropDay, setDropDay] = useState<string | null>(null);
  const dragged = useRef<string | null>(null);
  const limit = 3;
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
      {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => (
        <div key={day} className="px-1 pb-1 text-[11px] font-black uppercase text-[var(--faint)]">
          {day}
        </div>
      ))}
      {days.map((day) => {
        const key = day.toISOString();
        const dayEvents = occurrences.filter((item) => isSameDay(parseISO(item.start), day));
        const dayTasks = tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day));
        const dayExams = exams.filter((exam) => isSameDay(parseISO(exam.date), day));
        const total = dayEvents.length + dayTasks.length + dayExams.length;
        const today = isSameDay(day, new Date());
        const outside = !isSameMonth(day, month);
        let shown = 0;
        return (
          <div
            key={key}
            role="presentation"
            title="Clicca per aggiungere un evento in questo giorno"
            onClick={() => handlers.onCreate(defaultStartFor(day))}
            onDragOver={(event) => {
              event.preventDefault();
              setDropDay(key);
            }}
            onDragLeave={() => setDropDay((value) => (value === key ? null : value))}
            onDrop={(event) => {
              event.preventDefault();
              setDropDay(null);
              const item = occurrences.find((occurrence) => occurrence.occurrenceKey === dragged.current);
              dragged.current = null;
              if (!item) return;
              const start = parseISO(item.start);
              const next = startOfDay(day);
              next.setHours(start.getHours(), start.getMinutes(), 0, 0);
              handlers.onMoveEvent(item, next);
            }}
            className={`min-h-[68px] min-w-0 cursor-copy rounded-[14px] border p-1 sm:min-h-[112px] sm:p-1.5 ${
              dropDay === key ? "border-[var(--accent)]" : "border-[var(--border)]"
            } ${outside ? "opacity-45" : ""} ${today ? "bg-[var(--surface)]" : "bg-[var(--surface-soft)]"}`}
          >
            <div className="mb-1 flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onPickDay(day);
                }}
                className={`relative grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-black before:absolute before:-inset-2.5 before:content-[""] hover:bg-[var(--surface-strong)] ${
                  today ? "bg-[var(--accent)] text-[#10131d] hover:bg-[var(--accent)]" : ""
                }`}
                aria-label={`Apri ${format(day, "EEEE d MMMM", { locale: it })}`}
                title={`Apri ${format(day, "EEEE d MMMM", { locale: it })}`}
              >
                {format(day, "d")}
              </button>
              {total ? <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] sm:hidden" /> : null}
            </div>
            <div className="hidden gap-0.5 sm:grid">
              {dayExams.map((exam) => {
                shown += 1;
                return shown <= limit ? <ExamChip key={exam.id} exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} /> : null;
              })}
              {dayEvents.map((item) => {
                shown += 1;
                if (shown > limit) return null;
                const color = eventColor(item, handlers.subjects);
                const allDay = isAllDayEvent(item);
                return (
                  <button
                    key={item.occurrenceKey}
                    type="button"
                    draggable={canDrag(item)}
                    onDragStart={(event) => {
                      if (!canDrag(item)) {
                        event.preventDefault();
                        return;
                      }
                      dragged.current = item.occurrenceKey;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.occurrenceKey);
                      handlers.onPreviewHide();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.onEditEvent(item.id, item.sharedFrom?.ownerId);
                    }}
                    onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
                    onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
                    onMouseLeave={handlers.onPreviewHide}
                    className={`flex min-w-0 items-center gap-1 rounded-[8px] px-1 py-0.5 text-left text-[11px] ${
                      allDay ? "font-black hover:brightness-110" : "font-bold hover:bg-[var(--surface-strong)]"
                    } ${sharedOutlineClass(item)}`}
                    style={allDay ? { background: `color-mix(in srgb, ${color} 26%, var(--bg-2))`, ...sharedOutline(item) } : sharedOutline(item)}
                    title={allDay ? `${allDayEventLabel(item)} · ${item.title}` : `${timeLabel(item.start)} · ${item.title}`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
                    {item.sharedFrom ? <SharedMark origin={item.sharedFrom} compact /> : null}
                    {allDay ? null : <span className="shrink-0 tabular-nums text-[var(--muted)]">{timeLabel(item.start)}</span>}
                    <span className="min-w-0 truncate">{item.title}</span>
                  </button>
                );
              })}
              {dayTasks.map((task) => {
                shown += 1;
                return shown <= limit ? <TaskChip key={task.id} task={task} handlers={handlers} /> : null;
              })}
              {total > limit ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onPickDay(day);
                  }}
                  className="flex min-h-11 items-center px-1 text-left text-[11px] font-black text-[var(--muted)] hover:text-[var(--text)]"
                >
                  +{total - limit} altri
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
