// Logica pura della condivisione tra account: sezioni, copertura (specchio esatto di
// studyos_scope_covers in supabase/sharing.sql), permessi, cache dei dati altrui e link di invito.
// Nessun import di Supabase o Dexie: la usano store, viste, agente MCP e test.

import { timestampOf, type SyncableEntity } from "./collections";
import { inviteLinkBase } from "./groups";
import { SHARE_ACTION_FAILED, scopesSummary } from "./labels";

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

export const sharedKey = (ownerId: string, entityType: string, entityId: string) => `${ownerId}:${entityType}:${entityId}`;

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

/**
 * Chiavi `${tipo}:${id}` che il server mostra per `ownerId` ma che qui mancano (né in cache né in
 * coda): il cursore le ha saltate, ad esempio dopo una revoca e una nuova condivisione identica.
 */
export const missingVisibleKeys = (
  items: readonly SharedItem[],
  outbox: readonly SharedOutboxEntry[],
  ownerId: string,
  visible: ReadonlySet<string>
) => {
  const known = new Set(
    [...items, ...outbox].filter((entry) => entry.ownerId === ownerId).map((entry) => `${entry.entityType}:${entry.entityId}`)
  );
  return [...visible].filter((key) => !known.has(key));
};

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

// ——— Errori e notifiche ———

export const SHARING_UNAVAILABLE_TEXT =
  "La condivisione non è ancora attiva sul server: esegui supabase/sharing.sql nel SQL Editor di Supabase (vedi supabase/README.md).";

type ServerError = { message: string; code?: string } | null;

const SERVER_UNREACHABLE_TEXT = "Server cloud non raggiungibile: controlla la connessione.";

/** Tabella o funzione assente: supabase/sharing.sql non è stato eseguito. */
export const isMissingSharingObject = (error: ServerError) =>
  Boolean(error && /42P01|42883|PGRST202|PGRST205|does not exist|Could not find the (table|function)/i.test(`${error.code ?? ""} ${error.message}`));

/**
 * Rete assente o pezzo dell'app non scaricabile. Stessi casi di errorMessage in cloudSync.ts più i
 * messaggi di un import() fallito (Chrome, Firefox, Safari).
 */
const NETWORK_ERROR_RE =
  /failed to fetch|networkerror|load failed|network request failed|timed? ?out|timeout|aborted|err_connection|dynamically imported module|importing a module script failed/i;

/** Sonda sulla tabella delle condivisioni: solo un oggetto mancante vale "non attiva", un errore di rete resta incerto. */
export const sharingProbeOutcome = (error: ServerError): "available" | "missing" | "failed" =>
  !error ? "available" : isMissingSharingObject(error) ? "missing" : "failed";

const GENERIC_ERROR_TEXT = "Il server ha risposto con un errore. Riprova tra poco.";

/** Eccezione sollevata da sharing.sql con `raise exception` (SQLSTATE P0001): il testo è già in italiano. */
const OWN_SQL_EXCEPTION = "P0001";

/**
 * Errore con un testo già pronto per l'utente (in italiano). Chi lo lancia (fail() in shareSync, le
 * azioni) dichiara così che il messaggio si può mostrare tale e quale: shareErrorText lo lascia
 * com'è, mentre qualunque altro messaggio sconosciuto (infrastruttura, bug) non arriva mai
 * all'utente in inglese.
 */
export class ShareUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareUserError";
  }
}

/** Testo da mostrare per un errore del server (supabase-js riporta la rete come "TypeError: Failed to fetch"). */
export const shareErrorText = (error: NonNullable<ServerError>) => {
  if (error instanceof ShareUserError) return error.message;
  if (isMissingSharingObject(error)) return SHARING_UNAVAILABLE_TEXT;
  if (NETWORK_ERROR_RE.test(error.message)) {
    return `${SERVER_UNREACHABLE_TEXT} I dati condivisi si aggiornano da soli appena torna.`;
  }
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return "Non hai il permesso per questa operazione. Puoi condividere direttamente solo con persone che conosci (un gruppo in comune o una condivisione già attiva): per le altre crea un invito.";
  }
  // Indice unico (proprietario, sezione, destinatario): la sezione è già condivisa con quella persona o quel gruppo.
  if (error.code === "23505" || /duplicate key/i.test(error.message)) {
    return "Questa sezione è già condivisa con questa persona o questo gruppo.";
  }
  return error.code === OWN_SQL_EXCEPTION && error.message.trim() ? error.message : GENERIC_ERROR_TEXT;
};

/** Azione dell'utente che può fallire: crea invito e condividi (pannello), poi quelle della sezione Condivisione. */
export type ShareAction = "invite" | "share" | "accept" | "decline" | "cancel" | "update" | "revoke" | "leave" | "open";

/**
 * Errore di un'azione che l'utente ha appena fatto (crea invito, condividi, accetta…): dice cosa non è
 * stato salvato. Il testo di rete di shareErrorText parla della sync in background ("si aggiornano
 * da soli"), che per un invito non creato sarebbe fuorviante.
 */
