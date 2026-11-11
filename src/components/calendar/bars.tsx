// Barre della fascia "tutto il giorno": eventi di tutto il giorno o su più giorni, continue da un giorno
// all'altro (Settimana, Mese) oppure come striscia del giorno con "giorno 2 di 3" (vista Giorno).
import type { CSSProperties, DragEvent as ReactDragEvent } from "react";
import { SharedMark } from "../SharedMark";
import { CALENDAR_VIEW_TEXT } from "../../lib/labels";
import { barSource, spanText } from "../../lib/calendarRender";
import type { DayRangeItem } from "../../lib/calendarLayout";
import { allDayEventLabel, canDrag, editOccurrence, eventColor, pointerPoint, sharedOutline, sharedOutlineClass } from "./shared";
import type { CalendarOccurrence, Handlers } from "./types";

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
  const color = eventColor(item, handlers.subjects);
  const draggable = Boolean(onDragStart) && canDrag(item);
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
      } ${roundEnd ? "rounded-r-[8px]" : ""} ${item.status === "done" ? "opacity-60" : ""} ${sharedOutlineClass(item)} ${className}`}
      style={{ background: `color-mix(in srgb, ${color} 26%, var(--bg-2))`, ...sharedOutline(item), ...style }}
      title={`${item.title} · ${spanText(item) ?? allDayEventLabel(item)}`}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      {item.sharedFrom ? <SharedMark origin={item.sharedFrom} compact /> : null}
      <span className="min-w-0 truncate">
        {item.recurring ? (
          <span role="img" aria-label={CALENDAR_VIEW_TEXT.recurring}>
            ↻{" "}
          </span>
        ) : null}
        {item.title}
      </span>
      {detail ? <span className="ml-auto shrink-0 pl-1 font-bold text-[var(--muted)]">{detail}</span> : null}
    </button>
  );
}
