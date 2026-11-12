import { format } from "date-fns";
import { it } from "date-fns/locale";
import type { CalendarEvent, Subject } from "../types";
import { CALENDAR_EXAMS_TEXT } from "../lib/labels";
import { EXAMS_NEW_KEY, calendarExamRef, examPrefillFromEvent } from "../lib/calendarExams";
import { goToView } from "../hooks/useLinkedUiState";
import { Icon } from "./Icon";

/**
 * Home e Statistiche, elenco degli esami vuoto: gli esami segnati solo nel calendario (eventi «Esame»)
 * si propongono con una riga. Il pulsante apre «Aggiungi esame» in Esami già compilato (chiave
 * `exams.new`: solo id e inizio dell'occorrenza) con il più vicino; niente si salva finché non si
 * preme Salva nel modulo.
 */
export function CalendarExamsHint({ items, subjects }: { items: ReadonlyArray<CalendarEvent>; subjects: ReadonlyArray<Subject> }) {
  const first = items[0];
  if (!first) return null;
  const prefill = examPrefillFromEvent(first, subjects);
  const when = new Date(prefill.date);
  const day = Number.isNaN(when.getTime()) ? "" : format(when, "d MMM", { locale: it });
  return (
    <div className="grid grid-cols-1 gap-1 text-sm text-[var(--muted)]">
      <p className="safe-text">{CALENDAR_EXAMS_TEXT.line(items.length)}</p>
      <button
        type="button"
        onClick={() => goToView("exams", [[EXAMS_NEW_KEY, calendarExamRef(first), "tab"]])}
        aria-label={CALENDAR_EXAMS_TEXT.addAria(prefill.title, day)}
        className="relative inline-flex min-h-8 max-w-full items-center gap-1 justify-self-start text-left text-xs font-black text-[var(--accent-ink)] underline-offset-2 after:absolute after:-inset-y-1.5 after:inset-x-0 after:content-[''] hover:underline"
      >
        <Icon name="CalendarPlus" className="h-3.5 w-3.5 shrink-0" />
        <span className="two-line-safe">{CALENDAR_EXAMS_TEXT.add(prefill.title, day)}</span>
      </button>
    </div>
  );
}
