// Mese: una riga per settimana. Gli eventi di tutto il giorno o su più giorni sono barre continue in
// alto (spezzate solo al cambio di riga); sotto, le voci del giorno. Si trascinano gli eventi da un
// giorno all'altro, anche le barre (il giorno preso resta sotto il puntatore).
import { useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { addDays, format, isSameDay, isSameMonth, parseISO, startOfDay } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Task } from "../../types";
import { SharedMark } from "../SharedMark";
import { timeLabel } from "../../lib/selectors";
import { CALENDAR_VIEW_TEXT, WEEKDAY_SHORT } from "../../lib/labels";
import { addDays as addYmdDays, daysInclusive } from "../../lib/datePicker";
import type { Holiday } from "../../lib/holidays";
import { holidayBars, holidayId, holidayPaint, isBarEvent, laneRows, monthItemBudget, occasionText, weekStartsOf } from "../../lib/calendarRender";
import { EventBar, HolidayChip, TypeIcon, eventBars, useEventPaint, useEventTheme } from "./bars";
import { ExamChip, TaskChip } from "./chips";
import { canDrag, defaultStartFor, editOccurrence, pointerPoint, sharedOutline, sharedOutlineClass } from "./shared";
import type { CalendarOccurrence, Handlers } from "./types";

/** Corsie di barre per riga: oltre, la barra si conta nel "+N" dei suoi giorni. */
const MONTH_LANES = 3;
/** Intestazioni da lunedì a domenica (in maiuscolo dallo stile). */
const WEEKDAYS = (["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const).map((code) => WEEKDAY_SHORT[code]);

/** Evento preso per trascinarlo: chiave dell'occorrenza e giorni tra il suo primo giorno e quello preso. */
type Grab = { key: string; offsetDays: number };

export function MonthGrid({
  days,
  month,
  occurrences,
  tasks,
  exams,
  holidays = [],
  handlers,
  onPickDay
}: {
  days: Date[];
  month: Date;
  occurrences: CalendarOccurrence[];
  tasks: Task[];
  exams: Exam[];
  /** Festività del periodo (vuoto con "Festività" spento): voci grigie tra le barre. */
  holidays?: Holiday[];
  handlers: Handlers;
  onPickDay: (day: Date) => void;
}) {
  const [dropDay, setDropDay] = useState<string | null>(null);
  const grab = useRef<Grab | null>(null);
  const theme = useEventTheme();
  const paintOf = useEventPaint();
  const now = new Date();
  const bars = eventBars(occurrences);
  const barById = new Map(bars.map((bar) => [bar.id, bar]));
  const holidayById = new Map(holidays.map((holiday) => [holidayId(holiday), holiday]));
  // Prima gli eventi dell'utente: a parità di giorni le festività cedono la corsia (e vanno nel "+N").
  const rows = laneRows([...bars, ...holidayBars(holidays)], weekStartsOf(days), MONTH_LANES);
  const timed = occurrences.filter((item) => !isBarEvent(item));

  /** Click, trascinamento e rilascio su un giorno (fondo, numero e voci della cella). */
  const dayTarget = (day: Date, key: string) => ({
    onClick: () => handlers.onCreate(defaultStartFor(day)),
    onDragOver: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      setDropDay(key);
    },
    onDragLeave: () => setDropDay((value) => (value === key ? null : value)),
    onDrop: (event: ReactDragEvent<HTMLElement>) => {
      event.preventDefault();
      setDropDay(null);
      const dragged = grab.current;
      grab.current = null;
      const item = dragged ? occurrences.find((occurrence) => occurrence.occurrenceKey === dragged.key) : undefined;
      if (!dragged || !item) return;
      const start = parseISO(item.start);
      const next = startOfDay(addDays(day, -dragged.offsetDays));
      next.setHours(start.getHours(), start.getMinutes(), 0, 0);
      handlers.onMoveEvent(item, next);
    }
  });

  const startDrag = (event: ReactDragEvent<HTMLElement>, key: string, offsetDays = 0) => {
    grab.current = { key, offsetDays };
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", key);
  };

  return (
    <div className="grid grid-cols-1 gap-1 sm:gap-1.5">
      <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
        {WEEKDAYS.map((day) => (
          <div key={day} className="px-1 text-[11px] font-black uppercase text-[var(--faint)]">
            {day}
          </div>
        ))}
      </div>
      {rows.map((row, rowIndex) => {
        const week = days.slice(rowIndex * 7, rowIndex * 7 + 7);
        const budget = monthItemBudget(row.lanes);
        const itemsRow = row.lanes + 2;
        return (
          <div
            key={row.weekStart}
            className="grid min-h-[68px] grid-cols-7 gap-x-1 gap-y-0.5 sm:min-h-[112px] sm:gap-x-1.5"
            style={{ gridTemplateRows: `auto ${row.lanes ? `repeat(${row.lanes}, auto) ` : ""}1fr` }}
          >
            {/* fondo di ogni giorno: tutta l'altezza della riga */}
            {week.map((day, column) => {
              const key = day.toISOString();
              const today = isSameDay(day, now);
              return (
                <div
                  key={`bg-${key}`}
                  role="presentation"
                  title={CALENDAR_VIEW_TEXT.monthCellTitle}
                  {...dayTarget(day, key)}
                  className={`min-w-0 cursor-copy rounded-[14px] border ${dropDay === key ? "border-[var(--accent)]" : "border-[var(--border)]"} ${
                    isSameMonth(day, month) ? "" : "opacity-45"
                  } ${today ? "bg-[var(--surface)]" : "bg-[var(--surface-soft)]"}`}
                  style={{ gridColumn: column + 1, gridRow: "1 / -1" }}
                />
              );
            })}

            {/* numero del giorno (e, sul telefono, un punto se ci sono voci) */}
            {week.map((day, column) => {
              const key = day.toISOString();
              const today = isSameDay(day, now);
              // Sul telefono anche le barre oltre le corsie mostrate accendono il punto.
              const hasItems =
                row.hidden[column] > 0 ||
                timed.some((item) => isSameDay(parseISO(item.start), day)) ||
                tasks.some((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day)) ||
                exams.some((exam) => isSameDay(parseISO(exam.date), day));
              return (
                <div
                  key={`head-${key}`}
                  role="presentation"
                  {...dayTarget(day, key)}
                  className={`flex min-w-0 cursor-copy items-center justify-between gap-1 px-1 pt-1 sm:px-1.5 sm:pt-1.5 ${isSameMonth(day, month) ? "" : "opacity-45"}`}
                  style={{ gridColumn: column + 1, gridRow: 1 }}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onPickDay(day);
                    }}
                    className={`relative grid h-6 min-w-6 grid-cols-1 place-items-center rounded-full px-1 text-xs font-black before:absolute before:-inset-2.5 before:content-[""] hover:bg-[var(--surface-strong)] ${
                      today ? "bg-[var(--accent)] text-[#10131d] hover:bg-[var(--accent)]" : ""
                    }`}
                    aria-label={CALENDAR_VIEW_TEXT.openDay(format(day, "d"), format(day, "EEEE d MMMM", { locale: it }))}
                    title={CALENDAR_VIEW_TEXT.openDay(format(day, "d"), format(day, "EEEE d MMMM", { locale: it }))}
                  >
                    {format(day, "d")}
                  </button>
                  {hasItems ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--accent)] sm:hidden" /> : null}
                </div>
              );
            })}

            {/* barre: continue da un giorno all'altro; sul telefono solo un filo colorato */}
            {row.segments.map((segment) => {
              const place = {
                gridColumn: `${segment.startCol + 1} / ${segment.endCol + 2}`,
                gridRow: segment.lane + 2
              };
              const inset = `${segment.continuesBefore ? "" : "ml-1"} ${segment.continuesAfter ? "" : "mr-1"}`;
              // Telefono: toccare il filo apre il giorno toccato (area di tocco più alta del filo).
              const lineProps = {
                "aria-hidden": true,
                onClick: (event: ReactMouseEvent<HTMLSpanElement>) => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  const columns = segment.endCol - segment.startCol + 1;
                  const offset = Math.min(columns - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / Math.max(1, rect.width)) * columns)));
                  const day = week[segment.startCol + offset];
                  if (day) onPickDay(day);
                }
              } as const;
              const lineHit = "relative block h-1 cursor-pointer after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] sm:hidden";
              const holiday = holidayById.get(segment.id);
              if (holiday) {
                const paint = holidayPaint(holiday.kind, theme);
                return (
                  <div key={segment.id} className={`relative min-w-0 ${inset}`} style={place}>
                    <span {...lineProps} className={`${lineHit} rounded-full`} style={{ background: paint.strong ? paint.border : "var(--border)" }} />
                    <div className="hidden sm:block">
                      <HolidayChip holiday={holiday} theme={theme} />
                    </div>
                  </div>
                );
              }
              const bar = barById.get(segment.id);
              if (!bar) return null;
              return (
                <div key={segment.id} className={`relative min-w-0 ${inset}`} style={place}>
                  <span
                    {...lineProps}
                    className={`${lineHit} ${segment.continuesBefore ? "" : "rounded-l-full"} ${segment.continuesAfter ? "" : "rounded-r-full"}`}
                    style={{ background: paintOf(bar.item, handlers.subjects).color }}
                  />
                  <div className="hidden sm:block">
                    <EventBar
                      item={bar.item}
                      handlers={handlers}
                      roundStart={!segment.continuesBefore}
                      roundEnd={!segment.continuesAfter}
                      onDragStart={(event) => {
                        // Giorno preso: la colonna sotto il puntatore, contata dal primo giorno dell'evento.
                        const rect = event.currentTarget.getBoundingClientRect();
                        const columns = segment.endCol - segment.startCol + 1;
                        const offsetColumn = Math.min(columns - 1, Math.max(0, Math.floor(((event.clientX - rect.left) / rect.width) * columns)));
                        const grabbedDay = addYmdDays(row.weekStart, segment.startCol + offsetColumn);
                        startDrag(event, bar.item.occurrenceKey, Math.max(0, daysInclusive(bar.startDay, grabbedDay) - 1));
                      }}
                    />
                  </div>
                </div>
              );
            })}

            {/* voci del giorno sotto le barre (dal tablet in su) */}
            {week.map((day, column) => {
              const key = day.toISOString();
              const items: ReactNode[] = [
                ...exams
                  .filter((exam) => isSameDay(parseISO(exam.date), day))
                  .map((exam) => <ExamChip key={exam.id} exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} />),
                ...timed
                  .filter((item) => isSameDay(parseISO(item.start), day))
                  .map((item) => (
                    <MonthEvent
                      key={item.occurrenceKey}
                      item={item}
                      handlers={handlers}
                      onDragStart={(event) => {
                        startDrag(event, item.occurrenceKey);
                        handlers.onPreviewHide();
                      }}
                    />
                  )),
                ...tasks
                  .filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day))
                  .map((task) => <TaskChip key={task.id} task={task} handlers={handlers} />)
              ];
              const hidden = Math.max(0, items.length - budget) + row.hidden[column];
              return (
                <div
                  key={`items-${key}`}
                  role="presentation"
                  {...dayTarget(day, key)}
                  className="hidden min-w-0 cursor-copy content-start gap-0.5 px-1 pb-1 sm:grid sm:grid-cols-[minmax(0,1fr)] sm:px-1.5 sm:pb-1.5"
                  style={{ gridColumn: column + 1, gridRow: itemsRow }}
                >
                  {items.slice(0, budget)}
                  {hidden > 0 ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onPickDay(day);
                      }}
                      className="flex min-h-11 items-center px-1 text-left text-[11px] font-black text-[var(--muted)] hover:text-[var(--text)]"
                      title={CALENDAR_VIEW_TEXT.moreItemsAria(hidden, format(day, "EEEE d MMMM", { locale: it }))}
                    >
                      {CALENDAR_VIEW_TEXT.moreItems(hidden)}
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

