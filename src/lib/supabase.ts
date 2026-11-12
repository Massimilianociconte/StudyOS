import {
  createClient,
  isAuthApiError,
  type RealtimeChannel,
  type Session,
  type SupabaseClient
} from "@supabase/supabase-js";
import type { StudySnapshot } from "../types";
import type { RemoteRow } from "./syncMerge";
import { readPendingInvite } from "./groupInvite";
import { readPendingShare } from "./shareInvite";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

const AUTH_STORAGE_KEY = "studyos-auth";

// Senza timeout una rete che non risponde (captive portal, segnale debole) lascerebbe la
// sync "in corso" per minuti: nessun retry parte finché la richiesta non termina.
const REQUEST_TIMEOUT_MS = 30_000;

const fetchWithTimeout: typeof fetch = (input, init = {}) => {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") return fetch(input, init);
  const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  const signal =
    init.signal && typeof (AbortSignal as unknown as { any?: unknown }).any === "function"
      ? AbortSignal.any([init.signal, timeout])
      : init.signal ?? timeout;
  return fetch(input, { ...init, signal });
};

export const supabase: SupabaseClient | null =
  url && key
    ? createClient(url, key, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          storageKey: AUTH_STORAGE_KEY
        },
        global: { fetch: fetchWithTimeout }
      })
    : null;

export const isCloudConfigured = () => supabase !== null;

const TABLE = "studyos_items";
const LEGACY_SNAPSHOT_TYPE = "snapshot";
const LEGACY_SNAPSHOT_ID = "main";

const requireClient = () => {
  if (!supabase) throw new Error("Supabase non configurato.");
  return supabase;
};

const getEmailRedirectTo = () => {
  if (typeof window === "undefined") return undefined;
  // Con un invito in sospeso il link di conferma lo riporta (?invito=… / ?condividi=…): aprendolo
  // anche da un altro dispositivo si arriva alla scheda dell'invito già con l'account confermato.
  const params = new URLSearchParams();
  const pending = readPendingInvite();
  const share = readPendingShare();
  if (pending) params.set("invito", pending.code);
  if (share) params.set("condividi", share.token);
  const query = params.toString();
  return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}`;
};

export const signUp = async (email: string, password: string) => {
  const client = requireClient();
  const emailRedirectTo = getEmailRedirectTo();
  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: emailRedirectTo ? { emailRedirectTo } : undefined
  });
  if (error) throw error;
  return data;
};

export const resendConfirmation = async (email: string) => {
  const client = requireClient();
  const emailRedirectTo = getEmailRedirectTo();
  const { error } = await client.auth.resend({
    type: "signup",
    email,
    options: emailRedirectTo ? { emailRedirectTo } : undefined
  });
  if (error) throw error;
};

export const signIn = async (email: string, password: string) => {
  const client = requireClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
};

/**
 * Ritorna `{ localOnly: true }` quando il server non era raggiungibile: supabase-js in quel caso
 * NON rimuove la sessione (nemmeno con scope "local", che contatta comunque il server), quindi
 * la si elimina dallo storage del dispositivo e il chiamante ricarica l'app.
 * `scope: "local"` esce solo da questo dispositivo; il predefinito "global" da tutti.
 */
export const signOut = async (scope: "global" | "local" = "global"): Promise<{ localOnly: boolean }> => {
  if (!supabase) return { localOnly: false };
  const { error } = await supabase.auth.signOut({ scope });
  if (!error) return { localOnly: false };
  if (isAuthApiError(error)) throw error;
  for (const suffix of ["", "-code-verifier", "-user"]) {
    try {
      localStorage.removeItem(`${AUTH_STORAGE_KEY}${suffix}`);
    } catch {
      // storage non disponibile
    }
  }
  return { localOnly: true };
};

export const getSession = async (): Promise<Session | null> => {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
};

export const onAuthChange = (cb: (session: Session | null) => void) => {
  if (!supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => cb(session));
  return () => data.subscription.unsubscribe();
};

// ——— Sync per-entità (una riga per entità in studyos_items) ———

export interface PushRow {
  entity_type: string;
  entity_id: string;
  payload: unknown;
  deleted: boolean;
}

export interface PushResult {
  entity_type: string;
  entity_id: string;
  accepted: boolean;
}

/** Scrittura atomica condizionale: una versione locale vecchia non sovrascrive una remota recente. */
export const pushEntityRows = async (userId: string, clientId: string, rows: PushRow[]): Promise<PushResult[]> => {
  const client = requireClient();
  if (!rows.length) return [];
  const { data, error } = await client.rpc("push_studyos_rows", {
    p_user_id: userId,
    p_client_id: clientId,
    p_rows: rows
  });
  if (error) throw Object.assign(new Error(error.message), { code: error.code, details: error.details });
  if (!Array.isArray(data) || data.length !== rows.length || data.some((row, index) =>
    typeof row.accepted !== "boolean" || row.entity_type !== rows[index].entity_type || row.entity_id !== rows[index].entity_id
  )) {
    throw new Error("Risposta di sincronizzazione cloud incompleta: modifiche conservate in coda.");
  }
  return data as PushResult[];
};

/**
 * Ogni dato personale dell'account diventa un'eliminazione timbrata dal server (erase_studyos_account_items,
 * schema.sql). "missing": il progetto non ha ancora la funzione (PGRST202). Un altro errore si lancia.
 */
export const eraseAccountItems = async (): Promise<"ok" | "missing"> => {
  const client = requireClient();
  const { error } = await client.rpc("erase_studyos_account_items");
  if (!error) return "ok";
  if (error.code === "PGRST202") return "missing";
  throw Object.assign(new Error(error.message), { code: error.code });
};

/** Legge una versione precisa, inclusi gli aggiornamenti già scritti dalla scheda corrente. */
export const pullEntityRow = async (userId: string, entityType: string, entityId: string): Promise<RemoteRow | null> => {
  const client = requireClient();
  const { data, error } = await client.from(TABLE)
    .select("entity_type, entity_id, payload, deleted, updated_at, client_id")
    .eq("user_id", userId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as RemoteRow | null) ?? null;
};

/**
 * Righe modificate dopo `since` (updated_at lato server), in ordine crescente.
 * Le righe scritte da questo client (stessa sessione di pagina) sono escluse: sono già locali.
 */
/** Ultima riga di una pagina: la pagina dopo parte da qui (paginazione per chiave). */
export interface PullAfter {
  updated_at: string;
  id: string;
}

const quoted = (value: string) => `"${value.replace(/["\\]/g, "")}"`;

