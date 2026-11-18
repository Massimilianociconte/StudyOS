// Ripasso: flashcard, quiz, ripasso a intervalli, dubbi segnati, andamento e analisi degli agenti.
// Schede in ordine d'uso: Oggi (cosa fare adesso e cosa riprendere), Dubbi, Raccolte, Quiz, Andamento
// (con le analisi degli assistenti). I numeri sulle schede dicono subito dove c'è qualcosa da fare.
import { useMemo, useState } from "react";
import { LEARN_TABS, LEARN_TAB_LABEL, LEARN_TEXT, type LearnTab } from "../lib/labels/learn";
import { blocksPlainText } from "../lib/cardBlocks";
import { filterCounts } from "../lib/learnSession";
import { resolveDoubts } from "../lib/learnMarks";
import { oneOf, useUiState } from "../lib/uiState";
import { useToday } from "../hooks/useToday";
import type { AiRequest, StudyRun } from "../types";
import { SectionTitle } from "../components/ui";
import { Icon } from "../components/Icon";
import { AiPanel } from "../components/learn/AiPanel";
import { CardDrawer, type ExplainTarget } from "../components/learn/CardDrawer";
import { DoubtsTab } from "../components/learn/DoubtsTab";
import { ExplainSheet } from "../components/learn/ExplainSheet";
import { LearnStats } from "../components/learn/LearnStats";
import { LibraryTab } from "../components/learn/LibraryTab";
import { QuizPlayer, type QuizPlay } from "../components/learn/QuizPlayer";
import { QuizTab } from "../components/learn/QuizTab";
import { ReviewTab } from "../components/learn/ReviewTab";
import { SessionBuilder, isSessionSize, sessionSpec, type SessionOptions } from "../components/learn/SessionBuilder";
import { StudySession, type SessionSpec } from "../components/learn/StudySession";
import { cardsSessionSpec, resumeQuizPlay, resumeSessionSpec } from "../components/learn/learnStarts";
import { LearnTabs } from "../components/learn/LearnTabs";
import { pausedByDeck } from "../lib/learnResume";
import { markResumed } from "../store/learning";
import { findCard, unionOf, useLearnData } from "../components/learn/useLearnData";

const TAB_ICON: Record<LearnTab, string> = { review: "RotateCcw", doubts: "Flag", library: "Layers", quiz: "CircleDot", stats: "BarChart3" };

