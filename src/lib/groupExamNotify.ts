// Notifiche in app per gli appelli del gruppo (pure). Id stabili: più dispositivi dello stesso
// account non le duplicano (addNotification ignora un id già presente). Mai per le proprie modifiche.
import type { AppNotification, ExamPlan, Subject } from "../types";
import type { GroupExamSession } from "./groupExams";
import { describeSessionChanges, formatDay, sessionMatchesSubject, sessionTitle } from "./groupExams";

export const GROUP_EXAM_NOTIFICATION_PREFIX = "notif-gexam-";

export type GroupExamNotification = Pick<AppNotification, "id" | "kind" | "title" | "body" | "linkView" | "linkGroupId">;

interface NotifyInput {
  sessions: readonly GroupExamSession[];
  plans: readonly ExamPlan[];
  subjects: readonly Subject[];
  /** Id dell'account (created_by/updated_by delle righe). */
  me: string;
  /** createdAt più recente già considerato; undefined = primo avvio (nessun «nuovo appello» per il passato). */
  watermark: string | undefined;
  /** Giorno di oggi YYYY-MM-DD (appelli passati: niente «nuovo appello»). */
  today: string;
}

export const planGroupExamNotifications = ({ sessions, plans, subjects, me, watermark, today }: NotifyInput) => {
  const out: GroupExamNotification[] = [];
  const planOf = new Map(plans.map((plan) => [plan.sessionId, plan]));
  let next = watermark ?? "";
  for (const session of sessions) {
    if (session.createdAt > next) next = session.createdAt;
    const title = sessionTitle(session);
    const plan = planOf.get(session.id);
    if (watermark !== undefined && session.createdAt > watermark && session.createdBy !== me && !session.deletedAt && session.date >= today && subjects.some((subject) => !subject.archived && sessionMatchesSubject(session, subject))) {
      out.push({ id: `${GROUP_EXAM_NOTIFICATION_PREFIX}new-${session.id}`, kind: "group", title: "Nuovo appello nel gruppo", body: `${title}, ${formatDay(session.date)} · da ${session.createdByName || "un membro"}`, linkView: "groups", linkGroupId: session.groupId });
    }
    if (!plan?.selected || session.updatedBy === me) continue;
    if (session.deletedAt) {
      out.push({ id: `${GROUP_EXAM_NOTIFICATION_PREFIX}${session.id}-deleted`, kind: "group", title: "Appello eliminato", body: `${title} del ${formatDay(session.date)} · eliminato da ${session.deletedByName || "un membro"}. È ancora nel tuo piano.`, linkView: "groups", linkGroupId: session.groupId });
    } else if (session.version > plan.snapshot.version) {
      const s = plan.snapshot;
      const before = { courseId: null, courseName: s.courseName, date: s.date, kind: s.kind, label: "", time: s.time, room: s.room, notes: "", registrationOpens: null, registrationCloses: s.registrationCloses, barbSessionId: null, source: "member" as const };
      const changes = describeSessionChanges(before, { ...before, courseName: session.courseName, date: session.date, kind: session.kind, time: session.time, room: session.room, registrationCloses: session.registrationCloses });
      if (changes.length) {
        out.push({ id: `${GROUP_EXAM_NOTIFICATION_PREFIX}${session.id}-v${session.version}`, kind: "group", title: "Appello cambiato", body: `${title}: ${changes.join("; ")} · da ${session.updatedByName || "un membro"}`, linkView: "groups", linkGroupId: session.groupId });
      }
    }
  }
  return { notifications: out, watermark: next || watermark };
};
