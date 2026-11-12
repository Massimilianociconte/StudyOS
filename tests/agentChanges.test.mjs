import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fieldsSentence, restoreNotice, restoreQuestion, toConnectorChange } from "../src/lib/agentChanges.ts";
import { AGENT_CHANGES_TEXT } from "../src/lib/labels/agentChanges.ts";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const row = (patch) => ({
  id: "0b9d3a5e-6c1f-4a2b-9e8d-7f6a5b4c3d2e",
  created_at: "2026-11-12T10:00:00.000+00:00",
  grant_label: "ChatGPT",
  from_app: false,
  tool: "studyos_update_task",
  entity_type: "task",
  entity_id: "task_1",
  action: "update",
  before: null,
  after: null,
  restore_of: null,
  restored_at: null,
  can_restore: true,
  total: 1,
  ...patch
});

test("modifiche del connettore: frasi semplici in italiano", () => {
  const updated = toConnectorChange(row({
    before: { id: "task_1", title: "Ripasso", dueDate: "a", notes: "", updatedAt: "1" },
    after: { id: "task_1", title: "Ripasso cap. 3", dueDate: "b", notes: "x", updatedAt: "2" }
  }));
  assert.equal(updated.sentence, "Ha modificato l'attività «Ripasso cap. 3»: scadenza, note e titolo.");
  assert.equal(updated.who, "ChatGPT");
  assert.equal(updated.canRestore, true);
  const created = toConnectorChange(row({ action: "create", entity_type: "calendarEvent", after: { id: "e1", title: "Lezione" } }));
  assert.equal(created.sentence, "Ha creato l'evento «Lezione».");
  const deleted = toConnectorChange(row({ action: "delete", entity_type: "attachment", before: { id: "a1", name: "Dispense" }, after: { id: "a1", deletedAt: "x" } }));
  assert.equal(deleted.sentence, "Ha eliminato il materiale «Dispense».");
  const untitled = toConnectorChange(row({ action: "create", entity_type: "misterioso", after: { id: "z" } }));
  assert.equal(untitled.sentence, "Ha creato l'elemento «senza titolo».");
  const undo = toConnectorChange(row({ from_app: true, grant_label: "", restore_of: "x", tool: "studyos_restore_change", before: { id: "t", title: "A" }, after: { id: "t", title: "B" } }));
  assert.equal(undo.who, AGENT_CHANGES_TEXT.byApp);
  assert.equal(undo.undo, true);
  assert.equal(toConnectorChange(row({ grant_label: "" })).who, "Connettore remoto");
});

test("modifiche del connettore: campi cambiati e campi senza nome", () => {
  assert.equal(fieldsSentence([]), "");
  assert.equal(fieldsSentence(["title"]), "titolo");
  assert.equal(fieldsSentence(["title", "dueDate"]), "titolo e scadenza");
  assert.equal(fieldsSentence(["color", "colorCustom"]), "colore");
  assert.equal(fieldsSentence(["title", "campoNuovo", "altroCampo"]), "titolo e altri dettagli");
  assert.equal(fieldsSentence(["campoNuovo"]), "altri dettagli");
});

test("modifiche del connettore: conferma e esito di «Ripristina»", () => {
  assert.equal(restoreQuestion({ action: "create", title: "Lezione" }), "Annullare questa modifica? «Lezione» sparisce dai tuoi dati.");
  assert.equal(restoreQuestion({ action: "update", title: "Ripasso" }), "Annullare questa modifica? «Ripasso» torna com'era prima.");
  assert.equal(restoreQuestion({ action: "delete", title: "Dispense" }), "Annullare questa modifica? «Dispense» torna tra i tuoi dati.");
  assert.deepEqual(restoreNotice({ status: "restored", auditId: "x", entityType: "task", entityId: "t", action: "update", item: {} }), { ok: true, text: AGENT_CHANGES_TEXT.outcome.restored });
  assert.equal(restoreNotice({ status: "conflict", entityType: "task", entityId: "t", current: null, currentDeleted: false }).text, AGENT_CHANGES_TEXT.outcome.conflict);
  assert.equal(restoreNotice({ status: "already_restored", entityType: "task", entityId: "t", restoredAt: "x" }).ok, false);
  assert.equal(restoreNotice({ status: "not_found" }).text, AGENT_CHANGES_TEXT.outcome.notFound);
  assert.equal(restoreNotice(null).text, AGENT_CHANGES_TEXT.outcome.failed);
});

test("modifiche del connettore: pannello pigro, in un Drawer, con supabase solo nel modulo pigro", () => {
  const desk = read("../src/components/AgentDesk.tsx");
  assert.match(desk, /import\("\.\/AgentChangesDrawer"\)/);
  assert.doesNotMatch(desk, /from "\.\/AgentChangesDrawer"/);
  assert.doesNotMatch(desk, /from "\.\.\/lib\/agentCloud"/);
  const drawer = read("../src/components/AgentChangesDrawer.tsx");
  assert.match(drawer, /<Drawer /);
  assert.match(drawer, /ConfirmWithError/);
  assert.match(drawer, /grid-cols-1/);
  const cloud = read("../src/lib/agentCloud.ts");
  assert.match(cloud, /rpc\("studyos_agent_audit_own"/);
  assert.match(cloud, /rpc\("studyos_agent_restore_own"/);
  // Testi della sola schermata: non si riesportano dalle etichette condivise.
  assert.doesNotMatch(read("../src/lib/labels.ts"), /labels\/agentChanges/);
  for (const value of Object.values(AGENT_CHANGES_TEXT)) {
    if (typeof value === "string") assert.doesNotMatch(value, /\bundefined\b/);
  }
});
