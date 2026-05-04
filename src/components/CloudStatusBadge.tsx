import { useEffect, useState } from "react";
import { Icon } from "./Icon";
import { isCloudConfigured } from "../lib/supabase";
import { subscribeCloudSync, type CloudSyncState } from "../lib/cloudSync";

export function CloudStatusBadge({ onClick }: { onClick?: () => void }) {
  const configured = isCloudConfigured();
  const [sync, setSync] = useState<CloudSyncState>(() => ({
    status: configured ? "idle" : "off",
    session: null,
    lastSync: null,
    pendingChanges: false
  }));

  useEffect(() => {
    if (!configured) return;
    return subscribeCloudSync(setSync);
  }, [configured]);

  if (!configured) return null;

  const session = sync.session;
  const tone = session
    ? sync.status === "error"
      ? "border-[var(--danger-border)] text-[var(--danger-text)] bg-[var(--danger-bg)]"
      : sync.status === "syncing" || sync.pendingChanges
      ? "border-[var(--warning-border)] text-[var(--warning-text)] bg-[var(--warning-bg)]"
      : "border-[var(--success-border)] text-[var(--success-text)] bg-[var(--success-bg)]"
    : "border-[var(--warning-border)] text-[var(--warning-text)] bg-[var(--warning-bg)]";

  const label = !session
    ? "Solo locale"
    : sync.status === "syncing"
    ? "Sync..."
    : sync.status === "error"
    ? "Errore sync"
    : sync.pendingChanges
    ? "In attesa"
    : "Cloud attivo";

  const subtitle = !session
    ? "Accedi per sincronizzare"
    : sync.status === "error"
    ? sync.error ?? "Riprovo a breve"
    : session.user.email ?? "";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`mt-3 flex w-full items-center gap-3 rounded-[22px] border p-3 text-left ${tone}`}
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-black/20">
        <Icon name={session ? "Sparkles" : "Shield"} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-black uppercase opacity-80">{label}</span>
        <span className="block truncate text-xs font-bold opacity-90">{subtitle}</span>
      </span>
    </button>
  );
}
