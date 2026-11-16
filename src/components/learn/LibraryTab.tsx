// Raccolte: albero (materia → argomento → capitolo → …) con i conteggi, raccolte condivise da altre
// persone in sola lettura, ricerca nel testo delle schede, dettaglio di una raccolta con le schede a
// pagine di 50 (anche con migliaia di schede si disegna solo quello che si vede).
import { useMemo, useState } from "react";
import { blocksPlainText } from "../../lib/cardBlocks";
import { buildDeckTree, type DeckNode } from "../../lib/learnSession";
import { CARD_STATUS_LABEL, classifyCard } from "../../lib/srs";
import { DECK_KIND_LABEL, deckDescendantIds, deckPath, deckSubjectId, sortByPosition } from "../../lib/learningModel";
import { LEARN_TEXT } from "../../lib/labels/learn";
import { deleteDeck, duplicateDeck } from "../../store/learning";
import { deleteSharedDeck } from "../../store/sharedLearning";
import type { LearningSource } from "../../agent/learningShared";
import type { Flashcard, StudyDeck, Subject } from "../../types";
import { ConfirmWithError } from "../ConfirmWithError";
import { Icon } from "../Icon";
import { SubjectMark } from "../SubjectMark";
import { Button, Drawer, EmptyState, IconButton, Pill, inputClass } from "../ui";
import { CardDrawer, type ExplainTarget } from "./CardDrawer";
import { CardEditor } from "./CardEditor";
import { DeckEditor } from "./DeckEditor";
import { errorText, findCard, type LearnData } from "./useLearnData";

const PAGE = 50;

export interface StudyScope {
  deckIds: string[];
}

