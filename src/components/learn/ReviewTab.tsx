// Oggi: il numero grande delle flashcard di oggi con la barra che dice di cosa è fatto, da quali
// materie vengono quelle del pulsante e un solo pulsante per partire; poi cosa riprendere (sessioni e
// quiz in pausa, anche iniziati su un altro dispositivo). Sotto, i mazzi con qualcosa da fare divisi
// per materia (materia → mazzo → sotto-mazzo, ciascuno si avvia con un tocco) e le ultime sessioni,
// con una barra dei risultati al posto delle parole. «Personalizza» apre le scelte complete.
import { useMemo, useState } from "react";
import { format, isToday, isTomorrow, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { buildDeckTree, filterCounts, flattenTree, nextDueDay, percent } from "../../lib/learnSession";
import { groupDeckNodes, pruneToTodo, type DeckGroup } from "../../lib/learnGroups";
import { pausedRuns, type ResumePoint } from "../../lib/learnResume";
import { LEARN_TEXT } from "../../lib/labels/learn";
import { discardRun } from "../../store/learning";
import type { ReviewResult, StudyRun } from "../../types";
import { InlineConfirm } from "../InlineConfirm";
import { Button, EmptyState, Panel } from "../ui";
import { Icon } from "../Icon";
import { SubjectMark } from "../SubjectMark";
import { deckPath, deckSubjectId } from "../../lib/learningModel";
import { limitOf, sessionSpec, type SessionOptions } from "./SessionBuilder";
import { PausedTags, ResumedTag } from "./ResumeTags";
import { scoreTone } from "./tones";
import { unionOf, type LearnData } from "./useLearnData";

/** Righe di mazzi per materia prima di «Mostra altri». */
const DECK_ROWS = 8;
const PAUSED_ROWS = 4;

const dayText = (day: Date) => (isToday(day) ? "oggi" : isTomorrow(day) ? "domani" : `il ${format(day, "d MMMM", { locale: it })}`);

const RESULT_BAR: Record<ReviewResult, string> = {
  correct: "bg-[var(--success-text)]",
  doubt: "bg-[var(--warning-text)]",
  wrong: "bg-[var(--danger-text)]",
  skip: "bg-[var(--faint)]"
};

/** Barra orizzontale a segmenti (somma dei valori = 100%). */
function StackBar({ parts, className = "" }: { parts: { value: number; tone: string }[]; className?: string }) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (!total) return null;
  return (
    <span aria-hidden="true" className={`flex overflow-hidden rounded-full bg-[var(--surface-strong)] ${className}`}>
      {parts.map((part, position) => (part.value ? <span key={position} className={`h-full ${part.tone}`} style={{ width: `${(part.value / total) * 100}%` }} /> : null))}
    </span>
  );
}

