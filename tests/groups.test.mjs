import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyGroupRpcError,
  groupInviteLink,
  groupInviteMessage,
  inviteNotificationId,
  isInviteCodeShape,
  makeGroupInviteCode,
  mergeSharedSnapshot,
  normalizeInviteCode,
  realtimeGroupIds,
  settleInviteNotifications
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

test("merge condiviso: ciò che cambia senza un timbro nuovo dal server avanza di 1 ms", () => {
  // Il cloud personale accetta lo stesso timbro solo con lo stesso contenuto: membri nuovi o la
  // marcatura `sharedAt` con il timbro di prima venivano rifiutati per sempre («Conflitto cloud
  // irrisolto per studyGroup:…»).
  const shared = { ...group([member("alice", "owner")]), sharedAt: "2026-10-06T10:00:00.000Z" };
  const joined = mergeSharedSnapshot({ ...empty, groups: [shared] }, { ...empty, groups: [group([member("alice", "owner"), member("chicca")])] }, "chicca", ["g1"]);
  assert.equal(joined.groups[0].updatedAt, "2026-10-06T10:00:00.001Z");
  // Gruppo appena arrivato e marcato: stesso risultato su ogni dispositivo.
  const fresh = mergeSharedSnapshot(empty, { ...empty, groups: [group([member("alice", "owner")])] }, "chicca", ["g1"]);
  assert.equal(fresh.groups[0].updatedAt, "2026-10-06T10:00:00.001Z");
  assert.equal(fresh.groups[0].sharedAt, "2026-10-06T10:00:00.000Z");
  // Risorsa vista sul server per la prima volta.
  const marked = mergeSharedSnapshot(
    { ...empty, groups: [shared], resources: [resource("r1", "alice")] },
    { ...empty, groups: [group([member("alice", "owner")])], resources: [resource("r1", "alice")] },
    "alice",
    ["g1"]
  );
  assert.equal(marked.resources[0].updatedAt, "2026-10-06T10:00:00.001Z");
});

test("merge condiviso: i membri hanno sempre lo stesso ordine (niente riscritture a ogni pull)", () => {
  const members = [member("alice", "owner"), { ...member("bob"), joinedAt: "2026-10-07T10:00:00.000Z" }];
  const shared = { ...group(members), sharedAt: "2026-10-06T10:00:00.000Z" };
  // Il server restituisce i membri in un ordine qualsiasi.
  const merged = mergeSharedSnapshot({ ...empty, groups: [shared] }, { ...empty, groups: [group([...members].reverse())] }, "alice", ["g1"]);
  assert.equal(merged.groups[0], shared);
  const fromScratch = mergeSharedSnapshot(empty, { ...empty, groups: [group([...members].reverse())] }, "alice", ["g1"]);
  assert.deepEqual(fromScratch.groups[0].members.map((m) => m.userId), ["alice", "bob"]);
});

test("realtimeGroupIds: id sicuri per il filtro Realtime, senza doppioni, ordinati e al massimo 100", () => {
  assert.deepEqual(realtimeGroupIds(["group_b", "group_a", "group_b"]), ["group_a", "group_b"]);
  // Virgole, parentesi, punti o spazi cambierebbero il filtro `in.(…)`: quell'id resta fuori.
  assert.deepEqual(realtimeGroupIds(["ok-1", "a,b", "x)", "c.d", "e f", "", 7]), ["ok-1"]);
  assert.equal(realtimeGroupIds(Array.from({ length: 150 }, (_, i) => `g${String(i).padStart(3, "0")}`)).length, 100);
  assert.deepEqual(realtimeGroupIds([]), []);
});

const invite = (id, extra = {}) => ({
  ...base,
  id,
  updatedAt: "2026-10-06T10:00:00.000Z",
  groupId: "g1",
  groupName: "Fisio",
  fromUserId: "alice",
  fromDisplayName: "Alice",
  recipientEmail: "bob@example.com",
  code: "GRP-AB12-CD34",
  status: "pending",
  ...extra
});

test("merge condiviso: un invito ricevuto in attesa che il server non ha più sparisce (ritirato o gruppo eliminato)", () => {
  const local = { ...empty, invites: [invite("i1"), invite("i2"), invite("i3", { status: "accepted" }), invite("mine", { fromUserId: "bob", recipientEmail: "carla@example.com" })] };
  // Il server restituisce solo i2: i1 è stato cancellato (gruppo eliminato), i3 è storia, «mine» l'ho mandato io.
  const merged = mergeSharedSnapshot(local, { ...empty, invites: [invite("i2")] }, "bob", [], { receivedEmail: "Bob@Example.com" });
  assert.deepEqual(merged.invites.map((item) => item.id).sort(), ["i2", "i3", "mine"]);
  // Senza la lettura completa degli inviti ricevuti (niente email) non si toglie nulla.
  const partial = mergeSharedSnapshot(local, { ...empty, invites: [invite("i2")] }, "bob");
  assert.equal(partial.invites.length, 4);
});

