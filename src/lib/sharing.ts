// Logica pura della condivisione tra account: sezioni, copertura (specchio esatto di
// studyos_scope_covers in supabase/sharing.sql), permessi, cache dei dati altrui e link di invito.
// Nessun import di Supabase o Dexie: la usano store, viste, agente MCP e test.

import { timestampOf, type SyncableEntity } from "./collections";
import { inviteLinkBase } from "./groups";
import { scopesSummary } from "./labels";

export const SHARE_SCOPES = ["calendar", "barb_exams", "tasks", "study", "progress", "materials", "goals"] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];
export type SharePermission = "view" | "edit";

export const SCOPE_ENTITY_TYPES: Record<ShareScope, readonly string[]> = {
  calendar: ["calendarEvent"],
  barb_exams: ["calendarEvent"],
  tasks: ["task"],
  study: ["studySession", "studyTopic"],
  progress: ["exam"],
  materials: ["attachment", "note"],
  goals: ["goal"]
};

/** Date ufficiali: si condividono solo in lettura. */
export const VIEW_ONLY_SCOPES: ReadonlySet<ShareScope> = new Set<ShareScope>(["barb_exams"]);
/** Sezioni senza materia: il filtro per materie non si applica. */
export const SUBJECTLESS_SCOPES: ReadonlySet<ShareScope> = new Set<ShareScope>(["goals"]);

export const isShareScope = (value: unknown): value is ShareScope =>
  typeof value === "string" && (SHARE_SCOPES as readonly string[]).includes(value);

const isPermission = (value: unknown): value is SharePermission => value === "view" || value === "edit";

