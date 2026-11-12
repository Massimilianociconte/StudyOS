import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fieldsSentence, mergeActions, restoreNotice, restoreQuestion, toConnectorActions, toConnectorChange } from "../src/lib/agentChanges.ts";
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
  assert.equal(toConnectorChange(row({ grant_label: "" })).who, "Connettore remoto");
});

test("modifiche del connettore: i ripristini fatti dall'app parlano alla persona", () => {
  const app = { from_app: true, grant_label: "", restore_of: "x", tool: "studyos_restore_change" };
  const undo = toConnectorChange(row({ ...app, before: { id: "t", title: "A" }, after: { id: "t", title: "B" } }));
  assert.equal(undo.who, AGENT_CHANGES_TEXT.byApp);
  assert.equal(undo.undo, true);
  assert.equal(undo.sentence, "Hai riportato l'attività «B» com'era: titolo.");
  assert.equal(toConnectorChange(row({ ...app, action: "delete", before: { id: "t", title: "A" } })).sentence, "Hai eliminato l'attività «A».");
  assert.equal(toConnectorChange(row({ ...app, action: "create", entity_type: "studySession", after: { id: "s", title: "Sessione" } })).sentence, "Hai rimesso la sessione di studio «Sessione».");
  // Un ripristino fatto dal connettore resta in terza persona.
  assert.equal(toConnectorChange(row({ restore_of: "x", action: "delete", before: { id: "t", title: "A" } })).sentence, "Ha eliminato l'attività «A».");
});

test("modifiche del connettore: campi cambiati e campi senza nome", () => {
  assert.equal(fieldsSentence([]), "");
  assert.equal(fieldsSentence(["title"]), "titolo");
  assert.equal(fieldsSentence(["title", "dueDate"]), "titolo e scadenza");
  assert.equal(fieldsSentence(["color", "colorCustom"]), "colore");
  assert.equal(fieldsSentence(["title", "campoNuovo", "altroCampo"]), "titolo e altri dettagli");
  assert.equal(fieldsSentence(["campoNuovo"]), "altri dettagli");
});

test("modifiche del connettore: una richiesta con più elementi è un'azione sola", () => {
  const call = "11111111-2222-4333-8444-555555555555";
  const inCall = (patch) => row({ call_id: call, call_at: "2026-11-12T10:00:02.000Z", call_size: 7, call_can_restore: true, call_restored_at: null, tool: "studyos_delete_session", total: 2, ...patch });
  const actions = toConnectorActions([
    inCall({ id: "e1", action: "delete", entity_type: "studySession", entity_id: "s1", before: { id: "s1", title: "Sessione" } }),
    inCall({ id: "e2", entity_type: "goal", entity_id: "g1", before: { id: "g1", title: "Obiettivo", linkedSessionIds: ["s1"] }, after: { id: "g1", title: "Obiettivo", linkedSessionIds: [] }, can_restore: false }),
    row({ id: "legacy", restored_at: "2026-11-12T11:00:00.000Z", can_restore: false })
  ]);
  assert.equal(actions.length, 2);
  const [session, legacy] = actions;
  assert.equal(session.id, call);
  assert.equal(session.at, "2026-11-12T10:00:02.000Z");
  assert.equal(session.size, 7);
  assert.equal(session.more, 5);
  assert.equal(session.canRestore, true);
  assert.deepEqual(session.changes.map((change) => change.sentence), ["Ha eliminato la sessione di studio «Sessione».", "Ha modificato l'obiettivo «Obiettivo»: sessioni collegate."]);
  assert.equal(restoreQuestion(session), AGENT_CHANGES_TEXT.confirm.many(7));
  assert.match(restoreQuestion(session), /Le 7 modifiche tornano indietro insieme/);
  // agent.sql della prima revisione: la voce è un'azione da sola, con il suo stato.
  assert.equal(legacy.id, "legacy");
  assert.equal(legacy.size, 1);
  assert.equal(legacy.canRestore, false);
  assert.equal(legacy.restoredAt, "2026-11-12T11:00:00.000Z");
  // Rilettura: stessa azione aggiornata al suo posto, le nuove in fondo, nessun doppione.
  const merged = mergeActions(actions, [{ ...legacy, restoredAt: "dopo" }, { ...legacy, id: "nuova" }]);
  assert.deepEqual(merged.map((action) => action.id), [call, "legacy", "nuova"]);
  assert.equal(merged[1].restoredAt, "dopo");
});

test("modifiche del connettore: conferma e esito di «Ripristina»", () => {
  const one = (action, title) => ({ size: 1, changes: [{ action, title }] });
  assert.equal(restoreQuestion(one("create", "Lezione")), "Annullare questa modifica? «Lezione» sparisce dai tuoi dati.");
  assert.equal(restoreQuestion(one("update", "Ripasso")), "Annullare questa modifica? «Ripasso» torna com'era prima.");
  assert.equal(restoreQuestion(one("delete", "Dispense")), "Annullare questa modifica? «Dispense» torna tra i tuoi dati.");
  assert.deepEqual(restoreNotice({ status: "restored", auditId: "x", entityType: "task", entityId: "t", action: "update", item: {} }), { ok: true, text: AGENT_CHANGES_TEXT.outcome.restored });
  const many = restoreNotice({ status: "restored", callId: "c", changes: [{ auditId: "a", entityType: "task", entityId: "t", action: "update", item: {} }, { auditId: "b", entityType: "goal", entityId: "g", action: "update", item: {} }] });
  assert.deepEqual(many, { ok: true, text: AGENT_CHANGES_TEXT.outcome.restoredMany(2) });
  assert.equal(restoreNotice({ status: "conflict", entityType: "task", entityId: "t", current: null, currentDeleted: false }).text, AGENT_CHANGES_TEXT.outcome.conflict);
  // Azione con più elementi: dice quale è cambiato (titolo attuale, o quello dell'elenco).
  const conflict = { status: "conflict", items: 3, entityType: "note", entityId: "n1", current: { id: "n1", title: "Nota nuova" }, currentDeleted: false };
  assert.equal(restoreNotice(conflict).text, "Non annullata: «Nota nuova» è cambiato dopo. Si annulla tutto o niente, quindi non è stato toccato niente.");
  const gone = { ...conflict, current: null, currentDeleted: true };
  assert.match(restoreNotice(gone, { changes: [{ entityType: "note", entityId: "n1", title: "Nota vecchia" }] }).text, /«Nota vecchia» è cambiato dopo/);
  assert.match(restoreNotice(gone).text, /uno degli elementi è cambiato dopo/);
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
  // Dopo un ripristino si rilegge tutto ciò che era già mostrato, non solo la prima pagina.
  assert.match(drawer, /load\(items\.length \+ 1, true\)/);
  const cloud = read("../src/lib/agentCloud.ts");
  assert.match(cloud, /rpc\("studyos_agent_audit_own"/);
  assert.match(cloud, /rpc\("studyos_agent_restore_call_own"/);
  assert.match(cloud, /rpc\("studyos_agent_restore_own"/);
  // Testi della sola schermata: non si riesportano dalle etichette condivise.
  assert.doesNotMatch(read("../src/lib/labels.ts"), /labels\/agentChanges/);
  for (const value of Object.values(AGENT_CHANGES_TEXT)) {
    if (typeof value === "string") assert.doesNotMatch(value, /\bundefined\b/);
  }
});
