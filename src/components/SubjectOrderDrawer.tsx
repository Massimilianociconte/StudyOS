// «Riordina le materie»: l'ordine proprio delle materie in corso. Si trascina dalla maniglia (mouse,
// dito o penna; vicino ai bordi l'elenco scorre da solo) oppure si usa la tastiera (frecce, Home e Fine
// sulla maniglia) o i pulsanti su e giù, che fanno lo stesso senza trascinare. «Parti da» mette le
// materie secondo un criterio, da ritoccare a mano. Salvare scrive l'ordine nelle preferenze
// dell'account e sceglie «Il mio ordine».
import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import type { Subject } from "../types";
import { SUBJECT_SORT_TEXT, SUBJECTS_TEXT } from "../lib/labels/subjects";
import { moveInList, type SubjectSort } from "../lib/subjectSort";
import { Button, Drawer, IconButton } from "./ui";
import { Icon } from "./Icon";
import { SubjectMark } from "./SubjectMark";
import { UnsavedPrompt } from "./UnsavedPrompt";

const SEEDS: readonly SubjectSort[] = ["exam", "name", "cfu-desc", "cfu-asc"];
// Distanza dal bordo dell'area che scorre entro cui il trascinamento la fa scorrere, e di quanto per fotogramma.
const EDGE = 56;
const SCROLL_STEP = 10;

