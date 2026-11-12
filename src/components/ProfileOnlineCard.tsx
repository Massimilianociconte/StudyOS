import { useEffect, useState, type ReactNode } from "react";
import { useCloudSession } from "../hooks/useCloudSession";
import { cloudConfigured } from "../lib/cloudSyncState";
import { peopleLabels } from "../lib/labels";
import { DEFAULT_PROFILE, normalizeHandle, peopleCauseText, type MyProfile } from "../lib/people";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { Button, Field, inputClass } from "./ui";
import { Icon } from "./Icon";

type Availability = "idle" | "invalid" | "current" | "checking" | "free" | "taken";

/** Pausa prima di controllare un @nome: ogni controllo conta nel limite di ricerche al minuto. */
const HANDLE_CHECK_MS = 700;

const AVAILABILITY_TEXT: Record<Availability, string> = {
  idle: peopleLabels.handleRule,
  invalid: peopleLabels.handleRule,
  current: peopleLabels.handleCurrent,
  checking: peopleLabels.handleChecking,
  free: peopleLabels.handleAvailable,
  taken: peopleLabels.handleTaken
};

const AVAILABILITY_TONE: Record<Availability, string> = {
  idle: "text-[var(--muted)]",
  invalid: "text-[var(--danger-text)]",
  current: "text-[var(--muted)]",
  checking: "text-[var(--muted)]",
  free: "text-[var(--success-text)]",
  taken: "text-[var(--danger-text)]"
};

/**
 * Profilo online in Impostazioni → Profilo: nome visibile (quello di "Il tuo nome"), @nome con
 * controllo di disponibilità e "Gli altri possono trovarmi". peopleSync arriva con import(): niente
 * supabase-js nel bundle iniziale. `extra` (es. le notifiche di questo dispositivo) va in fondo.
 */
