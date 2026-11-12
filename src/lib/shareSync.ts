// Ponte verso supabase/sharing.sql: condivisioni, inviti e dati di altre persone.
// Caricato con import(): supabase-js resta fuori dal bundle iniziale. Senza account o senza
// migrazione la condivisione è spenta e il resto dell'app non se ne accorge.
//
// Ciclo: invia la coda (push_shared_rows) → scarica condivisioni, inviti, etichette → per ogni
// proprietario scarica le righe dei tipi coperti (cursore) → notifiche → Realtime (solo segnale).
// Riserva: ogni 5 minuti e al ritorno sulla scheda. Il confronto con gli id ancora visibili (revoche,
// filtri cambiati, elementi usciti da un filtro) costa una lettura di tutti gli id: si fa solo al
// controllo dei 5 minuti e quando cambiano i permessi di un proprietario, non a ogni segnale Realtime.
//
// Chi guarda e la sua generazione: shareViewer.ts.

import type { RealtimeChannel } from "@supabase/supabase-js";
import { getCloudSyncState, subscribeCloudSync } from "./cloudSyncState";
import { db, getMeta, setMeta } from "./db";
import { COLLECTION_BY_ENTITY_TYPE } from "./collections";
import { RESTORE_TEXT, SHARE_NOTICE_TEXT, SHARE_SCOPE_LABEL, peopleLabels, scopesSummary } from "./labels";
import { REVERT_TEXT } from "./labels/sharing";
import {
  SHARING_UNAVAILABLE_TEXT,
  grantFromRow,
  grantSignature,
  inviteFromRow,
  failedBatchesLast,
  isShareNetworkError,
  afterRowFilter,
  pushEachBatch,
  rowsForEntries,
  sharedPushDenied,
  sharedPushGone,
  sharedPushOutcome,
  isMissingSharingObject,
  missingVisibleKeys,
  offerToRow,
  ownerEntityTypes,
  planShareWrites,
  requireAffectedShare,
  REVISION_LIST_COLUMNS,
  SHARED_ENTITY_TYPES,
  PROTECTED_ENTITY_TYPES,
  canRestoreRevision,
  catchUpWhenSubscribed,
  revisionFromRow,
  revisionTitle,
  safeCssColor,
  shareErrorText,
  shareNotices,
  sharedKey,
  sharedPushBatches,
  sharingProbeOutcome,
  ShareUserError,
  type ItemRevision,
  type RestoreVersion,
  type RemoteSharedRow,
  type ShareGrant,
  type ShareInviteStatus,
  type ShareInviteSummary,
  type ShareOffer,
  type SharePermission,
  type ShareRequest,
  type ShareScope,
  type SharedOutboxEntry,
  type SharedPushBatch,
  type SharedPushResult
} from "./sharing";
import { clearPendingShare } from "./shareInvite";
import { requestPersist } from "./persistence";
import { supabase } from "./supabase";
import { useSharedStore } from "../store/useSharedStore";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";
import { ViewerChanged, createViewerLifecycle } from "./shareViewer";
import { createRecheckCadence } from "./shareRecheck";
import {
  entriesToRun,
  planKey,
  planRevert,
  revertSummary,
  revertVersions,
  touchedEntities,
  type ItemState,
  type RevertPlan,
  type RevertSummary
} from "./shareHistory";

const PAGE_SIZE = 200;
const ID_PAGE_SIZE = 1000;
/** Id per richiesta nella rilettura delle righe rifiutate. */
const REFETCH_PAGE_SIZE = 100;
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
// token_hash non è leggibile (grant per colonna): mai chiederlo. recipient_user_id arriva con people.sql.
const INVITE_COLUMNS = "id, owner_id, owner_name, offers, requests, recipient_email, recipient_user_id, status, accepted_by, expires_at, created_at";
const ROW_COLUMNS = "entity_type, entity_id, payload, deleted, updated_at";
/** Il pull pagina per (updated_at, id): serve anche l'id della riga. */
const PULL_COLUMNS = `id, ${ROW_COLUMNS}`;

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

/** Errore del server: lancia un ShareUserError con il testo già in italiano (marcato, così non viene riscritto). */
const fail = (error: DbError) => {
  if (error) throw new ShareUserError(shareErrorText(error));
};

const client = () => {
  if (!supabase) throw new ShareUserError("Gli account non sono attivi in questa versione dell'app.");
  return supabase;
};

const viewer = () => getCloudSyncState().session?.user.id ?? null;

