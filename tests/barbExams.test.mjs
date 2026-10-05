import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseUnimiExamFeed, dedupeExamSessions, resolveBarbCourse,
  getExamStatus, findSameDayExamCollisions, barbExamSourceUid,
  validateExamDataset,
  reconcileExamSessionIdentities,
} from "../src/lib/university/examSessions.ts";
import { fetchOfficialExamSource, retrieveBarbExams } from "../scripts/university/exams.mjs";

// Real public feed fields, captured 2026-10-05; missing `ora` means unpublished.
const english = { codIns: "F-001-", codW4: "B26-38", descrIns: "ACCERTAMENTO LINGUA INGLESE ", appelli: [{
  dataStr: "07/10/2026", aperturaStr: "02/10/2026", chiusuraStr: "06/10/2026", luogo: "Online", prova: "Test",
  docente: { nome: "", cognome: "Direttore dello SLAM" }, avviso: "PLACEMENT TEST riservato alle matricole a.a. 2026/27\r\nATTENZIONE: è possibile iscriversi ad UNA SOLA data.",
  piuGiorni: "Su piu' giorni", rangeDa: "A", rangeA: "Z", idAppello: "20737390", tipoTurni: "S",
  tipoAppello: "Accertamento competenze linguistiche (solo per appelli SLAM)", nomeAppello: "TEST ACCERTAMENTO LINGUA INGLESE",
}] };
const courses = [
  { id: "english", name: "Accertamento di lingua inglese - livello B2 (3 CFU)", code: null, officialPageUrl: "https://www.unimi.it/it/ugov/of/af20270000b26-38" },
  { id: "cellule", name: "Cellule staminali e medicina rigenerativa", code: null, officialPageUrl: null },
];
const options = { courses, sourceUrl: "https://work.unimi.it/foProssimiEsami/json/FBG", retrievedAt: "2026-10-05T14:30:00.000Z" };
const session = (courseId, date, type = "Orale", id = `${courseId}-${date}-${type}`) => ({
  id, courseId, date, type, time: null, location: null, notes: null,
  registrationOpens: null, registrationCloses: null,
  provenance: { sourceUrl: options.sourceUrl, retrievedAt: options.retrievedAt, lastVerifiedAt: options.retrievedAt },
});

test("official feed: published course code maps English, keeps null time and full notice", () => {
  const parsed = parseUnimiExamFeed([english], options);
  assert.equal(parsed.sessions.length, 1);
  assert.equal(parsed.sessions[0].courseId, "english");
  assert.equal(parsed.sessions[0].date, "2026-10-07");
  assert.equal(parsed.sessions[0].time, null);
  assert.equal(parsed.sessions[0].location, "Online");
  assert.equal(parsed.sessions[0].registrationCloses, "2026-10-06");
  assert.match(parsed.sessions[0].notes, /riservato alle matricole/);
  assert.equal(parsed.sessions[0].officialId, "20737390");
  assert.equal(parsed.unmatched.length, 0);
});

test("unknown course stays inspectable with its complete source record", () => {
  const source = { ...english, codW4: "OTHER", descrIns: "Corso non nel piano" };
  const parsed = parseUnimiExamFeed([source], options);
  assert.equal(parsed.sessions.length, 0);
  assert.equal(parsed.unmatched.length, 1);
  assert.deepEqual(parsed.unmatched[0].sourceRecord, source.appelli[0]);
  assert.equal(parsed.unmatched[0].courseName, "Corso non nel piano");
});

test("invalid date or invalid published time fails acquisition rather than guessing", () => {
  assert.throws(() => parseUnimiExamFeed([{ ...english, appelli: [{ ...english.appelli[0], dataStr: "31/02/2027" }] }], options), /data/i);
  assert.throws(() => parseUnimiExamFeed([{ ...english, appelli: [{ ...english.appelli[0], ora: "25:10" }] }], options), /ora/i);
  assert.throws(() => parseUnimiExamFeed({}, options), /array|elenco/i);
});

test("course linking prefers stable id; exact normalized name refuses ambiguous and fuzzy names", () => {
  assert.equal(resolveBarbCourse({ universityCourseId: "cellule", name: "English" }, courses)?.id, "cellule");
  assert.equal(resolveBarbCourse({ universityCourseId: "missing-id", name: courses[1].name }, courses), null);
  assert.equal(resolveBarbCourse({ name: " CELLULE STAMINALI E MEDICINA RIGENERATIVA " }, courses)?.id, "cellule");
  assert.equal(resolveBarbCourse({ name: "cellule staminali" }, courses), null);
  assert.equal(resolveBarbCourse({ name: courses[1].name }, [...courses, { ...courses[1], id: "other" }]), null);
});

