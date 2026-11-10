import { useState } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { AppView } from "../types";
import { openQuickAdd } from "../lib/quickAdd";
import { requestSettingsSection } from "../lib/settingsJump";
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
import { SEMESTER_LABEL, SEMESTER_TONE, subjectSemester } from "../lib/semesters";
import { CourseIcon } from "../components/CourseIcon";
import { BARB_DATASET } from "../data/university/barb.dataset";
import { resolveBarbCourse } from "../lib/university/examSessions";
import { safeCssColor } from "../lib/sharing";


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

  const nextExamDays = nextExams[0] ? studyDaysUntil(nextExams[0].date) : 0;
  const stats = [
    {
      label: "Studio della settimana",
      value: `${formatHours(weeklyMinutes)} h`,
      detail: `su ${formatHours(weeklyTarget)} h di obiettivo`,
      progress: (weeklyMinutes / weeklyTarget) * 100,
      icon: "Timer",
      tone: "var(--accent)",
      view: "study" as const
    },
    {
      label: "Giorni di fila",
      value: `${streak} ${streak === 1 ? "giorno" : "giorni"}`,
      detail: streak ? "in cui hai studiato" : "Studia oggi per iniziare",
      icon: "Flame",
      tone: "var(--accent-3)",
      view: "study" as const
    },
    {
      label: "Attività fatte",
      value: `${doneRate}%`,
      detail: openTasks.length ? `${openTasks.length} ancora da fare` : "Niente in sospeso",
      progress: doneRate,
      icon: "Check",
      tone: "var(--accent-2)",
      view: "tasks" as const
    },
    {
      label: "Prossimo esame",
      value: nextExams[0] ? (nextExamDays === 0 ? "Oggi" : `tra ${nextExamDays} ${nextExamDays === 1 ? "giorno" : "giorni"}`) : "—",
      detail: nextExams[0] ? subjectName(subjects, nextExams[0].subjectId) : "Nessun esame in programma",
      icon: "GraduationCap",
      tone: "var(--warning)",
      view: "exams" as const
    }
  ];

  const todayCount = today.length + todayTasks.length;
  const todaySummary = todayCount
    ? `oggi hai ${[
        today.length ? `${today.length} ${today.length === 1 ? "impegno" : "impegni"}` : "",
        todayTasks.length ? `${todayTasks.length} attività in scadenza` : ""
      ]
        .filter(Boolean)
        .join(" e ")}`
    : "niente in programma per oggi";

  return (
    <div>
      <SectionTitle
        title={welcomeName ? `Ciao, ${welcomeName}` : "Home"}
        subtitle={`${capitalizeFirst(format(now, "EEEE d MMMM", { locale: it }))} · ${todaySummary}`}
        action={
          <Button icon="Timer" variant="soft" onClick={() => setActiveView("study")} title="Apre il timer nella sezione Studio">
            Inizia a studiare
          </Button>
        }
      />

      <GettingStarted
        showBarb={preferences.showBarb}
        done={{ subjects: subjects.length > 0, calendar: events.length > 0, tasks: tasks.length > 0, profile: Boolean(displayName) }}
        onGo={setActiveView}
      />

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
              <PanelHeader title="Oggi" action="Apri calendario" onAction={() => setActiveView("calendar")} />
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
                        <span className="h-8 w-1 shrink-0 rounded-full" style={{ background: safeCssColor(event.color) || subjectColor(subjects, event.subjectId) }} />
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
                <p className="rounded-[16px] border border-dashed border-[var(--border)] p-4 text-sm font-bold text-[var(--muted)]">
                  Niente in programma oggi.{" "}
                  <button type="button" onClick={() => openQuickAdd("event")} className="font-black text-[var(--accent-ink)] hover:underline">
                    Aggiungi un impegno →
                  </button>
                </p>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Cosa fare adesso" action="Tutte le attività" onAction={() => setActiveView("tasks")} />
              {nextTask ? (
                <div>
                  <p className="two-line-safe text-xl font-black leading-tight">{nextTask.title}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Tag color={PRIORITY_TONE[nextTask.priority]}>{PRIORITY_LABEL[nextTask.priority]}</Tag>
                    {nextTask.dueDate ? (
                      <Tag className={daysUntil(nextTask.dueDate) < 0 ? "text-[var(--danger-text)]" : ""}>
                        {daysUntil(nextTask.dueDate) < 0 ? "Scaduta" : `Entro ${shortDate(nextTask.dueDate)}`}
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
                <p className="text-sm text-[var(--muted)]">
                  Qui comparirà la cosa più urgente da fare.{" "}
                  <button type="button" onClick={() => openQuickAdd("task")} className="font-black text-[var(--accent-ink)] hover:underline">
                    Aggiungi un'attività →
                  </button>
                </p>
              )}
            </Panel>
          </div>

          <Panel>
            <PanelHeader title="Esami in arrivo" action="Tutti gli esami" onAction={() => setActiveView("exams")} />
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
                          {capitalizeFirst(format(parseISO(exam.date), "EEE d MMM", { locale: it }))} · preparazione {exam.preparation}%
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
                Nessun esame in programma.{" "}
                <button type="button" onClick={() => setActiveView("exams")} className="font-black text-[var(--accent-ink)] hover:underline">
                  Aggiungi il primo →
                </button>
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader title={activeSubjects.length ? `Le tue materie · ${activeSubjects.length}` : "Le tue materie"} action="Tutte le materie" onAction={() => setActiveView("subjects")} />
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
                        {resolveBarbCourse(subject, BARB_DATASET.courses) ? <CourseIcon course={resolveBarbCourse(subject, BARB_DATASET.courses)!} className="h-4 w-4 text-[#10131d]" /> : <Icon name={subject.icon} className="h-4 w-4 text-[#10131d]" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="one-line-safe block text-sm font-black">{subject.name}</span>
                        <span className="text-xs font-bold text-[var(--muted)]">
                          {SUBJECT_STATUS_LABEL[subject.status]} · {subject.cfu} CFU
                        </span>
                        <span className="mt-1 block"><Tag color={SEMESTER_TONE[subjectSemester(subject)]}>{SEMESTER_LABEL[subjectSemester(subject)]}</Tag></span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-[var(--muted)]">
                Nessuna materia in corso.{" "}
                <button type="button" onClick={() => setActiveView("subjects")} className="font-black text-[var(--accent-ink)] hover:underline">
                  Aggiungi la prima →
                </button>
              </p>
            )}
          </Panel>
        </div>

        <aside className="grid grid-cols-1 min-w-0 content-start gap-4">
          <Panel>
            <PanelHeader title="Prossimi giorni" action="Apri calendario" onAction={() => setActiveView("calendar")} />
            {nextEvents.length ? (
              <ul className="grid grid-cols-1 gap-2.5">
                {nextEvents.map((event) => (
                  <li key={event.occurrenceKey} className="flex min-w-0 gap-3">
                    <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: safeCssColor(event.color) || subjectColor(subjects, event.subjectId) }} />
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
                Niente in programma nei prossimi giorni.{" "}
                <button type="button" onClick={() => openQuickAdd("event")} className="font-black text-[var(--accent-ink)] hover:underline">
                  Aggiungi un impegno →
                </button>
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Obiettivi" action="Tutti gli obiettivi" onAction={() => setActiveView("goals")} />
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
                Nessun obiettivo in corso.{" "}
                <button type="button" onClick={() => setActiveView("goals")} className="font-black text-[var(--accent-ink)] hover:underline">
                  Creane uno →
                </button>
              </p>
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Ultimi materiali" action="Tutti i materiali" onAction={() => setActiveView("materials")} />
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
                Ancora nessun materiale.{" "}
                <button type="button" onClick={() => setActiveView("materials")} className="font-black text-[var(--accent-ink)] hover:underline">
                  Aggiungi PDF, slide o link →
                </button>
              </p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  );
}

const GETTING_STARTED_HIDDEN_KEY = "studyos-getting-started-hidden";

const readHidden = () => {
  try {
    return localStorage.getItem(GETTING_STARTED_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
};

/**
 * Guida dei primi passi: resta in Home finché i quattro passi non sono fatti (o finché non la
 * si nasconde su questo dispositivo). Ogni passo si spunta da solo quando i dati ci sono.
 */
function GettingStarted({
  showBarb,
  done,
  onGo
}: {
  showBarb: boolean;
  done: { subjects: boolean; calendar: boolean; tasks: boolean; profile: boolean };
  onGo: (view: AppView) => void;
}) {
  const [hidden, setHidden] = useState(readHidden);
  const steps: { key: keyof typeof done; icon: string; title: string; body: string; action: string; run: () => void }[] = [
    {
      key: "subjects",
      icon: "BookOpen",
      title: "Aggiungi le tue materie",
      body: showBarb
        ? "Scegli gli insegnamenti del tuo piano dal Corso di laurea, oppure creali a mano."
        : "Crea i corsi che stai seguendo: li userai per lezioni, attività ed esami.",
      action: showBarb ? "Scegli dal Corso di laurea" : "Aggiungi una materia",
      run: () => (showBarb ? onGo("barb") : openQuickAdd("subject"))
    },
    {
      key: "calendar",
      icon: "CalendarDays",
      title: "Inserisci le lezioni",
      body: "Segna gli orari delle lezioni, anche ripetuti ogni settimana, o importali da Google o Apple Calendar.",
      action: "Apri il calendario",
      run: () => onGo("calendar")
    },
    {
      key: "tasks",
      icon: "Check",
      title: "Scrivi la prima cosa da fare",
      body: "Un esercizio, una consegna, un capitolo: con una scadenza te lo ricorderemo qui al momento giusto.",
      action: "Aggiungi un'attività",
      run: () => openQuickAdd("task")
    },
    {
      key: "profile",
      icon: "User",
      title: "Completa il profilo",
      body: "Il tuo nome e quante ore vuoi studiare ogni settimana.",
      action: "Apri il profilo",
      run: () => {
        requestSettingsSection("profilo");
        onGo("settings");
      }
    }
  ];
  const completed = steps.filter((step) => done[step.key]).length;
  if (hidden || completed === steps.length) return null;
  const nextKey = steps.find((step) => !done[step.key])?.key;

  const hide = () => {
    try {
      localStorage.setItem(GETTING_STARTED_HIDDEN_KEY, "1");
    } catch {
      // senza storage la guida si nasconde solo fino al prossimo caricamento
    }
    setHidden(true);
  };

  return (
    <section className="soft-panel mb-4 p-4" aria-labelledby="getting-started-title">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id="getting-started-title" className="text-lg font-black">
            Per iniziare
          </h3>
          <p className="text-sm font-bold text-[var(--muted)]">
            {completed ? `Hai fatto ${completed} ${completed === 1 ? "passo" : "passi"} su ${steps.length}. ` : "Quattro passi e StudyOS è pronto. "}
            Puoi farli nell'ordine che preferisci.
          </p>
        </div>
        <Button variant="ghost" icon="EyeOff" className="min-h-9 px-3 text-xs" onClick={hide} title="Nasconde questa guida su questo dispositivo">
          Nascondi la guida
        </Button>
      </div>
      <ol className="grid grid-cols-1 gap-2 md:grid-cols-2 2xl:grid-cols-4">
        {steps.map((step, index) => {
          const isDone = done[step.key];
          const isNext = step.key === nextKey;
          return (
            <li key={step.key}>
              <button
                type="button"
                onClick={step.run}
                aria-label={`${isDone ? "Fatto: " : `Passo ${index + 1}: `}${step.title}. ${step.action}`}
                className={`flex h-full w-full min-w-0 flex-col items-start gap-1 rounded-[20px] bg-[var(--surface-soft)] p-3 text-left hover:bg-[var(--surface)] ${isDone ? "opacity-60" : ""}`}
              >
                <span className="flex items-center gap-2 text-sm font-black">
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-xs ${
                      isNext ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-strong)] text-[var(--text)]"
                    }`}
                  >
                    {isDone ? <Icon name="Check" className="h-3.5 w-3.5" /> : index + 1}
                  </span>
                  {step.title}
                </span>
                <span className="text-xs font-bold text-[var(--muted)]">{isDone ? "Fatto." : step.body}</span>
                {isDone ? null : (
                  <span className="mt-auto inline-flex items-center gap-1 pt-1 text-xs font-black text-[var(--accent-ink)]">
                    <Icon name={step.icon} className="h-3.5 w-3.5" /> {step.action} →
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
