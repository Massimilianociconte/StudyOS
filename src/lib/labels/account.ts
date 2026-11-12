// Testi del pannello Account (Impostazioni, Condividi, inviti) e del cambio di account.

export const ACCOUNT_TEXT = {
  leaveTitle: "Uscire dall'account?",
  leaveText: "Esci solo da questo dispositivo: gli altri restano collegati.",
  leaveKeep: "Esci e tieni i dati qui",
  leaveKeepHint: "Tieni i dati qui: restano su questo dispositivo, ma le modifiche non arrivano più all'account.",
  leaveRemove: "Esci e togli i dati da qui",
  leaveRemoveHint: "Togli i dati da qui: per un dispositivo non tuo. Nell'account restano tutti e tornano quando accedi di nuovo.",
  leavePending: (count: number) =>
    count === 1
      ? "1 modifica non è ancora nell'account: premi «Sincronizza ora» qui sotto prima di togliere i dati da qui."
      : `${count} modifiche non sono ancora nell'account: premi «Sincronizza ora» qui sotto prima di togliere i dati da qui.`,
  leaveSyncNow: "Sincronizza ora",
  leaveCancel: "Annulla",
  leftKeep: "Sei uscito dall'account. I dati restano su questo dispositivo.",
  leftOffline: "Server non raggiungibile: sei uscito solo su questo dispositivo. Ricarico la pagina…",
  leaveFailed: "Uscita non riuscita. Riprova.",
  /**
   * Accesso con un altro account su un dispositivo con dati: domanda nel pannello, non una finestra del
   * browser. Finché non si sceglie la sincronizzazione aspetta; unire richiede il suo pulsante.
   */
  switchTitle: "Su questo dispositivo ci sono i dati di un altro account",
  switchText: "Scegli cosa fare. Finché non scegli, la sincronizzazione aspetta e niente passa da un account all'altro.",
  switchSeparate: "Mostra solo i dati di questo account",
  switchSeparateHint: "Consigliato. I dati di prima restano nel loro account: li ritrovi accedendo di nuovo con quello.",
  switchMerge: "Aggiungi i dati di prima a questo account",
  switchMergeHint: "Materie, eventi, attività e note di prima vanno anche in questo account. Nome, foto e preferenze restano quelli di questo account."
} as const;
