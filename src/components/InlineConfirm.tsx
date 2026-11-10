import { Button } from "./ui";

/** Conferma sul posto: dice cosa succede e il pulsante ripete l'azione (niente "OK" generico). */
export function InlineConfirm({ text, confirmLabel, icon, onConfirm, onCancel, busy }: { text: string; confirmLabel: string; icon: string; onConfirm: () => void; onCancel: () => void; busy?: boolean }) {
  return (
    <div role="group" aria-label={confirmLabel} className="rounded-[18px] bg-[var(--surface-soft)] p-3">
      <p className="safe-text text-sm font-bold">{text}</p>
      <div className="mt-2 flex flex-wrap justify-end gap-2">
        <Button variant="soft" onClick={onCancel} disabled={busy} autoFocus>
          Annulla
        </Button>
        <Button variant="danger" icon={icon} onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </Button>
      </div>
    </div>
  );
}