function DeckRow({
  node,
  expanded,
  toggle,
  onOpen,
  onStudy,
  inheritedSubjectId
}: {
  node: DeckNode;
  expanded: ReadonlySet<string>;
  toggle: (id: string) => void;
  onOpen: (deck: StudyDeck) => void;
  onStudy: (deck: StudyDeck) => void;
  /** Materia della raccolta madre: le sotto-raccolte senza materia propria la ereditano. */
  inheritedSubjectId?: string;
}) {
  const open = expanded.has(node.deck.id);
  const subjectId = node.deck.subjectId ?? inheritedSubjectId;
  const { counts } = node;
  return (
    <li>
      <div className="flex min-w-0 items-center gap-1.5 rounded-[18px] py-1 pr-1 hover:bg-[var(--surface-soft)]" style={{ paddingLeft: `${node.depth * 1.1}rem` }}>
        {node.children.length ? (
          <button
            type="button"
            onClick={() => toggle(node.deck.id)}
            aria-expanded={open}
            aria-label={open ? LEARN_TEXT.collapse(node.deck.title) : LEARN_TEXT.expand(node.deck.title)}
            className="motion-safe grid h-9 w-9 shrink-0 place-items-center rounded-full text-[var(--muted)] hover:bg-[var(--surface)]"
          >
            <Icon name="ChevronRight" className={`motion-safe h-4 w-4 ${open ? "rotate-90" : ""}`} />
          </button>
        ) : (
          <span className="w-9 shrink-0" aria-hidden="true" />
        )}
        <SubjectMark subjectId={subjectId} size="sm" />
        <button type="button" onClick={() => onOpen(node.deck)} className="motion-safe min-w-0 flex-1 rounded-[14px] px-1 py-1.5 text-left">
          <span className="one-line-safe block text-sm font-black">{node.deck.title}</span>
          <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">
            {DECK_KIND_LABEL[node.deck.kind]} · {LEARN_TEXT.cardsCount(counts.cards)}
            {counts.quizzes ? ` · ${LEARN_TEXT.quizzesCount(counts.quizzes)}` : ""}
          </span>
        </button>
        {counts.due ? <Pill active>{counts.due}</Pill> : null}
        {counts.cards ? <IconButton icon="PlayCircle" label={`${LEARN_TEXT.studyDeck}: ${node.deck.title}`} onClick={() => onStudy(node.deck)} /> : null}
      </div>
      {open && node.children.length ? (
        <ul>
          {node.children.map((child) => (
            <DeckRow key={child.deck.id} node={child} expanded={expanded} toggle={toggle} onOpen={onOpen} onStudy={onStudy} inheritedSubjectId={subjectId} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function CardRow({ card, status, onOpen }: { card: Flashcard; status: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="motion-safe flex w-full min-w-0 items-center gap-3 rounded-[16px] px-3 py-2.5 text-left hover:bg-[var(--surface-soft)]">
        <SubjectMark subjectId={card.subjectId} size="sm" />
        <span className="safe-text line-clamp-2 min-w-0 flex-1 text-sm font-bold">{blocksPlainText(card.front, 160) || "—"}</span>
        <span className="shrink-0 text-xs font-bold text-[var(--muted)]">{status}</span>
      </button>
    </li>
  );
}

function DeckDrawer({
  deck,
  source,
  data,
  onClose,
  onStudy,
  onOpenCard,
  onOpenDeck
}: {
  deck: StudyDeck | null;
  source: LearningSource | null;
  data: LearnData;
  onClose: () => void;
  onStudy: (deck: StudyDeck) => void;
  onOpenCard: (card: Flashcard) => void;
  onOpenDeck: (deck: StudyDeck) => void;
}) {
  // Pagine, conferma e avviso valgono per una raccolta: aprendo una sotto-raccolta nello stesso
  // drawer non restano nemmeno per un frame. Niente setState durante il render (con il drawer in
  // uscita lo teneva montato sotto la sessione) e niente effetto che li azzera dopo il disegno.
  const deckKey = deck?.id ?? "";
  const [pages, setPages] = useState<{ deckId: string; count: number }>({ deckId: "", count: PAGE });
  const [editor, setEditor] = useState<"deck" | "subdeck" | "card" | null>(null);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [noticeOf, setNoticeOf] = useState<{ deckId: string; text: string }>({ deckId: "", text: "" });
  const [duplicating, setDuplicating] = useState(false);
  const shown = pages.deckId === deckKey ? pages.count : PAGE;
  const setShown = (next: (value: number) => number) => setPages({ deckId: deckKey, count: next(shown) });
  const confirmDelete = confirmFor !== null && confirmFor === deckKey;
  const setConfirmDelete = (value: boolean) => setConfirmFor(value ? deckKey : null);
  const notice = noticeOf.deckId === deckKey ? noticeOf.text : "";
  const setNotice = (text: string) => setNoticeOf({ deckId: deckKey, text });
  const owner = source?.owner;
  const bundle = source?.bundle;
  // Libreria propria, oppure raccolta altrui con «Può modificare».
  const canEdit = !owner || owner.permission === "edit";
  const shared = owner && canEdit ? (source ?? undefined) : undefined;
  const now = new Date();
  const cards = useMemo(() => (deck && bundle ? sortByPosition(bundle.flashcards.filter((card) => card.deckId === deck.id)) : []), [deck, bundle]);
  const children = useMemo(() => (deck && bundle ? sortByPosition(bundle.decks.filter((item) => item.parentId === deck.id)) : []), [deck, bundle]);
  const scope = useMemo(() => (deck && bundle ? deckDescendantIds(bundle.decks, deck.id) : new Set<string>()), [deck, bundle]);
  const totalCards = bundle ? bundle.flashcards.filter((card) => scope.has(card.deckId)).length : 0;
  const path = deck && bundle ? deckPath(bundle.decks, deck.id) : [];
  const subjectName = (() => {
    const id = path.find((item) => item.subjectId)?.subjectId;
    if (!id) return "";
    return owner ? owner.subjectNames?.get(id) ?? "" : data.subjects.find((subject) => subject.id === id)?.name ?? "";
  })();

  const close = () => {
    setPages({ deckId: "", count: PAGE });
    setConfirmFor(null);
    setNoticeOf({ deckId: "", text: "" });
    onClose();
  };

  return (
    <>
      <Drawer
        open={Boolean(deck) && !editor}
        onClose={close}
        eyebrow={owner ? LEARN_TEXT.sharedBy(owner.name) : path.length > 1 ? path.slice(0, -1).map((item) => item.title).join(" › ") : subjectName || undefined}
        title={deck?.title ?? ""}
        footer={
          deck ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {owner ? (
                <Button
                  variant="soft"
                  icon="Copy"
                  disabled={duplicating}
                  onClick={async () => {
                    if (duplicating) return;
                    setDuplicating(true);
                    try {
                      const copy = await duplicateDeck(source!.bundle, deck.id, { subjectId: null });
                      setNotice(LEARN_TEXT.duplicated(copy.decks[0]?.title ?? deck.title));
                    } catch (failure) {
                      setNotice(errorText(failure));
                    } finally {
                      setDuplicating(false);
                    }
                  }}
                >
                  {LEARN_TEXT.duplicateDeck}
                </Button>
              ) : null}
              {canEdit ? (
                <>
                  <Button variant="soft" icon="PenLine" onClick={() => setEditor("deck")}>
                    {LEARN_TEXT.editDeck}
                  </Button>
                  <Button variant="danger" icon="Trash2" onClick={() => setConfirmDelete(true)}>
                    {LEARN_TEXT.deleteDeck}
                  </Button>
                </>
              ) : null}
              {totalCards ? (
                <Button variant="primary" icon="PlayCircle" onClick={() => onStudy(deck)}>
                  {LEARN_TEXT.studyDeck}
                </Button>
              ) : null}
            </div>
          ) : null
        }
      >
        {deck && bundle ? (
          <div className="grid grid-cols-1 gap-4">
            {notice ? (
              <p role="status" className="safe-text rounded-[14px] bg-[var(--surface-soft)] p-3 text-sm font-bold">
                {notice}
              </p>
            ) : null}
            {owner ? <p className="text-sm font-medium text-[var(--muted)]">{canEdit ? LEARN_TEXT.editShared(owner.name) : LEARN_TEXT.readOnlyShared}</p> : null}
            {confirmDelete ? (
              <ConfirmWithError
                text={shared && owner ? LEARN_TEXT.deleteSharedConfirm(deck.title, owner.name) : LEARN_TEXT.deleteDeckConfirm(totalCards, scope.size)}
                confirmLabel={LEARN_TEXT.deleteDeck}
                icon="Trash2"
                onCancel={() => setConfirmDelete(false)}
                onConfirm={async () => {
                  try {
                    if (shared) await deleteSharedDeck(shared, deck.id);
                    else await deleteDeck(deck.id);
                    close();
                    return null;
                  } catch (failure) {
                    return errorText(failure);
                  }
                }}
              />
            ) : null}
            {deck.description ? <p className="safe-text whitespace-pre-line text-sm font-medium text-[var(--muted)]">{deck.description}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Pill>{DECK_KIND_LABEL[deck.kind]}</Pill>
              <Pill>{LEARN_TEXT.cardsCount(totalCards)}</Pill>
              {subjectName ? <Pill>{subjectName}</Pill> : null}
              {deck.author?.kind === "agent" && deck.author.name ? <Pill>{LEARN_TEXT.agentMade(deck.author.name)}</Pill> : null}
            </div>

            {children.length ? (
              <section>
                <h3 className="mb-1 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.subdecks(children.length)}</h3>
                <ul className="grid gap-1">
                  {children.map((child) => (
                    <li key={child.id}>
                      <button type="button" onClick={() => onOpenDeck(child)} className="motion-safe flex w-full items-center gap-2 rounded-[16px] px-3 py-2.5 text-left hover:bg-[var(--surface-soft)]">
                        <SubjectMark subjectId={deckSubjectId(bundle.decks, child.id)} size="sm" />
                        <span className="one-line-safe min-w-0 flex-1 text-sm font-black">{child.title}</span>
                        <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-black uppercase text-[var(--faint)]">{children.length ? LEARN_TEXT.cardsHere(cards.length) : LEARN_TEXT.cardsCount(cards.length)}</h3>
                {canEdit ? (
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" icon="Layers" onClick={() => setEditor("subdeck")}>
                      {LEARN_TEXT.newSubdeck}
                    </Button>
                    <Button variant="soft" icon="Plus" onClick={() => setEditor("card")}>
                      {LEARN_TEXT.newCard}
                    </Button>
                  </div>
                ) : null}
              </div>
              {cards.length ? (
                <ul className="grid gap-0.5">
                  {cards.slice(0, shown).map((card) => (
                    <CardRow key={card.id} card={card} status={CARD_STATUS_LABEL[classifyCard(data.states.get(card.id), now).status]} onOpen={() => onOpenCard(card)} />
                  ))}
                </ul>
              ) : null}
              {cards.length > shown ? (
                <div className="mt-2 text-center">
                  <Button variant="soft" onClick={() => setShown((value) => value + PAGE)}>
                    {LEARN_TEXT.showMore(Math.min(PAGE, cards.length - shown))}
                  </Button>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}
      </Drawer>
      {deck && bundle && canEdit ? (
        <>
          <DeckEditor open={editor === "deck"} deck={deck} decks={bundle.decks} subjects={data.subjects} shared={shared} onClose={() => setEditor(null)} />
          <DeckEditor open={editor === "subdeck"} parentId={deck.id} decks={bundle.decks} subjects={data.subjects} shared={shared} onClose={() => setEditor(null)} />
          <CardEditor open={editor === "card"} deckId={deck.id} shared={shared} onClose={() => setEditor(null)} />
        </>
      ) : null}
    </>
  );
}

function DeckTree({ nodes, onOpen, onStudy }: { nodes: DeckNode[]; onOpen: (deck: StudyDeck) => void; onStudy: (deck: StudyDeck) => void }) {
  // Aperte di partenza: solo le radici (con migliaia di raccolte l'albero resta corto).
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) =>
    setExpanded((value) => {
      const next = new Set(value);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <ul className="grid gap-0.5">
      {nodes.map((node) => (
        <DeckRow key={node.deck.id} node={node} expanded={expanded} toggle={toggle} onOpen={onOpen} onStudy={onStudy} />
      ))}
    </ul>
  );
}

export function LibraryTab({ data, today, onStudy, onExplain }: { data: LearnData; today: string; onStudy: (scope: StudyScope) => void; onExplain: (target: ExplainTarget) => void }) {
  const [query, setQuery] = useState("");
  const [openDeckId, setOpenDeckId] = useState<string | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const now = useMemo(() => new Date(), [today, data.cardStates]);
  const ownTree = useMemo(() => buildDeckTree(data.decks, data.flashcards, data.states, data.quizzes, now), [data.decks, data.flashcards, data.states, data.quizzes, now]);
  const sharedTrees = useMemo(
    () => data.shared.map((source) => ({ source, nodes: buildDeckTree(source.bundle.decks, source.bundle.flashcards, data.states, source.bundle.quizzes, now) })),
    [data.shared, data.states, now]
  );

  // Indice di ricerca costruito solo alla prima ricerca (e rifatto se le schede cambiano).
  const index = useMemo(() => {
    if (!query.trim()) return null;
    const all = [...data.flashcards, ...data.shared.flatMap((source) => source.bundle.flashcards)];
    return all.map((card) => ({ card, text: `${blocksPlainText(card.front, 600)} ${blocksPlainText(card.back, 600)}`.toLowerCase() }));
  }, [Boolean(query.trim()), data.flashcards, data.shared]);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle || !index) return [];
    return index.filter((entry) => entry.text.includes(needle)).slice(0, PAGE).map((entry) => entry.card);
  }, [index, query]);

  const deckSource = (deckId: string | null): { deck: StudyDeck; source: LearningSource } | null => {
    if (!deckId) return null;
    const own = data.decks.find((deck) => deck.id === deckId);
    if (own) return { deck: own, source: { bundle: data.own } };
    for (const source of data.shared) {
      const deck = source.bundle.decks.find((item) => item.id === deckId);
      if (deck) return { deck, source };
    }
    return null;
  };
  const openDeck = deckSource(openDeckId);
  const openCard = openCardId ? findCard(data, openCardId) : null;
  const studyDeck = (deck: StudyDeck) => onStudy({ deckIds: [deck.id] });

  const empty = !data.decks.length && !data.shared.length;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <span className="sr-only">{LEARN_TEXT.searchAria}</span>
          <Icon name="Search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--faint)]" />
          <input type="search" className={`${inputClass} pl-9`} placeholder={LEARN_TEXT.searchPlaceholder} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <Button variant="primary" icon="Plus" onClick={() => setCreating(true)}>
          {LEARN_TEXT.newDeck}
        </Button>
      </div>

      {query.trim() ? (
        <section className="soft-panel p-3">
          {results.length ? (
            <ul className="grid gap-0.5">
              {results.map((card) => (
                <CardRow key={card.id} card={card} status={CARD_STATUS_LABEL[classifyCard(data.states.get(card.id), now).status]} onOpen={() => setOpenCardId(card.id)} />
              ))}
            </ul>
          ) : (
            <p className="p-2 text-sm font-medium text-[var(--muted)]">{LEARN_TEXT.noResults}</p>
          )}
        </section>
      ) : empty ? (
        <EmptyState icon="Layers" title={LEARN_TEXT.emptyLibraryTitle} body={LEARN_TEXT.emptyLibraryBody} />
      ) : (
        <>
          {ownTree.length ? (
            <section className="soft-panel p-2 sm:p-3">
              <DeckTree nodes={ownTree} onOpen={(deck) => setOpenDeckId(deck.id)} onStudy={studyDeck} />
            </section>
          ) : null}
          {sharedTrees.map(({ source, nodes }) =>
            nodes.length ? (
              <section key={source.owner?.id} className="soft-panel p-2 sm:p-3">
                <h3 className="mb-1 flex items-center gap-2 px-2 text-xs font-black uppercase text-[var(--faint)]">
                  <Icon name="Share2" className="h-3.5 w-3.5" />
                  {LEARN_TEXT.sharedBy(source.owner?.name ?? "")}
                </h3>
                <DeckTree nodes={nodes} onOpen={(deck) => setOpenDeckId(deck.id)} onStudy={studyDeck} />
              </section>
            ) : null
          )}
        </>
      )}

      <DeckDrawer
        deck={openDeck?.deck ?? null}
        source={openDeck?.source ?? null}
        data={data}
        onClose={() => setOpenDeckId(null)}
        onStudy={(deck) => {
          setOpenDeckId(null);
          studyDeck(deck);
        }}
        onOpenCard={(card) => setOpenCardId(card.id)}
        onOpenDeck={(deck) => setOpenDeckId(deck.id)}
      />
      <CardDrawer card={openCard?.card ?? null} source={openCard?.source ?? null} state={openCard ? data.states.get(openCard.card.id) : undefined} onClose={() => setOpenCardId(null)} onExplain={onExplain} />
      <DeckEditor open={creating} decks={data.decks} subjects={data.subjects as Subject[]} onClose={() => setCreating(false)} onSaved={(deck) => setOpenDeckId(deck.id)} />
    </div>
  );
}
