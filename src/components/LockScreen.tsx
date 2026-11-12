import { useEffect, useRef, useState } from "react";
import { useStudyStore } from "../store/useStudyStore";
import { cloudConfigured } from "../lib/cloudSyncState";
import { useCloudSession } from "../hooks/useCloudSession";
import { LOCK_TEXT, lockAccountOf } from "../lib/labels/lock";
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
  const [forgot, setForgot] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseError, setEraseError] = useState("");
  const { settings, unlockVault, resetAllData } = useStudyStore();
  const session = useCloudSession();
  const account = lockAccountOf(cloudConfigured, Boolean(session));
  const fieldRef = useRef<HTMLInputElement>(null);
  const forgotTitleRef = useRef<HTMLHeadingElement>(null);
  // Solo dopo «Annulla»: al primo disegno il campo ha già autoFocus.
  const returnToField = useRef(false);

  // Aprendo la conferma si legge subito la domanda; con «Annulla» si torna al campo della password.
  useEffect(() => {
    if (forgot) forgotTitleRef.current?.focus();
    else if (returnToField.current) fieldRef.current?.focus();
    returnToField.current = false;
  }, [forgot]);

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

  const cancelForgot = () => {
    returnToField.current = true;
    setForgot(false);
    setEraseError("");
  };

  // Solo questo dispositivo (mai l'account): con la sessione ancora attiva la sincronizzazione riparte da zero e riscarica tutto.
  const erase = async () => {
    if (erasing) return;
    setErasing(true);
    setEraseError("");
    try {
      await resetAllData({ propagate: false });
    } catch {
      setEraseError(LOCK_TEXT.failed);
      setErasing(false);
    }
  };

  return (
    <main className="app-bg grid min-h-screen place-items-center px-4 py-6">
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

        {forgot ? (
          <div role="group" aria-labelledby="lock-forgot-title" className="mt-6 text-left">
            <h2 id="lock-forgot-title" ref={forgotTitleRef} tabIndex={-1} className="text-lg font-black outline-none">
              {LOCK_TEXT.title}
            </h2>
            <p className="mt-2 text-sm">{LOCK_TEXT.erase}</p>
            <h3 className="mt-4 text-sm font-black">{LOCK_TEXT.recoveryTitle}</h3>
            <ul className="mt-1 grid grid-cols-1 gap-1.5 text-sm text-[var(--muted)]">
              {LOCK_TEXT.recovery(account).map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden="true">·</span>
                  <span className="min-w-0">{line}</span>
                </li>
              ))}
            </ul>
            {eraseError ? (
              <p role="alert" className="mt-3 text-sm font-bold text-[var(--danger-text)]">
                {eraseError}
              </p>
            ) : null}
            <div className="mt-5 grid grid-cols-1 gap-2">
              {/* Come il Button "danger", ma il testo va a capo invece di troncarsi a 320 px. */}
              <button
                type="button"
                disabled={erasing}
                onClick={() => void erase()}
                className="motion-safe inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-[var(--danger-bg)] px-4 py-2 text-center text-sm font-extrabold text-[var(--danger-text)] hover:bg-[var(--danger-bg-hover)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Icon name="Trash2" className="h-4 w-4 shrink-0" />
                <span className="min-w-0">{erasing ? LOCK_TEXT.busy : LOCK_TEXT.confirm}</span>
              </button>
              <Button className="w-full" variant="soft" disabled={erasing} onClick={cancelForgot}>
                {LOCK_TEXT.cancel}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-6 text-left">
            <Field label="Password">
              <input
                ref={fieldRef}
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
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={() => setForgot(true)}
                className="inline-flex min-h-11 items-center px-3 text-sm font-bold text-[var(--muted)] underline underline-offset-2 hover:text-[var(--text)]"
              >
                {LOCK_TEXT.forgot}
              </button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