// Nome del profilo e basta: vuoto = il server usa «Studente» e chi riceve mostra «Qualcuno». Mai la
// parte locale dell'email, che chi ha trovato la persona con il @nome non deve vedere.
const myName = () => selectPreferences(useStudyStore.getState()).displayName.trim().slice(0, 120);

// ——— Generazione di chi guarda (shareViewer.ts) ———

const isPersistent = () => useStudyStore.getState().settings.security.mode !== "vault";

const viewers = createViewerLifecycle({
  requested: () => silentOwners.clear(),
  reset: async () => {
    await stopRealtime();
    available = null;
    memoryMeta.clear();
    cadence.reset();
  },
  isLocked: () => useStudyStore.getState().locked,
  isPersistent,
  ready: () => schedule(0),
  // Logout o altro account: un invito aperto da link (token su questo dispositivo) non passa al prossimo.
  accountLeft: () => clearPendingShare()
});

/** Da chiamare dopo ogni attesa e prima di toccare lo store: un risultato di un'altra generazione si scarta. */
const still = (gen: number) => viewers.still(gen);

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
  const gen = viewers.generation;
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
    if (gen === viewers.generation) useSharedStore.getState().setAvailability("missing");
    return { state: "missing" };
  }
  if (outcome === "failed") return { state: "failed", message: shareErrorText(error as NonNullable<typeof error>) };
  available = true;
  await setMeta(AVAILABLE_META, true).catch(() => undefined);
  return { state: "available" };
};

export const isSharingAvailable = async (): Promise<boolean> => (await probeSharing()).state === "available";

const requireSharing = async () => {
  if (!viewer()) throw new ShareUserError("Accedi al tuo account per usare la condivisione.");
  const probe = await probeSharing();
  if (probe.state === "missing") throw new ShareUserError(SHARING_UNAVAILABLE_TEXT);
  if (probe.state === "failed") throw new ShareUserError(probe.message);
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
      // Colore scelto da un'altra persona: solo esadecimale, mai un url() che il browser scaricherebbe.
      color: safeCssColor(row.color),
      icon: String(row.icon ?? "")
    }))
  );
  return { received, invites: inviteList };
};

/**
 * Righe di `ownerId` cambiate da `since` (tutte con null), pagina per pagina. Ritorna l'ultimo updated_at visto.
 * Pagine per (updated_at, id), non per posizione (afterRowFilter): con l'offset una riga cambiata durante
 * la lettura passava in fondo e faceva saltare quella dopo.
 */
