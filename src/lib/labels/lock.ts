// Schermata di blocco (password dell'app).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

/** Com'è il dispositivo rispetto all'account: decide come si riavranno i dati dopo la cancellazione. */
export type LockAccount = "signed-in" | "signed-out" | "none";

/** Senza account configurato nell'app non si promette nulla dall'account. */
export const lockAccountOf = (cloudConfigured: boolean, signedIn: boolean): LockAccount =>
  !cloudConfigured ? "none" : signedIn ? "signed-in" : "signed-out";

const BACKUP_LINE = "Se hai scaricato una copia di sicurezza, ripristinala da Impostazioni → Copia di sicurezza.";

/**
 * «Ho dimenticato la password»: la cancellazione resta su questo dispositivo (mai nell'account).
 * Con l'account collegato la sessione resta: la sincronizzazione riparte da zero e riscarica tutto.
 * Le modifiche ancora in coda per l'account vengono cancellate con il resto.
 */
export const LOCK_TEXT = {
  forgot: "Ho dimenticato la password",
  title: "Hai dimenticato la password?",
  erase:
    "La password non si può recuperare. Puoi ripartire da zero: cancelliamo tutto quello che StudyOS ha salvato su questo dispositivo e togliamo la password. Restano solo le scelte di aspetto. Non si può annullare.",
  recoveryTitle: "Come riavere i tuoi dati",
  recovery: (account: LockAccount): string[] => {
    if (account === "signed-in")
      return [
        "Sei collegato a un account StudyOS: i dati nell'account restano come sono e tornano da soli su questo dispositivo appena c'è connessione. Le modifiche fatte qui e non ancora arrivate nell'account vanno perse.",
        BACKUP_LINE
      ];
    if (account === "signed-out")
      return [
        "Se hai un account StudyOS, dopo accedi da Impostazioni → Account: i dati salvati nell'account tornano su questo dispositivo.",
        BACKUP_LINE
      ];
    return [BACKUP_LINE];
  },
  confirm: "Cancella i dati di questo dispositivo",
  busy: "Cancellazione…",
  cancel: "Annulla",
  failed: "Cancellazione non riuscita. Riprova."
} as const;
