import { useEffect, useState } from "react";
import { isLocalPage } from "../agent/hubEndpoint";
import { trustedWritesActive } from "../agent/policy";
import type { AgentRisk, PolicyChoice } from "../agent/policy";
import {
  allowWritesFor15Minutes,
  approvePendingCall,
  clearTrustedWrites,
  decideAgentConsent,
  denyPendingCall,
  disconnectAgent,
  pairAgent,
  revokeAgentAccess,
  saveAgentHubAddress,
  setAgentPolicyChoice,
  useAgentLink
} from "../lib/agentLink";
import { readSavedHub } from "../lib/agentLocal";
import { useStudyStore } from "../store/useStudyStore";
import { Icon } from "./Icon";
import { Button, Field, inputClass } from "./ui";

const RISK_LABEL: Record<AgentRisk, string> = {
  read: "Letture",
  write: "Modifiche",
  destructive: "Eliminazioni"
};

const CHOICE_LABEL: Record<PolicyChoice, string> = {
  allow: "Consenti",
  ask: "Chiedi",
  deny: "Blocca"
};

const STATUS_LABEL = {
  executed: "eseguita",
  denied: "rifiutata",
  failed: "non riuscita",
  pending: "in attesa"
} as const;

const previewArgs = (args: Record<string, unknown>) => {
  const text = JSON.stringify(args, null, 2);
  if (!text || text === "{}") return "";
  return text.length > 700 ? `${text.slice(0, 700)}…` : text;
};

const when = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleString("it-IT", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
};

export function AgentDock() {
  const link = useAgentLink();
  const pending = link.pendingCall;
  const consent = link.pendingConsent;
  const [write, setWrite] = useState(true);

  useEffect(() => {
    setWrite(consent?.scopes.includes("studyos:write") ?? true);
  }, [consent?.requestId, consent?.scopes]);

  if (!pending && !consent && !(link.paired && link.hub === "down")) return null;

  return (
    <div
      className="fixed left-3 z-50 w-[min(24rem,calc(100vw-7.75rem))] bottom-[calc(6.75rem+env(safe-area-inset-bottom))] sm:bottom-6 sm:left-auto sm:right-6 sm:w-[min(26rem,calc(100vw-2rem))]"
    >
      {pending ? (
        <section role="dialog" aria-labelledby="agent-call-title" className="soft-panel border border-[var(--border)] p-4 shadow-soft">
          <p className="text-xs font-black uppercase text-[var(--faint)]">{pending.actorName} · {RISK_LABEL[pending.risk]}</p>
          <h2 id="agent-call-title" className="mt-1 text-xl font-black">{pending.summary}</h2>
          <p className="mt-1 text-sm font-bold text-[var(--muted)]">{pending.title}</p>
          {previewArgs(pending.args) ? (
            <pre className="mt-3 max-h-40 overflow-auto rounded-[16px] bg-[var(--surface-soft)] p-3 text-xs font-bold text-[var(--muted)]">{previewArgs(pending.args)}</pre>
          ) : null}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant={pending.risk === "destructive" ? "danger" : "primary"} icon="Check" onClick={() => approvePendingCall()}>
              {pending.risk === "destructive" ? "Elimina" : "Approva"}
            </Button>
            <Button variant="soft" onClick={() => denyPendingCall()}>Rifiuta</Button>
          </div>
        </section>
      ) : null}

      {consent ? (
        <section role="dialog" aria-labelledby="agent-consent-title" className="soft-panel border border-[var(--border)] p-4 shadow-soft">
          <p className="text-xs font-black uppercase text-[var(--faint)]">Nuovo collegamento{consent.redirectHost ? ` · ${consent.redirectHost}` : ""}</p>
          <h2 id="agent-consent-title" className="mt-1 text-xl font-black">{consent.clientName}</h2>
          <p className="mt-1 text-sm font-bold text-[var(--muted)]">Vuole usare il tuo studio. Le modifiche e le eliminazioni restano soggette alla policy qui sotto.</p>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked disabled />
            Lettura di materie, task, esami e del resto dello studio
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} />
            Anche creare, modificare ed eliminare
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" icon="Check" onClick={() => decideAgentConsent(true, write ? ["studyos:write"] : [])}>Consenti</Button>
            <Button variant="soft" onClick={() => decideAgentConsent(false, [])}>Rifiuta</Button>
          </div>
        </section>
      ) : null}

      {!pending && !consent && link.paired && link.hub === "down" ? (
        <button
          type="button"
          className="soft-panel flex w-full items-center gap-2 p-3 text-left text-sm font-black"
          onClick={() => {
            useStudyStore.getState().setActiveView("settings");
            window.setTimeout(() => document.getElementById("settings-agenti")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
          }}
        >
          <Icon name="AlertTriangle" className="h-4 w-4 shrink-0 text-[var(--danger-text)]" />
          <span>Agenti: il programma locale non risponde</span>
        </button>
      ) : null}
    </div>
  );
}

