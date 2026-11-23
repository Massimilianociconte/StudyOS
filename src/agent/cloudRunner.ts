// Connettore remoto: esegue gli strumenti degli agenti sui dati cloud di un account, con StudyOS
// chiuso. Gira nell'hub (Worker Cloudflare o scripts/agent.ts), mai nel browser.
//
// Per ogni chiamata:
// 1. legge le righe dell'account con `studyos_agent_pull` (la prima volta tutte, poi solo le
//    nuove: la cache resta in memoria finché vive l'istanza);
// 2. le carica nello store, senza persistenza locale, ed esegue lo stesso `executeAgentTool`
//    dell'app con il fuso orario della persona (ZonedDate);
// 3. confronta prima e dopo per riferimento e scrive solo le entità cambiate con
//    `studyos_agent_push`, con la regola LWW del cloud. L'app le ritira al pull successivo.
// Il segreto del permesso (vedi supabase/agent.sql) arriva dal «Consenti» nell'app.
// Dalla 1.8.0 la push porta anche il nome dello strumento e un id della chiamata (uguale su tutte le
// push della stessa richiesta): il database scrive il registro (studyos_agent_audit), che
// studyos_list_audit legge per chiamate e studyos_restore_change annulla, una chiamata intera o una voce.
// studyos_split_pages è puro: si risponde subito, senza leggere né scrivere il cloud.
//
// Dalla 1.12.0 il connettore remoto ha gli stessi strumenti del principale (supabase/agent-parity.sql):
// - gruppi, bacheca, appelli e correzioni dei gruppi: letture e scritture con le funzioni del segreto,
//   che fanno valere auth.uid() = l'account del permesso e ripetono i controlli dell'app;
// - dati condivisi da altre persone: letti come li legge l'app (stessa RLS, ripetuta nella funzione);
// - dare, cambiare o togliere condivisioni e scrivere dati di altri: diventano una richiesta che la
//   persona conferma nell'app (notifica push), come le conferme del connettore principale; l'esito
//   si legge con studyos_approval_status;
// - timer di studio: lo stato dell'account nel cloud (studyos_timer_states), lo stesso dell'app.

import { CLOUD_DEFERRED, CLOUD_UNAVAILABLE, findAgentTool, toolSummary } from "./catalog";
import { ALL_GROUPS, GROUP_TYPES, groupOfType, groupsForTool, type DataGroup } from "./cloudGroups";
import { configureAgentRuntime, executeAgentTool, groupSyncLoader, splitPagesResult } from "./execute";
import { groupExamWriterLoader } from "./groupExamTools";
import {
  AUDIT_UUID_RE,
  auditImage,
  auditPage,
  auditTitle,
  restoreConflicts,
  restoredChanges,
  type RestoreOutcome,
  type ServerAuditRow
} from "./remoteAudit";
import { fail, toIso } from "./toolkit";
import type { AgentCallResult } from "./types";
import { withZonedDate } from "./zonedDate";
import {
  COLLECTIONS,
  COLLECTION_BY_ENTITY_TYPE,
  ENTITY_TYPES,
  laterStamp,
  timestampOf,
  type CollectionKey,
  type CollectionsState,
  type SyncableEntity
} from "../lib/collections";
import { baselineFrom, diffCollections, setPersistenceSuspended } from "../lib/persistence";
import { chunkBySize } from "../lib/syncMerge";
import { GROUP_COLLECTIONS } from "../lib/syncScope";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import {
  historyFromRow,
  overrideFromRow,
  sessionFromRow,
  writeResultFrom,
  type CatalogOverride,
  type GroupExamSession,
  type GroupExamWriter,
  type GroupHistoryEntry
} from "../lib/groupExams";
import { activityFromRow, groupFromRow, memberFromRow, resourceFromRow, visibleMemberName } from "../lib/groups";
import { GROUP_EXAM_TEXT } from "../lib/labels/groupExams";
import { SCOPE_ENTITY_TYPES, grantFromRow, inviteFromRow, mergeSharedRows, safeCssColor, type RemoteSharedRow, type ShareGrant, type SharedItem } from "../lib/sharing";
import { defaultTimer, normalizeTimer, type TimerState } from "../lib/studyTimer";
import { useGroupExamStore } from "../store/useGroupExamStore";
import { useSharedStore } from "../store/useSharedStore";
import type { GroupResource, StudyGroup } from "../types";

/** Permesso di un connettore remoto: segreto di `studyos_create_agent_grant` e fuso del browser. */
export interface CloudGrant {
  secret: string;
  timeZone: string;
}

export interface CloudBackend {
  /** URL del progetto Supabase. */
  url: string;
  /** Chiave publishable (`sb_publishable_…`): le funzioni vogliono comunque il segreto. */
  key: string;
  fetch?: typeof fetch;
  /** Orologio (prove). */
  now?: () => number;
  /** Id di una chiamata (prove). */
  newCallId?: () => string;
  /** Attesa tra due letture dell'esito di una conferma (prove). */
  sleep?: (ms: number) => Promise<void>;
}

export interface CloudRunner {
  run: (grant: CloudGrant, name: string, args: Record<string, unknown>) => Promise<AgentCallResult>;
  /** Dimentica la cache di un permesso (revoca, nuovo consenso). */
  forget: (secret: string) => void;
  /**
   * Il permesso vale? Una lettura vuota (solo le righe cambiate da adesso, al più una): prima di
   * emettere un codice dal consenso, così un permesso sbagliato non diventa un token che fallisce.
   */
  verify: (grant: CloudGrant) => Promise<"ok" | "revoked" | "offline">;
}

interface PulledRow {
  entity_type: string;
  entity_id: string;
  payload: unknown;
  deleted: boolean;
  updated_at: string;
}

interface AccountCache {
  rows: Map<string, PulledRow>;
  /** Cursore del pull di tutti i tipi (agent.sql senza p_types). */
  cursor: string | null;
  /** Gruppi già letti e il loro cursore (1.10.0: pull per tipi, vedi cloudGroups.ts). */
  loaded: Set<DataGroup>;
  cursors: Map<DataGroup, string | null>;
}

/** Timer letto dal cloud per una chiamata: lo stato e il changedAt della riga (null = nessuna riga). */
interface TimerRead {
  timer: TimerState;
  expected: number | null;
}

interface PushRow {
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  deleted: boolean;
}

const PAGE_SIZE = 1000;
const CURSOR_OVERLAP_MS = 60_000;
const PUSH_MAX_BYTES = 900_000;
const PUSH_MAX_ROWS = 200;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CACHED_ACCOUNTS = 16;
/** Dopo un PGRST202 della push nuova, per quanto si scrive come prima prima di riprovare. */
export const LEGACY_PUSH_RETRY_MS = 10 * 60_000;
/** Chiamate per pagina di studyos_list_audit sul server. */
const AUDIT_PAGE_MAX = 50;
/** client_id delle righe scritte dal connettore: diverso da ogni scheda, così l'app le ritira. */
export const CLOUD_CLIENT_ID = "agent-remote";

