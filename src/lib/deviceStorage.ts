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
  // Segreto di questo browser per le revoche (va con la chiave: un dispositivo svuotato riparte da capo).
  "studyos-agent-secret",
  GETTING_STARTED_HIDDEN_KEY,
  // Promemoria degli eventi già mostrati.
  "studyos-event-reminders-fired"
] as const;

// Restano l'email in attesa di conferma e gli inviti (gruppo, condivisione) aperti prima di accedere:
// sono passi in corso dell'accesso, non dati del profilo. Cambiando account con «sostituisci»
// (cloudSync bindUser → resetAllData) un invito appena aperto non deve sparire prima di essere usato.

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
