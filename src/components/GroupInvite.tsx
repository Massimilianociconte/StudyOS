import { useEffect, useMemo, useState } from "react";
import { encode } from "uqr";
import type { StudyGroup } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { cloudConfigured, getCloudSyncState, subscribeCloudSync } from "../lib/cloudSyncState";
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
  joinGroupWithCode,
  logSharedActivity,
  previewInvite,
  pullSharedUpdates,
  pushSharedGroup,
  pushSharedInvite,
  pushSharedMembership,
  regenerateInviteCode,
  type Actor,
  type InvitePreviewResult
} from "../lib/groupSync";
import { Button, Drawer, Field, inputClass } from "./ui";
import { Icon } from "./Icon";
import { CloudPanel } from "./CloudPanel";

/** Sessione cloud corrente (senza caricare supabase-js: lo stato arriva dal motore di sync). */
export function useCloudSession() {
  const [session, setSession] = useState(() => getCloudSyncState().session);
  useEffect(() => subscribeCloudSync((state) => setSession(state.session)), []);
  return session;
}

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

const QR_OPTIONS = { ecc: "M", border: 2 } as const;

/** Moduli scuri come righe orizzontali: un solo path, nitido a ogni scala. */
const qrPath = (data: boolean[][]) => {
  let path = "";
  data.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x += 1;
        continue;
      }
      const start = x;
      while (x < row.length && row[x]) x += 1;
      path += `M${start} ${y}h${x - start}v1h-${x - start}z`;
    }
  });
  return path;
};

/** QR sempre scuro su bianco (anche in tema scuro): è quello che le fotocamere leggono meglio. */
export function InviteQr({ value, label }: { value: string; label: string }) {
  const qr = useMemo(() => encode(value, QR_OPTIONS), [value]);
  const path = useMemo(() => qrPath(qr.data), [qr]);
  return (
    <svg viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label={label} shapeRendering="crispEdges" className="block h-full w-full">
      <rect width={qr.size} height={qr.size} fill="#ffffff" />
      <path d={path} fill="#10131d" />
    </svg>
  );
}

const qrPngBlob = (value: string, scale = 12) =>
  new Promise<Blob>((resolve, reject) => {
    const qr = encode(value, QR_OPTIONS);
    const canvas = document.createElement("canvas");
    canvas.width = qr.size * scale;
    canvas.height = qr.size * scale;
    const context = canvas.getContext("2d");
    if (!context) return reject(new Error("Immagine non disponibile su questo browser."));
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#10131d";
    qr.data.forEach((row, y) => row.forEach((dark, x) => dark && context.fillRect(x * scale, y * scale, scale, scale)));
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Immagine non disponibile su questo browser."))), "image/png");
  });

const shareLinkClass =
  "motion-safe inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-[var(--surface-strong)] px-4 text-sm font-extrabold text-[var(--text)] hover:bg-[var(--surface)]";

type Reach = "no-cloud" | "login" | "device-only" | "publishing" | "ready" | "pending";

const REACH_TEXT: Record<Reach, { tone: "ok" | "warn"; text: string }> = {
  ready: { tone: "ok", text: "Link, QR e codice sono attivi: chi li apre entra nel gruppo con il proprio account." },
  publishing: { tone: "ok", text: "Preparo il gruppo per la condivisione…" },
  pending: { tone: "warn", text: "Il gruppo non è ancora sul cloud: riapri questa schermata tra poco o premi Aggiorna in Gruppi." },
  login: { tone: "warn", text: "Accedi al cloud per invitare altre persone: senza accesso link e codice valgono solo su questo dispositivo." },
  "device-only": { tone: "warn", text: "Questo gruppo è stato creato senza account e resta su questo dispositivo. Per invitare altre persone crea un nuovo gruppo dopo aver effettuato l'accesso." },
  "no-cloud": { tone: "warn", text: "Il cloud non è configurato: link, QR e codice funzionano solo su questo dispositivo." }
};

