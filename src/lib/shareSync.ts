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
import { getMeta, setMeta } from "./db";
import { SHARE_SCOPE_LABEL, scopesSummary } from "./labels";
import {
  grantFromRow,
  grantSignature,
  inviteFromRow,
  offerToRow,
  ownerEntityTypes,
  revisionFromRow,
  sharedKey,
  sharedPushBatches,
  type ItemRevision,
  type RemoteSharedRow,
  type ShareGrant,
  type ShareInviteStatus,
  type ShareInviteSummary,
  type ShareOffer,
  type SharePermission,
  type ShareRequest
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

const UNAVAILABLE_TEXT =
  "La condivisione non è ancora attiva sul server: esegui supabase/sharing.sql nel SQL Editor di Supabase (vedi supabase/README.md).";

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

const missingObject = (error: DbError) =>
  Boolean(error && /42P01|42883|PGRST202|PGRST205|does not exist|Could not find the (table|function)/i.test(`${error.code ?? ""} ${error.message}`));

const friendly = (error: NonNullable<DbError>) => {
  if (missingObject(error)) return UNAVAILABLE_TEXT;
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return "Non hai il permesso per questa operazione. Puoi condividere direttamente solo con persone che conosci (un gruppo in comune o una condivisione già attiva): per le altre crea un invito.";
  }
  return error.message;
};

