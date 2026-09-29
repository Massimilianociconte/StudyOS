import {
  addDays,
  differenceInCalendarDays,
  differenceInMinutes,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  parseISO,
  startOfDay,
  startOfWeek
} from "date-fns";
import { it } from "date-fns/locale";
import type { CalendarEvent, Exam, StudySession, Subject, Task } from "../types";
import { expandEvents } from "./recurrence";

export const subjectName = (subjects: Subject[], id?: string) =>
  subjects.find((subject) => subject.id === id)?.name ?? "Senza materia";

export const subjectColor = (subjects: Subject[], id?: string, fallback = "var(--accent)") =>
  subjects.find((subject) => subject.id === id)?.color ?? fallback;

/**
 * Materie da proporre nei menu di scelta: escluse quelle archiviate o già superate (libretto),
 * tranne quella eventualmente già selezionata, che deve restare visibile.
 */
export const selectableSubjects = (subjects: Subject[], currentId?: string) =>
  subjects.filter((subject) => (!subject.archived && subject.status !== "archived" && subject.status !== "completed") || subject.id === currentId);

const asDate = (date: string | Date) => (typeof date === "string" ? parseISO(date) : date);

const localDay = (date: string | Date) => startOfDay(asDate(date));

export const shortDate = (date: string | Date) => format(asDate(date), "d MMM", { locale: it });

export const timeLabel = (date: string | Date) => format(asDate(date), "HH:mm", { locale: it });

export const daysUntil = (date: string | Date, from: string | Date = new Date()) =>
  differenceInCalendarDays(localDay(date), localDay(from));

export const studyDaysUntil = (date: string | Date, from: string | Date = new Date()) =>
  Math.max(0, daysUntil(date, from));

export const studyDaysLabel = (date: string | Date, from: string | Date = new Date()) => {
  const days = studyDaysUntil(date, from);
  return `${days} ${days === 1 ? "giorno utile" : "giorni utili"}`;
};

export const eventMinutes = (event: CalendarEvent) => Math.max(15, differenceInMinutes(parseISO(event.end), parseISO(event.start)));

/** Eventi di oggi, incluse le occorrenze delle serie ripetute. */
export const todayEvents = (events: CalendarEvent[]) =>
  expandEvents(events, startOfDay(new Date()), addDays(startOfDay(new Date()), 1)).filter((event) =>
    isSameDay(parseISO(event.start), new Date())
  );

/** Prossimi eventi da oggi (occorrenze ripetute comprese, orizzonte 120 giorni). */
export const upcomingEvents = (events: CalendarEvent[], count = 6) =>
  expandEvents(events, startOfDay(new Date()), addDays(startOfDay(new Date()), 120))
    .filter((event) => isAfter(parseISO(event.start), new Date()) || isSameDay(parseISO(event.start), new Date()))
    .slice(0, count);

export const urgentTasks = (tasks: Task[], count = 5) =>
  tasks
    .filter((task) => task.status !== "done" && task.status !== "archived")
    .sort((a, b) => {
      const score = (task: Task) => {
        const due = task.dueDate ? Math.max(0, 10 - Math.abs(daysUntil(task.dueDate))) : 0;
        const priority = { urgent: 24, high: 16, medium: 8, low: 2 }[task.priority];
        return due + priority + task.importance * 2;
      };
      return score(b) - score(a);
    })
    .slice(0, count);

export const upcomingExams = (exams: Exam[], count = 4) =>
  exams
    .filter((exam) => exam.status !== "done" && !isBefore(parseISO(exam.date), startOfDay(new Date())))
    .sort((a, b) => parseISO(a.date).getTime() - parseISO(b.date).getTime())
    .slice(0, count);

export const studyMinutesThisWeek = (sessions: StudySession[]) => {
  const start = startOfWeek(new Date(), { weekStartsOn: 1 });
  const end = endOfWeek(new Date(), { weekStartsOn: 1 });
  return sessions
    .filter((session) => {
      const date = parseISO(session.start);
      return !isBefore(date, start) && !isAfter(date, end) && session.status === "completed";
    })
    .reduce((sum, session) => sum + session.actualMinutes, 0);
};

/**
 * Giorni consecutivi di studio. La serie resta viva finché l'ultimo giorno studiato è oggi o
 * ieri: la mattina, prima della prima sessione, lo streak non deve azzerarsi.
 */
export const studyStreak = (sessions: StudySession[], now: Date = new Date()) => {
  const days = new Set(
    sessions
      .filter((session) => session.status === "completed" && session.actualMinutes > 0)
      .map((session) => format(parseISO(session.start), "yyyy-MM-dd"))
  );

  let streak = 0;
  let cursor = startOfDay(now);
  if (!days.has(format(cursor, "yyyy-MM-dd"))) cursor = addDays(cursor, -1);
  while (days.has(format(cursor, "yyyy-MM-dd"))) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
};

export const completionRate = (tasks: Task[]) => {
  if (tasks.length === 0) return 0;
  return Math.round((tasks.filter((task) => task.status === "done").length / tasks.length) * 100);
};

export const workloadBySubject = (subjects: Subject[], sessions: StudySession[]) =>
  subjects.map((subject) => ({
    name: subject.name,
    minutes: sessions
      .filter((session) => session.subjectId === subject.id && session.status === "completed")
      .reduce((sum, session) => sum + session.actualMinutes, 0),
    color: subject.color
  }));
