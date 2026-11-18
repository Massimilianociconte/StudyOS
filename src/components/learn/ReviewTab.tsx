// Oggi: prima cosa riprendere (sessioni e quiz in pausa, anche iniziati su un altro dispositivo), poi
// il numero grande delle schede di oggi con la barra che dice di cosa è fatto e un solo pulsante per
// partire. Sotto, le raccolte con qualcosa da fare (un tocco e si parte) e le ultime sessioni, con
// una barra dei risultati al posto delle parole. «Personalizza» apre le scelte complete.
import { useMemo, useState } from "react";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { buildDeckTree, filterCounts, flattenTree, nextDueDay, percent } from "../../lib/learnSession";
import { pausedRuns, type ResumePoint } from "../../lib/learnResume";
import { LEARN_TEXT } from "../../lib/labels/learn";
import { discardRun } from "../../store/learning";
import type { ReviewResult, StudyRun } from "../../types";
import { InlineConfirm } from "../InlineConfirm";
import { Button, EmptyState, Panel } from "../ui";
import { Icon } from "../Icon";
import { SubjectMark } from "../SubjectMark";
import { deckSubjectId } from "../../lib/learningModel";
import { limitOf, type SessionOptions } from "./SessionBuilder";
import { PausedTags, ResumedTag } from "./ResumeTags";
import { scoreTone } from "./tones";
import { unionOf, type LearnData } from "./useLearnData";

const DECK_ROWS = 12;
const PAUSED_ROWS = 4;

const dayText = (day: Date) => (isToday(day) ? "oggi" : isTomorrow(day) ? "domani" : `il ${format(day, "d MMMM", { locale: it })}`);

const RESULT_BAR: Record<ReviewResult, string> = {
  correct: "bg-[var(--success-text)]",
  doubt: "bg-[var(--warning-text)]",
  wrong: "bg-[var(--danger-text)]",
  skip: "bg-[var(--faint)]"
};

/** Barra orizzontale a segmenti (somma dei valori = 100%). */
function StackBar({ parts, className = "" }: { parts: { value: number; tone: string }[]; className?: string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return null;
  return (
    <span aria-hidden="true" className={`flex overflow-hidden rounded-full bg-[var(--surface-strong)] ${className}`}>
      {parts.map((part, position) => (part.value ? <span key={position} className={`h-full ${part.tone}`} style={{ width: `${(part.value / total) * 100}%` }} /> : null))}
    </span>
  );
}

function Legend({ tone, value, label }: { tone: string; value: number; label: string }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--muted)]">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} />
      <span className="font-black tabular-nums text-[var(--text)]">{value}</span>
      {label}
    </span>
  );
}

