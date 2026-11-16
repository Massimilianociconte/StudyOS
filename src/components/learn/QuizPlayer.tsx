// Un tentativo di quiz a schermo intero. Allenamento (ed errori, casuale): esito e spiegazione subito
// dopo «Conferma»; Indietro riporta alle domande già fatte, da rileggere con esito e spiegazione.
// Simulazione d'esame: avanti/indietro su tutte le domande, tempo se il quiz ne ha uno, esiti solo alla
// fine. I numeri in alto portano a una domanda (in allenamento solo fino alla prima da fare).
// Tastiera: ← → scorrono, A–F o 1–6 scelgono, Invio conferma o va avanti.
// Layout: una colonna su telefono e tablet in verticale; domanda a sinistra e risposte a destra su
// tablet in orizzontale e computer (`wide:`) e sul telefono in orizzontale (`short:`).
// Il tentativo si salva una volta, alla fine, con punteggio deterministico (saveQuizAttempt).
import { createPortal } from "react-dom";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { newRun, saveQuizAttempt } from "../../store/learning";
import { clockText, optionFromKey, quizReachable, reviewAnswers, type PreparedQuestion } from "../../lib/learnSession";
import { correctOptionIds, optionLetter, scoreQuestion } from "../../lib/quizScoring";
import { LEARN_TEXT, QUIZ_MODE_LABEL, RESULT_LABEL, type QuizMode } from "../../lib/labels/learn";
import type { Quiz, StudyRun, StudyRunEvent, StudyRunMode } from "../../types";
import { InlineConfirm } from "../InlineConfirm";
import { Icon } from "../Icon";
import { Button, IconButton, ProgressRing, useBackCloses, useDialogLayer } from "../ui";
import { Blocks } from "./Blocks";
import type { ExplainTarget } from "./CardDrawer";
import { errorText } from "./useLearnData";

const RUN_MODE: Record<QuizMode, StudyRunMode> = { training: "training", exam: "exam", mistakes: "errors", random: "random" };

type OptionState = "idle" | "right" | "wrong" | "missed";

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
  state: OptionState;
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
          ? "border-[var(--success-border)] border-dashed bg-[var(--surface-soft)]"
          : selected
            ? "border-[var(--accent-ink)] bg-[color-mix(in_srgb,var(--accent)_12%,var(--surface))] shadow-[0_0_0_1px_var(--accent-ink)]"
            : "border-[var(--border)] bg-[var(--surface-soft)] hover:border-[color-mix(in_srgb,var(--accent)_45%,var(--border))] hover:bg-[var(--surface)]";
  const badge =
    state === "right" || state === "missed"
      ? "border-transparent bg-[var(--success-text)] text-[var(--bg)]"
      : state === "wrong"
        ? "border-transparent bg-[var(--danger-text)] text-[var(--bg)]"
        : selected
          ? "border-transparent bg-[var(--accent)] text-[#10131d]"
          : "border-[var(--border)] bg-[var(--surface-strong)] text-[var(--muted)]";
  return (
    <li>
      <button
        type="button"
        role={multiple ? "checkbox" : "radio"}
        aria-checked={selected}
        aria-keyshortcuts={letter}
        data-option
        disabled={disabled}
        onClick={onToggle}
        className={`motion-safe flex min-h-[3.25rem] w-full min-w-0 items-start gap-3 rounded-[18px] border p-3 text-left disabled:cursor-default sm:p-3.5 short:min-h-11 short:p-2.5 ${tone}`}
      >
        <span className={`grid h-8 w-8 shrink-0 place-items-center border text-sm font-black ${multiple ? "rounded-[10px]" : "rounded-full"} ${badge}`}>
          {state === "right" || state === "missed" ? <Icon name="Check" className="h-4 w-4" /> : state === "wrong" ? <Icon name="X" className="h-4 w-4" /> : letter}
        </span>
        <span className="min-w-0 flex-1 self-center">
          <span className="safe-text block text-[0.95rem] font-bold leading-snug sm:text-base short:text-sm">{text}</span>
          {feedback ? <span className="safe-text mt-1 block text-xs font-medium text-[var(--muted)] sm:text-sm">{feedback}</span> : null}
        </span>
      </button>
    </li>
  );
}

