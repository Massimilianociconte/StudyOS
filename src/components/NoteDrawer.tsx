import { useEffect, useId, useMemo, useRef, useState } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { useShallow } from "zustand/react/shallow";
import type { EntityType, Note } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { goToView } from "../hooks/useLinkedUiState";
import { NOTES_TEXT } from "../lib/labels/notes";
import { linkedItem, openItemPlan, type OpenItemData } from "../lib/openItem";
import { noteTextParts } from "../lib/noteText";
import { Button, Drawer, Field, inputClass } from "./ui";
import { Icon } from "./Icon";

/** Elemento da cui si è aperta la nota (es. l'attività nel suo modulo): lì il collegamento è solo testo. */
export type NoteContext = { type: EntityType; id: string };

const selectOpenData = (state: ReturnType<typeof useStudyStore.getState>): OpenItemData => ({
  tasks: state.tasks,
  events: state.events,
  subjects: state.subjects,
  exams: state.exams,
  attachments: state.attachments,
  sessions: state.sessions,
  topics: state.topics,
  goals: state.goals
});

const noteTitle = (note: Pick<Note, "title">) => note.title.trim() || NOTES_TEXT.untitled;

const updatedLabel = (iso: string) => {
  const date = parseISO(iso);
  return Number.isNaN(date.getTime()) ? "" : NOTES_TEXT.updated(format(date, "d MMM yyyy", { locale: it }));
};