export const CLOUD_TEXT = {
  revoked: "Questo connettore non può più usare l'account: l'accesso è stato revocato in StudyOS. In ChatGPT scollega e ricollega il connettore, poi premi «Consenti» nell'app.",
  offline: "Il cloud di StudyOS non risponde. Riprova tra poco.",
  unavailable: "Strumento non disponibile sul connettore remoto: usa il connettore principale con StudyOS aperto.",
  conflict: (count: number, partial: boolean) =>
    `${partial ? "Modifica salvata solo in parte" : "Modifica non salvata"}: ${count === 1 ? "un elemento è stato cambiato" : `${count} elementi sono stati cambiati`} nel frattempo da un altro dispositivo o da un altro assistente. Rileggi i dati e riprova.`,
  itemConflict: "Cambiato nel frattempo da un altro dispositivo o da un altro assistente: non salvato. Rileggi l'elemento e riprova.",
  auditMissing: "Il registro del connettore non è ancora attivo: chi gestisce StudyOS deve eseguire di nuovo supabase/agent.sql.",
  badAuditId: "id deve essere l'id (un uuid) di una voce o di una chiamata (callId) restituito da studyos_list_audit.",
  badDate: "since e until devono essere date ISO 8601.",
  restoreNotFound: "Questa modifica non c'è nel registro: rileggi gli id con studyos_list_audit (le voci durano 90 giorni).",
  restoreDone: "Questa modifica è già stata annullata.",
  /** what: «Titolo» (collection itemId) del primo elemento cambiato dopo. */
  restoreConflict: (what: string, items: number) =>
    items > 1
      ? `Non annullata: ${what} è cambiato dopo questa azione (nell'app o con un'altra modifica). L'annullamento è tutto o niente: nessuno dei ${items} elementi è stato toccato. In conflicts ci sono gli elementi cambiati, com'erano adesso.`
      : `Non annullata: ${what} è cambiato dopo questa modifica (nell'app o con un'altra modifica). Non è stato toccato niente: in current c'è com'è adesso.`,
  restored: (action: string) =>
    action === "delete" ? "Modifica annullata: l'elemento creato è stato eliminato."
      : action === "create" ? "Modifica annullata: l'elemento è di nuovo tra i dati."
        : "Modifica annullata: l'elemento è tornato com'era prima.",
  restoredCall: (count: number) => `Azione annullata: ${count} elementi sono tornati com'erano prima.`,
  /** Stesse parole del connettore principale (httpHub.ts). */
  pending: "L'azione aspetta la conferma della persona in StudyOS. Non ripeterla: avvisa la persona e chiama studyos_approval_status con questo approvalId.",
  running: "La persona l'ha confermata in StudyOS e l'app la sta eseguendo. Non ripeterla: richiama tra poco studyos_approval_status con questo approvalId.",
  approvalNotFound: "Nessuna azione con questo approvalId per questo account. Le conferme durano 30 minuti e il loro esito 7 giorni.",
  approvalDenied: "Rifiutato in StudyOS.",
  approvalExpired: "Nessuna conferma in StudyOS entro 30 minuti: l'azione non è stata eseguita.",
  parityMissing: "Questa funzione del connettore remoto non è ancora attiva: chi gestisce StudyOS deve eseguire supabase/agent-parity.sql.",
  resourceNotSaved: "Risorsa non pubblicata: il server dei gruppi non l'ha accettata (rete o permessi). Non è stata salvata: riprova tra poco.",
  timerConflict: "Il timer è stato cambiato nel frattempo in StudyOS: niente è stato salvato. Rileggilo con studyos_timer_status e riprova."
} as const;

class GrantError extends Error {}

/** Funzione RPC assente (agent.sql di prima): PostgREST risponde PGRST202. */
class MissingFunctionError extends Error {}

/** Errore del database con il suo codice (es. 54000: troppe richieste da confermare). */
class RpcError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

/**
 * Strumenti che leggono appelli o correzioni dei gruppi: prima si chiede lo snapshot al server
 * (studyos_agent_group_snapshot, spec §9.5), che vale solo per quella chiamata.
 */
export const GROUP_SNAPSHOT_TOOLS: ReadonlySet<string> = new Set([
  "studyos_list_group_exam_sessions",
  "studyos_plan_exam",
  "studyos_list_exam_plan",
  "studyos_check_consistency",
  "studyos_list_barb_teachers",
  "studyos_get_barb_course",
  "studyos_list_barb_contacts",
  // 1.12.0: scrivere e ripristinare partono dalla versione attuale, come nell'app.
  "studyos_create_group_exam_session",
  "studyos_update_group_exam_session",
  "studyos_delete_group_exam_session",
  "studyos_list_group_history",
  "studyos_restore_group_change",
  "studyos_save_catalog_override",
  "studyos_delete_catalog_override"
]);

/**
 * Strumenti che leggono gruppi, membri, bacheca e attività dalle tabelle dei gruppi (studyos_agent_groups):
 * nel cloud personale ce n'è solo una copia vecchia. Anche studyos_status (quanti gruppi), i collegamenti
 * (un id di gruppo o di risorsa) e le condivisioni (persone dei gruppi, gruppi destinatari).
 */
export const GROUP_TABLE_TOOLS: ReadonlySet<string> = new Set([
  "studyos_list_groups",
  "studyos_list_group_board",
  "studyos_add_group_resource",
  "studyos_delete_group_resource",
  "studyos_list_shares",
  "studyos_status",
  "studyos_add_link"
]);

/**
 * Strumenti per cui gruppi o dati condivisi sono il contenuto: se non si leggono, la chiamata fallisce.
 * Per gli altri (panoramica, stato, collegamenti, flashcard) sono un'aggiunta, come nell'app: senza,
 * lo strumento risponde con i soli dati personali.
 */
const GROUPS_REQUIRED: ReadonlySet<string> = new Set([
  "studyos_list_groups",
  "studyos_list_group_board",
  "studyos_add_group_resource",
  "studyos_delete_group_resource",
  "studyos_list_shares"
]);
const SHARING_REQUIRED: ReadonlySet<string> = new Set(["studyos_list_shares", "studyos_list_shared_items"]);

/** Strumenti di flashcard e quiz che leggono anche le raccolte condivise da altre persone (learningShared.ts). */
const LEARNING_SHARED_TOOLS: ReadonlySet<string> = new Set([
  "studyos_list_ai_requests",
  "studyos_take_ai_request",
  "studyos_finish_ai_request"
]);

/**
 * Tipi dei dati di altre persone da leggere per uno strumento (studyos_agent_sharing): null = tutti,
 * [] = solo le condivisioni, undefined = niente (lo strumento non li usa).
 */
export const sharedTypesFor = (name: string, groups: readonly DataGroup[]): string[] | null | undefined => {
  if (name === "studyos_list_shares") return [];
  if (name === "studyos_list_shared_items") return null;
  // Eventi di oggi dei calendari condivisi (sharedTodayEvents).
  if (name === "studyos_overview") return [...SCOPE_ENTITY_TYPES.calendar];
  if (LEARNING_SHARED_TOOLS.has(name) || groups.some((group) => group === "decks" || group === "cards" || group === "questions")) {
    return [...SCOPE_ENTITY_TYPES.flashcards];
  }
  return undefined;
};

