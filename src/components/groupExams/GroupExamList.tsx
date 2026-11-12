// Righe degli appelli del gruppo: toccandone una si apre il riquadro; «Scegli» la mette nel mio piano.
import { useMemo } from "react";
import { Button } from "../ui";
import { GROUP_EXAM_TEXT as T } from "../../lib/labels/groupExams";
import { formatDay, sessionMatchesSubject, sessionTitle, type GroupExamSession } from "../../lib/groupExams";
import { groupNamesOf, useGroupExamStore } from "../../store/useGroupExamStore";
import { useStudyStore } from "../../store/useStudyStore";

export function GroupExamList({
  sessions,
  emptyText,
  onOpen,
  showGroup = true
}: {
  sessions: readonly GroupExamSession[];
  emptyText: string;
  onOpen: (id: string) => void;
  /** Nome del gruppo nella riga (no nella scheda di un gruppo). */
  showGroup?: boolean;
}) {
  const plans = useStudyStore((state) => state.examPlans);
  const subjects = useStudyStore((state) => state.subjects);
  const planExam = useStudyStore((state) => state.planExam);
  const groups = useGroupExamStore((state) => state.groups);
  const names = useMemo(() => groupNamesOf(groups), [groups]);

  if (!sessions.length) return <p className="text-sm font-bold text-[var(--muted)]">{emptyText}</p>;
  return (
    <ul className="grid grid-cols-1 gap-2">
      {sessions.map((session) => {
        const plan = plans.find((item) => item.sessionId === session.id);
        const chosen = plan?.selected === true;
        const groupName = names.get(session.groupId) ?? "";
        const subject = subjects.find((item) => !item.archived && sessionMatchesSubject(session, item));
        const title = sessionTitle(session);
        return (
          <li key={session.id} className="quiet-panel flex min-w-0 flex-wrap items-center gap-2 p-3">
            <button type="button" className="min-h-11 min-w-0 flex-1 basis-48 text-left" onClick={() => onOpen(session.id)}>
              <span className="block text-sm font-extrabold">
                {formatDay(session.date)}
                {session.time ? ` · ${session.time}` : ""}
              </span>
              <span className="safe-text block text-xs text-[var(--muted)]">{[title, session.room, showGroup ? groupName : ""].filter(Boolean).join(" · ")}</span>
            </button>
            <Button
              variant={chosen ? "primary" : "soft"}
              icon={chosen ? "Check" : "Plus"}
              aria-label={`${chosen ? T.chosen : T.choose}: ${title}, ${formatDay(session.date)}`}
              onClick={() =>
                void planExam(session.id, { selected: !chosen, ...(!chosen && !plan?.subjectId && subject ? { subjectId: subject.id } : {}) }, session, groupName)
              }
            >
              {chosen ? T.chosen : T.choose}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
