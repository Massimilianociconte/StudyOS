// Sessione di ripasso a schermo intero: gira la scheda, poi Corretta / Sbagliata / Dubbia / Salta
// (pulsanti, tasti 1–4, trascinamento a destra/sinistra sulla scheda girata). Ogni risposta si salva
// subito (evento immutabile + stato di ripasso): interrompere non perde nulla.
import { createPortal } from "react-dom";
import { m, useReducedMotion, type PanInfo } from "framer-motion";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { finishRun, newRun, recordCardAnswer } from "../../store/learning";
import { LEARN_TEXT, RESULT_HINT, RESULT_LABEL } from "../../lib/labels/learn";
import type { Flashcard, ReviewResult, StudyRun } from "../../types";
import { Button, IconButton, ProgressBar, useBackCloses, useDialogLayer } from "../ui";
import { InlineConfirm } from "../InlineConfirm";
import { FlashcardCard } from "./FlashcardCard";

export interface SessionItem {
  card: Flashcard;
  /** Raccolta condivisa da un'altra persona (le risposte restano tue). */
  owner?: { id: string; name: string };
}

export interface SessionSpec {
  title: string;
  items: SessionItem[];
  deckIds: string[];
  subjectIds: string[];
  mode: StudyRun["mode"];
}

const RESULTS: { result: ReviewResult; key: string; icon: string; tone: string }[] = [
  { result: "correct", key: "1", icon: "Check", tone: "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]" },
  { result: "wrong", key: "2", icon: "X", tone: "bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-border)]" },
  { result: "doubt", key: "3", icon: "CircleDot", tone: "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]" },
  { result: "skip", key: "4", icon: "SkipForward", tone: "bg-[var(--surface-strong)] text-[var(--muted)] border-[var(--border)]" }
];

const SWIPE_PX = 90;

