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
// Dalla 1.8.0 la push porta anche il nome dello strumento: il database scrive il registro
// (studyos_agent_audit), che studyos_list_audit legge e studyos_restore_change annulla.

import { CLOUD_UNAVAILABLE } from "./catalog";
import { configureAgentRuntime, executeAgentTool } from "./execute";
import { AUDIT_UUID_RE, auditImage, auditPage, type RestoreOutcome, type ServerAuditRow } from "./remoteAudit";
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
/** client_id delle righe scritte dal connettore: diverso da ogni scheda, così l'app le ritira. */
export const CLOUD_CLIENT_ID = "agent-remote";

export const CLOUD_TEXT = {
  revoked: "Questo connettore non può più usare l'account: l'accesso è stato revocato in StudyOS. In ChatGPT scollega e ricollega il connettore, poi premi «Consenti» nell'app.",
  offline: "Il cloud di StudyOS non risponde. Riprova tra poco.",
  unavailable: "Strumento non disponibile sul connettore remoto: usa il connettore principale con StudyOS aperto.",
  conflict: (count: number, partial: boolean) =>
    `${partial ? "Modifica salvata solo in parte" : "Modifica non salvata"}: ${count === 1 ? "un elemento è stato cambiato" : `${count} elementi sono stati cambiati`} nel frattempo da un altro dispositivo. Rileggi i dati e riprova.`,
  auditMissing: "Il registro del connettore non è ancora attivo: chi gestisce StudyOS deve eseguire di nuovo supabase/agent.sql.",
  badAuditId: "id deve essere l'id (un uuid) di una voce restituita da studyos_list_audit.",
  badDate: "since e until devono essere date ISO 8601.",
  restoreNotFound: "Questa modifica non c'è nel registro: rileggi gli id con studyos_list_audit (le voci durano 90 giorni).",
  restoreDone: "Questa modifica è già stata annullata.",
  restoreConflict: "Non annullata: l'elemento è cambiato dopo questa modifica (nell'app o con un'altra modifica). Non è stato toccato niente: in current c'è com'è ora.",
  restored: (action: string) =>
    action === "delete" ? "Modifica annullata: l'elemento creato è stato eliminato."
      : action === "create" ? "Modifica annullata: l'elemento è di nuovo tra i dati."
        : "Modifica annullata: l'elemento è tornato com'era prima."
} as const;

class GrantError extends Error {}

/** Funzione RPC assente (agent.sql di prima): PostgREST risponde PGRST202. */
class MissingFunctionError extends Error {}

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

  // agent.sql di prima della 1.8.0: studyos_agent_push senza p_tool (e senza registro). Si scopre alla
  // prima push rifiutata con PGRST202 e da lì si manda come prima.
  let pushTakesTool = true;

  const pushBatch = async (secret: string, rows: PushRow[], tool: string) => {
    const body = { p_secret: secret, p_client_id: CLOUD_CLIENT_ID, p_rows: rows };
    if (pushTakesTool) {
      try {
        return await rpc<Array<{ entity_type: string; entity_id: string; accepted: boolean }>>("studyos_agent_push", { ...body, p_tool: tool });
      } catch (error) {
        if (!(error instanceof MissingFunctionError)) throw error;
        pushTakesTool = false;
      }
    }
    return rpc<Array<{ entity_type: string; entity_id: string; accepted: boolean }>>("studyos_agent_push", body);
  };

  const push = async (secret: string, cache: AccountCache, rows: PushRow[], tool: string) => {
    const encoder = new TextEncoder();
    const sized = rows.map((row) => ({ row, size: encoder.encode(JSON.stringify(row)).length }));
    let accepted = 0;
    let refused = 0;
    for (const batch of chunkBySize(sized, (item) => item.size, PUSH_MAX_BYTES, PUSH_MAX_ROWS)) {
      const results = await pushBatch(secret, batch.map((item) => item.row), tool);
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
      result = await withZonedDate(grant.timeZone, () => executeAgentTool(name, args));
    } finally {
      configureAgentRuntime({ remote: false });
    }

    const after = useStudyStore.getState() as unknown as CollectionsState;
    const rows = plannedRows(before, after, (type, id) => cache.rows.get(keyOf(type, id)));
    // Lo store torna vuoto: niente dati dell'account restano visibili alla prossima esecuzione.
    useStudyStore.setState({ ...emptyCollections() });
    if (!rows.length) return result;

    const { accepted, refused } = await push(grant.secret, cache, rows, name);
    if (!refused) return result;
    await refresh(grant.secret, cache).catch(() => caches.delete(grant.secret));
    return fail("failed", CLOUD_TEXT.conflict(refused, accepted > 0));
  };

  /** studyos_list_audit sul connettore remoto: il registro del server, non quello di un browser. */
  const listAudit = async (grant: CloudGrant, args: Record<string, unknown>): Promise<AgentCallResult> => {
    const offset = typeof args.offset === "number" ? args.offset : 0;
    const limit = typeof args.limit === "number" ? args.limit : 20;
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
        p_until: until ?? null
      });
    } catch (error) {
      if (error instanceof MissingFunctionError) return fail("failed", CLOUD_TEXT.auditMissing);
      throw error;
    }
    if (!Array.isArray(rows)) throw new Error("Risposta del cloud non valida.");
    return { ok: true, data: { source: "server", ...auditPage(rows, offset, limit) } };
  };

  /** studyos_restore_change: il database rimette la versione di prima, solo se nessuno l'ha cambiata dopo. */
  const restoreChange = async (grant: CloudGrant, args: Record<string, unknown>): Promise<AgentCallResult> => {
    const id = typeof args.id === "string" ? args.id.trim().toLowerCase() : "";
    if (!AUDIT_UUID_RE.test(id)) return fail("invalid", CLOUD_TEXT.badAuditId);
    let outcome: RestoreOutcome;
    try {
      outcome = await rpc<RestoreOutcome>("studyos_agent_restore", { p_secret: grant.secret, p_audit_id: id });
    } catch (error) {
      if (error instanceof MissingFunctionError) return fail("failed", CLOUD_TEXT.auditMissing);
      throw error;
    }
    const where = (type: string, itemId: string) => ({ collection: COLLECTION_BY_ENTITY_TYPE[type] ?? type, itemId });
    switch (outcome?.status) {
      case "restored":
        return {
          ok: true,
          data: { status: "restored", auditId: outcome.auditId, ...where(outcome.entityType, outcome.entityId), action: outcome.action, item: auditImage(outcome.entityType, outcome.item) ?? null },
          summary: CLOUD_TEXT.restored(outcome.action)
        };
      case "conflict":
        return {
          ok: false,
          code: "failed",
          error: CLOUD_TEXT.restoreConflict,
          data: { status: "conflict", ...where(outcome.entityType, outcome.entityId), current: auditImage(outcome.entityType, outcome.current) ?? null, currentDeleted: outcome.currentDeleted === true }
        };
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
