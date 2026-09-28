import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findCourse, lessonsToRules, normalizeCell } from "../scripts/university/easyAcademy.mjs";
import * as pipeline from "../scripts/university/pipeline.mjs";
const { diffSynced } = pipeline;
import { emptySyncedData, mergeUniversityDataset } from "../src/lib/university/merge.ts";
import { validateDataset } from "../src/lib/university/validate.ts";
import { BARB_SEED } from "../src/data/university/barb.seed.ts";

const cell = (date, orario, extra = {}) => ({ data: date, orario, nome_insegnamento: "Patologia", aula: "Aula 101", docente: "ROSSI", ...extra });

test("EasyAcademy: celle -> regole ricorrenti + eccezioni, senza estrapolare", () => {
  const lessons = [
    cell("05-10-2026", "09:30 - 11:30"),
    cell("12-10-2026", "09:30 - 11:30"),
    cell("19-10-2026", "09:30 - 11:30"),
    cell("21-10-2026", "14:00 - 16:00"),
    cell("26-10-2026", "09:30 - 11:30", { Annullato: "1" })
  ].map(normalizeCell);
  assert.equal(lessons[0].weekday, 1);
  const rules = lessonsToRules(lessons).get("patologia");
  assert.equal(rules.rules.length, 1);
  assert.deepEqual(rules.rules[0], { weekday: 1, start: "09:30", end: "11:30", room: "Aula 101", validFrom: "2026-10-05", validTo: "2026-10-19", occurrences: 3 });
  assert.deepEqual(rules.exceptions.map((e) => e.kind).sort(), ["cancellazione", "lezione-straordinaria"]);
  assert.equal(normalizeCell({ data: "xx", orario: "9-10", nome_insegnamento: "A" }), null);
});

test("EasyAcademy: una settimana senza lezione non diventa una ricorrenza inventata", () => {
  const lessons = [
    cell("05-10-2026", "09:30 - 11:30"),
    cell("12-10-2026", "09:30 - 11:30"),
    cell("26-10-2026", "09:30 - 11:30"),
    cell("02-11-2026", "09:30 - 11:30")
  ].map(normalizeCell);
  const result = lessonsToRules(lessons).get("patologia");
  assert.equal(result.rules.length, 0);
  assert.deepEqual(result.exceptions.map((item) => item.date), [
    "2026-10-05", "2026-10-12", "2026-10-26", "2026-11-02"
  ]);
});

test("Firecrawl: un redirect fuori dalla whitelist ufficiale è rifiutato anche se arriva dalla cache", () => {
  const result = pipeline.acceptOfficialPage({
    ok: true,
    url: "https://barb.cdl.unimi.it/it/insegnamenti/piano-didattico",
    finalUrl: "https://example.org/foreign-plan",
    markdown: "# Piano didattico",
    fromCache: true
  });
  assert.equal(result.ok, false);
  assert.match(result.error, /redirect|dominio|ufficiale/i);
});

test("EasyAcademy: rifiuta la risposta dopo un redirect verso un host esterno", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    url: "https://example.org/PortaleStudenti/combo.php",
    text: async () => "var elenco_corsi = [];"
  });
  try {
    await assert.rejects(findCourse({ academicYear: 2026, courseCode: "FBG" }), /redirect|dominio|ufficiale/i);
  } finally {
    globalThis.fetch = original;
  }
});

test("un candidato per un altro provider o con struttura incompleta non è applicabile", () => {
  const candidate = emptySyncedData("altro-corso");
  assert.ok(pipeline.validateCandidateEnvelope(candidate, "barb").length > 0);
  assert.ok(pipeline.validateCandidateEnvelope({ provider: "barb", version: 1 }, "barb").length > 0);
  assert.deepEqual(pipeline.validateCandidateEnvelope(emptySyncedData("barb"), "barb"), []);
});

test("--course richiede un match univoco e preferisce il nome esatto", () => {
  const targets = [
    { course: { id: "c1", name: "Anatomia dell'uomo" } },
    { course: { id: "c2", name: "Neuroanatomia" } }
  ];
  assert.match(pipeline.selectCourseTargets(targets, "anatomia").error, /ambiguo/i);
  assert.deepEqual(pipeline.selectCourseTargets(targets, "Anatomia dell'uomo").targets, [targets[0]]);
  assert.deepEqual(pipeline.selectCourseTargets(targets, "c2").targets, [targets[1]]);
});

test("barb:apply blocca un candidato parziale anche se il dataset è strutturalmente valido", async () => {
  const dir = mkdtempSync(join(tmpdir(), "studyos-candidate-"));
  const path = join(dir, "candidate.json");
  try {
    const candidate = emptySyncedData("barb");
    candidate.acquisition = { runId: "test", scope: "all", status: "incomplete", pages: 12, errors: 1, validationErrors: 0 };
    writeFileSync(path, JSON.stringify(candidate));
    const result = await pipeline.applyCandidate({ file: path });
    assert.equal(result.applied, false);
    assert.match(result.errors[0].message, /incompleta|errori/i);
    assert.equal(JSON.parse(readFileSync(path, "utf8")).acquisition.errors, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("diffSynced rileva campi, docenti e semestri cambiati", () => {
  const before = emptySyncedData("barb");
  const after = structuredClone(before);
  after.courses["c1"] = { fields: { cfu: 6 }, provenance: {} };
  after.teachers = [{ id: "t1", displayName: "A" }];
  after.semesters = [{ id: "secondo", startDate: "2027-03-01", endDate: "2027-06-18" }];
  const changes = diffSynced(before, after);
  assert.ok(changes.some((c) => c.section === "courses" && c.field === "cfu"));
  assert.ok(changes.some((c) => c.section === "teachers" && c.field === "added"));
  assert.ok(changes.some((c) => c.section === "semesters" && c.field === "startDate"));
});

test("merge + validazione: docenti referenziati devono esistere, date coerenti", () => {
  const synced = emptySyncedData("barb");
  const id = BARB_SEED.courses[0].id;
  synced.courses[id] = { fields: { teacherIds: ["unimi-ghost"] }, provenance: BARB_SEED.courses[0].provenance };
  synced.semesters = [{ id: "secondo", startDate: "2027-06-18", endDate: "2027-03-01", scheduleStatus: "non-pubblicato", scheduleNote: "", provenance: BARB_SEED.courses[0].provenance }];
  const issues = validateDataset(mergeUniversityDataset(BARB_SEED, synced));
  assert.ok(issues.some((i) => i.field === "teacherIds"));
  assert.ok(issues.some((i) => i.scope === "secondo" && i.field === "dates"));
});

test("seed base valido", () => {
  const issues = validateDataset(BARB_SEED).filter((i) => i.level === "error");
  assert.deepEqual(issues, []);
});
