// Ripasso: un solo pulsante per partire («Ripassa N schede»: prima quelle in scadenza, poi le nuove),
// le raccolte con qualcosa da fare (un tocco e si parte) e le ultime sessioni con il risultato.
// «Personalizza» apre le scelte complete.
import { useMemo } from "react";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { buildDeckTree, filterCounts, flattenTree, nextDueDay, percent } from "../../lib/learnSession";
import { LEARN_TEXT } from "../../lib/labels/learn";
import { Button, EmptyState, Panel } from "../ui";
import { Icon } from "../Icon";
import { SubjectMark } from "../SubjectMark";
import { deckSubjectId } from "../../lib/learningModel";
import { limitOf, type SessionOptions } from "./SessionBuilder";
import { unionOf, type LearnData } from "./useLearnData";

const DECK_ROWS = 12;

const dayText = (day: Date) => (isToday(day) ? "oggi" : isTomorrow(day) ? "domani" : `il ${format(day, "d MMMM", { locale: it })}`);

export function ReviewTab({
  data,
  today,
  size,
  onStart,
  onCustomize
}: {
  data: LearnData;
  today: string;
  size: number;
  onStart: (options: SessionOptions) => void;
  onCustomize: (deckIds: string[]) => void;
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
        .filter((run) => run.kind === "flashcards" && run.events.length && !run.continuesId)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 6),
    [data.studyRuns]
  );

  if (!union.cards.length) {
    return <EmptyState icon="Layers" title={LEARN_TEXT.emptyLibraryTitle} body={LEARN_TEXT.emptyLibraryBody} />;
  }

  const planned = Math.min(counts.today, limitOf(size));
  const rest = counts.today - planned;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 content-start gap-4">
        <Panel className="flex flex-col gap-4">
          <div className="min-w-0">
            <p className="text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.today}</p>
            {counts.today ? (
              <>
                <h3 className="mt-1 text-2xl font-black leading-tight sm:text-3xl">{LEARN_TEXT.todayCount(counts.today)}</h3>
                <p className="mt-1 text-sm font-bold text-[var(--muted)]">{LEARN_TEXT.todayBreakdown(counts.due, counts.new, counts.overdue)}</p>
              </>
            ) : (
              <>
                <h3 className="mt-1 text-2xl font-black leading-tight sm:text-3xl">{LEARN_TEXT.caughtUp}</h3>
                <p className="mt-1 text-sm font-bold text-[var(--muted)]">{upcoming ? LEARN_TEXT.caughtUpNext(dayText(upcoming.day), upcoming.count) : LEARN_TEXT.caughtUpNone}</p>
              </>
            )}
          </div>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {counts.today ? (
              <Button variant="primary" icon="PlayCircle" className="min-h-12 text-base sm:px-6" onClick={() => onStart({ deckIds: [], filter: "today", limit: size, shuffle: false })}>
                {LEARN_TEXT.startCount(planned)}
              </Button>
            ) : (
              <Button variant="primary" icon="PlayCircle" className="min-h-12 text-base sm:px-6" onClick={() => onStart({ deckIds: [], filter: "all", limit: size, shuffle: false, title: LEARN_TEXT.sessionTitle })}>
                {LEARN_TEXT.reviewAnyway}
              </Button>
            )}
            <Button variant="soft" icon="Settings" onClick={() => onCustomize([])}>
              {LEARN_TEXT.customize}
            </Button>
          </div>
          {counts.today && rest > 0 ? <p className="-mt-2 text-xs font-medium text-[var(--muted)]">{LEARN_TEXT.startRest(rest)}</p> : null}
        </Panel>

        {decks.length ? (
          <Panel>
            <h3 className="text-lg font-black">{LEARN_TEXT.byDeck}</h3>
            <p className="mb-2 text-xs font-medium text-[var(--muted)]">{LEARN_TEXT.byDeckHint}</p>
            <ul className="grid gap-1">
              {decks.map(({ deck, depth, counts: deckCounts }) => {
                const owner = depth === 0 ? union.ownerOfDeck.get(deck.id) : undefined;
                return (
                  <li key={deck.id}>
                    <button
                      type="button"
                      title={LEARN_TEXT.studyNow(deck.title)}
                      onClick={() => onStart({ deckIds: [deck.id], filter: "today", limit: size, shuffle: false })}
                      className="motion-safe group flex min-h-12 w-full min-w-0 items-center gap-2 rounded-[16px] py-2 pr-2 text-left hover:bg-[var(--surface-soft)]"
                      style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}
                    >
                      <SubjectMark subjectId={union.ownerOfDeck.has(deck.id) ? undefined : deckSubjectId(union.decks, deck.id)} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="one-line-safe block text-sm font-black">{deck.title}</span>
                        <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
                          {LEARN_TEXT.deckTodo(deckCounts.due, deckCounts.fresh)}
                          {owner ? ` · ${LEARN_TEXT.sharedBy(owner.name)}` : ""}
                        </span>
                      </span>
                      <Icon name="PlayCircle" className="motion-safe h-5 w-5 shrink-0 text-[var(--muted)] group-hover:text-[var(--accent-ink)]" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </Panel>
        ) : null}
      </div>

      <Panel className="lg:self-start">
        <h3 className="mb-2 text-lg font-black">{LEARN_TEXT.recentSessions}</h3>
        {recent.length ? (
          <ul className="grid gap-2">
            {recent.map((run) => {
              const tally = { correct: 0, wrong: 0, doubt: 0, skip: 0 };
              for (const event of run.events) tally[event.r]++;
              const answered = tally.correct + tally.wrong + tally.doubt;
              return (
                <li key={run.id} className="flex min-w-0 items-center gap-3 rounded-[16px] bg-[var(--surface-soft)] px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="one-line-safe block text-sm font-black">{run.title || LEARN_TEXT.sessionTitle}</span>
                    <span className="block text-xs font-bold text-[var(--muted)]">
                      {format(parseISO(run.startedAt), "d MMM, HH:mm", { locale: it })} · {LEARN_TEXT.sessionSummary(tally.correct, tally.wrong, tally.doubt, tally.skip)}
                    </span>
                  </span>
                  {answered ? <span className="shrink-0 text-lg font-black tabular-nums">{percent(tally.correct / answered)}</span> : null}
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
