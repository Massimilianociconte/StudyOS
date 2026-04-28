import { useEffect, useState } from "react";
import { Button, Field, Panel, Pill, inputClass } from "./ui";
import { isCloudConfigured, signIn, signOut, signUp } from "../lib/supabase";
import {
  forcePullNow,
  forcePushNow,
  subscribeCloudSync,
  type CloudSyncState
} from "../lib/cloudSync";

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

export function CloudPanel() {
  const [sync, setSync] = useState<CloudSyncState>(() => ({
    status: isCloudConfigured() ? "idle" : "off",
    session: null,
    lastSync: null,
    pendingChanges: false
  }));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const configured = isCloudConfigured();

  useEffect(() => {
    if (!configured) return;
    return subscribeCloudSync(setSync);
  }, [configured]);

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
      setInfo("Inserisci email e password.");
      return;
    }
    setBusy(true);
    setInfo("");
    try {
      await signIn(email.trim(), password);
      setPassword("");
      setInfo("Accesso effettuato. Sync automatica attiva.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Login fallito.";
      setInfo(/email not confirmed/i.test(msg) ? "Email non confermata. Controlla la casella e clicca il link di conferma." : msg);
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async () => {
    if (!email.trim() || password.length < 8) {
      setInfo("Email valida e password di almeno 8 caratteri.");
      return;
    }
    setBusy(true);
    setInfo("");
    try {
      const data = await signUp(email.trim(), password);
      setPassword("");
      setInfo(
        data.session
          ? "Account creato e accesso effettuato. Sync attiva."
          : "Account creato. Conferma l'email cliccando il link che hai ricevuto, poi torna qui per accedere."
      );
    } catch (error) {
      setInfo(error instanceof Error ? error.message : "Registrazione fallita.");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    if (!window.confirm("Disconnettersi? I dati locali restano sul dispositivo, ma non saranno più sincronizzati.")) return;
    setBusy(true);
    setInfo("");
    try {
      await signOut();
      setInfo("Disconnesso.");
    } finally {
      setBusy(false);
    }
  };

  const handleForcePull = async () => {
    if (!window.confirm("Forzare il download dal cloud sostituisce i dati locali con l'ultimo snapshot remoto. Continuare?")) return;
    setBusy(true);
    setInfo("");
    await forcePullNow();
    setBusy(false);
  };

  const handleForcePush = async () => {
    setBusy(true);
    setInfo("");
    await forcePushNow();
    setBusy(false);
  };

  const session = sync.session;

  return (
    <Panel>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-2xl font-black">Cloud sync</h3>
          <p className="text-sm text-[var(--muted)]">
            Account Supabase con email + password. Ogni modifica viene salvata nel cloud automaticamente.
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
          <Field label="Email">
            <input
              className={inputClass}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Field label="Password (min 8)">
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button icon="LogIn" variant="primary" onClick={handleSignIn} disabled={busy}>
              Accedi
            </Button>
            <Button icon="UserPlus" variant="soft" onClick={handleSignUp} disabled={busy}>
              Crea account
            </Button>
          </div>
        </div>
      )}

      {info ? (
        <p className="mt-4 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
          {info}
        </p>
      ) : null}
    </Panel>
  );
}
