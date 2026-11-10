// Tiene sveglio il progetto Supabase Free: due volte al giorno una vera scrittura nel database
// (funzione `studyos_keepalive`, vedi supabase/keepalive.sql). Worker separato dall'hub MCP.

interface Env {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
}

type Beat = { mode: "heartbeat" | "fallback"; detail: unknown };

const ATTEMPTS = 3;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function beatOnce(env: Env): Promise<Beat> {
  const base = env.SUPABASE_URL.replace(/\/+$/, "");
  const headers = { apikey: env.SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" };

  const rpc = await fetch(`${base}/rest/v1/rpc/studyos_keepalive`, {
    method: "POST",
    headers,
    body: JSON.stringify({ p_source: "cloudflare" })
  });
  if (rpc.ok) return { mode: "heartbeat", detail: await rpc.json() };

  const rpcBody = await rpc.text();
  // Finché keepalive.sql non è stato eseguito: una SELECT che Postgres valuta (e rifiuta per i
  // permessi) tiene comunque attivo il database.
  if (rpc.status === 404 && rpcBody.includes("PGRST202")) {
    const select = await fetch(`${base}/rest/v1/studyos_items?select=id&limit=1`, { headers });
    const selectBody = await select.text();
    if (select.ok || (select.status === 401 && selectBody.includes("42501"))) {
      return { mode: "fallback", detail: "studyos_keepalive mancante: esegui supabase/keepalive.sql" };
    }
    throw new Error(`Supabase ha risposto ${select.status}: ${selectBody.slice(0, 200)}`);
  }
  throw new Error(`Supabase ha risposto ${rpc.status}: ${rpcBody.slice(0, 200)}`);
}

async function beat(env: Env): Promise<Beat> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
    try {
      return await beatOnce(env);
    } catch (error) {
      lastError = error;
      if (attempt < ATTEMPTS) await wait(attempt * 5_000);
    }
  }
  throw lastError;
}

export default {
  async scheduled(_controller: ScheduledController, env: Env) {
    const result = await beat(env);
    // Visibile nei log del Worker (osservabilità attiva in keepalive.jsonc).
    console.log(JSON.stringify({ keepalive: result.mode, detail: result.detail }));
    if (result.mode === "fallback") console.warn("Battito ridotto: manca la funzione studyos_keepalive.");
  }
} satisfies ExportedHandler<Env>;