export function ProfileOnlineCard({ extra }: { extra?: ReactNode }) {
  const session = useCloudSession();
  const me = session?.user.id ?? null;
  const displayName = useStudyStore((state) => selectPreferences(state).displayName.trim());
  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [draft, setDraft] = useState("");
  const [availability, setAvailability] = useState<Availability>("idle");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  // Profilo dell'account attuale (si rilegge cambiando account). Riga mancante = trovabile, senza @nome.
  useEffect(() => {
    setProfile(null);
    setLoadError("");
    setMessage(null);
    if (!me) return;
    let alive = true;
    setLoading(true);
    void import("../lib/peopleSync")
      .then((people) => people.loadMyProfile())
      .then((loaded) => {
        if (!alive) return;
        const next = loaded ?? { ...DEFAULT_PROFILE };
        setProfile(next);
        setDraft(next.handle ?? "");
      })
      .catch((cause: unknown) => {
        if (alive) setLoadError(peopleCauseText(cause));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [me, reload]);

  const ready = profile !== null;
  const current = profile?.handle ?? null;
  const normalized = normalizeHandle(draft);
  const typed = draft.trim() !== "";

  // Disponibilità: solo per un @nome valido e diverso da quello salvato, dopo una pausa di scrittura.
  useEffect(() => {
    if (!ready || !typed) {
      setAvailability("idle");
      return;
    }
    if (!normalized) {
      setAvailability("invalid");
      return;
    }
    if (normalized === current) {
      setAvailability("current");
      return;
    }
    setAvailability("checking");
    let alive = true;
    const timer = setTimeout(() => {
      void import("../lib/peopleSync")
        .then((people) => people.isHandleAvailable(normalized))
        .then((free) => {
          if (alive) setAvailability(free ? "free" : "taken");
        })
        .catch((cause: unknown) => {
          if (!alive) return;
          setAvailability("idle");
          setMessage({ tone: "error", text: peopleCauseText(cause) });
        });
    }, HANDLE_CHECK_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [ready, typed, normalized, current]);

  const save = async (patch: Partial<Pick<MyProfile, "handle" | "discoverable">>, done: (saved: MyProfile) => string) => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const people = await import("../lib/peopleSync");
      const saved = await people.saveMyProfile(patch);
      setProfile(saved);
      setDraft(saved.handle ?? "");
      setMessage({ tone: "ok", text: done(saved) });
    } catch (cause) {
      setMessage({ tone: "error", text: peopleCauseText(cause) });
    } finally {
      setBusy(false);
    }
  };

  const saveHandle = () => {
    if (!normalized) {
      setMessage({ tone: "error", text: peopleLabels.errors.badHandle });
      return;
    }
    if (normalized === current || availability === "taken" || availability === "checking") return;
    void save({ handle: normalized }, (saved) => peopleLabels.handleSaved(saved.handle ?? normalized));
  };

  let body: ReactNode;
  if (!cloudConfigured) {
    body = <p className="text-sm font-bold text-[var(--muted)]">{peopleLabels.profileNoCloud}</p>;
  } else if (!me) {
    body = <p className="text-sm font-bold text-[var(--muted)]">{peopleLabels.profileSignedOut}</p>;
  } else if (loading || (!profile && !loadError)) {
    body = <p className="text-sm font-bold text-[var(--muted)]">{peopleLabels.profileLoading}</p>;
  } else if (loadError || !profile) {
    body = (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" className="min-w-0 flex-1 text-sm font-bold text-[var(--danger-text)]">
          {loadError}
        </p>
        <Button variant="soft" icon="RotateCcw" onClick={() => setReload((count) => count + 1)}>
          {peopleLabels.retry}
        </Button>
      </div>
    );
  } else {
    body = (
      <>
        <p className="text-sm font-bold">
          {peopleLabels.profileVisibleName(displayName || peopleLabels.noName)}
          <span className="block text-xs font-semibold text-[var(--muted)]">{peopleLabels.profileNameHint}</span>
        </p>
        <Field label={peopleLabels.handleLabel}>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black text-[var(--faint)]">
                @
              </span>
              <input
                className={`${inputClass} pl-7`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveHandle();
                  }
                }}
                placeholder={peopleLabels.handlePlaceholder}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                maxLength={25}
                aria-describedby="profile-handle-status"
                disabled={busy}
              />
            </div>
            <Button
              variant="soft"
              icon="Check"
              onClick={saveHandle}
              disabled={busy || !normalized || normalized === current || availability === "taken" || availability === "checking"}
            >
              {busy ? peopleLabels.saving : peopleLabels.handleSave}
            </Button>
          </div>
        </Field>
        <div className="-mt-1 flex flex-wrap items-center justify-between gap-2">
          <p id="profile-handle-status" aria-live="polite" className={`text-xs font-bold ${AVAILABILITY_TONE[availability]}`}>
            {AVAILABILITY_TEXT[availability]}
          </p>
          {current ? (
            <Button variant="ghost" icon="X" onClick={() => void save({ handle: null }, () => peopleLabels.handleRemoved)} disabled={busy}>
              {peopleLabels.handleRemove}
            </Button>
          ) : null}
        </div>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-[18px] bg-[var(--surface)] p-3">
          <input
            type="checkbox"
            role="switch"
            aria-checked={profile.discoverable}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
            checked={profile.discoverable}
            disabled={busy}
            onChange={(event) =>
              void save({ discoverable: event.target.checked }, (saved) => (saved.discoverable ? peopleLabels.discoverableOn : peopleLabels.discoverableOff))
            }
          />
          <span className="min-w-0">
            <span className="block text-sm font-black">{peopleLabels.discoverableLabel}</span>
            <span className="block text-xs font-semibold text-[var(--muted)]">
              {profile.discoverable ? peopleLabels.discoverableOn : peopleLabels.discoverableOff}
            </span>
          </span>
        </label>
        {message ? (
          <p role={message.tone === "ok" ? "status" : "alert"} className={`text-sm font-bold ${message.tone === "ok" ? "text-[var(--success-text)]" : "text-[var(--danger-text)]"}`}>
            {message.text}
          </p>
        ) : null}
      </>
    );
  }

  return (
    <section aria-labelledby="profile-online-title" className="mt-4 grid grid-cols-1 gap-3 rounded-[20px] bg-[var(--surface-soft)] p-3 sm:p-4">
      <div className="flex items-start gap-2">
        <Icon name="Globe" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
        <div className="min-w-0">
          <h4 id="profile-online-title" className="text-sm font-black">
            {peopleLabels.profileTitle}
          </h4>
          <p className="text-xs font-bold text-[var(--muted)]">{peopleLabels.profileIntro}</p>
        </div>
      </div>
      {body}
      {extra}
    </section>
  );
}
