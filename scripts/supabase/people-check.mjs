#!/usr/bin/env node
// Prova API di people.sql con le stesse chiamate del client: profili, ricerca, inviti all'account,
// chiusura degli inviti per email, migrazione, iscrizioni e trigger delle notifiche push.
// Account: Alice (proprietaria), Bob (destinatario), Carla (amministratrice), Dario (non trovabile),
// Mallory (estranea), Erin (si registra dopo la migrazione).
// Le push arrivano a un Worker finto su questo computer (porta 55428): pg_net, nel container del
// database, lo raggiunge come host.docker.internal:55428.
// Solo contro lo stack Supabase LOCALE (porte 55421-55429): vedi scripts/supabase/local-stack.md.
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

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
const describe = (target) => (target ? `${target.host}:${target.port || "porta predefinita"}` : "URL non valido");
// Solo le porte 55421-55429 dello stack `studyos-sharing`: altri stack locali (5432x e simili) non si toccano.
const isLocal = (target) =>
  Boolean(target) && ["127.0.0.1", "localhost", "[::1]"].includes(target.host) && target.port >= 55421 && target.port <= 55429;
const api = parse(url);
const db = parse(pgUrl);
if (!url || !pgUrl) {
  console.error("SUPABASE_URL e PGURL servono entrambi: http://127.0.0.1:55421 e postgresql://postgres:postgres@127.0.0.1:55422/postgres (vedi scripts/supabase/local-stack.md).");
  process.exit(2);
}
if (!isLocal(api) || !isLocal(db)) {
  console.error(`Solo stack locale: SUPABASE_URL e PGURL devono puntare a 127.0.0.1 o localhost sulle porte 55421-55429 (trovati: ${describe(api)}, ${describe(db)}).`);
  process.exit(2);
}
if (!key) {
  console.error("SUPABASE_KEY mancante: copiala da `supabase status -o env`.");
  process.exit(2);
}

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) passed += 1;
  else failures.push(detail ? `${name} — ${detail}` : name);
  console.log(`${condition ? "✓" : "✗"} ${name}${!condition && detail ? ` (${detail})` : ""}`);
};
// Un controllo da cui dipendono tutti i successivi: se fallisce si interrompe con un esito pulito, senza stack.
class Abort extends Error {}
const need = (name, condition, detail = "") => {
  check(name, condition, detail);
  if (!condition) throw new Abort(name);
};
const rejects = async (name, request) => {
  const { error } = await request;
  check(name, Boolean(error), error ? "" : "nessun errore");
};
// Il messaggio esatto conta: il client lo mostra così com'è.
const errorIs = async (name, request, message) => {
  const { error } = await request;
  check(name, error?.message === message, error?.message ?? "nessun errore");
};
const summary = () => {
  console.log(`\n${passed} controlli superati, ${failures.length} falliti.`);
  if (failures.length) console.log(failures.map((item) => `- ${item}`).join("\n"));
};

const run = Date.now().toString(36);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const root = fileURLToPath(new URL("../../", import.meta.url));
const peopleSql = `${root}supabase/people.sql`;
const STUB_PORT = 55428;
const stubHost = process.env.PUSH_STUB_HOST ?? "127.0.0.1";
const stubTarget = process.env.PUSH_STUB_TARGET ?? "host.docker.internal";
const secret = randomBytes(24).toString("hex");

// psql per ciò che un client non può fare: segreti in Vault, inviti vecchi per email, rilancio di people.sql.
const md5 = (value) => createHash("md5").update(value).digest("hex");
const lit = (value) => `'${String(value).replaceAll("'", "''")}'`;
const psql = (args) => {
  try {
    return execFileSync("psql", [pgUrl, "-X", "-q", "-v", "ON_ERROR_STOP=1", ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trim();
  } catch (error) {
    throw new Error(`psql: ${String(error.stderr || error.message).trim()}`);
  }
};
const sql = (query) => psql(["-At", "-c", query]);
const runPeopleSql = () => psql(["-f", peopleSql]);
const setSecret = (name, value) => sql(`do $$
begin
  if exists (select 1 from vault.secrets where name = ${lit(name)}) then
    perform vault.update_secret((select id from vault.secrets where name = ${lit(name)}), ${lit(value)});
  else
    perform vault.create_secret(${lit(value)}, ${lit(name)});
  end if;
end $$;`);

// Worker finto: registra ogni richiesta e risponde come il Worker vero ({ sent, gone }).
const pushes = [];
const owners = new Map();
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
    pushes.push({ path: request.url, secret: request.headers["x-studyos-push-secret"], type: request.headers["content-type"] ?? "", body });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ sent: Array.isArray(body?.subscriptions) ? body.subscriptions.length : 0, gone: 0 }));
  });
});
const withTag = (tag) => pushes.filter((push) => push.body?.notification?.tag === tag);
// Chi riceve: etichette dei proprietari degli endpoint, in ordine, con i doppioni (una notifica a testa).
const receivers = (tag) =>
  withTag(tag)
    .flatMap((push) => push.body?.subscriptions ?? [])
    .map((subscription) => owners.get(subscription.endpoint) ?? "?")
    .sort()
    .join(",");
const notification = (tag) => withTag(tag)[0]?.body?.notification ?? null;
const waitFor = async (predicate, ms = 10_000) => {
  const until = Date.now() + ms;
  while (!predicate() && Date.now() < until) await sleep(100);
  return predicate();
};
const waitTag = (tag) => waitFor(() => withTag(tag).length > 0);

