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

import { CLOUD_UNAVAILABLE } from "./catalog";
import { configureAgentRuntime, executeAgentTool, splitPagesResult } from "./execute";
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
import { useSharedStore } from "../store/useSharedStore";
import { useStudyStore } from "../store/useStudyStore";
import { overrideFromRow, sessionFromRow, type CatalogOverride, type GroupExamSession } from "../lib/groupExams";
import { useGroupExamStore } from "../store/useGroupExamStore";

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
}

export interface CloudRunner {
  run: (grant: CloudGrant, name: string, args: Record<string, unknown>) => Promise<AgentCallResult>;
  /** Dimentica la cache di un permesso (revoca, nuovo consenso). */
  forget: (secret: string) => void;
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
  cursor: string | null;
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
    `${partial ? "Modifica salvata solo in parte" : "Modifica non salvata"}: ${count === 1 ? "un elemento è stato cambiato" : `${count} elementi sono stati cambiati`} nel frattempo da un altro dispositivo. Rileggi i dati e riprova.`,
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
  restoredCall: (count: number) => `Azione annullata: ${count} elementi sono tornati com'erano prima.`
} as const;

class GrantError extends Error {}

/** Funzione RPC assente (agent.sql di prima): PostgREST risponde PGRST202. */
class MissingFunctionError extends Error {}

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
  "studyos_list_barb_contacts"
]);

/** Le righe dello snapshot non hanno id degli account: `mine` dice se l'ha aggiunta la persona ("remote"). */
const withRemoteAuthor = (row: unknown) =>
  row && typeof row === "object" ? { ...(row as Record<string, unknown>), created_by: (row as { mine?: unknown }).mine === true ? "remote" : "" } : row;

const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

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

const collectionsFrom = (cache: AccountCache): CollectionsState => {
  const collections = emptyCollections() as unknown as Record<CollectionKey, SyncableEntity[]>;
  for (const row of cache.rows.values()) {
    if (row.deleted) continue;
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

let sharedReset = false;
/** Lo store è uno solo: un'esecuzione alla volta, per qualsiasi account. */
let chain: Promise<unknown> = Promise.resolve();
const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
  const run = chain.then(task);
  chain = run.catch(() => undefined);
  return run;
};

export const createCloudRunner = (backend: CloudBackend): CloudRunner => {
  const base = backend.url.replace(/\/+$/, "");
  const doFetch = backend.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const now = backend.now ?? (() => Date.now());
  const newCallId = backend.newCallId ?? (() => crypto.randomUUID());
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
      throw new Error(error.message ?? `HTTP ${response.status}`);
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
    cache = { rows: new Map(), cursor: null };
    caches.set(secret, cache);
    while (caches.size > MAX_CACHED_ACCOUNTS) caches.delete(caches.keys().next().value as string);
    return cache;
  };

  /** Righe nuove dopo l'ultimo cursore, con un minuto di sovrapposizione come la sync dell'app. */
  const refresh = async (secret: string, cache: AccountCache) => {
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
    const sized = rows.map((row) => ({ row, size: encoder.encode(JSON.stringify(row)).length }));
    let accepted = 0;
    let refused = 0;
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
        }
      }
    }
    return { accepted, refused };
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

  const execute = async (grant: CloudGrant, name: string, args: Record<string, unknown>): Promise<AgentCallResult> => {
    const cache = cacheFor(grant.secret);
    await refresh(grant.secret, cache);
    const before = collectionsFrom(cache);

    if (!sharedReset) {
      // Nessun dato di altre persone sul connettore remoto.
      useSharedStore.setState({ viewerId: null, items: [], given: [], received: [], invites: [], labels: [], outbox: [], persistent: false });
      sharedReset = true;
    }
    setPersistenceSuspended(true);
    useStudyStore.setState({ loading: false, locked: false, persistError: undefined, ...before });
    configureAgentRuntime({ timeZone: grant.timeZone, remote: true });
    let result: AgentCallResult;
    try {
      // Appelli dei gruppi solo per gli strumenti che li leggono, solo per questa chiamata: il reset nel
      // finally vale anche se il caricamento si interrompe.
      if (GROUP_SNAPSHOT_TOOLS.has(name)) await loadGroupSnapshot(grant.secret);
      result = await withZonedDate(grant.timeZone, () => executeAgentTool(name, args));
    } finally {
      configureAgentRuntime({ remote: false });
      useGroupExamStore.getState().reset();
    }

    const after = useStudyStore.getState() as unknown as CollectionsState;
    const rows = plannedRows(before, after, (type, id) => cache.rows.get(keyOf(type, id)));
    // Lo store torna vuoto: niente dati dell'account restano visibili alla prossima esecuzione.
    useStudyStore.setState({ ...emptyCollections() });
    if (!rows.length) return result;

    // Un id per richiesta: tutte le push di questa chiamata finiscono nella stessa voce del registro.
    const { accepted, refused } = await push(grant.secret, cache, rows, name, newCallId());
    if (!refused) return result;
    await refresh(grant.secret, cache).catch(() => caches.delete(grant.secret));
    return fail("failed", CLOUD_TEXT.conflict(refused, accepted > 0));
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
      return exclusive(async () => {
        try {
          if (name === "studyos_list_audit") return await listAudit(grant, args);
          if (name === "studyos_restore_change") return await restoreChange(grant, args);
          return await execute(grant, name, args);
        } catch (error) {
          if (error instanceof GrantError) {
            caches.delete(grant.secret);
            return fail("denied", CLOUD_TEXT.revoked);
          }
          // Una cache a metà non deve sopravvivere a un errore: la prossima chiamata rilegge tutto.
          caches.delete(grant.secret);
          return fail("failed", CLOUD_TEXT.offline);
        }
      });
    },
    forget: (secret) => {
      caches.delete(secret);
    }
  };
};
