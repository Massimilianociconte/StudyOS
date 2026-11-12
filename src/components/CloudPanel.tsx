import { useEffect, useRef, useState } from "react";
import { Button, Field, Panel, PasswordInput, Pill, inputClass } from "./ui";
import { whenPersisted } from "../lib/persistence";
import { signOutThisDevice } from "../lib/deviceSignOut";
import { setCloudSyncState } from "../lib/cloudSyncState";
import { ACCOUNT_TEXT } from "../lib/labels/account";
import { useStudyStore } from "../store/useStudyStore";
import {
  isCloudConfigured,
  resendConfirmation,
  signIn,
  signOut,
  signUp
} from "../lib/supabase";
import {
  forcePullNow,
  forcePushNow,
  getCloudSyncState,
  requestSync,
  subscribeCloudSync,
  whenSyncIdle,
  type CloudSyncState
} from "../lib/cloudSync";

const PENDING_EMAIL_KEY = "studyos-pending-confirmation-email";

const formatRelative = (iso: string | null) => {
  if (!iso) return "mai";
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 5) return "adesso";
  if (sec < 60) return "pochi secondi fa";
  const min = Math.round(sec / 60);
  if (min < 60) return min === 1 ? "1 minuto fa" : `${min} minuti fa`;
  const hr = Math.round(min / 60);
  if (hr < 24) return hr === 1 ? "1 ora fa" : `${hr} ore fa`;
  return new Date(iso).toLocaleString("it-IT", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
};

const statusLabel = (sync: CloudSyncState) => {
  if (!sync.session) return sync.status === "off" ? "Non disponibile" : "Non connesso";
  if (sync.status === "offline") return "Senza connessione";
  if (sync.status === "syncing") return "Sincronizzazione…";
  if (sync.status === "error") return "Da controllare";
  if (sync.pendingChanges) return sync.pendingCount === 1 ? "1 modifica da inviare" : `${sync.pendingCount} modifiche da inviare`;
  return "Sincronizzato";
};

type Mode = "signin" | "signup";

