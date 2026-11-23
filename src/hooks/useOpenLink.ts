import { useEffect, useRef } from "react";
import { parseOpenTarget, requestAgentRequestsCheck, requestOpenNotifications, urlWithoutOpen, type OpenTarget } from "../lib/openLink";
import { requestSettingsSection } from "../lib/settingsJump";
import { useStudyStore } from "../store/useStudyStore";

const openTarget = (target: OpenTarget) => {
  if (target === "gruppi") useStudyStore.getState().setActiveView("groups");
  else if (target === "condivisione") useStudyStore.getState().setActiveView("sharing");
  else if (target === "calendario") useStudyStore.getState().setActiveView("calendar");
  else if (target === "agenti") {
    // La conferma compare nel dialogo degli agenti, sopra ogni pagina: Impostazioni → Agenti fa da contesto.
    requestSettingsSection("agenti");
    useStudyStore.getState().setActiveView("settings");
    requestAgentRequestsCheck();
  } else requestOpenNotifications();
};

/**
 * Collegamento profondo ?apri=notifiche|condivisione|gruppi|calendario|agenti (lo mette il service worker quando si
 * tocca una notifica push). Legge il parametro all'avvio, lo toglie dall'URL e apre la pagina giusta
 * appena l'app è pronta (dopo lo sblocco della password, se attiva).
 */
export function useOpenLink(ready: boolean) {
  const pending = useRef<OpenTarget | null>(null);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const target = parseOpenTarget(window.location.search);
    if (!target) return;
    window.history.replaceState(window.history.state, "", urlWithoutOpen(window.location.href));
    if (readyRef.current) openTarget(target);
    else pending.current = target;
  }, []);

  useEffect(() => {
    if (!ready || !pending.current) return;
    const target = pending.current;
    pending.current = null;
    openTarget(target);
  }, [ready]);
}
