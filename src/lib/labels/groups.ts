// Testi della sezione Gruppi che si caricano con la schermata (le etichette condivise sono in ../labels).

/** «Nuovo gruppo» e «Aggiungi alla bacheca»: chiudere con qualcosa di scritto chiede prima. */
export const GROUP_FORM_TEXT = {
  createEyebrow: "Nuovo gruppo",
  createTitle: "Con chi studi?",
  resourceEyebrow: (group: string) => `Bacheca · ${group}`,
  resourceTitle: "Cosa vuoi condividere?",
  unsavedTitle: "Scartare le modifiche?",
  unsavedCreateText: "Hai scritto il nome o la descrizione del gruppo senza crearlo.",
  unsavedResourceText: "Hai scritto qualcosa per la bacheca senza aggiungerlo.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche"
} as const;

/**
 * Esiti delle azioni sui gruppi condivisi. Prima un errore di rete diventava un «fatto» solo su questo
 * dispositivo (invito accettato in locale, gruppo eliminato solo qui): ora si dice che non è riuscito.
 */
export const GROUP_SYNC_TEXT = {
  welcome: (group: string) => `Benvenuto in "${group}".`,
  declined: "Invito rifiutato.",
  alreadyAnswered: "Hai già risposto a questo invito da un altro dispositivo.",
  alreadyMember: (group: string) => `Sei già nel gruppo "${group}".`,
  inviteGone: "Questo invito non esiste più: il gruppo è stato eliminato o l'invito ritirato.",
  otherAccount: "Questo invito è per un altro account. Se è un vecchio invito per email, chiedine uno nuovo.",
  offlineAnswer: "Il server dei gruppi non risponde: l'invito resta in attesa. Controlla la connessione e riprova.",
  needsAccount: "Accedi al tuo account per rispondere all'invito.",
  offlineAction: "Non riuscito: il server dei gruppi non risponde. Controlla la connessione e riprova.",
  pinFailed: "Fissaggio non riuscito: controlla la connessione e riprova.",
  deleteResourceFailed: "Eliminazione non riuscita: controlla la connessione e riprova.",
  roleFailed: (name: string) => `Ruolo di ${name} non cambiato: controlla la connessione e riprova.`,
  removeFailed: (name: string) => `${name} non è stato tolto dal gruppo: controlla la connessione e riprova.`,
  leaveFailed: "Uscita non riuscita: sei ancora nel gruppo. Controlla la connessione e riprova.",
  deleteGroupFailed: "Il gruppo non è stato eliminato: controlla la connessione e riprova.",
  removedMember: (name: string) => `${name} non fa più parte del gruppo.`,
  notPublished: "Non ancora condiviso: partirà appena il server risponde.",
  nameTooLong: "Nome troppo lungo: il server accetta al massimo 120 caratteri, quindi questo gruppo non è online e gli inviti non funzionano. Per invitare altre persone crea un nuovo gruppo con un nome più corto."
} as const;

/** Modifica degli annunci della bacheca, versioni precedenti e ripristino. */
export const GROUP_BOARD_TEXT = {
  edit: "Modifica",
  editAria: (title: string) => `Modifica "${title}"`,
  editTitle: "Modifica l'annuncio",
  editNote: "La versione attuale resterà tra le versioni precedenti e gli altri membri riceveranno un avviso.",
  save: "Salva le modifiche",
  saving: "Salvo…",
  unsavedEditText: "Hai cambiato l'annuncio senza salvare.",
  editedBy: (name: string, when: string) => `modificato da ${name}${when ? `, ${when}` : ""}`,
  showHistory: (count: number) => `Versioni precedenti · ${count}`,
  hideHistory: "Nascondi versioni",
  historyHeading: (name: string, when: string) => `Prima della modifica di ${name}${when ? ` · ${when}` : ""}`,
  historyChanged: (changes: string) => `Cambiati: ${changes}`,
  restore: "Ripristina questa versione",
  restoreAria: (title: string) => `Ripristina la versione "${title}"`,
  restored: "Versione ripristinata.",
  alreadySame: "L'annuncio è già uguale a questa versione.",
  missingTitle: "Scrivi un titolo per continuare.",
  missingLink: "Incolla il link da condividere.",
  gone: "Questo annuncio non è più in bacheca.",
  goneOrLeft: "Questo annuncio non è più in bacheca, oppure non fai più parte del gruppo.",
  denied: "Puoi modificare solo i tuoi annunci, a meno che tu sia proprietario o amministratore del gruppo.",
  failed: "Non è stato possibile salvare la modifica. Controlla la connessione e riprova.",
  activityEdited: (title: string) => `ha modificato "${title}"`,
  activityRestored: (title: string) => `ha ripristinato una versione precedente di "${title}"`
} as const;
