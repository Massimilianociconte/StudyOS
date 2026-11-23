// Conferma del connettore remoto dal sito (#collega=<id>): chi chiede, per quale account, il codice
// da confrontare con la pagina dell'assistente, i permessi; «Consenti» crea il permesso cloud
// dell'account con cui è fatto l'accesso e torna all'assistente. Logica in src/lib/agentSiteConsent.ts.
import { useEffect, useState } from "react";
import { agentCloudLabels } from "../lib/labels";
import { SITE_CONSENT_TEXT } from "../lib/labels/agents";
import { checkSiteConsent, clearSiteConsent, decideSiteConsent, fetchSiteConsent, profileSlug, type SiteConsentRequest } from "../lib/agentSiteConsent";
import { cloudConfigured, getCloudSyncState, subscribeCloudSync } from "../lib/cloudSyncState";
import { requestSettingsSection, type SettingsSection } from "../lib/settingsJump";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { Icon } from "./Icon";
import { Button, Drawer } from "./ui";

const MUTED = "text-sm font-bold text-[var(--muted)]";

const useCloud = () => {
  const read = () => {
    const sync = getCloudSyncState();
    return { signedIn: cloudConfigured && Boolean(sync.session), syncing: sync.status === "syncing" };
  };
  const [cloud, setCloud] = useState(read);
  useEffect(() => subscribeCloudSync(() => setCloud(read())), []);
  return cloud;
};

type Phase =
  | { kind: "loading" }
  | { kind: "error"; text: string }
  | { kind: "ready"; request: SiteConsentRequest }
  | { kind: "working"; request: SiteConsentRequest }
  | { kind: "leaving"; text: string };

