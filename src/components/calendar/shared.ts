// Piccoli aiuti comuni alle viste del calendario: chi si può trascinare, materia mostrata, bordo
// tratteggiato degli eventi altrui, punto del mouse per l'anteprima, orario proposto per un nuovo evento.
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { isSameDay, setHours, startOfDay } from "date-fns";
import type { CalendarEvent } from "../../types";
import { safeCssColor } from "../../lib/sharing";
import { subjectColor, subjectName } from "../../lib/selectors";
import { ALL_DAY_LABEL } from "../../lib/labels";
import type { CalendarOccurrence, Handlers, PreviewPoint, ShownEvent, Subjects } from "./types";

/** Si trascina solo ciò che si può modificare: gli eventi altrui in sola lettura non sono trascinabili. */
export const canDrag = (item: CalendarOccurrence) => !item.sharedFrom || item.sharedFrom.canEdit;

/** Apre l'evento toccato dicendo quale occorrenza è (giorno e serie), per chi sceglie cosa modificare. */
export const editOccurrence = (handlers: Handlers, item: CalendarOccurrence) =>
  handlers.onEditEvent(item.id, item.sharedFrom?.ownerId, { occurrenceDate: item.occurrenceDate, seriesId: item.seriesId });

/** Materia da mostrare ("" = nessuna): per gli eventi di altri quella del proprietario, mai una delle mie. */
export const occurrenceSubject = (item: ShownEvent, subjects: Subjects) =>
  item.sharedFrom ? item.sharedFrom.subjectName ?? "" : item.subjectId ? subjectName(subjects, item.subjectId) : "";

/**
 * Bordo tratteggiato nel colore della persona (outline: non tocca il bordo colorato a sinistra).
 * Classe e variabile, non stile in linea: così il contorno del focus da tastiera resta visibile.
 */
const SHARED_OUTLINE = "outline-dashed outline-1 -outline-offset-1 outline-[color:var(--owner-color)]";
export const sharedOutlineClass = (item: ShownEvent) => (item.sharedFrom ? SHARED_OUTLINE : "");
export const sharedOutline = (item: ShownEvent): CSSProperties =>
  item.sharedFrom ? ({ "--owner-color": item.sharedFrom.color } as CSSProperties) : {};

export const pointerPoint = (event: ReactMouseEvent<HTMLElement>): PreviewPoint => ({ x: event.clientX, y: event.clientY });

/** Prossima mezz'ora utile (o le 9:00 per un giorno senza orario). */
export const defaultStartFor = (day: Date) => {
  if (day.getHours() || day.getMinutes()) {
    const selected = new Date(day);
    selected.setSeconds(0, 0);
    return selected;
  }
  if (isSameDay(day, new Date())) {
    const next = new Date();
    next.setSeconds(0, 0);
    next.setMinutes(next.getMinutes() < 30 ? 30 : 60);
    return next;
  }
  return setHours(startOfDay(day), 9);
};

// Solo colori esadecimali, anche per i miei eventi: chi li modifica con "Può modificare" non deve poter
// mettere nello stile un url() da scaricare. Evento di altri senza colore valido: quello della sua
// materia (dal proprietario), poi quello della persona; mai di una delle mie materie.
export const eventColor = (event: ShownEvent, subjects: Subjects) =>
  safeCssColor(event.color) ||
  (event.sharedFrom ? event.sharedFrom.subjectColor || event.sharedFrom.color : subjectColor(subjects, event.subjectId));

export const allDayEventLabel = (event: CalendarEvent) => (event.tags?.includes("appello-importato") ? "Data appello" : ALL_DAY_LABEL);
