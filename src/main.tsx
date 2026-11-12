import React from "react";
import ReactDOM from "react-dom/client";
import { LazyMotion, MotionConfig } from "framer-motion";
import App from "./App";
import { TabGuard } from "./components/TabGuard";
import {
  applyRememberedLook,
  browserActiveTabEnv,
  consumeGuardReason,
  leaveToGuard,
  rememberLook,
  startActiveTab
} from "./lib/activeTab";
import { handOffPersistence, haltPersistence } from "./lib/persistence";
import { reloadOnceForMissingChunk } from "./lib/lazyView";
import "./index.css";

// Le funzioni di animazione si caricano dopo il primo disegno (le `m.*` restano ferme finché non arrivano).
// Senza di loro gli elementi resterebbero al loro stato iniziale, spesso trasparenti: due nuovi tentativi,
// poi una sola ricarica della pagina, come per le viste.
const loadMotionFeatures = async () => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return (await import("./lib/motionFeatures")).default;
    } catch (error) {
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
        continue;
      }
      if (await reloadOnceForMissingChunk()) return new Promise<never>(() => undefined);
      throw error;
    }
  }
};

const root = ReactDOM.createRoot(document.getElementById("root")!);

// Una sola scheda attiva per profilo (src/lib/activeTab.ts): l'app si monta solo con il blocco,
// altrimenti la guardia (niente caricamento dei dati, niente scritture, niente sync).
const activeTab = startActiveTab(
  browserActiveTabEnv(),
  {
    activate: () => {
      rememberLook();
      root.render(
        <React.StrictMode>
          {/* Solo le animazioni usate (ingresso/uscita, niente layout): bundle iniziale più leggero. */}
          <LazyMotion features={loadMotionFeatures} strict>
            {/* Chi chiede al sistema meno movimento non vede scivolamenti (framer di base: "never"). */}
            <MotionConfig reducedMotion="user">
              <App />
            </MotionConfig>
          </LazyMotion>
        </React.StrictMode>
      );
    },
    showGuard: (view) => {
      applyRememberedLook();
      root.render(
        <React.StrictMode>
          <TabGuard view={view} onUse={() => activeTab.takeOver()} onForce={() => activeTab.force()} />
        </React.StrictMode>
      );
    },
    // Un'altra scheda chiede il posto: tutto su disco (outbox compresa), poi niente più scritture.
    handOff: handOffPersistence,
    // Blocco preso con la forza: stop immediato, senza salvare.
    halt: haltPersistence,
    leave: leaveToGuard
  },
  consumeGuardReason()
);

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: "none" })
      .then((registration) => {
        registration.update().catch(() => undefined);
      })
      .catch(() => undefined);
  });
}
