// Ponte verso supabase/sharing.sql: condivisioni, inviti e dati di altre persone.
// Caricato con import(): supabase-js resta fuori dal bundle iniziale. Senza account o senza
// migrazione la condivisione è spenta e il resto dell'app non se ne accorge.
//
// Ciclo: invia la coda (push_shared_rows) → scarica condivisioni, inviti, etichette → per ogni
// proprietario scarica le righe dei tipi coperti (cursore) e riconcilia con gli id visibili →
// notifiche → Realtime (solo segnale). Riserva: ogni 5 minuti e al ritorno sulla scheda.
//
// Ogni cambio di chi guarda (accesso, logout, altro account, blocco/sblocco del vault, cambio di
// modalità, reset locale) fa salire la generazione: una passata, un invio o una rilettura partiti
// prima si fermano senza toccare lo store, e la passata nuova parte solo a store ricaricato.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getCloudSyncState, subscribeCloudSync } from "./cloudSyncState";
import { db, getMeta, setMeta } from "./db";
import { SHARE_SCOPE_LABEL, scopesSummary } from "./labels";
import {
  SHARING_UNAVAILABLE_TEXT,
  grantFromRow,
  grantSignature,
  inviteFromRow,
  missingVisibleKeys,
  offerToRow,
  ownerEntityTypes,
  planShareWrites,
  revisionFromRow,
  shareErrorText,
  shareNotices,
  sharedKey,
  sharedPushBatches,
  sharingProbeOutcome,
  type ItemRevision,
  type RemoteSharedRow,
  type ShareGrant,
  type ShareInviteStatus,
  type ShareInviteSummary,
  type ShareOffer,
  type SharePermission,
  type ShareRequest,
  type ShareScope
} from "./sharing";
import { supabase } from "./supabase";
import { useSharedStore } from "../store/useSharedStore";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";

const PAGE_SIZE = 200;
const ID_PAGE_SIZE = 1000;
const CURSOR_OVERLAP_MS = 60_000;
const DEBOUNCE_MS = 400;
const PERIODIC_MS = 5 * 60_000;
const UNAVAILABLE_RETRY_MS = 10 * 60_000;
/** Limite dei valori nel filtro `in` di Realtime: oltre, vale il controllo periodico. */
const REALTIME_OWNERS_MAX = 100;

const AVAILABLE_META = "share:available:v1";
const seenMeta = (viewer: string) => `share:seen:${viewer}`;
const cursorMeta = (viewer: string, owner: string) => `share:cursor:${viewer}:${owner}`;

const SHARE_COLUMNS =
  "id, owner_id, owner_name, scope, subject_ids, permission, grantee_user_id, grantee_group_id, grantee_name, grantee_email, created_at, updated_at";
// token_hash non è leggibile (grant per colonna): mai chiederlo.
const INVITE_COLUMNS = "id, owner_id, owner_name, offers, requests, recipient_email, status, accepted_by, expires_at, created_at";
const ROW_COLUMNS = "entity_type, entity_id, payload, deleted, updated_at";

// Un id per caricamento di pagina: gli eventi Realtime delle proprie scritture si ignorano.
const clientId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `share-${Date.now()}`;

interface OwnerCursor {
  sig: string;
  at: string | null;
}

export interface ShareInvitePreview {
  inviteId: string;
  ownerName: string;
  offers: ShareOffer[];
  requests: ShareRequest[];
  expiresAt: string;
  status: ShareInviteStatus;
  forOtherAccount: boolean;
  isOwn: boolean;
}

export interface ShareTarget {
  userId?: string;
  groupId?: string;
  name: string;
}

type DbError = { message: string; code?: string } | null;

const fail = (error: DbError) => {
  if (error) throw new Error(shareErrorText(error));
};

const client = () => {
  if (!supabase) throw new Error("Gli account non sono attivi in questa versione dell'app.");
  return supabase;
};

const viewer = () => getCloudSyncState().session?.user.id ?? null;

const myName = () => {
  const name = selectPreferences(useStudyStore.getState()).displayName.trim();
  return (name || getCloudSyncState().session?.user.email?.split("@")[0] || "").slice(0, 120);
};

