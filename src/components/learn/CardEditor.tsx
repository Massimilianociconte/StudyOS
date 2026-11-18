// Nuova flashcard o modifica: fronte, retro, spiegazione a blocchi, difficoltà ed etichette, con
// anteprima della scheda vera. Il salvataggio passa dalla stessa validazione degli strumenti MCP.
import { useEffect, useState } from "react";
import type { LearningSource } from "../../agent/learningShared";
import { createCard, updateCard } from "../../store/learning";
import { createSharedCard, updateSharedCard } from "../../store/sharedLearning";
import { LEARN_TEXT } from "../../lib/labels/learn";
import type { Flashcard } from "../../types";
import { Button, Drawer, Field, inputClass } from "../ui";
import { BlockListEditor, keyBlocks, keyBlocksOrBlank, unkeyBlocks, type KeyedBlock } from "./BlockListEditor";
import { FlashcardCard } from "./FlashcardCard";
import { errorText } from "./useLearnData";

interface Draft {
  front: KeyedBlock[];
  back: KeyedBlock[];
  explanation: KeyedBlock[];
  difficulty: string;
  tags: string;
}

const draftOf = (card?: Flashcard): Draft => ({
  front: keyBlocksOrBlank(card?.front),
  back: keyBlocksOrBlank(card?.back),
  explanation: keyBlocks(card?.explanation),
  difficulty: card?.difficulty ? String(card.difficulty) : "",
  tags: (card?.tags ?? []).join(", ")
});

export function CardEditor({
  open,
  deckId,
  card,
  shared,
  onClose,
  onSaved
}: {
  open: boolean;
  deckId: string;
  card?: Flashcard;
  /** Raccolta di un'altra persona con «Può modificare». */
  shared?: LearningSource;
  onClose: () => void;
  onSaved?: (card: Flashcard) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(card));
  const [preview, setPreview] = useState(false);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(draftOf(card));
    setPreview(false);
    setFlipped(false);
    setError("");
  }, [open, card]);

  const input = () => ({
    front: unkeyBlocks(draft.front),
    back: unkeyBlocks(draft.back),
    explanation: unkeyBlocks(draft.explanation),
    ...(draft.difficulty ? { difficulty: Number(draft.difficulty) } : {}),
    tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean)
  });

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const saved = shared
        ? card
          ? await updateSharedCard(shared, card.id, input())
          : await createSharedCard(shared, deckId, input())
        : card
          ? await updateCard(card.id, input())
          : await createCard(deckId, input());
      onSaved?.(saved as Flashcard);
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const previewCard: Flashcard | null = preview
    ? { ...(card ?? { id: "preview", deckId, position: 0, revision: 1, createdAt: "", updatedAt: "", archived: false, tags: [] }), front: input().front, back: input().back, explanation: input().explanation }
    : null;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={card ? LEARN_TEXT.editCard : LEARN_TEXT.newCard}
      dismissOutside={false}
      headerExtra={
        <Button variant="soft" icon={preview ? "PenLine" : "Eye"} onClick={() => setPreview((value) => !value)} aria-pressed={preview}>
          {preview ? LEARN_TEXT.editCard : LEARN_TEXT.preview}
        </Button>
      }
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error ? (
            <p role="alert" className="safe-text mr-auto min-w-0 flex-1 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}
          <Button onClick={onClose}>{LEARN_TEXT.cancel}</Button>
          <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy}>
            {LEARN_TEXT.save}
          </Button>
        </div>
      }
    >
      {previewCard ? (
        <FlashcardCard card={previewCard} flipped={flipped} onFlip={() => setFlipped((value) => !value)} flipButton />
      ) : (
        <div className="grid grid-cols-1 gap-5">
          <BlockListEditor label={LEARN_TEXT.front} value={draft.front} onChange={(front) => setDraft((value) => ({ ...value, front }))} required />
          <BlockListEditor label={LEARN_TEXT.back} value={draft.back} onChange={(back) => setDraft((value) => ({ ...value, back }))} required />
          <div>
            <BlockListEditor label={LEARN_TEXT.explanation} value={draft.explanation} onChange={(explanation) => setDraft((value) => ({ ...value, explanation }))} />
            <p className="mt-1 text-xs font-medium text-[var(--faint)]">{LEARN_TEXT.explanationHint}</p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_1fr]">
            <Field label={LEARN_TEXT.difficulty}>
              <select className={inputClass} value={draft.difficulty} onChange={(event) => setDraft((value) => ({ ...value, difficulty: event.target.value }))}>
                <option value="">—</option>
                {[1, 2, 3, 4, 5].map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={`${LEARN_TEXT.tags} · ${LEARN_TEXT.tagsHint}`}>
              <input className={inputClass} value={draft.tags} onChange={(event) => setDraft((value) => ({ ...value, tags: event.target.value }))} />
            </Field>
          </div>
        </div>
      )}
    </Drawer>
  );
}
