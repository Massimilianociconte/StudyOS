import test from "node:test";
import assert from "node:assert/strict";
import {
  entriesToRun,
  laterDeletion,
  planKey,
  planRevert,
  restoreBlocked,
  revertCandidates,
  revertSummary,
  revertVersions,
  touchedEntities
} from "../src/lib/shareHistory.ts";
import { createRecheckCadence } from "../src/lib/shareRecheck.ts";
import { REVERT_TEXT } from "../src/lib/labels.ts";

const at = (day, hour = 10) => `2026-11-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:00:00.000Z`;
const since = at(3, 0);

const rev = (id, entityId, change, changedBy, changedAt, extra = {}) => ({
  id, entityType: "calendarEvent", entityId, payload: { id: entityId, title: `${entityId} v${id}` }, deleted: false, change, changedBy, changedAt, ...extra
});

/** Dove sta oggi ogni elemento (per id): copia su questo dispositivo e riga sul server. */
const statesOf = (map) => (_type, id) => map[id] ?? { local: null, server: null };
const here = (updatedAt) => ({ local: { updatedAt }, server: { updatedAt, deleted: false } });
const deletedOnServer = (updatedAt) => ({ local: null, server: { updatedAt, deleted: true } });

const flags = (plan) =>
  Object.fromEntries(plan.restore.map((entry) => [entry.revision.entityId, [entry.othersAfter, entry.ownerAfter, entry.ownerDeleted]]));

test("annulla le modifiche di una persona: versione prima della sua prima modifica, e cosa resta com'è", () => {
  const revisions = [
    rev(1, "vecchio", "update", "bob", at(1)), // prima del giorno scelto
    rev(2, "e1", "update", "bob", at(4, 10)),
    rev(3, "e1", "update", "bob", at(5, 10)),
    rev(4, "e1", "update", "carla", at(6, 10)), // dopo Bob: anche questa si perde
    rev(5, "e2", "delete", "bob", at(4, 11)),
    rev(6, "e3", "create", "bob", at(4, 12)),
    rev(7, "e3", "update", "bob", at(4, 13)),
    rev(8, "e4", "update", "bob", at(4, 14)), // poi eliminato dal proprietario: senza file
    rev(9, "e5", "update", "bob", at(4, 15)),
    rev(10, "e5", "delete", "carla", at(5, 15)), // eliminato da altri: l'eliminazione ha i file
    rev(11, "e6", "update", "carla", at(4, 16)), // di altri soltanto
    rev(12, "e7", "update", "bob", at(4, 17), { deleted: true, payload: { id: "e7", deletedAt: "x" } }), // rimesso da Bob
    rev(13, "e8", "create", "bob", at(4, 9)), // aggiunto e poi già eliminato: non si conta
    rev(14, "e9", "update", "bob", at(4, 18)) // sul server, non ancora su questo dispositivo
  ];
  const plan = planRevert(revisions, "bob", since, statesOf({
    // La copia locale ha l'updatedAt scritto da Carla (mai dopo l'ora del server): non è una modifica del proprietario.
    e1: { local: { updatedAt: at(6, 9) }, server: { updatedAt: at(6, 10), deleted: false } },
    e2: deletedOnServer(at(4, 11)),
    e3: here(at(4, 13)),
    e4: deletedOnServer(at(7)),
    e5: deletedOnServer(at(5, 15)),
    e6: here(at(4, 16)),
    e7: here(at(4, 17)),
    e8: deletedOnServer(at(5)),
    e9: { local: null, server: { updatedAt: at(4, 18), deleted: false } }
  }));
  assert.deepEqual(plan.restore.map(({ revision, deletedAfter }) => [revision.id, deletedAfter?.id ?? null]), [[2, null], [5, null], [9, 10]]);
  assert.deepEqual(flags(plan), { e1: [true, false, false], e2: [false, false, false], e5: [true, false, false] });
  assert.deepEqual([plan.added, plan.gone, plan.notHere], [2, 1, 1]);
  assert.deepEqual(revertSummary(plan, false), {
    toRestore: 3, added: 2, gone: 1, notHere: 1, othersAfter: 2, ownerAfter: 0, ownerDeleted: 0, changedAfter: 2, skipped: 0, restored: 0, notRestored: 0
  });
  // Lasciando com'è ciò che altri hanno cambiato dopo, torna solo e2.
  assert.deepEqual(entriesToRun(plan, true).map((entry) => entry.revision.id), [5]);
  assert.deepEqual(revertSummary(plan, true), {
    toRestore: 1, added: 2, gone: 1, notHere: 1, othersAfter: 0, ownerAfter: 0, ownerDeleted: 0, changedAfter: 2, skipped: 2, restored: 0, notRestored: 0
  });
  // Stesso istante: vale l'ordine di inserimento.
  const same = at(4);
  const tied = planRevert([rev(21, "x", "update", "bob", same), rev(20, "x", "update", "bob", same)], "bob", since, () => here(same));
  assert.equal(tied.restore[0].revision.id, 20);
  assert.deepEqual(planRevert(revisions, "dario", since, () => here(at(1))), { restore: [], added: 0, gone: 0, notHere: 0 });
});