// ——— Generazione di chi guarda ———

/** Sale a ogni cambio di chi guarda (requestSwitch, blocco del vault). */
let generation = 0;
/** Generazione per cui lo store è caricato (hydrate concluso): solo allora parte una passata. */
let hydrated = -1;

class ViewerChanged extends Error {
  constructor() {
    super("Account cambiato durante l'aggiornamento.");
    this.name = "ViewerChanged";
  }
}

/** Da chiamare dopo ogni attesa e prima di toccare lo store: un risultato di un'altra generazione si scarta. */
const still = (gen: number) => {
  if (gen !== generation) throw new ViewerChanged();
};

// ——— Disponibilità (migrazione eseguita?) ———

let available: boolean | null = null;
let checkedAt = 0;

/**
 * Esito della sonda: "missing" solo se la migrazione manca davvero; rete assente o altri errori
 * lasciano la disponibilità incerta (niente cache) e dicono la causa vera a chi ha chiesto un'azione.
 */
type Probe = { state: "available" } | { state: "missing" } | { state: "failed"; message: string };

const probeSharing = async (): Promise<Probe> => {
  if (available === true) return { state: "available" };
  if (available === false && Date.now() - checkedAt < UNAVAILABLE_RETRY_MS) return { state: "missing" };
  const gen = generation;
  // Solo l'esito positivo resta tra le visite (come i gruppi): la migrazione può arrivare dopo.
  if ((await getMeta<boolean>(AVAILABLE_META).catch(() => undefined)) === true) {
    available = true;
    return { state: "available" };
  }
  if (!supabase) return { state: "failed", message: "Gli account non sono attivi in questa versione dell'app." };
  if (!viewer()) return { state: "failed", message: "Accedi al tuo account per usare la condivisione." };
  const { error } = await supabase.from("studyos_shares").select("id").limit(0);
  const outcome = sharingProbeOutcome(error);
  if (outcome === "missing") {
    available = false;
    checkedAt = Date.now();
    // Dopo un logout (o un altro cambio) lo stato dello store non è più di questa richiesta.
    if (gen === generation) useSharedStore.getState().setAvailability("missing");
    return { state: "missing" };
  }
  if (outcome === "failed") return { state: "failed", message: shareErrorText(error as NonNullable<typeof error>) };
  available = true;
  await setMeta(AVAILABLE_META, true).catch(() => undefined);
  return { state: "available" };
};

export const isSharingAvailable = async (): Promise<boolean> => (await probeSharing()).state === "available";

const requireSharing = async () => {
  if (!viewer()) throw new Error("Accedi al tuo account per usare la condivisione.");
  const probe = await probeSharing();
  if (probe.state === "missing") throw new Error(SHARING_UNAVAILABLE_TEXT);
  if (probe.state === "failed") throw new Error(probe.message);
};

// ——— Cursori e condivisioni già viste (in memoria con il vault: non sopravvivono al ricaricamento) ———

const memoryMeta = new Map<string, unknown>();

const readMeta = async <T,>(key: string) =>
  useSharedStore.getState().persistent ? await getMeta<T>(key).catch(() => undefined) : (memoryMeta.get(key) as T | undefined);

const writeMeta = async (key: string, value: unknown) => {
  if (useSharedStore.getState().persistent) await setMeta(key, value).catch(() => undefined);
  else memoryMeta.set(key, value);
};

/**
 * Via i cursori dei proprietari che non condividono più nulla con chi guarda: se ricondividono le
 * stesse sezioni (stessa firma) il pull riparte da zero invece di saltare le righe vecchie.
 */
const forgetCursors = async (me: string, owners: ReadonlySet<string>) => {
  const prefix = cursorMeta(me, "");
  const stale = (key: string) => key.startsWith(prefix) && !owners.has(key.slice(prefix.length));
  for (const key of [...memoryMeta.keys()]) if (stale(key)) memoryMeta.delete(key);
  // Anche su disco col vault o con la cache degradata: un cursore rimasto lì varrebbe al prossimo avvio.
  const keys = await db.meta.where("key").startsWith(prefix).primaryKeys().catch(() => [] as string[]);
  const old = keys.map(String).filter(stale);
  if (old.length) await db.meta.bulkDelete(old).catch(() => undefined);
};

