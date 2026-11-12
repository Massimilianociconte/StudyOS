// Esami segnati solo nel calendario (eventi di tipo «Esame», anche gli appelli importati): Home e
// Statistiche li propongono quando l'elenco degli esami è vuoto, e il modulo «Aggiungi esame» si apre
// già compilato con la chiave `exams.new` (schema `writeUiState` + `setActiveView`). Puro, testato.
import type { CalendarEvent, Subject } from "../types";
import { daySpanOf } from "./calendarRender";
import { todayYmd } from "./datePicker";
import { expandEvents, type EventOccurrence } from "./recurrence";

/** Chiave condivisa (ambito scheda): esame da proporre nel modulo «Aggiungi esame», o null. Esami la legge e la cancella. */
export const EXAMS_NEW_KEY = "exams.new";

/** Dati di partenza del modulo: materia ("" = da scegliere), giorno e ora, titolo dell'evento. */
export interface ExamPrefill {
  subjectId: string;
  date: string;
  title: string;
}

/** Giorni dopo oggi in cui un esame del calendario conta ancora come «in arrivo». */
export const CALENDAR_EXAM_DAYS = 60;

export const isNullableExamPrefill = (value: unknown): value is ExamPrefill | null => {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.subjectId === "string" &&
    typeof item.title === "string" &&
    item.title.length <= 500 &&
    typeof item.date === "string" &&
    !Number.isNaN(new Date(item.date).getTime())
  );
};

/** Eventi «Esame» (occorrenze) da oggi ai prossimi 60 giorni, dal più vicino. Il giorno è quello della barra. */
export const calendarExamEvents = <T extends CalendarEvent>(events: readonly T[], now: Date, days = CALENDAR_EXAM_DAYS): (T & EventOccurrence)[] => {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const until = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days + 1);
  const first = todayYmd(today);
  const last = todayYmd(new Date(today.getFullYear(), today.getMonth(), today.getDate() + days));
  return expandEvents(
    events.filter((event) => !event.archived),
    today,
    until
  )
    .filter((item) => {
      if (item.category !== "exam") return false;
      const day = daySpanOf(item)?.startDay ?? "";
      return day >= first && day <= last;
    })
    .sort((a, b) => (daySpanOf(a)?.startDay ?? "").localeCompare(daySpanOf(b)?.startDay ?? "") || a.start.localeCompare(b.start));
};

/**
 * Modulo dell'esame dall'evento: la materia dell'evento se esiste ancora, altrimenti quella (non
 * archiviata) il cui nome compare nel titolo, il più lungo; giorno e ora dell'evento (tutto il giorno:
 * alle 9 di quel giorno, in ora locale).
 */
export const examPrefillFromEvent = (
  event: Pick<CalendarEvent, "title" | "start" | "end" | "allDay" | "subjectId">,
  subjects: ReadonlyArray<Pick<Subject, "id" | "name" | "archived" | "status">>
): ExamPrefill => {
  const own = event.subjectId ? subjects.find((subject) => subject.id === event.subjectId) : undefined;
  const title = event.title.trim();
  const lower = title.toLocaleLowerCase("it");
  const byName = own
    ? undefined
    : subjects
        .filter((subject) => !subject.archived && subject.status !== "archived" && subject.name.trim() && lower.includes(subject.name.trim().toLocaleLowerCase("it")))
        .sort((a, b) => b.name.trim().length - a.name.trim().length)[0];
  const day = event.allDay === true ? daySpanOf(event)?.startDay : undefined;
  return { subjectId: (own ?? byName)?.id ?? "", date: day ? `${day}T09:00` : event.start, title };
};