/** Testo della nota: testo semplice (l'ha potuto scrivere un agente), link solo se sicuri. */
function NoteBody({ body }: { body: string }) {
  const parts = useMemo(() => noteTextParts(body), [body]);
  if (!body.trim()) return <p className="text-sm font-bold text-[var(--muted)]">{NOTES_TEXT.emptyBody}</p>;
  return (
    <p className="safe-text whitespace-pre-wrap text-sm leading-relaxed">
      {parts.map((part, index) =>
        part.href ? (
          <a key={index} href={part.href} target="_blank" rel="noopener noreferrer" className="break-all font-bold text-[var(--accent-ink)] underline underline-offset-2">
            {part.text}
          </a>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </p>
  );
}

/**
 * Dettaglio di una nota in un Drawer: si legge (testo semplice), si modifica, si elimina con «Annulla».
 * Dopo Elimina il Drawer resta aperto col messaggio e «Annulla», così funziona da ovunque si apra.
 */
export function NoteDrawer({ noteId, onClose, context }: { noteId: string | null; onClose: () => void; context?: NoteContext }) {
  const note = useStudyStore((state) => (noteId ? state.notes.find((item) => item.id === noteId) ?? null : null));
  const data = useStudyStore(useShallow(selectOpenData));
  const updateNote = useStudyStore((state) => state.updateNote);
  const deleteNote = useStudyStore((state) => state.deleteNote);
  const restoreEntities = useStudyStore((state) => state.restoreEntities);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ title: "", body: "" });
  const [removed, setRemoved] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  // Chiusura in attesa della risposta a «Scartare le modifiche?».
  const [asking, setAsking] = useState(false);
  const removedRef = useRef<HTMLDivElement>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const wasDeleted = useRef(false);
  const wasEditing = useRef(false);

  // Un'altra nota (o la chiusura) riparte dalla lettura.
  useEffect(() => {
    setEditing(false);
    setRemoved(null);
    setBusy(false);
    setAsking(false);
  }, [noteId]);

  const shown = note ?? (removed && removed.id === noteId ? removed : null);
  const open = Boolean(noteId && shown);
  // Mentre si modifica, chiudere con titolo o testo cambiati non perde nulla senza chiedere.
  const dirty = editing && Boolean(note) && (draft.title !== note?.title || draft.body !== note?.body);
  const close = () => {
    if (dirty) setAsking(true);
    else onClose();
  };

  const startEdit = () => {
    if (!note) return;
    setDraft({ title: note.title, body: note.body });
    setAsking(false);
    setEditing(true);
  };
  const save = async () => {
    if (!note || busy) return;
    setBusy(true);
    try {
      await updateNote(note.id, { title: draft.title.trim(), body: draft.body });
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };
  // Subito, senza conferma: «Annulla» la riporta (la nota sparisce dal negozio prima della fine del salvataggio).
  const remove = () => {
    if (!note || busy) return;
    setRemoved(note);
    setEditing(false);
    void deleteNote(note.id);
  };
  const undo = async () => {
    if (!removed || busy) return;
    setBusy(true);
    try {
      await restoreEntities([{ entityType: "note", entityId: removed.id, payload: { ...removed }, complete: true }]);
      setRemoved(null);
    } finally {
      setBusy(false);
    }
  };

  const link = shown ? linkedItem(shown.linkedEntityType, shown.linkedEntityId, data) : null;
  const isContext = Boolean(context && shown && shown.linkedEntityType === context.type && shown.linkedEntityId === context.id);
  const plan = shown && !isContext ? openItemPlan(shown.linkedEntityType, shown.linkedEntityId, data) : null;
  const deleted = Boolean(removed && !note);

  // Il pulsante premuto sparisce: dopo «Elimina» il focus va su «Annulla»; dopo «Annulla», «Salva nota»
  // o «Annulla modifiche» torna su «Modifica». Si aspetta la fine del salvataggio: un pulsante
  // disattivato non prende il focus.
  useEffect(() => {
    if (busy) return;
    if (deleted) removedRef.current?.querySelector("button")?.focus({ preventScroll: true });
    else if (!editing && (wasDeleted.current || wasEditing.current)) actionsRef.current?.querySelector<HTMLButtonElement>("button:last-of-type")?.focus({ preventScroll: true });
    wasDeleted.current = deleted;
    wasEditing.current = editing;
  }, [deleted, busy, editing]);

  const footer = !shown ? undefined : deleted ? (
    <div className="flex justify-end">
      <Button variant="soft" onClick={onClose}>
        {NOTES_TEXT.close}
      </Button>
    </div>
  ) : editing && asking ? (
    // Stesso schema di Attività, Materie e Obiettivi: la domanda sul posto, al posto dei pulsanti.
    <div role="group" aria-label={NOTES_TEXT.unsavedTitle} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
      <p className="text-sm font-black">{NOTES_TEXT.unsavedTitle}</p>
      <p className="text-sm font-bold text-[var(--muted)]">{NOTES_TEXT.unsavedText}</p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button variant="soft" onClick={() => setAsking(false)} autoFocus>
          {NOTES_TEXT.unsavedKeep}
        </Button>
        <Button
          variant="danger"
          icon="X"
          onClick={() => {
            setAsking(false);
            setEditing(false);
            onClose();
          }}
        >
          {NOTES_TEXT.unsavedDiscard}
        </Button>
      </div>
    </div>
  ) : editing ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <Button variant="soft" onClick={() => setEditing(false)} disabled={busy}>
        {NOTES_TEXT.cancelEdit}
      </Button>
      <Button variant="primary" icon="Check" onClick={() => void save()} disabled={busy || (!draft.title.trim() && !draft.body.trim())}>
        {NOTES_TEXT.save}
      </Button>
    </div>
  ) : (
    <div ref={actionsRef} className="flex flex-wrap items-center gap-2">
      <Button variant="danger" icon="Trash2" onClick={remove} disabled={busy} aria-label={NOTES_TEXT.removeAria(noteTitle(shown))}>
        {NOTES_TEXT.remove}
      </Button>
      <span className="flex-1" />
      <Button variant="primary" icon="PenLine" onClick={startEdit} disabled={busy}>
        {NOTES_TEXT.edit}
      </Button>
    </div>
  );

  return (
    <Drawer open={open} onClose={close} eyebrow={NOTES_TEXT.eyebrow} title={shown ? noteTitle(shown) : ""} width="max-w-[560px]" footer={footer}>
      {!shown ? null : deleted ? (
        <div ref={removedRef} role="status" className="flex flex-wrap items-center gap-2">
          <p className="safe-text min-w-0 flex-1 text-sm font-bold">{NOTES_TEXT.removed(noteTitle(shown))}</p>
          <Button variant="soft" icon="RotateCcw" onClick={() => void undo()} disabled={busy}>
            {NOTES_TEXT.undo}
          </Button>
        </div>
      ) : editing ? (
        <div className="grid grid-cols-1 gap-3">
          <Field label={NOTES_TEXT.title}>
            <input className={inputClass} value={draft.title} onChange={(event) => setDraft((value) => ({ ...value, title: event.target.value }))} autoFocus />
          </Field>
          <Field label={NOTES_TEXT.body}>
            <textarea
              className={`${inputClass} min-h-40 py-3`}
              value={draft.body}
              onChange={(event) => setDraft((value) => ({ ...value, body: event.target.value }))}
              placeholder={NOTES_TEXT.bodyPlaceholder}
            />
          </Field>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {shown.linkedEntityType ? (
            <div className="grid grid-cols-1 gap-1">
              <p className="text-xs font-black uppercase text-[var(--faint)]">{NOTES_TEXT.linkedTo}</p>
              {link && plan ? (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    goToView(plan.view, plan.writes);
                  }}
                  aria-label={NOTES_TEXT.openLinked(link.kind, link.title)}
                  className="flex min-h-11 w-full min-w-0 items-center gap-2 rounded-[16px] bg-[var(--surface-strong)] px-3 text-left text-sm font-extrabold hover:bg-[var(--surface)]"
                >
                  <span className="shrink-0 text-[var(--muted)]">{link.kind}</span>
                  <span className="one-line-safe min-w-0 flex-1">{link.title}</span>
                  <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--faint)]" />
                </button>
              ) : link ? (
                <p className="flex min-w-0 items-center gap-2 text-sm font-extrabold">
                  <span className="shrink-0 text-[var(--muted)]">{link.kind}</span>
                  <span className="one-line-safe min-w-0">{link.title}</span>
                </p>
              ) : (
                <p className="text-sm font-bold text-[var(--muted)]">{NOTES_TEXT.linkedGone}</p>
              )}
            </div>
          ) : null}
          <NoteBody body={shown.body} />
          <p className="text-[11px] font-bold text-[var(--faint)]">{updatedLabel(shown.updatedAt)}</p>
        </div>
      )}
    </Drawer>
  );
}

