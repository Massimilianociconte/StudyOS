// Guida a importazione ed esportazione del calendario (components/CalendarTransfer, lib/calendarGuide).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

/** Giorni che in italiano vogliono l'apostrofo: «l'8 nov», «dall'11 nov» (la data comincia con il giorno). */
const elides = (date: string) => /^(8|11)\b/.test(date);

export const CALENDAR_GUIDE_TEXT = {
  menuItem: "Importa o esporta",
  eyebrow: "Calendario",
  title: "Importa o esporta",
  honesty:
    "È una copia in un file .ics, non un collegamento: quello che cambi dopo non passa da solo da un'app all'altra, quindi quando serve ripeti l'esportazione o l'importazione. Una nuova importazione aggiunge e aggiorna gli eventi ma non ne toglie: un evento eliminato nell'altra app resta in StudyOS, eliminalo anche qui (e viceversa).",
  directionQuestion: "Cosa vuoi fare?",
  /** Scorciatoie della prima schermata, per chi sa già cosa fare (la guida resta sotto). */
  shortcutsTitle: "Sai già come fare?",
  shortcutDownload: "Scarica il file .ics",
  shortcutChooseFile: "Ho già il file",
  direction: {
    export: { title: "Da StudyOS a un'altra app", text: "Porta lezioni, esami e scadenze nel calendario del telefono o del computer." },
    import: { title: "Da un'altra app a StudyOS", text: "Aggiungi qui gli eventi di Google, Apple, Samsung o Outlook." }
  },
  deviceQuestion: "Su quale dispositivo?",
  device: {
    samsung: "Samsung (One UI)",
    android: "Pixel e altri Android",
    ios: "iPhone e iPad",
    windows: "Computer Windows",
    macos: "Mac"
  },
  thisDevice: "Questo dispositivo",
  appQuestion: "Con quale app?",
  app: {
    google: "Google Calendar",
    apple: "Calendario di Apple",
    samsung: "Calendario Samsung",
    outlook: "Outlook"
  },
  otherApp: "La tua app non c'è? Torna indietro e scegli il dispositivo su cui la usi.",
  route: (direction: "export" | "import", app: string, device: string) =>
    direction === "export" ? `Da StudyOS a ${app}, su ${device}` : `Da ${app} a StudyOS, su ${device}`,
  needsComputer: "Serve un computer",
  redirectTitle: "Da qui non si può",
  redirectButton: (app: string, device: string) => `Mostra come fare con ${app} su ${device}`,
  back: "Indietro",
  done: "Fatto",
  download: "Scarica il file",
  share: "Condividi il file",
  downloaded: (fileName: string) => `Scaricato: ${fileName}. Ora segui i passi qui sotto.`,
  /** Scorciatoia del primo passo: sotto non ci sono passi da seguire. */
  downloadedShortcut: (fileName: string) =>
    `Scaricato: ${fileName}. Aprilo con il tuo calendario, oppure scegli dove portarlo per vedere i passi.`,
  loading: "Un momento…",
  chooseFile: "Scegli il file",
  tooBig:
    "Il file è troppo grande (massimo 5 MB). Esporta un calendario alla volta invece di tutti insieme e importali uno per uno. Solo Outlook classico ti fa scegliere anche le date, in «Altre opzioni».",
  unreadable: "Non è stato possibile leggere il file. Riprova o scegli un altro file .ics.",
  empty: (warning?: string) =>
    `Nel file non ci sono eventi da importare.${warning ? ` ${warning}` : ""} Scegli il file .ics esportato dal tuo calendario.`,
  previewSummary: (count: number, recurring: number, changed: number) =>
    `Nel file ${count === 1 ? "c'è 1 evento" : `ci sono ${count} eventi`}${recurring ? ` (${recurring} si ${recurring === 1 ? "ripete" : "ripetono"})` : ""}${
      changed ? `, più ${changed === 1 ? "1 giorno modificato" : `${changed} giorni modificati`} di una serie` : ""
    }.`,
  /** `open`: c'è una serie che non finisce. */
  previewRange: (from: string, to?: string, open = false) => {
    const since = `${elides(from) ? "Dall'" : "Dal "}${from}`;
    if (open) return `${since} in poi.`;
    if (to) return `${since} ${elides(to) ? "all'" : "al "}${to}.`;
    return `${elides(from) ? "L'" : "Il "}${from}.`;
  },
  /** Giorni di una serie modificati a mano che il file scrive in un altro modo: la modifica a mano resta. */
  previewKeptEdits: (count: number) =>
    count === 1 ? "1 giorno che hai modificato a mano resta com'è." : `${count} giorni che hai modificato a mano restano come sono.`,
  previewNoDuplicates:
    "Se importi di nuovo lo stesso calendario, gli eventi già presenti vengono aggiornati, non duplicati. Le modifiche che hai fatto qui restano, tranne dove un avviso qui sotto dice che vengono sostituite.",
  /** Prima reimportazione di un calendario importato con una versione precedente (il luogo era nella descrizione). */
  previewPlaceMoved:
    "Questa volta risultano aggiornati anche gli eventi con un luogo importati con una versione precedente: il luogo passa dalla descrizione al campo Luogo. Succede una volta sola.",
  previewMore: (count: number) => `…e altri ${count}`,
  categoryLabel: "Tipo di evento",
  categoryHint: "Usato quando il titolo non fa capire il tipo (es. «Esame», «Laboratorio»).",
  matchSubjects: (count: number) => `Collega alle mie materie in base al titolo (${count} ${count === 1 ? "riconosciuto" : "riconosciuti"})`,
  warningsTitle: "Da controllare",
  moreWarnings: (count: number) => (count === 1 ? "…e un altro avviso." : `…e altri ${count} avvisi.`),
  /** Pulsante dell'anteprima, con i conti veri dell'unione con il calendario. */
  apply: (added: number, updated: number) => {
    const add = added === 1 ? "Aggiungi 1 evento" : `Aggiungi ${added} eventi`;
    const update = updated === 1 ? "aggiorna 1 evento" : `aggiorna ${updated} eventi`;
    if (added && updated) return `${add}, ${update}`;
    if (added) return add;
    if (updated) return `${update.charAt(0).toUpperCase()}${update.slice(1)}`;
    return "Aggiorna il calendario";
  },
  nothingNew: "Nessuna novità",
  nothingNewHint: "Questo file non cambia niente nel tuo calendario.",
  importFailed: "Non è stato possibile aggiungere gli eventi. Riprova tra poco.",
  resultTitle: "Importazione completata",
  result: (added: number, updated: number) => {
    const parts = [
      added ? `${added} ${added === 1 ? "evento aggiunto" : "eventi aggiunti"}` : "",
      updated ? `${updated} ${updated === 1 ? "evento aggiornato" : "eventi aggiornati"}` : ""
    ].filter(Boolean);
    if (!parts.length) return "Nessuna novità: gli eventi di questo file erano già tutti nel calendario.";
    const them = added + updated === 1 ? "Puoi modificarlo o eliminarlo come gli altri." : "Puoi modificarli o eliminarli come gli altri.";
    return `Fatto: ${parts.join(", ")} nel calendario. ${them}`;
  },
  importAnother: "Importa un altro file"
};

