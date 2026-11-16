#!/usr/bin/env node
// Prove di carico di flashcard, quiz, ripasso e richieste AI (scenari A–F) contro lo stack Supabase
// LOCALE (porte 55421-55429, vedi scripts/supabase/local-stack.md). Il connettore remoto gira qui con
// lo stesso codice del Worker (createCloudRunner) e il database vero dello stack: la CPU misurata è
// quella del processo Node per chiamata (process.cpuUsage, l'attesa di rete non conta), una stima
// del Worker, non il suo cpuTime. Il numero vero si legge con `wrangler tail` dopo un deploy.
// Uso:
//   eval "$(supabase status -o env --workdir .cache/ai/supabase-sharing | grep -E '^(API_URL|PUBLISHABLE_KEY)=')"
//   SUPABASE_URL=$API_URL SUPABASE_KEY=$PUBLISHABLE_KEY PGURL=postgresql://postgres:postgres@127.0.0.1:55422/postgres \
//     node --import ./scripts/lib/register-ts.mjs scripts/supabase/learning-stress.mjs
import { createClient } from "@supabase/supabase-js";
import { execFile, execFileSync } from "node:child_process";
import { createCloudRunner } from "../../src/agent/cloudRunner.ts";
import { applyReview } from "../../src/lib/srs.ts";
import { learningStats } from "../../src/lib/learningStats.ts";

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_KEY ?? "";
const pgUrl = process.env.PGURL ?? "";
const local = (value) => {
  try {
    const { hostname, port } = new URL(value);
    return ["127.0.0.1", "localhost", "[::1]"].includes(hostname) && Number(port) >= 55421 && Number(port) <= 55429;
  } catch {
    return false;
  }
};
if (!local(url) || !key || !local(pgUrl)) {
  console.error("Solo stack locale: servono SUPABASE_URL e PGURL sulle porte 55421-55429 e SUPABASE_KEY (publishable).");
  process.exit(2);
}

const run = Date.now().toString(36);
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const text = (value) => [{ type: "text", text: value }];
const sql = (query) => execFileSync("psql", [pgUrl, "-At", "-c", query], { encoding: "utf8" }).trim();

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) passed += 1;
  else failures.push(detail ? `${name} — ${detail}` : name);
  console.log(`${condition ? "✓" : "✗"} ${name}${!condition && detail ? ` (${detail})` : ""}`);
};

