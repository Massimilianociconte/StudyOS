// Strumenti che sul connettore remoto diventano una richiesta da confermare nell'app (1.12.0): dare,
// cambiare o togliere condivisioni e scrivere dati che altre persone condividono. Modulo senza
// dipendenze: lo usano il catalogo, l'app (agentCloudRequests.ts) e i test. Stesso elenco di
// studyos_agent_deferred_tool in supabase/agent-parity.sql.
export const CLOUD_DEFERRED: ReadonlySet<string> = new Set([
  "studyos_share_with",
  "studyos_update_share",
  "studyos_revoke_share",
  "studyos_create_shared_item",
  "studyos_update_shared_item",
  "studyos_delete_shared_item"
]);
