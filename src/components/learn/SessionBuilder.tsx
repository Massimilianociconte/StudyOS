// Prepara un ripasso: quali raccolte (anche condivise), quali schede (da ripassare, nuove, difficili,
// dubbie, tutte, a caso), quante al massimo e in che ordine. Mostra quante schede entreranno.
import { useEffect, useMemo, useState } from "react";
import { buildQueue, cardsInDecks, deckVisitOrder } from "../../lib/learnSession";
import { classifyCard } from "../../lib/srs";
import { LEARN_TEXT, SESSION_FILTERS, SESSION_FILTER_LABEL, type SessionFilter } from "../../lib/labels/learn";
import type { StudyRunMode } from "../../types";
import { Button, Drawer, Field, Segmented, inputClass } from "../ui";
import type { SessionSpec } from "./StudySession";
import { unionOf, type LearnData } from "./useLearnData";

const LIMITS = [10, 20, 30, 50, 100, 200, 500] as const;

export const MODE_OF_FILTER: Record<SessionFilter, StudyRunMode> = {
  due: "review",
  new: "free",
  difficult: "custom",
  doubtful: "custom",
  all: "free",
  random: "random"
};

/** Coda pronta per StudySession (con chi condivide ogni scheda). */
export const sessionSpec = (
  data: LearnData,
  options: { deckIds: string[]; filter: SessionFilter; limit: number; order: "priority" | "shuffle"; title?: string; now?: Date }
): SessionSpec => {
  const union = unionOf(data);
  const now = options.now ?? new Date();
  const cards = cardsInDecks(union.cards, union.decks, options.deckIds);
  const queue = buildQueue(cards, data.states, union.decks, now, { filter: options.filter, limit: options.limit, order: options.order, seed: now.getTime() % 100_000 });
  const titles = options.deckIds.map((id) => union.decks.find((deck) => deck.id === id)?.title).filter(Boolean);
  const subjectIds = [...new Set(queue.map((card) => card.subjectId).filter((id): id is string => Boolean(id)))];
  return {
    title: options.title ?? (titles.length === 1 ? (titles[0] as string) : `${LEARN_TEXT.sessionTitle} · ${SESSION_FILTER_LABEL[options.filter]}`),
    items: queue.map((card) => ({ card, ...(union.ownerOfCard.has(card.id) ? { owner: union.ownerOfCard.get(card.id) } : {}) })),
    deckIds: options.deckIds,
    subjectIds,
    mode: MODE_OF_FILTER[options.filter]
  };
};

export function SessionBuilder({ open, initialDeckIds, data, onClose, onStart }: { open: boolean; initialDeckIds: string[]; data: LearnData; onClose: () => void; onStart: (spec: SessionSpec) => void }) {
  const [deckIds, setDeckIds] = useState<string[]>(initialDeckIds);
  const [filter, setFilter] = useState<SessionFilter>("due");
  const [limit, setLimit] = useState<number>(30);
  const [order, setOrder] = useState<"priority" | "shuffle">("priority");

  const union = useMemo(() => unionOf(data), [data.own, data.shared]);
  const now = useMemo(() => new Date(), [open]);

  useEffect(() => {
    if (!open) return;
    setDeckIds(initialDeckIds);
    // Una raccolta scelta dall'albero senza schede da ripassare: si parte da «Tutte».
    const scoped = cardsInDecks(union.cards, union.decks, initialDeckIds);
    setFilter(scoped.some((card) => classifyCard(data.states.get(card.id), now).due) ? "due" : "all");
  }, [open]);

  // Raccolte nell'ordine dell'albero, con il rientro della profondità.
  const options = useMemo(() => {
    const order = deckVisitOrder(union.decks);
    const byId = new Map(union.decks.map((deck) => [deck.id, deck]));
    const depthOf = (id: string) => {
      let depth = 0;
      let cursor = byId.get(id);
      while (cursor?.parentId && byId.has(cursor.parentId) && depth < 12) {
        depth++;
        cursor = byId.get(cursor.parentId);
      }
      return depth;
    };
    return union.decks
      .slice()
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((deck) => ({ deck, depth: depthOf(deck.id), owner: union.ownerOfDeck.get(deck.id) }));
  }, [union]);

  const counts = useMemo(() => {
    const scoped = cardsInDecks(union.cards, union.decks, deckIds);
    const out: Record<SessionFilter, number> = { due: 0, new: 0, difficult: 0, doubtful: 0, all: scoped.length, random: scoped.length };
    for (const card of scoped) {
      const info = classifyCard(data.states.get(card.id), now);
      if (info.due) out.due++;
      if (info.isNew) out.new++;
      if (info.difficult) out.difficult++;
      if (info.doubtful) out.doubtful++;
    }
    return out;
  }, [union, deckIds, data.states, now]);

  const planned = Math.min(counts[filter], limit);
  const toggle = (id: string) => setDeckIds((value) => (value.includes(id) ? value.filter((item) => item !== id) : [...value, id]));

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={LEARN_TEXT.builderTitle}
      footer={
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-sm font-bold text-[var(--muted)]" aria-live="polite">
            {LEARN_TEXT.cardsCount(planned)}
          </span>
          <Button onClick={onClose}>{LEARN_TEXT.cancel}</Button>
          <Button variant="primary" icon="PlayCircle" disabled={!planned} onClick={() => onStart(sessionSpec(data, { deckIds, filter, limit, order, now: new Date() }))}>
            {LEARN_TEXT.start}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5">
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.builderScope}</legend>
          <div className="scrollbar-soft max-h-64 overflow-y-auto rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-1.5">
            <label className="flex min-h-11 items-center gap-2 rounded-[12px] px-2 text-sm font-black hover:bg-[var(--surface)]">
              <input type="checkbox" checked={!deckIds.length} onChange={() => setDeckIds([])} />
              {LEARN_TEXT.builderAllDecks}
            </label>
            {options.map(({ deck, depth, owner }) => (
              <label key={deck.id} className="flex min-h-11 items-center gap-2 rounded-[12px] px-2 text-sm font-bold hover:bg-[var(--surface)]" style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}>
                <input type="checkbox" checked={deckIds.includes(deck.id)} onChange={() => toggle(deck.id)} />
                <span className="one-line-safe min-w-0 flex-1">{deck.title}</span>
                {owner && depth === 0 ? <span className="shrink-0 text-xs font-bold text-[var(--faint)]">{LEARN_TEXT.sharedBy(owner.name)}</span> : null}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.builderFilter}</p>
          <Segmented<SessionFilter>
            label={LEARN_TEXT.builderFilter}
            value={filter}
            onChange={setFilter}
            size="sm"
            options={SESSION_FILTERS.map((id) => ({ id, label: SESSION_FILTER_LABEL[id], count: counts[id] }))}
          />
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={LEARN_TEXT.builderLimit}>
            <select className={inputClass} value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              {LIMITS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
          <div className="min-w-0">
            <p className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.builderOrder}</p>
            <Segmented<"priority" | "shuffle">
              label={LEARN_TEXT.builderOrder}
              value={filter === "random" ? "shuffle" : order}
              onChange={setOrder}
              size="sm"
              options={[
                { id: "priority", label: LEARN_TEXT.orderPriority },
                { id: "shuffle", label: LEARN_TEXT.orderShuffle }
              ]}
            />
          </div>
        </div>
      </div>
    </Drawer>
  );
}
