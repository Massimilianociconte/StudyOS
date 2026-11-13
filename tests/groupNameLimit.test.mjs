import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { executeAgentTool } from "../src/agent/execute.ts";
import { hiddenGroupName } from "../src/agent/groupExamTools.ts";
import { NOTIFICATION_TITLE_MAX, agentGroupName, agentNotificationTitle, publicGroup } from "../src/agent/project.ts";
import { auditImage } from "../src/agent/remoteAudit.ts";
import { publicShareGrant } from "../src/agent/shared.ts";
import { BARB_DATASET } from "../src/data/university/barb.dataset.ts";
import { GROUP_NAME_MAX, isGroupNameLimitError, serverGroupName } from "../src/lib/groups.ts";
import { GROUP_SYNC_TEXT } from "../src/lib/labels/groups.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// R3-4/R3-5: un nome di gruppo più lungo di 120 caratteri (scritto prima del limite) si taglia al confine di
// una parola PRIMA di oscurare. Tagliato a metà, «bea.privata@gmail.com» diventerebbe «bea.priv» (senza «@»,
// quindi non più un indirizzo da nascondere) e arriverebbe all'agente.
const T1 = `${"x".repeat(110)} bea.privata@gmail.com`;
const T4 = `${"x".repeat(105)} bea.privata(at)gmail.com`;
const LEAKS = ["bea", "priv", "gmail", "(at", "@"];
const assertClean = (value, label) => {
  const json = JSON.stringify(value);
  for (const leak of LEAKS) assert.equal(json.includes(leak), false, `${label}: ${leak}`);
};

const session = (patch = {}) => ({
  id: "gexam_a", groupId: "g1", courseKey: "nome:farmaco", courseId: null, courseName: "Farmaco",
  date: "2027-01-12", kind: "appello", label: "", time: "09:30", room: "Aula C03", notes: "",
  registrationOpens: null, registrationCloses: null, barbSessionId: null, source: "member", version: 1,
  createdBy: "u-bea", createdByName: "Bea", updatedBy: "u-bea", updatedByName: "Bea", deletedAt: null, deletedByName: null,
  createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", ...patch
});

const teacher = BARB_DATASET.teachers.find((item) => item.email);
const correction = {
  id: "gover_t", groupId: "g1", targetKind: "teacher", targetId: teacher.id, targetLabel: teacher.displayName,
  fields: { email: "nuovo.prof@unimi.it" }, version: 1, createdBy: "u", createdByName: "Bea", updatedBy: "u", updatedByName: "Bea",
  deletedAt: null, deletedByName: null, createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z"
};

const seed = (name) => {
  useStudyStore.setState({
    loading: false, locked: false, persistError: null, subjects: [], exams: [], events: [], examPlans: [], reminders: [], notifications: [],
    groupActivities: [], groupResources: [],
    studyGroups: [{ id: "g1", name, description: "", ownerDisplayName: "Bea", archived: false, updatedAt: "2026-11-01T10:00:00Z", members: [{ displayName: "Bea", role: "owner", userId: "u1" }] }]
  });
  useGroupExamStore.getState().reset();
  useGroupExamStore.getState().setSnapshot({ viewerId: "me", groups: [{ id: "g1", name }], sessions: [session()], overrides: [correction] });
};

test("agentGroupName: al massimo 120 caratteri, tagliato al confine di una parola, poi oscurato", () => {
  assert.equal(GROUP_NAME_MAX, 120);
  assert.equal(agentGroupName(T1), "x".repeat(110));
  assert.equal(agentGroupName(T4), "x".repeat(105));
  assert.equal(agentGroupName("Farmaco bea@gmail.com"), "Farmaco [email nascosta]", "un nome corto si oscura e basta");
  assert.equal(agentGroupName(null), "");
  assert.equal(publicGroup({ id: "g", name: T1, description: "", ownerDisplayName: "", archived: false, updatedAt: "", members: [] }).name, "x".repeat(110));
  // Gli stessi tagli dell'istantanea SQL (tests/fixtures/emailVectors.json, «cuts»).
  const { cuts } = JSON.parse(readFileSync(new URL("./fixtures/emailVectors.json", import.meta.url), "utf8"));
  for (const c of cuts) assert.equal(agentGroupName(c.input), c.agent, c.name);
});

