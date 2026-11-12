// Appelli del gruppo nel calendario e nei promemoria: eventi virtuali (mai salvati nello store),
// costruiti dagli appelli in memoria e dal piano personale. Senza DOM né store: testabile.
import type { CalendarEvent, Exam, ExamPlan, Subject } from "../types";
import type { GroupExamSession } from "./groupExams";
import { sessionMatchesSubject, sessionTitle } from "./groupExams";
import { OPEN_PLAN_STATUSES } from "./examPlans";
import { GROUP_EXAM_TEXT } from "./labels";

export const GROUP_EXAM_EVENT_PREFIX = "gexam:";
export const GROUP_EXAM_REGISTRATION_PREFIX = "gexam-reg:";
export const GROUP_EXAM_TAG = "appello-di-gruppo";

export const groupExamEventId = (sessionId: string) => `${GROUP_EXAM_EVENT_PREFIX}${sessionId}`;

/** Id dell'appello da un id di evento virtuale (anche quello della chiusura iscrizioni); null altrimenti. */
export const sessionIdOfEventId = (id: string): string | null => {
  if (id.startsWith(GROUP_EXAM_EVENT_PREFIX)) return id.slice(GROUP_EXAM_EVENT_PREFIX.length) || null;
  if (id.startsWith(GROUP_EXAM_REGISTRATION_PREFIX)) return id.slice(GROUP_EXAM_REGISTRATION_PREFIX.length) || null;
  return null;
};

export type GroupExamCalendarMode = "all" | "subjects" | "off";

export interface GroupExamMarker {
  sessionId: string;
  groupId: string;
  groupName: string;
  selected: boolean;
  /** Eliminato nel gruppo ma ancora scelto da me. */
  deleted: boolean;
  /** Dati dalla copia del piano (appello non raggiungibile: offline o non più nel gruppo). */
  stale: boolean;
}

export type GroupExamEvent = CalendarEvent & { groupExam: GroupExamMarker };

/** Giorno dopo `day` (YYYY-MM-DD), senza fusi. */
const nextDay = (day: string) => {
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
};

/** Evento di un giorno intero, con data «flottante» come gli appelli BARB importati. */
const allDayEvent = (id: string, day: string, fields: Partial<CalendarEvent> & Pick<CalendarEvent, "title">): CalendarEvent => ({
  id,
  createdAt: fields.createdAt ?? "",
  updatedAt: fields.updatedAt ?? "",
  archived: false,
  tags: [GROUP_EXAM_TAG],
  description: "",
  category: "exam",
  color: "",
  colorCustom: false,
  priority: "medium",
  start: `${day}T00:00:00`,
  end: `${nextDay(day)}T00:00:00`,
  allDay: true,
  recurrence: "none",
  status: "planned",
  checklist: [],
  attachmentIds: [],
  notes: "",
  links: [],
  ...fields
});

interface CalendarInput {
  sessions: readonly GroupExamSession[];
  plans: readonly ExamPlan[];
  groupNames: ReadonlyMap<string, string>;
  subjects: readonly Subject[];
  events: readonly (Pick<CalendarEvent, "id"> & Partial<CalendarEvent>)[];
  /** Miei esami: un appello già presente come mio esame (collegato o dello stesso giorno) non si ripete. */
  exams?: readonly Exam[];
  mode: GroupExamCalendarMode;
}

/**
 * Eventi virtuali degli appelli:
 * - scelti da me: sempre (anche con mode "off"), dalla riga viva o dalla copia del piano;
 * - "subjects": gli appelli vivi delle mie materie; "all": tutti gli appelli vivi dei miei gruppi;
 * - un eliminato si vede solo se l'avevo scelto (segnato `deleted`);
 * - un appello collegato a un mio evento o esame, o che coincide con un mio evento d'esame o un mio
 *   esame (stesso corso e giorno, non scartato con «Tienili separati»), non si ripete: lo mostra già
 *   il dato personale (il riquadro dell'appello propone il collegamento).
 */