test("dedupe removes shared feed id but retains different components and commissions", () => {
  const a = { ...session("cellule", "2027-01-11", "Scritto"), officialId: "100", commission: "MESSINA GRAZIELLA" };
  const same = { ...a, provenance: { ...a.provenance, sourceUrl: "https://work.unimi.it/foProssimiEsami/json/F92" } };
  const oral = { ...a, id: "oral", type: "Orale", officialId: "101" };
  const other = { ...a, id: "other", officialId: "102", commission: "ALTRA COMMISSIONE" };
  assert.equal(dedupeExamSessions([a, same, oral, other]).length, 3);
  assert.equal(barbExamSourceUid(a), barbExamSourceUid(same));
  assert.notEqual(barbExamSourceUid(a), barbExamSourceUid(oral));
});

test("different published enrolment ids only merge with verified alias evidence and identical sitting details", () => {
  const a = { ...session("cellule", "2027-01-11", "Scritto + Orale"), officialId: "20477449", commission: "MESSINA GRAZIELLA", component: "SCRITTO + ORALE CELLULE", time: "10:00" };
  const old = { ...a, id: "legacy", officialId: "20477450" };
  assert.equal(dedupeExamSessions([a, old]).length, 2);
  assert.equal(dedupeExamSessions([a, { ...old, aliasEvidenceUrl: "https://myariel.unimi.it/course/search.php?search=Cellule" }]).length, 1);
  assert.equal(dedupeExamSessions([a, { ...old, time: "11:00", aliasEvidenceUrl: "https://myariel.unimi.it/course/search.php?search=Cellule" }]).length, 2);
});

test("status includes today and considers next date separately for each course", () => {
  const past = session("a", "2026-10-04"), today = session("a", "2026-10-05"), later = session("a", "2026-10-20");
  const other = session("b", "2026-10-30"); const all = [later, other, past, today];
  assert.equal(getExamStatus(past, all, "2026-10-05"), "passato");
  assert.equal(getExamStatus(today, all, "2026-10-05"), "prossimo");
  assert.equal(getExamStatus(later, all, "2026-10-05"), "futuro");
  assert.equal(getExamStatus(other, all, "2026-10-05"), "prossimo");
});

test("same-day collisions require different courses, not two parts of one exam", () => {
  const a = session("a", "2026-10-05", "Scritto"), oral = session("a", "2026-10-05", "Orale");
  assert.deepEqual(findSameDayExamCollisions([a, oral]), []);
  const collisions = findSameDayExamCollisions([a, oral, session("b", "2026-10-05"), session("b", "2026-10-10")]);
  assert.equal(collisions.length, 1);
  assert.deepEqual(collisions[0].courseIds, ["a", "b"]);
});

test("versioned dataset has valid dates, officially sourced sessions and explicit acquisition states", () => {
  const data = JSON.parse(readFileSync(new URL("../src/data/university/barb.exams.json", import.meta.url), "utf8"));
  const errors = validateExamDataset(data);
  assert.deepEqual(errors, []);
  assert.ok(data.sessions.length > 0);
  assert.ok(data.sources.every(s => ["verificato", "non-verificato", "non-pubblicato"].includes(s.status)));
  assert.ok(data.sessions.some(s => s.courseId === "barb-26-27-cellule-staminali-e-medicina-rigenerativa"));
  assert.ok(data.sessions.some(s => s.courseId.startsWith("f92-")));
});

test("validation rejects unknown courses, missing nullable fields and unofficial references", () => {
  const data = JSON.parse(readFileSync(new URL("../src/data/university/barb.exams.json", import.meta.url), "utf8"));
  const mutated = structuredClone(data);
  mutated.sessions[0].courseId = "missing-course";
  delete mutated.sessions[0].time;
  mutated.sessions[0].sourceReferences[0].sourceUrl = "https://unimi.it.evil.test/feed";
  mutated.sources.push({ url: "http://work.unimi.it/test", status: "verificato", note: "" });
  const errors = validateExamDataset(mutated);
  assert.ok(errors.some(error => /corso/i.test(error)));
  assert.ok(errors.some(error => /ora|campo/i.test(error)));
  assert.ok(errors.some(error => /fonte/i.test(error)));
});

