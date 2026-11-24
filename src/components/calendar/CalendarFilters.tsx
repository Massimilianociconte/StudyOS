// Filtri sopra il calendario: «Materie» (un pulsante che dice cosa si vede e apre il pannello con
// tutte le materie: una, più d'una o tutte), le festività accese o spente e, in ogni vista, le
// Attività senza data.
import { startTransition, useId, useState } from "react";
import { Icon } from "../Icon";
import { Button, Drawer } from "../ui";
import { CALENDAR_PICKER_TEXT, CALENDAR_VIEW_TEXT, HOLIDAYS_TOGGLE_LABEL } from "../../lib/labels/calendar";
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

const dotColor = (color: string | undefined) => safeCssColor(color) || "var(--accent)";

/**
 * «Materie · Tutte» / «Materie ● Fisiologia» / «Materie ●●● 3 materie»: il pulsante dice sempre cosa si
 * vede e, con un filtro, cambia colore. Il pannello si apre al tocco. Dopo: «Festività» (solo con
 * `onToggleHolidays`) e «Senza data · N».
 */
export function CalendarFilterRow({
  subjects,
  active,
  onChange,
  showHolidays,
  onToggleHolidays,
  undatedCount = 0,
  onOpenUndated,
  className = ""
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
  className?: string;
}) {
  // Le materie superate escono dall'elenco, ma una già scelta (es. dal riepilogo «Per materia») resta.
  const options = subjects.filter((subject) => selectableSubjects([subject]).length > 0 || active.includes(subject.id));
  const [picking, setPicking] = useState(false);
  const chosen = options.filter((subject) => active.includes(subject.id));
  const filtered = chosen.length > 0;
  const summary = !filtered
    ? CALENDAR_PICKER_TEXT.summaryAll
    : chosen.length === 1
      ? CALENDAR_PICKER_TEXT.summaryOne(chosen[0].name)
      : CALENDAR_PICKER_TEXT.summaryMany(chosen.length, options.length);
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1.5 empty:hidden ${className}`}>
      {options.length ? (
        <button
          type="button"
          aria-haspopup="dialog"
          aria-label={CALENDAR_PICKER_TEXT.openAria(summary)}
          onClick={() => setPicking(true)}
          className={`motion-safe inline-flex min-h-11 min-w-0 max-w-full items-center gap-2 rounded-full border px-3.5 text-xs font-extrabold ${
            filtered
              ? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--text)] hover:bg-[color-mix(in_srgb,var(--accent)_24%,transparent)]"
              : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--text)] hover:bg-[var(--surface)]"
          }`}
        >
          <Icon name="SlidersHorizontal" className={`h-3.5 w-3.5 shrink-0 ${filtered ? "text-[var(--accent-ink)]" : "text-[var(--muted)]"}`} />
          <span className="shrink-0">{CALENDAR_PICKER_TEXT.button}</span>
          {filtered ? (
            <>
              <span aria-hidden="true" className="flex shrink-0 -space-x-1">
                {chosen.slice(0, 3).map((subject) => (
                  <span key={subject.id} className="h-2.5 w-2.5 rounded-full ring-2 ring-[var(--surface)]" style={{ background: dotColor(subject.color) }} />
                ))}
              </span>
              <span className="min-w-0 max-w-[11rem] truncate text-[var(--accent-ink)]">
                {chosen.length === 1 ? chosen[0].name : CALENDAR_PICKER_TEXT.countShort(chosen.length)}
              </span>
            </>
          ) : (
            <span className="text-[var(--muted)]">{CALENDAR_PICKER_TEXT.allShort}</span>
          )}
          <Icon name="ChevronDown" className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
        </button>
      ) : null}
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
      {picking ? (
        <CalendarViewPicker
          options={options}
          active={active}
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
 * «Cosa vedere nel calendario»: ogni scelta vale subito. Una materia si accende e si spegne (anche più
 * di una), «Solo» lascia quella e basta, «Tutte le materie» toglie il filtro; sotto, l'interruttore
 * delle festività. Niente si sposta mentre si sceglie: in alto solo un conteggio corto su una riga (un
 * nome lungo andava a capo e spingeva giù l'elenco), e la casella cambia subito (stato del pannello)
 * mentre il calendario dietro si aggiorna subito dopo (startTransition).
 */
function CalendarViewPicker({
  options,
  active,
  onChange,
  showHolidays,
  onToggleHolidays,
  onClose
}: {
  options: Subjects;
  active: readonly string[];
  onChange: (ids: string[]) => void;
  showHolidays: boolean;
  onToggleHolidays?: () => void;
  onClose: () => void;
}) {
  const headingId = useId();
  // Scelta del pannello, presa all'apertura: è lei a dire subito cosa è spuntato.
  const [picked, setPicked] = useState<readonly string[]>(active);
  const choose = (next: string[]) => {
    setPicked(next);
    startTransition(() => onChange(next));
  };
  const count = options.filter((subject) => picked.includes(subject.id)).length;
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
          <div className="flex min-h-6 items-center justify-between gap-3">
            <h3 id={headingId} className="text-xs font-black uppercase text-[var(--faint)]">
              {CALENDAR_PICKER_TEXT.subjects}
            </h3>
            <p role="status" className="shrink-0 whitespace-nowrap text-xs font-bold tabular-nums text-[var(--muted)]">
              {count ? CALENDAR_PICKER_TEXT.countOf(count, options.length) : CALENDAR_PICKER_TEXT.summaryAll}
            </p>
          </div>
          <p className="text-sm font-bold text-[var(--muted)]">{CALENDAR_PICKER_TEXT.hint}</p>
          <ul className="grid grid-cols-1 gap-0.5">
            <li className="flex">
              <button type="button" data-autofocus aria-pressed={!count} onClick={() => choose([])} className={row}>
                <CheckMark on={!count} />
                <span className="one-line-safe min-w-0 flex-1">{CALENDAR_PICKER_TEXT.all}</span>
              </button>
            </li>
            {options.map((subject) => {
              const pressed = picked.includes(subject.id);
              const only = pressed && count === 1;
              return (
                <li key={subject.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-pressed={pressed}
                    aria-label={CALENDAR_PICKER_TEXT.toggleAria(subject.name)}
                    title={subject.name}
                    onClick={() => choose(toggleSubjectFilter(picked, subject.id))}
                    className={row}
                  >
                    <CheckMark on={pressed} />
                    <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: dotColor(subject.color) }} />
                    <span className="one-line-safe min-w-0 flex-1">{subject.name}</span>
                  </button>
                  <button
                    type="button"
                    aria-pressed={only}
                    aria-label={CALENDAR_PICKER_TEXT.onlyAria(subject.name)}
                    onClick={() => choose([subject.id])}
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