/** Accesso attivo (riga di studyos_shares). */
export interface ShareGrant {
  id: string;
  ownerId: string;
  ownerName: string;
  scope: ShareScope;
  subjectIds: string[];
  permission: SharePermission;
  granteeUserId: string | null;
  granteeGroupId: string | null;
  granteeName: string;
  granteeEmail: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShareOffer {
  scope: ShareScope;
  permission: SharePermission;
  subjectIds: string[];
  /** Solo per l'anteprima di chi riceve: il server non li usa per i permessi. */
  subjectNames: string[];
}

export interface ShareRequest {
  scope: ShareScope;
  permission: SharePermission;
}

export type ShareInviteStatus = "pending" | "accepted" | "declined" | "expired";

export interface ShareInviteSummary {
  id: string;
  ownerId: string;
  ownerName: string;
  offers: ShareOffer[];
  requests: ShareRequest[];
  /** Visibile solo a chi ha creato l'invito (RLS): mai inviata agli agenti. */
  recipientEmail: string | null;
  status: ShareInviteStatus;
  expiresAt: string;
  createdAt: string;
}

export type SharedEntity = SyncableEntity & Record<string, unknown>;

/** Elemento di un'altra persona nella cache locale. */
export interface SharedItem {
  key: string;
  ownerId: string;
  entityType: string;
  entityId: string;
  entity: SharedEntity;
  serverUpdatedAt: string;
}

export interface SharedSubjectLabel {
  ownerId: string;
  id: string;
  name: string;
  color: string;
  icon: string;
}

/** Marcatura "di altri" che accompagna un elemento condiviso nelle viste. */
export interface SharedOrigin {
  ownerId: string;
  ownerName: string;
  canEdit: boolean;
  color: string;
  initials: string;
  subjectName?: string;
  subjectColor?: string;
}

export interface ItemRevision {
  id: number;
  entityType: string;
  entityId: string;
  payload: Record<string, unknown>;
  deleted: boolean;
  change: "create" | "update" | "delete";
  changedBy: string | null;
  changedAt: string;
}

export interface RemoteSharedRow {
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  deleted: boolean;
  updated_at: string;
}

type Payload = Record<string, unknown>;

const str = (value: unknown) => (typeof value === "string" ? value : undefined);

/** Materia a cui appartiene un elemento: materiali e note solo se collegati a una materia. */
export const subjectOfPayload = (entityType: string, payload: Payload): string | undefined => {
  if (entityType === "attachment" || entityType === "note") {
    return payload.linkedEntityType === "subject" ? str(payload.linkedEntityId) : undefined;
  }
  return str(payload.subjectId);
};

export const scopeCovers = (scope: ShareScope, entityType: string, payload: Payload, subjectIds: readonly string[] = []): boolean => {
  if (!SCOPE_ENTITY_TYPES[scope].includes(entityType)) return false;
  if (scope === "barb_exams" && !(str(payload.sourceUid) ?? "").startsWith("barb-exam-")) return false;
  // I progressi sono gli esami ancora da sostenere: il libretto (voti) non si condivide.
  if (scope === "progress" && ((payload.grade !== undefined && payload.grade !== null) || payload.passFail === true)) return false;
  if (!subjectIds.length) return true;
  const subject = subjectOfPayload(entityType, payload);
  return subject !== undefined && subjectIds.includes(subject);
};

const strongest = (grants: readonly ShareGrant[]): SharePermission | null =>
  grants.length ? (grants.some((grant) => grant.permission === "edit") ? "edit" : "view") : null;

/** Permesso di chi guarda su un elemento di `ownerId` (condivisioni dirette e di gruppo). */
export const itemAccess = (received: readonly ShareGrant[], ownerId: string, entityType: string, payload: Payload) =>
  strongest(received.filter((grant) => grant.ownerId === ownerId && scopeCovers(grant.scope, entityType, payload, grant.subjectIds)));

/** Permesso sul tipo ignorando i filtri (come studyos_type_access: serve alle eliminazioni). */
export const typeAccess = (received: readonly ShareGrant[], ownerId: string, entityType: string) =>
  strongest(received.filter((grant) => grant.ownerId === ownerId && SCOPE_ENTITY_TYPES[grant.scope].includes(entityType)));

/** Per ogni proprietario, i tipi di entità da scaricare. */
export const ownerEntityTypes = (received: readonly ShareGrant[]) => {
  const result = new Map<string, string[]>();
  for (const grant of received) {
    const types = result.get(grant.ownerId) ?? [];
    for (const type of SCOPE_ENTITY_TYPES[grant.scope]) if (!types.includes(type)) types.push(type);
    result.set(grant.ownerId, types);
  }
  return result;
};

/**
 * Firma di ciò che `ownerId` condivide con chi guarda. Se cambia (sezione nuova, materie in più)
 * il cursore non vale più: righe vecchie diventano visibili e vanno scaricate da capo.
 */
export const grantSignature = (received: readonly ShareGrant[], ownerId: string) =>
  JSON.stringify(
    received
      .filter((grant) => grant.ownerId === ownerId)
      .map((grant) => `${grant.scope}:${[...grant.subjectIds].sort().join(",")}`)
      .sort()
  );

export const sharedKey =(ownerId: string, entityType: string, entityId: string) => `${ownerId}:${entityType}:${entityId}`;

/** Applica righe del server alla cache (LWW). Una scrittura locale in coda e più recente vince. */
export const mergeSharedRows = (
  items: readonly SharedItem[],
  ownerId: string,
  rows: readonly RemoteSharedRow[],
  pending: ReadonlySet<string>
): SharedItem[] => {
  const byKey = new Map(items.map((entry) => [entry.key, entry]));
  for (const row of rows) {
    const key = sharedKey(ownerId, row.entity_type, row.entity_id);
    const local = byKey.get(key);
    // Ai destinatari il tombstone arriva ridotto a {id, deletedAt}: senza updatedAt vale deletedAt.
    const remoteAt = str(row.payload.updatedAt) ?? str(row.payload.deletedAt);
    if (pending.has(key) && local && timestampOf(local.entity.updatedAt) > timestampOf(remoteAt)) continue;
    if (row.deleted) {
      byKey.delete(key);
      continue;
    }
    byKey.set(key, {
      key,
      ownerId,
      entityType: row.entity_type,
      entityId: row.entity_id,
      entity: row.payload as SharedEntity,
      serverUpdatedAt: row.updated_at
    });
  }
  return [...byKey.values()];
};

/**
 * Una mia eliminazione in coda non lascia l'elemento in cache, quindi mergeSharedRows non la
 * riconosce: una riga del server non più recente dell'eliminazione lo riporterebbe in vita.
 * Toglie quelle righe (i tombstone e le modifiche del proprietario successive restano).
 */
export const withoutSupersededRows = (rows: readonly RemoteSharedRow[], ownerId: string, outbox: readonly SharedOutboxEntry[]) => {
  const tombstones = new Map(outbox.filter((entry) => entry.deleted).map((entry) => [entry.key, entry]));
  if (!tombstones.size) return rows;
  return rows.filter((row) => {
    const tombstone = row.deleted ? undefined : tombstones.get(sharedKey(ownerId, row.entity_type, row.entity_id));
    if (!tombstone) return true;
    return timestampOf(str(row.payload.updatedAt)) > timestampOf(tombstone.deletedAt ?? tombstone.queuedAt);
  });
};

/**
 * Toglie gli elementi di `ownerId` che il server non mostra più (revoca, filtro cambiato,
 * materia esclusa, voto registrato). `visible` contiene le chiavi `${tipo}:${id}` vive.
 */
export const reconcileOwner = (
  items: readonly SharedItem[],
  ownerId: string,
  types: readonly string[],
  visible: ReadonlySet<string>,
  pending: ReadonlySet<string>
) =>
  items.filter(
    (entry) =>
      entry.ownerId !== ownerId ||
      !types.includes(entry.entityType) ||
      pending.has(entry.key) ||
      visible.has(`${entry.entityType}:${entry.entityId}`)
  );

/** Via gli elementi di proprietari o tipi non più condivisi. */
export const dropUnshared = (items: readonly SharedItem[], received: readonly ShareGrant[], pending: ReadonlySet<string>) => {
  const allowed = ownerEntityTypes(received);
  return items.filter((entry) => pending.has(entry.key) || Boolean(allowed.get(entry.ownerId)?.includes(entry.entityType)));
};

/** Campi che puntano a entità del proprietario: chi riceve non li vede, quindi non li cambia. */
const OWNER_LINK_FIELDS = ["attachmentIds", "goalId", "linkedTaskIds", "linkedSessionIds"] as const;

export const prepareSharedWrite = (previous: Payload | undefined, next: Payload, now: string): Payload => {
  const result: Payload = { ...next, updatedAt: now };
  for (const field of OWNER_LINK_FIELDS) {
    if (previous) {
      // Modifica: il collegamento resta quello del proprietario (anche se prima non c'era).
      if (field in previous) result[field] = previous[field];
      else delete result[field];
    } else if (field in result) {
      // Nuovo elemento: chi lo crea non conosce le entità del proprietario.
      result[field] = Array.isArray(result[field]) ? [] : undefined;
    }
  }
  return result;
};

/** Voce della coda di scritture sui dati altrui: solo chiavi, il contenuto sta nella cache. */
export interface SharedOutboxEntry {
  key: string;
  ownerId: string;
  entityType: string;
  entityId: string;
  deleted: boolean;
  deletedAt?: string;
  queuedAt: string;
}

export interface SharedPushBatch {
  ownerId: string;
  entries: SharedOutboxEntry[];
  rows: { entity_type: string; entity_id: string; payload: Payload; deleted: boolean }[];
}

/** Perché una scrittura su dati altrui non è consentita (null = consentita). Specchio di push_shared_rows. */
export const sharedWriteError = (
  received: readonly ShareGrant[],
  ownerId: string,
  entityType: string,
  previous: Payload | undefined,
  next: Payload | null
): string | null => {
  if (previous && itemAccess(received, ownerId, entityType, previous) !== "edit") return "Puoi solo vedere questo elemento.";
  if (next && itemAccess(received, ownerId, entityType, next) !== "edit") {
    if (previous) return "Con questa modifica l'elemento uscirebbe da ciò che ti è stato condiviso.";
    return typeAccess(received, ownerId, entityType) === "edit"
      ? "Questo elemento non rientra in ciò che ti è stato condiviso: controlla la materia."
      : "Non puoi aggiungere elementi qui: ti serve il permesso \"Può modificare\".";
  }
  return null;
};

/** Lotti per proprietario (al massimo `maxRows` righe, come push_shared_rows). */
export const sharedPushBatches = (outbox: readonly SharedOutboxEntry[], items: readonly SharedItem[], maxRows = 200) => {
  const byKey = new Map(items.map((entry) => [entry.key, entry]));
  const orphans: SharedOutboxEntry[] = [];
  const batches: SharedPushBatch[] = [];
  const open = new Map<string, SharedPushBatch>();
  for (const entry of [...outbox].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))) {
    const cached = byKey.get(entry.key);
    if (!entry.deleted && !cached) {
      orphans.push(entry);
      continue;
    }
    let batch = open.get(entry.ownerId);
    if (!batch || batch.rows.length >= maxRows) {
      batch = { ownerId: entry.ownerId, entries: [], rows: [] };
      open.set(entry.ownerId, batch);
      batches.push(batch);
    }
    batch.entries.push(entry);
    batch.rows.push({
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      payload: entry.deleted ? { id: entry.entityId, deletedAt: entry.deletedAt ?? entry.queuedAt } : (cached as SharedItem).entity,
      deleted: entry.deleted
    });
  }
  return { batches, orphans };
};

