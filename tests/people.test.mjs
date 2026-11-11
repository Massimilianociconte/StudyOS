import test from "node:test";
import assert from "node:assert/strict";
import {
  HANDLE_PATTERN,
  PeopleUserError,
  bindInviteRecipients,
  classifyPersonQuery,
  groupInviteRecipient,
  isExpiredEmailInvite,
  normalizeHandle,
  peopleCauseText,
  peopleErrorText,
  personFromRow,
  personName,
  personQueryParam,
  personTitle,
  profileFromRow,
  shareInviteRecipient
} from "../src/lib/people.ts";
import { inviteFromRow } from "../src/lib/sharing.ts";
import { peopleLabels } from "../src/lib/labels.ts";

test("@nome: minuscolo, 3–24 caratteri, solo lettere, cifre, _ e punto (stesso check di people.sql)", () => {
  assert.equal(HANDLE_PATTERN.source, "^[a-z0-9_.]{3,24}$");
  assert.equal(normalizeHandle("@Giulia.Rossi "), "giulia.rossi");
  assert.equal(normalizeHandle(" mario_99"), "mario_99");
  assert.equal(normalizeHandle("abc"), "abc");
  assert.equal(normalizeHandle("a".repeat(24)), "a".repeat(24));
  assert.equal(normalizeHandle("a".repeat(25)), null);
  assert.equal(normalizeHandle("ab"), null);
  assert.equal(normalizeHandle("@"), null);
  assert.equal(normalizeHandle("mario rossi"), null);
  assert.equal(normalizeHandle("mario-rossi"), null);
  assert.equal(normalizeHandle("@@mario"), null);
  assert.equal(normalizeHandle("màrio"), null);
});

test("ricerca: @ iniziale = @nome, @ interno = email esatta senza maiuscole, il resto non parte", () => {
  assert.deepEqual(classifyPersonQuery("@Giulia.Rossi"), { kind: "handle", value: "giulia.rossi" });
  assert.deepEqual(classifyPersonQuery("giulia.rossi"), { kind: "handle", value: "giulia.rossi" });
  assert.deepEqual(classifyPersonQuery("  Giulia.Rossi@Esempio.IT "), { kind: "email", value: "giulia.rossi@esempio.it" });
  assert.equal(classifyPersonQuery(""), null);
  assert.equal(classifyPersonQuery("   "), null);
  assert.equal(classifyPersonQuery("@ab"), null);
  assert.equal(classifyPersonQuery("giulia@"), null);
  assert.equal(classifyPersonQuery("giulia@esempio"), null);
  assert.equal(classifyPersonQuery("giulia rossi"), null);
  assert.equal(personQueryParam({ kind: "handle", value: "giulia" }), "@giulia");
  assert.equal(personQueryParam({ kind: "email", value: "g@x.it" }), "g@x.it");
});

test("righe del server: persona trovata e profilo, con i valori di riserva", () => {
  assert.deepEqual(personFromRow({ person_id: "u1", display_name: "  Giulia ", handle: "giulia" }), { personId: "u1", displayName: "Giulia", handle: "giulia" });
  assert.deepEqual(personFromRow({ person_id: "u2", display_name: null, handle: "" }), { personId: "u2", displayName: "", handle: null });
  assert.equal(personFromRow({ display_name: "Senza id" }), null);
  assert.equal(personFromRow(undefined), null);
  assert.equal(personFromRow({ person_id: "u3", display_name: "x".repeat(80) }).displayName.length, 60);
  assert.deepEqual(profileFromRow(null), { displayName: "", handle: null, discoverable: true });
  assert.deepEqual(profileFromRow({ display_name: "Bob", handle: "bob_1", discoverable: false }), { displayName: "Bob", handle: "bob_1", discoverable: false });
  assert.equal(profileFromRow({ display_name: "Bob" }).discoverable, true);
  const noName = { personId: "u4", displayName: "", handle: null };
  assert.equal(personTitle(noName), "Nome non impostato");
  assert.equal(personName(noName), "una persona");
  assert.equal(personName({ ...noName, handle: "carla" }), "@carla");
  assert.equal(personName({ ...noName, displayName: "Carla", handle: "carla" }), "Carla");
});

