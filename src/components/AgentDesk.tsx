import { useEffect, useState } from "react";
import { isLocalPage, normalizePublicHub } from "../agent/hubEndpoint";
import { trustedWritesActive } from "../agent/policy";
import type { AgentRisk, PolicyChoice } from "../agent/policy";
import {
  allowWritesFor15Minutes,
  approvePendingCall,
  checkScopedRevoke,
  clearTrustedWrites,
  decideAgentConsent,
  denyPendingCall,
  disconnectAgent,
  pairAgent,
  revokeAgentAccess,
  revokeRemoteConnector,
  saveAgentHubAddress,
  setAgentPolicyChoice,
  useAgentLink
} from "../lib/agentLink";
import { agentDeskStatus, remoteConnectorView, type DeskStatus, type RemoteRevokeResult } from "../lib/agentDesk";
import { readSavedHub } from "../lib/agentLocal";
import { cloudConfigured, getCloudSyncState, subscribeCloudSync } from "../lib/cloudSyncState";
import { agentAccountLabels, agentCloudLabels } from "../lib/labels";
import { AGENT_DESK_TEXT } from "../lib/labels/agents";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { ConfirmWithError } from "./ConfirmWithError";
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

/** Accesso all'account cloud, senza caricare Supabase: lo stato lo pubblica la sync. */
const useSignedIn = () => {
  const [signedIn, setSignedIn] = useState(() => cloudConfigured && Boolean(getCloudSyncState().session));
  useEffect(() => subscribeCloudSync(() => setSignedIn(cloudConfigured && Boolean(getCloudSyncState().session))), []);
  return signedIn;
};

export function AgentDock() {
  const link = useAgentLink();
  const pending = link.pendingCall;
  const consent = link.pendingConsent;
  const [write, setWrite] = useState(true);
  const signedIn = useSignedIn();

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
          <p className="text-xs font-black uppercase text-[var(--faint)]">
            {consent.cloud ? agentCloudLabels.consentKicker : "Nuovo collegamento"}{consent.redirectHost ? ` · ${consent.redirectHost}` : ""}
          </p>
          <h2 id="agent-consent-title" className="mt-1 text-xl font-black">{consent.clientName}</h2>
          <p className="mt-1 text-sm font-bold text-[var(--muted)]">
            {consent.cloud
              ? agentCloudLabels.consentBody(consent.accountName ?? "")
              : "Vuole accedere ai tuoi dati di studio. Modifiche ed eliminazioni seguiranno i permessi scelti in Impostazioni › Agenti AI."}
          </p>
          {consent.cloud && !signedIn ? <p className="mt-2 text-sm font-bold text-[var(--danger-text)]">{agentCloudLabels.signInHint}</p> : null}
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

/** Indirizzo da incollare in ChatGPT o Claude, con il pulsante per copiarlo. */
function CopyAddress({ value }: { value: string }) {
  const [status, setStatus] = useState("");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(AGENT_DESK_TEXT.copied);
    } catch {
      setStatus(AGENT_DESK_TEXT.copyFailed);
    }
  };
  return (
    <div className="grid grid-cols-1 gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-2 rounded-[14px] bg-[var(--surface-soft)] p-2 pl-3">
        <code className="min-w-0 flex-1 break-all text-xs font-black text-[var(--text)]">{value}</code>
        <Button variant="soft" icon="Copy" onClick={() => void copy()} aria-label={`${AGENT_DESK_TEXT.copy} ${value}`}>
          {AGENT_DESK_TEXT.copy}
        </Button>
      </div>
      {status ? <p role="status" className="text-xs font-bold text-[var(--muted)]">{status}</p> : null}
    </div>
  );
}

/**
 * Connettore remoto (`/u/<nome>/mcp`): lavora sui dati cloud con l'app chiusa e senza conferme.
 * Mostra cosa fa, l'indirizzo di questo account (o come averlo) e la sua revoca.
 */