export function AgentSettings() {
  const link = useAgentLink();
  const [code, setCode] = useState("");
  const [hubAddress, setHubAddress] = useState(() => readSavedHub());
  const [busy, setBusy] = useState(false);
  const trusted = trustedWritesActive(link.policy);
  const localPage = isLocalPage(window.location.origin);
  const published = window.location.hostname === "massimilianociconte.github.io";

  const submitCode = async () => {
    setBusy(true);
    try {
      await pairAgent(code);
      setCode("");
    } catch {
      // il messaggio è nello stato del collegamento
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-center gap-2 text-sm font-black">
        <span className={`inline-flex min-h-8 items-center rounded-full px-3 ${link.hub === "up" ? "bg-[var(--accent)] text-[#10131d]" : "bg-[var(--surface-soft)] text-[var(--muted)]"}`}>
          {link.hub === "up" ? "Programma attivo" : link.hub === "down" ? "Programma spento" : "Controllo in corso"}
        </span>
        <span className="inline-flex min-h-8 items-center rounded-full bg-[var(--surface-soft)] px-3 text-[var(--muted)]">
          {link.paired ? "Browser collegato" : "Browser non collegato"}
        </span>
      </div>

      {link.error ? <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">{link.error}</p> : null}
      {link.notice ? <p role="status" className="rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">{link.notice}</p> : null}

      <form
        className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          void submitCode();
        }}
      >
        <Field label="Codice di collegamento">
          <input
            className={inputClass}
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            placeholder="ABCD-EFGH"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-describedby="agent-pair-help"
          />
        </Field>
        <Button type="submit" variant="primary" icon="Link" disabled={busy || code.replace(/[^A-Za-z0-9]/g, "").length !== 8}>
          Collega
        </Button>
      </form>
      <p id="agent-pair-help" className="text-sm font-bold text-[var(--muted)]">
        Nella cartella di StudyOS avvia <code className="font-black">npm run agent</code>. Il codice compare nel terminale, vale 15 minuti e si usa una volta sola.
      </p>
      <p className="text-sm font-bold text-[var(--muted)]">
        {published
          ? "ChatGPT modifica i dati di questo sito pubblicato. La finestra di localhost resta una copia a parte e riceve le modifiche solo se questa scheda è chiusa."
          : "ChatGPT modifica i dati di questa finestra. Con il sito pubblicato aperto e collegato, le modifiche vanno lì."}
      </p>
      {localPage ? null : (
        <form
          className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            saveAgentHubAddress(hubAddress);
          }}
        >
          <Field label="Indirizzo https del programma, se il collegamento diretto non risponde">
            <input
              className={inputClass}
              value={hubAddress}
              onChange={(event) => setHubAddress(event.target.value)}
              placeholder="https://nome.trycloudflare.com"
              autoComplete="off"
              spellCheck={false}
              inputMode="url"
            />
          </Field>
          <Button type="submit" variant="soft" icon="Link">Salva</Button>
        </form>
      )}
      {link.paired ? <Button variant="soft" icon="LogOut" onClick={() => disconnectAgent()}>Scollega questo browser</Button> : null}

      <div className="grid grid-cols-1 gap-3">
        {(Object.keys(RISK_LABEL) as AgentRisk[]).map((risk) => (
          <fieldset key={risk} className="min-w-0">
            <legend className="mb-1.5 text-xs font-black uppercase text-[var(--faint)]">{RISK_LABEL[risk]}</legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(CHOICE_LABEL) as PolicyChoice[]).map((choice) => {
                const active = link.policy[risk] === choice;
                return (
                  <button
                    key={choice}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setAgentPolicyChoice(risk, choice)}
                    className={`min-h-11 rounded-full border px-4 text-sm font-black ${active ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"}`}
                  >
                    {CHOICE_LABEL[choice]}
                  </button>
                );
              })}
            </div>
          </fieldset>
        ))}
      </div>
      <p className="text-sm font-bold text-[var(--muted)]">
        Di base le letture passano e tutto il resto chiede conferma. Un agente non può allentare queste regole. «Consenti» sulle eliminazioni le esegue senza chiederti nulla: tienilo solo se lo vuoi davvero.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="soft" icon="Clock" onClick={() => allowWritesFor15Minutes()} disabled={link.policy.write === "deny"}>
          Consenti le modifiche per 15 minuti
        </Button>
        {trusted ? <Button variant="ghost" onClick={() => clearTrustedWrites()}>Torna a chiedere</Button> : null}
      </div>
      {trusted && link.policy.trustedWritesUntil ? (
        <p className="text-sm font-bold text-[var(--muted)]">Modifiche senza conferma fino alle {when(link.policy.trustedWritesUntil)}. Le eliminazioni chiedono ancora conferma.</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="danger" icon="Shield" onClick={() => void revokeAgentAccess()}>
          Revoca ChatGPT e gli altri accessi
        </Button>
      </div>
      <p className="text-sm font-bold text-[var(--muted)]">
        Revoca i token OAuth. Il collegamento di questo browser, usato solo per portarti le richieste, resta. Gli agenti dovranno autorizzarsi di nuovo.
      </p>

      <div>
        <h4 className="text-sm font-black">Ultime azioni</h4>
        {link.audit.length ? (
          <ul className="mt-2 grid grid-cols-1 gap-2">
            {link.audit.map((entry) => (
              <li key={entry.id} className="rounded-[18px] bg-[var(--surface-soft)] px-3 py-2">
                <p className="text-sm font-black">{entry.summary}</p>
                <p className="text-xs font-bold text-[var(--muted)]">
                  {when(entry.at)} · {entry.actor} · {STATUS_LABEL[entry.status]}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm font-bold text-[var(--muted)]">Ancora nessuna azione. Il registro resta solo su questo browser.</p>
        )}
      </div>

      <div className="rounded-[20px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
        <p className="font-black text-[var(--text)]">Come collegare un agente</p>
        <p className="mt-2">Claude, Cursor e gli altri client locali usano, con la cartella di StudyOS come directory di lavoro:</p>
        <code className="mt-2 block overflow-x-auto rounded-[14px] bg-[var(--surface)] p-3 text-xs font-black text-[var(--text)]">node --import ./scripts/lib/register-ts.mjs ./scripts/agent.ts --stdio</code>
        <p className="mt-3">
          ChatGPT sul web e l’app per Mac usano i connettori dell’account, che raggiungono solo un indirizzo HTTPS pubblico. Avvia un tunnel verso la porta 47321, riesegui <code className="font-black">STUDYOS_PUBLIC_ORIGIN=https://il-tuo-indirizzo npm run agent</code> e in ChatGPT aggiungi un server MCP personalizzato all’indirizzo <code className="font-black">https://il-tuo-indirizzo/mcp</code>. L’accesso è OAuth: la conferma compare in questa schermata.
        </p>
        <p className="mt-3">
          L’app aperta con <code className="font-black">npm run dev</code> parla in modo affidabile con il programma locale. La copia pubblicata su GitHub Pages può essere bloccata dal browser perché è un sito https che chiama il computer.
        </p>
      </div>
    </div>
  );
}
