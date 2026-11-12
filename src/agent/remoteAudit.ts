// Registro del connettore remoto (supabase/agent.sql, 1.8.0): voci del server viste dagli agenti
// (studyos_list_audit, studyos_restore_change) e dall'app (Impostazioni → Agenti). Logica pura.
//
// Le immagini prima e dopo sono gli elementi dell'account, già senza file incorporati sul server.
// Verso gli agenti passano dalle stesse proiezioni degli altri strumenti (project.ts) e in più
// perdono a ogni profondità email, codici di invito, token, iscrizioni push e id di account.

import { COLLECTION_BY_ENTITY_TYPE } from "../lib/collections";
import { BRIEF_MAX, publicEntity, publicGroup, publicPreferences } from "./project";

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
  can_restore: boolean;
  total: number | string;
}

/** Esito di studyos_agent_restore / studyos_agent_restore_own. */
export type RestoreOutcome =
  | { status: "restored"; auditId: string; entityType: string; entityId: string; action: AuditAction; item: unknown }
  | { status: "conflict"; entityType: string; entityId: string; current: unknown; currentDeleted: boolean }
  | { status: "already_restored"; entityType: string; entityId: string; restoredAt: string }
  | { status: "not_found" };

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
  if (GROUP_TYPES.has(entityType)) {
    // Inviti, risorse e attività dei gruppi: il connettore non li scrive; se ce ne fossero, solo il nome.
    const clean = scrub(image) as Record<string, unknown>;
    return { id: clean.id, title: clean.title ?? clean.groupName ?? clean.text, status: clean.status };
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

/** Pagina come quella degli altri elenchi (`page` di toolkit), con il totale calcolato dal server. */
export const auditPage = (rows: readonly ServerAuditRow[], offset: number, limit: number) => {
  const total = rows.length ? Number(rows[0].total) || rows.length + offset : offset;
  const items = rows.map(auditEntryOut);
  const hasMore = offset + items.length < total;
  return { total, count: items.length, offset, limit, has_more: hasMore, ...(hasMore ? { next_offset: offset + items.length } : {}), items };
};
