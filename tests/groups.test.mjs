import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import {
  classifyGroupRpcError,
  groupInviteLink,
  groupInviteMessage,
  inviteNotificationId,
  invitesToNotify,
  isCodeOnlyInvite,
  isLegacyEmailInvite,
  isReceivedInvite,
  isInviteCodeShape,
  makeGroupInviteCode,
  mergeSharedSnapshot,
  normalizeInviteCode,
  realtimeGroupIds,
  serverStampOf,
  settleInviteNotifications,
  NEUTRAL_MEMBER_NAME,
  visibleMemberName,
  withServerStamp
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
  const invite = { ...base, id: "i1", updatedAt: "2026-10-06T10:00:00.000Z", groupId: "g1", groupName: "Fisio", fromUserId: "alice", fromDisplayName: "Alice", recipientUserId: "bob", code: "GRP-AB12-CD34", status: "pending" };
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
  recipientUserId: "bob",
  code: "GRP-AB12-CD34",
  status: "pending",
  ...extra
});

test("merge condiviso: un invito ricevuto in attesa che il server non ha più sparisce (ritirato o gruppo eliminato)", () => {
  const local = { ...empty, invites: [invite("i1"), invite("i2"), invite("i3", { status: "accepted" }), invite("mine", { fromUserId: "bob", recipientUserId: "carla" })] };
  // Il server restituisce solo i2: i1 è stato cancellato (gruppo eliminato), i3 è storia, «mine» l'ho mandato io.
  const merged = mergeSharedSnapshot(local, { ...empty, invites: [invite("i2")] }, "bob", [], { receivedComplete: true });
  assert.deepEqual(merged.invites.map((item) => item.id).sort(), ["i2", "i3", "mine"]);
  // Senza la lettura completa degli inviti ricevuti non si toglie nulla.
  const partial = mergeSharedSnapshot(local, { ...empty, invites: [invite("i2")] }, "bob");
  assert.equal(partial.invites.length, 4);
});

test("merge condiviso: un invito accettato da un altro dispositivo arriva come accettato", () => {
  const local = { ...empty, invites: [invite("i1")] };
  const server = { ...empty, invites: [invite("i1", { status: "accepted", updatedAt: "2026-10-07T09:00:00.123456+00:00" })] };
  const merged = mergeSharedSnapshot(local, server, "bob", [], { receivedComplete: true });
  assert.equal(merged.invites[0].status, "accepted");
  assert.equal(merged.freshInvites.length, 0);
});

test("merge condiviso: gli inviti di un gruppo sparito se ne vanno, salvo quelli che il server ha ancora", () => {
  const shared = { ...group([member("alice", "owner"), member("bob")]), sharedAt: "2026-10-06T10:00:00.000Z" };
  const local = { ...empty, groups: [shared], invites: [invite("old", { fromUserId: "bob", recipientUserId: "carla" }), invite("still")] };
  const merged = mergeSharedSnapshot(local, { ...empty, invites: [invite("still")] }, "bob", ["g1"], { receivedComplete: true });
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
  const invites = [invite("i1", { groupId: "g1" }), invite("i2", { groupId: "g2", status: "accepted" }), invite("sent", { groupId: "g2", fromUserId: "bob", recipientUserId: "x" })];
  const settled = settleInviteNotifications(notifications, invites, "bob", now);
  assert.deepEqual(settled.filter((item) => item.readAt === now).map((item) => item.id), ["n2"]);
  assert.equal(settled[0], notifications[0]);
  // Niente da cambiare (o senza account): stesso array, così lo store non riscrive.
  assert.equal(settleInviteNotifications(settled, invites, "bob", now), settled);
  assert.equal(settleInviteNotifications(notifications, invites, "", now), notifications);
  assert.equal(inviteNotificationId("i1"), "notif-group-invite-i1");
});

