// Barre della fascia "tutto il giorno": eventi di tutto il giorno o su più giorni, continue da un giorno
// all'altro (Settimana, Mese) oppure come striscia del giorno con "giorno 2 di 3" (vista Giorno).
import { useCallback, useMemo, type CSSProperties, type DragEvent as ReactDragEvent } from "react";
import { Icon } from "../Icon";
import { SharedMark } from "../SharedMark";
import { selectPreferences, useStudyStore } from "../../store/useStudyStore";
import type { Holiday } from "../../lib/holidays";
import { CALENDAR_VIEW_TEXT, HOLIDAY_KIND_LABEL } from "../../lib/labels";
import { barSource, eventPaint, holidayPaint, occasionText, spanText, type EventPaint } from "../../lib/calendarRender";
import type { DayRangeItem } from "../../lib/calendarLayout";
import { formatDateField, todayYmd } from "../../lib/datePicker";
import { sanitizeTypeColorOverrides, themeTone, type EventTheme } from "../../lib/eventColors";
import { subjectColor } from "../../lib/selectors";
import { allDayEventLabel, canDrag, editOccurrence, pointerPoint, sharedOutline, sharedOutlineClass } from "./shared";
import type { CalendarOccurrence, Handlers, ShownEvent, Subjects } from "./types";

/**
 * Colore, tipologia, icona e stile leggibile (tema chiaro o scuro) di un evento, con i colori per
 * tipologia scelti dall'utente. `preferences.eventTypeColors` si legge senza fidarsi: arriva con il
 * nuovo modulo evento. Eventi altrui: il colore della materia del proprietario, mai di una delle mie.
 */
export function useEventPaint(): (event: ShownEvent, subjects: Subjects) => EventPaint {
  const theme = useEventTheme();
  const stored = useStudyStore((state) => (selectPreferences(state) as { eventTypeColors?: unknown }).eventTypeColors);
  const overrides = useMemo(() => sanitizeTypeColorOverrides(stored), [stored]);
  return useCallback(
    (event: ShownEvent, subjects: Subjects) =>
      eventPaint(event, {
        subjectColor: event.sharedFrom ? event.sharedFrom.subjectColor : event.subjectId ? subjectColor(subjects, event.subjectId, "") : undefined,
        overrides,
        theme
      }),
    [overrides, theme]
  );
}

/** Icona piccola della tipologia (Lezione, Esame, Compleanno…): accanto al titolo, non letta. */
export const TypeIcon = ({ paint, className = "h-3 w-3" }: { paint: EventPaint; className?: string }) => (
  <Icon name={paint.icon} className={`${className} shrink-0`} />
);

/**
 * Elenchi vuoti (Agenda, Settimana sul telefono): le festività non contano come impegni, quindi resta lo
 * stato vuoto e sotto, in una riga, le festività del periodo.
 */
export function HolidaysNote({ holidays }: { holidays: readonly Holiday[] }) {
  if (!holidays.length) return null;
  const today = todayYmd();
  return (
    <p className="mt-3 text-xs font-bold text-[var(--muted)]">
      {CALENDAR_VIEW_TEXT.holidaysOfPeriod} {holidays.map((holiday) => `${holiday.name} (${formatDateField(holiday.date, today)})`).join(", ")}
    </p>
  );
}

/** Tema chiaro o scuro, per i colori leggibili delle voci del calendario. */
export const useEventTheme = (): EventTheme => themeTone(useStudyStore((state) => state.settings.themeMode));

/**
 * Festività come voce grigia della fascia in alto: solo testo con una piccola icona (non si apre, non si
 * sposta); le feste nazionali con fondo e bordo, un po' più marcate di ricorrenze e cambi dell'ora.
 */
