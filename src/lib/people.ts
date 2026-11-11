// Ricerca delle persone e profilo online: regole pure, senza Supabase (le usano peopleSync.ts, i
// componenti e i test). Specchio di supabase/people.sql: stesso formato del @nome, ricerca solo
// esatta (email intera o @nome), errori del server riconosciuti dal testo.

import type { GroupInvite } from "../types";
import { peopleLabels } from "./labels";

/** @nome: minuscolo, 3–24 caratteri tra lettere, cifre, `_` e `.` (check di studyos_profiles.handle). */
export const HANDLE_PATTERN = /^[a-z0-9_.]{3,24}$/;

/** Lunghezza massima del nome visibile (studyos_profiles.display_name, come preferences.displayName). */
export const DISPLAY_NAME_MAX = 60;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Risultato di find_person: mai l'email. */
export type FoundPerson = { personId: string; displayName: string; handle: string | null };

/** Il proprio profilo online (riga di studyos_profiles). */
export type MyProfile = { displayName: string; handle: string | null; discoverable: boolean };

/** Account senza riga di profilo: trovabile, senza nome né @nome (come lo tratta il server). */
export const DEFAULT_PROFILE: MyProfile = { displayName: "", handle: null, discoverable: true };

/** `@Giulia.Rossi ` → `giulia.rossi`; null se non rispetta HANDLE_PATTERN. */
export const normalizeHandle = (raw: string): string | null => {
  const value = raw.trim().replace(/^@/, "").toLowerCase();
  return HANDLE_PATTERN.test(value) ? value : null;
};

/**
 * Cosa cercare: `@` iniziale = @nome; `@` interno = email (senza maiuscole); senza `@`, un @nome
 * valido (molti lo scrivono senza chiocciola). Tutto il resto: null, nessuna richiesta al server.
 */
export const classifyPersonQuery = (raw: string): { kind: "handle"; value: string } | { kind: "email"; value: string } | null => {
  const query = raw.trim();
  if (!query) return null;
  if (!query.startsWith("@") && query.includes("@")) {
    const email = query.toLowerCase();
    return EMAIL_PATTERN.test(email) ? { kind: "email", value: email } : null;
  }
  const handle = normalizeHandle(query);
  return handle ? { kind: "handle", value: handle } : null;
};

/** Testo per find_person: il server cerca il @nome solo con la chiocciola iniziale. */
export const personQueryParam = (query: { kind: "handle" | "email"; value: string }) => (query.kind === "handle" ? `@${query.value}` : query.value);

const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** Riga di find_person → persona; null senza id. Nome e @nome sono dati di un altro: solo testo. */
export const personFromRow = (row: Record<string, unknown> | null | undefined): FoundPerson | null => {
  const personId = textOf(row?.person_id);
  if (!personId) return null;
  return { personId, displayName: textOf(row?.display_name).slice(0, DISPLAY_NAME_MAX), handle: normalizeHandle(textOf(row?.handle)) };
};

/** Riga di studyos_profiles (o nessuna riga) → profilo. */
export const profileFromRow = (row: Record<string, unknown> | null | undefined): MyProfile =>
  row
    ? { displayName: textOf(row.display_name), handle: normalizeHandle(textOf(row.handle)), discoverable: row.discoverable !== false }
    : { ...DEFAULT_PROFILE };

/** Titolo della scheda di una persona: il nome, oppure "Nome non impostato". */
export const personTitle = (person: FoundPerson) => person.displayName || peopleLabels.noName;

/** `@nome` da mostrare, oppure null. */
export const personHandle = (person: FoundPerson) => (person.handle ? `@${person.handle}` : null);

/** Come chiamarla in una frase o in un elenco: nome, altrimenti @nome, altrimenti "una persona". */
export const personName = (person: FoundPerson) => person.displayName || personHandle(person) || peopleLabels.somebody;

// ——— Errori ———

/** Errore con un testo già pronto per l'utente (in italiano): la UI lo mostra com'è. */
export class PeopleUserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeopleUserError";
  }
}

type ServerError = { message: string; code?: string };

/** Rete assente o pezzo dell'app non scaricabile (stessi casi di sharing.ts). */
const NETWORK_ERROR_RE =
  /failed to fetch|networkerror|load failed|network request failed|timed? ?out|timeout|aborted|err_connection|dynamically imported module|importing a module script failed/i;

