import { useEffect, useRef, useState } from "react";
import type { AppNotification } from "../types";
import { useStudyStore } from "../store/useStudyStore";
import { useCloudSession } from "../hooks/useCloudSession";
import { cloudConfigured } from "../lib/cloudSyncState";
import { useUiState } from "../lib/uiState";
import { pushLabels } from "../lib/labels";
import { pushPrivateOf } from "../lib/pushLocal";
import { Button } from "./ui";
import { Icon } from "./Icon";

type PushModule = typeof import("../lib/push");

// Inviti di gruppo (kind "invite") e di condivisione (id che comincia per notif-share-invite-).
const isInvite = (item: AppNotification) => item.kind === "invite" || item.id.startsWith("notif-share-invite-");

/**
 * Proposta una tantum: dopo il primo invito ricevuto, se il browser supporta le push e il permesso
 * non è ancora stato chiesto, propone di attivarle. Il permesso si chiede solo se la persona tocca
 * "Attiva le notifiche". Sempre montata nella shell: nessun import statico di push o supabase.
 */
export function PushPrompt() {
  const session = useCloudSession();
  const hasInvite = useStudyStore((state) => state.notifications.some((item) => !item.archived && isInvite(item)));
  const [seen, setSeen] = useUiState<boolean>("pushPromptSeen", false, { validate: (value) => typeof value === "boolean" });
  const push = useRef<PushModule | null>(null);
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const active = cloudConfigured && Boolean(session) && hasInvite && !seen;

  useEffect(() => {
    if (!active) {
      setEligible(false);
      return;
    }
    let cancelled = false;
    void import("../lib/push")
      .then((module) => {
        push.current = module;
        if (!cancelled) setEligible(module.pushSupport() === "ok" && Notification.permission === "default");
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [active]);

  if (!(active && eligible) && !failed) return null;

  const accept = async () => {
    const module = push.current;
    if (!module || busy) return;
    setBusy(true);
    try {
      // Il modulo è già caricato: il permesso parte dentro il gesto del tocco.
      const ok = await module.enablePush({ private: pushPrivateOf(useStudyStore.getState().settings) });
      setSeen(true);
      if (!ok) setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      aria-label={pushLabels.promptTitle}
      className="soft-panel fixed inset-x-4 bottom-24 z-40 mx-auto max-w-md p-4 lg:bottom-6 lg:left-auto lg:right-6"
    >
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 grid-cols-1 place-items-center rounded-full bg-[var(--accent)] text-[#10131d]">
          <Icon name="Bell" className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="safe-text text-sm font-black">{failed ? pushLabels.promptFailed : pushLabels.promptTitle}</p>
          {failed ? null : <p className="safe-text mt-1 text-xs text-[var(--muted)]">{pushLabels.promptBody}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {failed ? (
              <Button variant="soft" onClick={() => setFailed(false)}>
                {pushLabels.promptClose}
              </Button>
            ) : (
              <>
                <Button variant="primary" icon="Bell" disabled={busy} onClick={() => void accept()}>
                  {pushLabels.promptAccept}
                </Button>
                <Button variant="soft" disabled={busy} onClick={() => setSeen(true)}>
                  {pushLabels.promptLater}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
