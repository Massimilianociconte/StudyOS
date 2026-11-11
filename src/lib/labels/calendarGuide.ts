// Guida a importazione ed esportazione del calendario (components/CalendarTransfer, lib/calendarGuide).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

export const CALENDAR_GUIDE_TEXT = {
  menuItem: "Importa o esporta",
  eyebrow: "Calendario",
  title: "Importa o esporta",
  honesty:
    "È una copia in un file .ics, non un collegamento: le modifiche fatte dopo non passano da sole da un'app all'altra. Quando cambia qualcosa, ripeti l'esportazione o l'importazione.",
  directionQuestion: "Cosa vuoi fare?",
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
  loading: "Un momento…",
  chooseFile: "Scegli il file",
  tooBig: "Il file è troppo grande (massimo 5 MB). Esporta un periodo più breve dal tuo calendario e riprova.",
  unreadable: "Non è stato possibile leggere il file. Riprova o scegli un altro file .ics.",
  empty: (warning?: string) =>
    `Nel file non ci sono eventi da importare.${warning ? ` ${warning}` : ""} Scegli il file .ics esportato dal tuo calendario.`,
  previewSummary: (count: number, recurring: number, changed: number) =>
    `Nel file ${count === 1 ? "c'è 1 evento" : `ci sono ${count} eventi`}${recurring ? ` (${recurring} si ${recurring === 1 ? "ripete" : "ripetono"})` : ""}${
      changed ? `, più ${changed === 1 ? "1 giorno modificato" : `${changed} giorni modificati`} di una serie` : ""
    }.`,
  previewRange: (from: string, to?: string) => (to ? `Dal ${from} al ${to}.` : `Il ${from}.`),
  previewNoDuplicates: "Se importi di nuovo lo stesso file, gli eventi già presenti vengono aggiornati, non duplicati.",
  previewMore: (count: number) => `…e altri ${count}`,
  categoryLabel: "Tipo di evento",
  categoryHint: "Usato quando il titolo non fa capire il tipo (es. «Esame», «Laboratorio»).",
  matchSubjects: (count: number) => `Collega alle mie materie in base al titolo (${count} ${count === 1 ? "riconosciuto" : "riconosciuti"})`,
  warningsTitle: "Da controllare",
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
    return parts.length
      ? `Fatto: ${parts.join(", ")} nel calendario. Puoi modificarli o eliminarli come gli altri.`
      : "Nessuna novità: gli eventi di questo file erano già tutti nel calendario.";
  },
  importAnother: "Importa un altro file"
};

