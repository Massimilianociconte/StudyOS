import { useMemo, useState, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { addDays, format, isBefore, parseISO, startOfDay } from "date-fns";
import { it } from "date-fns/locale";
import { useShallow } from "zustand/react/shallow";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { completionRate, studyDaysUntil, studyStreak, subjectColor, subjectName } from "../lib/selectors";
import { SESSION_SOURCE_LABEL, STATS_PERIOD_LABEL, STATS_TEXT, capitalizeFirst, formatHours, formatMinutes } from "../lib/labels";
import { SEMESTER_LABEL } from "../lib/semesters";
import { BARB_DATASET } from "../data/university/barb.dataset";
import {
  SESSION_SOURCES,
  STATS_PERIODS,
  minutesBySubject,
  periodRange,
  sessionSummary,
  sessionsInRange,
  trendBuckets,
  trendUnit,
  type PeriodRange,
  type SessionSourceKey,
  type StatsPeriod
} from "../lib/studyStats";
import { oneOf, useUiState, writeUiState } from "../lib/uiState";
import { Button, EmptyState, HelpTip, IconButton, Panel, ProgressBar, SectionTitle, Segmented, StatTile } from "../components/ui";
import { Icon } from "../components/Icon";

const tooltipStyle = { background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 16, color: "var(--text)" };

const SOURCE_LABEL: Record<SessionSourceKey, string> = { ...SESSION_SOURCE_LABEL, unknown: STATS_TEXT.sourceUnknown };
const SOURCE_COLOR: Record<SessionSourceKey, string> = {
  pomodoro: "var(--accent)",
  timer: "var(--accent-3)",
  stopwatch: "var(--accent-2)",
  manual: "var(--warning)",
  unknown: "var(--faint)"
};
const CURRENT_LABEL: Record<StatsPeriod, string> = { week: STATS_TEXT.thisWeek, month: STATS_TEXT.thisMonth, semester: STATS_TEXT.thisSemester };

/** Nome leggibile del periodo: "9 – 15 nov 2026", "Novembre 2026", "1° semestre 2026/2027". */
const rangeLabel = (range: PeriodRange) => {
  if (range.period === "week") {
    const last = addDays(range.end, -1);
    return `${format(range.start, "d MMM", { locale: it })} – ${format(last, "d MMM yyyy", { locale: it })}`;
  }
  if (range.period === "month") return capitalizeFirst(format(range.start, "MMMM yyyy", { locale: it }));
  return `${SEMESTER_LABEL[range.semesterId ?? "primo"]} ${range.academicYear ?? ""}`.trim();
};

/** Collegamento verso un'altra sezione: prima la chiave condivisa, poi la vista. */
const goTo = (setActiveView: (view: "study" | "tasks" | "subjects" | "exams") => void, view: "study" | "tasks" | "subjects" | "exams", key?: [string, unknown, "tab" | "device"]) => {
  if (key) writeUiState(key[0], key[1], key[2]);
  setActiveView(view);
};

export function StatsView() {
  const { sessions, subjects, tasks, exams, topics, preferences, setActiveView } = useStudyStore(
    useShallow((state) => ({
      sessions: state.sessions,
      subjects: state.subjects,
      tasks: state.tasks,
      exams: state.exams,
      topics: state.topics,
      preferences: selectPreferences(state),
      setActiveView: state.setActiveView
    }))
  );
  const weeklyTarget = preferences.weeklyTargetMinutes;
  const [period, setPeriod] = useUiState<StatsPeriod>("stats.period", "week", { validate: oneOf(...STATS_PERIODS) });
  const [offset, setOffset] = useState(0);
  const range = useMemo(() => periodRange(period, new Date(), { offset, semesters: BARB_DATASET.semesters }), [period, offset]);

  const inPeriod = useMemo(() => sessionsInRange(sessions, range), [sessions, range]);
  const summary = useMemo(() => sessionSummary(inPeriod), [inPeriod]);
  const bySubject = useMemo(() => minutesBySubject(subjects, inPeriod), [subjects, inPeriod]);
  const trend = useMemo(() => {
    const unit = trendUnit(range.period);
    return trendBuckets(inPeriod, range, unit).map((bucket) => ({
      label: unit === "day" ? format(bucket.start, range.period === "week" ? "EEE" : "d", { locale: it }) : format(bucket.start, "d/M"),
      full: unit === "day" ? capitalizeFirst(format(bucket.start, "EEEE d MMMM", { locale: it })) : STATS_TEXT.weekOf(format(bucket.start, "d MMMM", { locale: it })),
      ore: Math.round((bucket.minutes / 60) * 10) / 10
    }));
  }, [inPeriod, range]);

  const examData = useMemo(
    () =>
      exams
        .filter((exam) => exam.status !== "done" && !isBefore(parseISO(exam.date), startOfDay(new Date())))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((exam) => ({
          id: exam.id,
          name: subjectName(subjects, exam.subjectId),
          prep: exam.preparation,
          days: studyDaysUntil(exam.date),
          color: subjectColor(subjects, exam.subjectId)
        })),
    [exams, subjects]
  );

  const visibleTasks = tasks.filter((task) => task.status !== "archived");
  const taskRate = completionRate(visibleTasks);
  const doneTasks = visibleTasks.filter((task) => task.status === "done").length;
  const streak = studyStreak(sessions);
  const reviewsDone = topics.reduce((sum, topic) => sum + topic.completedReviews, 0);
  const today = startOfDay(new Date());
  const overdue = visibleTasks.filter((task) => task.status !== "done" && task.dueDate && isBefore(parseISO(task.dueDate), today)).length;
  const blocked = visibleTasks.filter((task) => task.status === "blocked").length;
  const postponed = visibleTasks.filter((task) => task.status === "postponed").length;
  const total = summary.totalMinutes;
  const isWeekNow = period === "week" && offset === 0;

  const nothingYet = !sessions.some((session) => session.status === "completed") && !visibleTasks.length && !topics.length && !examData.length;
  if (nothingYet) {
    return (
      <div>
        <SectionTitle title={STATS_TEXT.title} subtitle={STATS_TEXT.subtitle} />
        <EmptyState
          icon="BarChart3"
          title={STATS_TEXT.emptyTitle}
          body={STATS_TEXT.emptyBody}
          action={
            <Button variant="primary" icon="Timer" onClick={() => setActiveView("study")}>
              {STATS_TEXT.goToStudy}
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div>
      <SectionTitle title={STATS_TEXT.title} subtitle={STATS_TEXT.subtitle} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          label={STATS_TEXT.periodAria}
          value={period}
          onChange={(value) => {
            setPeriod(value);
            setOffset(0);
          }}
          options={STATS_PERIODS.map((id) => ({ id, label: STATS_PERIOD_LABEL[id] }))}
        />
        <div className="flex min-w-0 items-center gap-1">
          <IconButton icon="ChevronLeft" label={STATS_TEXT.previous} className="h-10 w-10" onClick={() => setOffset((value) => value - 1)} />
          <span className="one-line-safe min-w-0 px-1 text-sm font-black" aria-live="polite">
            {rangeLabel(range)}
          </span>
          <IconButton icon="ChevronRight" label={STATS_TEXT.next} className="h-10 w-10 disabled:opacity-40" disabled={offset >= 0} onClick={() => setOffset((value) => Math.min(0, value + 1))} />
          {offset < 0 ? (
            <Button variant="ghost" onClick={() => setOffset(0)}>
              {STATS_TEXT.backToNow}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label={STATS_TEXT.studied}
          value={STATS_TEXT.hoursValue(formatHours(total))}
          hint={isWeekNow ? STATS_TEXT.ofTarget(formatHours(weeklyTarget)) : offset === 0 ? CURRENT_LABEL[period] : rangeLabel(range)}
          icon="Timer"
          onClick={() => goTo(setActiveView, "study")}
        />
        <StatTile
          label={STATS_TEXT.sessions}
          value={`${summary.count}`}
          hint={summary.count ? STATS_TEXT.sessionsHint(formatMinutes(summary.averageMinutes)) : STATS_TEXT.noSessionsHint}
          icon="Clock"
          onClick={() => goTo(setActiveView, "study")}
        />
        <WithHelp help={<HelpTip title={STATS_TEXT.streakHelp.title} text={STATS_TEXT.streakHelp.text} example={STATS_TEXT.streakHelp.example} />}>
          <StatTile label={STATS_TEXT.streak} value={`${streak}`} hint={STATS_TEXT.streakHint(streak)} icon="Flame" onClick={() => goTo(setActiveView, "study")} />
        </WithHelp>
        <WithHelp help={<HelpTip title={STATS_TEXT.tasksHelp.title} text={STATS_TEXT.tasksHelp.text} />}>
          <StatTile
            label={STATS_TEXT.tasksDone}
            value={visibleTasks.length ? `${taskRate}%` : "—"}
            hint={visibleTasks.length ? STATS_TEXT.tasksDoneHint(doneTasks, visibleTasks.length) : STATS_TEXT.tasksEmptyHint}
            icon="CheckCheck"
            onClick={() => goTo(setActiveView, "tasks")}
          />
        </WithHelp>
        <StatTile
          label={STATS_TEXT.reviews}
          value={`${reviewsDone}`}
          hint={topics.length ? STATS_TEXT.reviewsHint(topics.length) : STATS_TEXT.reviewsEmptyHint}
          icon="Brain"
          onClick={() => goTo(setActiveView, "study", ["study.topicsOpen", true, "tab"])}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-black">{trendUnit(period) === "day" ? STATS_TEXT.trendDay : STATS_TEXT.trendWeek}</h3>
            <span className="text-xs font-bold text-[var(--muted)]">{STATS_TEXT.trendTotal(formatHours(total))}</span>
          </div>
          {total ? (
            <div className="h-64" role="img" aria-label={STATS_TEXT.trendAria(rangeLabel(range), formatHours(total))}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ left: -18, right: 4, top: 4 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--muted)" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={4} tickLine={false} />
                  <YAxis stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "var(--surface-soft)" }}
                    labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.full ?? "")}
                    formatter={(value) => [`${String(value).replace(".", ",")} h`, STATS_TEXT.trendTooltip]}
                  />
                  <Bar dataKey="ore" radius={[8, 8, 3, 3]} fill="var(--accent)" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">{STATS_TEXT.trendEmpty}</p>
          )}
        </Panel>

        <Panel>
          <h3 className="mb-3 text-lg font-black">{STATS_TEXT.bySubject}</h3>
          {bySubject.length ? (
            <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
              <div className="mx-auto h-44 w-44 sm:h-48 sm:w-full" role="img" aria-label={STATS_TEXT.bySubjectAria(formatHours(total))}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={bySubject} dataKey="minutes" nameKey="name" outerRadius="95%" innerRadius="58%" paddingAngle={3} stroke="none">
                      {bySubject.map((entry) => (
                        <Cell key={entry.id ?? "none"} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${formatHours(Number(value))} h`, String(name)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="grid grid-cols-1 gap-0.5">
                {bySubject.map((entry) => {
                  const row = (
                    <>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.color }} />
                      <span className="one-line-safe min-w-0 flex-1 font-bold">{entry.name}</span>
                      <span className="shrink-0 text-xs font-black tabular-nums">{formatHours(entry.minutes)} h</span>
                      <span className="w-10 shrink-0 text-right text-xs font-bold text-[var(--muted)] tabular-nums">{Math.round((entry.minutes / total) * 100)}%</span>
                    </>
                  );
                  return (
                    <li key={entry.id ?? "none"}>
                      {entry.id ? (
                        <button
                          type="button"
                          aria-label={STATS_TEXT.openSubject(entry.name)}
                          onClick={() => goTo(setActiveView, "subjects", ["subjects.open", entry.id, "tab"])}
                          className="flex min-h-9 w-full min-w-0 items-center gap-2 rounded-[12px] px-2 text-left text-sm hover:bg-[var(--surface-soft)]"
                        >
                          {row}
                          <Icon name="ChevronRight" className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                        </button>
                      ) : (
                        <div className="flex min-h-9 min-w-0 items-center gap-2 px-2 text-sm">
                          {row}
                          <span className="h-3.5 w-3.5 shrink-0" />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">{STATS_TEXT.bySubjectEmpty}</p>
          )}
        </Panel>

        <Panel>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-lg font-black">{STATS_TEXT.howYouStudy}</h3>
            <span className="text-xs font-bold text-[var(--muted)]">{STATS_TEXT.sessionsCount(summary.count)}</span>
          </div>
          {summary.count ? (
            <div className="grid grid-cols-1 gap-3">
              <StatTile label={STATS_TEXT.average} value={formatMinutes(summary.averageMinutes)} icon="Clock" />
              <ul className="grid grid-cols-1 gap-2.5">
                {SESSION_SOURCES.filter((key) => summary.bySource[key].count > 0).map((key) => (
                  <li key={key}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="one-line-safe min-w-0 font-bold">{SOURCE_LABEL[key]}</span>
                      <span className="shrink-0 text-xs font-bold text-[var(--muted)]">
                        {STATS_TEXT.sourceRow(summary.bySource[key].count, formatMinutes(summary.bySource[key].minutes))}
                      </span>
                    </div>
                    <ProgressBar value={total ? (summary.bySource[key].minutes / total) * 100 : 0} color={SOURCE_COLOR[key]} />
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">{STATS_TEXT.howEmpty}</p>
          )}
        </Panel>

        <Panel>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-lg font-black">{STATS_TEXT.exams}</h3>
            <span className="text-xs font-bold text-[var(--muted)]">{STATS_TEXT.examsOrder}</span>
          </div>
          {examData.length ? (
            <ul className="grid grid-cols-1 gap-1">
              {examData.map((exam) => (
                <li key={exam.id}>
                  <button
                    type="button"
                    aria-label={STATS_TEXT.openExam(exam.name)}
                    onClick={() => goTo(setActiveView, "exams", ["exams.editing", exam.id, "tab"])}
                    className="block w-full rounded-[14px] px-2 py-1.5 text-left hover:bg-[var(--surface-soft)]"
                  >
                    <span className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className="one-line-safe min-w-0 font-bold">{exam.name}</span>
                      <span className="shrink-0 text-xs font-black">
                        {STATS_TEXT.examReady(exam.prep)} <span className="text-[var(--muted)]">· {STATS_TEXT.examWhen(exam.days)}</span>
                      </span>
                    </span>
                    <ProgressBar value={exam.prep} color={exam.color} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">{STATS_TEXT.examsEmpty}</p>
          )}
        </Panel>

        <Panel className="lg:col-span-2">
          <h3 className="mb-3 text-lg font-black">{STATS_TEXT.watch}</h3>
          <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-3">
            <Signal label={STATS_TEXT.overdue} value={overdue} tone="var(--accent-3)" onClick={() => goTo(setActiveView, "tasks", ["tasks.filter", "overdue", "tab"])} />
            <Signal label={STATS_TEXT.blocked} value={blocked} tone="var(--warning)" onClick={() => goTo(setActiveView, "tasks", ["tasks.mode", "kanban", "device"])} />
            <Signal label={STATS_TEXT.postponed} value={postponed} tone="var(--accent-2)" onClick={() => goTo(setActiveView, "tasks", ["tasks.mode", "kanban", "device"])} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

/** Riquadro con il suo "?" accanto (il "?" non può stare dentro il pulsante del riquadro). */
function WithHelp({ children, help }: { children: ReactNode; help: ReactNode }) {
  return (
    <div className="relative min-w-0">
      {children}
      <span className="absolute -right-1.5 -top-2.5">{help}</span>
    </div>
  );
}

function Signal({ value, label, tone, onClick }: { value: number; label: string; tone: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="group flex min-w-0 items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] p-3 text-left hover:bg-[var(--surface)] hover:ring-1 hover:ring-[var(--accent-ink)]">
      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
      <span className="min-w-0 flex-1">
        <span className="block text-2xl font-black leading-tight">{value}</span>
        <span className="safe-text block text-xs font-bold text-[var(--muted)]">{label}</span>
      </span>
      <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--muted)] group-hover:text-[var(--accent-ink)]" />
    </button>
  );
}
