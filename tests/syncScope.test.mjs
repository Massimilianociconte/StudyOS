import test from "node:test";
import assert from "node:assert/strict";
import { groupLookup, isServerBacked } from "../src/lib/syncScope.ts";
import { planMerge } from "../src/lib/syncMerge.ts";
import { normalizeCollections } from "../src/lib/collections.ts";

const published = { id: "g1", sharedAt: "2026-11-01T10:00:00.000Z" };
const localOnly = { id: "g2" };
const groupOf = groupLookup([published, localOnly]);

test("ambito: i gruppi pubblicati e ciò che ne dipende restano fuori dal cloud personale", () => {
  assert.equal(isServerBacked("studyGroups", published, groupOf), true);
  assert.equal(isServerBacked("studyGroups", localOnly, groupOf), false);
  // Risorsa vista sul server sì; una propria non ancora pubblicata no (deve poter arrivare agli altri miei dispositivi).
  assert.equal(isServerBacked("groupResources", { groupId: "g1", sharedAt: "x" }, groupOf), true);
  assert.equal(isServerBacked("groupResources", { groupId: "g1" }, groupOf), false);
  assert.equal(isServerBacked("groupActivities", { groupId: "g1" }, groupOf), true);
  assert.equal(isServerBacked("groupActivities", { groupId: "g2" }, groupOf), false);
  // Invito: del gruppo pubblicato, o di un gruppo che qui non c'è (ricevuto) → tabelle condivise.
  assert.equal(isServerBacked("groupInvites", { groupId: "g1" }, groupOf), true);
  assert.equal(isServerBacked("groupInvites", { groupId: "g-altrui" }, groupOf), true);
  assert.equal(isServerBacked("groupInvites", { groupId: "g2" }, groupOf), false);
  // Il resto non è toccato.
  assert.equal(isServerBacked("tasks", { id: "t", sharedAt: "x", groupId: "g1" }, groupOf), false);
});

test("groupLookup: vince il primo elenco che ha il gruppo (stato attuale prima di quello di prima)", () => {
  const lookup = groupLookup([{ id: "g1" }], [{ id: "g1", sharedAt: "x" }, { id: "g3", sharedAt: "y" }]);
  assert.equal(lookup("g1").sharedAt, undefined);
  assert.equal(lookup("g3").sharedAt, "y");
  assert.equal(lookup("nessuno"), undefined);
});

test("planMerge: le righe da saltare non toccano lo stato locale né la coda", () => {
  const row = (type, id, payload, deleted = false) => ({ entity_type: type, entity_id: id, payload, deleted, updated_at: "2026-11-12T10:00:00Z" });
  const local = normalizeCollections({ studyGroups: [{ id: "g1", updatedAt: "2026-11-01T10:00:00.000Z", sharedAt: "x" }] });
  const pending = new Map([["studyGroup:g1", { deleted: false }]]);
  const skip = (collection, incoming, entity) => collection === "studyGroups" && Boolean(entity?.sharedAt);
  // Un tombstone vecchio del cloud personale (uscita dal gruppo) non cancella più il gruppo in cui si è rientrati.
  const plan = planMerge([row("studyGroup", "g1", { id: "g1", deletedAt: "2026-11-12T10:00:00.000Z" }, true)], local, pending, { skip });
  assert.deepEqual(plan.changes, []);
  assert.deepEqual(plan.dropOutbox, []);
  assert.equal(plan.ignored, 1);
  // Anche con il pull forzato.
  assert.deepEqual(planMerge([row("studyGroup", "g1", { id: "g1", updatedAt: "2026-11-12T10:00:00.000Z" })], local, pending, { skip, force: true }).changes, []);
});
