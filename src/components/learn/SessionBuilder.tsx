// Personalizza il ripasso: quali raccolte (anche condivise), quali schede (consigliate, da ripassare,
// nuove, difficili o dubbie, tutte), quante per sessione e se mescolarle. Mostra quante schede
// entreranno. Le scelte (tranne le raccolte) restano su questo dispositivo per la volta dopo.
import { useEffect, useMemo, useState } from "react";
import { buildQueue, cardsInDecks, deckVisitOrder, filterCounts } from "../../lib/learnSession";
import { LEARN_TEXT, SESSION_FILTERS, SESSION_FILTER_HINT, SESSION_FILTER_LABEL, SESSION_SIZES, type SessionFilter } from "../../lib/labels/learn";
import { oneOf, useUiState } from "../../lib/uiState";
import type { StudyRunMode } from "../../types";
import { Button, Drawer, Segmented } from "../ui";
import type { SessionSpec } from "./StudySession";
import { unionOf, type LearnData } from "./useLearnData";

export interface SessionOptions {
  deckIds: string[];
  filter: SessionFilter;
  /** Schede per sessione; 0 = tutte. */
  limit: number;
  shuffle: boolean;
  title?: string;
}

const MODE_OF_FILTER: Record<SessionFilter, StudyRunMode> = {
  today: "review",
  due: "review",
  new: "free",
  hard: "custom",
  all: "free"
};

/** Nessun limite pratico: «Tutte» le schede dell'ambito. */
const NO_LIMIT = 100_000;
export const limitOf = (limit: number) => (limit > 0 ? limit : NO_LIMIT);

export const isSessionSize = (value: unknown): value is number => typeof value === "number" && (SESSION_SIZES as readonly number[]).includes(value);

/** Coda pronta per StudySession (con chi condivide ogni scheda). `exclude`: schede già viste. */
export const sessionSpec = (data: LearnData, options: SessionOptions, extra: { now?: Date; exclude?: ReadonlySet<string> } = {}): SessionSpec => {
  const union = unionOf(data);
  const now = extra.now ?? new Date();
  const cards = cardsInDecks(union.cards, union.decks, options.deckIds);
  const queue = buildQueue(cards, data.states, union.decks, now, {
    filter: options.filter,
    limit: limitOf(options.limit),
    order: options.shuffle ? "shuffle" : "priority",
    seed: now.getTime() % 100_000,
    ...(extra.exclude ? { exclude: extra.exclude } : {})
  });
  const titles = options.deckIds.map((id) => union.decks.find((deck) => deck.id === id)?.title).filter((title): title is string => Boolean(title));
  const title =
    options.title ??
    (titles.length === 1
      ? titles[0]
      : titles.length > 1
        ? `${titles[0]} e altre ${titles.length - 1}`
        : options.filter === "today"
          ? `${LEARN_TEXT.sessionTitle} di oggi`
          : `${LEARN_TEXT.sessionTitle} · ${SESSION_FILTER_LABEL[options.filter]}`);
  const subjectIds = [...new Set(queue.map((card) => card.subjectId).filter((id): id is string => Boolean(id)))];
  return {
    title,
    items: queue.map((card) => ({ card, ...(union.ownerOfCard.has(card.id) ? { owner: union.ownerOfCard.get(card.id) } : {}) })),
    deckIds: options.deckIds,
    subjectIds,
    mode: options.shuffle && options.filter === "all" ? "random" : MODE_OF_FILTER[options.filter],
    options
  };
};

