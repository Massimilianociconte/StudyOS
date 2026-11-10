// Quando chi riceve confronta la cache con gli id ancora visibili sul server (revoche, filtri cambiati,
// elementi usciti da un filtro). Costa una lettura di tutti gli id, quindi non a ogni segnale Realtime:
// al controllo dei 5 minuti, al ritorno sulla scheda se l'ultimo controllo completo è più vecchio,
// e per un proprietario quando i suoi permessi cambiano. Senza I/O: shareSync.ts la usa, i test la provano.

export interface RecheckCadence {
  /** Il prossimo passaggio ricontrolla tutti i proprietari (controllo dei 5 minuti). */
  requestFull: () => void;
  /** Ritorno sulla scheda: un controllo completo se l'ultimo è più vecchio del periodo. */
  resumed: (now: number) => void;
  /** All'inizio di una passata: se ricontrollare tutti (una volta: la richiesta si consuma). */
  take: () => boolean;
  /** Ricontrollo per questo proprietario: in un controllo completo, o se i suoi permessi sono cambiati. */
  needs: (ownerId: string, sig: string, full: boolean) => boolean;
  /** Proprietario ricontrollato con questi permessi. */
  checked: (ownerId: string, sig: string) => void;
  /** Via i proprietari che non condividono più nulla: se ricondividono, si ricontrolla da capo. */
  keep: (owners: ReadonlySet<string>) => void;
  /** Passata riuscita: se ha ricontrollato tutti, conta come controllo completo. */
  passDone: (allChecked: boolean, now: number) => void;
  /** Passata non riuscita: un controllo completo si ripete alla prossima. */
  passFailed: (full: boolean) => void;
  /** Cambio di chi guarda: tutto da capo. */
  reset: () => void;
}

export const createRecheckCadence = (periodMs: number): RecheckCadence => {
  let due = false;
  /** Ultimo controllo completo riuscito (0: mai, per chi guarda ora). */
  let lastFull = 0;
  /** Firma dei permessi con cui ogni proprietario è stato ricontrollato l'ultima volta (in memoria). */
  const checked = new Map<string, string>();
  return {
    requestFull: () => {
      due = true;
    },
    resumed: (now) => {
      if (now - lastFull >= periodMs) due = true;
    },
    take: () => {
      const full = due;
      due = false;
      return full;
    },
    needs: (ownerId, sig, full) => full || checked.get(ownerId) !== sig,
    checked: (ownerId, sig) => {
      checked.set(ownerId, sig);
    },
    keep: (owners) => {
      for (const ownerId of [...checked.keys()]) if (!owners.has(ownerId)) checked.delete(ownerId);
    },
    passDone: (allChecked, now) => {
      if (allChecked) lastFull = now;
    },
    passFailed: (full) => {
      if (full) due = true;
    },
    reset: () => {
      checked.clear();
      lastFull = 0;
    }
  };
};
