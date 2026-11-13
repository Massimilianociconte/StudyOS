import { useEffect, useState } from "react";
import type { StudyGroup } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { cloudConfigured } from "../lib/cloudSyncState";
import { useCloudSession } from "../hooks/useCloudSession";
import { groupInviteLink, groupInviteMessage } from "../lib/groups";
import {
  PENDING_INVITE_EVENT,
  clearPendingInvite,
  confirmPendingInvite,
  readPendingInvite,
  telegramShareUrl,
  whatsappShareUrl,
  type PendingInvite
} from "../lib/groupInvite";
import {
  getActor,
  groupNameRejected,
  joinGroupWithCode,
  logSharedActivity,
  previewInvite,
  publishGroup,
  pullSharedUpdates,
  regenerateInviteCode,
  rememberInviteRecipient,
  type Actor,
  type InvitePreviewResult
} from "../lib/groupSync";
import { peopleLabels } from "../lib/labels";
import { GROUP_SYNC_TEXT } from "../lib/labels/groups";
import { peopleCauseText, personName, type FoundPerson } from "../lib/people";
import { Button, Drawer } from "./ui";
import { Icon } from "./Icon";
import { CloudPanel } from "./CloudPanel";
import { FindPerson } from "./FindPerson";
import { InviteQr, qrPngBlob } from "./InviteQr";
import { InlineConfirm } from "./InlineConfirm";

// Spostati in hooks/useCloudSession, components/InviteQr e components/InlineConfirm: i vecchi import da qui restano validi.
export { useCloudSession, InviteQr, InlineConfirm };