/** Tabella o funzione assente: supabase/people.sql non è stato eseguito. */
const MISSING_OBJECT_RE = /42P01|42883|PGRST202|PGRST205|does not exist|Could not find the (table|function)/i;

/** Messaggi di supabase/people.sql (raise exception): identici alle etichette, si riconoscono nel testo. */
const SERVER_MESSAGES: readonly string[] = [
  peopleLabels.errors.rateLimited,
  peopleLabels.errors.notFound,
  peopleLabels.errors.alreadyMember,
  peopleLabels.errors.alreadyInvited,
  peopleLabels.errors.notAllowed,
  peopleLabels.errors.self,
  peopleLabels.errors.tooManyInvites,
  peopleLabels.errors.emailInvitesGone
];

/** Testo per un errore del server (ricerca, profilo, inviti all'account): sempre un'etichetta in italiano. */
export const peopleErrorText = (error: ServerError): string => {
  const known = SERVER_MESSAGES.find((message) => error.message.includes(message));
  if (known) return known;
  if (MISSING_OBJECT_RE.test(`${error.code ?? ""} ${error.message}`)) return peopleLabels.errors.unavailable;
  if (NETWORK_ERROR_RE.test(error.message)) return peopleLabels.errors.offline;
  // Indice unico sul @nome; check sul formato (se il controllo del client è stato aggirato).
  if (error.code === "23505" || /duplicate key/i.test(error.message)) return peopleLabels.errors.handleTaken;
  if (error.code === "23514") return peopleLabels.errors.badHandle;
  if (error.code === "42501" || /row-level security|permission denied/i.test(error.message)) return peopleLabels.errors.noPermission;
  // Altre eccezioni scritte in people.sql (raise exception, SQLSTATE P0001): già in italiano.
  return error.code === "P0001" && error.message.trim() ? error.message.trim() : peopleLabels.errors.generic;
};

/** Testo per qualunque errore di un'azione (anche un import() fallito): mai un messaggio tecnico in inglese. */
export const peopleCauseText = (cause: unknown): string => {
  if (cause instanceof PeopleUserError) return cause.message;
  if (cause instanceof Error && NETWORK_ERROR_RE.test(cause.message)) return peopleLabels.errors.offline;
  return peopleLabels.errors.generic;
};

// ——— Inviti ———

/** Invito per email di prima che la migrazione non ha legato a un account: non si può più accettare. */
export const isExpiredEmailInvite = (invite: { status: string; recipientEmail?: string | null; recipientUserId?: string | null }) =>
  invite.status === "pending" && Boolean(invite.recipientEmail) && !invite.recipientUserId;

/** Destinatario di un invito di gruppo nell'elenco di chi l'ha mandato. */
export const groupInviteRecipient = (invite: Pick<GroupInvite, "recipientName" | "recipientEmail" | "recipientUserId" | "code">) =>
  invite.recipientName || invite.recipientEmail || (invite.recipientUserId ? peopleLabels.invitedPerson : peopleLabels.codeInvite(invite.code));

/** Destinatario di un invito di condivisione in "Inviti che hai creato". */
export const shareInviteRecipient = (invite: { recipientEmail: string | null; recipientUserId: string | null }) =>
  invite.recipientEmail || (invite.recipientUserId ? peopleLabels.sentToPerson : peopleLabels.withLink);

/**
 * Lega agli inviti locali l'account destinatario arrivato dal server, anche se la riga non ha
 * cambiato data (la migrazione di people.sql lega gli inviti per email). Non toglie mai un legame e
 * conserva il nome salvato da chi ha invitato. Stesso array se non cambia nulla.
 */
export const bindInviteRecipients = (local: GroupInvite[], server: readonly GroupInvite[]): GroupInvite[] => {
  const bound = new Map<string, string>();
  for (const invite of server) if (invite.recipientUserId) bound.set(invite.id, invite.recipientUserId);
  if (!bound.size) return local;
  let changed = false;
  const next = local.map((invite) => {
    const recipientUserId = bound.get(invite.id);
    if (!recipientUserId || invite.recipientUserId === recipientUserId) return invite;
    changed = true;
    return { ...invite, recipientUserId };
  });
  return changed ? next : local;
};
