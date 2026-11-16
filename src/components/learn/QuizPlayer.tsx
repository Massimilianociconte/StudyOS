// Un tentativo di quiz a schermo intero. Allenamento (ed errori, casuale): esito e spiegazione subito
// dopo «Conferma». Simulazione d'esame: avanti/indietro, tempo se il quiz ne ha uno, esiti solo alla
// fine. Il tentativo si salva una volta, alla fine, con punteggio deterministico (saveQuizAttempt).
import { createPortal } from "react-dom";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { newRun, saveQuizAttempt } from "../../store/learning";
import { clockText, percent, reviewAnswers, type PreparedQuestion } from "../../lib/learnSession";
import { correctOptionIds, optionLetter, scoreQuestion } from "../../lib/quizScoring";
import { LEARN_TEXT, QUIZ_MODE_LABEL, RESULT_LABEL, type QuizMode } from "../../lib/labels/learn";
import type { Quiz, StudyRun, StudyRunEvent, StudyRunMode } from "../../types";
import { InlineConfirm } from "../InlineConfirm";
import { Icon } from "../Icon";
import { Button, IconButton, ProgressBar, useBackCloses, useDialogLayer } from "../ui";
import { Blocks } from "./Blocks";
import type { ExplainTarget } from "./CardDrawer";
import { errorText } from "./useLearnData";

const RUN_MODE: Record<QuizMode, StudyRunMode> = { training: "training", exam: "exam", mistakes: "errors", random: "random" };

export interface QuizPlay {
  quiz: Quiz;
  prepared: PreparedQuestion[];
  mode: QuizMode;
  owner?: { id: string; name: string };
}

function OptionButton({
  letter,
  text,
  multiple,
  selected,
  state,
  feedback,
  disabled,
  onToggle
}: {
  letter: string;
  text: string;
  multiple: boolean;
  selected: boolean;
  state: "idle" | "right" | "wrong" | "missed";
  feedback?: string;
  disabled: boolean;
  onToggle: () => void;
}) {
  const tone =
    state === "right"
      ? "border-[var(--success-border)] bg-[var(--success-bg)]"
      : state === "wrong"
        ? "border-[var(--danger-border)] bg-[var(--danger-bg)]"
        : state === "missed"
          ? "border-2 border-[var(--success-border)] bg-[var(--surface-soft)]"
          : selected
            ? "border-[var(--accent-ink)] bg-[var(--surface)] ring-1 ring-[var(--accent-ink)]"
            : "border-[var(--border)] bg-[var(--surface-soft)] hover:bg-[var(--surface)]";
  return (
    <li>
      <button
        type="button"
        role={multiple ? "checkbox" : "radio"}
        aria-checked={selected}
        disabled={disabled}
        onClick={onToggle}
        className={`motion-safe flex w-full min-w-0 items-start gap-3 rounded-[18px] border p-3 text-left disabled:cursor-default ${tone}`}
      >
        <span className={`grid h-7 w-7 shrink-0 place-items-center ${multiple ? "rounded-[8px]" : "rounded-full"} border border-[var(--border)] text-xs font-black ${selected ? "bg-[var(--accent)] text-[#10131d]" : ""}`}>{letter}</span>
        <span className="min-w-0 flex-1">
          <span className="safe-text block text-sm font-bold">{text}</span>
          {feedback ? <span className="safe-text mt-1 block text-xs font-medium text-[var(--muted)]">{feedback}</span> : null}
        </span>
        {state === "right" || state === "missed" ? <Icon name="Check" className="h-4 w-4 shrink-0 text-[var(--success-text)]" /> : state === "wrong" ? <Icon name="X" className="h-4 w-4 shrink-0 text-[var(--danger-text)]" /> : null}
      </button>
    </li>
  );
}

