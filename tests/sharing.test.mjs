import test from "node:test";
import assert from "node:assert/strict";
import {
  dropUnshared,
  grantFromRow,
  grantSignature,
  initialsOf,
  inviteBlockedReason,
  inviteFromRow,
  isMissingSharingObject,
  itemAccess,
  knownPeople,
  mergeSharedRows,
  missingVisibleKeys,
  ownerColor,
  ownerEntityTypes,
  planShareWrites,
  prepareSharedWrite,
  reconcileOwner,
  scopeCovers,
  sharingProbeOutcome,
  ShareUserError,
  shareActionErrorText,
  shareErrorText,
  shareNotices,
  shareTokenFromText,
  shareableGroups,
  sharedKey,
  sharedPushBatches,
  sharedWriteError,
  typeAccess,
  urlWithoutShare,
  withoutSupersededRows,
  changedFields,
  originOf,
  safeCssColor,
  revisionActorName,
  canRestoreRevision,
  isRestorableEntity,
  shareActionErrorTextSafe,
  SHARED_ENTITY_TYPES,
  REVISION_LIST_LIMIT,
  actorInSentence,
  restoredUpdatedAt,
  barbExamKey,
  linkHostname,
  sharedBarbExams,
  splitSharedBarbExams,
  replaceDatePart,
  shiftedEnd,
  storedDayOf,
  sharedEditResult,
  sharedFieldInput,
  parseSharedField
} from "../src/lib/sharing.ts";
import {
  SHARED_ENTITY_LABEL,
  SHARE_PERMISSION_LABEL,
  SHARE_SCOPE_LABEL,
  revisionListIntro,
  scopesSummary,
  sharedEntityLabel
} from "../src/lib/labels.ts";
import { expandEvents } from "../src/lib/recurrence.ts";

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
  assert.equal(SHARE_SCOPE_LABEL.barb_exams, "Appelli ufficiali");
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

test("errori del server sconosciuti: mai inglese grezzo, passano solo i testi italiani nostri", () => {
  const generic = "Il server ha risposto con un errore. Riprova tra poco.";
  // Eccezioni di sharing.sql (P0001, in italiano): passano così come sono.
  assert.equal(shareErrorText({ code: "P0001", message: "Sezione ripetuta: tasks" }), "Sezione ripetuta: tasks");
  // Qualunque altro errore sconosciuto (infrastruttura, bug) diventa una frase generica in italiano.
  assert.equal(shareErrorText({ code: "PGRST301", message: "JWT expired" }), generic);
  assert.equal(shareErrorText({ code: "XX000", message: "internal error" }), generic);
  assert.equal(shareErrorText({ code: "", message: "permission denied for table studyos_shares" }), generic);
  assert.equal(shareErrorText({ message: "Cannot read properties of undefined (reading 'id')" }), generic);
  // Gli altri casi mappati restano come prima.
  assert.match(shareErrorText({ code: "23505", message: "duplicate key value violates unique constraint" }), /già condivisa/);
  assert.match(shareErrorText({ code: "42501", message: "new row violates row-level security policy" }), /permesso/);
});

