import assert from "node:assert/strict";
import test from "node:test";
import { createCloudRunner } from "../src/agent/cloudRunner.ts";
import { executeAgentTool } from "../src/agent/execute.ts";
import { shareSyncLoader } from "../src/agent/sharedTools.ts";
import { courseKeyOf } from "../src/lib/groupExams.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";
import { useSharedStore } from "../src/store/useSharedStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const TYPED = "chiedi a bea.private@gmail.com o ada@unimi.it e @beahandle";
const LEAKS = ["bea.private", "gmail", "ada@unimi", "@beahandle", "beahandle", "bea private", "adaunimi", "%40"];
const leaksIn = (value) => {
  const json = JSON.stringify(value);
  return LEAKS.filter((leak) => json.includes(leak));
};

const session = (patch = {}) => ({
  id: "gexam_a", groupId: "g1", courseKey: "nome:farmaco", courseId: null, courseName: "Farmaco",
  date: "2027-01-12", kind: "appello", label: "", time: "09:30", room: "Aula C03", notes: "",
  registrationOpens: null, registrationCloses: null, barbSessionId: null, source: "member", version: 1,
  createdBy: "u-bea", createdByName: "Bea", updatedBy: "u-bea", updatedByName: "Bea", deletedAt: null, deletedByName: null,
  createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", ...patch
});

const seed = (sessions, extra = {}) => {
  useStudyStore.setState({ loading: false, locked: false, persistError: null, subjects: [], exams: [], events: [], examPlans: [], reminders: [], notifications: [], studyGroups: [], groupActivities: [], groupResources: [], ...extra });
  useGroupExamStore.getState().reset();
  useGroupExamStore.getState().setSnapshot({ viewerId: "me", groups: [{ id: "g1", name: "Farmaco" }], sessions, overrides: [] });
};

const resource = (id, url) => ({ id, groupId: "g1", kind: "link", title: "Link", url, body: "", pinned: false, addedByDisplayName: "Bea", updatedAt: "2026-11-05T10:00:00Z", createdAt: "2026-11-05T10:00:00Z" });

test("NEW-A: gli indirizzi delle risorse del gruppo non arrivano agli agenti; un link normale sì", async () => {
  seed([], {
    studyGroups: [{ id: "g1", name: "G", description: "", ownerDisplayName: "Ada", archived: false, updatedAt: "2026-11-01T10:00:00Z", members: [] }],
    groupResources: [
      resource("r1", "mailto:bea.private@gmail.com"),
      resource("r2", "mailto:ada@unimi.it"),
      resource("r3", "https://bea.private@gmail.com/"),
      resource("r4", "https://forms.example.com/?contatto=bea.private%40gmail.com"),
      resource("r5", "https://forms.example.com/?contatto=bea.private@gmail.com"),
      resource("r6", "https://example.org/appunti?pagina=2"),
      // Una percentuale non valida altrove impedisce di decodificare: il link non arriva.
      resource("r7", "https://forms.example.com/?vecchio=%E0&contatto=bea.private%2540gmail.com")
    ]
  });
  const board = await executeAgentTool("studyos_list_group_board", { groupId: "g1" });
  assert.equal(board.ok, true, JSON.stringify(board));
  const urls = Object.fromEntries(board.data.resources.map((item) => [item.id, item.url]));
  for (const id of ["r1", "r2", "r3", "r4", "r5", "r7"]) assert.equal(urls[id], null, id);
  assert.equal(urls.r6, "https://example.org/appunti?pagina=2");
  assert.deepEqual(leaksIn(board), []);
});

