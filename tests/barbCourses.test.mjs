import test from "node:test";
import assert from "node:assert/strict";
import { BARB_DATASET } from "../src/data/university/barb.dataset.ts";
import { BARB_COURSE_VISUALS, courseColor, courseVisual } from "../src/lib/barbCourseVisuals.ts";
import { parseSubjectSemester, subjectSemester, SEMESTER_IDS } from "../src/lib/semesters.ts";

// This intentionally checks the merged official catalog, including added courses.
// A new activity must get a deliberate symbol instead of silently inheriting a fallback.
test("all 33 official BARB activities have an explicit scientific visual", () => {
  assert.equal(BARB_DATASET.courses.length, 33);
  assert.deepEqual(Object.keys(BARB_COURSE_VISUALS).sort(), BARB_DATASET.courses.map((course) => course.id).sort());
  const symbols = new Set();
  for (const course of BARB_DATASET.courses) {
    const visual = courseVisual(course);
    assert.notEqual(visual.kind, "unknown", course.name);
    assert.match(visual.color, /^#[0-9a-f]{6}$/i, course.name);
    assert.equal(courseColor(course), visual.color);
    symbols.add(visual.kind);
  }
  assert.equal(symbols.size, 33, "each activity has its own scientific schematic");
});

test("personal semester recognizes canonical and legacy labels without guessing unknown text", () => {
  const labels = ["primo", "1° semestre 2026/2027", "I semestre", "secondo", "2º semestre 2026/2027", "II semestre", "Annuale", "Periodo da definire", "estate"];
  assert.deepEqual(labels.map(parseSubjectSemester), ["primo", "primo", "primo", "secondo", "secondo", "secondo", "annuale", "non-definito", "non-definito"]);
});

test("official semester beats stale imported text; an explicit personal override wins", () => {
  const course = BARB_DATASET.courses.find((course) => course.semester === "secondo");
  const subject = { name: course.name, universityCourseId: course.id, semester: "1° semestre 2025/2026" };
  assert.equal(subjectSemester(subject), "secondo");
  assert.equal(subjectSemester({ ...subject, name: "My renamed course" }), "secondo");
  for (const semesterOverride of SEMESTER_IDS) assert.equal(subjectSemester({ ...subject, semesterOverride }), semesterOverride);
  assert.equal(subjectSemester({ name: "Materia personale", semester: "2° semestre" }), "secondo");
  assert.equal(subjectSemester({ name: "Materia personale", semester: "" }), "non-definito");
});

test("all personal semester buckets stay separate and preserve catalog unknown periods", () => {
  const buckets = Object.fromEntries(SEMESTER_IDS.map((semester) => [semester, []]));
  for (const course of BARB_DATASET.courses) {
    const semester = subjectSemester({ name: course.name, semester: "", universityCourseId: course.id });
    assert.equal(semester, course.semester);
    buckets[semester].push(course.id);
  }
  assert.equal(Object.values(buckets).flat().length, BARB_DATASET.courses.length);
  assert.ok(buckets.annuale.length > 0);
  assert.ok(buckets["non-definito"].length > 0);
});