/** Invito ricevuto via link/QR in attesa (si aggiorna anche da altre schede). */
export function usePendingInvite() {
  const [pending, setPending] = useState<PendingInvite | null>(() => readPendingInvite());
  useEffect(() => {
    const update = () => setPending(readPendingInvite());
    window.addEventListener(PENDING_INVITE_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(PENDING_INVITE_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return pending;
}

const shareLinkClass =
  "motion-safe inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-4 text-sm font-extrabold text-[var(--text)] hover:bg-[var(--surface)]";

type Reach = "no-cloud" | "login" | "device-only" | "publishing" | "ready" | "pending" | "name-too-long";

const REACH_TEXT: Record<Reach, { tone: "ok" | "warn"; text: string }> = {
  ready: { tone: "ok", text: "Gli inviti sono attivi: chi apre il link o il QR entra nel gruppo con il proprio account." },
  publishing: { tone: "ok", text: "Sto preparando il gruppo per gli inviti…" },
  pending: { tone: "warn", text: "Il gruppo non è ancora online, quindi gli inviti potrebbero non funzionare. Controlla la connessione e riapri questa finestra tra poco." },
  "name-too-long": { tone: "warn", text: GROUP_SYNC_TEXT.nameTooLong },
  login: { tone: "warn", text: "Per invitare altre persone devi accedere al tuo account: finché non accedi, link, QR e codice non funzionano per gli altri." },
  "device-only": { tone: "warn", text: "Questo gruppo è stato creato senza account, quindi non si può condividere. Per invitare altre persone accedi e crea un nuovo gruppo." },
  "no-cloud": { tone: "warn", text: "Gli account non sono attivi in questa versione dell'app: link, QR e codice funzionano solo su questo dispositivo." }
};

/** Tutti i modi per invitare: link (WhatsApp, Telegram, email, condivisione di sistema), QR, codice, account. */
export function InviteSheet({ group, actor, onClose, onNotice, onLogin }: { group: StudyGroup; actor: Actor; onClose: () => void; onNotice: (text: string) => void; onLogin?: () => void }) {
  const session = useCloudSession();
  const loggedIn = Boolean(session);
  const myRole = group.members.find((member) => member.userId === actor.userId)?.role;
  const isOwner = group.ownerId === actor.userId;
  const canInvitePerson = myRole === "owner" || myRole === "admin";
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [publishing, setPublishing] = useState(false);
  // Il server ha rifiutato il nome (troppo lungo): non si riprova da soli, lo si dice (groupNameRejected).
  const [nameRejected, setNameRejected] = useState(() => groupNameRejected(group.id));
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const code = group.inviteCode;
  const link = groupInviteLink(code);
  const message = groupInviteMessage(group.name, actor.displayName, code);
  const shareText = `${actor.displayName} ti invita nel gruppo di studio "${group.name}" su StudyOS`;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const deviceOnly = group.ownerId.startsWith("local-");

  // Gruppo creato con l'account ma non ancora pubblicato (es. offline alla creazione): lo si
  // pubblica qui, altrimenti chi apre il link non lo troverebbe.
  useEffect(() => {
    if (!loggedIn || group.sharedAt || !isOwner || deviceOnly) return;
    let alive = true;
    setPublishing(true);
    void publishGroup(group).finally(() => {
      if (!alive) return;
      setPublishing(false);
      setNameRejected(groupNameRejected(group.id));
    });
    return () => {
      alive = false;
    };
    // Solo all'apertura o quando cambia lo stato di condivisione (non a ogni modifica del gruppo).
  }, [loggedIn, group.id, group.sharedAt]);

  // Un gruppo creato senza account non si può condividere neanche dopo l'accesso: lo si dice
  // subito, invece di chiedere un accesso che non basterebbe.
  const reach: Reach = !cloudConfigured
    ? "no-cloud"
    : deviceOnly && !group.sharedAt
      ? "device-only"
      : !loggedIn
        ? "login"
        : group.sharedAt
          ? "ready"
          : publishing
            ? "publishing"
            : nameRejected
              ? "name-too-long"
              : "pending";
  const reachInfo = REACH_TEXT[reach];
  const showLogin = Boolean(onLogin) && cloudConfigured && !loggedIn && (reach === "login" || reach === "device-only");

  const copy = async (text: string, done: string) => {
    setError("");
    try {
      await navigator.clipboard.writeText(text);
      setStatus(done);
    } catch {
      setError("Copia non riuscita: tieni premuto sul testo e copialo a mano.");
    }
  };

  const shareLink = async () => {
    setError("");
    try {
      await navigator.share({ title: `Invito al gruppo "${group.name}"`, text: shareText, url: link });
      setStatus("Invito condiviso.");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      await copy(message, "Condivisione non disponibile: messaggio copiato, incollalo dove vuoi.");
    }
  };

  const qrFileName = `studyos-invito-${code.toLowerCase()}.png`;

  const downloadQr = async () => {
    setError("");
    try {
      const blob = await qrPngBlob(link);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = qrFileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus("QR scaricato: puoi stamparlo o inviarlo come immagine.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Non è stato possibile scaricare il QR. Riprova.");
    }
  };

  const shareQr = async () => {
    setError("");
    try {
      const file = new File([await qrPngBlob(link)], qrFileName, { type: "image/png" });
      if (!navigator.canShare?.({ files: [file] })) return void (await downloadQr());
      await navigator.share({ files: [file], title: `Invito al gruppo "${group.name}"`, text: `${shareText}: ${link}` });
      setStatus("QR condiviso.");
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      await downloadQr();
    }
  };

  const regenerate = async () => {
    setConfirmRegenerate(false);
    setError("");
    setBusy(true);
    try {
      await regenerateInviteCode(group.id);
      setStatus("Fatto: i vecchi inviti non funzionano più. Manda il nuovo link a chi deve ancora entrare.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Non è stato possibile disattivare i vecchi inviti. Riprova.");
    } finally {
      setBusy(false);
    }
  };

  /** Invito all'account trovato: lo crea il server, poi si scarica per vederlo tra gli inviti mandati. */
  const invitePerson = async (person: FoundPerson): Promise<string | null> => {
    setError("");
    setStatus("");
    setBusy(true);
    try {
      const people = await import("../lib/peopleSync");
      const inviteId = await people.invitePersonToGroup(group.id, person.personId);
      const name = personName(person);
      // L'invito è già partito: da qui in poi un errore non lo annulla.
      await pullSharedUpdates();
      await rememberInviteRecipient(inviteId, name).catch(() => undefined);
      // Nella cronologia del gruppo solo il nome visibile, mai il @nome cercato.
      await logSharedActivity(group.id, actor.displayName, peopleLabels.groupActivity(person.displayName || peopleLabels.somebody)).catch(() => undefined);
      const text = peopleLabels.groupInvited(name);
      onNotice(text);
      setStatus(text);
      return null;
    } catch (cause) {
      return peopleCauseText(cause);
    } finally {
      setBusy(false);
    }
  };

  const mailto = `mailto:?subject=${encodeURIComponent(`Invito al gruppo "${group.name}" su StudyOS`)}&body=${encodeURIComponent(message)}`;

  return (
    <Drawer
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      eyebrow={<span className="text-xs font-black uppercase text-[var(--faint)]">{group.name}</span>}
      title="Invita i tuoi compagni"
      width="max-w-[560px]"
    >
      <div className="grid grid-cols-1 gap-5">
        <div
          className={`flex items-start gap-2 rounded-[18px] border p-3 text-sm font-bold ${
            reachInfo.tone === "ok"
              ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]"
              : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"
          }`}
        >
          <Icon name={reachInfo.tone === "ok" ? "ShieldCheck" : "AlertTriangle"} className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">
            {reachInfo.text}
            {showLogin ? (
              <span className="mt-2 block">
                <Button variant="soft" icon="LogIn" onClick={onLogin}>
                  Accedi
                </Button>
              </span>
            ) : null}
          </span>
        </div>

        {/* Esito vicino alle azioni più usate (link e QR), non in fondo al pannello. */}
        {status ? (
          <p role="status" className="rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--success-text)]">
            {status}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
            {error}
          </p>
        ) : null}

        <section aria-labelledby="invite-link-title">
          <h3 id="invite-link-title" className="text-sm font-black">Manda il link di invito</h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">È il modo più semplice: chi lo apre arriva al gruppo. Se non ha ancora un account può crearlo, poi entra da solo.</p>
          <button
            type="button"
            onClick={() => void copy(link, "Link copiato: incollalo in una chat o in un'email.")}
            className="mt-2 flex w-full min-w-0 items-center gap-2 rounded-[16px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 text-left"
            title="Copia il link di invito"
            aria-label="Copia il link di invito"
          >
            <Icon name="Link" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
            <span className="one-line-safe min-w-0 flex-1 font-mono text-xs font-bold">{link}</span>
            <Icon name="Copy" className="h-4 w-4 shrink-0 text-[var(--faint)]" />
          </button>
          <div className="mt-2 flex flex-wrap gap-2">
            {canShare ? (
              <Button variant="primary" icon="Share2" onClick={() => void shareLink()}>
                Condividi
              </Button>
            ) : null}
            <Button variant={canShare ? "soft" : "primary"} icon="Copy" onClick={() => void copy(link, "Link copiato: incollalo in una chat o in un'email.")}>
              Copia link di invito
            </Button>
          </div>
          <p className="mt-3 text-xs font-bold text-[var(--muted)]">Oppure mandalo con</p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            <a className={shareLinkClass} href={whatsappShareUrl(message)} target="_blank" rel="noopener noreferrer">
              <Icon name="MessageCircle" className="h-4 w-4" /> WhatsApp
            </a>
            <a className={shareLinkClass} href={telegramShareUrl(link, shareText)} target="_blank" rel="noopener noreferrer">
              <Icon name="Send" className="h-4 w-4" /> Telegram
            </a>
            <a className={shareLinkClass} href={mailto}>
              <Icon name="Mail" className="h-4 w-4" /> Email
            </a>
            <Button variant="soft" icon="Copy" onClick={() => void copy(message, "Messaggio copiato: incollalo in qualsiasi app.")}>
              Copia messaggio
            </Button>
          </div>
        </section>

        <section aria-labelledby="invite-qr-title" className="grid grid-cols-1 gap-4 sm:grid-cols-[176px_minmax(0,1fr)] sm:items-center">
          <div className="mx-auto w-44 overflow-hidden rounded-[18px] bg-white p-2 shadow-lift sm:mx-0">
            <InviteQr value={link} label={`QR code per entrare nel gruppo ${group.name}`} />
          </div>
          <div className="min-w-0">
            <h3 id="invite-qr-title" className="text-sm font-black">Oppure mostra il QR code</h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Fallo inquadrare con la fotocamera del telefono: si apre l'invito al gruppo. Comodo in aula o da stampare.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="soft" icon="Download" onClick={() => void downloadQr()}>
                Scarica il QR
              </Button>
              {canShare ? (
                <Button variant="soft" icon="Share2" onClick={() => void shareQr()}>
                  Invia il QR
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <section aria-labelledby="invite-code-title" className="quiet-panel p-3">
          <h3 id="invite-code-title" className="text-xs font-black uppercase text-[var(--faint)]">Oppure usa il codice del gruppo</h3>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-2xl font-black tracking-widest">{code}</p>
            <Button variant="soft" icon="Copy" onClick={() => void copy(code, "Codice copiato.")}>
              Copia codice
            </Button>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">Chi lo riceve lo inserisce in Gruppi → Entra con un codice.</p>
        </section>

        <section aria-labelledby="invite-person-title">
          <h3 id="invite-person-title" className="text-sm font-black">{peopleLabels.groupSectionTitle}</h3>
          {canInvitePerson ? (
            <>
              <p className="mt-0.5 text-xs text-[var(--muted)]">{peopleLabels.groupSectionHint}</p>
              <div className="mt-2">
                <FindPerson
                  onInvite={invitePerson}
                  disabled={!loggedIn || !group.sharedAt}
                  disabledHint={!loggedIn ? peopleLabels.needsLogin : peopleLabels.groupNotOnline}
                />
              </div>
            </>
          ) : (
            <p className="mt-0.5 text-xs text-[var(--muted)]">{peopleLabels.groupNotAllowed}</p>
          )}
        </section>

        {isOwner ? (
          <details className="quiet-panel p-3">
            <summary className="cursor-pointer text-sm font-extrabold">Altre opzioni: disattiva i vecchi inviti</summary>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Utile se un link è finito alla persona sbagliata. Crea un nuovo codice: link, QR e codice mandati finora smettono di funzionare. Chi è già nel gruppo resta dentro.
            </p>
            <div className="mt-2">
              {confirmRegenerate ? (
                <InlineConfirm
                  text="Disattivare i vecchi inviti? Link, QR e codice mandati finora non funzioneranno più e dovrai mandare quelli nuovi a chi deve ancora entrare."
                  confirmLabel="Disattiva i vecchi inviti"
                  icon="RefreshCw"
                  busy={busy}
                  onConfirm={() => void regenerate()}
                  onCancel={() => setConfirmRegenerate(false)}
                />
              ) : (
                <Button variant="soft" icon="RefreshCw" onClick={() => setConfirmRegenerate(true)} disabled={busy}>
                  Disattiva i vecchi inviti
                </Button>
              )}
            </div>
          </details>
        ) : null}
      </div>
    </Drawer>
  );
}

/** Perché si chiede l'accesso: gruppi (entrare, invitare) o condivisione (condividere, rispondere a un invito). */
export type LoginReason = "join" | "share" | "sharing" | "share-invite";

const LOGIN_COPY: Record<LoginReason, { eyebrow: string; title: string; text: string }> = {
  join: {
    eyebrow: "Invito a un gruppo",
    title: "Accedi o registrati per entrare",
    text: "L'invito resta salvato: appena accedi (o confermi l'email di registrazione su questo dispositivo) entri nel gruppo."
  },
  share: {
    eyebrow: "Gruppi",
    title: "Accedi al tuo account",
    text: "Con l'account puoi invitare i tuoi compagni nei tuoi gruppi ed entrare nei loro."
  },
  sharing: {
    eyebrow: "Condivisione",
    title: "Accedi per condividere",
    text: "Con l'account scegli cosa mostrare ad altre persone e vedi ciò che condividono con te, sempre aggiornato."
  },
  "share-invite": {
    eyebrow: "Invito a condividere",
    title: "Accedi o registrati per vedere l'invito",
    text: "L'invito resta salvato su questo dispositivo: dopo l'accesso vedi cosa ti viene condiviso e scegli se accettare."
  }
};

/** Accesso/registrazione senza lasciare Gruppi: si chiude da solo quando arriva la sessione. */
export function InviteLoginDrawer({ open, onClose, reason = "join" }: { open: boolean; onClose: () => void; reason?: LoginReason }) {
  const session = useCloudSession();
  const copy = LOGIN_COPY[reason];
  useEffect(() => {
    if (open && session) onClose();
  }, [open, session, onClose]);
  return (
    <Drawer open={open} onClose={onClose} eyebrow={<span className="text-xs font-black uppercase text-[var(--faint)]">{copy.eyebrow}</span>} title={copy.title} width="max-w-[560px]">
      <p className="mb-4 flex items-start gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
        <Icon name="UserPlus" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
        <span>{copy.text}</span>
      </p>
      <CloudPanel />
    </Drawer>
  );
}

/**
 * Invito arrivato da link o QR: anteprima del gruppo e un solo tocco per entrare. Entrare rende
 * visibili nome ed email agli altri membri, per questo serve una conferma esplicita (come per i
 * link di WhatsApp o Discord); se manca l'accesso, la conferma vale per dopo il login.
 */
export function PendingInviteCard({ onJoined, onLogin }: { onJoined: (groupId: string, name: string) => void; onLogin: () => void }) {
  const pending = usePendingInvite();
  const session = useCloudSession();
  const loggedIn = Boolean(session);
  const [preview, setPreview] = useState<InvitePreviewResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const code = pending?.code;

  useEffect(() => {
    setPreview(null);
    if (!code || !loggedIn) return;
    let alive = true;
    void previewInvite(code).then((result) => {
      if (alive) setPreview(result);
    });
    return () => {
      alive = false;
    };
  }, [code, loggedIn]);

  if (!pending) return null;

  const details = preview?.status === "ok" ? preview.preview : null;
  const invalid = preview?.status === "not-found";
  const needsLogin = cloudConfigured && !loggedIn;

  const join = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let groupId = details?.groupId ?? "";
      if (details?.isMember) {
        if (!useStudyStore.getState().studyGroups.some((group) => group.id === groupId)) await pullSharedUpdates();
      } else {
        const actor = await getActor();
        groupId = await joinGroupWithCode(pending.code, actor);
      }
      clearPendingInvite();
      const name = useStudyStore.getState().studyGroups.find((group) => group.id === groupId)?.name ?? details?.name ?? "il gruppo";
      onJoined(groupId, name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Non è stato possibile entrare nel gruppo. Riprova.");
    } finally {
      setBusy(false);
    }
  };

  const loginToJoin = () => {
    confirmPendingInvite();
    onLogin();
  };

  return (
    <section aria-label="Invito ricevuto" className="soft-panel mb-5 border border-[color-mix(in_srgb,var(--accent)_45%,transparent)] p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
          <Icon name="UserPlus" className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase text-[var(--accent-ink)]">Invito ricevuto</p>
          <h3 className="safe-text text-xl font-black leading-tight">{details ? details.name : "Un gruppo di studio ti aspetta"}</h3>
          {details ? (
            <p className="mt-1 text-sm text-[var(--muted)]">
              {details.memberCount} {details.memberCount === 1 ? "membro" : "membri"}
              {details.ownerName ? ` · gestito da ${details.ownerName}` : ""}
            </p>
          ) : (
            <p className="mt-1 font-mono text-sm font-bold text-[var(--muted)]">{pending.code}</p>
          )}
          {details?.description ? <p className="two-line-safe mt-1 text-sm text-[var(--muted)]">{details.description}</p> : null}
          {invalid ? (
            <p className="mt-2 text-sm font-bold text-[var(--danger-text)]">Questo invito non funziona più: il codice è stato cambiato o il gruppo eliminato. Chiedi un nuovo link a chi ti ha invitato.</p>
          ) : details?.isMember ? (
            <p className="mt-2 text-sm font-bold text-[var(--muted)]">Fai già parte di questo gruppo.</p>
          ) : needsLogin ? (
            <p className="mt-2 text-sm font-bold text-[var(--muted)]">
              {pending.confirmed
                ? "Appena accedi o completi la registrazione, entri nel gruppo in automatico."
                : "Per entrare devi accedere o creare un account. Gli altri membri vedranno il tuo nome e la tua email."}
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--faint)]">Gli altri membri vedranno il tuo nome e la tua email.</p>
          )}
          {error ? (
            <p role="alert" className="mt-2 text-sm font-bold text-[var(--danger-text)]">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {invalid ? null : needsLogin ? (
              <Button variant="primary" icon="LogIn" onClick={loginToJoin}>
                {pending.confirmed ? "Accedi" : "Accedi o registrati per entrare"}
              </Button>
            ) : (
              <Button variant="primary" icon={details?.isMember ? "Users" : "LogIn"} onClick={() => void join()} disabled={busy}>
                {busy ? "Entro…" : details?.isMember ? "Apri il gruppo" : "Entra nel gruppo"}
              </Button>
            )}
            <Button variant="ghost" onClick={clearPendingInvite} disabled={busy}>
              {invalid ? "Chiudi" : "Ignora"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
