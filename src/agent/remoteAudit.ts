// Registro del connettore remoto (supabase/agent.sql, 1.8.0): voci del server viste dagli agenti
// (studyos_list_audit, studyos_restore_change) e dall'app (Impostazioni → Agenti). Logica pura.
//
// Le immagini prima e dopo sono gli elementi dell'account, già senza file incorporati sul server.
// Verso gli agenti passano dalle stesse proiezioni degli altri strumenti (project.ts) e in più
// perdono a ogni profondità email, codici di invito, token, iscrizioni push e id di account.

import { COLLECTION_BY_ENTITY_TYPE } from "../lib/collections";
import { BRIEF_MAX, agentMemberText, publicEntity, publicGroup, publicPreferences } from "./project";

export type AuditAction = "create" | "update" | "delete";

/** Riga di studyos_agent_audit_list / studyos_agent_audit_own. */
export interface ServerAuditRow {
  id: string;
  created_at: string;
  grant_label: string;
  /** Ripristino fatto dall'app, non dal connettore. */
  from_app: boolean;
  tool: string;
  entity_type: string;
  entity_id: string;
  action: AuditAction;
  before: unknown;
  after: unknown;
  restore_of: string | null;
  restored_at: string | null;
  /** Questa voce da sola si può annullare. */
  can_restore: boolean;
  /**
   * Chiamata dello strumento a cui appartiene la voce (agent.sql con call_id). Assente con l'agent.sql
   * della prima revisione: ogni voce è una chiamata da sola.
   */
  call_id?: string | null;
  call_at?: string | null;
  /** Voci della chiamata (anche quelle non arrivate in questa pagina). */
  call_size?: number | null;
  /** L'intera chiamata si può annullare. */
  call_can_restore?: boolean | null;
  /** Tutta la chiamata è già stata annullata (l'ultimo annullamento). */
  call_restored_at?: string | null;
  /** Chiamate (o voci, con l'agent.sql di prima) che rispettano i filtri. */
  total: number | string;
}

/** Un elemento rimesso da un ripristino. */
export interface RestoredChange {
  auditId: string;
  entityType: string;
  entityId: string;
  action: AuditAction;
  item: unknown;
}

/** Un elemento cambiato dopo la modifica da annullare: niente è stato scritto. */
export interface RestoreConflict {
  auditId?: string;
  entityType: string;
  entityId: string;
  current: unknown;
  currentDeleted: boolean;
}

/**
 * Esito di studyos_agent_restore(_own) e studyos_agent_restore_call(_own). In cima i campi del primo
 * elemento (come la risposta di una voce sola); `changes` e `conflicts` li hanno tutti.
 */
export type RestoreOutcome =
  | ({ status: "restored"; callId?: string; items?: number; changes?: RestoredChange[] } & Partial<RestoredChange>)
  | ({ status: "conflict"; items?: number; conflicts?: RestoreConflict[] } & RestoreConflict)
  | { status: "already_restored"; entityType: string; entityId: string; restoredAt: string }
  | { status: "not_found" };

/** Elementi rimessi (anche da una risposta di una voce sola, senza changes). */
export const restoredChanges = (outcome: Extract<RestoreOutcome, { status: "restored" }>): RestoredChange[] => {
  if (Array.isArray(outcome.changes)) return outcome.changes;
  return outcome.entityType && outcome.entityId && outcome.action
    ? [{ auditId: outcome.auditId ?? "", entityType: outcome.entityType, entityId: outcome.entityId, action: outcome.action, item: outcome.item }]
    : [];
};

/** Elementi in conflitto (anche da una risposta di una voce sola, senza conflicts). */
export const restoreConflicts = (outcome: Extract<RestoreOutcome, { status: "conflict" }>): RestoreConflict[] =>
  Array.isArray(outcome.conflicts) && outcome.conflicts.length
    ? outcome.conflicts
    : [{ entityType: outcome.entityType, entityId: outcome.entityId, current: outcome.current, currentDeleted: outcome.currentDeleted === true }];

/** Chiave della chiamata di una voce: call_id, o la voce stessa (hub o agent.sql di prima). */
export const callKeyOf = (row: Pick<ServerAuditRow, "id" | "call_id">) => row.call_id || row.id;

