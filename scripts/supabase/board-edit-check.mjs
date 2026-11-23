#!/usr/bin/env node
// Prova API degli annunci della bacheca modificabili (revisione del 23/11/2026), con le stesse chiamate
// di src/lib/groupSync.ts: Alice (proprietaria), Birillo (membro, autore), Carla (amministratrice),
// Dave (membro), Mallory (estranea). Controlla permessi, versioni precedenti scritte dal server, evento
// in tempo reale, avviso in app (boardEditNotices) e notifica push agli altri membri (Worker finto).
// Solo contro lo stack Supabase LOCALE (porte 55421-55429): vedi scripts/supabase/local-stack.md.
// Come people-check.mjs mette in Vault dello stack locale un segreto e l'indirizzo del Worker finto
// (127.0.0.1:55428, che pg_net raggiunge come host.docker.internal:55428).
// Esecuzione dalla radice del repository:
//   SUPABASE_URL=… SUPABASE_KEY=… PGURL=… node --import ./scripts/lib/register-ts.mjs scripts/supabase/board-edit-check.mjs
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { boardEditNotices, resourceFromRow } from "../../src/lib/groups.ts";

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_KEY ?? "";
const pgUrl = process.env.PGURL ?? "";
const localPort = (value, from, to) => {
  try {
    const { hostname, port } = new URL(value);
    return ["127.0.0.1", "localhost", "[::1]"].includes(hostname) && Number(port) >= from && Number(port) <= to;
  } catch {
    return false;
  }
};
if (!localPort(url, 55421, 55429) || !localPort(pgUrl, 55421, 55429)) {
  console.error("Solo stack locale: SUPABASE_URL e PGURL devono puntare a 127.0.0.1 o localhost sulle porte 55421-55429.");
  process.exit(2);
}
if (!key) {
  console.error("SUPABASE_KEY mancante: leggila da `supabase status -o env` (PUBLISHABLE_KEY).");
  process.exit(2);
}

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) passed += 1;
  else failures.push(detail ? `${name} — ${detail}` : name);
  console.log(`${condition ? "✓" : "✗"} ${name}${!condition && detail ? ` (${detail})` : ""}`);
};
class Abort extends Error {}
const need = (name, condition, detail = "") => {
  check(name, condition, detail);
  if (!condition) throw new Abort(name);
};

const run = Date.now().toString(36);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, ms = 10_000) => {
  const until = Date.now() + ms;
  while (!predicate() && Date.now() < until) await sleep(100);
  return predicate();
};

// Segreti in Vault per il Worker finto (come people-check.mjs).
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sql = (query) =>
  execFileSync("psql", [pgUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-At", "-c", query], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const setSecret = (name, value) =>
  sql(`do $$
begin
  if exists (select 1 from vault.secrets where name = ${lit(name)}) then
    perform vault.update_secret((select id from vault.secrets where name = ${lit(name)}), ${lit(value)});
  else
    perform vault.create_secret(${lit(value)}, ${lit(name)});
  end if;
end $$;`);
const STUB_PORT = 55428;
const secret = randomBytes(24).toString("hex");
const pushes = [];
const owners = new Map();
const privateEndpoints = new Set();
const stub = createServer((request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    let body = null;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      body = null;
    }
    pushes.push({ secret: request.headers["x-studyos-push-secret"], body });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ sent: Array.isArray(body?.subscriptions) ? body.subscriptions.length : 0, gone: 0 }));
  });
});
const withTag = (tag) => pushes.filter((push) => push.body?.notification?.tag === tag);
const isPrivateBatch = (push) => (push.body?.subscriptions ?? []).every((subscription) => privateEndpoints.has(subscription.endpoint));
const receivers = (list) =>
  list
    .flatMap((push) => push.body?.subscriptions ?? [])
    .map((subscription) => owners.get(subscription.endpoint) ?? "?")
    .sort()
    .join(",");