const account = async (label, ip, email = `${label}-${run}@studyos.test`) => {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signUp({ email, password: `Prova-${run}-${label}!` });
  if (error || !data.session) throw new Error(`Registrazione di ${label}: ${error?.message ?? "conferma email attiva nello stack"}`);
  return { client, email, id: data.user.id, label, ip };
};
// Ogni account cerca da un suo IP (cf-connecting-ip, come dietro Cloudflare): i limiti per IP non si
// mescolano tra le prove, tranne in quella che li verifica.
const find = (who, query, ip = who.ip) => who.client.rpc("find_person", { p_query: query }).setHeader("cf-connecting-ip", ip);
const handleFree = (who, handle) => who.client.rpc("is_handle_available", { p_handle: handle }).setHeader("cf-connecting-ip", who.ip);
const saveProfile = (who, patch) => who.client.from("studyos_profiles").upsert({ user_id: who.id, ...patch }, { onConflict: "user_id" });
const pushKeys = () => ({ p256dh: randomBytes(65).toString("base64url"), auth: randomBytes(16).toString("base64url") });
const subscribe = async (who, endpoint = `https://push.example.test/${who.label}-${run}-${randomBytes(4).toString("hex")}`) => {
  const { error } = await who.client.from("studyos_push_subscriptions").upsert({ endpoint, ...pushKeys() }, { onConflict: "endpoint" });
  if (!error) owners.set(endpoint, who.label);
  return { endpoint, error };
};
const ownRows = async (who, table, columns = "id") => {
  const { data, error } = await who.client.from(table).select(columns);
  return { rows: data ?? [], error: error?.message };
};

// Le policy e le funzioni toccate da people.sql devono essere identiche in groups.sql e sharing.sql:
// rieseguire uno qualsiasi dei tre file non deve riaprire l'accettazione per email.
const sameBlocks = () => {
  const read = (name) => readFileSync(`${root}supabase/${name}`, "utf8");
  const people = read("people.sql");
  const sources = { "groups.sql": read("groups.sql"), "sharing.sql": read("sharing.sql") };
  const blocks = [
    ["groups.sql", "colonna recipient_user_id degli inviti di gruppo", "alter table public.studyos_group_invites add column if not exists recipient_user_id", "\n"],
    ["groups.sql", "policy studyos_group_invites_select", "create policy studyos_group_invites_select ", ";\n"],
    ["groups.sql", "policy studyos_group_invites_insert", "create policy studyos_group_invites_insert ", ";\n"],
    ["groups.sql", "accept_group_invite", "create or replace function public.accept_group_invite(", "\n$$;\n"],
    ["groups.sql", "decline_group_invite", "create or replace function public.decline_group_invite(", "\n$$;\n"],
    ["sharing.sql", "colonna recipient_user_id degli inviti di condivisione", "alter table public.studyos_share_invites\n  add column if not exists recipient_user_id", ";\n"],
    ["sharing.sql", "policy studyos_share_invites_select", "create policy studyos_share_invites_select ", ";\n"],
    ["sharing.sql", "create_share_invite", "create or replace function public.create_share_invite(", "\n$$;\n"],
    ["sharing.sql", "preview_share_invite", "create or replace function public.preview_share_invite(", "\n$$;\n"],
    ["sharing.sql", "studyos_claim_share_invite", "create or replace function public.studyos_claim_share_invite(", "\n$$;\n"]
  ];
  for (const [file, label, start, end] of blocks) {
    const text = sources[file];
    const from = text.indexOf(start);
    const to = from < 0 ? -1 : text.indexOf(end, from + start.length);
    const block = to < 0 ? "" : text.slice(from, to + end.length);
    check(`Uguale in ${file} e people.sql: ${label}`, block !== "" && people.includes(block), block ? "testi diversi" : `blocco non trovato in ${file}`);
  }
};

