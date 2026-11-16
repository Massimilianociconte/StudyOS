// Quiz: elenco (tuoi e condivisi) con ultimo e miglior punteggio, avvio con la modalità scelta,
// creazione e modifica dei tuoi quiz.
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { deleteQuiz } from "../../store/learning";
import { deleteSharedQuiz } from "../../store/sharedLearning";
import { lastMistakes, percent, prepareQuiz } from "../../lib/learnSession";
import { deckPath, sortByPosition } from "../../lib/learningModel";
import { LEARN_TEXT, QUIZ_MODES, QUIZ_MODE_HINT, QUIZ_MODE_LABEL, type QuizMode } from "../../lib/labels/learn";
import type { Quiz, QuizQuestion } from "../../types";
import { ConfirmWithError } from "../ConfirmWithError";
import { Button, Drawer, EmptyState, Field, inputClass } from "../ui";
import { Icon } from "../Icon";
import { QuizEditor } from "./QuizEditor";
import type { LearningSource } from "../../agent/learningShared";
import type { QuizPlay } from "./QuizPlayer";
import { errorText, type LearnData } from "./useLearnData";
import { SubjectMark } from "../SubjectMark";

const MODE_ICON: Record<QuizMode, string> = { training: "Target", exam: "Timer", mistakes: "RotateCcw", random: "Zap" };

interface QuizEntry {
  quiz: Quiz;
  questions: QuizQuestion[];
  owner?: { id: string; name: string };
  /** Fonte altrui con «Può modificare»: il quiz si modifica tra i dati di chi lo condivide. */
  shared?: LearningSource;
  path: string;
}

