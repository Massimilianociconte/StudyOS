import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("il calendario mostra gli appelli dei gruppi, li apre nel riquadro e non li trascina", () => {
  const view = source("src/views/CalendarView.tsx");
  assert.match(view, /groupExamEvents\(\{ sessions: groupSessions/);
  assert.match(view, /const groupSessionId = sessionIdOfEventId\(id\);/);
  assert.match(view, /if \(!item\.groupExam\) void moveEvent\(item, nextStart\);/);
  assert.match(view, /useUiState<GroupExamCalendarMode>\("calendar\.groupExams", "all", \{\n\s+scope: "device",\n\s+validate: oneOf\("all", "subjects", "off"\)/);
  assert.match(view, /lazy\(\(\) => import\("\.\.\/components\/groupExams\/GroupExamDrawer"\)\)/);
  // Supabase solo dentro il riquadro, mai nella vista.
  assert.doesNotMatch(view, /from "\.\.\/lib\/groupExamSync"/);
  assert.match(source("src/components/calendar/shared.ts"), /canDrag = \(item: CalendarOccurrence\) => !item\.groupExam && /);
});

test("«Condividi con il gruppo» solo per un mio evento d'esame singolo e non ancora collegato", () => {
  const view = source("src/views/CalendarView.tsx");
  assert.match(view, /item\.category !== "exam" \|\| normalizeRepeat\(item\) \|\| examPlans\.some\(\(plan\) => plan\.linkedEventId === item\.id\)/);
  assert.match(view, /onShareToGroup=\{shareToGroupFor\(editingEvent\)\}/);
  const editor = source("src/components/calendar/EventEditor.tsx");
  assert.match(editor, /\{onShareToGroup && !readOnly \? \(/);
  assert.match(editor, /discardThen === "shareToGroup" && onShareToGroup \? onShareToGroup : onClose/);
});
import { notificationJump } from "../src/lib/notificationJump.ts";

test("«Apri» di una notifica degli appelli porta alla scheda «Appelli» del gruppo", () => {
  const jump = notificationJump({ id: "notif-gexam-new-gexam_a", linkView: "groups", linkGroupId: "g1", createdAt: "2026-11-12T10:00:00Z" });
  assert.equal(jump.view, "groups");
  assert.deepEqual(jump.writes, [
    ["groups.open", "g1", "tab"],
    ["groups.detailTab", "appelli", "tab"]
  ]);
  const other = notificationJump({ id: "notif-group-x", linkView: "groups", linkGroupId: "g1", createdAt: "2026-11-12T10:00:00Z" });
  assert.deepEqual(other.writes, [["groups.open", "g1", "tab"]]);
});

test("schede del gruppo: «Appelli» con la stessa chiave, ora collegata", () => {
  const view = source("src/views/GroupsView.tsx");
  assert.match(view, /useLinkedUiState<DetailTab>\("groups\.detailTab", "bacheca", \{ scope: "tab", validate: oneOf\("bacheca", "membri", "attivita", "appelli"/);
  assert.match(view, /<GroupExamsTab groupId=\{group\.id\} \/>/);
});

test("pagina della materia: appelli del gruppo sotto quelli ufficiali, «Aggiungi al gruppo» da BARB", () => {
  const view = source("src/views/SubjectsView.tsx");
  assert.match(view, /<BarbExamSessions course=\{course\} onAddToGroup=\{hasExamGroups \?/);
  assert.match(view, /<SubjectGroupExams subject=\{subject\} draft=\{groupDraft\}/);
  assert.match(source("src/components/BarbExamSessions.tsx"), /onAddToGroup=\{onAddToGroup\}/);
});

test("«Docenti e aule»: scheda caricata solo quando si apre, link sempre filtrati", () => {
  const groups = source("src/views/GroupsView.tsx");
  assert.match(groups, /lazy\(\(\) => import\("\.\.\/components\/groupExams\/GroupCatalogTab"\)\)/);
  assert.match(groups, /oneOf\("bacheca", "membri", "attivita", "appelli", "catalogo"\)/);
  const corrections = source("src/components/groupExams/GroupCorrections.tsx");
  assert.match(corrections, /safeHref\(/);
  assert.doesNotMatch(corrections, /href=\{value\}/);
  const barb = source("src/views/BarbView.tsx");
  assert.match(barb, /<GroupCorrections kind="teacher" targetId=\{teacher\.id\} \/>/);
  assert.match(barb, /<GroupCorrections kind="contact" targetId=\{contactTargetId\(contact\.label\)\} \/>/);
});
