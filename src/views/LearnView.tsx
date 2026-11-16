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
import { SessionBuilder, isSessionSize, sessionSpec, type SessionOptions } from "../components/learn/SessionBuilder";
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

  // Schede per sessione (0 = tutte): una scelta sola per «Ripassa», le raccolte e Personalizza.
  const [size, setSize] = useUiState<number>("learn.sessionSize", 20, { validate: isSessionSize });

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

      {tab === "library" ? <LibraryTab data={data} today={today} onStudy={(scope) => start({ deckIds: scope.deckIds, filter: "today", limit: size, shuffle: false })} onExplain={setExplain} /> : null}
      {tab === "review" ? <ReviewTab data={data} today={today} size={size} onStart={start} onCustomize={setBuilder} /> : null}
      {tab === "quiz" ? <QuizTab data={data} onPlay={setQuiz} /> : null}
      {tab === "stats" ? <LearnStats data={data} today={today} onOpenCard={setOpenCardId} /> : null}
      {tab === "ai" ? <AiPanel data={data} targetTitle={targetTitle} /> : null}

      <SessionBuilder open={builder !== null} initialDeckIds={builder ?? []} data={data} size={size} onSize={setSize} onClose={() => setBuilder(null)} onStart={start} />
      <CardDrawer card={openCard?.card ?? null} source={openCard?.source ?? null} state={openCard ? data.states.get(openCard.card.id) : undefined} onClose={() => setOpenCardId(null)} onExplain={setExplain} />
      <ExplainSheet target={explain} requests={data.aiRequests} onClose={() => setExplain(null)} />
      {session ? (
        <StudySession
          spec={session}
          states={data.states}
          more={session.options ? (seen) => sessionSpec(data, session.options as SessionOptions, { exclude: seen }).items : undefined}
          onClose={() => setSession(null)}
          onExplain={(item) => setExplain({ kind: "explain_card", id: item.card.id, ...(item.owner ? { ownerId: item.owner.id } : {}), title: blocksPlainText(item.card.front, 80) })}
        />
      ) : null}
      {quiz ? <QuizPlayer play={quiz} onClose={() => setQuiz(null)} onExplain={setExplain} /> : null}
    </div>
  );
}
