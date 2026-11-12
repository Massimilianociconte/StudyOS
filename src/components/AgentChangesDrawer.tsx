// «Modifiche del connettore» (Impostazioni → Agenti → Connettore remoto): il registro del server con
// le modifiche fatte da ChatGPT o Claude con l'app chiusa, raggruppate per richiesta, e «Ripristina»
// (tutta la richiesta insieme). Modulo pigro: lo carica AgentDesk al tocco, con supabase-js
// (lib/agentCloud), così la schermata degli agenti resta leggera.

import { useCallback, useEffect, useState } from "react";
import { listConnectorActions, restoreConnectorAction } from "../lib/agentCloud";
import { mergeActions, restoreNotice, restoreQuestion, type ConnectorAction, type RestoreNotice } from "../lib/agentChanges";
import { AGENT_CHANGES_TEXT } from "../lib/labels/agentChanges";
import { ConfirmWithError } from "./ConfirmWithError";
import { Button, Drawer } from "./ui";

const PAGE = 30;

type Phase = "loading" | "ready" | "signIn" | "missingSql" | "failed";

const when = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

const MUTED = "text-sm font-bold text-[var(--muted)]";
const SMALL = "text-xs font-bold text-[var(--muted)]";

function ActionRow({ action, onRestored }: { action: ConnectorAction; onRestored: (notice: RestoreNotice) => void }) {
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState<RestoreNotice | null>(null);
  const restore = async (): Promise<string | null> => {
    try {
      const outcome = await restoreConnectorAction(action.id);
      const next = restoreNotice(outcome, action);
      setAsking(false);
      setNotice(next);
      onRestored(next);
      return null;
    } catch (error) {
      return error instanceof Error && error.message ? error.message : AGENT_CHANGES_TEXT.outcome.failed;
    }
  };
  const many = action.size > 1;
  return (
    <li className="grid grid-cols-1 gap-1 rounded-[18px] bg-[var(--surface)] px-3 py-2">
      {many ? (
        <ul className="grid grid-cols-1 gap-1">
          {action.changes.map((change) => (
            <li key={change.id} className="safe-text text-sm font-black">{change.sentence}</li>
          ))}
          {action.more > 0 ? <li className={SMALL}>{AGENT_CHANGES_TEXT.moreChanges(action.more)}</li> : null}
        </ul>
      ) : (
        <p className="safe-text text-sm font-black">{action.changes[0]?.sentence}</p>
      )}
      <p className={SMALL}>
        {when(action.at)} · {action.who}
        {action.undo ? ` · ${AGENT_CHANGES_TEXT.undo}` : ""}
      </p>
      {many && action.canRestore && !action.restoredAt && !notice ? <p className={SMALL}>{AGENT_CHANGES_TEXT.together(action.size)}</p> : null}
      {action.restoredAt ? (
        <p className={SMALL}>{AGENT_CHANGES_TEXT.restoredAt(when(action.restoredAt))}</p>
      ) : !action.canRestore ? (
        <p className={SMALL}>{AGENT_CHANGES_TEXT.changedLater}</p>
      ) : null}
      {notice ? (
        <p role={notice.ok ? "status" : "alert"} className={`text-sm font-bold ${notice.ok ? "text-[var(--muted)]" : "text-[var(--danger-text)]"}`}>
          {notice.text}
        </p>
      ) : null}
      {action.canRestore && !action.restoredAt && !notice ? (
        asking ? (
          <ConfirmWithError
            text={restoreQuestion(action)}
            confirmLabel={AGENT_CHANGES_TEXT.restore}
            icon="RotateCcw"
            onCancel={() => setAsking(false)}
            onConfirm={restore}
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button variant="soft" icon="RotateCcw" onClick={() => setAsking(true)}>
              {AGENT_CHANGES_TEXT.restore}
            </Button>
          </div>
        )
      ) : null}
    </li>
  );
}

export function AgentChangesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [items, setItems] = useState<ConnectorAction[]>([]);
  const [total, setTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreFailed, setMoreFailed] = useState(false);

  /**
   * count: quante azioni rileggere dall'inizio (dopo un ripristino anche quelle caricate con «Mostra
   * altre»). quiet: senza togliere l'elenco intanto.
   */
  const load = useCallback(async (count = PAGE, quiet = false) => {
    if (!quiet) setPhase("loading");
    setMoreFailed(false);
    try {
      const page = await listConnectorActions(0, Math.max(count, PAGE));
      if (page.kind !== "ok") {
        setPhase(page.kind);
        return;
      }
      // Stesso id = stessa riga (React key): l'esito mostrato resta sulla sua azione.
      setItems(page.items);
      setTotal(page.total);
      setPhase("ready");
    } catch {
      if (!quiet) setPhase("failed");
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const more = async () => {
    setLoadingMore(true);
    setMoreFailed(false);
    try {
      const page = await listConnectorActions(items.length, PAGE);
      if (page.kind === "ok") {
        setItems((shown) => mergeActions(shown, page.items));
        setTotal(page.total);
      }
    } catch {
      setMoreFailed(true);
    } finally {
      setLoadingMore(false);
    }
  };

  // Dopo un ripristino l'elenco si rilegge per intero (quante azioni c'erano, più quella nuova in alto):
  // l'azione annullata resta al suo posto, segnata.
  const restored = (notice: RestoreNotice) => {
    if (notice.ok) void load(items.length + 1, true);
  };

  return (
    <Drawer open={open} onClose={onClose} title={AGENT_CHANGES_TEXT.title} eyebrow={<span className="text-xs font-black uppercase tracking-wide text-[var(--muted)]">{AGENT_CHANGES_TEXT.eyebrow}</span>}>
      <div className="grid grid-cols-1 gap-3">
        <p className={MUTED}>{AGENT_CHANGES_TEXT.intro}</p>
        {phase === "loading" ? (
          <p role="status" className={MUTED}>{AGENT_CHANGES_TEXT.loading}</p>
        ) : phase === "signIn" ? (
          <p className={MUTED}>{AGENT_CHANGES_TEXT.signIn}</p>
        ) : phase === "missingSql" ? (
          <p className={MUTED}>{AGENT_CHANGES_TEXT.missingSql}</p>
        ) : phase === "failed" ? (
          <div className="grid grid-cols-1 gap-2">
            <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">{AGENT_CHANGES_TEXT.loadFailed}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="soft" icon="RotateCcw" onClick={() => void load()}>{AGENT_CHANGES_TEXT.retry}</Button>
            </div>
          </div>
        ) : items.length ? (
          <>
            <ul className="grid grid-cols-1 gap-2">
              {items.map((action) => (
                <ActionRow key={action.id} action={action} onRestored={restored} />
              ))}
            </ul>
            {moreFailed ? <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">{AGENT_CHANGES_TEXT.loadFailed}</p> : null}
            {items.length < total ? (
              <div className="flex flex-wrap gap-2">
                <Button variant="soft" icon="ChevronDown" disabled={loadingMore} aria-busy={loadingMore} onClick={() => void more()}>
                  {loadingMore ? AGENT_CHANGES_TEXT.loading : AGENT_CHANGES_TEXT.more}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className={MUTED}>{AGENT_CHANGES_TEXT.empty}</p>
        )}
      </div>
    </Drawer>
  );
}
