// Quiz: la stessa forma dei mazzi di flashcard. Per ogni materia un riquadro con una riga per mazzo:
// un mazzo con più quiz (anche nei sotto-mazzi) è un quiz in parti, che si apre sulle parti appese a
// una linea e con ▶ le fa tutte insieme; un mazzo con un quiz solo è quel quiz. Ogni riga dice quante
// domande, ultimo e miglior punteggio; ▶ apre l'avvio con la modalità (o riprende un tentativo in
// pausa). Modifica ed eliminazione dei tuoi quiz stanno nell'avvio, sotto le modalità.
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { deleteQuiz, discardRun } from "../../store/learning";
import { deleteSharedQuiz } from "../../store/sharedLearning";
import { answeredQuestions, lastMistakes, latestMistakes, percent, prepareQuiz } from "../../lib/learnSession";
import { partTitles, quizTree, type QuizNode } from "../../lib/learnGroups";
import { deckPath, sortByPosition } from "../../lib/learningModel";
import { LEARN_TEXT, QUIZ_MODES, QUIZ_MODE_HINT, QUIZ_MODE_LABEL, type QuizMode } from "../../lib/labels/learn";
import { pausedRuns, type ResumePoint } from "../../lib/learnResume";
import type { Quiz, QuizQuestion, StudyDeck, StudyRun } from "../../types";
import { ConfirmWithError } from "../ConfirmWithError";
import { Button, Drawer, EmptyState, Field, IconButton, inputClass } from "../ui";
import { Icon } from "../Icon";
import { QuizEditor } from "./QuizEditor";
import type { LearningSource } from "../../agent/learningShared";
import type { QuizPlay } from "./QuizPlayer";
import { errorText, type LearnData } from "./useLearnData";
import { SubjectMark } from "../SubjectMark";
import { FILTER_CHIP, FILTER_CHIP_IDLE, scoreTone } from "./tones";
import { useUiState } from "../../lib/uiState";
import { PausedTags } from "./ResumeTags";
import { setQuestions, setQuiz, setQuizId, setTimeLimit } from "./learnStarts";

const ALL_GROUPS = "all";

const MODE_ICON: Record<QuizMode, string> = { training: "Target", exam: "Timer", mistakes: "RotateCcw", random: "Zap" };

interface QuizEntry {
  quiz: Quiz;
  questions: QuizQuestion[];
  owner?: { id: string; name: string };
  /** Fonte altrui con «Può modificare»: il quiz si modifica tra i dati di chi lo condivide. */
  shared?: LearningSource;
  path: string;
}

type SetNode = Extract<QuizNode<QuizEntry>, { kind: "set" }>;

interface Paused {
  run: StudyRun;
  point: ResumePoint;
}

/** Cosa si avvia: un quiz, o tutte le parti di un quiz in parti insieme. */
interface StartTarget {
  quiz: Quiz;
  eyebrow?: string;
  /** Domande nell'ordine del quiz (per le parti: una parte dopo l'altra). */
  questions: QuizQuestion[];
  owner?: { id: string; name: string };
  /** Quiz da solo: si modifica ed elimina dall'avvio, se è tuo o condiviso con «Può modificare». */
  entry?: QuizEntry;
  /** Quiz in parti: le parti, ognuna apribile da sola. */
  parts?: { id: string; title: string; questions: number; best?: number }[];
}

