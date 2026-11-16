// Sessione di ripasso a schermo intero: gira la scheda, poi «Com'è andata?» Sbagliata / Dubbia /
// Corretta (ognuna dice tra quanto torna la scheda). Indietro e Avanti scorrono le schede: tornando a
// una scheda già vista la si ritrova con la risposta data, e se ne può scegliere un'altra (prende il
// posto della prima, vedi changeCardAnswer); Avanti su una scheda nuova la salta. Tastiera: ← →
// scorrono, Spazio gira, 1–3 rispondono nell'ordine dei pulsanti, 4 salta; sulla scheda girata si
// trascina a destra (corretta) o a sinistra (sbagliata). Ogni risposta si salva subito: «Termina»
// porta al riepilogo senza perdere nulla, e dal riepilogo si può tornare alle schede.
// Layout: la scheda occupa lo spazio libero (contenitore con `container-type: size`); su un telefono in
// orizzontale (`short:`) i comandi passano a destra, così la scheda resta leggibile.
import { createPortal } from "react-dom";
import { m, useReducedMotion, type PanInfo } from "framer-motion";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { answerCard, changeCardAnswer, finishRun, newRun, type SavedAnswer } from "../../store/learning";
import { blocksPlainText } from "../../lib/cardBlocks";
import { nextWaits } from "../../lib/learnSession";
import { LEARN_TEXT, RESULT_HINT, RESULT_LABEL, RESULT_PLURAL } from "../../lib/labels/learn";
import type { Flashcard, FlashcardState, ReviewResult, StudyRun } from "../../types";
import { Button, IconButton, ProgressRing, useBackCloses, useDialogLayer } from "../ui";
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

const STRIP_TONE: Record<ReviewResult, string> = {
  correct: "bg-[var(--success-text)]",
  wrong: "bg-[var(--danger-text)]",
  doubt: "bg-[var(--warning-text)]",
  skip: "bg-[var(--faint)]"
};

const EMPTY_TALLY: Record<ReviewResult, number> = { correct: 0, wrong: 0, doubt: 0, skip: 0 };
const SWIPE_PX = 90;
const MISSED_SHOWN = 8;
/** Fino a qui una tacca per scheda; oltre, una barra per esito. */
const STRIP_CELLS = 60;

const durationText = (ms: number) => (ms < 60_000 ? `${Math.max(1, Math.round(ms / 1000))} s` : LEARN_TEXT.minutes(Math.round(ms / 60_000)));

const NAV_BUTTON =
  "motion-safe inline-flex min-h-10 min-w-0 items-center gap-1 rounded-full px-3 text-sm font-extrabold text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)] disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent";

