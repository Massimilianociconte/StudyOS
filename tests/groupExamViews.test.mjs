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
