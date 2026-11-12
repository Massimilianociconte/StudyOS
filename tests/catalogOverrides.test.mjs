import test from "node:test";
import assert from "node:assert/strict";
import { EMAIL_HIDDEN, institutionalEmail, onlyInstitutionalEmails, redactEmails } from "../src/lib/institutionalEmail.ts";
import { cleanOverrideFields, contactTargetId, overridesOf, withOverride } from "../src/lib/catalogOverrides.ts";
import { overrideFromRow } from "../src/lib/groupExams.ts";

test("email istituzionale: solo esattamente @unimi.it, in minuscolo", () => {
  assert.equal(institutionalEmail(" Mario.Rossi@UNIMI.IT "), "mario.rossi@unimi.it");
  for (const value of ["mario@gmail.com", "mario@studenti.unimi.it", "x@sub.unimi.it", "x@unimi.it.evil.com", "x@unimi.it@evil.com", "unimi.it", "", null, 42]) {
    assert.equal(institutionalEmail(value), null, String(value));
  }
});

test("testi: indirizzi non istituzionali nascosti, istituzionali tenuti solo se richiesto", () => {
  const text = "Prof: Mario.Rossi@UNIMI.IT, rappresentante anna@gmail.com, studente x@studenti.unimi.it, strano x@unimi.it@evil.com, y@unimi.it.evil.com.";
  const kept = redactEmails(text, true);
  assert.ok(kept.includes("Mario.Rossi@UNIMI.IT"), "gli indirizzi tenuti conservano le maiuscole");
  for (const leaked of ["anna@gmail.com", "x@studenti.unimi.it", "evil.com.", "y@unimi.it.evil"]) assert.ok(!kept.includes(leaked), leaked);
  assert.ok(!kept.includes("x@unimi.it@"), "un indirizzo attaccato a un'altra @ non passa");
  const none = redactEmails(text, false);
  assert.ok(!/@unimi\.it/i.test(none.replaceAll(EMAIL_HIDDEN, "")), "con il divieto non resta nessun indirizzo");
  assert.ok(onlyInstitutionalEmails("cl.biol@unimi.it · via Celoria, 26"));
  assert.ok(onlyInstitutionalEmails("Scrivi a Mario.Rossi@UNIMI.IT."));
  assert.ok(!onlyInstitutionalEmails("x@unimi.it@evil.com"));
  assert.ok(!onlyInstitutionalEmails("x@unimi.it.evil.com"));
});

test("indirizzi: ogni forma di indirizzo non istituzionale sparisce (H1)", () => {
  const hidden = [
    "josé@gmail.com", "à@gmail.com", "o'brien@gmail.com", "x@münchen.de", "x@unimi.it​@gmail.com",
    "x@unimi.it@gmail.com", "a@@b.com", "x@unimi.it.evil.com", "x@xunimi.it", "x@UNIMI.IT.evil.com",
    "mailto:anna@gmail.com", "<anna@gmail.com>", "x@unimi.it‍@evil.com", "x＠gmail.com", "anna@gmail.com."
  ];
  for (const address of hidden) {
    for (const keep of [true, false]) {
      const out = redactEmails(`scrivi a ${address} grazie`, keep);
      assert.ok(!/gmail|evil|münchen|brien|josé|à@/.test(out), `${JSON.stringify(address)} keep=${keep} -> ${out}`);
      assert.ok(!/[@＠]/.test(out), `nessuna @ resta: ${out}`);
    }
  }
  assert.equal(redactEmails("mailto:Mario@UNIMI.IT.", true), "mailto:Mario@UNIMI.IT.");
  assert.equal(redactEmails("<Mario@UNIMI.IT>, ok", true), "<Mario@UNIMI.IT>, ok");
  assert.equal(redactEmails("(cl.biol@unimi.it)", true), "(cl.biol@unimi.it)");
  assert.equal(redactEmails("cl.biol@unimi.it", false), EMAIL_HIDDEN);
  assert.equal(redactEmails("niente da nascondere", false), "niente da nascondere");
  assert.equal(institutionalEmail("x@unimi.it\n"), "x@unimi.it", "gli spazi ai bordi si tolgono, quelli dentro no");
  assert.equal(institutionalEmail("x@unimi.it\n@evil.com"), null);
  assert.equal(institutionalEmail("evil%x.com@unimi.it"), "evil%x.com@unimi.it", "il % è ammesso come nella regola del server");
  assert.equal(institutionalEmail("a\u200B@unimi.it"), "a@unimi.it", "i caratteri invisibili si tolgono prima di confrontare (NFKC)");
});