/** Voci di una pagina raggruppate per chiamata, nell'ordine in cui arrivano (la più recente prima). */
export const groupByCall = <T extends Pick<ServerAuditRow, "id" | "call_id">>(rows: readonly T[]): T[][] => {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = callKeyOf(row);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups.values()];
};

export const AUDIT_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Campi mai mostrati agli agenti, a qualsiasi profondità (membri, inviti, iscrizioni push). */
const SECRET_KEYS = new Set([
  "email",
  "recipientEmail",
  "inviteCode",
  "code",
  "token",
  "secret",
  "subscription",
  "pushSubscription",
  "endpoint",
  "p256dh",
  "auth",
  "handle",
  "userId",
  "ownerId",
  "fromUserId",
  "addedByUserId",
  "actorUserId"
]);

/** Campi che cambiano a ogni scrittura: non sono «cosa è cambiato». */
const STAMP_KEYS = new Set(["updatedAt", "createdAt", "deletedAt"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** Copia senza segreti né file (stringhe data:), a ogni profondità. */
const scrub = (value: unknown): unknown => {
  if (typeof value === "string") return value.startsWith("data:") ? undefined : value;
  if (Array.isArray(value)) return value.map(scrub).filter((item) => item !== undefined);
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEYS.has(key)) continue;
      const clean = scrub(item);
      if (clean !== undefined) out[key] = clean;
    }
    return out;
  }
  return value;
};

const GROUP_TYPES = new Set(["studyGroup", "groupInvite", "groupResource", "groupActivity"]);

/** Immagine di un elemento per un agente: la proiezione del suo tipo, senza segreti. */
export const auditImage = (entityType: string, image: unknown): Record<string, unknown> | undefined => {
  if (!isRecord(image)) return undefined;
  if (entityType === "preferences") {
    return publicPreferences(image as unknown as Parameters<typeof publicPreferences>[0]) as unknown as Record<string, unknown>;
  }
  if (entityType === "studyGroup") {
    const members = Array.isArray(image.members) ? image.members.filter(isRecord) : [];
    return publicGroup({ ...(image as unknown as Parameters<typeof publicGroup>[0]), members: members as never }) as unknown as Record<string, unknown>;
  }
  if (entityType === "examPlan") {
    // Il piano d'esame tiene una copia dell'appello scritta dai membri (corso, aula, gruppo): agli agenti
    // restano solo i dati senza testo libero.
    const clean = scrub(image) as Record<string, unknown>;
    const snapshot = isRecord(clean.snapshot) ? clean.snapshot : {};
    return publicEntity({
      ...clean,
      snapshot: { groupId: snapshot.groupId, date: snapshot.date, kind: snapshot.kind, time: snapshot.time, version: snapshot.version }
    });
  }
  if (GROUP_TYPES.has(entityType)) {
    // Inviti, risorse e attività dei gruppi: il connettore non li scrive; se ce ne fossero, solo il nome.
    const clean = scrub(image) as Record<string, unknown>;
    const title = clean.title ?? clean.groupName ?? clean.text;
    return { id: clean.id, title: typeof title === "string" ? agentMemberText(title) : title, status: clean.status };
  }
  if (entityType === "notification") {
    // Le notifiche copiano testo di appelli scritto dai membri (corso, aula, nomi): sempre oscurato.
    const clean = scrub(image) as Record<string, unknown>;
    const redact = (value: unknown) => (typeof value === "string" ? agentMemberText(value) : value);
    return publicEntity({ ...clean, title: redact(clean.title), body: redact(clean.body) });
  }
  return publicEntity(scrub(image) as object);
};

/** Campi diversi tra prima e dopo (senza i timbri), in ordine stabile. */
export const changedFields = (before: unknown, after: unknown): string[] => {
  if (!isRecord(before) || !isRecord(after)) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys]
    .filter((key) => !STAMP_KEYS.has(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]))
    .sort();
};

/** Titolo leggibile dell'elemento (task, eventi, materie, materiali…). */
export const auditTitle = (...images: unknown[]): string | undefined => {
  for (const image of images) {
    if (!isRecord(image)) continue;
    for (const key of ["title", "name", "displayName"]) {
      const value = image[key];
      if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
    }
  }
  return undefined;
};

