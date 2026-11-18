// Andamento: numeri calcolati dai dati locali con le definizioni dichiarate (le stesse che leggono
// gli agenti), grafici delle risposte e delle scadenze, per raccolta e per materia, schede e domande
// più difficili. Filtro per periodo.
import { useMemo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { learningStats } from "../../lib/learningStats";
import { blocksPlainText } from "../../lib/cardBlocks";
import { percent } from "../../lib/learnSession";
import { LEARN_TEXT } from "../../lib/labels/learn";
import { oneOf, useUiState } from "../../lib/uiState";
import { Button, EmptyState, HelpTip, Panel, Segmented, StatTile } from "../ui";
import { unionOf, type LearnData } from "./useLearnData";
import { SubjectMark } from "../SubjectMark";

const tooltipStyle = { background: "var(--bg-2)", border: "1px solid var(--border)", borderRadius: 16, color: "var(--text)" };
const tooltipItemStyle = { color: "var(--text)" };
const tooltipLabelStyle = { color: "var(--muted)" };

const PERIODS = ["7", "30", "90", "all"] as const;
type Period = (typeof PERIODS)[number];

interface BreakdownRow {
  key: string;
  name: string;
  cards: number;
  due: number;
  accuracy: number | null;
}

/**
 * Per raccolta / per materia. Le colonne dei numeri prendono la loro larghezza, il nome il resto e si
 * accorcia con i puntini (w-full max-w-0); sul telefono «Da ripassare» va a capo e «Correttezza» diventa
 * «%» (il nome intero resta per gli screen reader): a 375 px niente esce dal riquadro.
 */
function BreakdownTable({ label, rows }: { label: string; rows: readonly BreakdownRow[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-xs font-black uppercase text-[var(--faint)]">
          <th scope="col" className="w-full max-w-0 py-1 pr-2 text-left">
            {label}
          </th>
          <th scope="col" className="whitespace-nowrap py-1 pl-2 text-right align-bottom">
            Schede
          </th>
          <th scope="col" className="py-1 pl-2 text-right align-bottom sm:whitespace-nowrap">
            {LEARN_TEXT.statDue}
          </th>
          <th scope="col" className="whitespace-nowrap py-1 pl-2 text-right align-bottom">
            <span aria-hidden="true" className="sm:hidden">
              %
            </span>
            <span className="sr-only sm:not-sr-only">{LEARN_TEXT.statAccuracy}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key} className="border-t border-[var(--border)]">
            <td className="w-full max-w-0 py-1.5 pr-2 font-bold">
              <span className="one-line-safe block" title={row.name}>
                {row.name}
              </span>
            </td>
            <td className="whitespace-nowrap py-1.5 pl-2 text-right tabular-nums">{row.cards}</td>
            <td className="whitespace-nowrap py-1.5 pl-2 text-right tabular-nums">{row.due}</td>
            <td className="whitespace-nowrap py-1.5 pl-2 text-right tabular-nums">{percent(row.accuracy)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function LearnStats({
  data,
  today,
  onOpenCard,
  onStudyCards
}: {
  data: LearnData;
  today: string;
  onOpenCard: (cardId: string) => void;
  /** «Ripassa queste»: una sessione sulle schede dell'elenco. */
  onStudyCards: (cardIds: string[]) => void;
}) {
  const [period, setPeriod] = useUiState<Period>("learn.statsPeriod", "30", { validate: oneOf(...PERIODS) });
  const union = useMemo(() => unionOf(data), [data.own, data.shared]);
  const stats = useMemo(() => {
    const quizzes = [...data.quizzes, ...data.shared.flatMap((source) => source.bundle.quizzes)];
    const questions = [...data.quizQuestions, ...data.shared.flatMap((source) => source.bundle.quizQuestions)];
    return learningStats({
      cards: union.cards,
      decks: union.decks,
      states: data.cardStates,
      runs: data.studyRuns,
      quizzes,
      questions,
      now: new Date(),
      ...(period === "all" ? {} : { filter: { days: Number(period) } })
    });
  }, [union, data.cardStates, data.studyRuns, data.quizzes, data.quizQuestions, data.shared, period, today]);

  const daily = useMemo(() => stats.daily.map((day) => ({ ...day, label: format(parseISO(day.date), "d/M"), full: format(parseISO(day.date), "EEEE d MMMM", { locale: it }) })), [stats.daily]);
  const forecast = useMemo(() => stats.forecast.map((day) => ({ ...day, label: format(parseISO(day.date), "EEE", { locale: it }) })), [stats.forecast]);
  const cardText = useMemo(() => new Map(union.cards.map((card) => [card.id, card])), [union.cards]);
  const questionText = useMemo(() => new Map([...data.quizQuestions, ...data.shared.flatMap((source) => source.bundle.quizQuestions)].map((question) => [question.id, question])), [data.quizQuestions, data.shared]);
  const subjectName = (id: string | null) => (id ? data.subjects.find((subject) => subject.id === id)?.name ?? "—" : LEARN_TEXT.noSubject);

  if (!union.cards.length && !stats.quiz.attempts) {
    return <EmptyState icon="BarChart3" title={LEARN_TEXT.statsEmptyTitle} body={LEARN_TEXT.statsEmptyBody} />;
  }

  const trendText = stats.trend
    ? Math.abs(stats.trend.delta) < 0.005
      ? LEARN_TEXT.trendFlat
      : stats.trend.delta > 0
        ? LEARN_TEXT.trendUp(Math.round(stats.trend.delta * 100))
        : LEARN_TEXT.trendDown(Math.round(stats.trend.delta * 100))
    : LEARN_TEXT.trendMissing;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented<Period>
          label={LEARN_TEXT.period}
          value={period}
          onChange={setPeriod}
          size="sm"
          options={PERIODS.map((id) => ({ id, label: id === "all" ? LEARN_TEXT.periodAll : LEARN_TEXT.periodDays(Number(id)) }))}
        />
        <HelpTip title={LEARN_TEXT.definitions} text={Object.values(stats.definitions).join("\n\n")} label={LEARN_TEXT.definitions} />
      </div>

      <Panel>
        <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          <StatTile icon="Target" label={LEARN_TEXT.statAccuracy} value={percent(stats.answers.accuracy)} hint={`${stats.answers.correct}/${stats.answers.total}`} />
          <StatTile icon="LineChart" label={LEARN_TEXT.statTrend} value={stats.trend ? `${stats.trend.delta >= 0 ? "+" : ""}${Math.round(stats.trend.delta * 100)}` : "—"} hint={trendText} />
          <StatTile icon="Clock" label={LEARN_TEXT.statTime} value={LEARN_TEXT.minutes(Math.round(stats.timeMs / 60_000))} hint={LEARN_TEXT.statAnswers + `: ${stats.answers.total + stats.answers.skip}`} />
          <StatTile icon="Flame" label={LEARN_TEXT.statStreak} value={stats.streakDays} />
          <StatTile icon="RotateCcw" label={LEARN_TEXT.statDue} value={stats.cards.due} hint={stats.cards.overdue ? `${stats.cards.overdue} in ritardo` : undefined} />
          <StatTile icon="Sparkles" label={LEARN_TEXT.statNew} value={stats.cards.new} hint={LEARN_TEXT.ofTotalCards(stats.cards.total)} />
          <StatTile icon="AlertTriangle" label={LEARN_TEXT.statDifficult} value={stats.cards.difficult} />
          <StatTile icon="Award" label={LEARN_TEXT.statConsolidated} value={stats.cards.consolidated} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="mb-3 text-lg font-black">{LEARN_TEXT.chartDaily}</h3>
          <div className="h-56" role="img" aria-label={`${LEARN_TEXT.chartDaily}: ${stats.answers.total + stats.answers.skip} ${LEARN_TEXT.statAnswers.toLowerCase()}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ left: -18, right: 4, top: 4 }} accessibilityLayer={false}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted)" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={8} tickLine={false} />
                <YAxis stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} cursor={{ fill: "var(--surface-soft)" }} labelFormatter={(_label, payload) => String(payload?.[0]?.payload?.full ?? "")} />
                <Bar dataKey="correct" name="Corrette" stackId="a" fill="var(--ok)" />
                <Bar dataKey="doubt" name="Dubbie" stackId="a" fill="var(--warning)" />
                <Bar dataKey="wrong" name="Sbagliate" stackId="a" fill="var(--danger-text)" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
        <Panel>
          <h3 className="mb-3 text-lg font-black">{LEARN_TEXT.chartForecast}</h3>
          <div className="h-56" role="img" aria-label={`${LEARN_TEXT.chartForecast}: ${forecast.map((day) => `${day.label} ${day.due}`).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={forecast} margin={{ left: -18, right: 4, top: 4 }} accessibilityLayer={false}>
                <CartesianGrid stroke="var(--border)" vertical={false} />
                <XAxis dataKey="label" stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis stroke="var(--muted)" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} itemStyle={tooltipItemStyle} labelStyle={tooltipLabelStyle} cursor={{ fill: "var(--surface-soft)" }} />
                <Bar dataKey="due" name={LEARN_TEXT.statDue} fill="var(--accent)" radius={[8, 8, 3, 3]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          <h3 className="mb-2 text-lg font-black">{LEARN_TEXT.perDeck}</h3>
          <BreakdownTable
            label="Mazzo"
            rows={stats.decks.slice(0, 12).map((deck) => ({ key: deck.deckId, name: deck.title || "—", cards: deck.cards, due: deck.due, accuracy: deck.accuracy }))}
          />
        </Panel>
        <Panel>
          <h3 className="mb-2 text-lg font-black">{LEARN_TEXT.perSubject}</h3>
          <BreakdownTable
            label="Materia"
            rows={stats.subjects.slice(0, 12).map((subject) => ({ key: subject.subjectId ?? "none", name: subjectName(subject.subjectId), cards: subject.cards, due: subject.due, accuracy: subject.accuracy }))}
          />
        </Panel>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Panel>
          {/* Dato che porta a un'azione: l'elenco si ripassa con un tocco e la percentuale dice cosa misura. */}
          <div className="mb-2 flex min-w-0 flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-lg font-black">{LEARN_TEXT.hardest}</h3>
              <p className="text-xs font-semibold text-[var(--muted)]">{LEARN_TEXT.hardestHint}</p>
            </div>
            {stats.hardest.length ? (
              <Button variant="soft" icon="PlayCircle" onClick={() => onStudyCards(stats.hardest.map((item) => item.cardId))}>
                {LEARN_TEXT.hardestStudy(stats.hardest.length)}
              </Button>
            ) : null}
          </div>
          {stats.hardest.length ? (
            <ol className="grid grid-cols-1 gap-1">
              {stats.hardest.map((item) => (
                <li key={item.cardId}>
                  <button type="button" onClick={() => onOpenCard(item.cardId)} className="motion-safe flex w-full min-w-0 items-center gap-3 rounded-[14px] px-2 py-2 text-left hover:bg-[var(--surface-soft)]">
                    <SubjectMark subjectId={cardText.get(item.cardId)?.subjectId} size="sm" />
                    <span className="safe-text line-clamp-2 min-w-0 flex-1 text-sm font-bold">{blocksPlainText(cardText.get(item.cardId)?.front, 120) || "—"}</span>
                    <span className="shrink-0 text-right text-xs font-bold tabular-nums text-[var(--danger-text)]">
                      <span aria-hidden="true">{percent(item.errorRate)}</span>
                      <span className="sr-only">{LEARN_TEXT.hardestRate(percent(item.errorRate))}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm font-medium text-[var(--muted)]">—</p>
          )}
        </Panel>
        <Panel>
          <h3 className="mb-1 text-lg font-black">{LEARN_TEXT.statQuizAvg}</h3>
          <p className="mb-2 text-sm font-bold text-[var(--muted)]">
            {percent(stats.quiz.avgScore)} · {stats.quiz.attempts} tentativi{stats.quiz.bestScore !== null ? ` · ${LEARN_TEXT.bestScore(percent(stats.quiz.bestScore))}` : ""}
          </p>
          {stats.quiz.missed.length ? (
            <>
              <h4 className="mb-1 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.missedQuestions}</h4>
              <ol className="grid grid-cols-1 gap-1">
                {stats.quiz.missed.map((item) => (
                  <li key={item.questionId} className="flex min-w-0 items-center gap-3 px-2 py-1.5">
                    <span className="safe-text line-clamp-2 min-w-0 flex-1 text-sm font-bold">{blocksPlainText(questionText.get(item.questionId)?.prompt, 120) || "—"}</span>
                    <span className="shrink-0 text-xs font-bold tabular-nums text-[var(--danger-text)]">
                      {item.wrong}/{item.total}
                    </span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