test("righe di correzione: il client filtra di nuovo (L4)", () => {
  const row = (fields, kind = "teacher") => overrideFromRow({ id: "gover_9", group_id: "gx", target_kind: kind, target_id: "t1", target_label: "T", fields, version: 1, created_by: "u", created_by_name: "B", updated_by: "u", updated_by_name: "B", deleted_at: null, deleted_by_name: null, created_at: "", updated_at: "" });
  assert.deepEqual(row({ id: "x", officeHours: "Lun 9", email: "a@gmail.com", note: "scrivi a b@gmail.com" }).fields, { officeHours: "Lun 9" });
  assert.deepEqual(row({ email: "A@UNIMI.IT", room: "C1" }).fields, { email: "a@unimi.it" });
  const effective = withOverride({ id: "official", email: "x@unimi.it" }, { ...row({ officeHours: "Lun 9" }), fields: { id: "evil", email: "a@gmail.com", officeHours: "Lun 9" } });
  assert.equal(effective.value.id, "official");
  assert.equal(effective.value.email, "x@unimi.it");
  assert.equal(effective.value.officeHours, "Lun 9");
});

test("correzioni: stessi controlli del server", () => {
  assert.deepEqual(cleanOverrideFields("teacher", { email: "Mario.Rossi@UNIMI.IT", officeHours: " Mar  10-12 ", phone: null }), { ok: true, value: { email: "mario.rossi@unimi.it", officeHours: "Mar 10-12" } });
  assert.equal(cleanOverrideFields("teacher", { email: "mario@gmail.com" }).field, "email");
  assert.equal(cleanOverrideFields("teacher", { email: "mario@studenti.unimi.it" }).field, "email");
  assert.equal(cleanOverrideFields("teacher", { officeHours: "scrivere a mario@gmail.com" }).field, "officeHours");
  assert.equal(cleanOverrideFields("teacher", { website: "javascript:alert(1)" }).field, "website");
  assert.equal(cleanOverrideFields("teacher", { website: "mailto:a@unimi.it" }).field, "website");
  assert.equal(cleanOverrideFields("course", { email: "a@unimi.it" }).field, "email");
  assert.equal(cleanOverrideFields("contact", { url: "mailto:cl.biol@unimi.it", value: "cl.biol@unimi.it · via Celoria, 26" }).ok, true);
  assert.equal(cleanOverrideFields("teacher", { phone: "chiamami" }).field, "phone");
  assert.deepEqual(cleanOverrideFields("teacher", { office: "  " }), { ok: false, field: "fields", message: "Scrivi almeno una correzione." });
  assert.equal(cleanOverrideFields("teacher", { note: "x".repeat(501) }).message, "Testo troppo lungo (massimo 500 caratteri).");
});

test("valori effettivi: ufficiale + correzione del gruppo scelto", () => {
  const row = (over) => overrideFromRow({ id: "gover_1", group_id: "gx", target_kind: "teacher", target_id: "unimi-mario-rossi", target_label: "Mario Rossi", fields: { officeHours: "Mer 14-16", note: "solo su appuntamento" }, version: 1, created_by: "u", created_by_name: "Bea", updated_by: "u", updated_by_name: "Bea", deleted_at: null, deleted_by_name: null, created_at: "", updated_at: "2026-11-12T10:00:00Z", ...over });
  const list = [row(), row({ id: "gover_2", group_id: "gy", fields: { officeHours: "Gio 9-11" }, updated_at: "2026-11-13T10:00:00Z" }), row({ id: "gover_3", deleted_at: "2026-11-12T11:00:00Z" })];
  assert.deepEqual(overridesOf(list, "teacher", "unimi-mario-rossi", "gx").map((item) => item.id), ["gover_1", "gover_2"]);
  const effective = withOverride({ displayName: "Mario Rossi", officeHours: "Mar 10-12" }, overridesOf(list, "teacher", "unimi-mario-rossi", "gx")[0]);
  assert.equal(effective.value.officeHours, "Mer 14-16");
  assert.deepEqual(effective.changed, ["officeHours"]);
  assert.equal(effective.value.note, undefined, "la nota resta sulla correzione, non entra nei campi ufficiali");
  assert.equal(contactTargetId("Information Center: per matricole"), "contatto:information-center-per-matricole");
});
