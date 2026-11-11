// Permesso cloud del connettore remoto (supabase/agent.sql). Modulo pigro: agentLink lo carica
// solo quando la persona preme «Consenti» su un connettore remoto o revoca gli accessi.
// Il segreto passa dall'app all'hub una volta sola e qui non viene salvato.

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
