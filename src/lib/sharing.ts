// Logica pura della condivisione tra account: sezioni, copertura (specchio esatto di
// studyos_scope_covers in supabase/sharing.sql), permessi, cache dei dati altrui e link di invito.
// Nessun import di Supabase o Dexie: la usano store, viste, agente MCP e test.

import { timestampOf, type SyncableEntity } from "./collections";
import { fromDatetimeLocal, toDatetimeLocal } from "./dates";
import { inviteLinkBase } from "./groups";
import { SHARE_ACTION_FAILED, SHARE_GONE_TEXT, UNKNOWN_PERSON, UNKNOWN_PERSON_IN_SENTENCE, scopesSummary } from "./labels";
import { normalizeExternalUrl } from "./safeUrl";
import { chunkBySize } from "./syncMerge";
import { taskStatusTransitionPatch } from "./taskTimer";
import type { Task } from "../types";

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

/** Tipi di elemento che la condivisione copre: gli unici che una cronologia di altri può contenere e ripristinare. */
export const SHARED_ENTITY_TYPES: ReadonlySet<string> = new Set(Object.values(SCOPE_ENTITY_TYPES).flat());

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
  /** Account destinatario di un invito nell'app (supabase/people.sql); null per gli inviti con link. */
  recipientUserId: string | null;
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
  /** Id della riga sul server: c'è solo nel pull, che pagina per (updated_at, id). */
  id?: string;
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
 * Voci in coda che le righe del server (già passate da withoutSupersededRows) superano: la versione
 * del server è uguale o più recente della modifica in coda, oppure l'elemento in coda come eliminato
 * è già eliminato lassù (o cambiato dopo l'eliminazione). Inviarle riscriverebbe la versione del
 * proprietario a nome di chi guarda, con una revisione che non cambia nulla: escono dalla coda, come
 * dropOutbox di planMerge per i dati personali. Stessa regola di mergeSharedRows.
 */
export const supersededOutboxKeys = (
  items: readonly SharedItem[],
  ownerId: string,
  rows: readonly RemoteSharedRow[],
  outbox: readonly SharedOutboxEntry[]
): Set<string> => {
  const queued = new Map(outbox.map((entry) => [entry.key, entry]));
  const cached = new Map(items.map((entry) => [entry.key, entry]));
  const superseded = new Set<string>();
  for (const row of rows) {
    const key = sharedKey(ownerId, row.entity_type, row.entity_id);
    const entry = queued.get(key);
    if (!entry) continue;
    // Un'eliminazione in coda arriva qui solo con un'eliminazione del server o una modifica più recente.
    if (entry.deleted) {
      superseded.add(key);
      continue;
    }
    const local = cached.get(key);
    const remoteAt = str(row.payload.updatedAt) ?? str(row.payload.deletedAt);
    if (local && timestampOf(local.entity.updatedAt) > timestampOf(remoteAt)) continue;
    superseded.add(key);
  }
  return superseded;
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

/**
 * Scrittura su un elemento altrui, con `updatedAt` = `now`. Non «un millisecondo dopo la versione che si
 * modifica»: con l'orologio del proprietario avanti quel timbro è nel futuro, il trigger
 * `studyos_items_recipient_values` (sharing.sql) lo riporta a now() dopo averlo accettato, e il
 * dispositivo del proprietario, che ha la sua copia più recente e nulla in coda, la ripubblicava
 * sopra la modifica già accettata: persa in silenzio. Con `now` la modifica perde subito ("stale") e
 * torna indietro sotto gli occhi di chi l'ha fatta. Il timbro più tardo serve insieme al server
 * (`greatest(now(), timbro attuale + 1 ms)` nel trigger).
 */
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
  /**
   * Inviata almeno una volta (segnato e salvato prima dell'invio). Se la risposta si perde (timeout,
   * rete caduta) la riga può essere già sul server: un elemento creato qui e poi eliminato deve allora
   * mandare il tombstone, altrimenti il pull lo riporterebbe in vita. Passa alle modifiche successive.
   */
  attempted?: boolean;
  /**
   * Versione del server da cui è partita la modifica in coda (senza chiavi protette) e il suo
   * `updated_at`. Se intanto il proprietario cambia l'elemento, la modifica si riallinea sulla versione
   * nuova campo per campo (rebasePendingEdits) invece di vincere o perdere per intero (S4). Assenti per
   * un elemento creato qui e per le voci di versioni precedenti: lì resta la regola di prima.
   */
  base?: Payload;
  baseAt?: string;
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

/**
 * Chiavi che chi riceve non cambia mai: copertine, file incorporati di prima (`dataUrl`, fino a ~900 KB), il
 * segno del file nello spazio file (`storedFile`: una copia vecchia o il ripristino di una modifica non
 * deve toglierlo, il file sparirebbe), UID di import. Specchio di v_protected in studyos_recipient_payload (supabase/sharing.sql): il server
 * tiene quelle salvate anche se mancano, quindi non serve inviarle. `sourceStamp` (impronta dell'ultimo
 * import .ics) non è tra queste: il server non la conserva, quindi viaggia con la riga, altrimenti una
 * modifica di chi riceve la toglierebbe al proprietario, e il suo prossimo import la annullerebbe.
 */
const PROTECTED_KEY = /^(?:cover|dataUrl|storedFile|sourceUid|[A-Za-z]*DataUrl|__proto__)$/;

/** Copia senza le chiavi protette, per la riga da inviare: la copia nella cache resta intera. */
export const withoutProtectedKeys = (payload: Payload): Payload =>
  Object.fromEntries(Object.entries(payload).filter(([key]) => !PROTECTED_KEY.test(key)));

/**
 * Versione da ripristinare con le chiavi protette di `source` (la copia attuale del proprietario, o
 * l'ultima eliminazione salvata): la cronologia delle modifiche non le conserva (sharing.sql), e chi
 * riceve non le cambia mai, quindi quelle giuste sono le più recenti del proprietario.
 */
export const withProtectedFrom = (payload: Payload, source: Payload): Payload => ({
  ...withoutProtectedKeys(payload),
  ...protectedOf(source)
});

/** Solo le chiavi protette (mai `__proto__`). */
const protectedOf = (source: Payload): Payload =>
  Object.fromEntries(Object.entries(source).filter(([key]) => key !== "__proto__" && PROTECTED_KEY.test(key)));

/**
 * Tipi condivisibili che possono avere copertine, file o UID (src/types.ts; un test lo controlla). Una
 * loro versione di modifica senza la copia del proprietario non basta: mancherebbero proprio quelli.
 * Sessioni, argomenti, obiettivi e note non ne hanno: la loro versione di modifica è già intera.
 */
export const PROTECTED_ENTITY_TYPES: ReadonlySet<string> = new Set(["calendarEvent", "task", "exam", "attachment"]);

/** Versione della cronologia da riscrivere tra i dati personali (`entityId`: l'elemento di cui parla). */
export interface RestoreVersion {
  entityType: string;
  entityId: string;
  payload: Payload;
  /**
   * La versione porta le sue chiavi protette: è il contenuto di un'eliminazione (sharing.sql le
   * conserva solo lì). Assente o false: versione di una modifica, senza copertine, file e UID.
   */
  complete?: boolean;
  /** Elemento intero da cui prenderle se il proprietario non ha più la sua copia: l'eliminazione successiva. */
  protectedFrom?: Payload | null;
}

/**
 * Contenuto da scrivere per una versione ripristinata, o null se scriverla perderebbe copertine, file o
 * UID. Le chiavi protette sono quelle della copia attuale del proprietario (`existing`), le più
 * recenti: chi riceve non le cambia mai. Quelle che la copia non ha le completa l'elemento intero della
 * versione (un'eliminazione), così un file tolto per errore torna. Una versione di modifica di un tipo
 * con chiavi protette, senza copia attuale né eliminazione da cui prenderle, si rifiuta: verrebbe
 * scritta come elemento nuovo senza il suo file, e vincerebbe sul server.
 */
export const restoredPayload = (version: RestoreVersion, existing: Payload | undefined): Payload | null => {
  const whole = version.complete ? version.payload : version.protectedFrom;
  if (!existing && !whole && PROTECTED_ENTITY_TYPES.has(version.entityType)) return null;
  return {
    ...withoutProtectedKeys(version.payload),
    ...(whole ? protectedOf(whole) : {}),
    ...(existing ? protectedOf(existing) : {})
  };
};

/** Una modifica o revoca che non ha toccato nessuna riga: la condivisione non c'è più. */
export const requireAffectedShare = (rows: readonly unknown[] | null | undefined) => {
  if (!rows?.length) throw new ShareUserError(SHARE_GONE_TEXT);
};

/**
 * Byte per lotto, come l'invio dei dati personali (PUSH_MAX_BYTES in cloudSync.ts, copiato: quel modulo
 * porta con sé supabase-js). Oltre, la richiesta può essere rifiutata intera.
 */
export const SHARE_PUSH_MAX_BYTES = 900_000;

const utf8 = new TextEncoder();

/**
 * Lotti per proprietario: al massimo `maxRows` righe (come push_shared_rows) e `maxBytes` byte (una
 * riga più grande va da sola). Un lotto troppo grande non blocca più tutta la coda.
 */
export const sharedPushBatches = (
  outbox: readonly SharedOutboxEntry[],
  items: readonly SharedItem[],
  maxRows = 200,
  maxBytes = SHARE_PUSH_MAX_BYTES
) => {
  const byKey = new Map(items.map((entry) => [entry.key, entry]));
  const orphans: SharedOutboxEntry[] = [];
  const byOwner = new Map<string, { entry: SharedOutboxEntry; row: SharedPushBatch["rows"][number]; size: number }[]>();
  for (const entry of [...outbox].sort((a, b) => a.queuedAt.localeCompare(b.queuedAt))) {
    const cached = byKey.get(entry.key);
    if (!entry.deleted && !cached) {
      orphans.push(entry);
      continue;
    }
    const row = {
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      payload: entry.deleted ? { id: entry.entityId, deletedAt: entry.deletedAt ?? entry.queuedAt } : withoutProtectedKeys((cached as SharedItem).entity),
      deleted: entry.deleted
    };
    const list = byOwner.get(entry.ownerId) ?? [];
    list.push({ entry, row, size: utf8.encode(JSON.stringify(row)).length });
    byOwner.set(entry.ownerId, list);
  }
  const batches: SharedPushBatch[] = [];
  for (const [ownerId, list] of byOwner) {
    for (const chunk of chunkBySize(list, (part) => part.size, maxBytes, maxRows)) {
      batches.push({ ownerId, entries: chunk.map((part) => part.entry), rows: chunk.map((part) => part.row) });
    }
  }
  return { batches, orphans };
};

/** Risposta di push_shared_rows per una riga. */
export interface SharedPushResult {
  entity_type: string;
  entity_id: string;
  accepted: boolean;
  reason: string | null;
}

/**
 * Esito di un lotto: voci accettate e rifiutate (anche quelle senza risposta), e il motivo del server per
 * una voce ("stale", "denied" o null).
 */
export const sharedPushOutcome = (ownerId: string, entries: readonly SharedOutboxEntry[], results: readonly SharedPushResult[]) => {
  const byKey = new Map(results.map((result) => [sharedKey(ownerId, result.entity_type, result.entity_id), result]));
  return {
    accepted: entries.filter((entry) => byKey.get(entry.key)?.accepted === true),
    rejected: entries.filter((entry) => byKey.get(entry.key)?.accepted !== true),
    reason: (entry: SharedOutboxEntry) => byKey.get(entry.key)?.reason ?? null
  };
};

/**
 * Righe del server per le voci rifiutate, una per voce e nello stesso ordine. Una riga che il server non
 * mostra (permesso tolto, filtro cambiato, mai scritta) torna come eliminazione: l'elemento sparisce dalla cache.
 */
export const rowsForEntries = (ownerId: string, entries: readonly SharedOutboxEntry[], found: readonly RemoteSharedRow[]): RemoteSharedRow[] => {
  const byKey = new Map(found.map((row) => [sharedKey(ownerId, row.entity_type, row.entity_id), row]));
  return entries.map(
    (entry) => byKey.get(entry.key) ?? { entity_type: entry.entityType, entity_id: entry.entityId, payload: { id: entry.entityId }, deleted: true, updated_at: "" }
  );
};

/**
 * Se dire che il permesso non c'è più: una voce rifiutata con "denied" la cui riga riletta (`rows`, nello
 * stesso ordine) è ancora lì. Il server risponde "denied" anche all'eliminazione di una riga che non ha o
 * che ha già eliminato (risposta persa e nuovo invio, secondo dispositivo, proprietario che ha eliminato
 * prima): lì l'eliminazione ha comunque l'effetto voluto.
 */
export const sharedPushDenied = (
  rejected: readonly SharedOutboxEntry[],
  reason: (entry: SharedOutboxEntry) => string | null,
  rows: readonly RemoteSharedRow[]
) => rejected.some((entry, index) => reason(entry) === "denied" && !(entry.deleted && rows[index]?.deleted === true));

/**
 * Se dire che il proprietario ha eliminato ciò che si stava modificando: una modifica (non un'eliminazione)
 * rifiutata con "gone" (sharing.sql dal 12/11/2026; prima il server rispondeva "denied"). Un'eliminazione
 * con "gone" è già fatta e non ha bisogno di avvisi.
 */
export const sharedPushGone = (rejected: readonly SharedOutboxEntry[], reason: (entry: SharedOutboxEntry) => string | null) =>
  rejected.some((entry) => reason(entry) === "gone" && !entry.deleted);

/**
 * Invia i lotti uno alla volta. Un lotto che fallisce non ferma gli altri (le sue voci restano in coda) e
 * il primo errore arriva alla fine. `abort` (chi guarda è cambiato) esce subito; `offline` (rete assente)
 * ferma i lotti dopo, che fallirebbero uguale, ognuno dopo l'attesa massima.
 */
export const pushEachBatch = async <B>(
  batches: readonly B[],
  push: (batch: B) => Promise<void>,
  rules: { abort: (error: unknown) => boolean; offline: (error: unknown) => boolean }
) => {
  let failed = false;
  let failure: unknown;
  for (const batch of batches) {
    try {
      await push(batch);
    } catch (error) {
      if (rules.abort(error)) throw error;
      if (!failed) failure = error;
      failed = true;
      if (rules.offline(error)) break;
    }
  }
  if (failed) throw failure;
};

/**
 * Lotti con voci fallite nella passata prima messi in fondo (ordine stabile). Un lotto che scade sempre
 * (troppo lento, timeout del server) ferma i lotti dopo di lui come se la rete mancasse: in testa, li
 * bloccava a ogni passata, anche quelli di altri proprietari.
 */
export const failedBatchesLast = <B extends { entries: readonly { key: string }[] }>(batches: readonly B[], failed: ReadonlySet<string>): B[] => {
  if (!failed.size) return [...batches];
  const hit = (batch: B) => batch.entries.some((entry) => failed.has(entry.key));
  return [...batches.filter((batch) => !hit(batch)), ...batches.filter(hit)];
};

const quotedFilterValue = (value: string) => `"${value.replace(/["\\]/g, "")}"`;

/**
 * Filtro PostgREST (per `.or()`) delle righe dopo `after` nell'ordine (updated_at, id): il pull pagina
 * così, non per posizione. Con l'offset una riga cambiata durante la lettura passava in fondo e faceva
 * saltare quella dopo, che poi il cursore superava: restava vecchia in cache.
 */
export const afterRowFilter = (after: { updatedAt: string; id: string }) => {
  const at = quotedFilterValue(after.updatedAt);
  return `updated_at.gt.${at},and(updated_at.eq.${at},id.gt.${quotedFilterValue(after.id)})`;
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
    recipientUserId: typeof row.recipient_user_id === "string" && row.recipient_user_id ? row.recipient_user_id : null,
    status: expired ? "expired" : status === "accepted" || status === "declined" || status === "expired" ? status : "pending",
    expiresAt,
    createdAt: String(row.created_at ?? "")
  };
};

/**
 * Colonne dell'elenco della cronologia: dal payload solo id, titolo, nome e il segno di tombstone. La
 * versione intera (con i file delle eliminazioni) si scarica solo per ripristinarla.
 */
export const REVISION_LIST_COLUMNS =
  "id, entity_type, entity_id, deleted, change, changed_by, changed_at, payload_id:payload->>id, title:payload->>title, name:payload->>name, deleted_at:payload->>deletedAt";

/** Riassunto del payload da una riga leggera (REVISION_LIST_COLUMNS): basta per titolo e controlli. */
const revisionSummary = (row: Record<string, unknown>): Payload => {
  const summary: Payload = {};
  for (const [key, column] of [["id", "payload_id"], ["title", "title"], ["name", "name"], ["deletedAt", "deleted_at"]] as const) {
    if (typeof row[column] === "string") summary[key] = row[column];
  }
  return summary;
};

export const revisionFromRow = (row: Record<string, unknown>): ItemRevision => ({
  id: Number(row.id),
  entityType: String(row.entity_type),
  entityId: String(row.entity_id),
  payload: typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload) ? (row.payload as Payload) : revisionSummary(row),
  deleted: row.deleted === true,
  change: row.change === "create" || row.change === "delete" ? row.change : "update",
  changedBy: (row.changed_by as string | null) ?? null,
  changedAt: String(row.changed_at ?? "")
});

