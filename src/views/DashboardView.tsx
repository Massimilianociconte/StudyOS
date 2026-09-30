import { format, isSameDay, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { AppView } from "../types";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { dueTopics } from "../lib/review";
import {
  completionRate,
  daysUntil,
  isAllDayEvent,
  shortDate,
  studyDaysLabel,
  studyDaysUntil,
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
import {
  ALL_DAY_LABEL,
  ATTACHMENT_KIND_ICON,
  ENERGY_LABEL,
  EVENT_CATEGORY_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  SUBJECT_STATUS_LABEL,
  attachmentKind,
  capitalizeFirst,
  formatHours,
  formatMinutes
} from "../lib/labels";
import { Icon } from "../components/Icon";
import { Button, Panel, ProgressBar, SectionTitle, Tag } from "../components/ui";


function PanelHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="text-lg font-black">{title}</h3>
      {action && onAction ? (
        <button type="button" onClick={onAction} className="inline-flex items-center gap-1 text-xs font-black text-[var(--muted)] hover:text-[var(--text)]">
          {action} <Icon name="ChevronRight" className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function DashboardView() {
  const store = useStudyStore();
  const { events, tasks, subjects, exams, sessions, attachments, goals, topics, setActiveView, toggleTask } = store;
  const today = todayEvents(events);
  const now = new Date();
  const todayTasks = tasks.filter((task) => task.dueDate && task.status !== "archived" && isSameDay(parseISO(task.dueDate), now));
  const urgent = urgentTasks(tasks, 4);
  const nextEvents = upcomingEvents(events, 6).filter((event) => !isSameDay(parseISO(event.start), now)).slice(0, 5);
  const nextExams = upcomingExams(exams, 4);
  const weeklyMinutes = studyMinutesThisWeek(sessions);
  const streak = studyStreak(sessions);
  const doneRate = completionRate(tasks.filter((task) => task.status !== "archived"));
  const openTasks = tasks.filter((task) => task.status !== "done" && task.status !== "archived");
  const activeSubjects = subjects.filter((subject) => ["active", "review", "exam-ready"].includes(subject.status));
  const nextTask = urgent[0];
  const preferences = selectPreferences(store);
  const weeklyTarget = preferences.weeklyTargetMinutes;
  const displayName = preferences.displayName.trim();
  const welcomeName = displayName ? displayName.split(/[ @]/).filter(Boolean)[0] : "";
  const recentAttachments = [...attachments].sort((a, b) => b.addedAt.localeCompare(a.addedAt)).slice(0, 4);
  const reviewsDue = dueTopics(topics, now);

  const stats = [
    {
      label: "Studio questa settimana",
      value: `${formatHours(weeklyMinutes)} h`,
      detail: `Obiettivo ${formatHours(weeklyTarget)} h`,
      progress: (weeklyMinutes / weeklyTarget) * 100,
      icon: "Timer",
      tone: "var(--accent)",
      view: "study" as const
    },
    {
      label: "Streak",
      value: `${streak} ${streak === 1 ? "giorno" : "giorni"}`,
      detail: streak ? "di studio consecutivo" : "Studia oggi per iniziare",
      icon: "Flame",
      tone: "var(--accent-3)",
      view: "study" as const
    },
    {
      label: "Task completate",
      value: `${doneRate}%`,
      detail: `${openTasks.length} ancora aperte`,
      progress: doneRate,
      icon: "Check",
      tone: "var(--accent-2)",
      view: "tasks" as const
    },
    {
      label: "Prossimo esame",
      value: nextExams[0] ? `${studyDaysUntil(nextExams[0].date)} gg` : "—",
      detail: nextExams[0] ? subjectName(subjects, nextExams[0].subjectId) : "Nessun esame pianificato",
      icon: "GraduationCap",
      tone: "var(--warning)",
      view: "exams" as const
    }
  ];

  return (
    <div>
      <SectionTitle
        title={welcomeName ? `Bentornato, ${welcomeName}` : "Dashboard"}
        subtitle={`${capitalizeFirst(format(now, "EEEE d MMMM", { locale: it }))} · ${today.length} ${today.length === 1 ? "evento" : "eventi"} e ${todayTasks.length} task in programma oggi`}
        action={
          <Button icon="Timer" variant="soft" onClick={() => setActiveView("study")} title="Vai al timer di studio">
            Inizia a studiare
          </Button>
        }
      />

      {!subjects.length && !tasks.length && !events.length ? (
        <GettingStarted showBarb={preferences.showBarb} hasName={Boolean(displayName)} onGo={setActiveView} />
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <button
            key={stat.label}
            type="button"
            onClick={() => setActiveView(stat.view)}
            aria-label={`${stat.label}: ${stat.value}. Vai alla sezione.`}
            className="quiet-panel motion-safe group min-w-0 p-3.5 text-left hover:bg-[var(--surface)]"
          >
            <div className="flex items-center gap-2 text-[11px] font-black uppercase text-[var(--faint)]">
              <span className="grid grid-cols-1 h-5 w-5 place-items-center rounded-full" style={{ background: `color-mix(in srgb, ${stat.tone} 28%, transparent)` }}>
                <Icon name={stat.icon} className="h-3 w-3 text-[var(--text)]" />
              </span>
              <span className="truncate">{stat.label}</span>
              <Icon name="ChevronRight" className="ml-auto h-3.5 w-3.5 shrink-0 transition-transform group-hover:translate-x-0.5" />
            </div>
            <p className="mt-1 truncate text-2xl font-black">
              {stat.value}
            </p>
            <p className="truncate text-xs font-bold text-[var(--muted)]">{stat.detail}</p>
            {stat.progress !== undefined ? (
              <div className="mt-2">
                <ProgressBar value={stat.progress} color={stat.tone} />
              </div>
            ) : null}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-1 min-w-0 content-start gap-4">
          <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <Panel>
              <PanelHeader title="Piano di oggi" action="Calendario" onAction={() => setActiveView("calendar")} />
              {today.length || todayTasks.length || reviewsDue.length ? (
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                  {today.map((event) => (
                    <li key={event.occurrenceKey}>
                      <button
                        type="button"
                        onClick={() => setActiveView("calendar")}
                        className={`flex w-full min-w-0 items-center gap-3 rounded-[16px] px-2 py-2 text-left hover:bg-[var(--surface-soft)] ${
                          parseISO(event.end) < now ? "opacity-55" : ""
                        }`}
                      >
                        {isAllDayEvent(event) ? (
                          <span className="w-11 shrink-0 text-center text-xs font-black text-[var(--faint)]" title={ALL_DAY_LABEL} aria-hidden="true">
                            —
                          </span>
                        ) : (
                          <span className="w-11 shrink-0 text-xs font-black tabular-nums">{timeLabel(event.start)}</span>
                        )}
                        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: event.color || subjectColor(subjects, event.subjectId) }} />
                        <span className="min-w-0 flex-1">
                          <span className="one-line-safe block text-sm font-extrabold">{event.title}</span>
                          <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
                            {isAllDayEvent(event) ? ALL_DAY_LABEL : `${timeLabel(event.start)}–${timeLabel(event.end)}`} ·{" "}
                            {event.subjectId ? subjectName(subjects, event.subjectId) : EVENT_CATEGORY_LABEL[event.category]}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                  {todayTasks.map((task) => (
                    <li key={task.id} className="flex min-w-0 items-center gap-3 rounded-[16px] px-2 py-1.5">
                      <button
                        type="button"
                        onClick={() => void toggleTask(task.id)}
                        aria-label={task.status === "done" ? `Riapri "${task.title}"` : `Completa "${task.title}"`}
                        className={`relative ml-3 grid h-5 w-5 shrink-0 place-items-center rounded-full border-2 after:absolute after:-inset-3 after:content-[""] ${
                          task.status === "done" ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--faint)]"
                        }`}
                      >
                        {task.status === "done" ? <Icon name="Check" className="h-3 w-3" /> : null}
                      </button>
                      <span className={`one-line-safe min-w-0 flex-1 pl-3 text-sm font-bold ${task.status === "done" ? "text-[var(--faint)] line-through" : ""}`}>
                        {task.title}
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-black text-[var(--muted)]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_TONE[task.priority] }} />
                        {PRIORITY_LABEL[task.priority]}
                      </span>
                    </li>
                  ))}
                  {reviewsDue.length ? (
                    <li>
                      <button
                        type="button"
                        onClick={() => setActiveView("study")}
                        className="flex w-full min-w-0 items-center gap-3 rounded-[16px] px-2 py-2 text-left hover:bg-[var(--surface-soft)]"
                      >
                        <span className="grid w-11 shrink-0 place-items-center">
                          <Icon name="Brain" className="h-4 w-4 text-[var(--accent-ink)]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="one-line-safe block text-sm font-extrabold">
                            {reviewsDue.length} {reviewsDue.length === 1 ? "argomento da ripassare" : "argomenti da ripassare"}
                          </span>
                          <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
                            {reviewsDue.slice(0, 3).map((topic) => topic.title).join(" · ")}
                          </span>
                        </span>
                        <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--faint)]" />
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <p className="rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm font-bold text-[var(--muted)]">Giornata libera: niente in calendario.</p>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Prossima mossa" action="Task" onAction={() => setActiveView("tasks")} />
              {nextTask ? (
                <div>
                  <p className="two-line-safe text-xl font-black leading-tight">{nextTask.title}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Tag color={PRIORITY_TONE[nextTask.priority]}>{PRIORITY_LABEL[nextTask.priority]}</Tag>
                    {nextTask.dueDate ? (
                      <Tag className={daysUntil(nextTask.dueDate) < 0 ? "text-[var(--danger-text)]" : ""}>
                        {daysUntil(nextTask.dueDate) < 0 ? "In ritardo" : `Scade ${shortDate(nextTask.dueDate)}`}
                      </Tag>
                    ) : null}
                    {nextTask.subjectId ? <Tag color={subjectColor(subjects, nextTask.subjectId)}>{subjectName(subjects, nextTask.subjectId)}</Tag> : null}
                  </div>
                  <p className="mt-2 text-xs font-bold text-[var(--muted)]">
                    {formatMinutes(nextTask.estimatedMinutes)} · {ENERGY_LABEL[nextTask.energy]} · Importanza {nextTask.importance}/5
                  </p>
                  {urgent.length > 1 ? (
                    <ul className="mt-3 grid gap-1 border-t border-[var(--border)] pt-3">
                      {urgent.slice(1).map((task) => (
                        <li key={task.id} className="flex min-w-0 items-center gap-2 text-sm">
                          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_TONE[task.priority] }} />
                          <span className="one-line-safe min-w-0 flex-1 font-bold">{task.title}</span>
                          {task.dueDate ? <span className="shrink-0 text-xs font-bold text-[var(--muted)]">{shortDate(task.dueDate)}</span> : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-[var(--muted)]">Aggiungi task con scadenza o importanza per far emergere un suggerimento.</p>
              )}
            </Panel>
          </div>

          <Panel>
            <PanelHeader title="Esami in arrivo" action="Esami" onAction={() => setActiveView("exams")} />
            {nextExams.length ? (
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {nextExams.map((exam) => {
                  const color = subjectColor(subjects, exam.subjectId);
                  const days = studyDaysUntil(exam.date);
                  return (
                    <li key={exam.id} className="flex min-w-0 items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] p-3">
                      <div className="grid grid-cols-1 w-14 shrink-0 place-items-center rounded-[14px] py-1.5 text-center" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}>
                        <span className="text-xl font-black leading-none tabular-nums">{days}</span>
                        <span className="text-[10px] font-black uppercase text-[var(--muted)]">{days === 1 ? "giorno" : "giorni"}</span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="two-line-safe text-sm font-black leading-tight">{subjectName(subjects, exam.subjectId)}</p>
                        <p className="text-xs font-bold text-[var(--muted)]">
                          {capitalizeFirst(format(parseISO(exam.date), "EEE d MMM", { locale: it }))} · {exam.preparation}% pronto
                        </p>
                        <div className="mt-1.5">
                          <ProgressBar value={exam.preparation} color={color} />
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Nessun esame pianificato.{" "}
                <button type="button" onClick={() => setActiveView("exams")} className="font-black text-[var(--accent-ink)] hover:underline">
                  Aggiungi il primo →
                </button>
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader title={`Materie attive · ${activeSubjects.length}`} action="Materie" onAction={() => setActiveView("subjects")} />
            {activeSubjects.length ? (
              <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {activeSubjects.map((subject) => (
                  <li key={subject.id}>
                    <button
                      type="button"
                      onClick={() => setActiveView("subjects")}
                      className="flex w-full min-w-0 items-center gap-3 rounded-[16px] px-2 py-2 text-left hover:bg-[var(--surface-soft)]"
                    >
                      <span className="grid grid-cols-1 h-9 w-9 shrink-0 place-items-center rounded-super" style={{ background: subject.color }}>
                        <Icon name={subject.icon} className="h-4 w-4 text-[#10131d]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="one-line-safe block text-sm font-black">{subject.name}</span>
                        <span className="text-xs font-bold text-[var(--muted)]">
                          {SUBJECT_STATUS_LABEL[subject.status]} · {subject.cfu} CFU
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Nessuna materia attiva.{" "}
                <button type="button" onClick={() => setActiveView("subjects")} className="font-black text-[var(--accent-ink)] hover:underline">
                  Aggiungi la prima →
                </button>
              </p>
            )}
          </Panel>
        </div>

        <aside className="grid grid-cols-1 min-w-0 content-start gap-4">
          <Panel>
            <PanelHeader title="Prossimi giorni" action="Calendario" onAction={() => setActiveView("calendar")} />
            {nextEvents.length ? (
              <ul className="grid grid-cols-1 gap-2.5">
                {nextEvents.map((event) => (
                  <li key={event.occurrenceKey} className="flex min-w-0 gap-3">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: event.color || subjectColor(subjects, event.subjectId) }} />
                    <div className="min-w-0 flex-1">
                      <p className="one-line-safe text-sm font-black">{event.title}</p>
                      <p className="text-xs font-bold text-[var(--muted)]">
                        {capitalizeFirst(format(parseISO(event.start), "EEE d MMM", { locale: it }))} ·{" "}
                        {isAllDayEvent(event) ? ALL_DAY_LABEL : timeLabel(event.start)}
                        {event.category === "deadline" || event.category === "exam" ? ` · ${studyDaysLabel(event.start)}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Niente in programma.{" "}
                <button type="button" onClick={() => setActiveView("calendar")} className="font-black text-[var(--accent-ink)] hover:underline">
                  Apri il calendario →
                </button>
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Obiettivi" action="Obiettivi" onAction={() => setActiveView("goals")} />
            {goals.filter((goal) => goal.status === "active").length ? (
              <ul className="grid grid-cols-1 gap-3">
                {goals
                  .filter((goal) => goal.status === "active")
                  .slice(0, 3)
                  .map((goal) => (
                    <li key={goal.id}>
                      <div className="mb-1.5 flex items-center justify-between gap-2">
                        <span className="one-line-safe text-sm font-bold">{goal.title}</span>
                        <span className="shrink-0 text-xs font-black">{goal.progress}%</span>
                      </div>
                      <ProgressBar value={goal.progress} />
                    </li>
                  ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Nessun obiettivo attivo.{" "}
                <button type="button" onClick={() => setActiveView("goals")} className="font-black text-[var(--accent-ink)] hover:underline">
                  Creane uno →
                </button>
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Materiali recenti" action="Materiali" onAction={() => setActiveView("materials")} />
            {recentAttachments.length ? (
              <ul className="grid grid-cols-1 gap-1">
                {recentAttachments.map((attachment) => (
                  <li key={attachment.id}>
                    <button
                      type="button"
                      onClick={() => setActiveView("materials")}
                      className="flex w-full min-w-0 items-center gap-3 rounded-[14px] px-2 py-1.5 text-left hover:bg-[var(--surface-soft)]"
                    >
                      <Icon name={ATTACHMENT_KIND_ICON[attachmentKind(attachment)]} className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                      <span className="one-line-safe min-w-0 flex-1 text-sm font-bold">{attachment.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Nessun materiale.{" "}
                <button type="button" onClick={() => setActiveView("materials")} className="font-black text-[var(--accent-ink)] hover:underline">
                  Aggiungi PDF, immagini o link →
                </button>
              </p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

/** Primo avvio (nessuna materia, task o evento): tre passi per partire con i propri dati. */
function GettingStarted({ showBarb, hasName, onGo }: { showBarb: boolean; hasName: boolean; onGo: (view: AppView) => void }) {
  const steps: { icon: string; title: string; body: string; action: string; view: AppView }[] = [
    {
      icon: "BookOpen",
      title: "Aggiungi le materie",
      body: showBarb ? "Crea le tue materie o aggiungile dal piano del corso BARB." : "Crea le materie del semestre con CFU e docente.",
      action: showBarb ? "Apri il corso BARB" : "Vai a Materie",
      view: showBarb ? "barb" : "subjects"
    },
    {
      icon: "CalendarDays",
      title: "Porta l'orario delle lezioni",
      body: "Importa un file .ics (portale orari, Google o Apple Calendario) o crea le lezioni ripetute.",
      action: "Apri il calendario",
      view: "calendar"
    },
    {
      icon: "Target",
      title: hasName ? "Imposta l'obiettivo" : "Profilo e obiettivo",
      body: "Nome, ore di studio a settimana e CFU del corso: seguono il tuo account su ogni dispositivo.",
      action: "Apri le impostazioni",
      view: "settings"
    }
  ];
  return (
    <section className="soft-panel mb-4 p-4" aria-label="Primi passi">
      <h3 className="text-lg font-black">Primi passi</h3>
      <p className="mb-3 text-sm font-bold text-[var(--muted)]">StudyOS parte vuoto: tutto quello che vedrai sono i tuoi dati.</p>
      <ol className="grid grid-cols-1 gap-2 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title}>
            <button
              type="button"
              onClick={() => onGo(step.view)}
              className="flex h-full w-full min-w-0 flex-col items-start gap-1 rounded-[20px] bg-[var(--surface-soft)] p-3 text-left hover:bg-[var(--surface)]"
            >
              <span className="flex items-center gap-2 text-sm font-black">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-[var(--accent)] text-xs text-[#10131d]">{index + 1}</span>
                {step.title}
              </span>
              <span className="text-xs font-bold text-[var(--muted)]">{step.body}</span>
              <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-black text-[var(--accent-ink)]">
                <Icon name={step.icon} className="h-3.5 w-3.5" /> {step.action}
              </span>
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