export function HolidayChip({
  holiday,
  theme,
  style,
  className = ""
}: {
  holiday: Holiday;
  theme: EventTheme;
  style?: CSSProperties;
  className?: string;
}) {
  const paint = holidayPaint(holiday.kind, theme);
  return (
    <div
      className={`flex min-h-6 min-w-0 items-center gap-1 rounded-[8px] px-1.5 py-0.5 text-[11px] leading-tight ${paint.strong ? "border font-black" : "font-bold"} ${className}`}
      style={{ background: paint.background, borderColor: paint.border, color: paint.text, ...style }}
      title={`${HOLIDAY_KIND_LABEL[holiday.kind]} · ${holiday.name}`}
    >
      <Icon name={holiday.icon} className="h-3 w-3 shrink-0" />
      <span className="min-w-0 truncate">{holiday.name}</span>
    </div>
  );
}

/** Barra di un evento: giorni (ultimo compreso) e occorrenza; `id` = chiave dell'occorrenza. */
export type CalendarBar = DayRangeItem & { item: CalendarOccurrence };

/** Le occorrenze che vanno nella fascia in alto come barre, nell'ordine ricevuto. */
export const eventBars = (occurrences: readonly CalendarOccurrence[]): CalendarBar[] =>
  occurrences.flatMap((item) => {
    const source = barSource(item);
    return source ? [{ ...source, item }] : [];
  });

/**
 * Una barra (o il suo pezzo in una riga-settimana): angoli arrotondati solo dove l'evento comincia o
 * finisce davvero; toccarla in qualunque punto apre lo stesso evento.
 */
export function EventBar({
  item,
  handlers,
  roundStart = true,
  roundEnd = true,
  detail,
  style,
  className = "",
  onDragStart
}: {
  item: CalendarOccurrence;
  handlers: Handlers;
  roundStart?: boolean;
  roundEnd?: boolean;
  /** Testo attenuato dopo il titolo (es. "giorno 2 di 3"). */
  detail?: string;
  style?: CSSProperties;
  className?: string;
  /** Solo dove la barra si può trascinare su un altro giorno (Mese). */
  onDragStart?: (event: ReactDragEvent<HTMLButtonElement>) => void;
}) {
  const paint = useEventPaint()(item, handlers.subjects);
  const draggable = Boolean(onDragStart) && canDrag(item);
  // Ricorrenze: gli anni compiuti, se non c'è già "giorno 2 di 3".
  const extra = detail ?? (occasionText(item) || undefined);
  return (
    <button
      type="button"
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable || !onDragStart) {
          event.preventDefault();
          return;
        }
        onDragStart(event);
        handlers.onPreviewHide();
      }}
      onClick={(event) => {
        event.stopPropagation();
        editOccurrence(handlers, item);
      }}
      onMouseEnter={(event) => handlers.onPreviewEvent(item, pointerPoint(event))}
      onMouseMove={(event) => handlers.onPreviewMove(pointerPoint(event))}
      onMouseLeave={handlers.onPreviewHide}
      className={`flex min-h-6 w-full min-w-0 items-center gap-1 px-1.5 py-0.5 text-left text-[11px] font-black leading-tight hover:brightness-110 ${
        roundStart ? "rounded-l-[8px]" : ""
      } ${roundEnd ? "rounded-r-[8px]" : ""} ${item.status === "done" ? "opacity-75" : ""} ${sharedOutlineClass(item)} ${className}`}
      style={{ background: paint.style.background, color: paint.style.text, boxShadow: `inset 3px 0 0 ${roundStart ? paint.style.border : "transparent"}`, ...sharedOutline(item), ...style }}
      title={`${item.title} · ${spanText(item) ?? allDayEventLabel(item)}`}
    >
      <TypeIcon paint={paint} />
      {item.sharedFrom ? <SharedMark origin={item.sharedFrom} compact /> : null}
      {/* Il testo in più segue il titolo nella stessa riga: se manca spazio si taglia lui, non il titolo. */}
      <span className="min-w-0 truncate">
        {item.recurring ? (
          <span role="img" aria-label={CALENDAR_VIEW_TEXT.recurring}>
            ↻{" "}
          </span>
        ) : null}
        {item.title}
        {extra ? <span className="font-bold opacity-80"> · {extra}</span> : null}
      </span>
    </button>
  );
}
