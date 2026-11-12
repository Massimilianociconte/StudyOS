import { useCallback, useEffect, useRef, useState } from "react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import type { PushDevice, PushSupport } from "../lib/push";
import { cloudConfigured } from "../lib/cloudSyncState";
import { notifyPushChanged } from "../lib/pushDevice";
import { pushPrivateOf } from "../lib/pushLocal";
import { useCloudSession } from "../hooks/useCloudSession";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { pushLabels } from "../lib/labels";

type PushModule = typeof import("../lib/push");

/** Interruttore (role="switch"): area di tocco di almeno 44 px grazie al bordo invisibile. */
function Switch({ checked, label, disabled, onToggle }: { checked: boolean; label: string; disabled: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-8 w-14 shrink-0 rounded-full transition-colors motion-reduce:transition-none after:absolute after:-inset-2 after:content-[''] disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? "bg-[var(--accent)]" : "bg-[var(--surface-strong)]"
      }`}
    >
      <span
        className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-[left] motion-reduce:transition-none ${checked ? "left-7" : "left-1"}`}
      />
    </button>
  );
}

/**
 * "Notifiche su questo dispositivo" (Impostazioni → Profilo, sotto la scheda del profilo online) e,
 * per l'account, "Promemoria con l'app chiusa" (preferenza sincronizzata `pushReminders`).
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
  const remindersOn = useStudyStore((state) => selectPreferences(state).pushReminders !== false);
  const updatePreferences = useStudyStore((state) => state.updatePreferences);
  // Password dell'app: i promemoria di questo dispositivo arrivano senza titolo, salvo scelta contraria.
  const vaultOn = useStudyStore((state) => state.settings.security.mode === "vault");
  const showTitles = useStudyStore((state) => state.settings.pushShowTitles === true);
  const updateSettings = useStudyStore((state) => state.updateSettings);
  const [devices, setDevices] = useState<PushDevice[] | null | undefined>(undefined);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);

  const loadDevices = useCallback(async () => {
    const module = push.current;
    if (!module || !userId) return;
    setDevices(await module.listPushDevices());
  }, [userId]);

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
        const list = userId ? await module.listPushDevices() : undefined;
        if (!cancelled) setDevices(list);
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
        const ok = await module.enablePush({ private: pushPrivateOf(useStudyStore.getState().settings) });
        setEnabled(ok);
        const now = module.pushSupport();
        setSupport(now);
        if (!ok && now === "ok") setFailed(true);
      }
    } finally {
      // I promemoria con l'app chiusa contano i dispositivi con le notifiche: si riallineano subito.
      notifyPushChanged();
      setBusy(false);
      void loadDevices();
    }
  };

  /** «Rimuovi»: la riga del dispositivo sparisce dal server (anche un telefono perso). */
  const remove = async (device: PushDevice) => {
    const module = push.current;
    if (!module || removing) return;
    setRemoving(device.id);
    setRemoveFailed(false);
    try {
      const ok = await module.removePushDevice(device.id);
      if (!ok) setRemoveFailed(true);
      if (ok && device.current) setEnabled(false);
    } finally {
      notifyPushChanged();
      setRemoving(null);
      void loadDevices();
    }
  };

  const seenText = (iso: string) => {
    const ms = Date.parse(iso);
    return Number.isFinite(ms) ? pushLabels.deviceSeen(format(ms, "d MMM yyyy", { locale: it })) : "";
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
        <Switch checked={enabled} label={pushLabels.toggle} disabled={disabled} onToggle={() => void toggle()} />
      </div>
      <p role="status" className="safe-text mt-2 text-xs font-bold text-[var(--muted)]">
        {note}
      </p>
      {userId ? (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">{pushLabels.remindersToggle}</p>
              <p className="safe-text mt-0.5 text-xs text-[var(--muted)]">{pushLabels.remindersHint}</p>
            </div>
            <Switch
              checked={remindersOn}
              label={pushLabels.remindersToggle}
              disabled={false}
              onToggle={() => void updatePreferences({ pushReminders: !remindersOn }).catch(() => undefined)}
            />
          </div>
          {remindersOn ? null : (
            <p className="safe-text mt-2 text-xs font-bold text-[var(--muted)]">{pushLabels.remindersOff}</p>
          )}
        </div>
      ) : null}
      {userId && vaultOn ? (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <div className="flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-black">{pushLabels.titlesToggle}</p>
              <p className="safe-text mt-0.5 text-xs text-[var(--muted)]">{showTitles ? pushLabels.titlesOn : pushLabels.titlesHint}</p>
            </div>
            <Switch
              checked={showTitles}
              label={pushLabels.titlesToggle}
              disabled={false}
              onToggle={() => void updateSettings({ pushShowTitles: !showTitles }).catch(() => undefined)}
            />
          </div>
        </div>
      ) : null}
      {userId && devices !== undefined ? (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <p className="text-sm font-black">{pushLabels.devicesTitle}</p>
          <p className="safe-text mt-0.5 text-xs text-[var(--muted)]">{pushLabels.devicesHint}</p>
          {devices === null ? (
            <p className="safe-text mt-2 text-xs font-bold text-[var(--muted)]">{pushLabels.devicesFailed}</p>
          ) : devices.length === 0 ? (
            <p className="safe-text mt-2 text-xs font-bold text-[var(--muted)]">{pushLabels.devicesEmpty}</p>
          ) : (
            <ul className="mt-2 grid grid-cols-1 gap-2">
              {devices.map((device) => {
                const kind = pushLabels.deviceKinds[device.kind];
                const name = device.current ? `${pushLabels.deviceThis} · ${kind}` : kind;
                return (
                  <li key={device.id} className="flex items-center gap-3 rounded-2xl bg-[var(--surface)] px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="safe-text text-sm font-bold">{name}</p>
                      <p className="safe-text text-xs text-[var(--muted)]">{seenText(device.lastSeenAt)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void remove(device)}
                      disabled={removing !== null}
                      aria-label={pushLabels.deviceRemoveLabel(name)}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full px-3 text-sm font-black text-[var(--accent-ink)] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {pushLabels.deviceRemove}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {removeFailed ? (
            <p role="status" className="safe-text mt-2 text-xs font-bold text-[var(--muted)]">
              {pushLabels.deviceRemoveFailed}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