test("ogni strumento che dà il nome del gruppo lo taglia allo stesso modo", async () => {
  for (const [label, name, expected] of [["T1", T1, "x".repeat(110)], ["T4", T4, "x".repeat(105)]]) {
    seed(name);
    assert.equal(hiddenGroupName("g1"), expected, `${label}: appelli e correzioni (publicOverride)`);
    const sessions = await executeAgentTool("studyos_list_group_exam_sessions", {});
    assert.equal(sessions.ok, true, JSON.stringify(sessions));
    assert.equal(sessions.data.groups[0].name, expected);
    assert.equal(sessions.data.items[0].groupName, expected);
    assertClean(sessions.data, `${label} appelli`);
    const corrections = await executeAgentTool("studyos_list_barb_teachers", { groupId: "g1", query: teacher.displayName, limit: 5 });
    assert.equal(corrections.ok, true, JSON.stringify(corrections));
    const mine = corrections.data.items.find((item) => item.id === teacher.id);
    assert.equal(mine.corrections[0].groupName, expected, `${label}: publicCorrection`);
    const groups = await executeAgentTool("studyos_list_groups", {});
    assert.equal(groups.data.items[0].name, expected);
    assertClean(groups.data, `${label} gruppi`);
    const plan = await executeAgentTool("studyos_plan_exam", { sessionId: "gexam_a", chosen: true });
    assert.equal(plan.ok, true, JSON.stringify(plan));
    useGroupExamStore.getState().reset();
    const offline = await executeAgentTool("studyos_list_exam_plan", {});
    assert.equal(offline.data.items[0].session.groupName, expected, `${label}: copia salvata (snapshotView)`);
    assertClean(offline.data.items[0].session, `${label} copia salvata`);
  }
});

test("i punti che danno il nome di un gruppo passano da agentGroupName o hiddenGroupName", () => {
  const exams = readFileSync(new URL("../src/agent/groupExamTools.ts", import.meta.url), "utf8");
  const university = readFileSync(new URL("../src/agent/universityTools.ts", import.meta.url), "utf8");
  assert.match(exams, /const publicOverride = [\s\S]*?groupName: hiddenGroupName\(row\.groupId\)/);
  assert.match(university, /export const publicCorrection = [\s\S]*?groupName: hiddenGroupName\(row\.groupId\)/);
  for (const source of [exams, university]) assert.equal(/groupName: agentMemberText/.test(source), false);
});

test("il nome di un nuovo gruppo ha maxLength 120 nel modulo", () => {
  const view = readFileSync(new URL("../src/views/GroupsView.tsx", import.meta.url), "utf8");
  const input = view.slice(view.indexOf('<Field label="Nome del gruppo">'), view.indexOf("</Field>", view.indexOf('<Field label="Nome del gruppo">')));
  assert.match(input, /maxLength=\{GROUP_NAME_MAX\}/);
  assert.match(view, /import \{[^}]*GROUP_NAME_MAX[^}]*\} from "\.\.\/lib\/groups"/);
});

// R5-D: il dettaglio «stesso appello in un altro gruppo», l'invito nel registro delle azioni e il titolo delle
// notifiche passano dallo stesso taglio. Un nome più lungo di 120 (T5) tagliato a metà lascerebbe «bea.priv».
const T5 = `${"x".repeat(100)} ${"y".repeat(30)} bea.privata@gmail.com`;

test("controllo di coerenza: i nomi degli altri gruppi sono tagliati e oscurati per l'agente", async () => {
  seed(T1);
  useGroupExamStore.getState().setSnapshot({
    viewerId: "me",
    groups: [{ id: "g1", name: T1 }, { id: "g2", name: T5 }],
    sessions: [session(), session({ id: "gexam_b", groupId: "g2", createdAt: "2026-11-01T11:00:00Z" })],
    overrides: []
  });
  const report = await executeAgentTool("studyos_check_consistency", {});
  assert.equal(report.ok, true, JSON.stringify(report));
  const issue = report.data.items.find((item) => item.code === "same_session_other_group");
  assert.ok(issue, JSON.stringify(report.data.items));
  assert.equal(issue.detail.startsWith(`Gruppi: ${"x".repeat(110)}, ${"x".repeat(100)}.`), true, issue.detail);
  assertClean(issue, "coerenza");
});

