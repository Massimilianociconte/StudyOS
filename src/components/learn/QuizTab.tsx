// Quiz: elenco (tuoi e condivisi) con ultimo e miglior punteggio in evidenza, un solo pulsante
// principale (Inizia, o Riprendi se c'è un tentativo in pausa) e il resto nel menu ⋯. Avvio con la
// modalità scelta, creazione e modifica dei tuoi quiz.
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { deleteQuiz, discardRun } from "../../store/learning";
import { deleteSharedQuiz } from "../../store/sharedLearning";
import { lastMistakes, percent, prepareQuiz } from "../../lib/learnSession";
import { deckPath, sortByPosition } from "../../lib/learningModel";
import { LEARN_TEXT, QUIZ_MODES, QUIZ_MODE_HINT, QUIZ_MODE_LABEL, type QuizMode } from "../../lib/labels/learn";
import { pausedRuns, type ResumePoint } from "../../lib/learnResume";
import type { Quiz, QuizQuestion, StudyRun } from "../../types";
import { ConfirmWithError } from "../ConfirmWithError";
import { Button, Drawer, EmptyState, Field, PageActions, inputClass, type PageAction } from "../ui";
import { Icon } from "../Icon";
import { QuizEditor } from "./QuizEditor";
import type { LearningSource } from "../../agent/learningShared";
import type { QuizPlay } from "./QuizPlayer";
import { errorText, type LearnData } from "./useLearnData";
import { SubjectMark } from "../SubjectMark";
import { FILTER_CHIP, FILTER_CHIP_IDLE, scoreTone } from "./tones";
import { useUiState } from "../../lib/uiState";

const ALL_GROUPS = "all";
import { PausedTags } from "./ResumeTags";

const MODE_ICON: Record<QuizMode, string> = { training: "Target", exam: "Timer", mistakes: "RotateCcw", random: "Zap" };

interface QuizEntry {
  quiz: Quiz;
  questions: QuizQuestion[];
  owner?: { id: string; name: string };
  /** Fonte altrui con «Può modificare»: il quiz si modifica tra i dati di chi lo condivide. */
  shared?: LearningSource;
  path: string;
}

function StartDrawer({
  entry,
  data,
  paused,
  onClose,
  onPlay
}: {
  entry: QuizEntry | null;
  data: LearnData;
  /** Tentativo in pausa di questo quiz: iniziandone uno nuovo si scarta. */
  paused?: { run: StudyRun; point: ResumePoint };
  onClose: () => void;
  onPlay: (play: QuizPlay) => void;
}) {
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
    // Allenamento ed esame: ordine del quiz, risposte mescolate solo nella simulazione e nel casuale.
    const shuffle = mode === "random" || mode === "exam";
    const prepared = prepareQuiz(entry.questions, {
      seed,
      ...(mode === "mistakes" ? { only: mistakes } : {}),
      ...(mode === "random" ? { limit } : {}),
      shuffle
    });
    if (!prepared.length) return;
    if (paused) void discardRun(paused.run.id).catch(() => undefined);
    onPlay({ quiz: entry.quiz, prepared, mode, seed, shuffle, ...(entry.owner ? { owner: entry.owner } : {}) });
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
        {paused ? (
          <p className="safe-text rounded-[14px] bg-[var(--warning-bg)] p-3 text-sm font-bold text-[var(--warning-text)]">{LEARN_TEXT.pausedReplace(paused.point.done, paused.point.total)}</p>
        ) : null}
        {entry.quiz.description ? <p className="learn-read whitespace-pre-line text-sm font-medium text-[var(--muted)]">{entry.quiz.description}</p> : null}
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
        <details className="text-xs font-medium text-[var(--muted)]">
          <summary className="cursor-pointer font-bold">{LEARN_TEXT.scoringTitle}</summary>
          <p className="mt-1 text-[var(--faint)]">{LEARN_TEXT.scoringRule}</p>
        </details>
      </div>
    </Drawer>
  );
}

const groupedContext = (entry: { owner?: { name: string }; path: string }, groupKey: string, groupLabel: string, grouped: boolean) => {
  if (entry.owner) return grouped && groupKey.startsWith("owner:") ? entry.path : LEARN_TEXT.sharedBy(entry.owner.name);
  if (!grouped) return entry.path;
  if (entry.path === groupLabel) return "";
  return entry.path.startsWith(`${groupLabel} › `) ? entry.path.slice(groupLabel.length + 3) : entry.path;
};

