import test from "node:test";
import assert from "node:assert/strict";
import {
  dropUnshared,
  grantFromRow,
  grantSignature,
  initialsOf,
  inviteFromRow,
  isMissingSharingObject,
  itemAccess,
  mergeSharedRows,
  missingVisibleKeys,
  ownerColor,
  ownerEntityTypes,
  prepareSharedWrite,
  reconcileOwner,
  scopeCovers,
  shareErrorText,
  shareNotices,
  shareTokenFromText,
  sharedKey,
  sharedPushBatches,
  sharedWriteError,
  typeAccess,
  urlWithoutShare,
  withoutSupersededRows
} from "../src/lib/sharing.ts";
import { SHARE_PERMISSION_LABEL, SHARE_SCOPE_LABEL, scopesSummary } from "../src/lib/labels.ts";

// Stessi casi provati in SQL da scripts/supabase/sharing-check.mjs (studyos_scope_covers).
const COVER_CASES = [
  ["calendar", "calendarEvent", { subjectId: "s1" }, [], true],
  ["calendar", "task", { subjectId: "s1" }, [], false],
  ["calendar", "calendarEvent", { subjectId: "s2" }, ["s1"], false],
  ["calendar", "calendarEvent", {}, ["s1"], false],
  ["barb_exams", "calendarEvent", { sourceUid: "barb-exam-unimi-1" }, [], true],
  ["barb_exams", "calendarEvent", { sourceUid: "ics-123" }, [], false],
  ["barb_exams", "calendarEvent", {}, [], false],
  ["tasks", "task", {}, [], true],
  ["study", "studySession", { subjectId: "s1" }, ["s1"], true],
  ["study", "studyTopic", { subjectId: "s1" }, [], true],
  ["progress", "exam", { subjectId: "s1" }, [], true],
  ["progress", "exam", { grade: 28 }, [], false],
  ["progress", "exam", { grade: null }, [], true],
  ["progress", "exam", { passFail: true }, [], false],
  ["materials", "attachment", { linkedEntityType: "subject", linkedEntityId: "s1" }, ["s1"], true],
  ["materials", "note", { linkedEntityType: "task", linkedEntityId: "s1" }, ["s1"], false],
  ["materials", "note", {}, [], true],
  ["goals", "goal", {}, [], true],
  ["goals", "preferences", {}, [], false]
];

test("copertura: specchio di studyos_scope_covers", () => {
  for (const [scope, type, payload, subjects, expected] of COVER_CASES) {
    assert.equal(scopeCovers(scope, type, payload, subjects), expected, `${scope} ${type} ${JSON.stringify(payload)} ${subjects}`);
  }
});

const grant = (extra) => ({
  id: "g", ownerId: "alice", ownerName: "Alice", scope: "calendar", subjectIds: [], permission: "view",
  granteeUserId: "bob", granteeGroupId: null, granteeName: "Bob", granteeEmail: null, createdAt: "", updatedAt: "", ...extra
});

test("permessi: edit vince, i filtri contano, il tipo ignora i filtri", () => {
  const received = [grant({ id: "1" }), grant({ id: "2", granteeUserId: null, granteeGroupId: "grp", permission: "edit", subjectIds: ["s1"] })];
  assert.equal(itemAccess(received, "alice", "calendarEvent", { subjectId: "s1" }), "edit");
  assert.equal(itemAccess(received, "alice", "calendarEvent", { subjectId: "s2" }), "view");
  assert.equal(itemAccess(received, "alice", "task", {}), null);
  assert.equal(itemAccess(received, "carla", "calendarEvent", {}), null);
  assert.equal(typeAccess(received, "alice", "calendarEvent"), "edit");
  assert.deepEqual([...ownerEntityTypes(received)], [["alice", ["calendarEvent"]]]);
});

const item = (ownerId, entityType, entityId, entity) => ({
  key: sharedKey(ownerId, entityType, entityId), ownerId, entityType, entityId, entity: { id: entityId, updatedAt: "2026-11-10T10:00:00.000Z", ...entity }, serverUpdatedAt: "2026-11-10T10:00:00.000Z"
});

