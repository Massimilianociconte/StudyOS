import { useMemo } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";
import { format, parseISO, subDays } from "date-fns";
import { useStudyStore } from "../store/useStudyStore";
import { completionRate, studyMinutesThisWeek, studyStreak, workloadBySubject } from "../lib/selectors";
import { Panel, ProgressBar, SectionTitle } from "../components/ui";

export function StatsView() {
  const { sessions, subjects, tasks, exams, topics } = useStudyStore();

  const dailyData = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => {
      const date = subDays(new Date(), 6 - index);
      const key = format(date, "yyyy-MM-dd");
      const minutes = sessions
        .filter((session) => format(parseISO(session.start), "yyyy-MM-dd") === key && session.status === "completed")
        .reduce((sum, session) => sum + session.actualMinutes, 0);
      return { day: format(date, "EEE"), ore: Math.round((minutes / 60) * 10) / 10 };
    });
  }, [sessions]);

  const subjectData = workloadBySubject(subjects, sessions).filter((item) => item.minutes > 0);
  const taskRate = completionRate(tasks);
  const weeklyMinutes = studyMinutesThisWeek(sessions);
  const streak = studyStreak(sessions);

  return (
    <div>
      <SectionTitle title="Statistiche" subtitle="Metriche leggibili: carico, ore, task, streak, ripassi e preparazione esami." />

      <div className="grid gap-4 xl:grid-cols-4">
        <Panel className="xl:col-span-1">
          <p className="text-xs font-black uppercase text-[var(--faint)]">Settimana</p>
          <h3 className="mt-2 text-5xl font-black">{Math.round((weeklyMinutes / 60) * 10) / 10}h</h3>
          <p className="text-sm text-[var(--muted)]">ore studiate</p>
          <div className="mt-5"><ProgressBar value={Math.min(100, (weeklyMinutes / (18 * 60)) * 100)} /></div>
        </Panel>
        <Panel className="xl:col-span-1">
          <p className="text-xs font-black uppercase text-[var(--faint)]">Task</p>
          <h3 className="mt-2 text-5xl font-black">{taskRate}%</h3>
          <p className="text-sm text-[var(--muted)]">completamento</p>
        </Panel>
        <Panel className="xl:col-span-1">
          <p className="text-xs font-black uppercase text-[var(--faint)]">Streak</p>
          <h3 className="mt-2 text-5xl font-black">{streak}</h3>
          <p className="text-sm text-[var(--muted)]">giorni</p>
        </Panel>
        <Panel className="xl:col-span-1">
          <p className="text-xs font-black uppercase text-[var(--faint)]">Ripassi</p>
          <h3 className="mt-2 text-5xl font-black">{topics.reduce((sum, topic) => sum + topic.completedReviews, 0)}</h3>
          <p className="text-sm text-[var(--muted)]">effettuati</p>
        </Panel>

        <Panel className="h-[380px] xl:col-span-2">
          <h3 className="mb-4 text-2xl font-black">Ore per giorno</h3>
          <ResponsiveContainer width="100%" height="82%">
            <BarChart data={dailyData}>
              <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
              <XAxis dataKey="day" stroke="var(--muted)" />
              <YAxis stroke="var(--muted)" />
              <Tooltip contentStyle={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 18 }} />
              <Bar dataKey="ore" radius={[12, 12, 12, 12]} fill="var(--accent)" />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel className="h-[380px] xl:col-span-2">
          <h3 className="mb-4 text-2xl font-black">Preparazione esami</h3>
          <ResponsiveContainer width="100%" height="82%">
            <LineChart data={exams.map((exam) => ({ name: subjects.find((subject) => subject.id === exam.subjectId)?.name ?? "Esame", prep: exam.preparation }))}>
              <CartesianGrid stroke="rgba(255,255,255,.08)" vertical={false} />
              <XAxis dataKey="name" stroke="var(--muted)" />
              <YAxis stroke="var(--muted)" />
              <Tooltip contentStyle={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 18 }} />
              <Line dataKey="prep" type="monotone" stroke="var(--accent-3)" strokeWidth={4} dot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </Panel>

        <Panel className="h-[380px] xl:col-span-2">
          <h3 className="mb-4 text-2xl font-black">Ore per materia</h3>
          <ResponsiveContainer width="100%" height="82%">
            <PieChart>
              <Pie data={subjectData} dataKey="minutes" nameKey="name" outerRadius={115} innerRadius={58} paddingAngle={5}>
                {subjectData.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 18 }} />
            </PieChart>
          </ResponsiveContainer>
        </Panel>

        <Panel className="xl:col-span-2">
          <h3 className="mb-4 text-2xl font-black">Segnali rapidi</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Signal label="Task rimandate" value={tasks.filter((task) => task.status === "postponed").length} />
            <Signal label="Task bloccate" value={tasks.filter((task) => task.status === "blocked").length} />
            <Signal label="Argomenti tracciati" value={topics.length} />
            <Signal label="Sessioni completate" value={sessions.filter((session) => session.status === "completed").length} />
          </div>
        </Panel>
      </div>
    </div>
  );
}

function Signal({ value, label }: { value: number; label: string }) {
  return (
    <div className="rounded-[22px] bg-[var(--surface-soft)] p-4">
      <div className="text-3xl font-black">{value}</div>
      <div className="text-sm font-bold text-[var(--muted)]">{label}</div>
    </div>
  );
}
