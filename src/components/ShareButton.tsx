import { lazy, Suspense, useState } from "react";
import type { ShareScope } from "../lib/sharing";
import { cloudConfigured } from "../lib/cloudSyncState";
import { SHARE_TEXT } from "../lib/labels";
import { Button } from "./ui";

// Pannello (e CloudPanel con supabase-js) caricato solo al tocco: le viste restano leggere.
const loadDrawer = () => import("./ShareDrawer");
const ShareDrawer = lazy(() => loadDrawer().then((module) => ({ default: module.ShareDrawer })));

type Phase = "idle" | "loading" | "open" | "failed";

/**
 * Pulsante "Condividi" delle sezioni: apre il pannello già sulla sezione giusta. Il pezzo di app si
 * scarica prima di montare il pannello: se non arriva (offline, scheda aperta prima di un
 * aggiornamento) lo si dice qui accanto al pulsante invece di far cadere la vista nel pannello
 * d'errore, e al tocco successivo si riprova.
 */
export function ShareButton({ scopes, label = "Condividi" }: { scopes: ShareScope[]; label?: string }) {
  const [phase, setPhase] = useState<Phase>("idle");
  if (!cloudConfigured) return null;

  const openDrawer = () => {
    if (phase === "loading") return;
    setPhase("loading");
    loadDrawer().then(
      () => setPhase("open"),
      () => setPhase("failed")
    );
  };

  return (
    <span className="inline-flex max-w-full flex-col items-start gap-1">
      <Button variant="soft" icon="Share2" onClick={openDrawer} disabled={phase === "loading"} aria-busy={phase === "loading"}>
        {phase === "loading" ? SHARE_TEXT.opening : label}
      </Button>
      {phase === "failed" ? (
        <span role="alert" className="text-xs font-bold text-[var(--danger-text)]">
          {SHARE_TEXT.loadFailed}
        </span>
      ) : null}
      {phase === "open" ? (
        <Suspense fallback={null}>
          <ShareDrawer open onClose={() => setPhase("idle")} initialScopes={scopes} />
        </Suspense>
      ) : null}
    </span>
  );
}