export function SubjectOrderDrawer({
  subjects,
  initial,
  seed,
  detail,
  onClose,
  onSave
}: {
  /** Le materie da riordinare (quelle in corso). */
  subjects: readonly Subject[];
  /** Ordine di partenza (id): quello che la sezione mostra adesso. */
  initial: readonly string[];
  /** Ordine delle stesse materie secondo un criterio («Parti da»). */
  seed: (mode: SubjectSort) => string[];
  /** Seconda riga della voce (CFU, esame). */
  detail: (subject: Subject) => string;
  onClose: () => void;
  onSave: (ids: string[]) => void;
}) {
  const [items, setItems] = useState<readonly string[]>(initial);
  const [dragging, setDragging] = useState<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [asking, setAsking] = useState(false);
  const listRef = useRef<HTMLOListElement>(null);
  // Copia sempre aggiornata dell'ordine: il trascinamento la legge tra un evento e l'altro, prima del render.
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);
  const hintId = useId();
  const base = useId();
  const byId = new Map(subjects.map((subject) => [subject.id, subject]));
  const rows = items.filter((id) => byId.has(id));
  const dirty = items.join("\n") !== initial.join("\n");
  const handleId = (id: string) => `${base}-handle-${id}`;
  const nameOf = (id: string) => byId.get(id)?.name ?? "";

  const apply = (next: readonly string[]) => {
    if (next === itemsRef.current) return false;
    itemsRef.current = next;
    setItems(next);
    return true;
  };
  const say = (id: string) => setAnnounce(SUBJECT_SORT_TEXT.moved(nameOf(id), itemsRef.current.indexOf(id) + 1, itemsRef.current.length));
  // La voce spostata resta sotto il focus: React può aver spostato il suo nodo nel DOM, e il focus si
  // rimette dopo il render che l'ha spostata.
  const pendingFocus = useRef<string | null>(null);
  useEffect(() => {
    if (!pendingFocus.current) return;
    document.getElementById(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });
  const refocus = (elementId: string) => {
    pendingFocus.current = elementId;
  };

  const moveBy = (id: string, to: number, focusId: string) => {
    if (!apply(moveInList(itemsRef.current, id, to))) return;
    say(id);
    refocus(focusId);
  };

  const onHandleKey = (id: string, event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const index = itemsRef.current.indexOf(id);
    const last = itemsRef.current.length - 1;
    const to = event.key === "ArrowUp" ? index - 1 : event.key === "ArrowDown" ? index + 1 : event.key === "Home" ? 0 : event.key === "End" ? last : null;
    if (to === null) return;
    event.preventDefault();
    moveBy(id, to, handleId(id));
  };

  // Posizione sotto il puntatore: quante altre voci hanno il centro sopra di lui.
  const targetIndex = (id: string, y: number) => {
    let index = 0;
    for (const row of listRef.current?.querySelectorAll<HTMLElement>("[data-row]") ?? []) {
      if (row.dataset.row === id) continue;
      const rect = row.getBoundingClientRect();
      if (y > rect.top + rect.height / 2) index += 1;
    }
    return index;
  };

  // Ascolto su window e non cattura del puntatore: spostando la voce React può spostare il nodo della
  // maniglia, e il browser perderebbe la cattura a metà gesto.
  const startDrag = (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    stopDrag.current?.();
    const pointerId = event.pointerId;
    const scroller = listRef.current?.closest<HTMLElement>(".overflow-y-auto") ?? null;
    let y = event.clientY;
    let frame = 0;
    const reorder = () => void apply(moveInList(itemsRef.current, id, targetIndex(id, y)));
    const onMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      y = moveEvent.clientY;
      reorder();
    };
    const tick = () => {
      if (scroller) {
        const rect = scroller.getBoundingClientRect();
        const direction = y < rect.top + EDGE ? -1 : y > rect.bottom - EDGE ? 1 : 0;
        if (direction) {
          scroller.scrollTop += direction * SCROLL_STEP;
          reorder();
        }
      }
      frame = window.requestAnimationFrame(tick);
    };
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      window.cancelAnimationFrame(frame);
      stopDrag.current = null;
      setDragging(null);
    };
    const onEnd = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerId) return;
      finish();
      say(id);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
    frame = window.requestAnimationFrame(tick);
    stopDrag.current = finish;
    setDragging(id);
  };

  const requestClose = () => (dirty ? setAsking(true) : onClose());

  return (
    <Drawer
      open
      onClose={requestClose}
      title={SUBJECT_SORT_TEXT.reorderTitle}
      footer={
        asking ? (
          <UnsavedPrompt
            title={SUBJECTS_TEXT.unsavedTitle}
            text={SUBJECT_SORT_TEXT.unsavedText}
            keep={SUBJECTS_TEXT.unsavedKeep}
            discard={SUBJECTS_TEXT.unsavedDiscard}
            onKeep={() => setAsking(false)}
            onDiscard={onClose}
          />
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="soft" onClick={requestClose}>
              {SUBJECT_SORT_TEXT.cancel}
            </Button>
            <Button variant="primary" icon="Check" onClick={() => onSave([...itemsRef.current])}>
              {SUBJECT_SORT_TEXT.save}
            </Button>
          </div>
        )
      }
    >
      <div className="grid grid-cols-1 gap-3">
        <p id={hintId} className="text-sm font-bold text-[var(--muted)]">
          {SUBJECT_SORT_TEXT.reorderHint}
        </p>
        <div role="group" aria-label={SUBJECT_SORT_TEXT.startFrom} className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-xs font-black uppercase text-[var(--faint)]">{SUBJECT_SORT_TEXT.startFrom}</span>
          {SEEDS.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                apply(seed(mode));
                setAnnounce(SUBJECT_SORT_TEXT.seeded(SUBJECT_SORT_TEXT.options[mode]));
              }}
              className="motion-safe min-h-11 rounded-full bg-[var(--surface-strong)] px-3 text-xs font-black hover:bg-[var(--surface)]"
            >
              {SUBJECT_SORT_TEXT.options[mode]}
            </button>
          ))}
        </div>
        <p role="status" aria-live="polite" className="sr-only">
          {announce}
        </p>
        <ol ref={listRef} className={`grid grid-cols-1 gap-1.5 ${dragging ? "select-none" : ""}`}>
          {rows.map((id, index) => {
            const subject = byId.get(id)!;
            const first = index === 0;
            const last = index === rows.length - 1;
            return (
              <li
                key={id}
                data-row={id}
                className={`flex min-h-14 min-w-0 items-center gap-1.5 rounded-[16px] sm:gap-2 border px-1.5 py-1 ${
                  dragging === id ? "border-[var(--accent)] bg-[var(--surface)] shadow-lift" : "border-transparent bg-[var(--surface-soft)]"
                }`}
              >
                <button
                  type="button"
                  id={handleId(id)}
                  aria-label={SUBJECT_SORT_TEXT.handle(subject.name)}
                  aria-describedby={hintId}
                  onPointerDown={(event) => startDrag(id, event)}
                  onKeyDown={(event) => onHandleKey(id, event)}
                  className={`grid h-11 w-11 shrink-0 touch-none place-items-center rounded-[12px] text-[var(--muted)] hover:bg-[var(--surface-strong)] hover:text-[var(--text)] ${dragging === id ? "cursor-grabbing" : "cursor-grab"}`}
                >
                  <Icon name="GripVertical" className="h-4.5 w-4.5" />
                </button>
                <span aria-hidden="true" className="hidden w-6 shrink-0 text-right text-xs font-black tabular-nums text-[var(--faint)] sm:block">
                  {SUBJECT_SORT_TEXT.position(index + 1)}
                </span>
                <SubjectMark subjectId={id} />
                <span className="min-w-0 flex-1">
                  <span className="one-line-safe block text-sm font-black">{subject.name}</span>
                  <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{detail(subject)}</span>
                </span>
                {/* Senza trascinare: aria-disabled e non disabled, così il focus non si perde arrivati in cima o in fondo. */}
                <IconButton
                  id={`${handleId(id)}-up`}
                  icon="ChevronUp"
                  label={SUBJECT_SORT_TEXT.moveUp(subject.name)}
                  aria-disabled={first}
                  className={`bg-transparent ${first ? "opacity-35 hover:scale-100" : ""}`}
                  onClick={() => (first ? undefined : moveBy(id, itemsRef.current.indexOf(id) - 1, `${handleId(id)}-up`))}
                />
                <IconButton
                  id={`${handleId(id)}-down`}
                  icon="ChevronDown"
                  label={SUBJECT_SORT_TEXT.moveDown(subject.name)}
                  aria-disabled={last}
                  className={`bg-transparent ${last ? "opacity-35 hover:scale-100" : ""}`}
                  onClick={() => (last ? undefined : moveBy(id, itemsRef.current.indexOf(id) + 1, `${handleId(id)}-down`))}
                />
              </li>
            );
          })}
        </ol>
      </div>
    </Drawer>
  );
}
