import test from "node:test";
import assert from "node:assert/strict";
import { CLOUD_CLIENT_ID, CLOUD_TEXT, createCloudRunner, perItemConflicts, plannedRows } from "../src/agent/cloudRunner.ts";
import { CLOUD_UNAVAILABLE } from "../src/agent/catalog.ts";
import { COLLECTIONS } from "../src/lib/collections.ts";

// Supabase finto con le due funzioni di supabase/agent.sql: segreto → account, LWW sul timbro,
// file incorporati tolti nel pull e rimessi nel push, updated_at del server sempre crescente.
const FILE_KEYS = ["dataUrl", "cover", "avatarDataUrl", "storedFile"];
const INVALID = "Collegamento dell'assistente non valido o revocato.";

const stampOf = (payload, deleted, updatedAt) => {
  const own = deleted ? payload?.deletedAt ?? payload?.updatedAt : payload?.updatedAt;
  const time = Date.parse(own ?? "");
  return Number.isFinite(time) ? time : Date.parse(updatedAt);
};

const fakeCloud = () => {
  const secrets = new Map();
  const rows = [];
  const calls = [];
  let clock = Date.parse("2026-11-11T10:00:00Z");
  let seq = 0;
  let refuseNext = 0;
  let legacy = false;
  const tick = () => new Date((clock += 1000)).toISOString();
  const find = (user, type, id) => rows.find((row) => row.user === user && row.entity_type === type && row.entity_id === id);
  const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetch = async (url, init) => {
    const fn = String(url).split("/rest/v1/rpc/")[1];
    const body = JSON.parse(init.body);
    calls.push({ fn, body, apikey: init.headers.apikey });
    const user = secrets.get(body.p_secret);
    if (!user) return reply(403, { code: "28000", message: INVALID });
    if (fn === "studyos_agent_pull") {
      // agent.sql di prima della 1.10.0: la funzione a 5 argomenti non esiste.
      if (legacy && "p_types" in body) return reply(404, { code: "PGRST202", message: "Could not find the function public.studyos_agent_pull(p_limit, p_offset, p_secret, p_since, p_types)" });
      const list = rows
        .filter((row) => row.user === user && (!body.p_since || row.updated_at >= body.p_since) && (!body.p_types || body.p_types.includes(row.entity_type)))
        .sort((a, b) => (a.updated_at === b.updated_at ? a.seq - b.seq : a.updated_at < b.updated_at ? -1 : 1))
        .slice(body.p_offset, body.p_offset + body.p_limit)
        .map((row) => {
          const payload = { ...row.payload };
          for (const key of FILE_KEYS) delete payload[key];
          return { entity_type: row.entity_type, entity_id: row.entity_id, payload, deleted: row.deleted, updated_at: row.updated_at };
        });
      return reply(200, list);
    }
    if (fn === "studyos_agent_push") {
      const results = body.p_rows.map((item) => {
        const current = find(user, item.entity_type, item.entity_id);
        let payload = item.payload;
        if (!item.deleted && current) {
          for (const key of FILE_KEYS) if (!(key in payload) && key in current.payload) payload = { ...payload, [key]: current.payload[key] };
        }
        const now = tick();
        const accepted = refuseNext > 0
          ? (refuseNext -= 1, false)
          : !current || stampOf(payload, item.deleted, now) > stampOf(current.payload, current.deleted, current.updated_at);
        if (accepted) {
          if (current) Object.assign(current, { payload, deleted: item.deleted, updated_at: now, client_id: body.p_client_id });
          else rows.push({ user, entity_type: item.entity_type, entity_id: item.entity_id, payload, deleted: item.deleted, updated_at: now, client_id: body.p_client_id, seq: ++seq });
        }
        return { entity_type: item.entity_type, entity_id: item.entity_id, accepted };
      });
      return reply(200, results);
    }
    return reply(404, { message: "funzione sconosciuta" });
  };

  return {
    fetch,
    rows,
    calls,
    secrets,
    refuse: (count = 1) => {
      refuseNext = count;
    },
    setLegacy: (value) => {
      legacy = value;
    },
    advance: (ms) => {
      clock += ms;
    },
    seed: (user, type, payload, deleted = false) => {
      rows.push({ user, entity_type: type, entity_id: payload.id, payload, deleted, updated_at: tick(), client_id: "browser", seq: ++seq });
    },
    row: (user, type, id) => find(user, type, id)
  };
};