/** Evento con orario nella cella del giorno: pallino del colore, ora d'inizio, titolo. */
function MonthEvent({
  item,
  handlers,
  onDragStart
}: {
  item: CalendarOccurrence;
  handlers: Handlers;
  onDragStart: (event: ReactDragEvent<HTMLButtonElement>) => void;
}) {
  const paint = useEventPaint()(item, handlers.subjects);
  const occasion = occasionText(item);
  return (
    <button
      type="button"
      draggable={canDrag(item)}
      onDragStart={(event) => {
        if (!canDrag(item)) {
          event.preventDefault();
          return;
        }
        onDragStart(event);
      }}
      onClick={(event) => {
        event.stopPropagation();
        editOccurrence(handlers, item);
      }}
      onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
      onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
      onMouseLeave={handlers.onPreviewHide}
      className={`flex min-w-0 items-center gap-1 rounded-[8px] px-1 py-0.5 text-left text-[11px] font-bold hover:bg-[var(--surface-strong)] ${
        item.status === "done" ? "opacity-75" : ""
      } ${sharedOutlineClass(item)}`}
      style={sharedOutline(item)}
      title={`${timeLabel(item.start)} · ${item.title}${occasion ? ` · ${occasion}` : ""}`}
    >
      {/* Icona della tipologia nel suo colore (al posto del pallino). */}
      <span className="grid shrink-0 grid-cols-1 place-items-center" style={{ color: paint.style.border }}>
        <TypeIcon paint={paint} />
      </span>
      {item.sharedFrom ? <SharedMark origin={item.sharedFrom} compact /> : null}
      <span className="shrink-0 tabular-nums text-[var(--muted)]">{timeLabel(item.start)}</span>
      <span className="min-w-0 truncate">{item.title}</span>
    </button>
  );
}