export function QuizPlayer({ play, onClose, onExplain }: { play: QuizPlay; onClose: () => void; onExplain: (target: ExplainTarget) => void }) {
  const { quiz, prepared, mode, owner } = play;
  const exam = mode === "exam";
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLOListElement>(null);
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
  // In allenamento una domanda confermata non cambia più: si rilegge con esito e spiegazione.
  const locked = isChecked && !exam;
  const unanswered = prepared.filter((item) => !(answers.get(item.question.id) ?? []).length).length;
  const last = index === prepared.length - 1;
  const outcome = current && locked ? scoreQuestion(current.question, chosen) : null;

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
    if (active && active !== panel && panel.contains(active) && !(active as HTMLButtonElement).disabled) return;
    (panel.querySelector<HTMLElement>("[data-autofocus]") ?? panel).focus({ preventScroll: true });
  }, [index, checked, result, confirmFinish]);

  // Il numero della domanda in vista resta visibile nella fila (che scorre in orizzontale).
  useEffect(() => {
    const list = navRef.current;
    const item = list?.querySelector<HTMLElement>('[aria-current="step"]');
    if (!list || !item) return;
    const left = item.offsetLeft - list.clientWidth / 2 + item.offsetWidth / 2;
    list.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [index]);

  const toggle = useCallback(
    (optionId: string) => {
      if (!current || locked) return;
      const id = current.question.id;
      setAnswers((value) => {
        const next = new Map(value);
        const previous = next.get(id) ?? [];
        next.set(id, current.question.kind === "single" ? [optionId] : previous.includes(optionId) ? previous.filter((item) => item !== optionId) : [...previous, optionId]);
        return next;
      });
    },
    [current, locked]
  );

  const jump = (position: number) => {
    if (position === index || !quizReachable(position, prepared, checked, exam)) return;
    track();
    setConfirmFinish(false);
    setIndex(position);
  };
  const check = () => {
    if (current) setChecked((value) => new Set(value).add(current.question.id));
  };

  // Avanti dalla domanda in vista: la dopo, o la fine sull'ultima. In allenamento solo dopo Conferma.
  const forward = () => {
    if (!current || (!exam && !isChecked)) return;
    if (!last) jump(index + 1);
    else if (exam) setConfirmFinish(true);
    else void finish();
  };

  const keysRef = useRef({ forward, jump, check, toggle });
  keysRef.current = { forward, jump, check, toggle };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || result || confirmStop || !current) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !panelRef.current?.contains(target)) return;
      if (target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])")) return;
      const keys = keysRef.current;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        keys.jump(index - 1);
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        keys.forward();
        return;
      }
      if (event.key === "Enter") {
        // Su un pulsante Invio lo preme già (niente doppio passo); su una risposta conferma, non la
        // deseleziona (dopo un clic il focus resta sull'ultima risposta scelta).
        if ((target.closest("button, a") && !target.closest("[data-option]")) || confirmFinish) return;
        event.preventDefault();
        if (!exam && !isChecked) {
          if (chosen.length) keys.check();
        } else keys.forward();
        return;
      }
      const option = optionFromKey(event.key, current.options.length);
      if (option < 0 || locked) return;
      event.preventDefault();
      keys.toggle(current.options[option].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chosen.length, confirmFinish, confirmStop, current, exam, index, isChecked, locked, result]);

  const review = result ? reviewAnswers(prepared, answers) : [];
  const right = review.filter((item) => item.outcome === "correct").length;
  const lowTime = limitSeconds > 0 && left <= 60;

  const navState = (position: number) => {
    const { question } = prepared[position];
    const id = question.id;
    const picked = answers.get(id) ?? [];
    if (!exam && checked.has(id)) return scoreQuestion(question, picked);
    return picked.length ? "answered" : "empty";
  };
  const NAV_TONE: Record<string, string> = {
    correct: "bg-[var(--success-bg)] text-[var(--success-text)] border-[var(--success-border)]",
    wrong: "bg-[var(--danger-bg)] text-[var(--danger-text)] border-[var(--danger-border)]",
    skip: "bg-[var(--surface-soft)] text-[var(--muted)] border-[var(--border)] border-dashed",
    answered: "bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] text-[var(--accent-ink)] border-[color-mix(in_srgb,var(--accent)_40%,transparent)]",
    empty: "bg-[var(--surface-soft)] text-[var(--muted)] border-[var(--border)]"
  };

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)] outline-none"
      style={{ paddingLeft: "env(safe-area-inset-left)", paddingRight: "env(safe-area-inset-right)" }}
    >
      <header className="border-b border-[var(--border)] px-4 pb-3 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-6 short:pb-2 short:pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="one-line-safe text-base font-black sm:text-lg short:text-sm">
              {quiz.title}
            </h2>
            <p className="one-line-safe text-xs font-bold text-[var(--muted)]">
              {QUIZ_MODE_LABEL[mode]}
              {owner ? ` · ${LEARN_TEXT.sharedBy(owner.name)}` : ""}
            </p>
          </div>
          {limitSeconds && !result ? (
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-black tabular-nums ${lowTime ? "bg-[var(--warning-bg)] text-[var(--warning-text)]" : "bg-[var(--surface-soft)]"}`}
              aria-label={LEARN_TEXT.quizTimeLeft(clockText(left))}
            >
              <Icon name="Clock" className="h-4 w-4" />
              {clockText(left)}
            </span>
          ) : null}
          <IconButton icon="X" label={result ? LEARN_TEXT.sessionClose : LEARN_TEXT.sessionStop} onClick={leave} />
        </div>
        {!result && prepared.length > 1 ? (
          <nav aria-label={LEARN_TEXT.questionNav} className="mt-2.5 short:mt-1.5" data-small-ok>
            <ol ref={navRef} className="scrollbar-hidden -mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5">
              {prepared.map((item, position) => {
                const state = navState(position);
                const flagged = flags.has(item.question.id);
                const here = position === index;
                const reachable = quizReachable(position, prepared, checked, exam);
                const said = [
                  state === "answered" ? LEARN_TEXT.questionAnswered : state === "correct" ? LEARN_TEXT.quizRight : state === "wrong" ? LEARN_TEXT.quizWrong : state === "skip" ? RESULT_LABEL.skip : "",
                  flagged ? LEARN_TEXT.questionFlagged : "",
                  here ? LEARN_TEXT.questionCurrent : ""
                ]
                  .filter(Boolean)
                  .join(", ");
                return (
                  <li key={item.question.id} className="shrink-0">
                    <button
                      type="button"
                      onClick={() => jump(position)}
                      disabled={!reachable}
                      aria-current={here ? "step" : undefined}
                      aria-label={LEARN_TEXT.goToQuestion(position + 1, said)}
                      className={`motion-safe relative grid h-9 min-w-9 place-items-center rounded-full border px-2 text-xs font-black tabular-nums disabled:cursor-not-allowed disabled:opacity-40 short:h-8 short:min-w-8 ${NAV_TONE[state]} ${
                        here ? "ring-2 ring-[var(--accent-ink)] ring-offset-2 ring-offset-[var(--bg)]" : ""
                      }`}
                    >
                      {position + 1}
                      {flagged ? <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg)] bg-[var(--warning-text)]" /> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : null}
      </header>

      <div className="scrollbar-soft min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 sm:py-5 short:py-2">
        {result ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
            <section className="soft-panel flex flex-col items-center p-6 text-center" aria-live="polite">
              <p className="text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.resultTitle}</p>
              <div className="mt-3 w-36 short:w-28">
                <ProgressRing value={(result.score ?? 0) * 100} label={LEARN_TEXT.resultCorrect} />
              </div>
              <p className="mt-3 text-lg font-black tabular-nums">{LEARN_TEXT.resultScore(right, prepared.length)}</p>
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
                  <li key={question.id} className="soft-panel p-4 sm:p-5">
                    <div className="mb-2 flex items-center gap-2">
                      <Icon
                        name={item.outcome === "correct" ? "Check" : item.outcome === "wrong" ? "X" : "CircleDot"}
                        className={`h-4 w-4 shrink-0 ${item.outcome === "correct" ? "text-[var(--success-text)]" : item.outcome === "wrong" ? "text-[var(--danger-text)]" : "text-[var(--muted)]"}`}
                      />
                      <span className="text-xs font-black uppercase text-[var(--faint)]">
                        {position + 1}/{prepared.length}
                      </span>
                      {flags.has(question.id) ? <Icon name="Flag" className="h-3.5 w-3.5 text-[var(--warning-text)]" /> : null}
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
          </div>
        ) : current ? (
          <div className="mx-auto grid w-full max-w-3xl grid-cols-1 items-start gap-4 short:max-w-none short:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] short:gap-3 wide:max-w-6xl wide:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] wide:gap-6">
            {confirmStop || error ? (
              <div className="grid gap-3 short:col-span-2 wide:col-span-2">
                {confirmStop ? <InlineConfirm text="Uscire? Il tentativo non viene salvato." confirmLabel={LEARN_TEXT.sessionStop} icon="X" onConfirm={onClose} onCancel={() => setConfirmStop(false)} /> : null}
                {error ? (
                  <p role="alert" className="safe-text rounded-[14px] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
                    {error}
                  </p>
                ) : null}
              </div>
            ) : null}

            <section className="flash-face p-5 sm:p-6 short:sticky short:top-0 short:p-4 wide:sticky wide:top-0 wide:p-7" aria-label={LEARN_TEXT.sessionOf(index + 1, prepared.length)}>
              <div className="mb-3 flex min-w-0 items-center gap-2">
                <p className="min-w-0 flex-1 text-xs font-black uppercase text-[var(--faint)]">
                  <span className="text-[var(--accent-ink)]">{LEARN_TEXT.sessionOf(index + 1, prepared.length)}</span>
                  <span className="block normal-case sm:inline"> {current.question.kind === "multiple" ? LEARN_TEXT.multipleHint : LEARN_TEXT.singleHint}</span>
                </p>
                <button
                  type="button"
                  aria-pressed={flags.has(current.question.id)}
                  onClick={() =>
                    setFlags((value) => {
                      const next = new Set(value);
                      if (next.has(current.question.id)) next.delete(current.question.id);
                      else next.add(current.question.id);
                      return next;
                    })
                  }
                  title={LEARN_TEXT.markDoubt}
                  className={`motion-safe inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-extrabold ${
                    flags.has(current.question.id) ? "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]" : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--surface)]"
                  }`}
                >
                  <Icon name="Flag" className="h-3.5 w-3.5" />
                  <span className="max-[379px]:sr-only">{LEARN_TEXT.markDoubt}</span>
                </button>
              </div>
              <div className="text-[1.08rem] font-semibold leading-relaxed sm:text-lg short:text-base wide:text-xl">
                {/* key: lo stato dei blocchi (immagini caricate al tocco, errori) non passa alla domanda dopo. */}
                <Blocks key={current.question.id} blocks={current.question.prompt} external={Boolean(owner)} />
              </div>
            </section>

            <div className="grid min-w-0 gap-3">
              <ul role={current.question.kind === "multiple" ? "group" : "radiogroup"} aria-label={LEARN_TEXT.answer} className="grid gap-2">
                {current.options.map((option, position) => {
                  const selected = chosen.includes(option.id);
                  const state: OptionState = locked ? (option.correct ? (selected ? "right" : "missed") : selected ? "wrong" : "idle") : "idle";
                  return (
                    <OptionButton
                      key={option.id}
                      letter={optionLetter(position)}
                      text={option.text}
                      multiple={current.question.kind === "multiple"}
                      selected={selected}
                      state={state}
                      feedback={locked && (selected || option.correct) ? option.feedback : undefined}
                      disabled={locked}
                      onToggle={() => toggle(option.id)}
                    />
                  );
                })}
              </ul>
              {locked && outcome ? (
                <div
                  className={`rounded-[22px] border p-4 ${outcome === "correct" ? "border-[var(--success-border)] bg-[var(--success-bg)]" : "border-[var(--danger-border)] bg-[var(--danger-bg)]"}`}
                  aria-live="polite"
                >
                  <p className={`flex items-center gap-1.5 text-sm font-black ${outcome === "correct" ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>
                    <Icon name={outcome === "correct" ? "Check" : "X"} className="h-4 w-4 shrink-0" />
                    {outcome === "correct" ? LEARN_TEXT.quizRight : outcome === "skip" ? LEARN_TEXT.noAnswer : LEARN_TEXT.quizWrong}
                    {outcome === "correct"
                      ? ""
                      : ` · ${LEARN_TEXT.correctAnswer}: ${current.options
                          .map((option, position) => (option.correct ? optionLetter(position) : ""))
                          .filter(Boolean)
                          .join(", ")}`}
                  </p>
                  {current.question.explanation?.length ? (
                    <div className="mt-2 text-sm text-[var(--text)]">
                      <Blocks key={current.question.id} blocks={current.question.explanation} external={Boolean(owner)} />
                    </div>
                  ) : null}
                  {current.question.mistakes ? <p className="safe-text mt-2 text-xs font-medium text-[var(--warning-text)]">{current.question.mistakes}</p> : null}
                </div>
              ) : null}
              {confirmFinish ? (
                <InlineConfirm text={LEARN_TEXT.finishQuizConfirm(unanswered)} confirmLabel={LEARN_TEXT.finishQuiz} icon="Check" busy={saving} onConfirm={() => void finish()} onCancel={() => setConfirmFinish(false)} />
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {!result && current ? (
        <footer className="border-t border-[var(--border)] px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:px-6 short:pb-[calc(0.5rem+env(safe-area-inset-bottom))] short:pt-2">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-2 wide:max-w-6xl short:max-w-none">
            {/* Sotto i 380px (telefoni stretti) Indietro e Salta restano icone: con Conferma stanno in una riga. */}
            <Button variant="ghost" icon="ChevronLeft" disabled={index === 0} onClick={() => jump(index - 1)} aria-keyshortcuts="ArrowLeft" title={LEARN_TEXT.previousQuestion} className="shrink-0 px-3">
              <span className="max-[379px]:sr-only">{LEARN_TEXT.previousQuestion}</span>
            </Button>
            <p className="mx-auto hidden min-w-0 text-center text-[11px] font-medium text-[var(--faint)] can-hover:block short:!hidden">{LEARN_TEXT.quizKeysHint}</p>
            <div className="ml-auto flex shrink-0 gap-2">
              {exam || isChecked ? (
                last ? (
                  <Button variant="primary" icon="Check" onClick={forward} disabled={saving} data-autofocus={isChecked ? true : undefined}>
                    {LEARN_TEXT.finishQuiz}
                  </Button>
                ) : (
                  <Button variant="primary" icon="ChevronRight" onClick={forward} aria-keyshortcuts="ArrowRight" data-autofocus={isChecked ? true : undefined} className="flex-row-reverse">
                    {LEARN_TEXT.nextQuestion}
                  </Button>
                )
              ) : (
                <>
                  <Button variant="ghost" icon="SkipForward" onClick={check} title={RESULT_LABEL.skip} className="px-3">
                    <span className="max-[379px]:sr-only">{RESULT_LABEL.skip}</span>
                  </Button>
                  <Button variant="primary" icon="Check" disabled={!chosen.length} onClick={check} aria-keyshortcuts="Enter">
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
