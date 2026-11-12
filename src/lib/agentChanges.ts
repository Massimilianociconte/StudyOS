// Impostazioni → Agenti → «Modifiche del connettore»: voci del registro del connettore remoto
// (supabase/agent.sql) in frasi semplici, raggruppate per richiesta (azione), e l'esito di «Ripristina».
// Logica pura: niente rete né DOM.
import {
  auditImage,
  auditTitle,
  callKeyOf,
  changedFields,
  groupByCall,
  restoreConflicts,
  restoredChanges,
  type AuditAction,
  type RestoreOutcome,
  type ServerAuditRow
} from "../agent/remoteAudit";
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

/** Una richiesta all'agente (una chiamata di uno strumento): una o più modifiche, annullate insieme. */
export interface ConnectorAction {
  /** callId (o l'id della voce, per le voci senza chiamata): è l'id da ripristinare. */
  id: string;
  at: string;
  who: string;
  /** È un ripristino (fatto dall'app o dal connettore). */
  undo: boolean;
  /** Modifiche arrivate (al massimo 5 per azione). */
  changes: ConnectorChange[];
  /** Modifiche dell'azione in tutto. */
  size: number;
  /** Modifiche non arrivate in elenco. */
  more: number;
  /** «Ripristina» annulla l'intera azione. */
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
  // Le voci scritte dall'app sono ripristini fatti dalla persona: «Hai eliminato…», non «Ha eliminato…».
  const words = row.from_app ? AGENT_CHANGES_TEXT.byYou : AGENT_CHANGES_TEXT.byAgent;
  const sentence = row.action === "create"
    ? words.created(what, title)
    : row.action === "delete"
      ? words.deleted(what, title)
      : words.updated(what, title, fieldsSentence(changedFields(row.before, row.after)));
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

/** Voci di una pagina in azioni, nell'ordine del server (la più recente prima). */
export const toConnectorActions = (rows: readonly ServerAuditRow[]): ConnectorAction[] =>
  groupByCall(rows).map((group) => {
    const first = group[0];
    const changes = group.map(toConnectorChange);
    const size = Math.max(Number(first.call_size) || group.length, group.length);
    // agent.sql della prima revisione: nessun dato della chiamata, la voce è un'azione da sola.
    const canRestore = first.call_can_restore ?? (group.length === 1 && first.can_restore === true);
    const restoredAt = first.call_size == null ? first.restored_at ?? null : first.call_restored_at ?? null;
    return {
      id: callKeyOf(first),
      at: first.call_at ?? first.created_at,
      who: changes[0].who,
      undo: changes.every((change) => change.undo),
      changes,
      size,
      more: size - changes.length,
      canRestore: canRestore === true,
      restoredAt
    };
  });

/** Aggiunge una pagina all'elenco già mostrato, senza doppioni (stesso id = stessa azione, aggiornata). */
export const mergeActions = (shown: readonly ConnectorAction[], page: readonly ConnectorAction[]) => {
  const fresh = new Map(page.map((action) => [action.id, action]));
  const kept = shown.map((action) => fresh.get(action.id) ?? action);
  const known = new Set(shown.map((action) => action.id));
  return [...kept, ...page.filter((action) => !known.has(action.id))];
};

/** Domanda di conferma di «Ripristina»: dice cosa succede agli elementi. */
export const restoreQuestion = (action: Pick<ConnectorAction, "size" | "changes">) => {
  if (action.size > 1 || action.changes.length !== 1) return AGENT_CHANGES_TEXT.confirm.many(action.size);
  const [change] = action.changes;
  return AGENT_CHANGES_TEXT.confirm[change.action](change.title);
};

export type RestoreNotice = { ok: boolean; text: string };

/** Frase dopo «Ripristina». Nel conflitto nomina l'elemento cambiato dopo (titolo attuale o dell'elenco). */
export const restoreNotice = (outcome: RestoreOutcome | null, action?: Pick<ConnectorAction, "changes">): RestoreNotice => {
  switch (outcome?.status) {
    case "restored": {
      const count = restoredChanges(outcome).length;
      return { ok: true, text: count > 1 ? AGENT_CHANGES_TEXT.outcome.restoredMany(count) : AGENT_CHANGES_TEXT.outcome.restored };
    }
    case "conflict": {
      const [first] = restoreConflicts(outcome);
      const listed = action?.changes.find((change) => change.entityType === first.entityType && change.entityId === first.entityId);
      const title = auditTitle(auditImage(first.entityType, first.current)) ?? (listed && listed.title !== AGENT_CHANGES_TEXT.unnamed ? listed.title : undefined);
      const items = Math.max(Number(outcome.items) || 1, 1);
      if (items > 1) return { ok: false, text: AGENT_CHANGES_TEXT.outcome.conflictMany(title) };
      return { ok: false, text: AGENT_CHANGES_TEXT.outcome.conflict };
    }
    case "already_restored":
      return { ok: false, text: AGENT_CHANGES_TEXT.outcome.already };
    case "not_found":
      return { ok: false, text: AGENT_CHANGES_TEXT.outcome.notFound };
    default:
      return { ok: false, text: AGENT_CHANGES_TEXT.outcome.failed };
  }
};