test("official HTTP downloader rejects off-domain redirects before fetching their destination", async () => {
  const requests = [];
  await assert.rejects(fetchOfficialExamSource(options.sourceUrl, async url => {
    requests.push(url);
    return new Response(null, { status: 302, headers: { location: "https://unimi.it.evil.test/steal" } });
  }), /non ufficiale/);
  assert.deepEqual(requests, [options.sourceUrl]);
});

test("partial feed failure remains unverified and cannot produce an applicable candidate", async () => {
  const result = await retrieveBarbExams({ acquire: async url => {
    if (url.endsWith("/json/F92")) throw new Error("HTTP 503");
    if (url.endsWith("/json/FBG")) return { text: JSON.stringify([english]), finalUrl: url };
    if (url.includes("myariel")) return { text: "Biologia del Differenziamento e Terapie che dall'a.a. 2025-2026 si chiama Cellule Staminali e Medicina Rigenerativa", finalUrl: url };
    if (url.endsWith("af20260000f1b-10")) return { text: 'Patenting and technology transfer <div class="views-label-cfu">6</div>', finalUrl: url };
    return { text: '<a href="https://www.unimi.it/it/node/134">Calendario degli appelli</a>', finalUrl: url };
  }, checkedAt: options.retrievedAt });
  assert.ok(result.errors.some(error => /503/.test(error)));
  assert.equal(result.data.sources.find(source => source.url.endsWith("/json/F92")).status, "non-verificato");
  assert.equal(result.data.sessions[0].courseId, "barb-26-27-accertamento-di-lingua-inglese-livello-b2-3-cfu");
});

test("same official id with contradictory published time blocks merging", () => {
  const a = { ...session("cellule", "2027-01-11"), officialId: "100", time: "10:00" };
  assert.throws(() => dedupeExamSessions([a, { ...a, time: "11:00" }]), /discordanti/);
});

test("alias identity survives when only the legacy enrolment remains in the next acquisition", () => {
  const previous = { ...session("cellule", "2027-01-11", "Scritto + Orale", "barb-exam-unimi-20477449"), officialId: "20477449", commission: "MESSINA GRAZIELLA", component: "CELLULE", sourceReferences: [
    { officialId: "20477449", sourceUrl: options.sourceUrl, sourceRecord: {}, registrationOpens: null, registrationCloses: null },
    { officialId: "20477450", sourceUrl: "https://work.unimi.it/foProssimiEsami/json/F92", sourceRecord: {}, registrationOpens: null, registrationCloses: null },
  ] };
  const remaining = { ...previous, id: "barb-exam-unimi-20477450", officialId: "20477450", sourceReferences: [previous.sourceReferences[1]] };
  const result = reconcileExamSessionIdentities([remaining], [previous]);
  assert.equal(result[0].id, "barb-exam-unimi-20477449");
  assert.equal(barbExamSourceUid(result[0]), "barb-exam-unimi-20477449");
  assert.equal(result[0].sourceReferences.find(r => r.officialId === "20477449").historical, true);
  assert.equal(result[0].sourceReferences.find(r => r.officialId === "20477450").historical, false);
  assert.equal(reconcileExamSessionIdentities([{ ...remaining, commission: "ALTRA COMMISSIONE" }], [previous])[0].id, "barb-exam-unimi-20477449");
  assert.equal(reconcileExamSessionIdentities([{ ...remaining, courseId: "altro-corso" }], [previous])[0].id, "barb-exam-unimi-20477450");
});

test("official correction of a surviving alias date updates its fields without creating a new import identity", () => {
  const old = { ...session("cellule", "2027-01-11", "Scritto + Orale", "barb-exam-unimi-20477449"), officialId: "20477449", sourceReferences: [{
    officialId: "20477450", sourceUrl: "https://work.unimi.it/foProssimiEsami/json/F92", sourceRecord: {}, registrationOpens: null, registrationCloses: null,
  }] };
  const corrected = { ...old, id: "barb-exam-unimi-20477450", officialId: "20477450", date: "2027-01-12", time: "11:00" };
  const result = reconcileExamSessionIdentities([corrected], [old])[0];
  assert.equal(barbExamSourceUid(result), "barb-exam-unimi-20477449");
  assert.equal(result.date, "2027-01-12");
  assert.equal(result.time, "11:00");
});