const pullRows = async (ownerId: string, types: string[], since: string | null, gen: number) => {
  const from = since ? new Date(Date.parse(since) - CURSOR_OVERLAP_MS).toISOString() : null;
  let latest = since;
  let after: { updatedAt: string; id: string } | null = null;
  for (;;) {
    let query = client()
      .from("studyos_items")
      .select(PULL_COLUMNS)
      .eq("user_id", ownerId)
      .in("entity_type", types)
      .order("updated_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(PAGE_SIZE);
    if (after) {
      query = query.or(afterRowFilter(after));
    } else if (from) {
      query = query.gte("updated_at", from);
    }
    const { data, error } = await query;
    still(gen);
    fail(error);
    const rows = (data ?? []) as RemoteSharedRow[];
    if (rows.length) {
      await useSharedStore.getState().applyRows(ownerId, rows);
      const last = rows[rows.length - 1];
      latest = last.updated_at;
      after = { updatedAt: last.updated_at, id: String(last.id ?? "") };
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

// ——— Ricontrollo degli id visibili ———

/** Quando confrontare la cache con gli id visibili (shareRecheck.ts). */
const cadence = createRecheckCadence(PERIODIC_MS);

/** Ritorna se ha ricontrollato gli id visibili di questo proprietario. */
const pullOwner = async (me: string, ownerId: string, types: string[], sig: string, full: boolean, gen: number) => {
  const key = cursorMeta(me, ownerId);
  const stored = await readMeta<OwnerCursor>(key);
  still(gen);
  const since = stored?.sig === sig ? stored.at : null;
  let latest = await pullRows(ownerId, types, since, gen);
  const recheck = cadence.needs(ownerId, sig, full);
  if (recheck) {
    const visible = await visibleKeys(ownerId, types, gen);
    // Il server mostra righe che qui mancano: il cursore le ha saltate (es. revoca e poi la stessa
    // condivisione di nuovo). Si riscarica tutto da zero, una volta per passata.
    const state = useSharedStore.getState();
    if (since !== null && missingVisibleKeys(state.items, state.outbox, ownerId, visible).length) {
      latest = (await pullRows(ownerId, types, null, gen)) ?? latest;
    }
    await useSharedStore.getState().reconcile(ownerId, types, visible);
    still(gen);
    cadence.checked(ownerId, sig);
  }
  // Il cursore avanza solo se le righe sono finite nello store di questa generazione.
  still(gen);
  await writeMeta(key, { sig, at: latest } satisfies OwnerCursor);
  return recheck;
};

/** Righe del server per le voci rifiutate (rowsForEntries), con una richiesta ogni REFETCH_PAGE_SIZE id. */
const refetchRows = async (ownerId: string, entries: readonly SharedOutboxEntry[], gen: number): Promise<RemoteSharedRow[]> =>
  rowsForEntries(ownerId, entries, await fetchRows(ownerId, entries, gen));

/** Righe del server per le voci, solo quelle che il server mostra. */
const fetchRows = async (ownerId: string, entries: readonly SharedOutboxEntry[], gen: number): Promise<RemoteSharedRow[]> => {
  const found: RemoteSharedRow[] = [];
  const ids = [...new Set(entries.map((entry) => entry.entityId))];
  const types = [...new Set(entries.map((entry) => entry.entityType))];
  for (let start = 0; start < ids.length; start += REFETCH_PAGE_SIZE) {
    const { data, error } = await client()
      .from("studyos_items")
      .select(ROW_COLUMNS)
      .eq("user_id", ownerId)
      .in("entity_type", types)
      .in("entity_id", ids.slice(start, start + REFETCH_PAGE_SIZE));
    still(gen);
    fail(error);
    found.push(...((data ?? []) as RemoteSharedRow[]));
  }
  // Tipi e id si incrociano nella richiesta: solo le righe delle voci.
  const wanted = new Set(entries.map((entry) => entry.key));
  return found.filter((row) => wanted.has(sharedKey(ownerId, row.entity_type, row.entity_id)));
};

// ——— Push ———

/**
 * Prima dell'invio (S4): le modifiche in coda partite da una versione del server si riallineano sulla
 * riga di adesso. Senza questo, una modifica fatta offline sopra una versione vecchia veniva accettata
 * (timbro più recente) e riscriveva i campi che il proprietario aveva cambiato nel frattempo. Le righe
 * uguali alla base non cambiano nulla; un errore qui non ferma l'invio (un rifiuto "stale" si riallinea
 * dopo). Resta una finestra di millisecondi tra questa lettura e l'invio.
 */
const rebaseBeforePush = async (gen: number) => {
  const byOwner = new Map<string, SharedOutboxEntry[]>();
  for (const entry of useSharedStore.getState().outbox) {
    if (entry.deleted || !entry.base) continue;
    byOwner.set(entry.ownerId, [...(byOwner.get(entry.ownerId) ?? []), entry]);
  }
  for (const [ownerId, entries] of byOwner) {
    try {
      const rows = await fetchRows(ownerId, entries, gen);
      still(gen);
      if (rows.length) await useSharedStore.getState().applyRows(ownerId, rows);
    } catch (error) {
      if (error instanceof ViewerChanged || gen !== viewers.generation) throw error;
    }
  }
};

const pushBatch = async (batch: SharedPushBatch, gen: number) => {
  // Segnate (e salvate) prima dell'invio: se la risposta si perde, la riga può essere già sul server.
  await useSharedStore.getState().markAttempted(batch.entries);
  still(gen);
  const { data, error } = await client().rpc("push_shared_rows", {
    p_owner_id: batch.ownerId,
    p_client_id: clientId,
    p_rows: batch.rows
  });
  still(gen);
  fail(error);
  const { accepted, rejected, reason } = sharedPushOutcome(batch.ownerId, batch.entries, (data ?? []) as SharedPushResult[]);
  // Le accettate diventano note al server: un elemento creato qui ed eliminato durante l'invio
  // riceve ora il suo tombstone, invece di tornare in vita al pull.
  await useSharedStore.getState().settlePushed(accepted, accepted);
  if (!rejected.length) return;
  // stale: vince la versione remota; denied: si torna a ciò che il server mostra. Le voci escono dalla
  // coda solo con la riga riletta: se la rilettura fallisce restano, e la passata dopo riprova.
  const rows = await refetchRows(batch.ownerId, rejected, gen);
  still(gen);
  // "stale" con la versione da cui era partita: si unisce alla riga riletta e riparte (S4).
  await useSharedStore.getState().settleRejected(
    batch.ownerId,
    rejected,
    rows,
    rejected.filter((entry) => reason(entry) === "stale")
  );
  const denied = sharedPushDenied(rejected, reason, rows);
  if (denied || sharedPushGone(rejected, reason)) {
    still(gen);
    // Mostrato in ogni sezione (AppShell): chi ha modificato dal Calendario lo vede lì.
    const owner = useSharedStore.getState().received.find((grant) => grant.ownerId === batch.ownerId)?.ownerName ?? "";
    useSharedStore.getState().setNotice(denied ? SHARE_NOTICE_TEXT.denied(owner) : SHARE_NOTICE_TEXT.gone(owner));
  }
};

/** Chiavi delle voci nei lotti falliti nell'ultima passata: alla prossima quei lotti partono per ultimi. */
let failedLastPass = new Set<string>();

/** Invia la coda, un lotto alla volta: un lotto che fallisce (troppo grande, errore del server) non ferma gli altri. */
const pushOutbox = async (gen: number) => {
  await rebaseBeforePush(gen);
  still(gen);
  const store = useSharedStore.getState();
  const { batches, orphans } = sharedPushBatches(store.outbox, store.items);
  if (orphans.length) await store.settleOutbox(orphans);
  const failedNow = new Set<string>();
  try {
    await pushEachBatch(
      failedBatchesLast(batches, failedLastPass),
      async (batch) => {
        still(gen);
        try {
          await pushBatch(batch, gen);
        } catch (error) {
          if (!(error instanceof ViewerChanged)) for (const entry of batch.entries) failedNow.add(entry.key);
          throw error;
        }
      },
      { abort: (error) => error instanceof ViewerChanged, offline: isShareNetworkError }
    );
  } finally {
    failedLastPass = failedNow;
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
      linkView: "sharing",
      // Ora del server, non di questo dispositivo: una lettura o eliminazione già fatta altrove resta più
      // recente e vince la sync, invece di farla ricomparire da leggere.
      createdAt: grant.createdAt
    });
  }
  for (const invite of notices.invites) {
    still(gen);
    await add({
      id: `notif-share-invite-${invite.id}`,
      kind: "share",
      title: `${invite.ownerName || "Qualcuno"} ti invita a condividere`,
      body: `${scopesSummary(invite.offers)}. Apri Condivisione per rispondere.`,
      linkView: "sharing",
      createdAt: invite.createdAt
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
        // Le cancellazioni vere (non i tombstone: solo account eliminati) qui non arrivano mai: la riga
        // vecchia di un DELETE ha solo l'id, quindi il filtro su user_id non la trova (provato sullo
        // stack locale). Le toglie il ricontrollo dei 5 minuti.
        const row = (payload.new ?? payload.old) as Record<string, unknown> | null;
        // Il server antepone a client_id di chi riceve "r:<id utente>:" (studyos_items_recipient_values).
        if (row?.client_id && (row.client_id === clientId || row.client_id === `r:${me}:${clientId}`)) return;
        schedule();
      }
    );
  }
  // A ogni SUBSCRIBED (prima iscrizione e riconnessioni) un pull di recupero, con la solita attesa: le
  // righe scritte prima che il canale fosse davvero iscritto non arrivano come evento.
  const subscribing = next;
  channel = subscribing.subscribe(catchUpWhenSubscribed(() => channel === subscribing, () => schedule()));
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
  const gen = viewers.generation;
  const me = viewer();
  // Store non ancora caricato per chi guarda ora: il cambio di chi guarda chiede la passata a fine caricamento.
  if (!me || !viewers.isHydrated(gen) || useStudyStore.getState().locked) return;
  // Preso ora: un controllo dei 5 minuti che arriva durante la passata vale per quella dopo.
  const full = cadence.take();
  try {
    if (!(await isSharingAvailable())) return;
    still(gen);
    useSharedStore.getState().setAvailability("ready");
    // Un invio non riuscito non ferma gli aggiornamenti: revoche, condivisioni nuove e modifiche degli
    // altri arrivano lo stesso. L'errore si mostra a fine passata.
    let pushFailure: unknown = null;
    try {
      await pushOutbox(gen);
    } catch (error) {
      if (error instanceof ViewerChanged || gen !== viewers.generation) throw error;
      pushFailure = error;
    }
    const { received, invites } = await pullShares(me, gen);
    const owners = ownerEntityTypes(received);
    await forgetCursors(me, new Set(owners.keys()));
    // Chi non condivide più nulla: se ricondivide, si ricontrolla da capo.
    cadence.keep(new Set(owners.keys()));
    let allChecked = true;
    for (const [ownerId, types] of owners) {
      if (!(await pullOwner(me, ownerId, types, grantSignature(received, ownerId), full, gen))) allChecked = false;
    }
    cadence.passDone(allChecked, Date.now());
    await notifyNew(me, received, invites, gen);
    await ensureRealtime(me, [...owners.keys()], gen);
    still(gen);
    showError(pushFailure === null ? null : errorText(pushFailure));
  } catch (error) {
    // Chi guarda è cambiato: la passata della nuova generazione parte da sola (e ricontrolla tutto).
    if (error instanceof ViewerChanged || gen !== viewers.generation) return;
    // Il controllo dei 5 minuti non riuscito si ripete alla passata dopo.
    cadence.passFailed(full);
    // Rete assente o errore temporaneo: si riprova al prossimo segnale o al controllo periodico.
    showError(errorText(error));
  }
};

/**
 * Si passa l'errore stesso, non il suo messaggio: un ShareUserError (da fail()) è già in italiano e
 * resta com'è; un errore grezzo (TypeError di rete, bug) diventa testo italiano.
 */
const errorText = (error: unknown) => (error instanceof Error ? shareErrorText(error) : "Aggiornamento non riuscito.");

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

export const initShareSync = () => {
  if (initialized || !supabase) return;
  initialized = true;
  subscribeCloudSync((state) => viewers.setViewer(state.session?.user.id ?? null));
  // Solo voci nuove (chiave e queuedAt): segnarle come tentate o toglierle non chiede un'altra passata.
  useSharedStore.subscribe((curr, prev) => {
    if (curr.outbox === prev.outbox || !curr.outbox.length) return;
    const known = new Set(prev.outbox.map((entry) => `${entry.key}|${entry.queuedAt}`));
    if (curr.outbox.some((entry) => !known.has(`${entry.key}|${entry.queuedAt}`))) schedule();
  });
  viewers.watch();
  const flags = (state: ReturnType<typeof useStudyStore.getState>) => ({ locked: state.locked, mode: state.settings.security.mode });
  useStudyStore.subscribe((curr, prev) => viewers.studyChanged(flags(curr), flags(prev)));
  if (typeof window !== "undefined") {
    window.addEventListener("online", () => schedule(0));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !viewers.viewer) return;
      // Scheda rimasta nascosta: il controllo dei 5 minuti non è passato, si fa ora se è scaduto.
      cadence.resumed(Date.now());
      schedule();
    });
    window.setInterval(() => {
      if (!viewers.viewer || document.visibilityState !== "visible") return;
      cadence.requestFull();
      void syncSharedNow();
    }, PERIODIC_MS);
  }
};

