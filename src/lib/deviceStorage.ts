// «Cancella tutti i dati» (Impostazioni e «Ho dimenticato la password»): oltre al database StudyOS
// salva alcune cose nel localStorage. Queste parlano del profilo e vanno via con il resto. Restano
// l'aspetto (nelle impostazioni), la sessione dell'account (la toglie solo l'uscita dall'account),
// l'id casuale del browser per gli agenti e le chiavi tecniche. Il timer di studio lo azzera lo store;
// filtri ed elementi aperti (studyos-ui) li toglie clearUiState.

/** «Nascondi la guida» nella Home. */
export const GETTING_STARTED_HIDDEN_KEY = "studyos-getting-started-hidden";

export const PROFILE_STORAGE_KEYS = [
  // Collegamento con gli agenti: chiave, permessi scelti, registro delle azioni, indirizzo dell'hub.
  "studyos-agent-token",
  "studyos-agent-policy",
  "studyos-agent-audit",
  "studyos-agent-hub",
  GETTING_STARTED_HIDDEN_KEY,
  // Promemoria degli eventi già mostrati.
  "studyos-event-reminders-fired",
  // Email in attesa di conferma; inviti a un gruppo o a una condivisione aperti prima di accedere.
  "studyos-pending-confirmation-email",
  "studyos-pending-invite",
  "studyos-pending-share"
] as const;

type KeyStorage = Pick<Storage, "removeItem">;

const browserStorage = (): KeyStorage | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

export const clearProfileStorage = (storage: KeyStorage | null = browserStorage()) => {
  for (const key of PROFILE_STORAGE_KEYS) {
    try {
      storage?.removeItem(key);
    } catch {
      // storage non disponibile
    }
  }
};