test("NEW-B: i nomi nelle condivisioni sono testo dei membri, in elenco e nella risposta", async () => {
  useStudyStore.setState({
    loading: false, locked: false, persistError: null, subjects: [],
    studyGroups: [{ id: "grp1", name: `G ${TYPED}`, description: "", ownerId: "me-uuid", ownerDisplayName: "Io", archived: false, sharedAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", members: [{ userId: "me-uuid", displayName: "Io", role: "owner" }, { userId: "u2", displayName: `Bea ${TYPED}`, role: "member" }] }]
  });
  const grant = (over) => ({
    id: "s1", ownerId: "me-uuid", ownerName: `Io ${TYPED}`, scope: "tasks", subjectIds: [], permission: "view", granteeUserId: null, granteeGroupId: "grp1",
    granteeName: `G ${TYPED}`, granteeEmail: null, createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z", ...over
  });
  useSharedStore.setState({
    availability: "ready", viewerId: "me-uuid", persistent: false,
    given: [grant({}), grant({ id: "s2", granteeGroupId: null, granteeUserId: "u2", granteeName: `Bea ${TYPED}` })],
    received: [grant({ id: "s3", ownerId: "u3", ownerName: `Carlo ${TYPED}`, granteeUserId: "me-uuid", granteeGroupId: null })],
    invites: [], labels: [], items: [], outbox: [], hiddenOwners: []
  });
  const listed = await executeAgentTool("studyos_list_shares", {});
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.deepEqual(leaksIn(listed), []);
  const real = shareSyncLoader.load;
  shareSyncLoader.load = async () => ({ shareWith: async () => undefined, updateShare: async () => undefined, revokeShare: async () => undefined });
  try {
    const group = await executeAgentTool("studyos_share_with", { groupId: "grp1", scopes: ["calendar"] });
    assert.equal(group.ok, true, JSON.stringify(group));
    assert.deepEqual(leaksIn(group), []);
    const handle = listed.data.people[0].personId;
    const person = await executeAgentTool("studyos_share_with", { personId: handle, scopes: ["calendar"] });
    assert.equal(person.ok, true, JSON.stringify(person));
    assert.deepEqual(leaksIn(person), []);
  } finally {
    shareSyncLoader.load = real;
  }
});

test("R-LOW-1: il controllo di coerenza non conferma un nome grezzo; duplicate_session resta sul nome vero", async () => {
  const name = "Chimica bea.private@gmail.com";
  const day = "2027-01-12";
  const one = session({ id: "a", courseName: name, courseKey: courseKeyOf(null, name), date: day, createdAt: "2026-11-01T10:00:00Z" });
  const two = session({ id: "b", courseName: "Chimica bea.private@yahoo.it", courseKey: courseKeyOf(null, "Chimica bea.private@yahoo.it"), date: day, createdAt: "2026-11-02T10:00:00Z" });
  const exam = (subjectId) => ({ id: "x1", subjectId, title: "Chimica", date: `${day}T09:00:00.000Z`, createdAt: "", updatedAt: "", archived: false, tags: [] });
  const subject = (title) => ({ id: "s1", name: title, archived: false, status: "active", teacher: "", cfu: 6, semester: "", color: "#000", createdAt: "", updatedAt: "", tags: [], notes: "" });
  // Controllo positivo: con un nome normale la corrispondenza c'è.
  seed([session({ id: "p", courseName: "Chimica", courseKey: "nome:chimica", date: day })], { subjects: [subject("Chimica")], exams: [exam("s1")] });
  assert.equal((await executeAgentTool("studyos_check_consistency", {})).data.items.some((issue) => issue.code === "unlinked_personal_duplicate"), true);
  // Il nome indovinato non fa comparire «unlinked_personal_duplicate».
  // Anche un appello con corso del catalogo non conferma il nome grezzo.
  seed([{ ...one, courseId: "chim-gen" }], { subjects: [subject("chimica bea private gmail com")], exams: [exam("s1")] });
  assert.equal((await executeAgentTool("studyos_check_consistency", {})).data.items.some((issue) => issue.code === "unlinked_personal_duplicate"), false);
  seed([one], { subjects: [subject("chimica bea private gmail com")], exams: [exam("s1")] });
  const guessed = await executeAgentTool("studyos_check_consistency", {});
  assert.equal(guessed.data.items.some((issue) => issue.code === "unlinked_personal_duplicate"), false);
  // Due appelli con indirizzi diversi non diventano un falso doppione.
  seed([one, two]);
  const separate = await executeAgentTool("studyos_check_consistency", {});
  assert.equal(separate.data.items.some((issue) => issue.code === "duplicate_session"), false);
  // Gli stessi nomi veri restano un doppione.
  seed([one, { ...one, id: "c", createdAt: "2026-11-03T10:00:00Z" }]);
  const same = await executeAgentTool("studyos_check_consistency", {});
  assert.equal(same.data.items.some((issue) => issue.code === "duplicate_session"), true);
  assert.deepEqual(leaksIn(same.data), []);
});

test("INFO-2: due corsi che oscurati coincidono hanno id diversi e stabili, senza testo grezzo", async () => {
  const names = ["Chimica a.one@gmail.com", "Chimica b.two@yahoo.it"];
  const sessions = names.flatMap((name, index) => [1, 2].map((n) => session({ id: `g${index}${n}`, courseName: name, courseKey: courseKeyOf(null, name), date: `2027-0${n}-12` })));
  seed(sessions);
  for (const item of sessions) assert.equal((await executeAgentTool("studyos_plan_exam", { sessionId: item.id, chosen: true })).ok, true);
  const first = await executeAgentTool("studyos_check_consistency", {});
  const issues = first.data.items.filter((issue) => issue.code === "two_selected_same_course");
  assert.equal(issues.length, 2);
  assert.notEqual(issues[0].id, issues[1].id);
  // Il suffisso è l'id del primo appello con quella chiave: mai derivato dal nome.
  assert.deepEqual(issues.map((issue) => issue.refs.courseKey.split("~")[1]).sort(), ["g01", "g11"]);
  assert.deepEqual(leaksIn(first.data), []);
  assert.equal(JSON.stringify(first.data).includes("a.one"), false);
  const second = await executeAgentTool("studyos_check_consistency", {});
  assert.deepEqual(second.data.items.filter((issue) => issue.code === "two_selected_same_course").map((i) => i.id), issues.map((i) => i.id));
});

test("INFO-3: le frasi vecchie del registro locale escono oscurate", async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, String(value)), removeItem: (key) => store.delete(key) };
  store.set("studyos-agent-audit", JSON.stringify([{ id: "e1", at: "2026-11-10T10:00:00Z", tool: "studyos_mark_notifications_read", status: "executed", summary: `Segnare come letta la notifica «${TYPED}»`, actor: "x" }]));
  const result = await executeAgentTool("studyos_list_audit", {});
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.data.items.length, 1);
  assert.deepEqual(leaksIn(result), []);
  delete globalThis.localStorage;
});

