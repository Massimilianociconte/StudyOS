// Griglia oraria di Settimana e Giorno: fascia "tutto il giorno" in alto, eventi con orario in colonne.
// Gli eventi contemporanei stanno affiancati (posizione e altezza restano quelle dell'orario); dove le
// colonne non entrano, le prime più un "+N" che apre l'elenco di quella fascia.
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
import { addDays, format, isSameDay, parseISO, startOfDay } from "date-fns";
import { it } from "date-fns/locale";
import type { Exam, Task } from "../../types";
import { SharedMark } from "../SharedMark";
import { Drawer } from "../ui";
import { useNow } from "../../hooks/useNow";
import { timeLabel } from "../../lib/selectors";
import { CALENDAR_LAYOUT_TEXT, CALENDAR_VIEW_TEXT } from "../../lib/labels/calendar";
import { dayOfSpan } from "../../lib/calendarLayout";
import { todayYmd } from "../../lib/datePicker";
import type { Holiday } from "../../lib/holidays";
import {
  MIN_EVENT_HEIGHT_PX,
  TOUCH_TARGET_PX,
  atWallMinutes,
  dayPieces,
  dotColor,
  holidayBars,
  holidayId,
  laneRows,
  layoutTimedDay,
  monthDots,
  occasionText,
  wallMinutes,
  weekStartsOf,
  type MoreBand,
  type PlacedPiece
} from "../../lib/calendarRender";
import { EventBar, HolidayChip, TypeIcon, eventBars, useEventPaint, useEventTheme } from "./bars";
import { ExamChip, TaskChip } from "./chips";
import { EventRow } from "./DayList";
import {
  COARSE_QUERY,
  PHONE_FAB_GUTTER_PX,
  PHONE_QUERY,
  canDrag,
  editOccurrence,
  occurrenceSubject,
  pointerPoint,
  sharedOutline,
  sharedOutlineClass,
  useMediaQuery
} from "./shared";
import type { CalendarOccurrence, Handlers } from "./types";

const MINUTE_MS = 60_000;
/** Etichette orarie a sinistra e spazio tra le colonne dei giorni (px). */
const HOURS_COLUMN_PX = 52;
const COLUMN_GAP_PX = 6;
/** Corsie di barre nella fascia in alto della Settimana: oltre, un "+N" per giorno apre il giorno. */
const WEEK_LANES = 4;

/** Evento preso per trascinarlo: chiave dell'occorrenza e minuti tra il suo inizio e il punto preso. */
type Grab = { key: string; offsetMin: number };

/** Posizione orizzontale di un evento affiancato: la fascia con "+N" lascia spazio a destra. */
const horizontal = ({ column, columns, span, narrowed }: Pick<PlacedPiece<unknown>, "column" | "columns" | "span" | "narrowed">, gutter: number) => {
  const room = narrowed ? `(100% - ${gutter}px)` : "100%";
  return { left: `calc(${room} * ${column / columns} + 1px)`, width: `calc(${room} * ${span / columns} - 3px)` };
};