test("merge: LWW, tombstone rimuove, una modifica locale più recente in coda vince", () => {
  const start = [item("alice", "calendarEvent", "e1", { title: "A" }), item("alice", "calendarEvent", "e2", { title: "B", updatedAt: "2026-11-10T12:00:00.000Z" })];
  const pending = new Set([sharedKey("alice", "calendarEvent", "e2")]);
  const merged = mergeSharedRows(start, "alice", [
    { entity_type: "calendarEvent", entity_id: "e1", payload: { id: "e1", title: "A2", updatedAt: "2026-11-10T11:00:00.000Z" }, deleted: false, updated_at: "2026-11-10T11:00:01Z" },
    { entity_type: "calendarEvent", entity_id: "e2", payload: { id: "e2", title: "remote", updatedAt: "2026-11-10T11:00:00.000Z" }, deleted: false, updated_at: "2026-11-10T11:00:01Z" },
    { entity_type: "calendarEvent", entity_id: "e3", payload: { id: "e3", title: "C", updatedAt: "2026-11-10T11:00:00.000Z" }, deleted: false, updated_at: "2026-11-10T11:00:01Z" }
  ], pending);
  assert.deepEqual(merged.map((entry) => entry.entity.title).sort(), ["A2", "B", "C"]);
  const afterDelete = mergeSharedRows(merged, "alice", [{ entity_type: "calendarEvent", entity_id: "e1", payload: { id: "e1", deletedAt: "x" }, deleted: true, updated_at: "z" }], new Set());
  assert.ok(!afterDelete.some((entry) => entry.entityId === "e1"));
});

test("merge: il tombstone ridotto a id e deletedAt si confronta con la modifica in coda", () => {
  const start = [item("alice", "calendarEvent", "e2", { title: "B", updatedAt: "2026-11-10T12:00:00.000Z" })];
  const pending = new Set([sharedKey("alice", "calendarEvent", "e2")]);
  const tombstone = (deletedAt) => [{ entity_type: "calendarEvent", entity_id: "e2", payload: { id: "e2", deletedAt }, deleted: true, updated_at: "z" }];
  // Eliminato prima della mia modifica in coda: la modifica vince e l'elemento resta.
  assert.equal(mergeSharedRows(start, "alice", tombstone("2026-11-10T11:00:00.000Z"), pending).length, 1);
  // Eliminato dopo: l'elemento sparisce anche se in coda c'è una modifica più vecchia.
  assert.equal(mergeSharedRows(start, "alice", tombstone("2026-11-10T13:00:00.000Z"), pending).length, 0);
});

test("riconciliazione: revoche e filtri tolgono, le scritture in coda restano", () => {
  const items = [item("alice", "calendarEvent", "e1"), item("alice", "calendarEvent", "e2"), item("alice", "task", "t1"), item("dario", "goal", "g1")];
  const pending = new Set([sharedKey("alice", "calendarEvent", "e2")]);
  const kept = reconcileOwner(items, "alice", ["calendarEvent"], new Set(["calendarEvent:e1"]), pending);
  assert.deepEqual(kept.map((entry) => entry.entityId).sort(), ["e1", "e2", "g1", "t1"]);
  const shared = dropUnshared(items, [grant({ scope: "calendar" })], new Set());
  assert.deepEqual(shared.map((entry) => entry.entityId).sort(), ["e1", "e2"]);
});

