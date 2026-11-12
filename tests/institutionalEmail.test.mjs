import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSql } from "../scripts/supabase/gen-email-vectors.mjs";
import { EMAIL_HIDDEN, institutionalEmail, normalizeEmailText, onlyInstitutionalEmails, redactEmails } from "../src/lib/institutionalEmail.ts";

const { vectors } = JSON.parse(readFileSync(new URL("./fixtures/emailVectors.json", import.meta.url), "utf8"));

test("la tabella di esempi: ogni vettore dà lo stesso risultato nel client", () => {
  assert.ok(vectors.length >= 30);
  for (const v of vectors) {
    assert.equal(redactEmails(v.input, false), v.hide, `nascondi: ${v.name}`);
    assert.equal(redactEmails(v.input, true), v.keep, `tieni unimi: ${v.name}`);
    assert.equal(onlyInstitutionalEmails(v.input), v.only, `solo unimi: ${v.name}`);
  }
});

test("gli stessi vettori sono nel file SQL generato (nessuna deriva tra client e server)", () => {
  const onDisk = readFileSync(new URL("../scripts/supabase/email-vectors-tests.sql", import.meta.url), "utf8");
  assert.equal(onDisk, buildSql(), "rigenera con: node scripts/supabase/gen-email-vectors.mjs");
  assert.match(readFileSync(new URL("../scripts/supabase/scratch-pg.sh", import.meta.url), "utf8"), /email-vectors-tests\.sql/);
});

test("institutionalEmail: solo @unimi.it esatto, in minuscolo, con la normalizzazione Unicode", () => {
  assert.equal(institutionalEmail(" Mario.Rossi@UNIMI.IT "), "mario.rossi@unimi.it");
  assert.equal(institutionalEmail("a＠unimi.it"), "a@unimi.it");
  assert.equal(institutionalEmail("a@UNİMI.IT"), null);
  assert.equal(institutionalEmail("josé@unimi.it"), null);
  assert.equal(institutionalEmail("x@studenti.unimi.it"), null);
  assert.equal(institutionalEmail(42), null);
});

test("il segnaposto e la normalizzazione", () => {
  assert.equal(EMAIL_HIDDEN, "[email nascosta]");
  assert.equal(normalizeEmailText("a​b­﻿c"), "abc");
});