// ——— Azioni (UI e agente) ———

/** Invito con link (token). Gli inviti per email non esistono più: a chi ha un account si manda createPersonShareInvite. */
export const createShareInvite = async (input: { offers: ShareOffer[]; requests: ShareRequest[] }) => {
  await requireSharing();
  const { data, error } = await client().rpc("create_share_invite", {
    p_owner_name: myName(),
    p_offers: input.offers.map(offerToRow),
    p_requests: input.requests.map((request) => ({ scope: request.scope, permission: request.permission })),
    p_recipient_email: null
  });
  fail(error);
  schedule();
  return data as { id: string; token: string };
};

/**
 * Invito nell'app a una persona trovata con la ricerca (supabase/people.sql): niente link né token,
 * solo il suo account può accettarlo. Ritorna l'id dell'invito.
 */
export const createPersonShareInvite = async (personId: string, offers: ShareOffer[], requests: ShareRequest[]) => {
  await requireSharing();
  const { data, error } = await client().rpc("invite_person_to_share", {
    p_person_id: personId,
    p_owner_name: myName(),
    p_offers: offers.map(offerToRow),
    p_requests: requests.map((request) => ({ scope: request.scope, permission: request.permission }))
  });
  // Condivisione attiva ma people.sql non ancora eseguito: lo si dice con il nome giusto dello script.
  if (error && isMissingSharingObject(error)) throw new ShareUserError(peopleLabels.errors.unavailable);
  fail(error);
  schedule();
  return String((data as { id?: string } | null)?.id ?? "");
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
  const gen = viewers.generation;
  const { data, error } = await client().rpc("accept_share_invite", {
    p_invite_id: inviteId,
    p_token: token,
    p_display_name: myName(),
    p_reciprocal: reciprocal.map(offerToRow)
  });
  fail(error);
  const result = data as { owner_id: string; owner_name: string; granted: number; shared_back: number };
  if (gen === viewers.generation) silentOwners.set(result.owner_id, Date.now() + SILENT_MS);
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
      const { data, error } = await client()
        .from("studyos_shares")
        .update({ permission: row.permission, subject_ids: row.subject_ids, owner_name: myName() })
        .eq("id", id)
        .select("id");
      fail(error);
      // Nessuna riga: tolta nel frattempo (anche da un altro dispositivo). La rilettura qui sotto la toglie dall'elenco.
      requireAffectedShare(data);
      saved.push(offer.scope);
    }
  } catch (cause) {
    if (saved.length && cause instanceof Error) {
      const text = `${cause.message} Già condivise prima dell'errore: ${saved.map((scope) => SHARE_SCOPE_LABEL[scope]).join(", ")}.`;
      // Il marcatore passa solo se il testo di partenza era già per l'utente.
      throw cause instanceof ShareUserError ? new ShareUserError(text) : new Error(text);
    }
    throw cause;
  } finally {
    await syncSharedNow().catch(() => undefined);
  }
};