const SECRET = "c".repeat(64);
const grant = { secret: SECRET, timeZone: "Europe/Rome" };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("INFO-1: il conflitto di un ripristino remoto non porta il testo dei membri", async () => {
  const payload = { id: "n1", kind: "group", title: TYPED, body: TYPED, createdAt: "2026-11-05T10:00:00Z", updatedAt: "2026-11-05T10:00:00Z" };
  let conflict = true;
  const fetch = async (url, init) => {
    const fn = String(url).split("/rest/v1/rpc/")[1];
    const body = JSON.parse(init.body);
    if (fn === "studyos_agent_restore_call") {
      return reply(200, conflict
        ? { status: "conflict", items: 1, conflicts: [{ auditId: "a", entityType: "notification", entityId: payload.id, current: payload, currentDeleted: false }] }
        : { status: "restored", items: 1, changes: [{ auditId: "x", entityType: "notification", entityId: payload.id, action: "update", item: payload }] });
    }
    if (fn === "studyos_agent_pull") return reply(200, []);
    if (fn === "studyos_agent_push") return reply(200, body.p_rows.map((row) => ({ entity_type: row.entity_type, entity_id: row.entity_id, accepted: true })));
    return reply(404, { code: "PGRST202", message: fn });
  };
  const runner = createCloudRunner({ url: "http://cloud.test/", key: "sb_publishable_x", fetch });
  const args = { id: "0b9d3a5e-6c1f-4a2b-9e8d-7f6a5b4c3d2e" };
  const failed = await runner.run(grant, "studyos_restore_change", args);
  assert.equal(failed.ok, false);
  assert.equal(failed.data.status, "conflict");
  assert.ok(failed.data.current, "il conflitto porta l'elemento attuale");
  assert.equal(JSON.stringify([failed.error, failed.data.title, failed.data.current]).includes("@"), false);
  assert.deepEqual(leaksIn(failed), []);
  conflict = false;
  const done = await runner.run(grant, "studyos_restore_change", args);
  assert.equal(done.ok, true);
  assert.equal(JSON.stringify(done.data.item).includes("@"), false);
});