export const groupExamEvents = ({ sessions, plans, groupNames, subjects, events, exams = [], mode }: CalendarInput): GroupExamEvent[] => {
  const planOf = new Map(plans.map((plan) => [plan.sessionId, plan]));
  const eventIds = new Set(events.map((event) => event.id));
  const examIds = new Set(exams.filter((exam) => !exam.archived).map((exam) => exam.id));
  const liveIds = new Set(sessions.map((session) => session.id));
  const out: GroupExamEvent[] = [];

  const push = (session: Pick<GroupExamSession, "id" | "groupId" | "courseId" | "courseName" | "date" | "kind" | "label" | "time" | "room" | "createdAt" | "updatedAt">, plan: ExamPlan | undefined, deleted: boolean, stale: boolean) => {
    if (plan?.linkedEventId && eventIds.has(plan.linkedEventId)) return;
    if (!deleted) {
      // Collegato a un mio esame: lo mostra già l'esame, scelto o no.
      if (plan?.examId && examIds.has(plan.examId)) return;
      // Un appello che ho scelto non sparisce mai per un doppione non collegato: il collegamento si propone nel riquadro.
      if (plan?.selected !== true && personalMatches(session, { events: events as readonly CalendarEvent[], exams, subjects }, plan).length) return;
    }
    const subject = (plan?.subjectId ? subjects.find((item) => item.id === plan.subjectId) : undefined) ?? subjects.find((item) => sessionMatchesSubject(session, item));
    const groupName = groupNames.get(session.groupId) ?? plan?.snapshot.groupName ?? "";
    const selected = plan?.selected === true;
    out.push({
      ...allDayEvent(groupExamEventId(session.id), session.date, {
        title: sessionTitle(session),
        description: [groupName && GROUP_EXAM_TEXT.calendarGroup(groupName), session.time && GROUP_EXAM_TEXT.calendarTime(session.time), session.room && GROUP_EXAM_TEXT.calendarRoom(session.room)].filter(Boolean).join("\n"),
        subjectId: subject?.id,
        priority: selected ? "high" : "medium",
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        ...(selected && plan?.reminders.length ? { reminders: plan.reminders } : {})
      }),
      groupExam: { sessionId: session.id, groupId: session.groupId, groupName, selected, deleted, stale }
    });
  };

  for (const session of sessions) {
    const plan = planOf.get(session.id);
    const selected = plan?.selected === true;
    if (session.deletedAt) {
      if (selected) push(session, plan, true, false);
      continue;
    }
    if (selected || mode === "all" || (mode === "subjects" && subjects.some((subject) => sessionMatchesSubject(session, subject)))) {
      push(session, plan, false, false);
    }
  }
  // Scelti ma non raggiungibili (offline, appello tolto definitivamente, gruppo lasciato): dalla copia.
  for (const plan of plans) {
    if (!plan.selected || liveIds.has(plan.sessionId)) continue;
    const s = plan.snapshot;
    push(
      { id: plan.sessionId, groupId: s.groupId, courseId: s.courseKey.startsWith("barb:") ? s.courseKey.slice(5) : null, courseName: s.courseName, date: s.date, kind: s.kind, label: "", time: s.time, room: s.room, createdAt: plan.createdAt, updatedAt: plan.updatedAt },
      plan,
      false,
      true
    );
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
};

/**
 * Eventi per i promemoria: gli appelli scelti con promemoria e, se richiesto, la chiusura delle
 * iscrizioni (il giorno prima e il giorno stesso alle 9) finché lo stato è «da fare».
 */
export const groupExamReminderEvents = (sessions: readonly GroupExamSession[], plans: readonly ExamPlan[], events: readonly CalendarEvent[] = []): CalendarEvent[] => {
  const eventIds = new Set(events.map((event) => event.id));
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const out: CalendarEvent[] = [];
  for (const plan of plans) {
    if (!plan.selected || !OPEN_PLAN_STATUSES.has(plan.status)) continue;
    const live = byId.get(plan.sessionId);
    if (live?.deletedAt) continue;
    const date = live?.date ?? plan.snapshot.date;
    const title = sessionTitle(live ?? { kind: plan.snapshot.kind, courseName: plan.snapshot.courseName, label: "" });
    // Collegato a un mio evento che esiste: avvisa quello, non anche l'appello (due promemoria per lo stesso giorno).
    const linked = Boolean(plan.linkedEventId && eventIds.has(plan.linkedEventId));
    if (plan.reminders.length && !linked) {
      out.push(allDayEvent(groupExamEventId(plan.sessionId), date, { title, reminders: plan.reminders }));
    }
    const closes = live ? live.registrationCloses : plan.snapshot.registrationCloses;
    if (plan.remindRegistration && plan.status === "planned" && closes) {
      out.push(allDayEvent(`${GROUP_EXAM_REGISTRATION_PREFIX}${plan.sessionId}`, closes, {
        title: GROUP_EXAM_TEXT.registrationClosesTitle(title),
        reminders: [{ daysBefore: 1, at: "09:00" }, { daysBefore: 0, at: "09:00" }]
      }));
    }
  }
  return out;
};

export interface PersonalMatch {
  type: "event" | "exam";
  id: string;
  title: string;
  /** `event:<id>` / `exam:<id>`: la chiave di `dismissedMatches`. */
  key: string;
}

/** Giorno locale (YYYY-MM-DD) di un istante; per le date flottanti «YYYY-MM-DDT00:00:00» il giorno scritto. */
export const localDay = (value: string): string | null => {
  if (/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(value)) return value.slice(0, 10);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/**
 * Miei eventi d'esame ed esami dello stesso corso e dello stesso giorno di un appello del gruppo,
 * non ancora collegati e non scartati con «Tienili separati». Niente si unisce da solo: si propone.
 */
export const personalMatches = (
  session: Pick<GroupExamSession, "id" | "courseId" | "courseName" | "date">,
  data: { events: readonly CalendarEvent[]; exams: readonly Exam[]; subjects: readonly Subject[] },
  plan?: ExamPlan
): PersonalMatch[] => {
  const dismissed = new Set(plan?.dismissedMatches ?? []);
  const linked = new Set([plan?.linkedEventId && `event:${plan.linkedEventId}`, plan?.examId && `exam:${plan.examId}`].filter(Boolean));
  const mySubjects = new Set(data.subjects.filter((subject) => sessionMatchesSubject(session, subject)).map((subject) => subject.id));
  const out: PersonalMatch[] = [];
  for (const event of data.events) {
    if (event.category !== "exam" || event.archived || event.cancelled || (event.recurrence && event.recurrence !== "none")) continue;
    if (localDay(event.start) !== session.date) continue;
    const sameCourse = (event.subjectId && mySubjects.has(event.subjectId)) || sessionMatchesSubject(session, { name: event.title.replace(/^Appello · /, "") });
    if (!sameCourse) continue;
    const key = `event:${event.id}`;
    if (!dismissed.has(key) && !linked.has(key)) out.push({ type: "event", id: event.id, title: event.title, key });
  }
  for (const exam of data.exams) {
    if (exam.archived || !mySubjects.has(exam.subjectId) || localDay(exam.date) !== session.date) continue;
    const key = `exam:${exam.id}`;
    const subject = data.subjects.find((item) => item.id === exam.subjectId);
    if (!dismissed.has(key) && !linked.has(key)) out.push({ type: "exam", id: exam.id, title: subject?.name ?? "", key });
  }
  return out;
};