const stringList = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

export const grantFromRow = (row: Record<string, unknown>): ShareGrant | null => {
  if (!isShareScope(row.scope) || !isPermission(row.permission)) return null;
  return {
    id: String(row.id),
    ownerId: String(row.owner_id),
    ownerName: String(row.owner_name ?? ""),
    scope: row.scope,
    subjectIds: stringList(row.subject_ids),
    permission: row.permission,
    granteeUserId: (row.grantee_user_id as string | null) ?? null,
    granteeGroupId: (row.grantee_group_id as string | null) ?? null,
    granteeName: String(row.grantee_name ?? ""),
    granteeEmail: (row.grantee_email as string | null) ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? "")
  };
};

const offerFromJson = (value: unknown): ShareOffer | null => {
  const entry = (value ?? {}) as Record<string, unknown>;
  if (!isShareScope(entry.scope)) return null;
  return {
    scope: entry.scope,
    permission: isPermission(entry.permission) ? entry.permission : "view",
    subjectIds: stringList(entry.subject_ids),
    subjectNames: stringList(entry.subject_names)
  };
};

export const offerToRow = (offer: ShareOffer) => ({
  scope: offer.scope,
  permission: VIEW_ONLY_SCOPES.has(offer.scope) ? "view" : offer.permission,
  subject_ids: SUBJECTLESS_SCOPES.has(offer.scope) ? [] : offer.subjectIds,
  subject_names: SUBJECTLESS_SCOPES.has(offer.scope) ? [] : offer.subjectNames
});

