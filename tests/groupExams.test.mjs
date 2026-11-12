import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ACCENT_FROM,
  ACCENT_TO,
  COURSE_NORM_VECTORS,
  cleanSessionFields,
  courseKeyOf,
  describeHistoryEntry,
  findTwin,
  historyFromRow,
  mergeSessionEdit,
  mergeSessionRow,
  newGroupRecordId,
  normalizeCourseName,
  sessionFromRow,
  sessionMatchesSubject,
  sessionTitle,
  sessionToFields,
  writeResultFrom
} from "../src/lib/groupExams.ts";

const row = (over = {}) => ({
  id: "gexam_a1",
  group_id: "gx",
  course_key: "barb:farm-spec",
  course_id: "farm-spec",
  course_name: "Farmacologia Speciale",
  course_norm: "farmacologia speciale",
  exam_date: "2027-01-12",
  kind: "preappello",
  label: "",
  exam_time: null,
  room: "Aula C03",
  notes: "",
  registration_opens: null,
  registration_closes: "2027-01-05",
  barb_session_id: null,
  source: "member",
  version: 1,
  created_by: "u-bea",
  created_by_name: "Bea",
  updated_by: "u-bea",
  updated_by_name: "Bea",
  deleted_at: null,
  deleted_by: null,
  deleted_by_name: null,
  created_at: "2026-11-12T10:00:00+00:00",
  updated_at: "2026-11-12T10:00:00+00:00",
  ...over
});

test("nome del corso: stessi esempi del server", () => {
  for (const [input, expected] of COURSE_NORM_VECTORS) assert.equal(normalizeCourseName(input), expected, input);
  assert.equal(ACCENT_FROM.length, ACCENT_TO.length);
  const sql = readFileSync(new URL("../supabase/group-exams.sql", import.meta.url), "utf8");
  assert.ok(sql.includes(`'${ACCENT_FROM}'`) && sql.includes(`'${ACCENT_TO}'`), "translate() del server usa le stesse lettere");
  const sqlTests = readFileSync(new URL("../scripts/supabase/group-exams-tests.sql", import.meta.url), "utf8");
  for (const [input, expected] of COURSE_NORM_VECTORS) {
    assert.ok(sqlTests.includes(`studyos_course_norm('${input}') = '${expected}'`), `il test SQL ha l'esempio «${input}»`);
  }
});

test("chiave del corso: catalogo o nome", () => {
  assert.equal(courseKeyOf("farm-spec", "Farmacologia"), "barb:farm-spec");
  assert.equal(courseKeyOf(null, " FARMACOLOGIA  Speciale "), "nome:farmacologia speciale");
});

test("campi dell'appello: puliti come sul server", () => {
  const ok = cleanSessionFields({ courseName: "  Farmacologia   Speciale ", date: "2027-01-12", kind: "preappello", time: "09:30" });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.courseName, "Farmacologia Speciale");
  assert.equal(ok.value.source, "member");
  assert.deepEqual(cleanSessionFields({ courseName: "Fisiologia", date: "2027-02-30", kind: "appello" }), { ok: false, field: "date", message: "Data non valida: usa AAAA-MM-GG." });
  assert.equal(cleanSessionFields({ courseName: "Fisiologia", date: "2027-02-10", kind: "esame" }).field, "kind");
  assert.equal(cleanSessionFields({ courseName: "Fisiologia", date: "2027-02-10", kind: "appello", grade: "30" }).field, "grade");
  assert.equal(cleanSessionFields({ courseName: "Fisiologia", date: "2027-02-10", kind: "appello", time: "25:00" }).field, "time");
  assert.equal(cleanSessionFields({ courseName: "Fisiologia", date: "2027-02-10", kind: "appello", registrationOpens: "2027-01-20", registrationCloses: "2027-01-10" }).field, "registrationCloses");
  assert.equal(cleanSessionFields({ courseName: "Fisiologia", date: "2027-02-10", kind: "appello", source: "barb" }).field, "source");
  assert.equal(cleanSessionFields({ courseName: "–", date: "2027-02-10", kind: "appello" }).field, "courseName");
});

test("righe del server: convertite, malformate scartate", () => {
  const session = sessionFromRow(row());
  assert.equal(session.date, "2027-01-12");
  assert.equal(session.registrationCloses, "2027-01-05");
  assert.equal(session.time, null);
  assert.equal(sessionFromRow(row({ kind: "esame" })), null);
  assert.equal(sessionFromRow(row({ version: 0 })), null);
  assert.equal(sessionFromRow(row({ exam_date: "domani" })), null);
  assert.equal(sessionFromRow(null), null);
  const result = writeResultFrom({ status: "conflict", row: row({ version: 3 }), message: "Nel frattempo…" }, sessionFromRow);
  assert.equal(result.status, "conflict");
  assert.equal(result.row.version, 3);
  assert.equal(writeResultFrom({ status: "boh" }, sessionFromRow).status, "invalid");
});

test("elenco in memoria: una versione vecchia non vince", () => {
  const v2 = sessionFromRow(row({ version: 2, room: "Aula G24" }));
  const v1 = sessionFromRow(row());
  const list = mergeSessionRow([v2], v1);
  assert.equal(list.length, 1);
  assert.equal(list[0].room, "Aula G24");
  assert.equal(mergeSessionRow(list, sessionFromRow(row({ version: 3, room: "Aula 1" })))[0].room, "Aula 1");
});