function StartDrawer({
  target,
  data,
  paused,
  onClose,
  onPlay,
  onResume,
  onEdit,
  onOpenPart
}: {
  target: StartTarget | null;
  data: LearnData;
  /** Tentativo in pausa di questo quiz: iniziandone uno nuovo si scarta. */
  paused?: Paused;
  onClose: () => void;
  onPlay: (play: QuizPlay) => void;
  onResume: (run: StudyRun) => void;
  onEdit: (quizId: string) => void;
  onOpenPart: (quizId: string) => void;
}) {
  const [mode, setMode] = useState<QuizMode>("training");
  const [limit, setLimit] = useState(20);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  // Errori: di un quiz, quelli del suo ultimo tentativo; delle parti insieme, l'ultima risposta a ogni
  // domanda, data facendo la parte da sola o tutte le parti.
  const mistakes = useMemo(
    () => (!target ? new Set<string>() : target.parts ? latestMistakes(data.studyRuns, target.questions.map((question) => question.id)) : lastMistakes(data.studyRuns, target.quiz.id)),
    [target, data.studyRuns]
  );
  if (!target) return <Drawer open={false} onClose={onClose} title="" />;
  const { entry, parts } = target;
  const editable = entry ? !entry.owner || Boolean(entry.shared) : false;
  const available = mode === "mistakes" ? target.questions.filter((question) => mistakes.has(question.id)).length : target.questions.length;
  const start = () => {
    const seed = Date.now() % 100_000;
    // Allenamento ed esame: ordine del quiz, risposte mescolate solo nella simulazione e nel casuale.
    const shuffle = mode === "random" || mode === "exam";
    const prepared = prepareQuiz(target.questions, {
      seed,
      ...(mode === "mistakes" ? { only: mistakes } : {}),
      ...(mode === "random" ? { limit } : {}),
      shuffle
    });
    if (!prepared.length) return;
    if (paused) void discardRun(paused.run.id).catch(() => undefined);
    onPlay({ quiz: target.quiz, prepared, mode, seed, shuffle, ...(target.owner ? { owner: target.owner } : {}) });
  };
  return (
    <Drawer
      open
      onClose={onClose}
      eyebrow={target.eyebrow}
      title={target.quiz.title}
      footer={
        <div className="flex items-center justify-end gap-2">
          <span className="mr-auto text-sm font-bold text-[var(--muted)]">{LEARN_TEXT.questionsCount(mode === "random" ? Math.min(limit, available) : available)}</span>
          <Button onClick={onClose}>{LEARN_TEXT.cancel}</Button>
          <Button variant="primary" icon="PlayCircle" disabled={!available} onClick={start}>
            {parts ? LEARN_TEXT.startSet : LEARN_TEXT.startQuiz}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        {paused ? (
          // In pausa: si riprende da qui, oppure «Inizia» ne comincia uno nuovo (e scarta questo).
          <div className="grid min-w-0 grid-cols-1 gap-2 rounded-[14px] bg-[var(--warning-bg)] p-3">
            <PausedTags run={paused.run} status when />
            <p className="safe-text text-sm font-bold text-[var(--warning-text)]">{LEARN_TEXT.pausedReplace(paused.point.done, paused.point.total)}</p>
            <div>
              <Button variant="soft" icon="PlayCircle" onClick={() => onResume(paused.run)}>
                {LEARN_TEXT.resume}
              </Button>
            </div>
          </div>
        ) : null}
        {parts ? <p className="safe-text text-sm font-medium text-[var(--muted)]">{LEARN_TEXT.setIntro(parts.length, target.questions.length)}</p> : null}
        {target.quiz.description ? <p className="learn-read whitespace-pre-line text-sm font-medium text-[var(--muted)]">{target.quiz.description}</p> : null}
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
                <span className="safe-text text-xs font-medium leading-snug text-[var(--muted)]">{parts && id === "random" ? LEARN_TEXT.setModeRandomHint : QUIZ_MODE_HINT[id]}</span>
              </button>
            ))}
          </div>
          {mode === "exam" && target.quiz.timeLimitMinutes ? <p className="mt-1 text-sm font-bold">{LEARN_TEXT.quizTimeLimit(target.quiz.timeLimitMinutes)}</p> : null}
          {mode === "mistakes" && !available ? <p className="mt-1 text-sm font-bold">{parts ? LEARN_TEXT.setMistakesNone : LEARN_TEXT.mistakesNone}</p> : null}
        </div>
        {mode === "random" ? (
          <Field label={LEARN_TEXT.builderLimit}>
            <select className={inputClass} value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
              {[5, 10, 20, 30, 50, 100].map((value) => (
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
        {/* Le parti: ognuna si apre da sola, con il suo avvio. */}
        {parts ? (
          <section className="min-w-0">
            <h3 className="mb-1 text-xs font-black uppercase text-[var(--faint)]">
              {LEARN_TEXT.setPartsTitle} · {parts.length}
            </h3>
            <ol className="grid grid-cols-1 gap-0.5">
              {parts.map((part, index) => (
                <li key={part.id}>
                  <button
                    type="button"
                    aria-label={LEARN_TEXT.openQuizNamed(part.title)}
                    onClick={() => onOpenPart(part.id)}
                    className="motion-safe flex w-full min-w-0 items-center gap-3 rounded-[16px] px-3 py-2 text-left hover:bg-[var(--surface-soft)]"
                  >
                    <span className="w-6 shrink-0 text-right text-xs font-black tabular-nums text-[var(--faint)]">{index + 1}</span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-bold leading-snug">{part.title}</span>
                      <span className="block text-xs font-bold text-[var(--muted)]">
                        {part.questions ? LEARN_TEXT.questionsCount(part.questions) : LEARN_TEXT.quizNoQuestionsShort}
                        {part.best !== undefined ? (
                          <>
                            {" · "}
                            <span className={scoreTone(part.best)}>{LEARN_TEXT.scoreBest(percent(part.best))}</span>
                          </>
                        ) : null}
                      </span>
                    </span>
                    <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                  </button>
                </li>
              ))}
            </ol>
          </section>
        ) : null}
        {/* Tuoi quiz (o condivisi con «Può modificare»): modifica ed eliminazione, lontano da «Inizia». */}
        {entry && editable ? (
          <section aria-label={LEARN_TEXT.manageQuiz} className="grid min-w-0 grid-cols-1 gap-2 border-t border-[var(--border)] pt-3">
            {confirmDelete ? (
              <ConfirmWithError
                text={entry.shared && entry.owner ? LEARN_TEXT.deleteSharedConfirm(entry.quiz.title, entry.owner.name) : LEARN_TEXT.deleteQuizConfirm(entry.questions.length)}
                confirmLabel={LEARN_TEXT.deleteQuiz}
                icon="Trash2"
                onCancel={() => setConfirmDelete(false)}
                onConfirm={async () => {
                  try {
                    if (entry.shared) await deleteSharedQuiz(entry.shared, entry.quiz.id);
                    else await deleteQuiz(entry.quiz.id);
                    onClose();
                    return null;
                  } catch (failure) {
                    return errorText(failure);
                  }
                }}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="ghost" icon="PenLine" onClick={() => onEdit(entry.quiz.id)}>
                  {LEARN_TEXT.editQuiz}
                </Button>
                <Button variant="ghost" icon="Trash2" className="!text-[var(--danger-text)]" onClick={() => setConfirmDelete(true)}>
                  {LEARN_TEXT.deleteQuiz}
                </Button>
              </div>
            )}
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}

export function QuizTab({
  data,
  initialStart,
  onPlay,
  onResume
}: {
  data: LearnData;
  /** Quiz da aprire subito per l'avvio (arrivando dal dettaglio di un mazzo). */
  initialStart?: string | null;
  onPlay: (play: QuizPlay) => void;
  onResume: (run: StudyRun) => void;
}) {
  const [starting, setStarting] = useState<string | null>(initialStart ?? null);
  const [editing, setEditing] = useState<string | "new" | null>(null);

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

  // Ultimo e miglior punteggio per quiz (e per «set:…», le parti fatte tutte insieme).
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

  // Una parte è fatta se ha un suo punteggio o se ogni sua domanda ha avuto risposta in un tentativo
  // concluso (anche facendo tutte le parti insieme).
  const answered = useMemo(() => answeredQuestions(data.studyRuns), [data.studyRuns]);
  const isDone = (entry: QuizEntry) =>
    scores.get(entry.quiz.id)?.best !== undefined || (entry.questions.length > 0 && entry.questions.every((question) => answered.has(question.id)));

  // Tentativo in pausa più recente di ogni quiz.
  const pausedByQuiz = useMemo(() => {
    const out = new Map<string, Paused>();
    for (const entry of pausedRuns(data.studyRuns)) if (entry.run.kind === "quiz" && entry.run.quizId && !out.has(entry.run.quizId)) out.set(entry.run.quizId, entry);
    return out;
  }, [data.studyRuns]);

  // Materie: con quiz di più materie (o condivisi da altre persone) si filtra con i chip; ogni materia
  // ha il suo riquadro, come i mazzi di flashcard.
  const subjectName = useMemo(() => new Map(data.subjects.map((subject) => [subject.id, subject.name])), [data.subjects]);
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; subjectId?: string; owned: boolean; entries: QuizEntry[] }>();
    for (const entry of entries) {
      const group = entry.owner
        ? { key: `owner:${entry.owner.id}`, label: LEARN_TEXT.sharedDecksBy(entry.owner.name), owned: false }
        : entry.quiz.subjectId && subjectName.get(entry.quiz.subjectId)
          ? { key: entry.quiz.subjectId, label: subjectName.get(entry.quiz.subjectId) as string, subjectId: entry.quiz.subjectId, owned: true }
          : { key: "none", label: LEARN_TEXT.quizNoSubject, owned: true };
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

  // Mazzi tuoi e condivisi: danno la forma (mazzo → quiz in parti) e i titoli.
  const allDecks = useMemo<StudyDeck[]>(() => [...data.decks, ...data.shared.flatMap((source) => source.bundle.decks)], [data.decks, data.shared]);
  const trees = useMemo(
    () => new Map(groups.map((group) => [group.key, quizTree(group.entries, (entry) => ({ id: entry.quiz.id, title: entry.quiz.title, deckId: entry.quiz.deckId }), allDecks)])),
    [groups, allDecks]
  );
  // Ogni quiz in parti con la sua materia e i titoli delle parti come si leggono nell'elenco
  // (una parte di un quiz in parti più interno porta anche il suo nome: «Capitolo 1 › Parte 2»).
  const sets = useMemo(() => {
    const out = new Map<string, { node: SetNode; groupKey: string; subjectId?: string; titles: Map<string, string> }>();
    const partTitles = (node: SetNode, prefix: string, titles: Map<string, string>) => {
      for (const child of node.children) {
        if (child.kind === "quiz") titles.set(child.item.quiz.id, prefix + child.title);
        else partTitles(child, `${prefix}${child.title} › `, titles);
      }
    };
    const walk = (nodes: readonly QuizNode<QuizEntry>[], group: (typeof groups)[number]) => {
      for (const node of nodes) {
        if (node.kind !== "set") continue;
        const titles = new Map<string, string>();
        partTitles(node, "", titles);
        out.set(setQuizId(node.key), { node, groupKey: group.key, ...(group.subjectId ? { subjectId: group.subjectId } : {}), titles });
        walk(node.children, group);
      }
    };
    for (const group of groups) walk(trees.get(group.key) ?? [], group);
    return out;
  }, [groups, trees]);

  // Aperti di partenza: solo i quiz in parti con una parte in pausa, così la si vede subito.
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    const open = new Set<string>();
    for (const { node } of sets.values()) if (node.items.some((entry) => pausedByQuiz.has(entry.quiz.id))) open.add(node.key);
    return open;
  });
  const toggle = (key: string) =>
    setExpanded((value) => {
      const next = new Set(value);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const target = useMemo<StartTarget | null>(() => {
    if (!starting) return null;
    const entry = entries.find((item) => item.quiz.id === starting);
    if (entry)
      return {
        quiz: entry.quiz,
        eyebrow: entry.owner ? LEARN_TEXT.sharedDeckBy(entry.owner.name) : entry.path || undefined,
        questions: entry.questions,
        ...(entry.owner ? { owner: entry.owner } : {}),
        entry
      };
    const found = sets.get(starting);
    if (!found) return null;
    const { node, subjectId, titles } = found;
    const owner = node.items[0]?.owner;
    const withQuestions = node.items.filter((item) => item.questions.length);
    const minutes = setTimeLimit(withQuestions.map((item) => item.quiz));
    const where = node.deckId ? deckPath(allDecks, node.deckId).slice(0, -1).map((deck) => deck.title).join(" › ") : "";
    return {
      quiz: setQuiz(node.key, node.title, { ...(subjectId ? { subjectId } : {}), ...(minutes ? { timeLimitMinutes: minutes } : {}) }),
      eyebrow: owner ? LEARN_TEXT.sharedDeckBy(owner.name) : where || (subjectId ? subjectName.get(subjectId) : undefined),
      questions: setQuestions(node.items.map((item) => item.questions)),
      ...(owner ? { owner } : {}),
      parts: node.items.map((item) => ({
        id: item.quiz.id,
        title: titles.get(item.quiz.id) ?? item.quiz.title,
        questions: item.questions.length,
        ...(scores.get(item.quiz.id)?.best !== undefined ? { best: scores.get(item.quiz.id)?.best } : {})
      }))
    };
  }, [starting, entries, sets, allDecks, subjectName, scores]);
  const editEntry = editing && editing !== "new" ? entries.find((entry) => entry.quiz.id === editing && (!entry.owner || entry.shared)) : undefined;

  // ─── Righe ───────────────────────────────────────────────────────────────────────────

  // Numeri sotto il titolo, ognuno con il suo nome; i punteggi con il colore del risultato.
  const scoreText = (label: (score: string) => string, value: number | undefined) =>
    value === undefined ? null : (
      <>
        {" · "}
        <span className={`whitespace-nowrap ${scoreTone(value)}`}>{label(percent(value))}</span>
      </>
    );

  // `indent`: la riga ha lo spazio della freccia (o la freccia), le etichette si allineano al titolo.
  const pausedLine = (paused: Paused | undefined, indent = true) =>
    paused ? (
      <div className={`flex min-w-0 flex-wrap items-center gap-2 pb-1.5 pr-1 ${indent ? "pl-10" : "pl-1"}`}>
        <PausedTags run={paused.run} status />
        <span className="text-xs font-black tabular-nums text-[var(--warning-text)]">{LEARN_TEXT.resumeAt(paused.point.done, paused.point.total)}</span>
      </div>
    ) : null;

  // Un quiz: titolo (accorciato tra le parti), domande e punteggi; ▶ apre l'avvio o riprende.
  // `indent`: lo spazio della freccia, solo se una riga accanto ce l'ha (sul telefono sono 36 px di titolo).
  const quizRow = (entry: QuizEntry, title: string, depth: number, indent: boolean) => {
    const score = scores.get(entry.quiz.id);
    const paused = pausedByQuiz.get(entry.quiz.id);
    const editable = !entry.owner || Boolean(entry.shared);
    const root = depth === 0;
    // Riga principale: sopra il titolo il mazzo da cui viene (come nei mazzi di flashcard) e, nel
    // titolo, solo ciò che il nome del mazzo non dice già («… · Ripasso semplice» → «Quiz semplici»).
    const context = root && entry.path && entry.path !== entry.quiz.title ? entry.path : "";
    if (context) title = partTitles([context, title])[1];
    return (
      <li key={entry.quiz.id} className="min-w-0">
        <div className="flex min-w-0 items-center gap-1 rounded-[16px] py-0.5 pr-1 hover:bg-[var(--surface-soft)]">
          {indent ? <span className="w-9 shrink-0" aria-hidden="true" /> : null}
          <button type="button" onClick={() => setStarting(entry.quiz.id)} className="motion-safe min-w-0 flex-1 rounded-[14px] px-1 py-1.5 text-left">
            {context ? <span className="one-line-safe block text-xs font-bold text-[var(--faint)]">{context}</span> : null}
            <span className={`learn-read line-clamp-2 leading-snug ${root ? "text-[15px] font-black" : "text-sm font-bold"}`}>{title}</span>
            <span className="block text-xs font-bold text-[var(--muted)]">
              {entry.questions.length ? LEARN_TEXT.questionsCount(entry.questions.length) : LEARN_TEXT.quizNoQuestionsShort}
              {scoreText(LEARN_TEXT.scoreLast, score?.last)}
              {scoreText(LEARN_TEXT.scoreBest, score?.best)}
            </span>
          </button>
          {paused ? (
            <IconButton icon="PlayCircle" label={LEARN_TEXT.resumeQuizNamed(title)} onClick={() => onResume(paused.run)} />
          ) : entry.questions.length ? (
            <IconButton icon="PlayCircle" label={LEARN_TEXT.startQuizNamed(title)} onClick={() => setStarting(entry.quiz.id)} />
          ) : editable ? (
            // Quiz senza domande: il passo successivo è aggiungerle, non un ▶ spento.
            <IconButton icon="Plus" label={`${LEARN_TEXT.addQuestions}: ${title}`} onClick={() => setEditing(entry.quiz.id)} />
          ) : null}
        </div>
        {pausedLine(paused, indent)}
      </li>
    );
  };

  // Un quiz in parti: toccandolo si apre sulle parti; ▶ le fa tutte insieme.
  const setRow = (node: SetNode, depth: number) => {
    const id = setQuizId(node.key);
    const open = expanded.has(node.key);
    const score = scores.get(id);
    const paused = pausedByQuiz.get(id);
    const questions = node.items.reduce((sum, entry) => sum + entry.questions.length, 0);
    const done = node.items.filter(isDone).length;
    const pausedInside = node.items.filter((entry) => pausedByQuiz.has(entry.quiz.id)).length;
    const root = depth === 0;
    return (
      <li key={node.key} className="min-w-0">
        <div className="flex min-w-0 items-center gap-1 rounded-[16px] py-0.5 pr-1 hover:bg-[var(--surface-soft)]">
          <button
            type="button"
            onClick={() => toggle(node.key)}
            aria-expanded={open}
            title={open ? LEARN_TEXT.collapse(node.title) : LEARN_TEXT.expand(node.title)}
            className="motion-safe flex min-w-0 flex-1 items-center gap-1 rounded-[14px] text-left"
          >
            <span className="grid h-9 w-9 shrink-0 grid-cols-1 place-items-center text-[var(--muted)]">
              <Icon name="ChevronRight" className={`motion-safe h-4 w-4 ${open ? "rotate-90" : ""}`} />
            </span>
            <span className="min-w-0 flex-1 px-1 py-1.5">
              <span className={`learn-read line-clamp-2 leading-snug ${root ? "text-[15px] font-black" : "text-sm font-bold"}`}>{node.title}</span>
              <span className="block text-xs font-bold text-[var(--muted)]">
                {LEARN_TEXT.quizParts(node.items.length)} · {LEARN_TEXT.questionsCount(questions)}
                {done ? ` · ${LEARN_TEXT.partsDone(done, node.items.length)}` : ""}
                {scoreText(LEARN_TEXT.scoreBest, score?.best)}
                {pausedInside && !open ? (
                  <>
                    {" · "}
                    <span className="text-[var(--warning-text)]">{LEARN_TEXT.partsPaused(pausedInside)}</span>
                  </>
                ) : null}
              </span>
            </span>
          </button>
          {paused ? (
            <IconButton icon="PlayCircle" label={LEARN_TEXT.resumeQuizNamed(node.title)} onClick={() => onResume(paused.run)} />
          ) : questions ? (
            <IconButton icon="PlayCircle" label={LEARN_TEXT.startSetNamed(node.title)} onClick={() => setStarting(id)} />
          ) : null}
        </div>
        {pausedLine(paused)}
        {/* Le parti appese a una linea verticale che scende dalla freccia, come i sotto-mazzi. */}
        {open ? (
          <ul aria-label={`${LEARN_TEXT.setPartsTitle}: ${node.title}`} className="mb-1 ml-[1.1rem] border-l-2 border-[var(--border)] pl-1">
            {node.children.map((child) => nodeRow(child, depth + 1, hasSet(node.children)))}
          </ul>
        ) : null}
      </li>
    );
  };

  const hasSet = (nodes: readonly QuizNode<QuizEntry>[]) => nodes.some((node) => node.kind === "set");
  const nodeRow = (node: QuizNode<QuizEntry>, depth: number, indent: boolean) => (node.kind === "quiz" ? quizRow(node.item, node.title, depth, indent) : setRow(node, depth));

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
            {/* Primo livello: la materia, con il suo segno e quanto contiene (come i mazzi di flashcard). */}
            <h2 className="flex min-w-0 items-center gap-2.5 px-1">
              <SubjectMark subjectId={group.subjectId} fallback={group.owned ? "CircleDot" : "Share2"} />
              <span className="min-w-0">
                <span className="one-line-safe block text-base font-black leading-tight">{group.label}</span>
                <span className="block text-xs font-bold text-[var(--muted)]">
                  {LEARN_TEXT.quizzesCount(group.entries.length)} · {LEARN_TEXT.questionsCount(group.entries.reduce((sum, entry) => sum + entry.questions.length, 0))}
                </span>
              </span>
            </h2>
            <div className="soft-panel min-w-0 p-1.5 sm:p-2">
              {/* Un blocco per mazzo, separati da una linea: ognuno con le sue parti. */}
              <ul className="grid grid-cols-1 divide-y divide-[var(--border)]">
                {(trees.get(group.key) ?? []).map((node, _index, nodes) => nodeRow(node, 0, hasSet(nodes)))}
              </ul>
            </div>
          </section>
        ))
      ) : (
        <EmptyState icon="CircleDot" title={LEARN_TEXT.quizEmptyTitle} body={LEARN_TEXT.quizEmptyBody} />
      )}
      <StartDrawer
        key={starting ?? "none"}
        target={target}
        data={data}
        paused={starting ? pausedByQuiz.get(starting) : undefined}
        onClose={() => setStarting(null)}
        onPlay={(play) => {
          setStarting(null);
          onPlay(play);
        }}
        onResume={(run) => {
          setStarting(null);
          onResume(run);
        }}
        onEdit={(quizId) => {
          setStarting(null);
          setEditing(quizId);
        }}
        onOpenPart={(quizId) => setStarting(quizId)}
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
