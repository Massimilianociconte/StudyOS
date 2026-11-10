import { useEffect, useRef, useState } from "react";
import { PENDING_SHARE_EVENT, readPendingShare, savePendingShare, type PendingShare } from "../lib/shareInvite";
import { shareTokenFromText, urlWithoutShare } from "../lib/sharing";
import { writeUiState } from "../lib/uiState";
import { useStudyStore } from "../store/useStudyStore";

/**
 * Link e QR di condivisione a livello di app: all'avvio (o se cambia il frammento) legge
 * #condividi=…, lo ricorda, pulisce l'URL e apre Condivisione sulla scheda Inviti.
 * Nessun import di Supabase: l'anteprima la carica la vista quando serve.
 */
export function useShareInviteLinks(ready: boolean) {
  const openSharing = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const capture = () => {
      const token = shareTokenFromText(window.location.href);
      if (!token) return;
      savePendingShare(token);
      window.history.replaceState(window.history.state, "", urlWithoutShare(window.location.href));
      writeUiState("sharing.tab", "invites", "tab");
      if (readyRef.current) useStudyStore.getState().setActiveView("sharing");
      else openSharing.current = true;
    };
    capture();
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);

  useEffect(() => {
    if (!ready || !openSharing.current) return;
    openSharing.current = false;
    useStudyStore.getState().setActiveView("sharing");
  }, [ready]);
}

/** Invito di condivisione in attesa (si aggiorna anche da altre schede). */
export function usePendingShare() {
  const [pending, setPending] = useState<PendingShare | null>(() => readPendingShare());
  useEffect(() => {
    const update = () => setPending(readPendingShare());
    window.addEventListener(PENDING_SHARE_EVENT, update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener(PENDING_SHARE_EVENT, update);
      window.removeEventListener("storage", update);
    };
  }, []);
  return pending;
}
