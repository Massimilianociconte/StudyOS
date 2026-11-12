import assert from "node:assert/strict";
import test from "node:test";
import { listedReminders, reminderInstant } from "../src/lib/standaloneReminders.ts";

const reminder = (id, remindAt, patch = {}) => ({ id, title: id, remindAt, done: false, archived: false, createdAt: "", updatedAt: "", tags: [], ...patch });

test("i promemoria da fare, dal più vicino; fatti, archiviati e senza data restano fuori", () => {
  const list = listedReminders([
    reminder("b", "2027-01-12T09:00:00.000Z"),
    reminder("a", "2027-01-10T09:00:00.000Z"),
    reminder("done", "2027-01-09T09:00:00.000Z", { done: true }),
    reminder("old", "2027-01-08T09:00:00.000Z", { archived: true }),
    reminder("bad", "boh")
  ]);
  assert.deepEqual(list.map((item) => item.id), ["a", "b"]);
});

test("giorno e ora locali diventano un istante", () => {
  const iso = reminderInstant("2027-01-12", "09:30");
  const date = new Date(iso);
  assert.equal(date.getFullYear(), 2027);
  assert.equal(date.getMonth(), 0);
  assert.equal(date.getDate(), 12);
  assert.equal(date.getHours(), 9);
  assert.equal(date.getMinutes(), 30);
  assert.equal(reminderInstant("2027-02-30", "09:30"), null);
  assert.equal(reminderInstant("2027-01-12", "25:00"), null);
});