function Legend({ tone, value, label }: { tone: string; value: number; label: string }) {
  if (!value) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-bold text-[var(--muted)]">
      <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone}`} />
      <span className="font-black tabular-nums text-[var(--text)]">{value}</span>
      {label}
    </span>
  );
}

/** «1 da ripassare · 19 mai studiate»: il numero con il suo nome, mai un numero da solo. */
function TodoLine({ due, fresh, className = "" }: { due: number; fresh: number; className?: string }) {
  return (
    <span className={`block text-xs font-bold text-[var(--muted)] ${className}`}>
      {due ? <span className="text-[var(--accent-ink)]">{LEARN_TEXT.dueCount(due)}</span> : null}
      {due && fresh ? " · " : null}
      {fresh ? LEARN_TEXT.newCount(fresh) : null}
    </span>
  );
}

/**
 * Una materia con i suoi mazzi da fare oggi. La materia è il primo livello (segno, nome, quanto c'è
 * da fare e «Ripassa» per tutta la materia); i mazzi stanno dentro il suo riquadro e i sotto-mazzi
 * sotto il loro mazzo, attaccati a una linea, più piccoli e in un colore più tenue.
 */
function SubjectTodo({
  group,
  pausedDecks,
  onStartDecks,
  onResume
}: {
  group: DeckGroup;
  pausedDecks: ReadonlyMap<string, { run: StudyRun; point: ResumePoint }>;
  onStartDecks: (deckIds: string[], title?: string) => void;
  onResume: (run: StudyRun) => void;
}) {
  const [all, setAll] = useState(false);
  // Un solo mazzo con il nome della materia («Biochimica» in Biochimica): la materia lo dice già,
  // si mostrano direttamente i suoi sotto-mazzi (il «Ripassa» della materia ripassa tutto il mazzo).
  const only = group.nodes.length === 1 ? group.nodes[0] : null;
  const same = Boolean(only && only.children.length && only.deck.title.trim().toLocaleLowerCase("it") === group.label.trim().toLocaleLowerCase("it"));
  const rows = same && only ? flattenTree(only.children).map((node) => ({ ...node, depth: node.depth - 1 })) : flattenTree(group.nodes);
  const shown = all ? rows : rows.slice(0, DECK_ROWS);
  return (
    <section aria-label={group.label} className="min-w-0 rounded-[20px] bg-[var(--surface-soft)] p-2 sm:p-2.5">
      <div className="flex min-w-0 items-center gap-3 p-1">
        <SubjectMark subjectId={group.subjectId} fallback={group.ownerId ? "Share2" : "Layers"} />
        <div className="min-w-0 flex-1">
          <h4 className="line-clamp-2 text-base font-black leading-tight">{group.label}</h4>
          <TodoLine due={group.due} fresh={group.fresh} className="mt-0.5" />
        </div>
        {/* Sotto i 420px solo l'icona: il nome della materia ha la precedenza (prima si troncava a «Anato…»). */}
        <Button
          variant="soft"
          icon="PlayCircle"
          className="shrink-0 px-3.5 max-[419px]:w-11 max-[419px]:gap-0 max-[419px]:px-0"
          aria-label={LEARN_TEXT.studySubject(group.label)}
          onClick={() => onStartDecks(group.nodes.map((node) => node.deck.id), group.label)}
        >
          <span className="max-[419px]:sr-only">{LEARN_TEXT.studyDeck}</span>
        </Button>
      </div>
      <ul className="mt-1 grid grid-cols-1">
        {shown.map(({ deck, depth, counts: deckCounts }) => {
          const paused = pausedDecks.get(deck.id);
          const action = paused ? LEARN_TEXT.resumeDeck(deck.title) : LEARN_TEXT.studyNow(deck.title);
          return (
            // Sotto-mazzi: rientrati e appesi a una linea verticale che parte dal mazzo sopra.
            <li key={deck.id} className={`min-w-0 ${depth ? "border-l-2 border-[var(--border)]" : ""}`} style={depth ? { marginLeft: `${0.75 + (Math.min(depth, 4) - 1) * 0.875}rem` } : undefined}>
              <button
                type="button"
                title={action}
                aria-label={paused ? `${action}: ${LEARN_TEXT.resumeAt(paused.point.done, paused.point.total)}` : `${action}: ${LEARN_TEXT.deckTodo(deckCounts.due, deckCounts.fresh)}`}
                onClick={() => (paused ? onResume(paused.run) : onStartDecks([deck.id]))}
                className={`motion-safe group flex min-h-12 w-full min-w-0 flex-col items-stretch justify-center gap-1.5 rounded-[14px] py-2 pr-2 text-left hover:bg-[var(--surface)] ${depth ? "pl-2.5" : "pl-2"}`}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="min-w-0 flex-1">
                    <span className={`line-clamp-2 leading-snug ${depth ? "text-[13px] font-bold text-[var(--muted)]" : "text-sm font-black"}`}>{deck.title}</span>
                    {paused ? (
                      <span className="block text-xs font-black tabular-nums text-[var(--warning-text)]">{LEARN_TEXT.resumeAt(paused.point.done, paused.point.total)}</span>
                    ) : (
                      <TodoLine due={deckCounts.due} fresh={deckCounts.fresh} />
                    )}
                  </span>
                  <Icon name="PlayCircle" className="motion-safe h-5 w-5 shrink-0 text-[var(--faint)] group-hover:text-[var(--accent-ink)]" />
                </span>
                {/* Sessione in pausa: etichette su una riga loro, a tutta larghezza (sui telefoni stretti non si troncano). */}
                {paused ? <PausedTags run={paused.run} status /> : null}
              </button>
            </li>
          );
        })}
      </ul>
      {rows.length > shown.length ? (
        <button type="button" onClick={() => setAll(true)} className="motion-safe mt-1 rounded-full px-3 py-1.5 text-xs font-extrabold text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]">
          {LEARN_TEXT.showMoreDecks(rows.length - shown.length)}
        </button>
      ) : null}
    </section>
  );
}

// Una sola azione principale per schermata: con schede da ripassare oggi il pulsante giallo è
// «Ripassa N schede» e qui «Riprendi» è secondario; senza, il primo «Riprendi» diventa principale.
function PausedList({ data, onResume, lead }: { data: LearnData; onResume: (run: StudyRun) => void; lead: boolean }) {
  const [discarding, setDiscarding] = useState<string | null>(null);
  const paused = useMemo(() => pausedRuns(data.studyRuns).slice(0, PAUSED_ROWS), [data.studyRuns]);
  if (!paused.length) return null;
  return (
    <Panel className="border-[color-mix(in_srgb,var(--warning-text)_35%,var(--border))]">
      <h3 className="mb-2 flex items-center gap-2 text-lg font-black">
        <Icon name="Pause" className="h-4 w-4 text-[var(--warning-text)]" />
        {LEARN_TEXT.resumeTitle}
      </h3>
      <ul className="grid grid-cols-1 gap-2">
        {paused.map(({ run, point }, position) => {
          const quiz = run.kind === "quiz";
          return (
            <li key={run.id} className="min-w-0 rounded-[18px] bg-[var(--surface-soft)] p-3">
              <div className="flex min-w-0 items-center gap-3">
                {/* Sotto i 380px l'icona lascia il posto al titolo (con «Riprendi» accanto si spezzava a metà parola). */}
                <span className="grid h-10 w-10 shrink-0 grid-cols-1 place-items-center rounded-full bg-[var(--surface-strong)] text-[var(--accent-ink)] max-[379px]:hidden">
                  <Icon name={quiz ? "CircleDot" : "Layers"} className="h-4.5 w-4.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="learn-read line-clamp-2 text-sm font-black leading-snug">{run.title || LEARN_TEXT.sessionTitle}</span>
                  <span className="one-line-safe block text-xs font-bold text-[var(--muted)]">{quiz ? LEARN_TEXT.resumeQuiz : LEARN_TEXT.resumeFlashcards}</span>
                </span>
                <Button variant={lead && position === 0 ? "primary" : "soft"} icon="PlayCircle" className="shrink-0 px-3.5" onClick={() => onResume(run)}>
                  {LEARN_TEXT.resume}
                </Button>
              </div>
              {/* Dove e quando è stata interrotta: «Da iPhone · Safari», «Interrotta ieri alle 18:30». */}
              <PausedTags run={run} when className="mt-2" />
              <div className="mt-2.5 flex items-center gap-2">
                <span
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={point.total}
                  aria-valuenow={point.done}
                  aria-label={LEARN_TEXT.resumeAt(point.done, point.total)}
                  className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surface-strong)]"
                >
                  <span className="block h-full rounded-full bg-[var(--warning-text)]" style={{ width: `${(point.done / Math.max(1, point.total)) * 100}%` }} />
                </span>
                <span className="shrink-0 text-xs font-black tabular-nums text-[var(--muted)]">{LEARN_TEXT.resumeAt(point.done, point.total)}</span>
                <button
                  type="button"
                  onClick={() => setDiscarding(run.id)}
                  className="motion-safe shrink-0 rounded-full px-2 py-1 text-xs font-extrabold text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--text)]"
                >
                  {LEARN_TEXT.discard}
                </button>
              </div>
              {discarding === run.id ? (
                <div className="mt-2">
                  <InlineConfirm
                    text={quiz ? LEARN_TEXT.discardQuizConfirm : LEARN_TEXT.discardConfirm}
                    confirmLabel={LEARN_TEXT.discard}
                    icon="Trash2"
                    onCancel={() => setDiscarding(null)}
                    onConfirm={() => {
                      setDiscarding(null);
                      void discardRun(run.id).catch(() => undefined);
                    }}
                  />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

export function ReviewTab({
  data,
  today,
  size,
  onStart,
  onCustomize,
  onResume,
  pausedDecks
}: {
  data: LearnData;
  today: string;
  size: number;
  /** Sessioni in pausa su un solo mazzo: la riga del mazzo le riprende. */
  pausedDecks: ReadonlyMap<string, { run: StudyRun; point: ResumePoint }>;
  onStart: (options: SessionOptions) => void;
  onCustomize: (deckIds: string[]) => void;
  onResume: (run: StudyRun) => void;
}) {
  const union = useMemo(() => unionOf(data), [data.own, data.shared]);
  const now = useMemo(() => new Date(), [today, data.cardStates]);
  const counts = useMemo(() => filterCounts(union.cards, data.states, now), [union, data.states, now]);
  const upcoming = useMemo(() => (counts.today ? null : nextDueDay(union.cards.map((card) => card.id), data.states, now)), [counts.today, union, data.states, now]);
  const subjectName = useMemo(() => new Map(data.subjects.map((subject) => [subject.id, subject.name])), [data.subjects]);

  // Mazzi con qualcosa da fare oggi, divisi per materia (i condivisi per chi li condivide).
  const groups = useMemo(
    () =>
      groupDeckNodes(pruneToTodo(buildDeckTree(union.decks, union.cards, data.states, [], now)), {
        subjectName: (id) => subjectName.get(id),
        ownerOf: (id) => union.ownerOfDeck.get(id),
        noSubject: LEARN_TEXT.noSubject,
        sharedBy: LEARN_TEXT.sharedDecksBy
      }),
    [union, data.states, now, subjectName]
  );

  // Da dove vengono le flashcard del pulsante: la stessa coda che parte toccandolo, per materia.
  const plannedFrom = useMemo(() => {
    if (!counts.today) return [];
    const spec = sessionSpec(data, { deckIds: [], filter: "today", limit: size, shuffle: false }, { now });
    const out = new Map<string, { key: string; label: string; subjectId?: string; count: number }>();
    for (const { card, owner } of spec.items) {
      const subjectId = owner ? undefined : (card.subjectId ?? deckSubjectId(union.decks, card.deckId));
      const name = subjectId ? subjectName.get(subjectId) : undefined;
      const root = deckPath(union.decks, card.deckId)[0];
      const key = name ? (subjectId as string) : `deck:${root?.id ?? card.deckId}`;
      const entry = out.get(key) ?? { key, label: name ?? root?.title ?? LEARN_TEXT.noSubject, ...(name ? { subjectId } : {}), count: 0 };
      entry.count++;
      out.set(key, entry);
    }
    return [...out.values()].sort((a, b) => b.count - a.count);
  }, [counts.today, data, size, now, union, subjectName]);

  const recent = useMemo(
    () =>
      data.studyRuns
        .filter((run) => run.kind === "flashcards" && run.events.length && !run.continuesId && !run.progress)
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .slice(0, 6),
    [data.studyRuns]
  );

  if (!union.cards.length && !data.studyRuns.some((run) => run.progress)) {
    return <EmptyState icon="Layers" title={LEARN_TEXT.emptyLibraryTitle} body={LEARN_TEXT.emptyLibraryBody} />;
  }

  const planned = Math.min(counts.today, limitOf(size));
  const rest = counts.today - planned;
  const overdue = counts.overdue;
  const dueOnly = Math.max(0, counts.due - overdue);
  const startDecks = (deckIds: string[], title?: string) => onStart({ deckIds, filter: "today", limit: size, shuffle: false, ...(title ? { title } : {}) });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <div className="grid min-w-0 grid-cols-1 content-start gap-4">
        {/* Prima il ripasso di oggi (il compito di ogni giorno), poi quello lasciato a metà. */}
        <Panel className="flex flex-col gap-4">
          {counts.today ? (
            <div className="min-w-0">
              <p className="text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.today}</p>
              <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2.5">
                <span className="text-5xl font-black leading-none tabular-nums sm:text-6xl">{counts.today}</span>
                <span className="text-base font-extrabold text-[var(--muted)]">{LEARN_TEXT.todayCards}</span>
              </p>
              <StackBar
                className="mt-4 h-2.5"
                parts={[
                  { value: overdue, tone: "bg-[var(--warning-text)]" },
                  { value: dueOnly, tone: "bg-[var(--accent)]" },
                  { value: counts.new, tone: "bg-[var(--accent-2)]" }
                ]}
              />
              <p className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
                <Legend tone="bg-[var(--warning-text)]" value={overdue} label={LEARN_TEXT.todayOverdue} />
                <Legend tone="bg-[var(--accent)]" value={dueOnly} label={LEARN_TEXT.todayDue} />
                <Legend tone="bg-[var(--accent-2)]" value={counts.new} label={LEARN_TEXT.todayNew} />
              </p>
            </div>
          ) : (
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid grid-cols-1 h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--success-bg)] text-[var(--success-text)]">
                <Icon name="Check" className="h-6 w-6" />
              </span>
              <div className="min-w-0">
                <h3 className="text-2xl font-black leading-tight">{LEARN_TEXT.caughtUp}</h3>
                <p className="mt-0.5 text-sm font-bold text-[var(--muted)]">{upcoming ? LEARN_TEXT.caughtUpNext(dayText(upcoming.day), upcoming.count) : LEARN_TEXT.caughtUpNone}</p>
              </div>
            </div>
          )}
          {union.cards.length ? (
            <div className="grid min-w-0 grid-cols-1 gap-3 border-t border-[var(--border)] pt-4">
              {/* Quali flashcard: le materie (con il loro segno) da cui vengono quelle del pulsante. */}
              {plannedFrom.length ? (
                <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="mr-0.5 text-sm font-bold text-[var(--muted)]">{LEARN_TEXT.plannedFrom(planned, rest <= 0)}</span>
                  {plannedFrom.map((item) => (
                    <span key={item.key} className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-[var(--surface-soft)] py-1 pl-1 pr-2.5 text-sm font-extrabold">
                      <SubjectMark subjectId={item.subjectId} size="sm" />
                      <span className="one-line-safe">{item.label}</span>
                      <span className="tabular-nums text-[var(--muted)]">{item.count}</span>
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                {counts.today ? (
                  <Button variant="primary" icon="PlayCircle" className="min-h-12 text-base sm:px-6" onClick={() => onStart({ deckIds: [], filter: "today", limit: size, shuffle: false })}>
                    {LEARN_TEXT.startCount(planned)}
                  </Button>
                ) : (
                  <Button variant="soft" icon="PlayCircle" className="min-h-12 text-base sm:px-6" onClick={() => onStart({ deckIds: [], filter: "all", limit: size, shuffle: false, title: LEARN_TEXT.sessionTitle })}>
                    {LEARN_TEXT.reviewAnyway}
                  </Button>
                )}
                <Button variant="ghost" icon="Settings" onClick={() => onCustomize([])}>
                  {LEARN_TEXT.customize}
                </Button>
                {counts.today && rest > 0 ? <p className="text-xs font-medium text-[var(--muted)] sm:ml-auto">{LEARN_TEXT.startRest(rest)}</p> : null}
              </div>
            </div>
          ) : null}
        </Panel>

        <PausedList data={data} onResume={onResume} lead={!counts.today} />

        {groups.length ? (
          <Panel>
            <h3 className="mb-3 text-lg font-black">{LEARN_TEXT.byDeck}</h3>
            <div className="grid grid-cols-1 gap-3">
              {groups.map((group) => (
                <SubjectTodo key={group.key} group={group} pausedDecks={pausedDecks} onStartDecks={startDecks} onResume={onResume} />
              ))}
            </div>
          </Panel>
        ) : null}
      </div>

      <Panel className="lg:self-start">
        <h3 className="mb-2 text-lg font-black">{LEARN_TEXT.recentSessions}</h3>
        {recent.length ? (
          <ul className="grid grid-cols-1 gap-1.5">
            {recent.map((run) => {
              const tally = { correct: 0, wrong: 0, doubt: 0, skip: 0 };
              for (const event of run.events) tally[event.r]++;
              const answered = tally.correct + tally.wrong + tally.doubt;
              return (
                <li key={run.id} className="flex min-w-0 items-center gap-3 rounded-[16px] bg-[var(--surface-soft)] px-3 py-2.5">
                  <SubjectMark subjectId={run.subjectIds?.[0]} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="one-line-safe block text-sm font-black">{run.title || LEARN_TEXT.sessionTitle}</span>
                    {run.resumed ? (
                      <span className="my-1 flex min-w-0">
                        <ResumedTag run={run} />
                      </span>
                    ) : null}
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-xs font-bold text-[var(--muted)]">{format(parseISO(run.startedAt), "d MMM, HH:mm", { locale: it })}</span>
                      <StackBar
                        className="h-1.5 min-w-0 max-w-[9rem] flex-1"
                        parts={(["correct", "doubt", "wrong", "skip"] as const).map((result) => ({ value: tally[result], tone: RESULT_BAR[result] }))}
                      />
                      <span className="sr-only">{LEARN_TEXT.sessionSummary(tally.correct, tally.wrong, tally.doubt, tally.skip)}</span>
                    </span>
                  </span>
                  {answered ? <span className={`shrink-0 text-lg font-black tabular-nums ${scoreTone(tally.correct / answered)}`}>{percent(tally.correct / answered)}</span> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm font-medium text-[var(--muted)]">{LEARN_TEXT.statsEmptyBody}</p>
        )}
      </Panel>
    </div>
  );
}