// Una sola azione principale per schermata: con schede da ripassare oggi il pulsante giallo è
// «Ripassa N schede» e qui «Riprendi» è secondario; senza, il primo «Riprendi» diventa principale.
function PausedList({ data, onResume, lead }: { data: LearnData; onResume: (run: StudyRun) => void; lead: boolean }) {
  const [discarding, setDiscarding] = useState<string | null>(null);
  const paused = useMemo(() => pausedRuns(data.studyRuns).slice(0, PAUSED_ROWS), [data.studyRuns]);
  if (!paused.length) return null;
  return (
    <Panel className="border-[color-mix(in_srgb,var(--warning-text)_35%,var(--border))]">
      <h3 className="mb-2 flex items-center gap-2 text-lg font-black">
        <Icon name="Pause" className="h-4 w-4 text-[var(--warning-text)]" />
        {LEARN_TEXT.resumeTitle}
      </h3>
      <ul className="grid grid-cols-1 gap-2">
        {paused.map(({ run, point }, position) => {
          const quiz = run.kind === "quiz";
          return (
            <li key={run.id} className="min-w-0 rounded-[18px] bg-[var(--surface-soft)] p-3">
              <div className="flex min-w-0 items-center gap-3">
                {/* Sotto i 380px l'icona lascia il posto al titolo (con «Riprendi» accanto si spezzava a metà parola). */}
                <span className="grid h-10 w-10 shrink-0 grid-cols-1 place-items-center rounded-full bg-[var(--surface-strong)] text-[var(--accent-ink)] max-[379px]:hidden">
                  <Icon name={quiz ? "CircleDot" : "Layers"} className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="learn-read line-clamp-2 text-sm font-black leading-snug">{run.title || LEARN_TEXT.sessionTitle}</span>
                  <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{quiz ? LEARN_TEXT.resumeQuiz : LEARN_TEXT.resumeFlashcards}</span>
                </span>
                <Button variant={lead && position === 0 ? "primary" : "soft"} icon="PlayCircle" className="shrink-0 px-3.5" onClick={() => onResume(run)}>
                  {LEARN_TEXT.resume}
                </Button>
              </div>
              {/* Dove e quando è stata interrotta: «Da iPhone · Safari», «Interrotta ieri alle 18:30». */}
              <PausedTags run={run} when className="mt-2" />
              <div className="mt-2.5 flex items-center gap-2">
                <span
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={point.total}
                  aria-valuenow={point.done}
                  aria-label={LEARN_TEXT.resumeAt(point.done, point.total)}
                  className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-strong)]"
                >
                  <span className="block h-full rounded-full bg-[var(--warning-text)]" style={{ width: `${(point.done / Math.max(1, point.total)) * 100}%` }} />
                </span>
                <span className="shrink-0 text-xs font-black tabular-nums text-[var(--muted)]">{LEARN_TEXT.resumeAt(point.done, point.total)}</span>
                <button
                  type="button"
                  onClick={() => setDiscarding(run.id)}
                  className="motion-safe shrink-0 rounded-full px-2 py-1 text-xs font-extrabold text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
                >
                  {LEARN_TEXT.discard}
                </button>
              </div>
              {discarding === run.id ? (
                <div className="mt-2">
                  <InlineConfirm
                    text={quiz ? LEARN_TEXT.discardQuizConfirm : LEARN_TEXT.discardConfirm}
                    confirmLabel={LEARN_TEXT.discard}
                    icon="Trash2"
                    onCancel={() => setDiscarding(null)}
                    onConfirm={() => {
                      setDiscarding(null);
                      void discardRun(run.id).catch(() => undefined);
                    }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function ReviewTab({
  data,
  today,
  size,
  onStart,
  onCustomize,
  onResume,
  pausedDecks
}: {
  data: LearnData;
  today: string;
  size: number;
  /** Sessioni in pausa su una sola raccolta: la riga della raccolta le riprende. */
  pausedDecks: ReadonlyMap<string, { run: StudyRun; point: ResumePoint }>;
  onStart: (options: SessionOptions) => void;
  onCustomize: (deckIds: string[]) => void;
  onResume: (run: StudyRun) => void;
}) {
  const union = useMemo(() => unionOf(data), [data.own, data.shared]);
  const now = useMemo(() => new Date(), [today, data.cardStates]);
  const counts = useMemo(() => filterCounts(union.cards, data.states, now), [union, data.states, now]);
  const upcoming = useMemo(() => (counts.today ? null : nextDueDay(union.cards.map((card) => card.id), data.states, now)), [counts.today, union, data.states, now]);

  const decks = useMemo(
    () =>
      flattenTree(buildDeckTree(union.decks, union.cards, data.states, [], now))
        .filter((node) => node.counts.due + node.counts.fresh > 0)
        .slice(0, DECK_ROWS),
    [union, data.states, now]
  );

  const recent = useMemo(
    () =>
      data.studyRuns
        .filter((run) => run.kind === "flashcards" && run.events.length && !run.continuesId && !run.progress)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 6),
    [data.studyRuns]
  );

  if (!union.cards.length && !data.studyRuns.some((run) => run.progress)) {
    return <EmptyState icon="Layers" title={LEARN_TEXT.emptyLibraryTitle} body={LEARN_TEXT.emptyLibraryBody} />;
  }

  const planned = Math.min(counts.today, limitOf(size));
  const rest = counts.today - planned;
  const overdue = counts.overdue;
  const dueOnly = Math.max(0, counts.due - overdue);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 grid-cols-1 content-start gap-4">
        {/* Prima il ripasso di oggi (il compito di ogni giorno), poi quello lasciato a metà. */}
        <Panel className="flex flex-col gap-4">
          {counts.today ? (
            <div className="min-w-0">
              <p className="text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.today}</p>
              <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2.5">
                <span className="text-5xl font-black leading-none tabular-nums sm:text-6xl">{counts.today}</span>
                <span className="text-base font-extrabold text-[var(--muted)]">{LEARN_TEXT.todayCards(counts.today)}</span>
              </p>
              <StackBar
                className="mt-4 h-2.5"
                parts={[
                  { value: overdue, tone: "bg-[var(--warning-text)]" },
                  { value: dueOnly, tone: "bg-[var(--accent)]" },
                  { value: counts.new, tone: "bg-[var(--accent-2)]" }
                ]}
              />
              <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                <Legend tone="bg-[var(--warning-text)]" value={overdue} label={LEARN_TEXT.todayOverdue} />
                <Legend tone="bg-[var(--accent)]" value={dueOnly} label={LEARN_TEXT.todayDue} />
                <Legend tone="bg-[var(--accent-2)]" value={counts.new} label={LEARN_TEXT.todayNew} />
              </p>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid grid-cols-1 h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success-text)]">
                <Icon name="Check" className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h3 className="text-2xl font-black leading-tight">{LEARN_TEXT.caughtUp}</h3>
                <p className="mt-0.5 text-sm font-bold text-[var(--muted)]">{upcoming ? LEARN_TEXT.caughtUpNext(dayText(upcoming.day), upcoming.count) : LEARN_TEXT.caughtUpNone}</p>
              </div>
            </div>
          )}
          {union.cards.length ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              {counts.today ? (
                <Button variant="primary" icon="PlayCircle" className="min-h-12 text-base sm:px-6" onClick={() => onStart({ deckIds: [], filter: "today", limit: size, shuffle: false })}>
                  {LEARN_TEXT.startCount(planned)}
                </Button>
              ) : (
                <Button variant="soft" icon="PlayCircle" className="min-h-12 text-base sm:px-6" onClick={() => onStart({ deckIds: [], filter: "all", limit: size, shuffle: false, title: LEARN_TEXT.sessionTitle })}>
                  {LEARN_TEXT.reviewAnyway}
                </Button>
              )}
              <Button variant="ghost" icon="Settings" onClick={() => onCustomize([])}>
                {LEARN_TEXT.customize}
              </Button>
              {counts.today && rest > 0 ? <p className="text-xs font-medium text-[var(--muted)] sm:ml-auto">{LEARN_TEXT.startRest(rest)}</p> : null}
            </div>
          ) : null}
        </Panel>

        <PausedList data={data} onResume={onResume} lead={!counts.today} />

        {decks.length ? (
          <Panel>
            <h3 className="mb-2 text-lg font-black">{LEARN_TEXT.byDeck}</h3>
            <ul className="grid grid-cols-1 gap-0.5">
              {decks.map(({ deck, depth, counts: deckCounts }) => {
                const owner = depth === 0 ? union.ownerOfDeck.get(deck.id) : undefined;
                const paused = pausedDecks.get(deck.id);
                const action = paused ? LEARN_TEXT.resumeDeck(deck.title) : LEARN_TEXT.studyNow(deck.title);
                return (
                  <li key={deck.id} className="min-w-0">
                    <button
                      type="button"
                      title={action}
                      aria-label={paused ? `${action}: ${LEARN_TEXT.resumeAt(paused.point.done, paused.point.total)}` : `${action}: ${LEARN_TEXT.deckTodo(deckCounts.due, deckCounts.fresh)}`}
                      onClick={() => (paused ? onResume(paused.run) : onStart({ deckIds: [deck.id], filter: "today", limit: size, shuffle: false }))}
                      className="motion-safe group flex min-h-12 w-full min-w-0 flex-col items-stretch justify-center gap-1.5 rounded-[16px] py-2 pr-2 text-left hover:bg-[var(--surface-soft)]"
                      style={{ paddingLeft: `${0.5 + Math.min(depth, 4) * 1}rem` }}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <SubjectMark subjectId={union.ownerOfDeck.has(deck.id) ? undefined : deckSubjectId(union.decks, deck.id)} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className={`one-line-safe block ${depth ? "text-sm font-bold" : "text-sm font-black"}`}>{deck.title}</span>
                          {owner ? <span className="one-line-safe block text-xs font-bold text-[var(--faint)]">{LEARN_TEXT.sharedBy(owner.name)}</span> : null}
                        </span>
                        {paused ? null : deckCounts.due ? (
                          <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-2 py-0.5 text-xs font-black tabular-nums text-[var(--accent-ink)]">{deckCounts.due}</span>
                        ) : null}
                        {!paused && deckCounts.fresh ? (
                          <span className="shrink-0 rounded-full bg-[color-mix(in_srgb,var(--accent-2)_20%,transparent)] px-2 py-0.5 text-xs font-black tabular-nums">+{deckCounts.fresh}</span>
                        ) : null}
                        {paused ? <span className="shrink-0 text-xs font-black tabular-nums text-[var(--warning-text)]">{LEARN_TEXT.resumeAt(paused.point.done, paused.point.total)}</span> : null}
                        <Icon name="PlayCircle" className="motion-safe h-5 w-5 shrink-0 text-[var(--faint)] group-hover:text-[var(--accent-ink)]" />
                      </span>
                      {/* Sessione in pausa: etichette su una riga loro, a tutta larghezza (sui telefoni stretti non si troncano). */}
                      {paused ? <PausedTags run={paused.run} status /> : null}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 px-2 text-xs font-bold text-[var(--faint)]">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--accent)]" />
                {LEARN_TEXT.todayDue}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[var(--accent-2)]" />
                {LEARN_TEXT.todayNew}
              </span>
            </p>
          </Panel>
        ) : null}
      </div>

      <Panel className="lg:self-start">
        <h3 className="mb-2 text-lg font-black">{LEARN_TEXT.recentSessions}</h3>
        {recent.length ? (
          <ul className="grid grid-cols-1 gap-1.5">
            {recent.map((run) => {
              const tally = { correct: 0, wrong: 0, doubt: 0, skip: 0 };
              for (const event of run.events) tally[event.r]++;
              const answered = tally.correct + tally.wrong + tally.doubt;
              return (
                <li key={run.id} className="flex min-w-0 items-center gap-3 rounded-[16px] bg-[var(--surface-soft)] px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="one-line-safe block text-sm font-black">{run.title || LEARN_TEXT.sessionTitle}</span>
                    {run.resumed ? (
                      <span className="my-1 flex min-w-0">
                        <ResumedTag run={run} />
                      </span>
                    ) : null}
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-xs font-bold text-[var(--muted)]">{format(parseISO(run.startedAt), "d MMM, HH:mm", { locale: it })}</span>
                      <StackBar
                        className="h-1.5 min-w-0 max-w-[9rem] flex-1"
                        parts={(["correct", "doubt", "wrong", "skip"] as const).map((result) => ({ value: tally[result], tone: RESULT_BAR[result] }))}
                      />
                      <span className="sr-only">{LEARN_TEXT.sessionSummary(tally.correct, tally.wrong, tally.doubt, tally.skip)}</span>
                    </span>
                  </span>
                  {answered ? <span className={`shrink-0 text-lg font-black tabular-nums ${scoreTone(tally.correct / answered)}`}>{percent(tally.correct / answered)}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm font-medium text-[var(--muted)]">{LEARN_TEXT.statsEmptyBody}</p>
        )}
      </Panel>
    </div>
  );
}