export function StudySession({ spec, onClose, onExplain }: { spec: SessionSpec; onClose: () => void; onExplain?: (item: SessionItem) => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() === true;
  const [queue, setQueue] = useState(spec.items);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);
  const [tally, setTally] = useState<Record<ReviewResult, number>>({ correct: 0, wrong: 0, doubt: 0, skip: 0 });
  const [wrongIds, setWrongIds] = useState<string[]>([]);
  const runRef = useRef<StudyRun>(newRun({ kind: "flashcards", mode: spec.mode, title: spec.title, deckIds: spec.deckIds, subjectIds: spec.subjectIds, itemIds: spec.items.map((item) => item.card.id) }));
  const shownAt = useRef(performance.now());
  const done = index >= queue.length;
  const current = done ? null : queue[index];
  // Nessuna risposta data in questo giro: uscire non interrompe nulla, niente conferma.
  const leaveFreely = done || index === 0;

  const close = useCallback(() => {
    void finishRun(runRef.current.id).catch(() => undefined);
    onClose();
  }, [onClose]);

  useDialogLayer(true, { panelRef, onEscape: () => (leaveFreely ? close() : setConfirmStop(true)) });
  useBackCloses(true, () => {
    if (leaveFreely) {
      close();
      return true;
    }
    setConfirmStop(true);
    return false;
  });

  // La scheda torna coperta nello stesso aggiornamento che cambia scheda (answer, again): la successiva
  // non compare girata per un attimo e un tasto 1–3 non la valuta prima che si veda.
  useEffect(() => {
    shownAt.current = performance.now();
  }, [index, queue]);

  // Il pulsante premuto sparisce (gira, risposta, fine): il focus resta nella finestra. Scheda coperta:
  // «Mostra la risposta»; girata: il pannello (Spazio rigira, 1–4 rispondono, Tab porta ai pulsanti).
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    if (active && active !== panel && panel.contains(active)) return;
    (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel).focus({ preventScroll: true });
  }, [flipped, index, done, queue]);

  const answer = useCallback(
    async (result: ReviewResult) => {
      if (!current || busy) return;
      setBusy(true);
      setError("");
      try {
        runRef.current = await recordCardAnswer(
          runRef.current,
          { id: current.card.id, deckId: current.card.deckId, subjectId: current.card.subjectId, revision: current.card.revision, ...(current.owner ? { ownerId: current.owner.id } : {}) },
          result,
          performance.now() - shownAt.current
        );
        setTally((value) => ({ ...value, [result]: value[result] + 1 }));
        if (result === "wrong") setWrongIds((ids) => (ids.includes(current.card.id) ? ids : [...ids, current.card.id]));
        setFlipped(false);
        setIndex((value) => value + 1);
        if (index + 1 >= queue.length) void finishRun(runRef.current.id).catch(() => undefined);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setBusy(false);
      }
    },
    [busy, current, index, queue.length]
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Tasto tenuto premuto: una sola risposta, mai sulla scheda successiva non ancora vista.
      if (done || confirmStop || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      // Solo con il focus nella sessione: con «Spiegami meglio» o un'altra finestra sopra (che prende il
      // focus all'apertura) Spazio e 1–4 restano a quella finestra.
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !panelRef.current?.contains(target)) return;
      if (target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      if (event.key === " " || event.key === "Enter") {
        if (target.closest("button, a")) return;
        event.preventDefault();
        setFlipped((value) => !value);
        return;
      }
      const hit = RESULTS.find((item) => item.key === event.key);
      if (!hit) return;
      // Corretta/Sbagliata/Dubbia solo dopo aver visto la risposta; Salta sempre.
      if (!flipped && hit.result !== "skip") return;
      event.preventDefault();
      void answer(hit.result);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, confirmStop, done, flipped]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (!flipped || busy) return;
    if (info.offset.x > SWIPE_PX) void answer("correct");
    else if (info.offset.x < -SWIPE_PX) void answer("wrong");
  };

  const again = () => {
    const retry = queue.filter((item) => wrongIds.includes(item.card.id));
    runRef.current = newRun({ kind: "flashcards", mode: "errors", title: spec.title, deckIds: spec.deckIds, subjectIds: spec.subjectIds, itemIds: retry.map((item) => item.card.id) });
    setQueue(retry);
    setWrongIds([]);
    setTally({ correct: 0, wrong: 0, doubt: 0, skip: 0 });
    setFlipped(false);
    setIndex(0);
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] outline-none"
    >
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="one-line-safe text-base font-black sm:text-lg">
            {spec.title || LEARN_TEXT.sessionTitle}
          </h2>
          <div className="mt-1.5 flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <ProgressBar value={queue.length ? (Math.min(index, queue.length) / queue.length) * 100 : 100} label={LEARN_TEXT.sessionOf(Math.min(index + 1, queue.length), queue.length)} />
            </div>
            <span className="shrink-0 text-xs font-bold tabular-nums text-[var(--muted)]" aria-live="polite">
              {LEARN_TEXT.sessionOf(Math.min(index + 1, queue.length), queue.length)}
            </span>
          </div>
        </div>
        <IconButton icon="X" label={done ? LEARN_TEXT.sessionClose : LEARN_TEXT.sessionStop} onClick={() => (leaveFreely ? close() : setConfirmStop(true))} />
      </header>

      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          {confirmStop ? <InlineConfirm text={LEARN_TEXT.sessionStopConfirm} confirmLabel={LEARN_TEXT.sessionStop} icon="X" onConfirm={close} onCancel={() => setConfirmStop(false)} /> : null}
          {done ? (
            <div className="soft-panel p-6 text-center">
              <h3 className="text-2xl font-black">{LEARN_TEXT.sessionDone}</h3>
              <p className="mt-2 text-sm font-bold text-[var(--muted)]">{LEARN_TEXT.sessionSummary(tally.correct, tally.wrong, tally.doubt, tally.skip)}</p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                {wrongIds.length ? (
                  <Button variant="soft" icon="RotateCcw" onClick={again}>
                    {LEARN_TEXT.sessionAgain}
                  </Button>
                ) : null}
                <Button variant="primary" icon="Check" onClick={close} data-autofocus>
                  {LEARN_TEXT.sessionClose}
                </Button>
              </div>
            </div>
          ) : current ? (
            <>
              {current.owner ? <p className="text-center text-xs font-bold text-[var(--muted)]">{LEARN_TEXT.sharedBy(current.owner.name)} · {LEARN_TEXT.sharedNoProgress}</p> : null}
              <m.div
                key={current.card.id + index}
                drag={flipped && !reduce ? "x" : false}
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.6}
                onDragEnd={onDragEnd}
                initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <FlashcardCard card={current.card} flipped={flipped} onFlip={() => setFlipped((value) => !value)} external={Boolean(current.owner)} />
              </m.div>
              <p className="text-center text-xs font-medium text-[var(--faint)]">
                <span className="[@media(pointer:coarse)]:hidden">{flipped ? LEARN_TEXT.keysHint : LEARN_TEXT.flipHint}</span>
                <span className="hidden [@media(pointer:coarse)]:inline">{flipped ? (reduce ? "" : LEARN_TEXT.swipeHint) : LEARN_TEXT.flipHintTouch}</span>
              </p>
              {error ? (
                <p role="alert" className="safe-text rounded-[14px] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
                  {error}
                </p>
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {!done && current ? (
        <footer className="border-t border-[var(--border)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto w-full max-w-2xl">
            {flipped ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {RESULTS.map((item) => (
                  <button
                    key={item.result}
                    type="button"
                    disabled={busy}
                    onClick={() => void answer(item.result)}
                    title={RESULT_HINT[item.result]}
                    aria-keyshortcuts={item.key}
                    className={`motion-safe flex min-h-12 items-center justify-center gap-2 rounded-[16px] border px-3 text-sm font-black hover:brightness-105 disabled:opacity-60 ${item.tone}`}
                  >
                    <span aria-hidden="true">{item.key}</span>
                    <span>{RESULT_LABEL[item.result]}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="primary" icon="RotateCcw" className="flex-1" onClick={() => setFlipped(true)} data-autofocus>
                  {LEARN_TEXT.showAnswer}
                </Button>
                <Button variant="soft" icon="SkipForward" onClick={() => void answer("skip")} disabled={busy}>
                  {RESULT_LABEL.skip}
                </Button>
              </div>
            )}
            {flipped && onExplain ? (
              <div className="mt-2 text-center">
                <button type="button" onClick={() => onExplain(current)} className="motion-safe inline-flex min-h-9 items-center gap-1.5 text-sm font-extrabold text-[var(--accent-ink)] hover:underline">
                  {LEARN_TEXT.explain}
                </button>
              </div>
            ) : null}
          </div>
        </footer>
      ) : null}
    </div>,
    document.body
  );
}