// ─── Misure ─────────────────────────────────────────────────────────────────────────────
const samples = new Map();
const record = (scenario, label, cpuMs, wallMs, bytes) => {
  const keyName = `${scenario} · ${label}`;
  const list = samples.get(keyName) ?? [];
  list.push({ cpuMs, wallMs, bytes });
  samples.set(keyName, list);
};
const cpuNow = () => {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
};
/** Chiamata del connettore misurata da sola (nessun'altra attività nel processo). */
const timed = async (scenario, label, runner, grant, name, args) => {
  const cpu0 = cpuNow();
  const wall0 = performance.now();
  const result = await runner.run(grant, name, args);
  const cpuMs = cpuNow() - cpu0;
  const wallMs = performance.now() - wall0;
  record(scenario, label, cpuMs, wallMs, JSON.stringify(result).length);
  return result;
};
const pct = (list, p) => {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const report = () => {
  console.log("\nMisure (CPU del processo Node per chiamata, ms; tempo totale con rete e database, ms; risposta, kB)");
  console.log("scenario · operazione | n | CPU prima | CPU mediana | CPU p95 | CPU max | tempo mediano | risposta max");
  for (const [label, list] of samples) {
    const cpu = list.map((item) => item.cpuMs);
    const wall = list.map((item) => item.wallMs);
    const kb = Math.max(...list.map((item) => item.bytes)) / 1024;
    console.log(`${label} | ${list.length} | ${cpu[0].toFixed(1)} | ${pct(cpu, 50).toFixed(1)} | ${pct(cpu, 95).toFixed(1)} | ${Math.max(...cpu).toFixed(1)} | ${pct(wall, 50).toFixed(0)} | ${kb.toFixed(1)}`);
  }
};

// ─── Account, permessi del connettore, sync dell'app ──────────────────────────────────────
const account = async (label) => {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `stress-${label}-${run}@studyos.test`;
  const { data, error } = await client.auth.signUp({ email, password: `Prova-${run}-${label}!` });
  if (error || !data.session) throw new Error(`Registrazione di ${label}: ${error?.message ?? "conferma email attiva nello stack"}`);
  const granted = await client.rpc("studyos_create_agent_grant", { p_label: `Stress ${label}` });
  if (granted.error) throw new Error(`Permesso dell'assistente di ${label}: ${granted.error.message}`);
  return { client, email, id: data.user.id, label, grant: { secret: granted.data, timeZone: "Europe/Rome" } };
};
/** Sync dell'app: lotti da 200 righe come cloudSync. */
const pushOwn = async (who, rows) => {
  let bytes = 0;
  for (let index = 0; index < rows.length; index += 200) {
    const slice = rows.slice(index, index + 200);
    bytes += JSON.stringify(slice).length;
    const { data, error } = await who.client.rpc("push_studyos_rows", { p_user_id: who.id, p_client_id: `stress-${who.label}`, p_rows: slice });
    if (error) throw new Error(`push_studyos_rows ${who.label}: ${error.message}`);
    if (!data.every((item) => item.accepted)) throw new Error(`push_studyos_rows ${who.label}: righe rifiutate`);
  }
  return bytes;
};
/** Pull dell'app: righe di un account (proprie o condivise) a pagine da 1000. */
const pull = async (who, ownerId, types) => {
  const out = [];
  for (let from = 0; ; from += 1000) {
    let query = who.client.from("studyos_items").select("entity_type, entity_id, payload, deleted, updated_at").eq("user_id", ownerId).eq("deleted", false);
    if (types) query = query.in("entity_type", types);
    const { data, error } = await query.order("updated_at").range(from, from + 999);
    if (error) throw new Error(`pull ${who.label}: ${error.message}`);
    out.push(...data);
    if (data.length < 1000) return out;
  }
};
const row = (type, payload, deleted = false) => ({ entity_type: type, entity_id: payload.id, payload, deleted });
const LEARNING = ["studyDeck", "flashcard", "quiz", "quizQuestion"];
const PERSONAL = ["flashcardState", "studyRun"];

/** Risposte dell'app: stati di ripasso e sessioni (al massimo 400 risposte per sessione). */
const answers = (cards, count, ownerId, at = Date.now()) => {
  const results = ["correct", "correct", "wrong", "doubt", "correct", "skip"];
  const states = [];
  const runs = [];
  let events = [];
  const flush = () => {
    if (!events.length) return;
    const id = `run-${run}-${runs.length}-${Math.random().toString(36).slice(2, 8)}`;
    runs.push({
      id, createdAt: events[0].at, updatedAt: events.at(-1).at, archived: false, tags: [], kind: "flashcards", mode: "review", title: "Ripasso",
      deckIds: [...new Set(cards.map((card) => card.deckId))].slice(0, 50), subjectIds: [], startedAt: events[0].at, endedAt: events.at(-1).at,
      itemIds: events.map((event) => event.i), events
    });
    events = [];
  };
  for (let index = 0; index < count; index += 1) {
    const card = cards[index % cards.length];
    const result = results[index % results.length];
    const now = new Date(at - (count - index) * 60_000);
    const previous = states.find((state) => state.id === card.id);
    if (result !== "skip") {
      const next = applyReview(previous, { id: card.id, deckId: card.deckId, revision: card.revision ?? 1 }, result, now);
      const stored = ownerId ? { ...next, ownerId } : next;
      if (previous) states[states.indexOf(previous)] = stored;
      else states.push(stored);
    }
    events.push({ i: card.id, r: result, ms: 4000, at: now.toISOString(), v: card.revision ?? 1 });
    if (events.length === 400) flush();
  }
  flush();
  return { states, runs };
};

const cardInputs = (count, prefix) =>
  Array.from({ length: count }, (_, index) => ({
    externalRef: `${prefix}-${index}`,
    front: text(`Domanda ${prefix} ${index}: definisci il concetto numero ${index} con un esempio.`),
    back: [{ type: "text", text: `Risposta ${index}: il concetto si spiega così, con un passaggio e un esempio.` }, { type: "formula", latex: `x_{${index}} = \\frac{a}{b}` }],
    tags: ["stress"]
  }));

/** Crea una raccolta e `count` schede con il connettore, in lotti da 100. */
const agentCards = async (scenario, who, runner, count, prefix) => {
  const deck = await timed(scenario, "save_decks", runner, who.grant, "studyos_save_decks", { decks: [{ title: `Raccolta ${prefix}`, kind: "collection", externalRef: prefix }] });
  if (!deck.ok) throw new Error(`save_decks ${who.label}: ${deck.error}`);
  const deckId = deck.data.items[0].id;
  const inputs = cardInputs(count, prefix);
  let created = 0;
  for (let index = 0; index < inputs.length; index += 100) {
    const saved = await timed(scenario, "save_flashcards ×100", runner, who.grant, "studyos_save_flashcards", { deckId, cards: inputs.slice(index, index + 100) });
    if (!saved.ok) throw new Error(`save_flashcards ${who.label}: ${saved.error}`);
    created += saved.data.created;
    const failed = saved.data.items.find((item) => item.status === "error");
    if (failed && !created) throw new Error(`save_flashcards ${who.label}: ${failed.error}`);
  }
  return { deckId, created };
};

const main = async () => {
  // ─── Scenario C: operazioni MCP massive ───────────────────────────────────────────────
  console.log("\nScenario C — operazioni MCP massive (1000 schede in lotti da 100)");
  const ugo = await account("ugo");
  const hub = createCloudRunner({ url, key });
  const { deckId: bigDeck, created } = await agentCards("C", ugo, hub, 1000, `c-${run}`);
  check("C 1000 schede create in 10 chiamate", created === 1000, `${created}`);
  const stored = Number(sql(`select count(*) from public.studyos_items where user_id = '${ugo.id}' and entity_type = 'flashcard' and not deleted`));
  check("C nel database ci sono 1000 schede", stored === 1000, `${stored}`);
  const retry = await timed("C", "save_flashcards ×100 (stesso lotto)", hub, ugo.grant, "studyos_save_flashcards", { deckId: bigDeck, cards: cardInputs(100, `c-${run}`) });
  check("C rimandare un lotto non duplica", retry.ok && retry.data.created === 0, JSON.stringify(retry.data ?? retry).slice(0, 200));
  const page = await timed("C", "list_flashcards", hub, ugo.grant, "studyos_list_flashcards", { deckId: bigDeck, limit: 100 });
  const ids = (page.data?.items ?? []).map((item) => item.id);
  check("C lettura paginata (100 per pagina, has_more)", page.ok && ids.length === 100 && page.data.has_more === true, JSON.stringify(page).slice(0, 200));
  const detail = await timed("C", "get_flashcards ×50", hub, ugo.grant, "studyos_get_flashcards", { ids: ids.slice(0, 50) });
  check("C dettaglio di 50 schede", detail.ok && detail.data.items.length === 50);
  const edits = detail.data.items.map((card) => ({ id: card.id, expectedRevision: card.revision, back: text(`Retro aggiornato ${card.id}`) }));
  const updated = await timed("C", "save_flashcards ×50 (modifica)", hub, ugo.grant, "studyos_save_flashcards", { cards: edits });
  check("C 50 schede modificate in una chiamata", updated.ok && updated.data.updated === 50, JSON.stringify(updated.data ?? updated).slice(0, 200));
  const duplicates = await timed("C", "find_duplicate_flashcards (1000)", hub, ugo.grant, "studyos_find_duplicate_flashcards", { deckId: bigDeck });
  check("C ricerca dei doppioni su 1000 schede", duplicates.ok, JSON.stringify(duplicates).slice(0, 200));
  for (let index = 0; index < 5; index += 1) {
    // Worker appena avviato (isolato nuovo o cache persa): pull dei gruppi dello strumento.
    const cold = createCloudRunner({ url, key });
    await timed("C", "list_decks a freddo", cold, ugo.grant, "studyos_list_decks", {});
    await timed("C", "list_flashcards a freddo", createCloudRunner({ url, key }), ugo.grant, "studyos_list_flashcards", { deckId: bigDeck, limit: 50 });
    await timed("C", "overview a freddo (strumenti di sempre)", createCloudRunner({ url, key }), ugo.grant, "studyos_overview", {});
  }

  // ─── Scenario E: consultazione e ripasso ──────────────────────────────────────────────
  console.log("\nScenario E — 3000 risposte registrate dall'app, statistiche nell'app e dall'agente");
  const ugoCards = (await pull(ugo, ugo.id, ["flashcard"])).map((item) => item.payload);
  const { states, runs } = answers(ugoCards, 3000);
  const wall0 = performance.now();
  const pushedBytes = await pushOwn(ugo, [...states.map((state) => row("flashcardState", state)), ...runs.map((item) => row("studyRun", item))]);
  const pushMs = performance.now() - wall0;
  console.log(`  sync dell'app: ${states.length} stati e ${runs.length} sessioni, ${(pushedBytes / 1024).toFixed(0)} kB in ${Math.ceil((states.length + runs.length) / 200)} chiamate, ${pushMs.toFixed(0)} ms`);
  check("E stati e sessioni salvati", Number(sql(`select count(*) from public.studyos_items where user_id = '${ugo.id}' and entity_type in ('flashcardState', 'studyRun')`)) === states.length + runs.length);
  // Statistiche nell'app (stessa funzione dell'Andamento), sui dati appena letti.
  const all = await pull(ugo, ugo.id);
  const of = (type) => all.filter((item) => item.entity_type === type).map((item) => item.payload);
  for (let index = 0; index < 5; index += 1) {
    const cpu0 = cpuNow();
    const stats = learningStats({ cards: of("flashcard"), decks: of("studyDeck"), states: of("flashcardState"), runs: of("studyRun"), quizzes: [], questions: [], now: new Date() });
    record("E", "learningStats nell'app (1000 schede, 3000 risposte)", cpuNow() - cpu0, 0, JSON.stringify(stats).length);
  }
  // Come in un account vero, le righe hanno timbri diversi (ogni riga 20 s prima della successiva):
  // altrimenti ogni chiamata a caldo rilegge la finestra di 60 s del cursore, cioè tutto. Solo lo
  // stack locale e solo l'account di prova (session_replication_role salta il trigger del timbro).
  sql(`set session_replication_role = replica; update public.studyos_items i set updated_at = now() - interval '2 minutes' - (r.n * interval '20 seconds')
    from (select id, row_number() over (order by id) as n from public.studyos_items where user_id = '${ugo.id}') r where i.id = r.id`);
  const fresh = createCloudRunner({ url, key });
  const agentStats = await timed("E", "learning_stats a freddo", fresh, ugo.grant, "studyos_learning_stats", { include: ["daily", "decks", "hardest", "forecast", "quiz"] });
  check("E l'agente legge le statistiche", agentStats.ok && agentStats.data.cards?.total === 1000, JSON.stringify(agentStats).slice(0, 300));
  for (let index = 0; index < 3; index += 1) await fresh.run(ugo.grant, "studyos_learning_stats", {}); // riscaldamento del JIT
  for (let index = 0; index < 20; index += 1) await timed("E", "learning_stats a caldo", fresh, ugo.grant, "studyos_learning_stats", { include: ["daily", "decks", "hardest", "forecast", "quiz"] });
  for (let index = 0; index < 20; index += 1) await timed("E", "list_flashcards a caldo", fresh, ugo.grant, "studyos_list_flashcards", { deckId: bigDeck, limit: 30 });
  for (let index = 0; index < 20; index += 1) await timed("E", "overview a caldo", fresh, ugo.grant, "studyos_overview", {});
  for (let index = 0; index < 10; index += 1) await timed("E", "learning_stats a freddo", createCloudRunner({ url, key }), ugo.grant, "studyos_learning_stats", {});

  // ─── Scenario F: richieste AI ────────────────────────────────────────────────────────
  console.log("\nScenario F — 20 «Spiegami meglio» e 2 analisi: elenco, presa, chiusura");
  const requests = Array.from({ length: 22 }, (_, index) => ({
    id: `req-${run}-${index}`, createdAt: iso(), updatedAt: iso(), archived: false, tags: [],
    kind: index < 20 ? "explain_card" : "analysis", ...(index < 20 ? { targetId: ugoCards[index].id } : { scope: { subjectIds: [], deckIds: [bigDeck], days: 30 } }),
    style: "simple", prompt: index < 20 ? "Non capisco il passaggio" : "Dove sbaglio?", status: "pending", expiresAt: iso(14 * 86_400_000), attempts: 0
  }));
  await pushOwn(ugo, requests.map((item) => row("aiRequest", item)));
  const agentF = createCloudRunner({ url, key });
  const open = await timed("F", "list_ai_requests", agentF, ugo.grant, "studyos_list_ai_requests", { limit: 20 });
  check("F l'agente vede le richieste aperte", open.ok && open.data.items.length === 20 && open.data.has_more === true, JSON.stringify(open).slice(0, 200));
  let finished = 0;
  for (const request of requests) {
    const taken = await timed("F", "take_ai_request", agentF, ugo.grant, "studyos_take_ai_request", { id: request.id, author: { name: "Stress" } });
    if (!taken.ok) continue;
    const args = request.kind === "analysis"
      ? { id: request.id, claimToken: taken.data.claimToken, outcome: "completed", analysis: { title: "Analisi", summary: "Riepilogo", sections: [{ kind: "tips", title: "Consiglio", body: "Ripassa ogni giorno." }] } }
      : { id: request.id, claimToken: taken.data.claimToken, outcome: "completed", blocks: text("Spiegazione semplice.") };
    const done = await timed("F", "finish_ai_request", agentF, ugo.grant, "studyos_finish_ai_request", args);
    if (done.ok) finished += 1;
  }
  check("F 22 richieste prese e chiuse", finished === 22, `${finished}`);
  const completed = sql(`select count(*) from public.studyos_items where user_id = '${ugo.id}' and entity_type = 'aiRequest' and payload->>'status' = 'completed'`);
  check("F nel database sono completate", Number(completed) === 22, completed);
  // Isolamento: un'altra persona (col suo assistente) non vede, non prende e non chiude le richieste
  // di Ugo, e un id di account nei parametri non sposta le scritture nell'account di un altro.
  const zoe = await account("zoe");
  const zoeRunner = createCloudRunner({ url, key });
  const zoeOpen = await zoeRunner.run(zoe.grant, "studyos_list_ai_requests", { status: "all" });
  check("F Zoe non vede le richieste di Ugo", zoeOpen.ok && zoeOpen.data.items.length === 0, JSON.stringify(zoeOpen).slice(0, 200));
  const pendingUgo = { ...requests[0], id: `req-${run}-iso`, status: "pending" };
  await pushOwn(ugo, [row("aiRequest", pendingUgo)]);
  const zoeTake = await zoeRunner.run(zoe.grant, "studyos_take_ai_request", { id: pendingUgo.id });
  check("F Zoe non prende una richiesta di Ugo", !zoeTake.ok, JSON.stringify(zoeTake).slice(0, 200));
  const zoeFinish = await zoeRunner.run(zoe.grant, "studyos_finish_ai_request", { id: requests[1].id, claimToken: "0".repeat(32), outcome: "completed", blocks: text("Falsa") });
  check("F Zoe non chiude una richiesta di Ugo", !zoeFinish.ok, JSON.stringify(zoeFinish).slice(0, 200));
  const ugoTake = await agentF.run(ugo.grant, "studyos_take_ai_request", { id: pendingUgo.id });
  const wrongToken = await agentF.run(ugo.grant, "studyos_finish_ai_request", { id: pendingUgo.id, claimToken: "f".repeat(32), outcome: "completed", blocks: text("x") });
  check("F senza il token della presa la richiesta non si chiude", ugoTake.ok && !wrongToken.ok, JSON.stringify(wrongToken).slice(0, 200));
  const otherAgent = await createCloudRunner({ url, key }).run(ugo.grant, "studyos_take_ai_request", { id: pendingUgo.id });
  check("F un secondo assistente non prende una richiesta già presa", !otherAgent.ok || otherAgent.data?.status === "conflict", JSON.stringify(otherAgent).slice(0, 200));
  const ugoCardsBefore = sql(`select count(*) from public.studyos_items where user_id = '${ugo.id}' and entity_type in ('flashcard', 'studyDeck')`);
  const spoof = await zoeRunner.run(zoe.grant, "studyos_save_decks", { decks: [{ title: "Intrusa" }], ownerId: ugo.id, userId: ugo.id, account: ugo.email });
  const spoofLanded = sql(`select count(*) from public.studyos_items where user_id = '${ugo.id}' and entity_type in ('flashcard', 'studyDeck')`);
  check("F un id di account nei parametri non scrive nell'account di Ugo", spoofLanded === ugoCardsBefore, `${spoof.ok ? "accettata nel proprio account" : spoof.code} · Ugo ${ugoCardsBefore}→${spoofLanded}`);
  console.log(`  parametri ownerId/userId/account estranei: ${spoof.ok ? "ignorati, raccolta creata nell'account di Zoe" : `rifiutati (${spoof.code})`}`);
  const explained = sql(`select count(*) from public.studyos_items where user_id = '${ugo.id}' and entity_type = 'flashcard' and jsonb_typeof(payload->'explanation') = 'array'`);
  console.log(`  schede con spiegazione pubblicata dall'agente: ${explained} (la spiegazione resta sulla richiesta finché la persona non la pubblica)`);

  // ─── Scenario D: due agenti sulla stessa raccolta ─────────────────────────────────────
  // Due processi separati (due hub, come due Durable Object): nello stesso processo le chiamate del
  // connettore sono in fila (exclusive in cloudRunner.ts) e la corsa non si vedrebbe.
  console.log("\nScenario D — due agenti (due permessi, due processi) sulla stessa raccolta, nello stesso istante");
  const second = await ugo.client.rpc("studyos_create_agent_grant", { p_label: "Secondo assistente" });
  const target = ids.slice(0, 75);
  const startAt = Date.now() + 4000;
  const agent = (secret, cardIds, back) =>
    new Promise((resolve, reject) => {
      execFile(process.execPath, ["--import", "./scripts/lib/register-ts.mjs", "scripts/supabase/learning-stress-agent.mjs"], {
        env: { ...process.env, STRESS_AGENT: JSON.stringify({ url, key, secret, ids: cardIds, back, startAt, deckId: bigDeck, ref: `d-${run}` }) }
      }, (error, stdout) => (error ? reject(new Error(`agente ${back}: ${error.message} ${stdout}`)) : resolve(JSON.parse(stdout.trim().split("\n").at(-1)))));
    });
  const [resultA, resultB] = await Promise.all([agent(ugo.grant.secret, target.slice(0, 50), "Versione A"), agent(second.data, target.slice(25, 75), "Versione B")]);
  const backs = new Map(sql(`select entity_id || '=' || (payload #>> '{back,0,text}') from public.studyos_items where user_id = '${ugo.id}' and entity_type = 'flashcard' and entity_id in (${target.map((id) => `'${id}'`).join(",")})`).split("\n").map((line) => line.split("=")));
  const onlyA = target.slice(0, 25).every((id) => backs.get(id) === "Versione A");
  const onlyB = target.slice(50, 75).every((id) => backs.get(id) === "Versione B");
  const overlap = target.slice(25, 50).map((id) => backs.get(id));
  const statusOf = (result, id) => result.edit.find((item) => item.id === id)?.status;
  const reportedA = target.slice(25, 50).filter((id) => statusOf(resultA, id) === "updated").length;
  const reportedB = target.slice(25, 50).filter((id) => statusOf(resultB, id) === "updated").length;
  const conflicts = [...resultA.edit, ...resultB.edit].filter((item) => item.status === "conflict").length;
  check("D le schede toccate da un solo agente hanno la sua versione", onlyA && onlyB, JSON.stringify({ a: resultA.edit.slice(0, 2), b: resultB.edit.slice(-2) }));
  const sameRef = Number(sql(`select count(*) from public.studyos_items where user_id = '${ugo.id}' and entity_type = 'flashcard' and not deleted and payload->>'externalRef' = 'd-${run}'`));
  const totalCards = Number(sql(`select count(*) from public.studyos_items where user_id = '${ugo.id}' and entity_type = 'flashcard' and not deleted`));
  check("D nessuna scheda persa", totalCards === 1000 + sameRef, `${totalCards}`);
  const lost = target.slice(25, 50).filter((id) => {
    const winner = backs.get(id);
    return (statusOf(resultA, id) === "updated" && winner !== "Versione A") || (statusOf(resultB, id) === "updated" && winner !== "Versione B");
  }).length;
  console.log(`  25 schede toccate da entrambi: ${overlap.filter((value) => value === "Versione A").length} con A, ${overlap.filter((value) => value === "Versione B").length} con B; «updated» A ${reportedA}, B ${reportedB}; «conflict» ${conflicts}`);
  console.log(`  modifiche dette «updated» ma sovrascritte dall'altro agente: ${lost}`);
  for (const [name, result] of [["A", resultA], ["B", resultB]]) if (result.editError) console.log(`  risposta all'agente ${name}: ${result.editError}`);
  check("D nessuna modifica detta salvata e poi persa", lost === 0, `${lost}`);
  console.log(`  stessa externalRef creata nello stesso istante da due agenti: ${sameRef} schede (A ${resultA.create}, B ${resultB.create})`);

  // ─── Scenario A: tre utenti insieme ──────────────────────────────────────────────────
  console.log("\nScenario A — 3 utenti insieme: schede, quiz, ripasso, statistiche");
  const trio = await Promise.all(["anna", "bruno", "ciro"].map((label) => account(label)));
  const wallA = performance.now();
  const perUser = await Promise.all(trio.map(async (who) => {
    const runner = createCloudRunner({ url, key });
    const { deckId } = await agentCards("A", who, runner, 200, `a-${who.label}-${run}`);
    const quiz = await runner.run(who.grant, "studyos_save_quiz", {
      quiz: { title: `Quiz ${who.label}`, deckId },
      questions: Array.from({ length: 20 }, (_, index) => ({
        kind: "single", prompt: text(`Domanda ${index}`), options: [{ text: "Giusta", correct: true }, { text: "Sbagliata", correct: false }, { text: "Altra", correct: false }]
      }))
    });
    const cards = (await pull(who, who.id, ["flashcard"])).map((item) => item.payload);
    const { states: own, runs: ownRuns } = answers(cards, 600);
    await pushOwn(who, [...own.map((state) => row("flashcardState", state)), ...ownRuns.map((item) => row("studyRun", item))]);
    const stats = await runner.run(who.grant, "studyos_learning_stats", {});
    return { who, quiz: quiz.ok, cards: cards.length, total: stats.data?.cards?.total, answered: stats.data?.answers };
  }));
  console.log(`  3 utenti in parallelo: ${(performance.now() - wallA).toFixed(0)} ms in tutto`);
  check("A ognuno ha le sue 200 schede, il suo quiz e le sue statistiche", perUser.every((item) => item.quiz && item.cards === 200 && item.total === 200), JSON.stringify(perUser.map((item) => [item.who.label, item.cards, item.total])));
  const crossA = await trio[0].client.from("studyos_items").select("entity_id").eq("user_id", trio[1].id);
  check("A nessuno legge i dati degli altri", !crossA.error && crossA.data.length === 0, crossA.error?.message ?? `${crossA.data.length} righe`);

  // ─── Scenario B: sei utenti con raccolte condivise ──────────────────────────────────
  console.log("\nScenario B — 6 utenti: una raccolta condivisa (Può modificare), progressi personali");
  const owner = await account("olga");
  const members = await Promise.all(["pia", "rita", "sara", "tea", "vera"].map((label) => account(label)));
  const groupId = `group-stress-${run}`;
  const code = `STR-${run.slice(-4).toUpperCase()}-TEST`;
  await owner.client.from("studyos_groups").insert({ id: groupId, name: "Stress", owner_id: owner.id, owner_display_name: "Olga", invite_code: code });
  await owner.client.from("studyos_group_members").insert({ group_id: groupId, user_id: owner.id, email: owner.email, display_name: "Olga", role: "owner" });
  for (const member of members) {
    const { error } = await member.client.rpc("join_group_by_code", { p_code: code, p_display_name: member.label });
    if (error) throw new Error(`join ${member.label}: ${error.message}`);
  }
  const ownerRunner = createCloudRunner({ url, key });
  const { deckId: sharedDeck } = await agentCards("B", owner, ownerRunner, 300, `b-${run}`);
  const ownerCards = (await pull(owner, owner.id, ["flashcard"])).map((item) => item.payload);
  const ownerAnswers = answers(ownerCards, 200);
  await pushOwn(owner, ownerAnswers.states.map((state) => row("flashcardState", state)));
  const { error: shareError } = await owner.client.from("studyos_shares").insert({
    owner_id: owner.id, owner_name: "Olga", scope: "flashcards", permission: "edit", grantee_group_id: groupId, grantee_name: "Stress"
  });
  check("B Olga condivide Flashcard e quiz con il gruppo", !shareError, shareError?.message);
  const wallB = performance.now();
  const seen = await Promise.all(members.map(async (member, index) => {
    const t0 = performance.now();
    const shared = await pull(member, owner.id, LEARNING);
    const pullMs = performance.now() - t0;
    const cards = shared.filter((item) => item.entity_type === "flashcard").map((item) => item.payload);
    const mine = answers(cards, 120 + index * 40, owner.id);
    await pushOwn(member, [...mine.states.map((state) => row("flashcardState", state)), ...mine.runs.map((item) => row("studyRun", item))]);
    let edited = null;
    if (index === 0) {
      const card = cards[0];
      const { data } = await member.client.rpc("push_shared_rows", {
        p_owner_id: owner.id, p_client_id: `stress-${member.label}`,
        p_rows: [row("flashcard", { ...card, back: text("Corretto da Pia"), revision: (card.revision ?? 1) + 1, updatedAt: iso(1000) })]
      });
      edited = { id: card.id, accepted: data?.[0]?.accepted };
    }
    return { member, cards: cards.length, states: mine.states.length, pullMs, bytes: JSON.stringify(shared).length, edited };
  }));
  // Olga, nello stesso momento, modifica un'altra scheda con il suo agente.
  const ownerEdit = await ownerRunner.run(owner.grant, "studyos_save_flashcards", { cards: [{ id: ownerCards[1].id, back: text("Corretto da Olga") }] });
  console.log(`  5 persone in parallelo: ${(performance.now() - wallB).toFixed(0)} ms; pull della raccolta condivisa ${seen.map((item) => item.pullMs.toFixed(0)).join("/")} ms, ${(seen[0].bytes / 1024).toFixed(0)} kB ciascuno`);
  check("B ognuno legge le 300 schede di Olga", seen.every((item) => item.cards === 300), seen.map((item) => item.cards).join(","));
  check("B la modifica di Pia è nella scheda di Olga", seen[0].edited?.accepted === true && sql(`select payload #>> '{back,0,text}' from public.studyos_items where user_id = '${owner.id}' and entity_id = '${seen[0].edited.id}' and entity_type = 'flashcard'`) === "Corretto da Pia");
  check("B la modifica di Olga intanto è salvata", ownerEdit.ok && ownerEdit.data.updated === 1);
  for (const item of seen) {
    const ownStates = Number(sql(`select count(*) from public.studyos_items where user_id = '${item.member.id}' and entity_type = 'flashcardState'`));
    check(`B progressi di ${item.member.label}: solo suoi (${item.states} stati)`, ownStates === item.states, `${ownStates}`);
  }
  const leak = await members[1].client.from("studyos_items").select("entity_id").in("user_id", [members[0].id, owner.id]).in("entity_type", PERSONAL);
  check("B nessuno vede gli stati di ripasso degli altri (né di Olga)", !leak.error && leak.data.length === 0, leak.error?.message ?? `${leak.data.length} righe`);
  const olgaStats = await createCloudRunner({ url, key }).run(owner.grant, "studyos_learning_stats", {});
  check("B le statistiche di Olga contano solo le sue risposte", olgaStats.ok && olgaStats.data.cards?.total === 300, JSON.stringify(olgaStats.data?.answers ?? olgaStats).slice(0, 200));
  const revisions = Number(sql(`select count(*) from public.studyos_item_revisions where owner_id = '${owner.id}' and changed_by = '${members[0].id}'`));
  check("B la cronologia di Olga registra la modifica di Pia", revisions >= 1, `${revisions}`);

  // ─── Spazio nel database (piano Free: 500 MB) ──────────────────────────────────────
  console.log("\nSpazio occupato (byte medi del payload per tipo, misurati nel database dello stack)");
  console.log(sql(`select entity_type || ': ' || count(*) || ' righe, ' || round(avg(pg_column_size(payload))) || ' B medi' from public.studyos_items
    where user_id in (${[ugo, ...trio, owner, ...members].map((who) => `'${who.id}'`).join(",")}) group by entity_type order by entity_type`));
  console.log(`studyos_items in tutto (tabella e indici): ${sql("select pg_size_pretty(pg_total_relation_size('public.studyos_items'))")}`);

  report();
};

try {
  await main();
} catch (error) {
  failures.push(error instanceof Error ? error.message : String(error));
  console.log(`✗ interrotto: ${error instanceof Error ? error.stack : error}`);
}
console.log(`\n${passed} controlli superati, ${failures.length} falliti.`);
process.exit(failures.length ? 1 : 0);