test("doppione: stessa data e tipo, corso per chiave o per nome", () => {
  const list = [sessionFromRow(row())];
  assert.equal(findTwin(list, "gx", { courseId: null, courseName: "FARMACOLOGIA speciale", date: "2027-01-12", kind: "preappello" })?.id, "gexam_a1");
  assert.equal(findTwin(list, "gx", { courseId: "farm-spec", courseName: "Altro nome", date: "2027-01-12", kind: "preappello" })?.id, "gexam_a1");
  assert.equal(findTwin(list, "gx", { courseId: null, courseName: "Farmacologia Speciale", date: "2027-01-12", kind: "orale" }), undefined);
  assert.equal(findTwin(list, "gy", { courseId: null, courseName: "Farmacologia Speciale", date: "2027-01-12", kind: "preappello" }), undefined);
  assert.equal(findTwin(list, "gx", { courseId: null, courseName: "Farmacologia Speciale", date: "2027-01-12", kind: "preappello" }, "gexam_a1"), undefined);
  assert.equal(findTwin([sessionFromRow(row({ deleted_at: "2026-11-12T11:00:00Z" }))], "gx", { courseId: null, courseName: "Farmacologia Speciale", date: "2027-01-12", kind: "preappello" }), undefined);
});

test("unione a tre: campi diversi si uniscono, lo stesso campo è un conflitto", () => {
  const base = sessionToFields(sessionFromRow(row()));
  const theirs = { ...base, room: "Aula G24" };
  const mine = { ...base, time: "09:00" };
  const merged = mergeSessionEdit(base, mine, theirs);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.merged.room, "Aula G24");
  assert.equal(merged.merged.time, "09:00");
  const clash = mergeSessionEdit(base, { ...base, date: "2027-01-14" }, { ...base, date: "2027-01-13" });
  assert.deepEqual(clash.conflicts, ["date"]);
  assert.equal(clash.merged.date, "2027-01-13", "in conflitto resta la loro finché non scegli");
  assert.deepEqual(mergeSessionEdit(base, { ...base, date: "2027-01-13" }, { ...base, date: "2027-01-13" }).conflicts, []);
});

test("cronologia leggibile", () => {
  const entry = historyFromRow({
    id: 7, group_id: "gx", record_kind: "exam_session", record_id: "gexam_a1", action: "update", version: 2,
    before: row(), after: row({ version: 2, exam_date: "2027-01-14", room: "Aula G24" }), changed_fields: ["date", "room"],
    actor_user_id: "u-ada", actor_name: "Ada", changed_at: "2026-11-12T11:00:00Z"
  });
  assert.deepEqual(describeHistoryEntry(entry), ["Data: 12/01/2027 → 14/01/2027", "Aula: Aula C03 → Aula G24"]);
  const removed = historyFromRow({ id: 8, group_id: "gx", record_kind: "exam_session", record_id: "gexam_a1", action: "delete", version: 3, before: row(), after: row({ deleted_at: "2026-11-12T12:00:00Z" }), changed_fields: ["deleted"], actor_user_id: "u", actor_name: "Bea", changed_at: "" });
  assert.deepEqual(describeHistoryEntry(removed), ["Eliminato"]);
  const created = historyFromRow({ id: 6, group_id: "gx", record_kind: "exam_session", record_id: "gexam_a1", action: "create", version: 1, before: null, after: row(), changed_fields: [], actor_user_id: "u", actor_name: "Bea", changed_at: "" });
  assert.deepEqual(describeHistoryEntry(created), ["Aggiunto: Preappello · Farmacologia Speciale del 12/01/2027"]);
  assert.equal(historyFromRow({ id: "x" }), null);
});

test("righe di cronologia: valori lunghi accorciati, solo corso collegato (L3)", () => {
  const long = "x".repeat(500);
  const entry = historyFromRow({ id: 9, group_id: "gx", record_kind: "exam_session", record_id: "gexam_a1", action: "update", version: 2, before: row({ notes: "" }), after: row({ version: 2, notes: long }), changed_fields: ["notes"], actor_user_id: "u", actor_name: "A", changed_at: "" });
  const [line] = describeHistoryEntry(entry);
  assert.ok(line.length < 120, line.length);
  assert.ok(line.includes("…"));
  const linked = historyFromRow({ id: 10, group_id: "gx", record_kind: "exam_session", record_id: "gexam_a1", action: "update", version: 2, before: row({ course_id: null, course_key: "nome:farmacologia speciale" }), after: row({ version: 2 }), changed_fields: ["course"], actor_user_id: "u", actor_name: "A", changed_at: "" });
  assert.deepEqual(describeHistoryEntry(linked), ["Corso: collegato al catalogo"]);
});

test("titolo e materia", () => {
  const session = sessionFromRow(row({ label: "Modulo A" }));
  assert.equal(sessionTitle(session), "Preappello · Farmacologia Speciale · Modulo A");
  assert.ok(sessionMatchesSubject(session, { name: "Altro", universityCourseId: "farm-spec" }));
  assert.ok(sessionMatchesSubject(session, { name: "farmacologia  SPECIALE" }));
  assert.ok(!sessionMatchesSubject(session, { name: "Farmacologia Generale" }));
});

test("id nuovi nella forma del server", () => {
  assert.match(newGroupRecordId("gexam"), /^gexam_[0-9a-f]{32}$/);
  assert.match(newGroupRecordId("gover"), /^[A-Za-z0-9_-]{1,120}$/);
});
