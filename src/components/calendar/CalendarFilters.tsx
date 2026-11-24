// Riga dei filtri sopra il calendario: «Scegli» (pannello con tutte le materie, una o più o una sola, e
// le festività), tutte le materie, una o più (le pillole accese, con ✕), le festività accese o spente
// e, in ogni vista, le Attività senza data.
import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../Icon";
import { Button, Drawer } from "../ui";
import { CALENDAR_PICKER_TEXT, CALENDAR_TEXT, CALENDAR_VIEW_TEXT, HOLIDAYS_TOGGLE_LABEL } from "../../lib/labels/calendar";
import { safeCssColor } from "../../lib/sharing";
import { selectableSubjects } from "../../lib/selectors";
import { toggleSubjectFilter } from "../../lib/calendarFilter";
import type { Subjects } from "./types";

/** Pillola della riga: 44 px di altezza (bersaglio da dito), accesa o spenta. */
const pill = (pressed: boolean) =>
  `motion-safe inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-extrabold ${
    pressed
      ? "border-transparent bg-[var(--accent)] text-[#10131d]"
      : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
  }`;

/**
 * Riga "Tutte · Analisi · Fisica…": scorre in orizzontale dentro la riga (mai la pagina). Un tocco su
 * una materia la aggiunge alle scelte (si vedono gli impegni di tutte quelle accese), un altro la
 * toglie (✕); «Tutte» le toglie tutte in un colpo. L'ultima accesa resta in vista quando la riga
 * scorre. Prima della riga «Scegli» apre il pannello con tutte le scelte. Dopo (sul telefono vanno a
 * capo): "Festività" (solo con `onToggleHolidays`; sul telefono anche in «Altre azioni») e
 * "Senza data · N".
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
  /** Materie scelte (nessuna = tutte). */
  active: readonly string[];
  onChange: (ids: string[]) => void;
  showHolidays: boolean;
  onToggleHolidays?: () => void;
  /** Attività senza data; il pulsante compare solo se ce ne sono e c'è chi le apre. */
  undatedCount?: number;
  onOpenUndated?: () => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  // Le materie superate escono dalla riga, ma una già scelta (es. dal riepilogo «Per materia») resta.
  const options = subjects.filter((subject) => selectableSubjects([subject]).length > 0 || active.includes(subject.id));
  const hasOptions = options.length > 0;
  const [picking, setPicking] = useState(false);
  const chosen = options.filter((subject) => active.includes(subject.id));
  const summary = !active.length
    ? CALENDAR_PICKER_TEXT.summaryAll
    : chosen.length === 1
      ? CALENDAR_PICKER_TEXT.summaryOne(chosen[0].name)
      : CALENDAR_PICKER_TEXT.summaryMany(active.length, options.length);
  const last = active[active.length - 1];
  // L'ultima pillola accesa resta in vista anche quando la riga scorre (telefono).
  useEffect(() => {
    const row = rowRef.current;
    const pressed = last ? row?.querySelector<HTMLElement>(`[data-subject="${CSS.escape(last)}"]`) : row?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!row || !pressed) return;
    const start = pressed.offsetLeft - row.offsetLeft;
    const end = start + pressed.offsetWidth;
    if (start < row.scrollLeft) row.scrollTo({ left: Math.max(0, start - 12) });
    else if (end > row.scrollLeft + row.clientWidth) row.scrollTo({ left: end - row.clientWidth + 12 });
  }, [last]);
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
        // Tutte le scelte in un pannello: chiaro anche con molte materie, che nella riga scorrono di lato.
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={CALENDAR_PICKER_TEXT.openAria(summary)}
          onClick={() => setPicking(true)}
          className={`${pill(false)} text-[var(--text)]`}
        >
          <Icon name="SlidersHorizontal" className="h-3.5 w-3.5 shrink-0" />
          {CALENDAR_PICKER_TEXT.open}
          {active.length ? (
            <span aria-hidden="true" className="rounded-full bg-[var(--accent)] px-1.5 text-[11px] leading-5 text-[#10131d]">
              {CALENDAR_PICKER_TEXT.countBadge(active.length, options.length)}
            </span>
          ) : null}
        </button>
      ) : null}
      {options.length ? (
        <div
          ref={rowRef}
          role="group"
          aria-label={CALENDAR_TEXT.filterLabel}
          className="scroll-strip flex min-w-0 flex-1 basis-[60%] gap-1.5 overflow-x-auto py-0.5"
        >
          <button
            type="button"
            aria-pressed={!active.length}
            aria-label={active.length ? CALENDAR_TEXT.clearFilters(active.length) : undefined}
            onClick={() => onChange([])}
            className={pill(!active.length)}
          >
            {CALENDAR_TEXT.allSubjects}
          </button>
          {options.map((subject) => {
            const pressed = active.includes(subject.id);
            return (
              <button
                key={subject.id}
                type="button"
                data-subject={subject.id}
                aria-pressed={pressed}
                aria-label={pressed ? CALENDAR_TEXT.clearFilter(subject.name) : CALENDAR_TEXT.addFilter(subject.name)}
                title={pressed ? CALENDAR_TEXT.clearFilter(subject.name) : undefined}
                onClick={() => onChange(toggleSubjectFilter(active, subject.id))}
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
      {picking ? (
        <CalendarViewPicker
          options={options}
          active={active}
          summary={summary}
          onChange={onChange}
          showHolidays={showHolidays}
          onToggleHolidays={onToggleHolidays}
          onClose={() => setPicking(false)}
        />
      ) : null}
    </div>
  );
}

/** Casella spuntata o vuota, solo da vedere (lo stato lo dice aria-pressed del pulsante). */
function CheckMark({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`grid h-5 w-5 shrink-0 place-items-center rounded-[6px] border-2 ${on ? "border-[var(--accent)] bg-[var(--accent)] text-[#10131d]" : "border-[var(--muted)]"}`}
    >
      {on ? <Icon name="Check" className="h-3.5 w-3.5" /> : null}
    </span>
  );
}

/**
 * «Cosa vedere nel calendario»: ogni scelta vale subito (il calendario dietro cambia mentre si tocca).
 * Una materia si accende e si spegne (anche più di una), «Solo» lascia quella e basta, «Tutte le
 * materie» toglie il filtro; sotto, l'interruttore delle festività.
 */
function CalendarViewPicker({
  options,
  active,
  summary,
  onChange,
  showHolidays,
  onToggleHolidays,
  onClose
}: {
  options: Subjects;
  active: readonly string[];
  summary: string;
  onChange: (ids: string[]) => void;
  showHolidays: boolean;
  onToggleHolidays?: () => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const row = "motion-safe flex min-h-11 min-w-0 flex-1 items-center gap-2.5 rounded-[14px] px-2.5 text-left text-sm font-extrabold hover:bg-[var(--surface)]";
  return (
    <Drawer
      open
      onClose={onClose}
      title={CALENDAR_PICKER_TEXT.title}
      width="max-w-[480px]"
      footer={
        <div className="flex justify-end">
          <Button variant="primary" icon="Check" onClick={onClose}>
            {CALENDAR_PICKER_TEXT.done}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5">
        <section aria-labelledby={headingId} className="grid grid-cols-1 gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <h3 id={headingId} className="text-xs font-black uppercase text-[var(--faint)]">
              {CALENDAR_PICKER_TEXT.subjects}
            </h3>
            <p role="status" className="text-xs font-bold text-[var(--muted)]">
              {summary}
            </p>
          </div>
          <p className="text-sm font-bold text-[var(--muted)]">{CALENDAR_PICKER_TEXT.hint}</p>
          <ul className="grid grid-cols-1 gap-0.5">
            <li className="flex">
              <button type="button" data-autofocus aria-pressed={!active.length} onClick={() => onChange([])} className={row}>
                <CheckMark on={!active.length} />
                <span className="one-line-safe min-w-0 flex-1">{CALENDAR_PICKER_TEXT.all}</span>
              </button>
            </li>
            {options.map((subject) => {
              const pressed = active.includes(subject.id);
              const only = pressed && active.length === 1;
              return (
                <li key={subject.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={pressed}
                    aria-label={CALENDAR_PICKER_TEXT.toggleAria(subject.name)}
                    onClick={() => onChange(toggleSubjectFilter(active, subject.id))}
                    className={row}
                  >
                    <CheckMark on={pressed} />
                    <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: safeCssColor(subject.color) || "var(--accent)" }} />
                    <span className="one-line-safe min-w-0 flex-1">{subject.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={only}
                    aria-label={CALENDAR_PICKER_TEXT.onlyAria(subject.name)}
                    onClick={() => onChange([subject.id])}
                    className={`motion-safe min-h-11 shrink-0 rounded-full px-3.5 text-xs font-black ${
                      only ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-strong)] text-[var(--text)] hover:bg-[var(--surface)]"
                    }`}
                  >
                    {CALENDAR_PICKER_TEXT.only}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
        {onToggleHolidays ? (
          <button
            type="button"
            role="switch"
            aria-checked={showHolidays}
            onClick={onToggleHolidays}
            className="motion-safe flex min-h-14 w-full items-center gap-3 rounded-[16px] bg-[var(--surface-soft)] p-3 text-left hover:bg-[var(--surface)]"
          >
            <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-[12px] bg-[var(--surface-strong)] text-[var(--accent-ink)]">
              <Icon name="PartyPopper" className="h-4.5 w-4.5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-black">{CALENDAR_PICKER_TEXT.holidays}</span>
              <span className="block text-xs font-bold text-[var(--muted)]">{CALENDAR_PICKER_TEXT.holidaysHint}</span>
            </span>
            <span aria-hidden="true" className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${showHolidays ? "bg-[var(--accent)]" : "bg-[var(--surface-strong)]"}`}>
              <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${showHolidays ? "translate-x-6" : "translate-x-1"}`} />
            </span>
          </button>
        ) : null}
      </div>
    </Drawer>
  );
}
