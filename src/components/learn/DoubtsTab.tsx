// Dubbi: tutto ciò che hai segnato con «Dubbio» (flashcard e domande, tue o condivise), per materia e
// poi per argomento (la raccolta «argomento» creata dall'assistente). In cima quanti sono e i due modi
// per ristudiarli (ripasso delle flashcard, quiz sulle domande), che seguono i filtri scelti.
// Ogni argomento si ripassa da solo o si toglie tutto insieme quando è chiarito; ogni elemento si
// toglie dai dubbi con il suo pulsante. Una flashcard si apre; una domanda mostra la risposta giusta.
import { useMemo, useState } from "react";
import { blocksPlainText } from "../../lib/cardBlocks";
import { groupDoubts, type DoubtItem, type DoubtSubject, type DoubtTopic } from "../../lib/learnMarks";
import { correctOptionIds, optionLetter } from "../../lib/quizScoring";
import { LEARN_TEXT } from "../../lib/labels/learn";
import { clearMarks, toggleMark } from "../../store/learning";
import { InlineConfirm } from "../InlineConfirm";
import { Icon } from "../Icon";
import { SubjectMark } from "../SubjectMark";
import { Button, EmptyState, Panel } from "../ui";
import { Blocks } from "./Blocks";
import type { QuizPlay } from "./QuizPlayer";
import type { SessionSpec } from "./StudySession";
import { doubtsQuizPlay, doubtsSessionSpec } from "./learnStarts";
import { FILTER_CHIP, FILTER_CHIP_IDLE } from "./tones";
import { unionOf, type LearnData } from "./useLearnData";

const ALL = "all";

const CHIP = FILTER_CHIP;
const CHIP_IDLE = FILTER_CHIP_IDLE;

const itemsOf = (topic: DoubtTopic) => [...topic.cards, ...topic.questions];
const subjectItems = (subject: DoubtSubject) => subject.topics.flatMap(itemsOf);

function Unmark({ item }: { item: DoubtItem }) {
  return (
    <button
      type="button"
      onClick={() => void toggleMark({ kind: item.mark.kind, id: item.mark.id }, false).catch(() => undefined)}
      title={LEARN_TEXT.doubtsUnmark}
      aria-label={LEARN_TEXT.doubtsUnmark}
      className="motion-safe grid grid-cols-1 h-10 w-10 shrink-0 place-items-center rounded-full text-[var(--warning-text)] hover:bg-[var(--surface)]"
    >
      <Icon name="Flag" className="h-4 w-4 fill-current" />
    </button>
  );
}

function QuestionRow({ item, showQuiz }: { item: DoubtItem; showQuiz: boolean }) {
  const question = item.question;
  if (!question) return null;
  const right = new Set(correctOptionIds(question));
  const external = Boolean(item.owner);
  return (
    <li className="min-w-0 rounded-[16px] bg-[var(--surface-soft)]">
      <div className="flex min-w-0 items-start gap-1">
        <details className="group min-w-0 flex-1">
          <summary className="flex min-h-12 cursor-pointer list-none items-start gap-2.5 rounded-[16px] px-3 py-2.5 hover:bg-[var(--surface)] [&::-webkit-details-marker]:hidden">
            <Icon name="CircleDot" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-2)]" />
            <span className="min-w-0 flex-1">
              <span className="learn-read line-clamp-2 text-sm font-bold">{blocksPlainText(question.prompt, 200)}</span>
              {showQuiz && item.quiz ? <span className="one-line-safe block text-xs font-bold text-[var(--faint)]">{LEARN_TEXT.doubtsFromQuiz(item.quiz.title)}</span> : null}
            </span>
            <Icon name="ChevronDown" className="motion-safe mt-0.5 h-4 w-4 shrink-0 text-[var(--faint)] group-open:rotate-180" />
          </summary>
          <div className="grid grid-cols-1 gap-2 px-3 pb-3 text-sm">
            <ul className="grid grid-cols-1 gap-1">
              {question.options.map((option, position) => (
                <li
                  key={option.id}
                  className={`flex min-w-0 items-start gap-2 rounded-[12px] px-2.5 py-1.5 ${right.has(option.id) ? "bg-[var(--success-bg)] font-bold text-[var(--success-text)]" : "text-[var(--muted)]"}`}
                >
                  <span className="shrink-0 font-black">{optionLetter(position)}</span>
                  <span className="learn-read min-w-0 flex-1">{option.text}</span>
                  {right.has(option.id) ? <Icon name="Check" className="mt-0.5 h-4 w-4 shrink-0" /> : null}
                </li>
              ))}
            </ul>
            {question.explanation?.length ? (
              <div className="rounded-[12px] border border-[var(--border)] p-2.5">
                <Blocks blocks={question.explanation} external={external} />
              </div>
            ) : null}
          </div>
        </details>
        <Unmark item={item} />
      </div>
    </li>
  );
}

