import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sessionFromRow, sessionToFields } from "../src/lib/groupExams.ts";
import { applyPlanPatch, newExamPlan } from "../src/lib/examPlans.ts";
import { groupExamEvents } from "../src/lib/groupExamCalendar.ts";
import { fieldText, resolveConflict, saveSession, sessionDraftFromEvent, draftFromBarb, courseFromSubject, sessionInputField, fieldsFromDraft, emptyDraft } from "../src/lib/groupExamForm.ts";
import { overrideInputField } from "../src/lib/catalogOverrides.ts";
import { registrationText } from "../src/lib/groupExamUi.ts";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = "2026-11-12T10:00:00.000Z";
const session = (over = {}) =>
  sessionFromRow({
    id: "gexam_a1", group_id: "gx", course_key: "barb:farm-spec", course_id: "farm-spec", course_name: "Farmacologia Speciale",
    exam_date: "2027-01-12", kind: "preappello", label: "", exam_time: "09:30", room: "Aula C03", notes: "",
    registration_opens: null, registration_closes: null, barb_session_id: null, source: "member", version: 1,
    created_by: "u-bea", created_by_name: "Bea", updated_by: "u-bea", updated_by_name: "Bea", deleted_at: null,
    deleted_by_name: null, created_at: NOW, updated_at: NOW, ...over
  });
const subject = { id: "sub_farm", name: "Farmacologia speciale", color: "#e11d48", archived: false, status: "active" };
const groupNames = new Map([["gx", "Farmaco"]]);

test("M1: un mio evento d'esame o un mio esame dello stesso giorno non si ripete nel calendario", () => {
  const myEvent = { id: "e1", title: "Appello · Farmacologia Speciale", category: "exam", start: "2027-01-12T00:00:00", end: "2027-01-13T00:00:00", allDay: true, recurrence: "none", archived: false, subjectId: "sub_farm" };
  const myExam = { id: "x1", subjectId: "sub_farm", date: "2027-01-12T08:00:00.000Z", archived: false };
  const base = { sessions: [session()], plans: [], groupNames, subjects: [subject], events: [], exams: [], mode: "all" };
  assert.equal(groupExamEvents(base).length, 1);
  assert.equal(groupExamEvents({ ...base, events: [myEvent] }).length, 0, "evento personale uguale");
  assert.equal(groupExamEvents({ ...base, exams: [myExam] }).length, 0, "esame personale uguale");
  const dismissed = applyPlanPatch(newExamPlan(session(), "Farmaco", NOW), { dismissMatch: "event:e1" }, session(), "Farmaco", NOW);
  assert.equal(groupExamEvents({ ...base, events: [myEvent], plans: [dismissed] }).length, 1, "«Tienili separati» li mostra entrambi");
  const linkedExam = applyPlanPatch(newExamPlan(session(), "Farmaco", NOW), { selected: true, examId: "x1" }, session(), "Farmaco", NOW);
  assert.equal(groupExamEvents({ ...base, exams: [{ ...myExam, date: "2027-02-01T08:00:00.000Z" }], plans: [linkedExam] }).length, 0, "piano collegato a un esame");
  assert.equal(groupExamEvents({ ...base, events: [{ ...myEvent, start: "2027-01-13T00:00:00" }] }).length, 1, "altro giorno");
});

test("H1: il modulo tiene la riga con cui si è aperto, non quella viva dello store", () => {
  const form = source("src/components/groupExams/GroupExamForm.tsx");
  assert.match(form, /const \[base\] = useState<GroupExamSession \| null>\(\(\) => session \?\? null\)/);
  assert.match(form, /base, mine: fields\.value/);
  assert.doesNotMatch(form, /base: session \?\? null/);
});