const A = "a".repeat(64);
const B = "b".repeat(64);
const rome = (secret) => ({ secret, timeZone: "Europe/Rome" });
const stamp = (iso) => ({ createdAt: iso, updatedAt: iso });

const setup = () => {
  const cloud = fakeCloud();
  cloud.secrets.set(A, "alice");
  cloud.secrets.set(B, "bob");
  const runner = createCloudRunner({ url: "http://cloud.test/", key: "sb_publishable_prova", fetch: cloud.fetch });
  return { cloud, runner };
};

test("connettore remoto: crea un'attività nel cloud e la rilegge dalla cache", async () => {
  const { cloud, runner } = setup();
  cloud.seed("alice", "subject", { id: "sub_1", name: "Analisi", color: "#123456", ...stamp("2026-11-01T08:00:00.000Z") });

  const created = await runner.run(rome(A), "studyos_create_task", { title: "Ripasso limiti", subjectId: "sub_1" });
  assert.equal(created.ok, true, JSON.stringify(created));
  const row = cloud.row("alice", "task", created.data.id);
  assert.equal(row.payload.title, "Ripasso limiti");
  assert.equal(row.payload.subjectId, "sub_1");
  assert.equal(row.client_id, CLOUD_CLIENT_ID);
  assert.deepEqual(cloud.calls.map((call) => call.fn), ["studyos_agent_pull", "studyos_agent_push"]);
  assert.equal(cloud.calls[0].body.p_since, null);
  assert.equal(cloud.calls[0].apikey, "sb_publishable_prova");

  const listed = await runner.run(rome(A), "studyos_list_tasks", {});
  assert.equal(listed.ok, true);
  assert.match(JSON.stringify(listed.data), /Ripasso limiti/);
  assert.match(JSON.stringify(listed.data), /Analisi/);
  // Lettura: solo un pull incrementale, nessuna scrittura.
  assert.deepEqual(cloud.calls.slice(2).map((call) => call.fn), ["studyos_agent_pull"]);
  assert.ok(cloud.calls[2].body.p_since, "il secondo pull parte dal cursore");
});

test("connettore remoto: date e ora nel fuso della persona, Date sempre ripristinato", async () => {
  const { runner } = setup();
  const original = globalThis.Date;
  const tokyo = { secret: A, timeZone: "Asia/Tokyo" };
  const event = await runner.run(tokyo, "studyos_create_event", { title: "Lezione", start: "2026-11-12T09:00" });
  assert.equal(event.ok, true, JSON.stringify(event));
  assert.equal(event.data.start, "2026-11-12T00:00:00.000Z");
  const status = await runner.run(tokyo, "studyos_status", {});
  assert.equal(status.data.timeZone, "Asia/Tokyo");
  assert.equal(status.data.utcOffset, "+09:00");
  assert.equal(status.data.remote, true);
  assert.equal(status.data.policy, undefined);
  assert.equal(globalThis.Date, original);
});

