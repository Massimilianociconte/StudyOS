// Ponte verso supabase/people.sql: profilo online, ricerca delle persone e inviti all'account.
// Caricato solo con import(): supabase-js resta fuori dal bundle iniziale. Gli errori del server
// diventano etichette (peopleErrorText); email e @nome cercati non finiscono mai in log o notifiche.
//
// initPeopleSync (da App, come initShareSync) copia nel profilo online il nome di "Profilo e
// obiettivi" quando cambia, e crea la riga del profilo al primo accesso dopo l'aggiornamento.

import { getCloudSyncState, subscribeCloudSync } from "./cloudSyncState";
import { peopleLabels } from "./labels";
import {
  DISPLAY_NAME_MAX,
  PeopleUserError,
  classifyPersonQuery,
  normalizeHandle,
  peopleErrorText,
  personFromRow,
  personQueryParam,
  profileFromRow,
  profileNameToWrite,
  type FoundPerson,
  type MyProfile
} from "./people";
import type { ShareOffer, ShareRequest } from "./sharing";
import { supabase } from "./supabase";
import { selectPreferences, useStudyStore } from "../store/useStudyStore";

export type { FoundPerson, MyProfile };

const PROFILE_COLUMNS = "display_name, handle, discoverable";
/** Pausa dopo l'ultima modifica del nome prima di scriverlo sul server. */
const NAME_DEBOUNCE_MS = 1500;

type DbError = { message: string; code?: string } | null;

const fail = (error: DbError) => {
  if (error) throw new PeopleUserError(peopleErrorText(error));
};

const client = () => {
  if (!supabase) throw new PeopleUserError(peopleLabels.errors.noCloud);
  return supabase;
};

const myId = () => {
  const id = getCloudSyncState().session?.user.id;
  if (!id) throw new PeopleUserError(peopleLabels.errors.signedOut);
  return id;
};

/**
 * Nome di "Profilo e obiettivi", al massimo 60 caratteri. Mai la parte locale dell'email come
 * riserva: chi trova qualcuno con il @nome non deve poter dedurre il suo indirizzo.
 */
const profileName = () => selectPreferences(useStudyStore.getState()).displayName.trim().slice(0, DISPLAY_NAME_MAX);

/** Ricerca esatta per email o @nome: al massimo una persona, mai sé stessi, mai l'email. */
export const findPerson = async (query: string): Promise<FoundPerson | null> => {
  const parsed = classifyPersonQuery(query);
  if (!parsed) throw new PeopleUserError(peopleLabels.errors.badQuery);
  myId();
  const { data, error } = await client().rpc("find_person", { p_query: personQueryParam(parsed) });
  fail(error);
  const rows = Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
  return personFromRow(rows[0]);
};

/** Il @nome è libero (o è già il mio)? Conta nel limite di ricerche al minuto: chiamarla con una pausa. */
export const isHandleAvailable = async (handle: string): Promise<boolean> => {
  const value = normalizeHandle(handle);
  if (!value) throw new PeopleUserError(peopleLabels.errors.badHandle);
  myId();
  const { data, error } = await client().rpc("is_handle_available", { p_handle: value });
  fail(error);
  return data === true;
};

/** Il proprio profilo online; null se la riga non c'è ancora (vale "trovabile, senza @nome"). */
export const loadMyProfile = async (): Promise<MyProfile | null> => {
  const me = myId();
  const { data, error } = await client().from("studyos_profiles").select(PROFILE_COLUMNS).eq("user_id", me).maybeSingle();
  fail(error);
  return data ? profileFromRow(data as Record<string, unknown>) : null;
};

/**
 * Salva i campi indicati (crea la riga se manca). Il nome, se non è nel patch, è quello di
 * "Profilo e obiettivi", ma solo se non è vuoto: un nome locale vuoto non cancella quello del server. `handle` vuoto o null lo toglie.
 */
