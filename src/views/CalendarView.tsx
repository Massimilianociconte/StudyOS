import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  addDays,
  addMinutes,
  addMonths,
  addWeeks,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  setHours,
  startOfDay,
  startOfMonth,
  startOfWeek
} from "date-fns";
import { it } from "date-fns/locale";
import { useStudyStore } from "../store/useStudyStore";
import type { CalendarEvent, EventCategory, Exam, Task } from "../types";
import { Button, Field, IconButton, Panel, ProgressBar, SectionTitle, Segmented, Tag, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";
import { BarbExamImport } from "../components/BarbExamImport";
import { SEMESTER_LABEL, SEMESTER_TONE, subjectSemester } from "../lib/semesters";
import { safeHref } from "../lib/safeUrl";
import { CalendarTransfer } from "../components/CalendarTransfer";
import { TaskEditorModal } from "../components/TaskEditorModal";
import { allDayRange, daysUntil, eventMinutes, isAllDayEvent, selectableSubjects, shortDate, studyDaysLabel, subjectColor, subjectName, timeLabel } from "../lib/selectors";
import { formatElapsedSeconds, isTaskCompletedLate, isTaskTimerRunning, taskElapsedSeconds } from "../lib/taskTimer";
import { expandEvents, RECURRENCE_LABEL, type EventOccurrence } from "../lib/recurrence";
import {
  ALL_DAY_LABEL,
  ENERGY_LABEL,
  EVENT_CATEGORY_LABEL,
  EVENT_STATUS_LABEL,
  EXAM_STATUS_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  TASK_STATUS_LABEL,
  capitalizeFirst,
  formatMinutes
} from "../lib/labels";
import { useNow } from "../hooks/useNow";
import { isNullableString, oneOf, useUiState, writeUiState } from "../lib/uiState";
import { CourseIcon } from "../components/CourseIcon";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { resolveBarbCourse } from "../lib/university/examSessions";

type CalendarMode = "day" | "week" | "month" | "agenda" | "exam" | "semester" | "focus";
type Subjects = ReturnType<typeof useStudyStore.getState>["subjects"];

const modes: { id: CalendarMode; label: string; title: string }[] = [
  { id: "day", label: "Giorno", title: "Un solo giorno, ora per ora" },
  { id: "week", label: "Settimana", title: "Griglia oraria di 7 giorni (elenco su telefono)" },
  { id: "month", label: "Mese", title: "Panoramica del mese, un riquadro al giorno" },
  { id: "agenda", label: "Agenda", title: "Elenco di eventi, scadenze ed esami dei prossimi 14 giorni" },
  { id: "exam", label: "Sessione", title: "Conto alla rovescia degli esami in arrivo" },
  { id: "semester", label: "Semestre", title: "Panoramica delle materie con conteggio eventi" },
  { id: "focus", label: "Focus", title: "Giornata concentrata 8–19, senza distrazioni" }
];

const categories = (Object.keys(EVENT_CATEGORY_LABEL) as EventCategory[]).map((id) => ({ id, label: EVENT_CATEGORY_LABEL[id] }));

const toDatetimeLocal = (date: string | Date) => {
  const value = typeof date === "string" ? new Date(date) : date;
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

/** Prossima mezz'ora utile (o le 9:00 per un giorno senza orario). */
const defaultStartFor = (day: Date) => {
  if (day.getHours() || day.getMinutes()) {
    const selected = new Date(day);
    selected.setSeconds(0, 0);
    return selected;
  }
  if (isSameDay(day, new Date())) {
    const next = new Date();
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() < 30 ? 30 : 60);
    return next;
  }
  return setHours(startOfDay(day), 9);
};

type PreviewPoint = { x: number; y: number };
type CalendarPreviewState =
  | { kind: "event"; event: CalendarEvent; x: number; y: number }
  | { kind: "task"; task: Task; x: number; y: number };

const supportsHoverPreview = () => typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const pointerPoint = (event: ReactMouseEvent<HTMLElement>): PreviewPoint => ({ x: event.clientX, y: event.clientY });

interface Handlers {
  subjects: Subjects;
  onEditEvent: (id: string) => void;
  onEditTask: (id: string) => void;
  onToggleTask: (id: string) => void;
  onCreate: (at: Date, kind?: "event" | "task") => void;
  onMoveEvent: (occurrence: EventOccurrence, nextStart: Date) => void;
  onPreviewEvent: (event: CalendarEvent, point: PreviewPoint) => void;
  onPreviewTask: (task: Task, point: PreviewPoint) => void;
  onPreviewMove: (point: PreviewPoint) => void;
  onPreviewHide: () => void;
}

const eventColor = (event: CalendarEvent, subjects: Subjects) => event.color || subjectColor(subjects, event.subjectId);
const allDayEventLabel = (event: CalendarEvent) => event.tags?.includes("appello-importato") ? "Data appello" : ALL_DAY_LABEL;

export function CalendarView() {
  const [mode, setMode] = useUiState<CalendarMode>("calendar.mode", "week", { validate: oneOf(...modes.map((item) => item.id)) });
  // Data visualizzata e dettaglio aperto restano dopo un refresh della scheda.
  const [cursorIso, setCursorIso] = useUiState("calendar.cursor", () => new Date().toISOString(), {
    scope: "tab",
    validate: (value) => typeof value === "string" && !Number.isNaN(Date.parse(value))
  });
  const cursor = useMemo(() => new Date(cursorIso), [cursorIso]);
  const setCursor = useCallback(
    (next: Date | ((current: Date) => Date)) => setCursorIso((iso) => (typeof next === "function" ? next(new Date(iso)) : next).toISOString()),
    [setCursorIso]
  );
  const [editingEventId, setEditingEventId] = useUiState<string | null>("calendar.editingEvent", null, { scope: "tab", validate: isNullableString });
  const [editingTaskId, setEditingTaskId] = useUiState<string | null>("calendar.editingTask", null, { scope: "tab", validate: isNullableString });
  const [creator, setCreator] = useState<{ at: Date; kind: "event" | "task" } | null>(null);
  const [preview, setPreview] = useState<CalendarPreviewState | null>(null);
  const [barbImportOpen, setBarbImportOpen] = useState(false);
  const { events, subjects, exams, tasks, updateEvent, addEvent, deleteEvent, addTask, updateTask, toggleTask, deleteTask, setActiveView } = useStudyStore();
  const calendarTasks = useMemo(() => tasks.filter((task) => task.dueDate && task.status !== "archived"), [tasks]);
  const editingEvent = editingEventId ? events.find((event) => event.id === editingEventId) ?? null : null;
  const editingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) ?? null : null;

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [cursor]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(cursor, { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end: addDays(start, 6) });
  }, [cursor]);

  const range = useMemo(() => {
    if (mode === "month") return { from: monthDays[0], to: addDays(monthDays[monthDays.length - 1], 1) };
    if (mode === "week") return { from: weekDays[0], to: addDays(weekDays[6], 1) };
    if (mode === "agenda") return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 14) };
    return { from: startOfDay(cursor), to: addDays(startOfDay(cursor), 1) };
  }, [mode, cursor, monthDays, weekDays]);

  const occurrences = useMemo(() => expandEvents(events, range.from, range.to), [events, range]);

  const navigate = (direction: -1 | 1) => {
    setCursor((current) => {
      if (mode === "day" || mode === "focus") return addDays(current, direction);
      if (mode === "week") return addWeeks(current, direction);
      if (mode === "agenda") return addDays(current, direction * 14);
      if (mode === "semester") return addMonths(current, direction * 6);
      return addMonths(current, direction);
    });
  };

  const periodLabel =
    mode === "month"
      ? format(cursor, "MMMM yyyy", { locale: it })
      : mode === "week"
        ? `${format(weekDays[0], "d MMM", { locale: it })} – ${format(weekDays[6], "d MMM yyyy", { locale: it })}`
        : mode === "agenda"
          ? `${format(range.from, "d MMM", { locale: it })} – ${format(addDays(range.to, -1), "d MMM", { locale: it })}`
          : mode === "day" || mode === "focus"
            ? format(cursor, "EEEE d MMMM yyyy", { locale: it })
            : "";
  const navigable = mode !== "exam" && mode !== "semester";

  const moveEvent = async (item: EventOccurrence, nextStart: Date) => {
    const series = events.find((event) => event.id === item.id);
    if (!series || Number.isNaN(nextStart.getTime())) return;
    // Spostare un'occorrenza sposta l'intera serie dello stesso scarto (niente eccezioni per singola data).
    const delta = nextStart.getTime() - parseISO(item.start).getTime();
    if (!delta) return;
    if (item.recurring && !window.confirm(`"${series.title}" è un evento ripetuto: spostare tutta la serie?`)) return;
    const start = new Date(parseISO(series.start).getTime() + delta);
    const end = new Date(parseISO(series.end).getTime() + delta);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return;
    await updateEvent(series.id, { start: start.toISOString(), end: end.toISOString() });
  };

  const handlers: Handlers = {
    subjects,
    onEditEvent: setEditingEventId,
    onEditTask: setEditingTaskId,
    onToggleTask: (id) => void toggleTask(id),
    onCreate: (at, kind = "event") => setCreator({ at, kind }),
    onMoveEvent: (item, nextStart) => void moveEvent(item, nextStart),
    onPreviewEvent: (event, point) => {
      if (supportsHoverPreview()) setPreview({ kind: "event", event, x: point.x, y: point.y });
    },
    onPreviewTask: (task, point) => {
      if (supportsHoverPreview()) setPreview({ kind: "task", task, x: point.x, y: point.y });
    },
    onPreviewMove: (point) => setPreview((current) => (current ? { ...current, x: point.x, y: point.y } : current)),
    onPreviewHide: () => setPreview(null)
  };

  return (
    <div>
      <SectionTitle
        title="Calendario personale"
        subtitle="I tuoi eventi, scadenze ed esami. Gli appelli BARB compaiono qui quando scegli di importarli."
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <CalendarTransfer />
            <Button icon="CalendarPlus" variant="soft" onClick={() => setBarbImportOpen(true)}>
              Importa appelli BARB
            </Button>
            <Button icon="Plus" variant="primary" onClick={() => setCreator({ at: defaultStartFor(new Date()), kind: "event" })}>
              Nuovo
            </Button>
          </div>
        }
      />

      <div className="quiet-panel mb-4 flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span className="font-bold text-[var(--muted)]">Calendario dello studente · appelli selezionati e impegni personali</span>
        <Button variant="ghost" icon="Landmark" onClick={() => { writeUiState("exams.tab", "barb", "device"); setActiveView("exams"); }}>Calendario Esami BARB</Button>
      </div>
      {barbImportOpen ? <BarbExamImport onClose={() => setBarbImportOpen(false)} /> : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented label="Vista calendario" value={mode} onChange={setMode} options={modes} />
        {navigable ? (
          <div className="flex items-center gap-1.5 sm:ml-auto">
            <p className="mr-1 min-w-0 truncate text-sm font-black capitalize">{periodLabel}</p>
            <IconButton icon="ChevronLeft" label="Periodo precedente" onClick={() => navigate(-1)} />
            <button
              type="button"
              onClick={() => setCursor(new Date())}
              className="min-h-11 rounded-full bg-[var(--surface-strong)] px-3.5 text-xs font-black hover:bg-[var(--surface)]"
            >
              Oggi
            </button>
            <IconButton icon="ChevronRight" label="Periodo successivo" onClick={() => navigate(1)} />
          </div>
        ) : (
          <p className="min-h-11 content-center text-sm font-black text-[var(--muted)] sm:ml-auto">
            {mode === "exam" ? "Tutti gli esami" : "Panoramica materie"}
          </p>
        )}
      </div>

      <Panel>
        {mode === "week" ? (
          <>
            <div className="hidden md:block">
              <TimeGrid days={weekDays} occurrences={occurrences} tasks={calendarTasks} exams={exams} handlers={handlers} onPickDay={(day) => {
                setCursor(day);
                setMode("day");
              }} />
            </div>
            <div className="md:hidden">
              <DayList days={weekDays} occurrences={occurrences} tasks={calendarTasks} exams={exams} handlers={handlers} />
            </div>
          </>
        ) : null}

        {mode === "day" || mode === "focus" ? (
          <TimeGrid
            days={[startOfDay(cursor)]}
            occurrences={occurrences}
            tasks={calendarTasks}
            exams={exams}
            handlers={handlers}
            hourHeight={mode === "focus" ? 64 : 52}
            fixedHours={mode === "focus" ? [8, 19] : undefined}
            onExpandHours={mode === "focus" ? () => setMode("day") : undefined}
          />
        ) : null}

        {mode === "month" ? (
          <MonthGrid
            days={monthDays}
            month={cursor}
            occurrences={occurrences}
            tasks={calendarTasks}
            exams={exams}
            handlers={handlers}
            onPickDay={(day) => {
              setCursor(day);
              setMode("day");
            }}
          />
        ) : null}

        {mode === "agenda" ? <Agenda from={range.from} to={range.to} occurrences={occurrences} tasks={calendarTasks} exams={exams} handlers={handlers} /> : null}
        {mode === "exam" ? <ExamSession exams={exams} subjects={subjects} onGoExams={() => setActiveView("exams")} /> : null}
        {mode === "semester" ? <SemesterMap events={events} subjects={subjects} /> : null}
      </Panel>

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
            const series = editingEvent.recurrence && editingEvent.recurrence !== "none" ? " (tutta la serie)" : "";
            if (!window.confirm(`Eliminare l'evento "${label}"${series}?`)) return;
            await deleteEvent(editingEvent.id);
            setEditingEventId(null);
          }}
        />
      ) : null}

      {creator ? (
        <CreateModal
          initial={creator}
          subjects={subjects}
          onClose={() => setCreator(null)}
          onSubmit={async (draft) => {
            if (draft.kind === "task") {
              await addTask({
                title: draft.title,
                dueDate: draft.start.toISOString(),
                subjectId: draft.subjectId || undefined,
                priority: draft.priority,
                importance: draft.priority === "urgent" ? 5 : draft.priority === "high" ? 4 : 3
              });
            } else {
              const range = draft.allDay ? allDayRange(draft.start) : { start: draft.start.toISOString(), end: addMinutes(draft.start, draft.duration).toISOString() };
              await addEvent({
                title: draft.title,
                start: range.start,
                end: range.end,
                allDay: draft.allDay || undefined,
                subjectId: draft.subjectId || undefined,
                color: subjectColor(subjects, draft.subjectId, "#7CF7C8"),
                priority: draft.priority,
                category: draft.category,
                recurrence: draft.recurrence
              });
            }
            setCreator(null);
          }}
        />
      ) : null}

      {editingTask ? (
        <TaskEditorModal
          task={editingTask}
          subjects={subjects}
          onClose={() => setEditingTaskId(null)}
          onSave={updateTask}
          onDelete={async (task) => {
            const label = task.title.length > 80 ? `${task.title.slice(0, 77)}...` : task.title;
            if (!window.confirm(`Eliminare la task "${label}"?`)) return;
            await deleteTask(task.id);
            setEditingTaskId(null);
            setPreview(null);
          }}
        />
      ) : null}

      {preview ? <CalendarHoverPreview preview={preview} subjects={subjects} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Griglia oraria (settimana / giorno / focus)                          */
/* ------------------------------------------------------------------ */

interface Placed {
  item: EventOccurrence;
  startMin: number;
  endMin: number;
  lane: number;
  lanes: number;
}

/** Eventi sovrapposti affiancati in colonne (come Google/Apple Calendar). */
const layoutDay = (items: Omit<Placed, "lane" | "lanes">[]): Placed[] => {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const result: Placed[] = [];
  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const laneEnds: number[] = [];
    for (const entry of cluster) {
      let lane = laneEnds.findIndex((end) => end <= entry.startMin);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(entry.endMin);
      } else {
        laneEnds[lane] = entry.endMin;
      }
      entry.lane = lane;
    }
    for (const entry of cluster) result.push({ ...entry, lanes: laneEnds.length });
    cluster = [];
  };
  for (const entry of sorted) {
    if (cluster.length && entry.startMin >= clusterEnd) {
      flush();
      clusterEnd = -1;
    }
    cluster.push({ ...entry, lane: 0, lanes: 1 });
    clusterEnd = Math.max(clusterEnd, entry.endMin);
  }
  if (cluster.length) flush();
  return result;
};