export function LearnView() {
  const data = useLearnData();
  const today = useToday();
  const [tab, setTab] = useUiState<LearnTab>("learn.tab", "review", { validate: oneOf(...LEARN_TABS) });
  const [session, setSession] = useState<SessionSpec | null>(null);
  const [quiz, setQuiz] = useState<QuizPlay | null>(null);
  // Ogni nuovo tentativo (anche «Rifai» dal risultato) rimonta il lettore da zero.
  const [quizRound, setQuizRound] = useState(0);
  // Quiz da avviare aprendo la scheda Quiz (dal dettaglio di una raccolta).
  const [quizStart, setQuizStart] = useState<string | null>(null);
  const [builder, setBuilder] = useState<string[] | null>(null);
  const [explain, setExplain] = useState<ExplainTarget | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const openCard = openCardId ? findCard(data, openCardId) : null;

  // Schede per sessione (0 = tutte): una scelta sola per «Ripassa», le raccolte e Personalizza.
  const [size, setSize] = useUiState<number>("learn.sessionSize", 20, { validate: isSessionSize });

  // Numeri sulle schede: quante flashcard per oggi, quanti dubbi.
  const union = useMemo(() => unionOf(data), [data.own, data.shared]);
  const todayCount = useMemo(() => filterCounts(union.cards, data.states, new Date()).today, [union, data.states, today]);
  const doubts = useMemo(() => resolveDoubts(data.studyMarks, [{ bundle: data.own }, ...data.shared]), [data.studyMarks, data.own, data.shared]);
  const tabCount: Partial<Record<LearnTab, number>> = { review: todayCount, doubts: doubts.length };

  const start = (options: SessionOptions) => {
    setBuilder(null);
    let spec = sessionSpec(data, options);
    // Una raccolta senza schede in scadenza né nuove: si ripassa comunque, prima le più vicine.
    if (!spec.items.length && options.filter === "today") spec = sessionSpec(data, { ...options, filter: "all" });
    if (!spec.items.length) {
      setNotice(LEARN_TEXT.sessionEmpty);
      return;
    }
    setNotice("");
    setSession(spec);
  };

  const play = (next: SessionSpec | QuizPlay | null) => {
    if (!next) {
      setNotice(LEARN_TEXT.resumeMissing);
      return;
    }
    setNotice("");
    if ("prepared" in next) {
      setQuizRound((value) => value + 1);
      setQuiz(next);
    } else setSession(next);
  };
  const changeTab = (next: LearnTab) => {
    setQuizStart(null);
    setTab(next);
  };
  const openQuiz = (quizId: string) => {
    setQuizStart(quizId);
    setTab("quiz");
  };
  // Riprendere segna la riga come ripresa (etichetta «Ripresa», anche nello storico) prima di aprirla:
  // il lettore parte dalla riga segnata, così il segno resta quando la sessione si chiude.
  const resume = async (run: StudyRun) => {
    const ready = run.kind === "quiz" ? resumeQuizPlay(data, run) : resumeSessionSpec(data, run);
    if (!ready) {
      play(null);
      return;
    }
    let marked = run;
    try {
      marked = await markResumed(run);
    } catch {
      // Workspace bloccato o salvataggio non riuscito: si riprende comunque, senza segno.
    }
    play(marked === run ? ready : run.kind === "quiz" ? resumeQuizPlay(data, marked) : resumeSessionSpec(data, marked));
  };
  const resumeVoid = (run: StudyRun) => void resume(run);

  // Una raccolta con una sessione in pausa riprende quella invece di iniziarne un'altra.
  const pausedDecks = useMemo(() => pausedByDeck(data.studyRuns), [data.studyRuns]);

  const closed = (paused?: boolean) => setNotice(paused ? LEARN_TEXT.paused : "");

  const targetTitle = (request: AiRequest) => {
    if (!request.targetId) return undefined;
    const card = findCard(data, request.targetId);
    if (card) return blocksPlainText(card.card.front, 100);
    const question = [...data.quizQuestions, ...data.shared.flatMap((source) => source.bundle.quizQuestions)].find((item) => item.id === request.targetId);
    return question ? blocksPlainText(question.prompt, 100) : undefined;
  };

  return (
    <div className="min-w-0">
      <SectionTitle title={LEARN_TEXT.title} />
      <div className="mb-4 min-w-0">
        <LearnTabs<LearnTab>
          label={LEARN_TEXT.tabsAria}
          value={tab}
          onChange={changeTab}
          options={LEARN_TABS.map((id) => ({ id, label: LEARN_TAB_LABEL[id], icon: TAB_ICON[id], ...(tabCount[id] ? { count: tabCount[id] } : {}) }))}
        />
      </div>
      {data.locked ? <p className="mb-4 text-sm font-bold text-[var(--warning-text)]">{LEARN_TEXT.locked}</p> : null}
      {notice ? (
        <p role="status" className="safe-text mb-4 flex items-start gap-2 rounded-[14px] bg-[var(--surface-soft)] p-3 text-sm font-bold">
          <span className="min-w-0 flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice("")} className="shrink-0 rounded-full px-2 text-[var(--muted)] hover:text-[var(--text)]" aria-label={LEARN_TEXT.sessionClose}>
            ×
          </button>
        </p>
      ) : null}

      {tab === "review" ? <ReviewTab data={data} today={today} size={size} pausedDecks={pausedDecks} onStart={start} onCustomize={setBuilder} onResume={resumeVoid} /> : null}
      {tab === "doubts" ? <DoubtsTab data={data} items={doubts} onPlay={play} onOpenCard={setOpenCardId} /> : null}
      {tab === "library" ? (
        <LibraryTab
          data={data}
          today={today}
          pausedDecks={pausedDecks}
          onStudy={(scope) => {
            const paused = scope.deckIds.length === 1 ? pausedDecks.get(scope.deckIds[0]) : undefined;
            if (paused) resumeVoid(paused.run);
            else start({ deckIds: scope.deckIds, filter: "today", limit: size, shuffle: false });
          }}
          onExplain={setExplain}
          onQuiz={openQuiz}
        />
      ) : null}
      {tab === "quiz" ? <QuizTab data={data} initialStart={quizStart} onPlay={play} onResume={resumeVoid} /> : null}
      {tab === "stats" ? (
        <div className="grid min-w-0 grid-cols-1 gap-6">
          <LearnStats data={data} today={today} onOpenCard={setOpenCardId} onStudyCards={(ids) => play(cardsSessionSpec(data, ids, LEARN_TEXT.hardestSessionTitle))} />
          {/* Analisi degli assistenti: stessa domanda (come sto andando), quindi stessa scheda. */}
          <section aria-labelledby="learn-ai-title" className="min-w-0">
            <h2 id="learn-ai-title" className="mb-3 flex items-center gap-2 text-xl font-black">
              <Icon name="Sparkles" className="h-5 w-5 text-[var(--accent-ink)]" />
              {LEARN_TEXT.aiSectionTitle}
            </h2>
            <AiPanel data={data} targetTitle={targetTitle} />
          </section>
        </div>
      ) : null}

      <SessionBuilder open={builder !== null} initialDeckIds={builder ?? []} data={data} size={size} onSize={setSize} onClose={() => setBuilder(null)} onStart={start} />
      <CardDrawer card={openCard?.card ?? null} source={openCard?.source ?? null} state={openCard ? data.states.get(openCard.card.id) : undefined} onClose={() => setOpenCardId(null)} onExplain={setExplain} />
      <ExplainSheet target={explain} requests={data.aiRequests} onClose={() => setExplain(null)} />
      {session ? (
        <StudySession
          spec={session}
          states={data.states}
          marked={data.marked}
          more={session.options ? (seen) => sessionSpec(data, session.options as SessionOptions, { exclude: seen }).items : undefined}
          onClose={(paused) => {
            setSession(null);
            closed(paused);
          }}
          onExplain={(item) => setExplain({ kind: "explain_card", id: item.card.id, ...(item.owner ? { ownerId: item.owner.id } : {}), title: blocksPlainText(item.card.front, 80) })}
        />
      ) : null}
      {quiz ? (
        <QuizPlayer
          key={quizRound}
          play={quiz}
          marked={data.marked}
          onAgain={play}
          onClose={(paused) => {
            setQuiz(null);
            closed(paused);
          }}
          onExplain={setExplain}
        />
      ) : null}
    </div>
  );
}
