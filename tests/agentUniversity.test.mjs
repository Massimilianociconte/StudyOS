import assert from "node:assert/strict";
import test from "node:test";
import { CLOUD_UNAVAILABLE, findAgentTool } from "../src/agent/catalog.ts";
import { UNIVERSITY_TOOL_NAMES } from "../src/agent/catalogUniversity.ts";
import { executeAgentTool } from "../src/agent/execute.ts";
import { groupExamWriterLoader } from "../src/agent/groupExamTools.ts";
import { BARB_DATASET } from "../src/data/university/barb.dataset.ts";
import { useGroupExamStore } from "../src/store/useGroupExamStore.ts";
import { useStudyStore } from "../src/store/useStudyStore.ts";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;
const ALLOWED = /^[a-z0-9._%+-]+@unimi\.it$/;
const teacher = BARB_DATASET.teachers.find((item) => item.email);
const course = BARB_DATASET.courses.find((item) => item.schedule.length > 0) ?? BARB_DATASET.courses[0];

const row = (id, patch = {}) => ({
  id,
  groupId: "g1",
  version: 1,
  createdBy: "u-bea",
  createdByName: "Bea bea@gmail.com",
  updatedBy: "u-bea",
  updatedByName: "Bea",
  deletedAt: null,
  deletedByName: null,
  createdAt: "2026-11-01T10:00:00Z",
  updatedAt: "2026-11-01T10:00:00Z",
  ...patch
});

const teacherOverride = (patch = {}) =>
  row("gover_t", {
    targetKind: "teacher",
    targetId: teacher.id,
    targetLabel: teacher.displayName,
    fields: { email: "nuovo.prof@unimi.it", note: "chiedere a bea@gmail.com o a ada@unimi.it", officeHours: "mar 10-12, scrivere a bea@gmail.com" },
    ...patch
  });

const seed = (overrides = [teacherOverride()], sessions = []) => {
  useStudyStore.setState({ loading: false, locked: false, persistError: null, subjects: [], exams: [], events: [], examPlans: [] });
  // Un pull non porta indietro una riga più nuova già in memoria (spec §5.3): ogni prova riparte da zero.
  useGroupExamStore.getState().reset();
  useGroupExamStore.getState().setSnapshot({ viewerId: "me", groups: [{ id: "g1", name: "Gruppo di bea@gmail.com" }], sessions, overrides });
};

const fakeWriter = () => {
  const calls = [];
  groupExamWriterLoader.load = async () => ({
    saveOverride: async (...args) => {
      calls.push(["saveOverride", ...args]);
      const [groupId, id, expectedVersion, targetKind, targetId, targetLabel, fields] = args;
      return { status: "ok", row: row(id, { groupId, targetKind, targetId, targetLabel, fields, version: (expectedVersion ?? 0) + 1 }) };
    },
    deleteOverride: async (...args) => {
      calls.push(["deleteOverride", ...args]);
      return { status: "ok", row: teacherOverride({ deletedAt: "2026-11-12T10:00:00Z", version: 2 }) };
    },
    listHistory: async () => [
      {
        id: 7,
        groupId: "g1",
        recordKind: "catalog_override",
        recordId: "gover_t",
        action: "update",
        version: 2,
        before: { fields: { email: "vecchio@unimi.it" } },
        after: { fields: { email: "nuovo.prof@unimi.it", note: "bea@gmail.com" } },
        changedFields: ["fields"],
        actorUserId: "u-bea",
        actorName: "Bea",
        changedAt: "2026-11-02T10:00:00Z"
      }
    ]
  });
  return calls;
};

test("catalogo: cinque strumenti, le correzioni toccano il gruppo", () => {
  assert.equal(UNIVERSITY_TOOL_NAMES.length, 5);
  for (const name of UNIVERSITY_TOOL_NAMES) assert.ok(findAgentTool(name), name);
  for (const name of ["studyos_save_catalog_override", "studyos_delete_catalog_override"]) {
    assert.equal(findAgentTool(name).openWorld, true, name);
    assert.equal(CLOUD_UNAVAILABLE.has(name), true, name);
  }
  assert.equal(CLOUD_UNAVAILABLE.has("studyos_list_barb_teachers"), false);
});

test("docenti: correzioni dei gruppi e valori effettivi; senza appelli letti solo il catalogo", async () => {
  seed();
  const listed = await executeAgentTool("studyos_list_barb_teachers", { query: teacher.displayName, groupId: "g1" });
  const [item] = listed.data.items;
  assert.equal(item.email, teacher.email.toLowerCase());
  assert.equal(item.corrections[0].overrideId, "gover_t");
  assert.equal(item.corrections[0].fields.email, "nuovo.prof@unimi.it");
  assert.equal(item.effective.email, "nuovo.prof@unimi.it");
  assert.ok(item.correctedFields.includes("email"));
  useGroupExamStore.getState().reset();
  const offline = await executeAgentTool("studyos_list_barb_teachers", { query: teacher.displayName });
  assert.equal(offline.data.correctionsRead, false);
  assert.deepEqual(offline.data.items[0].corrections, []);
  assert.equal((await executeAgentTool("studyos_list_barb_teachers", { groupId: "g1" })).code, "not_connected");
});

