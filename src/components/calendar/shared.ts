// Piccoli aiuti comuni alle viste del calendario: chi si può trascinare, materia mostrata, bordo
// tratteggiato degli eventi altrui, punto del mouse per l'anteprima, orario proposto per un nuovo evento.
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import type { CalendarEvent } from "../../types";
import { subjectName } from "../../lib/selectors";
import { ALL_DAY_LABEL } from "../../lib/labels";
import { CALENDAR_VIEW_TEXT } from "../../lib/labels/calendar";
import { proposedStart } from "../../lib/eventEditor";
import type { CalendarOccurrence, Handlers, PreviewPoint, ShownEvent, Subjects } from "./types";

/** Si trascina solo ciò che si può modificare: gli eventi altrui in sola lettura non sono trascinabili. */
export const canDrag = (item: CalendarOccurrence) => !item.groupExam && (!item.sharedFrom || item.sharedFrom.canEdit);

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

/** Prossima mezz'ora utile oggi, l'ora toccata, o le 9:00 per un altro giorno (vedi `proposedStart`). */
export const defaultStartFor = (day: Date) => proposedStart(day);

export const allDayEventLabel = (event: CalendarEvent) => (event.tags?.includes("appello-importato") ? CALENDAR_VIEW_TEXT.examDate : ALL_DAY_LABEL);

// Spostato in hooks/ (lo usano anche le Impostazioni): qui resta per chi lo importa dal calendario.
export { useMediaQuery } from "../../hooks/useMediaQuery";

/** Telefono: sotto 640 px c'è il pulsante "+" fisso in basso a destra (AppShell). */
export const PHONE_QUERY = "(max-width: 639px)";
/** Sotto 768 px: l'intestazione del calendario si fa più semplice (vedi CalendarView). */
export const NARROW_QUERY = "(max-width: 767px)";
/** Schermo touch: il "+N" della griglia oraria è largo un dito (44 px), con il mouse 28 (vedi OVERLAP_SIZES). */
export const COARSE_QUERY = "(pointer: coarse)";
/** Spazio libero (px) a destra della griglia oraria sul telefono: lì passa il pulsante "+" fisso. */
export const PHONE_FAB_GUTTER_PX = 56;