export function AgentSiteConsent({ id }: { id: string }) {
  const { signedIn, syncing } = useCloud();
  const displayName = useStudyStore((state) => selectPreferences(state).displayName ?? "");
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [write, setWrite] = useState(true);
  const [error, setError] = useState("");
  // Nascosto mentre la persona fa l'accesso o scrive il nome: torna da solo quando è fatto.
  const [away, setAway] = useState<"signIn" | "name" | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setPhase({ kind: "loading" });
    fetchSiteConsent(id, { offline: SITE_CONSENT_TEXT.offline })
      .then((request) => {
        if (!live) return;
        setWrite(request.scopes.includes("studyos:write") || !request.scopes.length);
        setPhase({ kind: "ready", request });
      })
      .catch((reason: unknown) => {
        if (live) setPhase({ kind: "error", text: reason instanceof Error ? reason.message : SITE_CONSENT_TEXT.offline });
      });
    return () => {
      live = false;
    };
  }, [id, attempt]);

  useEffect(() => {
    if (away === "signIn" && signedIn) setAway(null);
    if (away === "name" && profileSlug(displayName)) setAway(null);
  }, [away, signedIn, displayName]);

  const goTo = (section: SettingsSection, reason: "signIn" | "name") => {
    setAway(reason);
    requestSettingsSection(section);
    useStudyStore.getState().setActiveView("settings");
  };

  const decide = async (request: SiteConsentRequest, approve: boolean) => {
    setError("");
    setPhase({ kind: "working", request });
    try {
      const { continueUrl } = await decideSiteConsent(id, { approve, write, clientName: request.clientName }, { offline: SITE_CONSENT_TEXT.offline });
      clearSiteConsent();
      setPhase({ kind: "leaving", text: approve ? SITE_CONSENT_TEXT.done : SITE_CONSENT_TEXT.denied });
      window.location.assign(continueUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : agentCloudLabels.failed);
      setPhase({ kind: "ready", request });
    }
  };

  const request = phase.kind === "ready" || phase.kind === "working" ? phase.request : null;
  const check = request ? checkSiteConsent(request, { signedIn, displayName }) : null;
  const title = request ? SITE_CONSENT_TEXT.title(request.clientName) : SITE_CONSENT_TEXT.eyebrow;

  return (
    <Drawer open={!away} onClose={clearSiteConsent} title={title} eyebrow={SITE_CONSENT_TEXT.eyebrow} width="max-w-[520px]" dismissOutside={false}>
      <div className="grid grid-cols-1 gap-3">
        {phase.kind === "loading" ? <p role="status" className={MUTED}>{SITE_CONSENT_TEXT.loading}</p> : null}
        {phase.kind === "leaving" ? <p role="status" className="text-sm font-black">{phase.text}</p> : null}
        {phase.kind === "error" ? (
          <>
            <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">{phase.text}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="soft" icon="RotateCcw" onClick={() => setAttempt((value) => value + 1)}>{SITE_CONSENT_TEXT.retry}</Button>
              <Button variant="ghost" onClick={clearSiteConsent}>{SITE_CONSENT_TEXT.later}</Button>
            </div>
          </>
        ) : null}
        {request && check ? (
          <>
            <p className={MUTED}>{agentCloudLabels.consentBody(request.account)}</p>
            <div className="rounded-[18px] bg-[var(--surface-soft)] p-3">
              <p className="text-xs font-black uppercase text-[var(--faint)]">{SITE_CONSENT_TEXT.code}</p>
              <p className="text-2xl font-black tracking-[0.08em] tabular-nums">{request.code}</p>
              <p className="mt-1 text-xs font-bold text-[var(--muted)]">{SITE_CONSENT_TEXT.codeHint}</p>
            </div>
            {request.redirectHost ? <p className={MUTED}>{SITE_CONSENT_TEXT.returnTo(request.redirectHost)}</p> : null}

            {check.ok ? (
              <>
                <p className="flex items-start gap-2 text-sm font-black">
                  <Icon name="AlertTriangle" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--danger-text)]" />
                  <span>{SITE_CONSENT_TEXT.onlyYours}</span>
                </p>
                <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                  <input type="checkbox" checked disabled />
                  {SITE_CONSENT_TEXT.read}
                </label>
                <label className="flex min-h-11 items-center gap-2 text-sm font-bold">
                  <input type="checkbox" checked={write} onChange={(event) => setWrite(event.target.checked)} />
                  {SITE_CONSENT_TEXT.write}
                </label>
              </>
            ) : (
              <p role="status" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
                {check.reason === "signIn"
                  ? SITE_CONSENT_TEXT.signIn
                  : check.reason === "noName"
                    ? syncing ? SITE_CONSENT_TEXT.loadingName : SITE_CONSENT_TEXT.noName
                    : check.reason === "otherAccount"
                      ? SITE_CONSENT_TEXT.otherAccount(request.account, displayName.trim())
                      : check.reason === "expired"
                        ? SITE_CONSENT_TEXT.expired
                        : SITE_CONSENT_TEXT.decided}
              </p>
            )}
            {error ? <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">{error}</p> : null}

            <div className="flex flex-wrap gap-2">
              {check.ok ? (
                <Button variant="primary" icon="Check" disabled={phase.kind === "working"} onClick={() => void decide(request, true)}>
                  {phase.kind === "working" ? SITE_CONSENT_TEXT.working : SITE_CONSENT_TEXT.approve}
                </Button>
              ) : check.reason === "signIn" ? (
                <Button variant="primary" icon="LogIn" onClick={() => goTo("account", "signIn")}>{SITE_CONSENT_TEXT.toSignIn}</Button>
              ) : check.reason === "noName" && !syncing ? (
                <Button variant="primary" icon="User" onClick={() => goTo("profilo", "name")}>{SITE_CONSENT_TEXT.toProfile}</Button>
              ) : null}
              {check.ok || check.reason === "otherAccount" || check.reason === "signIn" || check.reason === "noName" ? (
                <Button variant="soft" disabled={phase.kind === "working"} onClick={() => void decide(request, false)}>{SITE_CONSENT_TEXT.deny}</Button>
              ) : (
                <Button variant="soft" onClick={clearSiteConsent}>{SITE_CONSENT_TEXT.later}</Button>
              )}
            </div>
          </>
        ) : null}
      </div>
    </Drawer>
  );
}
