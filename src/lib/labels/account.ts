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
   * Accesso con un altro account su un dispositivo con dati: OK = solo i dati del nuovo account
   * (la scelta sicura: quelli di prima sono già nel loro account), Annulla = unisci.
   */
  switchConfirm:
    "I dati su questo dispositivo sono di un altro account.\n\nOK = mostra solo i dati del nuovo account (consigliato: quelli di prima restano nel loro account)\nAnnulla = aggiungi i dati di prima al nuovo account (nome, foto e preferenze restano quelli del nuovo account)"
} as const;
