import assert from "node:assert/strict";
import test from "node:test";
import { canDeleteSession, lastDeletions, planChanges, registrationText } from "../src/lib/groupExamUi.ts";

const session = (patch = {}) => ({
  id: "gexam_a",
  groupId: "g1",
  courseName: "Farmacologia Speciale",
  date: "2027-01-14",
  kind: "preappello",
  time: "09:30",
  room: "Aula G24",
  registrationCloses: null,
  version: 3,
  createdBy: "u-bea",
  deletedAt: null,
  ...patch
});

const plan = (patch = {}) => ({
  id: "plan_gexam_a",
  sessionId: "gexam_a",
  selected: true,
  snapshot: {
    groupId: "g1",
    groupName: "Farmaco",
    courseKey: "id:farm-spec",
    courseName: "Farmacologia Speciale",
    date: "2027-01-12",
    kind: "preappello",
    time: "09:30",
    room: "Aula C03",
    registrationCloses: null,
    version: 1
  },
  ...patch
});

test("elimina chi l'ha aggiunto o chi gestisce il gruppo", () => {
  const group = { ownerId: "u-olga", members: [{ userId: "u-ada", role: "admin" }, { userId: "u-ugo", role: "member" }] };
  assert.equal(canDeleteSession(session(), "u-bea", group), true);
  assert.equal(canDeleteSession(session(), "u-olga", group), true);
  assert.equal(canDeleteSession(session(), "u-ada", group), true);
  assert.equal(canDeleteSession(session(), "u-ugo", group), false);
  assert.equal(canDeleteSession(session(), null, group), false);
});

test("cosa è cambiato da quando l'ho scelto", () => {
  assert.deepEqual(planChanges(plan(), session()), ["Data: 12/01/2027 → 14/01/2027", "Aula: Aula C03 → Aula G24"]);
  assert.deepEqual(planChanges(plan(), session({ version: 1 })), []);
  assert.deepEqual(planChanges(plan({ selected: false }), session()), []);
  assert.deepEqual(planChanges(plan(), undefined), []);
});

test("iscrizioni in una riga", () => {
  assert.equal(registrationText("2026-12-01", "2027-01-08"), "dal 01/12/2026 al 08/01/2027");
  assert.equal(registrationText(null, "2027-01-08"), "fino al 08/01/2027");
  assert.equal(registrationText("2026-12-01", null), "dal 01/12/2026");
  assert.equal(registrationText(null, null), "");
});

test("eliminati di recente: l'ultima eliminazione di ogni appello", () => {
  const entries = [
    { id: 4, recordKind: "exam_session", recordId: "a", action: "delete" },
    { id: 9, recordKind: "exam_session", recordId: "a", action: "delete" },
    { id: 7, recordKind: "exam_session", recordId: "b", action: "update" },
    { id: 8, recordKind: "catalog_override", recordId: "c", action: "delete" }
  ];
  const map = lastDeletions(entries);
  assert.deepEqual([...map.keys()], ["a"]);
  assert.equal(map.get("a").id, 9);
});