test("connettore remoto: modifica con timbro più recente ed eliminazione con tombstone", async () => {
  const { cloud, runner } = setup();
  // Timbro nel futuro (orologio di un altro dispositivo avanti): la modifica deve comunque passare.
  cloud.seed("alice", "task", { id: "task_1", title: "Vecchio", status: "todo", tags: [], subtasks: [], attachmentIds: [], ...stamp("2030-01-01T00:00:00.000Z") });
  cloud.seed("alice", "task", { id: "task_2", title: "Da togliere", status: "todo", tags: [], subtasks: [], attachmentIds: [], ...stamp("2026-11-01T00:00:00.000Z") });

  const updated = await runner.run(rome(A), "studyos_update_task", { id: "task_1", title: "Nuovo" });
  assert.equal(updated.ok, true, JSON.stringify(updated));
  const row = cloud.row("alice", "task", "task_1");
  assert.equal(row.payload.title, "Nuovo");
  assert.ok(Date.parse(row.payload.updatedAt) > Date.parse("2030-01-01T00:00:00.000Z"));

  const removed = await runner.run(rome(A), "studyos_delete_task", { id: "task_2", confirm: true });
  assert.equal(removed.ok, true, JSON.stringify(removed));
  const tombstone = cloud.row("alice", "task", "task_2");
  assert.equal(tombstone.deleted, true);
  assert.deepEqual(Object.keys(tombstone.payload).sort(), ["deletedAt", "id"]);

  const listed = await runner.run(rome(A), "studyos_list_tasks", {});
  assert.doesNotMatch(JSON.stringify(listed.data), /Da togliere/);
});

test("connettore remoto: una riga rifiutata dice che la modifica non è salvata e rilegge il cloud", async () => {
  const { cloud, runner } = setup();
  cloud.seed("alice", "task", { id: "task_1", title: "Prima", status: "todo", tags: [], subtasks: [], attachmentIds: [], ...stamp("2026-11-01T00:00:00.000Z") });
  cloud.refuse(1);
  const result = await runner.run(rome(A), "studyos_update_task", { id: "task_1", title: "Dopo" });
  assert.equal(result.ok, false);
  assert.equal(result.error, CLOUD_TEXT.conflict(1, false));
  assert.deepEqual(cloud.calls.map((call) => call.fn), ["studyos_agent_pull", "studyos_agent_push", "studyos_agent_pull"]);
  assert.equal(cloud.row("alice", "task", "task_1").payload.title, "Prima");
});

test("connettore remoto: permesso revocato, strumenti esclusi, file incorporati intatti", async () => {
  const { cloud, runner } = setup();
  cloud.seed("alice", "attachment", { id: "att_1", name: "Dispense", type: "pdf", dataUrl: "data:application/pdf;base64,AAAA", tags: [], ...stamp("2026-11-01T00:00:00.000Z") });
  const renamed = await runner.run(rome(A), "studyos_update_material", { id: "att_1", name: "Dispense cap. 2" });
  assert.equal(renamed.ok, true, JSON.stringify(renamed));
  const file = cloud.row("alice", "attachment", "att_1");
  assert.equal(file.payload.name, "Dispense cap. 2");
  assert.equal(file.payload.dataUrl, "data:application/pdf;base64,AAAA");

  const before = cloud.calls.length;
  for (const name of CLOUD_UNAVAILABLE) {
    const result = await runner.run(rome(A), name, {});
    assert.equal(result.code, "invalid", name);
  }
  assert.equal(cloud.calls.length, before, "gli strumenti esclusi non toccano il cloud");

  cloud.secrets.delete(A);
  const revoked = await runner.run(rome(A), "studyos_list_tasks", {});
  assert.equal(revoked.code, "denied");
  assert.equal(revoked.error, CLOUD_TEXT.revoked);
  cloud.secrets.set(A, "alice");
  await runner.run(rome(A), "studyos_list_tasks", {});
  assert.equal(cloud.calls.at(-1).body.p_since, null, "dopo la revoca la cache riparte da zero");
});

