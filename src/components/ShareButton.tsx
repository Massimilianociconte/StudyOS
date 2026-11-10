import { lazy, Suspense, useState } from "react";
import type { ShareScope } from "../lib/sharing";
import { cloudConfigured } from "../lib/cloudSyncState";
import { Button } from "./ui";

// Pannello (e CloudPanel con supabase-js) caricato solo al tocco: le viste restano leggere.
const ShareDrawer = lazy(() => import("./ShareDrawer").then((module) => ({ default: module.ShareDrawer })));

/** Pulsante "Condividi" delle sezioni: apre il pannello già sulla sezione giusta. */
export function ShareButton({ scopes, label = "Condividi" }: { scopes: ShareScope[]; label?: string }) {
  const [open, setOpen] = useState(false);
  if (!cloudConfigured) return null;
  return (
    <>
      <Button variant="soft" icon="Share2" onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open ? (
        <Suspense fallback={null}>
          <ShareDrawer open onClose={() => setOpen(false)} initialScopes={scopes} />
        </Suspense>
      ) : null}
    </>
  );
}
