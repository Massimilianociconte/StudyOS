import test from "node:test";
import assert from "node:assert/strict";
import { cfuBySemester, nextSubjectColor, otherStatuses, semesterFilterOptions, subjectMenuItems } from "../src/lib/subjectCards.ts";

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
    "1° semestre 21 CFU · 2° semestre 6 CFU · senza semestre 0 CFU"
  );
  assert.equal(cfuBySemester([]), "");
  // Un solo periodo ripeterebbe il totale («6 CFU (Da definire 6 CFU)»): niente dettaglio.
  assert.equal(cfuBySemester([{ semester: "non-definito", cfu: 6 }]), "");
  assert.equal(cfuBySemester([{ semester: "primo", cfu: 6 }, { semester: "primo", cfu: 9 }]), "");
});

test("sottotitolo di Materie: parole semplici, senza «Da definire»", async () => {
  const { SUBJECTS_TEXT } = await import("../src/lib/labels/subjects.ts");
  assert.equal(SUBJECTS_TEXT.subtitle(1, 6, cfuBySemester([{ semester: "non-definito", cfu: 6 }])).startsWith("1 materia in corso · 6 CFU."), true);
  assert.ok(!SUBJECTS_TEXT.subtitle(1, 6, "").includes("Da definire"));
  const options = semesterFilterOptions(["primo", "non-definito"], "tutti");
  assert.deepEqual(options.map((option) => option.label), ["Tutte", "1° semestre", "Senza semestre"]);
});

test("menu della scheda: In corso, Superata (→ voto), Altro stato…, Archivia (con Annulla)", () => {
  const items = subjectMenuItems({ status: "active", archived: false });
  assert.deepEqual(items, [{ kind: "complete" }, { kind: "other" }, { kind: "archive" }]);
  assert.ok(!items.some((item) => item.kind === "delete"), "dalle materie in corso non si elimina per sempre");
  assert.deepEqual(subjectMenuItems({ status: "review", archived: false }), [
    { kind: "status", status: "active" },
    { kind: "complete" },
    { kind: "other" },
    { kind: "archive" }
  ]);
  // Superata: torna in corso o cambia stato, niente «Superata» di nuovo.
  assert.deepEqual(subjectMenuItems({ status: "completed", archived: false }), [{ kind: "status", status: "active" }, { kind: "other" }, { kind: "archive" }]);
});

test("menu della scheda: «Altro stato…» raccoglie gli stati meno usati, tranne quello attuale", () => {
  assert.deepEqual(otherStatuses({ status: "active" }), ["not-started", "review", "exam-ready"]);
  assert.deepEqual(otherStatuses({ status: "review" }), ["not-started", "exam-ready"]);
  // Ogni stato resta raggiungibile in due passi: dal menu o da «Altro stato…».
  for (const status of ["not-started", "active", "review", "exam-ready", "completed"]) {
    const reachable = new Set([
      ...subjectMenuItems({ status, archived: false }).flatMap((item) => (item.kind === "status" ? [item.status] : item.kind === "complete" ? ["completed"] : [])),
      ...otherStatuses({ status })
    ]);
    for (const other of ["not-started", "active", "review", "exam-ready", "completed"]) if (other !== status) assert.ok(reachable.has(other), `${status} → ${other}`);
  }
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
