// Richieste del connettore remoto da confermare nell'app (supabase/agent-parity.sql, 1.12.0): dare,
// cambiare o togliere condivisioni e scrivere dati che altre persone condividono. L'hub non ha la
// sessione della persona: mette la richiesta in studyos_agent_requests e manda una notifica push
// (?apri=agenti). Qui si leggono le proprie richieste in attesa, si chiede conferma con lo stesso
// dialogo del connettore principale (agentLink.handleRemoteRequest) e si scrive l'esito, che l'agente
// legge con studyos_approval_status.
// Si controlla all'avvio, quando la pagina torna visibile, ogni 30 secondi con la pagina in vista e
// quando si tocca la notifica. Modulo pigro: lo carica App dopo l'avvio, solo con il cloud configurato.

import { CLOUD_DEFERRED } from "../agent/cloudDeferred";
import type { AgentCallResult } from "../agent/types";
import { dismissPendingCall, handleRemoteRequest } from "./agentLink";
import { cloudConfigured, getCloudSyncState, subscribeCloudSync } from "./cloudSyncState";
import { AGENT_REQUESTS_EVENT } from "./openLink";
import { supabase } from "./supabase";
import { useSharedStore } from "../store/useSharedStore";

const CHECK_MS = 30_000;
/** Richieste lette per controllo: il database ne tiene al più 20 in attesa per account. */
const MAX_PENDING = 20;
const FALLBACK_ACTOR = "Assistente remoto";

interface RequestRow {
  id: string;
  tool: string;
  args: unknown;
  client_label: string | null;
}

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Tabella non ancora creata (agent-parity.sql non eseguito): niente controlli in questa sessione. */
export const missingTable = (error: { code?: string; message?: string }) =>
  error.code === "PGRST205" || error.code === "42P01" || /does not exist|could not find the table/i.test(error.message ?? "");

/** Id nel dialogo: diverso da quelli del connettore principale. */
export const remoteCallId = (id: string) => `remote:${id}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const startCloudRequests = () => {
  const client = supabase;
  if (!cloudConfigured || !client) return () => undefined;
  let stopped = false;
  let missing = false;
  let checking = false;
  let again = false;
  // Richieste seguite da questa scheda (dialogo aperto o esecuzione in corso).
  const handling = new Set<string>();

  const handle = async (row: RequestRow) => {
    handling.add(row.id);
    try {
      // Solo gli strumenti che il database accetta come richiesta: qualsiasi altro si rifiuta.
      if (!CLOUD_DEFERRED.has(row.tool)) {
        await client.rpc("studyos_agent_request_decide", { p_id: row.id, p_approve: false });
        return;
      }
      await handleRemoteRequest(
        { id: remoteCallId(row.id), name: row.tool, args: isRecord(row.args) ? row.args : {}, actorName: row.client_label?.trim() || FALLBACK_ACTOR },
        {
          claim: async (approve) => {
            const { data, error } = await client.rpc("studyos_agent_request_decide", { p_id: row.id, p_approve: approve });
            if (error) throw new Error(error.message);
            return data === true;
          },
          report: async (result: AgentCallResult) => {
            // Una rete che va e viene non deve lasciare l'agente senza esito: tre tentativi, poi il
            // database chiude da solo la richiesta dopo 15 minuti (esito sconosciuto).
            for (let attempt = 1; attempt <= 3; attempt += 1) {
              const { error } = await client.rpc("studyos_agent_request_finish", { p_id: row.id, p_result: result });
              if (!error) return;
              await sleep(1000 * attempt);
            }
          }
        }
      );
    } catch {
      // Rete: la richiesta resta in attesa e torna al controllo successivo.
    } finally {
      handling.delete(row.id);
    }
  };

  const check = async () => {
    // Le condivisioni vogliono la sessione della condivisione già pronta (viewerId): prima, una conferma
    // eseguita subito fallirebbe e l'agente dovrebbe ripetere la richiesta.
    if (stopped || missing || !getCloudSyncState().session || !useSharedStore.getState().viewerId) return;
    if (checking) {
      again = true;
      return;
    }
    checking = true;
    try {
      const { data, error } = await client
        .from("studyos_agent_requests")
        .select("id, tool, args, client_label")
        .eq("status", "pending")
        .gt("expires_at", new Date().toISOString())
        .order("created_at", { ascending: true })
        .limit(MAX_PENDING);
      if (error) {
        if (missingTable(error)) missing = true;
        return;
      }
      const rows = (Array.isArray(data) ? data : []) as RequestRow[];
      const pending = new Set(rows.map((row) => row.id));
      // Decise su un altro dispositivo o scadute: il dialogo qui non vale più.
      for (const id of handling) if (!pending.has(id)) dismissPendingCall(remoteCallId(id));
      for (const row of rows) if (!handling.has(row.id) && typeof row.tool === "string") void handle(row);
    } catch {
      // Rete assente: al controllo successivo.
    } finally {
      checking = false;
      if (again && !stopped) {
        again = false;
        void check();
      }
    }
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") void check();
  };
  const interval = window.setInterval(() => {
    if (document.visibilityState === "visible") void check();
  }, CHECK_MS);
  let signedInAs: string | null = null;
  const unsubscribe = subscribeCloudSync((sync) => {
    const user = sync.session?.user.id ?? null;
    if (user === signedInAs) return;
    signedInAs = user;
    if (user) void check();
  });
  const onRequest = () => void check();
  const unsubscribeShared = useSharedStore.subscribe((state, previous) => {
    if (state.viewerId && state.viewerId !== previous.viewerId) void check();
  });
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
  window.addEventListener("online", onVisible);
  window.addEventListener(AGENT_REQUESTS_EVENT, onRequest);

  return () => {
    stopped = true;
    window.clearInterval(interval);
    unsubscribe();
    unsubscribeShared();
    document.removeEventListener("visibilitychange", onVisible);
    window.removeEventListener("focus", onVisible);
    window.removeEventListener("online", onVisible);
    window.removeEventListener(AGENT_REQUESTS_EVENT, onRequest);
    for (const id of handling) dismissPendingCall(remoteCallId(id));
  };
};
