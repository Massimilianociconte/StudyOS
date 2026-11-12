// "Apri l'elemento" da un'altra parte dell'app (risultato della ricerca, elemento collegato a una nota):
// la sezione da aprire e le chiavi di `uiState` che la sezione legge per aprire proprio quell'elemento.
// Logica pura (niente DOM, testata con node --test); chi la usa scrive le chiavi e cambia sezione.
import type { AppView, Attachment, CalendarEvent, Exam, Goal, StudySession, StudyTopic, Subject, Task } from "../types";
import type { UiScope } from "./uiState";
import { allDayFirstDate, isOccurrenceRow } from "./repeat";
import { LINKED_KIND_LABEL } from "./labels/notes";

export type UiWrite = readonly [key: string, value: unknown, scope: UiScope];
export interface OpenPlan {
  view: AppView;
  writes: UiWrite[];
}

type EventFields = Pick<CalendarEvent, "id" | "title" | "start" | "end" | "allDay" | "timeZone" | "seriesId" | "originalDate" | "occasion" | "category">;

export interface OpenItemData {
  tasks: readonly Pick<Task, "id" | "title">[];
  events: readonly EventFields[];
  subjects: readonly Pick<Subject, "id" | "name">[];
  exams: readonly Pick<Exam, "id" | "subjectId">[];
  attachments: readonly Pick<Attachment, "id" | "name">[];
  sessions: readonly Pick<StudySession, "id" | "title">[];
  topics: readonly Pick<StudyTopic, "id" | "title" | "subjectId">[];
  goals: readonly Pick<Goal, "id" | "title">[];
}

/** Tipo di risultato della ricerca globale → tipo di elemento. */
const SEARCH_KIND_ENTITY = {
  task: "task",
  event: "calendarEvent",
  subject: "subject",
  exam: "exam",
  material: "attachment",
  session: "studySession",
  topic: "studyTopic",
  goal: "goal",
  note: "note"
} as const;

export type SearchKind = keyof typeof SEARCH_KIND_ENTITY;

export const searchKindEntity = (kind: SearchKind) => SEARCH_KIND_ENTITY[kind];

const byId = <T extends { id: string }>(items: readonly T[], id: string) => items.find((item) => item.id === id);

/** Ricorrenze (compleanni…) e vacanze hanno un modulo semplice che vale per tutta la serie (come editorFormFor). */
const simpleForm = (event: Pick<CalendarEvent, "occasion" | "category">) => Boolean(event.occasion) || (event.category as string) === "vacation";

const isCivilDay = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Evento: il calendario va al suo giorno (quello che la ricerca mostra) e lo apre come farebbe un
 * tocco sul calendario. Un giorno di una serie cambiato da solo si apre come quel giorno; ricorrenze
 * e vacanze per tutta la serie, nel loro modulo.
 */
const eventPlan = (event: EventFields, events: readonly EventFields[]): OpenPlan => {
  const day = event.allDay === true ? allDayFirstDate(event).toISOString() : event.start;
  let openId = event.id;
  let date: string | null = null;
  if (isOccurrenceRow(event)) {
    const series = byId(events, event.seriesId as string);
    if (series && simpleForm(series)) openId = series.id;
    else if (isCivilDay(event.originalDate)) date = event.originalDate;
  }
  const writes: UiWrite[] = [];
  if (!Number.isNaN(Date.parse(day))) writes.push(["calendar.cursor", day, "tab"]);
  writes.push(["calendar.editingEvent", openId, "tab"], ["calendar.editingDate", date, "tab"]);
  return { view: "calendar", writes };
};

/**
 * Dove porta un elemento: null se non c'è (più), se l'id è di un altro tipo o se il tipo non ha una
 * sezione (le note si aprono sul posto). Chiavi e valori sono quelli che le sezioni leggono.
 */
export function openItemPlan(type: string | undefined, id: string | undefined, data: OpenItemData): OpenPlan | null {
  if (!type || !id) return null;
  switch (type) {
    case "task":
      return byId(data.tasks, id) ? { view: "tasks", writes: [["tasks.editing", id, "tab"]] } : null;
    case "calendarEvent": {
      const event = byId(data.events, id);
      return event ? eventPlan(event, data.events) : null;
    }
    case "subject":
      return byId(data.subjects, id) ? { view: "subjects", writes: [["subjects.open", id, "tab"]] } : null;
    case "exam":
      return byId(data.exams, id) ? { view: "exams", writes: [["exams.editing", id, "tab"]] } : null;
    case "goal":
      return byId(data.goals, id) ? { view: "goals", writes: [["goals.open", id, "tab"]] } : null;
    case "attachment": {
      // Materiali: nessun dettaglio da aprire per id; si ritrova per nome, senza filtri che lo nascondano.
      const attachment = byId(data.attachments, id);
      return attachment
        ? {
            view: "materials",
            writes: [
              ["materials.query", attachment.name, "tab"],
              ["materials.kind", "all", "device"],
              ["materials.subject", "", "device"]
            ]
          }
        : null;
    }
    case "studyTopic": {
      const topic = byId(data.topics, id);
      return topic
        ? {
            view: "study",
            writes: [
              ["study.topicsFilter", topic.subjectId, "tab"],
              ["study.topicsOpen", true, "tab"]
            ]
          }
        : null;
    }
    case "studySession":
      // Studio non ha ancora una chiave per aprire una sessione: si arriva alla sezione.
      return byId(data.sessions, id) ? { view: "study", writes: [] } : null;
    default:
      return null;
  }
}

/** Elemento a cui una nota è collegata: tipo e nome da mostrare, o null se non c'è (più). */
export function linkedItem(type: string | undefined, id: string | undefined, data: OpenItemData): { kind: string; title: string } | null {
  if (!type || !id || !Object.hasOwn(LINKED_KIND_LABEL, type)) return null;
  const kind = LINKED_KIND_LABEL[type];
  const title = (() => {
    switch (type) {
      case "task":
        return byId(data.tasks, id)?.title;
      case "calendarEvent":
        return byId(data.events, id)?.title;
      case "subject":
        return byId(data.subjects, id)?.name;
      case "exam": {
        const exam = byId(data.exams, id);
        return exam ? (byId(data.subjects, exam.subjectId)?.name ?? kind) : undefined;
      }
      case "attachment":
        return byId(data.attachments, id)?.name;
      case "studySession":
        return byId(data.sessions, id)?.title;
      case "studyTopic":
        return byId(data.topics, id)?.title;
      case "goal":
        return byId(data.goals, id)?.title;
      default:
        return undefined;
    }
  })();
  return title === undefined ? null : { kind, title: title || kind };
}
