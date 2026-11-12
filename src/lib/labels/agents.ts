// Impostazioni → Agenti AI: collegamento di ChatGPT o Claude, connettore remoto, revoche.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

const assistants = (count: number) => (count === 1 ? "1 assistente" : `${count} assistenti`);
const links = (count: number) => (count === 1 ? "1 collegamento" : `${count} collegamenti`);

export const AGENT_DESK_TEXT = {
  /** Un solo stato, calmo finché la persona non ha provato a collegarsi. */
  status: {
    notYet: "Non ancora collegato",
    connected: "Collegato",
    unreachable: "Collegamento non raggiungibile",
    checking: "Controllo in corso…"
  },

  connectTitle: "Collega ChatGPT o Claude",
  keyLabel: "Chiave di collegamento",
  codeLabel: "Codice di collegamento",
  keyPlaceholder: "Incolla qui la chiave",
  codePlaceholder: "Es. ABCD-EFGH",
  pairButton: "Collega questo browser",
  /** Da dove arriva la chiave, in parole semplici. */
  keyHelp:
    "La chiave te la dà chi gestisce StudyOS (chi ha messo online il collegamento per gli assistenti): è la stessa per tutte le persone che lo usano. Incollala una volta sola: resta salvata in questo browser, anche sul telefono.",
  addressIntro: "ChatGPT o Claude: aggiungi un connettore con questo indirizzo. La richiesta di accesso compare qui, da confermare.",
  pairedHint: "Tieni StudyOS aperto, anche dal telefono, mentre l'assistente lavora: i dati restano in questo browser.",
  disconnectBrowser: "Scollega questo browser",
  copy: "Copia",
  copied: "Indirizzo copiato.",
  copyFailed: "Copia non riuscita: tieni premuto sull'indirizzo e copialo a mano.",

  remote: {
    title: "Connettore remoto (app chiusa)",
    what: "Fa lavorare ChatGPT o Claude sui dati del tuo account salvati nel cloud, anche quando StudyOS è chiuso.",
    noConfirm:
      "Non ti chiede conferma nell'app: modifiche ed eliminazioni partono subito, con i permessi che scegli la prima volta con «Consenti».",
    howTo:
      "ChatGPT o Claude: aggiungi un connettore con questo indirizzo. La prima volta la richiesta di accesso compare qui, e serve l'accesso al tuo account (Impostazioni → Account e sincronizzazione).",
    pairFirst: "Prima collega questo browser qui sopra: la richiesta di accesso arriva qui.",
    noName: "Per avere il tuo indirizzo scrivi il tuo nome nel profilo: l'indirizzo finisce con /u/il-tuo-nome/mcp.",
    noHub: "L'indirizzo compare quando apri StudyOS dal sito pubblicato. In questa finestra di sviluppo il connettore remoto non si usa.",
    off: "Su questo collegamento il connettore remoto non è ancora attivo: chiedi a chi gestisce StudyOS di attivarlo.",
    revoke: "Scollega il connettore remoto",
    revoked:
      "Connettore remoto scollegato: gli assistenti non possono più usare questo account con l'app chiusa. Per ricollegarlo serve un nuovo «Consenti».",
    none: "Nessun connettore remoto risultava collegato a questo account."
  },

  revokeButton: "Revoca gli accessi che hai dato",
  revokeAllButton: "Scollega gli assistenti di tutti",
  revokeAllConfirm:
    "Scollega gli assistenti di tutte le persone che usano questo connettore, non solo i tuoi. Ognuno dovrà togliere il connettore StudyOS in ChatGPT o Claude e aggiungerlo di nuovo.",
  revokeAllConfirmLabel: "Scollega tutti",

  /** Esito di «Revoca gli accessi che hai dato». */
  revokedMine: (count: number) =>
    count > 0
      ? `Hai tolto l'accesso a ${assistants(count)} che avevi autorizzato tu. Gli assistenti delle altre persone restano collegati.`
      : "Nessun assistente risultava autorizzato da questo account.",
  /** Accessi dati prima della 1.6.0 dell'hub: non dicono chi li ha autorizzati. */
  revokedLegacy: (count: number, allButton: string) =>
    count === 1
      ? `${links(count)} di prima dell'aggiornamento non dice chi l'ha autorizzato e resta attivo. Se era tuo, usa «${allButton}»: scollega anche gli assistenti delle altre persone.`
      : `${links(count)} di prima dell'aggiornamento non dicono chi li ha autorizzati e restano attivi. Se erano tuoi, usa «${allButton}»: scollega anche gli assistenti delle altre persone.`,
  revokedAll:
    "Tutti gli assistenti sono scollegati, anche quelli delle altre persone che usano questo connettore. Per ricollegarne uno, toglilo e aggiungilo di nuovo in ChatGPT o Claude.",
  browserStays: "Questo browser resta collegato.",
  /** Revoca senza browser collegato e senza permessi remoti da togliere. */
  pairFirst: (local: boolean) =>
    local
      ? "Collega prima questo browser con il codice che compare nel terminale (npm run agent)."
      : "Collega prima questo browser con la chiave di collegamento.",

  advanced: "Avanzate",
  advancedHint: "Regole di conferma, modifiche senza conferma per 15 minuti, più persone, ultime azioni.",
  rulesTitle: "Cosa può fare un assistente",
  rulesBody:
    "Con «Collega ChatGPT o Claude» l'assistente all'inizio può leggere liberamente e ti chiede conferma per tutto il resto. Solo tu puoi cambiare queste regole, non l'assistente. Con «Consenti» sulle eliminazioni, cancella senza chiederti nulla: sceglilo solo se lo vuoi davvero. Condividere i tuoi dati con altre persone, o cambiare una condivisione, chiede sempre la tua conferma. Il connettore remoto non segue queste regole: non chiede conferme.",
  trustWrites: "Consenti le modifiche per 15 minuti",
  trustBack: "Torna a chiedere conferma",
  trustedUntil: (time: string) =>
    `Modifiche senza conferma fino alle ${time}. Le eliminazioni e le condivisioni chiedono ancora conferma.`,
  activityTitle: "Ultime azioni",
  activityEmpty: "Ancora nessuna azione. Qui vedrai cosa fanno gli assistenti; l'elenco resta solo in questo browser."
} as const;
