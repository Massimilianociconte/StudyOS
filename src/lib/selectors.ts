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

export const subjectName = (subjects: Subject[], id?: string) =>
  subjects.find((subject) => subject.id === id)?.name ?? "Senza materia";

export const subjectColor = (subjects: Subject[], id?: string, fallback = "var(--accent)") =>
  subjects.find((subject) => subject.id === id)?.color ?? fallback;

export const shortDate = (date: string | Date) =>
  format(typeof date === "string" ? parseISO(date) : date, "d MMM", { locale: it });

export const timeLabel = (date: string | Date) =>
  format(typeof date === "string" ? parseISO(date) : date, "HH:mm", { locale: it });

export const daysUntil = (date: string) => differenceInCalendarDays(parseISO(date), startOfDay(new Date()));

export const eventMinutes = (event: CalendarEvent) => Math.max(15, differenceInMinutes(parseISO(event.end), parseISO(event.start)));

export const todayEvents = (events: CalendarEvent[]) =>
  events
    .filter((event) => isSameDay(parseISO(event.start), new Date()))
    .sort((a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime());

export const upcomingEvents = (events: CalendarEvent[], count = 6) =>
  events
    .filter((event) => isAfter(parseISO(event.start), new Date()) || isSameDay(parseISO(event.start), new Date()))
    .sort((a, b) => parseISO(a.start).getTime() - parseISO(b.start).getTime())
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

export const studyStreak = (sessions: StudySession[]) => {
  const days = new Set(
    sessions
      .filter((session) => session.status === "completed" && session.actualMinutes > 0)
      .map((session) => format(parseISO(session.start), "yyyy-MM-dd"))
  );

  let streak = 0;
  let cursor = startOfDay(new Date());
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