export const TIMER_TOOLS: ReadonlySet<string> = new Set(["studyos_timer_status", "studyos_timer_control"]);

/** Attesa di una conferma nell'app: come il connettore principale, ma entro i limiti di una richiesta del Worker. */
const APPROVAL_POLL_MS = 2_500;
/** Letture dell'esito dopo la prima: al più 20 secondi, poche sotto-richieste per chiamata. */
const APPROVAL_POLLS = 8;
/** Righe di dati di altre persone lette per chiamata (le più recenti). */
const SHARED_ROWS_MAX = 5000;
const APPROVAL_PREFIX = "req_";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Le righe dello snapshot non hanno id degli account: `mine` dice se l'ha aggiunta la persona ("remote"). */
const withRemoteAuthor = (row: unknown) =>
  row && typeof row === "object" ? { ...(row as Record<string, unknown>), created_by: (row as { mine?: unknown }).mine === true ? "remote" : "" } : row;

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const isCallResult = (value: unknown): value is AgentCallResult =>
  isRecord(value) && typeof value.ok === "boolean" && (value.ok ? isRecord(value.data) : typeof value.error === "string");

type GroupSyncApi = Awaited<ReturnType<(typeof groupSyncLoader)["load"]>>;

const keyOf = (type: string, id: string) => `${type}:${id}`;

const isEntity = (value: unknown, id: string): value is SyncableEntity =>
  Boolean(value) && typeof value === "object" && (value as SyncableEntity).id === id;

/** Timbro LWW della riga in cache, come `studyos_item_stamp` sul server. */
const rowStamp = (row: PulledRow | undefined) => {
  if (!row) return 0;
  const payload = (row.payload ?? {}) as { updatedAt?: string; deletedAt?: string };
  const own = row.deleted ? payload.deletedAt ?? payload.updatedAt : payload.updatedAt;
  return timestampOf(own) || timestampOf(row.updated_at);
};

const emptyCollections = () =>
  Object.fromEntries(COLLECTIONS.map((key) => [key, [] as SyncableEntity[]])) as unknown as CollectionsState;

const collectionsFrom = (cache: AccountCache, groups: ReadonlySet<DataGroup>): CollectionsState => {
  const collections = emptyCollections() as unknown as Record<CollectionKey, SyncableEntity[]>;
  for (const row of cache.rows.values()) {
    if (row.deleted) continue;
    // Solo i gruppi dello strumento: meno dati da confrontare dopo (CPU del Worker).
    if (!groups.has(groupOfType(row.entity_type))) continue;
    const collection = COLLECTION_BY_ENTITY_TYPE[row.entity_type];
    if (!collection || !isEntity(row.payload, row.entity_id)) continue;
    // Gruppi: la verità è nelle tabelle condivise; nel cloud personale ne resta solo una copia vecchia
    // (o nessuna). Fuori anche dalla panoramica e dalla ricerca, e mai riscritti da qui.
    if (GROUP_COLLECTIONS.has(collection)) continue;
    collections[collection].push(row.payload);
  }
  return collections as unknown as CollectionsState;
};

/**
 * Righe da scrivere per le entità cambiate. Il server accetta solo un timbro più recente di
 * quello che ha: un'entità cambiata senza un updatedAt nuovo (orologio indietro, campo non
 * aggiornato) prende `laterStamp`; un'eliminazione diventa un tombstone `{ id, deletedAt }`.
 */
export const plannedRows = (before: CollectionsState, after: CollectionsState, cached: (type: string, id: string) => PulledRow | undefined): PushRow[] => {
  const diff = diffCollections(after, baselineFrom(before));
  const rows: PushRow[] = [];
  for (const collection of COLLECTIONS) {
    // Gruppi, bacheca e attività stanno nelle tabelle dei gruppi: le scrive groupSyncLoader, mai il cloud personale.
    if (GROUP_COLLECTIONS.has(collection)) continue;
    const type = ENTITY_TYPES[collection];
    for (const item of diff.puts[collection] ?? []) {
      const previous = rowStamp(cached(type, item.id));
      const payload = timestampOf(item.updatedAt) > previous ? item : { ...item, updatedAt: laterStamp(new Date(previous).toISOString()) };
      rows.push({ entity_type: type, entity_id: item.id, payload: payload as unknown as Record<string, unknown>, deleted: false });
    }
    for (const id of diff.deletes[collection] ?? []) {
      const previous = rowStamp(cached(type, id));
      rows.push({ entity_type: type, entity_id: id, payload: { id, deletedAt: laterStamp(new Date(previous).toISOString()) }, deleted: true });
    }
  }
  return rows;
};

/** Lo store condiviso vuoto: nessun dato di altre persone resta tra una chiamata e l'altra. */
const resetShared = () =>
  useSharedStore.setState({ viewerId: null, availability: "unknown", items: [], given: [], received: [], invites: [], labels: [], outbox: [], hiddenOwners: [], notice: null, syncError: null, persistent: false });

/** Lo store è uno solo: un'esecuzione alla volta, per qualsiasi account. */
let chain: Promise<unknown> = Promise.resolve();
const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
  const run = chain.then(task);
  chain = run.catch(() => undefined);
  return run;
};

/**
 * Righe rifiutate dal database (revisione cambiata nel frattempo) riportate sui loro elementi: gli
 * strumenti a lotti (flashcard, domande, raccolte) promettono un esito per elemento, e gli altri
 * elementi sono stati salvati. Solo se ogni riga rifiutata corrisponde a un elemento della risposta;
 * altrimenti (righe di contorno, strumenti senza elenco) l'errore resta per tutta la chiamata.
 */
export const perItemConflicts = (result: AgentCallResult, refusedIds: ReadonlySet<string>): AgentCallResult | null => {
  if (!result.ok || !Array.isArray(result.data.items) || !refusedIds.size) return null;
  const matched = new Set<string>();
  const counts: Record<string, number> = {};
  const items = (result.data.items as unknown[]).map((item) => {
    if (!item || typeof item !== "object") return item;
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !refusedIds.has(record.id) || (record.status !== "created" && record.status !== "updated")) return item;
    matched.add(record.id);
    counts[record.status] = (counts[record.status] ?? 0) + 1;
    return { ...record, status: "conflict", error: CLOUD_TEXT.itemConflict };
  });
  if (matched.size !== refusedIds.size) return null;
  const data: Record<string, unknown> = { ...result.data, items };
  for (const [status, count] of Object.entries(counts)) if (typeof data[status] === "number") data[status] = (data[status] as number) - count;
  if (typeof data.conflict === "number") data.conflict = (data.conflict as number) + matched.size;
  return { ...result, data };
};