/** Avanzamento: una tacca per scheda, colorata con la risposta data; la scheda in vista con l'accento. */
function ProgressStrip({ results, index, total, label }: { results: readonly ReviewResult[]; index: number; total: number; label: string }) {
  const counts = { ...EMPTY_TALLY };
  for (const result of results) counts[result]++;
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={results.length}
      aria-label={label}
      className={`flex h-1.5 w-full overflow-hidden rounded-full ${total <= STRIP_CELLS ? "gap-[3px]" : "bg-[var(--surface-strong)]"}`}
    >
      {total <= STRIP_CELLS
        ? Array.from({ length: total }, (_, position) => {
            const result = results[position];
            return (
              <span
                key={position}
                className={`motion-safe h-full min-w-0 flex-1 rounded-full ${result ? STRIP_TONE[result] : position === index ? "bg-[var(--accent)]" : "bg-[var(--surface-strong)]"} ${
                  result && position === index ? "opacity-60" : ""
                }`}
              />
            );
          })
        : (["correct", "doubt", "wrong", "skip"] as const).map((result) =>
            counts[result] ? <span key={result} className={`h-full ${STRIP_TONE[result]}`} style={{ width: `${(counts[result] / total) * 100}%` }} /> : null
          )}
    </div>
  );
}

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
  const coarse = useMemo(() => typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches), []);
  const [queue, setQueue] = useState(spec.items);
  const [index, setIndex] = useState(0);
  // Una risposta per posizione della coda: answers.length è la prima scheda ancora da fare.
  const [answers, setAnswers] = useState<SavedAnswer[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stopped, setStopped] = useState(false);
  const seen = useRef(new Set<string>());
  const runRef = useRef<StudyRun>(newRun({ kind: "flashcards", mode: spec.mode, title: spec.title, deckIds: spec.deckIds, subjectIds: spec.subjectIds, itemIds: spec.items.map((item) => item.card.id) }));
  const shownAt = useRef(performance.now());
  const frontier = answers.length;
  const finished = index >= queue.length;
  const summary = finished || stopped;
  const current = summary ? null : queue[index];
  const saved: SavedAnswer | undefined = summary ? undefined : answers[index];
  const atFrontier = index >= frontier;

  const results = useMemo(() => answers.map((item) => item.result), [answers]);
  const tally = useMemo(() => {
    const out = { ...EMPTY_TALLY };
    for (const result of results) out[result]++;
    return out;
  }, [results]);
  const answered = tally.correct + tally.wrong + tally.doubt;
  const missed = useMemo(
    () => answers.flatMap((item, position) => (item.result === "wrong" || item.result === "doubt") && queue[position] ? [{ item: queue[position], result: item.result }] : []),
    [answers, queue]
  );
  // Stesso tetto del salvataggio (un'ora per scheda): una scheda lasciata aperta non gonfia il tempo.
  const spentMs = useMemo(() => answers.reduce((sum, item) => sum + Math.min(3_600_000, Math.max(0, item.ms)), 0), [answers]);

  const close = useCallback(() => {
    void finishRun(runRef.current.id).catch(() => undefined);
    onClose();
  }, [onClose]);

  // «Termina», Esc e Indietro del telefono: senza risposte si esce, altrimenti si va al riepilogo
  // (tutto è già salvato, niente conferma); dal riepilogo si esce.
  const end = useCallback(() => {
    if (summary || !answers.length) {
      close();
      return;
    }
    void finishRun(runRef.current.id).catch(() => undefined);
    setStopped(true);
  }, [answers.length, close, summary]);

  useDialogLayer(true, { panelRef, onEscape: end });
  useBackCloses(true, () => {
    const leaving = summary || !answers.length;
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
    if (active && active !== panel && panel.contains(active) && !(active as HTMLButtonElement).disabled) return;
    (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel).focus({ preventScroll: true });
  }, [flipped, index, summary, queue]);

  // Va a una posizione: una scheda già vista si ritrova girata, con la risposta data (salvo le saltate).
  const show = useCallback((target: number, list: readonly SavedAnswer[], towards: 1 | -1) => {
    const at = list[target];
    setDirection(towards);
    setIndex(target);
    setFlipped(Boolean(at && at.result !== "skip"));
  }, []);

  const answer = useCallback(
    async (result: ReviewResult) => {
      if (!current || busy) return;
      const previous = answers[index];
      // Stessa risposta di prima: niente da salvare, si va avanti.
      if (previous && previous.result === result) {
        show(index + 1, answers, 1);
        return;
      }
      setBusy(true);
      setError("");
      const ms = performance.now() - shownAt.current;
      try {
        const out = previous
          ? await changeCardAnswer(runRef.current, previous, result, ms)
          : await answerCard(
              runRef.current,
              { id: current.card.id, deckId: current.card.deckId, subjectId: current.card.subjectId, revision: current.card.revision, ...(current.owner ? { ownerId: current.owner.id } : {}) },
              result,
              ms
            );
        runRef.current = out.run;
        seen.current.add(current.card.id);
        const list = answers.slice();
        list[index] = out.saved;
        setAnswers(list);
        show(index + 1, list, 1);
        if (index + 1 >= queue.length) void finishRun(runRef.current.id).catch(() => undefined);
      } catch (failure) {
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setBusy(false);
      }
    },
    [answers, busy, current, index, queue.length, show]
  );

  // Indietro: la scheda prima. Avanti: la scheda dopo, o «salta» se questa non ha ancora una risposta.
  const go = useCallback(
    (delta: 1 | -1) => {
      if (busy || summary) return;
      if (delta < 0) {
        if (index > 0) show(index - 1, answers, -1);
        return;
      }
      if (atFrontier) void answer("skip");
      else show(index + 1, answers, 1);
    },
    [answer, answers, atFrontier, busy, index, show, summary]
  );

  // Dal riepilogo alle schede: alla scheda dove si era fermata la sessione, o all'ultima se finita.
  const resume = useCallback(() => {
    if (!answers.length) return;
    setStopped(false);
    show(finished ? queue.length - 1 : index, answers, -1);
  }, [answers, finished, index, queue.length, show]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Tasto tenuto premuto: una sola azione, mai sulla scheda successiva non ancora vista.
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
      // Solo con il focus nella sessione: con «Spiegami meglio» o un'altra finestra sopra (che prende il
      // focus all'apertura) i tasti restano a quella finestra.
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !panelRef.current?.contains(target)) return;
      if (target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      if (summary) {
        if (event.key === "ArrowLeft" && answers.length) {
          event.preventDefault();
          resume();
        }
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        go(event.key === "ArrowLeft" ? -1 : 1);
        return;
      }
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
  }, [answer, answers.length, flipped, go, resume, summary]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (!flipped || busy) return;
    if (info.offset.x > SWIPE_PX) void answer("correct");
    else if (info.offset.x < -SWIPE_PX) void answer("wrong");
  };

  const restart = (items: SessionItem[], mode: StudyRun["mode"]) => {
    runRef.current = newRun({ kind: "flashcards", mode, title: spec.title, deckIds: spec.deckIds, subjectIds: spec.subjectIds, itemIds: items.map((item) => item.card.id) });
    setQueue(items);
    setAnswers([]);
    setStopped(false);
    setFlipped(false);
    setDirection(1);
    setIndex(0);
  };

  // Calcolate solo sul riepilogo: le schede viste sono già salvate e non tornano.
  const moreItems = useMemo(() => (summary && more ? more(seen.current) : []), [summary, more]);
  // Tra quanto torna la scheda: dallo stato di prima della risposta, se si è tornati a cambiarla.
  const waits = useMemo(
    () => (current && flipped ? nextWaits(saved && saved.after ? saved.before : states.get(current.card.id), current.card, new Date()) : null),
    [current, flipped, saved, states]
  );
  const score = answered ? tally.correct / answered : null;
  const feedback = !answered ? LEARN_TEXT.resultOnlySkips : (score ?? 0) >= 0.85 ? LEARN_TEXT.resultGreat : (score ?? 0) >= 0.6 ? LEARN_TEXT.resultGood : LEARN_TEXT.resultLow;
  const position = Math.min(index + 1, queue.length);
  const changing = Boolean(saved && saved.result !== "skip");

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] outline-none"
      // viewport-fit=cover: su un telefono in orizzontale la tacca non copre scheda e pulsanti.
      style={{ paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
    >
      <header className="border-b border-[var(--border)] px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6 short:pb-2 short:pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="one-line-safe text-base font-black sm:text-lg short:text-sm">
              {spec.title || LEARN_TEXT.sessionTitle}
            </h2>
            {summary ? null : (
              <p className="text-xs font-bold tabular-nums text-[var(--muted)]" aria-live="polite">
                {LEARN_TEXT.sessionOf(position, queue.length)}
              </p>
            )}
          </div>
          {summary ? null : (
            // Conteggi a colpo d'occhio (lo screen reader li sente nel riepilogo).
            <div className="hidden shrink-0 items-center gap-1.5 sm:flex" aria-hidden="true">
              {(["correct", "doubt", "wrong"] as const).map((result) => (
                <span key={result} className={`inline-flex items-center gap-1 rounded-full bg-[var(--surface-soft)] px-2 py-1 text-xs font-black tabular-nums ${TALLY_TONE[result]}`}>
                  <Icon name={ANSWERS.find((item) => item.result === result)?.icon ?? "Check"} className="h-3.5 w-3.5" />
                  {tally[result]}
                </span>
              ))}
            </div>
          )}
          {summary ? (
            <IconButton icon="X" label={LEARN_TEXT.sessionClose} onClick={close} />
          ) : (
            <Button variant="soft" onClick={end} className="min-h-10 px-3.5">
              {LEARN_TEXT.sessionEnd}
            </Button>
          )}
        </div>
        {summary ? null : (
          <div className="mt-2.5 short:mt-1.5">
            <ProgressStrip results={results} index={index} total={queue.length} label={LEARN_TEXT.sessionOf(position, queue.length)} />
          </div>
        )}
      </header>

      <div className="flex min-h-0 flex-1 flex-col short:flex-row">
        <div className="scrollbar-soft min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain [container-type:size]">
          <div className="mx-auto flex min-h-full w-full max-w-[46rem] flex-col justify-center gap-3 px-4 py-4 sm:px-6 short:py-2">
            {summary ? (
              <section aria-labelledby={`${titleId}-result`} className="soft-panel p-5 sm:p-6">
                <div className="flex flex-col items-center text-center">
                  <h3 id={`${titleId}-result`} className="text-2xl font-black">
                    {finished ? LEARN_TEXT.resultDone : LEARN_TEXT.resultStopped}
                  </h3>
                  <p className="mt-1 text-sm font-bold text-[var(--muted)]">
                    {LEARN_TEXT.resultReviewed(answers.length, queue.length)}
                    {spentMs ? ` ${LEARN_TEXT.resultTime(durationText(spentMs))}` : ""}
                  </p>
                  {score !== null ? (
                    <div className="mt-4 w-36 short:w-28">
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
                  drag={flipped && !reduce && !busy ? "x" : false}
                  dragConstraints={{ left: 0, right: 0 }}
                  dragElastic={0.6}
                  onDragEnd={onDragEnd}
                  initial={reduce ? { opacity: 0 } : { opacity: 0, x: direction * 40 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                >
                  <FlashcardCard
                    card={current.card}
                    flipped={flipped}
                    onFlip={() => setFlipped((value) => !value)}
                    external={Boolean(current.owner)}
                    questionOnBack
                    fill
                    stack={queue.length - index - 1}
                    answered={saved?.result}
                    hint={coarse ? LEARN_TEXT.tapToFlip : LEARN_TEXT.clickToFlip}
                  />
                </m.div>
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
          <footer className="border-t border-[var(--border)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 short:flex short:w-[min(19rem,42%)] short:shrink-0 short:flex-col short:justify-center short:overflow-y-auto short:border-l short:border-t-0 short:px-3 short:py-2">
            {/* Le azioni del riepilogo restano sempre in vista, anche con la lista «Da rivedere» lunga. */}
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center short:flex-col short:flex-nowrap">
              {answers.length ? (
                <Button variant="ghost" icon="ChevronLeft" onClick={resume} aria-keyshortcuts="ArrowLeft">
                  {LEARN_TEXT.backToCards}
                </Button>
              ) : null}
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
          <footer className="border-t border-[var(--border)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 short:flex short:w-[min(19rem,42%)] short:shrink-0 short:flex-col short:justify-center short:overflow-y-auto short:border-l short:border-t-0 short:px-3 short:pb-[calc(0.5rem+env(safe-area-inset-bottom))] short:pt-2">
            <div className="mx-auto w-full max-w-[46rem]">
              {flipped ? (
                <>
                  <p className="mb-2 text-center text-xs font-black uppercase text-[var(--faint)] short:mb-1.5">{changing ? LEARN_TEXT.changeAnswer : LEARN_TEXT.howWell}</p>
                  <div className="grid grid-cols-3 gap-2 short:grid-cols-1 short:gap-1.5">
                    {ANSWERS.map((item) => {
                      const chosen = saved?.result === item.result;
                      return (
                        <button
                          key={item.result}
                          type="button"
                          disabled={busy}
                          onClick={() => void answer(item.result)}
                          title={RESULT_HINT[item.result]}
                          aria-keyshortcuts={item.key}
                          aria-pressed={changing ? chosen : undefined}
                          aria-describedby={waits ? `${waitIds}-${item.result}` : undefined}
                          className={`motion-safe flex min-h-14 min-w-0 flex-col items-center justify-center rounded-[16px] border px-2 py-1.5 hover:brightness-105 disabled:opacity-60 short:min-h-11 short:flex-row short:justify-between short:gap-2 short:px-3 ${item.tone} ${
                            chosen ? "ring-2 ring-current ring-offset-2 ring-offset-[var(--bg)]" : changing ? "opacity-75 hover:opacity-100" : ""
                          }`}
                        >
                          <span className="flex items-center gap-1.5 text-sm font-black">
                            <Icon name={chosen ? "CheckCheck" : item.icon} className="h-4 w-4 shrink-0" />
                            {RESULT_LABEL[item.result]}
                          </span>
                          {waits ? (
                            <span id={`${waitIds}-${item.result}`} aria-hidden="true" className="one-line-safe max-w-full text-[11px] font-bold opacity-80">
                              {LEARN_TEXT.nextIn(waits[item.result])}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <Button variant="primary" icon="RotateCcw" className="min-h-12 w-full text-base short:min-h-11" onClick={() => setFlipped(true)} data-autofocus>
                  {LEARN_TEXT.showAnswer}
                </Button>
              )}
              <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-1 short:mt-1.5">
                <button
                  type="button"
                  onClick={() => go(-1)}
                  disabled={busy || index === 0}
                  aria-keyshortcuts="ArrowLeft"
                  title={LEARN_TEXT.previousCardHint}
                  className={`${NAV_BUTTON} justify-self-start`}
                >
                  <Icon name="ChevronLeft" className="h-4 w-4 shrink-0" />
                  {LEARN_TEXT.previousCard}
                </button>
                {flipped && onExplain ? (
                  <button
                    type="button"
                    onClick={() => onExplain(current)}
                    title={LEARN_TEXT.explain}
                    className="motion-safe inline-flex min-h-10 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-sm font-extrabold text-[var(--accent-ink)] hover:bg-[var(--surface)]"
                  >
                    <Icon name="Sparkles" className="h-4 w-4 shrink-0" />
                    <span className="one-line-safe max-[379px]:sr-only short:sr-only">{LEARN_TEXT.explain}</span>
                  </button>
                ) : (
                  <span />
                )}
                <button
                  type="button"
                  onClick={() => go(1)}
                  disabled={busy}
                  aria-keyshortcuts={atFrontier ? `ArrowRight ${SKIP_KEY}` : "ArrowRight"}
                  title={atFrontier ? LEARN_TEXT.skipCardHint : LEARN_TEXT.nextCardHint}
                  className={`${NAV_BUTTON} justify-self-end`}
                >
                  {atFrontier ? RESULT_LABEL.skip : LEARN_TEXT.nextCard}
                  <Icon name="ChevronRight" className="h-4 w-4 shrink-0" />
                </button>
              </div>
              <p className="mt-1 hidden text-center text-[11px] font-medium text-[var(--faint)] can-hover:block short:!hidden">{LEARN_TEXT.keysHint}</p>
              {flipped && !reduce ? <p className="mt-1 hidden text-center text-[11px] font-medium text-[var(--faint)] [@media(pointer:coarse)]:block short:!hidden">{LEARN_TEXT.swipeHint}</p> : null}
            </div>
          </footer>
        ) : null}
      </div>
    </div>,
    document.body
  );
}
