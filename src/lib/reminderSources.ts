// Eventi da cui nascono i promemoria: i miei eventi, gli appelli del gruppo che ho scelto (e la chiusura
// delle iscrizioni) e i promemoria autonomi come eventi di un istante. Puro: lo usano il watcher in app e
// il calcolo dei promemoria ad app chiusa (B3), così i due elenchi non si separano.
import type { CalendarEvent, ExamPlan, Reminder } from "../types";
import type { GroupExamSession } from "./groupExams";
import { GROUP_EXAM_EVENT_PREFIX, GROUP_EXAM_REGISTRATION_PREFIX, groupExamReminderEvents } from "./groupExamCalendar";
import { MISSED_WINDOW_MS, STANDALONE_REMINDER_PREFIX, type PlannedReminder } from "./eventReminders";
import { normalizeExamPlan } from "./examPlans";

export { STANDALONE_REMINDER_PREFIX };

/** Promemoria non fatti con un istante valido: un evento che avvisa all'ora indicata. */
export const standaloneReminderEvents = (reminders: readonly Reminder[]): CalendarEvent[] =>
  reminders
    .filter((item) => !item.done && !item.archived && Number.isFinite(Date.parse(item.remindAt)))
    .map((item) => ({
      id: `${STANDALONE_REMINDER_PREFIX}${item.id}`,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      archived: false,
      tags: [],
      title: item.title,
      description: "",
      category: "personal",
      color: "",
      colorCustom: false,
      priority: "medium",
      start: item.remindAt,
      // Mai nel calendario: la fine in avanti tiene il promemoria «aperto» per il recupero ad app chiusa.
      end: new Date(Date.parse(item.remindAt) + MISSED_WINDOW_MS + 60 * 60_000).toISOString(),
      allDay: false,
      recurrence: "none",
      status: "planned",
      checklist: [],
      attachmentIds: [],
      notes: "",
      links: [],
      reminders: [{ minutesBefore: 0 }]
    }));

export const reminderSourceEvents = (input: {
  events: readonly CalendarEvent[];
  examPlans: readonly ExamPlan[];
  reminders: readonly Reminder[];
  groupSessions: readonly GroupExamSession[];
}): CalendarEvent[] => {
  // Un piano arrivato storto dal cloud non deve far cadere i promemoria: si ripulisce o si salta.
  const plans = input.examPlans.map(normalizeExamPlan).filter((plan): plan is ExamPlan => plan !== null);
  return [...input.events, ...groupExamReminderEvents(input.groupSessions, plans, input.events), ...standaloneReminderEvents(input.reminders)];
};

/** Stato dello store degli appelli che serve a sapere se la copia salvata nel piano è ancora quella giusta. */
export interface GroupExamsReadiness {
  ready: boolean;
  available: boolean;
  viewerId: string | null;
}

/** Gli appelli dei gruppi sono stati letti per questo account (o non si possono leggere: vale la copia). */
export const groupExamsConfirmed = (state: GroupExamsReadiness, userId: string | null | undefined): boolean =>
  !state.available || (state.ready && Boolean(userId) && state.viewerId === userId);

/** Ci sono appelli scelti e la lettura dei gruppi non è ancora arrivata: le push aspettano. */
export const planNeedsGroupPull = (plans: readonly ExamPlan[], state: GroupExamsReadiness, userId: string | null | undefined): boolean =>
  plans.some((plan) => plan?.selected === true) && !groupExamsConfirmed(state, userId);

const isGroupExamEventId = (id: string) => id.startsWith(GROUP_EXAM_EVENT_PREFIX) || id.startsWith(GROUP_EXAM_REGISTRATION_PREFIX);

/** Promemoria «persi» di appelli del gruppo: prima della lettura dei gruppi non si sa se l'appello c'è ancora o è spostato. */
export const dropUnconfirmedGroupReminders = (missed: readonly PlannedReminder[], confirmed: boolean): PlannedReminder[] =>
  confirmed ? [...missed] : missed.filter((item) => !isGroupExamEventId(item.eventId));