test("connettore remoto: account separati anche con chiamate in parallelo", async () => {
  const { cloud, runner } = setup();
  cloud.seed("alice", "task", { id: "task_a", title: "Di Alice", status: "todo", tags: [], subtasks: [], attachmentIds: [], ...stamp("2026-11-01T00:00:00.000Z") });
  cloud.seed("bob", "task", { id: "task_b", title: "Di Bob", status: "todo", tags: [], subtasks: [], attachmentIds: [], ...stamp("2026-11-01T00:00:00.000Z") });
  const [created, bobList, aliceList] = await Promise.all([
    runner.run(rome(A), "studyos_create_task", { title: "Nuova di Alice" }),
    runner.run(rome(B), "studyos_list_tasks", {}),
    runner.run(rome(A), "studyos_list_tasks", {})
  ]);
  assert.equal(created.ok, true);
  assert.match(JSON.stringify(bobList.data), /Di Bob/);
  assert.doesNotMatch(JSON.stringify(bobList.data), /Alice/);
  assert.match(JSON.stringify(aliceList.data), /Nuova di Alice/);
  assert.doesNotMatch(JSON.stringify(aliceList.data), /Di Bob/);
  assert.equal(cloud.rows.filter((row) => row.user === "bob").length, 1);
});

test("plannedRows: solo le entità cambiate, timbro sempre più recente del cloud", () => {
  const empty = Object.fromEntries(COLLECTIONS.map((key) => [key, []]));
  const same = { id: "task_same", updatedAt: "2026-11-01T00:00:00.000Z" };
  const old = { id: "task_old", updatedAt: "2026-11-01T00:00:00.000Z" };
  const gone = { id: "goal_gone", updatedAt: "2026-11-01T00:00:00.000Z" };
  const before = { ...empty, tasks: [same, old], goals: [gone] };
  const changed = { ...old, title: "cambiata" };
  const after = { ...empty, tasks: [same, changed], goals: [] };
  const cached = (type, id) => (id === "task_old"
    ? { entity_type: type, entity_id: id, payload: { id, updatedAt: "2026-12-01T00:00:00.000Z" }, deleted: false, updated_at: "2026-11-01T00:00:00Z" }
    : undefined);
  const rows = plannedRows(before, after, cached);
  assert.equal(rows.length, 2);
  const task = rows.find((row) => row.entity_type === "task");
  assert.equal(task.entity_id, "task_old");
  assert.ok(Date.parse(task.payload.updatedAt) > Date.parse("2026-12-01T00:00:00.000Z"));
  const goal = rows.find((row) => row.entity_type === "goal");
  assert.equal(goal.deleted, true);
  assert.equal(goal.payload.id, "goal_gone");
});

// Il Worker gira in UTC: ogni calcolo che dipende dal fuso (fuso fissato sulle serie, giorno di un
// tutto il giorno, divisioni) deve usare quello del permesso, anche dopo un cambio d'ora.
// Con TZ=UTC (npm test nella matrice dei fusi) è esattamente la situazione del Worker.
test("connettore remoto: serie create e cambiate nel fuso del permesso, anche dopo il cambio d'ora", async () => {
  const { cloud, runner } = setup();
  const payload = (id) => cloud.row("alice", "calendarEvent", id)?.payload;
  const startsOf = (result) => result.data.items.map((item) => item.start);

  // Roma: lunedì 9:00 d'inverno (CET), la serie resta alle 9:00 anche d'estate (CEST).
  const made = await runner.run(rome(A), "studyos_create_event", {
    title: "Lezione", start: "2026-11-16T09:00", end: "2026-11-16T10:00", repeat: { freq: "weekly", byWeekday: ["MO"] }
  });
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(made.data.start, "2026-11-16T08:00:00.000Z");
  assert.equal(payload(made.data.id).timeZone, "Europe/Rome");
  const june = await runner.run(rome(A), "studyos_list_events", { from: "2027-06-07T00:00", to: "2027-06-15T00:00" });
  assert.deepEqual(startsOf(june), ["2027-06-07T07:00:00.000Z", "2027-06-14T07:00:00.000Z"]);

  // «Questo e i successivi» d'estate: la parte nuova è alle 11:00 di Roma e porta lo stesso fuso.
  const split = await runner.run(rome(A), "studyos_update_event", {
    id: made.data.id, occurrenceDate: "2027-06-07", scope: "following", start: "2027-06-07T11:00", end: "2027-06-07T12:00"
  });
  assert.equal(split.ok, true, JSON.stringify(split));
  assert.equal(payload(`${made.data.id}~2027-06-07`).timeZone, "Europe/Rome");
  const after = await runner.run(rome(A), "studyos_list_events", { from: "2027-06-07T00:00", to: "2027-06-15T00:00" });
  assert.deepEqual(startsOf(after), ["2027-06-07T09:00:00.000Z", "2027-06-14T09:00:00.000Z"]);
  const winter = await runner.run(rome(A), "studyos_list_events", { from: "2026-11-23T00:00", to: "2026-11-24T00:00" });
  assert.deepEqual(startsOf(winter), ["2026-11-23T08:00:00.000Z"]);

  // Tutto il giorno: il compleanno resta il 3 dicembre nel fuso della persona.
  const birthday = await runner.run(rome(A), "studyos_create_event", { title: "Compleanno", start: "2026-12-03", allDay: true, occasion: { kind: "birthday", person: "Ada" } });
  assert.equal(birthday.ok, true, JSON.stringify(birthday));
  assert.equal(payload(birthday.data.id).timeZone, "Europe/Rome");
  const nextYear = await runner.run(rome(A), "studyos_list_events", { from: "2027-12-01T00:00", to: "2027-12-06T00:00" });
  assert.deepEqual(nextYear.data.items.map((item) => item.occurrenceDate), ["2027-12-03"]);
});

