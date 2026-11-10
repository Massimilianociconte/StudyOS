import { useState } from "react";
import { InlineConfirm } from "./GroupInvite";

/** Conferma sul posto che resta aperta se l'azione fallisce, con l'errore accanto al pulsante. */
export function ConfirmWithError({
  text,
  confirmLabel,
  icon,
  onCancel,
  onConfirm
}: {
  text: string;
  confirmLabel: string;
  icon: string;
  onCancel: () => void;
  /** Esito dell'azione: null se riuscita, altrimenti il testo dell'errore da mostrare. */
  onConfirm: () => Promise<string | null>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    setBusy(true);
    setError("");
    const failure = await onConfirm();
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <div className="mt-2 grid grid-cols-1 gap-2">
      <InlineConfirm text={text} confirmLabel={confirmLabel} icon={icon} busy={busy} onCancel={onCancel} onConfirm={() => void confirm()} />
      {error ? (
        <p role="alert" className="text-sm font-bold text-[var(--danger-text)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
