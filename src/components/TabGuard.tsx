import { useEffect, useRef } from "react";
import type { GuardView } from "../lib/activeTab";
import { TAB_GUARD_TEXT as T } from "../lib/labels/activeTab";
import { Button } from "./ui";
import { Icon } from "./Icon";

const FORCE_ID = "tab-guard-force";

/**
 * StudyOS è aperto in un'altra scheda: al posto dell'app (nessun caricamento, nessuna scrittura)
 * solo questa pagina, con il pulsante per spostarsi qui. Vedi src/lib/activeTab.ts.
 */
export function TabGuard({ view, onUse, onForce }: { view: GuardView; onUse: () => void; onForce: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = view.reason === "moved";

  // Il pulsante premuto sparisce: il focus non deve cadere sul body.
  useEffect(() => {
    if (view.phase === "waiting") heading.current?.focus();
    if (view.phase === "slow") document.getElementById(FORCE_ID)?.focus();
  }, [view.phase]);

  return (
    <main className="app-bg grid min-h-screen grid-cols-1 place-items-center px-4 py-8">
      <section className="soft-panel w-full max-w-md p-6 text-center" aria-labelledby="tab-guard-title">
        <div className="mx-auto mb-5 grid h-20 w-20 place-items-center rounded-super bg-[var(--accent)] text-[#10131d]">
          <Icon name="Layers" className="h-9 w-9" />
        </div>
        <h1 id="tab-guard-title" ref={heading} tabIndex={-1} className="text-balance text-2xl font-black outline-none">
          {moved ? T.titleMoved : T.titleElsewhere}
        </h1>
        <p className="text-balance mt-2 text-sm text-[var(--muted)]">{moved ? T.bodyMoved : T.bodyElsewhere}</p>

        {view.phase === "idle" ? (
          <>
            <Button className="mt-6 w-full" variant="primary" icon="LogIn" onClick={onUse}>
              {T.use}
            </Button>
            <p className="text-balance mt-3 text-xs text-[var(--muted)]">{T.useNote}</p>
          </>
        ) : null}

        {/* Sempre presente (anche vuota): una regione live che appare dal nulla può non essere letta. */}
        <p role="status" className="text-balance text-sm font-bold [&:not(:empty)]:mt-6">
          {view.phase === "waiting" ? T.waiting : view.phase === "slow" ? T.slow : ""}
        </p>

        {view.phase === "slow" ? (
          <>
            <Button id={FORCE_ID} className="mt-4 w-full" variant="primary" icon="LogIn" onClick={onForce}>
              {T.force}
            </Button>
            <p className="text-balance mt-3 text-xs text-[var(--muted)]">{T.forceNote}</p>
          </>
        ) : null}
      </section>
    </main>
  );
}
