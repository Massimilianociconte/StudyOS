import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AGENT_TOOLS } from "../src/agent/catalog.ts";
import { GROUP_EXAM_TOOL_NAMES } from "../src/agent/catalogGroupExams.ts";
import { EXTRA_TOOL_NAMES } from "../src/agent/catalogExtras.ts";
import { UNIVERSITY_TOOL_NAMES } from "../src/agent/catalogUniversity.ts";
import { configureAgentRuntime, executeAgentTool } from "../src/agent/execute.ts";
import { groupExamWriterLoader } from "../src/agent/groupExamTools.ts";
import { setInstitutionalEmailsForTests } from "../src/agent/project.ts";
import { auditEntryOut, auditImage } from "../src/agent/remoteAudit.ts";
import { BARB_DATASET } from "../src/data/university/barb.dataset.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

// Indirizzi scritti da un membro: normale, @unimi.it, con caratteri invisibili, e un @nome.
const TYPED = "chiedi a bea.private@gmail.com o ada@unimi.it o be​a.x@gm​ail.com e @beahandle";
const LEAKS = ["bea.private", "gmail", "ada@unimi", "@beahandle", "beahandle", "@"];
const assertClean = (value, label = "") => {
  const json = JSON.stringify(value);
  for (const leak of LEAKS) assert.equal(json.includes(leak), false, `${label} ${leak}`);
};

const session = (patch = {}) => ({
  id: "gexam_a",
  groupId: "g1",
  courseKey: "id:farm-spec",
  courseId: "farm-spec",
  courseName: "Farmacologia Speciale",
  date: "2027-01-12",
  kind: "preappello",
  label: "",
  time: "09:30",
  room: "Aula C03",
  notes: "",
  registrationOpens: null,
  registrationCloses: null,
  barbSessionId: null,
  source: "member",
  version: 2,
  createdBy: "u-bea",
  createdByName: "Bea",
  updatedBy: "u-ada",
  updatedByName: "Ada",
  deletedAt: null,
  deletedByName: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-02T10:00:00Z",
  ...patch
});

const seed = (sessions = [session()], groupName = "Farmaco") => {
  useStudyStore.setState({ loading: false, locked: false, persistError: null, subjects: [], exams: [], events: [], examPlans: [], reminders: [] });
  useGroupExamStore.getState().reset();
  useGroupExamStore.getState().setSnapshot({ viewerId: "me", groups: [{ id: "g1", name: groupName }], sessions, overrides: [] });
};

test("H1: le righe «changes» del piano non portano email né @nome dei membri", async () => {
  seed([session({ room: "ex@gmail.com" })]);
  await executeAgentTool("studyos_plan_exam", { sessionId: "gexam_a", chosen: true });
  useGroupExamStore.getState().applySession(session({ version: 3, room: TYPED, courseName: `Farmacologia ${TYPED}`, label: TYPED }));
  const listed = await executeAgentTool("studyos_list_exam_plan", {});
  assert.equal(listed.ok, true);
  assert.ok(listed.data.items[0].changes.length >= 2);
  assertClean(listed.data, "list");
  const planned = await executeAgentTool("studyos_plan_exam", { sessionId: "gexam_a", notes: "ok" });
  assertClean(planned.data, "plan");
  assert.ok(planned.data.plan.changes.some((line) => line.includes("[email nascosta]")));
});

test("H1: anche il nome del gruppo e la copia salvata sono oscurati", async () => {
  seed([session({ room: TYPED })], TYPED);
  await executeAgentTool("studyos_plan_exam", { sessionId: "gexam_a", chosen: true });
  useGroupExamStore.getState().reset();
  const offline = await executeAgentTool("studyos_list_exam_plan", {});
  assertClean(offline.data, "copia salvata");
  seed([session({ room: TYPED })], TYPED);
  assertClean((await executeAgentTool("studyos_list_group_exam_sessions", {})).data, "elenco");
});