export const revisionTitle = (revision: Pick<ItemRevision, "payload">) =>
  str(revision.payload.title) || str(revision.payload.name) || "Elemento senza titolo";

/**
 * Una versione salvata si può riscrivere tra i dati personali solo se è un elemento vero: un tipo
 * che la condivisione copre (mai preferenze, notifiche, gruppi…), un oggetto con un `id` testuale non
 * vuoto e non un tombstone. Se si conosce l'elemento di cui è una versione (`entityId`), l'id deve
 * essere lo stesso: chi può modificare i miei dati ha scritto quel contenuto e non può farlo
 * puntare a un altro elemento.
 */
export const isRestorableEntity = (entityType: string, payload: unknown, entityId?: string): payload is Payload & { id: string } => {
  if (!SHARED_ENTITY_TYPES.has(entityType)) return false;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return false;
  const entry = payload as Payload;
  if (typeof entry.id !== "string" || !entry.id.trim()) return false;
  if ("deletedAt" in entry) return false;
  return entityId === undefined || entry.id === entityId;
};

/**
 * Il pulsante "Ripristina" compare solo per le versioni precedenti a una modifica o a un'eliminazione:
 * una creazione non ha una versione prima, e il contenuto di una riga già eliminata è un tombstone.
 */
export const canRestoreRevision = (revision: ItemRevision) =>
  revision.change !== "create" && !revision.deleted && isRestorableEntity(revision.entityType, revision.payload, revision.entityId);

