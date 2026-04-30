import { useMemo, useState } from "react";
import {
  addDays,
  addHours,
  addMonths,
  addWeeks,
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
  startOfWeek
} from "date-fns";
import { it } from "date-fns/locale";
import { useStudyStore } from "../store/useStudyStore";
import type { CalendarEvent, EventCategory, Exam, Task } from "../types";
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

const categories: { id: EventCategory; label: string }[] = [
  { id: "study", label: "Studio" },
  { id: "lesson", label: "Lezione" },
  { id: "lab", label: "Laboratorio" },
  { id: "exam", label: "Esame" },
  { id: "review", label: "Ripasso" },
  { id: "deadline", label: "Consegna" },
  { id: "project", label: "Progetto" },
  { id: "gym", label: "Palestra" },
  { id: "personal", label: "Personale" },
  { id: "work", label: "Lavoro" },
  { id: "relax", label: "Relax" },
  { id: "other", label: "Altro" }
];

const toDatetimeLocal = (date: string | Date) => {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const nextHourForDay = (day: Date) => {
  if (day.getHours() || day.getMinutes()) {
    const selected = new Date(day);
    selected.setSeconds(0, 0);
    return selected;
  }
  const next = setHours(startOfDay(day), 9);
  next.setMinutes(0, 0, 0);
  return next;
};

export function CalendarView() {
  const [mode, setMode] = useState<CalendarMode>("week");
  const [cursor, setCursor] = useState(new Date());
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [newStart, setNewStart] = useState(() => toDatetimeLocal(setHours(new Date(), 9)));
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  const [createKind, setCreateKind] = useState<"event" | "task">("event");
  const [dayDraft, setDayDraft] = useState({
    title: "",
    subjectId: "",
    startsAt: toDatetimeLocal(nextHourForDay(new Date())),
    priority: "medium" as Task["priority"]
  });
  const { events, subjects, exams, tasks, updateEvent, addEvent, deleteEvent, addTask, toggleTask, deleteTask } = useStudyStore();
  const calendarTasks = useMemo(
    () => tasks.filter((task) => task.dueDate && task.status !== "archived"),
    [tasks]
  );
  const editingEvent = editingEventId ? events.find((event) => event.id === editingEventId) ?? null : null;

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [cursor]);

  const navigate = (direction: -1 | 1) => {
    setCursor((current) => {
      if (mode === "day" || mode === "focus") return addDays(current, direction);
      if (mode === "week" || mode === "agenda") return addWeeks(current, direction);
      if (mode === "semester") return addMonths(current, direction * 6);
      return addMonths(current, direction);
    });
  };

  const openDayCreator = (day: Date, kind: "event" | "task" = "event") => {
    setSelectedDay(day);
    setCreateKind(kind);
    setDayDraft({
      title: "",
      subjectId: "",
      startsAt: toDatetimeLocal(nextHourForDay(day)),
      priority: "medium"
    });
  };

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

  const createFromDay = async () => {
    if (!selectedDay || !dayDraft.title.trim()) return;
    const start = new Date(dayDraft.startsAt);
    if (createKind === "task") {
      await addTask({
        title: dayDraft.title.trim(),
        dueDate: start.toISOString(),
        subjectId: dayDraft.subjectId || undefined,
        priority: dayDraft.priority,
        importance: dayDraft.priority === "urgent" ? 5 : dayDraft.priority === "high" ? 4 : 3
      });
    } else {
      await addEvent({
        title: dayDraft.title.trim(),
        start: start.toISOString(),
        end: addHours(start, 1).toISOString(),
        subjectId: dayDraft.subjectId || undefined,
        color: subjectColor(subjects, dayDraft.subjectId),
        priority: dayDraft.priority,
        category: "study"
      });
    }
    setSelectedDay(null);
  };

  return (
    <div>
      <SectionTitle
        title="Calendario"
        subtitle="Time blocking, eventi trascinabili e viste rapide per giorno, settimana, sessione esami e focus."
        action={
          <div className="flex gap-2">
            <Button icon="ChevronLeft" variant="soft" onClick={() => navigate(-1)}>
              Indietro
            </Button>
            <Button icon="ChevronRight" variant="soft" onClick={() => navigate(1)}>
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
              exams={exams}
              subjects={subjects}
              onDragStart={setDraggedId}
              onDropDay={(day) => {
                if (draggedId) moveEventToDay(draggedId, day);
                setDraggedId(null);
              }}
              onToggleTask={toggleTask}
              onDeleteTask={deleteTask}
              onEditEvent={setEditingEventId}
              onCreateDay={openDayCreator}
            />
          ) : null}

          {mode === "week" ? (
            <WeekGrid
              days={weekDays}
              events={events}
              tasks={calendarTasks}
              exams={exams}
              subjects={subjects}
              onDragStart={setDraggedId}
              onDropDay={(day) => {
                if (draggedId) moveEventToDay(draggedId, day);
                setDraggedId(null);
              }}
              onToggleTask={toggleTask}
              onDeleteTask={deleteTask}
              onEditEvent={setEditingEventId}
              onCreateDay={openDayCreator}
            />
          ) : null}

          {mode === "day" || mode === "focus" ? (
            <DayTimeline
              day={cursor}
              events={events}
              tasks={calendarTasks}
              exams={exams}
              subjects={subjects}
              focus={mode === "focus"}
              onToggleTask={toggleTask}
              onDeleteTask={deleteTask}
              onEditEvent={setEditingEventId}
              onCreateAt={(day) => openDayCreator(day)}
            />
          ) : null}

          {mode === "agenda" ? (
            <Agenda
              events={upcomingEvents(events, 16)}
              tasks={calendarTasks}
              exams={exams}
              subjects={subjects}
              onToggleTask={toggleTask}
              onDeleteTask={deleteTask}
              onEditEvent={setEditingEventId}
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
            <Agenda events={upcomingEvents(events, 5)} exams={exams} subjects={subjects} compact onEditEvent={setEditingEventId} />
          </Panel>
        </aside>
      </div>

      {editingEvent ? (
        <EventEditorModal
          event={editingEvent}
          subjects={subjects}
          onClose={() => setEditingEventId(null)}
          onSave={async (patch) => {
            await updateEvent(editingEvent.id, patch);
            setEditingEventId(null);
          }}
          onDelete={async () => {
            const label = editingEvent.title.length > 80 ? `${editingEvent.title.slice(0, 77)}...` : editingEvent.title;
            if (!window.confirm(`Eliminare l'evento "${label}"?`)) return;
            await deleteEvent(editingEvent.id);
            setEditingEventId(null);
          }}
        />
      ) : null}

      {selectedDay ? (
        <DayCreateModal
          day={selectedDay}
          kind={createKind}
          draft={dayDraft}
          subjects={subjects}
          onKindChange={setCreateKind}
          onDraftChange={(patch) => setDayDraft((current) => ({ ...current, ...patch }))}
          onClose={() => setSelectedDay(null)}
          onSubmit={createFromDay}
        />
      ) : null}
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
  onDragStart,
  onEdit
}: {
  event: CalendarEvent;
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onDragStart?: (id: string) => void;
  onEdit?: (id: string) => void;
}) {
  return (
    <button
      type="button"
      draggable
      onClick={(mouseEvent) => {
        mouseEvent.stopPropagation();
        onEdit?.(event.id);
      }}
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
  onDelete,
  compact
}: {
  task: Task;
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onToggle?: (id: string) => void;
  onDelete?: (id: string) => void;
  compact?: boolean;
}) {
  const accent = priorityAccent(task.priority);
  const subjectAccent = subjectColor(subjects, task.subjectId);
  const done = task.status === "done";
  return (
    <div
      className={`motion-safe flex w-full items-center gap-1.5 rounded-[14px] border border-dashed p-1.5 text-left text-[11px] sm:rounded-[18px] sm:p-2 sm:text-xs hover:translate-y-[-1px] ${
        done ? "opacity-55" : ""
      }`}
      style={{
        borderColor: `${accent}80`,
        background: `linear-gradient(135deg, ${subjectAccent}1f, transparent)`
      }}
    >
      <button
        type="button"
        aria-label={done ? `Riapri task ${task.title}` : `Completa task ${task.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onToggle?.(task.id);
        }}
        className="grid h-4 w-4 shrink-0 place-items-center rounded-full border"
        style={{ borderColor: accent, background: done ? accent : "transparent" }}
      >
        {done ? <Icon name="Check" className="h-3 w-3 text-[#10131d]" /> : null}
      </button>
      <span className="min-w-0 flex-1">
        <span className={`one-line-safe block font-black ${done ? "line-through" : ""}`}>{task.title}</span>
        {!compact ? (
          <span className="one-line-safe block font-bold text-[var(--muted)]">
            {task.dueDate ? timeLabel(task.dueDate) : "Task"}
            {task.subjectId ? ` · ${subjectName(subjects, task.subjectId)}` : ""}
          </span>
        ) : null}
      </span>
      {onDelete ? (
        <button
          type="button"
          aria-label={`Elimina task ${task.title}`}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-red-200 hover:bg-red-500/14"
          onClick={(event) => {
            event.stopPropagation();
            const label = task.title.length > 80 ? `${task.title.slice(0, 77)}...` : task.title;
            if (window.confirm(`Eliminare la task "${label}"?`)) onDelete(task.id);
          }}
        >
          <Icon name="Trash2" className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function ExamChip({
  exam,
  subjects,
  compact
}: {
  exam: Exam;
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  compact?: boolean;
}) {
  const color = subjectColor(subjects, exam.subjectId);
  return (
    <div
      className="w-full rounded-[14px] border p-1.5 text-left text-[11px] sm:rounded-[18px] sm:p-2 sm:text-xs"
      style={{ borderColor: `${color}80`, background: `linear-gradient(135deg, ${color}26, transparent)` }}
    >
      <span className="one-line-safe block font-black">Esame · {subjectName(subjects, exam.subjectId)}</span>
      {!compact ? (
        <span className="one-line-safe block font-bold text-[var(--muted)]">{exam.preparation}% preparazione</span>
      ) : null}
    </div>
  );
}

function MonthGrid({
  days,
  events,
  tasks,
  exams,
  subjects,
  onDragStart,
  onDropDay,
  onToggleTask,
  onDeleteTask,
  onEditEvent,
  onCreateDay
}: {
  days: Date[];
  events: CalendarEvent[];
  tasks: Task[];
  exams: Exam[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onDragStart: (id: string) => void;
  onDropDay: (day: Date) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onEditEvent: (id: string) => void;
  onCreateDay: (day: Date) => void;
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
          const dayExams = exams.filter((exam) => isSameDay(parseISO(exam.date), day));
          const total = dayEvents.length + dayTasks.length + dayExams.length;
          const merged = [
            ...dayEvents.map((event) => ({ kind: "event" as const, event })),
            ...dayExams.map((exam) => ({ kind: "exam" as const, exam })),
            ...dayTasks.map((task) => ({ kind: "task" as const, task }))
          ];
          return (
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={0}
              onClick={() => onCreateDay(day)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onCreateDay(day);
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDropDay(day)}
              className="quiet-panel min-h-[78px] cursor-pointer p-1.5 sm:min-h-[124px] sm:p-2"
            >
              <div className="mb-2 flex items-center justify-between gap-1">
                <span className={`text-sm font-black ${isSameDay(day, new Date()) ? "text-[var(--accent)]" : ""}`}>
                  {format(day, "d")}
                </span>
                {total ? (
                  <span className="text-[10px] font-bold text-[var(--muted)] sm:text-xs">
                    {dayEvents.length ? `${dayEvents.length}E` : ""}
                    {dayExams.length ? ` ${dayExams.length}X` : ""}
                    {(dayEvents.length || dayExams.length) && dayTasks.length ? " " : ""}
                    {dayTasks.length ? `${dayTasks.length}T` : ""}
                  </span>
                ) : null}
              </div>
              <div className="space-y-1">
                {merged.slice(0, 3).map((item) =>
                  item.kind === "event" ? (
                    <EventChip key={`e-${item.event.id}`} event={item.event} subjects={subjects} onDragStart={onDragStart} onEdit={onEditEvent} />
                  ) : item.kind === "exam" ? (
                    <ExamChip key={`x-${item.exam.id}`} exam={item.exam} subjects={subjects} compact />
                  ) : (
                    <TaskChip key={`t-${item.task.id}`} task={item.task} subjects={subjects} onToggle={onToggleTask} onDelete={onDeleteTask} compact />
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
  exams,
  subjects,
  onDragStart,
  onDropDay,
  onToggleTask,
  onDeleteTask,
  onEditEvent,
  onCreateDay
}: {
  days: Date[];
  events: CalendarEvent[];
  tasks: Task[];
  exams: Exam[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onDragStart: (id: string) => void;
  onDropDay: (day: Date) => void;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onEditEvent: (id: string) => void;
  onCreateDay: (day: Date) => void;
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
          const dayExams = exams.filter((exam) => isSameDay(parseISO(exam.date), day));
          return (
            <div
              key={day.toISOString()}
              role="button"
              tabIndex={0}
              onClick={() => onCreateDay(day)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onCreateDay(day);
                }
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDropDay(day)}
              className="quiet-panel min-h-[180px] cursor-pointer p-3 lg:min-h-[420px]"
            >
              <div className="mb-3 flex items-baseline justify-between gap-2 lg:block">
                <div>
                  <p className="text-xs font-black uppercase text-[var(--faint)]">{format(day, "EEE", { locale: it })}</p>
                  <p className={`text-2xl font-black sm:text-3xl ${isSameDay(day, new Date()) ? "text-[var(--accent)]" : ""}`}>
                    {format(day, "d")}
                  </p>
                </div>
                {dayEvents.length + dayTasks.length + dayExams.length ? (
                  <span className="text-[10px] font-bold text-[var(--muted)] sm:text-xs">
                    {dayEvents.length}E · {dayExams.length}X · {dayTasks.length}T
                  </span>
                ) : null}
              </div>
              <div className="space-y-2">
                {dayEvents.map((event) => (
                  <EventChip key={event.id} event={event} subjects={subjects} onDragStart={onDragStart} onEdit={onEditEvent} />
                ))}
                {dayExams.map((exam) => (
                  <ExamChip key={exam.id} exam={exam} subjects={subjects} />
                ))}
                {dayTasks.map((task) => (
                  <TaskChip key={task.id} task={task} subjects={subjects} onToggle={onToggleTask} onDelete={onDeleteTask} />
                ))}
                {dayEvents.length + dayTasks.length + dayExams.length === 0 ? (
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
  exams,
  subjects,
  focus,
  onToggleTask,
  onDeleteTask,
  onEditEvent,
  onCreateAt
}: {
  day: Date;
  events: CalendarEvent[];
  tasks: Task[];
  exams: Exam[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  focus?: boolean;
  onToggleTask: (id: string) => void;
  onDeleteTask: (id: string) => void;
  onEditEvent: (id: string) => void;
  onCreateAt: (day: Date) => void;
}) {
  const dayEvents = events.filter((event) => isSameDay(parseISO(event.start), day));
  const dayTasks = tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day));
  const dayExams = exams.filter((exam) => isSameDay(parseISO(exam.date), day));
  const hours = Array.from({ length: focus ? 10 : 15 }, (_, index) => index + (focus ? 8 : 7));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-2xl font-black sm:text-3xl">{focus ? "Vista focus" : format(day, "EEEE d MMMM", { locale: it })}</h3>
        <Pill>{dayEvents.length}E · {dayExams.length}X · {dayTasks.length}T</Pill>
      </div>
      {dayExams.length ? (
        <div className="quiet-panel mb-3 p-3">
          <p className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Esami</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {dayExams.map((exam) => (
              <ExamChip key={exam.id} exam={exam} subjects={subjects} />
            ))}
          </div>
        </div>
      ) : null}
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
              <div
                role="button"
                tabIndex={0}
                onClick={() => {
                  const selected = setHours(startOfDay(day), hour);
                  onCreateAt(selected);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  const selected = setHours(startOfDay(day), hour);
                  onCreateAt(selected);
                }}
                className={`quiet-panel min-h-12 cursor-pointer p-2 ${empty ? "opacity-60" : ""}`}
              >
                <div className="grid gap-2 sm:grid-cols-2">
                  {rowEvents.map((event) => (
                    <EventChip key={event.id} event={event} subjects={subjects} onEdit={onEditEvent} />
                  ))}
                  {rowTasks.map((task) => (
                    <TaskChip key={task.id} task={task} subjects={subjects} onToggle={onToggleTask} onDelete={onDeleteTask} />
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
                  <TaskChip key={task.id} task={task} subjects={subjects} onToggle={onToggleTask} onDelete={onDeleteTask} />
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
  exams,
  subjects,
  compact,
  onToggleTask,
  onDeleteTask,
  onEditEvent
}: {
  events: CalendarEvent[];
  tasks?: Task[];
  exams?: Exam[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  compact?: boolean;
  onToggleTask?: (id: string) => void;
  onDeleteTask?: (id: string) => void;
  onEditEvent?: (id: string) => void;
}) {
  type AgendaItem =
    | { kind: "event"; when: string; event: CalendarEvent }
    | { kind: "task"; when: string; task: Task }
    | { kind: "exam"; when: string; exam: Exam };
  const items: AgendaItem[] = [
    ...events.map((event) => ({ kind: "event" as const, when: event.start, event })),
    ...(exams ?? [])
      .filter((exam) => parseISO(exam.date) >= startOfDay(new Date()))
      .map((exam) => ({ kind: "exam" as const, when: exam.date, exam })),
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
          <button
            key={`e-${item.event.id}`}
            type="button"
            onClick={() => onEditEvent?.(item.event.id)}
            className="quiet-panel flex w-full gap-3 p-3 text-left"
          >
            <span className="mt-1 h-10 w-2 shrink-0 rounded-full" style={{ background: item.event.color }} />
            <div className="min-w-0 flex-1">
              <p className="two-line-safe font-black">{item.event.title}</p>
              <p className="one-line-safe text-sm font-bold text-[var(--muted)]">
                {shortDate(item.event.start)} · {timeLabel(item.event.start)} · {subjectName(subjects, item.event.subjectId)}
              </p>
            </div>
          </button>
        ) : item.kind === "exam" ? (
          <div key={`x-${item.exam.id}`} className="quiet-panel flex gap-3 p-3">
            <span className="mt-1 h-10 w-2 shrink-0 rounded-full" style={{ background: subjectColor(subjects, item.exam.subjectId) }} />
            <div className="min-w-0 flex-1">
              <p className="two-line-safe font-black">Esame · {subjectName(subjects, item.exam.subjectId)}</p>
              <p className="one-line-safe text-sm font-bold text-[var(--muted)]">
                {shortDate(item.exam.date)} · preparazione {item.exam.preparation}%
              </p>
            </div>
          </div>
        ) : (
          <div
            key={`t-${item.task.id}`}
            className={`quiet-panel flex w-full gap-3 p-3 text-left ${item.task.status === "done" ? "opacity-60" : ""}`}
          >
            <button
              type="button"
              onClick={() => onToggleTask?.(item.task.id)}
              aria-label={item.task.status === "done" ? `Riapri task ${item.task.title}` : `Completa task ${item.task.title}`}
              className="mt-1 grid h-6 w-6 shrink-0 place-items-center rounded-full border"
              style={{
                borderColor: priorityAccent(item.task.priority),
                background: item.task.status === "done" ? priorityAccent(item.task.priority) : "transparent"
              }}
            >
              {item.task.status === "done" ? <Icon name="Check" className="h-4 w-4 text-[#10131d]" /> : (
                <Icon name="CircleDot" className="h-3 w-3" />
              )}
            </button>
            <div className="min-w-0 flex-1">
              <p className={`two-line-safe font-black ${item.task.status === "done" ? "line-through" : ""}`}>{item.task.title}</p>
              <p className="one-line-safe text-sm font-bold text-[var(--muted)]">
                Task · {shortDate(item.task.dueDate as string)} · {timeLabel(item.task.dueDate as string)}
                {item.task.subjectId ? ` · ${subjectName(subjects, item.task.subjectId)}` : ""}
              </p>
            </div>
            {onDeleteTask ? (
              <button
                type="button"
                aria-label={`Elimina task ${item.task.title}`}
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-red-200 hover:bg-red-500/14"
                onClick={() => {
                  const label = item.task.title.length > 80 ? `${item.task.title.slice(0, 77)}...` : item.task.title;
                  if (window.confirm(`Eliminare la task "${label}"?`)) onDeleteTask(item.task.id);
                }}
              >
                <Icon name="Trash2" className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        )
      )}
    </div>
  );
}

function EventEditorModal({
  event,
  subjects,
  onClose,
  onSave,
  onDelete
}: {
  event: CalendarEvent;
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onClose: () => void;
  onSave: (patch: Partial<CalendarEvent>) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    title: event.title,
    description: event.description,
    category: event.category,
    subjectId: event.subjectId ?? "",
    priority: event.priority,
    status: event.status,
    start: toDatetimeLocal(event.start),
    end: toDatetimeLocal(event.end),
    color: event.color || subjectColor(subjects, event.subjectId)
  });
  const [error, setError] = useState("");

  const save = async () => {
    if (!draft.title.trim()) {
      setError("Inserisci un titolo.");
      return;
    }
    const start = new Date(draft.start);
    const end = new Date(draft.end);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) {
      setError("La fine deve essere successiva all'inizio.");
      return;
    }
    await onSave({
      title: draft.title.trim(),
      description: draft.description.trim(),
      category: draft.category,
      subjectId: draft.subjectId || undefined,
      priority: draft.priority,
      status: draft.status,
      start: start.toISOString(),
      end: end.toISOString(),
      color: draft.color || subjectColor(subjects, draft.subjectId)
    });
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
      <section className="soft-panel scrollbar-soft max-h-[88vh] w-full max-w-2xl overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="safe-text text-2xl font-black">Modifica evento</h3>
            <p className="two-line-safe text-sm text-[var(--muted)]">Sposta, aggiorna o elimina il blocco calendario.</p>
          </div>
          <Button variant="ghost" icon="X" onClick={onClose}>
            Chiudi
          </Button>
        </div>

        <div className="grid gap-3">
          <Field label="Titolo">
            <input className={inputClass} value={draft.title} onChange={(e) => setDraft((v) => ({ ...v, title: e.target.value }))} />
          </Field>
          <Field label="Descrizione">
            <textarea className={`${inputClass} min-h-24 py-3`} value={draft.description} onChange={(e) => setDraft((v) => ({ ...v, description: e.target.value }))} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Inizio">
              <input className={inputClass} type="datetime-local" value={draft.start} onChange={(e) => setDraft((v) => ({ ...v, start: e.target.value }))} />
            </Field>
            <Field label="Fine">
              <input className={inputClass} type="datetime-local" value={draft.end} onChange={(e) => setDraft((v) => ({ ...v, end: e.target.value }))} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Materia">
              <select className={inputClass} value={draft.subjectId} onChange={(e) => setDraft((v) => ({ ...v, subjectId: e.target.value, color: subjectColor(subjects, e.target.value) }))}>
                <option value="">Nessuna</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Categoria">
              <select className={inputClass} value={draft.category} onChange={(e) => setDraft((v) => ({ ...v, category: e.target.value as EventCategory }))}>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Priorita">
              <select className={inputClass} value={draft.priority} onChange={(e) => setDraft((v) => ({ ...v, priority: e.target.value as CalendarEvent["priority"] }))}>
                <option value="low">Bassa</option>
                <option value="medium">Media</option>
                <option value="high">Alta</option>
                <option value="urgent">Urgente</option>
              </select>
            </Field>
            <Field label="Stato">
              <select className={inputClass} value={draft.status} onChange={(e) => setDraft((v) => ({ ...v, status: e.target.value as CalendarEvent["status"] }))}>
                <option value="planned">Pianificato</option>
                <option value="in-progress">In corso</option>
                <option value="done">Fatto</option>
                <option value="skipped">Saltato</option>
              </select>
            </Field>
            <Field label="Colore">
              <input
                className="h-11 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-1"
                type="color"
                value={draft.color.startsWith("#") ? draft.color : "#7CF7C8"}
                onChange={(e) => setDraft((v) => ({ ...v, color: e.target.value }))}
              />
            </Field>
          </div>
          {error ? <p className="rounded-[18px] border border-red-400/30 bg-red-500/10 p-3 text-sm font-bold text-red-200">{error}</p> : null}
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <Button variant="danger" icon="Trash2" onClick={onDelete}>
              Elimina
            </Button>
            <Button variant="soft" onClick={onClose}>
              Annulla
            </Button>
            <Button variant="primary" icon="Check" onClick={save}>
              Salva evento
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function DayCreateModal({
  day,
  kind,
  draft,
  subjects,
  onKindChange,
  onDraftChange,
  onClose,
  onSubmit
}: {
  day: Date;
  kind: "event" | "task";
  draft: { title: string; subjectId: string; startsAt: string; priority: Task["priority"] };
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onKindChange: (kind: "event" | "task") => void;
  onDraftChange: (patch: Partial<{ title: string; subjectId: string; startsAt: string; priority: Task["priority"] }>) => void;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}) {
  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center" role="dialog" aria-modal="true">
      <section className="soft-panel w-full max-w-xl p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="safe-text text-2xl font-black">Aggiungi al {shortDate(day)}</h3>
            <p className="text-sm text-[var(--muted)]">Crea un evento o una task direttamente dal calendario.</p>
          </div>
          <Button variant="ghost" icon="X" onClick={onClose}>
            Chiudi
          </Button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-2">
          {(["event", "task"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onKindChange(item)}
              className={`min-h-11 rounded-[18px] border px-3 text-sm font-black ${
                kind === item ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--border)] bg-[var(--surface-soft)]"
              }`}
            >
              {item === "event" ? "Evento" : "Task"}
            </button>
          ))}
        </div>

        <div className="grid gap-3">
          <Field label="Titolo">
            <input className={inputClass} value={draft.title} onChange={(e) => onDraftChange({ title: e.target.value })} autoFocus />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Materia">
              <select className={inputClass} value={draft.subjectId} onChange={(e) => onDraftChange({ subjectId: e.target.value })}>
                <option value="">Nessuna</option>
                {subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Data e ora">
              <input className={inputClass} type="datetime-local" value={draft.startsAt} onChange={(e) => onDraftChange({ startsAt: e.target.value })} />
            </Field>
          </div>
          <Field label="Priorita">
            <select className={inputClass} value={draft.priority} onChange={(e) => onDraftChange({ priority: e.target.value as Task["priority"] })}>
              <option value="low">Bassa</option>
              <option value="medium">Media</option>
              <option value="high">Alta</option>
              <option value="urgent">Urgente</option>
            </select>
          </Field>
          <div className="mt-2 flex justify-end gap-2">
            <Button variant="soft" onClick={onClose}>
              Annulla
            </Button>
            <Button variant="primary" icon="Plus" onClick={onSubmit} disabled={!draft.title.trim()}>
              Crea {kind === "event" ? "evento" : "task"}
            </Button>
          </div>
        </div>
      </section>
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
