// Campi di una materia: le stesse regole nel modulo dell'app e negli strumenti degli agenti.
import test from "node:test";
import assert from "node:assert/strict";
import {
  SUBJECT_FIELD_ERRORS,
  SUBJECT_ICONS,
  SUBJECT_SEMESTER_IDS,
  newSubjectDraft,
  subjectDraftOf,
  subjectDraftProblem,
  subjectFieldsFromDraft,
  subjectFieldsProblem
} from "../src/lib/subjectFields.ts";
import { SEMESTER_IDS } from "../src/lib/semesters.ts";
import { readFileSync } from "node:fs";

test("semestri uguali a quelli dell'app (copiati per non caricare il catalogo negli strumenti)", () => {
  assert.deepEqual([...SUBJECT_SEMESTER_IDS], [...SEMESTER_IDS]);
});

test("ogni icona proposta esiste nel registro delle icone", () => {
  // Il registro è la mappa `icons` di Icon.tsx (che importa React: qui si legge il sorgente).
  const source = readFileSync(new URL("../src/components/Icon.tsx", import.meta.url), "utf8");
  const registry = source.slice(source.indexOf("const icons = {"), source.indexOf("} satisfies Record<string, LucideIcon>"));
  for (const icon of SUBJECT_ICONS) assert.match(registry, new RegExp(`^\\s+${icon.id},?$`, "m"), icon.id);
});

test("regole dei campi: nome, CFU, voto (31 = lode), colore, icona, stato, semestre", () => {
  assert.equal(subjectFieldsProblem({}, { requireName: true }), SUBJECT_FIELD_ERRORS.name);
  assert.equal(subjectFieldsProblem({ name: "x".repeat(161) }), SUBJECT_FIELD_ERRORS.nameLong);
  assert.equal(subjectFieldsProblem({ cfu: 61 }), SUBJECT_FIELD_ERRORS.cfu);
  assert.equal(subjectFieldsProblem({ cfu: "" }), SUBJECT_FIELD_ERRORS.cfu);
  assert.equal(subjectFieldsProblem({ targetGrade: 31 }), null);
  assert.equal(subjectFieldsProblem({ targetGrade: 17 }), SUBJECT_FIELD_ERRORS.targetGrade);
  assert.equal(subjectFieldsProblem({ targetGrade: 27.5 }), SUBJECT_FIELD_ERRORS.targetGrade);
  assert.equal(subjectFieldsProblem({ color: "red" }), SUBJECT_FIELD_ERRORS.color);
  assert.equal(subjectFieldsProblem({ icon: "Rocket" }), SUBJECT_FIELD_ERRORS.icon);
  assert.equal(subjectFieldsProblem({ icon: "barb:c39" }), null, "l'icona del corso resta valida");
  assert.equal(subjectFieldsProblem({ status: "boh" }), SUBJECT_FIELD_ERRORS.status);
  assert.equal(subjectFieldsProblem({ semesterOverride: "terzo" }), SUBJECT_FIELD_ERRORS.semester);
});

test("modulo: CFU vuoti non valgono 0; virgola accettata; semestre «ufficiale» senza scelta", () => {
  const draft = { ...newSubjectDraft("#9FB7FF"), name: "  Istologia ", cfu: "" };
  assert.equal(subjectDraftProblem(draft), SUBJECT_FIELD_ERRORS.cfu);
  const ok = { ...draft, cfu: "7,5", teacher: " Rossi ", targetGrade: "30" };
  assert.equal(subjectDraftProblem(ok), null);
  const fields = subjectFieldsFromDraft(ok);
  assert.equal(fields.name, "Istologia");
  assert.equal(fields.teacher, "Rossi");
  assert.equal(fields.cfu, 7.5);
  assert.equal(fields.targetGrade, 30);
  assert.equal(fields.semesterOverride, undefined);
  assert.equal(fields.semester, "Semestre");
  assert.equal(subjectFieldsFromDraft({ ...ok, semester: "secondo" }).semesterOverride, "secondo");
  assert.equal(subjectFieldsFromDraft(ok, { officialSemester: "primo", currentSemester: "x" }).semester, "primo");
});

test("modifica: il modulo riparte dai dati salvati e li restituisce uguali", () => {
  const subject = { id: "s", name: "Patologia", teacher: "Gandellini", cfu: 6, semester: "1° semestre", semesterOverride: "primo", targetGrade: 28, color: "#7CF7C8", icon: "Microscope", status: "review", notes: "n", archived: false, tags: [], createdAt: "", updatedAt: "" };
  const draft = subjectDraftOf(subject);
  assert.equal(subjectDraftProblem(draft), null);
  const fields = subjectFieldsFromDraft(draft, { currentSemester: subject.semester });
  for (const key of ["name", "teacher", "cfu", "semesterOverride", "targetGrade", "color", "icon", "status", "notes"]) assert.equal(fields[key], subject[key], key);
});