export function SessionBuilder({
  open,
  initialDeckIds,
  data,
  size,
  onSize,
  onClose,
  onStart
}: {
  open: boolean;
  initialDeckIds: string[];
  data: LearnData;
  size: number;
  onSize: (size: number) => void;
  onClose: () => void;
  onStart: (options: SessionOptions) => void;
}) {
  const [deckIds, setDeckIds] = useState<string[]>(initialDeckIds);
  const [remembered, setRemembered] = useUiState<SessionFilter>("learn.filter", "today", { validate: oneOf(...SESSION_FILTERS) });
  const [shuffle, setShuffle] = useUiState<boolean>("learn.shuffle", false, { validate: (value) => typeof value === "boolean" });
  const [filter, setFilter] = useState<SessionFilter>(remembered);

  const union = useMemo(() => unionOf(data), [data.own, data.shared]);
  const now = useMemo(() => new Date(), [open]);

  const countsFor = (ids: readonly string[]) => filterCounts(cardsInDecks(union.cards, union.decks, ids), data.states, now);

  useEffect(() => {
    if (!open) return;
    setDeckIds(initialDeckIds);
    // L'ultima scelta, se ha schede in questo ambito; altrimenti le consigliate, poi tutte.
    const scoped = countsFor(initialDeckIds);
    setFilter(scoped[remembered] ? remembered : scoped.today ? "today" : "all");
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

  const counts = useMemo(() => countsFor(deckIds), [union, deckIds, data.states, now]);

  const planned = Math.min(counts[filter], limitOf(size));
  const toggle = (id: string) => setDeckIds((value) => (value.includes(id) ? value.filter((item) => item !== id) : [...value, id]));
  const start = () => {
    setRemembered(filter);
    onStart({ deckIds, filter, limit: size, shuffle });
  };

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
          <Button variant="primary" icon="PlayCircle" disabled={!planned} onClick={start}>
            {LEARN_TEXT.start}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-5">
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.builderScope}</legend>
          <div className="scrollbar-soft max-h-56 overflow-y-auto rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-1.5">
            <label className="flex min-h-11 items-center gap-2 rounded-[12px] px-2 text-sm font-black hover:bg-[var(--surface)]">
              <input type="checkbox" checked={!deckIds.length} onChange={() => setDeckIds([])} />
              {LEARN_TEXT.builderAllDecks}
            </label>
            {options.map(({ deck, depth, owner }) => (
              <label key={deck.id} className="flex min-h-11 items-center gap-2 rounded-[12px] px-2 text-sm font-bold hover:bg-[var(--surface)]" style={{ paddingLeft: `${0.5 + depth * 1.1}rem` }}>
                <input type="checkbox" checked={deckIds.includes(deck.id)} onChange={() => toggle(deck.id)} />
                <span className="one-line-safe min-w-0 flex-1">{deck.title}</span>
                {owner && depth === 0 ? <span className="shrink-0 text-xs font-bold text-[var(--faint)]">{LEARN_TEXT.sharedDeckBy(owner.name)}</span> : null}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.builderFilter}</legend>
          <div className="grid grid-cols-1 gap-1.5">
            {SESSION_FILTERS.map((id) => {
              const empty = !counts[id];
              const active = filter === id;
              return (
                <label
                  key={id}
                  className={`motion-safe flex min-h-12 items-start gap-3 rounded-[16px] border px-3 py-2.5 ${
                    active ? "border-[var(--accent-ink)] bg-[var(--surface)]" : "border-[var(--border)] bg-[var(--surface-soft)]"
                  } ${empty ? "opacity-55" : "cursor-pointer hover:bg-[var(--surface)]"}`}
                >
                  <input type="radio" name="learn-filter" className="mt-1" checked={active} disabled={empty} onChange={() => setFilter(id)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-2">
                      <span className="text-sm font-black">{SESSION_FILTER_LABEL[id]}</span>
                      <span className="text-xs font-bold tabular-nums text-[var(--muted)]">{counts[id]}</span>
                    </span>
                    <span className="safe-text block text-xs font-medium text-[var(--muted)]">{SESSION_FILTER_HINT[id]}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>

        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.builderLimit}</p>
          <Segmented<string>
            label={LEARN_TEXT.builderLimit}
            value={String(size)}
            onChange={(value) => onSize(Number(value))}
            options={SESSION_SIZES.map((value) => ({ id: String(value), label: value ? String(value) : LEARN_TEXT.limitAll }))}
          />
        </div>

        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[16px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 hover:bg-[var(--surface)]">
          <input type="checkbox" className="mt-1" checked={shuffle} onChange={(event) => setShuffle(event.target.checked)} />
          <span className="min-w-0">
            <span className="block text-sm font-black">{LEARN_TEXT.shuffle}</span>
            <span className="safe-text block text-xs font-medium text-[var(--muted)]">{LEARN_TEXT.shuffleHint}</span>
          </span>
        </label>
      </div>
    </Drawer>
  );
}