/** Quante modifiche mostra la cronologia (le più recenti): l'intestazione lo dice quando la lista è piena. */
export const REVISION_LIST_LIMIT = 100;

/**
 * `updatedAt` di una versione ripristinata. Di norma l'ora attuale, ma se la copia locale è più recente
 * o uguale (l'altra persona ha l'orologio avanti) un millisecondo dopo: un ripristino con un
 * timestamp più vecchio perderebbe per LWW e non arriverebbe a nessuno. Senza copia locale
 * (elemento eliminato da altri) vale l'ora attuale.
 */
export const restoredUpdatedAt = (now: string, existingUpdatedAt?: string | null) => {
  const existing = timestampOf(existingUpdatedAt);
  return existing > 0 && existing >= timestampOf(now) ? new Date(existing + 1).toISOString() : now;
};

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

/**
 * Errore di rete o di attesa scaduta (anche già tradotto da shareErrorText): un invio non riuscito così
 * fallirebbe uguale per gli altri lotti, quindi non si prova con quelli.
 */
export const isShareNetworkError = (error: unknown) =>
  error instanceof Error && (error.message.startsWith(SERVER_UNREACHABLE_TEXT) || NETWORK_ERROR_RE.test(error.message));

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
export type ShareAction = "invite" | "share" | "accept" | "decline" | "cancel" | "update" | "revoke" | "leave" | "open" | "history" | "restore" | "revertCheck" | "revert" | "save" | "delete";

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
 * Come shareActionErrorText, per le azioni che toccano anche codice dell'app (cronologia, ripristino):
 * passano solo i testi pensati per l'utente (ShareUserError) e i problemi di rete; un guasto
 * tecnico non mostra mai il proprio messaggio, che sarebbe in inglese.
 */
