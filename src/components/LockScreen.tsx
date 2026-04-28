import { useState } from "react";
import { useStudyStore } from "../store/useStudyStore";
import { Button, Field, inputClass } from "./ui";
import { Icon } from "./Icon";

export function LockScreen() {
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { settings, unlockVault } = useStudyStore();

  const unlock = async () => {
    setBusy(true);
    setError("");
    try {
      await unlockVault(passphrase);
    } catch (unlockError) {
      setError(unlockError instanceof Error ? unlockError.message : "Impossibile aprire il vault.");
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
        <p className="mt-2 text-sm text-[var(--muted)]">Vault locale cifrato con AES-GCM. La passphrase resta solo in memoria.</p>
        {settings.security.passphraseHint ? (
          <p className="mt-3 rounded-full bg-[var(--surface)] px-4 py-2 text-xs font-bold text-[var(--muted)]">
            Suggerimento: {settings.security.passphraseHint}
          </p>
        ) : null}

        <div className="mt-6 text-left">
          <Field label="Passphrase">
            <input
              className={inputClass}
              type="password"
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") unlock();
              }}
              autoFocus
            />
          </Field>
          {error ? <p className="mt-2 text-sm font-bold text-red-200">{error}</p> : null}
          <Button className="mt-4 w-full" variant="primary" icon="Lock" disabled={busy || !passphrase} onClick={unlock}>
            Sblocca workspace
          </Button>
        </div>
      </section>
    </main>
  );
}
