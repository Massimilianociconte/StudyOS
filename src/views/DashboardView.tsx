import { useEffect, useState, type ReactNode } from "react";
import { format, isSameDay, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import type { AppView, Subject } from "../types";
import type { BarbCourse } from "../lib/university/types";
import { openQuickAdd } from "../lib/quickAdd";
import { requestSettingsSection } from "../lib/settingsJump";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { dueTopics } from "../lib/review";
import {
  completionRate,
  daysUntil,
  isAllDayEvent,
  nextOccurrences,
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
  formatMinutes,
  HOME_HELP,
  HOME_OCCASIONS_TEXT,
  HOME_TEXT,
  occasionAgeText
} from "../lib/labels";
import { sanitizeTypeColorOverrides, themeTone } from "../lib/eventColors";
import { daySpanOf, eventPaint, upcomingAfterToday } from "../lib/calendarRender";
import { Icon } from "../components/Icon";
import { Button, HelpTip, Panel, ProgressBar, SectionTitle, Tag } from "../components/ui";
import { CourseIcon } from "../components/CourseIcon";
import { safeCssColor } from "../lib/sharing";
import { goToView } from "../hooks/useLinkedUiState";

type Help = { title: string; text: string; example?: string };

/** Collegamento testuale della Home: uno solo stile, sia nelle intestazioni sia negli stati vuoti. */
function TextLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 items-center gap-1 text-xs font-black text-[var(--accent-ink)] underline-offset-2 hover:underline"
    >
      {children} <Icon name="ChevronRight" className="h-3.5 w-3.5 shrink-0" />
    </button>
  );
}

function PanelHeader({ title, action, onAction, help }: { title: string; action?: string; onAction?: () => void; help?: Help }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-1.5">
        <h3 className="min-w-0 text-lg font-black">{title}</h3>
        {help ? <HelpTip {...help} /> : null}
      </span>
      {action && onAction ? <TextLink onClick={onAction}>{action}</TextLink> : null}
    </div>
  );
}

/** Riquadro senza dati: una riga e un solo collegamento per aggiungere. */
function EmptyLine({ text, action, onAction }: { text: string; action: string; onAction: () => void }) {
  return (
    <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-[var(--muted)]">
      {text} <TextLink onClick={onAction}>{action}</TextLink>
    </p>
  );
}

/** Riga cliccabile: tutte le righe della Home aprono l'elemento, con lo stesso aspetto. */
const ROW = "motion-safe flex w-full min-w-0 items-center gap-3 rounded-[16px] px-2 py-2 text-left hover:bg-[var(--surface-soft)]";
// Il nome della riga resta il suo testo visibile (ora, priorità, data, progresso): l'azione si aggiunge in coda, solo a voce.
const RowChevron = ({ action = HOME_TEXT.openAction }: { action?: string }) => (
  <>
    <span className="sr-only">, {action}</span>
    <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--faint)]" />
  </>
);

const openTask = (id: string) => goToView("tasks", [["tasks.editing", id, "tab"]]);
const openExam = (id: string) => goToView("exams", [["exams.editing", id, "tab"]]);
const openEvent = (id: string) => goToView("calendar", [["calendar.editingEvent", id, "tab"]]);
const openSubject = (id: string) => goToView("subjects", [["subjects.open", id, "tab"]]);
const openGoal = (id: string) => goToView("goals", [["goals.open", id, "tab"]]);
// Il materiale si ritrova cercandolo per nome, con tipo e materia azzerati (altrimenti un filtro lo nasconderebbe).
const findMaterial = (name: string) =>
  goToView("materials", [
    ["materials.query", name, "tab"],
    ["materials.kind", "all", "device"],
    ["materials.subject", "", "device"]
  ]);

type BarbLookup = {
  course: (subject: Subject) => BarbCourse | null;
  semester: (subject: Subject) => { label: string; tone: string };
};

/**
 * Catalogo dei corsi (icone e semestri) caricato a parte con `import()`: la Home è la prima schermata e
 * così il suo pacchetto non si porta dietro i dati BARB. Finché non arriva, le materie usano la loro icona.
 */