export const shareActionErrorTextSafe = (action: ShareAction, cause: unknown) =>
  shareActionErrorText(action, cause instanceof ShareUserError || (cause instanceof Error && NETWORK_ERROR_RE.test(cause.message)) ? cause : undefined);

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

const HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Colore da dati di altri, pronto per uno stile in linea: solo #rgb, #rgba, #rrggbb o #rrggbbaa,
 * altrimenti "". Così un valore come `url("https://…")` non fa scaricare nulla a chi guarda.
 */
export const safeCssColor = (value: unknown) => {
  if (typeof value !== "string") return "";
  const color = value.trim();
  return HEX_COLOR.test(color) ? color : "";
};

/**
 * Campi di `after` diversi da `before` (confronto per valore). Una modifica a un dato altrui invia
 * solo questi, così non riporta indietro ciò che il proprietario ha cambiato nel frattempo. I campi
 * di un gruppo vanno insieme: se ne cambia uno, si mandano tutti (es. inizio, fine, tutto il giorno).
 */
export const changedFields = <T extends object>(before: T, after: T, groups: readonly (readonly string[])[] = []): Partial<T> => {
  const previous = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  const changed = new Set([...Object.keys(previous), ...Object.keys(next)].filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(next[key])));
  for (const group of groups) if (group.some((key) => changed.has(key))) for (const key of group) changed.add(key);
  return Object.fromEntries([...changed].map((key) => [key, next[key]])) as Partial<T>;
};

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
  const ownerName = received.find((grant) => grant.ownerId === entry.ownerId)?.ownerName || UNKNOWN_PERSON;
  const subjectId = subjectOfPayload(entry.entityType, entry.entity);
  const label = subjectId ? labels.find((candidate) => candidate.ownerId === entry.ownerId && candidate.id === subjectId) : undefined;
  return {
    ownerId: entry.ownerId,
    ownerName,
    canEdit: itemAccess(received, entry.ownerId, entry.entityType, entry.entity) === "edit",
    color: ownerColor(entry.ownerId),
    initials: initialsOf(ownerName),
    subjectName: label?.name,
    subjectColor: safeCssColor(label?.color) || undefined
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

/** Chi ha fatto una modifica: nome dalla condivisione o dal gruppo, mai l'id dell'account. */
export const revisionActorName = (
  changedBy: string | null,
  given: readonly ShareGrant[],
  groups: readonly { members: readonly { userId: string; displayName: string }[] }[]
) => {
  if (!changedBy) return UNKNOWN_PERSON;
  const direct = given.find((grant) => grant.granteeUserId === changedBy)?.granteeName;
  if (direct) return direct;
  for (const group of groups) {
    const member = group.members.find((candidate) => candidate.userId === changedBy);
    if (member?.displayName) return member.displayName;
  }
  return UNKNOWN_PERSON;
};

/** Il nome di `revisionActorName` in mezzo a una frase ("prima che un'altra persona…"): solo il nome sconosciuto cambia. */
export const actorInSentence = (name: string) => (name === UNKNOWN_PERSON ? UNKNOWN_PERSON_IN_SENTENCE : name);

export interface SharedBarbExam {
  sourceUid: string;
  title: string;
  start: string;
  link?: string;
  ownerIds: string[];
  /** Lo stesso appello è anche nel mio calendario. */
  mine: boolean;
}

/** Giorno locale (aaaa-mm-gg) di una data ISO senza fuso, com'è negli appelli; "" se manca o non è un giorno del calendario. */
const localDayOf = (start: string) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(start);
  if (!match) return "";
  const [day, year, month, date] = [match[0], Number(match[1]), Number(match[2]), Number(match[3])];
  const check = new Date(Date.UTC(year, month - 1, date));
  return check.getUTCFullYear() === year && check.getUTCMonth() === month - 1 && check.getUTCDate() === date ? day : "";
};