test("correzioni: version obbligatoria se c'è già, campi uniti, email solo @unimi.it", async () => {
  seed([teacherOverride({ fields: { email: "nuovo.prof@unimi.it", note: "vecchia nota", officeHours: "mar 10-12" } })]);
  const calls = fakeWriter();
  const noVersion = await executeAgentTool("studyos_save_catalog_override", { groupId: "g1", targetKind: "teacher", targetId: teacher.id, fields: { office: "Stanza 3" } });
  assert.equal(noVersion.code, "conflict");
  assert.equal(noVersion.data.current.version, 1);
  const badEmail = await executeAgentTool("studyos_save_catalog_override", { groupId: "g1", targetKind: "teacher", targetId: teacher.id, expectedVersion: 1, fields: { email: "prof@gmail.com" } });
  assert.equal(badEmail.code, "invalid");
  assert.equal(badEmail.data.field, "email");
  const saved = await executeAgentTool("studyos_save_catalog_override", { groupId: "g1", targetKind: "teacher", targetId: teacher.id, expectedVersion: 1, fields: { office: "Stanza 3", note: "" } });
  assert.equal(saved.ok, true);
  const [, , id, version, , , , fields] = calls.at(-1);
  assert.equal(id, "gover_t");
  assert.equal(version, 1);
  assert.deepEqual(fields, { email: "nuovo.prof@unimi.it", officeHours: "mar 10-12", office: "Stanza 3" });
  const missing = await executeAgentTool("studyos_save_catalog_override", { groupId: "g1", targetKind: "course", targetId: "non-esiste", fields: { room: "Aula 1" } });
  assert.equal(missing.code, "not_found");
  const contact = await executeAgentTool("studyos_save_catalog_override", { groupId: "g1", targetKind: "contact", targetId: "nuovo", fields: { label: "Tutor", value: "tutor.barb@unimi.it" } });
  assert.equal(contact.ok, true);
  assert.match(calls.at(-1)[5], /^nuovo:[0-9a-f]{32}$/);
  assert.equal(calls.at(-1)[6], "Tutor");
});

test("eliminare una correzione: senza expectedVersion vale quella letta ora", async () => {
  seed();
  const calls = fakeWriter();
  const stale = await executeAgentTool("studyos_delete_catalog_override", { id: "gover_t", expectedVersion: 5, confirm: true });
  assert.equal(stale.code, "conflict");
  assert.equal(calls.length, 0);
  const done = await executeAgentTool("studyos_delete_catalog_override", { id: "gover_t", confirm: true });
  assert.equal(done.ok, true);
  assert.deepEqual(calls[0], ["deleteOverride", "gover_t", 1]);
});

test("email: agli agenti arrivano solo gli indirizzi @unimi.it di docenti e contatti", async () => {
  const session = row("gexam_e", {
    courseKey: "name:chimica",
    courseId: null,
    courseName: "Chimica",
    date: "2027-01-12",
    kind: "appello",
    label: "",
    time: null,
    room: "Aula ada@unimi.it",
    notes: "prof mario.rossi@unimi.it, io bea@gmail.com",
    registrationOpens: null,
    registrationCloses: null,
    barbSessionId: null,
    source: "member"
  });
  const contactOverride = row("gover_c", {
    targetKind: "contact",
    targetId: "nuovo:abc",
    targetLabel: "Segreteria",
    fields: { label: "Segreteria", value: "segreteria.x@unimi.it oppure bea@gmail.com", url: "mailto:bea@gmail.com" }
  });
  seed([teacherOverride(), contactOverride], [session]);
  fakeWriter();
  const outputs = [
    await executeAgentTool("studyos_list_barb_teachers", { groupId: "g1", query: teacher.displayName }),
    await executeAgentTool("studyos_get_barb_course", { id: course.id, groupId: "g1" }),
    await executeAgentTool("studyos_list_barb_contacts", { groupId: "g1" }),
    await executeAgentTool("studyos_list_group_exam_sessions", {}),
    await executeAgentTool("studyos_list_group_history", { groupId: "g1" })
  ];
  for (const result of outputs) assert.equal(result.ok, true, JSON.stringify(result));
  const json = JSON.stringify(outputs);
  for (const email of json.match(EMAIL) ?? []) assert.match(email, ALLOWED, email);
  // Mai indirizzi di altri domini, e mai quelli scritti dai membri in note, aule, nomi o cronologia.
  for (const hidden of ["bea@gmail.com", "ada@unimi.it", "mario.rossi@unimi.it", "vecchio@unimi.it"]) assert.equal(json.includes(hidden), false, hidden);
  // Quelli di docenti e contatti (anche corretti dal gruppo) arrivano.
  for (const shown of [teacher.email.toLowerCase(), "nuovo.prof@unimi.it", "segreteria.x@unimi.it"]) assert.ok(json.includes(shown), shown);
  useGroupExamStore.getState().reset();
});