/**
 * Zero righe toccate (condivisione tolta altrove, o una che la RLS non lascia cambiare): non è un
 * successo. Prima si rilegge, così l'elenco non la mostra più, poi l'errore arriva all'app e all'agente.
 */
const requireAffected = async (rows: readonly unknown[] | null) => {
  try {
    requireAffectedShare(rows);
  } catch (error) {
    await syncSharedNow().catch(() => undefined);
    throw error;
  }
};

export const updateShare = async (id: string, patch: { permission: SharePermission; subjectIds: string[] }) => {
  await requireSharing();
  const { data, error } = await client()
    .from("studyos_shares")
    .update({ permission: patch.permission, subject_ids: patch.subjectIds })
    .eq("id", id)
    .select("id");
  fail(error);
  await requireAffected(data);
  await syncSharedNow();
};

/** Il proprietario smette di condividere; chi riceve esce da una condivisione diretta. */
export const revokeShare = async (id: string) => {
  await requireSharing();
  const { data, error } = await client().from("studyos_shares").delete().eq("id", id).select("id");
  fail(error);
  await requireAffected(data);
  await syncSharedNow();
};

// ——— Cronologia delle modifiche di altri ———

const REVISIONS = "studyos_item_revisions";
/** Revisioni lette per annullare le modifiche di una persona: oltre, si chiede una data più vicina. */
const REVERT_SCAN_MAX = 5000;
/** Versioni intere per richiesta: quelle delle eliminazioni possono avere file fino a 600 KiB. */
const PAYLOAD_PAGE_SIZE = 20;

