import { useEffect, useState } from "react";
import { Button, Field, Panel, Pill, inputClass } from "./ui";
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
  subscribeCloudSync,
  type CloudSyncState
} from "../lib/cloudSync";

const PENDING_EMAIL_KEY = "studyos-pending-confirmation-email";

const formatRelative = (iso: string | null) => {
  if (!iso) return "mai";
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 5) return "ora";
  if (sec < 60) return `${sec}s fa`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min fa`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h fa`;
  return new Date(iso).toLocaleString();
};

const statusLabel = (sync: CloudSyncState) => {
  if (!sync.session) return sync.status === "off" ? "non configurato" : "offline";
  if (sync.status === "syncing") return "sync in corso";
  if (sync.status === "error") return "errore";
  if (sync.pendingChanges) return "in attesa";
  return "auto-sync attivo";
};

type Mode = "signin" | "signup";

export function CloudPanel() {
  const [sync, setSync] = useState<CloudSyncState>(() => ({
    status: isCloudConfigured() ? "idle" : "off",
    session: null,
    lastSync: null,
    pendingChanges: false
  }));
  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ kind: "ok" | "err" | "pending"; text: string } | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [pendingEmail, setPendingEmail] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(PENDING_EMAIL_KEY) : null
  );
  const configured = isCloudConfigured();

  useEffect(() => {
    if (!configured) return;
    return subscribeCloudSync(setSync);
  }, [configured]);

  useEffect(() => {
    if (sync.session && pendingEmail) {
      localStorage.removeItem(PENDING_EMAIL_KEY);
      setPendingEmail(null);
    }
  }, [sync.session, pendingEmail]);

  if (!configured) {
    return (
      <Panel>
        <h3 className="mb-2 text-2xl font-black">Cloud sync</h3>
        <p className="text-sm text-[var(--muted)]">
          Variabili VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY non configurate. Aggiungile in .env per attivare la sync multi-dispositivo.
        </p>
      </Panel>
    );
  }

  const handleSignIn = async () => {
    if (!email.trim() || !password) {
      setInfo({ kind: "err", text: "Inserisci email e password." });
      return;
    }
    setBusy(true);
    setInfo(null);
    try {
      await signIn(email.trim(), password);
      setPassword("");
      setInfo({ kind: "ok", text: "Accesso effettuato. Sync automatica attiva." });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Login fallito.";
      if (/email not confirmed/i.test(msg)) {
        localStorage.setItem(PENDING_EMAIL_KEY, email.trim());
        setPendingEmail(email.trim());
        setInfo({
          kind: "pending",
          text: "Email non ancora confermata. Apri il link che hai ricevuto, poi torna qui e accedi di nuovo."
        });
      } else if (/invalid login credentials/i.test(msg)) {
        setInfo({
          kind: "err",
          text: "Credenziali non valide. Se non hai ancora un account, passa a Crea account."
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
      setInfo({ kind: "err", text: "Email valida e password di almeno 8 caratteri." });
      return;
    }
    setBusy(true);
    setInfo(null);
    try {
      const data = await signUp(email.trim(), password);
      setPassword("");
      if (data.session) {
        setInfo({ kind: "ok", text: "Account creato. Sync attiva." });
      } else {
        localStorage.setItem(PENDING_EMAIL_KEY, email.trim());
        setPendingEmail(email.trim());
        setInfo({
          kind: "pending",
          text: `Account registrato su Supabase. Ti abbiamo mandato un'email a ${email.trim()}: clicca il link per confermare. Solo dopo la conferma il login funzionerà davvero (e i dati saranno sincronizzati nel cloud).`
        });
        setMode("signin");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Registrazione fallita.";
      if (/already registered|already exists|user exists/i.test(msg)) {
        setInfo({ kind: "err", text: "Email già registrata. Usa Accedi." });
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
        text: `Nuova email di conferma inviata a ${pendingEmail}.`
      });
    } catch (error) {
      setInfo({
        kind: "err",
        text: error instanceof Error ? error.message : "Reinvio fallito."
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

  const handleSignOut = async () => {
    if (!window.confirm("Disconnettersi? I dati locali restano sul dispositivo, ma non saranno più sincronizzati.")) return;
    setBusy(true);
    setInfo(null);
    try {
      await signOut();
      setInfo({ kind: "ok", text: "Disconnesso." });
    } finally {
      setBusy(false);
    }
  };

  const handleForcePull = async () => {
    if (!window.confirm("Forzare il download dal cloud sostituisce i dati locali con l'ultimo snapshot remoto. Continuare?")) return;
    setBusy(true);
    setInfo(null);
    await forcePullNow();
    setBusy(false);
  };

  const handleForcePush = async () => {
    setBusy(true);
    setInfo(null);
    await forcePushNow();
    setBusy(false);
  };

  const session = sync.session;
  const tone =
    info?.kind === "ok"
      ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-100"
      : info?.kind === "err"
      ? "border-red-400/40 bg-red-500/10 text-red-200"
      : "border-amber-400/40 bg-amber-500/10 text-amber-100";

  return (
    <Panel>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-2xl font-black">Cloud sync</h3>
          <p className="text-sm text-[var(--muted)]">
            Account Supabase con email + password. Ogni modifica viene salvata nel cloud automaticamente quando sei connesso.
          </p>
        </div>
        <Pill active={sync.status === "idle" && !!session}>{statusLabel(sync)}</Pill>
      </div>

      {session ? (
        <div className="grid gap-3">
          <div className="quiet-panel p-4">
            <p className="text-xs font-black uppercase text-[var(--faint)]">Connesso come</p>
            <p className="font-black">{session.user.email}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Email confermata: {session.user.email_confirmed_at ? "si" : "no"} · Ultima sync: {formatRelative(sync.lastSync)}
            </p>
          </div>

          {sync.error ? (
            <p className="rounded-[18px] border border-red-400/40 bg-red-500/10 p-3 text-sm font-bold text-red-200">
              {sync.error}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button icon="LogOut" variant="danger" onClick={handleSignOut} disabled={busy}>
              Disconnetti
            </Button>
            <Button icon="Settings" variant="ghost" onClick={() => setShowAdvanced((value) => !value)}>
              {showAdvanced ? "Nascondi avanzate" : "Avanzate"}
            </Button>
          </div>

          {showAdvanced ? (
            <div className="quiet-panel grid gap-2 p-4">
              <p className="text-xs font-bold text-[var(--muted)]">
                Override manuali. Usali solo per recupero o test: la sync automatica copre tutti i casi normali.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button icon="Upload" variant="soft" onClick={handleForcePush} disabled={busy}>
                  Forza push
                </Button>
                <Button icon="Download" variant="soft" onClick={handleForcePull} disabled={busy}>
                  Forza pull
                </Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="rounded-[18px] border border-amber-400/30 bg-amber-500/5 p-3 text-xs font-bold text-amber-100">
            Senza login i dati sono salvati solo in questo browser. Per sincronizzarli su altri dispositivi servono account + login confermato.
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
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
              Accedi
            </button>
            <button
              type="button"
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
              Crea account
            </button>
          </div>

          {pendingEmail && mode === "signin" ? (
            <div className="rounded-[18px] border border-amber-400/40 bg-amber-500/10 p-3 text-sm font-bold text-amber-100">
              <p>
                Conferma in sospeso per <span className="font-black">{pendingEmail}</span>. Apri il link nell'email, poi torna qui e accedi.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button icon="Upload" variant="soft" onClick={handleResend} disabled={busy}>
                  Reinvia email
                </Button>
                <Button icon="Trash2" variant="ghost" onClick={handleClearPending} disabled={busy}>
                  Annulla
                </Button>
              </div>
            </div>
          ) : null}

          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label={mode === "signup" ? "Password (min 8 caratteri)" : "Password"}>
            <input
              className={inputClass}
              type="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>

          {mode === "signin" ? (
            <Button icon="LogIn" variant="primary" onClick={handleSignIn} disabled={busy}>
              Accedi al cloud
            </Button>
          ) : (
            <Button icon="UserPlus" variant="primary" onClick={handleSignUp} disabled={busy}>
              Registra account
            </Button>
          )}
        </div>
      )}

      {info ? (
        <p className={`mt-4 rounded-[18px] border p-3 text-sm font-bold ${tone}`}>{info.text}</p>
      ) : null}
    </Panel>
  );
}
