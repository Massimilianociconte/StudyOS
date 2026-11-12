// «Il mio piano» nel riquadro dell'appello: scelta, stato, note, promemoria, materia ed esito. È un dato
// personale (examPlans, sync personale): il gruppo non lo vede.
import { useEffect, useRef, useState } from "react";
import { Button, Field, inputClass } from "../ui";
import { GradeDrawer } from "../GradeDrawer";
import { ReminderList } from "../calendar/ReminderList";
import { EXAM_PLAN_STATUS_LABEL } from "../../lib/labels";
import { GROUP_EXAM_TEXT as T } from "../../lib/labels/groupExams";
import { EXAM_PLAN_STATUSES, type ExamPlanPatch } from "../../lib/examPlans";
import { planChanges } from "../../lib/groupExamUi";
import { sessionMatchesSubject, type GroupExamSession } from "../../lib/groupExams";
import { useStudyStore } from "../../store/useStudyStore";
import type { ExamPlanStatus } from "../../types";

const NOTES_SAVE_DELAY_MS = 800;

export function MyPlanSection({
  sessionId,
  session,
  groupName,
  onMessage
}: {
  sessionId: string;
  /** Riga viva; assente se l'appello non si legge (offline, gruppo lasciato): resta la copia del piano. */
  session?: GroupExamSession;
  groupName: string;
  onMessage: (text: string) => void;
}) {
  const plan = useStudyStore((state) => state.examPlans.find((item) => item.sessionId === sessionId));
  const subjects = useStudyStore((state) => state.subjects);
  const exams = useStudyStore((state) => state.exams);
  const planExam = useStudyStore((state) => state.planExam);
  const [notes, setNotes] = useState(plan?.notes ?? "");
  const [grading, setGrading] = useState(false);
  const mySubjects = subjects.filter((subject) => !subject.archived && subject.status !== "archived");
  const sameCourse = session ? mySubjects.find((subject) => sessionMatchesSubject(session, subject)) : undefined;

  const patch = (change: ExamPlanPatch) => void planExam(sessionId, change, session, groupName);
  // Le note si salvano mentre si scrive (dopo una pausa) e alla chiusura del riquadro: Esc o un tocco fuori
  // non le perdono.
  const latest = useRef({ notes, saved: plan?.notes ?? "", save: (_text: string) => {} });
  latest.current = { notes, saved: plan?.notes ?? "", save: (text) => patch({ notes: text }) };
  useEffect(() => {
    if (notes === latest.current.saved) return;
    const timer = window.setTimeout(() => latest.current.save(latest.current.notes), NOTES_SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [notes]);
  useEffect(
    () => () => {
      const { notes: typed, saved, save } = latest.current;
      if (typed !== saved) save(typed);
    },
    []
  );
  if (!plan && !session) return null;
  const changes = plan ? planChanges(plan, session) : [];
  const linkedExam = plan?.examId ? exams.find((exam) => exam.id === plan.examId) : undefined;
  const subjectId = plan?.subjectId ?? sameCourse?.id ?? null;

  return (
    <section className="grid grid-cols-1 gap-3" aria-labelledby={`plan-${sessionId}`}>
      <div>
        <h4 id={`plan-${sessionId}`} className="text-xs font-black uppercase text-[var(--faint)]">
          {T.myPlanTitle}
        </h4>
        <p className="text-sm font-bold text-[var(--muted)]">{T.myPlanPrivate}</p>
      </div>
      {changes.length ? (
        <div className="soft-panel grid grid-cols-1 gap-2 p-2.5">
          <p className="safe-text text-sm font-bold">{T.changedSince(changes.join("; "))}</p>
          <Button variant="soft" icon="Check" className="justify-self-start" onClick={() => patch({ acknowledge: true })}>
            {T.seen}
          </Button>
        </div>
      ) : null}
      <label className="flex min-h-11 items-center gap-3 text-sm font-extrabold">
        <input
          type="checkbox"
          className="h-5 w-5 accent-[var(--accent)]"
          checked={Boolean(plan?.selected)}
          onChange={(event) => patch({ selected: event.target.checked, ...(event.target.checked && !plan?.subjectId && sameCourse ? { subjectId: sameCourse.id } : {}) })}
        />
        {T.chooseToggle}
      </label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label={T.status}>
          <select className={inputClass} value={plan?.status ?? "planned"} onChange={(event) => patch({ status: event.target.value as ExamPlanStatus })}>
            {EXAM_PLAN_STATUSES.map((status) => (
              <option key={status} value={status}>
                {EXAM_PLAN_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={T.subject}>
          <select className={inputClass} value={plan?.subjectId ?? ""} onChange={(event) => patch({ subjectId: event.target.value || null })}>
            <option value="">{T.noSubject}</option>
            {mySubjects.map((subject) => (
              <option key={subject.id} value={subject.id}>
                {subject.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label={T.notes}>
        <textarea
          className={`${inputClass} min-h-20 py-2`}
          value={notes}
          maxLength={2000}
          onChange={(event) => setNotes(event.target.value)}
          onBlur={() => {
            if (notes !== (plan?.notes ?? "")) patch({ notes });
          }}
        />
      </Field>
      <div className="grid grid-cols-1 gap-2">
        <span className="text-xs font-black uppercase text-[var(--faint)]">{T.reminders}</span>
        <ReminderList value={plan?.reminders ?? []} allDay onChange={(reminders) => patch({ reminders })} />
      </div>
      {(session?.registrationCloses ?? plan?.snapshot.registrationCloses) ? (
        <label className="flex min-h-11 items-center gap-3 text-sm font-extrabold">
          <input
            type="checkbox"
            className="h-5 w-5 accent-[var(--accent)]"
            checked={plan?.remindRegistration ?? true}
            onChange={(event) => patch({ remindRegistration: event.target.checked })}
          />
          {T.remindRegistration}
        </label>
      ) : null}
      <Button variant="soft" icon="GraduationCap" className="justify-self-start" onClick={() => setGrading(true)}>
        {T.recordOutcome}
      </Button>
      {/* Il libretto crea o riusa l'esame personale della materia; il piano prende l'esito e il collegamento. */}
      <GradeDrawer
        open={grading}
        exam={linkedExam ?? null}
        subjectId={subjectId}
        subjects={subjects}
        exams={exams}
        onClose={() => setGrading(false)}
        onSaved={(message, outcome) => {
          setGrading(false);
          const latest = useStudyStore.getState().exams.filter((exam) => exam.subjectId === subjectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
          patch({ status: outcome === "failed" ? "failed" : "passed", ...(latest ? { examId: latest.id } : {}), ...(subjectId ? { subjectId } : {}) });
          onMessage(message);
        }}
      />
    </section>
  );
}
