// Tipi condivisi dalle viste del calendario (griglie, Mese, Agenda, elenco del telefono, anteprima).
import type { CalendarEvent, Subject, Task } from "../../types";
import type { EventOccurrence } from "../../lib/recurrence";
import type { SharedOrigin } from "../../lib/sharing";

export type Subjects = Subject[];

/** Occorrenza del calendario: propria, oppure di un'altra persona (`sharedFrom`). */
export type CalendarOccurrence = EventOccurrence & { sharedFrom?: SharedOrigin };
export type SharedCalendarEvent = CalendarEvent & { sharedFrom: SharedOrigin };
/** Evento mostrato (chip, anteprima, editor): proprio o di un'altra persona. */
export type ShownEvent = CalendarEvent & { sharedFrom?: SharedOrigin };

export type PreviewPoint = { x: number; y: number };
export type CalendarPreviewState =
  | { kind: "event"; event: ShownEvent; x: number; y: number }
  | { kind: "task"; task: Task; x: number; y: number };

/**
 * Quale occorrenza di una serie si è toccata: il giorno (`occurrenceDate`, nel fuso della serie) e, per
 * una riga modificata (id `serie@giorno`), l'id della serie.
 */
export type OccurrenceRef = { occurrenceDate?: string; seriesId?: string };

export interface Handlers {
  subjects: Subjects;
  /** `occurrence`: l'occorrenza toccata, se l'evento si ripete (chi apre l'editor sceglie cosa farne). */
  onEditEvent: (id: string, ownerId?: string, occurrence?: OccurrenceRef) => void;
  onEditTask: (id: string) => void;
  onToggleTask: (id: string) => void;
  onCreate: (at: Date, kind?: "event" | "task") => void;
  /** Apre l'esame nella sezione Esami. */
  onOpenExam: (id: string) => void;
  onMoveEvent: (occurrence: CalendarOccurrence, nextStart: Date) => void;
  onPreviewEvent: (event: ShownEvent, point: PreviewPoint) => void;
  onPreviewTask: (task: Task, point: PreviewPoint) => void;
  onPreviewMove: (point: PreviewPoint) => void;
  onPreviewHide: () => void;
}
