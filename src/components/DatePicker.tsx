// Selettore grafico di data e ora (al posto di `datetime-local`, che sui telefoni apre le rotelle):
// un mese intero da lunedì a domenica, mese e anno scelti con un tocco sul titolo, orari ogni 15 minuti
// più un campo "hh:mm". Pannello dal basso sui telefoni (< 640 px), popover sul computer; montato
// dentro la finestra aperta come fumetti e menu, pagina bloccata, tastiera completa.
import { createPortal } from "react-dom";
import { AnimatePresence, m, useReducedMotion } from "framer-motion";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import { Icon } from "./Icon";
import { Button, floatingHost, inputClass, useDialogLayer, useFloatingLayer } from "./ui";
import { DATE_PICKER_TEXT as TEXT } from "../lib/labels";
import {
  addMonths,
  clampYmd,
  daysInclusive,
  formatDateField,
  formatDateLong,
  formatDateTimeField,
  formatMonthTitle,
  formatRangeField,
  isOutOfRange,
  joinDateTime,
  jumpTo,
  monthDisabled,
  monthGrid,
  moveByKey,
  nearestSlot,
  parseTime,
  parseYmd,
  pickRange,
  previewRange,
  splitDateTime,
  timeSlots,
  todayYmd,
  yearDisabled,
  yearPage
} from "../lib/datePicker";

/* ------------------------------------------------------------------ */
/* Campo e pannello                                                    */
/* ------------------------------------------------------------------ */

const labelClass = "mb-1.5 block text-xs font-black uppercase text-[var(--faint)]";

/** Stato comune dei tre campi: aperto, foglio o popover (deciso all'apertura), finestra che lo ospita. */
function usePicker() {
  const [open, setOpen] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const openPicker = () => {
    setSheet(!window.matchMedia("(min-width: 640px)").matches);
    setHost(floatingHost(buttonRef.current));
    setOpen(true);
  };
  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);
  return { open, sheet, host, buttonRef, openPicker, close };
}

type Picker = ReturnType<typeof usePicker>;

/** Il campo: etichetta, giorno della settimana e data sempre visibili, nome completo per gli screen reader. */
function PickerTrigger({
  label,
  text,
  spoken,
  picker,
  onOpen,
  icon = "CalendarDays"
}: {
  label: string;
  text: string;
  spoken: string;
  picker: Picker;
  /** Prepara il pannello (giorno con il focus) e lo apre. */
  onOpen: () => void;
  icon?: string;
}) {
  const id = useId();
  return (
    <div className="min-w-0">
      <span id={`${id}-label`} className={labelClass}>
        {label}
      </span>
      <button
        ref={picker.buttonRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={picker.open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (picker.open ? picker.close(true) : onOpen())}
        className={`${inputClass} motion-safe flex items-center gap-2 text-left hover:bg-[var(--surface)]`}
      >
        <Icon name={icon} className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
        <span aria-hidden="true" className={`one-line-safe flex-1 ${text ? "" : "font-semibold text-[var(--faint)]"}`}>
          {text || TEXT.noDate}
        </span>
        <span id={`${id}-value`} className="sr-only">
          {spoken || TEXT.noDate}
        </span>
        <Icon name="ChevronDown" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
      </button>
    </div>
  );
}

/**
 * Pannello del selettore. Telefono: foglio dal basso con sfondo (tocco fuori = chiude). Computer:
 * popover sotto il campo (sopra se manca spazio). Esc chiude solo il selettore (anche dentro un modulo),
 * Tab resta dentro, il focus torna al campo; la pagina sotto non scorre.
 */
function PickerShell({
  open,
  sheet,
  host,
  onClose,
  anchorRef,
  title,
  width,
  children
}: {
  open: boolean;
  sheet: boolean;
  host: HTMLElement | null;
  onClose: (refocus: boolean) => void;
  anchorRef: RefObject<HTMLElement | null>;
  title: string;
  width: string;
  children: ReactNode;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const position = useFloatingLayer(open, onClose, anchorRef, panelRef, "start", sheet);
  useDialogLayer(open, { panelRef, areaRef: sheet ? backdropRef : panelRef });

  const heading = (
    <p id={titleId} className="one-line-safe mb-2 text-xs font-black uppercase text-[var(--faint)]">
      {title}
    </p>
  );

  return createPortal(
    <AnimatePresence>
      {open ? (
        sheet ? (
          <m.div
            ref={backdropRef}
            key="picker-sheet"
            className="fixed inset-0 z-[60] flex items-end bg-black/35"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
          >
            <m.div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              className="soft-panel scrollbar-soft max-h-[92dvh] w-full overflow-y-auto overscroll-contain rounded-b-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))] outline-none"
              initial={{ y: reduceMotion ? 0 : 48 }}
              animate={{ y: 0 }}
              exit={{ y: reduceMotion ? 0 : 48 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
            >
              {heading}
              {children}
            </m.div>
          </m.div>
        ) : (
          <m.div
            ref={panelRef}
            key="picker-popover"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            className="soft-panel scrollbar-soft fixed z-[60] overflow-y-auto overscroll-contain p-3 outline-none"
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              width,
              maxWidth: "calc(100vw - 32px)",
              maxHeight: "calc(100dvh - 32px)"
            }}
            initial={{ opacity: 0, y: reduceMotion ? 0 : position?.side === "top" ? 4 : -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14, ease: "easeOut" }}
          >
            {heading}
            {children}
          </m.div>
        )
      ) : null}
    </AnimatePresence>,
    host ?? document.body
  );
}

function PickerFooter({ children }: { children: ReactNode }) {
  return <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] pt-3">{children}</div>;
}

/* ------------------------------------------------------------------ */
/* Calendario del mese                                                 */
/* ------------------------------------------------------------------ */

const navButtonClass =
  "motion-safe relative grid h-9 w-9 shrink-0 grid-cols-1 place-items-center rounded-full text-[var(--muted)] after:absolute after:-inset-1 after:content-[''] hover:bg-[var(--surface)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-35";

function NavButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={navButtonClass}>
      <Icon name={icon} className="h-4 w-4" />
    </button>
  );
}

