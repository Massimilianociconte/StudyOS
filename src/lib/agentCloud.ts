// Permesso cloud del connettore remoto (supabase/agent.sql). Modulo pigro: agentLink lo carica
// solo quando la persona preme «Consenti» su un connettore remoto o revoca gli accessi.
// Il segreto passa dall'app all'hub una volta sola e qui non viene salvato.

import type { RestoreOutcome, ServerAuditRow } from "../agent/remoteAudit";
import { toConnectorChange, type ConnectorChange } from "./agentChanges";
import { agentCloudLabels } from "./labels";
import { supabase } from "./supabase";

const SECRET_RE = /^[0-9a-f]{64}$/;

const browserTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Rome";
  } catch {
    return "Europe/Rome";
  }
};

const signedIn = async () => {
  if (!supabase) throw new Error(agentCloudLabels.noCloud);
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error(agentCloudLabels.signIn);
  return supabase;
};

const missingFunction = (error: { code?: string; message: string }) =>
  error.code === "PGRST202" || /could not find the function|does not exist/i.test(error.message);

/** Crea il permesso per l'account con cui è fatto l'accesso: segreto e fuso del browser per l'hub. */
export const createAgentGrant = async (label: string): Promise<{ secret: string; timeZone: string }> => {
  const client = await signedIn();
  const { data, error } = await client.rpc("studyos_create_agent_grant", { p_label: label.slice(0, 80) });
  if (error) throw new Error(missingFunction(error) ? agentCloudLabels.missingSql : error.message);
  if (typeof data !== "string" || !SECRET_RE.test(data)) throw new Error(agentCloudLabels.failed);
  return { secret: data, timeZone: browserTimeZone() };
};

/** Revoca tutti i permessi cloud dell'account. 0 senza accesso o senza agent.sql. */
export const revokeAgentGrants = async (): Promise<number> => {
  if (!supabase) return 0;
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return 0;
  const { data, error } = await supabase.rpc("studyos_revoke_agent_grants");
  if (error) {
    if (missingFunction(error)) return 0;
    throw new Error(error.message);
  }
  return typeof data === "number" ? data : 0;
};

export type ChangesPage =
  | { kind: "ok"; items: ConnectorChange[]; total: number }
  /** Senza accesso all'account: il registro è legato all'account. */
  | { kind: "signIn" }
  /** agent.sql di prima della 1.8.0: il registro non c'è ancora. */
  | { kind: "missingSql" };

/**
 * «Modifiche del connettore»: voci del registro del connettore remoto di questo account, la più recente
 * prima (studyos_agent_audit_own, solo le voci di chi ha fatto l'accesso). Errore di rete = eccezione.
 */
export const listConnectorChanges = async (offset: number, limit = 30): Promise<ChangesPage> => {
  if (!supabase) return { kind: "signIn" };
  const { data: session } = await supabase.auth.getSession();
  if (!session.session) return { kind: "signIn" };
  const { data, error } = await supabase.rpc("studyos_agent_audit_own", { p_limit: limit, p_offset: offset });
  if (error) {
    if (missingFunction(error)) return { kind: "missingSql" };
    throw new Error(error.message);
  }
  const rows = Array.isArray(data) ? (data as ServerAuditRow[]) : [];
  return { kind: "ok", items: rows.map(toConnectorChange), total: rows.length ? Number(rows[0].total) || offset + rows.length : offset };
};

/**
 * «Ripristina»: il database rimette la versione di prima solo se l'elemento non è cambiato dopo. Riuscito,
 * chiede subito una sincronizzazione: la riga ha client_id vuoto, quindi arriva anche a questo dispositivo.
 */
export const restoreConnectorChange = async (id: string): Promise<RestoreOutcome | null> => {
  const client = await signedIn();
  const { data, error } = await client.rpc("studyos_agent_restore_own", { p_audit_id: id });
  if (error) throw new Error(missingFunction(error) ? agentCloudLabels.missingSql : error.message);
  const outcome = data && typeof data === "object" ? (data as RestoreOutcome) : null;
  if (outcome?.status === "restored") {
    void import("./cloudSync").then((sync) => sync.requestSync()).catch(() => undefined);
  }
  return outcome;
};