export const shareActionErrorText = (action: ShareAction, cause: unknown) => {
  const message = cause instanceof Error ? cause.message.trim() : "";
  const reason = message.startsWith(SERVER_UNREACHABLE_TEXT) || NETWORK_ERROR_RE.test(message)
    ? `${SERVER_UNREACHABLE_TEXT} Riprova appena torna.`
    : message || "Riprova tra poco.";
  return `${SHARE_ACTION_FAILED[action]} ${reason}`;
};

/**
 * Cosa notificare dopo un aggiornamento: condivisioni e inviti mai visti su questo dispositivo.
 * Senza `seen` (primo controllo) nessuna notifica: niente raffica per condivisioni vecchie.
 * I proprietari in `silent` (invito appena accettato da chi guarda) non generano notifiche;
 * `consumed` elenca quelli di cui arriva davvero una condivisione nuova: solo allora il silenzio finisce.
 */
export const shareNotices = (
  me: string,
  received: readonly ShareGrant[],
  invites: readonly ShareInviteSummary[],
  seen: readonly string[] | undefined,
  silent: ReadonlySet<string>
) => {
  const incoming = invites.filter((invite) => invite.ownerId !== me && invite.status === "pending");
  const known = new Set(seen ?? []);
  const fresh = received.filter((grant) => !known.has(grant.id));
  return {
    ids: [...received.map((grant) => grant.id), ...incoming.map((invite) => `invite-${invite.id}`)],
    grants: seen ? fresh.filter((grant) => !silent.has(grant.ownerId)) : [],
    invites: seen ? incoming.filter((invite) => !known.has(`invite-${invite.id}`)) : [],
    consumed: [...new Set(fresh.map((grant) => grant.ownerId))].filter((owner) => silent.has(owner))
  };
};

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

export type InviteBlock = "invalid" | "own" | "otherAccount" | Exclude<ShareInviteStatus, "pending">;

/**
 * Perché chi ha aperto un invito da link non può rispondere (null = può). Se c'è un motivo il
 * link salvato su questo dispositivo non serve più e si toglie, mostrando il motivo una volta.
 * `preview` null: il server non conosce il link. Un invito proprio o per un altro indirizzo
 * email conta prima dello stato.
 */
export const inviteBlockedReason = (
  preview: { status: ShareInviteStatus; isOwn: boolean; forOtherAccount: boolean } | null
): InviteBlock | null => {
  if (!preview) return "invalid";
  if (preview.isOwn) return "own";
  if (preview.forOtherAccount) return "otherAccount";
  return preview.status === "pending" ? null : preview.status;
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

// ——— Con chi si può condividere ———

/**
 * Condivisione diretta: le sezioni non ancora condivise con quel destinatario si creano tutte
 * insieme (un solo insert, atomico), quelle già condivise si aggiornano.
 */
export const planShareWrites = (
  given: readonly ShareGrant[],
  target: { userId?: string; groupId?: string },
  offers: readonly ShareOffer[]
) => {
  const create: ShareOffer[] = [];
  const update: { id: string; offer: ShareOffer }[] = [];
  for (const offer of offers) {
    const current = given.find(
      (grant) => grant.scope === offer.scope && (target.userId ? grant.granteeUserId === target.userId : grant.granteeGroupId === target.groupId)
    );
    if (current) update.push({ id: current.id, offer });
    else create.push(offer);
  }
  return { create, update };
};

export interface ShareContact {
  userId: string;
  name: string;
  via: "share" | "group";
}

/**
 * Persone con cui si può condividere senza invito: stessa regola di studyos_knows_user (un gruppo
 * in comune, o una condivisione diretta attiva in uno dei due sensi). Una condivisione ricevuta
 * tramite un gruppo non conta: il server guarda grantee_user_id, non il gruppo. Per i compagni di
 * gruppo passare solo i gruppi online di cui si è membri (`shareableGroups`).
 */
export const knownPeople = (
  me: string,
  given: readonly ShareGrant[],
  received: readonly ShareGrant[],
  groups: readonly { members: readonly { userId: string; displayName: string }[] }[]
): ShareContact[] => {
  const people = new Map<string, ShareContact>();
  for (const grant of given) {
    if (grant.granteeUserId && !people.has(grant.granteeUserId)) {
      people.set(grant.granteeUserId, { userId: grant.granteeUserId, name: grant.granteeName || "Persona", via: "share" });
    }
  }
  for (const grant of received) {
    if (grant.granteeUserId !== me || people.has(grant.ownerId)) continue;
    people.set(grant.ownerId, { userId: grant.ownerId, name: grant.ownerName || "Persona", via: "share" });
  }
  for (const group of groups) {
    for (const member of group.members) {
      if (member.userId === me || member.userId.startsWith("local-") || people.has(member.userId)) continue;
      people.set(member.userId, { userId: member.userId, name: member.displayName || "Compagno", via: "group" });
    }
  }
  return [...people.values()].sort((a, b) => a.name.localeCompare(b.name, "it"));
};

/** Gruppi a cui si può dare accesso: online (non solo su questo dispositivo) e di cui si è membri. */
export const shareableGroups = <G extends { ownerId: string; sharedAt?: string; members: readonly { userId: string }[] }>(
  groups: readonly G[],
  me: string
) => groups.filter((group) => Boolean(group.sharedAt) && !group.ownerId.startsWith("local-") && group.members.some((member) => member.userId === me));