test("errori: i messaggi di people.sql diventano etichette, il resto mai in inglese", () => {
  const server = (message, code = "P0001") => peopleErrorText({ message, code });
  assert.equal(server("Troppe ricerche, riprova tra un minuto"), peopleLabels.errors.rateLimited);
  assert.equal(server("Nessuna persona trovata"), "Nessuna persona trovata");
  assert.equal(server("È già nel gruppo"), peopleLabels.errors.alreadyMember);
  assert.equal(server("Ha già un invito"), peopleLabels.errors.alreadyInvited);
  assert.equal(server("Solo proprietario e amministratori possono invitare"), peopleLabels.errors.notAllowed);
  assert.equal(server("Non puoi invitare te stesso"), peopleLabels.errors.self);
  assert.equal(server("Troppi inviti in attesa: annullane qualcuno"), peopleLabels.errors.tooManyInvites);
  assert.equal(server("Gli inviti per email non ci sono più: cerca la persona"), peopleLabels.errors.emailInvitesGone);
  assert.equal(server("Il gruppo non esiste più"), "Il gruppo non esiste più");
  assert.equal(server('duplicate key value violates unique constraint "studyos_profiles_handle_key"', "23505"), peopleLabels.errors.handleTaken);
  assert.equal(server("new row violates check constraint", "23514"), peopleLabels.errors.badHandle);
  assert.equal(server("Could not find the function public.find_person(p_query)", "PGRST202"), peopleLabels.errors.unavailable);
  assert.equal(server("relation \"public.studyos_profiles\" does not exist", "42P01"), peopleLabels.errors.unavailable);
  assert.equal(server("TypeError: Failed to fetch", ""), peopleLabels.errors.offline);
  assert.equal(server("permission denied for function find_person", "42501"), peopleLabels.errors.noPermission);
  assert.equal(server("internal error", "XX000"), peopleLabels.errors.generic);
  assert.equal(peopleCauseText(new PeopleUserError("Testo pronto")), "Testo pronto");
  assert.equal(peopleCauseText(new TypeError("Failed to fetch dynamically imported module: /assets/peopleSync.js")), peopleLabels.errors.offline);
  assert.equal(peopleCauseText(new Error("Cannot read properties of undefined")), peopleLabels.errors.generic);
  assert.equal(peopleCauseText("boom"), peopleLabels.errors.generic);
});

test("inviti per email di prima: scaduti se nessun account li ha presi", () => {
  assert.equal(isExpiredEmailInvite({ status: "pending", recipientEmail: "bob@x.it" }), true);
  assert.equal(isExpiredEmailInvite({ status: "pending", recipientEmail: "bob@x.it", recipientUserId: "u-bob" }), false);
  assert.equal(isExpiredEmailInvite({ status: "accepted", recipientEmail: "bob@x.it" }), false);
  assert.equal(isExpiredEmailInvite({ status: "pending", recipientUserId: "u-bob" }), false);
  assert.equal(isExpiredEmailInvite({ status: "pending", recipientEmail: null, recipientUserId: null }), false);
  const base = { recipientName: undefined, recipientEmail: undefined, recipientUserId: undefined, code: "GRP-AB12-CD34" };
  assert.equal(groupInviteRecipient(base), "Codice GRP-AB12-CD34");
  assert.equal(groupInviteRecipient({ ...base, recipientEmail: "bob@x.it" }), "bob@x.it");
  assert.equal(groupInviteRecipient({ ...base, recipientUserId: "u-bob" }), "Persona invitata");
  assert.equal(groupInviteRecipient({ ...base, recipientUserId: "u-bob", recipientName: "Bob" }), "Bob");
  const share = inviteFromRow({ id: "i1", owner_id: "alice", status: "pending", expires_at: "2999-01-01T00:00:00Z", recipient_email: null, recipient_user_id: "u-bob" });
  assert.equal(share.recipientUserId, "u-bob");
  assert.equal(shareInviteRecipient(share), "A una persona, nella sua app");
  assert.equal(inviteFromRow({ id: "i2", status: "pending", expires_at: "2999-01-01T00:00:00Z" }).recipientUserId, null);
  assert.equal(shareInviteRecipient({ recipientEmail: null, recipientUserId: null }), "Con link");
});

test("legame degli inviti: arriva dal server, non si toglie, conserva il nome, stesso array se non cambia", () => {
  const invite = (id, extra = {}) => ({ id, createdAt: "c", updatedAt: "u", archived: false, tags: [], groupId: "g1", groupName: "Fisio", fromUserId: "alice", fromDisplayName: "Alice", code: "GRP-AB12-CD34", status: "pending", ...extra });
  const local = [invite("i1", { recipientEmail: "bob@x.it" }), invite("i2", { recipientUserId: "u-carla", recipientName: "Carla" }), invite("i3")];
  const bound = bindInviteRecipients(local, [invite("i1", { recipientEmail: "bob@x.it", recipientUserId: "u-bob" }), invite("i2")]);
  assert.equal(bound[0].recipientUserId, "u-bob");
  assert.equal(bound[1].recipientUserId, "u-carla");
  assert.equal(bound[1].recipientName, "Carla");
  assert.equal(bound[2], local[2]);
  assert.equal(bindInviteRecipients(bound, [invite("i1", { recipientUserId: "u-bob" })]), bound);
  assert.equal(bindInviteRecipients(local, []), local);
});