export const saveMyProfile = async (patch: Partial<Pick<MyProfile, "handle" | "discoverable" | "displayName">>): Promise<MyProfile> => {
  const me = myId();
  const row: Record<string, unknown> = { user_id: me };
  const name = profileNameToWrite(patch.displayName, profileName());
  if (name !== null) row.display_name = name;
  if (patch.handle !== undefined) {
    if (patch.handle === null || !patch.handle.trim()) {
      row.handle = null;
    } else {
      const handle = normalizeHandle(patch.handle);
      if (!handle) throw new PeopleUserError(peopleLabels.errors.badHandle);
      row.handle = handle;
    }
  }
  if (patch.discoverable !== undefined) row.discoverable = patch.discoverable;
  const { data, error } = await client().from("studyos_profiles").upsert(row, { onConflict: "user_id" }).select(PROFILE_COLUMNS).single();
  fail(error);
  return profileFromRow(data as Record<string, unknown>);
};

/** Invito in un gruppo a una persona trovata (proprietario o amministratore). Ritorna l'id dell'invito. */
export const invitePersonToGroup = async (groupId: string, personId: string): Promise<string> => {
  myId();
  const { data, error } = await client().rpc("invite_person_to_group", {
    p_group_id: groupId,
    p_person_id: personId,
    // Vuoto = il server usa il nome di riserva, come accept_group_invite e join_group_by_code.
    p_display_name: profileName()
  });
  fail(error);
  return String(data ?? "");
};

/**
 * Invito a vedere o modificare i propri dati, alla persona trovata: stesse offerte e richieste del
 * pannello Condividi. Passa da shareSync (controllo della migrazione, nome, aggiornamento elenchi).
 */
export const invitePersonToShare = async (personId: string, offers: ShareOffer[], requests: ShareRequest[]): Promise<string> => {
  const sync = await import("./shareSync");
  return sync.createPersonShareInvite(personId, offers, requests);
};

// ——— Nome del profilo online (in differita) ———

let initialized = false;
let nameTimer: ReturnType<typeof setTimeout> | undefined;
/** `${utente}:${nome}` già scritto sul server: niente scritture ripetute. */
let sentName: string | null = null;

const pushName = async () => {
  nameTimer = undefined;
  const state = useStudyStore.getState();
  const sync = getCloudSyncState();
  const me = sync.session?.user.id;
  // Vault chiuso o dati non ancora caricati: le preferenze non sono quelle vere.
  if (!me || !supabase || state.loading || state.locked) return;
  // Prima sincronizzazione in corso (nuovo dispositivo): il nome dell'account deve ancora arrivare.
  if (sync.status === "syncing") return scheduleName(NAME_DEBOUNCE_MS);
  const name = profileName();
  const key = `${me}:${name}`;
  if (sentName === key) return;
  try {
    // Nome vuoto (non ancora scelto): si crea la riga se manca, senza cancellare un nome già salvato.
    const { error } = await supabase
      .from("studyos_profiles")
      .upsert({ user_id: me, display_name: name }, { onConflict: "user_id", ignoreDuplicates: !name });
    if (!error && getCloudSyncState().session?.user.id === me) sentName = key;
  } catch {
    // Rete assente: si riprova alla prossima modifica, al prossimo accesso o quando torna la rete.
  }
};

const scheduleName = (delay: number) => {
  if (nameTimer !== undefined) clearTimeout(nameTimer);
  nameTimer = setTimeout(() => void pushName(), delay);
};

/** Da chiamare una volta dopo init() (App): segue accessi, cambi di account e modifiche del nome. */
export const initPeopleSync = () => {
  if (initialized || !supabase) return;
  initialized = true;
  let viewer: string | null = null;
  subscribeCloudSync((state) => {
    const id = state.session?.user.id ?? null;
    if (id === viewer) return;
    viewer = id;
    sentName = null;
    if (id) scheduleName(NAME_DEBOUNCE_MS);
  });
  useStudyStore.subscribe((curr, prev) => {
    if (curr.preferences === prev.preferences && curr.locked === prev.locked && curr.loading === prev.loading) return;
    if (selectPreferences(curr).displayName !== selectPreferences(prev).displayName || curr.locked !== prev.locked || curr.loading !== prev.loading) {
      scheduleName(NAME_DEBOUNCE_MS);
    }
  });
  if (typeof window !== "undefined") window.addEventListener("online", () => scheduleName(0));
};