const minutesInDay = (occurrence: EventOccurrence, day: Date) => {
  const dayStart = startOfDay(day).getTime();
  const start = Math.max(0, (parseISO(occurrence.start).getTime() - dayStart) / 60_000);
  const end = Math.min(24 * 60, (parseISO(occurrence.end).getTime() - dayStart) / 60_000);
  return { startMin: start, endMin: Math.max(end, start + 15) };
};

function TimeGrid({
  days,
  occurrences,
  tasks,
  exams,
  handlers,
  hourHeight = 46,
  fixedHours,
  onPickDay,
  onExpandHours
}: {
  days: Date[];
  occurrences: EventOccurrence[];
  tasks: Task[];
  exams: Exam[];
  handlers: Handlers;
  hourHeight?: number;
  fixedHours?: [number, number];
  onPickDay?: (day: Date) => void;
  onExpandHours?: () => void;
}) {
  const now = useNow(60_000);
  const grab = useRef<{ key: string; offsetMin: number } | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Larghezza di una colonna giorno (52 px di etichette orarie, 6 px tra le colonne).
  const columnWidth = containerWidth ? (containerWidth - 52 - days.length * 6) / days.length : 200;

  const perDay = days.map((day) => {
    const dayStart = startOfDay(day).getTime();
    const dayEnd = dayStart + 24 * 60 * 60_000;
    const dayEvents = occurrences.filter((item) => parseISO(item.start).getTime() < dayEnd && parseISO(item.end).getTime() > dayStart);
    // Gli eventi "Tutto il giorno" non occupano corsie orarie: stanno nella riga in alto.
    const timed = dayEvents.filter((item) => !isAllDayEvent(item));
    return {
      day,
      allDay: dayEvents.filter(isAllDayEvent),
      placed: layoutDay(timed.map((item) => ({ item, ...minutesInDay(item, day) }))),
      tasks: tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day)).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
      exams: exams.filter((exam) => isSameDay(parseISO(exam.date), day))
    };
  });

  // Fascia oraria: 8–20 di base, allargata per includere gli eventi visibili.
  let [hourStart, hourEnd] = fixedHours ?? [8, 20];
  if (!fixedHours) {
    for (const entry of perDay) {
      for (const placed of entry.placed) {
        hourStart = Math.min(hourStart, Math.floor(placed.startMin / 60));
        hourEnd = Math.max(hourEnd, Math.ceil(placed.endMin / 60));
      }
    }
    hourStart = Math.max(0, hourStart);
    hourEnd = Math.min(24, hourEnd);
  }

  const hours = Array.from({ length: hourEnd - hourStart }, (_, index) => hourStart + index);
  const gridHeight = hours.length * hourHeight;
  const hasAllDay = perDay.some((entry) => entry.allDay.length || entry.tasks.length || entry.exams.length);
  // Fascia fissa (Focus 8–19): eventi interamente fuori fascia, che la griglia taglia.
  const hiddenBefore = fixedHours ? perDay.reduce((sum, entry) => sum + entry.placed.filter((placed) => placed.endMin <= hourStart * 60).length, 0) : 0;
  const hiddenAfter = fixedHours ? perDay.reduce((sum, entry) => sum + entry.placed.filter((placed) => placed.startMin >= hourEnd * 60).length, 0) : 0;
  const columns = `52px repeat(${days.length}, minmax(0, 1fr))`;

  const minutesFromPointer = (event: ReactMouseEvent<HTMLElement> | ReactDragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = hourStart * 60 + ((event.clientY - rect.top) / hourHeight) * 60;
    return Math.max(0, Math.min(24 * 60 - 15, Math.round(minutes / 15) * 15));
  };

  return (
    <div className="min-w-0" ref={containerRef}>
      {/* intestazione giorni */}
      <div className="grid grid-cols-1 gap-x-1.5" style={{ gridTemplateColumns: columns }}>
        <span />
        {days.map((day) => {
          const today = isSameDay(day, now);
          const content = (
            <>
              <span className="text-[11px] font-black uppercase text-[var(--faint)]">{format(day, "EEE", { locale: it })}</span>
              <span
                className={`grid h-8 min-w-8 place-items-center rounded-full px-1.5 text-lg font-black ${today ? "bg-[var(--accent)] text-[#10131d]" : ""}`}
              >
                {format(day, "d")}
              </span>
            </>
          );
          return onPickDay ? (
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onPickDay(day)}
              className="flex items-center justify-center gap-1.5 rounded-[14px] py-1 hover:bg-[var(--surface-soft)] hover:underline hover:decoration-[var(--faint)] hover:underline-offset-4"
              aria-label={`Apri ${format(day, "EEEE d MMMM", { locale: it })}`}
              title={`Apri ${format(day, "EEEE d MMMM", { locale: it })}`}
            >
              {content}
            </button>
          ) : (
            <div key={day.toISOString()} className="flex items-center gap-1.5 py-1">
              {content}
            </div>
          );
        })}
      </div>

      {/* riga "tutto il giorno": eventi senza orario, esami e task in scadenza */}
      {hasAllDay ? (
        <div className="mt-1.5 grid gap-x-1.5 border-b border-[var(--border)] pb-1.5" style={{ gridTemplateColumns: columns }}>
          <span
            className="pt-1 text-right text-[10px] font-black uppercase leading-tight text-[var(--faint)]"
            title="Eventi di tutto il giorno, esami e scadenze"
          >
            Tutto il giorno
          </span>
          {perDay.map((entry) => {
            const dayKey = entry.day.toISOString();
            const base = days.length > 1 ? 3 : 12;
            const expanded = expandedDays.includes(dayKey);
            const limit = expanded ? Number.MAX_SAFE_INTEGER : base;
            const hidden = entry.tasks.length - limit;
            return (
              <div key={dayKey} className="grid grid-cols-1 min-w-0 content-start gap-1">
                {entry.allDay.map((item) => (
                  <AllDayChip key={item.occurrenceKey} item={item} handlers={handlers} />
                ))}
                {entry.exams.map((exam) => (
                  <ExamChip key={exam.id} exam={exam} subjects={handlers.subjects} />
                ))}
                {entry.tasks.slice(0, limit).map((task) => (
                  <TaskChip key={task.id} task={task} handlers={handlers} />
                ))}
                {hidden > 0 ? (
                  <button
                    type="button"
                    onClick={() => (days.length > 1 ? onPickDay?.(entry.day) : setExpandedDays((value) => [...value, dayKey]))}
                    className="flex min-h-11 items-center text-left text-[11px] font-black text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    +{hidden} altre
                  </button>
                ) : expanded && days.length === 1 && entry.tasks.length > base ? (
                  <button
                    type="button"
                    onClick={() => setExpandedDays((value) => value.filter((key) => key !== dayKey))}
                    className="flex min-h-11 items-center text-left text-[11px] font-black text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    Mostra meno
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      {hiddenBefore > 0 ? (
        <button
          type="button"
          onClick={onExpandHours}
          className="mt-1.5 w-full rounded-[14px] bg-[var(--surface-soft)] px-3 py-2 text-center text-xs font-black text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
        >
          {hiddenBefore} {hiddenBefore === 1 ? "evento prima" : "eventi prima"} delle {String(hourStart).padStart(2, "0")}:00 · mostra tutto
        </button>
      ) : null}

      {/* corpo orario */}
      <div className="relative mt-1.5 grid gap-x-1.5" style={{ gridTemplateColumns: columns }}>
        <div className="relative" style={{ height: gridHeight }}>
          {hours.map((hour) => (
            <span
              key={hour}
              className="absolute right-1 -translate-y-1/2 text-[11px] font-black text-[var(--faint)]"
              style={{ top: (hour - hourStart) * hourHeight }}
            >
              {hour === hourStart ? "" : `${String(hour).padStart(2, "0")}:00`}
            </span>
          ))}
        </div>
        {perDay.map((entry) => {
          const key = entry.day.toISOString();
          const today = isSameDay(entry.day, now);
          const nowMin = (now.getTime() - startOfDay(entry.day).getTime()) / 60_000;
          return (
            <div
              key={key}
              role="presentation"
              title="Clicca per creare un evento qui"
              className={`relative cursor-copy overflow-hidden rounded-[14px] ${dropTarget === key ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : today ? "bg-[var(--surface-soft)]" : ""}`}
              style={{
                height: gridHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${hourHeight}px)`
              }}
              onClick={(event) => {
                const minutes = minutesFromPointer(event);
                handlers.onCreate(addMinutes(startOfDay(entry.day), Math.floor(minutes / 30) * 30));
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                setDropTarget(key);
              }}
              onDragLeave={() => setDropTarget((value) => (value === key ? null : value))}
              onDrop={(event) => {
                event.preventDefault();
                setDropTarget(null);
                const dragged = grab.current;
                grab.current = null;
                if (!dragged) return;
                const item = occurrences.find((occurrence) => occurrence.occurrenceKey === dragged.key);
                if (!item) return;
                const minutes = Math.max(0, minutesFromPointer(event) - Math.round(dragged.offsetMin / 15) * 15);
                handlers.onMoveEvent(item, addMinutes(startOfDay(entry.day), minutes));
              }}
            >
              {today && nowMin >= hourStart * 60 && nowMin <= hourEnd * 60 ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute left-0 right-0 z-10 h-0.5 bg-[var(--accent-3)]"
                  style={{ top: ((nowMin - hourStart * 60) / 60) * hourHeight }}
                >
                  <span className="absolute -left-1 -top-1 h-2.5 w-2.5 rounded-full bg-[var(--accent-3)]" />
                </span>
              ) : null}
              {entry.placed.map((placed) => {
                const top = ((placed.startMin - hourStart * 60) / 60) * hourHeight;
                const height = Math.max(20, ((placed.endMin - placed.startMin) / 60) * hourHeight - 2);
                const color = eventColor(placed.item, handlers.subjects);
                const width = 100 / placed.lanes;
                // Colonne strette (tablet in verticale): eventi sovrapposti a cascata invece che
                // in corsie affiancate da 30 px, dove il titolo diventerebbe illeggibile.
                const cascade = placed.lanes > 1 && columnWidth / placed.lanes < 72;
                const position = cascade
                  ? { left: `${placed.lane * 10}px`, width: `calc(100% - ${placed.lane * 10 + 2}px)`, zIndex: 1 + placed.lane }
                  : { left: `calc(${placed.lane * width}% + 1px)`, width: `calc(${width}% - 3px)` };
                // Righe disponibili nel blocco: il titolo ha la precedenza (colonne strette su tablet),
                // l'orario compare da 3 righe, la materia da 5.
                const lineCount = Math.max(1, Math.floor((height - 6) / 13.75));
                const showTime = lineCount >= 3;
                const showSubject = lineCount >= 5 && Boolean(placed.item.subjectId);
                const titleLines = Math.min(5, Math.max(1, lineCount - (showTime ? 1 : 0) - (showSubject ? 1 : 0)));
                return (
                  <button
                    key={placed.item.occurrenceKey}
                    type="button"
                    draggable
                    onDragStart={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      grab.current = { key: placed.item.occurrenceKey, offsetMin: ((event.clientY - rect.top) / hourHeight) * 60 };
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", placed.item.occurrenceKey);
                      handlers.onPreviewHide();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.onEditEvent(placed.item.id);
                    }}
                    onMouseEnter={(event) => handlers.onPreviewEvent(placed.item, pointerPoint(event))}
                    onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
                    onMouseLeave={handlers.onPreviewHide}
                    className={`absolute overflow-hidden rounded-[10px] border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight hover:z-20 hover:brightness-110 ${
                      placed.item.status === "done" ? "opacity-60" : ""
                    }`}
                    style={{
                      top,
                      height,
                      ...position,
                      borderLeftColor: color,
                      background: `color-mix(in srgb, ${color} 24%, var(--bg-2))`,
                      boxShadow: cascade ? "0 0 0 1px var(--bg-2)" : undefined
                    }}
                  >
                    <span
                      className="safe-text font-black"
                      style={{ display: "-webkit-box", WebkitLineClamp: titleLines, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                    >
                      {placed.item.recurring ? (
                        <span role="img" aria-label="Ripetuto">
                          ↻{" "}
                        </span>
                      ) : null}
                      {placed.item.title}
                    </span>
                    {showTime ? (
                      <span className="one-line-safe block font-bold text-[var(--muted)]">
                        {timeLabel(placed.item.start)}–{timeLabel(placed.item.end)}
                      </span>
                    ) : null}
                    {showSubject ? (
                      <span className="one-line-safe block font-bold text-[var(--muted)]">{subjectName(handlers.subjects, placed.item.subjectId)}</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {hiddenAfter > 0 ? (
        <button
          type="button"
          onClick={onExpandHours}
          className="mt-1.5 w-full rounded-[14px] bg-[var(--surface-soft)] px-3 py-2 text-center text-xs font-black text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
        >
          {hiddenAfter} {hiddenAfter === 1 ? "evento dopo" : "eventi dopo"} le {String(hourEnd).padStart(2, "0")}:00 · mostra tutto
        </button>
      ) : null}
    </div>
  );
}

function TaskChip({ task, handlers }: { task: Task; handlers: Handlers }) {
  const done = task.status === "done";
  const overdue = !done && task.dueDate ? isBefore(parseISO(task.dueDate), new Date()) : false;
  return (
    <div
      className={`flex min-w-0 items-center gap-1.5 rounded-[10px] bg-[var(--surface-soft)] px-1.5 py-1 text-[11px] font-bold hover:bg-[var(--surface)] ${done ? "opacity-55" : ""}`}
      title={task.title}
    >
      <button
        type="button"
        aria-label={done ? `Riapri "${task.title}"` : `Completa "${task.title}"`}
        onClick={(event) => {
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
        aria-label={`Modifica "${task.title}"`}
        className={`min-w-0 flex-1 truncate text-left ${done ? "line-through" : ""} ${overdue ? "text-[var(--danger-text)]" : ""}`}
      >
        {task.title}
      </button>
    </div>
  );
}

function AllDayChip({ item, handlers }: { item: EventOccurrence; handlers: Handlers }) {
  const color = eventColor(item, handlers.subjects);
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        handlers.onEditEvent(item.id);
      }}
      onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
      onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
      onMouseLeave={handlers.onPreviewHide}
      className={`flex min-w-0 items-center gap-1.5 rounded-[10px] px-1.5 py-1 text-left text-[11px] font-black hover:brightness-110 ${
        item.status === "done" ? "opacity-60" : ""
      }`}
      style={{ background: `color-mix(in srgb, ${color} 26%, var(--bg-2))` }}
      title={`${allDayEventLabel(item)} · ${item.title}`}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 truncate">
        {item.recurring ? (
          <span role="img" aria-label="Ripetuto">
            ↻{" "}
          </span>
        ) : null}
        {item.title}
      </span>
    </button>
  );
}

function ExamChip({ exam, subjects }: { exam: Exam; subjects: Subjects }) {
  const color = subjectColor(subjects, exam.subjectId);
  return (
    <div
      className="flex min-w-0 cursor-default items-center gap-1.5 rounded-[10px] px-1.5 py-1 text-[11px] font-black"
      style={{ background: `color-mix(in srgb, ${color} 26%, var(--bg-2))` }}
      title={`Esame · ${subjectName(subjects, exam.subjectId)} · preparazione ${exam.preparation}%`}
      // Nella cella del mese il click crea un evento: cliccare un esame non deve farlo.
      onClick={(event) => event.stopPropagation()}
    >
      <Icon name="GraduationCap" className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">Esame · {subjectName(subjects, exam.subjectId)}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settimana su mobile: elenco per giorno                               */
/* ------------------------------------------------------------------ */

function DayList({
  days,
  occurrences,
  tasks,
  exams,
  handlers
}: {
  days: Date[];
  occurrences: EventOccurrence[];
  tasks: Task[];
  exams: Exam[];
  handlers: Handlers;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {days.map((day) => {
        const dayEvents = occurrences.filter((item) => isSameDay(parseISO(item.start), day));
        const dayTasks = tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day));
        const dayExams = exams.filter((exam) => isSameDay(parseISO(exam.date), day));
        const empty = !dayEvents.length && !dayTasks.length && !dayExams.length;
        return (
          <section key={day.toISOString()} aria-label={format(day, "EEEE d MMMM", { locale: it })}>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <h3 className={`text-sm font-black capitalize ${isSameDay(day, new Date()) ? "text-[var(--accent-ink)]" : ""}`}>{format(day, "EEEE d MMMM", { locale: it })}</h3>
              <button
                type="button"
                onClick={() => handlers.onCreate(defaultStartFor(day))}
                className="grid h-11 min-w-11 place-items-center rounded-full bg-[var(--surface-soft)] px-2.5"
                aria-label={`Aggiungi il ${format(day, "d MMMM", { locale: it })}`}
                title={`Aggiungi il ${format(day, "d MMMM", { locale: it })}`}
              >
                <Icon name="Plus" className="h-4 w-4" />
              </button>
            </div>
            {empty ? (
              <p className="rounded-[14px] border border-dashed border-[var(--border)] px-3 py-2 text-xs font-bold text-[var(--faint)]">Libero</p>
            ) : (
              <ul className="grid grid-cols-[minmax(0,1fr)] gap-1.5">
                {dayExams.map((exam) => (
                  <li key={exam.id}>
                    <ExamChip exam={exam} subjects={handlers.subjects} />
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

function EventRow({ item, handlers }: { item: EventOccurrence; handlers: Handlers }) {
  const color = eventColor(item, handlers.subjects);
  const allDay = isAllDayEvent(item);
  return (
    <button
      type="button"
      onClick={() => handlers.onEditEvent(item.id)}
      onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
      onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
      onMouseLeave={handlers.onPreviewHide}
      className={`flex w-full min-w-0 items-center gap-3 rounded-[14px] px-2.5 py-2 text-left hover:bg-[var(--surface-soft)] ${item.status === "done" ? "opacity-60" : ""}`}
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
            <span role="img" aria-label="Ripetuto">
              ↻{" "}
            </span>
          ) : null}
          {item.title}
        </span>
        <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
          {allDay ? allDayEventLabel(item) : `${timeLabel(item.start)}–${timeLabel(item.end)}`}
          {item.subjectId ? ` · ${subjectName(handlers.subjects, item.subjectId)}` : ""}
        </span>
      </span>
      <Tag className="hidden shrink-0 sm:inline-flex">{EVENT_CATEGORY_LABEL[item.category]}</Tag>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Mese                                                                 */
/* ------------------------------------------------------------------ */

function MonthGrid({
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
  occurrences: EventOccurrence[];
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
            title="Clicca per creare un evento"
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
                return shown <= limit ? <ExamChip key={exam.id} exam={exam} subjects={handlers.subjects} /> : null;
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
                    draggable
                    onDragStart={(event) => {
                      dragged.current = item.occurrenceKey;
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", item.occurrenceKey);
                      handlers.onPreviewHide();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.onEditEvent(item.id);
                    }}
                    onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
                    onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
                    onMouseLeave={handlers.onPreviewHide}
                    className={`flex min-w-0 items-center gap-1 rounded-[8px] px-1 py-0.5 text-left text-[11px] ${
                      allDay ? "font-black hover:brightness-110" : "font-bold hover:bg-[var(--surface-strong)]"
                    }`}
                    style={allDay ? { background: `color-mix(in srgb, ${color} 26%, var(--bg-2))` } : undefined}
                    title={allDay ? `${allDayEventLabel(item)} · ${item.title}` : `${timeLabel(item.start)} · ${item.title}`}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
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

/* ------------------------------------------------------------------ */
/* Agenda                                                               */
/* ------------------------------------------------------------------ */

function Agenda({
  from,
  to,
  occurrences,
  tasks,
  exams,
  handlers
}: {
  from: Date;
  to: Date;
  occurrences: EventOccurrence[];
  tasks: Task[];
  exams: Exam[];
  handlers: Handlers;
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
    return <p className="p-6 text-center text-sm font-bold text-[var(--muted)]">Niente in programma nelle prossime due settimane.</p>;
  }

  const dayTitle = (day: Date) => {
    const diff = daysUntil(day);
    const base = format(day, "EEEE d MMMM", { locale: it });
    return diff === 0 ? `Oggi · ${base}` : diff === 1 ? `Domani · ${base}` : base;
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      {overdue.length && isSameDay(from, startOfDay(new Date())) ? (
        <section aria-label="Task in ritardo">
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
                <ExamChip exam={exam} subjects={handlers.subjects} />
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

/* ------------------------------------------------------------------ */
/* Anteprima al passaggio del mouse                                     */
/* ------------------------------------------------------------------ */

function CalendarHoverPreview({ preview, subjects }: { preview: CalendarPreviewState; subjects: Subjects }) {
  const width = 320;
  const height = preview.kind === "event" ? 200 : 240;
  const left = Math.min(Math.max(12, preview.x + 16), Math.max(12, window.innerWidth - width - 12));
  const top = Math.min(Math.max(12, preview.y + 16), Math.max(12, window.innerHeight - height - 12));
  const accent = preview.kind === "event" ? eventColor(preview.event, subjects) : subjectColor(subjects, preview.task.subjectId);
  const taskTimerRunning = preview.kind === "task" && isTaskTimerRunning(preview.task);
  const taskElapsed = preview.kind === "task" ? taskElapsedSeconds(preview.task) : 0;
  const taskCompletedLate = preview.kind === "task" && isTaskCompletedLate(preview.task);

  return (
    <aside
      aria-hidden="true"
      className="pointer-events-none fixed z-[60] w-[min(320px,calc(100vw-24px))] rounded-[24px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_90%,transparent)] p-4 text-left shadow-soft backdrop-blur-2xl"
      style={{ left, top }}
    >
      <div className="mb-2 flex items-start gap-3">
        <span className="mt-1 h-9 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-black uppercase text-[var(--faint)]">
            {preview.kind === "event" ? EVENT_CATEGORY_LABEL[preview.event.category] : "Task"}
          </p>
          <h4 className="two-line-safe text-base font-black">{preview.kind === "event" ? preview.event.title : preview.task.title}</h4>
        </div>
      </div>

      {preview.kind === "event" ? (
        <div className="grid grid-cols-1 gap-2 text-sm">
          <p className="font-bold text-[var(--muted)]">
            {capitalizeFirst(format(parseISO(preview.event.start), "EEEE d MMM", { locale: it }))} ·{" "}
            {isAllDayEvent(preview.event) ? allDayEventLabel(preview.event) : `${timeLabel(preview.event.start)}–${timeLabel(preview.event.end)} · ${formatMinutes(eventMinutes(preview.event))}`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Tag color={accent}>{subjectName(subjects, preview.event.subjectId)}</Tag>
            <Tag>{EVENT_STATUS_LABEL[preview.event.status]}</Tag>
            {preview.event.recurrence && preview.event.recurrence !== "none" ? <Tag>{RECURRENCE_LABEL[preview.event.recurrence]}</Tag> : null}
            {preview.event.category === "deadline" || preview.event.category === "exam" ? <Tag>{studyDaysLabel(preview.event.start)}</Tag> : null}
          </div>
          {preview.event.description || preview.event.notes ? (
            <p className="three-line-safe text-[var(--muted)]">{preview.event.description || preview.event.notes}</p>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 text-sm">
          <p className="font-bold text-[var(--muted)]">
            {preview.task.dueDate ? `${shortDate(preview.task.dueDate)} · ${timeLabel(preview.task.dueDate)}` : "Nessuna data"} ·{" "}
            {subjectName(subjects, preview.task.subjectId)}
          </p>
          <div className="flex flex-wrap gap-1.5">
            <Tag color={PRIORITY_TONE[preview.task.priority]}>{PRIORITY_LABEL[preview.task.priority]}</Tag>
            <Tag>{TASK_STATUS_LABEL[preview.task.status]}</Tag>
            <Tag>{ENERGY_LABEL[preview.task.energy]}</Tag>
            <Tag>
              {formatMinutes(preview.task.estimatedMinutes)} stimati
              {taskTimerRunning ? ` · ⏱ ${formatElapsedSeconds(taskElapsed)}` : preview.task.actualMinutes !== undefined ? ` · ${preview.task.actualMinutes} min reali` : ""}
            </Tag>
            {taskCompletedLate ? <Tag className="text-[var(--warning-text)]">Completata in ritardo</Tag> : null}
          </div>
          {preview.task.description || preview.task.notes ? (
            <p className="three-line-safe text-[var(--muted)]">{preview.task.description || preview.task.notes}</p>
          ) : null}
        </div>
      )}
    </aside>
  );
}

/* ------------------------------------------------------------------ */
/* Modali                                                               */
/* ------------------------------------------------------------------ */

const DURATIONS = [15, 30, 45, 60, 90, 120, 180, 240];

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-black/45 p-3 backdrop-blur-sm sm:place-items-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <section className="soft-panel scrollbar-soft max-h-[90dvh] w-full max-w-2xl overflow-y-auto p-4 sm:p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="safe-text text-2xl font-black">{title}</h3>
            {subtitle ? <p className="two-line-safe text-sm text-[var(--muted)]">{subtitle}</p> : null}
          </div>
          <IconButton icon="X" label="Chiudi" onClick={onClose} className="h-10 w-10" />
        </div>
        {children}
      </section>
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
  subjects: Subjects;
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
    allDay: event.allDay === true,
    // Orari precedenti: togliendo "Tutto il giorno" si ritrovano gli orari di prima.
    prevStart: "",
    prevEnd: "",
    color: event.color || subjectColor(subjects, event.subjectId),
    recurrence: event.recurrence ?? "none",
    recurrenceUntil: event.recurrenceUntil ?? ""
  });
  const [error, setError] = useState("");
  const recurring = draft.recurrence !== "none";

  const setAllDay = (value: boolean) => {
    setDraft((v) => {
      if (value) return { ...v, allDay: true, prevStart: v.start, prevEnd: v.end };
      const day = v.start.slice(0, 10) || toDatetimeLocal(new Date()).slice(0, 10);
      const sameDay = v.prevStart.slice(0, 10) === day && v.prevEnd > v.prevStart;
      return {
        ...v,
        allDay: false,
        start: sameDay ? v.prevStart : `${day}T09:00`,
        end: sameDay ? v.prevEnd : `${day}T10:00`
      };
    });
  };

  const save = async () => {
    if (!draft.title.trim()) {
      setError("Inserisci un titolo.");
      return;
    }
    const day = draft.start.slice(0, 10);
    if (recurring && draft.recurrenceUntil && draft.recurrenceUntil < day) {
      setError("La data di fine ripetizione deve essere successiva all'inizio.");
      return;
    }
    if (draft.allDay) {
      const at = new Date(`${day}T00:00`);
      if (!day || Number.isNaN(at.getTime())) {
        setError("Seleziona un giorno valido.");
        return;
      }
      const range = allDayRange(at);
      await onSave({
        title: draft.title.trim(),
        description: draft.description.trim(),
        category: draft.category,
        subjectId: draft.subjectId || undefined,
        priority: draft.priority,
        status: draft.status,
        start: range.start,
        end: range.end,
        allDay: true,
        color: draft.color || subjectColor(subjects, draft.subjectId),
        recurrence: draft.recurrence,
        recurrenceUntil: recurring && draft.recurrenceUntil ? draft.recurrenceUntil : undefined
      });
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
      allDay: false,
      color: draft.color || subjectColor(subjects, draft.subjectId),
      recurrence: draft.recurrence,
      recurrenceUntil: recurring && draft.recurrenceUntil ? draft.recurrenceUntil : undefined
    });
  };

  return (
    <ModalShell
      title="Modifica evento"
      subtitle={recurring ? "Evento ripetuto: le modifiche valgono per tutta la serie." : "Sposta, aggiorna o elimina il blocco calendario."}
      onClose={onClose}
    >
      <div className="grid grid-cols-1 gap-3">
        {event.tags?.includes("appello-importato") ? (
          <Panel className="p-3">
            <h4 className="font-black">Appello scelto dal Calendario Esami BARB</h4>
            <p className="mt-1 whitespace-pre-line text-sm text-[var(--muted)]">{event.description}</p>
            <p className="mt-2 whitespace-pre-line text-xs text-[var(--muted)]">{event.notes}</p>
            {event.links.map((url) => <a key={url} href={safeHref(url)} target="_blank" rel="noreferrer" className="mt-2 inline-block text-sm font-bold text-[var(--accent-ink)] underline">Fonte ufficiale UniMi</a>)}
            <p className="mt-2 text-xs text-[var(--muted)]">Le modifiche valgono per il tuo promemoria personale. La data ufficiale resta consultabile nel calendario generale.</p>
          </Panel>
        ) : null}
        <Field label="Titolo">
          <input className={inputClass} value={draft.title} onChange={(e) => setDraft((v) => ({ ...v, title: e.target.value }))} />
        </Field>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] px-3 py-2 text-sm font-bold">
          <input type="checkbox" className="h-4 w-4 shrink-0 accent-[var(--accent)]" checked={draft.allDay} onChange={(e) => setAllDay(e.target.checked)} />
          <span className="min-w-0 flex-1">
            {ALL_DAY_LABEL}
            <span className="block text-xs font-bold text-[var(--muted)]">Occupa l'intera giornata, senza orari</span>
          </span>
        </label>
        {draft.allDay ? (
          <Field label="Giorno">
            <input
              className={inputClass}
              type="date"
              value={draft.start.slice(0, 10)}
              onChange={(e) => setDraft((v) => ({ ...v, start: e.target.value ? `${e.target.value}T00:00` : "" }))}
            />
          </Field>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Inizio">
              <input
                className={inputClass}
                type="datetime-local"
                value={draft.start}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((v) => {
                    // Spostando l'inizio la durata resta invariata.
                    const previousStart = new Date(v.start);
                    const previousEnd = new Date(v.end);
                    const nextStart = new Date(value);
                    const duration = previousEnd.getTime() - previousStart.getTime();
                    const nextEnd = Number.isFinite(duration) && duration > 0 && !Number.isNaN(nextStart.getTime()) ? toDatetimeLocal(new Date(nextStart.getTime() + duration)) : v.end;
                    return { ...v, start: value, end: nextEnd };
                  });
                }}
              />
            </Field>
            <Field label="Fine">
              <input className={inputClass} type="datetime-local" value={draft.end} onChange={(e) => setDraft((v) => ({ ...v, end: e.target.value }))} />
            </Field>
            <p className="-mt-1 text-xs font-bold text-[var(--muted)] sm:col-span-2">Spostando l'inizio, la fine segue per mantenere la durata.</p>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Ripetizione">
            <select className={inputClass} value={draft.recurrence} onChange={(e) => setDraft((v) => ({ ...v, recurrence: e.target.value as NonNullable<CalendarEvent["recurrence"]> }))}>
              {(Object.keys(RECURRENCE_LABEL) as NonNullable<CalendarEvent["recurrence"]>[]).map((key) => (
                <option key={key} value={key}>
                  {RECURRENCE_LABEL[key]}
                </option>
              ))}
            </select>
          </Field>
          {recurring ? (
            <Field label="Fino al (opzionale)">
              <input className={inputClass} type="date" value={draft.recurrenceUntil} onChange={(e) => setDraft((v) => ({ ...v, recurrenceUntil: e.target.value }))} />
            </Field>
          ) : null}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Materia">
            <select
              className={inputClass}
              value={draft.subjectId}
              onChange={(e) => setDraft((v) => ({ ...v, subjectId: e.target.value, color: subjectColor(subjects, e.target.value, v.color) }))}
            >
              <option value="">Nessuna</option>
              {selectableSubjects(subjects, draft.subjectId).map((subject) => (
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Priorità">
            <select className={inputClass} value={draft.priority} onChange={(e) => setDraft((v) => ({ ...v, priority: e.target.value as CalendarEvent["priority"] }))}>
              {(Object.keys(PRIORITY_LABEL) as CalendarEvent["priority"][]).map((key) => (
                <option key={key} value={key}>
                  {PRIORITY_LABEL[key]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stato">
            <select className={inputClass} value={draft.status} onChange={(e) => setDraft((v) => ({ ...v, status: e.target.value as CalendarEvent["status"] }))}>
              {(Object.keys(EVENT_STATUS_LABEL) as CalendarEvent["status"][]).map((key) => (
                <option key={key} value={key}>
                  {EVENT_STATUS_LABEL[key]}
                </option>
              ))}
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
        <Field label="Descrizione">
          <textarea className={`${inputClass} min-h-20 py-3`} value={draft.description} onChange={(e) => setDraft((v) => ({ ...v, description: e.target.value }))} />
        </Field>
        {error ? (
          <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button variant="danger" icon="Trash2" onClick={onDelete}>
            Elimina
          </Button>
          <span className="flex-1" />
          <Button variant="soft" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="primary" icon="Check" onClick={save}>
            Salva
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

interface CreateDraft {
  kind: "event" | "task";
  title: string;
  subjectId: string;
  start: Date;
  duration: number;
  allDay: boolean;
  priority: Task["priority"];
  category: EventCategory;
  recurrence: NonNullable<CalendarEvent["recurrence"]>;
}

function CreateModal({
  initial,
  subjects,
  onClose,
  onSubmit
}: {
  initial: { at: Date; kind: "event" | "task" };
  subjects: Subjects;
  onClose: () => void;
  onSubmit: (draft: CreateDraft) => Promise<void>;
}) {
  const [kind, setKind] = useState(initial.kind);
  const [title, setTitle] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [startsAt, setStartsAt] = useState(toDatetimeLocal(defaultStartFor(initial.at)));
  const [duration, setDuration] = useState<number | "allday">(60);
  const [priority, setPriority] = useState<Task["priority"]>("medium");
  const [category, setCategory] = useState<EventCategory>("study");
  const [recurrence, setRecurrence] = useState<NonNullable<CalendarEvent["recurrence"]>>("none");
  const allDay = kind === "event" && duration === "allday";
  const start = new Date(startsAt);
  const valid = Boolean(title.trim()) && !Number.isNaN(start.getTime());

  const submit = async () => {
    if (!valid) return;
    await onSubmit({ kind, title: title.trim(), subjectId, start, duration: typeof duration === "number" ? duration : 60, allDay, priority, category, recurrence });
  };

  return (
    <ModalShell title={`Nuovo · ${format(Number.isNaN(start.getTime()) ? initial.at : start, "EEEE d MMMM", { locale: it })}`} onClose={onClose}>
      <form
        className="grid grid-cols-1 gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <Segmented
          label="Tipo"
          value={kind}
          onChange={setKind}
          className="justify-self-start"
          options={[
            { id: "event", label: "Evento", icon: "CalendarDays" },
            { id: "task", label: "Task con scadenza", icon: "Check" }
          ]}
        />
        <Field label="Titolo">
          <input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder={kind === "event" ? "Es. Lezione di Anatomia" : "Es. Consegnare relazione"} />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={allDay ? "Giorno" : kind === "event" ? "Inizio" : "Scadenza"}>
            {allDay ? (
              <input
                className={inputClass}
                type="date"
                value={startsAt.slice(0, 10)}
                onChange={(e) => setStartsAt(e.target.value ? `${e.target.value}T${startsAt.slice(11, 16) || "09:00"}` : "")}
              />
            ) : (
              <input className={inputClass} type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
            )}
          </Field>
          {kind === "event" ? (
            <Field label="Durata">
              <select
                className={inputClass}
                value={String(duration)}
                onChange={(e) => setDuration(e.target.value === "allday" ? "allday" : Number(e.target.value))}
              >
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {formatMinutes(minutes)}
                  </option>
                ))}
                <option value="allday">{ALL_DAY_LABEL}</option>
              </select>
            </Field>
          ) : (
            <Field label="Priorità">
              <select className={inputClass} value={priority} onChange={(e) => setPriority(e.target.value as Task["priority"])}>
                {(Object.keys(PRIORITY_LABEL) as Task["priority"][]).map((key) => (
                  <option key={key} value={key}>
                    {PRIORITY_LABEL[key]}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Materia">
            <select className={inputClass} value={subjectId} onChange={(e) => setSubjectId(e.target.value)}>
              <option value="">Nessuna</option>
              {selectableSubjects(subjects, subjectId).map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </Field>
          {kind === "event" ? (
            <Field label="Categoria">
              <select className={inputClass} value={category} onChange={(e) => setCategory(e.target.value as EventCategory)}>
                {categories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>
        {kind === "event" ? (
          <Field label="Ripetizione">
            <select className={inputClass} value={recurrence} onChange={(e) => setRecurrence(e.target.value as NonNullable<CalendarEvent["recurrence"]>)}>
              {(Object.keys(RECURRENCE_LABEL) as NonNullable<CalendarEvent["recurrence"]>[]).map((key) => (
                <option key={key} value={key}>
                  {RECURRENCE_LABEL[key]}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        {!valid ? (
          <p className="text-xs font-bold text-[var(--muted)]">{!title.trim() ? "Inserisci un titolo per continuare." : "Controlla la data inserita."}</p>
        ) : null}
        <div className="mt-2 flex justify-end gap-2">
          <Button variant="soft" onClick={onClose}>
            Annulla
          </Button>
          <Button variant="primary" icon="Plus" type="submit" disabled={!valid}>
            Crea {kind === "event" ? "evento" : "task"}
          </Button>
        </div>
      </form>
    </ModalShell>
  );
}

/* ------------------------------------------------------------------ */
/* Sessione esami e semestre                                            */
/* ------------------------------------------------------------------ */

function ExamSession({ exams, subjects, onGoExams }: { exams: Exam[]; subjects: Subjects; onGoExams: () => void }) {
  const today = startOfDay(new Date());
  const upcoming = exams.filter((exam) => exam.status !== "done" && !isBefore(parseISO(exam.date), today)).sort((a, b) => a.date.localeCompare(b.date));
  const past = exams.filter((exam) => !upcoming.includes(exam)).sort((a, b) => b.date.localeCompare(a.date));
  if (!exams.length)
    return (
      <div className="grid place-items-center gap-3 p-6 text-center">
        <p className="text-sm font-bold text-[var(--muted)]">Nessun esame pianificato.</p>
        <Button variant="primary" icon="GraduationCap" onClick={onGoExams}>
          Vai a Esami
        </Button>
      </div>
    );
  return (
    <div className="grid grid-cols-1 gap-5">
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,240px),1fr))]">
        {upcoming.map((exam) => {
          const color = subjectColor(subjects, exam.subjectId);
          const days = daysUntil(exam.date);
          return (
            <div key={exam.id} className="quiet-panel p-4" style={{ boxShadow: `inset 0 3px 0 ${color}` }}>
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-3xl font-black tabular-nums">{days}</p>
                <Tag>{EXAM_STATUS_LABEL[exam.status]}</Tag>
              </div>
              <p className="text-xs font-bold text-[var(--muted)]">{days === 1 ? "giorno" : "giorni"} · {format(parseISO(exam.date), "EEEE d MMMM", { locale: it })}</p>
              <h4 className="two-line-safe mt-2 font-black">{subjectName(subjects, exam.subjectId)}</h4>
              <div className="mt-3">
                <ProgressBar value={exam.preparation} color={color} />
              </div>
              <p className="mt-1.5 text-xs font-bold text-[var(--muted)]">{exam.preparation}% preparazione · obiettivo {exam.targetGrade}</p>
            </div>
          );
        })}
      </div>
      {past.length ? (
        <div>
          <h4 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">Sostenuti o passati</h4>
          <ul className="grid grid-cols-1 gap-1">
            {past.map((exam) => (
              <li key={exam.id} className="flex items-center gap-2 text-sm text-[var(--muted)]">
                <span className="h-2 w-2 rounded-full" style={{ background: subjectColor(subjects, exam.subjectId) }} />
                <span className="font-bold">{subjectName(subjects, exam.subjectId)}</span> · {shortDate(exam.date)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function SemesterMap({ events, subjects }: { events: CalendarEvent[]; subjects: Subjects }) {
  if (!subjects.length) return <p className="p-6 text-center text-sm font-bold text-[var(--muted)]">Aggiungi le materie per vedere la mappa del semestre.</p>;
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(min(100%,260px),1fr))]">
      {subjects.map((subject) => {
        const course = resolveBarbCourse(subject, BARB_DATASET.courses);
        const count = events.filter((event) => event.subjectId === subject.id).length;
        const weekly = events.filter((event) => event.subjectId === subject.id && event.recurrence === "weekly").length;
        return (
          <div key={subject.id} className="quiet-panel flex items-center gap-3 p-3.5">
            <span className="grid grid-cols-1 h-11 w-11 shrink-0 place-items-center rounded-super" style={{ background: subject.color }}>
              {course ? <CourseIcon course={course} className="h-5 w-5 text-[#10131d]" /> : <Icon name={subject.icon} className="h-5 w-5 text-[#10131d]" />}
            </span>
            <div className="min-w-0">
              <h4 className="two-line-safe font-black leading-tight">{subject.name}</h4>
              <p className="text-xs font-bold text-[var(--muted)]">
                {count} {count === 1 ? "evento" : "eventi"}
                {weekly ? ` · ${weekly} settimanali` : ""}
              </p>
              <Tag color={SEMESTER_TONE[subjectSemester(subject)]}>{SEMESTER_LABEL[subjectSemester(subject)]}</Tag>
            </div>
          </div>
        );
      })}
    </div>
  );
}
