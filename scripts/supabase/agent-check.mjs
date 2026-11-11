#!/usr/bin/env node
// Prova agent.sql con le stesse chiamate dell'app (permesso con «Consenti») e dell'hub del
// connettore remoto (pull e push col segreto e la chiave publishable).
// Solo contro lo stack Supabase LOCALE (porte 55421-55429): vedi scripts/supabase/local-stack.md.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_KEY ?? "";
const pgUrl = process.env.PGURL ?? "";
const parse = (value) => {
  try {
    const { hostname, port } = new URL(value);
    return { host: hostname, port: Number(port) };
  } catch {
    return null;
  }
};
const isLocal = (target) =>
  Boolean(target) && ["127.0.0.1", "localhost", "[::1]"].includes(target.host) && target.port >= 55421 && target.port <= 55429;
if (!url || !key || !pgUrl) {
  console.error("Servono SUPABASE_URL, SUPABASE_KEY (publishable) e PGURL dello stack locale (vedi scripts/supabase/local-stack.md).");
  process.exit(2);
}
if (!isLocal(parse(url)) || !isLocal(parse(pgUrl))) {
  console.error("Solo stack locale: SUPABASE_URL e PGURL devono puntare a 127.0.0.1 o localhost sulle porte 55421-55429.");
  process.exit(2);
}

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) passed += 1;
  else failures.push(detail ? `${name} — ${detail}` : name);
  console.log(`${condition ? "✓" : "✗"} ${name}${!condition && detail ? ` (${detail})` : ""}`);
};
const sql = (query) => execFileSync("psql", [pgUrl, "-At", "-v", "ON_ERROR_STOP=1", "-c", query], { encoding: "utf8" }).trim();
const lit = (value) => `'${String(value).replace(/'/g, "''")}'`;
const run = randomUUID().slice(0, 8);
const options = { auth: { persistSession: false, autoRefreshToken: false } };

const account = async (label) => {
  const client = createClient(url, key, options);
  const { data, error } = await client.auth.signUp({ email: `${label}-${run}@studyos.test`, password: `Prova-${run}-${label}!` });
  if (error || !data.session) throw new Error(`Registrazione di ${label}: ${error?.message ?? "conferma email attiva nello stack"}`);
  return { client, id: data.user.id, label };
};

const stamp = (offsetMinutes) => new Date(Date.UTC(2026, 10, 11, 10, offsetMinutes)).toISOString();
const INVALID = "Collegamento dell'assistente non valido o revocato.";