/**
 * Note collegate a un elemento (attività, materia, esame…): un elenco compatto, ogni nota si apre nel
 * Drawer. Senza note non mostra nulla. Da mettere nei dettagli dell'elemento.
 */
export function LinkedNotes({ entityType, id }: { entityType: EntityType; id: string }) {
  const notes = useStudyStore(
    useShallow((state) =>
      state.notes.filter((note) => note.linkedEntityType === entityType && note.linkedEntityId === id && !note.archived)
    )
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const sorted = [...notes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const baseId = useId();
  const buttonId = (noteId: string) => `${baseId}-note-${noteId}`;
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Sempre nel DOM (nascosto, niente spazio): da qui si ritrova il pannello che contiene l'elenco.
  const anchorRef = useRef<HTMLSpanElement>(null);

  // Dopo Elimina e «Annulla» il pulsante della nota è un altro (l'elenco si è svuotato e riempito): il
  // Drawer rimetterebbe il focus su quello vecchio, staccato, e finirebbe sulla pagina. Dopo la sua
  // chiusura il focus va al pulsante della nota; se non c'è più, al titolo dell'elenco o al pannello.
  const close = () => {
    const closed = openId;
    setOpenId(null);
    window.requestAnimationFrame(() => {
      const target =
        (closed ? document.getElementById(buttonId(closed)) : null) ??
        headingRef.current ??
        anchorRef.current?.closest<HTMLElement>('[tabindex="-1"]');
      target?.focus({ preventScroll: true });
    });
  };

  return (
    <>
      {sorted.length ? (
        <section aria-label={NOTES_TEXT.listTitle(sorted.length)} className="grid grid-cols-1 gap-1.5">
          <h4 ref={headingRef} tabIndex={-1} className="text-xs font-black uppercase text-[var(--faint)] outline-none">
            {NOTES_TEXT.listTitle(sorted.length)}
          </h4>
          <ul className="grid grid-cols-1 gap-1.5">
            {sorted.map((note) => (
              <li key={note.id}>
                <button
                  id={buttonId(note.id)}
                  type="button"
                  onClick={() => setOpenId(note.id)}
                  aria-haspopup="dialog"
                  aria-label={NOTES_TEXT.openNote(noteTitle(note))}
                  className="flex min-h-11 w-full min-w-0 items-center gap-3 rounded-[16px] bg-[var(--surface-soft)] px-3 py-2 text-left hover:bg-[var(--surface)]"
                >
                  <Icon name="PenLine" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                  <span className="min-w-0 flex-1">
                    <span className="one-line-safe block text-sm font-extrabold">{noteTitle(note)}</span>
                    {note.body.trim() ? <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{note.body}</span> : null}
                  </span>
                  <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--faint)]" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <span ref={anchorRef} hidden />
      <NoteDrawer noteId={openId} onClose={close} context={{ type: entityType, id }} />
    </>
  );
}