/** `token_hash` non c'è: le colonne degli inviti si leggono con elenco esplicito e l'hash non è mai leggibile. */
export const inviteFromRow = (row: Record<string, unknown>, now: number = Date.now()): ShareInviteSummary => {
  const status = String(row.status ?? "pending");
  const expiresAt = String(row.expires_at ?? "");
  const expired = status === "pending" && timestampOf(expiresAt) <= now;
  return {
    id: String(row.id ?? row.invite_id),
    ownerId: String(row.owner_id ?? ""),
    ownerName: String(row.owner_name ?? ""),
    offers: (Array.isArray(row.offers) ? row.offers : []).map(offerFromJson).filter((entry): entry is ShareOffer => entry !== null),
    requests: (Array.isArray(row.requests) ? row.requests : [])
      .map(offerFromJson)
      .filter((entry): entry is ShareOffer => entry !== null)
      .map(({ scope, permission }) => ({ scope, permission })),
    recipientEmail: (row.recipient_email as string | null) ?? null,
    status: expired ? "expired" : status === "accepted" || status === "declined" || status === "expired" ? status : "pending",
    expiresAt,
    createdAt: String(row.created_at ?? "")
  };
};

export const revisionFromRow = (row: Record<string, unknown>): ItemRevision => ({
  id: Number(row.id),
  entityType: String(row.entity_type),
  entityId: String(row.entity_id),
  payload: (row.payload ?? {}) as Record<string, unknown>,
  deleted: row.deleted === true,
  change: row.change === "create" || row.change === "delete" ? row.change : "update",
  changedBy: (row.changed_by as string | null) ?? null,
  changedAt: String(row.changed_at ?? "")
});

