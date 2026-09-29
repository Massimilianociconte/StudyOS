import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, isBefore, parseISO, startOfDay, subDays } from "date-fns";
import { it } from "date-fns/locale";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { completionRate, studyDaysUntil, studyMinutesThisWeek, studyStreak, subjectColor, subjectName, workloadBySubject } from "../lib/selectors";
import { formatHours } from "../lib/labels";
import { Panel, ProgressBar, SectionTitle } from "../components/ui";

const tooltipStyle = { background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 16, color: "var(--text)" };

export function StatsView() {
  const store = useStudyStore();
  const { sessions, subjects, tasks, exams, topics } = store;
  const weeklyTarget = selectPreferences(store).weeklyTargetMinutes;

  const dailyData = useMemo(
    () =>
      Array.from({ length: 14 }, (_, index) => {
        const date = subDays(new Date(), 13 - index);
        const key = format(date, "yyyy-MM-dd");
        const minutes = sessions
          .filter((session) => session.status === "completed" && format(parseISO(session.start), "yyyy-MM-dd") === key)
          .reduce((sum, session) => sum + session.actualMinutes, 0);
        return { day: format(date, "d"), full: format(date, "EEEE d MMMM", { locale: it }), ore: Math.round((minutes / 60) * 10) / 10 };
      }),
    [sessions]
  );

  const examData = useMemo(
    () =>
      exams
        .filter((exam) => exam.status !== "done" && !isBefore(parseISO(exam.date), startOfDay(new Date())))
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((exam) => ({
          name: subjectName(subjects, exam.subjectId),
          prep: exam.preparation,
          days: studyDaysUntil(exam.date),
          color: subjectColor(subjects, exam.subjectId)
        })),
    [exams, subjects]
  );

  const subjectData = workloadBySubject(subjects, sessions)
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
  const totalSubjectMinutes = subjectData.reduce((sum, item) => sum + item.minutes, 0);
  const visibleTasks = tasks.filter((task) => task.status !== "archived");
  const taskRate = completionRate(visibleTasks);
  const weeklyMinutes = studyMinutesThisWeek(sessions);
  const streak = studyStreak(sessions);
  const fortnightMinutes = dailyData.reduce((sum, day) => sum + day.ore * 60, 0);

  const kpis = [
    { label: "Questa settimana", value: `${formatHours(weeklyMinutes)} h`, detail: `su ${formatHours(weeklyTarget)} h di obiettivo`, progress: (weeklyMinutes / weeklyTarget) * 100 },
    { label: "Task completate", value: `${taskRate}%`, detail: `${visibleTasks.filter((task) => task.status === "done").length} su ${visibleTasks.length}`, progress: taskRate },
    { label: "Streak", value: `${streak}`, detail: streak === 1 ? "giorno consecutivo" : "giorni consecutivi" },
    { label: "Ripassi fatti", value: `${topics.reduce((sum, topic) => sum + topic.completedReviews, 0)}`, detail: `${topics.length} argomenti tracciati` }
  ];

  return (
    <div>
      <SectionTitle title="Statistiche" subtitle="Ore di studio, distribuzione per materia, preparazione esami e segnali da tenere d'occhio." />

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <div key={kpi.label} className="quiet-panel min-w-0 p-3.5">
            <p className="truncate text-[11px] font-black uppercase text-[var(--faint)]">{kpi.label}</p>
            <p className="mt-1 text-2xl font-black">{kpi.value}</p>
            <p className="truncate text-xs font-bold text-[var(--muted)]">{kpi.detail}</p>
            {kpi.progress !== undefined ? (
              <div className="mt-2">
                <ProgressBar value={kpi.progress} />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-lg font-black">Ore per giorno</h3>
            <span className="text-xs font-bold text-[var(--muted)]">ultimi 14 giorni · {formatHours(fortnightMinutes)} h totali</span>
          </div>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ left: -18, right: 4, top: 4 }}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" stroke="var(--muted)" tick={{ fontSize: 11 }} interval={0} tickLine={false} />
                <YAxis stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  cursor={{ fill: "var(--surface-soft)" }}
                  labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.full ?? "")}
                  formatter={(value) => [`${String(value).replace(".", ",")} h`, "Studio"]}
                />
                <Bar dataKey="ore" radius={[8, 8, 3, 3]} fill="var(--accent)" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel>
          <div className="mb-3 flex items-baseline justify-between gap-2">
            <h3 className="text-lg font-black">Preparazione esami</h3>
            <span className="text-xs font-bold text-[var(--muted)]">in ordine di data</span>
          </div>
          {examData.length ? (
            <ul className="grid grid-cols-1 gap-3">
              {examData.map((exam) => (
                <li key={exam.name + exam.days}>
                  <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                    <span className="one-line-safe min-w-0 font-bold">{exam.name}</span>
                    <span className="shrink-0 text-xs font-black">
                      {exam.prep}% <span className="text-[var(--muted)]">· tra {exam.days} {exam.days === 1 ? "giorno" : "giorni"}</span>
                    </span>
                  </div>
                  <ProgressBar value={exam.prep} color={exam.color} />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-[var(--muted)]">Nessun esame in arrivo.</p>
          )}
        </Panel>

        <Panel>
          <h3 className="mb-3 text-lg font-black">Ore per materia</h3>
          {subjectData.length ? (
            <div className="grid grid-cols-1 items-center gap-4 sm:grid-cols-[200px_minmax(0,1fr)]">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={subjectData} dataKey="minutes" nameKey="name" outerRadius={90} innerRadius={52} paddingAngle={3} stroke="none">
                      {subjectData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={tooltipStyle} formatter={(value, name) => [`${formatHours(Number(value))} h`, String(name)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ul className="grid grid-cols-1 gap-1.5">
                {subjectData.map((entry) => (
                  <li key={entry.name} className="flex min-w-0 items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: entry.color }} />
                    <span className="one-line-safe min-w-0 flex-1 font-bold">{entry.name}</span>
                    <span className="shrink-0 text-xs font-black tabular-nums">{formatHours(entry.minutes)} h</span>
                    <span className="w-10 shrink-0 text-right text-xs font-bold text-[var(--muted)] tabular-nums">
                      {Math.round((entry.minutes / totalSubjectMinutes) * 100)}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Registra sessioni di studio collegate a una materia per vedere la distribuzione.</p>
          )}
        </Panel>

        <Panel>
          <h3 className="mb-3 text-lg font-black">Segnali</h3>
          <div className="grid grid-cols-2 gap-2">
            <Signal label="Task in ritardo" value={visibleTasks.filter((task) => task.status !== "done" && task.dueDate && isBefore(parseISO(task.dueDate), startOfDay(new Date()))).length} tone="var(--accent-3)" />
            <Signal label="Task bloccate" value={visibleTasks.filter((task) => task.status === "blocked").length} tone="var(--warning)" />
            <Signal label="Task rimandate" value={visibleTasks.filter((task) => task.status === "postponed").length} tone="var(--accent-2)" />
            <Signal label="Sessioni completate" value={sessions.filter((session) => session.status === "completed").length} tone="var(--accent)" />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Signal({ value, label, tone }: { value: number; label: string; tone: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[18px] bg-[var(--surface-soft)] p-3">
      <span className="h-8 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
      <div className="min-w-0">
        <div className="text-2xl font-black leading-tight">{value}</div>
        <div className="truncate text-xs font-bold text-[var(--muted)]">{label}</div>
      </div>
    </div>
  );
}