const pushKeys = () => ({ p256dh: randomBytes(65).toString("base64url"), auth: randomBytes(16).toString("base64url") });
const subscribe = async (who, isPrivate = false) => {
  const endpoint = `https://push.example.test/${who.label}${isPrivate ? "-private" : ""}-${run}-${randomBytes(4).toString("hex")}`;
  const { error } = await who.client.from("studyos_push_subscriptions").upsert({ endpoint, ...pushKeys(), ...(isPrivate ? { private: true } : {}) }, { onConflict: "endpoint" });
  if (!error) {
    owners.set(endpoint, who.label);
    if (isPrivate) privateEndpoints.add(endpoint);
  }
  return error;
};

const account = async (label) => {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `${label}-${run}@studyos.test`;
  const { data, error } = await client.auth.signUp({ email, password: `Prova-${run}-${label}!` });
  if (error || !data.session) throw new Error(`Registrazione di ${label}: ${error?.message ?? "conferma email attiva nello stack"}`);
  return { client, id: data.user.id, label };
};

// Come updateSharedResourceContent: update mirato, il timbro lo scrive il server.
const editContent = (who, id, content) =>
  who.client
    .from("studyos_group_resources")
    .update({ title: content.title, url: content.url ?? null, body: content.body ?? null })
    .eq("id", id)
    .select("*");

const readResource = async (who, id) => {
  const { data, error } = await who.client.from("studyos_group_resources").select("*").eq("id", id);
  if (error) throw new Error(`lettura ${who.label}: ${error.message}`);
  return data[0] ? resourceFromRow(data[0]) : null;
};