test("M1: il filtro query lavora sul testo oscurato: nessun oracolo carattere per carattere", async () => {
  seed([session({ room: "chiedi a bea.private@gmail.com" })]);
  const hit = await executeAgentTool("studyos_list_group_exam_sessions", { query: "bea.private@gmail.co" });
  const miss = await executeAgentTool("studyos_list_group_exam_sessions", { query: "bea.private@gmail.cx" });
  assert.equal(hit.data.items.length, 0);
  assert.equal(miss.data.items.length, 0);
  const shown = await executeAgentTool("studyos_list_group_exam_sessions", { query: "chiedi a" });
  assert.equal(shown.data.items.length, 1);
  assert.equal(shown.data.items[0].room, "chiedi a [email nascosta]");
  const zero = await executeAgentTool("studyos_list_group_exam_sessions", { query: "bea.private" });
  assert.equal(zero.data.items.length, 0);
});

const planImage = (room) => ({
  id: "plan_gexam_a",
  sessionId: "gexam_a",
  selected: true,
  status: "planned",
  notes: "",
  reminders: [],
  remindRegistration: false,
  dismissedMatches: [],
  archived: false,
  tags: [],
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  snapshot: { groupId: "g1", groupName: TYPED, courseKey: "nome:x", courseName: TYPED, date: "2027-01-12", kind: "appello", time: null, room, registrationCloses: null, version: 1 }
});

test("H2: registro remoto e ripristino non mostrano il testo dei membri del piano", () => {
  const image = auditImage("examPlan", planImage(TYPED));
  assertClean(image, "image");
  assert.equal(image.snapshot.date, "2027-01-12");
  const row = (patch) => ({
    id: "0b9d3a5e-6c1f-4a2b-9e8d-7f6a5b4c3d2e",
    created_at: "2026-11-12T10:00:00Z",
    grant_label: "x",
    from_app: false,
    tool: "studyos_plan_exam",
    entity_type: "examPlan",
    entity_id: "plan_gexam_a",
    restore_of: null,
    restored_at: null,
    can_restore: true,
    ...patch
  });
  assertClean(auditEntryOut(row({ action: "create", before: null, after: planImage(TYPED) })), "create");
  assertClean(
    auditEntryOut(row({ action: "update", before: planImage(TYPED), after: { ...planImage("altro ex@gmail.com"), snapshot: { ...planImage(TYPED).snapshot, version: 2, room: "altro ex@gmail.com" } } })),
    "update"
  );
  assertClean(auditEntryOut(row({ action: "delete", before: planImage(TYPED), after: null })), "delete");
});

test("H2: ripristino remoto: l'elemento e il conflitto passano da auditImage", () => {
  const source = readFileSync(new URL("../src/agent/cloudRunner.ts", import.meta.url), "utf8");
  assert.match(source, /item: auditImage\(change\.entityType, change\.item\)/);
  assert.match(source, /auditImage\(conflict\.entityType, conflict\.current\)/);
});

