// Ripasso: quante schede aspettano oggi, «Ripassa ora», le raccolte con più schede in scadenza e le
// ultime sessioni. «Prepara un ripasso» apre il costruttore con tutti i filtri.
import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { classifyCard } from "../../lib/srs";
import { LEARN_TEXT } from "../../lib/labels/learn";
import { Button, EmptyState, Panel } from "../ui";
import { Icon } from "../Icon";
import { unionOf, type LearnData } from "./useLearnData";

export function ReviewTab({ data, today, onQuickStart, onBuild }: { data: LearnData; today: string; onQuickStart: () => void; onBuild: (deckIds: string[]) => void }) {
  const union = useMemo(() => unionOf(data), [data.own, data.shared]);
  const summary = useMemo(() => {
    const now = new Date();
    let due = 0;
    let overdue = 0;
    let fresh = 0;
    const perDeck = new Map<string, number>();
    for (const card of union.cards) {
      const info = classifyCard(data.states.get(card.id), now);
      if (info.isNew) fresh++;
      else if (info.due) {
        due++;
        if (info.overdue) overdue++;
        perDeck.set(card.deckId, (perDeck.get(card.deckId) ?? 0) + 1);
      }
    }
    const byId = new Map(union.decks.map((deck) => [deck.id, deck]));
    const top = [...perDeck.entries()]
      .map(([deckId, count]) => ({ deck: byId.get(deckId), count }))
      .filter((item): item is { deck: NonNullable<typeof item.deck>; count: number } => Boolean(item.deck))
      .sort((a, b) => b.count - a.count || a.deck.title.localeCompare(b.deck.title, "it"))
      .slice(0, 8);
    return { due, overdue, fresh, top };
  }, [union, data.states, today]);

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

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <Panel className="flex flex-col gap-4">
        <div>
          <p className="text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.dueToday}</p>
          <p className="mt-1 text-5xl font-black tabular-nums leading-none">{summary.due}</p>
          <p className="mt-2 text-sm font-bold text-[var(--muted)]">
            {LEARN_TEXT.dueTodayHint(summary.due)}
            {summary.overdue ? ` · ${summary.overdue} in ritardo` : ""}
            {summary.fresh ? ` · ${LEARN_TEXT.newCount(summary.fresh)}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon="PlayCircle" onClick={onQuickStart} disabled={!summary.due && !summary.fresh}>
            {LEARN_TEXT.startDue}
          </Button>
          <Button variant="soft" icon="Target" onClick={() => onBuild([])}>
            {LEARN_TEXT.builderTitle}
          </Button>
        </div>
        {summary.top.length ? (
          <ul className="grid gap-1 border-t border-[var(--border)] pt-3">
            {summary.top.map(({ deck, count }) => (
              <li key={deck.id}>
                <button type="button" onClick={() => onBuild([deck.id])} className="motion-safe flex w-full min-w-0 items-center gap-2 rounded-[16px] px-2 py-2 text-left hover:bg-[var(--surface-soft)]">
                  <Icon name="Layers" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                  <span className="one-line-safe min-w-0 flex-1 text-sm font-black">{deck.title}</span>
                  <span className="shrink-0 text-xs font-bold text-[var(--muted)]">{LEARN_TEXT.dueCount(count)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </Panel>

      <Panel>
        <h3 className="mb-2 text-lg font-black">Ultime sessioni</h3>
        {recent.length ? (
          <ul className="grid gap-2">
            {recent.map((run) => {
              const counts = { correct: 0, wrong: 0, doubt: 0, skip: 0 };
              for (const event of run.events) counts[event.r]++;
              return (
                <li key={run.id} className="rounded-[16px] bg-[var(--surface-soft)] px-3 py-2">
                  <p className="one-line-safe text-sm font-black">{run.title || LEARN_TEXT.sessionTitle}</p>
                  <p className="text-xs font-bold text-[var(--muted)]">
                    {format(parseISO(run.startedAt), "d MMM, HH:mm", { locale: it })} · {LEARN_TEXT.sessionSummary(counts.correct, counts.wrong, counts.doubt, counts.skip)}
                  </p>
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
