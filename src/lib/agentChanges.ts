// Impostazioni → Agenti → «Modifiche del connettore»: voci del registro del connettore remoto
// (supabase/agent.sql) in frasi semplici, e l'esito di «Ripristina». Logica pura: niente rete né DOM.
import { auditTitle, changedFields, type AuditAction, type RestoreOutcome, type ServerAuditRow } from "../agent/remoteAudit";
import { AGENT_CHANGES_TEXT, CHANGE_ENTITY_LABEL, CHANGE_FIELD_LABEL } from "./labels/agentChanges";

export interface ConnectorChange {
  id: string;
  at: string;
  /** Chi l'ha fatta: nome del connettore (es. «ChatGPT») oppure «Tu, dall'app». */
  who: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  title: string;
  /** Frase per la persona: «Ha modificato l'attività «Ripasso»: titolo e scadenza.» */
  sentence: string;
  /** È un ripristino di un'altra voce. */
  undo: boolean;
  canRestore: boolean;
  restoredAt: string | null;
}

/** «titolo», «titolo e scadenza», «titolo, scadenza e note»; i campi senza nome diventano «altri dettagli». */
export const fieldsSentence = (fields: readonly string[]) => {
  const words: string[] = [];
  let other = false;
  for (const field of fields) {
    const word = CHANGE_FIELD_LABEL[field];
    if (!word) other = true;
    else if (!words.includes(word)) words.push(word);
  }
  if (other) words.push(AGENT_CHANGES_TEXT.otherFields);
  if (words.length <= 1) return words.join("");
  return `${words.slice(0, -1).join(", ")} e ${words.at(-1)}`;
};

export const toConnectorChange = (row: ServerAuditRow): ConnectorChange => {
  const what = CHANGE_ENTITY_LABEL[row.entity_type] ?? "l'elemento";
  const title = auditTitle(row.after, row.before) ?? AGENT_CHANGES_TEXT.unnamed;
  const sentence = row.action === "create"
    ? AGENT_CHANGES_TEXT.created(what, title)
    : row.action === "delete"
      ? AGENT_CHANGES_TEXT.deleted(what, title)
      : AGENT_CHANGES_TEXT.updated(what, title, fieldsSentence(changedFields(row.before, row.after)));
  return {
    id: row.id,
    at: row.created_at,
    who: row.from_app ? AGENT_CHANGES_TEXT.byApp : AGENT_CHANGES_TEXT.byConnector(row.grant_label),
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    title,
    sentence,
    undo: Boolean(row.restore_of),
    canRestore: row.can_restore === true,
    restoredAt: row.restored_at ?? null
  };
};

/** Domanda di conferma di «Ripristina»: dice cosa succede all'elemento. */
export const restoreQuestion = (change: Pick<ConnectorChange, "action" | "title">) => AGENT_CHANGES_TEXT.confirm[change.action](change.title);

export type RestoreNotice = { ok: boolean; text: string };

/** Frase dopo «Ripristina». */
export const restoreNotice = (outcome: RestoreOutcome | null): RestoreNotice => {
  switch (outcome?.status) {
    case "restored":
      return { ok: true, text: AGENT_CHANGES_TEXT.outcome.restored };
    case "conflict":
      return { ok: false, text: AGENT_CHANGES_TEXT.outcome.conflict };
    case "already_restored":
      return { ok: false, text: AGENT_CHANGES_TEXT.outcome.already };
    case "not_found":
      return { ok: false, text: AGENT_CHANGES_TEXT.outcome.notFound };
    default:
      return { ok: false, text: AGENT_CHANGES_TEXT.outcome.failed };
  }
};
