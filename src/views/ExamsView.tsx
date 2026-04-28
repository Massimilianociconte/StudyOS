import { useMemo } from "react";
import { useStudyStore } from "../store/useStudyStore";
import { daysUntil, shortDate, subjectColor, subjectName } from "../lib/selectors";
import { Button, Panel, Pill, ProgressBar, ProgressRing, SectionTitle } from "../components/ui";
import { Icon } from "../components/Icon";

export function ExamsView() {
  const { exams, subjects, tasks, sessions, topics, updateExam, setActiveView } = useStudyStore();
  const sorted = useMemo(() => [...exams].sort((a, b) => a.date.localeCompare(b.date)), [exams]);

  return (
    <div>
      <SectionTitle
        title="Esami"
        subtitle="Piano esame con countdown, preparazione, rischio di ritardo, task e ripassi collegati."
        action={
          <Button icon="CalendarDays" variant="soft" onClick={() => setActiveView("calendar")}>
            Calendario
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {sorted.map((exam) => {
          const color = subjectColor(subjects, exam.subjectId);
          const remaining = daysUntil(exam.date);
          const relatedTasks = tasks.filter((task) => task.subjectId === exam.subjectId && task.status !== "done");
          const relatedSessions = sessions.filter((session) => session.subjectId === exam.subjectId);
          const relatedTopics = topics.filter((topic) => topic.subjectId === exam.subjectId);
          const plannedHours = Math.round(relatedSessions.reduce((sum, session) => sum + session.plannedMinutes, 0) / 60);
          const risk = remaining < 10 && exam.preparation < 70 ? "alto" : remaining < 20 && exam.preparation < 55 ? "medio" : "basso";

          return (
            <Panel key={exam.id}>
              <div className="flex flex-col gap-5 md:flex-row">
                <div className="md:w-44">
                  <ProgressRing value={exam.preparation} label="pronto" color={color} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-black uppercase text-[var(--faint)]">Piano esame</p>
                      <h3 className="two-line-safe text-3xl font-black">{subjectName(subjects, exam.subjectId)}</h3>
                      <p className="text-sm font-bold text-[var(--muted)]">{shortDate(exam.date)}</p>
                    </div>
                    <Pill active={risk === "alto"}>rischio {risk}</Pill>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <Metric label="giorni" value={Math.max(0, remaining)} />
                    <Metric label="task" value={relatedTasks.length} />
                    <Metric label="ore pian." value={plannedHours} />
                    <Metric label="ripassi" value={relatedTopics.length} />
                  </div>

                  <div className="mt-5">
                    <div className="mb-2 flex items-center justify-between text-xs font-black">
                      <span>Preparazione</span>
                      <span>{exam.preparation}%</span>
                    </div>
                    <ProgressBar value={exam.preparation} color={color} />
                  </div>

                  <div className="mt-5 grid gap-2">
                    {exam.program.slice(0, 5).map((topic, index) => (
                      <div key={topic} className="flex items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] p-2">
                        <span className="grid h-7 w-7 place-items-center rounded-full text-xs font-black" style={{ background: color, color: "#10131d" }}>
                          {index + 1}
                        </span>
                        <span className="text-sm font-bold">{topic}</span>
                      </div>
                    ))}
                  </div>

                  <div className="mt-5 flex flex-wrap gap-2">
                    <Button
                      variant="soft"
                      icon="ChevronRight"
                      onClick={() => updateExam(exam.id, { preparation: Math.min(100, exam.preparation + 5) })}
                    >
                      +5% prep
                    </Button>
                    <Button variant="ghost" icon="Timer" onClick={() => setActiveView("study")}>
                      Pianifica studio
                    </Button>
                  </div>
                </div>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[20px] bg-[var(--surface-soft)] p-3">
      <div className="flex items-center gap-2">
        <Icon name="CircleDot" className="h-3.5 w-3.5 text-[var(--accent)]" />
        <span className="text-2xl font-black">{value}</span>
      </div>
      <p className="text-xs font-bold text-[var(--muted)]">{label}</p>
    </div>
  );
}
