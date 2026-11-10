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
  safeCssColor
} from "../src/lib/sharing.ts";
import { SHARE_PERMISSION_LABEL, SHARE_SCOPE_LABEL, scopesSummary } from "../src/lib/labels.ts";
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
    open: "Invito non aperto."
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