export const createCloudRunner = (backend: CloudBackend): CloudRunner => {
  const base = backend.url.replace(/\/+$/, "");
  const doFetch = backend.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = backend.now ?? (() => Date.now());
  const newCallId = backend.newCallId ?? (() => crypto.randomUUID());
  const sleep = backend.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const caches = new Map<string, AccountCache>();

  const rpc = async <T>(fn: string, body: Record<string, unknown>): Promise<T> => {
    const signal = typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined;
    const response = await doFetch(`${base}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: { apikey: backend.key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(body),
      signal
    });
    const raw = await response.text();
    let data: unknown = null;
    try {
      data = raw ? JSON.parse(raw) : null;
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = (data ?? {}) as { code?: string; message?: string };
      if (error.code === "28000") throw new GrantError(error.message ?? "revoked");
      if (error.code === "PGRST202") throw new MissingFunctionError(error.message ?? fn);
      throw new RpcError(error.message ?? `HTTP ${response.status}`, error.code ?? "");
    }
    return data as T;
  };

  const cacheFor = (secret: string) => {
    let cache = caches.get(secret);
    if (cache) {
      // Ordine di inserimento = uso più recente in fondo.
      caches.delete(secret);
      caches.set(secret, cache);
      return cache;
    }
    cache = { rows: new Map(), cursor: null, loaded: new Set(), cursors: new Map() };
    caches.set(secret, cache);
    while (caches.size > MAX_CACHED_ACCOUNTS) caches.delete(caches.keys().next().value as string);
    return cache;
  };

  /** Righe nuove dopo l'ultimo cursore, con un minuto di sovrapposizione come la sync dell'app. */
  const refreshAll = async (secret: string, cache: AccountCache) => {
    const since = cache.cursor ? new Date(Date.parse(cache.cursor) - CURSOR_OVERLAP_MS).toISOString() : null;
    let offset = 0;
    for (;;) {
      const page = await rpc<PulledRow[]>("studyos_agent_pull", { p_secret: secret, p_since: since, p_offset: offset, p_limit: PAGE_SIZE });
      if (!Array.isArray(page)) throw new Error("Risposta del cloud non valida.");
      for (const row of page) {
        cache.rows.set(keyOf(row.entity_type, row.entity_id), row);
        if (!cache.cursor || row.updated_at > cache.cursor) cache.cursor = row.updated_at;
      }
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    // Letto tutto: ogni gruppo riparte da qui se torna il pull per tipi.
    for (const group of ALL_GROUPS) {
      cache.loaded.add(group);
      cache.cursors.set(group, cache.cursor);
    }
  };

  /** Pull per tipi di alcuni gruppi da `since` (null = tutto), con il cursore di ciascun gruppo. */
  const pullGroups = async (secret: string, cache: AccountCache, groups: DataGroup[], since: string | null) => {
    const types = groups.flatMap((group) => GROUP_TYPES[group]);
    let offset = 0;
    let latest: string | null = null;
    for (;;) {
      const page = await rpc<PulledRow[]>("studyos_agent_pull", { p_secret: secret, p_since: since, p_offset: offset, p_limit: PAGE_SIZE, p_types: types });
      if (!Array.isArray(page)) throw new Error("Risposta del cloud non valida.");
      for (const row of page) {
        cache.rows.set(keyOf(row.entity_type, row.entity_id), row);
        if (!latest || row.updated_at > latest) latest = row.updated_at;
      }
      if (page.length < PAGE_SIZE) break;
      offset += PAGE_SIZE;
    }
    // Tutti i gruppi letti sono aggiornati fino all'ultima riga vista, anche quelli senza righe nuove:
    // updated_at lo scrive il server, una riga successiva arriva dopo (col minuto di sovrapposizione).
    // Con il cursore della sola ultima riga di ogni gruppo, il gruppo fermo da più tempo (le materie)
    // farebbe rileggere a ogni chiamata tutte le righe degli altri gruppi scritte dopo.
    for (const group of groups) {
      cache.loaded.add(group);
      const cursor = cache.cursors.get(group);
      if (latest && (!cursor || latest > cursor)) cache.cursors.set(group, latest);
    }
  };

  // agent.sql di prima della 1.10.0: studyos_agent_pull senza p_types (PGRST202). Si legge tutto come
  // prima per LEGACY_PUSH_RETRY_MS, poi si riprova il pull per tipi.
  let legacyPullUntil = 0;

  /**
   * Aggiorna i gruppi chiesti: quelli mai letti da capo in una chiamata, gli altri in una sola
   * chiamata incrementale dal cursore più vecchio fra loro (da capo se uno è ancora senza righe:
   * account vuoto, lettura vuota). Al massimo due letture (più pagine).
   */
  const refresh = async (secret: string, cache: AccountCache, groups: readonly DataGroup[]) => {
    if (!groups.length) return;
    if (now() < legacyPullUntil) return refreshAll(secret, cache);
    const fresh = groups.filter((group) => !cache.loaded.has(group));
    const known = groups.filter((group) => cache.loaded.has(group));
    try {
      if (fresh.length) await pullGroups(secret, cache, fresh, null);
      if (known.length) {
        const cursors = known.map((group) => cache.cursors.get(group) ?? null);
        const oldest = cursors.includes(null) ? null : (cursors as string[]).sort()[0];
        await pullGroups(secret, cache, known, oldest ? new Date(Date.parse(oldest) - CURSOR_OVERLAP_MS).toISOString() : null);
      }
    } catch (error) {
      if (!(error instanceof MissingFunctionError)) throw error;
      legacyPullUntil = now() + LEGACY_PUSH_RETRY_MS;
      await refreshAll(secret, cache);
    }
  };

  // agent.sql di prima: studyos_agent_push senza p_tool e p_call (quella della prima revisione 1.8.0
  // ha p_tool ma non p_call, e accetta la chiamata a tre argomenti). Una push rifiutata con PGRST202
  // ripete la stessa scrittura come prima; per LEGACY_PUSH_RETRY_MS si scrive così, poi si riprova la
  // push nuova: dopo aver rieseguito agent.sql il registro torna completo senza riavviare l'hub.
  let legacyUntil = 0;

  const pushBatch = async (secret: string, rows: PushRow[], tool: string, callId: string) => {
    const body = { p_secret: secret, p_client_id: CLOUD_CLIENT_ID, p_rows: rows };
    if (now() >= legacyUntil) {
      try {
        const results = await rpc<Array<{ entity_type: string; entity_id: string; accepted: boolean }>>("studyos_agent_push", { ...body, p_tool: tool, p_call: callId });
        legacyUntil = 0;
        return results;
      } catch (error) {
        if (!(error instanceof MissingFunctionError)) throw error;
        legacyUntil = now() + LEGACY_PUSH_RETRY_MS;
      }
    }
    return rpc<Array<{ entity_type: string; entity_id: string; accepted: boolean }>>("studyos_agent_push", body);
  };

  const push = async (secret: string, cache: AccountCache, rows: PushRow[], tool: string, callId: string) => {
    const encoder = new TextEncoder();
    // Righe in ordine fisso (tipo, id): due hub che scrivono le stesse schede in ordine diverso
    // bloccherebbero le righe a incrocio e Postgres annullerebbe un lotto intero (deadlock).
    const ordered = [...rows].sort((a, b) => (a.entity_type === b.entity_type ? (a.entity_id < b.entity_id ? -1 : a.entity_id > b.entity_id ? 1 : 0) : a.entity_type < b.entity_type ? -1 : 1));
    const sized = ordered.map((row) => ({ row, size: encoder.encode(JSON.stringify(row)).length }));
    let accepted = 0;
    let refused = 0;
    const refusedIds = new Set<string>();
    for (const batch of chunkBySize(sized, (item) => item.size, PUSH_MAX_BYTES, PUSH_MAX_ROWS)) {
      const results = await pushBatch(secret, batch.map((item) => item.row), tool, callId);
      if (!Array.isArray(results) || results.length !== batch.length) throw new Error("Risposta del cloud incompleta.");
      const now = new Date().toISOString();
      for (const [index, { row }] of batch.entries()) {
        if (results[index]?.accepted) {
          accepted += 1;
          // Il cursore non si muove: il pull successivo rilegge anche queste righe, già uguali.
          cache.rows.set(keyOf(row.entity_type, row.entity_id), { ...row, updated_at: now });
        } else {
          refused += 1;
          refusedIds.add(row.entity_id);
        }
      }
    }
    return { accepted, refused, refusedIds };
  };

  /** Appelli e correzioni dei gruppi dell'account nello store in memoria. Script non eseguito = non attivi. */
  const loadGroupSnapshot = async (secret: string) => {
    const store = useGroupExamStore.getState();
    try {
      const raw = await rpc<{ groups?: unknown; sessions?: unknown; overrides?: unknown } | null>("studyos_agent_group_snapshot", { p_secret: secret });
      const groups = listOf(raw?.groups).flatMap((item) => {
        const row = (item ?? {}) as { id?: unknown; name?: unknown };
        return typeof row.id === "string" && typeof row.name === "string" ? [{ id: row.id, name: row.name }] : [];
      });
      const sessions = listOf(raw?.sessions)
        .map((row) => sessionFromRow(withRemoteAuthor(row)))
        .filter((row): row is GroupExamSession => row !== null);
      const overrides = listOf(raw?.overrides)
        .map((row) => overrideFromRow(withRemoteAuthor(row)))
        .filter((row): row is CatalogOverride => row !== null);
      store.setSnapshot({ viewerId: "remote", groups, sessions, overrides });
    } catch (error) {
      if (error instanceof GrantError) throw error;
      if (error instanceof MissingFunctionError) store.setUnavailable();
      // Rete: lo store resta «non letto» e gli strumenti dicono not_connected per i dati dei gruppi.
    }
  };

  /**
   * Appelli e correzioni dei gruppi scritti con le funzioni del segreto (agent-parity.sql): stesse funzioni
   * dell'app sul server, righe dell'esito come nello snapshot (senza indirizzi né id degli account).
   * Gli errori sono quelli di lib/groupExamSync, che groupExamTools riconosce.
   */
  const remoteGroupExamWriter = (secret: string, lost: () => void): GroupExamWriter => {
    const call = async (fn: string, body: Record<string, unknown>): Promise<unknown> => {
      try {
        return await rpc<unknown>(fn, { p_secret: secret, ...body });
      } catch (error) {
        if (error instanceof GrantError) lost();
        throw new Error(error instanceof MissingFunctionError ? GROUP_EXAM_TEXT.notActive : GROUP_EXAM_TEXT.offline);
      }
    };
    const session = (row: unknown) => sessionFromRow(withRemoteAuthor(row));
    const override = (row: unknown) => overrideFromRow(withRemoteAuthor(row));
    const either = (row: unknown): GroupExamSession | CatalogOverride | null => session(row) ?? override(row);
    return {
      saveSession: async (groupId, id, expectedVersion, fields) =>
        writeResultFrom(await call("studyos_agent_save_group_exam_session", { p_group_id: groupId, p_id: id, p_expected_version: expectedVersion, p_fields: fields }), session),
      deleteSession: async (id, expectedVersion) =>
        writeResultFrom(await call("studyos_agent_delete_group_exam_session", { p_id: id, p_expected_version: expectedVersion }), session),
      restore: async (historyId, expectedVersion) =>
        writeResultFrom(await call("studyos_agent_restore_group_record", { p_history_id: historyId, p_expected_version: expectedVersion }), either),
      listHistory: async ({ groupId, recordKind, recordId, limit, beforeId }) => {
        const rows = await call("studyos_agent_group_history", {
          p_group_id: groupId,
          p_record_kind: recordKind ?? null,
          p_record_id: recordId ?? null,
          p_before_id: beforeId ?? null,
          p_limit: limit
        });
        if (!Array.isArray(rows)) return null;
        return rows.map(historyFromRow).filter((entry): entry is GroupHistoryEntry => entry !== null);
      },
      saveOverride: async (groupId, id, expectedVersion, targetKind, targetId, targetLabel, fields) =>
        writeResultFrom(
          await call("studyos_agent_save_catalog_override", {
            p_group_id: groupId,
            p_id: id,
            p_expected_version: expectedVersion,
            p_target_kind: targetKind,
            p_target_id: targetId,
            p_target_label: targetLabel,
            p_fields: fields
          }),
          override
        ),
      deleteOverride: async (id, expectedVersion) =>
        writeResultFrom(await call("studyos_agent_delete_catalog_override", { p_id: id, p_expected_version: expectedVersion }), override)
    };
  };

  /**
   * Bacheca dei gruppi con le funzioni del segreto, al posto di lib/groupSync. Nessuna coda: se il server
   * non accetta la risorsa non resta da nessuna parte (execute lo dice all'agente) e l'attività non parte.
   */
  const remoteGroupSync = (secret: string, me: string, lost: () => void): GroupSyncApi => {
    let publishFailed = false;
    const call = async <T>(fn: string, body: Record<string, unknown>): Promise<T> => {
      try {
        return await rpc<T>(fn, { p_secret: secret, ...body });
      } catch (error) {
        if (error instanceof GrantError) lost();
        throw error;
      }
    };
    return {
      // Come getActor dell'app: il nome del profilo, mai l'email.
      getActor: async () => ({ userId: me, displayName: visibleMemberName(selectPreferences(useStudyStore.getState()).displayName) }),
      publishResource: async (resource: GroupResource) => {
        const out = await call<{ status?: unknown; updated_at?: unknown } | null>("studyos_agent_add_group_resource", {
          p_resource: {
            id: resource.id,
            group_id: resource.groupId,
            kind: resource.kind,
            title: resource.title,
            url: resource.url ?? null,
            body: resource.body ?? null,
            pinned: resource.pinned,
            added_by_display_name: resource.addedByDisplayName
          }
        }).catch(() => null);
        if (out?.status !== "ok") {
          publishFailed = true;
          return false;
        }
        const stamp = typeof out.updated_at === "string" ? out.updated_at : new Date(now()).toISOString();
        useStudyStore.setState((current) => ({
          groupResources: current.groupResources.map((item) => (item.id === resource.id ? { ...item, sharedAt: stamp, updatedAt: stamp } : item))
        }));
        return true;
      },
      logSharedActivity: async (groupId: string, actorDisplayName: string, text: string) => {
        if (publishFailed) return;
        const entry = await useStudyStore.getState().logGroupActivity(groupId, actorDisplayName, text);
        await call("studyos_agent_log_group_activity", {
          p_activity: { id: entry.id, group_id: groupId, actor_display_name: entry.actorDisplayName, text: entry.text }
        });
      },
      deleteSharedResource: async (resourceId: string) => (await call<unknown>("studyos_agent_delete_group_resource", { p_id: resourceId })) === true
    };
  };

  /** Gruppi dell'account, membri (senza email), bacheca e ultime attività nello store, come il pull dell'app. Ritorna l'id dell'account. */
  const loadGroups = async (secret: string) => {
    const raw = await rpc<Record<string, unknown> | null>("studyos_agent_groups", { p_secret: secret });
    const me = typeof raw?.me === "string" ? raw.me : "";
    const members = new Map<string, StudyGroup["members"]>();
    for (const row of listOf(raw?.members)) {
      if (!isRecord(row)) continue;
      const list = members.get(String(row.group_id)) ?? [];
      list.push(memberFromRow(row));
      members.set(String(row.group_id), list);
    }
    // Righe del server: già pubblicate (sharedAt), come dopo il pull dell'app.
    const studyGroups = listOf(raw?.groups).filter(isRecord).map((row) => {
      const group = groupFromRow(row);
      return { ...group, sharedAt: group.updatedAt, members: members.get(group.id) ?? [] };
    });
    const groupResources = listOf(raw?.resources).filter(isRecord).map((row) => {
      const resource = resourceFromRow(row);
      return { ...resource, sharedAt: resource.updatedAt };
    });
    const groupActivities = listOf(raw?.activities).filter(isRecord).map(activityFromRow);
    useStudyStore.setState({ studyGroups, groupResources, groupActivities });
    return me;
  };

  /** Condivisioni, inviti, materie condivise e dati di altre persone (dei tipi chiesti) nello store condiviso, solo in memoria. */
  const loadSharing = async (secret: string, types: string[] | null) => {
    const raw = await rpc<Record<string, unknown> | null>("studyos_agent_sharing", { p_secret: secret, p_limit: SHARED_ROWS_MAX, p_types: types });
    const me = typeof raw?.me === "string" ? raw.me : "";
    if (!me) return;
    const grants = listOf(raw?.shares)
      .filter(isRecord)
      .map((row) => grantFromRow(row))
      .filter((grant): grant is ShareGrant => grant !== null);
    const byOwner = new Map<string, RemoteSharedRow[]>();
    for (const row of listOf(raw?.items)) {
      if (!isRecord(row) || typeof row.owner_id !== "string" || !isRecord(row.payload)) continue;
      const list = byOwner.get(row.owner_id) ?? [];
      list.push({
        entity_type: String(row.entity_type),
        entity_id: String(row.entity_id),
        payload: row.payload,
        deleted: row.deleted === true,
        updated_at: String(row.updated_at ?? ""),
        id: String(row.id ?? "")
      });
      byOwner.set(row.owner_id, list);
    }
    let items: SharedItem[] = [];
    for (const [ownerId, rows] of byOwner) items = mergeSharedRows(items, ownerId, rows, new Set());
    useSharedStore.setState({
      viewerId: me,
      availability: "ready",
      persistent: false,
      given: grants.filter((grant) => grant.ownerId === me),
      received: grants.filter((grant) => grant.ownerId !== me),
      invites: listOf(raw?.invites).filter(isRecord).map((row) => inviteFromRow(row, now())),
      labels: listOf(raw?.labels)
        .filter(isRecord)
        .map((row) => ({
          ownerId: String(row.owner_id),
          id: String(row.subject_id),
          name: String(row.name ?? ""),
          // Colore scelto da un'altra persona: solo esadecimale, come nell'app.
          color: safeCssColor(row.color),
          icon: String(row.icon ?? "")
        })),
      items,
      outbox: [],
      hiddenOwners: []
    });
  };

  /**
   * Timer dell'account dal cloud nello store e, come fa l'app aperta, i blocchi finiti chiusi in sessioni.
   * Ritorna lo stato letto (prima di chiuderli), che se dopo lo strumento è un altro va salvato, e il suo
   * changedAt nel database (null = nessuna riga): la scrittura vale solo se è ancora quello.
   */
  const loadTimer = async (secret: string): Promise<TimerRead> => {
    const raw = await rpc<unknown>("studyos_agent_timer_get", { p_secret: secret });
    const timer = isRecord(raw) ? normalizeTimer(raw) : defaultTimer();
    useStudyStore.setState({ timer, timerReview: false });
    useStudyStore.getState().settleStudyTimer();
    const expected = isRecord(raw) ? (typeof raw.changedAt === "number" && Number.isFinite(raw.changedAt) ? Math.floor(raw.changedAt) : 0) : null;
    return { timer, expected };
  };

  /**
   * Scrittura del timer dell'hub: solo se nessuno l'ha cambiato dopo la lettura. Ritorna lo stato salvato
   * o null se nel frattempo è cambiato (o la risposta non è leggibile).
   */
  const putTimer = async (secret: string, state: TimerState, expected: number | null) => {
    const saved = await rpc<unknown>("studyos_agent_timer_put", { p_secret: secret, p_state: state, p_expected: expected });
    return isRecord(saved) && saved.changedAt === state.changedAt ? state : null;
  };

  /** Lettura facoltativa: un errore (rete, script non eseguito) lascia lo store vuoto, salvo il permesso revocato. */
  const optional = async <T>(required: boolean, task: () => Promise<T>, fallback: T): Promise<T> => {
    if (required) return task();
    try {
      return await task();
    } catch (error) {
      if (error instanceof GrantError) throw error;
      return fallback;
    }
  };

  const execute = async (grant: CloudGrant, name: string, args: Record<string, unknown>): Promise<AgentCallResult> => {
    const cache = cacheFor(grant.secret);
    const groups = groupsForTool(name, args);
    await refresh(grant.secret, cache, groups);
    const before = collectionsFrom(cache, new Set(groups));

    // Nessun dato di altre persone da una chiamata all'altra: lo store condiviso si riempie solo qui.
    resetShared();
    setPersistenceSuspended(true);
    useStudyStore.setState({ loading: false, locked: false, persistError: undefined, ...before, timer: defaultTimer(), timerReview: false });
    configureAgentRuntime({ timeZone: grant.timeZone, remote: true });
    const original = { exams: groupExamWriterLoader.load, groups: groupSyncLoader.load };
    let lost = false;
    const markLost = () => {
      lost = true;
    };
    let timer: TimerRead | null = null;
    let result: AgentCallResult;
    let after: CollectionsState & { timer: TimerState };
    try {
      // Appelli dei gruppi solo per gli strumenti che li leggono, solo per questa chiamata: il reset nel
      // finally vale anche se il caricamento si interrompe.
      if (GROUP_SNAPSHOT_TOOLS.has(name)) await loadGroupSnapshot(grant.secret);
      const me = GROUP_TABLE_TOOLS.has(name) ? await optional(GROUPS_REQUIRED.has(name), () => loadGroups(grant.secret), "") : "";
      const sharedTypes = sharedTypesFor(name, groups);
      if (sharedTypes !== undefined) await optional(SHARING_REQUIRED.has(name), () => loadSharing(grant.secret, sharedTypes), undefined);
      if (TIMER_TOOLS.has(name)) timer = await loadTimer(grant.secret);
      const writer = remoteGroupExamWriter(grant.secret, markLost);
      const board = remoteGroupSync(grant.secret, me, markLost);
      groupExamWriterLoader.load = async () => writer;
      groupSyncLoader.load = async () => board;
      result = await withZonedDate(grant.timeZone, () => executeAgentTool(name, args));
      after = useStudyStore.getState() as unknown as CollectionsState & { timer: TimerState };
    } finally {
      groupExamWriterLoader.load = original.exams;
      groupSyncLoader.load = original.groups;
      configureAgentRuntime({ remote: false });
      useGroupExamStore.getState().reset();
      resetShared();
      // Lo store torna vuoto anche se la lettura o lo strumento si sono interrotti: niente dati
      // dell'account restano in memoria fino alla prossima esecuzione.
      useStudyStore.setState({ ...emptyCollections(), timer: defaultTimer(), timerReview: false });
    }

    const rows = plannedRows(before, after, (type, id) => cache.rows.get(keyOf(type, id)));
    const timerAfter = after.timer;
    if (lost) throw new GrantError("revoked");
    if (name === "studyos_add_group_resource" && result.ok && result.data.shared === false) return fail("failed", CLOUD_TEXT.resourceNotSaved);
    // Leggere il timer non salva niente: i blocchi finiti li chiude l'app (stesse sessioni, stessi id).
    if (name === "studyos_timer_status") return result;
    let written: TimerState | null = null;
    if (timer && timerAfter !== timer.timer) {
      // Sempre dopo lo stato letto, anche se l'orologio di un dispositivo è avanti rispetto al server.
      const stamped = { ...timerAfter, changedAt: Math.max(timerAfter.changedAt ?? 0, (timer.timer.changedAt ?? 0) + 1, (timer.expected ?? 0) + 1) };
      // Un dispositivo l'ha cambiato dopo la lettura: niente sessioni salvate da qui.
      written = await putTimer(grant.secret, stamped, timer.expected);
      if (!written) return fail("failed", CLOUD_TEXT.timerConflict);
    }
    if (!rows.length) return result;

    // Il timer è già cambiato ma le sessioni non sono arrivate: si rimette com'era, così l'azione si può
    // ripetere (altrimenti un «finish» perso lascerebbe il timer azzerato senza la sessione).
    const restoreTimer = async () => {
      if (!timer || !written) return;
      const changedAt = (written.changedAt ?? 0) + 1;
      await putTimer(grant.secret, { ...timer.timer, changedAt }, Math.floor(written.changedAt ?? 0)).catch(() => null);
    };
    // Un id per richiesta: tutte le push di questa chiamata finiscono nella stessa voce del registro.
    let pushed: Awaited<ReturnType<typeof push>>;
    try {
      pushed = await push(grant.secret, cache, rows, name, newCallId());
    } catch (error) {
      await restoreTimer();
      throw error;
    }
    const { accepted, refused, refusedIds } = pushed;
    if (!refused) return result;
    if (!accepted) await restoreTimer();
    await refresh(grant.secret, cache, groups).catch(() => caches.delete(grant.secret));
    return perItemConflicts(result, refusedIds) ?? fail("failed", CLOUD_TEXT.conflict(refused, accepted > 0));
  };

  const pendingResult = (id: string, running = false): AgentCallResult => ({
    ok: true,
    data: { status: "pending_approval", approvalId: `${APPROVAL_PREFIX}${id}`, message: running ? CLOUD_TEXT.running : CLOUD_TEXT.pending }
  });

  /**
   * Esito di una richiesta da confermare: null = non c'è, "pending" = la persona non ha ancora deciso,
   * "running" = confermata, l'app la sta eseguendo.
   */
  const requestOutcome = (raw: unknown): AgentCallResult | null | "pending" | "running" => {
    if (!isRecord(raw)) return null;
    if (raw.status === "pending" || raw.status === "running") return raw.status;
    if (raw.status === "expired") return { ok: false, code: "denied", error: CLOUD_TEXT.approvalExpired };
    if (isCallResult(raw.result)) return raw.result;
    if (raw.status === "denied") return { ok: false, code: "denied", error: CLOUD_TEXT.approvalDenied };
    return { ok: false, code: "failed", error: CLOUD_TEXT.offline };
  };

  /** Come il connettore principale: aspetta un poco la decisione, poi risponde pending_approval. */
  const waitRequest = async (secret: string, id: string) => {
    for (let attempt = 0; ; attempt += 1) {
      const outcome = requestOutcome(await rpc<unknown>("studyos_agent_request_status", { p_secret: secret, p_id: id }));
      if ((outcome !== "pending" && outcome !== "running") || attempt >= APPROVAL_POLLS) return outcome;
      await sleep(APPROVAL_POLL_MS);
    }
  };

  /**
   * Condividere o scrivere dati di altre persone: l'hub non ha la sessione della persona e non lo fa da sé.
   * Nasce una richiesta (notifica push), la persona la conferma nell'app, che esegue lo strumento.
   */
  const deferred = async (grant: CloudGrant, name: string, args: Record<string, unknown>): Promise<AgentCallResult> => {
    let id: unknown;
    try {
      id = await rpc<unknown>("studyos_agent_request_create", {
        p_secret: grant.secret,
        p_tool: name,
        p_args: args,
        p_summary: toolSummary(name, args),
        p_risk: findAgentTool(name)?.risk === "destructive" ? "destructive" : "write"
      });
    } catch (error) {
      // Troppe richieste aperte: il testo del database dice cosa fare.
      if (error instanceof RpcError && error.code === "54000") return fail("failed", error.message);
      throw error;
    }
    if (typeof id !== "string" || !UUID_RE.test(id)) throw new Error("Risposta del cloud non valida.");
    // La richiesta c'è già: un errore durante l'attesa non deve farla ripetere all'agente.
    const outcome = await waitRequest(grant.secret, id).catch(() => "pending" as const);
    if (outcome === null || outcome === "pending" || outcome === "running") return pendingResult(id, outcome === "running");
    return outcome;
  };

  const approvalStatus = async (grant: CloudGrant, args: Record<string, unknown>): Promise<AgentCallResult> => {
    const raw = String(args.approvalId ?? "").trim().toLowerCase();
    const id = raw.startsWith(APPROVAL_PREFIX) ? raw.slice(APPROVAL_PREFIX.length) : raw;
    if (!UUID_RE.test(id)) return fail("not_found", CLOUD_TEXT.approvalNotFound);
    const outcome = await waitRequest(grant.secret, id);
    if (outcome === null) return fail("not_found", CLOUD_TEXT.approvalNotFound);
    if (outcome === "pending" || outcome === "running") return pendingResult(id, outcome === "running");
    return outcome;
  };

  /** Errori comuni a ogni chiamata: permesso revocato, script non eseguito, rete. */
  const guarded = async (grant: CloudGrant, task: () => Promise<AgentCallResult>): Promise<AgentCallResult> => {
    try {
      return await task();
    } catch (error) {
      if (error instanceof GrantError) {
        caches.delete(grant.secret);
        return fail("denied", CLOUD_TEXT.revoked);
      }
      if (error instanceof MissingFunctionError) return fail("not_connected", CLOUD_TEXT.parityMissing);
      // Una cache a metà non deve sopravvivere a un errore: la prossima chiamata rilegge tutto.
      caches.delete(grant.secret);
      return fail("failed", CLOUD_TEXT.offline);
    }
  };

  /** studyos_list_audit sul connettore remoto: il registro del server per chiamate, non quello di un browser. */
  const listAudit = async (grant: CloudGrant, args: Record<string, unknown>): Promise<AgentCallResult> => {
    const offset = typeof args.offset === "number" ? args.offset : 0;
    const limit = Math.min(typeof args.limit === "number" ? args.limit : 20, AUDIT_PAGE_MAX);
    const callId = typeof args.callId === "string" ? args.callId.trim().toLowerCase() : "";
    if (callId && !AUDIT_UUID_RE.test(callId)) return fail("invalid", CLOUD_TEXT.badAuditId);
    // Date senza offset: ora locale della persona, come negli altri strumenti.
    const [since, until] = await withZonedDate(grant.timeZone, async () => [args.since, args.until].map((value) => (typeof value === "string" && value.trim() ? toIso(value) : undefined)));
    if (since === null || until === null) return fail("invalid", CLOUD_TEXT.badDate);
    let rows: ServerAuditRow[];
    try {
      rows = await rpc<ServerAuditRow[]>("studyos_agent_audit_list", {
        p_secret: grant.secret,
        p_limit: limit,
        p_offset: offset,
        p_entity_id: typeof args.itemId === "string" && args.itemId ? args.itemId : null,
        p_tool: typeof args.tool === "string" && args.tool ? args.tool : null,
        p_since: since ?? null,
        p_until: until ?? null,
        ...(callId ? { p_call_id: callId } : {})
      });
    } catch (error) {
      if (error instanceof MissingFunctionError) return fail("failed", CLOUD_TEXT.auditMissing);
      throw error;
    }
    if (!Array.isArray(rows)) throw new Error("Risposta del cloud non valida.");
    return { ok: true, data: { source: "server", ...auditPage(rows, offset, limit) } };
  };

  /**
   * studyos_restore_change: il database rimette la versione di prima, solo se nessuno l'ha cambiata dopo.
   * Di solito l'intera chiamata (tutte le sue modifiche, tutto o niente); con onlyThisChange una voce.
   */
  const restoreChange = async (grant: CloudGrant, args: Record<string, unknown>): Promise<AgentCallResult> => {
    const id = typeof args.id === "string" ? args.id.trim().toLowerCase() : "";
    if (!AUDIT_UUID_RE.test(id)) return fail("invalid", CLOUD_TEXT.badAuditId);
    const single = () => rpc<RestoreOutcome>("studyos_agent_restore", { p_secret: grant.secret, p_audit_id: id });
    let outcome: RestoreOutcome;
    try {
      if (args.onlyThisChange === true) {
        outcome = await single();
      } else {
        try {
          outcome = await rpc<RestoreOutcome>("studyos_agent_restore_call", { p_secret: grant.secret, p_id: id });
        } catch (error) {
          // agent.sql della prima revisione: nessun id di chiamata, ogni voce è una chiamata da sola.
          if (!(error instanceof MissingFunctionError)) throw error;
          outcome = await single();
        }
      }
    } catch (error) {
      if (error instanceof MissingFunctionError) return fail("failed", CLOUD_TEXT.auditMissing);
      throw error;
    }
    const where = (type: string, itemId: string) => ({ collection: COLLECTION_BY_ENTITY_TYPE[type] ?? type, itemId });
    switch (outcome?.status) {
      case "restored": {
        const changes = restoredChanges(outcome).map((change) => ({
          auditId: change.auditId,
          ...where(change.entityType, change.entityId),
          action: change.action,
          item: auditImage(change.entityType, change.item) ?? null
        }));
        const [first] = changes;
        return {
          ok: true,
          data: { status: "restored", ...(outcome.callId ? { callId: outcome.callId } : {}), ...(first ?? {}), count: changes.length, changes },
          summary: changes.length === 1 ? CLOUD_TEXT.restored(changes[0].action) : CLOUD_TEXT.restoredCall(changes.length)
        };
      }
      case "conflict": {
        const conflicts = restoreConflicts(outcome).map((conflict) => {
          const current = auditImage(conflict.entityType, conflict.current) ?? null;
          const title = auditTitle(current);
          return { ...where(conflict.entityType, conflict.entityId), ...(title ? { title } : {}), current, currentDeleted: conflict.currentDeleted === true };
        });
        const [first] = conflicts;
        const what = `${first.title ? `«${first.title}» ` : "l'elemento "}(${first.collection} ${first.itemId})`;
        const items = Math.max(Number(outcome.items) || 1, conflicts.length);
        return {
          ok: false,
          code: "failed",
          error: CLOUD_TEXT.restoreConflict(what, items),
          data: { status: "conflict", ...first, items, conflicts }
        };
      }
      case "already_restored":
        return { ok: false, code: "invalid", error: CLOUD_TEXT.restoreDone, data: { status: "already_restored", ...where(outcome.entityType, outcome.entityId), restoredAt: outcome.restoredAt } };
      case "not_found":
        return { ok: false, code: "not_found", error: CLOUD_TEXT.restoreNotFound };
      default:
        throw new Error("Risposta del cloud non valida.");
    }
  };

  return {
    run: (grant, name, args) => {
      if (CLOUD_UNAVAILABLE.has(name)) return Promise.resolve(fail("invalid", CLOUD_TEXT.unavailable));
      // Calcolo puro: nessun dato da leggere, nessuna attesa sugli altri account.
      if (name === "studyos_split_pages") return Promise.resolve(splitPagesResult(args));
      // Richieste da confermare nell'app: fuori dalla coda, l'attesa della persona non ferma gli altri account.
      if (CLOUD_DEFERRED.has(name)) return guarded(grant, () => deferred(grant, name, args));
      if (name === "studyos_approval_status") return guarded(grant, () => approvalStatus(grant, args));
      return exclusive(() =>
        guarded(grant, () => {
          if (name === "studyos_list_audit") return listAudit(grant, args);
          if (name === "studyos_restore_change") return restoreChange(grant, args);
          return execute(grant, name, args);
        })
      );
    },
    forget: (secret) => {
      caches.delete(secret);
    },
    verify: async (grant) => {
      try {
        await rpc("studyos_agent_pull", { p_secret: grant.secret, p_since: new Date(now()).toISOString(), p_offset: 0, p_limit: 1 });
        return "ok";
      } catch (error) {
        return error instanceof GrantError ? "revoked" : "offline";
      }
    }
  };
};
