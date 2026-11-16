// Una flashcard aperta: la scheda che si gira, il tuo stato di ripasso, modifica, eliminazione e
// «Spiegami meglio». Le schede delle raccolte condivise si studiano e si fanno spiegare, non si modificano qui.
import { useState } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { deleteCards } from "../../store/learning";
import { deleteSharedCards } from "../../store/sharedLearning";
import { CARD_STATUS_LABEL, classifyCard } from "../../lib/srs";
import { deckPath } from "../../lib/learningModel";
import { LEARN_TEXT } from "../../lib/labels/learn";
import type { LearningSource } from "../../agent/learningShared";
import type { Flashcard, FlashcardState } from "../../types";
import { ConfirmWithError } from "../ConfirmWithError";
import { Button, Drawer, Pill } from "../ui";
import { CardEditor } from "./CardEditor";
import { FlashcardCard } from "./FlashcardCard";
import { errorText } from "./useLearnData";

export interface ExplainTarget {
  kind: "explain_card" | "explain_question";
  id: string;
  ownerId?: string;
  title: string;
}

export function CardDrawer({
  card,
  source,
  state,
  onClose,
  onExplain
}: {
  card: Flashcard | null;
  source: LearningSource | null;
  state?: FlashcardState;
  onClose: () => void;
  onExplain: (target: ExplainTarget) => void;
}) {
  const [flipped, setFlipped] = useState(false);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Un'altra scheda (o la chiusura decisa da fuori): si riparte coperta e senza conferma aperta.
  const [shownId, setShownId] = useState(card?.id);
  if (card?.id !== shownId) {
    setShownId(card?.id);
    setFlipped(false);
    setConfirmDelete(false);
  }
  const owner = source?.owner;
  const canEdit = !owner || owner.permission === "edit";
  const shared = owner && canEdit ? (source ?? undefined) : undefined;
  const info = classifyCard(state, new Date());
  const path = card && source ? deckPath(source.bundle.decks, card.deckId).map((deck) => deck.title).join(" › ") : "";
  const close = () => {
    setFlipped(false);
    setConfirmDelete(false);
    onClose();
  };

  return (
    <>
      <Drawer
        open={Boolean(card) && !editing}
        onClose={close}
        eyebrow={owner ? LEARN_TEXT.sharedBy(owner.name) : path || undefined}
        title={card?.title || LEARN_TEXT.question}
        footer={
          card ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="soft" icon="Sparkles" onClick={() => onExplain({ kind: "explain_card", id: card.id, ...(owner ? { ownerId: owner.id } : {}), title: card.title || LEARN_TEXT.question })}>
                {LEARN_TEXT.explain}
              </Button>
              {canEdit ? (
                <>
                  <Button variant="soft" icon="PenLine" onClick={() => setEditing(true)}>
                    {LEARN_TEXT.editCard}
                  </Button>
                  <Button variant="danger" icon="Trash2" onClick={() => setConfirmDelete(true)} aria-label={LEARN_TEXT.deleteCard}>
                    {LEARN_TEXT.deleteCard}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null
        }
      >
        {card ? (
          <div className="grid grid-cols-1 gap-4">
            {confirmDelete ? (
              <ConfirmWithError
                text={shared && owner ? LEARN_TEXT.deleteSharedConfirm(card.title || LEARN_TEXT.question, owner.name) : LEARN_TEXT.deleteCardConfirm}
                confirmLabel={LEARN_TEXT.deleteCard}
                icon="Trash2"
                onCancel={() => setConfirmDelete(false)}
                onConfirm={async () => {
                  try {
                    if (shared) await deleteSharedCards(shared, [card.id]);
                    else await deleteCards([card.id]);
                    close();
                    return null;
                  } catch (failure) {
                    return errorText(failure);
                  }
                }}
              />
            ) : null}
            {/* key: le immagini «tocca per caricare» di una scheda non restano caricate su un'altra. */}
            <FlashcardCard key={card.id} card={card} flipped={flipped} onFlip={() => setFlipped((value) => !value)} external={Boolean(owner)} flipButton />
            <div className="flex flex-wrap items-center gap-2">
              <Pill active={info.due}>{CARD_STATUS_LABEL[info.status]}</Pill>
              {state && !info.isNew ? (
                <span className="text-xs font-bold text-[var(--muted)]">
                  {`Prossimo ripasso: ${format(parseISO(state.due), "d MMM", { locale: it })} · ${state.correct} corrette, ${state.wrong} sbagliate, ${state.doubt} dubbie`}
                </span>
              ) : null}
              {card.author?.kind === "agent" && card.author.name ? <span className="text-xs font-bold text-[var(--faint)]">{LEARN_TEXT.agentMade(card.author.name)}</span> : null}
            </div>
            {owner ? <p className="text-xs font-medium text-[var(--muted)]">{LEARN_TEXT.sharedNoProgress}</p> : null}
          </div>
        ) : null}
      </Drawer>
      {card && canEdit ? <CardEditor open={editing} deckId={card.deckId} card={card} shared={shared} onClose={() => setEditing(false)} /> : null}
    </>
  );
}