function TopicPanel({ topic, onPlay, onOpenCard }: { topic: DoubtTopic; onPlay: (next: SessionSpec | QuizPlay | null) => void; onOpenCard: (id: string) => void }) {
  const [confirm, setConfirm] = useState(false);
  const items = itemsOf(topic);
  const title = topic.title || LEARN_TEXT.doubtsOther;
  // Domande di un solo quiz: il quiz si dice una volta, nell'intestazione.
  const quizTitles = [...new Set(topic.questions.map((item) => item.quiz?.title).filter((name): name is string => Boolean(name)))];
  const oneQuiz = quizTitles.length === 1 && quizTitles[0] !== title ? quizTitles[0] : null;
  return (
    <Panel>
      {/* Telefono: azioni sotto il titolo, con il nome scritto (solo icone non si capivano). */}
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          {topic.path ? <p className="one-line-safe text-xs font-bold text-[var(--faint)]">{topic.path}</p> : null}
          <h4 className="learn-read text-base font-black leading-snug">{title}</h4>
          <p className="mt-0.5 text-xs font-bold text-[var(--muted)]">
            {[...(topic.cards.length ? [LEARN_TEXT.doubtsCards(topic.cards.length)] : []), ...(topic.questions.length ? [LEARN_TEXT.doubtsQuestions(topic.questions.length)] : [])].join(" · ")}
          </p>
          {oneQuiz ? <p className="one-line-safe text-xs font-bold text-[var(--faint)]">{LEARN_TEXT.doubtsFromQuiz(oneQuiz)}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1">
          <Button
            variant="soft"
            icon="PlayCircle"
            className="min-h-10 px-3"
            title={LEARN_TEXT.doubtsStudyTopic(title)}
            aria-label={LEARN_TEXT.doubtsStudyTopic(title)}
            onClick={() => onPlay(topic.cards.length ? doubtsSessionSpec(topic.cards) : doubtsQuizPlay(topic.questions))}
          >
            {LEARN_TEXT.studyDeck}
          </Button>
          <Button variant="ghost" icon="Check" className="min-h-10 px-3" onClick={() => setConfirm(true)} aria-label={LEARN_TEXT.doubtsClearTopic(title)} title={LEARN_TEXT.doubtsClearTopic(title)}>
            {LEARN_TEXT.doubtsCleared}
          </Button>
        </div>
      </div>
      {confirm ? (
        <div className="mt-3">
          <InlineConfirm
            text={LEARN_TEXT.doubtsClearConfirm(items.length)}
            confirmLabel={LEARN_TEXT.doubtsCleared}
            icon="Check"
            onCancel={() => setConfirm(false)}
            onConfirm={() => {
              setConfirm(false);
              void clearMarks(items.map((item) => item.mark.id)).catch(() => undefined);
            }}
          />
        </div>
      ) : null}
      <ul className="mt-3 grid grid-cols-1 gap-1.5">
        {topic.cards.map((item) =>
          item.card ? (
            <li key={item.mark.id} className="flex min-w-0 items-start gap-1 rounded-[16px] bg-[var(--surface-soft)]">
              <button
                type="button"
                onClick={() => onOpenCard(item.mark.id)}
                className="motion-safe flex min-h-12 min-w-0 flex-1 items-start gap-2.5 rounded-[16px] px-3 py-2.5 text-left hover:bg-[var(--surface)]"
              >
                <Icon name="Layers" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
                <span className="min-w-0 flex-1">
                  <span className="learn-read line-clamp-2 text-sm font-bold">{blocksPlainText(item.card.front, 200)}</span>
                  {item.owner ? <span className="one-line-safe block text-xs font-bold text-[var(--faint)]">{LEARN_TEXT.sharedBy(item.owner.name)}</span> : null}
                </span>
              </button>
              <Unmark item={item} />
            </li>
          ) : null
        )}
        {topic.questions.map((item) => (
          <QuestionRow key={item.mark.id} item={item} showQuiz={!oneQuiz} />
        ))}
      </ul>
    </Panel>
  );
}

export function DoubtsTab({
  data,
  items,
  onPlay,
  onOpenCard
}: {
  data: LearnData;
  items: readonly DoubtItem[];
  onPlay: (next: SessionSpec | QuizPlay | null) => void;
  onOpenCard: (cardId: string) => void;
}) {
  const [subjectKey, setSubjectKey] = useState(ALL);
  const [topicKey, setTopicKey] = useState(ALL);
  const union = useMemo(() => unionOf(data), [data.own, data.shared]);
  const groups = useMemo(() => groupDoubts(items, union.decks), [items, union.decks]);
  const subjectName = useMemo(() => new Map(data.subjects.map((subject) => [subject.id, subject.name])), [data.subjects]);

  if (!items.length) return <EmptyState icon="Flag" title={LEARN_TEXT.doubtsEmptyTitle} body={LEARN_TEXT.doubtsEmptyBody} />;

  // Filtri: una materia (o tutte), poi un argomento di quella materia (o tutti). Un filtro che non
  // esiste più (dubbi tolti) torna a «tutti».
  const subject = groups.find((group) => group.key === subjectKey);
  const subjects = subject ? [subject] : groups;
  const topic = subject?.topics.find((entry) => entry.key === topicKey);
  const visible = subjects.map((group) => ({ group, topics: topic && group === subject ? [topic] : group.topics }));
  const inView = visible.flatMap(({ topics }) => topics.flatMap(itemsOf));
  const cards = inView.filter((item) => item.card);
  const questions = inView.filter((item) => item.question);

  const labelOf = (group: DoubtSubject) => {
    if (group.ownerId) {
      const owner = subjectItems(group).find((item) => item.owner)?.owner;
      const name = group.subjectId ? undefined : LEARN_TEXT.noSubject;
      return owner ? LEARN_TEXT.sharedBy(owner.name) + (name ? ` · ${name}` : "") : LEARN_TEXT.noSubject;
    }
    return (group.subjectId && subjectName.get(group.subjectId)) || LEARN_TEXT.noSubject;
  };

  return (
    <div className="grid min-w-0 grid-cols-1 gap-4">
      <Panel className="flex flex-col gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid grid-cols-1 h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--warning-bg)] text-[var(--warning-text)]">
            <Icon name="Flag" className="h-5 w-5 fill-current" />
          </span>
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-2.5">
            <span className="text-5xl font-black leading-none tabular-nums">{inView.length}</span>
            <span className="text-base font-extrabold text-[var(--muted)]">{LEARN_TEXT.doubtsCount(inView.length)}</span>
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {cards.length ? (
            <Button variant="primary" icon="Layers" className="min-h-12 text-base sm:px-6" onClick={() => onPlay(doubtsSessionSpec(cards))}>
              {LEARN_TEXT.doubtsStudyCards(cards.length)}
            </Button>
          ) : null}
          {questions.length ? (
            <Button variant={cards.length ? "soft" : "primary"} icon="CircleDot" className="min-h-12 text-base sm:px-6" onClick={() => onPlay(doubtsQuizPlay(questions))}>
              {LEARN_TEXT.doubtsQuiz(questions.length)}
            </Button>
          ) : null}
        </div>
        <p className="flex min-w-0 items-start gap-2 text-xs font-bold text-[var(--muted)]">
          <Icon name="Flag" className="mt-px h-3.5 w-3.5 shrink-0 fill-current text-[var(--warning-text)]" />
          {LEARN_TEXT.doubtsUnmarkHint}
        </p>
      </Panel>

      {groups.length > 1 ? (
        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.doubtsSubjects}</p>
          <div role="group" aria-label={LEARN_TEXT.doubtsSubjects} className="scrollbar-hidden -mx-1 flex gap-2 overflow-x-auto px-1 py-0.5">
            <button
              type="button"
              aria-pressed={!subject}
              onClick={() => {
                setSubjectKey(ALL);
                setTopicKey(ALL);
              }}
              className={`${CHIP} ${subject ? CHIP_IDLE : ""}`}
            >
              {LEARN_TEXT.doubtsAll}
              <span className="tabular-nums opacity-70">{items.length}</span>
            </button>
            {groups.map((group) => (
              <button
                key={group.key}
                type="button"
                aria-pressed={group === subject}
                onClick={() => {
                  setSubjectKey(group.key);
                  setTopicKey(ALL);
                }}
                className={`${CHIP} max-w-[16rem] ${group === subject ? "" : CHIP_IDLE}`}
              >
                <SubjectMark subjectId={group.ownerId ? undefined : group.subjectId} size="sm" />
                <span className="one-line-safe">{labelOf(group)}</span>
                <span className="tabular-nums opacity-70">{group.cards + group.questions}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {subject && subject.topics.length > 1 ? (
        <div className="min-w-0">
          <p className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.doubtsTopics}</p>
          <div role="group" aria-label={LEARN_TEXT.doubtsTopics} className="scrollbar-hidden -mx-1 flex gap-2 overflow-x-auto px-1 py-0.5">
            <button type="button" aria-pressed={!topic} onClick={() => setTopicKey(ALL)} className={`${CHIP} ${topic ? CHIP_IDLE : ""}`}>
              {LEARN_TEXT.doubtsAllTopics}
            </button>
            {subject.topics.map((entry) => (
              <button key={entry.key} type="button" aria-pressed={entry === topic} onClick={() => setTopicKey(entry.key)} className={`${CHIP} max-w-[16rem] ${entry === topic ? "" : CHIP_IDLE}`}>
                <span className="one-line-safe">{entry.title || LEARN_TEXT.doubtsOther}</span>
                <span className="tabular-nums opacity-70">{entry.cards.length + entry.questions.length}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {visible.map(({ group, topics }) => (
        <section key={group.key} className="grid min-w-0 grid-cols-1 gap-3" aria-label={labelOf(group)}>
          {subjects.length > 1 ? (
            <h3 className="flex min-w-0 items-center gap-2 pt-1 text-lg font-black">
              <SubjectMark subjectId={group.ownerId ? undefined : group.subjectId} size="sm" />
              <span className="one-line-safe">{labelOf(group)}</span>
              <span className="text-sm font-black tabular-nums text-[var(--faint)]">{group.cards + group.questions}</span>
            </h3>
          ) : null}
          <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">
            {topics.map((entry) => (
              <TopicPanel key={entry.key} topic={entry} onPlay={onPlay} onOpenCard={onOpenCard} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