test("H1: un cambio arrivato mentre si modifica porta al conflitto, non a una sovrascrittura", async () => {
  const opened = session();
  const live = session({ room: "Aula G24", version: 2, updated_by_name: "Ada" });
  const mine = { ...sessionToFields(opened), date: "2027-01-14" };
  const calls = [];
  const writer = {
    saveSession: async (_g, _id, expected, fields) => {
      calls.push({ expected, fields });
      return expected === 1 ? { status: "conflict", row: live } : { status: "ok", row: session({ ...live, version: 3 }) };
    }
  };
  // `base` è la riga di partenza (v1) anche se lo store ora ha la v2.
  const outcome = await saveSession(writer, { groupId: "gx", id: opened.id, base: opened, mine, sessions: [live] });
  assert.equal(calls[0].expected, 1);
  assert.equal(outcome.kind, "saved");
  assert.equal(calls[1].fields.room, "Aula G24", "la modifica di Ada si conserva");
  assert.equal(calls[1].fields.date, "2027-01-14");
  // Stesso campo: conflitto da far scegliere.
  const clash = { ...sessionToFields(opened), room: "Aula B" };
  const again = await saveSession({ saveSession: async () => ({ status: "conflict", row: live }) }, { groupId: "gx", id: opened.id, base: opened, mine: clash, sessions: [live] });
  assert.equal(again.kind, "conflict");
  assert.deepEqual(again.conflicts, ["room"]);
});

test("L6: cambiare corso porta con sé anche il collegamento al catalogo e l'origine", () => {
  const base = session({ source: "barb", barb_session_id: "farm-spec:2027-01-12:written" });
  const mineFields = { ...sessionToFields(base), courseId: null, courseName: "Chimica", barbSessionId: null, source: "member" };
  const current = session({ source: "barb", barb_session_id: "farm-spec:2027-01-12:written", room: "Aula G24", version: 2 });
  const outcome = { kind: "conflict", base: sessionToFields(base), mine: mineFields, current, theirs: sessionToFields(current), merged: { ...sessionToFields(current), courseId: null, courseName: "Chimica" }, conflicts: ["course"] };
  const resolved = resolveConflict(outcome, {});
  assert.equal(resolved.courseId, null);
  assert.equal(resolved.source, "member");
  assert.equal(resolved.barbSessionId, null);
  const theirsPick = resolveConflict({ ...outcome, mine: sessionToFields(current), theirs: mineFields }, { course: "theirs" });
  assert.equal(theirsPick.source, "member");
});

test("L6: nell'unione automatica la modifica del corso porta origine e id BARB insieme", async () => {
  const base = session({ source: "barb", barb_session_id: "farm-spec:2027-01-12:written" });
  const current = session({ source: "barb", barb_session_id: "farm-spec:2027-01-12:written", room: "Aula G24", version: 2 });
  const mine = { ...sessionToFields(base), courseId: null, courseName: "Chimica", barbSessionId: null, source: "member" };
  const sent = [];
  const writer = {
    saveSession: async (_g, _id, expected, fields) => {
      sent.push(fields);
      return expected === 1 ? { status: "conflict", row: current } : { status: "ok", row: session({ version: 3 }) };
    }
  };
  await saveSession(writer, { groupId: "gx", id: base.id, base, mine, sessions: [current] });
  assert.equal(sent[1].courseName, "Chimica");
  assert.equal(sent[1].source, "member");
  assert.equal(sent[1].barbSessionId, null);
  assert.equal(sent[1].room, "Aula G24");
});

test("L4: nel conflitto un corso del catalogo si distingue da uno scritto a mano", () => {
  const typed = { ...sessionToFields(session()), courseId: null, courseName: "Farmacologia Speciale" };
  const catalogue = { ...typed, courseId: "farm-spec" };
  assert.notEqual(fieldText(typed, "course"), fieldText(catalogue, "course"));
  assert.match(fieldText(catalogue, "course"), /catalogo/);
});

test("L10: condividere un mio evento non copia le sue note nell'appello del gruppo", () => {
  const draft = sessionDraftFromEvent({ title: "Appello · Chimica", start: "2027-02-03T10:15:00", allDay: false, description: "Porta il libretto, sono in ansia" }, []);
  assert.equal(draft.notes, "");
  assert.equal(draft.time, "10:15");
});

test("L9: da una materia nota la bozza BARB sceglie la materia", () => {
  const draft = { ...draftFromBarb({ id: "x", courseId: "farm-spec", date: "2027-01-12", type: "written", time: null, location: null, notes: null, registrationOpens: null, registrationCloses: null }, "Farmacologia"), ...courseFromSubject(subject) };
  assert.equal(draft.subjectId, "sub_farm");
  const view = source("src/views/SubjectsView.tsx");
  assert.match(view, /\{ \.\.\.draftFromBarb\(session, course\.name\), \.\.\.courseFromSubject\(subject\) \}/);
});

