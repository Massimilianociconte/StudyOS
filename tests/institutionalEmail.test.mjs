import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildSql } from "../scripts/supabase/gen-email-vectors.mjs";
import { EMAIL_HIDDEN, agentCorrectionLink, cutAtRunBoundary, institutionalEmail, normalizeEmailText, onlyInstitutionalEmails, redactEmails } from "../src/lib/institutionalEmail.ts";

const { vectors, cuts, links } = JSON.parse(readFileSync(new URL("./fixtures/emailVectors.json", import.meta.url), "utf8"));

test("la tabella di esempi: ogni vettore dà lo stesso risultato nel client", () => {
  assert.ok(vectors.length >= 30);
  for (const v of vectors) {
    const url = v.url === true;
    assert.equal(redactEmails(v.input, false, url), v.hide, `nascondi: ${v.name}`);
    assert.equal(redactEmails(v.input, true, url), v.keep, `tieni unimi: ${v.name}`);
    assert.equal(onlyInstitutionalEmails(v.input, url), v.only, `solo unimi: ${v.name}`);
  }
});

test("i tagli dei nomi di gruppo: stesso taglio e stesso testo per l'agente nel client", () => {
  assert.ok(cuts.length >= 10);
  for (const c of cuts) {
    assert.equal(cutAtRunBoundary(c.input, 120), c.cut, `taglio: ${c.name}`);
    assert.equal(redactEmails(cutAtRunBoundary(c.input, 120), false), c.agent, `agente: ${c.name}`);
  }
});

test("R5-C: i link delle correzioni (url, website) per l'agente: decodificati, nulli con un indirizzo non @unimi.it", () => {
  assert.ok(links.length >= 10);
  for (const l of links) assert.equal(agentCorrectionLink(l.input), l.agent, `link: ${l.name}`);
  const named = (name) => links.find((l) => l.name === name);
  assert.equal(named("Teams: indirizzo gmail codificato nel link").agent, null);
  assert.equal(named("Google Calendar: invitato nel link").agent, null);
  assert.equal(named("parametro to= con %40").agent, null);
  assert.equal(named("mailto unimi (campo url)").agent, "mailto:prof@unimi.it");
  assert.equal(named("mailto unimi (campo url)").field, "url", "website non accetta mailto (validazione di scrittura)");
});

test("R5-B: crescita della normalizzazione oltre 32 caratteri: il valore con una chiocciola diventa il segnaposto", () => {
  const FDFA = "\uFDFA";
  assert.equal(redactEmails(`x@ ${FDFA}`, false).includes(EMAIL_HIDDEN), true, "17 in più: si analizza");
  assert.equal(redactEmails(`x@ ${FDFA.repeat(2)}`, false), EMAIL_HIDDEN, "34 in più: tutto nascosto");
  assert.equal(redactEmails(`prof@unimi.it ${"\uFB03".repeat(16)}`, true), `prof@unimi.it ${"ffi".repeat(16)}`, "32 in più: resta");
  assert.equal(redactEmails(`prof@unimi.it ${"\uFB03".repeat(17)}`, true), EMAIL_HIDDEN, "34 in più: nascosto");
  assert.equal(onlyInstitutionalEmails(`prof@unimi.it ${"\uFB03".repeat(17)}`), false, "la scrittura lo rifiuta");
  assert.equal(redactEmails(FDFA.repeat(500), false), FDFA.repeat(500), "senza chiocciola il testo torna com'è");
});

test("R5-B: 2000 valori della forma N5 (x@ e U+FDFA fino al limite della colonna) in tempo limitato", () => {
  const FDFA = "\uFDFA";
  const shapes = [`x@ ${FDFA.repeat(157)}`, `x@ ${FDFA.repeat(77)}`, `x@ ${FDFA.repeat(117)}`, `x@ ${FDFA.repeat(997)}`];
  const started = performance.now();
  let hidden = 0;
  for (let row = 0; row < 2000; row += 1) {
    for (const value of shapes) if (redactEmails(value, row % 2 === 0) === EMAIL_HIDDEN) hidden += 1;
  }
  const elapsed = performance.now() - started;
  assert.equal(hidden, 8000);
  assert.ok(elapsed < 2000, `8000 valori N5 in ${Math.round(elapsed)} ms`);
  const links = performance.now();
  for (let row = 0; row < 2000; row += 1) assert.equal(agentCorrectionLink(`https://x.it/${"%EF%B7%BA".repeat(33)}@`), null);
  assert.ok(performance.now() - links < 2000, "2000 link con U+FDFA codificato");
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
  assert.equal(redactEmails(mixed, true), EMAIL_HIDDEN, "più di 10 chiocciole: tutto nascosto");
  assert.ok(performance.now() - started < 4000, "400 KB di testo misto");
  started = performance.now();
  assert.equal(onlyInstitutionalEmails(mixed), false);
  assert.ok(performance.now() - started < 4000);
  // 400 KB di parole con 10 indirizzi: si analizza, e resta lineare.
  const words = `${"ciao mondo ".repeat(18_000)}prof@unimi.it, x.y@gmail.com ${"a@b ".repeat(8)}fine`;
  assert.ok(words.length > 190_000);
  started = performance.now();
  const out = redactEmails(words, true);
  assert.ok(performance.now() - started < 4000, "testo lungo con 10 chiocciole");
  assert.ok(out.includes("prof@unimi.it") && !out.includes("gmail") && out.endsWith(" fine"));
  assert.equal(redactEmails("niente da nascondere ".repeat(30_000), false).length, 630_000, "senza chiocciola il testo torna com'è");
});