test("annulla le modifiche: le modifiche e le eliminazioni successive del proprietario si riconoscono", () => {
  const goal = (id, entityId, change, changedAt) => rev(id, entityId, change, "bob", changedAt, { entityType: "goal" });
  const revisions = [
    rev(1, "o1", "update", "bob", at(4)), // poi modificato dal proprietario qui, non ancora inviato
    rev(2, "o2", "update", "bob", at(4)), // poi modificato dal proprietario su un altro dispositivo
    rev(3, "o3", "delete", "bob", at(4)), // ripristinato e poi eliminato di nuovo dal proprietario
    rev(4, "o4", "delete", "bob", at(4)), // eliminato da Bob e basta
    goal(5, "o5", "update", at(4)), // obiettivo (senza file) poi eliminato dal proprietario
    goal(6, "o6", "update", at(4)), // obiettivo che non c'è da nessuna parte
    rev(7, "o7", "update", "bob", at(4)) // copia e riga ferme all'ora della modifica di Bob
  ];
  const plan = planRevert(revisions, "bob", since, statesOf({
    o1: { local: { updatedAt: at(8) }, server: { updatedAt: at(4), deleted: false } },
    o2: { local: { updatedAt: at(4) }, server: { updatedAt: at(9), deleted: false } },
    o3: deletedOnServer(at(9)),
    o4: deletedOnServer(at(4)),
    o5: deletedOnServer(at(9)),
    o7: here(at(4))
  }));
  // Un obiettivo non ha file: la sua versione di modifica si ripristina anche senza copia (come prima).
  assert.deepEqual(plan.restore.map((entry) => entry.revision.id), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(flags(plan), {
    o1: [false, true, false],
    o2: [false, true, false],
    o3: [false, false, true],
    o4: [false, false, false],
    o5: [false, false, true],
    o6: [false, false, false],
    o7: [false, false, false]
  });
  const summary = revertSummary(plan, false);
  assert.deepEqual([summary.ownerAfter, summary.ownerDeleted, summary.changedAfter], [2, 2, 4]);
  assert.deepEqual(entriesToRun(plan, true).map((entry) => entry.revision.entityId), ["o4", "o6", "o7"]);
});

test("annulla le modifiche: la conferma vale solo per il controllo letto", () => {
  const revisions = [rev(1, "e1", "update", "bob", at(4)), rev(2, "e2", "update", "bob", at(4, 11))];
  const state = statesOf({ e1: here(at(4)), e2: here(at(4, 11)) });
  const checked = planRevert(revisions, "bob", since, state);
  assert.equal(planKey(planRevert(revisions, "bob", since, state), false), planKey(checked, false));
  // Un'altra modifica arrivata dopo il controllo cambia ciò che si perde: si chiede di nuovo.
  const later = planRevert([...revisions, rev(3, "e1", "update", "carla", at(5))], "bob", since, state);
  assert.notEqual(planKey(later, false), planKey(checked, false));
  // Anche un elemento eliminato nel frattempo dal proprietario.
  const gone = planRevert(revisions, "bob", since, statesOf({ e1: here(at(4)), e2: deletedOnServer(at(6)) }));
  assert.notEqual(planKey(gone, false), planKey(checked, false));
});

test("annulla le modifiche: versioni da scrivere, con il file dall'eliminazione e senza mezze versioni", () => {
  const update = rev(1, "a1", "update", "bob", at(4), { entityType: "attachment" });
  const deletion = rev(2, "a1", "delete", "carla", at(5), { entityType: "attachment" });
  const removed = rev(3, "a2", "delete", "bob", at(4), { entityType: "attachment" });
  const orphan = rev(4, "a3", "update", "bob", at(4), { entityType: "attachment" });
  const orphanDeletion = rev(5, "a3", "delete", "carla", at(5), { entityType: "attachment" });
  const entries = [
    { revision: update, deletedAfter: deletion },
    { revision: removed, deletedAfter: null },
    { revision: orphan, deletedAfter: orphanDeletion }, // l'eliminazione non c'è più nella cronologia
    { revision: rev(6, "a4", "update", "bob", at(4), { entityType: "attachment" }), deletedAfter: null } // versione sparita
  ];
  const payloads = new Map([
    [1, { id: "a1", name: "Prima" }],
    [2, { id: "a1", name: "Eliminato", dataUrl: "data:a1" }],
    [3, { id: "a2", name: "Tolto da Bob", dataUrl: "data:a2" }],
    [4, { id: "a3", name: "Prima" }]
  ]);
  const { versions, missing } = revertVersions(entries, payloads);
  assert.equal(missing, 2);
  assert.deepEqual(versions, [
    { entityType: "attachment", entityId: "a1", payload: { id: "a1", name: "Prima" }, complete: false, protectedFrom: { id: "a1", name: "Eliminato", dataUrl: "data:a1" } },
    { entityType: "attachment", entityId: "a2", payload: { id: "a2", name: "Tolto da Bob", dataUrl: "data:a2" }, complete: true, protectedFrom: null }
  ]);
});

test("cronologia: «Ripristina» non compare quando non riuscirebbe", () => {
  const attachment = (id, entityId, change, changedAt) => rev(id, entityId, change, "bob", changedAt, { entityType: "attachment" });
  const edit = attachment(1, "a1", "update", at(4));
  const list = [attachment(3, "a1", "update", at(6)), attachment(2, "a1", "delete", at(5)), edit];
  const none = () => false;
  assert.equal(laterDeletion(edit, list)?.id, 2);
  assert.equal(restoreBlocked(edit, list, none), false, "l'eliminazione dopo conserva il file");
  assert.equal(restoreBlocked(edit, [edit], none), true, "né copia né eliminazione: mancherebbe il file");
  assert.equal(restoreBlocked(edit, [edit], () => true), false, "la copia del proprietario ha il file");
  assert.equal(restoreBlocked(attachment(4, "a2", "delete", at(4)), [], none), false, "un'eliminazione ha il suo file");
  assert.equal(restoreBlocked(rev(5, "g1", "update", "bob", at(4), { entityType: "goal" }), [], none), false, "un obiettivo non ha file");
  // Un'eliminazione più vecchia della versione non conta.
  assert.equal(laterDeletion(attachment(7, "a1", "update", at(7)), list), null);
});

test("annulla le modifiche: elementi da controllare e persone tra cui scegliere", () => {
  const revisions = [rev(1, "e1", "update", "bob", at(1)), rev(2, "e2", "update", "bob", at(4)), rev(3, "e2", "update", "bob", at(5)), rev(4, "e3", "update", "carla", at(4))];
  assert.deepEqual(touchedEntities(revisions, "bob", since), [{ entityType: "calendarEvent", entityId: "e2" }]);
  const given = [
    { id: "g1", ownerId: "me", ownerName: "Io", scope: "calendar", subjectIds: [], permission: "edit", granteeUserId: "bob", granteeGroupId: null, granteeName: "Bob", granteeEmail: null, createdAt: "", updatedAt: "" },
    { id: "g2", ownerId: "me", ownerName: "Io", scope: "tasks", subjectIds: [], permission: "view", granteeUserId: "vera", granteeGroupId: null, granteeName: "Vera", granteeEmail: null, createdAt: "", updatedAt: "" },
    { id: "g3", ownerId: "me", ownerName: "Io", scope: "goals", subjectIds: [], permission: "edit", granteeUserId: null, granteeGroupId: "grp", granteeName: "Gruppo", granteeEmail: null, createdAt: "", updatedAt: "" }
  ];
  const groups = [{ id: "grp", members: [{ userId: "me", displayName: "Io" }, { userId: "carla", displayName: "Carla" }] }];
  // Chi ha cambiato qualcosa (dalla cronologia o dalla lettura dei 90 giorni, anche ripetuto) e chi può modificare.
  const people = revertCandidates(["ex1", "ex2", null, "bob", "ex1"], given, groups, "me");
  assert.deepEqual(people.map((person) => [person.id, person.label]), [
    ["bob", "Bob"], ["carla", "Carla"], ["ex1", "Un'altra persona"], ["ex2", "Un'altra persona (2)"]
  ]);
  assert.equal(people[3].name, "Un'altra persona");
});

test("annulla le modifiche: testi della conferma e dell'esito in italiano semplice", () => {
  const base = { toRestore: 0, added: 0, gone: 0, notHere: 0, othersAfter: 0, ownerAfter: 0, ownerDeleted: 0, changedAfter: 0, skipped: 0, restored: 0, notRestored: 0 };
  const plan = REVERT_TEXT.plan("Bob", "3 nov", { ...base, toRestore: 3, added: 2, gone: 1, notHere: 1, othersAfter: 1, ownerAfter: 2, ownerDeleted: 1 });
  assert.match(plan, /^3 elementi tornano com'erano prima delle modifiche di Bob dal 3 nov\./);
  assert.match(plan, /1 di questi l'avevi eliminato tu: torna tra i tuoi dati\./);
  assert.match(plan, /Su 2 di questi hai fatto modifiche anche tu, dopo: vengono sostituite\./);
  assert.match(plan, /anche un'altra persona/);
  assert.match(plan, /2 elementi aggiunti da Bob restano/);
  assert.match(plan, /1 elemento che hai eliminato tu resta eliminato\./);
  assert.match(plan, /1 elemento non è ancora arrivato su questo dispositivo/);
  // Solo ciò che vale: nessuna frase fissa sulle modifiche del proprietario.
  assert.equal(REVERT_TEXT.plan("Bob", "3 nov", { ...base, toRestore: 3 }), "3 elementi tornano com'erano prima delle modifiche di Bob dal 3 nov.");
  assert.equal(
    REVERT_TEXT.plan("Bob", "3 nov", { ...base, skipped: 2 }),
    "Nessun elemento da riportare indietro. 2 elementi cambiati dopo da te o da altri restano come sono ora."
  );
  assert.equal(REVERT_TEXT.skipChanged(1), "Lascia com'è l'elemento cambiato dopo da te o da altri");
  assert.equal(REVERT_TEXT.plan("Bob", "11 nov", { ...base, toRestore: 1 }), "1 elemento torna com'era prima delle modifiche di Bob dall'11 nov.");
  assert.equal(REVERT_TEXT.nothing("Bob", "8 nov"), "Dall'8 nov Bob non ha cambiato nulla dei tuoi dati.");
  assert.equal(REVERT_TEXT.nothing("Bob", "18 nov"), "Dal 18 nov Bob non ha cambiato nulla dei tuoi dati.");
  assert.equal(REVERT_TEXT.done("Bob", 3, 0), "Fatto: 3 elementi sono tornati com'erano prima delle modifiche di Bob.");
  assert.equal(
    REVERT_TEXT.done("Bob", 2, 1),
    "Fatto: 2 elementi sono tornati com'erano prima delle modifiche di Bob. 1 elemento non si è potuto ripristinare: non era più tra i tuoi dati o nella cronologia."
  );
  assert.match(REVERT_TEXT.done("Bob", 0, 2), /^Nessun elemento è cambiato\. 2 elementi non si sono potuti ripristinare/);
  assert.notEqual(REVERT_TEXT.confirm.split(" ")[0], "Annulla");
});

test("ricontrollo degli id visibili: al controllo dei 5 minuti, al ritorno sulla scheda se scaduto, ai permessi cambiati", () => {
  const period = 5 * 60_000;
  const cadence = createRecheckCadence(period);
  // Dopo l'avvio (o un cambio di chi guarda) ogni proprietario si ricontrolla: non c'è una firma.
  assert.equal(cadence.take(), false);
  assert.equal(cadence.needs("alice", "s1", false), true);
  cadence.checked("alice", "s1");
  cadence.passDone(true, 1_000);
  // Un segnale Realtime qualsiasi: niente ricontrollo.
  assert.equal(cadence.take(), false);
  assert.equal(cadence.needs("alice", "s1", false), false);
  // Permessi cambiati (filtro per materie, gruppo): subito, senza aspettare.
  assert.equal(cadence.needs("alice", "s2", false), true);
  // Ritorno sulla scheda poco dopo un controllo completo: niente.
  cadence.resumed(1_000 + period - 1);
  assert.equal(cadence.take(), false);
  // Ritorno dopo più di 5 minuti nascosta: controllo completo, una volta.
  cadence.resumed(1_000 + period);
  assert.equal(cadence.take(), true);
  assert.equal(cadence.take(), false);
  assert.equal(cadence.needs("alice", "s1", true), true);
  // Controllo dei 5 minuti non riuscito: si ripete alla passata dopo; una passata normale fallita no.
  cadence.requestFull();
  const full = cadence.take();
  cadence.passFailed(full);
  assert.equal(cadence.take(), true);
  cadence.passFailed(false);
  assert.equal(cadence.take(), false);
  // Una passata che non ha ricontrollato tutti non conta come controllo completo.
  cadence.passDone(false, 1_000 + 3 * period);
  cadence.resumed(1_000 + 3 * period);
  assert.equal(cadence.take(), true);
  // Chi non condivide più nulla si dimentica: se ricondivide, si ricontrolla.
  cadence.checked("bruno", "s1");
  cadence.keep(new Set(["alice"]));
  assert.equal(cadence.needs("bruno", "s1", false), true);
  // Cambio di chi guarda: tutto da capo, anche al ritorno sulla scheda.
  cadence.passDone(true, 10 * period);
  cadence.reset();
  assert.equal(cadence.needs("alice", "s1", false), true);
  cadence.resumed(10 * period + 1);
  assert.equal(cadence.take(), true);
});
