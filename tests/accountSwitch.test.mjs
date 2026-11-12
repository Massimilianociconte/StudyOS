import test from "node:test";
import assert from "node:assert/strict";
import { PERSONAL_COLLECTIONS, personalRemovals } from "../src/lib/accountSwitch.ts";
import { ACCOUNT_TEXT } from "../src/lib/labels/account.ts";

const empty = () => ({
  subjects: [],
  tasks: [],
  events: [],
  exams: [],
  notes: [],
  goals: [],
  sessions: [],
  materials: [],
  preferences: []
});

test("cambio di account: nome, foto e preferenze di prima si tolgono, il resto si unisce", () => {
  const state = {
    ...empty(),
    preferences: [{ id: "main", displayName: "Anna Rossi", avatarDataUrl: "data:image/png;base64,AA", updatedAt: "2026-11-12T08:54:07.668Z" }],
    tasks: [{ id: "task_1", title: "Compito di Anna", updatedAt: "2026-11-12T08:54:07.668Z" }]
  };
  assert.deepEqual(personalRemovals(state), [{ collection: "preferences", id: "main", entity: null, force: true }]);
});

test("cambio di account: senza preferenze salvate non si toglie nulla", () => {
  assert.deepEqual(personalRemovals(empty()), []);
  assert.deepEqual(personalRemovals({ ...empty(), tasks: [{ id: "task_1", title: "x", updatedAt: "2026-11-12T08:00:00.000Z" }] }), []);
});

test("cambio di account: solo le preferenze sono della persona", () => {
  assert.deepEqual([...PERSONAL_COLLECTIONS], ["preferences"]);
});

test("uscita: le modifiche non inviate si contano al singolare e al plurale", () => {
  assert.match(ACCOUNT_TEXT.leavePending(1), /^1 modifica non è ancora/);
  assert.match(ACCOUNT_TEXT.leavePending(3), /^3 modifiche non sono ancora/);
});
