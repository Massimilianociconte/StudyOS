// Notifiche in app per gli appelli del gruppo (pure). Id stabili: più dispositivi dello stesso
// account non le duplicano (addNotification ignora un id già presente). Mai per le proprie modifiche.
import type { AppNotification, ExamPlan, Subject } from "../types";
import type { GroupExamSession } from "./groupExams";
import { describeSessionChanges, formatDay, sessionMatchesSubject, sessionTitle } from "./groupExams";
import { GROUP_EXAM_TEXT } from "./labels";

export const GROUP_EXAM_NOTIFICATION_PREFIX = "notif-gexam-";

/** `createdAt` = istante dell'evento sul server: una lettura o eliminazione fatta dopo, su un dispositivo qualsiasi, vince la sync. */
export type GroupExamNotification = Pick<AppNotification, "id" | "kind" | "title" | "body" | "linkView" | "linkGroupId" | "createdAt">;

interface NotifyInput {
  sessions: readonly GroupExamSession[];
  plans: readonly ExamPlan[];
  subjects: readonly Subject[];
  /** Id dell'account (created_by/updated_by delle righe). */
  me: string;
  /**
   * Istante più recente già considerato (creazione o ultima modifica di una riga); undefined = primo avvio.
   * Si avvisa solo di ciò che è PIÙ NUOVO del segno e il segno avanza: una notifica tolta dalla persona
   * non viene ripianificata ai giri successivi.
   */
  watermark: string | undefined;
  /** Giorno di oggi YYYY-MM-DD (appelli passati: niente «nuovo appello»). */
  today: string;
}

/** Segno di partenza quando il gruppo è ancora vuoto: non vuoto, così il primo appello aggiunto avvisa. */
export const EMPTY_WATERMARK = "1970-01-01T00:00:00.000Z";

/** Istante di una stringa del server («Z» o «+00:00»); NaN se illeggibile. */
const instant = (value: string) => Date.parse(value);
const isAfter = (a: string, b: string) => {
  const x = instant(a);
  const y = instant(b);
  return Number.isNaN(x) || Number.isNaN(y) ? a > b : x > y;
};

export const planGroupExamNotifications = ({ sessions, plans, subjects, me, watermark, today }: NotifyInput) => {
  const out: GroupExamNotification[] = [];
  const planOf = new Map(plans.map((plan) => [plan.sessionId, plan]));
  let next = watermark ?? "";
  for (const session of sessions) {
    const touched = isAfter(session.updatedAt, session.createdAt) ? session.updatedAt : session.createdAt;
    const title = sessionTitle(session);
    const plan = planOf.get(session.id);
    if (watermark !== undefined) {
      if (isAfter(session.createdAt, watermark) && session.createdBy !== me && !session.deletedAt && session.date >= today && subjects.some((subject) => !subject.archived && sessionMatchesSubject(session, subject))) {
        out.push({ id: `${GROUP_EXAM_NOTIFICATION_PREFIX}new-${session.id}`, kind: "group", title: GROUP_EXAM_TEXT.notifyNewTitle, body: GROUP_EXAM_TEXT.notifyNewBody(title, formatDay(session.date), session.createdByName || GROUP_EXAM_TEXT.someMember), linkView: "groups", linkGroupId: session.groupId, createdAt: session.createdAt });
      }
      if (plan?.selected && session.updatedBy !== me && isAfter(touched, watermark)) {
        if (session.deletedAt) {
          out.push({ id: `${GROUP_EXAM_NOTIFICATION_PREFIX}${session.id}-deleted`, kind: "group", title: GROUP_EXAM_TEXT.notifyDeletedTitle, body: GROUP_EXAM_TEXT.notifyDeletedBody(title, formatDay(session.date), session.deletedByName || GROUP_EXAM_TEXT.someMember), linkView: "groups", linkGroupId: session.groupId, createdAt: session.deletedAt });
        } else if (session.version > plan.snapshot.version) {
          const s = plan.snapshot;
          const before = { courseId: null, courseName: s.courseName, date: s.date, kind: s.kind, label: "", time: s.time, room: s.room, notes: "", registrationOpens: null, registrationCloses: s.registrationCloses, barbSessionId: null, source: "member" as const };
          const changes = describeSessionChanges(before, { ...before, courseName: session.courseName, date: session.date, kind: session.kind, time: session.time, room: session.room, registrationCloses: session.registrationCloses });
          if (changes.length) {
            out.push({ id: `${GROUP_EXAM_NOTIFICATION_PREFIX}${session.id}-v${session.version}`, kind: "group", title: GROUP_EXAM_TEXT.notifyChangedTitle, body: GROUP_EXAM_TEXT.notifyChangedBody(title, changes.join("; "), session.updatedByName || GROUP_EXAM_TEXT.someMember), linkView: "groups", linkGroupId: session.groupId, createdAt: session.updatedAt });
          }
        }
      }
    }
    if (!next || isAfter(touched, next)) next = touched;
  }
  return { notifications: out, watermark: next || watermark || EMPTY_WATERMARK };
};
