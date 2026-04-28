import { useState } from "react";
import type { Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { shortDate } from "../lib/selectors";
import { Button, Field, Panel, Pill, ProgressBar, SectionTitle, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";

export function SubjectsView() {
  const [name, setName] = useState("");
  const [color, setColor] = useState("#7CF7C8");
  const { subjects, tasks, sessions, exams, addSubject, updateSubject } = useStudyStore();

  const createSubject = async () => {
    if (!name.trim()) return;
    await addSubject({ name: name.trim(), color, status: "active", icon: "BookOpen" });
    setName("");
  };

  return (
    <div>
      <SectionTitle
        title="Materie"
        subtitle="Ogni corso ha colore, stato, materiali collegati, task, sessioni, obiettivi e preparazione."
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {subjects.map((subject) => {
              const subjectTasks = tasks.filter((task) => task.subjectId === subject.id);
              const completed = subjectTasks.filter((task) => task.status === "done").length;
              const studyMinutes = sessions
                .filter((session) => session.subjectId === subject.id && session.status === "completed")
                .reduce((sum, session) => sum + session.actualMinutes, 0);
              const exam = exams.find((item) => item.subjectId === subject.id);
              const progress = subjectTasks.length ? Math.round((completed / subjectTasks.length) * 100) : exam?.preparation ?? 0;
              return (
                <article key={subject.id} className="quiet-panel min-w-0 overflow-hidden p-4">
                  <div className="mb-5 flex items-start justify-between gap-3">
                    <span className="grid h-16 w-16 place-items-center rounded-super" style={{ background: subject.color }}>
                      <Icon name={subject.icon} className="h-7 w-7 text-[#10131d]" />
                    </span>
                    <select
                      className="rounded-full border border-[var(--border)] bg-[var(--surface-soft)] px-2 py-2 text-xs font-black"
                      value={subject.status}
                      onChange={(event) => updateSubject(subject.id, { status: event.target.value as Subject["status"] })}
                      aria-label="Cambia stato materia"
                    >
                      <option value="not-started">non iniziata</option>
                      <option value="active">in corso</option>
                      <option value="review">da ripassare</option>
                      <option value="exam-ready">pronta</option>
                      <option value="completed">completata</option>
                      <option value="archived">archiviata</option>
                    </select>
                  </div>
                  <h3 className="two-line-safe text-2xl font-black">{subject.name}</h3>
                  <p className="two-line-safe mt-1 text-sm font-bold text-[var(--muted)]">
                    {subject.teacher || "Docente non impostato"}
                  </p>
                  <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                    <Mini label="CFU" value={subject.cfu} />
                    <Mini label="Task" value={subjectTasks.length} />
                    <Mini label="Ore" value={Math.round(studyMinutes / 60)} />
                  </div>
                  <div className="mt-4">
                    <div className="mb-2 flex items-center justify-between text-xs font-black">
                      <span>Preparazione</span>
                      <span>{progress}%</span>
                    </div>
                    <ProgressBar value={progress} color={subject.color} />
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Pill>{subject.semester}</Pill>
                    {subject.examDate ? <Pill>{shortDate(subject.examDate)}</Pill> : null}
                    {subject.targetGrade ? <Pill>{subject.targetGrade}/30</Pill> : null}
                  </div>
                </article>
              );
            })}
          </div>
        </Panel>

        <aside className="grid content-start gap-4">
          <Panel>
            <h3 className="mb-4 text-2xl font-black">Nuova materia</h3>
            <div className="grid gap-3">
              <Field label="Nome">
                <input className={inputClass} value={name} onChange={(event) => setName(event.target.value)} />
              </Field>
              <Field label="Colore">
                <input
                  className="h-12 w-full rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-1"
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value)}
                />
              </Field>
              <Button icon="Plus" variant="primary" onClick={createSubject}>
                Aggiungi materia
              </Button>
            </div>
          </Panel>

          <Panel>
            <h3 className="mb-4 text-2xl font-black">Visual board</h3>
            <div className="grid grid-cols-2 gap-3">
              {subjects.slice(0, 4).map((subject) => (
                <div key={subject.id} className="super-card grid place-items-center p-4 text-center" style={{ background: subject.color }}>
                  <div className="text-[#10131d]">
                    <Icon name={subject.icon} className="mx-auto mb-2 h-7 w-7" />
                    <p className="two-line-safe text-sm font-black">{subject.name}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function Mini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[18px] bg-[var(--surface-soft)] p-2">
      <div className="text-lg font-black">{value}</div>
      <div className="text-[11px] font-bold text-[var(--muted)]">{label}</div>
    </div>
  );
}
