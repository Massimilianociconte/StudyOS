import test from "node:test";
import assert from "node:assert/strict";
import { addStep, chipFocusAfterRemove, cleanSteps, draftChanged, editorCloseRequest, priorityText, quickTaskChips, removeStep, renameStep, stepsDone, toggleStep } from "../src/lib/tasksUi.ts";

const STEPS = [
  { id: "s1", text: "Leggere il capitolo", done: true },
  { id: "s2", text: "Esercizi 1-5", done: false }
];

test("passaggi: aggiungere toglie gli spazi e ignora un testo vuoto", () => {
  assert.deepEqual(addStep(STEPS, "  Ripasso  ", "s3"), [...STEPS, { id: "s3", text: "Ripasso", done: false }]);
  assert.equal(addStep(STEPS, "   ", "s3"), STEPS);
  assert.equal(addStep(STEPS, "", "s3"), STEPS);
});

test("passaggi: spuntare cambia solo quel passaggio, senza toccare l'elenco di partenza", () => {
  const next = toggleStep(STEPS, "s2");
  assert.deepEqual(next.map((step) => step.done), [true, true]);
  assert.equal(STEPS[1].done, false);
  assert.deepEqual(toggleStep(next, "s1").map((step) => step.done), [false, true]);
  assert.deepEqual(toggleStep(STEPS, "nessuno"), STEPS);
});

test("passaggi: rinominare tiene il testo com'è mentre scrivi; togliere lo elimina", () => {
  assert.equal(renameStep(STEPS, "s2", "Esercizi 1-10 ")[1].text, "Esercizi 1-10 ");
  assert.equal(renameStep(STEPS, "s2", "")[1].text, "");
  assert.deepEqual(removeStep(STEPS, "s1"), [STEPS[1]]);
});

test("passaggi: al salvataggio i testi si puliscono e quelli rimasti vuoti spariscono", () => {
  const steps = [{ id: "a", text: " Uno ", done: false }, { id: "b", text: "   ", done: true }, { id: "c", text: "Tre", done: true }];
  assert.deepEqual(cleanSteps(steps), [{ id: "a", text: "Uno", done: false }, { id: "c", text: "Tre", done: true }]);
});

test("passaggi: il conto dei fatti è quello delle righe dell'elenco", () => {
  assert.deepEqual(stepsDone(STEPS), { done: 1, total: 2 });
  assert.deepEqual(stepsDone([]), { done: 0, total: 0 });
});

const SUBJECTS = [
  { id: "s1", name: "Analisi 1", color: "#ff0000" },
  { id: "s2", name: "Fisica", color: "#00ff00" }
];
const BLANK = { subjectId: "", priority: "medium", dueDate: "" };

test("aggiunta rapida: con le scelte di base non c'è nessuna pillola", () => {
  assert.deepEqual(quickTaskChips(BLANK, "", SUBJECTS), []);
});

test("aggiunta rapida: ogni scelta diversa da quella di base si vede come pillola", () => {
  const chips = quickTaskChips({ subjectId: "s2", priority: "urgent", dueDate: "2026-11-14" }, "", SUBJECTS);
  assert.deepEqual(chips, [
    { id: "subject", label: "Fisica", color: "#00ff00" },
    { id: "priority", label: "Urgente" },
    { id: "due", label: "Scade il 14 nov" }
  ]);
  assert.deepEqual(quickTaskChips({ ...BLANK, priority: "high" }, "", SUBJECTS), [{ id: "priority", label: "Priorità alta" }]);
  assert.deepEqual(quickTaskChips({ ...BLANK, priority: "low" }, "", SUBJECTS), [{ id: "priority", label: "Priorità bassa" }]);
});

test("aggiunta rapida: la materia del filtro attivo non fa pillola (si vede già nel filtro), un'altra sì", () => {
  assert.deepEqual(quickTaskChips({ ...BLANK, subjectId: "s1" }, "s1", SUBJECTS), []);
  assert.deepEqual(quickTaskChips({ ...BLANK, subjectId: "s2" }, "s1", SUBJECTS), [{ id: "subject", label: "Fisica", color: "#00ff00" }]);
  assert.deepEqual(quickTaskChips(BLANK, "s1", SUBJECTS), [{ id: "subject", label: "Nessuna materia" }], "materia tolta con il filtro attivo");
});

test("aggiunta rapida: una materia che non c'è più resta visibile invece di applicarsi di nascosto", () => {
  assert.deepEqual(quickTaskChips({ ...BLANK, subjectId: "gone" }, "", SUBJECTS), [{ id: "subject", label: "Materia eliminata" }]);
});

test("aggiunta rapida: una data non valida non fa pillola", () => {
  assert.deepEqual(quickTaskChips({ ...BLANK, dueDate: "domani" }, "", SUBJECTS), []);
});

test("aggiunta rapida: tolta una pillola, il focus va alla successiva, all'ultima rimasta o al campo", () => {
  assert.equal(chipFocusAfterRemove(0, 2), 0, "tolta la prima di tre: la nuova prima");
  assert.equal(chipFocusAfterRemove(1, 2), 1, "tolta quella in mezzo: la successiva");
  assert.equal(chipFocusAfterRemove(2, 2), 1, "tolta l'ultima: quella prima");
  assert.equal(chipFocusAfterRemove(0, 0), null, "nessuna rimasta: il campo");
});

test("priorità a parole: «Urgente» da sola, le altre con «Priorità»", () => {
  assert.equal(priorityText("urgent"), "Urgente");
  assert.equal(priorityText("medium"), "Priorità media");
});

const DRAFT = { title: "Esercizi", status: "doing", actualMinutes: "40", steps: STEPS };

test("editor: modifiche non salvate solo se qualcosa è davvero diverso da quando l'hai aperto", () => {
  assert.equal(draftChanged(DRAFT, { ...DRAFT }), false);
  assert.equal(draftChanged(DRAFT, { ...DRAFT, title: "Esercizi 1-10" }), true);
  assert.equal(draftChanged(DRAFT, { ...DRAFT, steps: toggleStep(STEPS, "s2") }), true);
  assert.equal(draftChanged(DRAFT, { ...DRAFT, steps: toggleStep(toggleStep(STEPS, "s2"), "s2") }), false, "spuntato e tolto");
});

test("editor: chiudere senza modifiche chiude; con modifiche chiede; chiudere di nuovo mentre chiede torna a modificare", () => {
  assert.equal(editorCloseRequest(false, false), "close");
  assert.equal(editorCloseRequest(true, false), "ask");
  assert.equal(editorCloseRequest(true, true), "keep");
});
