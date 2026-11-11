// Riga dei filtri sopra il calendario: una materia sola ("Solo: Analisi ✕") o tutte, le festività
// accese o spente e, in Giorno e Agenda, le Attività senza data.
import { useEffect, useRef } from "react";
import { Icon } from "../Icon";
import { CALENDAR_TEXT, CALENDAR_VIEW_TEXT, HOLIDAYS_TOGGLE_LABEL } from "../../lib/labels";
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
 * Riga "Tutte · Analisi · Fisica…": scorre in orizzontale dentro la riga (mai la pagina). Con un
 * filtro attivo, a sinistra e sempre visibile, il chip "Solo: Analisi ✕" che lo toglie. Dopo, sempre
 * visibili (sul telefono vanno a capo): "Festività" e "Senza data · N".
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
  onToggleHolidays: () => void;
  /** Attività senza data; il pulsante compare solo se ce ne sono e c'è chi le apre. */
  undatedCount?: number;
  onOpenUndated?: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  const options = selectableSubjects(subjects, active?.id);
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
  return (
    <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2">
      {active ? (
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label={CALENDAR_TEXT.clearFilter(active.name)}
          title={CALENDAR_TEXT.showAll}
          className="motion-safe inline-flex min-h-11 max-w-[50%] shrink-0 items-center gap-1.5 rounded-full border border-[var(--accent-ink)] bg-[var(--surface-strong)] px-3 text-xs font-black text-[var(--text)] hover:bg-[var(--surface)]"
        >
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: safeCssColor(active.color) || "var(--accent)" }} />
          <span className="min-w-0 truncate">{CALENDAR_TEXT.onlySubject(active.name)}</span>
          <Icon name="X" className="h-3.5 w-3.5 shrink-0" />
        </button>
      ) : null}
      {options.length ? (
        <div
          ref={rowRef}
          role="group"
          aria-label={CALENDAR_TEXT.filterLabel}
          className="no-scrollbar flex min-w-0 flex-1 basis-[60%] gap-1.5 overflow-x-auto py-0.5"
        >
          <button type="button" aria-pressed={!active} onClick={() => onChange(null)} className={pill(!active)}>
            {CALENDAR_TEXT.allSubjects}
          </button>
          {options.map((subject) => {
            const pressed = active?.id === subject.id;
            return (
              <button key={subject.id} type="button" aria-pressed={pressed} onClick={() => onChange(pressed ? null : subject.id)} className={pill(pressed)}>
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: safeCssColor(subject.color) || "var(--accent)" }} />
                {subject.name}
              </button>
            );
          })}
        </div>
      ) : null}
      <div className="flex shrink-0 items-center gap-1.5 py-0.5">
        <button type="button" aria-pressed={showHolidays} onClick={onToggleHolidays} title={CALENDAR_VIEW_TEXT.holidaysTitle} className={pill(showHolidays)}>
          <Icon name="PartyPopper" className="h-3.5 w-3.5 shrink-0" />
          {HOLIDAYS_TOGGLE_LABEL}
        </button>
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