/** Passi della guida (lib/calendarGuide). I nomi dei menu sono scritti in modo da restare veri tra una versione e l'altra. */
export const CALENDAR_GUIDE_STEPS = {
  download: "Scarica il file con il pulsante qui sotto: contiene i tuoi eventi, gli esami e le scadenze.",
  downloadPhone: "Scarica il file con il pulsante qui sotto: il telefono lo salva nella cartella Download.",
  downloadIos: "Scarica il file con il pulsante qui sotto: a seconda della versione, il Calendario lo apre subito oppure finisce nell'app File, nella cartella Download.",
  downloadToComputer: "Scarica il file con il pulsante qui sotto e mandalo al computer, per esempio per email a te stesso.",
  /** Solo con l'accesso fatto e la sincronizzazione attiva (altrimenti StudyOS sul computer ha altri dati). */
  downloadToComputerSynced:
    "Scarica il file con il pulsante qui sotto e mandalo al computer, per esempio per email a te stesso. Oppure, visto che i tuoi dati si sincronizzano con il tuo account, apri StudyOS dal computer, entra con lo stesso account e scaricalo da lì.",
  googleOwnCalendar:
    "Consiglio: crea prima un calendario «StudyOS» in cui importare il file: nel menu a sinistra scegli «Aggiungi calendario», poi «Crea nuovo calendario».",
  /** Lo stesso consiglio per ogni app in cui si può tenere StudyOS in un calendario a parte. */
  startClean:
    "Per ripartire puliti, elimina il calendario «StudyOS» nell'altra app e importa di nuovo il file: una nuova importazione aggiunge e aggiorna gli eventi, ma non toglie quelli che hai eliminato in StudyOS.",
  googleSettings: "Apri calendar.google.com nel browser, fai clic sull'ingranaggio in alto e scegli «Impostazioni».",
  googleOnComputer: "Sul computer apri calendar.google.com nel browser (l'app del telefono non ha questa funzione), fai clic sull'ingranaggio in alto e scegli «Impostazioni».",
  googleImport: "Nel menu a sinistra apri «Importazione ed esportazione», seleziona il file e il calendario in cui aggiungerlo, poi premi «Importa».",
  googleOnPhone: "Dopo qualche minuto gli eventi compaiono anche nell'app Google Calendar del telefono.",
  googleExport:
    "Nel menu a sinistra apri «Importazione ed esportazione» e premi «Esporta»: scarichi un file .zip con un file .ics per ogni calendario. Per un solo calendario, usa «Esporta calendario» nelle sue impostazioni.",
  unzip: "Apri il file .zip ed estrai il file .ics del calendario che ti serve.",
  samsungOpenFile: "Apri l'app «Archivio» (in alcune versioni «I miei file»), vai in «Download» e tocca il file che finisce con .ics.",
  samsungSave:
    "Se il telefono ti fa scegliere con cosa aprirlo, scegli «Calendario»: controlla gli eventi, scegli in quale calendario metterli (se ne hai uno Google «StudyOS», quello) e salva.",
  samsungViaGoogle:
    "Se il file non si apre con il Calendario, importalo dal computer su calendar.google.com, in un calendario «StudyOS» dell'account Google collegato al telefono: dopo qualche minuto gli eventi compaiono anche nel Calendario Samsung.",
  iosOpenFile: "Se il Calendario non si è aperto, apri l'app «File», vai in «Download» e tocca il file che finisce con .ics.",
  iosNewCalendar: "Consiglio: prima crea un calendario «StudyOS» in cui mettere gli eventi: nell'app Calendario tocca «Calendari», poi «Aggiungi calendario».",
  iosAddAll: "Nell'anteprima del Calendario tocca «Aggiungi tutti» e scegli il calendario (meglio «StudyOS», se l'hai creato).",
  macNewCalendar: "Consiglio: prima crea un calendario «StudyOS» in cui mettere gli eventi: nell'app Calendario usa «File», poi «Nuovo calendario».",
  macOpen: "Fai doppio clic sul file scaricato, oppure nell'app Calendario usa «File», poi «Importa…».",
  macPick: "Scegli il calendario in cui aggiungere gli eventi (meglio «StudyOS», se l'hai creato).",
  macSelect: "Nell'app Calendario seleziona, nella colonna a sinistra, il calendario da portare in StudyOS.",
  macExport: "Usa «File», poi «Esporta», poi «Esporta…» e salva il file .ics. Non scegliere «Archivio Calendario»: è un altro formato.",
  outlookClassicImport:
    "Outlook classico: «File», poi «Apri ed esporta», poi «Importa/Esporta», e scegli di importare un file iCalendar (.ics). Quando te lo chiede, scegli «Apri come nuovo»: gli eventi vanno in un calendario a parte.",
  outlookWebImport:
    "Nuovo Outlook o outlook.com: nel Calendario premi «Aggiungi calendario», poi «Carica da file», e scegli il file e il calendario: meglio uno nuovo, «StudyOS», che crei dallo stesso «Aggiungi calendario».",
  outlookOnComputer:
    "Sul computer apri outlook.com nel browser: nel Calendario premi «Aggiungi calendario», poi «Carica da file», e scegli il file e il calendario: meglio uno nuovo, «StudyOS», che crei dallo stesso «Aggiungi calendario».",
  outlookOnPhone: "Gli eventi compaiono anche nell'app Outlook, sul computer e sul telefono, con lo stesso account.",
  outlookSave: "Outlook classico: seleziona il calendario, poi «File» e «Salva calendario». In «Altre opzioni» scegli le date e «Dettagli completi».",
  outlookNoFile: "Il nuovo Outlook e outlook.com non salvano il calendario in un file: se lo stesso calendario è anche su Google, esportalo da calendar.google.com.",
  chooseFile: "Torna qui e premi «Scegli il file»: prima di aggiungere qualcosa vedrai un'anteprima.",
  chooseFileFromComputer:
    "Porta il file .ics su questo dispositivo (per esempio per email a te stesso) e tocca «Scegli il file». Prima di aggiungere vedrai un'anteprima.",
  /** Solo con la sincronizzazione attiva: importato dal computer, arriva anche qui. */
  chooseFileFromComputerSynced:
    "Porta il file .ics su questo dispositivo (per esempio per email a te stesso) e tocca «Scegli il file», oppure apri StudyOS dal computer con lo stesso account e importalo lì: i dati si sincronizzano. Prima di aggiungere vedrai un'anteprima."
};

/** Perché una combinazione non si fa da quel dispositivo, e dove si fa. */
export const CALENDAR_GUIDE_REDIRECT = {
  appleOnlyApple: "Il Calendario di Apple c'è solo su iPhone, iPad e Mac: segui i passi da uno di questi.",
  appleIosNoFile:
    "Il Calendario di iPhone e iPad non salva i calendari in un file. Serve un Mac con lo stesso account iCloud: da lì esporti il calendario e poi lo scegli in StudyOS.",
  appleOnlyMac: "Solo il Calendario del Mac salva i calendari in un file .ics: segui i passi dal Mac.",
  samsungOnlySamsung: "Il Calendario Samsung c'è solo sui telefoni e tablet Samsung: segui i passi da lì.",
  samsungNoFile:
    "Il Calendario Samsung non salva i calendari in un file. Se i tuoi eventi sono in un account Google collegato al telefono, esportali da calendar.google.com. Quelli salvati solo sul telefono o nell'account Samsung non si possono portare in un file.",
  outlookOnlyWindows: "Solo Outlook classico per Windows salva il calendario in un file .ics: le app per telefono, per Mac e outlook.com non lo fanno."
};
