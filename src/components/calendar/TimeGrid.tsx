// Griglia oraria di Settimana e Giorno: fascia "tutto il giorno" in alto, eventi con orario in colonne.
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { addMinutes, format, isSameDay, parseISO, startOfDay } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Task } from "../../types";
import { SharedMark } from "../SharedMark";
import { useNow } from "../../hooks/useNow";
import { isAllDayEvent, timeLabel } from "../../lib/selectors";
import { AllDayChip, ExamChip, TaskChip } from "./chips";
import { canDrag, eventColor, occurrenceSubject, pointerPoint, sharedOutline, sharedOutlineClass } from "./shared";
import type { CalendarOccurrence, Handlers } from "./types";

interface Placed {
  item: CalendarOccurrence;
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

const minutesInDay = (occurrence: CalendarOccurrence, day: Date) => {
  const dayStart = startOfDay(day).getTime();
  const start = Math.max(0, (parseISO(occurrence.start).getTime() - dayStart) / 60_000);
  const end = Math.min(24 * 60, (parseISO(occurrence.end).getTime() - dayStart) / 60_000);
  return { startMin: start, endMin: Math.max(end, start + 15) };
};

export function TimeGrid({
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
  occurrences: CalendarOccurrence[];
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

      {/* riga "tutto il giorno": eventi senza orario, esami e attività in scadenza */}
      {hasAllDay ? (
        <div className="mt-1.5 grid gap-x-1.5 border-b border-[var(--border)] pb-1.5" style={{ gridTemplateColumns: columns }}>
          <span
            className="pt-1 text-right text-[10px] font-black uppercase leading-tight text-[var(--faint)]"
            title="Eventi senza orario, esami e attività in scadenza"
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
                  <ExamChip key={exam.id} exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} />
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
                    +{hidden} {hidden === 1 ? "altra" : "altre"}
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
          {hiddenBefore} {hiddenBefore === 1 ? "evento prima" : "eventi prima"} delle {String(hourStart).padStart(2, "0")}:00 · mostra tutte le ore
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
              title="Clicca su un orario libero per aggiungere un evento"
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
                const showSubject = lineCount >= 5 && Boolean(occurrenceSubject(placed.item, handlers.subjects));
                const titleLines = Math.min(5, Math.max(1, lineCount - (showTime ? 1 : 0) - (showSubject ? 1 : 0)));
                return (
                  <button
                    key={placed.item.occurrenceKey}
                    type="button"
                    draggable={canDrag(placed.item)}
                    onDragStart={(event) => {
                      if (!canDrag(placed.item)) {
                        event.preventDefault();
                        return;
                      }
                      const rect = event.currentTarget.getBoundingClientRect();
                      grab.current = { key: placed.item.occurrenceKey, offsetMin: ((event.clientY - rect.top) / hourHeight) * 60 };
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", placed.item.occurrenceKey);
                      handlers.onPreviewHide();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      handlers.onEditEvent(placed.item.id, placed.item.sharedFrom?.ownerId);
                    }}
                    onMouseEnter={(event) => handlers.onPreviewEvent(placed.item, pointerPoint(event))}
                    onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
                    onMouseLeave={handlers.onPreviewHide}
                    className={`absolute overflow-hidden rounded-[10px] border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight hover:z-20 hover:brightness-110 ${
                      placed.item.status === "done" ? "opacity-60" : ""
                    } ${sharedOutlineClass(placed.item)}`}
                    style={{
                      top,
                      height,
                      ...position,
                      borderLeftColor: color,
                      background: `color-mix(in srgb, ${color} 24%, var(--bg-2))`,
                      boxShadow: cascade ? "0 0 0 1px var(--bg-2)" : undefined,
                      ...sharedOutline(placed.item)
                    }}
                  >
                    <span
                      className="safe-text font-black"
                      style={{ display: "-webkit-box", WebkitLineClamp: titleLines, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                    >
                      {placed.item.sharedFrom ? (
                        <>
                          <SharedMark origin={placed.item.sharedFrom} compact />{" "}
                        </>
                      ) : null}
                      {placed.item.recurring ? (
                        <span role="img" aria-label="Si ripete">
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
                      <span className="one-line-safe block font-bold text-[var(--muted)]">{occurrenceSubject(placed.item, handlers.subjects)}</span>
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
          {hiddenAfter} {hiddenAfter === 1 ? "evento dopo" : "eventi dopo"} le {String(hourEnd).padStart(2, "0")}:00 · mostra tutte le ore
        </button>
      ) : null}
    </div>
  );
}