// ——— Pull ———

const pullShares = async (me: string, gen: number) => {
  const server = client();
  const [shares, invites, labels] = await Promise.all([
    server.from("studyos_shares").select(SHARE_COLUMNS).order("created_at", { ascending: true }).limit(1000),
    server.from("studyos_share_invites").select(INVITE_COLUMNS).order("created_at", { ascending: false }).limit(100),
    server.rpc("shared_subject_labels")
  ]);
  still(gen);
  fail(shares.error);
  fail(invites.error);
  fail(labels.error);
  const grants = (shares.data ?? []).map((row) => grantFromRow(row)).filter((grant): grant is ShareGrant => grant !== null);
  const received = grants.filter((grant) => grant.ownerId !== me);
  const inviteList = (invites.data ?? []).map((row) => inviteFromRow(row));
  await useSharedStore.getState().setShares(grants.filter((grant) => grant.ownerId === me), received, inviteList);
  still(gen);
  useSharedStore.getState().setLabels(
    ((labels.data ?? []) as Record<string, unknown>[]).map((row) => ({
      ownerId: String(row.owner_id),
      id: String(row.subject_id),
      name: String(row.name ?? ""),
      color: String(row.color ?? ""),
      icon: String(row.icon ?? "")
    }))
  );
  return { received, invites: inviteList };
};

