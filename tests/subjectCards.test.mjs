import test from "node:test";
import assert from "node:assert/strict";
import { cfuBySemester, nextSubjectColor, semesterFilterOptions, subjectMenuItems } from "../src/lib/subjectCards.ts";

test("semestre: un solo filtro con i conteggi, solo i semestri che hanno materie", () => {
  const options = semesterFilterOptions(["primo", "primo", "secondo", "annuale", "primo"], "tutti");
  assert.deepEqual(
    options.map((option) => [option.id, option.label, option.count]),
    [
      ["tutti", "Tutte", 5],
      ["primo", "1° semestre", 3],
      ["secondo", "2° semestre", 1],
      ["annuale", "Annuali", 1]
    ]
  );
});

test("semestre: il filtro scelto resta visibile anche senza materie (non sparisce sotto il dito)", () => {
  const options = semesterFilterOptions(["primo"], "secondo");
  assert.deepEqual(options.map((option) => [option.id, option.count]), [["tutti", 1], ["primo", 1], ["secondo", 0]]);
});

test("semestre: i CFU per semestre per il sottotitolo, nell'ordine dei semestri", () => {
  assert.equal(
    cfuBySemester([
      { semester: "secondo", cfu: 6 },
      { semester: "primo", cfu: 9 },
      { semester: "primo", cfu: 12 },
      { semester: "non-definito", cfu: 0 }
    ]),
    "1° semestre 21 CFU · 2° semestre 6 CFU · Da definire 0 CFU"
  );
  assert.equal(cfuBySemester([]), "");
});

test("menu della scheda: una materia in corso cambia stato o si archivia (con Annulla)", () => {
  const items = subjectMenuItems({ status: "active", archived: false });
  assert.deepEqual(items, [
    { kind: "status", status: "not-started" },
    { kind: "status", status: "review" },
    { kind: "status", status: "exam-ready" },
    { kind: "status", status: "completed" },
    { kind: "archive" }
  ]);
  assert.ok(!items.some((item) => item.kind === "delete"), "dalle materie in corso non si elimina per sempre");
});

test("menu della scheda: una materia archiviata si ripristina o si elimina per sempre", () => {
  assert.deepEqual(subjectMenuItems({ status: "archived", archived: false }), [{ kind: "restore" }, { kind: "delete" }]);
  // Vecchi dati: archiviata col solo flag, stato ancora "active".
  assert.deepEqual(subjectMenuItems({ status: "active", archived: true }), [{ kind: "restore" }, { kind: "delete" }]);
});

test("colore della nuova materia: il primo non ancora usato, poi a rotazione", () => {
  const swatches = ["#a", "#b", "#c"];
  assert.equal(nextSubjectColor([], swatches), "#a");
  assert.equal(nextSubjectColor([{ color: "#A", status: "active", archived: false }], swatches), "#b", "maiuscole e minuscole contano uguale");
  // Le archiviate non occupano un colore.
  assert.equal(nextSubjectColor([{ color: "#a", status: "archived", archived: false }], swatches), "#a");
  const full = [
    { color: "#a", status: "active", archived: false },
    { color: "#b", status: "active", archived: false },
    { color: "#c", status: "review", archived: false },
    { color: "#c", status: "active", archived: false }
  ];
  assert.equal(nextSubjectColor(full, swatches), "#b", "tutti usati: rotazione sul numero di materie");
});