/** Passi della guida (lib/calendarGuide). I nomi dei menu sono scritti in modo da restare veri tra una versione e l'altra. */
export const CALENDAR_GUIDE_STEPS = {
  download: "Scarica il file con il pulsante qui sotto: contiene i tuoi eventi, gli esami e le scadenze.",
  downloadPhone: "Scarica il file con il pulsante qui sotto: il telefono lo salva nella cartella Download.",
  downloadIos: "Scarica il file con il pulsante qui sotto: a seconda della versione, il Calendario lo apre subito oppure finisce nell'app File, nella cartella Download.",
  downloadToComputer:
    "Scarica il file con il pulsante qui sotto e mandalo al computer, per esempio per email a te stesso. Se hai fatto l'accesso con il tuo account, i dati si sincronizzano: allora puoi anche aprire StudyOS dal computer, entrare con lo stesso account e scaricarlo da lì.",
  googleOwnCalendar: "Consiglio: su calendar.google.com crea prima un calendario «StudyOS» (accanto ad «Altri calendari», +). Se vuoi ricominciare, lo elimini e reimporti il file.",
  googleSettings: "Apri calendar.google.com nel browser, fai clic sull'ingranaggio in alto e scegli «Impostazioni».",
  googleOnComputer: "Sul computer apri calendar.google.com nel browser (l'app del telefono non ha questa funzione), fai clic sull'ingranaggio in alto e scegli «Impostazioni».",
  googleImport: "Nel menu a sinistra apri «Importa ed esporta», seleziona il file e il calendario in cui aggiungerlo, poi premi «Importa».",
  googleOnPhone: "Dopo qualche minuto gli eventi compaiono anche nell'app Google Calendar del telefono.",
  googleExport:
    "Nel menu a sinistra apri «Importa ed esporta» e premi «Esporta»: scarichi un file .zip con un file .ics per ogni calendario. Per un solo calendario, usa «Esporta calendario» nelle sue impostazioni.",
  unzip: "Apri il file .zip ed estrai il file .ics del calendario che ti serve.",
  samsungOpenFile: "Apri l'app «I miei file», vai in «Download» e tocca il file che finisce con .ics.",
  samsungSave: "Se ti chiede con cosa aprirlo, scegli «Calendario»: controlla gli eventi, scegli in quale calendario metterli e salva.",
  samsungMenu: "Se il file non si apre, nell'app Calendario apri il menu (☰ oppure ⋮), poi le impostazioni, e cerca «Importa».",
  samsungExport: "Nell'app Calendario apri il menu (☰ oppure ⋮), poi le impostazioni, e cerca «Esporta»: salva il file .ics nel telefono. Il nome cambia un po' con la versione.",
  samsungGoogle: "Se non trovi «Esporta» e il calendario è collegato a un account Google, esportalo dal computer su calendar.google.com.",
  iosOpenFile: "Se il Calendario non si è aperto, apri l'app «File», vai in «Download» e tocca il file che finisce con .ics.",
  iosAddAll: "Nell'anteprima del Calendario tocca «Aggiungi tutti» e scegli il calendario. Consiglio: creane prima uno «StudyOS» (Calendario, «Calendari», «Aggiungi»).",
  macOpen: "Fai doppio clic sul file scaricato, oppure nell'app Calendario usa «File», poi «Importa…».",
  macPick: "Scegli il calendario in cui aggiungere gli eventi: meglio uno nuovo, «StudyOS» («File», poi «Nuovo calendario»), così puoi eliminarlo e reimportare.",
  macSelect: "Nell'app Calendario seleziona, nella colonna a sinistra, il calendario da portare in StudyOS.",
  macExport: "Usa «File», poi «Esporta», poi «Esporta…» e salva il file .ics. Non scegliere «Archivio Calendario»: è un altro formato.",
  outlookClassicImport: "Outlook classico: «File», poi «Apri ed esporta», poi «Importa/Esporta», e scegli di importare un file iCalendar (.ics).",
  outlookWebImport: "Nuovo Outlook o outlook.com: nel Calendario premi «Aggiungi calendario», poi «Carica da file», e scegli il file e il calendario.",
  outlookOnComputer: "Sul computer apri outlook.com nel browser: nel Calendario premi «Aggiungi calendario», poi «Carica da file», e scegli il file e il calendario.",
  outlookOnPhone: "Gli eventi compaiono anche nell'app Outlook, sul computer e sul telefono, con lo stesso account.",
  outlookSave: "Outlook classico: seleziona il calendario, poi «File» e «Salva calendario». In «Altre opzioni» scegli le date e «Dettagli completi».",
  outlookNoFile: "Il nuovo Outlook e outlook.com non salvano il calendario in un file: se lo stesso calendario è anche su Google, esportalo da calendar.google.com.",
  chooseFile: "Torna qui e premi «Scegli il file»: prima di aggiungere qualcosa vedrai un'anteprima.",
  chooseFilePhone: "Torna qui, tocca «Scegli il file» e cercalo nei file del telefono (di solito in Download): prima di aggiungere vedrai un'anteprima.",
  chooseFileFromComputer:
    "Porta il file .ics su questo dispositivo (per esempio per email a te stesso) e tocca «Scegli il file», oppure apri StudyOS dal computer. Prima di aggiungere vedrai un'anteprima."
};

/** Perché una combinazione non si fa da quel dispositivo, e dove si fa. */
export const CALENDAR_GUIDE_REDIRECT = {
  appleOnlyApple: "Il Calendario di Apple c'è solo su iPhone, iPad e Mac: segui i passi da uno di questi.",
  appleIosNoFile:
    "Il Calendario di iPhone e iPad non salva i calendari in un file. Serve un Mac con lo stesso account iCloud: da lì esporti il calendario e poi lo scegli in StudyOS.",
  appleOnlyMac: "Solo il Calendario del Mac salva i calendari in un file .ics: segui i passi dal Mac.",
  samsungOnlySamsung: "Il Calendario Samsung c'è solo sui telefoni e tablet Samsung: segui i passi da lì.",
  outlookOnlyWindows: "Solo Outlook classico per Windows salva il calendario in un file .ics: le app per telefono, per Mac e outlook.com non lo fanno."
};