test("scrittura su dati altrui: i collegamenti del proprietario non cambiano", () => {
  const previous = { id: "e1", title: "A", attachmentIds: ["att-alice"], goalId: "goal-alice" };
  const next = prepareSharedWrite(previous, { ...previous, title: "B", attachmentIds: ["att-bob"], goalId: "goal-bob" }, "2026-11-10T12:00:00.000Z");
  assert.deepEqual(next.attachmentIds, ["att-alice"]);
  assert.equal(next.goalId, "goal-alice");
  assert.equal(next.updatedAt, "2026-11-10T12:00:00.000Z");
  const created = prepareSharedWrite(undefined, { id: "e9", title: "Nuovo", attachmentIds: ["att-bob"], goalId: "goal-bob" }, "2026-11-10T12:00:00.000Z");
  assert.deepEqual(created.attachmentIds, []);
  assert.equal(created.goalId, undefined);
  // Un elemento del proprietario senza collegamenti non ne acquista da chi lo modifica.
  const bare = { id: "e2", title: "A" };
  const edited = prepareSharedWrite(bare, { ...bare, attachmentIds: ["att-bob"], goalId: "goal-bob" }, "2026-11-10T12:00:00.000Z");
  assert.ok(!("attachmentIds" in edited) && !("goalId" in edited));
});

test("link di condivisione: token solo esadecimale da 64 caratteri, nel frammento", () => {
  const token = "a".repeat(64);
  assert.equal(shareTokenFromText(token), token);
  assert.equal(shareTokenFromText(`https://x.github.io/StudyOS/#condividi=${token}`), token);
  assert.equal(shareTokenFromText(`https://x.github.io/StudyOS/?condividi=${token}`), token);
  assert.equal(shareTokenFromText(`https://x.github.io/StudyOS/#condividi=${"g".repeat(64)}`), null);
  assert.equal(shareTokenFromText("GRP-AB12-CD34"), null);
  assert.equal(urlWithoutShare(`https://x.github.io/StudyOS/?a=1#condividi=${token}&access_token=t`), "/StudyOS/?a=1#access_token=t");
});

test("righe del server: conversione e nomi leggibili", () => {
  const share = grantFromRow({
    id: "s1", owner_id: "alice", owner_name: "Alice", scope: "calendar", subject_ids: ["x"], permission: "edit",
    grantee_user_id: "bob", grantee_group_id: null, grantee_name: "Bob", grantee_email: "bob@x.it", created_at: "c", updated_at: "u"
  });
  assert.equal(share.permission, "edit");
  assert.deepEqual(share.subjectIds, ["x"]);
  assert.equal(grantFromRow({ ...share, scope: "segreta" }), null);
  const invite = inviteFromRow({
    id: "i1", owner_id: "alice", owner_name: "Alice", status: "pending", expires_at: "2000-01-01T00:00:00Z", created_at: "c", recipient_email: null,
    offers: [{ scope: "calendar", permission: "edit", subject_ids: [], subject_names: [] }, { scope: "nope" }], requests: [{ scope: "calendar", permission: "view" }]
  });
  assert.equal(invite.status, "expired");
  assert.equal(invite.offers.length, 1);
  assert.equal(SHARE_SCOPE_LABEL.barb_exams, "Appelli BARB");
  assert.equal(SHARE_PERMISSION_LABEL.edit, "Può modificare");
  assert.equal(scopesSummary(invite.offers), "Calendario (Può modificare)");
  assert.equal(initialsOf("giulia rossi"), "GR");
  assert.equal(initialsOf("  "), "?");
  assert.equal(ownerColor("alice"), ownerColor("alice"));
});

test("scrittura su dati altrui: stessi controlli di push_shared_rows", () => {
  const received = [grant({ permission: "edit", subjectIds: ["s1"] }), grant({ id: "t", scope: "tasks" })];
  assert.equal(sharedWriteError(received, "alice", "calendarEvent", { subjectId: "s1" }, { subjectId: "s1", title: "x" }), null);
  assert.equal(sharedWriteError(received, "alice", "calendarEvent", undefined, { subjectId: "s1" }), null);
  assert.match(sharedWriteError(received, "alice", "calendarEvent", { subjectId: "s1" }, { subjectId: "s2" }), /uscirebbe/);
  assert.match(sharedWriteError(received, "alice", "task", { title: "t" }, { title: "u" }), /solo vedere/);
  assert.match(sharedWriteError(received, "alice", "goal", undefined, { title: "g" }), /Non puoi aggiungere/);
  assert.match(sharedWriteError(received, "alice", "calendarEvent", undefined, { subjectId: "s2" }), /materia/);
  assert.equal(sharedWriteError(received, "alice", "calendarEvent", { subjectId: "s1" }, null), null);
});

