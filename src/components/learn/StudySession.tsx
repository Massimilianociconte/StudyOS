// Sessione di ripasso a schermo intero: gira la scheda, poi «Com'è andata?» Sbagliata / Dubbia /
// Corretta (ognuna dice tra quanto torna la scheda), Salta sempre a portata. Tasti 1–3 nell'ordine dei
// pulsanti, 4 salta; trascinamento a destra/sinistra sulla scheda girata. Ogni risposta si salva
// subito (evento immutabile + stato di ripasso): «Termina» porta al riepilogo senza perdere nulla.
// Il riepilogo valuta la sessione (percentuale, conteggi, tempo, schede da rivedere) e propone di
// ripassare sbagliate e dubbie o di continuare con altre schede dello stesso ambito.
import { createPortal } from "react-dom";
import { m, useReducedMotion, type PanInfo } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { finishRun, newRun, recordCardAnswer } from "../../store/learning";
import { blocksPlainText } from "../../lib/cardBlocks";
import { nextWaits, percent } from "../../lib/learnSession";
import { LEARN_TEXT, RESULT_HINT, RESULT_LABEL, RESULT_PLURAL } from "../../lib/labels/learn";
import type { Flashcard, FlashcardState, ReviewResult, StudyRun } from "../../types";
import { Button, IconButton, ProgressBar, ProgressRing, useBackCloses, useDialogLayer } from "../ui";
import { Icon } from "../Icon";
import { SubjectMark } from "../SubjectMark";
import { FlashcardCard } from "./FlashcardCard";
import type { SessionOptions } from "./SessionBuilder";

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
  /** Scelte che hanno prodotto la coda: «Continua» le riusa. */
  options?: SessionOptions;
}

type Rated = Exclude<ReviewResult, "skip">;

const ANSWERS: { result: Rated; key: string; icon: string; tone: string }[] = [
  { result: "wrong", key: "1", icon: "X", tone: "bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-border)]" },
  { result: "doubt", key: "2", icon: "CircleDot", tone: "bg-[var(--warning-bg)] text-[var(--warning-text)] border-[var(--warning-border)]" },
  { result: "correct", key: "3", icon: "Check", tone: "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]" }
];
const SKIP_KEY = "4";

const TALLY_TONE: Record<ReviewResult, string> = {
  correct: "text-[var(--success-text)]",
  wrong: "text-[var(--danger-text)]",
  doubt: "text-[var(--warning-text)]",
  skip: "text-[var(--muted)]"
};

const EMPTY_TALLY: Record<ReviewResult, number> = { correct: 0, wrong: 0, doubt: 0, skip: 0 };
const SWIPE_PX = 90;
const MISSED_SHOWN = 8;

const durationText = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : LEARN_TEXT.minutes(Math.round(ms / 60_000)));