test("connettore remoto: New York, la serie segue la fine dell'ora legale e il giorno cambiato da solo", async () => {
  const { cloud, runner } = setup();
  const york = { secret: A, timeZone: "America/New_York" };
  const payload = (id) => cloud.row("alice", "calendarEvent", id)?.payload;
  // Lunedì 26 ottobre 2026 alle 9:00 EDT (-4); l'ora legale finisce domenica 1 novembre.
  const made = await runner.run(york, "studyos_create_event", {
    title: "Seminar", start: "2026-10-26T09:00", end: "2026-10-26T10:00", repeat: { freq: "weekly" }
  });
  assert.equal(made.ok, true, JSON.stringify(made));
  assert.equal(made.data.start, "2026-10-26T13:00:00.000Z");
  assert.equal(payload(made.data.id).timeZone, "America/New_York");
  const listed = await runner.run(york, "studyos_list_events", { from: "2026-10-26T00:00", to: "2026-11-03T00:00" });
  assert.deepEqual(listed.data.items.map((item) => [item.occurrenceDate, item.start]), [
    ["2026-10-26", "2026-10-26T13:00:00.000Z"],
    ["2026-11-02", "2026-11-02T14:00:00.000Z"]
  ]);

  // Solo il 9 novembre alle 10:00 (EST): riga del giorno, la serie resta alle 9:00.
  const moved = await runner.run(york, "studyos_update_event", {
    id: made.data.id, occurrenceDate: "2026-11-09", scope: "this", start: "2026-11-09T10:00", end: "2026-11-09T11:00"
  });
  assert.equal(moved.ok, true, JSON.stringify(moved));
  const renamed = await runner.run(york, "studyos_update_event", { id: made.data.id, title: "Seminar B" });
  assert.equal(renamed.ok, true, JSON.stringify(renamed));
  assert.equal(payload(made.data.id).timeZone, "America/New_York");
  const november = await runner.run(york, "studyos_list_events", { from: "2026-11-09T00:00", to: "2026-11-17T00:00" });
  assert.deepEqual(november.data.items.map((item) => [item.occurrenceDate, item.start]), [
    ["2026-11-09", "2026-11-09T15:00:00.000Z"],
    ["2026-11-16", "2026-11-16T14:00:00.000Z"]
  ]);
});

// ─── Flashcard, quiz e richieste sul connettore remoto ─────────────────────────────────────

const LEARNING_TYPES = ["studyDeck", "quiz", "flashcard", "quizQuestion", "flashcardState", "studyRun", "aiAnalysis", "aiRequest"];