function StartDrawer({ entry, data, onClose, onPlay }: { entry: QuizEntry | null; data: LearnData; onClose: () => void; onPlay: (play: QuizPlay) => void }) {
  const [mode, setMode] = useState<QuizMode>("training");
  const [limit, setLimit] = useState(20);
  const modeLabelId = useId();
  // Gruppo di scelte: le frecce cambiano modalità e spostano il focus (Tab entra solo su quella scelta).
  const onModeKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = QUIZ_MODES[(QUIZ_MODES.indexOf(mode) + step + QUIZ_MODES.length) % QUIZ_MODES.length];
    setMode(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus();
  };
  const mistakes = useMemo(() => (entry ? lastMistakes(data.studyRuns, entry.quiz.id) : new Set<string>()), [entry, data.studyRuns]);
  if (!entry) return <Drawer open={false} onClose={onClose} title="" />;
  const available = mode === "mistakes" ? entry.questions.filter((question) => mistakes.has(question.id)).length : entry.questions.length;
  const start = () => {
    const seed = Date.now() % 100_000;
    const prepared = prepareQuiz(entry.questions, {
      seed,
      ...(mode === "mistakes" ? { only: mistakes } : {}),
      ...(mode === "random" ? { limit } : {}),
      // Allenamento ed esame: ordine del quiz, risposte mescolate solo nella simulazione e nel casuale.
      shuffle: mode === "random" || mode === "exam"
    });
    if (prepared.length) onPlay({ quiz: entry.quiz, prepared, mode, ...(entry.owner ? { owner: entry.owner } : {}) });
  };
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={entry.owner ? LEARN_TEXT.sharedBy(entry.owner.name) : entry.path || undefined}
      title={entry.quiz.title}
      footer={
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-sm font-bold text-[var(--muted)]">{LEARN_TEXT.questionsCount(mode === "random" ? Math.min(limit, available) : available)}</span>
          <Button onClick={onClose}>{LEARN_TEXT.cancel}</Button>
          <Button variant="primary" icon="PlayCircle" disabled={!available} onClick={start}>
            {LEARN_TEXT.startQuiz}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        {entry.quiz.description ? <p className="safe-text whitespace-pre-line text-sm font-medium text-[var(--muted)]">{entry.quiz.description}</p> : null}
        <div className="min-w-0">
          <p id={modeLabelId} className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">
            {LEARN_TEXT.quizMode}
          </p>
          {/* Le quattro modalità tutte in vista, ciascuna con cosa fa (su telefono una fila scorrevole ne nascondeva due). */}
          <div role="radiogroup" aria-labelledby={modeLabelId} className="grid grid-cols-2 gap-2" onKeyDown={onModeKey}>
            {QUIZ_MODES.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={mode === id}
                tabIndex={mode === id ? 0 : -1}
                data-mode={id}
                onClick={() => setMode(id)}
                className={`motion-safe flex min-h-[4.5rem] min-w-0 flex-col items-start gap-1 rounded-[18px] border p-3 text-left ${
                  mode === id
                    ? "border-[var(--accent-ink)] bg-[color-mix(in_srgb,var(--accent)_12%,var(--surface))] shadow-[0_0_0_1px_var(--accent-ink)]"
                    : "border-[var(--border)] bg-[var(--surface-soft)] hover:bg-[var(--surface)]"
                }`}
              >
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-black">
                  <Icon name={MODE_ICON[id]} className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                  <span className="safe-text">{QUIZ_MODE_LABEL[id]}</span>
                </span>
                <span className="safe-text text-xs font-medium leading-snug text-[var(--muted)]">{QUIZ_MODE_HINT[id]}</span>
              </button>
            ))}
          </div>
          {mode === "exam" && entry.quiz.timeLimitMinutes ? <p className="mt-1 text-sm font-bold">{LEARN_TEXT.quizTimeLimit(entry.quiz.timeLimitMinutes)}</p> : null}
          {mode === "mistakes" && !available ? <p className="mt-1 text-sm font-bold">{LEARN_TEXT.mistakesNone}</p> : null}
        </div>
        {mode === "random" ? (
          <Field label={LEARN_TEXT.builderLimit}>
            <select className={inputClass} value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              {[5, 10, 20, 30, 50].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
        <p className="text-xs font-medium text-[var(--faint)]">{LEARN_TEXT.scoringRule}</p>
      </div>
    </Drawer>
  );
}

export function QuizTab({ data, onPlay }: { data: LearnData; onPlay: (play: QuizPlay) => void }) {
  const [starting, setStarting] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const entries = useMemo<QuizEntry[]>(() => {
    const out: QuizEntry[] = [];
    const add = (quizzes: readonly Quiz[], questions: readonly QuizQuestion[], decks: LearnData["decks"], source?: LearningSource) => {
      const byQuiz = new Map<string, QuizQuestion[]>();
      for (const question of questions) byQuiz.set(question.quizId, [...(byQuiz.get(question.quizId) ?? []), question]);
      const owner = source?.owner ? { id: source.owner.id, name: source.owner.name } : undefined;
      const shared = source?.owner?.permission === "edit" ? source : undefined;
      for (const quiz of sortByPosition(quizzes)) {
        out.push({
          quiz,
          questions: byQuiz.get(quiz.id) ?? [],
          ...(owner ? { owner } : {}),
          ...(shared ? { shared } : {}),
          path: quiz.deckId ? deckPath(decks, quiz.deckId).map((deck) => deck.title).join(" › ") : ""
        });
      }
    };
    add(data.quizzes, data.quizQuestions, data.decks);
    for (const source of data.shared) if (source.owner) add(source.bundle.quizzes, source.bundle.quizQuestions, source.bundle.decks, source);
    return out;
  }, [data.quizzes, data.quizQuestions, data.decks, data.shared]);

  const scores = useMemo(() => {
    const out = new Map<string, { last?: number; best?: number }>();
    const done = data.studyRuns.filter((run) => run.kind === "quiz" && run.quizId && run.endedAt && run.score !== undefined).sort((a, b) => (a.endedAt as string).localeCompare(b.endedAt as string));
    for (const run of done) {
      const entry = out.get(run.quizId as string) ?? {};
      entry.last = run.score;
      entry.best = Math.max(entry.best ?? 0, run.score as number);
      out.set(run.quizId as string, entry);
    }
    return out;
  }, [data.studyRuns]);

  const startEntry = entries.find((entry) => entry.quiz.id === starting) ?? null;
  const editEntry = editing && editing !== "new" ? entries.find((entry) => entry.quiz.id === editing && (!entry.owner || entry.shared)) : undefined;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex justify-end">
        <Button variant="primary" icon="Plus" onClick={() => setEditing("new")}>
          {LEARN_TEXT.newQuiz}
        </Button>
      </div>
      {entries.length ? (
        <ul className="grid gap-3 md:grid-cols-2">
          {entries.map((entry) => {
            const score = scores.get(entry.quiz.id);
            return (
              <li key={entry.quiz.id} className="soft-panel flex min-w-0 flex-col gap-2 p-4">
                <div className="flex min-w-0 items-start gap-3">
                  <SubjectMark subjectId={entry.owner ? undefined : entry.quiz.subjectId} fallback="CircleDot" />
                  <div className="min-w-0 flex-1">
                    {entry.owner || entry.path ? <p className="one-line-safe text-xs font-bold text-[var(--faint)]">{entry.owner ? LEARN_TEXT.sharedBy(entry.owner.name) : entry.path}</p> : null}
                    <h3 className="safe-text text-base font-black">{entry.quiz.title}</h3>
                    <p className="text-xs font-bold text-[var(--muted)]">
                      {LEARN_TEXT.questionsCount(entry.questions.length)}
                      {score?.last !== undefined ? ` · ${LEARN_TEXT.lastScore(percent(score.last))}` : ""}
                      {score?.best !== undefined ? ` · ${LEARN_TEXT.bestScore(percent(score.best))}` : ""}
                    </p>
                  </div>
                </div>
                {confirmDelete === entry.quiz.id ? (
                  <ConfirmWithError
                    text={entry.shared && entry.owner ? LEARN_TEXT.deleteSharedConfirm(entry.quiz.title, entry.owner.name) : LEARN_TEXT.deleteQuizConfirm(entry.questions.length)}
                    confirmLabel={LEARN_TEXT.deleteQuiz}
                    icon="Trash2"
                    onCancel={() => setConfirmDelete(null)}
                    onConfirm={async () => {
                      try {
                        if (entry.shared) await deleteSharedQuiz(entry.shared, entry.quiz.id);
                        else await deleteQuiz(entry.quiz.id);
                        setConfirmDelete(null);
                        return null;
                      } catch (failure) {
                        return errorText(failure);
                      }
                    }}
                  />
                ) : null}
                <div className="mt-auto flex flex-wrap gap-2">
                  <Button variant="primary" icon="PlayCircle" disabled={!entry.questions.length} onClick={() => setStarting(entry.quiz.id)}>
                    {LEARN_TEXT.startQuiz}
                  </Button>
                  {entry.owner && !entry.shared ? null : (
                    <>
                      <Button variant="soft" icon="PenLine" onClick={() => setEditing(entry.quiz.id)}>
                        {LEARN_TEXT.editQuiz}
                      </Button>
                      <Button variant="ghost" icon="Trash2" onClick={() => setConfirmDelete(entry.quiz.id)} aria-label={`${LEARN_TEXT.deleteQuiz}: ${entry.quiz.title}`}>
                        {LEARN_TEXT.deleteQuiz}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState icon="CircleDot" title={LEARN_TEXT.quizEmptyTitle} body={LEARN_TEXT.quizEmptyBody} />
      )}
      <StartDrawer
        key={starting ?? "none"}
        entry={startEntry}
        data={data}
        onClose={() => setStarting(null)}
        onPlay={(play) => {
          setStarting(null);
          onPlay(play);
        }}
      />
      <QuizEditor
        open={editing !== null}
        quiz={editEntry?.quiz}
        questions={editEntry?.shared ? editEntry.shared.bundle.quizQuestions : data.quizQuestions}
        decks={editEntry?.shared ? editEntry.shared.bundle.decks : data.decks}
        shared={editEntry?.shared}
        onClose={() => setEditing(null)}
        onCreated={(quiz) => setEditing(quiz.id)}
      />
    </div>
  );
}