const fail = (error: DbError) => {
  if (error) throw new Error(friendly(error));
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

export const isSharingAvailable = async (): Promise<boolean> => {
  if (available === true) return true;
  if (available === false && Date.now() - checkedAt < UNAVAILABLE_RETRY_MS) return false;
  // Solo l'esito positivo resta tra le visite (come i gruppi): la migrazione può arrivare dopo.
  if ((await getMeta<boolean>(AVAILABLE_META).catch(() => undefined)) === true) {
    available = true;
    return true;
  }
  if (!supabase || !viewer()) return false;
  const { error } = await supabase.from("studyos_shares").select("id").limit(0);
  if (error && missingObject(error)) {
    available = false;
    checkedAt = Date.now();
    useSharedStore.getState().setAvailability("missing");
    return false;
  }
  if (error) return false;
  available = true;
  await setMeta(AVAILABLE_META, true).catch(() => undefined);
  return true;
};

const requireSharing = async () => {
  if (!viewer()) throw new Error("Accedi al tuo account per usare la condivisione.");
  if (!(await isSharingAvailable())) throw new Error(UNAVAILABLE_TEXT);
};

// ——— Cursori (in memoria con il vault: la cache non sopravvive al ricaricamento) ———

const memoryCursors = new Map<string, OwnerCursor>();

const readCursor = async (key: string) =>
  useSharedStore.getState().persistent ? await getMeta<OwnerCursor>(key).catch(() => undefined) : memoryCursors.get(key);

const writeCursor = async (key: string, value: OwnerCursor) => {
  if (useSharedStore.getState().persistent) await setMeta(key, value).catch(() => undefined);
  else memoryCursors.set(key, value);
};

// ——— Pull ———

const pullShares = async (me: string, gen: number) => {
  const db = client();
  const [shares, invites, labels] = await Promise.all([
    db.from("studyos_shares").select(SHARE_COLUMNS).order("created_at", { ascending: true }).limit(1000),
    db.from("studyos_share_invites").select(INVITE_COLUMNS).order("created_at", { ascending: false }).limit(100),
    db.rpc("shared_subject_labels")
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

const pullOwner = async (me: string, ownerId: string, types: string[], sig: string, gen: number) => {
  const db = client();
  const key = cursorMeta(me, ownerId);
  const stored = await readCursor(key);
  const since = stored?.sig === sig ? stored.at : null;
  const from = since ? new Date(Date.parse(since) - CURSOR_OVERLAP_MS).toISOString() : null;
  let latest = since;
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let query = db
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
  // Id ancora visibili: toglie dalla cache revoche, filtri cambiati, materie escluse, voti registrati.
  const visible = new Set<string>();
  for (let offset = 0; ; offset += ID_PAGE_SIZE) {
    const { data, error } = await db
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
  await useSharedStore.getState().reconcile(ownerId, types, visible);
  // Il cursore avanza solo se le righe sono finite nello store di questa generazione.
  still(gen);
  await writeCursor(key, { sig, at: latest });
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

/** Proprietari appena accettati da chi guarda: niente notifica per ciò che ha appena scelto. */
const silentOwners = new Set<string>();

const notifyNew = async (me: string, received: ShareGrant[], invites: ShareInviteSummary[], gen: number) => {
  const incoming = invites.filter((invite) => invite.ownerId !== me && invite.status === "pending");
  const ids = [...received.map((grant) => grant.id), ...incoming.map((invite) => `invite-${invite.id}`)];
  const seen = await getMeta<string[]>(seenMeta(me)).catch(() => undefined);
  still(gen);
  const silent = new Set(silentOwners);
  silentOwners.clear();
  // Primo controllo su questo dispositivo: nessuna raffica di notifiche per condivisioni vecchie.
  if (seen) {
    const known = new Set(seen);
    const add = useStudyStore.getState().addNotification;
    for (const grant of received) {
      if (known.has(grant.id) || silent.has(grant.ownerId)) continue;
      still(gen);
      await add({
        id: `notif-share-${grant.id}`,
        kind: "share",
        title: `${grant.ownerName || "Qualcuno"} condivide con te: ${SHARE_SCOPE_LABEL[grant.scope]}`,
        body: grant.permission === "edit" ? "Puoi vedere e modificare. Lo trovi in Condivisione." : "Puoi vedere. Lo trovi in Condivisione.",
        linkView: "sharing"
      });
    }
    for (const invite of incoming) {
      if (known.has(`invite-${invite.id}`)) continue;
      still(gen);
      await add({
        id: `notif-share-invite-${invite.id}`,
        kind: "share",
        title: `${invite.ownerName || "Qualcuno"} ti invita a condividere`,
        body: `${scopesSummary(invite.offers)}. Apri Condivisione per rispondere.`,
        linkView: "sharing"
      });
    }
  }
  // Segnate come viste dopo le notifiche: una passata interrotta a metà non ne perde nessuna
  // (gli id stabili evitano i doppioni alla passata dopo).
  still(gen);
  await setMeta(seenMeta(me), ids).catch(() => undefined);
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
    for (const [ownerId, types] of owners) await pullOwner(me, ownerId, types, grantSignature(received, ownerId), gen);
    await notifyNew(me, received, invites, gen);
    await ensureRealtime(me, [...owners.keys()], gen);
    still(gen);
    showError(null);
  } catch (error) {
    // Chi guarda è cambiato: la passata della nuova generazione parte da sola.
    if (error instanceof ViewerChanged || gen !== generation) return;
    // Rete assente o errore temporaneo: si riprova al prossimo segnale o al controllo periodico.
    showError(error instanceof Error ? error.message : "Aggiornamento non riuscito.");
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
  memoryCursors.clear();
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
  if (gen === generation) silentOwners.add(result.owner_id);
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

/** Condivisione diretta con una persona già collegata o con un gruppo (la RLS lo verifica). */
export const shareWith = async (target: ShareTarget, offers: ShareOffer[]) => {
  await requireSharing();
  const me = viewer() as string;
  const given = useSharedStore.getState().given;
  for (const offer of offers) {
    const row = offerToRow(offer);
    const current = given.find(
      (grant) =>
        grant.scope === offer.scope &&
        (target.userId ? grant.granteeUserId === target.userId : grant.granteeGroupId === target.groupId)
    );
    const { error } = current
      ? await client()
          .from("studyos_shares")
          .update({ permission: row.permission, subject_ids: row.subject_ids, owner_name: myName() })
          .eq("id", current.id)
      : await client().from("studyos_shares").insert({
          owner_id: me,
          owner_name: myName(),
          scope: row.scope,
          permission: row.permission,
          subject_ids: row.subject_ids,
          grantee_user_id: target.userId ?? null,
          grantee_group_id: target.groupId ?? null,
          grantee_name: target.name.slice(0, 120)
        });
    fail(error);
  }
  await syncSharedNow();
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