const choiceClass = (current: boolean) =>
  `motion-safe min-h-11 rounded-[14px] px-2 text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-35 ${
    current ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-soft)] text-[var(--text)] hover:bg-[var(--surface)]"
  }`;

/**
 * Un mese da lunedì a domenica. `focusDay` è il giorno con il focus (tabindex mobile): frecce, Pagina
 * su/giù (con Maiusc l'anno), Home/End lo spostano; Invio o tocco sceglie. Il titolo apre la scelta
 * di mese e anno (e da lì degli anni) senza scorrere.
 */
function MonthCalendar({
  focusDay,
  onFocusDay,
  onPick,
  today,
  selected,
  range,
  min,
  max,
  onHover
}: {
  focusDay: string;
  onFocusDay: (ymd: string) => void;
  onPick: (ymd: string) => void;
  today: string;
  selected?: string;
  range?: { start: string; end: string };
  min?: string;
  max?: string;
  onHover?: (ymd: string | null) => void;
}) {
  const id = useId();
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const { year, month } = parseYmd(focusDay) ?? { year: 1970, month: 0 };
  const [viewYear, setViewYear] = useState(year);
  const rootRef = useRef<HTMLDivElement>(null);
  // Il focus segue il giorno solo dopo un tasto o un cambio di vista, mai all'apertura (lo dà il pannello).
  const moveFocus = useRef(false);
  const grid = useMemo(() => monthGrid(year, month, { today, selected, min, max, range }), [year, month, today, selected, min, max, range]);
  const title = formatMonthTitle(year, month);

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    const target =
      view === "days"
        ? rootRef.current?.querySelector<HTMLElement>(`[data-ymd="${focusDay}"]`)
        : rootRef.current?.querySelector<HTMLElement>('[data-current="true"]');
    target?.focus();
  }, [focusDay, view, viewYear]);

  const go = (next: string, focus = false) => {
    moveFocus.current = focus;
    onFocusDay(next);
  };

  const onGridKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = moveByKey(focusDay, event.key, { shiftKey: event.shiftKey, min, max });
    if (next === null) return;
    event.preventDefault();
    go(next, true);
  };

  const switchView = (next: "days" | "months" | "years") => {
    moveFocus.current = true;
    setView(next);
  };

  if (view !== "days") {
    const years = yearPage(viewYear);
    return (
      <div ref={rootRef} className="min-h-[19.5rem] min-w-0 sm:min-h-[18.25rem] sm:w-[18.5rem] sm:shrink-0">
        <div className="mb-2 flex items-center gap-1">
          <NavButton
            icon="ChevronLeft"
            label={view === "months" ? TEXT.previousYear : TEXT.previousYears}
            onClick={() => setViewYear((value) => value - (view === "months" ? 1 : 12))}
          />
          <button
            type="button"
            onClick={() => switchView(view === "months" ? "years" : "days")}
            aria-label={view === "months" ? TEXT.chooseYear(viewYear) : TEXT.backToDays}
            className="motion-safe min-h-9 flex-1 rounded-full px-2 text-sm font-black hover:bg-[var(--surface)]"
          >
            {view === "months" ? viewYear : `${years[0]} – ${years[years.length - 1]}`}
          </button>
          <NavButton
            icon="ChevronRight"
            label={view === "months" ? TEXT.nextYear : TEXT.nextYears}
            onClick={() => setViewYear((value) => value + (view === "months" ? 1 : 12))}
          />
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {view === "months"
            ? TEXT.monthsLong.map((name, index) => {
                const current = viewYear === year && index === month;
                return (
                  <button
                    key={name}
                    type="button"
                    data-current={current || undefined}
                    aria-pressed={current}
                    disabled={monthDisabled(viewYear, index, min, max)}
                    onClick={() => {
                      go(jumpTo(focusDay, viewYear, index, { min, max }), true);
                      setView("days");
                    }}
                    className={choiceClass(current)}
                  >
                    <span aria-hidden="true">{TEXT.monthsShort[index]}</span>
                    <span className="sr-only">{name}</span>
                  </button>
                );
              })
            : years.map((value) => {
                const current = value === viewYear;
                return (
                  <button
                    key={value}
                    type="button"
                    data-current={current || undefined}
                    aria-pressed={current}
                    disabled={yearDisabled(value, min, max)}
                    onClick={() => {
                      setViewYear(value);
                      switchView("months");
                    }}
                    className={choiceClass(current)}
                  >
                    {value}
                  </button>
                );
              })}
        </div>
      </div>
    );
  }

  const firstOfMonth = `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-01`;

  return (
    <div ref={rootRef} className="min-h-[19.5rem] min-w-0 sm:min-h-[18.25rem] sm:w-[18.5rem] sm:shrink-0">
      <div className="mb-1 flex items-center gap-1">
        <NavButton
          icon="ChevronLeft"
          label={TEXT.previousMonth}
          disabled={Boolean(min && firstOfMonth <= min)}
          onClick={() => go(clampYmd(addMonths(focusDay, -1), min, max))}
        />
        <button
          type="button"
          id={`${id}-title`}
          onClick={() => {
            setViewYear(year);
            switchView("months");
          }}
          aria-label={TEXT.chooseMonthYear(title)}
          aria-live="polite"
          className="motion-safe inline-flex min-h-9 flex-1 items-center justify-center gap-1 rounded-full px-2 text-sm font-black capitalize hover:bg-[var(--surface)]"
        >
          {title}
          <Icon name="ChevronDown" className="h-3.5 w-3.5 text-[var(--muted)]" />
        </button>
        <NavButton
          icon="ChevronRight"
          label={TEXT.nextMonth}
          disabled={Boolean(max && addMonths(firstOfMonth, 1) > max)}
          onClick={() => go(clampYmd(addMonths(focusDay, 1), min, max))}
        />
      </div>
      <div role="grid" aria-labelledby={`${id}-title`} onKeyDown={onGridKey} onMouseLeave={() => onHover?.(null)}>
        <div role="row" className="grid grid-cols-7">
          {TEXT.weekdaysShort.map((name, index) => (
            <span key={name} role="columnheader" aria-label={TEXT.weekdaysLong[index]} className="py-1 text-center text-[11px] font-black uppercase text-[var(--faint)]">
              {name}
            </span>
          ))}
        </div>
        {grid.weeks.map((week) => (
          <div role="row" key={week[0].ymd} className="grid grid-cols-7">
            {week.map((day) => {
              const edge = day.rangeStart || day.rangeEnd || day.isSelected;
              return (
                <div
                  role="gridcell"
                  key={day.ymd}
                  aria-selected={day.isSelected || day.inRange}
                  className={`flex justify-center py-0.5 ${
                    day.inRange && !(day.rangeStart && day.rangeEnd)
                      ? `bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] ${day.rangeStart ? "rounded-l-full" : ""} ${day.rangeEnd ? "rounded-r-full" : ""}`
                      : ""
                  }`}
                >
                  <button
                    type="button"
                    data-ymd={day.ymd}
                    data-autofocus={day.ymd === focusDay || undefined}
                    tabIndex={day.ymd === focusDay ? 0 : -1}
                    disabled={day.disabled}
                    aria-label={day.isToday ? `${formatDateLong(day.ymd)}, ${TEXT.todaySuffix}` : formatDateLong(day.ymd)}
                    aria-current={day.isToday ? "date" : undefined}
                    onClick={() => {
                      moveFocus.current = false;
                      onFocusDay(day.ymd);
                      onPick(day.ymd);
                    }}
                    onFocus={() => {
                      if (day.ymd !== focusDay) onFocusDay(day.ymd);
                      onHover?.(day.ymd);
                    }}
                    onMouseEnter={() => onHover?.(day.ymd)}
                    className={`motion-safe grid h-11 w-11 grid-cols-1 place-items-center rounded-full text-sm font-extrabold disabled:cursor-not-allowed disabled:opacity-35 sm:h-10 sm:w-10 ${
                      edge
                        ? "bg-[var(--accent)] text-[#10131d]"
                        : `${day.inMonth ? "text-[var(--text)]" : "text-[var(--faint)]"} hover:bg-[var(--surface)]`
                    } ${day.isToday ? "ring-2 ring-[var(--accent-ink)] ring-offset-2 ring-offset-[var(--bg-2)]" : ""}`}
                  >
                    {day.day}
                  </button>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Orari                                                               */
/* ------------------------------------------------------------------ */

const SLOT_STEP = 15;

/**
 * Ora: campo "hh:mm" (accetta 9.30, 930, 09:30) e orari ogni 15 minuti centrati su quello scelto.
 * Frecce, Home/End tra gli orari; un tocco su un orario lo sceglie e chiude.
 */
function TimeChooser({
  value,
  minTime,
  sheet,
  focusRequest,
  onCommit
}: {
  value: string;
  minTime?: string;
  sheet: boolean;
  focusRequest: number;
  onCommit: (time: string, close: boolean) => void;
}) {
  const id = useId();
  const slots = useMemo(() => timeSlots(SLOT_STEP), []);
  const listRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(() => nearestSlot(value || "09:00", SLOT_STEP));
  const [typed, setTyped] = useState(value);
  const [error, setError] = useState("");
  const columns = sheet ? 4 : 1;

  useEffect(() => {
    setTyped(value);
    setError("");
    if (value) setCursor(nearestSlot(value, SLOT_STEP));
  }, [value]);

  // L'orario scelto (o il più vicino) al centro della lista, senza muovere il resto della pagina.
  useLayoutEffect(() => {
    const list = listRef.current;
    const slot = list?.querySelector<HTMLElement>(`[data-slot="${nearestSlot(value || "09:00", SLOT_STEP)}"]`);
    if (list && slot) list.scrollTop = slot.offsetTop - list.clientHeight / 2 + slot.offsetHeight / 2;
  }, [value]);

  useEffect(() => {
    // Solo alla richiesta (data appena scelta), non a ogni spostamento del cursore.
    if (focusRequest) listRef.current?.querySelector<HTMLElement>(`[data-slot="${cursor}"]`)?.focus();
  }, [focusRequest]);

  const commitTyped = (close: boolean) => {
    if (!typed.trim() || typed === value) return;
    const time = parseTime(typed);
    if (!time) return setError(TEXT.timeInvalid);
    if (minTime && time < minTime) return setError(TEXT.timeTooEarly(minTime));
    setError("");
    onCommit(time, close);
  };

  const onListKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = slots.indexOf(cursor);
    const step: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    let next: number | null = null;
    if (event.key in step) next = index + step[event.key];
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = slots.length - 1;
    if (next === null) return;
    event.preventDefault();
    const slot = slots[Math.max(0, Math.min(slots.length - 1, next))];
    setCursor(slot);
    listRef.current?.querySelector<HTMLElement>(`[data-slot="${slot}"]`)?.focus();
  };

  return (
    <div className={`min-w-0 ${sheet ? "" : "w-28 shrink-0"}`}>
      <label htmlFor={`${id}-input`} className={labelClass}>
        {TEXT.time}
      </label>
      <input
        id={`${id}-input`}
        className={inputClass}
        inputMode="decimal"
        autoComplete="off"
        placeholder={TEXT.timePlaceholder}
        title={TEXT.timeInput}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        value={typed}
        onChange={(event) => {
          setTyped(event.target.value);
          setError("");
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          commitTyped(true);
        }}
        onBlur={() => commitTyped(false)}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="safe-text mt-1 text-xs font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
      <div
        ref={listRef}
        role="group"
        aria-label={TEXT.timeSlots}
        onKeyDown={onListKey}
        className={`scrollbar-soft relative mt-2 grid overflow-y-auto overscroll-contain p-0.5 ${sheet ? "max-h-44 grid-cols-4 gap-1.5" : "max-h-[15.25rem] grid-cols-1 gap-1"}`}
      >
        {slots.map((slot) => {
          const chosen = slot === value;
          return (
            <button
              key={slot}
              type="button"
              data-slot={slot}
              tabIndex={slot === cursor ? 0 : -1}
              aria-pressed={chosen}
              disabled={Boolean(minTime && slot < minTime)}
              onClick={() => {
                setCursor(slot);
                onCommit(slot, true);
              }}
              className={`motion-safe min-h-10 rounded-[12px] text-sm font-extrabold tabular-nums disabled:cursor-not-allowed disabled:opacity-35 ${
                chosen ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-soft)] text-[var(--text)] hover:bg-[var(--surface)]"
              }`}
            >
              {slot}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Campi pubblici                                                      */
/* ------------------------------------------------------------------ */

/**
 * Data ("YYYY-MM-DD"). Un tocco su un giorno lo sceglie e chiude. `optional`: valore "" ammesso, con
 * "Togli la data" nel pannello.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  label,
  optional = false
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  label: string;
  optional?: boolean;
}) {
  const picker = usePicker();
  const today = todayYmd();
  const [focusDay, setFocusDay] = useState(today);
  const valid = parseYmd(value) ? value : "";

  const open = () => {
    setFocusDay(clampYmd(valid || today, min, max));
    picker.openPicker();
  };
  const choose = (ymd: string) => {
    onChange(ymd);
    picker.close(true);
  };

  return (
    <>
      <PickerTrigger
        label={label}
        text={valid ? formatDateField(valid, today) : ""}
        spoken={valid ? formatDateLong(valid) : ""}
        picker={picker}
        onOpen={open}
      />
      <PickerShell open={picker.open} sheet={picker.sheet} host={picker.host} onClose={picker.close} anchorRef={picker.buttonRef} title={label} width="20.5rem">
        <MonthCalendar focusDay={focusDay} onFocusDay={setFocusDay} onPick={choose} today={today} selected={valid || undefined} min={min} max={max} />
        <PickerFooter>
          {optional && valid ? (
            <Button onClick={() => choose("")} className="mr-auto">
              {TEXT.clear}
            </Button>
          ) : null}
          {!isOutOfRange(today, min, max) ? (
            <Button variant="soft" onClick={() => choose(today)}>
              {TEXT.today}
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => picker.close(true)}>
            {TEXT.done}
          </Button>
        </PickerFooter>
      </PickerShell>
    </>
  );
}

/**
 * Data e ora (valore locale "YYYY-MM-DDTHH:mm", come `datetime-local`). Prima il giorno, poi nello
 * stesso pannello l'ora; `allDay` nasconde l'ora (la parte oraria del valore resta com'è). `min`:
 * stesso formato, giorni e orari precedenti non si scelgono. `optional`: valore "" ammesso.
 * `defaultTime`: ora proposta quando il valore è vuoto.
 */
export function DateTimeField({
  value,
  onChange,
  min,
  label,
  allDay = false,
  optional = false,
  defaultTime = "09:00"
}: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  label: string;
  allDay?: boolean;
  optional?: boolean;
  defaultTime?: string;
}) {
  const picker = usePicker();
  const today = todayYmd();
  const parts = splitDateTime(value);
  const minParts = min ? splitDateTime(min) : null;
  const minDate = minParts?.date;
  const [focusDay, setFocusDay] = useState(today);
  const [focusTime, setFocusTime] = useState(0);
  const date = parts?.date ?? focusDay;
  const minTime = minParts && date === minParts.date ? minParts.time : undefined;

  const open = () => {
    setFocusDay(clampYmd(parts?.date ?? today, minDate));
    picker.openPicker();
  };
  const pickDay = (ymd: string) => {
    const time = parts?.time ?? defaultTime;
    const earliest = minParts && ymd === minParts.date ? minParts.time : undefined;
    onChange(joinDateTime(ymd, earliest && time < earliest ? earliest : time));
    if (allDay) picker.close(true);
    else setFocusTime((count) => count + 1);
  };

  return (
    <>
      <PickerTrigger
        label={label}
        text={parts ? formatDateTimeField(value, today, { allDay }) : ""}
        spoken={parts ? `${formatDateLong(parts.date)}${allDay ? "" : `, ${parts.time}`}` : ""}
        picker={picker}
        onOpen={open}
      />
      <PickerShell
        open={picker.open}
        sheet={picker.sheet}
        host={picker.host}
        onClose={picker.close}
        anchorRef={picker.buttonRef}
        title={label}
        width={allDay ? "20.5rem" : "28.5rem"}
      >
        <div className="flex flex-col gap-4 sm:flex-row">
          <MonthCalendar
            focusDay={focusDay}
            onFocusDay={setFocusDay}
            onPick={pickDay}
            today={today}
            selected={parts?.date}
            min={minDate}
          />
          {allDay ? null : (
            <TimeChooser
              value={parts?.time ?? ""}
              minTime={minTime}
              sheet={picker.sheet}
              focusRequest={focusTime}
              onCommit={(time, close) => {
                onChange(joinDateTime(date, time));
                if (close) picker.close(true);
              }}
            />
          )}
        </div>
        <PickerFooter>
          {optional && parts ? (
            <Button
              onClick={() => {
                onChange("");
                picker.close(true);
              }}
              className="mr-auto"
            >
              {TEXT.clear}
            </Button>
          ) : null}
          {!isOutOfRange(today, minDate) ? (
            <Button
              variant="soft"
              onClick={() => {
                setFocusDay(today);
                pickDay(today);
              }}
            >
              {TEXT.today}
            </Button>
          ) : null}
          <Button variant="primary" onClick={() => picker.close(true)}>
            {TEXT.done}
          </Button>
        </PickerFooter>
      </PickerShell>
    </>
  );
}

/**
 * Più giorni sullo stesso calendario ("YYYY-MM-DD", fine compresa): primo tocco = inizio, secondo =
 * fine (se viene prima, i due si scambiano), intervallo evidenziato e "N giorni" (partenza e ritorno
 * compresi). `onChange(start, end)` a ogni tocco: dopo il primo l'intervallo è di un giorno.
 */
export function DateRangeField({
  start,
  end,
  onChange,
  label,
  min,
  max
}: {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
  label: string;
  min?: string;
  max?: string;
}) {
  const picker = usePicker();
  const today = todayYmd();
  const validStart = parseYmd(start) ? start : "";
  const validEnd = validStart && parseYmd(end) && end >= validStart ? end : validStart;
  const [focusDay, setFocusDay] = useState(today);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const shown = anchor && hover ? previewRange(anchor, hover) : validStart ? { start: validStart, end: validEnd } : undefined;
  const count = shown ? daysInclusive(shown.start, shown.end) : 0;

  const open = () => {
    setFocusDay(clampYmd(validStart || today, min, max));
    setAnchor(null);
    setHover(null);
    picker.openPicker();
  };
  const pick = (day: string) => {
    const next = pickRange({ start: validStart, end: validEnd, anchor }, day);
    onChange(next.start, next.end);
    setAnchor(next.anchor);
    if (next.done) picker.close(true);
  };

  return (
    <>
      <PickerTrigger
        label={label}
        icon="CalendarRange"
        text={validStart ? `${formatRangeField(validStart, validEnd, today)} · ${TEXT.days(daysInclusive(validStart, validEnd))}` : ""}
        spoken={
          validStart
            ? `${formatDateLong(validStart)}${validEnd !== validStart ? ` – ${formatDateLong(validEnd)}` : ""}, ${TEXT.days(daysInclusive(validStart, validEnd))}`
            : ""
        }
        picker={picker}
        onOpen={open}
      />
      <PickerShell open={picker.open} sheet={picker.sheet} host={picker.host} onClose={picker.close} anchorRef={picker.buttonRef} title={label} width="20.5rem">
        <p className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-sm font-bold" aria-live="polite">
          <span className="text-[var(--muted)]">{anchor ? TEXT.rangeEndHint : TEXT.rangeStartHint}</span>
          {count ? <span className="font-black text-[var(--accent-ink)]">{TEXT.days(count)}</span> : null}
        </p>
        <MonthCalendar
          focusDay={focusDay}
          onFocusDay={setFocusDay}
          onPick={pick}
          today={today}
          range={shown}
          min={min}
          max={max}
          onHover={(day) => setHover(anchor ? day : null)}
        />
        <PickerFooter>
          <Button variant="primary" onClick={() => picker.close(true)}>
            {TEXT.done}
          </Button>
        </PickerFooter>
      </PickerShell>
    </>
  );
}
