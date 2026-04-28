import { useState } from "react";
import type { Goal } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { shortDate } from "../lib/selectors";
import { Button, Field, Panel, Pill, ProgressBar, SectionTitle, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";

export function GoalsView() {
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<Goal["category"]>("study");
  const { goals, addGoal, updateGoal } = useStudyStore();

  const createGoal = async () => {
    if (!title.trim()) return;
    await addGoal({ title: title.trim(), category, progress: 0, metric: "%" });
    setTitle("");
  };

  return (
    <div>
      <SectionTitle title="Obiettivi" subtitle="Obiettivi universitari e personali con progresso, metriche, task e sessioni collegate." />
      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Panel>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {goals.map((goal) => (
              <article key={goal.id} className="quiet-panel p-4">
                <div className="mb-4 flex items-start justify-between gap-3">
                  <span className="grid h-14 w-14 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
                    <Icon name={goal.category === "exam" ? "GraduationCap" : "Target"} className="h-6 w-6" />
                  </span>
                  <Pill active={goal.status === "active"}>{goal.status}</Pill>
                </div>
                <h3 className="two-line-safe text-2xl font-black">{goal.title}</h3>
                <p className="three-line-safe mt-2 text-sm text-[var(--muted)]">{goal.description || goal.metric}</p>
                <div className="mt-5">
                  <div className="mb-2 flex justify-between text-xs font-black">
                    <span>Progresso</span>
                    <span>{goal.progress}%</span>
                  </div>
                  <ProgressBar value={goal.progress} />
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="soft" onClick={() => updateGoal(goal.id, { progress: Math.max(0, goal.progress - 5) })}>
                    -5
                  </Button>
                  <Button variant="primary" onClick={() => updateGoal(goal.id, { progress: Math.min(100, goal.progress + 5) })}>
                    +5
                  </Button>
                  {goal.deadline ? <Pill>{shortDate(goal.deadline)}</Pill> : null}
                </div>
              </article>
            ))}
          </div>
        </Panel>

        <aside className="grid content-start gap-4">
          <Panel>
            <h3 className="mb-4 text-2xl font-black">Nuovo obiettivo</h3>
            <div className="grid gap-3">
              <Field label="Titolo">
                <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} />
              </Field>
              <Field label="Categoria">
                <select className={inputClass} value={category} onChange={(event) => setCategory(event.target.value as Goal["category"])}>
                  <option value="study">studio</option>
                  <option value="exam">esame</option>
                  <option value="notes">appunti</option>
                  <option value="review">ripasso</option>
                  <option value="streak">streak</option>
                  <option value="fitness">allenamento</option>
                  <option value="personal">personale</option>
                  <option value="project">progetto</option>
                </select>
              </Field>
              <Button icon="Plus" variant="primary" onClick={createGoal}>
                Crea obiettivo
              </Button>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
