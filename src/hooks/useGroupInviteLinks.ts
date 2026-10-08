import { useEffect, useRef } from "react";
import { cloudConfigured, subscribeCloudSync } from "../lib/cloudSyncState";
import { GROUP_JOINED_EVENT, inviteCodeFromText, readPendingInvite, savePendingInvite, urlWithoutInvite } from "../lib/groupInvite";
import { writeUiState } from "../lib/uiState";
import { useStudyStore } from "../store/useStudyStore";

/**
 * Link e QR di invito a livello di app (qualunque sia l'ultima sezione aperta):
 * - all'avvio legge #invito=… (o ?invito=…), lo ricorda e pulisce l'URL, poi apre Gruppi;
 * - quando arriva una sessione (login, registrazione, ritorno dalla conferma email) completa
 *   l'invito che l'utente aveva già confermato;
 * - a ingresso avvenuto apre il gruppo.
 * groupSync (e con lui supabase-js) si carica solo quando serve davvero.
 */
export function useGroupInviteLinks(ready: boolean) {
  const openGroups = useRef(false);
  const readyRef = useRef(ready);
  readyRef.current = ready;

  useEffect(() => {
    const capture = () => {
      const code = inviteCodeFromText(window.location.href);
      if (!code) return;
      savePendingInvite(code);
      window.history.replaceState(window.history.state, "", urlWithoutInvite(window.location.href));
      if (readyRef.current) useStudyStore.getState().setActiveView("groups");
      else openGroups.current = true;
    };
    capture();
    // Link incollato in una scheda di StudyOS già aperta: cambia solo il frammento, niente reload.
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);

  useEffect(() => {
    if (!ready || !openGroups.current) return;
    openGroups.current = false;
    useStudyStore.getState().setActiveView("groups");
  }, [ready]);

  useEffect(() => {
    if (!ready || !cloudConfigured) return;
    let lastUserId: string | null = null;
    return subscribeCloudSync((state) => {
      const userId = state.session?.user.id ?? null;
      const changed = userId !== lastUserId;
      lastUserId = userId;
      if (!userId || !changed || !readPendingInvite()?.confirmed) return;
      void import("../lib/groupSync").then((module) => module.completePendingInvite()).catch(() => undefined);
    });
  }, [ready]);

  useEffect(() => {
    const onJoined = (event: Event) => {
      const groupId = (event as CustomEvent<{ groupId?: string }>).detail?.groupId;
      if (!groupId) return;
      writeUiState("groups.open", groupId, "tab");
      useStudyStore.getState().setActiveView("groups");
    };
    window.addEventListener(GROUP_JOINED_EVENT, onJoined);
    return () => window.removeEventListener(GROUP_JOINED_EVENT, onJoined);
  }, []);
}