test("notifiche degli inviti con id stabile: si chiudono per il loro invito, anche con un altro invito in attesa nel gruppo", () => {
  const now = "2026-10-08T10:00:00.000Z";
  const stable = (inviteId) => ({ id: inviteNotificationId(inviteId), kind: "invite", linkGroupId: "g1", updatedAt: "2026-10-06T10:00:00.000Z" });
  const notifications = [stable("withdrawn"), stable("open")];
  // «withdrawn» non c'è più sul server, «open» è ancora in attesa nello stesso gruppo.
  const settled = settleInviteNotifications(notifications, [invite("open")], "bob", now);
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

test("timbro del server: si adotta dopo la scrittura, mai sopra una modifica fatta nel frattempo", () => {
  // Postgres restituisce microsecondi e fuso: in ISO al millisecondo, come i timbri dell'app.
  assert.equal(serverStampOf([{ updated_at: "2026-11-12T15:00:00.123456+00:00" }]), "2026-11-12T15:00:00.123Z");
  assert.equal(serverStampOf([]), undefined);
  assert.equal(serverStampOf(null), undefined);
  assert.equal(serverStampOf([{ updated_at: "non è una data" }]), undefined);

  // Telefono con l'orologio 5 minuti avanti: la copia locale prende l'ora del server.
  const sent = "2026-11-12T15:05:00.000Z";
  const items = [{ id: "r1", updatedAt: sent, pinned: true }, { id: "r2", updatedAt: "2026-11-12T14:00:00.000Z", pinned: false }];
  const next = withServerStamp(items, "r1", "2026-11-12T15:00:00.123Z", sent);
  assert.deepEqual(next, [{ id: "r1", updatedAt: "2026-11-12T15:00:00.123Z", pinned: true }, items[1]]);
  // Una modifica successiva di un altro membro (ora del server, dopo) ora vince nel merge.
  assert.ok(Date.parse("2026-11-12T15:01:00.000Z") > Date.parse(next[0].updatedAt));

  // Cambiata qui dopo l'invio, già uguale, sparita o server vecchio (nessun timbro): nulla da fare.
  assert.equal(withServerStamp(items, "r1", "2026-11-12T15:00:00.123Z", "2026-11-12T15:04:00.000Z"), null);
  assert.equal(withServerStamp(items, "r1", sent, sent), null);
  assert.equal(withServerStamp(items, "r9", "2026-11-12T15:00:00.123Z"), null);
  assert.equal(withServerStamp(items, "r1", undefined, sent), null);
  // Senza `sent` (fissaggio: il cambio locale arriva dopo la scrittura) si adotta comunque.
  assert.equal(withServerStamp(items, "r2", "2026-11-12T15:00:00.123Z")[1].updatedAt, "2026-11-12T15:00:00.123Z");
});

test("SQL dei gruppi: timbri, ingressi e uscite li scrive il server", () => {
  const sql = readFileSync(new URL("../supabase/groups.sql", import.meta.url), "utf8");
  for (const table of ["studyos_groups", "studyos_group_invites", "studyos_group_resources"]) {
    assert.match(sql, new RegExp(`before insert or update on public\\.${table}\\s+for each row execute function public\\.studyos_group_stamp\\(\\)`));
  }
  // Nome diverso dal trigger di sharing.sql che toglie le condivisioni di chi esce.
  assert.match(sql, /after delete on public\.studyos_group_members\s+for each row execute function public\.studyos_group_member_left_activity\(\)/);
  assert.equal((sql.match(/get diagnostics v_added = row_count;/g) ?? []).length, 2);
  assert.doesNotMatch(sql, /'activity-' \|\| p_invite_id/);
  // L'app non scrive più le voci di uscita e rimozione (le scriveva prima di sapere se l'uscita riusciva).
  const view = readFileSync(new URL("../src/views/GroupsView.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(view, /logSharedActivity\([^)]*"ha lasciato il gruppo"/);
  assert.doesNotMatch(view, /removedMemberActivity/);
});

test("notifiche inviti: solo quelli ricevuti e ancora in attesa, mai quelli che ho mandato io", () => {
  const base = { groupId: "g1", groupName: "Fisio", groupDescription: "", fromDisplayName: "Alice", code: "", updatedAt: "2026-01-01T00:00:00.000Z" };
  const sent = { ...base, id: "i1", fromUserId: "me", recipientUserId: "bob", status: "pending" };
  const received = { ...base, id: "i2", fromUserId: "alice", recipientUserId: "me", status: "pending" };
  const answered = { ...base, id: "i3", fromUserId: "alice", recipientUserId: "me", status: "accepted" };
  assert.deepEqual(invitesToNotify([sent], "me"), []);
  assert.deepEqual(invitesToNotify([sent, received, answered], "me").map((invite) => invite.id), ["i2"]);
});

// ——— Un solo percorso per gli inviti ricevuti: per account (recipient_user_id), mai per email ———

test("inviti ricevuti: solo quelli legati al mio account, non per email né con codice", () => {
  assert.equal(isReceivedInvite(invite("a"), "bob"), true);
  // Stessa email di un tempo ma nessun legame all'account: non è un invito ricevuto.
  assert.equal(isReceivedInvite(invite("b", { recipientUserId: undefined, recipientEmail: "bob@example.com" }), "bob"), false);
  assert.equal(isReceivedInvite(invite("c", { recipientUserId: "carla" }), "bob"), false);
  // Mandato da me a me stesso (non dovrebbe esistere): non si notifica.
  assert.equal(isReceivedInvite(invite("d", { fromUserId: "bob" }), "bob"), false);
  // Senza account (disconnesso) nessun invito è «mio».
  assert.equal(isReceivedInvite(invite("e", { recipientUserId: "" }), ""), false);
});

test("notifiche inviti: niente per gli inviti di altri membri, con codice o per email", () => {
  const forCarla = invite("carla", { recipientUserId: "carla" });
  const codeOnly = invite("code", { recipientUserId: undefined });
  const byEmail = invite("email", { recipientUserId: undefined, recipientEmail: "bob@example.com" });
  assert.deepEqual(invitesToNotify([forCarla, codeOnly, byEmail, invite("mine")], "bob").map((item) => item.id), ["mine"]);
});

test("merge condiviso: la copia locale di un vecchio invito per email mai legato sparisce", () => {
  const legacy = invite("legacy", { recipientUserId: undefined, recipientEmail: "bob@example.com" });
  const answered = invite("old", { recipientUserId: undefined, recipientEmail: "bob@example.com", status: "declined" });
  const sentByMe = invite("sent", { fromUserId: "bob", recipientUserId: undefined, recipientEmail: "carla@example.com" });
  const local = { ...empty, invites: [legacy, answered, sentByMe] };
  const merged = mergeSharedSnapshot(local, { ...empty, invites: [sentByMe] }, "bob", [], { receivedComplete: true });
  // Il vecchio invito in attesa non si può più accettare: via. La storia e quelli mandati da me restano.
  assert.deepEqual(merged.invites.map((item) => item.id).sort(), ["old", "sent"]);
  assert.equal(isLegacyEmailInvite(legacy, "bob"), true);
  assert.equal(isLegacyEmailInvite(sentByMe, "bob"), false);
  assert.equal(isLegacyEmailInvite(invite("bound", { recipientEmail: "bob@example.com" }), "bob"), false);
});

test("merge condiviso: la migrazione lega l'invito all'account anche se la copia locale sembra più nuova", () => {
  // Orologio del telefono avanti: la copia locale (solo email) ha un timbro più nuovo di quello del server.
  const local = { ...empty, invites: [invite("i1", { recipientUserId: undefined, recipientEmail: "bob@example.com", updatedAt: "2026-12-01T00:00:00.000Z" })] };
  const server = { ...empty, invites: [invite("i1", { recipientEmail: "bob@example.com" })] };
  const merged = mergeSharedSnapshot(local, server, "bob", [], { receivedComplete: true });
  assert.equal(merged.invites.length, 1);
  assert.equal(merged.invites[0].recipientUserId, "bob");
  // Senza novità dal server: stesso array, niente riscritture.
  const again = mergeSharedSnapshot(merged, server, "bob", [], { receivedComplete: true });
  assert.equal(again.invites[0], merged.invites[0]);
});

test("inviti pubblicabili dal client: solo con codice, senza destinatario", () => {
  assert.equal(isCodeOnlyInvite(invite("code", { recipientUserId: undefined })), true);
  assert.equal(isCodeOnlyInvite(invite("person")), false);
  assert.equal(isCodeOnlyInvite(invite("email", { recipientUserId: undefined, recipientEmail: "bob@example.com" })), false);
});

test("cassetta degli inviti: letture, realtime e notifiche per account, mai per email", () => {
  const source = readFileSync(new URL("../src/lib/groupSync.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.eq\("recipient_email"/);
  assert.doesNotMatch(source, /recipient_email=eq\./);
  assert.doesNotMatch(source, /receivedEmail/);
  assert.match(source, /\.eq\("recipient_user_id", me\)/);
  assert.match(source, /filter: `recipient_user_id=eq\.\$\{userId\}`/);
  assert.match(source, /settleInviteNotifications\(state\.notifications, merged\.invites, me,/);
  // Gli inviti a una persona li crea il server: il client non pubblica (né rimette in coda) quelli con un destinatario.
  assert.match(source, /if \(!isCodeOnlyInvite\(invite\)\) return false;/);
  const view = readFileSync(new URL("../src/views/GroupsView.tsx", import.meta.url), "utf8");
  assert.match(view, /isReceivedInvite\(invite, myAccountId\)/);
  assert.doesNotMatch(view, /myEmail/);
  const sheet = readFileSync(new URL("../src/components/GroupInvite.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(sheet, /recipientEmail/);
});

test("gruppi: il canale Realtime ricontrolla anche alla prima iscrizione", () => {
  // Tra il pull fatto prima di aprire il canale e l'iscrizione vera un altro membro può scrivere:
  // senza un controllo al primo SUBSCRIBED quella scrittura resta invisibile fino al prossimo evento.
  const source = readFileSync(new URL("../src/lib/groupSync.ts", import.meta.url), "utf8");
  assert.match(source, /signalGroups\(subscribedOnce \? 0 : undefined\)/);
  assert.doesNotMatch(source, /if \(subscribedOnce\) signalGroups\(0\)/);
});

test("nome visibile agli altri: quello del profilo, altrimenti «Studente», mai dall'email", () => {
  assert.equal(NEUTRAL_MEMBER_NAME, "Studente");
  assert.equal(visibleMemberName("  Anna Rossi "), "Anna Rossi");
  assert.equal(visibleMemberName(""), "Studente");
  assert.equal(visibleMemberName("   "), "Studente");
  assert.equal(visibleMemberName(undefined), "Studente");
  assert.equal(visibleMemberName(null), "Studente");
  assert.equal(visibleMemberName("x".repeat(100)).length, 80);
  // Il fallback è lo stesso del server (studyos_member_name in supabase/groups.sql).
  const sql = readFileSync(new URL("../supabase/groups.sql", import.meta.url), "utf8");
  assert.match(sql, new RegExp(`coalesce\\(v_name, '${NEUTRAL_MEMBER_NAME}'\\)`));
});

test("nessun nome ricavato dall'email nel client: gruppi, inviti e condivisioni", () => {
  // Chi trova qualcuno con il @nome non deve poterne dedurre l'indirizzo dal nome che vede.
  const root = new URL("../src/", import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter((name) => /\.(ts|tsx)$/.test(String(name)));
  assert.ok(files.length > 50);
  for (const name of files) {
    const source = readFileSync(new URL(String(name), root), "utf8");
    assert.doesNotMatch(source, /split\(\s*["']@["']\s*\)/, String(name));
    assert.doesNotMatch(source, /\.indexOf\(\s*["']@["']\s*\)/, String(name));
  }
  const sync = readFileSync(new URL("../src/lib/groupSync.ts", import.meta.url), "utf8");
  assert.match(sync, /const displayName = visibleMemberName\(selectPreferences\(useStudyStore\.getState\(\)\)\.displayName\);/);
  // Accettare un invito manda il nome del profilo (anche vuoto): il server sceglie la riserva, senza email.
  const view = readFileSync(new URL("../src/views/GroupsView.tsx", import.meta.url), "utf8");
  assert.match(view, /await acceptInviteRemote\(invite\.id\)/);
  assert.doesNotMatch(view, /acceptInviteRemote\(invite\.id, actor\.displayName\)/);
});
