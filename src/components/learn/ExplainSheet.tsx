// «Spiegami meglio»: richiesta persistente a un agente collegato (StudyOS non genera testi). Scegli lo
// stile, scrivi il dubbio se serve; la richiesta resta in coda finché un agente la elabora. Qui sotto
// le richieste già fatte per la stessa scheda, con le spiegazioni arrivate.
import { useEffect, useState } from "react";
import { createAiRequest } from "../../store/learning";
import { AI_STYLES, AI_STYLE_LABEL } from "../../lib/learningModel";
import { LEARN_TEXT, STYLE_HINT } from "../../lib/labels/learn";
import type { AiRequest, AiRequestStyle } from "../../types";
import { Button, Drawer, Field, inputClass } from "../ui";
import { RequestItem } from "./AiPanel";
import type { ExplainTarget } from "./CardDrawer";
import { errorText } from "./useLearnData";

export function ExplainSheet({ target, requests, onClose }: { target: ExplainTarget | null; requests: readonly AiRequest[]; onClose: () => void }) {
  const [style, setStyle] = useState<AiRequestStyle>("simple");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!target) return;
    setStyle("simple");
    setPrompt("");
    setMessage("");
  }, [target]);

  const needsPrompt = style === "doubt" || style === "custom";
  const previous = target ? requests.filter((request) => request.targetId === target.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) : [];

  const send = async () => {
    if (!target) return;
    if (needsPrompt && !prompt.trim()) {
      setMessage(LEARN_TEXT.explainPromptRequired);
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await createAiRequest({ kind: target.kind, style, prompt, targetId: target.id, ...(target.ownerId ? { targetOwnerId: target.ownerId } : {}) });
      setPrompt("");
      setMessage(LEARN_TEXT.explainSent);
    } catch (failure) {
      setMessage(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={Boolean(target)}
      onClose={onClose}
      eyebrow={target?.title}
      title={LEARN_TEXT.explainTitle}
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button onClick={onClose}>{LEARN_TEXT.sessionClose}</Button>
          <Button variant="primary" icon="Send" onClick={() => void send()} disabled={busy}>
            {LEARN_TEXT.explainSend}
          </Button>
        </div>
      }
    >
      <div className="grid grid-cols-1 gap-4">
        <fieldset>
          <legend className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.explainStyle}</legend>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {AI_STYLES.map((id) => (
              <label key={id} className={`flex min-h-11 cursor-pointer items-start gap-2 rounded-[16px] border p-2.5 ${style === id ? "border-[var(--accent-ink)] bg-[var(--surface)]" : "border-[var(--border)] bg-[var(--surface-soft)]"}`}>
                <input type="radio" name="explain-style" className="mt-1" checked={style === id} onChange={() => setStyle(id)} />
                <span className="min-w-0">
                  <span className="block text-sm font-black">{AI_STYLE_LABEL[id]}</span>
                  <span className="block text-xs font-medium text-[var(--muted)]">{STYLE_HINT[id]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label={needsPrompt ? LEARN_TEXT.explainPromptRequired : LEARN_TEXT.explainPrompt}>
          <textarea className={`${inputClass} min-h-20 py-2.5`} maxLength={2000} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </Field>
        {message ? (
          <p role="status" className="safe-text rounded-[14px] bg-[var(--surface-soft)] p-3 text-sm font-bold">
            {message}
          </p>
        ) : null}
        <p className="text-xs font-medium text-[var(--faint)]">{LEARN_TEXT.requestWaitHelp}</p>
        {previous.length ? (
          <section>
            <h3 className="mb-2 text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.explainResults}</h3>
            <ul className="grid gap-2">
              {previous.map((request) => (
                <RequestItem key={request.id} request={request} />
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}