test("L8: i testi delle iscrizioni stanno nelle etichette", () => {
  assert.equal(registrationText("2026-12-01", "2027-01-08"), "dal 01/12/2026 al 08/01/2027");
  assert.equal(registrationText(null, "2027-01-08"), "fino al 08/01/2027");
  assert.doesNotMatch(source("src/lib/groupExamUi.ts"), /`dal |`fino al /);
});

test("M2: offline il riquadro mostra la copia salvata, non un caricamento senza fine", () => {
  assert.match(source("src/components/groupExams/GroupExamDrawer.tsx"), /if \(!session && !plan && !ready\) return/);
});

test("M3: le note del piano si salvano mentre si scrive e alla chiusura", () => {
  const plan = source("src/components/groupExams/MyPlanSection.tsx");
  assert.match(plan, /window\.setTimeout\(\(\) => latest\.current\.save\(latest\.current\.notes\), NOTES_SAVE_DELAY_MS\)/);
  assert.match(plan, /\(\) => \(\) => \{\s+const \{ notes: typed, saved, save \} = latest\.current;\s+if \(typed !== saved\) save\(typed\);/);
});

test("M4: l'errore di un campo va all'input giusto, quelli generali restano un messaggio", () => {
  assert.equal(sessionInputField("courseName"), "course");
  assert.equal(sessionInputField("courseId"), "course");
  assert.equal(sessionInputField("registrationOrder"), "registrationCloses");
  assert.equal(sessionInputField("date"), "date");
  assert.equal(sessionInputField("rate"), undefined);
  assert.equal(sessionInputField(undefined), undefined);
  const bad = fieldsFromDraft({ ...emptyDraft(), courseName: "Farmacologia", date: "2027-02-30" });
  assert.equal(bad.ok, false);
  assert.equal(sessionInputField(bad.field), "date");
  assert.equal(overrideInputField("contact", "targetLabel"), "label");
  assert.equal(overrideInputField("teacher", "targetLabel"), undefined);
  assert.equal(overrideInputField("teacher", "email"), "email");
  assert.equal(overrideInputField("teacher", "boh"), undefined);
  const form = source("src/components/groupExams/GroupExamForm.tsx");
  assert.match(form, /fail\(result\.message, sessionInputField\(result\.field\)\)/);
  assert.match(form, /fail\(fields\.message, sessionInputField\(fields\.field\)\)/);
  const drawer = source("src/components/groupExams/OverrideDrawer.tsx");
  assert.match(drawer, /showFailure\(result\.message \?\? T\.actionFailed, result\.field\)/);
  assert.match(drawer, /showFailure\(clean\.message, clean\.field\)/);
  const errors = source("src/components/groupExams/FieldError.tsx");
  assert.match(errors, /"aria-invalid"/);
  assert.match(errors, /"aria-describedby"/);
  assert.match(errors, /role="alert"/);
  assert.match(errors, /\.focus\(\)/);
});

test("L11: un contatto nuovo ha bisogno del nome", () => {
  assert.match(source("src/components/groupExams/OverrideDrawer.tsx"), /kind === "contact" && !targetLabel && !\(draft\.label \?\? ""\)\.trim\(\)/);
});

test("L1 e L2: promemoria autonomi con focus, errore e conferma prima di eliminare", () => {
  const view = source("src/components/StandaloneReminders.tsx");
  assert.match(view, /titleRef\.current\?\.focus\(\)/);
  assert.match(view, /standalone-reminder-add"\)\?\.focus\(\)/);
  assert.match(view, /catch \{\s+setError\(T\.addFailed\)/);
  assert.match(view, /<InlineConfirm/);
  assert.doesNotMatch(view, /onClick=\{\(\) => void deleteReminder/);
});

test("L3, L5, L7, L13: focus dopo il modulo, nome del gruppo, nomi dei pulsanti, un solo segnale", () => {
  const drawer = source("src/components/groupExams/GroupExamDrawer.tsx");
  assert.match(drawer, /bodyRef\.current\?\.focus\(\)/);
  assert.match(drawer, /useGroupExamStore\.getState\(\)\.groups\.find\(\(item\) => item\.id === saved\.groupId\)/);
  assert.match(source("src/components/groupExams/GroupCatalogTab.tsx"), /aria-label=\{T\.correctAria\(title\)\}/);
  assert.match(source("src/components/groupExams/HistoryList.tsx"), /aria-label=\{T\.restoreAria\(/);
  assert.doesNotMatch(source("src/components/groupExams/GroupExamList.tsx"), /aria-pressed/);
});