test("coda: lotti per proprietario, tombstone ridotti, voci orfane scartate", () => {
  const items = [item("alice", "calendarEvent", "e1", { title: "A" }), item("dario", "task", "t1", { title: "T" })];
  const outbox = [
    { key: sharedKey("alice", "calendarEvent", "e1"), ownerId: "alice", entityType: "calendarEvent", entityId: "e1", deleted: false, queuedAt: "1" },
    { key: sharedKey("alice", "calendarEvent", "e2"), ownerId: "alice", entityType: "calendarEvent", entityId: "e2", deleted: true, deletedAt: "2026-11-10T12:00:00.000Z", queuedAt: "2" },
    { key: sharedKey("dario", "task", "t1"), ownerId: "dario", entityType: "task", entityId: "t1", deleted: false, queuedAt: "3" },
    { key: sharedKey("alice", "calendarEvent", "gone"), ownerId: "alice", entityType: "calendarEvent", entityId: "gone", deleted: false, queuedAt: "4" }
  ];
  const { batches, orphans } = sharedPushBatches(outbox, items, 1);
  assert.deepEqual(orphans.map((entry) => entry.entityId), ["gone"]);
  assert.deepEqual(batches.map((batch) => [batch.ownerId, batch.rows.length]), [["alice", 1], ["alice", 1], ["dario", 1]]);
  assert.deepEqual(batches[1].rows[0], { entity_type: "calendarEvent", entity_id: "e2", payload: { id: "e2", deletedAt: "2026-11-10T12:00:00.000Z" }, deleted: true });
  assert.equal(batches[0].rows[0].payload.title, "A");
});

test("righe del server: una eliminazione in coda scarta le righe più vecchie, non le più nuove né i tombstone", () => {
  const tombstone = { key: sharedKey("alice", "calendarEvent", "e1"), ownerId: "alice", entityType: "calendarEvent", entityId: "e1", deleted: true, deletedAt: "2026-11-10T12:00:00.000Z", queuedAt: "2026-11-10T12:00:00.000Z" };
  const edit = { key: sharedKey("alice", "calendarEvent", "e2"), ownerId: "alice", entityType: "calendarEvent", entityId: "e2", deleted: false, queuedAt: "2026-11-10T12:00:00.000Z" };
  const live = (id, updatedAt) => ({ entity_type: "calendarEvent", entity_id: id, payload: { id, updatedAt }, deleted: false, updated_at: "z" });
  const rows = [
    live("e1", "2026-11-10T11:00:00.000Z"),
    live("e1", "2026-11-10T13:00:00.000Z"),
    { entity_type: "calendarEvent", entity_id: "e1", payload: { id: "e1", deletedAt: "2026-11-10T11:00:00.000Z" }, deleted: true, updated_at: "z" },
    live("e2", "2026-11-10T11:00:00.000Z"),
    { entity_type: "calendarEvent", entity_id: "e1", payload: { id: "e1" }, deleted: false, updated_at: "z" }
  ];
  const kept = withoutSupersededRows(rows, "alice", [tombstone, edit]);
  assert.deepEqual(kept.map((row) => [row.entity_id, row.payload.updatedAt ?? row.payload.deletedAt ?? null]), [
    ["e1", "2026-11-10T13:00:00.000Z"],
    ["e1", "2026-11-10T11:00:00.000Z"],
    ["e2", "2026-11-10T11:00:00.000Z"]
  ]);
  // Un'eliminazione in coda per un altro proprietario non tocca queste righe; senza tombstone nulla cambia.
  assert.equal(withoutSupersededRows(rows, "dario", [tombstone]).length, rows.length);
  assert.equal(withoutSupersededRows(rows, "alice", [edit]).length, rows.length);
});