test("connettore remoto: flashcard nel cloud, solo i tipi che servono a ogni strumento", async () => {
  const { cloud, runner } = setup();
  const t0 = "2026-11-01T08:00:00.000Z";
  cloud.seed("alice", "subject", { id: "sub_1", name: "Chimica", color: "#123456", ...stamp(t0) });
  cloud.seed("alice", "task", { id: "task_1", title: "Esercizi", status: "todo", tags: [], subtasks: [], attachmentIds: [], ...stamp(t0) });

  const decks = await runner.run(rome(A), "studyos_save_decks", { decks: [{ title: "Stechiometria", subjectId: "sub_1", externalRef: "chim-3" }] });
  assert.equal(decks.ok, true, JSON.stringify(decks));
  const deckId = decks.data.items[0].id;
  const pull = cloud.calls[0];
  assert.equal(pull.fn, "studyos_agent_pull");
  assert.ok(pull.body.p_types.includes("studyDeck") && pull.body.p_types.includes("subject"));
  assert.equal(pull.body.p_types.includes("task"), false, "le task non servono");

  const cards = Array.from({ length: 60 }, (_, i) => ({
    externalRef: `c3-${i}`,
    front: [{ type: "text", text: `Domanda ${i}` }],
    back: [{ type: "formula", latex: `x_{${i}} = ${i}` }]
  }));
  const saved = await runner.run(rome(A), "studyos_save_flashcards", { deckId, cards });
  assert.equal(saved.ok, true, JSON.stringify(saved));
  assert.equal(saved.data.created, 60);
  const stored = cloud.rows.filter((row) => row.user === "alice" && row.entity_type === "flashcard");
  assert.equal(stored.length, 60);
  assert.equal(stored[0].payload.subjectId, "sub_1");
  assert.equal(stored[0].client_id, CLOUD_CLIENT_ID);
  // Ripetere il lotto (es. timeout dell'agente) non crea doppioni né scritture.
  const pushes = cloud.calls.filter((item) => item.fn === "studyos_agent_push").length;
  const again = await runner.run(rome(A), "studyos_save_flashcards", { deckId, cards });
  assert.equal(again.data.unchanged, 60);
  assert.equal(cloud.calls.filter((item) => item.fn === "studyos_agent_push").length, pushes);

  // Uno strumento di sempre non legge le flashcard.
  const before = cloud.calls.length;
  const tasks = await runner.run(rome(A), "studyos_list_tasks", {});
  assert.equal(tasks.ok, true);
  const taskPulls = cloud.calls.slice(before).filter((item) => item.fn === "studyos_agent_pull");
  assert.ok(taskPulls.length >= 1);
  for (const item of taskPulls) for (const type of LEARNING_TYPES.filter((type) => type !== "studyDeck")) assert.equal(item.body.p_types.includes(type), false, type);
  // Dopo una lettura per tipi diversi la cache resta coerente: la raccolta si rilegge.
  assert.equal(groupsHas(await runner.run(rome(A), "studyos_list_decks", {}), deckId), true);
});

const groupsHas = (result, id) => result.ok && result.data.items.some((item) => item.id === id);