/**
 * Chiave di un appello: codice ufficiale e giorno. Chi sposta un appello importato tiene il codice
 * ma cambia il giorno: è un'altra riga, e il segno "anche tu" vale solo per il mio stesso giorno.
 */
export const barbExamKey = (sourceUid: string, start: string) => `${sourceUid}|${localDayOf(start)}`;

/** Il primo link che si può aprire senza rischi; chi condivide può mandare qualsiasi stringa. */
const firstSafeLink = (value: unknown): string | undefined => {
  if (!Array.isArray(value)) return undefined;
  for (const link of value) {
    const safe = typeof link === "string" ? normalizeExternalUrl(link) : null;
    if (safe) return safe;
  }
  return undefined;
};

/**
 * Appelli ufficiali scelti da chi condivide con me (calendario o appelli), uno per appello e giorno.
 * `mine` contiene le chiavi (`barbExamKey`) degli appelli che ho nel mio calendario. Senza data valida
 * le righe vanno in coda.
 */
export const sharedBarbExams = (items: readonly SharedItem[], mine: ReadonlySet<string>): SharedBarbExam[] => {
  const byKey = new Map<string, SharedBarbExam>();
  for (const entry of items) {
    if (entry.entityType !== "calendarEvent") continue;
    const uid = str(entry.entity.sourceUid);
    if (!uid?.startsWith("barb-exam-")) continue;
    const start = str(entry.entity.start) ?? "";
    const key = barbExamKey(uid, start);
    const current = byKey.get(key);
    if (current) {
      if (!current.ownerIds.includes(entry.ownerId)) current.ownerIds.push(entry.ownerId);
      current.link ??= firstSafeLink(entry.entity.links);
      continue;
    }
    byKey.set(key, {
      sourceUid: uid,
      title: str(entry.entity.title) || "Appello",
      start,
      link: firstSafeLink(entry.entity.links),
      ownerIds: [entry.ownerId],
      mine: mine.has(key)
    });
  }
  return [...byKey.values()].sort((a, b) => {
    const dayA = localDayOf(a.start);
    const dayB = localDayOf(b.start);
    if (Boolean(dayA) !== Boolean(dayB)) return dayA ? -1 : 1;
    return a.start.localeCompare(b.start) || a.sourceUid.localeCompare(b.sourceUid);
  });
};

/**
 * Divide per giorno locale (`today` = aaaa-mm-gg): chi è di oggi è ancora in arrivo, chi non ha una data
 * valida resta tra gli in arrivo (non si sa che sia passato), i passati vanno dal più recente.
 */