function RemoteConnector({ hub, accountName, paired }: { hub: string | null; accountName: string; paired: boolean }) {
  const link = useAgentLink();
  const signedIn = useSignedIn();
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<RemoteRevokeResult | null>(null);
  const text = AGENT_DESK_TEXT.remote;
  const view = remoteConnectorView({ cloud: cloudConfigured, hub, remote: link.remote, displayName: accountName });
  const revoke = async () => {
    setBusy(true);
    setOutcome(null);
    try {
      setOutcome(await revokeRemoteConnector());
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-labelledby="agent-remote-title" className="grid grid-cols-1 gap-2 rounded-[20px] border border-[var(--border)] p-3">
      <h4 id="agent-remote-title" className="text-sm font-black">{text.title}</h4>
      <p className="text-sm font-bold text-[var(--muted)]">{text.what}</p>
      <p className="flex items-start gap-2 text-sm font-black">
        <Icon name="AlertTriangle" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger-text)]" />
        <span>{text.noConfirm}</span>
      </p>
      {view.kind === "address" ? (
        <>
          <p className="text-sm font-bold text-[var(--muted)]">{text.howTo}</p>
          <CopyAddress value={view.address} />
          {!paired ? <p className="text-sm font-bold text-[var(--muted)]">{text.pairFirst}</p> : null}
          {paired && !signedIn ? <p className="text-sm font-bold text-[var(--muted)]">{agentCloudLabels.signInHint}</p> : null}
        </>
      ) : view.kind === "noName" ? (
        <p className="text-sm font-bold text-[var(--muted)]">
          {text.noName}{" "}
          <a href="#settings-profilo" className="font-black text-[var(--accent-ink)] underline underline-offset-2">{agentAccountLabels.toProfile}</a>
        </p>
      ) : (
        <p className="text-sm font-bold text-[var(--muted)]">{view.kind === "noCloud" ? agentCloudLabels.noCloud : view.kind === "off" ? text.off : text.noHub}</p>
      )}
      {cloudConfigured && (paired || signedIn) ? (
        outcome?.kind === "failed" ? (
          <div className="grid grid-cols-1 gap-2">
            <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">{outcome.text}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="soft" icon="RotateCcw" disabled={busy} onClick={() => void revoke()}>{text.retry}</Button>
            </div>
          </div>
        ) : (
          <>
            {outcome ? <p role="status" className="rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">{outcome.text}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="soft" icon="LogOut" disabled={busy} onClick={() => void revoke()}>{text.revoke}</Button>
            </div>
          </>
        )
      ) : null}
    </section>
  );
}

const TONE_CLASS: Record<DeskStatus["tone"], string> = {
  ok: "bg-[var(--accent)] text-[#10131d]",
  warn: "bg-[var(--danger-bg)] text-[var(--danger-text)]",
  neutral: "bg-[var(--surface-soft)] text-[var(--muted)]"
};

const MUTED = "text-sm font-bold text-[var(--muted)]";

/**
 * Impostazioni → Agenti AI. Prima l'essenziale («Collega ChatGPT o Claude»: stato, chiave, indirizzo),
 * poi il connettore remoto e le revoche; regole, 15 minuti e ultime azioni in «Avanzate».
 */
