import { useEffect, useRef, useState } from "react";
import type { PushSupport } from "../lib/push";
import { cloudConfigured } from "../lib/cloudSyncState";
import { useCloudSession } from "../hooks/useCloudSession";
import { pushLabels } from "../lib/labels";

type PushModule = typeof import("../lib/push");

/**
 * "Notifiche su questo dispositivo" (Impostazioni → Profilo, sotto la scheda del profilo online).
 * Il codice push si carica qui, in differita; il permesso del browser si chiede solo al tocco.
 */
export function PushToggle() {
  const session = useCloudSession();
  const userId = session?.user.id ?? null;
  const push = useRef<PushModule | null>(null);
  const [support, setSupport] = useState<PushSupport | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!cloudConfigured) return;
    let cancelled = false;
    void import("../lib/push")
      .then(async (module) => {
        push.current = module;
        const current = module.pushSupport();
        const on = userId ? await module.isPushEnabled(userId) : false;
        if (cancelled) return;
        setSupport(current);
        setEnabled(on);
      })
      .catch(() => {
        if (!cancelled) setSupport("unsupported");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  if (!cloudConfigured) return null;

  const toggle = async () => {
    const module = push.current;
    if (!module || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      if (enabled) {
        await module.disablePush();
        setEnabled(false);
      } else {
        // Nessun await prima di enablePush: il permesso va chiesto dentro il gesto della persona.
        const ok = await module.enablePush();
        setEnabled(ok);
        const now = module.pushSupport();
        setSupport(now);
        if (!ok && now === "ok") setFailed(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const note = (() => {
    if (!userId) return pushLabels.needAccount;
    if (support === null) return pushLabels.checking;
    if (support === "unsupported") return pushLabels.unsupported;
    if (support === "ios-install") return pushLabels.iosInstall;
    if (support === "denied") return pushLabels.denied;
    if (failed) return pushLabels.failed;
    return enabled ? pushLabels.on : pushLabels.off;
  })();
  const disabled = busy || !userId || support !== "ok";

  return (
    <div className="mt-4 rounded-[22px] bg-[var(--surface-soft)] p-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-black">{pushLabels.toggle}</p>
          <p className="safe-text mt-0.5 text-xs text-[var(--muted)]">{pushLabels.hint}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={pushLabels.toggle}
          disabled={disabled}
          onClick={() => void toggle()}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors motion-reduce:transition-none after:absolute after:-inset-2 after:content-[''] disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-[var(--accent)]" : "bg-[var(--surface-strong)]"
          }`}
        >
          <span
            className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none ${enabled ? "left-7" : "left-1"}`}
          />
        </button>
      </div>
      <p role="status" className="safe-text mt-2 text-xs font-bold text-[var(--muted)]">
        {note}
      </p>
    </div>
  );
}
