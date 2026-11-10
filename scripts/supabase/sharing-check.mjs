#!/usr/bin/env node
// Prova API della condivisione con le stesse chiamate del client e quattro account:
// Alice (proprietaria), Bob (invitato, reciproco), Carla (membro di gruppo), Mallory (estranea).
// Solo contro lo stack Supabase LOCALE della condivisione (porte 55421-55429): vedi scripts/supabase/local-stack.md.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? "";
const key = process.env.SUPABASE_KEY ?? "";
const target = (() => {
  try {
    const { hostname, port } = new URL(url);
    return { host: hostname, port: Number(port) };
  } catch {
    return null;
  }
})();
if (!url) {
  console.error("SUPABASE_URL mancante: atteso lo stack locale della condivisione, http://127.0.0.1:55421 (vedi scripts/supabase/local-stack.md).");
  process.exit(2);
}
// Solo le porte 55421-55429 dello stack `studyos-sharing`: altri stack locali (5432x e simili) non si toccano.
if (!target || !["127.0.0.1", "localhost", "[::1]"].includes(target.host) || !(target.port >= 55421 && target.port <= 55429)) {
  const found = target ? `${target.host}:${target.port || "porta predefinita"}` : "URL non valido";
  console.error(`Solo stack locale: SUPABASE_URL deve puntare a 127.0.0.1 o localhost sulle porte 55421-55429 (trovato: ${found}).`);
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
const summary = () => {
  console.log(`\n${passed} controlli superati, ${failures.length} falliti.`);
  if (failures.length) console.log(failures.map((item) => `- ${item}`).join("\n"));
};

const run = Date.now().toString(36);
const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
const entity = (id, extra = {}) => ({ id, createdAt: iso(), updatedAt: iso(), archived: false, tags: [], ...extra });
// Elementi completi come li scrive l'app (src/types.ts): una creazione di chi riceve deve avere i campi
// che le viste del proprietario leggono (testi, date, liste).
const fullEvent = (id, extra = {}) => entity(id, {
  title: "Evento", description: "", category: "study", color: "#7CF7C8", priority: "medium", start: iso(), end: iso(3_600_000),
  status: "planned", checklist: [], attachmentIds: [], notes: "", links: [], ...extra
});
const fullTask = (id, extra = {}) => entity(id, {
  title: "Attività", description: "", priority: "medium", status: "todo", subtasks: [], attachmentIds: [], notes: "",
  estimatedMinutes: 45, energy: "medium", difficulty: 2, importance: 3, ...extra
});
const fullSession = (id, extra = {}) => entity(id, {
  title: "Sessione", template: "review", plannedMinutes: 60, actualMinutes: 0, start: iso(), end: iso(3_600_000), topics: [],
  perceivedDifficulty: 3, focusLevel: 3, notes: "", attachmentIds: [], status: "planned", ...extra
});
const fullTopic = (id, extra = {}) => entity(id, {
  title: "Argomento", firstStudiedAt: iso(), comprehension: 3, memorization: 3, difficulty: 3, nextReviewDate: iso(86_400_000),
  completedReviews: 0, notes: "", attachmentIds: [], questions: [], ...extra
});
const fullExam = (id, extra = {}) => entity(id, {
  date: iso(30 * 86_400_000), program: [], preparation: 0, targetGrade: 28, status: "planning", simulations: 0, frequentQuestions: [], ...extra
});
const fullAttachment = (id, extra = {}) => entity(id, { name: "File", mimeType: "application/pdf", size: 4, addedAt: iso(), description: "", ...extra });
const fullNote = (id, extra = {}) => entity(id, { title: "Nota", body: "", ...extra });
const fullGoal = (id, extra = {}) => entity(id, {
  title: "Obiettivo", description: "", category: "study", startDate: iso(), progress: 0, metric: "%", linkedTaskIds: [],
  linkedSessionIds: [], status: "active", notes: "", ...extra
});
const row = (entityType, payload, deleted = false) => ({ entity_type: entityType, entity_id: payload.id, payload, deleted });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const account = async (label) => {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = `${label}-${run}@studyos.test`;
  const { data, error } = await client.auth.signUp({ email, password: `Prova-${run}-${label}!` });
  if (error || !data.session) throw new Error(`Registrazione di ${label}: ${error?.message ?? "conferma email attiva nello stack"}`);
  return { client, email, id: data.user.id, label };
};

const pushOwn = async (who, rows) => {
  const { data, error } = await who.client.rpc("push_studyos_rows", { p_user_id: who.id, p_client_id: `check-${who.label}`, p_rows: rows });
  if (error) throw new Error(`push_studyos_rows ${who.label}: ${error.message}`);
  return data;
};
const pushShared = (who, owner, rows) =>
  who.client.rpc("push_shared_rows", { p_owner_id: owner.id, p_client_id: `check-${who.label}`, p_rows: rows });
const items = async (who, owner, type) => {
  const { data, error } = await who.client
    .from("studyos_items")
    .select("entity_type, entity_id, payload, deleted, updated_at")
    .eq("user_id", owner.id)
    .eq("entity_type", type);
  if (error) throw new Error(error.message);
  return data;
};
const liveIds = (rows) => rows.filter((item) => !item.deleted).map((item) => item.entity_id).sort().join(",");
const inviteColumns = "id, owner_id, owner_name, offers, requests, recipient_email, status, accepted_by, expires_at, created_at";
const share = async (who, filter) => {
  const { data, error } = await who.client.from("studyos_shares").select("*").match(filter);
  if (error) throw new Error(error.message);
  return data;
};
// Righe visibili in una tabella: l'errore di lettura non si scambia per "nessuna riga".
const count = async (who, table) => {
  const { data, error } = await who.client.from(table).select("id");
  return { rows: data?.length ?? 0, error: error?.message };
};

// Il canale Realtime di Bob si chiude in ogni caso (esito pulito, controllo fallito, eccezione).
let closeRealtime = async () => {};

const main = async () => {
  const alice = await account("alice");
  const bob = await account("bob");
  const carla = await account("carla");
  const mallory = await account("mallory");

  // Dati di Alice: due materie, eventi (uno BARB), un'attività, esami con e senza voto, un obiettivo.
  const S1 = `subject-s1-${run}`;
  const S2 = `subject-s2-${run}`;
  const E1 = entity(`event-e1-${run}`, { title: "Biochimica", subjectId: S1, start: iso(), end: iso(3_600_000) });
  const E2 = entity(`event-e2-${run}`, { title: "Genetica", subjectId: S2, start: iso(), end: iso(3_600_000) });
  const E3 = entity(`event-e3-${run}`, { title: "Appello", subjectId: S1, sourceUid: "barb-exam-unimi-1", allDay: true, start: iso(), end: iso(86_400_000) });
  const T1 = entity(`task-t1-${run}`, { title: "Ripassare", subjectId: S1 });
  const X1 = entity(`exam-x1-${run}`, { subjectId: S1, preparation: 40 });
  const X2 = entity(`exam-x2-${run}`, { subjectId: S2, grade: 28 });
  const G1 = entity(`goal-g1-${run}`, { title: "Media 28" });
  await pushOwn(alice, [
    row("subject", entity(S1, { name: "Biochimica", color: "#f00", icon: "Dna", teacher: "Prof. Segreto", notes: "privato" })),
    row("subject", entity(S2, { name: "Genetica", color: "#0f0", icon: "Dna" })),
    row("calendarEvent", E1), row("calendarEvent", E2), row("calendarEvent", E3),
    row("task", T1), row("exam", X1), row("exam", X2), row("goal", G1),
    row("preferences", entity("main", { displayName: "Alice" }))
  ]);
  const B1 = entity(`event-b1-${run}`, { title: "Palestra di Bob", start: iso(), end: iso(3_600_000) });
  await pushOwn(bob, [row("calendarEvent", B1)]);

  // Nessun accesso prima di una condivisione.
  check("Bob senza condivisione non vede gli eventi di Alice", liveIds(await items(bob, alice, "calendarEvent")) === "");

  // Realtime: Bob ascolta le righe di Alice (Realtime applica la RLS). Si registrano id e titolo
  // di ogni evento, così una consegna in ritardo di una modifica vecchia non vale come prova.
  const received = [];
  const channel = bob.client
    .channel(`check-${run}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "studyos_items", filter: `user_id=in.(${alice.id})` }, (payload) =>
      received.push({ id: payload.new?.entity_id ?? payload.old?.entity_id, title: payload.new?.payload?.title })
    );
  closeRealtime = async () => {
    closeRealtime = async () => {};
    await bob.client.removeChannel(channel);
  };
  // L'iscrizione non deve mai bloccare lo script: ogni esito (anche errore o timeout) chiude l'attesa.
  const subscribed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve("nessuna risposta in 10 s"), 10_000);
    channel.subscribe((status, error) => {
      if (!["SUBSCRIBED", "CHANNEL_ERROR", "TIMED_OUT", "CLOSED"].includes(status)) return;
      clearTimeout(timer);
      resolve(status === "SUBSCRIBED" ? status : `${status}${error?.message ? `: ${error.message}` : ""}`);
    });
  });
  check("Realtime: Bob si iscrive al canale", subscribed === "SUBSCRIBED", subscribed);

  // Invito via link: calendario con modifica, in cambio calendario in lettura.
  const { data: invite, error: inviteError } = await alice.client.rpc("create_share_invite", {
    p_owner_name: "Alice",
    p_offers: [{ scope: "calendar", permission: "edit", subject_ids: [], subject_names: [] }],
    p_requests: [{ scope: "calendar", permission: "view" }],
    p_recipient_email: null
  });
  need("Alice crea un invito via link", !inviteError && /^[0-9a-f]{64}$/.test(invite?.token ?? "") && Boolean(invite?.id), inviteError?.message ?? "risposta senza id o token");
  // `select *` è negato perché token_hash è nascosto per colonna: sugli inviti si elencano sempre le colonne.
  const { data: tokenRow, error: tokenRowError } = await alice.client.from("studyos_share_invites").select(inviteColumns).eq("id", invite.id).single();
  const { error: hashError } = await alice.client.from("studyos_share_invites").select("token_hash").eq("id", invite.id);
  const { error: starError } = await alice.client.from("studyos_share_invites").select("*").eq("id", invite.id);
  check("Alice legge il proprio invito (colonne elencate)", tokenRow?.id === invite.id, tokenRowError?.message);
  check("Il token non è leggibile dalla tabella", hashError?.code === "42501", hashError ? `${hashError.code}: ${hashError.message}` : "token_hash leggibile");
  check("select * sugli inviti è negato (vanno elencate le colonne)", starError?.code === "42501", starError ? `${starError.code}: ${starError.message}` : "select * riuscita");
  await rejects("barb_exams con modifica rifiutato", alice.client.rpc("create_share_invite", {
    p_owner_name: "Alice", p_offers: [{ scope: "barb_exams", permission: "edit" }], p_requests: [], p_recipient_email: null
  }));

  const { data: preview } = await bob.client.rpc("preview_share_invite", { p_token: invite.token });
  check("Bob vede l'anteprima", preview?.[0]?.owner_name === "Alice" && preview?.[0]?.status === "pending");
  const { data: wrongPreview } = await mallory.client.rpc("preview_share_invite", { p_token: "0".repeat(64) });
  check("Un token sbagliato non mostra nulla", Array.isArray(wrongPreview) && wrongPreview.length === 0);
  await rejects("Mallory non accetta senza token", mallory.client.rpc("accept_share_invite", {
    p_invite_id: invite.id, p_token: null, p_display_name: "Mallory", p_reciprocal: []
  }));
  await rejects("Bob non può restituire più di quanto chiesto", bob.client.rpc("accept_share_invite", {
    p_invite_id: invite.id, p_token: invite.token, p_display_name: "Bob", p_reciprocal: [{ scope: "calendar", permission: "edit" }]
  }));
  const { data: accepted, error: acceptError } = await bob.client.rpc("accept_share_invite", {
    p_invite_id: invite.id, p_token: invite.token, p_display_name: "Bob", p_reciprocal: [{ scope: "calendar", permission: "view", subject_ids: [] }]
  });
  check("Bob accetta e condivide in cambio", !acceptError && accepted?.granted === 1 && accepted?.shared_back === 1, acceptError?.message);
  await rejects("L'invito non si riusa", mallory.client.rpc("accept_share_invite", {
    p_invite_id: invite.id, p_token: invite.token, p_display_name: "Mallory", p_reciprocal: []
  }));

  // Lettura secondo la sezione.
  check("Bob vede tutti gli eventi di Alice", liveIds(await items(bob, alice, "calendarEvent")) === [E1.id, E2.id, E3.id].sort().join(","));
  // Controllo positivo: le righe esistono davvero (le legge Alice) prima di constatare che Bob non le vede.
  const hiddenTypes = ["task", "exam", "goal", "subject", "preferences"];
  const aliceOwn = [];
  const bobSees = [];
  for (const type of hiddenTypes) {
    aliceOwn.push((await items(alice, alice, type)).length);
    bobSees.push((await items(bob, alice, type)).length);
  }
  check("Bob non vede attività, esami, obiettivi, materie e preferenze",
    aliceOwn.every((total) => total > 0) && bobSees.every((total) => total === 0),
    `Alice ${hiddenTypes.map((type, index) => `${type}=${aliceOwn[index]}`).join(" ")}; Bob ${bobSees.join(",")}`);
  check("Alice vede l'evento di Bob (reciproco)", liveIds(await items(alice, bob, "calendarEvent")) === B1.id);
  const { data: labels } = await bob.client.rpc("shared_subject_labels");
  check("Etichette delle materie senza note né docente", labels?.length === 2 && labels.every((label) => !("teacher" in label) && !("notes" in label)));

  // Scrittura con "edit".
  const E1b = { ...E1, title: "Biochimica (spostata da Bob)", updatedAt: iso(1_000) };
  const { data: updateResult } = await pushShared(bob, alice, [row("calendarEvent", E1b)]);
  check("Bob modifica un evento di Alice", updateResult?.[0]?.accepted === true);
  const { data: staleResult } = await pushShared(bob, alice, [row("calendarEvent", { ...E1, title: "vecchia", updatedAt: iso(-60_000) })]);
  check("Una versione vecchia torna stale", staleResult?.[0]?.accepted === false && staleResult?.[0]?.reason === "stale");
  const E4 = fullEvent(`event-e4-${run}`, { title: "Aggiunto da Bob", subjectId: S1 });
  const { data: createResult } = await pushShared(bob, alice, [row("calendarEvent", E4)]);
  check("Bob aggiunge un evento nel calendario di Alice", createResult?.[0]?.accepted === true);
  const { data: deleteResult } = await pushShared(bob, alice, [row("calendarEvent", { id: E2.id, deletedAt: iso(2_000), title: "dati nascosti" }, true)]);
  check("Bob elimina un evento di Alice", deleteResult?.[0]?.accepted === true);
  const aliceEvents = await items(alice, alice, "calendarEvent");
  const tomb = aliceEvents.find((item) => item.entity_id === E2.id);
  check("Il tombstone contiene solo id e deletedAt", tomb?.deleted === true && Object.keys(tomb.payload).sort().join(",") === "deletedAt,id");
  check("Alice vede la modifica e l'aggiunta di Bob",
    aliceEvents.find((item) => item.entity_id === E1.id)?.payload.title === E1b.title && aliceEvents.some((item) => item.entity_id === E4.id));
  const { data: revisions } = await alice.client.from("studyos_item_revisions").select("*").order("id");
  check("Cronologia: creazione, modifica ed eliminazione di Bob",
    ["update", "create", "delete"].every((change) => revisions?.some((rev) => rev.change === change && rev.changed_by === bob.id)));
  check("La revisione conserva la versione precedente", revisions?.find((rev) => rev.change === "update")?.payload.title === "Biochimica");
  const bobRevisions = await count(bob, "studyos_item_revisions");
  check("Bob non legge la cronologia di Alice", !bobRevisions.error && bobRevisions.rows === 0, bobRevisions.error ?? `${bobRevisions.rows} righe`);

  // Valori sicuri: le viste di Alice mostrano le sue righe come dati propri (colori negli stili,
  // copertine, link, appelli ufficiali). Chi riceve non può piantarci valori pericolosi.
  // Eventi propri di questo blocco: alla fine Alice li elimina, i conteggi successivi non cambiano.
  const tracker = "https://tracker.example/pixel.png";
  const P1 = entity(`event-p1-${run}`, {
    title: "Lezione con copertina", subjectId: S1, start: iso(), end: iso(3_600_000), color: "#123456",
    cover: "data:image/png;base64,AAAA", sourceUid: `ics-${run}`, links: ["https://www.unimi.it/"], tags: ["lezione"]
  });
  // Valori che l'app di Alice può salvare da sé (colore di riserva, link mailto): chi modifica li rimanda uguali.
  const P2 = entity(`event-p2-${run}`, {
    title: "Ricevimento", subjectId: S1, start: iso(), end: iso(3_600_000), color: "var(--accent)", links: ["mailto:prof@unimi.it"], tags: []
  });
  await pushOwn(alice, [row("calendarEvent", P1), row("calendarEvent", P2)]);
  const stored = async (id) => (await items(alice, alice, "calendarEvent")).find((item) => item.entity_id === id)?.payload;
  const unchanged = (payload) => payload?.title === P1.title && payload?.color === P1.color && payload?.links?.[0] === P1.links[0];

  const { data: colourDenied } = await pushShared(bob, alice, [row("calendarEvent", { ...P1, title: "Spia", color: `url(${tracker})`, updatedAt: iso(1_000) })]);
  check("Colore url() scritto da chi riceve: rifiutato, riga invariata", colourDenied?.[0]?.reason === "denied" && unchanged(await stored(P1.id)),
    JSON.stringify(colourDenied));
  const { data: linkDenied } = await pushShared(bob, alice, [row("calendarEvent", { ...P1, title: "Link", links: ["javascript:alert(1)"], updatedAt: iso(1_100) })]);
  check("Link javascript: scritto da chi riceve: rifiutato, riga invariata", linkDenied?.[0]?.reason === "denied" && unchanged(await stored(P1.id)),
    JSON.stringify(linkDenied));
  const { data: urlDenied } = await pushShared(bob, alice, [row("calendarEvent", { ...P1, externalUrl: "javascript:alert(1)", updatedAt: iso(1_200) })]);
  check("Indirizzo esterno non http(s): rifiutato, riga invariata", urlDenied?.[0]?.reason === "denied" && unchanged(await stored(P1.id)),
    JSON.stringify(urlDenied));
  const { data: markerDenied } = await pushShared(bob, alice, [row("calendarEvent", { ...P1, title: "Appello finto", tags: ["BARB", "appello-importato"], updatedAt: iso(1_300) })]);
  check("Chi riceve non trasforma un evento in appello ufficiale (tag): riga invariata",
    markerDenied?.[0]?.reason === "denied" && unchanged(await stored(P1.id)), JSON.stringify(markerDenied));

  // Una riga rifiutata non ferma il lotto; la modifica legittima rimanda colore e link di Alice uguali.
  const { data: mixed } = await pushShared(bob, alice, [
    row("calendarEvent", { ...P1, color: `#123456; background-image: url(${tracker})`, updatedAt: iso(2_000) }),
    row("calendarEvent", { ...P2, title: "Ricevimento (spostato da Bob)", start: iso(7_200_000), end: iso(10_800_000), updatedAt: iso(2_000) })
  ]);
  check("Lotto misto: la riga non sicura è rifiutata, quella legittima passa", mixed?.[0]?.reason === "denied" && mixed?.[1]?.accepted === true,
    JSON.stringify(mixed));
  const p2 = await stored(P2.id);
  check("Modifica legittima (titolo e orari) con colore e link di Alice rimandati uguali",
    p2?.title === "Ricevimento (spostato da Bob)" && p2?.color === "var(--accent)" && p2?.links?.[0] === "mailto:prof@unimi.it", JSON.stringify(p2));

  // Chiavi protette: in una modifica restano quelle salvate (anche se mancano), in una creazione spariscono.
  const { cover: _cover, sourceUid: _sourceUid, ...withoutProtected } = P1;
  const { data: omitted } = await pushShared(bob, alice, [row("calendarEvent", { ...withoutProtected, title: "Lezione (Bob)", updatedAt: iso(3_000) })]);
  const afterOmit = await stored(P1.id);
  check("Modifica senza copertina e UID: restano quelli di Alice",
    omitted?.[0]?.accepted === true && afterOmit?.title === "Lezione (Bob)" && afterOmit?.cover === P1.cover && afterOmit?.sourceUid === P1.sourceUid,
    JSON.stringify({ omitted, afterOmit }));
  const { data: replaced } = await pushShared(bob, alice, [row("calendarEvent", {
    ...P1, title: "Lezione (Bob 2)", cover: tracker, sourceUid: "barb-exam-x", dataUrl: "data:text/html,<b>x</b>", updatedAt: iso(4_000)
  })]);
  const afterReplace = await stored(P1.id);
  check("Copertina, UID e file cambiati da chi riceve: restano quelli di Alice",
    replaced?.[0]?.accepted === true && afterReplace?.title === "Lezione (Bob 2)" && afterReplace?.cover === P1.cover
      && afterReplace?.sourceUid === P1.sourceUid && !("dataUrl" in (afterReplace ?? {})),
    JSON.stringify({ replaced, afterReplace }));
  const C1 = fullEvent(`event-c1-${run}`, { title: "Finto appello", subjectId: S1, sourceUid: "barb-exam-x", cover: tracker });
  const { data: created } = await pushShared(bob, alice, [row("calendarEvent", C1)]);
  const c1 = await stored(C1.id);
  check("Creazione con UID d'appello e copertina: salvata senza", created?.[0]?.accepted === true && c1?.title === C1.title && !("sourceUid" in (c1 ?? { sourceUid: 1 })) && !("cover" in (c1 ?? { cover: 1 })),
    JSON.stringify({ created, c1 }));

  // Le scritture dirette sulla tabella (RLS) seguono la stessa regola.
  const p1Filter = (query) => query.eq("user_id", alice.id).eq("entity_type", "calendarEvent").eq("entity_id", P1.id);
  await rejects("Update diretto con colore url() rifiutato",
    p1Filter(bob.client.from("studyos_items").update({ payload: { ...afterReplace, color: `url(${tracker})`, updatedAt: iso(5_000) } })).select().single());
  const { error: directError } = await p1Filter(bob.client.from("studyos_items")
    .update({ payload: { ...afterReplace, title: "Diretto", cover: tracker, sourceUid: "barb-exam-y", updatedAt: iso(6_000) } })).select().single();
  const afterDirect = await stored(P1.id);
  check("Update diretto: copertina e UID restano quelli di Alice",
    !directError && afterDirect?.title === "Diretto" && afterDirect?.cover === P1.cover && afterDirect?.sourceUid === P1.sourceUid,
    directError?.message ?? JSON.stringify(afterDirect));

  // Cronologia leggera: le modifiche non ripetono copertine, file e UID (chi riceve non li cambia);
  // le eliminazioni li conservano, perché il ripristino deve ridare ad Alice l'elemento intero.
  const { data: p1Revisions } = await alice.client.from("studyos_item_revisions")
    .select("change, payload").eq("entity_id", P1.id).order("id");
  check("Revisioni di modifica senza copertina e UID",
    p1Revisions?.length >= 3 && p1Revisions.every((rev) => rev.change === "update" && !("cover" in rev.payload) && !("sourceUid" in rev.payload))
      && p1Revisions[0].payload.title === P1.title,
    JSON.stringify(p1Revisions?.map((rev) => [rev.change, Object.keys(rev.payload).sort().join(",")])));
  const F1 = entity(`event-f1-${run}`, {
    title: "Con file", subjectId: S1, start: iso(), end: iso(3_600_000), cover: "data:image/png;base64,BBBB", sourceUid: `ics-f-${run}`, tags: []
  });
  await pushOwn(alice, [row("calendarEvent", F1)]);
  const { data: f1Delete } = await pushShared(bob, alice, [row("calendarEvent", { id: F1.id, deletedAt: iso(1_000) }, true)]);
  const { data: f1Revisions } = await alice.client.from("studyos_item_revisions")
    .select("change, payload, changed_at").eq("entity_id", F1.id).order("id");
  check("Revisione di eliminazione con copertina e UID",
    f1Delete?.[0]?.accepted === true && f1Revisions?.length === 1 && f1Revisions[0].change === "delete"
      && f1Revisions[0].payload.cover === F1.cover && f1Revisions[0].payload.sourceUid === F1.sourceUid,
    JSON.stringify({ f1Delete, f1Revisions }));
  // Elenco della cronologia nel client: solo id e titolo dal payload, mai il file.
  const { data: light, error: lightError } = await alice.client.from("studyos_item_revisions")
    .select("id, change, title:payload->>title, name:payload->>name, payload_id:payload->>id").eq("entity_id", F1.id);
  check("Elenco leggero della cronologia (titolo e id dal payload)",
    !lightError && light?.[0]?.title === F1.title && light[0].payload_id === F1.id && light[0].name === null && !("payload" in light[0]),
    lightError?.message ?? JSON.stringify(light));
  // Annullamento delle modifiche di una persona (shareSync.ts): la riga scritta da chi riceve ha la
  // stessa ora del server della sua revisione (stessa transazione); una scrittura successiva del
  // proprietario, che non lascia revisioni, ha un'ora più recente. Stato chiesto per id, solo righe di Alice.
  const f1State = async () => (await alice.client.from("studyos_items")
    .select("entity_type, entity_id, updated_at, deleted").eq("user_id", alice.id).in("entity_id", [F1.id])).data?.[0];
  const f1DeletedAt = f1Revisions?.[0]?.changed_at;
  const f1ByBob = await f1State();
  check("Riga eliminata da chi riceve: stessa ora del server della sua revisione",
    f1ByBob?.deleted === true && typeof f1DeletedAt === "string" && f1ByBob.updated_at === f1DeletedAt,
    JSON.stringify({ f1ByBob, f1DeletedAt }));
  await pushOwn(alice, [row("calendarEvent", { id: F1.id, deletedAt: iso(2_000) }, true)]);
  const f1ByAlice = await f1State();
  const { data: f1After } = await alice.client.from("studyos_item_revisions").select("id").eq("entity_id", F1.id);
  check("Scrittura successiva del proprietario: nessuna revisione, ora più recente",
    f1After?.length === 1 && Date.parse(f1ByAlice?.updated_at ?? "") > Date.parse(f1DeletedAt ?? ""),
    JSON.stringify({ f1ByAlice, f1After }));
  // Due creazioni nello stesso invio: stessa ora del server. Le pagine per (changed_at, id) non saltano
  // né ripetono righe anche se il confine cade tra le due.
  const K1 = fullEvent(`event-k1-${run}`, { title: "Pagina 1", subjectId: S1 });
  const K2 = fullEvent(`event-k2-${run}`, { title: "Pagina 2", subjectId: S1 });
  const { data: pair } = await pushShared(bob, alice, [row("calendarEvent", K1), row("calendarEvent", K2)]);
  const { data: allRevisions } = await alice.client.from("studyos_item_revisions").select("id, entity_id, changed_at")
    .order("changed_at", { ascending: true }).order("id", { ascending: true });
  const boundary = allRevisions?.findIndex((revision) => revision.entity_id === K1.id) ?? -1;
  const firstPage = allRevisions?.slice(0, boundary + 1) ?? [];
  const last = firstPage.at(-1);
  const { data: nextPage, error: pageError } = await alice.client.from("studyos_item_revisions").select("id, entity_id, changed_at")
    .or(`changed_at.gt."${last?.changed_at}",and(changed_at.eq."${last?.changed_at}",id.gt.${last?.id})`)
    .order("changed_at", { ascending: true }).order("id", { ascending: true });
  const sameInstant = allRevisions?.find((revision) => revision.entity_id === K2.id)?.changed_at === last?.changed_at;
  check("Cronologia a pagine per (changed_at, id): nessuna riga saltata né ripetuta",
    pair?.every((result) => result.accepted) && boundary >= 0 && sameInstant && !pageError
      && JSON.stringify([...firstPage, ...(nextPage ?? [])].map((revision) => revision.id)) === JSON.stringify(allRevisions.map((revision) => revision.id)),
    pageError?.message ?? JSON.stringify({ boundary, sameInstant, next: nextPage?.length, all: allRevisions?.length }));
  await pushOwn(alice, [row("calendarEvent", { id: K1.id, deletedAt: iso(3_000) }, true), row("calendarEvent", { id: K2.id, deletedAt: iso(3_000) }, true)]);
  // Persone che hanno cambiato qualcosa: una lettura per persona, escludendo quelle già trovate.
  const actors = [];
  for (let round = 0; round < 10; round += 1) {
    const query = alice.client.from("studyos_item_revisions").select("changed_by").not("changed_by", "is", null);
    const { data: next, error: actorError } = await (actors.length ? query.not("changed_by", "in", `(${actors.join(",")})`) : query)
      .order("changed_at", { ascending: false }).limit(1);
    if (actorError) {
      actors.push(`errore: ${actorError.message}`);
      break;
    }
    if (!next?.length) break;
    actors.push(next[0].changed_by);
  }
  const { data: everyActor } = await alice.client.from("studyos_item_revisions").select("changed_by");
  const distinctActors = [...new Set((everyActor ?? []).map((revision) => revision.changed_by).filter(Boolean))].sort();
  check("Persone della cronologia, una per lettura", actors.includes(bob.id) && JSON.stringify([...actors].sort()) === JSON.stringify(distinctActors),
    JSON.stringify({ actors, distinctActors }));

  const D1 = fullEvent(`event-d1-${run}`, { title: "Inserito diretto", subjectId: S1, sourceUid: "barb-exam-z", cover: tracker });
  const { error: insertError } = await bob.client.from("studyos_items")
    .insert({ user_id: alice.id, entity_type: "calendarEvent", entity_id: D1.id, payload: D1, deleted: false, encrypted: false }).select().single();
  const d1 = await stored(D1.id);
  check("Insert diretto con UID d'appello e copertina: salvato senza",
    !insertError && d1?.title === D1.title && !("sourceUid" in (d1 ?? { sourceUid: 1 })) && !("cover" in (d1 ?? { cover: 1 })),
    insertError?.message ?? JSON.stringify(d1));

  // Link di un appello ufficiale (la pagina UniMi): li scrive solo Alice. Chi riceve non li sostituisce
  // né ne aggiunge, e un evento che crea nasce senza link.
  const OFFICIAL = entity(`event-official-${run}`, {
    title: "Appello di Biochimica", subjectId: S1, allDay: true, start: iso(), end: iso(86_400_000), color: "#123456",
    links: ["https://www.unimi.it/it/appello-14b"], tags: ["BARB", "appello-importato"]
  });
  await pushOwn(alice, [row("calendarEvent", OFFICIAL)]);
  const officialLinks = (payload) => JSON.stringify(payload?.links) === JSON.stringify(OFFICIAL.links);
  const { data: linkSwap } = await pushShared(bob, alice, [row("calendarEvent", {
    ...OFFICIAL, title: "Appello (Bob)", links: ["https://phish.example/login"], updatedAt: iso(1_000)
  })]);
  const afterSwap = await stored(OFFICIAL.id);
  check("Link dell'appello ufficiale sostituito da chi riceve: restano quelli di Alice",
    linkSwap?.[0]?.accepted === true && afterSwap?.title === "Appello (Bob)" && officialLinks(afterSwap), JSON.stringify({ linkSwap, afterSwap }));
  const { data: linkAdd } = await pushShared(bob, alice, [row("calendarEvent", {
    ...afterSwap, title: "Appello (Bob 2)", links: [...OFFICIAL.links, "https://phish.example/"], updatedAt: iso(2_000)
  })]);
  const afterAdd = await stored(OFFICIAL.id);
  check("Link aggiunto all'appello ufficiale da chi riceve: restano quelli di Alice",
    linkAdd?.[0]?.accepted === true && afterAdd?.title === "Appello (Bob 2)" && officialLinks(afterAdd), JSON.stringify({ linkAdd, afterAdd }));
  const L1 = fullEvent(`event-l1-${run}`, { title: "Con link", subjectId: S1, links: ["https://phish.example/"] });
  const { data: linkCreate } = await pushShared(bob, alice, [row("calendarEvent", L1)]);
  check("Evento nuovo di chi riceve con un link: rifiutato", linkCreate?.[0]?.reason === "denied" && !(await stored(L1.id)), JSON.stringify(linkCreate));
  const { links: _links, ...L2 } = { ...L1, id: `event-l2-${run}`, title: "Senza link" };
  const { data: noLinks } = await pushShared(bob, alice, [row("calendarEvent", L2)]);
  const l2 = await stored(L2.id);
  check("Evento nuovo di chi riceve senza link: salvato con una lista vuota",
    noLinks?.[0]?.accepted === true && Array.isArray(l2?.links) && l2.links.length === 0, JSON.stringify({ noLinks, l2 }));

  // Stamp nel futuro: il server lo riporta ad adesso, così le modifiche successive di Alice valgono ancora.
  const FAR = "9999-12-31T23:59:59.999Z";
  const notFuture = (stamp) => typeof stamp === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(stamp) && Date.parse(stamp) <= Date.now() + 60_000;
  const storedRow = async (id) => (await items(alice, alice, "calendarEvent")).find((item) => item.entity_id === id);
  const { data: farUpdate } = await pushShared(bob, alice, [row("calendarEvent", { ...(await stored(P2.id)), title: "Ricevimento (futuro)", updatedAt: FAR })]);
  const afterFar = await stored(P2.id);
  check("Modifica con stamp nel futuro: salvata con lo stamp di adesso",
    farUpdate?.[0]?.accepted === true && afterFar?.title === "Ricevimento (futuro)" && notFuture(afterFar?.updatedAt), JSON.stringify({ farUpdate, stamp: afterFar?.updatedAt }));
  const [aliceNext] = await pushOwn(alice, [row("calendarEvent", { ...afterFar, title: "Ricevimento (Alice dopo)", updatedAt: iso(1_000) })]);
  check("Dopo uno stamp nel futuro la modifica di Alice vale", aliceNext?.accepted === true && (await stored(P2.id))?.title === "Ricevimento (Alice dopo)",
    JSON.stringify(aliceNext));
  const { data: farDelete } = await pushShared(bob, alice, [row("calendarEvent", { id: L2.id, deletedAt: FAR }, true)]);
  const farTomb = await storedRow(L2.id);
  check("Tombstone con stamp nel futuro: salvato con lo stamp di adesso",
    farDelete?.[0]?.accepted === true && farTomb?.deleted === true && Object.keys(farTomb.payload).sort().join(",") === "deletedAt,id" && notFuture(farTomb.payload.deletedAt),
    JSON.stringify({ farDelete, farTomb }));
  const [aliceRestore] = await pushOwn(alice, [row("calendarEvent", { ...l2, title: "Ripristinato da Alice", updatedAt: iso(1_000) })]);
  const restored = await storedRow(L2.id);
  check("Dopo un tombstone nel futuro Alice ripristina l'evento", aliceRestore?.accepted === true && restored?.deleted === false && restored?.payload.title === "Ripristinato da Alice",
    JSON.stringify(aliceRestore));

  // Colonne della riga: con una scrittura diretta sulla tabella chi riceve non sceglie updated_at (il
  // cursore del pull di Alice), created_at, version, encrypted, id né un client_id di Alice.
  const rowColumns = "id, updated_at, created_at, version, encrypted, client_id, payload, deleted";
  const aliceRow = async (type, id) => (await alice.client.from("studyos_items").select(rowColumns)
    .eq("user_id", alice.id).eq("entity_type", type).eq("entity_id", id).maybeSingle()).data;
  const nearNow = (value) => typeof value === "string" && Math.abs(Date.parse(value) - Date.now()) < 120_000;
  const byBob = (value) => typeof value === "string" && value.startsWith(`r:${bob.id}:`);
  const R1 = fullEvent(`event-r1-${run}`, { title: "Inserito con colonne scelte", subjectId: S1 });
  const chosenId = crypto.randomUUID();
  const { error: columnsInsertError } = await bob.client.from("studyos_items").insert({
    id: chosenId, user_id: alice.id, entity_type: "calendarEvent", entity_id: R1.id, payload: R1, deleted: false,
    updated_at: "2100-01-01T00:00:00Z", created_at: "1990-01-01T00:00:00Z", version: 999, encrypted: true, client_id: "check-alice"
  });
  const r1 = await aliceRow("calendarEvent", R1.id);
  check("Insert diretto di chi riceve: updated_at, created_at, version, encrypted e id li sceglie il server",
    !columnsInsertError && nearNow(r1?.updated_at) && nearNow(r1?.created_at) && r1?.version === 1 && r1?.encrypted === false && r1?.id !== chosenId,
    columnsInsertError?.message ?? JSON.stringify(r1 && { ...r1, payload: undefined }));
  check("Insert diretto di chi riceve: client_id di chi scrive, mai quello di un dispositivo di Alice", byBob(r1?.client_id), String(r1?.client_id));
  const { error: columnsUpdateError } = await bob.client.from("studyos_items")
    .update({
      payload: { ...r1?.payload, title: "Aggiornato diretto", updatedAt: FAR }, id: crypto.randomUUID(),
      updated_at: "2100-01-01T00:00:00Z", created_at: "1990-01-01T00:00:00Z", version: 999, encrypted: true, client_id: "check-alice"
    })
    .eq("user_id", alice.id).eq("entity_type", "calendarEvent").eq("entity_id", R1.id);
  const r1u = await aliceRow("calendarEvent", R1.id);
  check("Update diretto con stamp nel futuro: salvato con lo stamp di adesso",
    !columnsUpdateError && r1u?.payload.title === "Aggiornato diretto" && notFuture(r1u?.payload.updatedAt),
    columnsUpdateError?.message ?? String(r1u?.payload.updatedAt));
  check("Update diretto: updated_at adesso, version +1, created_at, encrypted e id invariati, client_id di chi scrive",
    nearNow(r1u?.updated_at) && r1u?.version === (r1?.version ?? 0) + 1 && r1u?.created_at === r1?.created_at && r1u?.encrypted === r1?.encrypted
      && r1u?.id === r1?.id && byBob(r1u?.client_id),
    JSON.stringify(r1u && { ...r1u, payload: undefined }));
  const { error: farTombError } = await bob.client.from("studyos_items")
    .update({ deleted: true, payload: { id: R1.id, deletedAt: FAR } })
    .eq("user_id", alice.id).eq("entity_type", "calendarEvent").eq("entity_id", R1.id);
  const r1t = await aliceRow("calendarEvent", R1.id);
  check("Tombstone diretto con stamp nel futuro: salvato con lo stamp di adesso",
    !farTombError && r1t?.deleted === true && Object.keys(r1t.payload).sort().join(",") === "deletedAt,id" && notFuture(r1t.payload.deletedAt),
    farTombError?.message ?? JSON.stringify(r1t?.payload));
  const R2 = fullEvent(`event-r2-${run}`, { title: "Con il link di Alice", subjectId: S1, links: ["https://www.unimi.it/r2"] });
  await pushOwn(alice, [row("calendarEvent", R2)]);
  const { error: linksDirectError } = await bob.client.from("studyos_items")
    .update({ payload: { ...R2, title: "Link diretto", links: ["https://phish.example/"], updatedAt: iso(1_000) } })
    .eq("user_id", alice.id).eq("entity_type", "calendarEvent").eq("entity_id", R2.id);
  const r2 = await aliceRow("calendarEvent", R2.id);
  check("Update diretto dei link di un evento: restano quelli di Alice",
    !linksDirectError && r2?.payload.title === "Link diretto" && JSON.stringify(r2?.payload.links) === JSON.stringify(R2.links),
    linksDirectError?.message ?? JSON.stringify(r2?.payload.links));

  // Tipi dei campi: un valore del tipo sbagliato manderebbe in errore le viste di Alice (Home, Calendario,
  // Attività…). Rifiutato con l'RPC e con le scritture dirette; le modifiche dell'app passano per ogni tipo.
  const typeScopes = ["tasks", "study", "progress", "materials", "goals"];
  const { data: typeShares, error: typeShareError } = await alice.client.from("studyos_shares").insert(typeScopes.map((scope) => ({
    owner_id: alice.id, owner_name: "Alice", scope, permission: "edit", grantee_user_id: bob.id, grantee_name: "Bob"
  }))).select("id");
  need("Alice dà a Bob «Può modificare» su attività, studio, progressi, materiali e obiettivi",
    !typeShareError && typeShares?.length === typeScopes.length, typeShareError?.message);
  const TT = fullTask(`task-tt-${run}`, { title: "Relazione", subjectId: S1, dueDate: iso(86_400_000) });
  const SS = fullSession(`session-ss-${run}`, { title: "Ripasso", subjectId: S1 });
  const TP = fullTopic(`topic-tp-${run}`, { title: "Glicolisi", subjectId: S1 });
  const XX = fullExam(`exam-xx-${run}`, { subjectId: S1, preparation: 30 });
  const AT = fullAttachment(`attachment-at-${run}`, {
    name: "Dispensa.pdf", dataUrl: "data:application/pdf;base64,AAAA", linkedEntityType: "subject", linkedEntityId: S1
  });
  const NT = fullNote(`note-nt-${run}`, { title: "Appunti", body: "Testo", linkedEntityType: "subject", linkedEntityId: S1 });
  const GL = fullGoal(`goal-gl-${run}`, { title: "Media 29", progress: 10 });
  await pushOwn(alice, [
    row("task", TT), row("studySession", SS), row("studyTopic", TP), row("exam", XX), row("attachment", AT), row("note", NT), row("goal", GL)
  ]);
  const storedOf = async (type, id) => (await aliceRow(type, id))?.payload;
  const storedR2 = await storedOf("calendarEvent", R2.id);
  // Come le scrive l'app: l'elemento intero rimandato con i campi cambiati; il file del materiale non
  // viaggia (le chiavi protette restano quelle salvate).
  const { dataUrl: _dataUrl, ...atWithoutFile } = AT;
  const at = iso(5_000);
  const legit = [
    ["calendarEvent", { ...storedR2, title: "Lezione (Bob, tipi)", start: iso(7_200_000), end: iso(10_800_000), allDay: false, updatedAt: at }],
    ["task", { ...TT, status: "done", completedAt: iso(), actualMinutes: 30, timerAccumulatedSeconds: 1_800, updatedAt: at }],
    ["studySession", { ...SS, start: iso(3_600_000), end: iso(7_200_000), plannedMinutes: 90, status: "completed", updatedAt: at }],
    ["studyTopic", { ...TP, nextReviewDate: iso(2 * 86_400_000), notes: "Rivedere", updatedAt: at }],
    ["exam", { ...XX, date: iso(31 * 86_400_000), status: "studying", preparation: 50, updatedAt: at }],
    ["attachment", { ...atWithoutFile, name: "Dispensa (Bob).pdf", description: "Capitolo 3", updatedAt: at }],
    ["note", { ...NT, title: "Appunti (Bob)", body: "Testo nuovo", updatedAt: at }],
    ["goal", { ...GL, progress: 40, deadline: iso(60 * 86_400_000), notes: "Quasi", updatedAt: at }]
  ];
  const { data: legitResult, error: legitError } = await pushShared(bob, alice, legit.map(([type, payload]) => row(type, payload)));
  check("Modifiche legittime di ogni tipo (come le scrive l'app): accettate",
    !legitError && legitResult?.length === legit.length && legitResult.every((result) => result.accepted === true),
    legitError?.message ?? JSON.stringify(legitResult));
  const storedAttachment = await storedOf("attachment", AT.id);
  check("Materiale modificato senza il file: il file di Alice resta",
    storedAttachment?.name === "Dispensa (Bob).pdf" && storedAttachment?.dataUrl === AT.dataUrl, JSON.stringify(storedAttachment?.name));
  const BT = fullTask(`task-bt-${run}`, { title: "Aggiunta da Bob", subjectId: S1 });
  const { data: taskCreate } = await pushShared(bob, alice, [row("task", BT)]);
  check("Attività nuova di chi riceve, completa come la scrive l'app: accettata", taskCreate?.[0]?.accepted === true, JSON.stringify(taskCreate));

  const typedEvent = await storedOf("calendarEvent", R2.id);
  const typedTask = await storedOf("task", TT.id);
  const sameTyped = async () => {
    const [event, task] = [await storedOf("calendarEvent", R2.id), await storedOf("task", TT.id)];
    return event?.title === typedEvent?.title && event?.start === typedEvent?.start && Array.isArray(event?.checklist)
      && task?.title === typedTask?.title && Array.isArray(task?.subtasks);
  };
  const typeAttacks = [
    ["titolo oggetto", "calendarEvent", { ...typedEvent, title: { x: 1 } }],
    ["inizio numerico", "calendarEvent", { ...typedEvent, start: 42 }],
    ["checklist testo", "calendarEvent", { ...typedEvent, checklist: "x" }],
    ["passaggi testo", "task", { ...typedTask, subtasks: "x" }],
    ["inizio null", "calendarEvent", { ...typedEvent, start: null }],
    ["passaggi null", "task", { ...typedTask, subtasks: null }]
  ];
  for (const [label, type, payload] of typeAttacks) {
    const { data: rpcResult } = await pushShared(bob, alice, [row(type, { ...payload, updatedAt: iso(9_000) })]);
    check(`Tipo sbagliato (${label}) con l'RPC: rifiutato, riga invariata`, rpcResult?.[0]?.reason === "denied" && (await sameTyped()), JSON.stringify(rpcResult));
    const { error: directTypeError } = await bob.client.from("studyos_items")
      .update({ payload: { ...payload, updatedAt: iso(9_500) } })
      .eq("user_id", alice.id).eq("entity_type", type).eq("entity_id", payload.id);
    check(`Tipo sbagliato (${label}) con un update diretto: rifiutato, riga invariata`, Boolean(directTypeError) && (await sameTyped()),
      directTypeError ? "" : "nessun errore");
  }
  const createAttacks = [
    ["evento con titolo oggetto", "calendarEvent", fullEvent(`event-bad-title-${run}`, { subjectId: S1, title: { x: 1 } })],
    ["evento con inizio numerico", "calendarEvent", fullEvent(`event-bad-start-${run}`, { subjectId: S1, start: 42 })],
    ["evento senza inizio", "calendarEvent", (({ start: _start, ...rest }) => rest)(fullEvent(`event-no-start-${run}`, { subjectId: S1 }))],
    ["evento con checklist testo", "calendarEvent", fullEvent(`event-bad-list-${run}`, { subjectId: S1, checklist: "x" })],
    ["attività con passaggi testo", "task", fullTask(`task-bad-list-${run}`, { subjectId: S1, subtasks: "x" })]
  ];
  for (const [label, type, payload] of createAttacks) {
    const { data: rpcResult } = await pushShared(bob, alice, [row(type, payload)]);
    check(`Creazione: ${label} con l'RPC: rifiutata`, rpcResult?.[0]?.reason === "denied" && !(await aliceRow(type, payload.id)), JSON.stringify(rpcResult));
  }
  const { error: directCreateError } = await bob.client.from("studyos_items").insert({
    user_id: alice.id, entity_type: "calendarEvent", entity_id: `event-direct-bad-${run}`, deleted: false,
    payload: fullEvent(`event-direct-bad-${run}`, { subjectId: S1, start: 42 })
  });
  check("Creazione: evento con inizio numerico con un insert diretto: rifiutata",
    Boolean(directCreateError) && !(await aliceRow("calendarEvent", `event-direct-bad-${run}`)), directCreateError ? "" : "nessun errore");

  // Pulizia del blocco: i conteggi successivi (Carla, progressi, obiettivi) non cambiano.
  await pushOwn(alice, [
    ["calendarEvent", R1.id], ["calendarEvent", R2.id], ["task", TT.id], ["task", BT.id], ["studySession", SS.id], ["studyTopic", TP.id],
    ["exam", XX.id], ["attachment", AT.id], ["note", NT.id], ["goal", GL.id]
  ].map(([type, id]) => row(type, { id, deletedAt: iso(60_000) }, true)));
  const { error: typeShareCleanup } = await alice.client.from("studyos_shares").delete().in("id", typeShares.map((item) => item.id));
  need("Alice toglie le condivisioni temporanee del blocco", !typeShareCleanup, typeShareCleanup?.message);

  // La sync personale di Alice non cambia: i suoi dati restano come li scrive.
  const own = { ...P1, title: "Di Alice", color: "hsl(0 0% 50%)", cover: "data:image/png;base64,BBBB", sourceUid: `ics-own-${run}`, updatedAt: iso(30_000) };
  await pushOwn(alice, [row("calendarEvent", own)]);
  const afterOwn = await stored(P1.id);
  check("Le scritture di Alice sui propri dati restano invariate",
    afterOwn?.title === own.title && afterOwn?.color === own.color && afterOwn?.cover === own.cover && afterOwn?.sourceUid === own.sourceUid,
    JSON.stringify(afterOwn));
  await pushOwn(alice, [P1, P2, C1, D1, OFFICIAL, L2].map((event) => row("calendarEvent", { id: event.id, deletedAt: iso(60_000) }, true)));

  // Tentativi vietati.
  const { data: viewOnly } = await pushShared(alice, bob, [row("calendarEvent", { ...B1, title: "no", updatedAt: iso(5_000) })]);
  check("Alice (solo lettura) non modifica Bob", viewOnly?.[0]?.accepted === false && viewOnly?.[0]?.reason === "denied");
  const { data: prefDenied } = await pushShared(bob, alice, [row("preferences", entity("main", { displayName: "Hackerata" }))]);
  check("Bob non scrive preferenze di Alice", prefDenied?.[0]?.reason === "denied");
  await rejects("Tombstone con dati extra rifiutato (update diretto)", bob.client.from("studyos_items")
    .update({ deleted: true, payload: { id: E1.id, deletedAt: iso(9_000), extra: "x" } }).eq("user_id", alice.id).eq("entity_id", E1.id).select().single());
  await rejects("Cambio di proprietario rifiutato", bob.client.from("studyos_items")
    .update({ user_id: bob.id }).eq("user_id", alice.id).eq("entity_id", E1.id).select().single());
  const { data: removedRows, error: removeError } = await bob.client.from("studyos_items").delete().eq("user_id", alice.id).eq("entity_id", E1.id).select();
  check("Bob non cancella fisicamente righe di Alice", !removeError && removedRows?.length === 0, removeError?.message ?? `${removedRows?.length} righe cancellate`);

  // Permessi e filtri cambiati dal proprietario.
  const [calendarShare] = await share(alice, { owner_id: alice.id, grantee_user_id: bob.id, scope: "calendar" });
  need("Esiste la condivisione del calendario con Bob", Boolean(calendarShare));
  await alice.client.from("studyos_shares").update({ permission: "view" }).eq("id", calendarShare.id);
  const { data: afterView } = await pushShared(bob, alice, [row("calendarEvent", { ...E1b, title: "ancora", updatedAt: iso(10_000) })]);
  check("Con 'Può vedere' Bob non modifica più", afterView?.[0]?.reason === "denied");
  // Un evento vivo di Genetica (S2): senza di lui il filtro per materia non potrebbe mai fallire,
  // perché l'unico altro evento di S2 (E2) è già un tombstone e `liveIds` lo scarta.
  const E5 = entity(`event-e5-${run}`, { title: "Genetica (lezione)", subjectId: S2, start: iso(), end: iso(3_600_000) });
  await pushOwn(alice, [row("calendarEvent", E5)]);
  check("Senza filtro Bob vede anche l'evento vivo di Genetica", liveIds(await items(bob, alice, "calendarEvent")) === [E1.id, E3.id, E4.id, E5.id].sort().join(","));
  await alice.client.from("studyos_shares").update({ subject_ids: [S1] }).eq("id", calendarShare.id);
  check("Filtro materie: solo gli eventi di Biochimica", liveIds(await items(bob, alice, "calendarEvent")) === [E1.id, E3.id, E4.id].sort().join(","));
  const { data: filteredLabels } = await bob.client.rpc("shared_subject_labels");
  check("Filtro materie: solo l'etichetta scelta", filteredLabels?.length === 1 && filteredLabels[0].subject_id === S1);
  await rejects("Il destinatario di una condivisione non cambia", alice.client.from("studyos_shares")
    .update({ grantee_user_id: mallory.id }).eq("id", calendarShare.id).select().single());

  // Progressi: solo esami senza voto.
  const { error: knownError } = await alice.client.from("studyos_shares").insert({
    owner_id: alice.id, owner_name: "Alice", scope: "progress", permission: "view", grantee_user_id: bob.id, grantee_name: "Bob"
  });
  check("Alice condivide i progressi con una persona nota", !knownError, knownError?.message);
  check("Progressi: esame con voto escluso", liveIds(await items(bob, alice, "exam")) === X1.id);
  await rejects("Condividere con una persona sconosciuta è rifiutato", alice.client.from("studyos_shares").insert({
    owner_id: alice.id, owner_name: "Alice", scope: "tasks", permission: "view", grantee_user_id: mallory.id
  }));
  await rejects("Mallory non crea condivisioni a nome di Alice", mallory.client.from("studyos_shares").insert({
    owner_id: alice.id, owner_name: "Alice", scope: "tasks", permission: "edit", grantee_user_id: mallory.id
  }));

  // Gruppo: Carla entra e vede le attività condivise col gruppo; uscendo perde l'accesso.
  const groupId = `group-${run}`;
  const code = `GRP-${run.slice(-4).toUpperCase()}-TEST`;
  await alice.client.from("studyos_groups").insert({ id: groupId, name: "Prova", owner_id: alice.id, owner_display_name: "Alice", invite_code: code });
  await alice.client.from("studyos_group_members").insert({ group_id: groupId, user_id: alice.id, email: alice.email, display_name: "Alice", role: "owner" });
  const { error: joinError } = await carla.client.rpc("join_group_by_code", { p_code: code, p_display_name: "Carla" });
  check("Carla entra nel gruppo", !joinError, joinError?.message);
  const { error: groupShareError } = await alice.client.from("studyos_shares").insert({
    owner_id: alice.id, owner_name: "Alice", scope: "tasks", permission: "view", grantee_group_id: groupId, grantee_name: "Prova"
  });
  check("Alice condivide le attività col gruppo", !groupShareError, groupShareError?.message);
  check("Carla vede l'attività di Alice", liveIds(await items(carla, alice, "task")) === T1.id);
  check("Mallory non vede nulla di Alice", (await items(mallory, alice, "task")).length + (await items(mallory, alice, "calendarEvent")).length === 0);
  const { error: carlaShareError } = await carla.client.from("studyos_shares").insert({
    owner_id: carla.id, owner_name: "Carla", scope: "goals", permission: "view", grantee_group_id: groupId, grantee_name: "Prova"
  });
  check("Carla condivide i suoi obiettivi col gruppo", !carlaShareError, carlaShareError?.message);
  // Carla legge la propria condivisione verso il gruppo: prima di uscire c'è, dopo non c'è più.
  const carlaSharesBefore = await share(carla, { grantee_group_id: groupId, owner_id: carla.id });
  await carla.client.from("studyos_group_members").delete().eq("group_id", groupId).eq("user_id", carla.id);
  check("Uscita dal gruppo: Carla non vede più le attività", (await items(carla, alice, "task")).length === 0);
  const carlaSharesAfter = await share(carla, { grantee_group_id: groupId, owner_id: carla.id });
  check("Uscita dal gruppo: la condivisione di Carla verso il gruppo è sparita", carlaSharesBefore.length === 1 && carlaSharesAfter.length === 0,
    `prima ${carlaSharesBefore.length}, dopo ${carlaSharesAfter.length}`);

  // Invito per email: vale solo per l'account indicato, anche senza token.
  const { data: emailInvite, error: emailInviteError } = await alice.client.rpc("create_share_invite", {
    p_owner_name: "Alice", p_offers: [{ scope: "goals", permission: "view" }], p_requests: [], p_recipient_email: carla.email.toUpperCase()
  });
  need("Alice crea un invito per email", !emailInviteError && Boolean(emailInvite?.id), emailInviteError?.message ?? "risposta senza id");
  const { data: carlaInbox } = await carla.client.from("studyos_share_invites").select("id, owner_name, offers").eq("status", "pending");
  check("Carla vede l'invito per email", carlaInbox?.some((item) => item.id === emailInvite.id));
  await rejects("Bob non accetta un invito per Carla", bob.client.rpc("accept_share_invite", {
    p_invite_id: emailInvite.id, p_token: emailInvite.token, p_display_name: "Bob", p_reciprocal: []
  }));
  const { error: carlaAcceptError } = await carla.client.rpc("accept_share_invite", {
    p_invite_id: emailInvite.id, p_token: null, p_display_name: "Carla", p_reciprocal: []
  });
  check("Carla accetta senza token", !carlaAcceptError, carlaAcceptError?.message);
  check("Carla vede l'obiettivo di Alice", liveIds(await items(carla, alice, "goal")) === G1.id);
  const { error: barbError } = await alice.client.from("studyos_shares").insert({
    owner_id: alice.id, owner_name: "Alice", scope: "barb_exams", permission: "view", grantee_user_id: carla.id, grantee_name: "Carla"
  });
  check("Alice condivide gli appelli BARB con Carla", !barbError, barbError?.message);
  check("Appelli BARB: Carla vede solo l'appello", liveIds(await items(carla, alice, "calendarEvent")) === E3.id);
  const { data: barbWrite } = await pushShared(carla, alice, [row("calendarEvent", { ...E3, title: "no", updatedAt: iso(30_000) })]);
  check("Appelli BARB: Carla non modifica", barbWrite?.[0]?.reason === "denied");

  // Realtime: arrivano le modifiche condivise, non quelle private.
  // Su un tenant Realtime appena avviato i primi eventi possono perdersi: si riprova qualche volta
  // con versioni sempre più recenti (altrimenti il server le scarterebbe come vecchie).
  // Vale solo un evento di E1 con il titolo scritto da Alice in questo passo: le modifiche di Bob
  // a E1 fatte prima producono eventi dello stesso id, che su un tenant lento possono arrivare tardi.
  received.length = 0;
  const gotShared = () => received.some((event) => event.id === E1.id && event.title === "Realtime");
  for (let attempt = 0; subscribed === "SUBSCRIBED" && attempt < 4 && !gotShared(); attempt += 1) {
    const updatedAt = iso(20_000 + attempt * 1_000);
    await pushOwn(alice, [row("calendarEvent", { ...E1b, title: "Realtime", updatedAt }), row("task", { ...T1, title: "privata", updatedAt })]);
    await sleep(3_000);
  }
  const leaked = received.filter((event) => event.id === T1.id);
  check("Realtime: Bob riceve l'evento condiviso", gotShared(),
    subscribed === "SUBSCRIBED" ? `eventi ricevuti: ${received.map((event) => `${event.id}=${event.title}`).join(", ") || "nessuno"}` : "canale non attivo");
  // Senza l'evento condiviso la prova sarebbe vuota (nessun evento = nessuna fuga): serve entrambi.
  check("Realtime: Bob non riceve l'attività non condivisa", gotShared() && leaked.length === 0,
    leaked.length ? `ricevuti ${leaked.length} eventi su ${T1.id}: ${leaked.map((event) => event.title).join(", ")}` : "");
  await closeRealtime();

  // Revoca e uscita.
  await alice.client.from("studyos_shares").delete().eq("owner_id", alice.id).eq("grantee_user_id", bob.id);
  check("Revoca: Bob non vede più nulla di Alice", (await items(bob, alice, "calendarEvent")).length + (await items(bob, alice, "exam")).length === 0);
  check("Revoca: i dati di Alice restano", liveIds(await items(alice, alice, "calendarEvent")) === [E1.id, E3.id, E4.id, E5.id].sort().join(","));
  const { error: leaveError } = await alice.client.from("studyos_shares").delete().eq("owner_id", bob.id).eq("grantee_user_id", alice.id);
  check("Alice esce dalla condivisione di Bob", !leaveError && (await items(alice, bob, "calendarEvent")).length === 0);

  // Mallory: nessuna lettura di condivisioni, inviti e cronologia altrui. Il controllo positivo
  // (Alice le legge, quindi le righe esistono) evita che "zero righe" nasconda un errore o una tabella vuota.
  const tables = ["studyos_shares", "studyos_share_invites", "studyos_item_revisions"];
  const malloryReads = [];
  const aliceReads = [];
  for (const table of tables) {
    malloryReads.push(await count(mallory, table));
    aliceReads.push(await count(alice, table));
  }
  check("Mallory non vede condivisioni, inviti e cronologia di altri",
    malloryReads.every((read) => !read.error && read.rows === 0) && aliceReads.every((read) => !read.error && read.rows > 0),
    tables.map((table, index) => `${table}: Mallory ${malloryReads[index].error ?? malloryReads[index].rows}, Alice ${aliceReads[index].error ?? aliceReads[index].rows}`).join("; "));

  // Prestazioni: il pull del proprietario non paga le funzioni di condivisione.
  const many = Array.from({ length: 200 }, (_, index) => row("calendarEvent", entity(`event-bulk-${index}-${run}`, { title: `Bulk ${index}`, start: iso(), end: iso(1_000) })));
  const pushedMany = await pushOwn(alice, many);
  check("Alice carica 200 eventi in blocco", pushedMany?.filter((result) => result.accepted).length === 200, `${pushedMany?.filter((result) => result.accepted).length ?? 0} accettati`);
  const started = performance.now();
  const pulled = await items(alice, alice, "calendarEvent");
  const elapsed = Math.round(performance.now() - started);
  check("Pull del proprietario con 200+ righe sotto 1 s", pulled.length >= 200 && elapsed < 1_000, `${pulled.length} righe in ${elapsed} ms`);
};

main()
  .catch((error) => {
    if (!(error instanceof Abort)) console.error(error);
    process.exitCode = 1;
  })
  .then(() => closeRealtime().catch(() => {}))
  .then(() => {
    summary();
    if (failures.length) process.exitCode = 1;
    process.exit(process.exitCode ?? 0);
  });
