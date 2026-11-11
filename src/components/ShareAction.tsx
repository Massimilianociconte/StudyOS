import { lazy, Suspense, useState, type ReactNode } from "react";
import type { ShareScope } from "../lib/sharing";
import { cloudConfigured } from "../lib/cloudSyncState";
import { SHARE_ACTION_LABEL, SHARE_TEXT } from "../lib/labels/sharing";
import type { PageAction } from "./ui";

// Come ShareButton: il pannello (e supabase-js) si scarica solo al tocco, le viste restano leggere.
const loadDrawer = () => import("./ShareDrawer");
const ShareDrawer = lazy(() => loadDrawer().then((module) => ({ default: module.ShareDrawer })));

type Phase = "idle" | "loading" | "open" | "failed";

/**
 * "Condividi" come voce del menu "Altre azioni" (`PageActions`): `action` va nel menu (null senza
 * cloud), `element` va reso nella vista (pannello aperto, oppure l'avviso se il pezzo di app non arriva).
 */
export function useShareAction(scopes: ShareScope[]): { action: PageAction | null; element: ReactNode } {
  const [phase, setPhase] = useState<Phase>("idle");
  if (!cloudConfigured) return { action: null, element: null };

  const open = () => {
    if (phase === "loading") return;
    setPhase("loading");
    loadDrawer().then(
      () => setPhase("open"),
      () => setPhase("failed")
    );
  };

  return {
    action: { label: phase === "loading" ? SHARE_TEXT.opening : SHARE_ACTION_LABEL, icon: "Share2", onClick: open },
    element:
      phase === "failed" ? (
        <p role="alert" className="mb-3 text-xs font-bold text-[var(--danger-text)]">
          {SHARE_TEXT.loadFailed}
        </p>
      ) : phase === "open" ? (
        <Suspense fallback={null}>
          <ShareDrawer open onClose={() => setPhase("idle")} initialScopes={scopes} />
        </Suspense>
      ) : null
  };
}