export function TimeGrid({
  days,
  occurrences,
  tasks,
  exams,
  holidays = [],
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
  /** Festività del periodo (vuoto con "Festività" spento): voci grigie nella fascia in alto. */
  holidays?: Holiday[];
  handlers: Handlers;
  hourHeight?: number;
  fixedHours?: [number, number];
  onPickDay?: (day: Date) => void;
  onExpandHours?: () => void;
}) {
  const now = useNow(60_000);
  const grab = useRef<Grab | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [expandedDays, setExpandedDays] = useState<string[]>([]);
  const [band, setBand] = useState<{ day: Date; band: MoreBand<CalendarOccurrence> } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const element = containerRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setContainerWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  // Telefono: a destra degli eventi resta libera la striscia dove passa il pulsante "+" fisso, così
  // l'ultima colonna di eventi affiancati non finisce mai sotto di lui.
  const fabGutter = useMediaQuery(PHONE_QUERY) ? PHONE_FAB_GUTTER_PX : 0;
  // "+N" da 44 px solo dove si tocca col dito; con il mouse 28 px e più eventi affiancati.
  const pointer = useMediaQuery(COARSE_QUERY) ? "touch" : "mouse";
  // Larghezza di una colonna giorno per gli eventi (etichette orarie a sinistra, spazio tra le colonne).
  const columnWidth = (containerWidth ? (containerWidth - HOURS_COLUMN_PX - days.length * COLUMN_GAP_PX) / days.length : 200) - fabGutter;

  // Eventi di tutto il giorno o su più giorni: barre nella fascia in alto, non nella griglia oraria.
  const theme = useEventTheme();
  const paintOf = useEventPaint();
  const bars = eventBars(occurrences);
  const barById = new Map(bars.map((bar) => [bar.id, bar]));
  const holidayById = new Map(holidays.map((holiday) => [holidayId(holiday), holiday]));
  // Settimana: barre continue da un giorno all'altro, al più WEEK_LANES corsie. Prima gli eventi
  // dell'utente: a parità di giorni le festività cedono la corsia (e finiscono nel "+N").
  const laneRow = days.length === 7 ? laneRows([...bars, ...holidayBars(holidays)], weekStartsOf(days), WEEK_LANES)[0] : undefined;
  const lanes = laneRow?.lanes ?? 0;

  const perDay = days.map((day) => {
    const dayStart = startOfDay(day).getTime();
    // Giorno vero (23 o 25 ore nei giorni del cambio dell'ora), non 24 ore fisse.
    const dayEnd = addDays(startOfDay(day), 1).getTime();
    const ymd = todayYmd(day);
    const pieces = dayPieces(occurrences, dayStart, dayEnd);
    return {
      day,
      dayEnd,
      ymd,
      // Vista Giorno: le barre che toccano il giorno, come striscia con "giorno 2 di 3".
      bars: laneRow ? [] : bars.filter((bar) => bar.startDay <= ymd && bar.endDay >= ymd),
      holidays: laneRow ? [] : holidays.filter((holiday) => holiday.date === ymd),
      pieces,
      layout: layoutTimedDay(pieces, { hourHeight, columnWidth, pointer }),
      tasks: tasks.filter((task) => task.dueDate && isSameDay(parseISO(task.dueDate), day)).sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
      exams: exams.filter((exam) => isSameDay(parseISO(exam.date), day))
    };
  });

  /**
   * Minuti d'orologio dalla mezzanotte (inizio e fine disegnata, almeno l'altezza minima): nei giorni del
   * cambio dell'ora un evento alle 10 sta sulla riga delle 10. Se l'ora che si ripete (ottobre) rende
   * la fine non successiva all'inizio, vale la durata vera.
   */
  const minutesOf = (startMs: number, endMs: number, dayEnd: number) => {
    const startMin = wallMinutes(startMs, dayEnd);
    const wallEnd = wallMinutes(endMs, dayEnd);
    const endMin = wallEnd > startMin ? wallEnd : startMin + (endMs - startMs) / MINUTE_MS;
    const minMinutes = (MIN_EVENT_HEIGHT_PX / hourHeight) * 60;
    return { startMin, endMin: Math.max(endMin, startMin + minMinutes) };
  };

  // Fascia oraria: 8–20 di base, allargata per includere gli eventi visibili (anche quelli nel "+N").
  let [hourStart, hourEnd] = fixedHours ?? [8, 20];
  if (!fixedHours) {
    for (const entry of perDay) {
      for (const piece of entry.pieces) {
        const { startMin, endMin } = minutesOf(piece.startMs, piece.endMs, entry.dayEnd);
        hourStart = Math.min(hourStart, Math.floor(startMin / 60));
        hourEnd = Math.max(hourEnd, Math.ceil(endMin / 60));
      }
    }
    hourStart = Math.max(0, hourStart);
    hourEnd = Math.min(24, hourEnd);
  }

  const hours = Array.from({ length: hourEnd - hourStart }, (_, index) => hourStart + index);
  const gridHeight = hours.length * hourHeight;
  const hasAllDay = Boolean(laneRow?.segments.length) || perDay.some((entry) => entry.bars.length || entry.holidays.length || entry.tasks.length || entry.exams.length);
  // Fascia fissa (Focus 8–19): eventi interamente fuori fascia, che la griglia taglia.
  const outside = (test: (minutes: { startMin: number; endMin: number }) => boolean) =>
    fixedHours ? perDay.reduce((sum, entry) => sum + entry.pieces.filter((piece) => test(minutesOf(piece.startMs, piece.endMs, entry.dayEnd))).length, 0) : 0;
  const hiddenBefore = outside(({ endMin }) => endMin <= hourStart * 60);
  const hiddenAfter = outside(({ startMin }) => startMin >= hourEnd * 60);
  const columns = `${HOURS_COLUMN_PX}px repeat(${days.length}, minmax(0, 1fr))`;
  /** Posizione e altezza (px) di un pezzo nella griglia, dall'ora d'orologio. */
  const boxOf = (startMs: number, endMs: number, dayEnd: number) => {
    const { startMin, endMin } = minutesOf(startMs, endMs, dayEnd);
    return {
      top: ((startMin - hourStart * 60) / 60) * hourHeight,
      height: Math.max(MIN_EVENT_HEIGHT_PX, ((endMin - startMin) / 60) * hourHeight - 2)
    };
  };

  const minutesFromPointer = (event: ReactMouseEvent<HTMLElement> | ReactDragEvent<HTMLElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const minutes = hourStart * 60 + ((event.clientY - rect.top) / hourHeight) * 60;
    return Math.max(0, Math.min(24 * 60 - 15, Math.round(minutes / 15) * 15));
  };

  // Scelto un evento dall'elenco del "+N", l'elenco si chiude e si apre l'evento.
  const bandHandlers: Handlers = {
    ...handlers,
    onEditEvent: (...args) => {
      setBand(null);
      handlers.onEditEvent(...args);
    }
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
                className={`grid h-8 min-w-8 grid-cols-1 place-items-center rounded-full px-1.5 text-lg font-black ${today ? "bg-[var(--accent)] text-[#10131d]" : ""}`}
              >
                {format(day, "d")}
              </span>
            </>
          );
          return onPickDay ? (
            // Alto 40 px, area di tocco di 44 (2 px sopra e sotto, nello spazio prima della fascia in alto).
            <button
              key={day.toISOString()}
              type="button"
              onClick={() => onPickDay(day)}
              className="relative flex items-center justify-center gap-1.5 rounded-[14px] py-1 after:absolute after:-inset-y-0.5 after:inset-x-0 after:content-[''] hover:bg-[var(--surface-soft)] hover:underline hover:decoration-[var(--faint)] hover:underline-offset-4"
              aria-label={CALENDAR_VIEW_TEXT.openDay(format(day, "EEE d", { locale: it }), format(day, "EEEE d MMMM", { locale: it }))}
              title={CALENDAR_VIEW_TEXT.openDay(format(day, "EEE d", { locale: it }), format(day, "EEEE d MMMM", { locale: it }))}
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

      {/* fascia "tutto il giorno": barre (tutto il giorno, più giorni), esami e attività in scadenza */}
      {hasAllDay ? (
        <div
          className="mt-1.5 grid grid-cols-1 gap-x-1.5 gap-y-1 border-b border-[var(--border)] pb-1.5"
          style={{ gridTemplateColumns: columns, gridTemplateRows: `${lanes ? `repeat(${lanes}, auto) ` : ""}auto` }}
        >
          <span
            className="pt-1 text-right text-[10px] font-black uppercase leading-tight text-[var(--faint)]"
            style={{ gridColumn: 1, gridRow: `1 / ${lanes + 2}` }}
            title={CALENDAR_VIEW_TEXT.allDayRowTitle}
          >
            {CALENDAR_VIEW_TEXT.allDayRow}
          </span>
          {laneRow?.segments.map((segment) => {
            const place = { gridColumn: `${segment.startCol + 2} / ${segment.endCol + 3}`, gridRow: segment.lane + 1 };
            const holiday = holidayById.get(segment.id);
            if (holiday) return <HolidayChip key={segment.id} holiday={holiday} theme={theme} style={place} />;
            const bar = barById.get(segment.id);
            return bar ? (
              <EventBar
                key={segment.id}
                item={bar.item}
                handlers={handlers}
                roundStart={!segment.continuesBefore}
                roundEnd={!segment.continuesAfter}
                style={place}
              />
            ) : null;
          })}
          {perDay.map((entry, index) => {
            const dayKey = entry.day.toISOString();
            const base = days.length > 1 ? 3 : 12;
            const expanded = expandedDays.includes(dayKey);
            const limit = expanded ? Number.MAX_SAFE_INTEGER : base;
            const hiddenTasks = Math.max(0, entry.tasks.length - limit);
            // Settimana: barre oltre il tetto e attività in più si vedono aprendo il giorno.
            const hidden = hiddenTasks + (laneRow?.hidden[index] ?? 0);
            const longDay = format(entry.day, "EEEE d MMMM", { locale: it });
            return (
              <div key={dayKey} className="grid grid-cols-1 min-w-0 content-start gap-1" style={{ gridColumn: index + 2, gridRow: lanes + 1 }}>
                {entry.holidays.map((holiday) => (
                  <HolidayChip key={holidayId(holiday)} holiday={holiday} theme={theme} />
                ))}
                {entry.bars.map((bar) => {
                  const position = dayOfSpan(entry.ymd, bar.startDay, bar.endDay);
                  return (
                    <EventBar
                      key={bar.id}
                      item={bar.item}
                      handlers={handlers}
                      detail={position && position.total > 1 ? CALENDAR_LAYOUT_TEXT.dayOfSpan(position.index, position.total) : undefined}
                    />
                  );
                })}
                {entry.exams.map((exam) => (
                  <ExamChip key={exam.id} exam={exam} subjects={handlers.subjects} onOpen={handlers.onOpenExam} />
                ))}
                {entry.tasks.slice(0, limit).map((task) => (
                  <TaskChip key={task.id} task={task} handlers={handlers} />
                ))}
                {hidden > 0 && days.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => onPickDay?.(entry.day)}
                    className="flex min-h-11 items-center text-left text-[11px] font-black text-[var(--muted)] hover:text-[var(--text)]"
                    title={CALENDAR_VIEW_TEXT.moreItemsAria(hidden, longDay)}
                  >
                    {CALENDAR_VIEW_TEXT.moreItems(hidden)}
                  </button>
                ) : hidden > 0 ? (
                  <button
                    type="button"
                    onClick={() => setExpandedDays((value) => [...value, dayKey])}
                    className="flex min-h-11 items-center text-left text-[11px] font-black text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    {CALENDAR_VIEW_TEXT.moreTasks(hidden)}
                  </button>
                ) : expanded && days.length === 1 && entry.tasks.length > base ? (
                  <button
                    type="button"
                    onClick={() => setExpandedDays((value) => value.filter((key) => key !== dayKey))}
                    className="flex min-h-11 items-center text-left text-[11px] font-black text-[var(--muted)] hover:text-[var(--text)]"
                  >
                    {CALENDAR_VIEW_TEXT.showLess}
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
          {CALENDAR_VIEW_TEXT.hiddenBefore(hiddenBefore, `${String(hourStart).padStart(2, "0")}:00`)}
        </button>
      ) : null}

      {/* corpo orario */}
      <div className="relative mt-1.5 grid grid-cols-1 gap-x-1.5" style={{ gridTemplateColumns: columns }}>
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
          const nowMin = wallMinutes(now.getTime(), entry.dayEnd);
          return (
            <div
              key={key}
              role="presentation"
              title={CALENDAR_VIEW_TEXT.gridTitle}
              className={`relative cursor-copy overflow-hidden rounded-[14px] ${dropTarget === key ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : today ? "bg-[var(--surface-soft)]" : ""}`}
              style={{
                height: gridHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0, var(--border) 1px, transparent 1px, transparent ${hourHeight}px)`
              }}
              onClick={(event) => {
                const minutes = minutesFromPointer(event);
                handlers.onCreate(atWallMinutes(entry.day, Math.floor(minutes / 30) * 30));
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
                // Il punto preso resta sotto il puntatore (anche se l'evento era cominciato il giorno prima).
                const minutes = minutesFromPointer(event) - Math.round(dragged.offsetMin / 15) * 15;
                handlers.onMoveEvent(item, atWallMinutes(entry.day, minutes));
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
              {/* Area degli eventi: sul telefono si ferma prima della striscia del pulsante "+" fisso
                  (la striscia resta un orario libero: toccarla aggiunge un evento). */}
              <div className="absolute inset-y-0 left-0" style={{ right: fabGutter }}>
                {entry.layout.placed.map((placed) => (
                  <TimedEvent
                    key={placed.key}
                    placed={placed}
                    gutter={entry.layout.gutter}
                    {...boxOf(placed.startMs, placed.endMs, entry.dayEnd)}
                    hourHeight={hourHeight}
                    handlers={handlers}
                    onGrab={(value) => {
                      grab.current = value;
                    }}
                  />
                ))}
                {entry.layout.more.map((more) => {
                  const { top, height } = boxOf(more.startMs, more.endMs, entry.dayEnd);
                  // Fascia bassa: l'area di tocco arriva a 44 px, sopra e sotto in parti uguali.
                  const reach = Math.max(0, (TOUCH_TARGET_PX - height) / 2);
                  const merged = entry.layout.merged;
                  const visible = merged ? CALENDAR_LAYOUT_TEXT.merged(more.count) : CALENDAR_LAYOUT_TEXT.more(more.count);
                  const explain = merged ? CALENDAR_LAYOUT_TEXT.mergedAria(more.count) : CALENDAR_LAYOUT_TEXT.moreAria(more.count);
                  const dots = merged ? monthDots(more.items.map((item) => dotColor(paintOf(item, handlers.subjects).color, theme, "pill"))) : null;
                  return (
                    <button
                      key={more.cluster}
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        handlers.onPreviewHide();
                        setBand({ day: entry.day, band: more });
                      }}
                      // Il nome comincia dal testo visibile ("+2", "3 eventi"), poi la spiegazione (senza ripeterlo).
                      aria-label={explain.startsWith(visible) ? explain : `${visible}, ${explain}`}
                      title={explain}
                      className={`absolute z-[5] flex flex-col items-center gap-1 rounded-[10px] bg-[var(--surface-strong)] pt-1 text-[11px] font-black leading-tight text-[var(--text)] hover:bg-[var(--surface)] ${
                        merged ? "left-0 right-0 px-1" : "right-0"
                      }`}
                      style={{ top, height, ...(merged ? {} : { width: entry.layout.gutter - 2 }) }}
                    >
                      {reach ? <span aria-hidden="true" className="absolute inset-x-0" style={{ top: -reach, bottom: -reach }} /> : null}
                      {dots ? (
                        <span aria-hidden="true" className="flex items-center gap-0.5">
                          {dots.dots.map((color, index) => (
                            <span key={index} className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                          ))}
                        </span>
                      ) : null}
                      <span className="max-w-full truncate">{visible}</span>
                    </button>
                  );
                })}
              </div>
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
          {CALENDAR_VIEW_TEXT.hiddenAfter(hiddenAfter, `${String(hourEnd).padStart(2, "0")}:00`)}
        </button>
      ) : null}

      <Drawer
        open={band !== null}
        onClose={() => setBand(null)}
        eyebrow={band ? format(band.day, "EEEE d MMMM", { locale: it }) : undefined}
        title={band ? CALENDAR_VIEW_TEXT.bandTitle(timeLabel(new Date(band.band.startMs)), timeLabel(new Date(band.band.endMs))) : ""}
      >
        {band ? (
          <>
            <p className="mb-2 text-sm font-bold text-[var(--muted)]">{CALENDAR_VIEW_TEXT.bandCount(band.band.items.length)}</p>
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
              {band.band.items.map((item) => (
                <li key={item.occurrenceKey}>
                  <EventRow item={item} handlers={bandHandlers} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

/** Un evento con orario nella colonna del giorno: posizione e altezza dall'orario, larghezza dalla sua colonna. */
function TimedEvent({
  placed,
  gutter,
  top,
  height,
  hourHeight,
  handlers,
  onGrab
}: {
  placed: PlacedPiece<CalendarOccurrence>;
  /** Larghezza (px) del "+N" accanto alla fascia (vedi layoutTimedDay). */
  gutter: number;
  top: number;
  height: number;
  hourHeight: number;
  handlers: Handlers;
  onGrab: (grab: Grab) => void;
}) {
  const { item } = placed;
  const paint = useEventPaint()(item, handlers.subjects);
  const occasion = occasionText(item);
  // Righe disponibili nel blocco: il titolo ha la precedenza (colonne strette), l'orario compare da 3
  // righe, la materia da 5.
  const lineCount = Math.max(1, Math.floor((height - 6) / 13.75));
  const showTime = lineCount >= 3;
  const subject = occurrenceSubject(item, handlers.subjects);
  const showSubject = lineCount >= 5 && Boolean(subject);
  const titleLines = Math.min(5, Math.max(1, lineCount - (showTime ? 1 : 0) - (showSubject ? 1 : 0)));
  // Le righe secondarie si attenuano, ma non in un evento fatto: è già attenuato tutto (contrasto ≥ 4,5:1).
  const secondary = item.status === "done" ? "" : "opacity-80";
  return (
    <button
      type="button"
      draggable={canDrag(item)}
      onDragStart={(event) => {
        if (!canDrag(item)) {
          event.preventDefault();
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        // Minuti dall'inizio dell'evento al punto preso: il pezzo del secondo giorno parte da mezzanotte.
        onGrab({ key: item.occurrenceKey, offsetMin: ((event.clientY - rect.top) / hourHeight) * 60 + placed.offsetMs / MINUTE_MS });
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.occurrenceKey);
        handlers.onPreviewHide();
      }}
      onClick={(event) => {
        event.stopPropagation();
        editOccurrence(handlers, item);
      }}
      onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
      onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
      onMouseLeave={handlers.onPreviewHide}
      className={`absolute overflow-hidden rounded-[10px] border-l-[3px] px-1.5 py-1 text-left text-[11px] leading-tight hover:z-20 hover:brightness-110 ${
        item.status === "done" ? "opacity-75" : ""
      } ${sharedOutlineClass(item)}`}
      style={{
        top,
        height,
        ...horizontal(placed, gutter),
        // Colore della tipologia (o della materia), con testo leggibile nel tema.
        borderLeftColor: paint.style.border,
        background: paint.style.background,
        color: paint.style.text,
        // Un filo del colore della pagina separa gli eventi affiancati.
        boxShadow: placed.columns > 1 ? "0 0 0 1px var(--bg-2)" : undefined,
        ...sharedOutline(item)
      }}
    >
      <span className="safe-text font-black" style={{ display: "-webkit-box", WebkitLineClamp: titleLines, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
        <TypeIcon paint={paint} className="mr-0.5 inline h-3 w-3 align-[-2px]" />
        {item.sharedFrom ? (
          <>
            <SharedMark origin={item.sharedFrom} compact />{" "}
          </>
        ) : null}
        {item.recurring ? (
          <span role="img" aria-label={CALENDAR_VIEW_TEXT.recurring}>
            ↻{" "}
          </span>
        ) : null}
        {item.title}
      </span>
      {showTime ? (
        <span className={`one-line-safe block font-bold ${secondary}`}>
          {timeLabel(item.start)}–{timeLabel(item.end)}
          {occasion ? ` · ${occasion}` : ""}
        </span>
      ) : null}
      {showSubject ? <span className={`one-line-safe block font-bold ${secondary}`}>{subject}</span> : null}
    </button>
  );
}
