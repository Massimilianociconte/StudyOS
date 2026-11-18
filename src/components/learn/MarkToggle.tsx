// «Dubbio»: segno reversibile su una flashcard o una domanda. Acceso porta l'elemento nella scheda
// Dubbi (per materia e argomento), su tutti i dispositivi; si toglie con lo stesso pulsante.
import { useState } from "react";
import { toggleMark, type MarkTarget } from "../../store/learning";
import { LEARN_TEXT } from "../../lib/labels/learn";
import { Icon } from "../Icon";

export function MarkToggle({
  target,
  marked,
  compact = false,
  className = ""
}: {
  target: MarkTarget;
  marked: boolean;
  /** Solo icona sotto i 380px (sessioni a schermo intero su telefoni stretti). */
  compact?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-pressed={marked}
      aria-keyshortcuts="D"
      disabled={busy}
      title={marked ? LEARN_TEXT.markDoubtOff : LEARN_TEXT.markDoubtOn}
      onClick={(event) => {
        // Sulla flashcard il clic non deve girarla.
        event.stopPropagation();
        setBusy(true);
        void toggleMark(target, !marked)
          .catch(() => undefined)
          .finally(() => setBusy(false));
      }}
      data-mark-toggle
      className={`motion-safe inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-extrabold disabled:opacity-60 ${
        marked
          ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]"
          : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
      } ${className}`}
    >
      <Icon name="Flag" className={`h-3.5 w-3.5 ${marked ? "fill-current" : ""}`} />
      <span className={compact ? "max-[379px]:sr-only" : ""}>{LEARN_TEXT.markDoubt}</span>
    </button>
  );
}

/** Il segno di un elemento a partire da una flashcard o da una domanda (con chi la condivide). */
export const cardMark = (card: { id: string; deckId: string; subjectId?: string }, ownerId?: string): MarkTarget => ({
  kind: "card",
  id: card.id,
  deckId: card.deckId,
  ...(card.subjectId ? { subjectId: card.subjectId } : {}),
  ...(ownerId ? { ownerId } : {})
});

export const questionMark = (question: { id: string; quizId: string; subjectId?: string }, quiz?: { deckId?: string; subjectId?: string }, ownerId?: string): MarkTarget => {
  const subjectId = question.subjectId ?? quiz?.subjectId;
  return {
    kind: "question",
    id: question.id,
    quizId: question.quizId,
    ...(quiz?.deckId ? { deckId: quiz.deckId } : {}),
    ...(subjectId ? { subjectId } : {}),
    ...(ownerId ? { ownerId } : {})
  };
};