/** Solo i campi indicati, con i testi lunghi accorciati e i loro nomi in `truncated`. */
const pickClipped = (image: Record<string, unknown> | undefined, keys: readonly string[]) => {
  if (!image) return undefined;
  const out: Record<string, unknown> = {};
  const truncated: string[] = [];
  for (const key of keys) {
    if (!(key in image)) continue;
    const value = image[key];
    if (typeof value === "string" && value.length > BRIEF_MAX) {
      out[key] = `${value.slice(0, BRIEF_MAX)}…`;
      truncated.push(key);
    } else {
      out[key] = value;
    }
  }
  return truncated.length ? { ...out, truncated } : out;
};

/** L'elemento intero, con i testi oltre BRIEF_MAX accorciati come negli elenchi. */
const clipLong = (image: Record<string, unknown> | undefined) => (image ? pickClipped(image, Object.keys(image)) : undefined);

/**
 * Voce del registro per un agente. Modifica: solo i campi cambiati, prima e dopo. Creazione: l'elemento
 * creato. Eliminazione: l'elemento com'era. canRestore dice se studyos_restore_change può annullarla.
 */
export const auditEntryOut = (row: ServerAuditRow) => {
  const before = auditImage(row.entity_type, row.before);
  const after = row.action === "delete" ? undefined : auditImage(row.entity_type, row.after);
  const changed = row.action === "update" ? changedFields(before, after) : [];
  return {
    id: row.id,
    at: row.created_at,
    tool: row.tool || undefined,
    by: row.from_app ? "app" : "connector",
    connector: row.from_app ? undefined : row.grant_label || undefined,
    collection: COLLECTION_BY_ENTITY_TYPE[row.entity_type] ?? row.entity_type,
    itemId: row.entity_id,
    title: auditTitle(after, before),
    action: row.action,
    ...(row.action === "update"
      ? { changed, before: pickClipped(before, changed), after: pickClipped(after, changed) }
      : row.action === "create"
        ? { after: clipLong(after) }
        : { before: clipLong(before) }),
    canRestore: row.can_restore === true,
    ...(row.restore_of ? { restoreOf: row.restore_of } : {}),
    ...(row.restored_at ? { restoredAt: row.restored_at } : {})
  };
};

/**
 * Una chiamata dello strumento per un agente: chi, quando, con quale strumento, e le sue modifiche
 * (al massimo 5 nell'elenco; tutte con il filtro callId). canRestore: studyos_restore_change con
 * callId (o l'id di una voce) annulla l'intera chiamata, tutto o niente.
 */
export const auditCallOut = (rows: readonly ServerAuditRow[]) => {
  const first = rows[0];
  const size = Math.max(Number(first.call_size) || rows.length, rows.length);
  const changes = rows.map((row) => {
    const { at: _at, tool: _tool, by: _by, connector: _connector, ...entry } = auditEntryOut(row);
    return entry;
  });
  const canRestore = first.call_can_restore ?? (rows.length === 1 && first.can_restore === true);
  return {
    callId: callKeyOf(first),
    at: first.call_at ?? first.created_at,
    tool: first.tool || undefined,
    by: first.from_app ? "app" : "connector",
    connector: first.from_app ? undefined : first.grant_label || undefined,
    size,
    ...(size > changes.length ? { moreChanges: size - changes.length } : {}),
    canRestore: canRestore === true,
    ...(first.call_restored_at ? { restoredAt: first.call_restored_at } : {}),
    ...(first.restore_of ? { isRestore: true } : {}),
    changes
  };
};

/**
 * Pagina come quella degli altri elenchi (`page` di toolkit), con il totale calcolato dal server:
 * limit, offset e total contano le chiamate.
 */
export const auditPage = (rows: readonly ServerAuditRow[], offset: number, limit: number) => {
  const total = rows.length ? Number(rows[0].total) || rows.length + offset : offset;
  const items = groupByCall(rows).map(auditCallOut);
  const hasMore = offset + items.length < total;
  return { total, count: items.length, offset, limit, has_more: hasMore, ...(hasMore ? { next_offset: offset + items.length } : {}), items };
};
