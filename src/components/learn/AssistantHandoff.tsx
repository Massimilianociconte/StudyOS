// Messaggio per l'assistente: le richieste restano in coda finché la persona non scrive a ChatGPT o a
// Claude (vedi lib/assistantHandoff). Qui il messaggio pronto, da copiare o da aprire in una chat nuova.
import { useState } from "react";
import { chatGptUrl, claudeUrl } from "../../lib/assistantHandoff";
import { LEARN_TEXT } from "../../lib/labels/learn";
import { selectPreferences, useStudyStore } from "../../store/useStudyStore";
import { Icon } from "../Icon";
import { Button } from "../ui";

const linkClass =
  "motion-safe inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-4 text-sm font-extrabold text-[var(--text)] hover:bg-[var(--surface)]";

export function AssistantHandoff() {
  const account = useStudyStore((state) => selectPreferences(state).displayName.trim());
  const message = LEARN_TEXT.handoffMessage(account);
  const [status, setStatus] = useState("");

  // Senza await prima di aprire il link: il browser lo lascia aprire solo dentro il clic.
  const copy = (done: string) => {
    setStatus("");
    const write = navigator.clipboard?.writeText(message);
    if (!write) {
      setStatus(LEARN_TEXT.handoffCopyFailed);
      return;
    }
    write.then(
      () => setStatus(done),
      () => setStatus(LEARN_TEXT.handoffCopyFailed)
    );
  };

  return (
    <div className="grid grid-cols-1 gap-2 rounded-[18px] border border-[var(--border)] bg-[var(--surface-soft)] p-3">
      <p className="text-xs font-medium text-[var(--muted)]">{LEARN_TEXT.handoffHelp}</p>
      <p className="text-xs font-black uppercase text-[var(--faint)]">{LEARN_TEXT.handoffTitle}</p>
      <p className="safe-text select-all rounded-[14px] bg-[var(--surface)] p-3 text-sm font-bold">{message}</p>
      <div className="grid grid-cols-1 gap-2">
        <Button variant="primary" icon="Copy" onClick={() => copy(LEARN_TEXT.handoffCopied)}>
          {LEARN_TEXT.handoffCopy}
        </Button>
        <a className={linkClass} href={chatGptUrl(message)} target="_blank" rel="noopener noreferrer" onClick={() => copy(LEARN_TEXT.handoffOpened)}>
          <Icon name="ExternalLink" className="h-4 w-4" />
          {LEARN_TEXT.handoffOpenChatGpt}
          <span className="sr-only"> {LEARN_TEXT.newTab}</span>
        </a>
        <a className={linkClass} href={claudeUrl(message)} target="_blank" rel="noopener noreferrer" onClick={() => copy(LEARN_TEXT.handoffOpened)}>
          <Icon name="ExternalLink" className="h-4 w-4" />
          {LEARN_TEXT.handoffOpenClaude}
          <span className="sr-only"> {LEARN_TEXT.newTab}</span>
        </a>
      </div>
      {status ? (
        <p role="status" className="safe-text text-xs font-bold text-[var(--muted)]">
          {status}
        </p>
      ) : null}
    </div>
  );
}