export function QuizPlayer({ play, onClose, onExplain }: { play: QuizPlay; onClose: () => void; onExplain: (target: ExplainTarget) => void }) {
  const { quiz, prepared, mode, owner } = play;
  const exam = mode === "exam";
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<string, string[]>>(() => new Map());
  const [flags, setFlags] = useState<Set<string>>(() => new Set());
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);
  const [result, setResult] = useState<StudyRun | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const startedAt = useRef(Date.now());
  const shownAt = useRef(Date.now());
  const times = useRef(new Map<string, number>());
  const limitSeconds = exam && quiz.timeLimitMinutes ? quiz.timeLimitMinutes * 60 : 0;
  const [left, setLeft] = useState(limitSeconds);
  const run = useMemo(
    () =>
      newRun({
        kind: "quiz",
        mode: RUN_MODE[mode],
        title: quiz.title,
        quizId: quiz.id,
        deckIds: quiz.deckId ? [quiz.deckId] : [],
        subjectIds: quiz.subjectId ? [quiz.subjectId] : [],
        itemIds: prepared.map((item) => item.question.id)
      }),
    [mode, prepared, quiz]
  );

  const current = prepared[index];
  const chosen = current ? answers.get(current.question.id) ?? [] : [];
  const isChecked = current ? checked.has(current.question.id) : false;
  const unanswered = prepared.filter((item) => !(answers.get(item.question.id) ?? []).length).length;

  const track = () => {
    if (!current) return;
    const id = current.question.id;
    times.current.set(id, (times.current.get(id) ?? 0) + (Date.now() - shownAt.current));
    shownAt.current = Date.now();
  };

  const finish = async () => {
    if (saving || result) return;
    track();
    setSaving(true);
    setError("");
    const iso = new Date().toISOString();
    const events: StudyRunEvent[] = prepared.map(({ question }) => {
      const picked = answers.get(question.id) ?? [];
      const ms = times.current.get(question.id) ?? 0;
      return {
        i: question.id,
        r: scoreQuestion(question, picked),
        at: iso,
        ...(picked.length ? { c: picked } : {}),
        ...(ms > 0 ? { ms: Math.min(3_600_000, Math.round(ms)) } : {}),
        ...(question.revision ? { v: question.revision } : {}),
        ...(flags.has(question.id) ? { f: true } : {})
      };
    });
    try {
      setResult(await saveQuizAttempt({ ...run, startedAt: new Date(startedAt.current).toISOString() }, events));
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setSaving(false);
      setConfirmFinish(false);
    }
  };
  const finishRef = useRef(finish);
  finishRef.current = finish;

  // Timer della simulazione: allo zero il tentativo si chiude con le risposte date.
  useEffect(() => {
    if (!limitSeconds || result) return;
    const timer = window.setInterval(() => {
      const remaining = limitSeconds - Math.floor((Date.now() - startedAt.current) / 1000);
      setLeft(remaining);
      if (remaining <= 0) {
        window.clearInterval(timer);
        void finishRef.current();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [limitSeconds, result]);

  const leave = () => (result || !answers.size ? onClose() : setConfirmStop(true));
  useDialogLayer(true, { panelRef, onEscape: leave });
  useBackCloses(true, () => {
    if (result || !answers.size) {
      onClose();
      return true;
    }
    setConfirmStop(true);
    return false;
  });

  // Il pulsante premuto sparisce (Conferma, Avanti, fine): il focus resta nella finestra.
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const active = document.activeElement;
    if (active && active !== panel && panel.contains(active)) return;
    (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel).focus({ preventScroll: true });
  }, [index, checked, result, confirmFinish]);

  const toggle = (optionId: string) => {
    if (!current || (isChecked && !exam)) return;
    const id = current.question.id;
    setAnswers((value) => {
      const next = new Map(value);
      const previous = next.get(id) ?? [];
      next.set(id, current.question.kind === "single" ? [optionId] : previous.includes(optionId) ? previous.filter((item) => item !== optionId) : [...previous, optionId]);
      return next;
    });
  };

  const go = (delta: number) => {
    track();
    setIndex((value) => Math.min(prepared.length - 1, Math.max(0, value + delta)));
  };

  const review = result ? reviewAnswers(prepared, answers) : [];
  const right = review.filter((item) => item.outcome === "correct").length;

  return createPortal(
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] outline-none">
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="one-line-safe text-base font-black sm:text-lg">
            {quiz.title}
          </h2>
          <p className="text-xs font-bold text-[var(--muted)]">
            {QUIZ_MODE_LABEL[mode]}
            {owner ? ` · ${LEARN_TEXT.sharedBy(owner.name)}` : ""}
            {limitSeconds && !result ? ` · ${LEARN_TEXT.quizTimeLeft(clockText(left))}` : ""}
          </p>
        </div>
        <IconButton icon="X" label={result ? LEARN_TEXT.sessionClose : LEARN_TEXT.sessionStop} onClick={leave} />
      </header>

      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
          {confirmStop ? <InlineConfirm text="Uscire? Il tentativo non viene salvato." confirmLabel={LEARN_TEXT.sessionStop} icon="X" onConfirm={onClose} onCancel={() => setConfirmStop(false)} /> : null}
          {error ? (
            <p role="alert" className="safe-text rounded-[14px] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}

          {result ? (
            <>
              <section className="soft-panel p-6 text-center" aria-live="polite">
                <p className="text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.resultTitle}</p>
                <p className="mt-1 text-5xl font-black tabular-nums">{percent(result.score)}</p>
                <p className="mt-2 text-sm font-bold text-[var(--muted)]">{LEARN_TEXT.resultScore(right, prepared.length)}</p>
                {left <= 0 && limitSeconds ? <p className="mt-2 text-sm font-bold text-[var(--warning-text)]">{LEARN_TEXT.quizTimeUp}</p> : null}
                <p className="mx-auto mt-3 max-w-md text-xs font-medium text-[var(--faint)]">{LEARN_TEXT.scoringRule}</p>
                <div className="mt-4 flex justify-center">
                  <Button variant="primary" icon="Check" onClick={onClose} data-autofocus>
                    {LEARN_TEXT.sessionClose}
                  </Button>
                </div>
              </section>
              <h3 className="text-lg font-black">{LEARN_TEXT.resultReview}</h3>
              <ol className="grid gap-3">
                {prepared.map(({ question, options }, position) => {
                  const item = review[position];
                  const rightIds = new Set(correctOptionIds(question));
                  const text = (ids: readonly string[]) =>
                    ids.length
                      ? ids
                          .map((id) => {
                            const at = options.findIndex((option) => option.id === id);
                            return at >= 0 ? `${optionLetter(at)}. ${options[at].text}` : "";
                          })
                          .filter(Boolean)
                          .join(" · ")
                      : LEARN_TEXT.noAnswer;
                  return (
                    <li key={question.id} className="soft-panel p-4">
                      <div className="mb-2 flex items-center gap-2">
                        <Icon
                          name={item.outcome === "correct" ? "Check" : item.outcome === "wrong" ? "X" : "CircleDot"}
                          className={`h-4 w-4 shrink-0 ${item.outcome === "correct" ? "text-[var(--success-text)]" : item.outcome === "wrong" ? "text-[var(--danger-text)]" : "text-[var(--muted)]"}`}
                        />
                        <span className="text-xs font-black uppercase text-[var(--faint)]">
                          {position + 1}/{prepared.length}
                        </span>
                      </div>
                      <Blocks blocks={question.prompt} external={Boolean(owner)} />
                      <dl className="mt-3 grid gap-1 text-sm">
                        <div>
                          <dt className="inline font-black">{LEARN_TEXT.yourAnswer}: </dt>
                          <dd className="safe-text inline font-medium">{text(item.chosen)}</dd>
                        </div>
                        {item.outcome !== "correct" ? (
                          <div>
                            <dt className="inline font-black">{LEARN_TEXT.correctAnswer}: </dt>
                            <dd className="safe-text inline font-medium">{text([...rightIds])}</dd>
                          </div>
                        ) : null}
                      </dl>
                      {question.explanation?.length ? (
                        <div className="mt-3 border-t border-[var(--border)] pt-3 text-sm">
                          <Blocks blocks={question.explanation} external={Boolean(owner)} />
                        </div>
                      ) : null}
                      {question.mistakes ? <p className="safe-text mt-2 text-xs font-medium text-[var(--warning-text)]">{question.mistakes}</p> : null}
                      <div className="mt-2">
                        <Button variant="ghost" icon="Sparkles" onClick={() => onExplain({ kind: "explain_question", id: question.id, ...(owner ? { ownerId: owner.id } : {}), title: quiz.title })}>
                          {LEARN_TEXT.explain}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : current ? (
            <>
              <ProgressBar value={((exam ? prepared.length - unanswered : checked.size) / prepared.length) * 100} label={LEARN_TEXT.sessionOf(index + 1, prepared.length)} />
              <section className="soft-panel p-5 sm:p-6" aria-label={LEARN_TEXT.sessionOf(index + 1, prepared.length)}>
                <p className="mb-2 text-xs font-black uppercase text-[var(--faint)]">
                  {LEARN_TEXT.sessionOf(index + 1, prepared.length)} · {current.question.kind === "multiple" ? LEARN_TEXT.multipleHint : LEARN_TEXT.singleHint}
                </p>
                <div className="text-[1.05rem] leading-relaxed">
                  {/* key: lo stato dei blocchi (immagini caricate al tocco, errori) non passa alla domanda dopo. */}
                  <Blocks key={current.question.id} blocks={current.question.prompt} external={Boolean(owner)} />
                </div>
              </section>
              <ul role={current.question.kind === "multiple" ? "group" : "radiogroup"} aria-label={LEARN_TEXT.answer} className="grid gap-2">
                {current.options.map((option, position) => {
                  const selected = chosen.includes(option.id);
                  const state: "idle" | "right" | "wrong" | "missed" =
                    isChecked && !exam ? (option.correct ? (selected ? "right" : "missed") : selected ? "wrong" : "idle") : "idle";
                  return (
                    <OptionButton
                      key={option.id}
                      letter={optionLetter(position)}
                      text={option.text}
                      multiple={current.question.kind === "multiple"}
                      selected={selected}
                      state={state}
                      feedback={isChecked && !exam && (selected || option.correct) ? option.feedback : undefined}
                      disabled={isChecked && !exam}
                      onToggle={() => toggle(option.id)}
                    />
                  );
                })}
              </ul>
              {isChecked && !exam ? (
                <div className="soft-panel p-4" aria-live="polite">
                  <p className={`text-sm font-black ${scoreQuestion(current.question, chosen) === "correct" ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>
                    {scoreQuestion(current.question, chosen) === "correct" ? "Giusta" : scoreQuestion(current.question, chosen) === "skip" ? LEARN_TEXT.noAnswer : "Sbagliata"}
                    {scoreQuestion(current.question, chosen) === "correct"
                      ? ""
                      : ` · ${LEARN_TEXT.correctAnswer}: ${current.options
                          .map((option, position) => (option.correct ? optionLetter(position) : ""))
                          .filter(Boolean)
                          .join(", ")}`}
                  </p>
                  {current.question.explanation?.length ? (
                    <div className="mt-2 text-sm">
                      <Blocks key={current.question.id} blocks={current.question.explanation} external={Boolean(owner)} />
                    </div>
                  ) : null}
                  {current.question.mistakes ? <p className="safe-text mt-2 text-xs font-medium text-[var(--warning-text)]">{current.question.mistakes}</p> : null}
                </div>
              ) : null}
              {confirmFinish ? (
                <InlineConfirm text={LEARN_TEXT.finishQuizConfirm(unanswered)} confirmLabel={LEARN_TEXT.finishQuiz} icon="Check" busy={saving} onConfirm={() => void finish()} onCancel={() => setConfirmFinish(false)} />
              ) : null}
            </>
          ) : null}
        </div>
      </div>

      {!result && current ? (
        <footer className="border-t border-[var(--border)] px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6">
          <div className="mx-auto flex w-full max-w-2xl flex-wrap items-center gap-2">
            <label className="inline-flex min-h-11 w-full items-center gap-2 text-sm font-bold sm:mr-auto sm:w-auto">
              <input
                type="checkbox"
                checked={flags.has(current.question.id)}
                onChange={(event) =>
                  setFlags((value) => {
                    const next = new Set(value);
                    if (event.target.checked) next.add(current.question.id);
                    else next.delete(current.question.id);
                    return next;
                  })
                }
              />
              {LEARN_TEXT.markDoubt}
            </label>
            <div className="ml-auto flex flex-wrap justify-end gap-2">
              {exam ? (
                <>
                  <Button variant="soft" icon="ChevronLeft" disabled={index === 0} onClick={() => go(-1)}>
                    {LEARN_TEXT.previousQuestion}
                  </Button>
                  {index < prepared.length - 1 ? (
                    <Button variant="primary" icon="ChevronRight" onClick={() => go(1)}>
                      {LEARN_TEXT.nextQuestion}
                    </Button>
                  ) : (
                    <Button variant="primary" icon="Check" onClick={() => setConfirmFinish(true)} disabled={saving}>
                      {LEARN_TEXT.finishQuiz}
                    </Button>
                  )}
                </>
              ) : isChecked ? (
                index < prepared.length - 1 ? (
                  <Button variant="primary" icon="ChevronRight" onClick={() => go(1)} data-autofocus>
                    {LEARN_TEXT.nextQuestion}
                  </Button>
                ) : (
                  <Button variant="primary" icon="Check" onClick={() => void finish()} disabled={saving} data-autofocus>
                    {LEARN_TEXT.finishQuiz}
                  </Button>
                )
              ) : (
                <>
                  <Button variant="ghost" icon="SkipForward" onClick={() => setChecked((value) => new Set(value).add(current.question.id))}>
                    {RESULT_LABEL.skip}
                  </Button>
                  <Button
                    variant="primary"
                    icon="Check"
                    disabled={!chosen.length}
                    onClick={() => setChecked((value) => new Set(value).add(current.question.id))}
                  >
                    {LEARN_TEXT.confirmAnswer}
                  </Button>
                </>
              )}
            </div>
          </div>
        </footer>
      ) : null}
    </div>,
    document.body
  );
}