test("merge condiviso: un invito accettato da un altro dispositivo arriva come accettato", () => {
  const local = { ...empty, invites: [invite("i1")] };
  const server = { ...empty, invites: [invite("i1", { status: "accepted", updatedAt: "2026-10-07T09:00:00.123456+00:00" })] };
  const merged = mergeSharedSnapshot(local, server, "bob", [], { receivedEmail: "bob@example.com" });
  assert.equal(merged.invites[0].status, "accepted");
  assert.equal(merged.freshInvites.length, 0);
});

test("merge condiviso: gli inviti di un gruppo sparito se ne vanno, salvo quelli che il server ha ancora", () => {
  const shared = { ...group([member("alice", "owner"), member("bob")]), sharedAt: "2026-10-06T10:00:00.000Z" };
  const local = { ...empty, groups: [shared], invites: [invite("old", { fromUserId: "bob", recipientEmail: "carla@example.com" }), invite("still")] };
  const merged = mergeSharedSnapshot(local, { ...empty, invites: [invite("still")] }, "bob", ["g1"], { receivedEmail: "bob@example.com" });
  assert.deepEqual(merged.groups, []);
  assert.deepEqual(merged.invites.map((item) => item.id), ["still"]);
});

test("notifiche degli inviti: lette quando nessun invito ricevuto per quel gruppo è più in attesa", () => {
  const now = "2026-10-08T10:00:00.000Z";
  const notification = (id, groupId, extra = {}) => ({ id, kind: "invite", linkGroupId: groupId, updatedAt: "2026-10-06T10:00:00.000Z", ...extra });
  const notifications = [
    notification("n1", "g1"),
    notification("n2", "g2"),
    notification("n3", "g3", { readAt: "2026-10-07T10:00:00.000Z" }),
    { id: "n4", kind: "group", linkGroupId: "g2", updatedAt: "2026-10-06T10:00:00.000Z" }
  ];
  const invites = [invite("i1", { groupId: "g1" }), invite("i2", { groupId: "g2", status: "accepted" }), invite("sent", { groupId: "g2", fromUserId: "bob", recipientEmail: "x@example.com" })];
  const settled = settleInviteNotifications(notifications, invites, "bob@example.com", now);
  assert.deepEqual(settled.filter((item) => item.readAt === now).map((item) => item.id), ["n2"]);
  assert.equal(settled[0], notifications[0]);
  // Niente da cambiare (o senza email): stesso array, così lo store non riscrive.
  assert.equal(settleInviteNotifications(settled, invites, "bob@example.com", now), settled);
  assert.equal(settleInviteNotifications(notifications, invites, "", now), notifications);
  assert.equal(inviteNotificationId("i1"), "notif-group-invite-i1");
});

test("notifiche degli inviti con id stabile: si chiudono per il loro invito, anche con un altro invito in attesa nel gruppo", () => {
  const now = "2026-10-08T10:00:00.000Z";
  const stable = (inviteId) => ({ id: inviteNotificationId(inviteId), kind: "invite", linkGroupId: "g1", updatedAt: "2026-10-06T10:00:00.000Z" });
  const notifications = [stable("withdrawn"), stable("open")];
  // «withdrawn» non c'è più sul server, «open» è ancora in attesa nello stesso gruppo.
  const settled = settleInviteNotifications(notifications, [invite("open")], "bob@example.com", now);
  assert.deepEqual(settled.map((item) => Boolean(item.readAt)), [true, false]);
});

test("esiti delle RPC dei gruppi: solo la rete è da riprovare", () => {
  assert.equal(classifyGroupRpcError(null), "ok");
  assert.equal(classifyGroupRpcError({ message: "Invito già gestito" }), "handled");
  assert.equal(classifyGroupRpcError({ message: "Invito non trovato" }), "not-found");
  assert.equal(classifyGroupRpcError({ message: "Invito destinato a un altro account" }), "other-account");
  assert.equal(classifyGroupRpcError({ message: "Codice non valido" }), "invalid-code");
  assert.equal(classifyGroupRpcError({ message: "Failed to fetch" }), "unavailable");
  assert.equal(classifyGroupRpcError({ message: "Accesso richiesto" }), "unavailable");
});