test("errori per l'utente: un errore marcato passa uguale, un messaggio sconosciuto non marcato diventa la frase generica", () => {
  const generic = "Il server ha risposto con un errore. Riprova tra poco.";
  // fail() lancia un errore marcato con il testo già in italiano; il ciclo di sync lo ripassa da shareErrorText.
  const friendly = new ShareUserError("Server cloud non raggiungibile: controlla la connessione. I dati condivisi si aggiornano da soli appena torna.");
  assert.ok(friendly instanceof Error);
  assert.equal(friendly.name, "ShareUserError");
  assert.equal(shareErrorText(friendly), friendly.message);
  assert.equal(shareErrorText(new ShareUserError("Sezione ripetuta: tasks")), "Sezione ripetuta: tasks");
  // Lo stesso testo senza marcatura, o un errore inglese qualunque, non passa.
  assert.equal(shareErrorText({ message: "Sezione ripetuta: tasks" }), generic);
  assert.equal(shareErrorText(new Error("Sezione ripetuta: tasks")), generic);
  assert.equal(shareErrorText(new Error("JWT expired")), generic);
  assert.equal(shareErrorText(new TypeError("Cannot read properties of undefined (reading 'id')")), generic);
  // Un errore di rete non marcato (TypeError di fetch) resta riconosciuto come rete.
  assert.match(shareErrorText(new TypeError("Failed to fetch")), /non raggiungibile/);
  // Il testo di un errore marcato arriva intero anche all'azione dell'utente.
  assert.equal(shareActionErrorText("accept", new ShareUserError("Invito già usato")), "Invito non accettato. Invito già usato");
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

test("persone collegate: condivisioni nei due sensi e compagni di gruppo, senza duplicati", () => {
  const given = [grant({ ownerId: "me", granteeUserId: "bob", granteeName: "Bob" })];
  const received = [grant({ ownerId: "alice", ownerName: "Alice", granteeUserId: "me" })];
  const groups = [{
    members: [
      { userId: "me", displayName: "Io" },
      { userId: "bob", displayName: "Roberto" },
      { userId: "carla", displayName: "Carla" },
      { userId: "local-x", displayName: "Solo locale" }
    ]
  }];
  assert.deepEqual(knownPeople("me", given, received, groups).map((person) => [person.userId, person.name, person.via]), [
    ["alice", "Alice", "share"],
    ["bob", "Bob", "share"],
    ["carla", "Carla", "group"]
  ]);
  const online = { ownerId: "owner", sharedAt: "2026-11-01T00:00:00.000Z", members: [{ userId: "me" }] };
  const candidates = [online, { ...online, sharedAt: undefined }, { ...online, ownerId: "local-1" }, { ...online, members: [{ userId: "bob" }] }];
  assert.deepEqual(shareableGroups(candidates, "me"), [online]);
});

test("persone collegate: come studyos_knows_user, contano solo le condivisioni dirette", () => {
  // Chi condivide con un gruppo di cui faccio parte non è "collegato" per questo: la regola del
  // server guarda gli accessi diretti (grantee_user_id) e i gruppi in comune.
  const viaGroup = grant({ ownerId: "dario", ownerName: "Dario", granteeUserId: null, granteeGroupId: "grp" });
  const toGroup = grant({ ownerId: "me", granteeUserId: null, granteeGroupId: "grp", granteeName: "Gruppo" });
  assert.deepEqual(knownPeople("me", [toGroup], [viaGroup], []), []);
  // Revocata ogni condivisione, resta solo chi è nello stesso gruppo.
  assert.deepEqual(
    knownPeople("me", [], [], [{ members: [{ userId: "me", displayName: "Io" }, { userId: "carla", displayName: "" }] }]).map((person) => [person.userId, person.name]),
    [["carla", "Compagno"]]
  );
});

test("errori delle azioni dell'utente: dicono cosa non è stato salvato, senza promettere aggiornamenti automatici", () => {
  const offlineText = shareErrorText({ message: "TypeError: Failed to fetch" });
  assert.match(offlineText, /si aggiornano da soli/);
  const offline = new Error(offlineText);
  assert.equal(shareActionErrorText("invite", offline), "Invito non creato. Server cloud non raggiungibile: controlla la connessione. Riprova appena torna.");
  assert.equal(shareActionErrorText("share", offline), "Condivisione non salvata. Server cloud non raggiungibile: controlla la connessione. Riprova appena torna.");
  assert.equal(shareActionErrorText("share", new Error("Invito già usato")), "Condivisione non salvata. Invito già usato");
  assert.equal(shareActionErrorText("invite", "non è un Error"), "Invito non creato. Riprova tra poco.");
});

test("errori delle azioni: anche il caricamento di un pezzo dell'app fallito parla di connessione, in italiano", () => {
  const network = "Server cloud non raggiungibile: controlla la connessione. Riprova appena torna.";
  for (const message of [
    "Failed to fetch dynamically imported module: https://x.github.io/StudyOS/assets/ShareDrawer-abc.js",
    "error loading dynamically imported module: https://x.github.io/StudyOS/assets/ShareDrawer-abc.js",
    "Importing a module script failed.",
    "TypeError: Failed to fetch",
    "Load failed"
  ]) {
    assert.equal(shareActionErrorText("invite", new TypeError(message)), `Invito non creato. ${network}`, message);
  }
});

test("errori delle azioni della sezione Condivisione: ogni azione dice cosa non è andato a buon fine, in italiano", () => {
  const network = "Server cloud non raggiungibile: controlla la connessione. Riprova appena torna.";
  const prefixes = {
    accept: "Invito non accettato.",
    decline: "Invito non rifiutato.",
    cancel: "Invito non annullato.",
    update: "Permessi non aggiornati.",
    revoke: "Condivisione non tolta.",
    leave: "Non sei uscito dalla condivisione.",
    open: "Invito non aperto.",
    history: "Cronologia non caricata.",
    restore: "Ripristino non riuscito."
  };
  for (const [action, prefix] of Object.entries(prefixes)) {
    assert.equal(shareActionErrorText(action, new TypeError("Failed to fetch")), `${prefix} ${network}`, action);
    assert.equal(shareActionErrorText(action, new Error("Invito già usato")), `${prefix} Invito già usato`, action);
    assert.equal(shareActionErrorText(action, "non è un Error"), `${prefix} Riprova tra poco.`, action);
  }
});

test("invito aperto da link: quando non si può rispondere (e il link salvato va tolto)", () => {
  const open = { status: "pending", isOwn: false, forOtherAccount: false };
  assert.equal(inviteBlockedReason(open), null);
  // Il server non conosce il link (sbagliato o invito annullato).
  assert.equal(inviteBlockedReason(null), "invalid");
  assert.equal(inviteBlockedReason({ ...open, isOwn: true }), "own");
  assert.equal(inviteBlockedReason({ ...open, forOtherAccount: true }), "otherAccount");
  for (const status of ["accepted", "declined", "expired"]) assert.equal(inviteBlockedReason({ ...open, status }), status);
  // L'invito proprio e quello per un altro indirizzo hanno la precedenza sullo stato.
  assert.equal(inviteBlockedReason({ status: "accepted", isOwn: true, forOtherAccount: false }), "own");
  assert.equal(inviteBlockedReason({ status: "declined", isOwn: false, forOtherAccount: true }), "otherAccount");
});

test("sonda della migrazione: solo un oggetto mancante vale 'non attiva', un errore di rete resta incerto", () => {
  assert.equal(sharingProbeOutcome(null), "available");
  assert.equal(sharingProbeOutcome({ code: "PGRST205", message: "Could not find the table 'public.studyos_shares' in the schema cache" }), "missing");
  assert.equal(sharingProbeOutcome({ code: "42P01", message: 'relation "studyos_shares" does not exist' }), "missing");
  assert.equal(sharingProbeOutcome({ message: "TypeError: Failed to fetch" }), "failed");
  assert.equal(sharingProbeOutcome({ code: "PGRST301", message: "JWT expired" }), "failed");
});

test("condivisione già presente: una sezione doppia dà una frase chiara, non l'errore grezzo del database", () => {
  const text = shareErrorText({ code: "23505", message: 'duplicate key value violates unique constraint "studyos_shares_grantee_key"' });
  assert.equal(text, "Questa sezione è già condivisa con questa persona o questo gruppo.");
});

test("condividere con una persona: le sezioni nuove si creano insieme, quelle già condivise si aggiornano", () => {
  const given = [
    grant({ id: "g1", ownerId: "me", scope: "calendar", granteeUserId: "bob" }),
    grant({ id: "g2", ownerId: "me", scope: "tasks", granteeUserId: null, granteeGroupId: "grp" }),
    grant({ id: "g3", ownerId: "me", scope: "study", granteeUserId: "carla" })
  ];
  const offer = (scope) => ({ scope, permission: "edit", subjectIds: [], subjectNames: [] });
  const plan = planShareWrites(given, { userId: "bob" }, [offer("calendar"), offer("tasks"), offer("study")]);
  assert.deepEqual(plan.update.map((entry) => [entry.id, entry.offer.scope]), [["g1", "calendar"]]);
  assert.deepEqual(plan.create.map((entry) => entry.scope), ["tasks", "study"]);
  // Per un gruppo conta solo la condivisione con quel gruppo.
  const forGroup = planShareWrites(given, { groupId: "grp" }, [offer("calendar"), offer("tasks")]);
  assert.deepEqual(forGroup.update.map((entry) => entry.id), ["g2"]);
  assert.deepEqual(forGroup.create.map((entry) => entry.scope), ["calendar"]);
});

test("expandEvents conserva i campi extra (sharedFrom) anche sulle occorrenze ripetute", () => {
  const base = {
    id: "e1", createdAt: "", updatedAt: "", archived: false, tags: [], title: "Lezione", description: "", category: "lecture",
    color: "#fff", priority: "medium", start: "2026-11-09T09:00:00.000Z", end: "2026-11-09T10:00:00.000Z", recurrence: "daily",
    status: "planned", checklist: [], attachmentIds: [], notes: "", links: []
  };
  const found = expandEvents([{ ...base, sharedFrom: { ownerId: "alice" } }], new Date("2026-11-10T00:00:00Z"), new Date("2026-11-12T00:00:00Z"));
  assert.equal(found.length, 2);
  assert.ok(found.every((item) => item.sharedFrom?.ownerId === "alice" && item.recurring));
});

test("safeCssColor: dai dati altrui passano solo colori esadecimali, mai url() o altre dichiarazioni", () => {
  for (const color of ["#abc", "#ABCD", "#a1b2c3", "#A1B2C3D4"]) assert.equal(safeCssColor(color), color);
  assert.equal(safeCssColor("  #7CF7C8 "), "#7CF7C8");
  for (const color of [
    'url("https://tracker.example/p.png")',
    "url(https://tracker.example/p.png)",
    "red; background-image: url(https://tracker.example/p.png)",
    "#fff; background-image: url(x)",
    "var(--x)",
    "image-set(\"https://tracker.example/p.png\" 1x)",
    "red",
    "#ab",
    "#abcde",
    "#ggg",
    ""
  ]) assert.equal(safeCssColor(color), "", color);
  for (const value of [undefined, null, 42, {}, ["#fff"], true]) assert.equal(safeCssColor(value), "");
});

test("originOf: il colore della materia altrui passa da safeCssColor", () => {
  const received = [{ id: "g", ownerId: "alice", ownerName: "Alice", scope: "calendar", permission: "view", subjectIds: [], subjectNames: [] }];
  const entry = (subjectId) => ({ key: "k", ownerId: "alice", entityType: "calendarEvent", entityId: "e1", entity: { id: "e1", subjectId }, serverUpdatedAt: "" });
  const labels = [
    { ownerId: "alice", id: "s1", name: "Anatomia", color: 'url("https://tracker.example/p.png")', icon: "" },
    { ownerId: "alice", id: "s2", name: "Chimica", color: "#F472B6", icon: "" }
  ];
  const tainted = originOf(received, entry("s1"), labels);
  assert.equal(tainted.subjectName, "Anatomia");
  assert.equal(tainted.subjectColor, undefined);
  assert.equal(originOf(received, entry("s2"), labels).subjectColor, "#F472B6");
});

test("changedFields: solo i campi cambiati (per valore), e i gruppi legati vanno insieme", () => {
  const before = { title: "Lezione", description: "", start: "a", end: "b", allDay: false, tags: ["x"], recurrence: "weekly", recurrenceUntil: "2026-12-01" };
  assert.deepEqual(changedFields(before, { ...before, tags: ["x"] }), {});
  assert.deepEqual(changedFields(before, { ...before, description: "Aula 3" }), { description: "Aula 3" });
  // Un campo tolto (undefined) è un cambiamento: la chiave resta, così sovrascrive il valore precedente.
  const cleared = changedFields(before, { ...before, recurrence: "none", recurrenceUntil: undefined });
  assert.deepEqual(Object.keys(cleared).sort(), ["recurrence", "recurrenceUntil"]);
  assert.equal(cleared.recurrenceUntil, undefined);
  // Con un gruppo (orari): cambia la fine, si mandano anche inizio e "tutto il giorno".
  const groups = [["start", "end", "allDay"], ["recurrence", "recurrenceUntil"]];
  assert.deepEqual(changedFields(before, { ...before, end: "c" }, groups), { start: "a", end: "c", allDay: false });
  assert.deepEqual(changedFields(before, { ...before, title: "Nuovo" }, groups), { title: "Nuovo" });
});

test("cronologia: nome di chi ha modificato da condivisioni e gruppi, mai l'id", () => {
  const given = [grant({ ownerId: "me", granteeUserId: "bob", granteeName: "Bob" })];
  const groups = [{ members: [{ userId: "carla", displayName: "Carla" }] }];
  assert.equal(revisionActorName("bob", given, groups), "Bob");
  assert.equal(revisionActorName("carla", given, groups), "Carla");
  assert.equal(revisionActorName("sconosciuto", given, groups), "Un'altra persona");
  assert.equal(revisionActorName(null, given, groups), "Un'altra persona");
});

test("cronologia: senza un nome da mostrare non compare mai l'id o l'email dell'account", () => {
  const given = [grant({ granteeUserId: "u-9f1c", granteeName: "", granteeEmail: "bob@example.com" })];
  const groups = [{ members: [{ userId: "u-77aa", displayName: "" }] }];
  assert.equal(revisionActorName("u-9f1c", given, groups), "Un'altra persona");
  assert.equal(revisionActorName("u-77aa", given, groups), "Un'altra persona");
});

test("cronologia: ogni tipo condivisibile ha un'etichetta in italiano", () => {
  for (const type of SHARED_ENTITY_TYPES) assert.ok(SHARED_ENTITY_LABEL[type], type);
  assert.deepEqual([...SHARED_ENTITY_TYPES].sort(), ["attachment", "calendarEvent", "exam", "goal", "note", "studySession", "studyTopic", "task"]);
});

test("ripristino: solo elementi veri di un tipo condivisibile, con un id", () => {
  const event = { id: "e1", title: "Lezione", updatedAt: "2026-11-10T10:00:00.000Z" };
  assert.equal(isRestorableEntity("calendarEvent", event), true);
  for (const type of SHARED_ENTITY_TYPES) assert.equal(isRestorableEntity(type, { id: "x1" }), true, type);
  // Tipi personali che la condivisione non copre: mai (preferenze, notifiche, gruppi, materie, tag…).
  for (const type of ["preferences", "notification", "studyGroup", "groupInvite", "groupResource", "groupActivity", "subject", "tag", "reminder", "widget", "", "nope"]) {
    assert.equal(isRestorableEntity(type, event), false, type);
  }
  // Chiavi di Object.prototype non sono tipi.
  for (const type of ["constructor", "__proto__", "toString", "hasOwnProperty"]) assert.equal(isRestorableEntity(type, event), false, type);
  // Senza un id testuale non vuoto, o con un contenuto che non è un oggetto, non si scrive niente.
  for (const payload of [{}, { id: "" }, { id: "   " }, { id: 7 }, { id: null }, { id: ["e1"] }, null, undefined, "e1", 5, ["e1"]]) {
    assert.equal(isRestorableEntity("calendarEvent", payload), false, JSON.stringify(payload));
  }
  // L'id deve essere quello dell'elemento, se noto: una versione non può sovrascriverne un altro.
  assert.equal(isRestorableEntity("calendarEvent", event, "e1"), true);
  assert.equal(isRestorableEntity("calendarEvent", event, "e2"), false);
});

test("ripristino: una cronologia si ripristina se è una versione precedente intera, non una creazione né un'eliminazione già registrata", () => {
  const base = { id: 1, entityType: "calendarEvent", entityId: "e1", payload: { id: "e1", title: "Lezione" }, deleted: false, change: "update", changedBy: "bob", changedAt: "2026-11-10T10:00:00.000Z" };
  assert.equal(canRestoreRevision(base), true);
  assert.equal(canRestoreRevision({ ...base, change: "delete" }), true);
  // Una creazione non ha una versione precedente da recuperare.
  assert.equal(canRestoreRevision({ ...base, change: "create" }), false);
  // Il contenuto di una riga già eliminata è solo un tombstone, non un elemento.
  assert.equal(canRestoreRevision({ ...base, deleted: true }), false);
  assert.equal(canRestoreRevision({ ...base, payload: { id: "e1", deletedAt: "2026-11-09T10:00:00.000Z" } }), false);
  // Il contenuto scritto da altri non può puntare a un altro elemento o a un tipo non condivisibile.
  assert.equal(canRestoreRevision({ ...base, payload: { id: "e2", title: "Altro" } }), false);
  assert.equal(canRestoreRevision({ ...base, entityType: "preferences", payload: { id: "e1" } }), false);
});

test("errori della cronologia: un guasto tecnico non mostra mai il suo testo (in inglese)", () => {
  const network = "Server cloud non raggiungibile: controlla la connessione. Riprova appena torna.";
  // Testi pensati per l'utente e problemi di rete passano come nelle altre azioni.
  assert.equal(shareActionErrorTextSafe("restore", new ShareUserError("Questo elemento non si può ripristinare.")), "Ripristino non riuscito. Questo elemento non si può ripristinare.");
  assert.equal(shareActionErrorTextSafe("history", new ShareUserError("Accedi al tuo account per usare la condivisione.")), "Cronologia non caricata. Accedi al tuo account per usare la condivisione.");
  assert.equal(shareActionErrorTextSafe("history", new TypeError("Failed to fetch dynamically imported module: https://x/y.js")), `Cronologia non caricata. ${network}`);
  // Un errore qualunque (bug, infrastruttura) resta generico.
  assert.equal(shareActionErrorTextSafe("restore", new TypeError("Cannot read properties of undefined (reading 'id')")), "Ripristino non riuscito. Riprova tra poco.");
  assert.equal(shareActionErrorTextSafe("history", "non è un Error"), "Cronologia non caricata. Riprova tra poco.");
});

test("cronologia: chi ha modificato si legge bene anche in mezzo a una frase", () => {
  // In testa alla riga resta "Un'altra persona"; dopo "che" o "di" va in minuscolo.
  assert.equal(actorInSentence(revisionActorName(null, [], [])), "un'altra persona");
  assert.equal(actorInSentence("Un'altra persona"), "un'altra persona");
  // I nomi veri non si toccano, nemmeno se iniziano in minuscolo.
  assert.equal(actorInSentence("Bob"), "Bob");
  assert.equal(actorInSentence("de Rossi"), "de Rossi");
  assert.equal(revisionActorName(null, [], []), "Un'altra persona");
});

test("cronologia: l'etichetta del tipo non pesca dai nomi di Object.prototype", () => {
  assert.equal(sharedEntityLabel("calendarEvent"), "evento");
  assert.equal(sharedEntityLabel("task"), "attività");
  for (const type of ["preferences", "", "nope", "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(sharedEntityLabel(type), "elemento", type);
  }
});

test("cronologia: l'intestazione non promette più di quanto mostra", () => {
  assert.equal(REVISION_LIST_LIMIT, 100);
  const partial = revisionListIntro(7, REVISION_LIST_LIMIT);
  assert.match(partial, /90 giorni/);
  assert.doesNotMatch(partial, /100/);
  // Con la lista piena le più vecchie possono mancare: lo dice, col numero giusto.
  const full = revisionListIntro(REVISION_LIST_LIMIT, REVISION_LIST_LIMIT);
  assert.match(full, /ultime 100/i);
  assert.match(full, /90 giorni/);
  assert.match(full, /Ripristina/);
  assert.match(partial, /Ripristina/);
});

test("ripristino: l'updatedAt non è mai più vecchio della copia locale (orologio dell'altra persona avanti)", () => {
  const now = "2026-11-10T16:00:00.000Z";
  // Nessuna copia locale (eliminata da altri): vale l'ora attuale, com'è.
  assert.equal(restoredUpdatedAt(now, undefined), now);
  assert.equal(restoredUpdatedAt(now, ""), now);
  assert.equal(restoredUpdatedAt(now, "non è una data"), now);
  // La copia locale è più vecchia: vale l'ora attuale.
  assert.equal(restoredUpdatedAt(now, "2026-11-10T15:00:00.000Z"), now);
  // Stesso istante: un millisecondo dopo, altrimenti non vince per LWW.
  assert.equal(restoredUpdatedAt(now, now), "2026-11-10T16:00:00.001Z");
  // L'altra persona ha l'orologio avanti: un millisecondo dopo la sua modifica.
  assert.equal(restoredUpdatedAt(now, "2026-11-10T18:30:15.250Z"), "2026-11-10T18:30:15.251Z");
  assert.ok(Date.parse(restoredUpdatedAt(now, "2026-11-10T18:30:15.250Z")) > Date.parse("2026-11-10T18:30:15.250Z"));
});

test("appelli condivisi: solo barb-exam-*, uniti per appello e giorno, con il segno 'anche tu'", () => {
  const exam = (owner, id, uid, start) => item(owner, "calendarEvent", id, { title: `Appello ${uid}`, sourceUid: uid, start, links: ["https://unimi.it/x"] });
  const rows = sharedBarbExams(
    [
      exam("alice", "a1", "barb-exam-unimi-2", "2026-12-10T00:00"),
      exam("dario", "d1", "barb-exam-unimi-2", "2026-12-10T00:00"),
      exam("alice", "a2", "barb-exam-unimi-1", "2026-11-20T00:00"),
      item("alice", "calendarEvent", "a3", { title: "Lezione", sourceUid: "ics-1", start: "2026-11-11T09:00" }),
      item("alice", "task", "t1", { title: "x", sourceUid: "barb-exam-unimi-9" })
    ],
    new Set([barbExamKey("barb-exam-unimi-2", "2026-12-10T00:00:00")])
  );
  assert.deepEqual(rows.map((row) => [row.sourceUid, row.ownerIds, row.mine]), [
    ["barb-exam-unimi-1", ["alice"], false],
    ["barb-exam-unimi-2", ["alice", "dario"], true]
  ]);
  assert.equal(rows[0].link, "https://unimi.it/x");
  assert.equal(barbExamKey("barb-exam-unimi-2", "2026-12-10T09:30:00"), "barb-exam-unimi-2|2026-12-10");
});

test("appelli condivisi: lo stesso appello spostato è una riga a parte e 'anche tu' vale solo per il mio giorno", () => {
  const exam = (owner, id, start) => item(owner, "calendarEvent", id, { title: "Appello Anatomia", sourceUid: "barb-exam-unimi-7", start, links: ["https://unimi.it/a"] });
  const items = [exam("dario", "d1", "2026-12-10T00:00:00"), exam("alice", "a1", "2026-12-15T00:00:00"), exam("carla", "c1", "2026-12-10T09:30:00")];
  const mine = new Set(["barb-exam-unimi-7|2026-12-10"]);
  const shape = (rows) => rows.map((row) => [row.start.slice(0, 10), [...row.ownerIds].sort(), row.mine]);
  const expected = [
    ["2026-12-10", ["carla", "dario"], true],
    ["2026-12-15", ["alice"], false]
  ];
  assert.deepEqual(shape(sharedBarbExams(items, mine)), expected);
  // L'ordine in cui arrivano gli elementi non decide quale data compare accanto a quale nome.
  assert.deepEqual(shape(sharedBarbExams([...items].reverse(), mine)), expected);
  // Se nel mio calendario c'è un altro giorno, nessuna riga porta il segno.
  assert.deepEqual(sharedBarbExams(items, new Set(["barb-exam-unimi-7|2026-12-11"])).map((row) => row.mine), [false, false]);
});

test("appelli condivisi: stesso proprietario due volte, data mancante, link non validi, titolo mancante", () => {
  const ev = (owner, id, entity) => item(owner, "calendarEvent", id, { sourceUid: "barb-exam-unimi-3", ...entity });
  const rows = sharedBarbExams(
    [
      ev("alice", "a1", { title: "Appello A", start: "2026-12-01T00:00:00", links: [42, null, "javascript:alert(1)", {}] }),
      ev("alice", "a2", { title: "Secondo", start: "2026-12-01T00:00:00" }),
      ev("dario", "d1", { title: "Appello B", start: "2026-12-01T00:00:00", links: ["https://unimi.it/ok"] }),
      ev("dario", "d2", { sourceUid: "barb-exam-unimi-4", title: "Senza data" }),
      ev("carla", "c1", { sourceUid: "barb-exam-unimi-4", start: "non è una data" }),
      ev("alice", "a3", { sourceUid: "barb-exam-unimi-5", start: 123, title: "" })
    ],
    new Set()
  );
  assert.deepEqual(
    rows.map((row) => [row.sourceUid, row.title, row.start, row.ownerIds, row.link]),
    [
      // Lo stesso proprietario due volte conta una sola volta; il primo link sicuro tra tutti vince.
      ["barb-exam-unimi-3", "Appello A", "2026-12-01T00:00:00", ["alice", "dario"], "https://unimi.it/ok"],
      // Senza data valida: in coda, e uniti tra loro.
      ["barb-exam-unimi-4", "Senza data", "", ["dario", "carla"], undefined],
      ["barb-exam-unimi-5", "Appello", "", ["alice"], undefined]
    ]
  );
});

test("appelli condivisi: in arrivo e passati dal giorno locale, senza data tra quelli in arrivo, passati dal più recente", () => {
  const row = (uid, start) => ({ sourceUid: uid, title: "t", start, ownerIds: ["alice"], mine: false });
  const { upcoming, past } = splitSharedBarbExams(
    [
      row("a", "2026-11-08T00:00:00"),
      row("b", "2026-11-09T23:59:00"),
      row("c", "2026-11-10T00:00:00"),
      row("d", "2026-11-10T23:59:00"),
      row("e", "2026-11-11T00:00:00"),
      row("f", ""),
      row("g", "2026-02-31T00:00:00")
    ],
    "2026-11-10"
  );
  assert.deepEqual(past.map((entry) => entry.sourceUid), ["b", "a"]);
  assert.deepEqual(upcoming.map((entry) => entry.sourceUid), ["c", "d", "e", "f", "g"]);
});

test("link degli appelli: si mostra il dominio vero, mai un nome ufficiale scelto da chi condivide", () => {
  assert.equal(linkHostname("https://www.unimi.it/ecm/x?y=1"), "unimi.it");
  assert.equal(linkHostname("https://exam.evil.example/unimi.it"), "exam.evil.example");
  assert.equal(linkHostname("mailto:a@b.it"), undefined);
  assert.equal(linkHostname("non un url"), undefined);
});

test("date nei dati altrui: si cambia il giorno, il formato originale resta", () => {
  assert.equal(replaceDatePart("2026-11-10T09:00:00.000Z", "2026-12-01"), "2026-12-01T09:00:00.000Z");
  assert.equal(replaceDatePart("2026-11-10", "2026-12-01"), "2026-12-01");
  assert.equal(replaceDatePart(undefined, "2026-12-01"), "2026-12-01");
  assert.equal(replaceDatePart("2026-11-10", ""), undefined);
  const session = { start: "2026-11-10T09:00:00.000Z", end: "2026-11-10T10:30:00.000Z" };
  assert.equal(shiftedEnd(session, "2026-11-11T08:00:00.000Z"), "2026-11-11T09:30:00.000Z");
  assert.equal(shiftedEnd({ start: "2026-11-10T09:00:00.000Z" }, "2026-11-11T08:00:00.000Z"), undefined);
});

test("date nei dati altrui: il giorno è quello locale e l'ora locale resta, in qualunque fuso", () => {
  // Mezzanotte e mezza locale: in UTC è il giorno prima, ma per chi guarda è il 10.
  const original = new Date(2026, 10, 10, 0, 30).toISOString();
  assert.equal(storedDayOf(original), "2026-11-10");
  const moved = new Date(replaceDatePart(original, "2026-12-01"));
  assert.deepEqual([moved.getFullYear(), moved.getMonth(), moved.getDate(), moved.getHours(), moved.getMinutes()], [2026, 11, 1, 0, 30]);
  // Un giorno solo (senza ora) è già il giorno; dati altrui illeggibili non producono date inventate.
  assert.equal(storedDayOf("2026-11-10"), "2026-11-10");
  assert.equal(storedDayOf(undefined), "");
  assert.equal(storedDayOf("non una data"), "");
  assert.equal(storedDayOf(12345), "");
  assert.equal(replaceDatePart("non una data, ma lunga", "2026-12-01"), "2026-12-01");
  assert.equal(replaceDatePart("2026-11-10T09:00:00.000Z", "2026-02-31"), undefined);
  assert.equal(replaceDatePart("2026-11-10T09:00:00.000Z", "2026-13-01"), undefined);
});

test("campi del dettaglio altrui: i dati arrivano da chiunque, il modulo non si fida del tipo", () => {
  assert.equal(sharedFieldInput("text", 42), "");
  assert.equal(sharedFieldInput("text", "Ciao"), "Ciao");
  assert.equal(sharedFieldInput("number", "7"), "");
  assert.equal(sharedFieldInput("number", Number.NaN), "");
  assert.equal(sharedFieldInput("number", 7), "7");
  assert.equal(sharedFieldInput("date", "2026-11-10"), "2026-11-10");
  assert.equal(sharedFieldInput("date", { toString: () => "2026-11-10" }), "");
  // Un anno a cinque cifre o un testo qualunque non è una data da mostrare (e non rompe la vista).
  assert.equal(sharedFieldInput("datetime", "275760-09-13T00:00:00Z"), "");
  assert.equal(sharedFieldInput("datetime", "12345"), "");
  const local = new Date(2026, 10, 10, 9, 5);
  assert.equal(sharedFieldInput("datetime", local.toISOString()), "2026-11-10T09:05");
  assert.equal(sharedFieldInput("date", local.toISOString()), "2026-11-10");
});

test("campi del dettaglio altrui: obbligatori non si svuotano, facoltativi si tolgono, numeri nei limiti", () => {
  assert.deepEqual(parseSharedField({ kind: "text", required: true }, "  Titolo  ", ""), { value: "Titolo" });
  assert.equal(parseSharedField({ kind: "text", required: true }, "   ", "Prima"), null);
  assert.deepEqual(parseSharedField({ kind: "text" }, "   ", "Prima"), { value: "" });
  assert.deepEqual(parseSharedField({ kind: "textarea" }, "  a\nb ", ""), { value: "  a\nb " });
  assert.equal(parseSharedField({ kind: "datetime", required: true }, "", "2026-11-10T09:00:00.000Z"), null);
  assert.deepEqual(parseSharedField({ kind: "datetime" }, "", "2026-11-10T09:00:00.000Z"), { value: undefined });
  assert.equal(parseSharedField({ kind: "datetime" }, "non una data", undefined), null);
  assert.deepEqual(parseSharedField({ kind: "datetime" }, "2026-11-10T09:00", undefined), { value: new Date("2026-11-10T09:00").toISOString() });
  assert.equal(parseSharedField({ kind: "date", required: true }, "", "2026-11-10"), null);
  assert.deepEqual(parseSharedField({ kind: "date" }, "", "2026-11-10"), { value: undefined });
  assert.deepEqual(parseSharedField({ kind: "date" }, "2026-12-01", "2026-11-10"), { value: "2026-12-01" });
  assert.equal(parseSharedField({ kind: "date" }, "2026-02-30", "2026-11-10"), null);
  const percent = { kind: "number", min: 0, max: 100 };
  assert.deepEqual(parseSharedField(percent, "150", 10), { value: 100 });
  assert.deepEqual(parseSharedField(percent, "-5", 10), { value: 0 });
  assert.deepEqual(parseSharedField(percent, "42.6", 10), { value: 43 });
  assert.equal(parseSharedField(percent, "", 10), null);
  assert.equal(parseSharedField(percent, "abc", 10), null);
  assert.deepEqual(parseSharedField({ kind: "select" }, "done", "todo"), { value: "done" });
});

test("modifica di un elemento altrui: solo i campi cambiati, sopra l'ultima versione", () => {
  const opened = { id: "t1", title: "Studiare", notes: "", status: "todo", dueDate: "2026-11-10T09:00:30.000Z", updatedAt: "a" };
  // Nel frattempo il proprietario ha cambiato le note e l'orario di aggiornamento.
  const latest = { ...opened, notes: "dal proprietario", updatedAt: "b" };
  assert.deepEqual(sharedEditResult("task", opened, { title: "Studiare di più" }, latest), { ...latest, title: "Studiare di più" });
  // Niente di cambiato: niente da scrivere.
  assert.equal(sharedEditResult("task", opened, {}, latest), null);
  assert.equal(sharedEditResult("task", opened, { title: "Studiare" }, latest), null);
  // Un campo non toccato resta com'era anche se la conversione dal modulo lo avrebbe arrotondato.
  assert.equal(sharedEditResult("task", opened, { notes: "mie" }, latest).dueDate, "2026-11-10T09:00:30.000Z");
});

test("modifica di un'attività altrui: stato e completamento viaggiano insieme", () => {
  const todo = { id: "t1", title: "x", status: "todo" };
  const done = sharedEditResult("task", todo, { status: "done" }, todo, "2026-11-10T12:00:00.000Z");
  assert.deepEqual(done, { ...todo, status: "done", completedAt: "2026-11-10T12:00:00.000Z", timerStartedAt: undefined, timerLastReminderAt: undefined });
  // Già completata nel frattempo dal proprietario: il suo orario di completamento resta.
  const meanwhile = { ...todo, status: "done", completedAt: "2026-11-10T11:00:00.000Z" };
  assert.equal(sharedEditResult("task", todo, { status: "done" }, meanwhile, "2026-11-10T12:00:00.000Z").completedAt, "2026-11-10T11:00:00.000Z");
  // Riaperta: il completamento si toglie.
  const reopened = sharedEditResult("task", meanwhile, { status: "todo" }, meanwhile);
  assert.equal(reopened.status, "todo");
  assert.equal(reopened.completedAt, undefined);
  assert.ok("completedAt" in reopened);
});

test("modifica di un'attività altrui: lo stato chiude il cronometro del proprietario come nella sua app", () => {
  const started = "2026-11-10T11:55:00.000Z";
  const now = "2026-11-10T12:00:00.000Z";
  // Cronometro in corso: 10 minuti già contati più 5 da quando è partito.
  const running = { id: "t1", title: "x", status: "doing", timerStartedAt: started, timerAccumulatedSeconds: 600, timerLastReminderAt: started };
  const done = sharedEditResult("task", running, { status: "done" }, running, now);
  assert.equal(done.status, "done");
  assert.equal(done.timerStartedAt, undefined);
  assert.equal(done.timerAccumulatedSeconds, 900);
  assert.equal(done.actualMinutes, 15);
  assert.equal(done.timerLastReminderAt, undefined);
  assert.equal(done.completedAt, now);
  // Anche uscire da "in corso" verso un altro stato chiude il cronometro, senza completare.
  for (const status of ["todo", "blocked"]) {
    const left = sharedEditResult("task", running, { status }, running, now);
    assert.equal(left.status, status);
    assert.equal(left.timerStartedAt, undefined);
    assert.equal(left.timerAccumulatedSeconds, 900);
    assert.equal(left.actualMinutes, 15);
    assert.equal(left.completedAt, undefined);
  }
  // Il cronometro si legge dall'ultima versione: partito dal proprietario dopo l'apertura del dettaglio.
  const openedTodo = { id: "t1", title: "x", status: "todo" };
  const lateStop = sharedEditResult("task", openedTodo, { status: "blocked" }, running, now);
  assert.equal(lateStop.timerStartedAt, undefined);
  assert.equal(lateStop.timerAccumulatedSeconds, 900);
  // Una modifica che non tocca lo stato lascia il cronometro com'è.
  const titleOnly = sharedEditResult("task", running, { title: "y" }, running, now);
  assert.deepEqual(titleOnly, { ...running, title: "y" });
});

test("modifica di una sessione altrui: spostare l'inizio sposta la fine, stessa durata", () => {
  const opened = { id: "s1", title: "x", start: "2026-11-10T09:00:00.000Z", end: "2026-11-10T10:30:00.000Z", notes: "" };
  const result = sharedEditResult("studySession", opened, { start: "2026-11-11T08:00:00.000Z" }, opened);
  assert.equal(result.start, "2026-11-11T08:00:00.000Z");
  assert.equal(result.end, "2026-11-11T09:30:00.000Z");
  // La durata è quella dell'ultima versione: il proprietario ha allungato la sessione nel frattempo.
  const longer = { ...opened, end: "2026-11-10T11:00:00.000Z" };
  const moved = sharedEditResult("studySession", opened, { start: "2026-11-11T08:00:00.000Z" }, longer);
  assert.equal(moved.start, "2026-11-11T08:00:00.000Z");
  assert.equal(moved.end, "2026-11-11T10:00:00.000Z");
  // Se cambiano solo le note, inizio e fine non si toccano: restano quelli del proprietario.
  const elsewhere = { ...opened, start: "2026-11-12T09:00:00.000Z", end: "2026-11-12T10:30:00.000Z" };
  const notes = sharedEditResult("studySession", opened, { notes: "ok" }, elsewhere);
  assert.deepEqual([notes.start, notes.end, notes.notes], [elsewhere.start, elsewhere.end, "ok"]);
});

test("modifica di un elemento altrui: un tipo sconosciuto o un nome di Object.prototype non rompe nulla", () => {
  const opened = { id: "x", title: "a" };
  assert.deepEqual(sharedEditResult("constructor", opened, { title: "b" }, opened), { id: "x", title: "b" });
  assert.deepEqual(sharedEditResult("sconosciuto", opened, { title: "b" }, opened), { id: "x", title: "b" });
});
