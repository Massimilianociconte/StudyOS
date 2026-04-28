import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Button, Field, Panel, Pill, inputClass } from "./ui";
import {
  getSession,
  isCloudConfigured,
  onAuthChange,
  pullSnapshot,
  pushSnapshot,
  signIn,
  signOut,
  signUp
} from "../lib/supabase";
import { snapshotFromState, useStudyStore } from "../store/useStudyStore";

const CLIENT_ID_KEY = "studyos-client-id";

const getClientId = () => {
  let id = localStorage.getItem(CLIENT_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CLIENT_ID_KEY, id);
  }
  return id;
};

export function CloudPanel() {
  const replaceAllData = useStudyStore((s) => s.replaceAllData);
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [lastSync, setLastSync] = useState<string | null>(null);
  const configured = isCloudConfigured();

  useEffect(() => {
    if (!configured) return;
    getSession().then(setSession);
    return onAuthChange(setSession);
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
    setBusy(true);
    setMessage("");
    try {
      await signIn(email.trim(), password);
      setMessage("Login effettuato.");
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Login fallito.");
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async () => {
    setBusy(true);
    setMessage("");
    try {
      const data = await signUp(email.trim(), password);
      setMessage(
        data.session
          ? "Account creato e login effettuato."
          : "Account creato. Conferma l'email se richiesto, poi accedi."
      );
      setPassword("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Registrazione fallita.");
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    setBusy(true);
    setMessage("");
    try {
      await signOut();
      setMessage("Logout effettuato.");
    } finally {
      setBusy(false);
    }
  };

  const handlePush = async () => {
    setBusy(true);
    setMessage("");
    try {
      const snapshot = snapshotFromState(useStudyStore.getState());
      const row = await pushSnapshot(snapshot, getClientId());
      setLastSync(row.updated_at);
      setMessage(`Dati salvati su cloud (v${row.version}).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Push fallito.");
    } finally {
      setBusy(false);
    }
  };

  const handlePull = async () => {
    setBusy(true);
    setMessage("");
    try {
      const row = await pullSnapshot();
      if (!row) {
        setMessage("Nessuno snapshot remoto trovato. Fai prima un push.");
        return;
      }
      if (
        !window.confirm(
          "Caricare lo snapshot dal cloud sostituisce i dati locali. Continuare?"
        )
      ) {
        return;
      }
      await replaceAllData(row.payload);
      setLastSync(row.updated_at);
      setMessage(`Dati caricati dal cloud (v${row.version}).`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Pull fallito.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-2xl font-black">Cloud sync</h3>
          <p className="text-sm text-[var(--muted)]">
            Account Supabase con email e password. Snapshot completo salvato lato server con RLS.
          </p>
        </div>
        <Pill active={!!session}>{session ? "online" : "offline"}</Pill>
      </div>

      {session ? (
        <div className="grid gap-3">
          <div className="quiet-panel p-4">
            <p className="text-sm font-bold text-[var(--muted)]">Connesso come</p>
            <p className="font-black">{session.user.email}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button icon="Upload" variant="primary" onClick={handlePush} disabled={busy}>
              Salva su cloud
            </Button>
            <Button icon="Download" variant="soft" onClick={handlePull} disabled={busy}>
              Carica da cloud
            </Button>
            <Button icon="LogOut" variant="danger" onClick={handleSignOut} disabled={busy}>
              Logout
            </Button>
          </div>
          {lastSync ? (
            <p className="text-xs font-bold text-[var(--muted)]">
              Ultima sync: {new Date(lastSync).toLocaleString()}
            </p>
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
          <Field label="Password">
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

      {message ? (
        <p className="mt-4 rounded-[18px] bg-[var(--surface-soft)] p-3 text-sm font-bold text-[var(--muted)]">
          {message}
        </p>
      ) : null}
    </Panel>
  );
}
