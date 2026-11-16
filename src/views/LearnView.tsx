// Ripasso: flashcard, quiz, ripasso a intervalli, andamento e analisi degli agenti collegati.
import { useState } from "react";
import { LEARN_TABS, LEARN_TAB_LABEL, LEARN_TEXT, type LearnTab } from "../lib/labels/learn";
import { blocksPlainText } from "../lib/cardBlocks";
import { oneOf, useUiState } from "../lib/uiState";
import { useToday } from "../hooks/useToday";
import type { AiRequest } from "../types";
import { SectionTitle, Segmented } from "../components/ui";
import { AiPanel } from "../components/learn/AiPanel";
import { CardDrawer, type ExplainTarget } from "../components/learn/CardDrawer";
import { ExplainSheet } from "../components/learn/ExplainSheet";
import { LearnStats } from "../components/learn/LearnStats";
import { LibraryTab } from "../components/learn/LibraryTab";
import { QuizPlayer, type QuizPlay } from "../components/learn/QuizPlayer";
import { QuizTab } from "../components/learn/QuizTab";
import { ReviewTab } from "../components/learn/ReviewTab";
import { SessionBuilder, sessionSpec } from "../components/learn/SessionBuilder";
import { StudySession, type SessionSpec } from "../components/learn/StudySession";
import { findCard, useLearnData } from "../components/learn/useLearnData";

const TAB_ICON: Record<LearnTab, string> = { library: "Layers", review: "RotateCcw", quiz: "CircleDot", stats: "BarChart3", ai: "Sparkles" };

export function LearnView() {
  const data = useLearnData();
  const today = useToday();
  const [tab, setTab] = useUiState<LearnTab>("learn.tab", "review", { validate: oneOf(...LEARN_TABS) });
  const [session, setSession] = useState<SessionSpec | null>(null);
  const [quiz, setQuiz] = useState<QuizPlay | null>(null);
  const [builder, setBuilder] = useState<string[] | null>(null);
  const [explain, setExplain] = useState<ExplainTarget | null>(null);
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const openCard = openCardId ? findCard(data, openCardId) : null;

  const start = (spec: SessionSpec) => {
    setBuilder(null);
    if (!spec.items.length) {
      setNotice(LEARN_TEXT.sessionEmpty);
      return;
    }
    setNotice("");
    setSession(spec);
  };

  const quickStart = () => {
    // Da ripassare oggi; se non c'è nulla, le nuove nell'ordine delle raccolte.
    const due = sessionSpec(data, { deckIds: [], filter: "due", limit: 100, order: "priority", title: LEARN_TEXT.dueToday });
    start(due.items.length ? due : sessionSpec(data, { deckIds: [], filter: "new", limit: 20, order: "priority", title: LEARN_TEXT.sessionTitle }));
  };

  const targetTitle = (request: AiRequest) => {
    if (!request.targetId) return undefined;
    const card = findCard(data, request.targetId);
    if (card) return blocksPlainText(card.card.front, 100);
    const question = [...data.quizQuestions, ...data.shared.flatMap((source) => source.bundle.quizQuestions)].find((item) => item.id === request.targetId);
    return question ? blocksPlainText(question.prompt, 100) : undefined;
  };

  return (
    <div>
      <SectionTitle title={LEARN_TEXT.title} subtitle={LEARN_TEXT.subtitle} />
      <div className="mb-4">
        <Segmented<LearnTab> label={LEARN_TEXT.tabsAria} value={tab} onChange={setTab} options={LEARN_TABS.map((id) => ({ id, label: LEARN_TAB_LABEL[id], icon: TAB_ICON[id] }))} />
      </div>
      {data.locked ? <p className="mb-4 text-sm font-bold text-[var(--warning-text)]">{LEARN_TEXT.locked}</p> : null}
      {notice ? (
        <p role="status" className="safe-text mb-4 rounded-[14px] bg-[var(--surface-soft)] p-3 text-sm font-bold">
          {notice}
        </p>
      ) : null}

      {tab === "library" ? <LibraryTab data={data} today={today} onStudy={(scope) => setBuilder(scope.deckIds)} onExplain={setExplain} /> : null}
      {tab === "review" ? <ReviewTab data={data} today={today} onQuickStart={quickStart} onBuild={setBuilder} /> : null}
      {tab === "quiz" ? <QuizTab data={data} onPlay={setQuiz} /> : null}
      {tab === "stats" ? <LearnStats data={data} today={today} onOpenCard={setOpenCardId} /> : null}
      {tab === "ai" ? <AiPanel data={data} targetTitle={targetTitle} /> : null}

      <SessionBuilder open={builder !== null} initialDeckIds={builder ?? []} data={data} onClose={() => setBuilder(null)} onStart={start} />
      <CardDrawer card={openCard?.card ?? null} source={openCard?.source ?? null} state={openCard ? data.states.get(openCard.card.id) : undefined} onClose={() => setOpenCardId(null)} onExplain={setExplain} />
      <ExplainSheet target={explain} requests={data.aiRequests} onClose={() => setExplain(null)} />
      {session ? (
        <StudySession
          spec={session}
          onClose={() => setSession(null)}
          onExplain={(item) => setExplain({ kind: "explain_card", id: item.card.id, ...(item.owner ? { ownerId: item.owner.id } : {}), title: blocksPlainText(item.card.front, 80) })}
        />
      ) : null}
      {quiz ? <QuizPlayer play={quiz} onClose={() => setQuiz(null)} onExplain={setExplain} /> : null}
    </div>
  );
}
