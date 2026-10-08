import test from "node:test";
import assert from "node:assert/strict";
import {
  groupInviteLink,
  groupInviteMessage,
  isInviteCodeShape,
  makeGroupInviteCode,
  mergeSharedSnapshot,
  normalizeInviteCode
} from "../src/lib/groups.ts";
import { durationToMinutes, minutesToDuration } from "../src/lib/duration.ts";

test("codici invito: forma stabile, senza ambiguità, normalizzazione", () => {
  const seen = new Set();
  for (let i = 0; i < 50; i += 1) {
    const code = makeGroupInviteCode();
    assert.match(code, /^GRP-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    assert.ok(!/[01ILO]/.test(code.replace("GRP-", "").replaceAll("-", "")), `niente caratteri ambigui in ${code}`);
    seen.add(code);
  }
  assert.ok(seen.size > 40, "codici quasi sempre unici");
  assert.equal(normalizeInviteCode("  grp-ab12-cd34 "), "GRP-AB12-CD34");
  assert.ok(isInviteCodeShape("grp-ab12-cd34"));
  assert.ok(!isInviteCodeShape("ABC-123"));
  assert.ok(!isInviteCodeShape(""));
});

test("link e messaggio di invito contengono il codice normalizzato", () => {
  const link = groupInviteLink("grp-ab12-cd34");
  // Nel frammento: il codice non arriva ai server (log di GitHub Pages, referrer).
  assert.ok(link.includes("#invito=GRP-AB12-CD34"));
  assert.ok(!link.includes("?invito="));
  const message = groupInviteMessage("Fisio", "Alice", "grp-ab12-cd34");
  assert.ok(message.includes("Fisio") && message.includes("Alice") && message.includes("GRP-AB12-CD34"));
});

test("durate: conversioni valore+unità in minuti", () => {
  assert.equal(durationToMinutes(30, "minutes"), 30);
  assert.equal(durationToMinutes(2, "hours"), 120);
  assert.equal(durationToMinutes(1, "days"), 480);
  assert.equal(durationToMinutes(3, "days"), 1440);
  assert.equal(durationToMinutes(1, "weeks"), 2400);
  assert.equal(durationToMinutes(2, "weeks"), 4800);
  assert.equal(durationToMinutes(1, "months"), 9600);
  assert.equal(durationToMinutes(-5, "hours"), 0);
  assert.equal(durationToMinutes(1.5, "hours"), 90);
});

test("durate: unità più leggibile dai minuti", () => {
  assert.deepEqual(minutesToDuration(30), { value: "30", unit: "minutes" });
  assert.deepEqual(minutesToDuration(120), { value: "2", unit: "hours" });
  assert.deepEqual(minutesToDuration(480), { value: "1", unit: "days" });
  assert.deepEqual(minutesToDuration(2400), { value: "1", unit: "weeks" });
  assert.deepEqual(minutesToDuration(9600), { value: "1", unit: "months" });
  assert.deepEqual(minutesToDuration(90), { value: "90", unit: "minutes" });
  assert.deepEqual(minutesToDuration(0), { value: "0", unit: "minutes" });
});

const base = { archived: false, tags: [], createdAt: "2026-10-01T10:00:00.000Z" };
const group = (members, updatedAt = "2026-10-06T10:00:00.000Z") => ({
  ...base,
  id: "g1",
  updatedAt,
  name: "Fisio",
  description: "",
  ownerId: "alice",
  ownerDisplayName: "Alice",
  inviteCode: "GRP-AB12-CD34",
  members
});
const member = (userId, role = "member") => ({ userId, displayName: userId, role, joinedAt: "2026-10-06T10:00:00.000Z" });
const resource = (id, addedByUserId, updatedAt = "2026-10-06T10:00:00.000Z") => ({
  ...base,
  id,
  updatedAt,
  groupId: "g1",
  kind: "note",
  title: id,
  pinned: false,
  addedByUserId,
  addedByDisplayName: addedByUserId
});
const empty = { groups: [], invites: [], resources: [], activities: [] };

test("merge condiviso: i membri arrivano dal server anche se il gruppo non è cambiato", () => {
  const local = { ...empty, groups: [group([member("alice", "owner")])] };
  // Bob è entrato con un invito: il gruppo sul server ha la stessa data, ma un membro in più.
  const server = { ...empty, groups: [group([member("alice", "owner"), member("bob")], "2026-10-06T10:00:00+00:00")] };
  const merged = mergeSharedSnapshot(local, server, "alice");
  assert.deepEqual(merged.groups[0].members.map((m) => m.userId), ["alice", "bob"]);
  // Rimozione: sparisce anche in locale.
  const removed = mergeSharedSnapshot(merged, { ...empty, groups: [group([member("alice", "owner")])] }, "alice");
  assert.deepEqual(removed.groups[0].members.map((m) => m.userId), ["alice"]);
});

test("merge condiviso: risorse cancellate spariscono, le mie mai pubblicate restano", () => {
  const members = [member("alice", "owner"), member("bob")];
  const local = {
    ...empty,
    groups: [group(members)],
    resources: [resource("r-bob", "bob"), resource("r-alice-draft", "alice"), { ...resource("r-alice", "alice"), sharedAt: "2026-10-06T10:00:00.000Z" }]
  };
  const server = { ...empty, groups: [group(members)], resources: [] };
  const merged = mergeSharedSnapshot(local, server, "alice", ["g1"]);
  // r-bob (di altri) e r-alice (già vista sul server) cancellate; la bozza mai confermata resta.
  assert.deepEqual(merged.resources.map((r) => r.id), ["r-alice-draft"]);
  // Gruppo non restituito né chiesto (es. solo locale): nessuna pulizia.
  const untouched = mergeSharedSnapshot(local, empty, "alice");
  assert.equal(untouched.resources.length, 3);
});

test("merge condiviso: una risorsa vista sul server viene marcata", () => {
  const local = { ...empty, groups: [group([member("alice", "owner")])], resources: [resource("r1", "alice")] };
  const server = { ...empty, groups: [group([member("alice", "owner")])], resources: [resource("r1", "alice")] };
  const merged = mergeSharedSnapshot(local, server, "alice", ["g1"]);
  assert.ok(merged.resources[0].sharedAt);
  assert.ok(merged.groups[0].sharedAt);
});

test("merge condiviso: gruppo eliminato o membro rimosso sparisce con bacheca e cronologia", () => {
  const shared = { ...group([member("alice", "owner"), member("bob")]), sharedAt: "2026-10-06T10:00:00.000Z" };
  const activity = { ...base, id: "a1", updatedAt: "2026-10-06T10:00:00.000Z", groupId: "g1", actorDisplayName: "Alice", text: "ha creato il gruppo" };
  const local = { ...empty, groups: [shared], resources: [resource("r1", "alice")], activities: [activity] };
  // Bob chiede g1 (risulta membro in locale) ma il server non lo restituisce più.
  const merged = mergeSharedSnapshot(local, empty, "bob", ["g1"]);
  assert.equal(merged.groups.length, 0);
  assert.equal(merged.resources.length, 0);
  assert.equal(merged.activities.length, 0);
  // Mai visto sul server (solo locale) o non chiesto (altro account sullo stesso dispositivo): resta.
  assert.equal(mergeSharedSnapshot({ ...local, groups: [group(shared.members)] }, empty, "bob", ["g1"]).groups.length, 1);
  assert.equal(mergeSharedSnapshot(local, empty, "carol", []).groups.length, 1);
});

test("merge condiviso: confronto per istante, non per stringa (+00:00 e microsecondi)", () => {
  const local = { ...empty, resources: [{ ...resource("r1", "bob", "2026-10-06T10:00:00.500Z"), title: "vecchio" }] };
  // Più recente di 0,3 s ma, confrontata come stringa, "+" < "Z" la faceva sembrare più vecchia.
  const server = { ...empty, resources: [{ ...resource("r1", "bob", "2026-10-06T10:00:00.800123+00:00"), title: "nuovo" }] };
  assert.equal(mergeSharedSnapshot(local, server, "alice").resources[0].title, "nuovo");
  const stale = { ...empty, resources: [{ ...resource("r1", "bob", "2026-10-06T09:59:59.999999+00:00"), title: "stantio" }] };
  assert.equal(mergeSharedSnapshot(local, stale, "alice").resources[0].title, "vecchio");
});

test("merge condiviso: inviti nuovi segnalati una volta sola", () => {
  const invite = { ...base, id: "i1", updatedAt: "2026-10-06T10:00:00.000Z", groupId: "g1", groupName: "Fisio", fromUserId: "alice", fromDisplayName: "Alice", recipientEmail: "bob@example.com", code: "GRP-AB12-CD34", status: "pending" };
  const first = mergeSharedSnapshot(empty, { ...empty, invites: [invite] }, "bob");
  assert.equal(first.freshInvites.length, 1);
  const again = mergeSharedSnapshot(first, { ...empty, invites: [invite] }, "bob");
  assert.equal(again.freshInvites.length, 0);
});

test("merge condiviso: senza novità restituisce gli stessi oggetti (niente riscritture inutili)", () => {
  const shared = { ...group([member("alice", "owner")]), sharedAt: "2026-10-06T10:00:00.000Z" };
  const res = { ...resource("r1", "alice"), sharedAt: "2026-10-06T10:00:00.000Z" };
  const local = { ...empty, groups: [shared], resources: [res] };
  const server = { ...empty, groups: [group([member("alice", "owner")])], resources: [resource("r1", "alice")] };
  const merged = mergeSharedSnapshot(local, server, "alice", ["g1"]);
  assert.equal(merged.groups[0], shared);
  assert.equal(merged.resources[0], res);
});