export function QuizTab({
  data,
  initialStart,
  onPlay,
  onResume
}: {
  data: LearnData;
  /** Quiz da aprire subito per l'avvio (arrivando dal dettaglio di una raccolta). */
  initialStart?: string | null;
  onPlay: (play: QuizPlay) => void;
  onResume: (run: StudyRun) => void;
}) {
  const [starting, setStarting] = useState<string | null>(initialStart ?? null);
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

  // Tentativo in pausa più recente di ogni quiz.
  const pausedByQuiz = useMemo(() => {
    const out = new Map<string, { run: StudyRun; point: ResumePoint }>();
    for (const entry of pausedRuns(data.studyRuns)) if (entry.run.kind === "quiz" && entry.run.quizId && !out.has(entry.run.quizId)) out.set(entry.run.quizId, entry);
    return out;
  }, [data.studyRuns]);

  // Materie: con quiz di più materie (o condivisi da altre persone) si filtra con i chip e, su
  // «Tutte», i quiz stanno in gruppi con il nome della materia.
  const subjectName = useMemo(() => new Map(data.subjects.map((subject) => [subject.id, subject.name])), [data.subjects]);
  const groupOf = (entry: QuizEntry) =>
    entry.owner
      ? { key: `owner:${entry.owner.id}`, label: LEARN_TEXT.sharedBy(entry.owner.name), subjectId: undefined }
      : { key: entry.quiz.subjectId ?? "none", label: (entry.quiz.subjectId && subjectName.get(entry.quiz.subjectId)) || LEARN_TEXT.quizNoSubject, subjectId: entry.quiz.subjectId };
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; subjectId?: string; entries: QuizEntry[] }>();
    for (const entry of entries) {
      const group = groupOf(entry);
      const current = map.get(group.key) ?? { ...group, entries: [] };
      current.entries.push(entry);
      map.set(group.key, current);
    }
    // Prima le materie, poi «Senza materia», poi i quiz condivisi.
    const rank = (key: string) => (key.startsWith("owner:") ? 2 : key === "none" ? 1 : 0);
    return [...map.values()].sort((a, b) => rank(a.key) - rank(b.key) || a.label.localeCompare(b.label, "it"));
  }, [entries, subjectName]);
  const [groupKey, setGroupKey] = useUiState<string>("learn.quizGroup", ALL_GROUPS);
  const activeGroup = groups.find((group) => group.key === groupKey);
  const visibleGroups = activeGroup ? [activeGroup] : groups;

  const startEntry = entries.find((entry) => entry.quiz.id === starting) ?? null;
  const editEntry = editing && editing !== "new" ? entries.find((entry) => entry.quiz.id === editing && (!entry.owner || entry.shared)) : undefined;

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex justify-end">
        <Button variant="soft" icon="Plus" onClick={() => setEditing("new")}>
          {LEARN_TEXT.newQuiz}
        </Button>
      </div>
      {groups.length > 1 ? (
        <div role="group" aria-label={LEARN_TEXT.doubtsSubjects} className="scrollbar-hidden -mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 py-0.5">
          <button type="button" aria-pressed={!activeGroup} onClick={() => setGroupKey(ALL_GROUPS)} className={`${FILTER_CHIP} ${activeGroup ? FILTER_CHIP_IDLE : ""}`}>
            {LEARN_TEXT.doubtsAll}
            <span className="tabular-nums opacity-70">{entries.length}</span>
          </button>
          {groups.map((group) => (
            <button
              key={group.key}
              type="button"
              aria-pressed={group === activeGroup}
              onClick={() => setGroupKey(group.key)}
              className={`${FILTER_CHIP} max-w-[16rem] ${group === activeGroup ? "" : FILTER_CHIP_IDLE}`}
            >
              {group.subjectId ? <SubjectMark subjectId={group.subjectId} size="sm" /> : null}
              <span className="one-line-safe">{group.label}</span>
              <span className="tabular-nums opacity-70">{group.entries.length}</span>
            </button>
          ))}
        </div>
      ) : null}
      {entries.length ? (
        visibleGroups.map((group) => (
          <section key={group.key} aria-label={group.label} className="grid min-w-0 grid-cols-1 gap-2">
            {groups.length > 1 && !activeGroup ? (
              <h2 className="flex min-w-0 items-center gap-2 px-1 text-sm font-black text-[var(--muted)]">
                <span className="one-line-safe">{group.label}</span>
                <span className="tabular-nums text-[var(--faint)]">{group.entries.length}</span>
              </h2>
            ) : null}
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {group.entries.map((entry) => {
                const score = scores.get(entry.quiz.id);
                const paused = pausedByQuiz.get(entry.quiz.id);
                const editable = !entry.owner || Boolean(entry.shared);
                // Raggruppati per materia: sopra il titolo solo ciò che il gruppo non dice già.
                const context = groupedContext(entry, group.key, group.label, groups.length > 1);
                const more: PageAction[] = [
                  ...(paused ? [{ label: LEARN_TEXT.restartQuiz, icon: "RotateCcw", onClick: () => setStarting(entry.quiz.id) }] : []),
                  ...(editable
                    ? [
                        { label: LEARN_TEXT.editQuiz, icon: "PenLine", onClick: () => setEditing(entry.quiz.id) },
                        { label: LEARN_TEXT.deleteQuiz, icon: "Trash2", danger: true, onClick: () => setConfirmDelete(entry.quiz.id) }
                      ]
                    : [])
                ];
                return (
                  <li key={entry.quiz.id} className="soft-panel flex min-w-0 flex-col gap-3 p-4">
                    <div className="flex min-w-0 items-start gap-3">
                      <SubjectMark subjectId={entry.owner ? undefined : entry.quiz.subjectId} fallback="CircleDot" />
                      <div className="min-w-0 flex-1">
                        {context ? <p className="one-line-safe text-xs font-bold text-[var(--faint)]">{context}</p> : null}
                        <h3 className="learn-read text-base font-black leading-snug">{entry.quiz.title}</h3>
                      </div>
                    </div>
                    {/* Numeri in evidenza: ultimo e miglior punteggio, quante domande. Un quiz vuoto lo dice. */}
                    {!entry.questions.length ? (
                      <p className="text-sm font-semibold text-[var(--muted)]">{editable ? LEARN_TEXT.quizNoQuestionsEdit : LEARN_TEXT.quizNoQuestions}</p>
                    ) : (
                    <dl className="grid grid-cols-3 gap-1.5">
                      <div className="min-w-0 rounded-[14px] bg-[var(--surface-soft)] px-2 py-1.5">
                        <dt className="text-[11px] font-black uppercase text-[var(--faint)]">{LEARN_TEXT.lastLabel}</dt>
                        <dd className={`text-xl font-black tabular-nums ${score?.last !== undefined ? scoreTone(score.last) : "text-[var(--faint)]"}`}>{score?.last !== undefined ? percent(score.last) : "—"}</dd>
                      </div>
                      <div className="min-w-0 rounded-[14px] bg-[var(--surface-soft)] px-2 py-1.5">
                        <dt className="text-[11px] font-black uppercase text-[var(--faint)]">{LEARN_TEXT.bestLabel}</dt>
                        <dd className="text-xl font-black tabular-nums">{score?.best !== undefined ? percent(score.best) : "—"}</dd>
                      </div>
                      <div className="min-w-0 rounded-[14px] bg-[var(--surface-soft)] px-2 py-1.5">
                        <dt className="text-[11px] font-black uppercase text-[var(--faint)]">{LEARN_TEXT.questionsLabel}</dt>
                        <dd className="text-xl font-black tabular-nums">{entry.questions.length}</dd>
                      </div>
                    </dl>
                    )}
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
                    {/* Tentativo in pausa: «Da riprendere», dove e quando, e a che punto. */}
                    {paused ? (
                      <div className="grid min-w-0 grid-cols-1 gap-1.5 rounded-[14px] bg-[var(--warning-bg)] p-2.5">
                        <PausedTags run={paused.run} status when />
                        <span className="flex min-w-0 items-center gap-2">
                          <span
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={paused.point.total}
                            aria-valuenow={paused.point.done}
                            aria-label={LEARN_TEXT.resumeAt(paused.point.done, paused.point.total)}
                            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-strong)]"
                          >
                            <span className="block h-full rounded-full bg-[var(--warning-text)]" style={{ width: `${(paused.point.done / Math.max(1, paused.point.total)) * 100}%` }} />
                          </span>
                          <span className="shrink-0 text-xs font-black tabular-nums text-[var(--warning-text)]">{LEARN_TEXT.resumeAt(paused.point.done, paused.point.total)}</span>
                        </span>
                      </div>
                    ) : null}
                    <div className="mt-auto flex min-w-0 items-center gap-2">
                      <div className="ml-auto">
                        <PageActions
                          label={LEARN_TEXT.quizActions(entry.quiz.title)}
                          primary={
                            paused ? (
                              <Button variant="primary" icon="PlayCircle" onClick={() => onResume(paused.run)}>
                                {LEARN_TEXT.resume}
                              </Button>
                            ) : !entry.questions.length && editable ? (
                              // Quiz senza domande: il passo successivo è aggiungerle, non un «Inizia» spento.
                              <Button variant="primary" icon="Plus" onClick={() => setEditing(entry.quiz.id)}>
                                {LEARN_TEXT.addQuestions}
                              </Button>
                            ) : (
                              <Button variant="primary" icon="PlayCircle" disabled={!entry.questions.length} onClick={() => setStarting(entry.quiz.id)}>
                                {LEARN_TEXT.startQuiz}
                              </Button>
                            )
                          }
                          more={more}
                        />
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      ) : (
        <EmptyState icon="CircleDot" title={LEARN_TEXT.quizEmptyTitle} body={LEARN_TEXT.quizEmptyBody} />
      )}
      <StartDrawer
        key={starting ?? "none"}
        entry={startEntry}
        data={data}
        paused={starting ? pausedByQuiz.get(starting) : undefined}
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
