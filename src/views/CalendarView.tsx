import { useMemo, useState } from "react";
import {
  addDays,
  addHours,
  addMonths,
  differenceInMinutes,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  parseISO,
  setHours,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subMonths
} from "date-fns";
import { it } from "date-fns/locale";
import { useStudyStore } from "../store/useStudyStore";
import type { CalendarEvent, Task } from "../types";
import { Button, Field, Panel, Pill, ProgressBar, SectionTitle, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { eventMinutes, shortDate, subjectColor, subjectName, timeLabel, upcomingEvents } from "../lib/selectors";

type CalendarMode = "day" | "week" | "month" | "agenda" | "exam" | "semester" | "focus";

const modes: { id: CalendarMode; label: string }[] = [
  { id: "day", label: "Giorno" },
  { id: "week", label: "Settimana" },
  { id: "month", label: "Mese" },
  { id: "agenda", label: "Agenda" },
  { id: "exam", label: "Sessione" },
  { id: "semester", label: "Semestre" },
  { id: "focus", label: "Focus" }
];

export function CalendarView() {
  const [mode, setMode] = useState<CalendarMode>("week");
  const [cursor, setCursor] = useState(new Date());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [newStart, setNewStart] = useState(() => setHours(new Date(), 9).toISOString().slice(0, 16));
  const { events, subjects, exams, tasks, updateEvent, addEvent, toggleTask } = useStudyStore();
  const calendarTasks = useMemo(
    () => tasks.filter((task) => task.dueDate && task.status !== "archived"),
    [tasks]
  );

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [cursor]);

  const moveEventToDay = async (eventId: string, day: Date) => {
    const event = events.find((item) => item.id === eventId);
    if (!event) return;
    const start = parseISO(event.start);
    const minutes = differenceInMinutes(parseISO(event.end), start);
    const nextStart = setHours(startOfDay(day), start.getHours());
    nextStart.setMinutes(start.getMinutes());
    await updateEvent(event.id, { start: nextStart.toISOString(), end: addMinutesSafe(nextStart, minutes).toISOString() });
  };

  const createEvent = async () => {
    if (!newTitle.trim()) return;
    const start = new Date(newStart);
    await addEvent({
      title: newTitle.trim(),
      start: start.toISOString(),
      end: addHours(start, 1).toISOString(),
      subjectId: subjectId || undefined,
      color: subjectColor(subjects, subjectId)
    });
    setNewTitle("");
  };

  return (
    <div>
      <SectionTitle
        title="Calendario"
        subtitle="Time blocking, eventi trascinabili e viste rapide per giorno, settimana, sessione esami e focus."
        action={
          <div className="flex gap-2">
            <Button icon="ChevronRight" variant="soft" onClick={() => setCursor(subMonths(cursor, 1))}>
              Indietro
            </Button>
            <Button icon="ChevronRight" variant="soft" onClick={() => setCursor(addMonths(cursor, 1))}>
              Avanti
            </Button>
          </div>
        }
      />

      <div className="scrollbar-soft mb-4 -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 md:flex-wrap md:overflow-visible">
        {modes.map((item) => (
          <button key={item.id} type="button" onClick={() => setMode(item.id)} className="shrink-0">
            <Pill active={mode === item.id}>{item.label}</Pill>
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel className="min-h-[640px]">
          {mode === "month" ? (
            <MonthGrid
              days={monthDays}
              events={events}
              tasks={calendarTasks}
              subjects={subjects}
              onDragStart={setDraggedId}
              onDropDay={(day) => {
                if (draggedId) moveEventToDay(draggedId, day);
                setDraggedId(null);
              }}
              onToggleTask={toggleTask}
            />
          ) : null}

          {mode === "week" ? (
            <WeekGrid
              days={weekDays}
              events={events}
              tasks={calendarTasks}
              subjects={subjects}
              onDragStart={setDraggedId}
              onDropDay={(day) => {
                if (draggedId) moveEventToDay(draggedId, day);
                setDraggedId(null);
              }}
              onToggleTask={toggleTask}
            />
          ) : null}

          {mode === "day" || mode === "focus" ? (
            <DayTimeline
              day={cursor}
              events={events}
              tasks={calendarTasks}
              subjects={subjects}
              focus={mode === "focus"}
              onToggleTask={toggleTask}
            />
          ) : null}

          {mode === "agenda" ? (
            <Agenda
              events={upcomingEvents(events, 16)}
              tasks={calendarTasks}
              subjects={subjects}
              onToggleTask={toggleTask}
            />
          ) : null}
          {mode === "exam" ? <ExamSession exams={exams} subjects={subjects} /> : null}
          {mode === "semester" ? <SemesterMap events={events} subjects={subjects} /> : null}
        </Panel>

        <aside className="grid content-start gap-4">
          <Panel>
            <h3 className="mb-4 text-2xl font-black">Nuovo evento</h3>
            <div className="grid gap-3">
              <Field label="Titolo">
                <input className={inputClass} value={newTitle} onChange={(event) => setNewTitle(event.target.value)} />
              </Field>
              <Field label="Materia">
                <select className={inputClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                  <option value="">Nessuna</option>
                  {subjects.map((subject) => (
                    <option value={subject.id} key={subject.id}>
                      {subject.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Inizio">
                <input
                  className={inputClass}
                  type="datetime-local"
                  value={newStart}
                  onChange={(event) => setNewStart(event.target.value)}
                />
              </Field>
              <Button variant="primary" icon="Plus" onClick={createEvent}>
                Aggiungi blocco
              </Button>
            </div>
          </Panel>

          <Panel>
            <h3 className="mb-4 text-2xl font-black">Prossimi blocchi</h3>
            <Agenda events={upcomingEvents(events, 5)} subjects={subjects} compact />
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function addMinutesSafe(date: Date, minutes: number) {
  const next = new Date(date);
  next.setMinutes(next.getMinutes() + minutes);
  return next;
}

function EventChip({
  event,
  subjects,
  onDragStart
}: {
  event: CalendarEvent;
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onDragStart?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      draggable
      onDragStart={() => onDragStart?.(event.id)}
      className="motion-safe w-full rounded-[14px] border border-white/10 p-1.5 text-left text-[11px] sm:rounded-[18px] sm:p-2 sm:text-xs hover:translate-y-[-1px]"
      style={{
        background: `linear-gradient(135deg, ${event.color || subjectColor(subjects, event.subjectId)}33, transparent)`
      }}
    >
      <span className="two-line-safe block font-black">{event.title}</span>
      <span className="one-line-safe block font-bold text-[var(--muted)]">
        {timeLabel(event.start)} · {eventMinutes(event)} min
      </span>
    </button>
  );
}

const priorityAccent = (priority: Task["priority"]) =>
  priority === "urgent"
    ? "var(--accent-3)"
    : priority === "high"
    ? "var(--warning)"
    : priority === "low"
    ? "var(--accent-2)"
    : "var(--accent)";

function TaskChip({
  task,
  subjects,
  onToggle,
  compact
}: {
  task: Task;
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onToggle?: (id: string) => void;
  compact?: boolean;
}) {
  const accent = priorityAccent(task.priority);
  const subjectAccent = subjectColor(subjects, task.subjectId);
  const done = task.status === "done";
  return (
    <button
      type="button"
      onClick={() => onToggle?.(task.id)}
      className={`motion-safe flex w-full items-center gap-1.5 rounded-[14px] border border-dashed p-1.5 text-left text-[11px] sm:rounded-[18px] sm:p-2 sm:text-xs hover:translate-y-[-1px] ${
        done ? "opacity-55" : ""
      }`}
      style={{
        borderColor: `${accent}80`,
        background: `linear-gradient(135deg, ${subjectAccent}1f, transparent)`
      }}
      aria-label={done ? `Riapri task ${task.title}` : `Completa task ${task.title}`}
    >
      <span
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full border"
        style={{ borderColor: accent, background: done ? accent : "transparent" }}
      >
        {done ? <Icon name="Check" className="h-3 w-3 text-[#10131d]" /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={`one-line-safe block font-black ${done ? "line-through" : ""}`}>{task.title}</span>
        {!compact ? (
          <span className="one-line-safe block font-bold text-[var(--muted)]">
            {task.dueDate ? timeLabel(task.dueDate) : "Task"}
            {task.subjectId ? ` · ${subjectName(subjects, task.subjectId)}` : ""}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function MonthGrid({
  days,
  events,
  tasks,
  subjects,
  onDragStart,
  onDropDay,
  onToggleTask
}: {
  days: Date[];
  events: CalendarEvent[];
  tasks: Task[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onDragStart: (id: string) => void;
  onDropDay: (day: Date) => void;
  onToggleTask: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-3xl font-black">{format(days[15], "MMMM yyyy", { locale: it })}</h3>
        <Pill>eventi + task</Pill>
      </div>
      <div className="grid grid-cols-7 gap-1 sm:gap-2">
        {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => (
          <div key={day} className="px-1 text-[10px] font-black uppercase text-[var(--faint)] sm:px-2 sm:text-xs">
            {day}
          </div>
        ))}
        {days.map((day) => {
          const dayEvents = events.filter((event) => isSameDay(parseISO(event.start), day));
          const dayTasks = tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day));
          const total = dayEvents.length + dayTasks.length;
          const merged = [
            ...dayEvents.map((event) => ({ kind: "event" as const, event })),
            ...dayTasks.map((task) => ({ kind: "task" as const, task }))
          ];
          return (
            <div
              key={day.toISOString()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDropDay(day)}
              className="quiet-panel min-h-[78px] p-1.5 sm:min-h-[124px] sm:p-2"
            >
              <div className="mb-2 flex items-center justify-between gap-1">
                <span className={`text-sm font-black ${isSameDay(day, new Date()) ? "text-[var(--accent)]" : ""}`}>
                  {format(day, "d")}
                </span>
                {total ? (
                  <span className="text-[10px] font-bold text-[var(--muted)] sm:text-xs">
                    {dayEvents.length ? `${dayEvents.length}E` : ""}
                    {dayEvents.length && dayTasks.length ? " " : ""}
                    {dayTasks.length ? `${dayTasks.length}T` : ""}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1">
                {merged.slice(0, 3).map((item) =>
                  item.kind === "event" ? (
                    <EventChip key={`e-${item.event.id}`} event={item.event} subjects={subjects} onDragStart={onDragStart} />
                  ) : (
                    <TaskChip key={`t-${item.task.id}`} task={item.task} subjects={subjects} onToggle={onToggleTask} compact />
                  )
                )}
                {merged.length > 3 ? (
                  <span className="block text-[10px] font-bold text-[var(--faint)]">+{merged.length - 3} altri</span>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekGrid({
  days,
  events,
  tasks,
  subjects,
  onDragStart,
  onDropDay,
  onToggleTask
}: {
  days: Date[];
  events: CalendarEvent[];
  tasks: Task[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onDragStart: (id: string) => void;
  onDropDay: (day: Date) => void;
  onToggleTask: (id: string) => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-3xl font-black">Settimana</h3>
        <Pill>{shortDate(days[0])} - {shortDate(days[6])}</Pill>
      </div>
      <div className="grid gap-3 lg:grid-cols-7">
        {days.map((day) => {
          const dayEvents = events
            .filter((event) => isSameDay(parseISO(event.start), day))
            .sort((a, b) => a.start.localeCompare(b.start));
          const dayTasks = tasks
            .filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day))
            .sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? ""));
          return (
            <div
              key={day.toISOString()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDropDay(day)}
              className="quiet-panel min-h-[180px] p-3 lg:min-h-[420px]"
            >
              <div className="mb-3 flex items-baseline justify-between gap-2 lg:block">
                <div>
                  <p className="text-xs font-black uppercase text-[var(--faint)]">{format(day, "EEE", { locale: it })}</p>
                  <p className={`text-2xl font-black sm:text-3xl ${isSameDay(day, new Date()) ? "text-[var(--accent)]" : ""}`}>
                    {format(day, "d")}
                  </p>
                </div>
                {dayEvents.length + dayTasks.length ? (
                  <span className="text-[10px] font-bold text-[var(--muted)] sm:text-xs">
                    {dayEvents.length}E · {dayTasks.length}T
                  </span>
                ) : null}
              </div>
              <div className="space-y-2">
                {dayEvents.map((event) => (
                  <EventChip key={event.id} event={event} subjects={subjects} onDragStart={onDragStart} />
                ))}
                {dayTasks.map((task) => (
                  <TaskChip key={task.id} task={task} subjects={subjects} onToggle={onToggleTask} />
                ))}
                {dayEvents.length + dayTasks.length === 0 ? (
                  <p className="text-xs font-bold text-[var(--faint)]">Nulla in agenda</p>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DayTimeline({
  day,
  events,
  tasks,
  subjects,
  focus,
  onToggleTask
}: {
  day: Date;
  events: CalendarEvent[];
  tasks: Task[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  focus?: boolean;
  onToggleTask: (id: string) => void;
}) {
  const dayEvents = events.filter((event) => isSameDay(parseISO(event.start), day));
  const dayTasks = tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day));
  const hours = Array.from({ length: focus ? 10 : 15 }, (_, index) => index + (focus ? 8 : 7));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-2xl font-black sm:text-3xl">{focus ? "Vista focus" : format(day, "EEEE d MMMM", { locale: it })}</h3>
        <Pill>{dayEvents.length}E · {dayTasks.length}T</Pill>
      </div>
      <div className="space-y-2">
        {hours.map((hour) => {
          const rowEvents = dayEvents.filter((event) => parseISO(event.start).getHours() === hour);
          const rowTasks = dayTasks.filter((task) => task.dueDate && parseISO(task.dueDate).getHours() === hour);
          const empty = rowEvents.length + rowTasks.length === 0;
          return (
            <div key={hour} className="grid grid-cols-[44px_1fr] gap-2 sm:grid-cols-[64px_1fr] sm:gap-3">
              <div className="pt-2 text-xs font-black text-[var(--faint)] sm:pt-3 sm:text-sm">
                {String(hour).padStart(2, "0")}:00
              </div>
              <div className={`quiet-panel min-h-12 p-2 ${empty ? "opacity-60" : ""}`}>
                <div className="grid gap-2 sm:grid-cols-2">
                  {rowEvents.map((event) => (
                    <EventChip key={event.id} event={event} subjects={subjects} />
                  ))}
                  {rowTasks.map((task) => (
                    <TaskChip key={task.id} task={task} subjects={subjects} onToggle={onToggleTask} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
        {dayTasks.some((task) => !task.dueDate || parseISO(task.dueDate).getHours() < (focus ? 8 : 7) || parseISO(task.dueDate).getHours() >= (focus ? 18 : 22)) ? (
          <div className="quiet-panel mt-3 p-3">
            <p className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Fuori orario</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {dayTasks
                .filter((task) => task.dueDate && (parseISO(task.dueDate).getHours() < (focus ? 8 : 7) || parseISO(task.dueDate).getHours() >= (focus ? 18 : 22)))
                .map((task) => (
                  <TaskChip key={task.id} task={task} subjects={subjects} onToggle={onToggleTask} />
                ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Agenda({
  events,
  tasks,
  subjects,
  compact,
  onToggleTask
}: {
  events: CalendarEvent[];
  tasks?: Task[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  compact?: boolean;
  onToggleTask?: (id: string) => void;
}) {
  type AgendaItem =
    | { kind: "event"; when: string; event: CalendarEvent }
    | { kind: "task"; when: string; task: Task };
  const items: AgendaItem[] = [
    ...events.map((event) => ({ kind: "event" as const, when: event.start, event })),
    ...(tasks ?? [])
      .filter((task) => task.dueDate)
      .map((task) => ({ kind: "task" as const, when: task.dueDate as string, task }))
  ].sort((a, b) => a.when.localeCompare(b.when));

  if (items.length === 0) {
    return <p className="text-sm font-bold text-[var(--muted)]">Niente in arrivo.</p>;
  }

  return (
    <div className={compact ? "space-y-2" : "grid gap-3 md:grid-cols-2"}>
      {items.map((item) =>
        item.kind === "event" ? (
          <div key={`e-${item.event.id}`} className="quiet-panel flex gap-3 p-3">
            <span className="mt-1 h-10 w-2 shrink-0 rounded-full" style={{ background: item.event.color }} />
            <div className="min-w-0 flex-1">
              <p className="two-line-safe font-black">{item.event.title}</p>
              <p className="one-line-safe text-sm font-bold text-[var(--muted)]">
                {shortDate(item.event.start)} · {timeLabel(item.event.start)} · {subjectName(subjects, item.event.subjectId)}
              </p>
            </div>
          </div>
        ) : (
          <button
            key={`t-${item.task.id}`}
            type="button"
            onClick={() => onToggleTask?.(item.task.id)}
            className={`quiet-panel flex w-full gap-3 p-3 text-left ${item.task.status === "done" ? "opacity-60" : ""}`}
          >
            <span
              className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border"
              style={{
                borderColor: priorityAccent(item.task.priority),
                background: item.task.status === "done" ? priorityAccent(item.task.priority) : "transparent"
              }}
            >
              {item.task.status === "done" ? <Icon name="Check" className="h-4 w-4 text-[#10131d]" /> : (
                <Icon name="CircleDot" className="h-3 w-3" />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <p className={`two-line-safe font-black ${item.task.status === "done" ? "line-through" : ""}`}>{item.task.title}</p>
              <p className="one-line-safe text-sm font-bold text-[var(--muted)]">
                Task · {shortDate(item.task.dueDate as string)} · {timeLabel(item.task.dueDate as string)}
                {item.task.subjectId ? ` · ${subjectName(subjects, item.task.subjectId)}` : ""}
              </p>
            </div>
          </button>
        )
      )}
    </div>
  );
}

function ExamSession({
  exams,
  subjects
}: {
  exams: ReturnType<typeof useStudyStore.getState>["exams"];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
}) {
  return (
    <div>
      <h3 className="mb-4 text-3xl font-black">Sessione esami</h3>
      <div className="grid gap-4 lg:grid-cols-3">
        {exams.map((exam) => {
          const color = subjectColor(subjects, exam.subjectId);
          return (
            <div key={exam.id} className="quiet-panel p-4">
              <div className="mb-5 h-3 rounded-full" style={{ background: color }} />
              <h4 className="two-line-safe text-xl font-black">{subjectName(subjects, exam.subjectId)}</h4>
              <p className="text-sm font-bold text-[var(--muted)]">{shortDate(exam.date)}</p>
              <div className="mt-5">
                <ProgressBar value={exam.preparation} color={color} />
              </div>
              <p className="mt-3 text-sm font-bold text-[var(--muted)]">{exam.preparation}% preparazione</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SemesterMap({
  events,
  subjects
}: {
  events: CalendarEvent[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
}) {
  return (
    <div>
      <h3 className="mb-4 text-3xl font-black">Vista semestre</h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {subjects.map((subject) => (
          <div key={subject.id} className="quiet-panel p-4">
            <div className="mb-3 flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-super" style={{ background: subject.color }}>
                <Icon name={subject.icon} className="h-5 w-5 text-[#10131d]" />
              </span>
              <div>
                <h4 className="font-black">{subject.name}</h4>
                <p className="text-xs font-bold text-[var(--muted)]">{subject.semester}</p>
              </div>
            </div>
            <p className="text-sm text-[var(--muted)]">
              {events.filter((event) => event.subjectId === subject.id).length} blocchi pianificati
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