export const revisionTitle = (revision: Pick<ItemRevision, "payload">) =>
  str(revision.payload.title) || str(revision.payload.name) || "Elemento senza titolo";

// ——— Link di invito ———

export const SHARE_PARAM = "condividi";
const TOKEN_RE = /^[0-9a-f]{64}$/;

export const isShareToken = (value: string) => TOKEN_RE.test(value);

const hashParams = (hash: string) => new URLSearchParams(hash.replace(/^#/, ""));

/** Token da un link (#condividi=… preferito: il browser non lo invia ai server) o da testo incollato. */
export const shareTokenFromText = (value: string): string | null => {
  const text = value.trim();
  if (isShareToken(text)) return text;
  try {
    const url = new URL(text);
    const raw = hashParams(url.hash).get(SHARE_PARAM) ?? url.searchParams.get(SHARE_PARAM);
    return raw && isShareToken(raw) ? raw : null;
  } catch {
    return null;
  }
};

export const urlWithoutShare = (href: string) => {
  const url = new URL(href);
  url.searchParams.delete(SHARE_PARAM);
  const hash = hashParams(url.hash);
  if (hash.has(SHARE_PARAM)) {
    hash.delete(SHARE_PARAM);
    const rest = hash.toString();
    url.hash = rest ? `#${rest}` : "";
  }
  return `${url.pathname}${url.search}${url.hash}`;
};

export const shareInviteLink = (token: string) => `${inviteLinkBase()}#${SHARE_PARAM}=${token}`;

export const shareInviteMessage = (ownerName: string, offers: readonly ShareOffer[], link: string) =>
  `${ownerName} vuole condividere con te su StudyOS: ${scopesSummary(offers)}.\n\nApri l'invito da qui: ${link}`;

// ——— Marcatura "di altri" ———

// Toni chiari: le iniziali sopra sono sempre scure (#10131d), leggibili in tema chiaro e scuro.
const OWNER_COLORS = ["#A78BFA", "#38BDF8", "#FB923C", "#34D399", "#F472B6", "#FACC15", "#818CF8", "#2DD4BF"];

/** Colore stabile per persona: lo stesso proprietario ha lo stesso colore in ogni vista. */
export const ownerColor = (ownerId: string) => {
  let hash = 0;
  for (const char of ownerId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return OWNER_COLORS[hash % OWNER_COLORS.length];
};

export const initialsOf = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toLocaleUpperCase("it"))
    .join("") || "?";

export const originOf = (received: readonly ShareGrant[], entry: SharedItem, labels: readonly SharedSubjectLabel[]): SharedOrigin => {
  const ownerName = received.find((grant) => grant.ownerId === entry.ownerId)?.ownerName || "Un'altra persona";
  const subjectId = subjectOfPayload(entry.entityType, entry.entity);
  const label = subjectId ? labels.find((candidate) => candidate.ownerId === entry.ownerId && candidate.id === subjectId) : undefined;
  return {
    ownerId: entry.ownerId,
    ownerName,
    canEdit: itemAccess(received, entry.ownerId, entry.entityType, entry.entity) === "edit",
    color: ownerColor(entry.ownerId),
    initials: initialsOf(ownerName),
    subjectName: label?.name,
    subjectColor: label?.color || undefined
  };
};
