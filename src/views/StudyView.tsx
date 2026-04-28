import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, isBefore, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { useStudyStore } from "../store/useStudyStore";
import { shortDate, studyMinutesThisWeek, subjectColor, subjectName } from "../lib/selectors";
import { Button, Field, Panel, Pill, ProgressBar, ProgressRing, SectionTitle, inputClass } from "../components/ui";
import { Icon } from "../components/Icon";

export function StudyView() {
  const {
    sessions,
    topics,
    subjects,
    timer,
    setTimer,
    addSession,
    completeTopicReview,
    updateSession
  } = useStudyStore();
  const [subjectId, setSubjectId] = useState(subjects[0]?.id ?? "");
  const [sessionTitle, setSessionTitle] = useState("Deep focus");

  useEffect(() => {
    if (!timer.running) return;
    const interval = window.setInterval(() => {
      const next = Math.max(0, useStudyStore.getState().timer.remainingSeconds - 1);
      useStudyStore.getState().setTimer({ remainingSeconds: next, running: next > 0 });
    }, 1000);
    return () => window.clearInterval(interval);
  }, [timer.running]);

  const minutes = Math.floor(timer.remainingSeconds / 60);
  const seconds = timer.remainingSeconds % 60;
  const dueReviews = topics.filter((topic) => isBefore(parseISO(topic.nextReviewDate), new Date()) || topic.nextReviewDate.slice(0, 10) === new Date().toISOString().slice(0, 10));
  const weeklyMinutes = studyMinutesThisWeek(sessions);

  const startTimer = (mode: typeof timer.mode) => {
    const durations = { classic: 45 * 60, pomodoro: 25 * 60, "deep-focus": 90 * 60 };
    setTimer({ mode, remainingSeconds: durations[mode], running: true, label: mode === "deep-focus" ? "Deep focus" : mode });
  };

  const finishSession = async () => {
    const elapsed = timer.mode === "pomodoro" ? 25 * 60 - timer.remainingSeconds : timer.mode === "deep-focus" ? 90 * 60 - timer.remainingSeconds : 45 * 60 - timer.remainingSeconds;
    const actualMinutes = Math.max(1, Math.round(elapsed / 60));
    await addSession({
      title: sessionTitle,
      subjectId: subjectId || undefined,
      actualMinutes,
      plannedMinutes: actualMinutes,
      status: "completed",
      start: new Date(Date.now() - elapsed * 1000).toISOString(),
      end: new Date().toISOString(),
      focusLevel: 4
    });
    setTimer({ running: false, remainingSeconds: 25 * 60, mode: "pomodoro" });
  };

  return (
    <div>
      <SectionTitle
        title="Studio"
        subtitle="Sessioni, timer, storico e ripassi programmati con logica spaced repetition estendibile."
        action={
          <Button icon="Timer" variant="primary" onClick={() => startTimer("deep-focus")}>
            Deep focus
          </Button>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel className="lg:col-span-2">
            <div className="grid items-center gap-6 md:grid-cols-[280px_1fr]">
              <div className="mx-auto w-full max-w-[260px]">
                <ProgressRing
                  value={timer.mode === "pomodoro" ? (timer.remainingSeconds / (25 * 60)) * 100 : timer.mode === "deep-focus" ? (timer.remainingSeconds / (90 * 60)) * 100 : (timer.remainingSeconds / (45 * 60)) * 100}
                  label={timer.label}
                  color="var(--accent)"
                />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-[var(--faint)]">Timer integrato</p>
                <div className="mt-2 text-7xl font-black tabular-nums">
                  {String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Button variant="soft" onClick={() => startTimer("pomodoro")}>
                    Pomodoro
                  </Button>
                  <Button variant="soft" onClick={() => startTimer("classic")}>
                    Classico
                  </Button>
                  <Button variant="soft" onClick={() => startTimer("deep-focus")}>
                    Deep focus
                  </Button>
                  <Button
                    variant={timer.running ? "danger" : "primary"}
                    icon={timer.running ? "Timer" : "Zap"}
                    onClick={() => setTimer({ running: !timer.running })}
                  >
                    {timer.running ? "Pausa" : "Avvia"}
                  </Button>
                  <Button variant="primary" icon="Check" onClick={finishSession}>
                    Completa
                  </Button>
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <Field label="Sessione">
                    <input className={inputClass} value={sessionTitle} onChange={(event) => setSessionTitle(event.target.value)} />
                  </Field>
                  <Field label="Materia">
                    <select className={inputClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                      <option value="">Nessuna</option>
                      {subjects.map((subject) => (
                        <option key={subject.id} value={subject.id}>
                          {subject.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
            </div>
          </Panel>

          <Panel>
            <h3 className="mb-4 text-2xl font-black">Ripassi intelligenti</h3>
            <div className="grid gap-3">
              {dueReviews.map((topic) => (
                <div key={topic.id} className="quiet-panel p-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h4 className="two-line-safe text-lg font-black">{topic.title}</h4>
                      <p className="text-sm font-bold text-[var(--muted)]">{subjectName(subjects, topic.subjectId)}</p>
                    </div>
                    <Pill>{topic.completedReviews} ripassi</Pill>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <MiniScore label="Compr." value={topic.comprehension} />
                    <MiniScore label="Mem." value={topic.memorization} />
                    <MiniScore label="Diff." value={topic.difficulty} />
                  </div>
                  <Button className="mt-4 w-full" variant="primary" icon="Check" onClick={() => completeTopicReview(topic.id)}>
                    Ripasso fatto
                  </Button>
                </div>
              ))}
              {dueReviews.length === 0 ? <p className="text-sm text-[var(--muted)]">Nessun ripasso urgente oggi.</p> : null}
            </div>
          </Panel>

          <Panel>
            <h3 className="mb-4 text-2xl font-black">Storico studio</h3>
            <div className="space-y-3">
              {sessions.slice(0, 6).map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => updateSession(session.id, { status: session.status === "completed" ? "planned" : "completed" })}
                  className="quiet-panel flex w-full items-center gap-3 p-3 text-left"
                >
                  <span className="grid h-12 w-12 place-items-center rounded-super" style={{ background: subjectColor(subjects, session.subjectId) }}>
                    <Icon name="Timer" className="h-5 w-5 text-[#10131d]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="two-line-safe block font-black">{session.title}</span>
                    <span className="text-sm font-bold text-[var(--muted)]">
                      {session.actualMinutes || session.plannedMinutes} min · {subjectName(subjects, session.subjectId)}
                    </span>
                  </span>
                  <Pill active={session.status === "completed"}>{session.status}</Pill>
                </button>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="grid content-start gap-4">
          <Panel>
            <h3 className="mb-4 text-2xl font-black">Settimana</h3>
            <div className="text-6xl font-black">{Math.round((weeklyMinutes / 60) * 10) / 10}h</div>
            <p className="mt-1 text-sm font-bold text-[var(--muted)]">studio completato</p>
            <div className="mt-5">
              <ProgressBar value={Math.min(100, (weeklyMinutes / (18 * 60)) * 100)} />
            </div>
          </Panel>

          <Panel>
            <h3 className="mb-4 text-2xl font-black">Template sessione</h3>
            <div className="grid gap-2">
              {["nuovo argomento", "ripasso", "esercizi", "simulazione", "lettura PDF", "orale"].map((template) => (
                <div key={template} className="quiet-panel flex items-center justify-between p-3">
                  <span className="font-black">{template}</span>
                  <Icon name="ChevronRight" className="h-4 w-4 text-[var(--faint)]" />
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <h3 className="mb-4 text-2xl font-black">Prossimi ripassi</h3>
            <div className="space-y-3">
              {topics
                .slice()
                .sort((a, b) => a.nextReviewDate.localeCompare(b.nextReviewDate))
                .slice(0, 5)
                .map((topic) => (
                  <div key={topic.id} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="two-line-safe block text-sm font-black">{topic.title}</span>
                      <span className="text-xs font-bold text-[var(--muted)]">{shortDate(topic.nextReviewDate)}</span>
                    </span>
                    <span className="text-xs font-black text-[var(--accent)]">
                      {formatDistanceToNow(parseISO(topic.nextReviewDate), { addSuffix: true, locale: it })}
                    </span>
                  </div>
                ))}
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}

function MiniScore({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-[18px] bg-[var(--surface-soft)] p-2">
      <div className="text-lg font-black">{value}/5</div>
      <div className="text-[11px] font-bold text-[var(--muted)]">{label}</div>
    </div>
  );
}
