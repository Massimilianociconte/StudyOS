import { useEffect, useState } from "react";
import { isLocalPage, normalizePublicHub } from "../agent/hubEndpoint";
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
import { agentAccountLabels } from "../lib/labels";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { Icon } from "./Icon";
import { Button, Field, inputClass } from "./ui";

const RISK_LABEL: Record<AgentRisk, string> = {
  read: "Letture",
  write: "Modifiche",
  destructive: "Eliminazioni"
};

const CHOICE_LABEL: Record<PolicyChoice, string> = {
  allow: "Consenti",
  ask: "Chiedi prima",
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
          <p className="text-xs font-black uppercase text-[var(--faint)]">
            {pending.actorName} · {RISK_LABEL[pending.risk]}{link.queuedCalls ? ` · altre ${link.queuedCalls} in attesa` : ""}
          </p>
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
          <p className="mt-1 text-sm font-bold text-[var(--muted)]">Vuole accedere ai tuoi dati di studio. Modifiche ed eliminazioni seguiranno i permessi scelti in Impostazioni › Agenti AI.</p>
          <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-bold">
            <input type="checkbox" checked disabled />
            Leggere materie, attività, esami e il resto dei tuoi dati
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
          <span>{window.location.hostname === "massimilianociconte.github.io" ? "Agenti AI: riapri StudyOS per ricollegarli" : "Agenti AI: il programma sul computer non risponde"}</span>
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
  const accountName = useStudyStore((state) => selectPreferences(state).displayName.trim());
  const trusted = trustedWritesActive(link.policy);
  const localPage = isLocalPage(window.location.origin);
  const published = window.location.hostname === "massimilianociconte.github.io";
  const hostedHub = published ? normalizePublicHub(import.meta.env.VITE_AGENT_HUB_ORIGIN ?? "") : null;
  const pairReady = localPage
    ? code.replace(/[^A-Za-z0-9]/g, "").length === 8
    : code.trim().length >= 20 && !/\s/.test(code.trim());

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
          {link.hub === "up" ? "Collegamento attivo" : link.hub === "down" ? "Collegamento non raggiungibile" : "Controllo in corso…"}
        </span>
        <span className="inline-flex min-h-8 items-center rounded-full bg-[var(--surface-soft)] px-3 text-[var(--muted)]">
          {link.paired ? "Questo browser è collegato" : "Questo browser non è collegato"}
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
        <Field label={localPage ? "Codice di collegamento" : "Chiave di collegamento"}>
          <input
            className={inputClass}
            value={code}
            onChange={(event) => setCode(localPage ? event.target.value.toUpperCase() : event.target.value)}
            placeholder={localPage ? "Es. ABCD-EFGH" : "Incolla qui la chiave"}
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            aria-describedby="agent-pair-help"
          />
        </Field>
        <Button type="submit" variant="primary" icon="Link" disabled={busy || !pairReady}>
          Collega questo browser
        </Button>
      </form>
      <p id="agent-pair-help" className="text-sm font-bold text-[var(--muted)]">
        {localPage
          ? <>Il codice compare nel terminale quando avvii <code className="font-black">npm run agent</code> nella cartella di StudyOS. Vale 15 minuti e si usa una volta sola.</>
          : "Incolla la chiave una sola volta: resta salvata in questo browser, anche sul telefono, e non serve tenere acceso il computer."}
      </p>
      {hostedHub ? (
        <p className="text-sm font-bold text-[var(--muted)]">
          Per usarlo con ChatGPT, aggiungi in ChatGPT un connettore personalizzato (server MCP) con questo indirizzo. La richiesta di accesso comparirà qui, da confermare:
          <code className="mt-2 block overflow-x-auto rounded-[14px] bg-[var(--surface-soft)] p-3 text-xs font-black text-[var(--text)]">{hostedHub}/mcp</code>
        </p>
      ) : null}
      {link.paired ? <Button variant="soft" icon="LogOut" onClick={() => disconnectAgent()}>Scollega questo browser</Button> : null}

      <div className="grid grid-cols-1 gap-1">
        <h4 className="text-sm font-black">{agentAccountLabels.title}</h4>
        <p className="text-sm font-bold text-[var(--muted)]">
          {accountName ? agentAccountLabels.named(accountName) : agentAccountLabels.unnamed}
          {accountName ? null : (
            <>
              {" "}
              <a href="#settings-profilo" className="font-black text-[var(--accent-ink)] underline underline-offset-2">{agentAccountLabels.toProfile}</a>
            </>
          )}
        </p>
        <p className="text-sm font-bold text-[var(--muted)]">{agentAccountLabels.help}</p>
      </div>

      <div>
        <h4 className="text-sm font-black">Cosa può fare un assistente</h4>
        <p className="mt-1 text-sm font-bold text-[var(--muted)]">
          All'inizio può leggere liberamente e ti chiede conferma per tutto il resto. Solo tu puoi cambiare queste regole, non l'assistente. Con «Consenti» sulle eliminazioni, cancella senza chiederti nulla: sceglilo solo se lo vuoi davvero. Condividere i tuoi dati con altre persone, o cambiare una condivisione, chiede sempre la tua conferma.
        </p>
      </div>
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
      <div className="flex flex-wrap gap-2">
        <Button variant="soft" icon="Clock" onClick={() => allowWritesFor15Minutes()} disabled={link.policy.write === "deny"}>
          Consenti le modifiche per 15 minuti
        </Button>
        {trusted ? <Button variant="ghost" onClick={() => clearTrustedWrites()}>Torna a chiedere conferma</Button> : null}
      </div>
      {trusted && link.policy.trustedWritesUntil ? (
        <p className="text-sm font-bold text-[var(--muted)]">Modifiche senza conferma fino alle {when(link.policy.trustedWritesUntil)}. Le eliminazioni e le condivisioni chiedono ancora conferma.</p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button variant="danger" icon="Shield" onClick={() => void revokeAgentAccess()}>
          Revoca l'accesso agli assistenti
        </Button>
      </div>
      <p className="text-sm font-bold text-[var(--muted)]">
        Gli assistenti autorizzati perdono subito l'accesso e dovranno chiederlo di nuovo. Questo browser resta collegato, perché serve solo a portarti le loro richieste.
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
          <p className="mt-1 text-sm font-bold text-[var(--muted)]">Ancora nessuna azione. Qui vedrai cosa fanno gli assistenti; l'elenco resta solo in questo browser.</p>
        )}
      </div>

      <details className="rounded-[20px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
        <summary className="cursor-pointer font-black text-[var(--text)]">Istruzioni tecniche</summary>
        <p className="mt-3">
          {published
            ? "ChatGPT modifica i dati di questo sito pubblicato. La finestra di localhost resta una copia a parte e riceve le modifiche solo se questa scheda è chiusa."
            : "ChatGPT modifica i dati di questa finestra. Con il sito pubblicato aperto e collegato, le modifiche vanno lì."}
        </p>
        {localPage || hostedHub ? null : (
          <form
            className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
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
                placeholder="Es. https://nome.trycloudflare.com"
                autoComplete="off"
                spellCheck={false}
                inputMode="url"
              />
            </Field>
            <Button type="submit" variant="soft" icon="Link">Salva indirizzo</Button>
          </form>
        )}
        <p className="mt-3">Claude, Cursor e gli altri programmi sul computer si collegano con questo comando, lanciato dalla cartella di StudyOS:</p>
        <code className="mt-2 block overflow-x-auto rounded-[14px] bg-[var(--surface)] p-3 text-xs font-black text-[var(--text)]">node --import ./scripts/lib/register-ts.mjs ./scripts/agent.ts --stdio</code>
        <p className="mt-3">
          {hostedHub
            ? "ChatGPT, sul web e nell’app per Mac, usa l’indirizzo MCP qui sopra. L’accesso passa da OAuth e la conferma compare in questa schermata. Tieni aperta questa pagina, anche dal telefono: i dati restano in questo browser."
            : "ChatGPT sul web parla con il sito pubblicato, non con questa finestra di sviluppo. Qui colleghi solo i programmi sul computer, con il codice del terminale."}
        </p>
        <p className="mt-3">
          La finestra aperta con <code className="font-black">npm run dev</code> è una copia a parte e parla solo con <code className="font-black">npm run agent</code> sul computer.
        </p>
      </details>
    </div>
  );
}
