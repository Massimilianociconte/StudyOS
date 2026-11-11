// Studio nella pagina della materia: tempo in tutto, oggi, settimana e mese, andamento per giorni,
// settimane o mesi (stesso stile delle Statistiche), tempo per argomento ed elenco delle sessioni
// che si aprono nella modifica. Caricato solo all'apertura del dettaglio (porta con sé recharts).
import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { useShallow } from "zustand/react/shallow";
import type { Subject } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { capitalizeFirst, formatHours, formatMinutes } from "../lib/labels";
import { SUBJECT_STUDY_TEXT, SUBJECT_STUDY_UNIT_LABEL } from "../lib/labels/study";
import { sessionSourceLabel, sessionTopicId } from "../lib/studySessions";
import { RECENT_TREND_UNITS, minutesByTopic, recentTrend, studyTotals, subjectSessions, type RecentTrendUnit } from "../lib/studyStats";
import { oneOf, useUiState } from "../lib/uiState";
import { safeCssColor } from "../lib/sharing";
import { goToView } from "../hooks/useLinkedUiState";
import { ProgressBar, Segmented, StatTile } from "./ui";
import { Icon } from "./Icon";
import { useSessionEditor } from "./StudySessionDrawers";

const tooltipStyle = { background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 16, color: "var(--text)" };
/** Sessioni visibili prima di "Mostra tutte". */
const FIRST_SESSIONS = 6;

const bucketLabels = (unit: RecentTrendUnit, start: Date) => {
  if (unit === "day") return { label: format(start, "d", { locale: it }), full: capitalizeFirst(format(start, "EEEE d MMMM", { locale: it })) };
  if (unit === "week") return { label: format(start, "d/M"), full: SUBJECT_STUDY_TEXT.weekOf(format(start, "d MMMM", { locale: it })) };
  return { label: capitalizeFirst(format(start, "MMM", { locale: it })), full: capitalizeFirst(format(start, "MMMM yyyy", { locale: it })) };
};