/** Tutti i modi per invitare: link (WhatsApp, Telegram, email, condivisione di sistema), QR, codice, account. */
export function InviteSheet({ group, actor, onClose, onNotice }: { group: StudyGroup; actor: Actor; onClose: () => void; onNotice: (text: string) => void }) {
  const session = useCloudSession();
  const loggedIn = Boolean(session);
  const myRole = group.members.find((member) => member.userId === actor.userId)?.role;
  const isOwner = group.ownerId === actor.userId;
  const canInviteByEmail = myRole === "owner" || myRole === "admin";
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [publishing, setPublishing] = useState(false);
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
    void (async () => {
      const owner = group.members.find((member) => member.userId === group.ownerId);
      if ((await pushSharedGroup(group)) && owner) await pushSharedMembership(group.id, owner);
    })().finally(() => {
      if (alive) setPublishing(false);
    });
    return () => {
      alive = false;
    };
    // Solo all'apertura o quando cambia lo stato di condivisione (non a ogni modifica del gruppo).
  }, [loggedIn, group.id, group.sharedAt]);

  const reach: Reach = !cloudConfigured
    ? "no-cloud"
    : !loggedIn
      ? "login"
      : group.sharedAt
        ? "ready"
        : deviceOnly
          ? "device-only"
          : publishing
            ? "publishing"
            : "pending";
  const reachInfo = REACH_TEXT[reach];

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
      setError(cause instanceof Error ? cause.message : "Download non riuscito.");
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
    if (!window.confirm("Generare un nuovo codice? Link e QR già inviati smetteranno di funzionare.")) return;
    setError("");
    setBusy(true);
    try {
      await regenerateInviteCode(group.id);
      setStatus("Nuovo codice attivo: i link e i QR precedenti non funzionano più.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Codice non aggiornato.");
    } finally {
      setBusy(false);
    }
  };

  const sendEmailInvite = async () => {
    if (busy) return;
    const recipient = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      setError("Inserisci un indirizzo email valido.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const store = useStudyStore.getState();
      const id = await store.createGroupInvite({
        groupId: group.id,
        groupName: group.name,
        groupDescription: group.description || undefined,
        fromUserId: actor.userId,
        fromDisplayName: actor.displayName,
        recipientEmail: recipient,
        code
      });
      const created = useStudyStore.getState().groupInvites.find((invite) => invite.id === id);
      if (created) await pushSharedInvite(created);
      await logSharedActivity(group.id, actor.displayName, `ha invitato ${recipient}`).catch(() => undefined);
      setEmail("");
      onNotice(`Invito inviato a ${recipient}: lo trova nella campanella e in Gruppi al prossimo accesso.`);
      setStatus(`Invito inviato a ${recipient}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Invito non riuscito.");
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
      eyebrow={<span className="text-xs font-black uppercase text-[var(--faint)]">Invita · {group.name}</span>}
      title="Porta qualcuno nel gruppo"
      width="max-w-[560px]"
    >
      <div className="grid grid-cols-1 gap-5">
        <p
          className={`flex items-start gap-2 rounded-[18px] border p-3 text-sm font-bold ${
            reachInfo.tone === "ok"
              ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]"
              : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"
          }`}
        >
          <Icon name={reachInfo.tone === "ok" ? "ShieldCheck" : "AlertTriangle"} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{reachInfo.text}</span>
        </p>

        <section aria-labelledby="invite-link-title">
          <h3 id="invite-link-title" className="text-sm font-black">Condividi il link</h3>
          <p className="mt-0.5 text-xs text-[var(--muted)]">Chi lo apre arriva all'ingresso del gruppo; se non ha ancora fatto l'accesso, entra appena accede o si registra.</p>
          <button
            type="button"
            onClick={() => void copy(link, "Link copiato.")}
            className="mt-2 flex w-full min-w-0 items-center gap-2 rounded-[16px] border border-[var(--border)] bg-[var(--surface-soft)] px-3 py-2.5 text-left"
            title="Copia il link"
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
            <h3 id="invite-qr-title" className="text-sm font-black">QR code</h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">Da far inquadrare con la fotocamera del telefono: si apre StudyOS sull'ingresso in questo gruppo. Utile in aula o stampato.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="soft" icon="Download" onClick={() => void downloadQr()}>
                Scarica QR
              </Button>
              {canShare ? (
                <Button variant="soft" icon="Share2" onClick={() => void shareQr()}>
                  Invia QR
                </Button>
              ) : null}
            </div>
          </div>
        </section>

        <section aria-labelledby="invite-code-title" className="quiet-panel p-3">
          <h3 id="invite-code-title" className="text-xs font-black uppercase text-[var(--faint)]">Codice del gruppo</h3>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <p className="font-mono text-2xl font-black tracking-widest">{code}</p>
            <Button variant="soft" icon="Copy" onClick={() => void copy(code, "Codice copiato.")}>
              Copia codice
            </Button>
          </div>
          <p className="mt-1 text-xs text-[var(--muted)]">Si inserisce in Gruppi → Unisciti con codice.</p>
          {isOwner ? (
            <button type="button" onClick={() => void regenerate()} disabled={busy} className="mt-2 inline-flex min-h-9 items-center gap-1.5 text-xs font-black text-[var(--muted)] hover:text-[var(--danger-text)]">
              <Icon name="RefreshCw" className="h-3.5 w-3.5" /> Genera un nuovo codice (disattiva link e QR inviati)
            </button>
          ) : null}
        </section>

        <section aria-labelledby="invite-email-title">
          <h3 id="invite-email-title" className="text-sm font-black">Invita un account StudyOS</h3>
          {canInviteByEmail ? (
            <>
              <p className="mt-0.5 text-xs text-[var(--muted)]">L'invito compare nella sua app (campanella e Gruppi) con Accetta e Rifiuta.</p>
              <Field label="Email dell'account" className="mt-2">
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input className={inputClass} type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="nome@esempio.it" inputMode="email" autoComplete="off" />
                  <Button variant="soft" icon="Send" onClick={() => void sendEmailInvite()} disabled={busy || !loggedIn}>
                    {busy ? "Invio…" : "Invia invito"}
                  </Button>
                </div>
              </Field>
            </>
          ) : (
            <p className="mt-0.5 text-xs text-[var(--muted)]">Gli inviti per email li mandano proprietario e amministratori; tu puoi condividere link, QR o codice.</p>
          )}
        </section>

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
      </div>
    </Drawer>
  );
}

/** Accesso/registrazione senza lasciare l'invito: si chiude da solo quando arriva la sessione. */
export function InviteLoginDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const session = useCloudSession();
  useEffect(() => {
    if (open && session) onClose();
  }, [open, session, onClose]);
  return (
    <Drawer open={open} onClose={onClose} eyebrow={<span className="text-xs font-black uppercase text-[var(--faint)]">Invito a un gruppo</span>} title="Accedi o registrati per entrare" width="max-w-[560px]">
      <p className="mb-4 flex items-start gap-2 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
        <Icon name="UserPlus" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
        <span>L'invito resta salvato: appena accedi (o confermi l'email della registrazione su questo dispositivo) entri nel gruppo con quell'account.</span>
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
      setError(cause instanceof Error ? cause.message : "Ingresso non riuscito. Riprova.");
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
            <p className="mt-2 text-sm font-bold text-[var(--danger-text)]">Questo invito non è più valido (codice cambiato o gruppo eliminato). Chiedi un nuovo link.</p>
          ) : details?.isMember ? (
            <p className="mt-2 text-sm font-bold text-[var(--muted)]">Fai già parte di questo gruppo.</p>
          ) : needsLogin ? (
            <p className="mt-2 text-sm font-bold text-[var(--muted)]">
              {pending.confirmed
                ? "Appena accedi o completi la registrazione entri nel gruppo da solo."
                : "Accedi o crea un account: entrerai nel gruppo con quell'account. Entrando, nome ed email sono visibili agli altri membri."}
            </p>
          ) : (
            <p className="mt-2 text-xs text-[var(--faint)]">Entrando, il tuo nome e la tua email sono visibili agli altri membri.</p>
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
