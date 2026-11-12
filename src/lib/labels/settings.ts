// Testi della sezione Impostazioni: elenco delle categorie, riepiloghi e domande sul posto.
import type { SettingsSection } from "../settingsJump";

export const SETTINGS_TEXT = {
  title: "Impostazioni",
  subtitle: "Scegli una categoria: accanto a ognuna vedi com'è impostata adesso.",
  listLabel: "Categorie di impostazioni",
  back: "Impostazioni",
  backLabel: "Torna all'elenco delle impostazioni",
  groups: {
    you: "Tu",
    account: "Account e assistenti",
    device: "Questo dispositivo",
    data: "I tuoi dati"
  },
  titles: {
    profilo: "Profilo e obiettivi",
    account: "Account e sincronizzazione",
    agenti: "Agenti AI",
    aspetto: "Aspetto e avvio",
    privacy: "Password dell'app",
    backup: "Copia di sicurezza",
    dati: "Spazio e dati"
  } satisfies Record<SettingsSection, string>,
  descriptions: {
    profilo: "Il tuo nome, la foto, il corso e quanto vuoi studiare. Con l'account li ritrovi su ogni dispositivo.",
    account: "Accedi, controlla la sincronizzazione tra i dispositivi o esci dall'account.",
    agenti: "Collega ChatGPT, Claude o un altro assistente AI: potrà leggere il tuo studio e, se lo permetti, aggiornarlo con la tua conferma.",
    aspetto: "Tema, colori e la sezione che si apre all'avvio. Valgono solo su questo dispositivo.",
    privacy: "Chiedi una password ogni volta che StudyOS si apre su questo dispositivo.",
    backup: "Salva i tuoi dati in un file, per ripristinarli qui o su un altro dispositivo.",
    dati: "Quanti elementi hai su questo dispositivo e, solo se serve davvero, come ripartire da zero."
  } satisfies Record<SettingsSection, string>,
  summaries: {
    noName: "Nome non ancora scelto",
    signedIn: (email: string) => `Connesso come ${email}`,
    signedOut: "Non connesso: i dati sono solo qui",
    cloudOff: "Non disponibile in questa versione",
    agents: "ChatGPT, Claude e altri assistenti",
    vaultOn: "Attiva: chiede la password all'apertura",
    vaultOff: "Non attiva",
    backup: "Scarica o ripristina un file con i tuoi dati",
    data: (subjects: number, tasks: number, events: number) =>
      `${subjects} ${subjects === 1 ? "materia" : "materie"} · ${tasks} attività · ${events} ${events === 1 ? "evento" : "eventi"}`
  },
  profile: {
    hello: (name: string) => `Ciao, ${name}.`,
    whoTitle: "Chi sei",
    studyTitle: "Corso e obiettivi"
  },
  appearance: {
    comfortTitle: "Spazio e avvio",
    /** Solo se la guida «Per iniziare» della Home è stata nascosta e ha ancora passi da fare. */
    guideHint: "Hai nascosto la guida «Per iniziare» della Home.",
    /** Corto: sui telefoni il pulsante sta su una riga (la frase sopra dice già «della Home»). */
    guideShow: "Mostra di nuovo la guida",
    guideShown: "Fatto: la guida «Per iniziare» è di nuovo nella Home."
  },
  backup: {
    downloadTitle: "Scarica una copia",
    restoreTitle: "Ripristina da una copia",
    restoreAskTitle: (day: string) => `Sostituire tutti i dati con la copia del ${day}?`,
    restoreAskText: (summary: string) => `Nella copia: ${summary}. I dati attuali verranno cancellati e non si potrà annullare.`,
    restoreAskCloud: "La sostituzione arriverà anche al tuo account e agli altri dispositivi collegati.",
    restoreConfirm: "Sostituisci tutti i dati",
    cancel: "Annulla",
    /** La copia completa porta anche i file dei materiali; quelli che ora non si possono avere restano fuori. */
    filesMissing: (count: number) =>
      count === 1
        ? " Un file dei materiali non è incluso: non è su questo dispositivo e ora non si può scaricare. Riprova online per averlo nella copia."
        : ` ${count} file dei materiali non sono inclusi: non sono su questo dispositivo e ora non si possono scaricare. Riprova online per averli nella copia.`,
    /** La copia porta al massimo 100 MB di file (BACKUP_FILES_LIMIT_BYTES): gli altri restano fuori. */
    filesOverLimit: (count: number) =>
      count === 1
        ? " Un file dei materiali non è incluso: la copia porta al massimo 100 MB di file. Resta nel tuo account o su questo dispositivo, e puoi scaricarlo dalla scheda del materiale."
        : ` ${count} file dei materiali non sono inclusi: la copia porta al massimo 100 MB di file. Restano nel tuo account o su questo dispositivo, e puoi scaricarli dalla scheda di ogni materiale.`,
    /** I file non si sono potuti aggiungere (memoria, errore): la copia è stata scaricata senza. */
    filesLeftOut:
      " La copia non contiene i file dei materiali: non è stato possibile aggiungerli. Restano nel tuo account o su questo dispositivo, e puoi scaricarli dalla scheda di ogni materiale."
  },
  erase: {
    askTitle: "Cancellare tutti i dati?",
    askText: "Materie, esami, attività, eventi, allegati e profilo spariscono da questo dispositivo (restano solo le scelte di aspetto), la password dell'app viene tolta e le notifiche su questo dispositivo si spengono. Non si può annullare: se non hai una copia di sicurezza, premi Annulla e scaricala prima.",
    askSignedIn: "Sei collegato al tuo account: scegli se svuotare solo questo dispositivo o cancellare anche dall'account.",
    deviceOnly: "Svuota solo questo dispositivo",
    deviceOnlyHint: "Svuota solo questo dispositivo: i dati restano nell'account e vengono riscaricati.",
    alsoCloud: "Cancella anche dall'account",
    alsoCloudHint:
      "Cancella anche dall'account: spariscono anche dagli altri dispositivi collegati, insieme a nome e @nome del profilo online, alle tue condivisioni e al connettore remoto degli assistenti. Restano i gruppi e ciò che altri condividono con te. Non si può annullare.",
    confirmLocal: "Cancella tutti i dati",
    cancel: "Annulla",
    accountUnreachable:
      "Dati cancellati da questo dispositivo. L'account non ha risposto: ciò che c'era qui sparirà anche dall'account quando la sincronizzazione riprende, il resto no. Ripeti «Cancella anche dall'account» quando sei online.",
    /** Aggiunta al messaggio: i file dei materiali nell'account si cancellano alla prossima occasione. */
    filesPending: " I file dei materiali spariranno dall'account appena StudyOS riesce a collegarsi."
  }
} as const;
