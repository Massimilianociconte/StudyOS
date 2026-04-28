import { format } from "date-fns";
import { it } from "date-fns/locale";
import { useStudyStore } from "../store/useStudyStore";
import {
  completionRate,
  daysUntil,
  shortDate,
  studyMinutesThisWeek,
  studyStreak,
  subjectColor,
  subjectName,
  timeLabel,
  todayEvents,
  upcomingExams,
  upcomingEvents,
  urgentTasks
} from "../lib/selectors";
import { Icon } from "../components/Icon";
import { Button, Panel, Pill, ProgressBar, ProgressRing, SectionTitle } from "../components/ui";

export function DashboardView() {
  const {
    events,
    tasks,
    subjects,
    exams,
    sessions,
    attachments,
    goals,
    setActiveView,
    settings
  } = useStudyStore();
  const today = todayEvents(events);
  const urgent = urgentTasks(tasks, 4);
  const nextEvents = upcomingEvents(events, 5);
  const nextExams = upcomingExams(exams, 3);
  const weeklyMinutes = studyMinutesThisWeek(sessions);
  const weeklyHours = Math.round((weeklyMinutes / 60) * 10) / 10;
  const streak = studyStreak(sessions);
  const doneRate = completionRate(tasks);
  const activeSubjects = subjects.filter((subject) => ["active", "review", "exam-ready"].includes(subject.status));
  const nextTask = urgent[0];

  return (
    <div>
      <SectionTitle
        title="Dashboard"
        subtitle="Il centro operativo della giornata: studio, scadenze, materiali e prossima azione."
        action={
          <Button icon="Timer" variant="soft" onClick={() => setActiveView("study")}>
            Focus mode
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.45fr_.85fr]">
        <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
          <Panel className="lg:col-span-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-black uppercase text-[var(--faint)]">
                  {format(new Date(), "EEEE d MMMM", { locale: it })}
                </p>
                <h3 className="mt-1 text-3xl font-black">Piano di oggi</h3>
              </div>
              <span className="grid h-14 w-14 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
                <Icon name="CalendarDays" className="h-6 w-6" />
              </span>
            </div>

            <div className="mt-5 grid gap-3">
              {today.length > 0 ? (
                today.map((event) => (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setActiveView("calendar")}
                    className="motion-safe quiet-panel flex items-center gap-3 p-3 text-left hover:translate-y-[-2px]"
                  >
                    <span
                      className="h-12 w-2 rounded-full"
                      style={{ background: event.color || subjectColor(subjects, event.subjectId) }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-black">{event.title}</span>
                      <span className="block truncate text-sm text-[var(--muted)]">
                        {timeLabel(event.start)} - {timeLabel(event.end)} · {subjectName(subjects, event.subjectId)}
                      </span>
                    </span>
                    <Pill active={event.priority === "urgent"}>{event.priority}</Pill>
                  </button>
                ))
              ) : (
                <div className="quiet-panel p-5 text-sm font-bold text-[var(--muted)]">Nessun blocco per oggi.</div>
              )}
            </div>
          </Panel>

          <Panel className="lg:col-span-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-[var(--faint)]">Prossima mossa</p>
                <h3 className="two-line-safe mt-1 text-2xl font-black">{nextTask?.title ?? "Scegli un task"}</h3>
              </div>
              <span className="grid h-12 w-12 place-items-center rounded-super bg-[var(--accent-3)] text-white">
                <Icon name="Sparkles" className="h-5 w-5" />
              </span>
            </div>
            <p className="three-line-safe mt-3 text-sm font-medium text-[var(--muted)]">
              {nextTask
                ? `${nextTask.estimatedMinutes} min, energia ${nextTask.energy}, importanza ${nextTask.importance}/5.`
                : "Aggiungi task con scadenza o importanza per far emergere un suggerimento."}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <div className="quiet-panel p-4">
                <div className="text-3xl font-black">{urgent.length}</div>
                <div className="text-xs font-bold text-[var(--muted)]">task critici</div>
              </div>
              <div className="quiet-panel p-4">
                <div className="text-3xl font-black">{nextExams.length}</div>
                <div className="text-xs font-bold text-[var(--muted)]">esami in vista</div>
              </div>
            </div>
            <Button className="mt-5 w-full" variant="primary" icon="Zap" onClick={() => setActiveView("tasks")}>
              Apri piano task
            </Button>
          </Panel>

          <Panel className="lg:col-span-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-black uppercase text-[var(--faint)]">Ore studiate</p>
                <h3 className="text-5xl font-black">{weeklyHours}</h3>
              </div>
              <ProgressRing value={Math.min(100, (weeklyMinutes / (18 * 60)) * 100)} label="18h" />
            </div>
            <ProgressBar value={Math.min(100, (weeklyMinutes / (18 * 60)) * 100)} />
          </Panel>

          <Panel className="lg:col-span-4">
            <p className="text-xs font-black uppercase text-[var(--faint)]">Streak studio</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-6xl font-black">{streak}</div>
                <p className="two-line-safe text-sm font-bold text-[var(--muted)]">giorni consecutivi</p>
              </div>
              <span className="grid h-24 w-24 place-items-center rounded-super bg-[var(--surface)] text-[var(--accent-3)]">
                <Icon name="Flame" className="h-10 w-10" />
              </span>
            </div>
          </Panel>

          <Panel className="lg:col-span-4">
            <p className="text-xs font-black uppercase text-[var(--faint)]">Task completate</p>
            <div className="mt-3 flex items-center gap-4">
              <ProgressRing value={doneRate} label="done" color="var(--accent-2)" />
              <div className="min-w-0">
                <h3 className="text-2xl font-black">{doneRate}%</h3>
                <p className="safe-text text-sm text-[var(--muted)]">
                  {tasks.filter((task) => task.status === "done").length} completate su {tasks.length}
                </p>
              </div>
            </div>
          </Panel>

          <Panel className="lg:col-span-7">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-2xl font-black">Esami in arrivo</h3>
              <Button variant="ghost" icon="GraduationCap" onClick={() => setActiveView("exams")}>
                Vedi
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              {nextExams.map((exam) => {
                const color = subjectColor(subjects, exam.subjectId);
                return (
                  <div key={exam.id} className="quiet-panel p-4">
                    <div className="mb-4 h-2 rounded-full" style={{ background: color }} />
                    <h4 className="two-line-safe text-lg font-black">{subjectName(subjects, exam.subjectId)}</h4>
                    <p className="text-sm font-bold text-[var(--muted)]">{shortDate(exam.date)}</p>
                    <div className="mt-4 text-4xl font-black">{daysUntil(exam.date)}</div>
                    <p className="text-xs font-bold text-[var(--muted)]">giorni rimasti</p>
                    <div className="mt-4">
                      <ProgressBar value={exam.preparation} color={color} />
                    </div>
                  </div>
                );
              })}
            </div>
          </Panel>

          <Panel className="lg:col-span-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h3 className="safe-text min-w-0 text-2xl font-black">Materie attive</h3>
              <Pill>{activeSubjects.length} attive</Pill>
            </div>
            <div className="grid gap-2">
              {activeSubjects.map((subject) => (
                <button
                  type="button"
                  key={subject.id}
                  onClick={() => setActiveView("subjects")}
                  className="quiet-panel flex min-w-0 max-w-full items-center gap-3 overflow-hidden p-3 text-left"
                >
                  <span className="grid h-11 w-11 place-items-center rounded-super" style={{ background: subject.color }}>
                    <Icon name={subject.icon} className="h-5 w-5 text-[#10131d]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="two-line-safe block font-black">{subject.name}</span>
                    <span className="text-xs font-bold text-[var(--muted)]">{subject.status}</span>
                  </span>
                  <span className="shrink-0 text-sm font-black">{subject.cfu} CFU</span>
                </button>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="grid min-w-0 gap-4">
          <Panel>
            <h3 className="mb-4 text-2xl font-black">Timeline</h3>
            <div className="space-y-3">
              {nextEvents.map((event) => (
                <div key={event.id} className="flex gap-3">
                  <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: event.color }} />
                  <div className="min-w-0 flex-1">
                    <p className="two-line-safe text-sm font-black">{event.title}</p>
                    <p className="text-xs font-bold text-[var(--muted)]">
                      {shortDate(event.start)} · {timeLabel(event.start)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel>
            <h3 className="mb-4 text-2xl font-black">Materiali recenti</h3>
            <div className="space-y-2">
              {attachments.slice(0, 4).map((attachment) => (
                <button
                  key={attachment.id}
                  type="button"
                  onClick={() => setActiveView("materials")}
                  className="quiet-panel flex w-full items-center gap-3 p-3 text-left"
                >
                  <Icon name="Paperclip" className="h-4 w-4 shrink-0 text-[var(--accent)]" />
                  <span className="two-line-safe min-w-0 flex-1 text-sm font-black">{attachment.name}</span>
                </button>
              ))}
              {attachments.length === 0 ? <p className="text-sm text-[var(--muted)]">Aggiungi PDF, immagini o link.</p> : null}
            </div>
          </Panel>

          <Panel>
            <h3 className="text-2xl font-black">Obiettivi</h3>
            <div className="mt-4 space-y-4">
              {goals.slice(0, 3).map((goal) => (
                <div key={goal.id}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="two-line-safe text-sm font-black">{goal.title}</span>
                    <span className="text-xs font-black">{goal.progress}%</span>
                  </div>
                  <ProgressBar value={goal.progress} />
                </div>
              ))}
            </div>
          </Panel>

          <Panel className="overflow-hidden">
            <div className="flex items-center gap-3">
              <span className="grid h-16 w-16 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
                <Icon name={settings.security.mode === "vault" ? "Lock" : "Shield"} className="h-7 w-7" />
              </span>
              <div className="min-w-0">
                <h3 className="text-xl font-black">
                  {settings.security.mode === "vault" ? "Workspace cifrato" : "Local-first"}
                </h3>
                <p className="safe-text text-sm text-[var(--muted)]">IndexedDB locale, backup manuali e nessuna API esterna.</p>
              </div>
            </div>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