export function StudySession({
  spec,
  states,
  onClose,
  onExplain,
  more
}: {
  spec: SessionSpec;
  /** Stati di ripasso attuali: dicono tra quanto torna la scheda con ogni risposta. */
  states: ReadonlyMap<string, FlashcardState>;
  onClose: () => void;
  onExplain?: (item: SessionItem) => void;
  /** Altre schede dello stesso ambito, escluse quelle già viste in questa sessione. */
  more?: (seen: ReadonlySet<string>) => SessionItem[];
}) {
  const titleId = useId();
  const waitIds = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion() === true;
  const [queue, setQueue] = useState(spec.items);
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stopped, setStopped] = useState(false);
  const [tally, setTally] = useState(EMPTY_TALLY);
  const [missed, setMissed] = useState<{ item: SessionItem; result: Rated }[]>([]);
  const [spentMs, setSpentMs] = useState(0);
  const seen = useRef(new Set<string>());
  const runRef = useRef<StudyRun>(newRun({ kind: "flashcards", mode: spec.mode, title: spec.title, deckIds: spec.deckIds, subjectIds: spec.subjectIds, itemIds: spec.items.map((item) => item.card.id) }));
  const shownAt = useRef(performance.now());
  const finished = index >= queue.length;
  const summary = finished || stopped;
  const current = summary ? null : queue[index];
  const answered = tally.correct + tally.wrong + tally.doubt;

  const close = useCallback(() => {
    void finishRun(runRef.current.id).catch(() => undefined);
    onClose();
  }, [onClose]);

  // «Termina», Esc e Indietro: senza risposte si esce, altrimenti si va al riepilogo (tutto è già
  // salvato, niente conferma); dal riepilogo si esce.
  const end = useCallback(() => {
    if (summary || index === 0) {
      close();
      return;
    }
    void finishRun(runRef.current.id).catch(() => undefined);
    setStopped(true);
  }, [close, index, summary]);

  useDialogLayer(true, { panelRef, onEscape: end });
  useBackCloses(true, () => {
    const leaving = summary || index === 0;
    end();
    return leaving;
  });

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
  }, [flipped, index, summary, queue]);

  const answer = useCallback(
    async (result: ReviewResult) => {
      if (!current || busy) return;
      setBusy(true);
      setError("");
      const ms = performance.now() - shownAt.current;
      try {
        runRef.current = await recordCardAnswer(
          runRef.current,
          { id: current.card.id, deckId: current.card.deckId, subjectId: current.card.subjectId, revision: current.card.revision, ...(current.owner ? { ownerId: current.owner.id } : {}) },
          result,
          ms
        );
        seen.current.add(current.card.id);
        setTally((value) => ({ ...value, [result]: value[result] + 1 }));
        // Stesso tetto del salvataggio (un'ora per scheda): una scheda lasciata aperta non gonfia il tempo.
        setSpentMs((value) => value + Math.min(3_600_000, Math.max(0, ms)));
        if (result === "wrong" || result === "doubt") setMissed((list) => [...list.filter((entry) => entry.item.card.id !== current.card.id), { item: current, result }]);
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
      if (summary || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
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
      if (event.key === SKIP_KEY) {
        event.preventDefault();
        void answer("skip");
        return;
      }
      const hit = ANSWERS.find((item) => item.key === event.key);
      // Sbagliata/Dubbia/Corretta solo dopo aver visto la risposta.
      if (!hit || !flipped) return;
      event.preventDefault();
      void answer(hit.result);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, summary, flipped]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (!flipped || busy) return;
    if (info.offset.x > SWIPE_PX) void answer("correct");
    else if (info.offset.x < -SWIPE_PX) void answer("wrong");
  };

  const restart = (items: SessionItem[], mode: StudyRun["mode"]) => {
    runRef.current = newRun({ kind: "flashcards", mode, title: spec.title, deckIds: spec.deckIds, subjectIds: spec.subjectIds, itemIds: items.map((item) => item.card.id) });
    setQueue(items);
    setMissed([]);
    setTally(EMPTY_TALLY);
    setSpentMs(0);
    setStopped(false);
    setFlipped(false);
    setIndex(0);
  };

  // Calcolate solo sul riepilogo: le schede viste sono già salvate e non tornano.
  const moreItems = useMemo(() => (summary && more ? more(seen.current) : []), [summary, more]);
  const waits = useMemo(() => (current && flipped ? nextWaits(states.get(current.card.id), current.card, new Date()) : null), [current, flipped, states]);
  const score = answered ? tally.correct / answered : null;
  const feedback = !answered ? LEARN_TEXT.resultOnlySkips : (score ?? 0) >= 0.85 ? LEARN_TEXT.resultGreat : (score ?? 0) >= 0.6 ? LEARN_TEXT.resultGood : LEARN_TEXT.resultLow;

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
              <ProgressBar value={summary ? 100 : queue.length ? (index / queue.length) * 100 : 100} label={LEARN_TEXT.sessionOf(Math.min(index + 1, queue.length), queue.length)} />
            </div>
            {summary ? null : (
              <span className="shrink-0 text-xs font-bold tabular-nums text-[var(--muted)]" aria-live="polite">
                {LEARN_TEXT.sessionOf(Math.min(index + 1, queue.length), queue.length)}
              </span>
            )}
          </div>
        </div>
        {summary ? (
          <IconButton icon="X" label={LEARN_TEXT.sessionClose} onClick={close} />
        ) : (
          <Button variant="soft" onClick={end} className="min-h-10 px-3.5">
            {LEARN_TEXT.sessionEnd}
          </Button>
        )}
      </header>

      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          {summary ? (
            <section aria-labelledby={`${titleId}-result`} className="soft-panel p-5 sm:p-6">
              <div className="flex flex-col items-center text-center">
                <h3 id={`${titleId}-result`} className="text-2xl font-black">
                  {finished ? LEARN_TEXT.resultDone : LEARN_TEXT.resultStopped}
                </h3>
                <p className="mt-1 text-sm font-bold text-[var(--muted)]">
                  {LEARN_TEXT.resultReviewed(index, queue.length)}
                  {spentMs ? ` ${LEARN_TEXT.resultTime(durationText(spentMs))}` : ""}
                </p>
                {score !== null ? (
                  <div className="mt-4 w-36">
                    <ProgressRing value={score * 100} label={LEARN_TEXT.resultCorrect} />
                  </div>
                ) : null}
                <p className="mt-3 max-w-md text-sm font-bold">{feedback}</p>
              </div>

              <dl className="mt-5 grid grid-cols-4 gap-1.5 sm:gap-2">
                {(["correct", "wrong", "doubt", "skip"] as const).map((result) => (
                  <div key={result} className="min-w-0 rounded-[14px] bg-[var(--surface-soft)] px-1 py-2 text-center">
                    <dt className="one-line-safe text-[10px] font-black uppercase text-[var(--faint)] sm:text-xs">{RESULT_PLURAL[result]}</dt>
                    <dd className={`text-xl font-black tabular-nums sm:text-2xl ${TALLY_TONE[result]}`}>{tally[result]}</dd>
                  </div>
                ))}
              </dl>

              {missed.length ? (
                <div className="mt-5">
                  <h4 className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.resultMissed}</h4>
                  <ul className="grid gap-1">
                    {missed.slice(0, MISSED_SHOWN).map(({ item, result }) => (
                      <li key={item.card.id} className="flex min-w-0 items-center gap-2 rounded-[14px] bg-[var(--surface-soft)] px-2.5 py-2">
                        <SubjectMark subjectId={item.owner ? undefined : item.card.subjectId} size="sm" />
                        <span className="sr-only">{RESULT_LABEL[result]}:</span>
                        <span className="one-line-safe min-w-0 flex-1 text-sm font-bold">{blocksPlainText(item.card.front, 120)}</span>
                        <Icon name={result === "wrong" ? "X" : "CircleDot"} className={`h-4 w-4 shrink-0 ${TALLY_TONE[result]}`} />
                      </li>
                    ))}
                  </ul>
                  {missed.length > MISSED_SHOWN ? <p className="mt-1 text-xs font-bold text-[var(--muted)]">{LEARN_TEXT.resultMissedMore(missed.length - MISSED_SHOWN)}</p> : null}
                </div>
              ) : null}

            </section>
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
                <FlashcardCard card={current.card} flipped={flipped} onFlip={() => setFlipped((value) => !value)} external={Boolean(current.owner)} questionOnBack />
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

      {summary ? (
        <footer className="border-t border-[var(--border)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6">
          {/* Le azioni del riepilogo restano sempre in vista, anche con la lista «Da rivedere» lunga. */}
          <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
            {missed.length ? (
              <Button variant="soft" icon="RotateCcw" onClick={() => restart(missed.map((entry) => entry.item), "errors")}>
                {LEARN_TEXT.retryMissed(missed.length)}
              </Button>
            ) : null}
            {moreItems.length ? (
              <Button variant="soft" icon="PlayCircle" onClick={() => restart(moreItems, spec.mode)}>
                {LEARN_TEXT.continueMore(moreItems.length)}
              </Button>
            ) : null}
            <Button variant="primary" icon="Check" onClick={close} data-autofocus>
              {LEARN_TEXT.finish}
            </Button>
          </div>
        </footer>
      ) : current ? (
        <footer className="border-t border-[var(--border)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto w-full max-w-2xl">
            {flipped ? (
              <>
                <p className="mb-2 text-center text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.howWell}</p>
                <div className="grid grid-cols-3 gap-2">
                  {ANSWERS.map((item) => (
                    <button
                      key={item.result}
                      type="button"
                      disabled={busy}
                      onClick={() => void answer(item.result)}
                      title={RESULT_HINT[item.result]}
                      aria-keyshortcuts={item.key}
                      aria-describedby={waits ? `${waitIds}-${item.result}` : undefined}
                      className={`motion-safe flex min-h-14 min-w-0 flex-col items-center justify-center rounded-[16px] border px-2 py-1.5 hover:brightness-105 disabled:opacity-60 ${item.tone}`}
                    >
                      <span className="flex items-center gap-1.5 text-sm font-black">
                        <Icon name={item.icon} className="h-4 w-4 shrink-0" />
                        {RESULT_LABEL[item.result]}
                      </span>
                      {waits ? (
                        <span id={`${waitIds}-${item.result}`} aria-hidden="true" className="one-line-safe max-w-full text-[11px] font-bold opacity-80">
                          {LEARN_TEXT.nextIn(waits[item.result])}
                        </span>
                      ) : null}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <Button variant="primary" icon="RotateCcw" className="min-h-12 w-full text-base" onClick={() => setFlipped(true)} data-autofocus>
                {LEARN_TEXT.showAnswer}
              </Button>
            )}
            <div className="mt-1.5 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => void answer("skip")}
                disabled={busy}
                aria-keyshortcuts={SKIP_KEY}
                title={RESULT_HINT.skip}
                className="motion-safe inline-flex min-h-10 items-center gap-1.5 text-sm font-extrabold text-[var(--muted)] hover:text-[var(--text)] disabled:opacity-60"
              >
                <Icon name="SkipForward" className="h-4 w-4" />
                {RESULT_LABEL.skip}
              </button>
              {flipped && onExplain ? (
                <button type="button" onClick={() => onExplain(current)} className="motion-safe inline-flex min-h-10 items-center gap-1.5 text-sm font-extrabold text-[var(--accent-ink)] hover:underline">
                  <Icon name="Sparkles" className="h-4 w-4" />
                  {LEARN_TEXT.explain}
                </button>
              ) : null}
            </div>
          </div>
        </footer>
      ) : null}
    </div>,
    document.body
  );
}