test("connettore remoto: account isolati, nessuno legge o chiude le richieste di un altro", async () => {
  const { cloud, runner } = setup();
  const t0 = "2026-11-01T08:00:00.000Z";
  const deck = await runner.run(rome(A), "studyos_save_decks", { decks: [{ title: "Privata di Alice" }] });
  const deckId = deck.data.items[0].id;
  const card = await runner.run(rome(A), "studyos_save_flashcards", { deckId, cards: [{ front: [{ type: "text", text: "Segreto" }], back: [{ type: "text", text: "Sì" }] }] });
  const cardId = card.data.items[0].id;
  // Richiesta fatta da Alice nell'app (riga come la sincronizza il browser).
  cloud.seed("alice", "aiRequest", {
    id: "aireq_1", kind: "explain_card", targetId: cardId, style: "simple", prompt: "Non capisco", status: "pending",
    expiresAt: "2099-01-01T00:00:00.000Z", attempts: 0, archived: false, tags: [], ...stamp(t0)
  });

  // Bob non vede nulla di Alice, neanche passando gli id.
  assert.equal((await runner.run(rome(B), "studyos_list_decks", {})).data.total, 0);
  assert.equal((await runner.run(rome(B), "studyos_list_flashcards", {})).data.total, 0);
  assert.deepEqual((await runner.run(rome(B), "studyos_get_flashcards", { ids: [cardId] })).data.missing, [cardId]);
  assert.equal((await runner.run(rome(B), "studyos_list_ai_requests", {})).data.total, 0);
  assert.equal((await runner.run(rome(B), "studyos_take_ai_request", { id: "aireq_1" })).code, "not_found");
  assert.equal((await runner.run(rome(B), "studyos_delete_flashcards", { ids: [cardId], confirm: true })).code, "not_found");
  const spoof = await runner.run(rome(B), "studyos_save_flashcards", { cards: [{ id: cardId, back: [{ type: "text", text: "Cambiata" }] }] });
  assert.equal(spoof.data.items[0].status, "error");
  // ownerId di un'altra persona: sul connettore remoto non c'è nessuna condivisione da leggere.
  assert.equal((await runner.run(rome(B), "studyos_list_flashcards", { ownerId: "11111111-1111-4111-8111-111111111111" })).code, "not_found");
  assert.equal(cloud.row("alice", "flashcard", cardId).payload.back[0].text, "Sì");
  assert.equal(cloud.rows.filter((row) => row.user === "bob").length, 0, "Bob non ha scritto nulla");

  // Alice (il suo assistente) prende e chiude la richiesta: risultato nel cloud, token solo come hash.
  const taken = await runner.run(rome(A), "studyos_take_ai_request", { id: "aireq_1", author: { name: "Claude" } });
  assert.equal(taken.ok, true, JSON.stringify(taken));
  const claimed = cloud.row("alice", "aiRequest", "aireq_1").payload;
  assert.equal(claimed.status, "claimed");
  assert.notEqual(claimed.claimToken, taken.data.claimToken);
  assert.equal(taken.data.request.target.type, "flashcard");
  // Un secondo assistente (stesso account, altra cache) trova la richiesta occupata.
  const other = createCloudRunner({ url: "http://cloud.test/", key: "sb_publishable_prova", fetch: cloud.fetch });
  assert.equal((await other.run(rome(A), "studyos_take_ai_request", { id: "aireq_1" })).code, "conflict");
  const done = await runner.run(rome(A), "studyos_finish_ai_request", { id: "aireq_1", claimToken: taken.data.claimToken, outcome: "completed", blocks: [{ type: "text", text: "Spiegazione semplice." }] });
  assert.equal(done.ok, true, JSON.stringify(done));
  const finished = cloud.row("alice", "aiRequest", "aireq_1").payload;
  assert.equal(finished.status, "completed");
  assert.deepEqual(finished.result.blocks, [{ type: "text", text: "Spiegazione semplice." }]);
  // L'altro assistente con un token inventato non può riscriverla.
  assert.equal((await other.run(rome(A), "studyos_finish_ai_request", { id: "aireq_1", claimToken: "f".repeat(32), outcome: "failed" })).code, "denied");
});