test("registro delle azioni e notifiche: il nome del gruppo si taglia prima di oscurare", async () => {
  assert.equal(auditImage("groupInvite", { id: "i1", groupName: T1, status: "pending" }).title, "x".repeat(110));
  assert.equal(auditImage("groupInvite", { id: "i1", groupName: T5, status: "pending" }).title, "x".repeat(100));
  assertClean(auditImage("groupInvite", { id: "i1", groupName: T4, status: "pending" }), "invito T4");
  assert.equal(auditImage("groupResource", { id: "r1", title: "Dispense bea@gmail.com" }).title, "Dispense [email nascosta]");
  const invite = `Invito al gruppo "${T5}"`;
  const audited = auditImage("notification", { id: "n1", kind: "invite", title: invite, body: "Ti ha invitato Bea" });
  assertClean(audited, "notifica nel registro");
  assert.equal(audited.title, `Invito al gruppo "${"x".repeat(100)} ${"y".repeat(30)}`);
  assert.equal(agentNotificationTitle(invite).length <= NOTIFICATION_TITLE_MAX, true);
  assert.equal(agentNotificationTitle('Sei entrato in "Farmaco bea@gmail.com"'), 'Sei entrato in "Farmaco [email nascosta]"');
  seed(T5);
  useStudyStore.setState({
    notifications: [{ id: "n1", kind: "invite", title: invite, body: "", createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z" }]
  });
  const listed = await executeAgentTool("studyos_list_notifications", {});
  assert.equal(listed.ok, true, JSON.stringify(listed));
  assert.equal(listed.data.items[0].title, `Invito al gruppo "${"x".repeat(100)} ${"y".repeat(30)}`);
  assertClean(listed.data, "notifiche");
  const searched = await executeAgentTool("studyos_list_notifications", { query: "gmail" });
  assert.equal(searched.data.items.length, 0, "la ricerca lavora sul titolo tagliato e oscurato");
  // L'app mostra il titolo intero.
  assert.equal(useStudyStore.getState().notifications[0].title, invite);
});

// R5-E: un nome locale più lungo di 120 (scritto prima del limite) parte tagliato al confine di una parola; se il
// server lo rifiuta comunque (23514), il gruppo non torna in coda e l'invito dice «nome troppo lungo».
test("serverGroupName: entro 120 caratteri Unicode, tagliato al confine di una parola, mai un pezzo d'indirizzo", () => {
  assert.equal(serverGroupName("Farmaco"), "Farmaco");
  const exact = "é".repeat(GROUP_NAME_MAX);
  assert.equal(serverGroupName(exact), exact, "120 caratteri restano");
  const astral = "\u{1F600}".repeat(GROUP_NAME_MAX);
  assert.equal(serverGroupName(astral), astral, "120 caratteri astrali (240 unità UTF-16) restano");
  assert.equal(serverGroupName(T1), "x".repeat(110));
  assert.equal(serverGroupName(T4), "x".repeat(105));
  assert.equal(serverGroupName(T5), `${"x".repeat(100)} ${"y".repeat(30)}`.slice(0, 100));
  const oneWord = `${"x".repeat(110)}bea.privata@gmail.com`;
  const cut = serverGroupName(oneWord);
  assert.equal(Array.from(cut).length <= GROUP_NAME_MAX, true);
  for (const leak of ["bea", "priv", "gmail"]) assert.equal(cut.includes(leak), false, `una parola sola: ${leak}`);
  for (const name of [T1, T4, T5, oneWord, "a ".repeat(200), "\u{1F600} ".repeat(100)]) {
    assert.equal(Array.from(serverGroupName(name)).length <= GROUP_NAME_MAX, true, name.slice(0, 20));
  }
});

test("isGroupNameLimitError: 23514 o il messaggio del limite, non gli errori di rete", () => {
  assert.equal(isGroupNameLimitError({ code: "23514", message: "Il nome del gruppo può avere al massimo 120 caratteri." }), true);
  assert.equal(isGroupNameLimitError({ code: "P0001", message: "Il nome del gruppo può avere al massimo 120 caratteri." }), true);
  assert.equal(isGroupNameLimitError({ message: 'trigger "studyos_groups_name_limit"' }), true);
  assert.equal(isGroupNameLimitError({ code: "23514" }), true);
  assert.equal(isGroupNameLimitError({ code: "PGRST301", message: "JWT expired" }), false);
  assert.equal(isGroupNameLimitError({ code: "08006", message: "connection failure" }), false);
  assert.equal(isGroupNameLimitError(undefined), false);
  assert.equal(isGroupNameLimitError(null), false);
  // R5-2: un altro vincolo (id di un gruppo vecchio) non è «nome troppo lungo».
  assert.equal(isGroupNameLimitError({ code: "23514", message: 'new row for relation "studyos_groups" violates check constraint "studyos_groups_id_shape"' }), false);
});

test("R5-1: una condivisione con un gruppo mostra all'agente il nome attuale tagliato tra due parole", () => {
  // 112 caratteri prima dell'indirizzo: il vecchio slice(0, 120) teneva «bea.priv», senza @ e quindi non oscurato.
  const name = `${"Gruppo di studio ".repeat(6)}seminario bea.privata@gmail.com`;
  const stored = name.slice(0, 120);
  assert.equal(stored.endsWith("bea.priv"), true);
  const grant = {
    id: "s1", ownerId: "me", ownerName: "Io", scope: "tasks", subjectIds: [], permission: "view", granteeUserId: null, granteeGroupId: "g1",
    granteeName: stored, granteeEmail: null, createdAt: "2026-11-10T00:00:00.000Z", updatedAt: "2026-11-10T00:00:00.000Z"
  };
  const shown = publicShareGrant(grant, "given", () => undefined, (id) => (id === "g1" ? name : undefined)).sharedWith;
  for (const leak of ["bea", "priv", "gmail"]) assert.equal(shown.includes(leak), false, `${leak}: ${shown}`);
  assert.equal(shown.startsWith("Gruppo di studio"), true);
  // Gruppo non più presente in locale: il nome salvato passa comunque dal taglio e dall'oscuramento.
  assert.equal(publicShareGrant(grant, "given", () => undefined).sharedWith.includes("@"), false);
  const sync = readFileSync(new URL("../src/lib/shareSync.ts", import.meta.url), "utf8");
  assert.match(sync, /grantee_name: target\.groupId \? serverGroupName\(target\.name\) : target\.name\.slice\(0, 120\)/);
});

test("groupSync taglia il nome prima dell'upsert e non rimette in coda un nome rifiutato", () => {
  const sync = readFileSync(new URL("../src/lib/groupSync.ts", import.meta.url), "utf8");
  const push = sync.slice(sync.indexOf("export const pushSharedGroup"), sync.indexOf("export const pushSharedMembership"));
  assert.match(push, /name: serverGroupName\(group\.name\)/, "il nome parte tagliato");
  assert.doesNotMatch(push, /name: group\.name/);
  assert.match(push, /if \(isGroupNameLimitError\(error\)\) nameRejected\.add\(group\.id\);/);
  assert.match(push, /nameRejected\.delete\(group\.id\);/, "una scrittura riuscita toglie il rifiuto");
  const publish = sync.slice(sync.indexOf("export const publishGroup"), sync.indexOf("export const publishResource"));
  assert.match(publish, /rememberPublish\("group", group\.id, ok \|\| nameRejected\.has\(group\.id\)\)/, "un nome rifiutato esce dalla coda");
  assert.match(sync, /error: \{ code: error\.code, message: error\.message \}/, "pushRowDetailed riporta codice e messaggio");
  assert.match(sync, /export const groupNameRejected = \(groupId: string\) => nameRejected\.has\(groupId\);/);
  const invite = readFileSync(new URL("../src/components/GroupInvite.tsx", import.meta.url), "utf8");
  assert.match(invite, /"name-too-long": \{ tone: "warn", text: GROUP_SYNC_TEXT\.nameTooLong \}/);
  assert.match(invite, /setNameRejected\(groupNameRejected\(group\.id\)\)/);
  assert.match(invite, /: nameRejected\s*\? "name-too-long"/);
  assert.match(GROUP_SYNC_TEXT.nameTooLong, /^Nome troppo lungo/);
  assert.match(GROUP_SYNC_TEXT.nameTooLong, /120 caratteri/);
});
