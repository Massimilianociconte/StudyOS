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
import type { CalendarEvent } from "../types";
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
  const { events, subjects, exams, updateEvent, addEvent } = useStudyStore();

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

      <div className="mb-4 flex flex-wrap gap-2">
        {modes.map((item) => (
          <button key={item.id} type="button" onClick={() => setMode(item.id)}>
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
              subjects={subjects}
              onDragStart={setDraggedId}
              onDropDay={(day) => {
                if (draggedId) moveEventToDay(draggedId, day);
                setDraggedId(null);
              }}
            />
          ) : null}

          {mode === "week" ? (
            <WeekGrid
              days={weekDays}
              events={events}
              subjects={subjects}
              onDragStart={setDraggedId}
              onDropDay={(day) => {
                if (draggedId) moveEventToDay(draggedId, day);
                setDraggedId(null);
              }}
            />
          ) : null}

          {mode === "day" || mode === "focus" ? (
            <DayTimeline day={cursor} events={events} subjects={subjects} focus={mode === "focus"} />
          ) : null}

          {mode === "agenda" ? <Agenda events={upcomingEvents(events, 16)} subjects={subjects} /> : null}
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
      className="motion-safe w-full rounded-[18px] border border-white/10 p-2 text-left text-xs hover:translate-y-[-1px]"
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

function MonthGrid({
  days,
  events,
  subjects,
  onDragStart,
  onDropDay
}: {
  days: Date[];
  events: CalendarEvent[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onDragStart: (id: string) => void;
  onDropDay: (day: Date) => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-3xl font-black">{format(days[15], "MMMM yyyy", { locale: it })}</h3>
        <Pill>drag and drop</Pill>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {["Lun", "Mar", "Mer", "Gio", "Ven", "Sab", "Dom"].map((day) => (
          <div key={day} className="px-2 text-xs font-black uppercase text-[var(--faint)]">
            {day}
          </div>
        ))}
        {days.map((day) => {
          const dayEvents = events.filter((event) => isSameDay(parseISO(event.start), day));
          return (
            <div
              key={day.toISOString()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDropDay(day)}
              className="quiet-panel min-h-[118px] p-2"
            >
              <div className="mb-2 flex items-center justify-between">
                <span className={`text-sm font-black ${isSameDay(day, new Date()) ? "text-[var(--accent)]" : ""}`}>
                  {format(day, "d")}
                </span>
                {dayEvents.length ? <span className="text-xs font-bold text-[var(--muted)]">{dayEvents.length}</span> : null}
              </div>
              <div className="space-y-1">
                {dayEvents.slice(0, 3).map((event) => (
                  <EventChip key={event.id} event={event} subjects={subjects} onDragStart={onDragStart} />
                ))}
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
  subjects,
  onDragStart,
  onDropDay
}: {
  days: Date[];
  events: CalendarEvent[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  onDragStart: (id: string) => void;
  onDropDay: (day: Date) => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-3xl font-black">Settimana</h3>
        <Pill>{shortDate(days[0])} - {shortDate(days[6])}</Pill>
      </div>
      <div className="grid gap-3 lg:grid-cols-7">
        {days.map((day) => {
          const dayEvents = events.filter((event) => isSameDay(parseISO(event.start), day));
          return (
            <div
              key={day.toISOString()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={() => onDropDay(day)}
              className="quiet-panel min-h-[420px] p-3"
            >
              <div className="mb-3">
                <p className="text-xs font-black uppercase text-[var(--faint)]">{format(day, "EEE", { locale: it })}</p>
                <p className={`text-3xl font-black ${isSameDay(day, new Date()) ? "text-[var(--accent)]" : ""}`}>
                  {format(day, "d")}
                </p>
              </div>
              <div className="space-y-2">
                {dayEvents.map((event) => (
                  <EventChip key={event.id} event={event} subjects={subjects} onDragStart={onDragStart} />
                ))}
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
  subjects,
  focus
}: {
  day: Date;
  events: CalendarEvent[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  focus?: boolean;
}) {
  const dayEvents = events.filter((event) => isSameDay(parseISO(event.start), day));
  const hours = Array.from({ length: focus ? 10 : 15 }, (_, index) => index + (focus ? 8 : 7));

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-3xl font-black">{focus ? "Vista focus" : format(day, "EEEE d MMMM", { locale: it })}</h3>
        <Pill>{dayEvents.length} eventi</Pill>
      </div>
      <div className="space-y-2">
        {hours.map((hour) => {
          const rowEvents = dayEvents.filter((event) => parseISO(event.start).getHours() === hour);
          return (
            <div key={hour} className="grid grid-cols-[64px_1fr] gap-3">
              <div className="pt-3 text-sm font-black text-[var(--faint)]">{String(hour).padStart(2, "0")}:00</div>
              <div className="quiet-panel min-h-16 p-2">
                <div className="grid gap-2 md:grid-cols-2">
                  {rowEvents.map((event) => (
                    <EventChip key={event.id} event={event} subjects={subjects} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Agenda({
  events,
  subjects,
  compact
}: {
  events: CalendarEvent[];
  subjects: ReturnType<typeof useStudyStore.getState>["subjects"];
  compact?: boolean;
}) {
  return (
    <div className={compact ? "space-y-2" : "grid gap-3 md:grid-cols-2"}>
      {events.map((event) => (
        <div key={event.id} className="quiet-panel flex gap-3 p-3">
          <span className="mt-1 h-10 w-2 shrink-0 rounded-full" style={{ background: event.color }} />
          <div className="min-w-0 flex-1">
            <p className="two-line-safe font-black">{event.title}</p>
            <p className="text-sm font-bold text-[var(--muted)]">
              {shortDate(event.start)} · {timeLabel(event.start)} · {subjectName(subjects, event.subjectId)}
            </p>
          </div>
        </div>
      ))}
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
