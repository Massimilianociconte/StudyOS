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
  switchMergeHint: "Materie, eventi, attività e note di prima vanno anche in questo account. Nome, foto e preferenze restano quelli di questo account.",
  /** «Mostra solo» con modifiche fatte mentre la domanda era aperta: si perderebbero (P6). */
  switchEditedWhileAsked: (count: number) =>
    count === 1
      ? "Mentre sceglievi hai cambiato 1 elemento: non è nell'account di prima e togliendo i dati da qui andrebbe perso. Per tenerlo scegli «Aggiungi i dati di prima a questo account», oppure esci, accedi con l'account di prima e aspetta che si sincronizzi."
      : `Mentre sceglievi hai cambiato ${count} elementi: non sono nell'account di prima e togliendo i dati da qui andrebbero persi. Per tenerli scegli «Aggiungi i dati di prima a questo account», oppure esci, accedi con l'account di prima e aspetta che si sincronizzi.`,
  /** Cambio account fermo: elementi mai arrivati all'account precedente perché troppo grandi (P12). */
  switchStuck: (count: number) =>
    count === 1
      ? "Prima di cambiare account: 1 elemento di questo dispositivo è troppo grande e non è mai arrivato all'account di prima. Qui sotto puoi scaricarne una copia o toglierlo dalla coda."
      : `Prima di cambiare account: ${count} elementi di questo dispositivo sono troppo grandi e non sono mai arrivati all'account di prima. Qui sotto puoi scaricarne una copia o toglierli dalla coda.`,
  /** Elementi oltre il limite di un invio al cloud: restano solo qui (stuckOutbox.ts). */
  stuckTitle: "Elementi che non arrivano all'account",
  stuckText: (count: number, limitKb: number) =>
    count === 1
      ? `1 elemento è troppo grande per l'account (limite ${limitKb} KB) e resta solo su questo dispositivo.`
      : `${count} elementi sono troppo grandi per l'account (limite ${limitKb} KB) e restano solo su questo dispositivo.`,
  stuckFix: "Per farli arrivare all'account, sostituisci gli allegati più grandi con un link.",
  stuckBlocks: "Finché sono in coda non puoi cambiare account né togliere i dati da qui: prima scaricane una copia o toglili dalla coda.",
  stuckUntitled: "Senza titolo",
  stuckNotHere: "non più su questo dispositivo",
  stuckDownload: "Scarica una copia",
  stuckDownloaded: "Copia scaricata. Per riaverli, ripristinala da Impostazioni › Copia di sicurezza.",
  stuckCopyPlain: "La copia non è protetta da password: conservala in un posto sicuro.",
  stuckDiscard: "Togli dalla coda",
  stuckDiscardWarning:
    "Restano solo su questo dispositivo e non arriveranno all'account. Se poi togli i dati da qui o cambi account, si perdono: scarica prima una copia.",
  stuckDiscardConfirm: "Sì, togli dalla coda",
  stuckDiscardCancel: "Annulla",
  stuckDiscarded: "Tolti dalla coda: restano solo su questo dispositivo.",
  stuckFailed: "Operazione non riuscita. Riprova."
} as const;