test("L1: sul remoto il controllo non propone strumenti che non ci sono; counts seguono i filtri", async () => {
  const dup = (id, created) => session({ id, courseKey: "name:chimica", courseId: null, courseName: "Chimica", date: "2027-01-12", kind: "appello", createdAt: created });
  seed([dup("a", "2026-11-01T10:00:00Z"), dup("b", "2026-11-02T10:00:00Z")]);
  const local = await executeAgentTool("studyos_check_consistency", {});
  assert.equal(local.data.items.find((i) => i.code === "duplicate_session").fix.tool, "studyos_delete_group_exam_session");
  configureAgentRuntime({ remote: true });
  try {
    const remote = await executeAgentTool("studyos_check_consistency", {});
    const issue = remote.data.items.find((i) => i.code === "duplicate_session");
    assert.equal(issue.fix, undefined);
    assert.match(issue.fixInApp, /nell'app/);
    const errors = await executeAgentTool("studyos_check_consistency", { minSeverity: "error" });
    assert.equal(errors.data.counts.error, errors.data.total);
    assert.equal(errors.data.counts.warning + errors.data.counts.info, 0);
  } finally {
    configureAgentRuntime({ remote: false });
  }
});

test("L2: 94 strumenti in tutto, 73 nel catalogo di base", () => {
  const core = AGENT_TOOLS.length - GROUP_EXAM_TOOL_NAMES.length - EXTRA_TOOL_NAMES.length - UNIVERSITY_TOOL_NAMES.length;
  assert.equal(AGENT_TOOLS.length, 94, `Strumenti: ${AGENT_TOOLS.length}, attesi 94 (73 di base + 8 + 8 + 5). Se ne hai aggiunti, aggiorna spec e documenti.`);
  assert.equal(core, 73, `Catalogo di base: ${core}, atteso 73: i nuovi strumenti vanno nei file catalog*.ts.`);
  assert.equal(new Set(AGENT_TOOLS.map((tool) => tool.name)).size, 94, "Nomi di strumenti ripetuti.");
});

test("L3: il caricamento dello snapshot sta dentro il try che azzera lo store", () => {
  const source = readFileSync(new URL("../src/agent/cloudRunner.ts", import.meta.url), "utf8");
  const run = source.indexOf("executeAgentTool(name, args)");
  const load = source.indexOf("await loadGroupSnapshot(grant.secret)", source.indexOf("const execute = async"));
  const tryAt = source.lastIndexOf("try {", run);
  const finallyAt = source.indexOf("useGroupExamStore.getState().reset()", run);
  assert.ok(load > tryAt && load < run, "loadGroupSnapshot deve stare nel try");
  assert.ok(finallyAt > run);
});

const teacher = BARB_DATASET.teachers.find((item) => item.email);
const course = BARB_DATASET.courses.find((item) => item.schedule.length > 0) ?? BARB_DATASET.courses[0];
const row = (id, patch = {}) => ({
  id, groupId: "g1", version: 1, createdBy: "u", createdByName: "Bea", updatedBy: "u", updatedByName: `Bea ${TYPED}`,
  deletedAt: null, deletedByName: null, createdAt: "2026-11-01T10:00:00Z", updatedAt: "2026-11-01T10:00:00Z", ...patch
});
const overrides = () => [
  row("gover_t", { targetKind: "teacher", targetId: teacher.id, targetLabel: teacher.displayName, fields: { email: "nuovo.prof@unimi.it", note: TYPED, officeHours: TYPED, website: "https://example.org/x" } }),
  row("gover_c", { targetKind: "contact", targetId: "nuovo:abc", targetLabel: TYPED, fields: { value: "segreteria@unimi.it", url: "mailto:segreteria@unimi.it" } })
];

test("L4: con l'interruttore spento nessuno strumento del catalogo mostra un indirizzo", async () => {
  useStudyStore.setState({ loading: false, locked: false, persistError: null, subjects: [], exams: [], events: [], examPlans: [] });
  useGroupExamStore.getState().setSnapshot({ viewerId: "me", groups: [{ id: "g1", name: TYPED }], sessions: [], overrides: overrides() });
  setInstitutionalEmailsForTests(false);
  try {
    const outputs = [
      await executeAgentTool("studyos_list_barb_teachers", { groupId: "g1", limit: 100 }),
      await executeAgentTool("studyos_get_barb_course", { id: course.id, groupId: "g1" }),
      await executeAgentTool("studyos_list_barb_contacts", { groupId: "g1" })
    ];
    for (const result of outputs) assert.equal(result.ok, true);
    const json = JSON.stringify(outputs);
    assert.equal(json.includes("@"), false, "nessun indirizzo con l'interruttore spento");
  } finally {
    setInstitutionalEmailsForTests(true);
  }
});

test("L5: l'etichetta di un contatto scritta da un membro è testo dei membri; passa solo l'email dedicata", async () => {
  useStudyStore.setState({ loading: false, locked: false, persistError: null, subjects: [], exams: [], events: [], examPlans: [] });
  useGroupExamStore.getState().setSnapshot({ viewerId: "me", groups: [{ id: "g1", name: "G" }], sessions: [], overrides: overrides() });
  groupExamWriterLoader.load = async () => ({});
  const contacts = await executeAgentTool("studyos_list_barb_contacts", { groupId: "g1" });
  const added = contacts.data.items.find((item) => !item.official);
  assertClean([added.label, added.corrections[0].targetLabel, added.corrections[0].by], "contatto aggiunto");
  assert.equal(added.value, "segreteria@unimi.it");
  const teachers = await executeAgentTool("studyos_list_barb_teachers", { groupId: "g1", query: teacher.displayName });
  assert.equal(teachers.data.items[0].effective.email, "nuovo.prof@unimi.it");
  const { note, officeHours } = teachers.data.items[0].corrections[0].fields;
  assertClean([note, officeHours], "note del docente");
});
