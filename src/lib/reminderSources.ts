// Eventi da cui nascono i promemoria: i miei eventi, gli appelli del gruppo che ho scelto (e la chiusura
// delle iscrizioni) e i promemoria autonomi come eventi di un istante. Puro: lo usano il watcher in app e
// il calcolo dei promemoria ad app chiusa (B3), così i due elenchi non si separano.
import type { CalendarEvent, ExamPlan, Reminder } from "../types";
import type { GroupExamSession } from "./groupExams";
import { groupExamReminderEvents } from "./groupExamCalendar";

export const STANDALONE_REMINDER_PREFIX = "reminder:";

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
      end: item.remindAt,
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
}): CalendarEvent[] => [...input.events, ...groupExamReminderEvents(input.groupSessions, input.examPlans), ...standaloneReminderEvents(input.reminders)];