const main = async () => {
  sameBlocks();

  // Worker finto e segreti di prova in Vault: le notifiche dello stack locale arrivano qui.
  await new Promise((resolve, reject) => {
    stub.once("error", reject);
    stub.listen(STUB_PORT, stubHost, resolve);
  });
  setSecret("studyos_push_secret", secret);
  setSecret("studyos_push_url", `http://${stubTarget}:${STUB_PORT}/push`);
  sql(`select net.http_post(url := ${lit(`http://${stubTarget}:${STUB_PORT}/ping`)}, body := '{}'::jsonb)`);
  need("pg_net raggiunge il Worker finto", await waitFor(() => pushes.some((push) => push.path === "/ping")),
    `nessuna richiesta in 10 s su ${stubTarget}:${STUB_PORT}; con Docker su Linux riprova con PUSH_STUB_HOST=0.0.0.0`);

  const alice = await account("alice", "198.51.100.1");
  const bob = await account("bob", "198.51.100.2");
  const carla = await account("carla", "198.51.100.3");
  const dario = await account("dario", "198.51.100.4");
  const mallory = await account("mallory", "198.51.100.5");
  const anon = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  // ─── Profili ──────────────────────────────────────────────────────────────
  const bobHandle = `bob_${run}`;
  const aliceHandle = `alice_${run}`;
  const darioHandle = `dario_${run}`;
  const { error: bobProfileError } = await saveProfile(bob, { display_name: "Bob", handle: bobHandle });
  need("Bob salva nome e @nome", !bobProfileError, bobProfileError?.message);
  const { data: mine } = await handleFree(bob, `@${bobHandle}`);
  const { data: taken } = await handleFree(alice, bobHandle);
  const { data: free } = await handleFree(alice, aliceHandle);
  check("@nome: già mio = libero, di un altro = occupato, nuovo = libero", mine === true && taken === false && free === true,
    JSON.stringify({ mine, taken, free }));
  await rejects("@nome con maiuscole o simboli rifiutato", saveProfile(alice, { display_name: "Alice", handle: "Alice!" }));
  await rejects("@nome già preso rifiutato", saveProfile(alice, { display_name: "Alice", handle: bobHandle }));
  await rejects("Nome oltre 60 caratteri rifiutato", saveProfile(alice, { display_name: "A".repeat(61) }));
  const { error: aliceProfileError } = await saveProfile(alice, { display_name: "Alice", handle: aliceHandle });
  check("Alice salva il profilo", !aliceProfileError, aliceProfileError?.message);
  const aliceView = await ownRows(alice, "studyos_profiles", "user_id");
  check("Ognuno legge solo il proprio profilo", aliceView.rows.length === 1 && aliceView.rows[0].user_id === alice.id,
    aliceView.error ?? `${aliceView.rows.length} righe`);
  const { data: hijack } = await alice.client.from("studyos_profiles").update({ display_name: "Preso" }).eq("user_id", bob.id).select();
  check("Alice non modifica il profilo di Bob", Array.isArray(hijack) && hijack.length === 0);
  const { error: darioProfileError } = await saveProfile(dario, { display_name: "Dario", handle: darioHandle, discoverable: false });
  check("Dario spegne «Gli altri possono trovarmi»", !darioProfileError, darioProfileError?.message);

  // ─── Ricerca ──────────────────────────────────────────────────────────────
  const byHandle = await find(alice, `@${bobHandle}`);
  check("Ricerca esatta per @nome", byHandle.data?.length === 1 && byHandle.data[0].person_id === bob.id
    && byHandle.data[0].display_name === "Bob" && byHandle.data[0].handle === bobHandle, byHandle.error?.message ?? JSON.stringify(byHandle.data));
  const byEmail = await find(alice, `  ${bob.email.toUpperCase()} `);
  check("Ricerca esatta per email (maiuscole e spazi ignorati), mai l'email nel risultato",
    byEmail.data?.[0]?.person_id === bob.id && Object.keys(byEmail.data[0]).sort().join(",") === "display_name,handle,person_id",
    byEmail.error?.message ?? JSON.stringify(byEmail.data));
  const partialEmail = await find(alice, bob.email.slice(0, -2));
  const partialHandle = await find(alice, `@${bobHandle.slice(0, -1)}`);
  check("Nessuna ricerca parziale", partialEmail.data?.length === 0 && partialHandle.data?.length === 0,
    JSON.stringify([partialEmail.data, partialHandle.data]));
  const self = await find(bob, bob.email);
  check("Mai sé stessi", !self.error && self.data?.length === 0, self.error?.message ?? JSON.stringify(self.data));
  const hiddenEmail = await find(alice, dario.email);
  const hiddenHandle = await find(alice, `@${darioHandle}`);
  const missing = await find(alice, `nessuno-${run}@studyos.test`);
  const answer = (result) => JSON.stringify({ status: result.status, data: result.data, error: result.error });
  check("Non trovabile e inesistente danno la stessa risposta",
    missing.data?.length === 0 && answer(hiddenEmail) === answer(missing) && answer(hiddenHandle) === answer(missing),
    `${answer(hiddenEmail)} / ${answer(hiddenHandle)} / ${answer(missing)}`);
  const noProfile = await find(alice, carla.email);
  check("Senza profilo: trovabile, nome vuoto e nessun @nome",
    noProfile.data?.[0]?.person_id === carla.id && noProfile.data[0].display_name === "" && noProfile.data[0].handle === null,
    noProfile.error?.message ?? JSON.stringify(noProfile.data));
  await rejects("Senza accesso la ricerca è negata", anon.rpc("find_person", { p_query: bob.email }));

  // ─── Iscrizioni push di prova ─────────────────────────────────────────────
  const subscriptions = [await subscribe(alice), await subscribe(bob), await subscribe(carla), await subscribe(mallory)];
  need("Iscrizioni push salvate (upsert su endpoint)", subscriptions.every((item) => !item.error),
    subscriptions.map((item) => item.error?.message).filter(Boolean).join("; "));
  const mallorySubscription = subscriptions[3];

  // ─── Inviti di gruppo ─────────────────────────────────────────────────────
  const groupId = `group-people-${run}`;
  const code = `GRP-${run.slice(-4).toUpperCase()}-PPLE`;
  const { error: groupError } = await alice.client.from("studyos_groups")
    .insert({ id: groupId, name: "Fisica 2", owner_id: alice.id, owner_display_name: "Alice", invite_code: code });
  const { error: ownerError } = await alice.client.from("studyos_group_members")
    .insert({ group_id: groupId, user_id: alice.id, email: alice.email, display_name: "Alice", role: "owner" });
  need("Alice crea il gruppo Fisica 2", !groupError && !ownerError, groupError?.message ?? ownerError?.message);

  const { error: joinError } = await carla.client.rpc("join_group_by_code", { p_code: code, p_display_name: "Carla" });
  check("Carla entra con il codice", !joinError, joinError?.message);
  const carlaJoin = `group-join:${md5(groupId)}:${carla.id}`;
  await waitTag(carlaJoin);
  check("Push «nuovo membro» (codice) solo alla proprietaria", receivers(carlaJoin) === "alice", receivers(carlaJoin) || "nessuna push");
  check("La push arriva con segreto, JSON e percorso /push",
    withTag(carlaJoin).length > 0 && withTag(carlaJoin).every((push) => push.secret === secret && push.type.startsWith("application/json") && push.path === "/push"));
  const joinText = notification(carlaJoin);
  check("Testo «nuovo membro» in italiano semplice",
    joinText?.kind === "accepted" && joinText.title === "Nuovo membro" && joinText.body === "Carla ora fa parte del gruppo Fisica 2"
      && joinText.url === "?apri=gruppi", JSON.stringify(joinText));
  const { error: promoteError } = await alice.client.from("studyos_group_members")
    .update({ role: "admin" }).eq("group_id", groupId).eq("user_id", carla.id);
  check("Alice nomina Carla amministratrice", !promoteError, promoteError?.message);

  const directInvite = (extra) => alice.client.from("studyos_group_invites").insert({
    id: `groupInvite_direct_${randomBytes(4).toString("hex")}`, group_id: groupId, group_name: "Fisica 2",
    from_user_id: alice.id, from_display_name: "Alice", code, status: "pending", ...extra
  });
  await rejects("Inserimento diretto con destinatario rifiutato", directInvite({ recipient_user_id: bob.id }));
  await rejects("Inserimento diretto per email rifiutato", directInvite({ recipient_email: bob.email }));
  const { error: codeInviteError } = await directInvite({});
  check("Invito con codice (senza destinatario) come prima", !codeInviteError, codeInviteError?.message);

  const inviteToGroup = (who, personId, name) =>
    who.client.rpc("invite_person_to_group", { p_group_id: groupId, p_person_id: personId, p_display_name: name });
  await errorIs("Un estraneo non invita", inviteToGroup(mallory, bob.id, "Mallory"), "Solo proprietario e amministratori possono invitare");
  await errorIs("Persona non trovabile: «Nessuna persona trovata»", inviteToGroup(alice, dario.id, "Alice"), "Nessuna persona trovata");
  await errorIs("Account inesistente: stessa risposta", inviteToGroup(alice, randomUUID(), "Alice"), "Nessuna persona trovata");
  await errorIs("Persona già nel gruppo", inviteToGroup(alice, carla.id, "Alice"), "È già nel gruppo");
  const groupInvite = await inviteToGroup(alice, bob.id, "Alice");
  need("Alice invita Bob nel gruppo", !groupInvite.error && typeof groupInvite.data === "string" && groupInvite.data.startsWith("groupInvite_"),
    groupInvite.error?.message ?? JSON.stringify(groupInvite.data));
  await errorIs("Un solo invito in attesa per persona", inviteToGroup(carla, bob.id, "Carla"), "Ha già un invito");
  const { data: bobInbox } = await bob.client.from("studyos_group_invites")
    .select("id, group_name, from_display_name, recipient_user_id, recipient_email, code, status")
    .eq("recipient_user_id", bob.id).eq("status", "pending");
  check("Bob vede l'invito filtrando su recipient_user_id",
    bobInbox?.length === 1 && bobInbox[0].id === groupInvite.data && bobInbox[0].group_name === "Fisica 2"
      && bobInbox[0].from_display_name === "Alice" && bobInbox[0].recipient_email === null && bobInbox[0].code === code,
    JSON.stringify(bobInbox));
  const { data: malloryPeek } = await mallory.client.from("studyos_group_invites").select("id").eq("id", groupInvite.data);
  check("Mallory non vede l'invito di Bob", malloryPeek?.length === 0);
  const inviteTag = `group-invite:${groupInvite.data}`;
  await waitTag(inviteTag);
  check("Push «invito» solo a Bob, mai ad Alice che invita", receivers(inviteTag) === "bob", receivers(inviteTag) || "nessuna push");
  const inviteText = notification(inviteTag);
  check("Testo «invito a un gruppo»",
    inviteText?.kind === "invite" && inviteText.title === "Invito a un gruppo" && inviteText.body === "Alice ti invita nel gruppo Fisica 2"
      && inviteText.url === "?apri=notifiche", JSON.stringify(inviteText));
  await errorIs("Mallory non accetta l'invito di Bob",
    mallory.client.rpc("accept_group_invite", { p_invite_id: groupInvite.data, p_display_name: "Mallory" }), "Invito destinato a un altro account");
  await errorIs("Mallory non rifiuta l'invito di Bob",
    mallory.client.rpc("decline_group_invite", { p_invite_id: groupInvite.data }), "Invito destinato a un altro account");
  const { error: bobAcceptError } = await bob.client.rpc("accept_group_invite", { p_invite_id: groupInvite.data, p_display_name: "Bob" });
  const { data: bobMember } = await bob.client.from("studyos_group_members").select("user_id").eq("group_id", groupId).eq("user_id", bob.id);
  check("Bob accetta ed è subito nel gruppo", !bobAcceptError && bobMember?.length === 1, bobAcceptError?.message);
  const bobMemberEmail = sql(`select coalesce(email, '<null>') from public.studyos_group_members where group_id = ${lit(groupId)} and user_id = ${lit(bob.id)}`);
  check("Invito di gruppo accettato: l'email di Bob non resta nella riga del membro", bobMemberEmail === "<null>", bobMemberEmail);
  const bobJoin = `group-join:${md5(groupId)}:${bob.id}`;
  await waitTag(bobJoin);
  check("Push «nuovo membro»: proprietaria (anche autrice dell'invito) e amministratrice, una a testa, mai a Bob",
    receivers(bobJoin) === "alice,carla", receivers(bobJoin) || "nessuna push");

  // Carla (amministratrice) invita Mallory: Mallory rifiuta, Carla la invita di nuovo, Mallory accetta.
  const firstForMallory = await inviteToGroup(carla, mallory.id, "Carla");
  const { error: declineError } = await mallory.client.rpc("decline_group_invite", { p_invite_id: firstForMallory.data });
  check("Mallory rifiuta l'invito di Carla", !firstForMallory.error && !declineError, firstForMallory.error?.message ?? declineError?.message);
  const secondForMallory = await inviteToGroup(carla, mallory.id, "Carla");
  const { error: malloryAcceptError } = await mallory.client.rpc("accept_group_invite", { p_invite_id: secondForMallory.data, p_display_name: "Mallory" });
  check("Dopo un rifiuto si può invitare di nuovo, e Mallory accetta", !secondForMallory.error && !malloryAcceptError,
    secondForMallory.error?.message ?? malloryAcceptError?.message);
  const malloryJoin = `group-join:${md5(groupId)}:${mallory.id}`;
  await waitTag(malloryJoin);
  check("Push «nuovo membro»: Carla, amministratrice e autrice dell'invito, la riceve una volta sola",
    receivers(malloryJoin) === "alice,carla", receivers(malloryJoin) || "nessuna push");

  // ─── Inviti di condivisione ───────────────────────────────────────────────
  const offer = (scope, permission = "view") => ({ scope, permission, subject_ids: [], subject_names: [] });
  await errorIs("create_share_invite con email rifiutato",
    alice.client.rpc("create_share_invite", { p_owner_name: "Alice", p_offers: [offer("calendar")], p_requests: [], p_recipient_email: bob.email }),
    "Gli inviti per email non ci sono più: cerca la persona");
  const linkInvite = await alice.client.rpc("create_share_invite", { p_owner_name: "Alice", p_offers: [offer("calendar")], p_requests: [], p_recipient_email: null });
  check("Gli inviti via link restano", !linkInvite.error && /^[0-9a-f]{64}$/.test(linkInvite.data?.token ?? ""), linkInvite.error?.message);
  const inviteToShare = (who, personId, offers, name = "Alice") =>
    who.client.rpc("invite_person_to_share", { p_person_id: personId, p_owner_name: name, p_offers: offers, p_requests: [] });
  await errorIs("Invito a sé stessi rifiutato", inviteToShare(alice, alice.id, [offer("calendar")]), "Non puoi invitare te stesso");
  await errorIs("Invito a chi non è trovabile rifiutato", inviteToShare(alice, dario.id, [offer("calendar")]), "Nessuna persona trovata");
  const shareInvite = await inviteToShare(alice, bob.id, [offer("calendar"), offer("tasks")]);
  need("Alice invita Bob a vedere calendario e attività", !shareInvite.error && Object.keys(shareInvite.data ?? {}).join(",") === "id",
    shareInvite.error?.message ?? JSON.stringify(shareInvite.data));
  const repeated = await inviteToShare(alice, bob.id, [offer("calendar"), offer("tasks")]);
  check("Un secondo invito alla stessa persona aggiorna quello in attesa", repeated.data?.id === shareInvite.data.id,
    repeated.error?.message ?? JSON.stringify(repeated.data));
  const { data: bobShareInbox } = await bob.client.from("studyos_share_invites")
    .select("id, owner_name, recipient_user_id, status").eq("recipient_user_id", bob.id).eq("status", "pending");
  check("Bob vede l'invito di condivisione", bobShareInbox?.length === 1 && bobShareInbox[0].id === shareInvite.data.id, JSON.stringify(bobShareInbox));
  const shareTag = `share-invite:${shareInvite.data.id}`;
  await waitTag(shareTag);
  check("Push «invito a condividere» a Bob, una sola anche con l'invito aggiornato",
    receivers(shareTag) === "bob" && withTag(shareTag).length === 1, `${receivers(shareTag)} in ${withTag(shareTag).length} richieste`);
  check("Testo «invito a condividere» con le sezioni",
    notification(shareTag)?.body === "Alice vuole condividere con te: Calendario, Attività" && notification(shareTag)?.url === "?apri=notifiche",
    JSON.stringify(notification(shareTag)));
  await errorIs("Mallory non accetta un invito per Bob",
    mallory.client.rpc("accept_share_invite", { p_invite_id: shareInvite.data.id, p_token: null, p_display_name: "Mallory", p_reciprocal: [] }),
    "Invito destinato a un altro account");
  const bobShareAccept = await bob.client.rpc("accept_share_invite", { p_invite_id: shareInvite.data.id, p_token: null, p_display_name: "Bob", p_reciprocal: [] });
  check("Bob accetta senza token", !bobShareAccept.error && bobShareAccept.data?.granted === 2, bobShareAccept.error?.message);
  const bobShareEmails = sql(`select coalesce(grantee_email, '<null>') from public.studyos_shares where owner_id = ${lit(alice.id)} and grantee_user_id = ${lit(bob.id)}`);
  check("Invito di condivisione accettato: l'email di Bob non resta nelle righe della condivisione",
    bobShareEmails.length > 0 && bobShareEmails.split("\n").every((value) => value === "<null>"), bobShareEmails);
  const acceptedTag = `share-accepted:${shareInvite.data.id}`;
  await waitTag(acceptedTag);
  check("Push «invito accettato» ad Alice, mai a Bob", receivers(acceptedTag) === "alice", receivers(acceptedTag) || "nessuna push");
  check("Testo «invito accettato»",
    notification(acceptedTag)?.body === "Bob ha accettato il tuo invito" && notification(acceptedTag)?.url === "?apri=condivisione",
    JSON.stringify(notification(acceptedTag)));

  const { data: bobShares } = await alice.client.from("studyos_shares").select("id, scope, permission").eq("owner_id", alice.id).eq("grantee_user_id", bob.id);
  const calendarShare = bobShares?.find((item) => item.scope === "calendar");
  const tasksShare = bobShares?.find((item) => item.scope === "tasks");
  need("Bob riceve calendario e attività", Boolean(calendarShare && tasksShare), JSON.stringify(bobShares));
  // Nuovo invito con «Può modificare» sulle attività: accettandolo Bob cambia il proprio permesso, ma è
  // lui che agisce e non riceve nulla.
  const upgrade = await inviteToShare(alice, bob.id, [offer("tasks", "edit")]);
  const { error: upgradeError } = await bob.client.rpc("accept_share_invite", { p_invite_id: upgrade.data?.id, p_token: null, p_display_name: "Bob", p_reciprocal: [] });
  check("Bob accetta «Può modificare» sulle attività", !upgrade.error && !upgradeError, upgrade.error?.message ?? upgradeError?.message);
  await waitTag(`share-accepted:${upgrade.data?.id}`);
  const { error: permissionError } = await alice.client.from("studyos_shares").update({ permission: "edit" }).eq("id", calendarShare.id);
  check("Alice passa il calendario a «Può modificare»", !permissionError, permissionError?.message);
  const calendarTag = `share-permission:${calendarShare.id}`;
  await waitTag(calendarTag);
  check("Push «permessi cambiati» a Bob", receivers(calendarTag) === "bob", receivers(calendarTag) || "nessuna push");
  check("Testo «permessi cambiati»", notification(calendarTag)?.title === "Permessi cambiati"
    && notification(calendarTag)?.body === "Alice ora ti permette di modificare: Calendario", JSON.stringify(notification(calendarTag)));
  const { error: leaveError } = await bob.client.from("studyos_shares").delete().eq("id", tasksShare.id);
  check("Bob esce dalla condivisione delle attività", !leaveError, leaveError?.message);
  const { error: revokeError } = await alice.client.from("studyos_shares").delete().eq("id", calendarShare.id);
  check("Alice toglie il calendario a Bob", !revokeError, revokeError?.message);
  await waitFor(() => withTag(calendarTag).length > 1);
  const removed = withTag(calendarTag).map((push) => push.body.notification).find((item) => item.title === "Accesso tolto");
  check("Push «accesso tolto» a Bob", removed?.body === "Alice ha smesso di condividere con te: Calendario"
    && receivers(calendarTag) === "bob,bob", `${JSON.stringify(removed)} → ${receivers(calendarTag)}`);
  check("Nessuna push a chi agisce: Bob che si alza «Può modificare» o esce non riceve nulla",
    withTag(`share-permission:${tasksShare.id}`).length === 0, `${withTag(`share-permission:${tasksShare.id}`).length} richieste`);

  // Condivisione con il gruppo: un cambio di permesso arriva ai membri, mai alla proprietaria.
  const { data: groupShare, error: groupShareError } = await alice.client.from("studyos_shares")
    .insert({ owner_id: alice.id, owner_name: "Alice", scope: "goals", permission: "view", grantee_group_id: groupId, grantee_name: "Fisica 2" })
    .select("id").single();
  check("Alice condivide gli obiettivi con il gruppo", !groupShareError, groupShareError?.message);
  await alice.client.from("studyos_shares").update({ permission: "edit" }).eq("id", groupShare?.id);
  const groupTag = `share-permission:${groupShare?.id}`;
  await waitTag(groupTag);
  check("Push «permessi cambiati» ai membri del gruppo, non ad Alice", receivers(groupTag) === "bob,carla,mallory", receivers(groupTag) || "nessuna push");
  check("Testo per il gruppo", notification(groupTag)?.body === "Alice ora permette al gruppo Fisica 2 di modificare: Obiettivi",
    JSON.stringify(notification(groupTag)));

  // ─── Migrazione degli inviti per email ────────────────────────────────────
  // Inviti per email creati prima dell'aggiornamento: li scrive psql, come se fossero vecchi.
  const chemistry = `group-chem-${run}`;
  const chemistryCode = `GRP-${run.slice(-4).toUpperCase()}-CHEM`;
  await alice.client.from("studyos_groups").insert({ id: chemistry, name: "Chimica", owner_id: alice.id, owner_display_name: "Alice", invite_code: chemistryCode });
  await alice.client.from("studyos_group_members").insert({ group_id: chemistry, user_id: alice.id, email: alice.email, display_name: "Alice", role: "owner" });
  const erinEmail = `erin-${run}@studyos.test`;
  const legacyGroup = (label, email) => {
    const id = `groupInvite_legacy_${label}_${run}`;
    sql(`insert into public.studyos_group_invites (id, group_id, group_name, from_user_id, from_display_name, recipient_email, code, status)
      values (${lit(id)}, ${lit(chemistry)}, 'Chimica', ${lit(alice.id)}, 'Alice', ${lit(email)}, ${lit(chemistryCode)}, 'pending')`);
    return id;
  };
  const legacyShare = (email, token) => sql(`insert into public.studyos_share_invites (owner_id, owner_name, offers, recipient_email, token_hash)
    values (${lit(alice.id)}, 'Alice', '[{"scope":"goals","permission":"view"}]', ${lit(email)}, sha256(convert_to(${lit(token)}, 'UTF8')))
    returning id`);
  const tokenBob = randomBytes(32).toString("hex");
  const tokenErin = randomBytes(32).toString("hex");
  const groupForBob = legacyGroup("bob", bob.email.toUpperCase());
  const groupForErin = legacyGroup("erin", erinEmail);
  const shareForBob = legacyShare(bob.email, tokenBob);
  const shareForErin = legacyShare(erinEmail, tokenErin);
  sql("delete from public.studyos_migrations where name = 'people_email_invites'");
  runPeopleSql();
  const boundTo = (table, id) => sql(`select coalesce(recipient_user_id::text, '-') from public.${table} where id = ${lit(id)}`);
  check("Migrazione: l'invito di gruppo per l'email di Bob passa al suo account", boundTo("studyos_group_invites", groupForBob) === bob.id,
    boundTo("studyos_group_invites", groupForBob));
  check("Migrazione: l'invito di condivisione per l'email di Bob passa al suo account", boundTo("studyos_share_invites", shareForBob) === bob.id,
    boundTo("studyos_share_invites", shareForBob));
  check("Migrazione: senza account con quell'email l'invito resta slegato",
    boundTo("studyos_group_invites", groupForErin) === "-" && boundTo("studyos_share_invites", shareForErin) === "-");
  const { data: migratedInbox } = await bob.client.from("studyos_group_invites").select("id").eq("recipient_user_id", bob.id).eq("status", "pending");
  check("Bob vede l'invito migrato", migratedInbox?.some((item) => item.id === groupForBob), JSON.stringify(migratedInbox));
  await errorIs("Con un destinatario il token non basta",
    mallory.client.rpc("accept_share_invite", { p_invite_id: shareForBob, p_token: tokenBob, p_display_name: "Mallory", p_reciprocal: [] }),
    "Invito destinato a un altro account");
  const migratedAccept = await bob.client.rpc("accept_share_invite", { p_invite_id: shareForBob, p_token: null, p_display_name: "Bob", p_reciprocal: [] });
  check("Bob accetta l'invito migrato senza token", !migratedAccept.error, migratedAccept.error?.message);

  const erin = await account("erin", "198.51.100.6", erinEmail);
  runPeopleSql();
  check("Rieseguire people.sql non lega un account registrato dopo",
    boundTo("studyos_group_invites", groupForErin) === "-" && boundTo("studyos_share_invites", shareForErin) === "-");
  await errorIs("Vecchio invito per email: non si accetta nemmeno con il token",
    erin.client.rpc("accept_share_invite", { p_invite_id: shareForErin, p_token: tokenErin, p_display_name: "Erin", p_reciprocal: [] }),
    "Invito scaduto: chiedine uno nuovo");
  await errorIs("Vecchio invito di gruppo per email: non si accetta",
    erin.client.rpc("accept_group_invite", { p_invite_id: groupForErin, p_display_name: "Erin" }), "Invito destinato a un altro account");
  const { data: erinPreview } = await erin.client.rpc("preview_share_invite", { p_token: tokenErin });
  check("Anteprima del vecchio invito: «scaduto»", erinPreview?.[0]?.status === "expired" && erinPreview[0].for_other_account === false,
    JSON.stringify(erinPreview));
  check("La migrazione non manda notifiche", withTag(`group-invite:${groupForBob}`).length === 0 && withTag(`share-invite:${shareForBob}`).length === 0);

  // ─── Iscrizioni push ──────────────────────────────────────────────────────
  const darioEndpoints = [];
  for (let index = 0; index < 11; index += 1) {
    const { endpoint, error } = await subscribe(dario);
    if (!error) darioEndpoints.push(endpoint);
  }
  const darioRows = await ownRows(dario, "studyos_push_subscriptions", "endpoint");
  check("Al massimo 10 iscrizioni per account: la più vecchia sparisce",
    darioEndpoints.length === 11 && darioRows.rows.length === 10 && !darioRows.rows.some((item) => item.endpoint === darioEndpoints[0]),
    darioRows.error ?? `${darioEndpoints.length} salvate, ${darioRows.rows.length} rimaste`);
  const device = await subscribe(bob);
  const { error: claimError } = await carla.client.from("studyos_push_subscriptions").upsert({ endpoint: device.endpoint, ...pushKeys() }, { onConflict: "endpoint" });
  if (!claimError) owners.set(device.endpoint, "carla");
  const bobDevice = await bob.client.from("studyos_push_subscriptions").select("endpoint").eq("endpoint", device.endpoint);
  const carlaDevice = await carla.client.from("studyos_push_subscriptions").select("endpoint").eq("endpoint", device.endpoint);
  check("Stesso browser, altro account: l'iscrizione passa a Carla", !device.error && !claimError
    && bobDevice.data?.length === 0 && carlaDevice.data?.length === 1, claimError?.message ?? device.error?.message);
  const malloryRows = await ownRows(mallory, "studyos_push_subscriptions", "endpoint");
  check("Ognuno vede solo le proprie iscrizioni", malloryRows.rows.length === 1 && malloryRows.rows[0].endpoint === mallorySubscription.endpoint,
    malloryRows.error ?? `${malloryRows.rows.length} righe`);
  await rejects("Endpoint non https rifiutato", mallory.client.from("studyos_push_subscriptions").insert({ endpoint: "http://push.example.test/x", ...pushKeys() }));
  await errorIs("push_gone con un segreto sbagliato", anon.rpc("push_gone", { p_secret: "sbagliato", p_endpoints: [mallorySubscription.endpoint] }), "Non autorizzato");
  const gone = await anon.rpc("push_gone", { p_secret: secret, p_endpoints: [mallorySubscription.endpoint, "https://push.example.test/inesistente"] });
  const malloryAfter = await ownRows(mallory, "studyos_push_subscriptions", "endpoint");
  check("push_gone con il segreto giusto (chiave publishable) cancella l'iscrizione", gone.data === 1 && malloryAfter.rows.length === 0,
    gone.error?.message ?? `${gone.data} cancellate`);
  await rejects("studyos_push_notify non è chiamabile dai client", alice.client.rpc("studyos_push_notify", {
    p_user_ids: [bob.id], p_kind: "invite", p_title: "x", p_body: "x", p_url: "?apri=notifiche", p_tag: "x"
  }));
  const lookups = await alice.client.from("studyos_person_lookups").select("id");
  check("Il registro delle ricerche non è leggibile", lookups.error?.code === "42501", lookups.error ? `${lookups.error.code}: ${lookups.error.message}` : "leggibile");

  // ─── Limiti delle ricerche ────────────────────────────────────────────────
  // Per account: 30 al minuto. Mallory non ha ancora cercato nulla.
  let mallorySearches = 0;
  for (let index = 0; index < 30; index += 1) {
    const { error } = await find(mallory, `nessuno-${index}-${run}@studyos.test`);
    if (!error) mallorySearches += 1;
  }
  check("30 ricerche in un minuto passano", mallorySearches === 30, `${mallorySearches} su 30`);
  await errorIs("La 31ª ricerca dello stesso account è fermata", find(mallory, bob.email, "198.51.100.50"), "Troppe ricerche, riprova tra un minuto");
  // Per IP: 60 al minuto, anche da account diversi (Bob, Carla e Dario sono sotto il loro limite).
  const sharedIp = "198.51.100.77";
  let ipSearches = 0;
  for (const who of [bob, carla, dario]) {
    for (let index = 0; index < 20; index += 1) {
      const { error } = await find(who, `ip-${index}-${run}@studyos.test`, sharedIp);
      if (!error) ipSearches += 1;
    }
  }
  check("60 ricerche dallo stesso IP passano", ipSearches === 60, `${ipSearches} su 60`);
  await errorIs("La 61ª ricerca dallo stesso IP è fermata", find(dario, bob.email, sharedIp), "Troppe ricerche, riprova tra un minuto");
  const otherIp = await find(dario, bob.email, "198.51.100.78");
  check("Lo stesso account da un altro IP cerca ancora", !otherIp.error && otherIp.data?.[0]?.person_id === bob.id, otherIp.error?.message);
  await errorIs("Anche is_handle_available rispetta i limiti", handleFree({ ...mallory, ip: "198.51.100.51" }, `libero_${run}`),
    "Troppe ricerche, riprova tra un minuto");
  // Righe più vecchie di un'ora: cancellate alla ricerca successiva.
  sql(`insert into public.studyos_person_lookups (user_id, ip, at) values (${lit(alice.id)}, '192.0.2.1', now() - interval '2 hours')`);
  await find(alice, bob.email);
  check("Le ricerche più vecchie di un'ora si cancellano", sql("select count(*) from public.studyos_person_lookups where at < now() - interval '1 hour'") === "0");
  // L'IP letto dalle intestazioni, provato direttamente in una sessione psql.
  const forwarded = psql(["-At", "-c", `select set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', false)`, "-c", "select public.studyos_request_ip()"]).split("\n").pop();
  const cloudflare = psql(["-At", "-c", `select set_config('request.headers', '{"cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "203.0.113.9"}', false)`, "-c", "select public.studyos_request_ip()"]).split("\n").pop();
  check("IP: cf-connecting-ip, altrimenti il primo valore di x-forwarded-for", cloudflare === "198.51.100.9" && forwarded === "203.0.113.9",
    `${cloudflare} / ${forwarded}`);

  // ─── Tetto di notifiche per chi agisce ────────────────────────────────────
  // Alice ha già esaurito 30 invii nell'ultima ora: un invito a Carla (che ha un'iscrizione) va a buon fine,
  // ma non parte alcuna push. Messo per ultimo, così non tocca le notifiche attese dalle altre prove.
  sql(`insert into public.studyos_push_sends (user_id, at) select ${lit(alice.id)}, now() from generate_series(1, 30)`);
  const budgetInvite = await alice.client.rpc("invite_person_to_share", {
    p_person_id: carla.id, p_owner_name: "Alice", p_offers: [{ scope: "goals", permission: "view", subject_ids: [], subject_names: [] }], p_requests: []
  });
  const budgetTag = `share-invite:${budgetInvite.data?.id}`;
  await sleep(3000);
  check("Tetto di 30 notifiche all'ora per chi agisce: l'invito riesce ma non parte nessuna push",
    !budgetInvite.error && Boolean(budgetInvite.data?.id) && withTag(budgetTag).length === 0,
    budgetInvite.error?.message ?? `${withTag(budgetTag).length} richieste`);
  sql(`delete from public.studyos_push_sends where user_id = ${lit(alice.id)}`);
};

main()
  .catch((error) => {
    if (!(error instanceof Abort)) console.error(error);
    process.exitCode = 1;
  })
  .then(() => new Promise((resolve) => stub.close(() => resolve())))
  .then(() => {
    summary();
    if (failures.length) process.exitCode = 1;
    process.exit(process.exitCode ?? 0);
  });