function useBarbLookup(enabled: boolean) {
  const [lookup, setLookup] = useState<BarbLookup | null>(null);
  useEffect(() => {
    if (!enabled || lookup) return;
    let alive = true;
    void Promise.all([import("../lib/semesters"), import("../lib/university/examSessions"), import("../data/university/barb.dataset")])
      .then(([semesters, sessions, data]) => {
        if (!alive) return;
        setLookup({
          course: (subject) => sessions.resolveBarbCourse(subject, data.BARB_DATASET.courses),
          semester: (subject) => {
            const id = semesters.subjectSemester(subject, data.BARB_DATASET.courses);
            return { label: semesters.SEMESTER_LABEL[id], tone: semesters.SEMESTER_TONE[id] };
          }
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled, lookup]);
  return lookup;
}

export function DashboardView() {
  const store = useStudyStore();
  const { events, tasks, subjects, exams, sessions, attachments, goals, topics, setActiveView, toggleTask } = store;
  const today = todayEvents(events);
  const now = new Date();
  const todayTasks = tasks.filter((task) => task.dueDate && task.status !== "archived" && isSameDay(parseISO(task.dueDate), now));
  const urgent = urgentTasks(tasks, 4);
  // Da domani in poi: prima si prendevano i primi 6 da oggi e poi si toglievano quelli di oggi, così con
  // tanti impegni oggi "Prossimi giorni" restava vuoto.
  const nextEvents = upcomingAfterToday(events, now, 5);
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
  const barb = useBarbLookup(activeSubjects.length > 0);
  // Compleanni e anniversari dei prossimi dodici mesi: la prossima volta di ciascuno, al massimo tre.
  const occasions = nextOccurrences(events, now).slice(0, 3);
  const theme = themeTone(store.settings.themeMode);
  // Come nel calendario: colori per tipologia scelti dall'utente e colore messo a mano.
  const typeOverrides = sanitizeTypeColorOverrides((preferences as { eventTypeColors?: unknown }).eventTypeColors);

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
              <PanelHeader title="Oggi" action={HOME_TEXT.openCalendar} onAction={() => setActiveView("calendar")} />
              {today.length || todayTasks.length || reviewsDue.length ? (
                <ul className="grid grid-cols-[minmax(0,1fr)] gap-1">
                  {today.map((event) => (
                    <li key={event.occurrenceKey}>
                      <button
                        type="button"
                        onClick={() => openEvent(event.id)}
                        className={`${ROW} ${parseISO(event.end) < now ? "opacity-55" : ""}`}
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
                        <RowChevron />
                      </button>
                    </li>
                  ))}
                  {todayTasks.map((task) => (
                    <li key={task.id} className="flex min-w-0 items-center gap-1 rounded-[16px] px-2">
                      <button
                        type="button"
                        onClick={() => void toggleTask(task.id)}
                        aria-label={task.status === "done" ? `Riapri "${task.title}"` : `Completa "${task.title}"`}
                        className={`relative ml-3 grid h-5 w-5 shrink-0 grid-cols-1 place-items-center rounded-full border-2 after:absolute after:-inset-3 after:content-[""] ${
                          task.status === "done" ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--faint)]"
                        }`}
                      >
                        {task.status === "done" ? <Icon name="Check" className="h-3 w-3" /> : null}
                      </button>
                      <button type="button" onClick={() => openTask(task.id)} className={`${ROW} ml-2 flex-1 pl-3`}>
                        <span className={`one-line-safe min-w-0 flex-1 text-sm font-bold ${task.status === "done" ? "text-[var(--faint)] line-through" : ""}`}>
                          {task.title}
                        </span>
                        <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-black text-[var(--muted)]">
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: PRIORITY_TONE[task.priority] }} />
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                        <RowChevron />
                      </button>
                    </li>
                  ))}
                  {reviewsDue.length ? (
                    <li>
                      <button
                        type="button"
                        // Tutte le materie, come il conteggio: senza, l'elenco riaprirebbe filtrato sull'ultima materia.
                        onClick={() =>
                          goToView("study", [
                            ["study.topicsFilter", "", "tab"],
                            ["study.topicsOpen", true, "tab"]
                          ])
                        }
                        className={ROW}
                      >
                        <span className="grid w-11 shrink-0 grid-cols-1 place-items-center">
                          <Icon name="Brain" className="h-4 w-4 text-[var(--accent-ink)]" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="one-line-safe block text-sm font-extrabold">
                            {HOME_TEXT.reviews(reviewsDue.length)}
                          </span>
                          <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
                            {reviewsDue.slice(0, 3).map((topic) => topic.title).join(" · ")}
                          </span>
                        </span>
                        <RowChevron />
                      </button>
                    </li>
                  ) : null}
                </ul>
              ) : (
                <EmptyLine text={HOME_TEXT.emptyToday} action={HOME_TEXT.addEvent} onAction={() => openQuickAdd("event")} />
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Cosa fare adesso" action={HOME_TEXT.allTasks} onAction={() => setActiveView("tasks")} help={HOME_HELP.next} />
              {nextTask ? (
                <div>
                  <button
                    type="button"
                    onClick={() => openTask(nextTask.id)}
                    className="motion-safe -mx-2 flex w-[calc(100%+1rem)] min-w-0 items-start gap-2 rounded-[16px] px-2 py-1 text-left hover:bg-[var(--surface-soft)]"
                  >
                    <span className="two-line-safe min-w-0 flex-1 text-xl font-black leading-tight">{nextTask.title}</span>
                    <span className="sr-only">, {HOME_TEXT.openAction}</span>
                    <Icon name="ChevronRight" className="mt-1 h-4 w-4 shrink-0 text-[var(--faint)]" />
                  </button>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <Tag color={PRIORITY_TONE[nextTask.priority]}>{PRIORITY_LABEL[nextTask.priority]}</Tag>
                    {nextTask.dueDate ? (
                      <Tag className={daysUntil(nextTask.dueDate) < 0 ? "text-[var(--danger-text)]" : ""}>
                        {daysUntil(nextTask.dueDate) < 0 ? "Scaduta" : `Entro ${shortDate(nextTask.dueDate)}`}
                      </Tag>
                    ) : null}
                    {nextTask.subjectId ? <Tag color={subjectColor(subjects, nextTask.subjectId)}>{subjectName(subjects, nextTask.subjectId)}</Tag> : null}
                  </div>
                  <p className="mt-2 flex flex-wrap items-center gap-x-1 text-xs font-bold text-[var(--muted)]">
                    {formatMinutes(nextTask.estimatedMinutes)} · {ENERGY_LABEL[nextTask.energy]} · {HOME_TEXT.importance(nextTask.importance)}
                    <span className="-my-1 inline-flex">
                      <HelpTip {...HOME_HELP.effort} />
                    </span>
                  </p>
                  {urgent.length > 1 ? (
                    <ul className="mt-3 grid grid-cols-1 gap-0.5 border-t border-[var(--border)] pt-2">
                      {urgent.slice(1).map((task) => (
                        <li key={task.id}>
                          <button type="button" onClick={() => openTask(task.id)} className={`${ROW} gap-2 py-1.5 text-sm`}>
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PRIORITY_TONE[task.priority] }} />
                            <span className="one-line-safe min-w-0 flex-1 font-bold">{task.title}</span>
                            {task.dueDate ? <span className="shrink-0 text-xs font-bold text-[var(--muted)]">{shortDate(task.dueDate)}</span> : null}
                            <RowChevron />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <EmptyLine text={HOME_TEXT.emptyNext} action={HOME_TEXT.addTask} onAction={() => openQuickAdd("task")} />
              )}
            </Panel>
          </div>

          <Panel>
            <PanelHeader title="Esami in arrivo" action={HOME_TEXT.allExams} onAction={() => setActiveView("exams")} help={HOME_HELP.preparation} />
            {nextExams.length ? (
              <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
                {nextExams.map((exam) => {
                  const color = subjectColor(subjects, exam.subjectId);
                  const days = studyDaysUntil(exam.date);
                  return (
                    <li key={exam.id}>
                      <button
                        type="button"
                        onClick={() => openExam(exam.id)}
                        className="motion-safe flex w-full min-w-0 items-center gap-3 rounded-[18px] border border-transparent bg-[var(--surface-soft)] p-3 text-left hover:border-[var(--border)] hover:bg-[var(--surface)]"
                      >
                        <span className="grid w-14 shrink-0 grid-cols-1 place-items-center rounded-[14px] py-1.5 text-center" style={{ background: `color-mix(in srgb, ${color} 22%, transparent)` }}>
                          <span className="text-xl font-black leading-none tabular-nums">{days}</span>
                          <span className="text-[10px] font-black uppercase text-[var(--muted)]">{days === 1 ? "giorno" : "giorni"}</span>
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="two-line-safe block text-sm font-black leading-tight">{subjectName(subjects, exam.subjectId)}</span>
                          <span className="block text-xs font-bold text-[var(--muted)]">
                            {capitalizeFirst(format(parseISO(exam.date), "EEE d MMM", { locale: it }))} · {HOME_TEXT.preparation(exam.preparation)}
                          </span>
                          <span className="mt-1.5 block">
                            <ProgressBar value={exam.preparation} color={color} />
                          </span>
                        </span>
                        <RowChevron />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyLine text={HOME_TEXT.emptyExams} action={HOME_TEXT.addExam} onAction={() => setActiveView("exams")} />
            )}
          </Panel>

          <Panel>
            <PanelHeader title={activeSubjects.length ? `Le tue materie · ${activeSubjects.length}` : "Le tue materie"} action={HOME_TEXT.allSubjects} onAction={() => setActiveView("subjects")} />
            {activeSubjects.length ? (
              <ul className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
                {activeSubjects.map((subject) => {
                  const course = barb?.course(subject) ?? null;
                  const semester = barb?.semester(subject);
                  return (
                    <li key={subject.id}>
                      <button type="button" onClick={() => openSubject(subject.id)} className={ROW}>
                        <span className="grid h-9 w-9 shrink-0 grid-cols-1 place-items-center rounded-super" style={{ background: safeCssColor(subject.color) || "var(--accent)" }}>
                          {course ? <CourseIcon course={course} className="h-4 w-4 text-[#10131d]" /> : <Icon name={subject.icon} className="h-4 w-4 text-[#10131d]" />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="one-line-safe block text-sm font-black">{subject.name}</span>
                          <span className="text-xs font-bold text-[var(--muted)]">
                            {SUBJECT_STATUS_LABEL[subject.status]} · {subject.cfu} CFU
                          </span>
                          {semester ? (
                            <span className="mt-1 block">
                              <Tag color={semester.tone}>{semester.label}</Tag>
                            </span>
                          ) : null}
                        </span>
                        <RowChevron />
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyLine text={HOME_TEXT.emptySubjects} action={HOME_TEXT.addSubject} onAction={() => setActiveView("subjects")} />
            )}
          </Panel>
        </div>

        <aside className="grid grid-cols-1 min-w-0 content-start gap-4">
          <Panel>
            {/* "Apri calendario" c'è già in «Oggi»: qui solo il titolo. */}
            <PanelHeader title="Prossimi giorni" />
            {nextEvents.length ? (
              <ul className="grid grid-cols-1 gap-0.5">
                {nextEvents.map((event) => (
                  <li key={event.occurrenceKey}>
                    <button type="button" onClick={() => openEvent(event.id)} className={`${ROW} items-start`}>
                      <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: safeCssColor(event.color) || subjectColor(subjects, event.subjectId) }} />
                      <span className="min-w-0 flex-1">
                        <span className="one-line-safe block text-sm font-black">{event.title}</span>
                        <span className="block text-xs font-bold text-[var(--muted)]">
                          {capitalizeFirst(format(parseISO(daySpanOf(event)?.startDay ?? event.start), "EEE d MMM", { locale: it }))} ·{" "}
                          {isAllDayEvent(event) ? ALL_DAY_LABEL : timeLabel(event.start)}
                          {event.category === "deadline" || event.category === "exam" ? ` · ${studyDaysLabel(event.start)}` : ""}
                        </span>
                      </span>
                      <RowChevron />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyLine text={HOME_TEXT.emptyUpcoming} action={HOME_TEXT.addEvent} onAction={() => openQuickAdd("event")} />
            )}
          </Panel>

          {occasions.length ? (
            <Panel>
              <PanelHeader title={HOME_OCCASIONS_TEXT.title} action={HOME_OCCASIONS_TEXT.openCalendar} onAction={() => setActiveView("calendar")} />
              <ul className="grid grid-cols-1 gap-0.5">
                {occasions.map((item) => {
                  const paint = eventPaint(item, {
                    subjectColor: item.subjectId ? subjectColor(subjects, item.subjectId, "") : undefined,
                    overrides: typeOverrides,
                    theme
                  });
                  const style = paint.style;
                  // Il giorno della ricorrenza (data civile), non l'istante: vale in ogni fuso.
                  const days = daysUntil(item.occurrenceDate, now);
                  const when = days <= 0 ? HOME_OCCASIONS_TEXT.today : days === 1 ? HOME_OCCASIONS_TEXT.tomorrow : HOME_OCCASIONS_TEXT.inDays(days);
                  return (
                    <li key={item.occurrenceKey}>
                      <button type="button" onClick={() => openEvent(item.id)} className={ROW}>
                        <span
                          className="grid h-8 w-8 shrink-0 grid-cols-1 place-items-center rounded-[10px]"
                          style={{ background: style.background, color: style.text, boxShadow: `inset 0 0 0 1px ${style.border}` }}
                        >
                          <Icon name={paint.icon} className="h-4 w-4" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="one-line-safe block text-sm font-black">{item.title}</span>
                          <span className="block text-xs font-bold text-[var(--muted)]">
                            {when} · {format(parseISO(item.occurrenceDate), "EEE d MMM", { locale: it })}
                            {item.age !== undefined && item.occasion ? ` · ${occasionAgeText(item.occasion.kind, item.age)}` : ""}
                          </span>
                        </span>
                        <RowChevron />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          ) : null}

          <Panel>
            <PanelHeader title="Obiettivi" action={HOME_TEXT.allGoals} onAction={() => setActiveView("goals")} />
            {goals.filter((goal) => goal.status === "active").length ? (
              <ul className="grid grid-cols-1 gap-0.5">
                {goals
                  .filter((goal) => goal.status === "active")
                  .slice(0, 3)
                  .map((goal) => (
                    <li key={goal.id}>
                      <button type="button" onClick={() => openGoal(goal.id)} className={ROW}>
                        <span className="min-w-0 flex-1">
                          <span className="mb-1.5 flex items-center justify-between gap-2">
                            <span className="one-line-safe text-sm font-bold">{goal.title}</span>
                            <span className="shrink-0 text-xs font-black">{goal.progress}%</span>
                          </span>
                          <ProgressBar value={goal.progress} />
                        </span>
                        <RowChevron />
                      </button>
                    </li>
                  ))}
              </ul>
            ) : (
              <EmptyLine text={HOME_TEXT.emptyGoals} action={HOME_TEXT.addGoal} onAction={() => setActiveView("goals")} />
            )}
          </Panel>

          <Panel>
            <PanelHeader title="Ultimi materiali" action={HOME_TEXT.allMaterials} onAction={() => setActiveView("materials")} />
            {recentAttachments.length ? (
              <ul className="grid grid-cols-1 gap-1">
                {recentAttachments.map((attachment) => (
                  <li key={attachment.id}>
                    <button type="button" onClick={() => findMaterial(attachment.name)} className={`${ROW} py-1.5`}>
                      <Icon name={ATTACHMENT_KIND_ICON[attachmentKind(attachment)]} className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                      <span className="one-line-safe min-w-0 flex-1 text-sm font-bold">{attachment.name}</span>
                      <RowChevron action={HOME_TEXT.findAction} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyLine text={HOME_TEXT.emptyMaterials} action={HOME_TEXT.addMaterial} onAction={() => setActiveView("materials")} />
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
                    className={`grid h-7 w-7 shrink-0 grid-cols-1 place-items-center rounded-full text-xs ${
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
