import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseContactsPage,
  parseCoursePage,
  parseItalianDate,
  parsePersonPage,
  parsePianoDidattico,
  parseSemesterDates,
  planCohortToCourses,
  stripBoilerplate
} from "../src/lib/university/parsers.ts";

const fixture = (name) => readFileSync(new URL(`./fixtures/unimi/${name}.md`, import.meta.url), "utf8");

test("piano didattico: due coorti, coorte 2026/2027 = FBGof2 con 33 attività", () => {
  const plan = parsePianoDidattico(fixture("piano"));
  assert.equal(plan.academicYear, "2026/2027");
  assert.equal(plan.cohorts.length, 2);
  const cohort = plan.cohorts.find((c) => c.enrollmentYear === "2026/2027");
  assert.equal(cohort.curriculum, "FBGof2");
  assert.match(cohort.manifestoUrl, /FBGof2_2027\.pdf$/);
  const courses = planCohortToCourses(cohort);
  assert.equal(courses.length, 33);
  const byName = Object.fromEntries(courses.map((c) => [c.name, c]));
  assert.equal(byName["Anatomia dell'uomo"].character, "obbligatorio");
  assert.equal(byName["Anatomia dell'uomo"].semester, "primo");
  assert.deepEqual(byName["Diagnostica avanzata di laboratorio biosanitario"].ssd, ["BIOS-09/A", "MEDS-01/A", "MEDS-03/A"]);
  assert.equal(byName["Antropologia"].choiceGroup, "gruppo-1");
  assert.equal(byName["Neurofisiologia"].choiceGroup, "gruppo-2");
  assert.equal(byName["Methods in bioinformatics"].language, "Inglese");
  assert.equal(byName["Prova finale"].character, "tirocinio-tesi");
  assert.equal(byName["Prova finale"].year, 2);
  assert.equal(byName["Prova finale"].cfu, 30);
  const groups = cohort.groups.filter((g) => g.courses.length);
  assert.deepEqual(groups.map((g) => [g.index, g.pick, g.cfu, g.courses.length]), [[1, 1, 6, 4], [2, 2, 12, 12], [3, 2, 12, 7]]);
});

test("scheda insegnamento: docenti, ricevimento, programma, esame, Ariel", () => {
  const page = parseCoursePage(fixture("anatomia"));
  assert.equal(page.title, "Anatomia dell'uomo");
  assert.equal(page.cfu, 6);
  assert.equal(page.totalHours, 48);
  assert.equal(page.semester, "primo");
  assert.equal(page.examMode, "Esame");
  assert.equal(page.grading, "voto verbalizzato in trentesimi");
  assert.equal(page.responsible[0].name, "Cappelletti Graziella");
  assert.equal(page.teachers[0].officeHours, "giovedì · concordare via mail");
  assert.equal(page.arielUrl, "https://myariel.unimi.it/course/view.php?id=5098");
  assert.match(page.syllabus, /^Generalità di costituzione del corpo umano/);
  assert.match(page.scheduleUrl, /^https:\/\/orari\.unimi\.it\//, "link EasyAcademy migrato a orari.unimi.it");
  assert.equal(page.offered, true);
});

test("scheda multi-docente senza programma attivo", () => {
  const page = parseCoursePage(fixture("diagnostica"));
  assert.equal(page.teachers.length, 5);
  assert.equal(page.syllabus, null);
  assert.equal(page.modules.length, 3);
  assert.equal(page.teachers.find((t) => t.name === "Borghi Elisa").officeHours, "su appuntamento · Polo universitario San Paolo, blocco C, ottavo piano, stanza 813");
});

test("pagina docente: email istituzionale, ruolo, ricevimento", () => {
  const person = parsePersonPage(fixture("person"));
  assert.equal(person.name, "Cappelletti Graziella");
  assert.equal(person.email, "graziella.cappelletti@unimi.it");
  assert.equal(person.role, "Professore Ordinario");
  assert.equal(person.department, "Dipartimento di Bioscienze");
  assert.equal(person.ssd, "BIOS-12/A");
  assert.equal(person.officeHours, "giovedì");
});

test("date semestri dalla pagina calendari (incluso '1° marzo')", () => {
  const { semesters } = parseSemesterDates(fixture("calendari"));
  assert.deepEqual(semesters.map((s) => [s.id, s.startDate, s.endDate]), [
    ["primo", "2026-09-28", "2027-01-15"],
    ["secondo", "2027-03-01", "2027-06-18"]
  ]);
  assert.equal(parseItalianDate("31 febbraio 2027"), null);
});

test("date semestri: un A.A. precedente in cima alla pagina non contamina quello richiesto", () => {
  const old = "Periodi di lezione 2025-2026\n**Primo semestre**: inizio 22 settembre 2025, termine 16 gennaio 2026\n**Secondo semestre**: inizio 2 marzo 2026, termine 19 giugno 2026\n";
  const text = `${old}\n${fixture("calendari")}`;
  const selected = parseSemesterDates(text, "2026/2027");
  assert.equal(selected.periodLabel, "2026-2027");
  assert.deepEqual(selected.semesters.map((s) => s.startDate), ["2026-09-28", "2027-03-01"]);
  assert.deepEqual(parseSemesterDates(old, "2026/2027").semesters, []);
});

test("referenti e contatti: niente rumore dalle sezioni successive", () => {
  const data = parseContactsPage(fixture("contatti"));
  assert.equal(data.roles[0].role, "Presidente del Collegio didattico");
  assert.equal(data.contacts.length, 6);
  assert.ok(data.contacts.some((c) => c.value.includes("cl.biol@unimi.it")));
});

test("hash stabile: banner cookie e token immagine esclusi", () => {
  const a = "Titolo\n![x](https://a/img.gif?itok=AAA)\nTesto\nQuesto sito utilizza cookie tecnici...\nAccetta";
  const b = "Titolo\n![x](https://a/img.gif?itok=BBB)\nTesto\nQuesto sito utilizza cookie diversi";
  assert.equal(stripBoilerplate(a), stripBoilerplate(b));
});

test("email offuscate da Cloudflare: decodificate e stabili (niente falsi 'pagina cambiata')", async () => {
  const { decodeCloudflareEmails, parsePersonPage } = await import("../src/lib/university/parsers.ts");
  const obfuscated = (hex) =>
    `Rossi Mario\n===========\nProfessore Associato\nE-mail di ateneo\n[\\[email protected\\]](https://www.unimi.it/cdn-cgi/l/email-protection#${hex})\nRicevimento\nSu appuntamento, [\\[email protected\\]](https://www.unimi.it/cdn-cgi/l/email-protection)\nLuogo di ricevimento\nstudio`;
  // Stessa email con due chiavi XOR diverse, come avviene tra due richieste.
  const a = obfuscated("582b2c3d3e393637763a313e3e37182d3631353176312c");
  const b = obfuscated("473433222126292869252e2121280732292e2a2e692e33");
  assert.equal(stripBoilerplateHash(decodeCloudflareEmails(a)), stripBoilerplateHash(decodeCloudflareEmails(b)));
  const person = parsePersonPage(a);
  assert.equal(person.email, "stefano.biffo@unimi.it");
  assert.equal(person.officeHours, "Su appuntamento, stefano.biffo@unimi.it");
});

const stripBoilerplateHash = (text) => text.replace(/\s+/g, " ");