test("R3-1: oltre 10 chiocciole tutto il valore è nascosto, fino a 10 si analizza", () => {
  assert.equal(redactEmails("@ ".repeat(11).trim(), false), EMAIL_HIDDEN);
  assert.equal(redactEmails("a＠b ".repeat(11).trim(), false), EMAIL_HIDDEN, "si contano dopo la normalizzazione");
  assert.equal(redactEmails("a%40b ".repeat(11).trim(), false), EMAIL_HIDDEN);
  const ten = Array.from({ length: 10 }, (_, i) => `p${i}@unimi.it`).join(" ");
  assert.equal(redactEmails(ten, true), ten);
  assert.equal(onlyInstitutionalEmails(ten), true);
  assert.equal(onlyInstitutionalEmails(`${ten} q@unimi.it`), false);
});

test("R3-3: il limite di 300 conta i caratteri Unicode (una emoji è uno), come char_length in Postgres", () => {
  const emoji = "\u{1F600}";
  assert.equal(redactEmails(`${emoji.repeat(299)}@ ciao`, false), `${EMAIL_HIDDEN} ${EMAIL_HIDDEN}`, "300 caratteri: si analizza");
  assert.equal(redactEmails(`${emoji.repeat(300)}@ ciao`, false), `${EMAIL_HIDDEN} ciao`, "301 caratteri: nascosta per intero");
});

test("R3-6: (at) solo se attaccato; nei link «%40» del percorso resta", () => {
  assert.equal(normalizeEmailText("Sede di Asti (AT), aula 3"), "Sede di Asti (AT), aula 3");
  assert.equal(normalizeEmailText("bea(at)gmail.com"), "bea@gmail.com");
  assert.equal(normalizeEmailText("a(at)(at)b"), "a@@b");
  const teams = "https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0";
  assert.equal(normalizeEmailText(teams, true), teams);
  assert.equal(normalizeEmailText(teams), teams.replace("%40", "@"), "fuori da un campo link «%40» resta «@»");
  assert.equal(normalizeEmailText("https://a%40b.it@x.it/p%40q", true), "https://a@b.it@x.it/p%40q");
  assert.equal(normalizeEmailText("mailto:a%40b.it?cc=c%40d.it", true), "mailto:a@b.it?cc=c@d.it");
  assert.equal(normalizeEmailText("https://x.it/p%40q a%40b", true), "https://x.it/p%40q a@b", "dopo lo spazio non è più il link");
});

test("R3-4/R3-5: il taglio a 120 cade al confine di una parola, mai dentro un indirizzo", () => {
  assert.equal(cutAtRunBoundary("Farmaco", 120), "Farmaco");
  assert.equal(cutAtRunBoundary(`${"x".repeat(110)} bea.privata@gmail.com`, 120), "x".repeat(110));
  assert.equal(cutAtRunBoundary(`${"x".repeat(105)} bea.privata(at)gmail.com`, 120), "x".repeat(105));
  assert.equal(cutAtRunBoundary(`${"y".repeat(120)} z`, 120), "y".repeat(120), "parola che finisce proprio a 120");
  assert.equal(cutAtRunBoundary("w".repeat(300), 120), "", "una parola sola più lunga: niente");
  const emoji = "\u{1F600}";
  assert.equal(cutAtRunBoundary(`${emoji.repeat(100)} ${emoji.repeat(30)}`, 120), emoji.repeat(100), "si contano i caratteri Unicode");
  assert.equal(cutAtRunBoundary(`${emoji.repeat(119)} ab`, 120), emoji.repeat(119));
  const huge = "a@b ".repeat(75_000);
  const started = performance.now();
  assert.equal(cutAtRunBoundary(huge, 120).length, 119);
  assert.ok(performance.now() - started < 200);
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