export const splitSharedBarbExams = (rows: readonly SharedBarbExam[], today: string) => {
  const upcoming: SharedBarbExam[] = [];
  const past: SharedBarbExam[] = [];
  for (const row of rows) {
    const day = localDayOf(row.start);
    (day && day < today ? past : upcoming).push(row);
  }
  return { upcoming, past: past.reverse() };
};

/** Dominio di un link, da mostrare com'è: chi condivide non può far passare un sito qualsiasi per quello ufficiale. */
export const linkHostname = (href: string): string | undefined => {
  try {
    return new URL(href).hostname.replace(/^www\./, "") || undefined;
  } catch {
    return undefined;
  }
};

// ——— Modifica di un elemento altrui ———

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}[T ]/;

/** Istante di un campo data altrui; null se non è una data ISO leggibile (chi condivide può mandare qualsiasi testo). */
const storedInstant = (value: unknown): Date | null => {
  if (typeof value !== "string" || !TIMESTAMP.test(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

/**
 * Giorno (aaaa-mm-gg) di un campo data altrui, per chi guarda: un giorno solo resta com'è, un istante
 * (es. un esame con l'ora) si legge nel fuso locale, non con le prime cifre dell'UTC. "" se manca o non è una data.
 */
export const storedDayOf = (value: unknown) => {
  if (typeof value === "string" && DAY_ONLY.test(value)) return localDayOf(value);
  const date = storedInstant(value);
  return date ? toDatetimeLocal(date).slice(0, 10) : "";
};

/**
 * Nuovo giorno per un campo data altrui. Un giorno solo resta un giorno solo; un istante tiene l'ora
 * locale (e secondi, millisecondi) sul nuovo giorno. Senza un valore precedente leggibile il risultato
 * è il solo giorno; `undefined` se `nextDate` non è un giorno del calendario.
 */
export const replaceDatePart = (original: unknown, nextDate: string): string | undefined => {
  if (!DAY_ONLY.test(nextDate) || localDayOf(nextDate) !== nextDate) return undefined;
  const previous = storedInstant(original);
  if (!previous) return nextDate;
  const [year, month, day] = nextDate.split("-").map(Number);
  previous.setFullYear(year, month - 1, day);
  return previous.toISOString();
};

/** Fine di una sessione spostata: stessa durata. Senza una fine valida resta quella salvata. */
export const shiftedEnd = (previous: Record<string, unknown>, nextStart: string): string | undefined => {
  const kept = typeof previous.end === "string" ? previous.end : undefined;
  const start = Date.parse(String(previous.start));
  const end = Date.parse(String(previous.end));
  const moved = Date.parse(nextStart);
  if (!Number.isFinite(start) || !Number.isFinite(end) || !Number.isFinite(moved)) return kept;
  const shifted = new Date(moved + (end - start));
  return Number.isNaN(shifted.getTime()) ? kept : shifted.toISOString();
};

export type SharedFieldKind = "text" | "textarea" | "datetime" | "date" | "number" | "select";

/** Come si legge e si scrive un campo del dettaglio di un elemento altrui. */
export interface SharedFieldRule {
  kind: SharedFieldKind;
  /** Non può restare vuoto: un titolo o una data che l'elemento deve avere. */
  required?: boolean;
  min?: number;
  max?: number;
}

/** Testo da mettere nel campo per il valore salvato: i dati altrui possono avere qualsiasi tipo. */
export const sharedFieldInput = (kind: SharedFieldKind, value: unknown): string => {
  if (kind === "datetime") {
    const date = storedInstant(value);
    return date ? toDatetimeLocal(date) : "";
  }
  if (kind === "date") return storedDayOf(value);
  if (kind === "number") return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
  return typeof value === "string" ? value : "";
};

/**
 * Valore da salvare per ciò che è scritto in un campo, o null se non è valido (un campo obbligatorio
 * vuoto, una data o un numero illeggibili). Un campo facoltativo svuotato si toglie (`undefined`).
 * `original` è il valore salvato: una data tiene la sua ora.
 */
export const parseSharedField = (rule: SharedFieldRule, input: string, original: unknown): { value: unknown } | null => {
  const empty = () => (rule.required ? null : { value: undefined });
  switch (rule.kind) {
    case "text": {
      const value = input.trim();
      return value || !rule.required ? { value } : null;
    }
    case "datetime": {
      if (!input) return empty();
      const value = fromDatetimeLocal(input);
      return value ? { value } : null;
    }
    case "date": {
      if (!input) return empty();
      const value = replaceDatePart(original, input);
      return value ? { value } : null;
    }
    case "number": {
      const value = Number(input);
      if (!input.trim() || !Number.isFinite(value)) return null;
      return { value: Math.min(rule.max ?? value, Math.max(rule.min ?? value, Math.round(value))) };
    }
    default:
      return { value: input };
  }
};

/** Campi che viaggiano insieme in una modifica a un elemento altrui: se cambia uno, si mandano tutti. */
/**
 * Campi di un evento che vanno insieme in una modifica a un evento altrui: orari, e tutta la
 * ripetizione (regola nuova, impronta, fuso e i campi vecchi che ne sono la proiezione). Mandarne
 * solo una parte sopra l'ultima versione creerebbe un'impronta sbagliata o una regola a metà.
 */
export const CALENDAR_EVENT_FIELD_GROUPS = [
  ["start", "end", "allDay"],
  ["recurrence", "recurrenceUntil", "repeat", "repeatLegacy", "timeZone"]
] as const;

const SHARED_EDIT_GROUPS: Record<string, readonly (readonly string[])[]> = {
  studySession: [["start", "end"]],
  calendarEvent: CALENDAR_EVENT_FIELD_GROUPS
};

/**
 * Voci da tenere in coda in questa passata: le modifiche con una base (S4) dei proprietari la cui
 * rilettura prima dell'invio non è riuscita. Inviate senza riallinearle, con il timbro più recente
 * riscriverebbero ciò che il proprietario ha cambiato nel frattempo. Partono alla passata dopo.
 */
export const withoutUnreadEdits = <T extends Pick<SharedOutboxEntry, "ownerId" | "deleted" | "base">>(
  outbox: readonly T[],
  owners: ReadonlySet<string>
): readonly T[] => (owners.size ? outbox.filter((entry) => entry.deleted || !entry.base || !owners.has(entry.ownerId)) : outbox);

/** Campi che non si uniscono: identità e timbri (il timbro della versione unita lo decide chi unisce). */
const REBASE_SKIP = new Set(["id", "updatedAt", "deletedAt"]);

const sameUnit = (a: Payload, b: Payload, unit: readonly string[]) => unit.every((key) => JSON.stringify(a[key]) === JSON.stringify(b[key]));

/**
 * Stato e cronometro di un'attività: nel riallineamento vanno insieme. Uniti campo per campo, lo stato
 * «fatta» di qui finiva accanto al cronometro acceso del proprietario. Solo qui, non in sharedEditResult:
 * lì il cambio di stato si ricalcola già sull'ultima versione (taskStatusTransitionPatch).
 */
const TASK_STATUS_FIELDS = ["status", "timerStartedAt", "timerAccumulatedSeconds", "timerLastReminderAt", "actualMinutes", "completedAt"] as const;

const REBASE_GROUPS: Record<string, readonly (readonly string[])[]> = { ...SHARED_EDIT_GROUPS, task: [TASK_STATUS_FIELDS] };

/**
 * Stato e cronometro cambiati da entrambi, qui più recente. Stato cambiato qui e diverso da quello del
 * proprietario: lo stesso passaggio fatto sulla sua versione, all'ora della modifica di qui (cronometro
 * chiuso, tempo già contato salvato). Stesso stato: la versione di qui, intera. Qui solo il cronometro e
 * lo stato cambiato lassù: resta quella del proprietario (null).
 */
const rebasedTaskStatus = (base: Payload, local: Payload, remote: Payload): Payload | null => {
  if (local.status === remote.status) return local;
  if (local.status === base.status || typeof local.status !== "string") return null;
  const at = new Date(timestampOf(str(local.updatedAt)));
  return { ...remote, ...taskStatusTransitionPatch(remote as unknown as Task, local.status as Task["status"], at) };
};

/**
 * Unione a tre vie di una modifica in coda (`local`, partita da `base`) con la versione nuova del server
 * (`remote`). Si lavora per unità: un gruppo di SHARED_EDIT_GROUPS (es. orari) o un campo singolo, mai le
 * chiavi protette. Cambiata solo qui: vale quella di qui. Cambiata da entrambi in modo diverso: vince il
 * timbro più recente (a parità il proprietario) e l'unità finisce in `conflicts`. Il resto è del server.
 * `differs`: la versione unita ha ancora qualcosa di qui da inviare.
 */
export const rebaseSharedEdit = (entityType: string, base: Payload, local: Payload, remote: Payload) => {
  const groups = Object.hasOwn(REBASE_GROUPS, entityType) ? REBASE_GROUPS[entityType] : [];
  const grouped = new Set(groups.flat());
  const keys = new Set(
    [...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)].filter((key) => !REBASE_SKIP.has(key) && !PROTECTED_KEY.test(key))
  );
  const units: (readonly string[])[] = [...groups, ...[...keys].filter((key) => !grouped.has(key)).map((key) => [key])];
  const localNewer = timestampOf(str(local.updatedAt)) > timestampOf(str(remote.updatedAt));
  const merged: Payload = { ...remote };
  const conflicts: string[] = [];
  let differs = false;
  for (const unit of units) {
    if (sameUnit(base, local, unit) || sameUnit(local, remote, unit)) continue;
    let source: Payload | null = local;
    if (!sameUnit(base, remote, unit)) {
      conflicts.push(...unit);
      if (!localNewer) continue;
      if (unit === TASK_STATUS_FIELDS) source = rebasedTaskStatus(base, local, remote);
    }
    if (!source || sameUnit(source, remote, unit)) continue;
    for (const key of unit) {
      if (Object.hasOwn(source, key) && source[key] !== undefined) merged[key] = source[key];
      else delete merged[key];
    }
    differs = true;
  }
  return { merged, differs, conflicts };
};

/**
 * Prima di applicare righe del server (pull o rilettura dopo un rifiuto): le modifiche in coda con una
 * base (S4) si riallineano sulle righe nuove dello stesso elemento. La riga della base stessa
 * (`updated_at` uguale) non tocca la modifica in coda, qualunque sia il suo timbro. Una riga nuova si
 * unisce campo per campo (rebaseSharedEdit): se resta qualcosa di qui, la cache prende la versione
 * unita con un timbro oltre l'ora del server della riga (così il server la accetta), la voce prende la
 * riga come nuova base e un queuedAt nuovo (parte di nuovo, anche se un invio della versione di prima
 * era in volo), e la riga non passa oltre. Se non resta nulla, la voce esce e la riga si applica.
 * `force`: voci rifiutate come "stale", da riallineare anche sulla riga della base (orologio indietro).
 * Le eliminazioni, del server o in coda, seguono le regole di prima.
 */
export const rebasePendingEdits = (
  items: readonly SharedItem[],
  ownerId: string,
  rows: readonly RemoteSharedRow[],
  outbox: readonly SharedOutboxEntry[],
  options: { now: string; force?: ReadonlySet<string> }
) => {
  const queued = new Map(outbox.filter((entry) => !entry.deleted && entry.base).map((entry) => [entry.key, entry]));
  if (!queued.size) return { items, rows, outbox, conflicts: 0 };
  const force = options.force ?? new Set<string>();
  const cached = new Map(items.map((entry) => [entry.key, entry]));
  const replacedItems = new Map<string, SharedItem>();
  const replacedEntries = new Map<string, SharedOutboxEntry | null>();
  const passed: RemoteSharedRow[] = [];
  let conflicts = 0;
  for (const row of rows) {
    const key = sharedKey(ownerId, row.entity_type, row.entity_id);
    const entry = replacedEntries.has(key) ? replacedEntries.get(key) : queued.get(key);
    const local = replacedItems.get(key) ?? cached.get(key);
    if (!entry || !entry.base || !local) {
      passed.push(row);
      continue;
    }
    if (row.deleted) {
      // Eliminato lassù: una modifica rifiutata non ha più nulla su cui riallinearsi.
      if (force.has(key)) replacedEntries.set(key, null);
      passed.push(row);
      continue;
    }
    // La riga della base: stessa ora del server e stesso timbro. Nulla di nuovo, la modifica resta com'è.
    const isBase = row.updated_at === entry.baseAt && str(row.payload.updatedAt) === str(entry.base.updatedAt);
    if (isBase && !force.has(key)) continue;
    const result = rebaseSharedEdit(row.entity_type, entry.base, local.entity, row.payload);
    if (result.conflicts.length) conflicts += 1;
    if (!result.differs) {
      replacedEntries.set(key, null);
      passed.push(row);
      continue;
    }
    const at = Math.max(timestampOf(str(local.entity.updatedAt)), timestampOf(options.now), timestampOf(row.updated_at) + 1);
    const queuedAt = options.now === entry.queuedAt ? new Date(timestampOf(options.now) + 1).toISOString() : options.now;
    replacedItems.set(key, { ...local, entity: { ...result.merged, updatedAt: new Date(at).toISOString() } as SharedEntity, serverUpdatedAt: row.updated_at });
    replacedEntries.set(key, { ...entry, base: withoutProtectedKeys(row.payload), baseAt: row.updated_at, queuedAt });
  }
  if (!replacedItems.size && !replacedEntries.size && passed.length === rows.length) return { items, rows, outbox, conflicts };
  return {
    items: items.map((entry) => replacedItems.get(entry.key) ?? entry),
    rows: passed,
    outbox: outbox.flatMap((entry) => {
      if (!replacedEntries.has(entry.key) || entry !== queued.get(entry.key)) return [entry];
      const next = replacedEntries.get(entry.key);
      return next ? [next] : [];
    }),
    conflicts
  };
};

/**
 * Elemento altrui da scrivere dopo una modifica, o null se non è cambiato nulla. `opened` è come era
 * quando si è aperto il dettaglio, `edits` solo i campi toccati, `latest` l'ultima versione nello
 * store: si invia solo ciò che è cambiato sopra `latest`, così le modifiche che il proprietario ha
 * fatto nel frattempo non tornano indietro. La fine di una sessione segue l'inizio (stessa durata
 * dell'ultima versione). Un cambio di stato di un'attività fa ciò che farebbe l'app del proprietario
 * (cronometro chiuso e tempo salvato, completamento), calcolato sull'ultima versione: il tempo già
 * contato non va perso, anche se il cronometro è partito dopo l'apertura del dettaglio.
 */
export const sharedEditResult = (
  entityType: string,
  opened: Record<string, unknown>,
  edits: Record<string, unknown>,
  latest: SharedEntity,
  now: string = new Date().toISOString()
): SharedEntity | null => {
  const edited: Record<string, unknown> = { ...opened, ...edits };
  if (entityType === "studySession" && typeof edits.start === "string") edited.end = shiftedEnd(latest, edits.start);
  const groups = Object.hasOwn(SHARED_EDIT_GROUPS, entityType) ? SHARED_EDIT_GROUPS[entityType] : [];
  const patch: Record<string, unknown> = changedFields(opened, edited, groups);
  // Non passa dal confronto con `opened`: ciò che chiude il cronometro dipende da com'è ora, non da com'era.
  if (entityType === "task" && typeof edits.status === "string") {
    Object.assign(patch, taskStatusTransitionPatch(latest as unknown as Task, edits.status as Task["status"], new Date(now)));
  }
  return Object.keys(patch).length ? { ...latest, ...patch } : null;
};

/**
 * Stato del canale realtime (callback di `subscribe`): a ogni SUBSCRIBED, compresa la prima iscrizione
 * di un canale nuovo o ricreato e ogni riconnessione, chiede un pull di recupero. Le righe scritte da
 * altri prima che il canale fosse davvero iscritto non arrivano come evento: senza questo restavano
 * fuori fino all'evento dopo o al ricontrollo dei 5 minuti. `isCurrent`: un canale già sostituito tace.
 */
export const catchUpWhenSubscribed =
  (isCurrent: () => boolean, pull: () => void) =>
  (status: string): void => {
    if (status === "SUBSCRIBED" && isCurrent()) pull();
  };
