import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { cloudConfigured, getCloudSyncState, subscribeCloudSync, type CloudSyncState } from "../lib/cloudSyncState";
import { ACCOUNT_CHOICE_TEXT, CLOUD_STUCK_TEXT } from "../lib/labels";

export function CloudStatusBadge({ onClick, compact = false }: { onClick?: () => void; compact?: boolean }) {
  const configured = cloudConfigured;
  const [sync, setSync] = useState<CloudSyncState>(() => getCloudSyncState());

  useEffect(() => {
    if (!configured) return;
    return subscribeCloudSync(setSync);
  }, [configured]);

  if (!configured) return null;

  const session = sync.session;
  // Dati di un altro account su questo dispositivo: la sync aspetta la scelta nel pannello Account.
  const choice = Boolean(session && sync.accountChoice);
  // Elementi troppo grandi per l'account (stuckOutbox.ts): restano solo qui, l'elenco è nel pannello Account.
  const stuck = session ? sync.stuckCount ?? 0 : 0;
  const tone = session
    ? sync.status === "error"
      ? "border-[var(--danger-border)] text-[var(--danger-text)] bg-[var(--danger-bg)]"
      : choice || sync.status === "syncing" || sync.status === "offline" || sync.pendingChanges || stuck > 0
      ? "border-[var(--warning-border)] text-[var(--warning-text)] bg-[var(--warning-bg)]"
      : "border-[var(--success-border)] text-[var(--success-text)] bg-[var(--success-bg)]"
    : "border-[var(--warning-border)] text-[var(--warning-text)] bg-[var(--warning-bg)]";

  const label = !session
    ? "Salvato solo qui"
    : choice
    ? ACCOUNT_CHOICE_TEXT.label
    : sync.status === "syncing"
    ? "Sincronizzazione…"
    : sync.status === "offline"
    ? "Sei offline"
    : sync.status === "error"
    ? "Sincronizzazione non riuscita"
    : sync.pendingChanges
    ? `${sync.pendingCount} ${sync.pendingCount === 1 ? "modifica da inviare" : "modifiche da inviare"}`
    : stuck > 0
    ? CLOUD_STUCK_TEXT.label(stuck)
    : "Sincronizzato";

  const subtitle = !session
    ? "Accedi per sincronizzare"
    : choice
    ? ACCOUNT_CHOICE_TEXT.hint
    : stuck > 0 && sync.status === "idle" && !sync.pendingChanges
    ? CLOUD_STUCK_TEXT.hint
    : sync.status === "error"
    ? sync.error ?? "Riprovo tra poco da solo"
    : sync.status === "offline"
    ? "Le modifiche sono salvate e partono appena torni online"
    : session.user.email ?? "";

  if (compact) {
    // Variante per la barra laterale compatta (tablet): solo icona, stato nel tooltip.
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={`${label}: ${subtitle}`}
        title={`${label} · ${subtitle}`}
        className={`grid h-11 w-11 place-items-center rounded-full border ${tone}`}
      >
        <Icon name={session ? "Sparkles" : "Shield"} className="h-4 w-4" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title="Stato dell'account: apri le impostazioni dell'account"
      aria-label={`${label}: ${subtitle}. Apri le impostazioni dell'account.`}
      className={`mt-3 flex w-full items-center gap-3 rounded-[22px] border p-3 text-left ${tone}`}
    >
      <span className="grid grid-cols-1 h-9 w-9 shrink-0 place-items-center rounded-full bg-black/20">
        <Icon name={session ? "Sparkles" : "Shield"} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-black uppercase opacity-80">{label}</span>
        <span className="block truncate text-xs font-bold opacity-90">{subtitle}</span>
      </span>
    </button>
  );
}
