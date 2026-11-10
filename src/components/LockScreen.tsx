import { useState } from "react";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Field, inputClass } from "./ui";
import { Icon } from "./Icon";

/** Il messaggio della logica parla di "passphrase": qui diventa una frase semplice con il passo successivo. */
const unlockErrorText = (error: unknown) => {
  const text = error instanceof Error ? error.message : "";
  if (/passphrase non valida/i.test(text)) return "Password sbagliata. Controlla maiuscole e minuscole e riprova.";
  if (/vault corrotto/i.test(text)) return "La password è giusta, ma i dati salvati su questo dispositivo sono danneggiati e non si possono aprire.";
  return text || "Non è stato possibile aprire StudyOS. Riprova.";
};

export function LockScreen() {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { settings, unlockVault } = useStudyStore();

  const unlock = async () => {
    if (busy || !passphrase) return;
    setBusy(true);
    setError("");
    try {
      await unlockVault(passphrase);
    } catch (unlockError) {
      setError(unlockErrorText(unlockError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="app-bg grid min-h-screen place-items-center px-4">
      <section className="soft-panel w-full max-w-md p-6 text-center">
        <div className="mx-auto mb-5 grid h-24 w-24 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
          <Icon name="Lock" className="h-10 w-10" />
        </div>
        <h1 className="text-4xl font-black">StudyOS</h1>
        <p className="mt-2 text-sm text-[var(--muted)]">Inserisci la password per aprire StudyOS. I tuoi dati su questo dispositivo sono protetti.</p>
        {settings.security.passphraseHint ? (
          <p className="mt-3 rounded-full bg-[var(--surface)] px-4 py-2 text-xs font-bold text-[var(--muted)]">
            Promemoria: {settings.security.passphraseHint}
          </p>
        ) : null}

        <div className="mt-6 text-left">
          <Field label="Password">
            <input
              className={inputClass}
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") unlock();
              }}
              autoFocus
            />
          </Field>
          {error ? <p role="alert" className="mt-2 text-sm font-bold text-[var(--danger-text)]">{error}</p> : null}
          <Button className="mt-4 w-full" variant="primary" icon="Lock" disabled={busy || !passphrase} onClick={unlock}>
            {busy ? "Apertura…" : "Apri StudyOS"}
          </Button>
        </div>
      </section>
    </main>
  );
}
