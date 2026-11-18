// Analisi AI: analisi scritte dagli agenti collegati (mai generate da StudyOS), richieste in coda
// («Spiegami meglio», «Chiedi un'analisi») con il loro stato. Il testo degli agenti si mostra come
// testo semplice o come blocchi validati: niente HTML, niente script.
import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { it } from "date-fns/locale";
import { archiveAnalysis, cancelAiRequest, createAiRequest, deleteAiRequest, deleteAnalysis, publishExplanation } from "../../store/learning";
import { editableSource, publishSharedExplanation } from "../../store/sharedLearning";
import { AI_STYLE_LABEL, requestStatusAt, resultBlocks } from "../../lib/learningModel";
import { LEARN_TEXT } from "../../lib/labels/learn";
import type { AiAnalysis, AiRequest } from "../../types";
import { ConfirmWithError } from "../ConfirmWithError";
import { Button, EmptyState, Field, Panel, Pill, inputClass } from "../ui";
import { Blocks } from "./Blocks";
import { errorText, type LearnData } from "./useLearnData";

const KIND_LABEL: Record<AiRequest["kind"], string> = {
  explain_card: "Spiegazione di una flashcard",
  explain_question: "Spiegazione di una domanda",
  analysis: "Analisi del ripasso"
};

const when = (iso: string | undefined) => (iso ? format(parseISO(iso), "d MMM yyyy, HH:mm", { locale: it }) : "");