test("connettore remoto: agent.sql senza p_types, si legge tutto come prima e si riprova più tardi", async () => {
  const { cloud, runner } = setup();
  cloud.setLegacy(true);
  cloud.seed("alice", "subject", { id: "sub_1", name: "Fisica", color: "#123456", ...stamp("2026-11-01T08:00:00.000Z") });
  const decks = await runner.run(rome(A), "studyos_save_decks", { decks: [{ title: "Cinematica", subjectId: "sub_1" }] });
  assert.equal(decks.ok, true, JSON.stringify(decks));
  const pulls = cloud.calls.filter((item) => item.fn === "studyos_agent_pull");
  assert.equal("p_types" in pulls[0].body, true);
  assert.equal("p_types" in pulls[1].body, false, "ripiego sul pull completo");
  assert.equal(cloud.rows.filter((row) => row.entity_type === "studyDeck").length, 1);
  // Nel periodo di ripiego le letture successive non riprovano p_types.
  const listed = await runner.run(rome(A), "studyos_list_decks", {});
  assert.equal(listed.data.total, 1);
  assert.equal(cloud.calls.filter((item) => item.fn === "studyos_agent_pull" && "p_types" in item.body).length, 1);
});

test("connettore remoto: dopo il primo pull ogni gruppo riparte dall'ultima riga letta, non dal gruppo più fermo", async () => {
  const { cloud, runner } = setup();
  const t0 = "2026-11-01T08:00:00.000Z";
  // La materia è l'ultima riga del suo gruppo da molto prima delle schede.
  cloud.seed("alice", "subject", { id: "sub_1", name: "Chimica", color: "#123456", ...stamp(t0) });
  cloud.advance(3_600_000);
  cloud.seed("alice", "studyDeck", { id: "deck_1", title: "D", description: "", kind: "topic", position: 1, subjectId: "sub_1", archived: false, tags: [], ...stamp(t0) });
  for (let i = 0; i < 5; i++) {
    cloud.seed("alice", "flashcard", { id: `card_${i}`, deckId: "deck_1", front: [{ type: "text", text: `F${i}` }], back: [{ type: "text", text: "B" }], position: i, revision: 1, archived: false, tags: [], ...stamp(t0) });
  }
  assert.equal((await runner.run(rome(A), "studyos_list_flashcards", {})).data.total, 5);
  cloud.seed("alice", "flashcard", { id: "card_9", deckId: "deck_1", front: [{ type: "text", text: "Nuova" }], back: [{ type: "text", text: "B" }], position: 9, revision: 1, archived: false, tags: [], ...stamp(t0) });
  const before = cloud.calls.length;
  assert.equal((await runner.run(rome(A), "studyos_list_flashcards", {})).data.total, 6, "la scheda nuova arriva");
  const pulls = cloud.calls.slice(before).filter((call) => call.fn === "studyos_agent_pull");
  assert.equal(pulls.length, 1, "una sola lettura incrementale");
  const subjectAt = cloud.row("alice", "subject", "sub_1").updated_at;
  assert.ok(pulls[0].body.p_since > subjectAt, `p_since ${pulls[0].body.p_since} non torna alla materia (${subjectAt})`);
});

test("righe rifiutate dal database: esito conflict sul loro elemento, gli altri restano salvati", () => {
  const result = {
    ok: true,
    data: {
      created: 1,
      updated: 1,
      unchanged: 0,
      duplicate: 0,
      conflict: 0,
      error: 0,
      items: [
        { index: 0, status: "created", id: "card_a" },
        { index: 1, status: "updated", id: "card_b" },
        { index: 2, status: "unchanged", id: "card_c" }
      ]
    }
  };
  const mapped = perItemConflicts(result, new Set(["card_b"]));
  assert.equal(mapped.ok, true);
  assert.equal(mapped.data.items[1].status, "conflict");
  assert.equal(mapped.data.items[1].error, CLOUD_TEXT.itemConflict);
  assert.equal(mapped.data.items[0].status, "created");
  assert.equal(mapped.data.updated, 0);
  assert.equal(mapped.data.conflict, 1);
  assert.equal(perItemConflicts(result, new Set(["card_b", "subject_x"])), null, "una riga rifiutata senza elemento: errore per tutta la chiamata");
  assert.equal(perItemConflicts(result, new Set(["card_c"])), null, "un elemento invariato non ha scritto nulla");
  assert.equal(perItemConflicts({ ok: true, data: { id: "quiz_1" } }, new Set(["quiz_1"])), null);
});