test("firma delle condivisioni: cambia con sezioni e materie, non con l'ordine o il permesso", () => {
  const a = [grant({ id: "1", subjectIds: ["b", "a"] }), grant({ id: "2", scope: "tasks" })];
  const b = [grant({ id: "2", scope: "tasks", permission: "edit" }), grant({ id: "1", subjectIds: ["a", "b"] })];
  assert.equal(grantSignature(a, "alice"), grantSignature(b, "alice"));
  assert.notEqual(grantSignature(a, "alice"), grantSignature([grant({ id: "1", subjectIds: ["a"] })], "alice"));
  assert.equal(grantSignature(a, "dario"), "[]");
});

test("cursore saltato: righe visibili sul server ma né in cache né in coda", () => {
  const items = [item("alice", "calendarEvent", "e1"), item("dario", "calendarEvent", "e3")];
  const outbox = [{ key: sharedKey("alice", "calendarEvent", "e2"), ownerId: "alice", entityType: "calendarEvent", entityId: "e2", deleted: true, deletedAt: "x", queuedAt: "x" }];
  const visible = new Set(["calendarEvent:e1", "calendarEvent:e2", "calendarEvent:e3", "task:t1"]);
  // e3 è in cache ma di un altro proprietario: per Alice manca.
  assert.deepEqual(missingVisibleKeys(items, outbox, "alice", visible), ["calendarEvent:e3", "task:t1"]);
  assert.deepEqual(missingVisibleKeys(items, outbox, "alice", new Set(["calendarEvent:e1", "calendarEvent:e2"])), []);
});

test("errori del server in italiano: rete, migrazione mancante, permessi", () => {
  for (const message of ["TypeError: Failed to fetch", "TypeError: Load failed", "AbortError: signal timed out", "TypeError: NetworkError when attempting to fetch resource."]) {
    assert.match(shareErrorText({ message, code: "" }), /non raggiungibile/, message);
  }
  assert.match(shareErrorText({ code: "PGRST205", message: "Could not find the table 'public.studyos_shares' in the schema cache" }), /sharing\.sql/);
  assert.match(shareErrorText({ code: "42501", message: "new row violates row-level security policy" }), /permesso/);
  assert.equal(shareErrorText({ code: "P0001", message: "Invito già usato" }), "Invito già usato");
  assert.equal(isMissingSharingObject({ code: "42883", message: "function public.push_shared_rows does not exist" }), true);
  assert.equal(isMissingSharingObject({ code: "", message: "TypeError: Failed to fetch" }), false);
  assert.equal(isMissingSharingObject(null), false);
});

test("notifiche: solo novità; il silenzio dopo un'accettazione finisce quando la condivisione arriva davvero", () => {
  const pending = (id, owner, status = "pending") => inviteFromRow({ id, owner_id: owner, owner_name: owner, status, expires_at: "2999-01-01T00:00:00Z", offers: [] });
  const received = [grant({ id: "g1" }), grant({ id: "g2", scope: "tasks" }), grant({ id: "g3", ownerId: "dario", ownerName: "Dario" })];
  const invites = [pending("i1", "carla"), pending("i2", "bob"), pending("i3", "carla", "accepted")];
  // Primo controllo sul dispositivo: nessuna raffica, tutto segnato come visto (non i propri inviti).
  const first = shareNotices("bob", received, invites, undefined, new Set());
  assert.deepEqual([first.grants, first.invites], [[], []]);
  assert.deepEqual(first.ids, ["g1", "g2", "g3", "invite-i1"]);
  // Passata partita prima dell'accettazione: la nuova condivisione di Alice non c'è ancora, il silenzio resta.
  const early = shareNotices("bob", [received[0], received[2]], [], ["g1", "g3"], new Set(["alice"]));
  assert.deepEqual([early.grants, early.consumed], [[], []]);
  // La passata che la vede: niente notifica per Alice e il silenzio finisce; Dario e Carla sì.
  const later = shareNotices("bob", received, invites, ["g1"], new Set(["alice"]));
  assert.deepEqual(later.grants.map((entry) => entry.id), ["g3"]);
  assert.deepEqual(later.invites.map((entry) => entry.id), ["i1"]);
  assert.deepEqual(later.consumed, ["alice"]);
});

