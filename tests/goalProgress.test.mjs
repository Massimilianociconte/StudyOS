import test from "node:test";
import assert from "node:assert/strict";
import { goalDeadlineLabel, goalDraftChanged, goalDraftOf, goalDraftWith, goalMove, goalStep, statusForProgress } from "../src/lib/goalProgress.ts";

test("obiettivi: lo stato segue il progresso (100 → raggiunto, sotto 100 un raggiunto torna attivo)", () => {
  assert.equal(statusForProgress("active", 100), "done");
  assert.equal(statusForProgress("paused", 100), "done");
  assert.equal(statusForProgress("done", 95), "active");
  assert.equal(statusForProgress("done", 100), "done");
  assert.equal(statusForProgress("active", 40), "active");
  // In pausa resta in pausa sotto il 100; archiviato resta archiviato (scelta esplicita).
  assert.equal(statusForProgress("paused", 40), "paused");
  assert.equal(statusForProgress("archived", 100), "archived");
  assert.equal(statusForProgress("archived", 20), "archived");
});

test("obiettivi: + e − di 5 tra 0 e 100, con lo stato che segue", () => {
  assert.deepEqual(goalStep({ progress: 95, status: "active" }, 5), { progress: 100, status: "done" });
  assert.deepEqual(goalStep({ progress: 100, status: "done" }, -5), { progress: 95, status: "active" });
  assert.deepEqual(goalStep({ progress: 100, status: "done" }, 5), { progress: 100, status: "done" });
  assert.deepEqual(goalStep({ progress: 0, status: "active" }, -5), { progress: 0, status: "active" });
  assert.deepEqual(goalStep({ progress: 97, status: "active" }, 5), { progress: 100, status: "done" });
});

test("obiettivi: nel dettaglio progresso e stato restano d'accordo", () => {
  const base = { title: "x", progress: 60, status: "active" };
  assert.deepEqual(goalDraftWith(base, { progress: 100 }), { ...base, progress: 100, status: "done" });
  assert.deepEqual(goalDraftWith({ ...base, progress: 100, status: "done" }, { progress: 80 }), { ...base, progress: 80, status: "active" });
  // «Raggiunto» scelto a mano porta il progresso al 100%.
  assert.deepEqual(goalDraftWith(base, { status: "done" }), { ...base, progress: 100, status: "done" });
  // «Attivo» o «In pausa» al 100% scendono al 95%, altrimenti tornerebbero subito raggiunti.
  assert.deepEqual(goalDraftWith({ ...base, progress: 100, status: "done" }, { status: "active" }), { ...base, progress: 95, status: "active" });
  assert.deepEqual(goalDraftWith({ ...base, progress: 100, status: "done" }, { status: "paused" }), { ...base, progress: 95, status: "paused" });
  // Archiviare non tocca il progresso.
  assert.deepEqual(goalDraftWith({ ...base, progress: 100, status: "done" }, { status: "archived" }), { ...base, progress: 100, status: "archived" });
});

test("obiettivi: cambia gruppo solo passando tra «in corso» e «raggiunti e archiviati»", () => {
  assert.equal(goalMove("active", "done"), "reached");
  assert.equal(goalMove("paused", "done"), "reached");
  assert.equal(goalMove("archived", "done"), null);
  assert.equal(goalMove("active", "archived"), "archived");
  assert.equal(goalMove("done", "archived"), null);
  assert.equal(goalMove("done", "active"), "reopened");
  assert.equal(goalMove("archived", "paused"), "reopened");
  assert.equal(goalMove("active", "paused"), null);
  assert.equal(goalMove("done", "done"), null);
});

test("obiettivi: scadenza passata in rosso solo se l'obiettivo è ancora da raggiungere", () => {
  // Mezzogiorno locale e scadenze come le salva il dettaglio (giorno civile): niente dipendenza dal fuso.
  const now = new Date(2026, 10, 12, 12, 0, 0);
  assert.deepEqual(goalDeadlineLabel("2026-11-03", "active", now), { text: "Scaduto il 3 nov", late: true });
  assert.deepEqual(goalDeadlineLabel("2026-11-03", "paused", now), { text: "Scaduto il 3 nov", late: true });
  assert.deepEqual(goalDeadlineLabel("2026-11-03", "done", now), { text: "Scadenza 3 nov", late: false });
  assert.deepEqual(goalDeadlineLabel("2026-11-03", "archived", now), { text: "Scadenza 3 nov", late: false });
  assert.deepEqual(goalDeadlineLabel("2026-11-12", "active", now), { text: "Scade oggi", late: false });
  assert.deepEqual(goalDeadlineLabel("2026-11-13", "active", now), { text: "Scade domani", late: false });
  assert.deepEqual(goalDeadlineLabel("2026-11-20", "active", now), { text: "Scade tra 8 giorni · 20 nov", late: false });
  assert.equal(goalDeadlineLabel(undefined, "active", now), null);
  assert.equal(goalDeadlineLabel("non una data", "active", now), null);
});

test("obiettivi: il dettaglio sa se chiudere perderebbe modifiche", () => {
  const goal = {
    id: "g1", title: "Finire Anatomia", description: "", category: "study", startDate: "2026-11-01",
    deadline: "2026-12-20T00:00:00.000Z", progress: 40, metric: "", linkedTaskIds: [], linkedSessionIds: [],
    status: "active", notes: "", createdAt: "2026-11-01T00:00:00.000Z", updatedAt: "2026-11-01T00:00:00.000Z"
  };
  const saved = goalDraftOf(goal);
  assert.deepEqual(saved, { title: "Finire Anatomia", description: "", category: "study", deadline: "2026-12-20", progress: 40, status: "active", notes: "" });
  assert.equal(goalDraftOf({ ...goal, deadline: undefined }).deadline, "");
  assert.equal(goalDraftChanged({ ...saved }, saved), false);
  // Il cursore al 100% cambia anche lo stato: è una modifica da non perdere.
  assert.equal(goalDraftChanged(goalDraftWith(saved, { progress: 100 }), saved), true);
  assert.equal(goalDraftChanged({ ...saved, notes: "Capitoli 3-5" }, saved), true);
  assert.equal(goalDraftChanged({ ...saved, deadline: "" }, saved), true);
});