/** Righe di `ownerId` cambiate da `since` (tutte con null), pagina per pagina. Ritorna l'ultimo updated_at visto. */
const pullRows = async (ownerId: string, types: string[], since: string | null, gen: number) => {
  const from = since ? new Date(Date.parse(since) - CURSOR_OVERLAP_MS).toISOString() : null;
  let latest = since;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = client()
      .from("studyos_items")
      .select(ROW_COLUMNS)
      .eq("user_id", ownerId)
      .in("entity_type", types)
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (from) query = query.gte("updated_at", from);
    const { data, error } = await query;
    still(gen);
    fail(error);
    const rows = (data ?? []) as RemoteSharedRow[];
    if (rows.length) {
      await useSharedStore.getState().applyRows(ownerId, rows);
      latest = rows[rows.length - 1].updated_at;
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return latest;
};

/** Id ancora visibili (`${tipo}:${id}`): la riconciliazione toglie revoche, filtri cambiati, materie escluse, voti registrati. */
const visibleKeys = async (ownerId: string, types: string[], gen: number) => {
  const visible = new Set<string>();
  for (let offset = 0; ; offset += ID_PAGE_SIZE) {
    const { data, error } = await client()
      .from("studyos_items")
      .select("entity_type, entity_id")
      .eq("user_id", ownerId)
      .in("entity_type", types)
      .eq("deleted", false)
      .order("id", { ascending: true })
      .range(offset, offset + ID_PAGE_SIZE - 1);
    still(gen);
    fail(error);
    for (const row of data ?? []) visible.add(`${row.entity_type}:${row.entity_id}`);
    if (!data || data.length < ID_PAGE_SIZE) break;
  }
  return visible;
};

const pullOwner = async (me: string, ownerId: string, types: string[], sig: string, gen: number) => {
  const key = cursorMeta(me, ownerId);
  const stored = await readMeta<OwnerCursor>(key);
  still(gen);
  const since = stored?.sig === sig ? stored.at : null;
  let latest = await pullRows(ownerId, types, since, gen);
  const visible = await visibleKeys(ownerId, types, gen);
  // Il server mostra righe che qui mancano: il cursore le ha saltate (es. revoca e poi la stessa
  // condivisione di nuovo). Si riscarica tutto da zero, una volta per passata.
  const state = useSharedStore.getState();
  if (since !== null && missingVisibleKeys(state.items, state.outbox, ownerId, visible).length) {
    latest = (await pullRows(ownerId, types, null, gen)) ?? latest;
  }
  await useSharedStore.getState().reconcile(ownerId, types, visible);
  // Il cursore avanza solo se le righe sono finite nello store di questa generazione.
  still(gen);
  await writeMeta(key, { sig, at: latest } satisfies OwnerCursor);
};

const refetchRow = async (ownerId: string, entityType: string, entityId: string, gen: number) => {
  const { data, error } = await client()
    .from("studyos_items")
    .select(ROW_COLUMNS)
    .eq("user_id", ownerId)
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .maybeSingle();
  still(gen);
  fail(error);
  // Riga non più visibile (permesso tolto, filtro cambiato): sparisce dalla cache.
  const row: RemoteSharedRow =
    (data as RemoteSharedRow | null) ?? { entity_type: entityType, entity_id: entityId, payload: { id: entityId }, deleted: true, updated_at: "" };
  await useSharedStore.getState().applyRows(ownerId, [row]);
};

// ——— Push ———

const pushOutbox = async (gen: number) => {
  const store = useSharedStore.getState();
  const { batches, orphans } = sharedPushBatches(store.outbox, store.items);
  if (orphans.length) await store.settleOutbox(orphans);
  for (const batch of batches) {
    still(gen);
    const { data, error } = await client().rpc("push_shared_rows", {
      p_owner_id: batch.ownerId,
      p_client_id: clientId,
      p_rows: batch.rows
    });
    still(gen);
    fail(error);
    const results = (data ?? []) as { entity_type: string; entity_id: string; accepted: boolean; reason: string | null }[];
    const accepted = new Set(results.filter((result) => result.accepted).map((result) => sharedKey(batch.ownerId, result.entity_type, result.entity_id)));
    // Le accettate diventano note al server: un elemento creato qui ed eliminato durante l'invio
    // riceve ora il suo tombstone, invece di tornare in vita al pull.
    await useSharedStore.getState().settlePushed(
      batch.entries,
      batch.entries.filter((entry) => accepted.has(entry.key))
    );
    let denied = false;
    for (const result of results) {
      if (result.accepted) continue;
      if (result.reason === "denied") denied = true;
      // stale: vince la versione remota; denied: si torna a ciò che il server mostra.
      await refetchRow(batch.ownerId, result.entity_type, result.entity_id, gen);
    }
    if (denied) {
      still(gen);
      const owner = useSharedStore.getState().received.find((grant) => grant.ownerId === batch.ownerId)?.ownerName || "questa persona";
      useSharedStore.getState().setNotice(`Non hai più il permesso di modificare i dati di ${owner}: la modifica non è stata salvata.`);
    }
  }
};

// ——— Notifiche ———

/**
 * Proprietari di un invito appena accettato da chi guarda (con scadenza): niente notifica per ciò
 * che ha appena scelto. Il silenzio finisce quando una passata vede davvero la nuova condivisione:
 * una passata già in corso al momento dell'accettazione non la vede ancora.
 */
const silentOwners = new Map<string, number>();
const SILENT_MS = 2 * 60_000;

const notifyNew = async (me: string, received: ShareGrant[], invites: ShareInviteSummary[], gen: number) => {
  const seen = await readMeta<string[]>(seenMeta(me));
  still(gen);
  const now = Date.now();
  for (const [owner, until] of silentOwners) if (until <= now) silentOwners.delete(owner);
  const notices = shareNotices(me, received, invites, seen, new Set(silentOwners.keys()));
  for (const owner of notices.consumed) silentOwners.delete(owner);
  const add = useStudyStore.getState().addNotification;
  for (const grant of notices.grants) {
    still(gen);
    await add({
      id: `notif-share-${grant.id}`,
      kind: "share",
      title: `${grant.ownerName || "Qualcuno"} condivide con te: ${SHARE_SCOPE_LABEL[grant.scope]}`,
      body: grant.permission === "edit" ? "Puoi vedere e modificare. Lo trovi in Condivisione." : "Puoi vedere. Lo trovi in Condivisione.",
      linkView: "sharing"
    });
  }
  for (const invite of notices.invites) {
    still(gen);
    await add({
      id: `notif-share-invite-${invite.id}`,
      kind: "share",
      title: `${invite.ownerName || "Qualcuno"} ti invita a condividere`,
      body: `${scopesSummary(invite.offers)}. Apri Condivisione per rispondere.`,
      linkView: "sharing"
    });
  }
  // Segnate come viste dopo le notifiche: una passata interrotta a metà non ne perde nessuna
  // (gli id stabili evitano i doppioni alla passata dopo). Col vault restano in memoria.
  still(gen);
  await writeMeta(seenMeta(me), notices.ids);
};

// ——— Realtime ———

let channel: RealtimeChannel | null = null;
let channelKey = "";

const stopRealtime = async () => {
  const current = channel;
  channel = null;
  channelKey = "";
  // Attendere la rimozione: supabase-js riusa un canale con lo stesso topic finché esiste.
  if (current && supabase) await supabase.removeChannel(current).catch(() => undefined);
};

const ensureRealtime = async (me: string, owners: string[], gen: number) => {
  const watched = [...owners].sort().slice(0, REALTIME_OWNERS_MAX);
  const key = `${me}|${watched.join(",")}`;
  if (channel && key === channelKey) return;
  await stopRealtime();
  still(gen);
  channelKey = key;
  // Condivisioni e inviti: solo segnale. Gli eventi DELETE portano solo la chiave e arrivano a
  // tutti gli iscritti, quindi dal payload non si legge né si conserva nulla.
  let next = client()
    .channel(`studyos-sharing:${me}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "studyos_shares" }, () => schedule())
    .on("postgres_changes", { event: "*", schema: "public", table: "studyos_share_invites" }, () => schedule());
  if (watched.length) {
    next = next.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "studyos_items", filter: `user_id=in.(${watched.join(",")})` },
      (payload) => {
        const row = (payload.new ?? payload.old) as Record<string, unknown> | null;
        if (row?.client_id && row.client_id === clientId) return;
        schedule();
      }
    );
  }
  channel = next.subscribe();
};

// ——— Ciclo ———

let running: Promise<void> | null = null;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | null = null;
/** Ultimo errore messo da qui: una passata riuscita toglie quello, non l'avviso dell'archivio dello store. */
let shownError: string | null = null;

const showError = (text: string | null) => {
  const store = useSharedStore.getState();
  if (text !== null) store.setSyncError(text);
  else if (shownError !== null && store.syncError === shownError) store.setSyncError(null);
  shownError = text;
};

const schedule = (delay = DEBOUNCE_MS) => {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void syncSharedNow();
  }, delay);
};

const syncOnce = async () => {
  const gen = generation;
  const me = viewer();
  // Store non ancora caricato per chi guarda ora: switchViewer chiede la passata a fine caricamento.
  if (!me || hydrated !== gen || useStudyStore.getState().locked) return;
  try {
    if (!(await isSharingAvailable())) return;
    still(gen);
    useSharedStore.getState().setAvailability("ready");
    await pushOutbox(gen);
    const { received, invites } = await pullShares(me, gen);
    const owners = ownerEntityTypes(received);
    await forgetCursors(me, new Set(owners.keys()));
    for (const [ownerId, types] of owners) await pullOwner(me, ownerId, types, grantSignature(received, ownerId), gen);
    await notifyNew(me, received, invites, gen);
    await ensureRealtime(me, [...owners.keys()], gen);
    still(gen);
    showError(null);
  } catch (error) {
    // Chi guarda è cambiato: la passata della nuova generazione parte da sola.
    if (error instanceof ViewerChanged || gen !== generation) return;
    // Rete assente o errore temporaneo: si riprova al prossimo segnale o al controllo periodico.
    // I testi da fail() sono già pronti; un errore grezzo (es. TypeError di rete) diventa italiano.
    showError(error instanceof Error ? shareErrorText({ message: error.message }) : "Aggiornamento non riuscito.");
  }
};

/** Una passata completa (single-flight: chiamate concorrenti si uniscono in una passata in più). */
export const syncSharedNow = (): Promise<void> => {
  if (running) {
    rerun = true;
    return running;
  }
  running = (async () => {
    do {
      rerun = false;
      await syncOnce();
    } while (rerun);
  })().finally(() => {
    running = null;
  });
  return running;
};

// ——— Chi guarda ———

let initialized = false;
let currentViewer: string | null = null;
let switching: Promise<void> = Promise.resolve();

const isPersistent = () => useStudyStore.getState().settings.security.mode !== "vault";

const switchViewer = async (next: string | null, previous: string | null, gen: number) => {
  await stopRealtime();
  available = null;
  memoryMeta.clear();
  const store = useSharedStore.getState();
  if (!next) {
    // Logout vero (c'era un account): via i dati altrui anche dal disco. Le scritture ancora in
    // coda si perdono: senza sessione non si possono inviare.
    if (previous) await store.clear();
    store.setAvailability("off");
    return;
  }
  // Vault bloccato: dati altrui fuori dalla memoria (la cache su disco, se c'è, resta). Lo sblocco li ricarica.
  if (useStudyStore.getState().locked) {
    store.forgetMemory();
    return;
  }
  await store.hydrate(next, isPersistent());
  // Un altro cambio è arrivato durante il caricamento: è già in coda e decide lui.
  if (gen !== generation) return;
  hydrated = gen;
  schedule(0);
};

/** Le risposte in corso si scartano subito; i caricamenti dello store si eseguono in fila. */
const requestSwitch = (next: string | null, previous: string | null) => {
  generation += 1;
  silentOwners.clear();
  const gen = generation;
  switching = switching.then(() => switchViewer(next, previous, gen)).catch(() => undefined);
};

export const initShareSync = () => {
  if (initialized || !supabase) return;
  initialized = true;
  subscribeCloudSync((state) => {
    const next = state.session?.user.id ?? null;
    if (next === currentViewer) return;
    const previous = currentViewer;
    currentViewer = next;
    requestSwitch(next, previous);
  });
  useSharedStore.subscribe((curr, prev) => {
    if (curr.outbox !== prev.outbox && curr.outbox.length) schedule();
    // Reset locale con l'account ancora collegato (resetAllData → clear()): la sessione non cambia,
    // quindi si ricarica da qui. Il blocco del vault (forgetMemory) no: ci pensa lo sblocco.
    if (prev.viewerId && !curr.viewerId && currentViewer && !useStudyStore.getState().locked) {
      requestSwitch(currentViewer, currentViewer);
    }
  });
  useStudyStore.subscribe((curr, prev) => {
    if (!prev.locked && curr.locked) {
      // Subito fuori dalla memoria; il cambio in coda lo ripete dopo un eventuale caricamento in corso.
      useSharedStore.getState().forgetMemory();
      requestSwitch(currentViewer, currentViewer);
      return;
    }
    if (curr.locked || !currentViewer) return;
    // Sblocco, oppure vault attivato o tolto: la cache passa da disco a memoria (o viceversa) da capo.
    if (prev.locked || curr.settings.security.mode !== prev.settings.security.mode) requestSwitch(currentViewer, currentViewer);
  });
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => schedule(0));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && currentViewer) schedule();
    });
    window.setInterval(() => {
      if (currentViewer && document.visibilityState === "visible") void syncSharedNow();
    }, PERIODIC_MS);
  }
};

// ——— Azioni (UI e agente) ———

export const createShareInvite = async (input: { offers: ShareOffer[]; requests: ShareRequest[]; recipientEmail?: string }) => {
  await requireSharing();
  const { data, error } = await client().rpc("create_share_invite", {
    p_owner_name: myName(),
    p_offers: input.offers.map(offerToRow),
    p_requests: input.requests.map((request) => ({ scope: request.scope, permission: request.permission })),
    p_recipient_email: input.recipientEmail?.trim() || null
  });
  fail(error);
  schedule();
  return data as { id: string; token: string };
};

export const previewShareInvite = async (token: string): Promise<ShareInvitePreview | null> => {
  await requireSharing();
  const { data, error } = await client().rpc("preview_share_invite", { p_token: token });
  fail(error);
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;
  const summary = inviteFromRow({ ...row, id: row.invite_id });
  return {
    inviteId: summary.id,
    ownerName: summary.ownerName,
    offers: summary.offers,
    requests: summary.requests,
    expiresAt: summary.expiresAt,
    status: summary.status,
    forOtherAccount: row.for_other_account === true,
    isOwn: row.is_own === true
  };
};

export const acceptShareInvite = async (inviteId: string, token: string | null, reciprocal: ShareOffer[]) => {
  await requireSharing();
  const gen = generation;
  const { data, error } = await client().rpc("accept_share_invite", {
    p_invite_id: inviteId,
    p_token: token,
    p_display_name: myName(),
    p_reciprocal: reciprocal.map(offerToRow)
  });
  fail(error);
  const result = data as { owner_id: string; owner_name: string; granted: number; shared_back: number };
  if (gen === generation) silentOwners.set(result.owner_id, Date.now() + SILENT_MS);
  await syncSharedNow();
  return result;
};

export const declineShareInvite = async (inviteId: string, token: string | null) => {
  await requireSharing();
  const { error } = await client().rpc("decline_share_invite", { p_invite_id: inviteId, p_token: token });
  fail(error);
  await syncSharedNow();
};

/** Annulla un invito non ancora usato (solo chi l'ha creato, via RLS). */
export const cancelShareInvite = async (inviteId: string) => {
  await requireSharing();
  const { error } = await client().from("studyos_share_invites").delete().eq("id", inviteId);
  fail(error);
  await syncSharedNow();
};

/**
 * Condivisione diretta con una persona già collegata o con un gruppo (la RLS lo verifica).
 * Le sezioni nuove si creano con un solo insert (tutte o nessuna), poi si aggiornano quelle già
 * condivise. La rilettura parte comunque: se un passo fallisce dopo che altri sono andati a buon
 * fine, l'elenco "condivisi da me" è già aggiornato e l'errore dice cosa è stato salvato.
 */
export const shareWith = async (target: ShareTarget, offers: ShareOffer[]) => {
  await requireSharing();
  const me = viewer() as string;
  const { create, update } = planShareWrites(useSharedStore.getState().given, target, offers);
  const saved: ShareScope[] = [];
  try {
    if (create.length) {
      const { error } = await client()
        .from("studyos_shares")
        .insert(
          create.map((offer) => {
            const row = offerToRow(offer);
            return {
              owner_id: me,
              owner_name: myName(),
              scope: row.scope,
              permission: row.permission,
              subject_ids: row.subject_ids,
              grantee_user_id: target.userId ?? null,
              grantee_group_id: target.groupId ?? null,
              grantee_name: target.name.slice(0, 120)
            };
          })
        );
      fail(error);
      saved.push(...create.map((offer) => offer.scope));
    }
    for (const { id, offer } of update) {
      const row = offerToRow(offer);
      const { error } = await client()
        .from("studyos_shares")
        .update({ permission: row.permission, subject_ids: row.subject_ids, owner_name: myName() })
        .eq("id", id);
      fail(error);
      saved.push(offer.scope);
    }
  } catch (cause) {
    if (saved.length && cause instanceof Error) {
      throw new Error(`${cause.message} Già condivise prima dell'errore: ${saved.map((scope) => SHARE_SCOPE_LABEL[scope]).join(", ")}.`);
    }
    throw cause;
  } finally {
    await syncSharedNow().catch(() => undefined);
  }
};

export const updateShare = async (id: string, patch: { permission: SharePermission; subjectIds: string[] }) => {
  await requireSharing();
  const { error } = await client()
    .from("studyos_shares")
    .update({ permission: patch.permission, subject_ids: patch.subjectIds })
    .eq("id", id);
  fail(error);
  await syncSharedNow();
};

/** Il proprietario smette di condividere; chi riceve esce da una condivisione diretta. */
export const revokeShare = async (id: string) => {
  await requireSharing();
  const { error } = await client().from("studyos_shares").delete().eq("id", id);
  fail(error);
  await syncSharedNow();
};

/** Modifiche fatte da altre persone sui miei dati (ultimi 90 giorni). */
export const listRevisions = async (limit = 100): Promise<ItemRevision[]> => {
  await requireSharing();
  const { data, error } = await client()
    .from("studyos_item_revisions")
    .select("id, entity_type, entity_id, payload, deleted, change, changed_by, changed_at")
    .order("changed_at", { ascending: false })
    .limit(limit);
  fail(error);
  return (data ?? []).map((row) => revisionFromRow(row));
};
