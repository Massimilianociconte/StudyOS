// Riga dei filtri sopra il calendario: una materia sola (la sua pillola accesa, con ✕) o tutte, le
// festività accese o spente e, in ogni vista, le Attività senza data.
import { useEffect, useRef } from "react";
import { Icon } from "../Icon";
import { CALENDAR_TEXT, CALENDAR_VIEW_TEXT, HOLIDAYS_TOGGLE_LABEL } from "../../lib/labels/calendar";
import { safeCssColor } from "../../lib/sharing";
import { selectableSubjects } from "../../lib/selectors";
import type { Subjects } from "./types";

/** Pillola della riga: 44 px di altezza (bersaglio da dito), accesa o spenta. */
const pill = (pressed: boolean) =>
  `motion-safe inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-extrabold ${
    pressed
      ? "border-transparent bg-[var(--accent)] text-[#10131d]"
      : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
  }`;

/**
 * Riga "Tutte · Analisi · Fisica…": scorre in orizzontale dentro la riga (mai la pagina). Un solo
 * segno del filtro attivo: la pillola della materia accesa, con ✕, che lo toglie (e resta in vista
 * quando la riga scorre). Dopo (sul telefono vanno a capo): "Festività" (solo con `onToggleHolidays`:
 * sul telefono è in «Altre azioni») e "Senza data · N".
 */
export function CalendarFilterRow({
  subjects,
  active,
  onChange,
  showHolidays,
  onToggleHolidays,
  undatedCount = 0,
  onOpenUndated
}: {
  subjects: Subjects;
  active: Subjects[number] | null;
  onChange: (id: string | null) => void;
  showHolidays: boolean;
  onToggleHolidays?: () => void;
  /** Attività senza data; il pulsante compare solo se ce ne sono e c'è chi le apre. */
  undatedCount?: number;
  onOpenUndated?: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const options = selectableSubjects(subjects, active?.id);
  const hasOptions = options.length > 0;
  // La pillola attiva resta in vista anche quando la riga scorre (telefono).
  useEffect(() => {
    const row = rowRef.current;
    const pressed = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !pressed) return;
    const start = pressed.offsetLeft - row.offsetLeft;
    const end = start + pressed.offsetWidth;
    if (start < row.scrollLeft) row.scrollTo({ left: Math.max(0, start - 12) });
    else if (end > row.scrollLeft + row.clientWidth) row.scrollTo({ left: end - row.clientWidth + 12 });
  }, [active?.id]);
  // Con il mouse la rotella (su e giù) scorre la riga di lato, finché c'è da scorrere: senza trackpad
  // le materie oltre il bordo non si raggiungevano. Ai bordi la rotella torna alla pagina.
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
      const max = row.scrollWidth - row.clientWidth;
      if (max <= 0) return;
      const next = Math.min(max, Math.max(0, row.scrollLeft + event.deltaY));
      if (next === row.scrollLeft) return;
      event.preventDefault();
      row.scrollLeft = next;
    };
    row.addEventListener("wheel", onWheel, { passive: false });
    return () => row.removeEventListener("wheel", onWheel);
  }, [hasOptions]);
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
      {options.length ? (
        <div
          ref={rowRef}
          role="group"
          aria-label={CALENDAR_TEXT.filterLabel}
          className="scroll-strip flex min-w-0 flex-1 basis-[60%] gap-1.5 overflow-x-auto py-0.5"
        >
          <button type="button" aria-pressed={!active} onClick={() => onChange(null)} className={pill(!active)}>
            {CALENDAR_TEXT.allSubjects}
          </button>
          {options.map((subject) => {
            const pressed = active?.id === subject.id;
            return (
              <button
                key={subject.id}
                type="button"
                aria-pressed={pressed}
                aria-label={pressed ? CALENDAR_TEXT.clearFilter(subject.name) : undefined}
                title={pressed ? CALENDAR_TEXT.showAll : undefined}
                onClick={() => onChange(pressed ? null : subject.id)}
                className={pill(pressed)}
              >
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: safeCssColor(subject.color) || "var(--accent)" }} />
                {subject.name}
                {pressed ? <Icon name="X" className="h-3.5 w-3.5 shrink-0" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-1.5 py-0.5 empty:hidden">
        {onToggleHolidays ? (
          <button type="button" aria-pressed={showHolidays} onClick={onToggleHolidays} title={CALENDAR_VIEW_TEXT.holidaysTitle} className={pill(showHolidays)}>
            <Icon name="PartyPopper" className="h-3.5 w-3.5 shrink-0" />
            {HOLIDAYS_TOGGLE_LABEL}
          </button>
        ) : null}
        {undatedCount > 0 && onOpenUndated ? (
          <button type="button" onClick={onOpenUndated} title={CALENDAR_VIEW_TEXT.undatedAria(undatedCount)} aria-haspopup="dialog" className={pill(false)}>
            <Icon name="CalendarPlus" className="h-3.5 w-3.5 shrink-0" />
            {CALENDAR_VIEW_TEXT.undated(undatedCount)}
          </button>
        ) : null}
      </div>
    </div>
  );
}