export function CloudPanel() {
  const [sync, setSync] = useState<CloudSyncState>(() => getCloudSyncState());
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ kind: "ok" | "err" | "pending"; text: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  // «Esci dall'account» chiede sul posto: tenere i dati qui o toglierli (dispositivo non tuo).
  const [leaving, setLeaving] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(PENDING_EMAIL_KEY) : null
  );
  const configured = isCloudConfigured();

  useEffect(() => {
    if (!configured) return;
    return subscribeCloudSync(setSync);
  }, [configured]);

  // Uscito altrove (altra scheda, sessione scaduta): la domanda non resta pronta per il prossimo accesso.
  useEffect(() => {
    if (!sync.session) setLeaving(false);
  }, [sync.session]);

  useEffect(() => {
    if (sync.session && pendingEmail) {
      localStorage.removeItem(PENDING_EMAIL_KEY);
      setPendingEmail(null);
    }
  }, [sync.session, pendingEmail]);

  if (!configured) {
    return (
      <Panel>
        <h3 className="mb-2 text-2xl font-black">Account non disponibile</h3>
        <p className="text-sm text-[var(--muted)]">
          In questa versione di StudyOS l'accesso con account non è attivo: i tuoi dati restano solo in questo browser.
        </p>
        <p className="mt-2 text-xs text-[var(--muted)]">
          Per chi gestisce l'app: servono VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY nel file .env.
        </p>
      </Panel>
    );
  }

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      setInfo({ kind: "err", text: "Scrivi email e password per accedere." });
      return;
    }
    setBusy(true);
    setInfo(null);
    try {
      await signIn(email.trim(), password);
      setPassword("");
      setInfo({ kind: "ok", text: "Accesso fatto. Da ora i tuoi dati si sincronizzano da soli su tutti i dispositivi." });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Accesso non riuscito. Riprova.";
      if (/email not confirmed/i.test(msg)) {
        localStorage.setItem(PENDING_EMAIL_KEY, email.trim());
        setPendingEmail(email.trim());
        setInfo({
          kind: "pending",
          text: "Email non ancora confermata. Apri il link che ti abbiamo inviato, poi torna qui e accedi di nuovo."
        });
      } else if (/invalid login credentials/i.test(msg)) {
        setInfo({
          kind: "err",
          text: "Email o password sbagliate. Se non hai ancora un account, scegli «Sono nuovo»."
        });
      } else {
        setInfo({ kind: "err", text: msg });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async () => {
    if (!email.trim() || password.length < 8) {
      setInfo({ kind: "err", text: "Scrivi un'email valida e una password di almeno 8 caratteri." });
      return;
    }
    setBusy(true);
    setInfo(null);
    try {
      const data = await signUp(email.trim(), password);
      setPassword("");
      if (data.session) {
        setInfo({ kind: "ok", text: "Account creato. Da ora i tuoi dati si sincronizzano da soli su tutti i dispositivi." });
      } else {
        localStorage.setItem(PENDING_EMAIL_KEY, email.trim());
        setPendingEmail(email.trim());
        setInfo({
          kind: "pending",
          text: `Quasi fatto: ti abbiamo mandato un'email a ${email.trim()}. Apri il link per confermare l'account, poi torna qui e accedi. Fino ad allora i dati restano solo in questo browser.`
        });
        setMode("signin");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Registrazione non riuscita. Riprova.";
      if (/already registered|already exists|user exists/i.test(msg)) {
        setInfo({ kind: "err", text: "Esiste già un account con questa email: accedi con la tua password." });
        setMode("signin");
      } else {
        setInfo({ kind: "err", text: msg });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleResend = async () => {
    if (!pendingEmail) return;
    setBusy(true);
    setInfo(null);
    try {
      await resendConfirmation(pendingEmail);
      setInfo({
        kind: "pending",
        text: `Nuova email di conferma inviata a ${pendingEmail}. Controlla anche lo spam.`
      });
    } catch (error) {
      setInfo({
        kind: "err",
        text: error instanceof Error ? error.message : "Invio non riuscito. Riprova tra qualche minuto."
      });
    } finally {
      setBusy(false);
    }
  };

  const handleClearPending = () => {
    localStorage.removeItem(PENDING_EMAIL_KEY);
    setPendingEmail(null);
    setInfo(null);
  };

  const cancelLeave = () => {
    setLeaving(false);
    // Il focus torna su «Esci dall'account», non sul body.
    window.setTimeout(() => actionsRef.current?.querySelector<HTMLElement>("[data-leave]")?.focus(), 0);
  };

  // Solo da questo dispositivo («local»): prima l'uscita era da tutti i dispositivi, anche dal tablet
  // di chi aveva fatto l'accesso qui solo per un momento.
  const leaveKeepingData = async () => {
    setBusy(true);
    setInfo(null);
    try {
      const result = await signOut("local");
      setLeaving(false);
      if (result.localOnly) {
        setInfo({ kind: "pending", text: ACCOUNT_TEXT.leftOffline });
        await whenPersisted().catch(() => undefined);
        window.location.reload();
        return;
      }
      setInfo({ kind: "ok", text: ACCOUNT_TEXT.leftKeep });
    } catch (error) {
      setInfo({ kind: "err", text: error instanceof Error ? error.message : ACCOUNT_TEXT.leaveFailed });
    } finally {
      setBusy(false);
    }
  };

  // Come «Ho dimenticato la password» (LockScreen): prima l'uscita solo da qui, poi i dati del
  // dispositivo si cancellano (nome, foto, materie…). Nell'account resta tutto.
  const leaveRemovingData = async () => {
    if (sync.pendingCount > 0) return;
    setBusy(true);
    setInfo(null);
    try {
      const signedOut = await signOutThisDevice({
        configured: true,
        signOut: () => signOut("local"),
        removeItem: (key) => window.localStorage.removeItem(key),
        dropSession: () => setCloudSyncState({ session: null, lastSync: null, status: "idle", error: undefined }),
        schedule: (fn, ms) => void window.setTimeout(fn, ms)
      });
      // Una sincronizzazione già partita finisce prima dello svuotamento (le sue righe tardive
      // vengono comunque scartate: la sessione non c'è più).
      await whenSyncIdle();
      await useStudyStore.getState().resetAllData({ propagate: false });
      // Profilo vuoto: si riparte da Home («Per iniziare»), non da Impostazioni. Solo a svuotamento
      // riuscito: se fallisce l'errore resta qui, visibile.
      useStudyStore.getState().setActiveView("dashboard");
      // Sessione tolta solo dallo storage: supabase-js può averne una copia in memoria, si riparte puliti.
      if (signedOut === "removed-here") window.location.reload();
      // Pannello ancora aperto (es. in un invito di gruppo): torna al modulo di accesso.
      setLeaving(false);
      setBusy(false);
    } catch (error) {
      setInfo({ kind: "err", text: error instanceof Error ? error.message : ACCOUNT_TEXT.leaveFailed });
      setBusy(false);
    }
  };

  const handleForcePull = async () => {
    if (
      !window.confirm(
        "Riscaricare tutto dall'account?\n\nPer ogni elemento salvato nell'account, la versione dell'account sostituisce quella di questo dispositivo. Gli elementi che esistono solo qui restano."
      )
    )
      return;
    setBusy(true);
    setInfo(null);
    try {
      await forcePullNow();
    } finally {
      setBusy(false);
    }
  };

  const handleForcePush = async () => {
    setBusy(true);
    setInfo(null);
    try {
      await forcePushNow();
    } finally {
      setBusy(false);
    }
  };

  const handleSyncNow = async () => {
    setBusy(true);
    try {
      await requestSync();
    } finally {
      setBusy(false);
    }
  };

  const session = sync.session;
  const tone =
    info?.kind === "ok"
      ? "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success-text)]"
      : info?.kind === "err"
      ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger-text)]"
      : "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning-text)]";

  return (
    <Panel>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-2xl font-black">{session ? "Sei connesso" : "Accedi o crea un account"}</h3>
          <p className="text-sm text-[var(--muted)]">
            {session
              ? "Ogni modifica si salva subito su questo dispositivo e arriva all'account appena sei online, anche dopo un periodo senza rete."
              : "Con un account ritrovi gli stessi dati su ogni dispositivo. Ti servono solo un'email e una password."}
          </p>
          <p className="mt-2 text-xs font-bold text-[var(--warning-text)]">
            Nell'account i dati sono salvati senza cifratura: la protezione con password di StudyOS vale solo su questo dispositivo.
          </p>
        </div>
        <Pill active={sync.status === "idle" && !!session} className="shrink-0">
          {statusLabel(sync)}
        </Pill>
      </div>

      {session ? (
        <div className="grid grid-cols-1 gap-3">
          <div className="quiet-panel p-4">
            <p className="text-xs font-black uppercase text-[var(--faint)]">Il tuo account</p>
            <p className="font-black">{session.user.email}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {session.user.email_confirmed_at ? "Email confermata" : "Email non ancora confermata"} · Ultima sincronizzazione: {formatRelative(sync.lastSync)}
            </p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Modifiche da inviare: {sync.pendingCount} · Aggiornamento in tempo reale: {sync.realtime ? "attivo" : "no, controllo ogni tanto"}
            </p>
          </div>

          {sync.warning ? (
            <p className="rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-sm font-bold text-[var(--warning-text)]">
              {sync.warning}
            </p>
          ) : null}

          {sync.error ? (
            <p className="rounded-[18px] border border-[var(--danger-border)] bg-[var(--danger-bg)] p-3 text-sm font-bold text-[var(--danger-text)]">
              {sync.error}
            </p>
          ) : null}

          {leaving ? (
            // Stesso schema delle domande sul posto (Scartare le modifiche?): niente finestra del browser.
            <div role="group" aria-labelledby="account-leave-title" className="quiet-panel grid grid-cols-1 gap-2 p-4">
              <p id="account-leave-title" className="text-sm font-black">
                {ACCOUNT_TEXT.leaveTitle}
              </p>
              <p className="text-sm font-bold text-[var(--muted)]">{ACCOUNT_TEXT.leaveText}</p>
              <p className="text-sm text-[var(--muted)]">{ACCOUNT_TEXT.leaveKeepHint}</p>
              <p className="text-sm text-[var(--muted)]">{ACCOUNT_TEXT.leaveRemoveHint}</p>
              {sync.pendingCount > 0 ? (
                <div className="grid grid-cols-1 gap-2 rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3">
                  <p className="text-sm font-bold text-[var(--warning-text)]">{ACCOUNT_TEXT.leavePending(sync.pendingCount)}</p>
                  {sync.warning ? <p className="text-sm font-bold text-[var(--warning-text)]">{sync.warning}</p> : null}
                  <div className="flex flex-wrap gap-2">
                    <Button icon="Sparkles" variant="soft" onClick={handleSyncNow} disabled={busy || sync.status === "syncing"}>
                      {ACCOUNT_TEXT.leaveSyncNow}
                    </Button>
                  </div>
                </div>
              ) : null}
              <div className="mt-1 flex flex-wrap justify-end gap-2">
                <Button variant="soft" onClick={cancelLeave} disabled={busy} autoFocus>
                  {ACCOUNT_TEXT.leaveCancel}
                </Button>
                <Button icon="LogOut" variant="soft" onClick={() => void leaveKeepingData()} disabled={busy}>
                  {ACCOUNT_TEXT.leaveKeep}
                </Button>
                <Button icon="Trash2" variant="danger" onClick={() => void leaveRemovingData()} disabled={busy || sync.pendingCount > 0}>
                  {ACCOUNT_TEXT.leaveRemove}
                </Button>
              </div>
            </div>
          ) : (
            <div ref={actionsRef} className="flex flex-wrap gap-2">
              <Button icon="Sparkles" variant="soft" onClick={handleSyncNow} disabled={busy || sync.status === "syncing"}>
                Sincronizza ora
              </Button>
              <Button
                icon="LogOut"
                variant="danger"
                data-leave=""
                onClick={() => {
                  setInfo(null);
                  setLeaving(true);
                }}
                disabled={busy}
              >
                Esci dall'account
              </Button>
              <Button icon="Settings" variant="ghost" aria-expanded={showAdvanced} onClick={() => setShowAdvanced((value) => !value)}>
                {showAdvanced ? "Nascondi altre opzioni" : "Altre opzioni"}
              </Button>
            </div>
          )}

          {showAdvanced ? (
            <div className="quiet-panel grid grid-cols-1 gap-2 p-4">
              <p className="text-xs font-bold text-[var(--muted)]">
                Servono solo se qualcosa non torna tra i dispositivi: di solito la sincronizzazione automatica basta.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button icon="Upload" variant="soft" onClick={handleForcePush} disabled={busy}>
                  Invia di nuovo tutto all'account
                </Button>
                <Button icon="Download" variant="soft" onClick={handleForcePull} disabled={busy}>
                  Riscarica tutto dall'account
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          <div className="rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-xs font-bold text-[var(--warning-text)]">
            Per ora i tuoi dati sono solo in questo browser. Accedi (dopo aver confermato l'email) per ritrovarli anche sugli altri dispositivi.
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              aria-pressed={mode === "signin"}
              onClick={() => {
                setMode("signin");
                setInfo(null);
              }}
              className={`min-h-11 rounded-[18px] border px-3 text-sm font-black ${
                mode === "signin"
                  ? "border-transparent bg-[var(--accent)] text-[#10131d]"
                  : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"
              }`}
            >
              Ho già un account
            </button>
            <button
              type="button"
              aria-pressed={mode === "signup"}
              onClick={() => {
                setMode("signup");
                setInfo(null);
              }}
              className={`min-h-11 rounded-[18px] border px-3 text-sm font-black ${
                mode === "signup"
                  ? "border-transparent bg-[var(--accent)] text-[#10131d]"
                  : "border-[var(--border)] bg-[var(--surface-soft)] text-[var(--muted)]"
              }`}
            >
              Sono nuovo
            </button>
          </div>

          {pendingEmail && mode === "signin" ? (
            <div className="rounded-[18px] border border-[var(--warning-border)] bg-[var(--warning-bg)] p-3 text-sm font-bold text-[var(--warning-text)]">
              <p>
                Manca la conferma di <span className="font-black">{pendingEmail}</span>: apri il link che ti abbiamo inviato, poi torna qui e accedi.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button icon="Mail" variant="soft" onClick={handleResend} disabled={busy}>
                  Invia di nuovo l'email
                </Button>
                <Button icon="X" variant="ghost" onClick={handleClearPending} disabled={busy}>
                  Usa un'altra email
                </Button>
              </div>
            </div>
          ) : null}

          {/* Un vero modulo: Invio (o «Vai» sulla tastiera del telefono) invia come il pulsante. */}
          <form
            className="grid grid-cols-1 gap-3"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (busy) return;
              void (mode === "signin" ? handleSignIn() : handleSignUp());
            }}
          >
            <Field label="Email">
              <input
                className={inputClass}
                type="email"
                inputMode="email"
                autoComplete={mode === "signup" ? "email" : "username"}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onKeyDown={(event) => {
                  // Invio sull'email con la password ancora vuota: si passa alla password invece di inviare.
                  if (event.key !== "Enter" || password) return;
                  event.preventDefault();
                  passwordRef.current?.focus();
                }}
                placeholder="Es. nome@esempio.it"
              />
            </Field>
            <Field label={mode === "signup" ? "Scegli una password (almeno 8 caratteri)" : "Password"}>
              <PasswordInput
                ref={passwordRef}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                enterKeyHint={mode === "signup" ? "done" : "go"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>

            {mode === "signin" ? (
              <Button type="submit" icon="LogIn" variant="primary" disabled={busy}>
                Accedi
              </Button>
            ) : (
              <Button type="submit" icon="UserPlus" variant="primary" disabled={busy}>
                Crea account
              </Button>
            )}
          </form>
        </div>
      )}

      {info ? (
        <p role="status" className={`mt-4 rounded-[18px] border p-3 text-sm font-bold ${tone}`}>
          {info.text}
        </p>
      ) : null}
    </Panel>
  );
}