export function AgentSettings() {
  const link = useAgentLink();
  const signedIn = useSignedIn();
  const [code, setCode] = useState("");
  const [hubAddress, setHubAddress] = useState(() => readSavedHub());
  const [busy, setBusy] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  /** Hub di prima: «Revoca gli accessi di questo browser» sa solo scollegare tutti, quindi chiede conferma. */
  const [confirmOldHub, setConfirmOldHub] = useState(false);
  const accountName = useStudyStore((state) => selectPreferences(state).displayName.trim());
  const trusted = trustedWritesActive(link.policy);
  const localPage = isLocalPage(window.location.origin);
  const published = window.location.hostname === "massimilianociconte.github.io";
  const hostedHub = published ? normalizePublicHub(import.meta.env.VITE_AGENT_HUB_ORIGIN ?? "") : null;
  const status = agentDeskStatus({ paired: link.paired, hub: link.hub, attempted: link.attempted });
  const pairReady = localPage
    ? code.replace(/[^A-Za-z0-9]/g, "").length === 8
    : code.trim().length >= 20 && !/\s/.test(code.trim());

  const revokeMine = async () => {
    if (!link.paired) {
      await revokeAgentAccess("browser");
      return;
    }
    setBusy(true);
    try {
      // Mai una revoca limitata a un hub di prima o di versione ignota: la scollegherebbe a tutti.
      if ((await checkScopedRevoke()) === "allOnly") setConfirmOldHub(true);
      else await revokeAgentAccess("browser");
    } finally {
      setBusy(false);
    }
  };

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
      <section aria-labelledby="agent-connect-title" className="grid grid-cols-1 gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="agent-connect-title" className="text-base font-black">{AGENT_DESK_TEXT.connectTitle}</h4>
          <span className={`inline-flex min-h-8 items-center rounded-full px-3 text-sm font-black ${TONE_CLASS[status.tone]}`}>{status.label}</span>
        </div>

        {link.error ? <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">{link.error}</p> : null}
        {link.notice ? <p role="status" className="rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">{link.notice}</p> : null}

        {link.paired ? null : (
          <>
            <form
              className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
              onSubmit={(event) => {
                event.preventDefault();
                void submitCode();
              }}
            >
              <Field label={localPage ? AGENT_DESK_TEXT.codeLabel : AGENT_DESK_TEXT.keyLabel}>
                <input
                  className={inputClass}
                  value={code}
                  onChange={(event) => setCode(localPage ? event.target.value.toUpperCase() : event.target.value)}
                  placeholder={localPage ? AGENT_DESK_TEXT.codePlaceholder : AGENT_DESK_TEXT.keyPlaceholder}
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="text"
                  aria-describedby="agent-pair-help"
                />
              </Field>
              <Button type="submit" variant="primary" icon="Link" disabled={busy || !pairReady}>
                {AGENT_DESK_TEXT.pairButton}
              </Button>
            </form>
            <p id="agent-pair-help" className={MUTED}>
              {localPage
                ? <>Il codice compare nel terminale quando avvii <code className="font-black">npm run agent</code> nella cartella di StudyOS. Vale 15 minuti e si usa una volta sola.</>
                : AGENT_DESK_TEXT.keyHelp}
            </p>
          </>
        )}

        {hostedHub ? (
          <div className="grid grid-cols-1 gap-2">
            <p className={MUTED}>{AGENT_DESK_TEXT.addressIntro}</p>
            <CopyAddress value={`${hostedHub}/mcp`} />
          </div>
        ) : null}

        {link.paired ? (
          <>
            {localPage ? null : <p className={MUTED}>{AGENT_DESK_TEXT.pairedHint}</p>}
            <div className="flex flex-wrap gap-2">
              <Button variant="soft" icon="LogOut" onClick={() => disconnectAgent()}>{AGENT_DESK_TEXT.disconnectBrowser}</Button>
            </div>
          </>
        ) : null}

        {accountName ? null : (
          <p className={MUTED}>
            {agentAccountLabels.unnamed}{" "}
            <a href="#settings-profilo" className="font-black text-[var(--accent-ink)] underline underline-offset-2">{agentAccountLabels.toProfile}</a>
          </p>
        )}
      </section>

      {trusted && link.policy.trustedWritesUntil ? (
        <div className="flex flex-wrap items-center gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3">
          <p className="min-w-0 flex-1 text-sm font-bold">{AGENT_DESK_TEXT.trustedUntil(when(link.policy.trustedWritesUntil))}</p>
          <Button variant="ghost" onClick={() => clearTrustedWrites()}>{AGENT_DESK_TEXT.trustBack}</Button>
        </div>
      ) : null}

      <RemoteConnector hub={hostedHub} accountName={accountName} paired={link.paired} />

      {link.paired || (cloudConfigured && signedIn) ? (
        <div className="grid grid-cols-1 gap-2">
          {confirmOldHub ? (
            <ConfirmWithError
              text={`${AGENT_DESK_TEXT.oldHubAllOnly} ${AGENT_DESK_TEXT.revokeAllConfirm}`}
              confirmLabel={AGENT_DESK_TEXT.revokeAllConfirmLabel}
              icon="Shield"
              onCancel={() => setConfirmOldHub(false)}
              onConfirm={async () => {
                const failure = await revokeAgentAccess("all");
                if (!failure) setConfirmOldHub(false);
                return failure;
              }}
            />
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" icon="Shield" disabled={busy} onClick={() => void revokeMine()}>
                {AGENT_DESK_TEXT.revokeButton}
              </Button>
            </div>
          )}
          <p className={MUTED}>{agentAccountLabels.revokeHint}</p>
          {link.paired ? (
            confirmAll ? (
              <ConfirmWithError
                text={AGENT_DESK_TEXT.revokeAllConfirm}
                confirmLabel={AGENT_DESK_TEXT.revokeAllConfirmLabel}
                icon="Shield"
                onCancel={() => setConfirmAll(false)}
                onConfirm={async () => {
                  const failure = await revokeAgentAccess("all");
                  if (!failure) setConfirmAll(false);
                  return failure;
                }}
              />
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="ghost" onClick={() => setConfirmAll(true)}>{AGENT_DESK_TEXT.revokeAllButton}…</Button>
              </div>
            )
          ) : null}
        </div>
      ) : null}

      <details className="rounded-[20px] bg-[var(--surface-soft)] p-3">
        <summary className="cursor-pointer text-sm font-black text-[var(--text)]">
          {AGENT_DESK_TEXT.advanced}
          <span className="mt-0.5 block text-xs font-bold text-[var(--muted)]">{AGENT_DESK_TEXT.advancedHint}</span>
        </summary>
        <div className="mt-3 grid grid-cols-1 gap-4">
          <div>
            <h4 className="text-sm font-black">{AGENT_DESK_TEXT.rulesTitle}</h4>
            <p className={`mt-1 ${MUTED}`}>{AGENT_DESK_TEXT.rulesBody}</p>
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
                        className={`min-h-11 rounded-full border px-4 text-sm font-black ${active ? "border-transparent bg-[var(--accent)] text-[#10131d]" : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"}`}
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
              {AGENT_DESK_TEXT.trustWrites}
            </Button>
            {trusted ? <Button variant="ghost" onClick={() => clearTrustedWrites()}>{AGENT_DESK_TEXT.trustBack}</Button> : null}
          </div>

          <div className="grid grid-cols-1 gap-1">
            <h4 className="text-sm font-black">{agentAccountLabels.title}</h4>
            {accountName ? <p className={MUTED}>{agentAccountLabels.named(accountName)}</p> : null}
            <p className={MUTED}>{agentAccountLabels.help(localPage)}</p>
          </div>

          <div>
            <h4 className="text-sm font-black">{AGENT_DESK_TEXT.activityTitle}</h4>
            {link.audit.length ? (
              <ul className="mt-2 grid grid-cols-1 gap-2">
                {link.audit.map((entry) => (
                  <li key={entry.id} className="rounded-[18px] bg-[var(--surface)] px-3 py-2">
                    <p className="text-sm font-black">{entry.summary}</p>
                    <p className="text-xs font-bold text-[var(--muted)]">
                      {when(entry.at)} · {entry.actor} · {STATUS_LABEL[entry.status]}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`mt-1 ${MUTED}`}>{AGENT_DESK_TEXT.activityEmpty}</p>
            )}
          </div>
        </div>
      </details>

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
        <p className="mt-3">Con la finestra di sviluppo, Claude Code, Cursor e gli altri programmi sul computer si collegano anche con questo comando, lanciato dalla cartella di StudyOS:</p>
        <code className="mt-2 block overflow-x-auto rounded-[14px] bg-[var(--surface)] p-3 text-xs font-black text-[var(--text)]">node --import ./scripts/lib/register-ts.mjs ./scripts/agent.ts --stdio</code>
        <p className="mt-3">
          {hostedHub
            ? "ChatGPT e Claude, sul web e nelle app, usano l’indirizzo qui sopra. L’accesso passa da OAuth e la conferma compare in questa schermata. Tieni aperta questa pagina, anche dal telefono: i dati restano in questo browser."
            : "ChatGPT sul web parla con il sito pubblicato, non con questa finestra di sviluppo. Qui colleghi solo i programmi sul computer, con il codice del terminale."}
        </p>
        <p className="mt-3">
          La finestra aperta con <code className="font-black">npm run dev</code> è una copia a parte e parla solo con <code className="font-black">npm run agent</code> sul computer.
        </p>
      </details>
    </div>
  );
}
