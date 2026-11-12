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

test("tempo lineare: una corsa lunga e un testo grande non rallentano (NEW-1)", () => {
  const run = `@${"x".repeat(50_000)}`;
  let started = performance.now();
  assert.equal(redactEmails(run, false), EMAIL_HIDDEN);
  assert.ok(performance.now() - started < 1500, "50k in una corsa sola");
  const mixed = "a@b ciao mondo prof@unimi.it, x.y@gmail.com ".repeat(9_500);
  assert.ok(mixed.length > 400_000);
  started = performance.now();
  const out = redactEmails(mixed, true);
  assert.ok(performance.now() - started < 4000, "400 KB di testo misto");
  assert.ok(out.includes("prof@unimi.it") && !out.includes("gmail"));
  started = performance.now();
  assert.equal(onlyInstitutionalEmails(mixed), false);
  assert.ok(performance.now() - started < 4000);
  assert.equal(redactEmails("niente da nascondere ".repeat(30_000), false).length, 630_000, "senza chiocciola il testo torna com'è");
});

test("senza chiocciola il testo non si normalizza (NEW-4)", () => {
  const plain = "Chimica 1º modulo … Ⅰ";
  assert.equal(redactEmails(plain, false), plain);
});

test("ogni indirizzo @unimi.it dei dati dell'app passa la regola", () => {
  const files = ["../src/data/university/barb.synced.json", "../src/data/university/barb.seed.ts"];
  let count = 0;
  for (const file of files) {
    const text = readFileSync(new URL(file, import.meta.url), "utf8");
    for (const address of text.match(/[A-Za-z0-9._%+-]+@unimi\.it/g) ?? []) {
      count += 1;
      assert.equal(institutionalEmail(address), address.toLowerCase(), address);
      assert.equal(redactEmails(address, true), address, address);
    }
  }
  assert.ok(count > 20, "trovati gli indirizzi dei dati");
});

test("il segnaposto e la normalizzazione", () => {
  assert.equal(EMAIL_HIDDEN, "[email nascosta]");
  assert.equal(normalizeEmailText("a​b­﻿c"), "abc");
});
