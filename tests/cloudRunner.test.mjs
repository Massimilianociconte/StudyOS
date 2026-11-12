import test from "node:test";
import assert from "node:assert/strict";
import { CLOUD_CLIENT_ID, CLOUD_TEXT, createCloudRunner, plannedRows } from "../src/agent/cloudRunner.ts";
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
      const list = rows
        .filter((row) => row.user === user && (!body.p_since || row.updated_at >= body.p_since))
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