/** Modifiche fatte da altre persone sui miei dati (ultimi 90 giorni): solo titoli, mai i file. */
export const listRevisions = async (limit = 100): Promise<ItemRevision[]> => {
  await requireSharing();
  const { data, error } = await client()
    .from(REVISIONS)
    .select(REVISION_LIST_COLUMNS)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit);
  fail(error);
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => revisionFromRow(row));
};

/** Versioni intere delle revisioni scelte (con i file delle eliminazioni), per id. */
const loadRevisionPayloads = async (ids: readonly number[]) => {
  const payloads = new Map<number, Record<string, unknown>>();
  const unique = [...new Set(ids)];
  for (let start = 0; start < unique.length; start += PAYLOAD_PAGE_SIZE) {
    const { data, error } = await client()
      .from(REVISIONS)
      .select("id, payload")
      .in("id", unique.slice(start, start + PAYLOAD_PAGE_SIZE));
    fail(error);
    for (const row of (data ?? []) as { id: number; payload: unknown }[]) {
      if (typeof row.payload === "object" && row.payload !== null && !Array.isArray(row.payload)) {
        payloads.set(Number(row.id), row.payload as Record<string, unknown>);
      }
    }
  }
  return payloads;
};

/** Copia del proprietario su questo dispositivo (copertine e file attuali stanno lì), se c'è. */
const localEntity = (entityType: string, entityId: string) => {
  const collection = COLLECTION_BY_ENTITY_TYPE[entityType];
  if (!collection || !SHARED_ENTITY_TYPES.has(entityType)) return null;
  const entries = useStudyStore.getState()[collection] as unknown as readonly { id: string; updatedAt?: string }[];
  return entries.find((entry) => entry.id === entityId) ?? null;
};