const main = async () => {
  await new Promise((resolve) => stub.listen(STUB_PORT, "127.0.0.1", resolve));
  setSecret("studyos_push_secret", secret);
  setSecret("studyos_push_url", `http://host.docker.internal:${STUB_PORT}/push`);

  const alice = await account("alice");
  const birillo = await account("birillo");
  const carla = await account("carla");
  const dave = await account("dave");
  const mallory = await account("mallory");
  for (const who of [alice, birillo, carla, dave]) need(`iscrizione push di ${who.label}`, !(await subscribe(who)));
  need("iscrizione con la password dell'app (Dave)", !(await subscribe(dave, true)));

  const groupId = `studyGroup_${run}`;
  const code = `GRP-${run.slice(-4).toUpperCase().padStart(4, "X")}-TEST`;
  // pushSharedGroup + pushSharedMembership
  const created = await alice.client
    .from("studyos_groups")
    .upsert({ id: groupId, name: "Lezioni", description: "", owner_id: alice.id, owner_display_name: "Alice", invite_code: code }, { onConflict: "id" });
  need("gruppo creato", !created.error, created.error?.message);
  const owner = await alice.client
    .from("studyos_group_members")
    .upsert({ group_id: groupId, user_id: alice.id, email: null, display_name: "Alice", role: "owner" }, { onConflict: "group_id,user_id" });
  need("proprietaria registrata", !owner.error, owner.error?.message);
  for (const [who, name] of [[birillo, "Birillo"], [carla, "Carla"], [dave, "Dave"]]) {
    const joined = await who.client.rpc("join_group_by_code", { p_code: code, p_display_name: name });
    need(`${name} entra con il codice`, !joined.error, joined.error?.message);
  }
  const promoted = await alice.client.from("studyos_group_members").update({ role: "admin" }).eq("group_id", groupId).eq("user_id", carla.id).select();
  need("Carla amministratrice", !promoted.error && promoted.data?.length === 1, promoted.error?.message);

  // Birillo pubblica (pushSharedResource), anche con versioni inventate.
  const resourceId = `groupResource_${run}`;
  const published = await birillo.client.from("studyos_group_resources").upsert(
    {
      id: resourceId,
      group_id: groupId,
      kind: "note",
      title: "Orari",
      url: null,
      body: "Aula 3",
      pinned: false,
      added_by_user_id: birillo.id,
      added_by_display_name: "Birillo",
      revisions: [{ id: "finto", at: new Date().toISOString(), title: "falso", byUserId: alice.id, byDisplayName: "Alice" }]
    },
    { onConflict: "id" }
  );
  need("annuncio pubblicato", !published.error, published.error?.message);
  const daveBefore = await readResource(dave, resourceId);
  check("pubblicazione: versioni inventate ignorate", daveBefore?.revisions?.length === 0, JSON.stringify(daveBefore?.revisions));

  // Dave guarda i suoi gruppi come watchGroups (UPDATE sulla bacheca filtrato per gruppo).
  // L'ascolto delle modifiche parte con il messaggio «Subscribed to PostgreSQL», che arriva dopo
  // SUBSCRIBED (l'app copre quel tratto con un pull a SUBSCRIBED, vedi watchGroups).
  const events = [];
  let listening = false;
  const channel = dave.client
    .channel(`studyos-groups:${dave.id}`)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "studyos_group_resources", filter: `group_id=in.(${groupId})` }, (payload) => events.push(payload))
    .on("system", {}, (payload) => {
      if (payload?.extension === "postgres_changes" && payload?.status === "ok") listening = true;
    })
    .subscribe();
  check("canale dei gruppi attivo", await waitFor(() => listening, 10_000));

  // Birillo (autore) modifica.
  const started = Date.now();
  const edit = await editContent(birillo, resourceId, { title: "Orari", body: "Aula 5" });
  need("modifica dell'autore accettata", !edit.error && edit.data?.length === 1, edit.error?.message);
  const saved = resourceFromRow(edit.data[0]);
  check("la riga restituita porta la versione precedente", saved.revisions?.length === 1 && saved.revisions[0].body === "Aula 3");
  check("nome di chi modifica dai membri", saved.revisions?.[0]?.byDisplayName === "Birillo" && saved.revisions[0].byUserId === birillo.id);
  check("ora della modifica = timbro della riga", Date.parse(saved.revisions?.[0]?.at ?? "") === Date.parse(saved.updatedAt));

  const arrived = await waitFor(() => events.length > 0, 5000);
  check("Dave riceve la modifica in tempo reale", arrived, `${events.length} eventi`);
  if (arrived) console.log(`  (arrivata in ${((Date.now() - started) / 1000).toFixed(2)} s)`);

  // Dave scarica e calcola l'avviso in app come pullSharedUpdates.
  const daveAfter = await readResource(dave, resourceId);
  const notices = boardEditNotices({ current: [daveBefore], incoming: [daveAfter], groups: [{ id: groupId, name: "Lezioni" }], me: dave.id });
  check("un avviso in app per Dave", notices.length === 1, JSON.stringify(notices));
  check(
    "testo dell'avviso in app",
    notices[0]?.title === 'Modifica annuncio in bacheca "Lezioni" da parte di Birillo' && notices[0]?.body === '"Orari": modificato il testo.',
    `${notices[0]?.title} / ${notices[0]?.body}`
  );
  check("nessun avviso in app a chi ha modificato", boardEditNotices({ current: [daveBefore], incoming: [daveAfter], groups: [], me: birillo.id }).length === 0);

  // Notifica push: tutti gli altri membri, stesso testo dell'avviso in app, generica dove c'è la password.
  const tag = `board-edit:${createHash("md5").update(saved.revisions[0].id).digest("hex")}`;
  check("push arrivata al Worker", await waitFor(() => withTag(tag).length >= 2), `${pushes.length} richieste`);
  const full = withTag(tag).filter((push) => !isPrivateBatch(push));
  const generic = withTag(tag).filter(isPrivateBatch);
  check("push agli altri membri, non a chi modifica", receivers(full) === "alice,carla,dave", receivers(full));
  check(
    "push con lo stesso testo dell'avviso in app",
    full[0]?.body?.notification?.title === notices[0]?.title && full[0]?.body?.notification?.body === notices[0]?.body,
    JSON.stringify(full[0]?.body?.notification)
  );
  check("push: tipo e indirizzo ammessi dal Worker", full[0]?.body?.notification?.kind === "accepted" && full[0]?.body?.notification?.url === "?apri=gruppi");
  check(
    "push generica al dispositivo con la password",
    receivers(generic) === "dave" && generic.every((push) => push.body.notification.title === "StudyOS" && push.body.notification.body === "Hai una nuova notifica."),
    JSON.stringify(generic.map((push) => push.body.notification))
  );
  check("segreto in ogni richiesta", pushes.every((push) => push.secret === secret));

  // Riscrivere la cronologia o cambiare solo il fissaggio non aggiunge versioni né notifiche.
  const before = pushes.length;
  const forged = await birillo.client.from("studyos_group_resources").update({ revisions: [] }).eq("id", resourceId).select("revisions");
  check("cronologia non riscrivibile", !forged.error && forged.data?.[0]?.revisions?.length === 1, forged.error?.message);
  const pin = await dave.client.from("studyos_group_resources").update({ pinned: true }).eq("id", resourceId).select("revisions, pinned");
  check("un membro fissa senza creare versioni", !pin.error && pin.data?.[0]?.pinned === true && pin.data[0].revisions.length === 1, pin.error?.message);
  await sleep(1500);
  check("fissare e riscrivere la cronologia: nessuna push", pushes.length === before, `${pushes.length - before} richieste in più`);

  // Dave non è autore né amministratore: rifiutato dal trigger (P0001, come lo legge groupSync).
  const denied = await editContent(dave, resourceId, { title: "Hack", body: "Aula 5" });
  check("membro non autore rifiutato", denied.error?.code === "P0001", denied.error ? `${denied.error.code} ${denied.error.message}` : "nessun errore");

  // Mallory non è nel gruppo: nessuna riga e nessun errore (groupSync: "gone").
  const outsider = await editContent(mallory, resourceId, { title: "Hack" });
  check("estranea: zero righe", !outsider.error && outsider.data?.length === 0, outsider.error?.message);

  // Carla (amministratrice) modifica l'annuncio di Birillo; Alice ripristina la prima versione.
  const admin = await editContent(carla, resourceId, { title: "Orari di giovedì", body: "Aula 5" });
  check("amministratrice modifica", !admin.error && admin.data?.[0]?.revisions?.at(-1)?.byDisplayName === "Carla", admin.error?.message);
  const adminTag = `board-edit:${createHash("md5").update(admin.data?.[0]?.revisions?.at(-1)?.id ?? "").digest("hex")}`;
  check("push della modifica di Carla agli altri", (await waitFor(() => withTag(adminTag).length >= 2)) && receivers(withTag(adminTag).filter((push) => !isPrivateBatch(push))) === "alice,birillo,dave");
  check(
    "push di Carla: titolo cambiato",
    withTag(adminTag).find((push) => !isPrivateBatch(push))?.body?.notification?.body === '"Orari di giovedì" (prima "Orari"): modificato il titolo.'
  );
  const restored = await editContent(alice, resourceId, { title: "Orari", body: "Aula 3" });
  const final = restored.data?.[0] ? resourceFromRow(restored.data[0]) : null;
  check("ripristino = modifica nuova della proprietaria", final?.revisions?.length === 3 && final.revisions.at(-1).byDisplayName === "Alice" && final.title === "Orari");

  await dave.client.removeChannel(channel);
  // Pulizia: il gruppo (e a cascata bacheca e membri) sparisce; via anche le iscrizioni di prova.
  const removed = await alice.client.from("studyos_groups").delete().eq("id", groupId);
  check("pulizia", !removed.error, removed.error?.message);
  for (const who of [alice, birillo, carla, dave]) await who.client.from("studyos_push_subscriptions").delete().eq("user_id", who.id);
};

try {
  await main();
} catch (error) {
  if (!(error instanceof Abort)) {
    failures.push(error instanceof Error ? error.message : String(error));
    console.log(`✗ ${error instanceof Error ? error.message : error}`);
  }
} finally {
  await new Promise((resolve) => stub.close(() => resolve()));
}
console.log(`\n${passed} controlli superati, ${failures.length} falliti.`);
if (failures.length) console.log(failures.map((item) => `- ${item}`).join("\n"));
process.exit(failures.length ? 1 : 0);
