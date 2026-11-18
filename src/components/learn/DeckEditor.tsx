// Nuova raccolta o modifica: titolo, descrizione, livello (materia → argomento → capitolo → …),
// raccolta madre (mai sé stessa né una discendente) e materia (solo in cima: le figlie la ereditano).
import { useEffect, useMemo, useState } from "react";
import type { LearningSource } from "../../agent/learningShared";
import { createDeck, updateDeck } from "../../store/learning";
import { createSharedSubdeck, updateSharedDeck } from "../../store/sharedLearning";
import { DECK_KINDS, DECK_KIND_LABEL, deckDescendantIds } from "../../lib/learningModel";
import { deckVisitOrder } from "../../lib/learnSession";
import { LEARN_TEXT } from "../../lib/labels/learn";
import type { DeckKind, StudyDeck, Subject } from "../../types";
import { Button, Drawer, Field, inputClass } from "../ui";
import { errorText } from "./useLearnData";

interface Draft {
  title: string;
  description: string;
  kind: DeckKind;
  parentId: string;
  subjectId: string;
}

export function DeckEditor({
  open,
  deck,
  parentId,
  decks,
  subjects,
  shared,
  onClose,
  onSaved
}: {
  open: boolean;
  deck?: StudyDeck;
  /** Nuova sotto-raccolta di questa raccolta. */
  parentId?: string;
  decks: readonly StudyDeck[];
  subjects: readonly Subject[];
  /** Raccolta di un'altra persona con «Può modificare»: materia e madre restano le sue. */
  shared?: LearningSource;
  onClose: () => void;
  onSaved?: (deck: StudyDeck) => void;
}) {
  const initial = (): Draft => ({
    title: deck?.title ?? "",
    description: deck?.description ?? "",
    kind: deck?.kind ?? (parentId ? "chapter" : "collection"),
    parentId: deck?.parentId ?? parentId ?? "",
    subjectId: deck?.subjectId ?? ""
  });
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setDraft(initial());
    setError("");
  }, [open, deck?.id, parentId]);

  // Madri possibili: in ordine di visita, con il rientro della profondità; esclusa la raccolta stessa e le sue discendenti.
  const parents = useMemo(() => {
    const blocked = deck ? deckDescendantIds(decks, deck.id) : new Set<string>();
    const order = deckVisitOrder(decks);
    const byId = new Map(decks.map((item) => [item.id, item]));
    const depth = (item: StudyDeck) => {
      let level = 0;
      let cursor = item.parentId ? byId.get(item.parentId) : undefined;
      while (cursor && level < 12) {
        level++;
        cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
      }
      return level;
    };
    return decks
      .filter((item) => !blocked.has(item.id))
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      .map((item) => ({ id: item.id, label: `${" ".repeat(depth(item))}${item.title}` }));
  }, [deck, decks]);

  const save = async () => {
    // Invio nel modulo e clic su «Salva» passano entrambi da qui: un salvataggio alla volta.
    if (busy || !draft.title.trim()) return;
    setBusy(true);
    setError("");
    const input = {
      title: draft.title,
      description: draft.description,
      kind: draft.kind,
      parentId: draft.parentId || null,
      // La materia vale solo per le raccolte in cima: le figlie la prendono dalla madre.
      subjectId: draft.parentId ? null : draft.subjectId || null
    };
    try {
      const saved = shared
        ? deck
          ? await updateSharedDeck(shared, deck.id, input)
          : await createSharedSubdeck(shared, parentId ?? "", input)
        : deck
          ? await updateDeck(deck.id, input)
          : await createDeck(input);
      onSaved?.(saved);
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={deck ? LEARN_TEXT.editDeck : parentId ? LEARN_TEXT.newSubdeck : LEARN_TEXT.newDeck}
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2">
          {error ? (
            <p role="alert" className="safe-text mr-auto min-w-0 flex-1 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}
          <Button onClick={onClose}>{LEARN_TEXT.cancel}</Button>
          <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy || !draft.title.trim()}>
            {LEARN_TEXT.save}
          </Button>
        </div>
      }
    >
      <form
        className="grid grid-cols-1 gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Field label={LEARN_TEXT.deckTitle}>
          <input className={inputClass} value={draft.title} maxLength={200} required data-autofocus onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} />
        </Field>
        {/* Ordine delle domande che ci si fa: dove sta, di che materia è, che cos'è; la descrizione per ultima. */}
        {shared ? null : (
          <Field label={LEARN_TEXT.deckParent}>
            <select className={inputClass} value={draft.parentId} onChange={(event) => setDraft((value) => ({ ...value, parentId: event.target.value }))}>
              <option value="">{LEARN_TEXT.deckParentRoot}</option>
              {parents.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
          </Field>
        )}
        {draft.parentId || shared ? null : (
          <Field label={LEARN_TEXT.deckSubject}>
            <select className={inputClass} value={draft.subjectId} onChange={(event) => setDraft((value) => ({ ...value, subjectId: event.target.value }))}>
              <option value="">{LEARN_TEXT.noSubject}</option>
              {subjects
                .filter((subject) => !subject.archived)
                .map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.name}
                  </option>
                ))}
            </select>
          </Field>
        )}
        <Field label={LEARN_TEXT.deckKind}>
          <select className={inputClass} value={draft.kind} onChange={(event) => setDraft((value) => ({ ...value, kind: event.target.value as DeckKind }))}>
            {DECK_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {DECK_KIND_LABEL[kind]}
              </option>
            ))}
          </select>
        </Field>
        <Field label={LEARN_TEXT.deckDescription}>
          <textarea className={`${inputClass} min-h-24 py-2.5`} value={draft.description} maxLength={4000} onChange={(event) => setDraft((value) => ({ ...value, description: event.target.value }))} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Drawer>
  );
}