/** Una richiesta con stato, risultato (blocchi validati) e azioni. */
export function RequestItem({ request, targetTitle }: { request: AiRequest; targetTitle?: string }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const status = requestStatusAt(request, new Date());
  const open = status === "pending" || status === "claimed";
  const blocks = status === "completed" && request.kind !== "analysis" ? resultBlocks(request) : [];
  const run = async (action: () => Promise<unknown>, done?: string) => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
      if (done) setMessage(done);
    } catch (failure) {
      setMessage(errorText(failure));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill active={status === "completed"}>{LEARN_TEXT.requestStatus[status] ?? status}</Pill>
        <span className="text-xs font-bold text-[var(--muted)]">
          {KIND_LABEL[request.kind]} · {AI_STYLE_LABEL[request.style]} · {when(request.createdAt)}
        </span>
      </div>
      {targetTitle ? <p className="safe-text mt-1 text-sm font-black">{targetTitle}</p> : null}
      {request.prompt ? <p className="safe-text mt-1 whitespace-pre-line text-sm font-medium">«{request.prompt}»</p> : null}
      {status === "claimed" && request.claimedBy ? <p className="mt-1 text-xs font-bold text-[var(--muted)]">{request.claimedBy}</p> : null}
      {status === "failed" && request.error ? <p className="safe-text mt-1 text-xs font-bold text-[var(--danger-text)]">{request.error}</p> : null}
      {blocks.length ? (
        <div className="mt-3 rounded-[14px] bg-[var(--surface)] p-3 text-sm">
          <p className="mb-1 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.explainBy(request.result?.agent.name || "assistente")}</p>
          <Blocks blocks={blocks} external />
        </div>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {blocks.length && (!request.targetOwnerId || editableSource(request.targetOwnerId)) ? (
          <Button
            variant="soft"
            icon="Check"
            disabled={busy}
            onClick={() => void run(() => (request.targetOwnerId ? publishSharedExplanation(request) : publishExplanation(request.id)), LEARN_TEXT.explainPublished)}
          >
            {LEARN_TEXT.explainPublish}
          </Button>
        ) : null}
        {open ? (
          <Button variant="ghost" icon="X" disabled={busy} onClick={() => void run(() => cancelAiRequest(request.id))}>
            {LEARN_TEXT.cancelRequest}
          </Button>
        ) : (
          <Button variant="ghost" icon="Trash2" disabled={busy} onClick={() => void run(() => deleteAiRequest(request.id))}>
            {LEARN_TEXT.deleteRequest}
          </Button>
        )}
      </div>
      {message ? (
        <p role="status" className="safe-text mt-2 text-xs font-bold text-[var(--muted)]">
          {message}
        </p>
      ) : null}
    </li>
  );
}

function AnalysisCard({ analysis }: { analysis: AiAnalysis }) {
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <article className="soft-panel p-4 sm:p-5">
      <p className="text-xs font-bold text-[var(--muted)]">
        {LEARN_TEXT.analysisBy(analysis.agent.name || "Assistente", when(analysis.createdAt))}
        {analysis.agent.model ? ` · ${analysis.agent.model}` : ""} · {LEARN_TEXT.analysisVersion(analysis.version)}
      </p>
      <h3 className="safe-text mt-1 text-lg font-black">{analysis.title}</h3>
      {analysis.summary ? <p className="safe-text mt-2 whitespace-pre-line text-sm font-medium">{analysis.summary}</p> : null}
      {analysis.sections.length ? (
        <div className="mt-3 grid grid-cols-1 gap-3">
          {analysis.sections.map((section, index) => (
            <section key={index} className="rounded-[16px] bg-[var(--surface-soft)] p-3">
              <h4 className="safe-text text-sm font-black">{section.title}</h4>
              <p className="safe-text mt-1 whitespace-pre-line text-sm font-medium text-[var(--muted)]">{section.body}</p>
            </section>
          ))}
        </div>
      ) : null}
      {analysis.dataNote ? (
        <p className="safe-text mt-3 text-xs font-medium text-[var(--faint)]">
          <span className="font-black">{LEARN_TEXT.analysisData}: </span>
          {analysis.dataNote}
        </p>
      ) : null}
      {confirm ? (
        <div className="mt-3">
          <ConfirmWithError
            text={LEARN_TEXT.deleteAnalysisConfirm}
            confirmLabel={LEARN_TEXT.deleteAnalysis}
            icon="Trash2"
            onCancel={() => setConfirm(false)}
            onConfirm={async () => {
              try {
                await deleteAnalysis(analysis.id);
                return null;
              } catch (failure) {
                return errorText(failure);
              }
            }}
          />
        </div>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="soft"
          icon="Archive"
          onClick={() =>
            void archiveAnalysis(analysis.id, analysis.status !== "archived").catch((failure) => setMessage(errorText(failure)))
          }
        >
          {analysis.status === "archived" ? LEARN_TEXT.unarchive : LEARN_TEXT.archive}
        </Button>
        <Button variant="ghost" icon="Trash2" onClick={() => setConfirm(true)}>
          {LEARN_TEXT.deleteAnalysis}
        </Button>
      </div>
      {message ? <p role="status" className="mt-2 text-xs font-bold text-[var(--danger-text)]">{message}</p> : null}
    </article>
  );
}

export function AiPanel({ data, targetTitle }: { data: LearnData; targetTitle: (request: AiRequest) => string | undefined }) {
  const [showArchived, setShowArchived] = useState(false);
  const [asking, setAsking] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [days, setDays] = useState(30);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  const analyses = useMemo(
    () => data.aiAnalyses.filter((item) => (showArchived ? true : item.status === "active")).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [data.aiAnalyses, showArchived]
  );
  const requests = useMemo(() => data.aiRequests.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30), [data.aiRequests]);
  const archivedCount = data.aiAnalyses.filter((item) => item.status === "archived").length;

  const ask = async () => {
    // Un doppio clic non mette in coda due richieste uguali.
    if (sending) return;
    setSending(true);
    setMessage("");
    try {
      await createAiRequest({ kind: "analysis", style: prompt.trim() ? "custom" : "deep", prompt, scope: { subjectIds: subjectId ? [subjectId] : [], deckIds: [], days } });
      setPrompt("");
      setAsking(false);
      setMessage(LEARN_TEXT.explainSent);
    } catch (failure) {
      setMessage(errorText(failure));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="grid grid-cols-1 content-start gap-4">
        <p className="safe-text text-sm font-medium text-[var(--muted)]">{LEARN_TEXT.aiIntro}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon="Sparkles" onClick={() => setAsking((value) => !value)} aria-expanded={asking}>
            {LEARN_TEXT.askAnalysis}
          </Button>
          {archivedCount ? (
            <label className="inline-flex min-h-11 items-center gap-2 text-sm font-bold">
              <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
              {LEARN_TEXT.showArchived} ({archivedCount})
            </label>
          ) : null}
        </div>
        {message ? (
          <p role="status" className="safe-text rounded-[14px] bg-[var(--surface-soft)] p-3 text-sm font-bold">
            {message}
          </p>
        ) : null}
        {asking ? (
          <Panel className="grid grid-cols-1 gap-3">
            <Field label={LEARN_TEXT.askAnalysisPrompt}>
              <textarea className={`${inputClass} min-h-20 py-2.5`} maxLength={2000} placeholder={LEARN_TEXT.askAnalysisPlaceholder} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
            </Field>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label={LEARN_TEXT.deckSubject}>
                <select className={inputClass} value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>
                  <option value="">Tutte</option>
                  {data.subjects
                    .filter((subject) => !subject.archived)
                    .map((subject) => (
                      <option key={subject.id} value={subject.id}>
                        {subject.name}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label={LEARN_TEXT.period}>
                <select className={inputClass} value={days} onChange={(event) => setDays(Number(event.target.value))}>
                  {[7, 14, 30, 90, 365].map((value) => (
                    <option key={value} value={value}>
                      {LEARN_TEXT.periodDays(value)}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <p className="text-xs font-medium text-[var(--faint)]">{LEARN_TEXT.requestWaitHelp}</p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setAsking(false)}>{LEARN_TEXT.cancel}</Button>
              <Button variant="primary" icon="Send" onClick={() => void ask()} disabled={sending}>
                {LEARN_TEXT.explainSend}
              </Button>
            </div>
          </Panel>
        ) : null}
        {analyses.length ? analyses.map((analysis) => <AnalysisCard key={analysis.id} analysis={analysis} />) : <EmptyState icon="Sparkles" title={LEARN_TEXT.aiEmptyTitle} body={LEARN_TEXT.aiEmptyBody} />}
      </div>
      <Panel className="content-start">
        <h3 className="mb-1 text-lg font-black">{LEARN_TEXT.requests}</h3>
        <p className="mb-3 text-xs font-medium text-[var(--faint)]">{LEARN_TEXT.requestWaitHelp}</p>
        {requests.length ? (
          <ul className="grid grid-cols-1 gap-2">
            {requests.map((request) => (
              <RequestItem key={request.id} request={request} targetTitle={targetTitle(request)} />
            ))}
          </ul>
        ) : (
          <p className="text-sm font-medium text-[var(--muted)]">{LEARN_TEXT.requestsEmpty}</p>
        )}
      </Panel>
    </div>
  );
}
