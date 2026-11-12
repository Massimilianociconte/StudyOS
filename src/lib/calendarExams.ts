// Esami segnati solo nel calendario (eventi di tipo «Esame», anche gli appelli importati): Home e
// Statistiche li propongono quando l'elenco degli esami è vuoto, e il modulo «Aggiungi esame» si apre
// già compilato con la chiave `exams.new` (schema `writeUiState` + `setActiveView`). Salvando, l'esame
// può prendere il posto dell'evento: si toglie quella sola occorrenza, con Annulla. Testato.
import type { Attachment, CalendarEvent, Note, Subject } from "../types";
import type { RestoreVersion } from "./sharing";
import { ENTITY_TYPES } from "./collections";
import { daySpanOf } from "./calendarRender";
import { todayYmd } from "./datePicker";
import { occurrenceTarget } from "./occurrenceLookup";
import { expandEvents, type EventOccurrence } from "./recurrence";
import { isOccurrenceRow } from "./repeat";

/** Chiave condivisa (ambito scheda): evento da cui aggiungere l'esame, o null. Esami la legge e la cancella. */
export const EXAMS_NEW_KEY = "exams.new";

/**
 * Valore di `exams.new`: solo navigazione (GOTCHAS: lo stato UI non porta contenuti). Id e inizio
 * dell'occorrenza; titolo, giorno e materia il modulo li legge dal negozio.
 */
export interface CalendarExamRef {
  eventId: string;
  occurrenceStart: string;
}

/** Dati di partenza del modulo, letti dall'evento: materia ("" = da scegliere), giorno e ora, titolo. */
export interface ExamPrefill {
  subjectId: string;
  date: string;
  title: string;
}

/** Giorni dopo oggi in cui un esame del calendario conta ancora come «in arrivo». */
export const CALENDAR_EXAM_DAYS = 60;

/** Esattamente `{ eventId, occurrenceStart }`: qualsiasi altra chiave (un titolo, una data scritta) si rifiuta. */
export const isNullableCalendarExamRef = (value: unknown): value is CalendarExamRef | null => {
  if (value === null) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (Object.keys(value).length !== 2) return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.eventId === "string" &&
    item.eventId.length > 0 &&
    item.eventId.length <= 300 &&
    typeof item.occurrenceStart === "string" &&
    item.occurrenceStart.length <= 40 &&
    !Number.isNaN(new Date(item.occurrenceStart).getTime())
  );
};

/** Riferimento da scrivere in `exams.new` per un'occorrenza. */
export const calendarExamRef = (item: Pick<CalendarEvent, "id" | "start">): CalendarExamRef => ({ eventId: item.id, occurrenceStart: item.start });

/** L'occorrenza a cui punta il riferimento, se c'è ancora (stesso id e stesso inizio); altrimenti null. */
export const findCalendarExam = <T extends CalendarEvent>(events: readonly T[], ref: CalendarExamRef): (T & EventOccurrence) | null => {
  const at = new Date(ref.occurrenceStart);
  if (Number.isNaN(at.getTime())) return null;
  // Qualche giorno di margine: il giorno della serie è nel suo fuso, la finestra in ora locale.
  const from = new Date(at.getFullYear(), at.getMonth(), at.getDate() - 2);
  const to = new Date(at.getFullYear(), at.getMonth(), at.getDate() + 3);
  return (
    expandEvents(
      events.filter((event) => !event.archived),
      from,
      to
    ).find((item) => item.id === ref.eventId && item.start === ref.occurrenceStart) ?? null
  );
};

/** Come togliere dal calendario l'evento sostituito: il solo giorno di una serie, oppure l'evento singolo. */
export type CalendarExamRemoval = { kind: "occurrence"; seriesId: string; date: string } | { kind: "event"; id: string };

export const calendarExamRemoval = (item: Pick<EventOccurrence, "id" | "seriesId" | "originalDate" | "occurrenceDate" | "recurring">): CalendarExamRemoval => {
  if (!item.recurring && !isOccurrenceRow(item)) return { kind: "event", id: item.id };
  const { seriesId, date } = occurrenceTarget(item);
  return { kind: "occurrence", seriesId, date };
};

/** Collezioni che togliere un evento può cambiare: l'evento (o la serie) e ciò che vi era collegato. */
type RemovalSnapshot = { events: readonly CalendarEvent[]; attachments: readonly Attachment[]; notes: readonly Note[] };
const REMOVAL_COLLECTIONS = ["events", "attachments", "notes"] as const;

const snapshotOf = (state: RemovalSnapshot): RemovalSnapshot => ({ events: state.events, attachments: state.attachments, notes: state.notes });

/**
 * Annulla di una rimozione, dal prima e dal dopo: le versioni di prima di ciò che è cambiato o sparito
 * (da riscrivere con `restoreEntities`) e gli eventi nati con la rimozione (il giorno annullato di una
 * serie), da eliminare.
 */
export const removalUndo = (before: RemovalSnapshot, after: RemovalSnapshot): { restore: RestoreVersion[]; remove: string[] } => {
  const restore: RestoreVersion[] = [];
  for (const key of REMOVAL_COLLECTIONS) {
    const now = new Map<string, unknown>(after[key].map((item) => [item.id, item]));
    for (const item of before[key]) {
      if (now.get(item.id) === item) continue;
      restore.push({ entityType: ENTITY_TYPES[key], entityId: item.id, payload: item as unknown as Record<string, unknown>, complete: true });
    }
  }
  const had = new Set(before.events.map((event) => event.id));
  return { restore, remove: after.events.filter((event) => !had.has(event.id)).map((event) => event.id) };
};

/** Azioni del negozio che servono (useStudyStore le ha tutte). */
export interface CalendarExamStore {
  getState: () => RemovalSnapshot & {
    deleteEvent: (id: string) => Promise<void>;
    deleteOccurrence: (seriesId: string, originalDate: string, scope: "this") => Promise<void>;
    restoreEntities: (versions: readonly RestoreVersion[]) => Promise<number>;
  };
}

/**
 * Toglie dal calendario l'occorrenza a cui punta `ref` (deleteOccurrence per un giorno di una serie,
 * deleteEvent per un evento singolo) e restituisce l'Annulla, o null se non c'era più niente da togliere.
 */
export const removeCalendarExam = async (store: CalendarExamStore, ref: CalendarExamRef): Promise<(() => Promise<void>) | null> => {
  const state = store.getState();
  const item = findCalendarExam(state.events, ref);
  if (!item) return null;
  const removal = calendarExamRemoval(item);
  const before = snapshotOf(state);
  if (removal.kind === "event") await state.deleteEvent(removal.id);
  else await state.deleteOccurrence(removal.seriesId, removal.date, "this");
  const { restore, remove } = removalUndo(before, snapshotOf(store.getState()));
  if (!restore.length && !remove.length) return null;
  return async () => {
    if (restore.length) await store.getState().restoreEntities(restore);
    for (const id of remove) await store.getState().deleteEvent(id);
  };
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