const main = async () => {
  const anon = createClient(url, key, options);
  const alice = await account("alice");
  const bob = await account("bob");

  const anonymous = await anon.rpc("studyos_create_agent_grant", { p_label: "ChatGPT" });
  check("Senza accesso non si crea un permesso", Boolean(anonymous.error));

  const created = await alice.client.rpc("studyos_create_agent_grant", { p_label: "ChatGPT" });
  const secret = created.data;
  check("Alice crea un permesso e riceve un segreto di 64 caratteri", !created.error && /^[0-9a-f]{64}$/.test(secret ?? ""), created.error?.message);
  const stored = sql(`select secret_hash, label from public.studyos_agent_grants where user_id = ${lit(alice.id)}`);
  check("Nel database c'è solo l'hash, non il segreto", stored.length > 0 && !stored.includes(secret) && stored.endsWith("|ChatGPT"), stored);
  const bobView = await bob.client.from("studyos_agent_grants").select("id");
  check("Bob non vede i permessi di Alice", !bobView.error && bobView.data.length === 0, bobView.error?.message);
  const anonView = await anon.from("studyos_agent_grants").select("id");
  check("Senza accesso la tabella dei permessi non si legge", Boolean(anonView.error) || anonView.data.length === 0);

  // Dati di Alice scritti dall'app, con file incorporati.
  const task = { id: `task_${run}`, title: "Ripasso", updatedAt: stamp(0), cover: "data:image/png;base64,COPERTINA" };
  const file = { id: `att_${run}`, name: "dispense", updatedAt: stamp(0), dataUrl: "data:application/pdf;base64,FILE" };
  const pushed = await alice.client.rpc("push_studyos_rows", {
    p_user_id: alice.id,
    p_client_id: "browser",
    p_rows: [
      { entity_type: "task", entity_id: task.id, payload: task, deleted: false },
      { entity_type: "attachment", entity_id: file.id, payload: file, deleted: false }
    ]
  });
  check("L'app di Alice scrive due righe", !pushed.error && pushed.data.every((row) => row.accepted), pushed.error?.message);

  const pulled = await anon.rpc("studyos_agent_pull", { p_secret: secret, p_since: null, p_offset: 0, p_limit: 500 });
  const byId = new Map((pulled.data ?? []).map((row) => [row.entity_id, row]));
  check("L'hub legge le righe di Alice col segreto", !pulled.error && byId.has(task.id) && byId.has(file.id), pulled.error?.message);
  check("Il pull toglie copertine e file incorporati",
    byId.get(task.id)?.payload.cover === undefined && byId.get(file.id)?.payload.dataUrl === undefined && byId.get(task.id)?.payload.title === "Ripasso");
  const lastUsed = sql(`select last_used_at is not null from public.studyos_agent_grants where user_id = ${lit(alice.id)}`);
  check("Il permesso registra l'ultimo uso", lastUsed === "t", lastUsed);

  const update = await anon.rpc("studyos_agent_push", {
    p_secret: secret,
    p_client_id: "agent-cloud",
    p_rows: [{ entity_type: "task", entity_id: task.id, payload: { id: task.id, title: "Ripasso capitolo 3", updatedAt: stamp(5) }, deleted: false }]
  });
  check("L'hub aggiorna una riga più recente", !update.error && update.data?.[0]?.accepted === true, update.error?.message);
  const saved = JSON.parse(sql(`select payload::text from public.studyos_items where user_id = ${lit(alice.id)} and entity_id = ${lit(task.id)}`));
  check("La copertina torna dalla riga attuale", saved.title === "Ripasso capitolo 3" && saved.cover === task.cover, JSON.stringify(saved));
  const client = sql(`select client_id from public.studyos_items where user_id = ${lit(alice.id)} and entity_id = ${lit(task.id)}`);
  check("La riga porta il client dell'hub, così l'app la ritira", client === "agent-cloud", client);

  const stale = await anon.rpc("studyos_agent_push", {
    p_secret: secret,
    p_client_id: "agent-cloud",
    p_rows: [{ entity_type: "task", entity_id: task.id, payload: { id: task.id, title: "Vecchia", updatedAt: stamp(1) }, deleted: false }]
  });
  check("Una versione più vecchia viene rifiutata (LWW)", !stale.error && stale.data?.[0]?.accepted === false, stale.error?.message);

  const created2 = await anon.rpc("studyos_agent_push", {
    p_secret: secret,
    p_client_id: "agent-cloud",
    p_rows: [{ entity_type: "task", entity_id: `task_new_${run}`, payload: { id: `task_new_${run}`, title: "Nuova", updatedAt: stamp(6) }, deleted: false }]
  });
  check("L'hub crea una riga nuova", !created2.error && created2.data?.[0]?.accepted === true, created2.error?.message);

  const tombstone = await anon.rpc("studyos_agent_push", {
    p_secret: secret,
    p_client_id: "agent-cloud",
    p_rows: [{ entity_type: "attachment", entity_id: file.id, payload: { id: file.id, deletedAt: stamp(7) }, deleted: true }]
  });
  const deleted = sql(`select deleted from public.studyos_items where user_id = ${lit(alice.id)} and entity_id = ${lit(file.id)}`);
  check("L'hub elimina con un tombstone", !tombstone.error && tombstone.data?.[0]?.accepted === true && deleted === "t", tombstone.error?.message ?? deleted);

  const snapshot = await anon.rpc("studyos_agent_push", {
    p_secret: secret,
    p_client_id: "agent-cloud",
    p_rows: [{ entity_type: "snapshot", entity_id: "main", payload: { id: "main" }, deleted: false }]
  });
  check("Lo snapshot legacy non si scrive", Boolean(snapshot.error));

  const mismatch = await anon.rpc("studyos_agent_push", {
    p_secret: secret,
    p_client_id: "agent-cloud",
    p_rows: [{ entity_type: "task", entity_id: "a", payload: { id: "b", updatedAt: stamp(8) }, deleted: false }]
  });
  check("Id del payload diverso dall'entità: rifiutato", Boolean(mismatch.error));

  const wrong = await anon.rpc("studyos_agent_pull", { p_secret: "0".repeat(64), p_since: null, p_offset: 0, p_limit: 10 });
  check("Un segreto sbagliato non legge niente", wrong.error?.message === INVALID, wrong.error?.message ?? "nessun errore");
  const wrongPush = await anon.rpc("studyos_agent_push", { p_secret: "x", p_client_id: "agent-cloud", p_rows: [] });
  check("Un segreto sbagliato non scrive niente", wrongPush.error?.message === INVALID, wrongPush.error?.message ?? "nessun errore");

  const bobGrant = await bob.client.rpc("studyos_create_agent_grant", { p_label: "ChatGPT" });
  const bobRows = await anon.rpc("studyos_agent_pull", { p_secret: bobGrant.data, p_since: null, p_offset: 0, p_limit: 500 });
  check("Il segreto di Bob legge solo le righe di Bob", !bobRows.error && bobRows.data.length === 0, bobRows.error?.message ?? `${bobRows.data?.length} righe`);
  const bobWrite = await anon.rpc("studyos_agent_push", {
    p_secret: bobGrant.data,
    p_client_id: "agent-cloud",
    p_rows: [{ entity_type: "task", entity_id: task.id, payload: { id: task.id, title: "Di Bob", updatedAt: stamp(30) }, deleted: false }]
  });
  const aliceTitle = JSON.parse(sql(`select payload::text from public.studyos_items where user_id = ${lit(alice.id)} and entity_id = ${lit(task.id)}`)).title;
  check("Il segreto di Bob non tocca la task di Alice", !bobWrite.error && aliceTitle === "Ripasso capitolo 3", bobWrite.error?.message ?? aliceTitle);

  const since = await anon.rpc("studyos_agent_pull", { p_secret: secret, p_since: new Date(Date.now() + 60_000).toISOString(), p_offset: 0, p_limit: 10 });
  check("Il pull da un istante futuro è vuoto", !since.error && since.data.length === 0, since.error?.message);

  const revoked = await alice.client.rpc("studyos_revoke_agent_grants");
  const after = await anon.rpc("studyos_agent_pull", { p_secret: secret, p_since: null, p_offset: 0, p_limit: 10 });
  check("Dopo la revoca il segreto non vale più", !revoked.error && revoked.data === 1 && after.error?.message === INVALID,
    revoked.error?.message ?? after.error?.message ?? "ancora valido");
  const bobStill = await anon.rpc("studyos_agent_pull", { p_secret: bobGrant.data, p_since: null, p_offset: 0, p_limit: 10 });
  check("La revoca di Alice non tocca il permesso di Bob", !bobStill.error, bobStill.error?.message);

  const direct = sql(`select has_function_privilege('anon', 'public.studyos_agent_user(text)', 'execute')`);
  check("La funzione interna studyos_agent_user non è chiamabile dall'esterno", direct === "f", direct);
};

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .then(() => {
    console.log(`\n${passed} controlli superati, ${failures.length} falliti.`);
    if (failures.length) console.log(failures.map((item) => `- ${item}`).join("\n"));
    process.exit(failures.length || process.exitCode ? 1 : 0);
  });