/**
 * Una pagina del pull personale in ordine (updated_at, id). Si prosegue dall'ultima riga ricevuta e
 * non per posizione: con l'offset, una riga aggiornata da un altro dispositivo tra una pagina e
 * l'altra si spostava in fondo e faceva saltare la riga successiva, per sempre (il cursore la
 * superava). Così una riga aggiornata torna solo più avanti.
 */
export const pullEntityRows = async (
  userId: string,
  since: string | null,
  after: PullAfter | null,
  limit: number,
  excludeClientId?: string
): Promise<Array<RemoteRow & { id: string }>> => {
  const client = requireClient();
  let query = client
    .from(TABLE)
    .select("id, entity_type, entity_id, payload, deleted, updated_at, client_id")
    .eq("user_id", userId)
    .neq("entity_type", LEGACY_SNAPSHOT_TYPE)
    .order("updated_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit);
  const conditions: string[] = [];
  if (after) {
    const at = quoted(after.updated_at);
    conditions.push(`or(updated_at.gt.${at},and(updated_at.eq.${at},id.gt.${quoted(after.id)}))`);
  } else if (since) {
    query = query.gte("updated_at", since);
  }
  if (excludeClientId) conditions.push(`or(client_id.is.null,client_id.neq.${quoted(excludeClientId)})`);
  if (conditions.length) query = query.or(`and(${conditions.join(",")})`);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []) as Array<RemoteRow & { id: string }>;
};

export interface LegacySnapshotRow {
  payload: StudySnapshot;
  updated_at: string;
}

/** Snapshot unico del vecchio motore di sync (letto solo per la migrazione). */
export const pullLegacySnapshot = async (userId: string): Promise<LegacySnapshotRow | null> => {
  const client = requireClient();
  const { data, error } = await client
    .from(TABLE)
    .select("payload, updated_at")
    .eq("user_id", userId)
    .eq("entity_type", LEGACY_SNAPSHOT_TYPE)
    .eq("entity_id", LEGACY_SNAPSHOT_ID)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as LegacySnapshotRow | null) ?? null;
};

export const subscribeRemoteChanges = (
  userId: string,
  onChange: (clientId: string | null) => void,
  onStatus?: (status: string) => void
): RealtimeChannel | null => {
  if (!supabase) return null;
  return supabase
    .channel(`studyos-items:${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: TABLE, filter: `user_id=eq.${userId}` },
      (payload) => {
        const row = (payload.new ?? payload.old) as Record<string, unknown> | null;
        if (!row || row.entity_type === LEGACY_SNAPSHOT_TYPE) return;
        onChange((row.client_id as string | null) ?? null);
      }
    )
    .subscribe((status) => onStatus?.(status));
};

/** Attendere la rimozione: supabase-js riusa un canale con lo stesso topic finché esiste. */
export const unsubscribeChannel = async (channel: RealtimeChannel | null) => {
  if (!supabase || !channel) return;
  await supabase.removeChannel(channel).catch(() => undefined);
};