const isPayload = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** L'ultima eliminazione dell'elemento dopo questa versione: conserva copertine e file. */
const latestDeletion = async (revision: ItemRevision) => {
  const { data, error } = await client()
    .from(REVISIONS)
    .select("payload")
    .eq("entity_type", revision.entityType)
    .eq("entity_id", revision.entityId)
    .eq("change", "delete")
    .gte("changed_at", revision.changedAt)
    .order("changed_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  fail(error);
  const payload = (data as { payload: unknown } | null)?.payload;
  return isPayload(payload) ? payload : null;
};

/**
 * Ripristina una versione della cronologia. Le versioni delle modifiche non hanno copertine, file e UID:
 * li riprende il negozio dalla copia del proprietario o, se l'elemento non è su questo dispositivo, qui
 * dall'eliminazione salvata dopo (che li conserva). I tipi senza copertine e file si ripristinano anche
 * senza copia.
 */
export const restoreRevision = async (revision: ItemRevision) => {
  await requireSharing();
  if (!canRestoreRevision(revision)) throw new ShareUserError(RESTORE_TEXT.notRestorable);
  const payloads = await loadRevisionPayloads([revision.id]);
  const payload = payloads.get(revision.id);
  if (!payload) throw new ShareUserError(RESTORE_TEXT.missing);
  const version: RestoreVersion = {
    entityType: revision.entityType,
    entityId: revision.entityId,
    payload,
    complete: revision.change === "delete",
    protectedFrom: null
  };
  if (!version.complete && PROTECTED_ENTITY_TYPES.has(revision.entityType) && !localEntity(revision.entityType, revision.entityId)) {
    version.protectedFrom = await latestDeletion(revision);
    if (!version.protectedFrom) throw new ShareUserError(RESTORE_TEXT.gone(revisionTitle(revision)));
  }
  await useStudyStore.getState().restoreEntity(version);
};

/**
 * Revisioni di tutti da `since` (dalla più vecchia), solo titoli: servono a pianificare l'annullamento.
 * Pagine per (changed_at, id), non per posizione: la pulizia dei 90 giorni può togliere le righe più
 * vecchie durante la lettura, e con le posizioni qualche riga verrebbe saltata.
 */
const revisionsSince = async (since: string) => {
  const rows: ItemRevision[] = [];
  let after: ItemRevision | null = null;
  for (;;) {
    let query = client()
      .from(REVISIONS)
      .select(REVISION_LIST_COLUMNS)
      .order("changed_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(ID_PAGE_SIZE);
    query = after
      ? query.or(`changed_at.gt."${after.changedAt}",and(changed_at.eq."${after.changedAt}",id.gt.${after.id})`)
      : query.gte("changed_at", since);
    const { data, error } = await query;
    fail(error);
    const page = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => revisionFromRow(row));
    rows.push(...page);
    if (rows.length > REVERT_SCAN_MAX) throw new ShareUserError(REVERT_TEXT.tooMany);
    if (page.length < ID_PAGE_SIZE) return rows;
    after = page[page.length - 1];
  }
};

/** Id per richiesta delle righe di cui serve lo stato. */
const STATE_PAGE_SIZE = 100;

/**
 * Dove sta oggi ogni elemento: la copia su questo dispositivo, la riga sul server e la coda d'invio.
 * `updated_at` della riga è dell'orologio del server, come `changed_at` delle revisioni: una scrittura
 * del proprietario (che non lascia revisioni) si riconosce perché è più recente dell'ultima revisione,
 * o perché è ancora in coda. Il timbro della copia qui (orologio del dispositivo) non si confronta.
 */
const itemStates = async (entities: readonly { entityType: string; entityId: string }[]) => {
  const me = viewer();
  if (!me) throw new ShareUserError("Accedi al tuo account per usare la condivisione.");
  const server = new Map<string, NonNullable<ItemState["server"]>>();
  const ids = [...new Set(entities.map((entity) => entity.entityId))];
  for (let start = 0; start < ids.length; start += STATE_PAGE_SIZE) {
    const { data, error } = await client()
      .from("studyos_items")
      .select("entity_type, entity_id, updated_at, deleted")
      .eq("user_id", me)
      .in("entity_id", ids.slice(start, start + STATE_PAGE_SIZE));
    fail(error);
    for (const row of (data ?? []) as { entity_type: string; entity_id: string; updated_at: string; deleted: boolean }[]) {
      server.set(`${row.entity_type}:${row.entity_id}`, { updatedAt: String(row.updated_at), deleted: row.deleted === true });
    }
  }
  // Modifiche del proprietario fatte qui e non ancora inviate (coda d'invio personale, chiave
  // `${tipo}:${id}`): contano come «cambiato dopo». Prima il salvataggio, così c'è anche l'ultima.
  await requestPersist().catch(() => undefined);
  const keys = entities.map((entity) => `${entity.entityType}:${entity.entityId}`);
  const queued = new Set((await db.syncOutbox.bulkGet(keys)).flatMap((row) => (row ? [row.key] : [])));
  return (entityType: string, entityId: string): ItemState => {
    const local = localEntity(entityType, entityId);
    return {
      local: local ? { updatedAt: local.updatedAt } : null,
      server: server.get(`${entityType}:${entityId}`) ?? null,
      pending: queued.has(`${entityType}:${entityId}`)
    };
  };
};

const buildRevertPlan = async (actorId: string, since: string) => {
  const revisions = await revisionsSince(since);
  const stateOf = await itemStates(touchedEntities(revisions, actorId, since));
  return planRevert(revisions, actorId, since, stateOf);
};

/** Il controllo mostrato alla persona: la conferma esegue proprio questo. */
export interface RevertPreview {
  actorId: string;
  since: string;
  plan: RevertPlan;
}

export type RevertOutcome = { status: "changed"; preview: RevertPreview } | { status: "done"; summary: RevertSummary };

/** Cosa farebbe l'annullamento delle modifiche di una persona da `since`, senza toccare nulla. */
export const previewRevert = async (actorId: string, since: string): Promise<RevertPreview> => {
  await requireSharing();
  return { actorId, since, plan: await buildRevertPlan(actorId, since) };
};

/**
 * Annulla tutte le modifiche di una persona da un giorno, come confermato: ogni elemento che ha
 * modificato o eliminato torna alla versione prima della sua prima modifica (stesso ripristino di un
 * elemento solo, tutto in un salvataggio). Gli elementi che ha aggiunto restano. Se da quel controllo
 * qualcosa è cambiato (un'altra modifica, un elemento eliminato), non scrive nulla e ridà il controllo
 * nuovo da confermare.
 */
export const revertPersonSince = async (confirmed: RevertPreview, skipChanged: boolean): Promise<RevertOutcome> => {
  await requireSharing();
  const plan = await buildRevertPlan(confirmed.actorId, confirmed.since);
  if (planKey(plan, skipChanged) !== planKey(confirmed.plan, skipChanged)) return { status: "changed", preview: { ...confirmed, plan } };
  const entries = entriesToRun(confirmed.plan, skipChanged);
  const payloads = await loadRevisionPayloads(
    entries.flatMap(({ revision, deletedAfter }) => (deletedAfter ? [revision.id, deletedAfter.id] : [revision.id]))
  );
  const { versions } = revertVersions(entries, payloads);
  // Il negozio ricontrolla al momento di scrivere: un elemento eliminato durante lo scaricamento non
  // torna senza il suo file, e si conta tra quelli non ripristinati.
  const restored = versions.length ? await useStudyStore.getState().restoreEntities(versions) : 0;
  return { status: "done", summary: { ...revertSummary(confirmed.plan, skipChanged), restored, notRestored: entries.length - restored } };
};

/** Persone che hanno cambiato i miei dati negli ultimi 90 giorni (al più 50): una lettura per persona. */
const ACTORS_MAX = 50;

export const revisionActors = async (): Promise<string[]> => {
  await requireSharing();
  const since = new Date(Date.now() - 90 * 24 * 60 * 60_000).toISOString();
  const found: string[] = [];
  while (found.length < ACTORS_MAX) {
    const query = client().from(REVISIONS).select("changed_by").gte("changed_at", since).not("changed_by", "is", null);
    const { data, error } = await (found.length ? query.not("changed_by", "in", `(${found.join(",")})`) : query)
      .order("changed_at", { ascending: false })
      .limit(1);
    fail(error);
    const next = (data as { changed_by: unknown }[] | null)?.[0]?.changed_by;
    if (typeof next !== "string") break;
    found.push(next);
  }
  return found;
};