export default function SubjectStudyStats({ subject }: { subject: Subject }) {
  const { sessions, topics } = useStudyStore(useShallow((state) => ({ sessions: state.sessions, topics: state.topics })));
  const [unit, setUnit] = useUiState<RecentTrendUnit>("subjects.studyUnit", "day", { validate: oneOf(...RECENT_TREND_UNITS) });
  const [showAll, setShowAll] = useState(false);
  const editor = useSessionEditor();
  const color = safeCssColor(subject.color) || "var(--accent)";

  const mine = useMemo(() => subjectSessions(sessions, subject.id), [sessions, subject.id]);
  const totals = useMemo(() => studyTotals(mine, new Date()), [mine]);
  const trend = useMemo(
    () => recentTrend(mine, unit, new Date()).map((bucket) => ({ ...bucketLabels(unit, bucket.start), ore: Math.round((bucket.minutes / 60) * 10) / 10, minutes: bucket.minutes })),
    [mine, unit]
  );
  const trendMinutes = trend.reduce((sum, bucket) => sum + bucket.minutes, 0);
  const byTopic = useMemo(() => minutesByTopic(mine, topics), [mine, topics]);
  const topMinutes = byTopic.reduce((max, row) => Math.max(max, row.minutes), 0);
  const topicTitle = (id?: string) => (id ? topics.find((topic) => topic.id === id)?.title : undefined);
  const visible = showAll ? mine : mine.slice(0, FIRST_SESSIONS);

  return (
    <section className="grid grid-cols-1 gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-black uppercase text-[var(--faint)]">{SUBJECT_STUDY_TEXT.title}</h4>
        <button
          type="button"
          onClick={() => goToView("study", [["study.subject", subject.id, "device"]])}
          className="inline-flex min-h-11 items-center gap-1 px-1 text-xs font-black text-[var(--accent-ink)] underline-offset-2 hover:underline"
        >
          <Icon name="Timer" className="h-3.5 w-3.5" />
          {SUBJECT_STUDY_TEXT.study}
        </button>
      </div>

      {mine.length ? (
        <>
          {/* Il totale è già nella prima casella del dettaglio ("Ore di studio"): qui oggi, settimana, mese e sessioni. */}
          <div className="grid grid-cols-2 gap-2 min-[480px]:grid-cols-4">
            <StatTile label={SUBJECT_STUDY_TEXT.today} value={formatMinutes(totals.today)} />
            <StatTile label={SUBJECT_STUDY_TEXT.week} value={formatMinutes(totals.week)} />
            <StatTile label={SUBJECT_STUDY_TEXT.month} value={formatMinutes(totals.month)} />
            <StatTile label={SUBJECT_STUDY_TEXT.sessions} value={`${totals.count}`} hint={SUBJECT_STUDY_TEXT.average(formatMinutes(Math.round(totals.total / totals.count)))} />
          </div>

          <div className="rounded-[20px] border border-[var(--border)] p-3">
            <Segmented
              label={SUBJECT_STUDY_TEXT.unitAria}
              value={unit}
              onChange={setUnit}
              options={RECENT_TREND_UNITS.map((id) => ({ id, label: SUBJECT_STUDY_UNIT_LABEL[id] }))}
            />
            <div className="mt-3 h-44" role="img" aria-label={SUBJECT_STUDY_TEXT.trendAria(SUBJECT_STUDY_UNIT_LABEL[unit].toLowerCase(), formatHours(trendMinutes))}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ left: -18, right: 4, top: 4 }}>
                  <CartesianGrid stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" stroke="var(--muted)" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={4} tickLine={false} />
                  <YAxis stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "var(--surface-soft)" }}
                    labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.full ?? "")}
                    formatter={(value) => [`${String(value).replace(".", ",")} h`, SUBJECT_STUDY_TEXT.trendTooltip]}
                  />
                  <Bar dataKey="ore" radius={[8, 8, 3, 3]} fill={color} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {byTopic.length ? (
            <div>
              <h5 className="mb-2 text-sm font-black">{SUBJECT_STUDY_TEXT.byTopic}</h5>
              <ul className="grid grid-cols-1 gap-2">
                {byTopic.map((row) => (
                  <li key={row.id ?? "none"}>
                    <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                      <span className={`one-line-safe min-w-0 font-bold ${row.id ? "" : "text-[var(--muted)]"}`}>{row.title}</span>
                      <span className="shrink-0 text-xs font-bold text-[var(--muted)] tabular-nums">{SUBJECT_STUDY_TEXT.topicRow(row.count, formatMinutes(row.minutes))}</span>
                    </div>
                    <ProgressBar value={topMinutes ? (row.minutes / topMinutes) * 100 : 0} color={row.id ? color : "var(--faint)"} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div>
            <h5 className="mb-1 text-sm font-black">{SUBJECT_STUDY_TEXT.sessions}</h5>
            <ul className="grid grid-cols-1 gap-0.5">
              {visible.map((session) => {
                const topic = topicTitle(sessionTopicId(session));
                const details = [
                  capitalizeFirst(format(parseISO(session.start), "EEE d MMM · HH:mm", { locale: it })),
                  topic && topic.toLocaleLowerCase("it") !== session.title.toLocaleLowerCase("it") ? topic : null,
                  sessionSourceLabel(session.source) ?? null
                ].filter(Boolean);
                return (
                  <li key={session.id}>
                    <button
                      type="button"
                      onClick={() => editor.edit(session.id)}
                      className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[12px] px-2 py-1 text-left hover:bg-[var(--surface-soft)]"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="one-line-safe block text-sm font-bold">{session.title}</span>
                        <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{details.join(" · ")}</span>
                      </span>
                      <span className="shrink-0 text-sm font-black tabular-nums">{formatMinutes(session.actualMinutes)}</span>
                      <Icon name="ChevronRight" className="h-3.5 w-3.5 shrink-0 text-[var(--muted)]" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {mine.length > FIRST_SESSIONS ? (
              <button type="button" onClick={() => setShowAll((value) => !value)} className="mt-1 min-h-11 px-2 text-xs font-black text-[var(--accent-ink)] underline-offset-2 hover:underline">
                {showAll ? SUBJECT_STUDY_TEXT.showLess : SUBJECT_STUDY_TEXT.showAll(mine.length)}
              </button>
            ) : null}
            {editor.undoNotice ? <div className="mt-1 px-2">{editor.undoNotice}</div> : null}
          </div>
        </>
      ) : (
        <>
          <p className="rounded-[14px] border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted)]">{SUBJECT_STUDY_TEXT.empty}</p>
          {editor.undoNotice}
        </>
      )}
      {editor.drawer}
    </section>
  );
}
