import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_INSTITUTIONAL_EMAILS, agentCatalogText, agentMemberText, agentTeacherEmail } from "../src/agent/project.ts";
import { BARB_DATASET } from "../src/data/university/barb.dataset.ts";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

test("email per gli agenti: solo @unimi.it esatto, nessuna con il flag spento", () => {
  assert.equal(AGENT_INSTITUTIONAL_EMAILS, true);
  assert.equal(agentTeacherEmail(" Mario.Rossi@UNIMI.it "), "mario.rossi@unimi.it");
  for (const bad of ["a@studenti.unimi.it", "a@sub.unimi.it", "a@unimi.it.evil.com", "x@unimi.it@evil.com", "a@gmail.com", "", null, 42]) {
    assert.equal(agentTeacherEmail(bad), null, String(bad));
  }
  assert.equal(agentTeacherEmail("mario.rossi@unimi.it", false), null);
  assert.equal(agentCatalogText("Scrivi a segreteria@unimi.it o a bea@gmail.com"), "Scrivi a segreteria@unimi.it o a [email nascosta]");
  assert.equal(agentCatalogText("segreteria@unimi.it", false), "[email nascosta]");
  assert.equal(agentCatalogText(null), "");
  // Testo dei membri: anche gli indirizzi istituzionali spariscono.
  assert.equal(agentMemberText("prof: mario.rossi@unimi.it, io: bea@gmail.com"), "prof: [email nascosta], io: [email nascosta]");
});

test("il catalogo BARB usa solo indirizzi @unimi.it esatti (nessun sottodominio)", () => {
  const found = JSON.stringify(BARB_DATASET).match(EMAIL) ?? [];
  assert.ok(found.length > 0);
  for (const email of found) assert.equal(agentTeacherEmail(email), email.toLowerCase(), email);
});
