// Calendario: vista, modulo evento, ripetizioni e portate, promemoria, ricorrenze, vacanze, colori, festività.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.
import { hostOf } from "../labels";

/** Calendario: intestazione, menu "Altre azioni", viste, filtro per materia, riepiloghi, stati vuoti. */
export const CALENDAR_TEXT = {
  subtitle: "Lezioni, studio, scadenze ed esami.",
  newEvent: "Nuovo evento",
  importFile: "Importa da un altro calendario",
  exportFile: "Esporta il calendario",
  share: "Condividi",
  subjectSummary: "Riepilogo per materia",
  examSummary: "Riepilogo esami",
  backToCalendar: "Torna al calendario",
  viewsLabel: "Vista calendario",
  dayFocus: "Solo 8–19, ore grandi",
  dayFocusTitle: "Mostra il giorno dalle 8 alle 19, con le ore più grandi",
  /** Sul telefono "Solo 8–19" e "Festività" stanno in «Altre azioni»: la voce dice cosa fa. */
  dayFocusOff: "Mostra tutte le ore",
  holidaysShow: "Mostra le festività",
  holidaysHide: "Nascondi le festività",
  filterLabel: "Mostra gli impegni di una materia",
  allSubjects: "Tutte",
  onlySubject: (name: string) => `Solo: ${name}`,
  clearFilter: (name: string) => `Togli «Solo: ${name}» e mostra tutte le materie`,
  showAll: "Mostra tutte le materie",
  addEvent: "Aggiungi un evento",
  emptySubject: (name: string) => `Nessun impegno di ${name} in questo periodo`,
  emptyWeek: "Settimana senza impegni",
  sharedCalendars: "Calendari condivisi:",
  summaryCounts: (planned: number, withItems: number) =>
    `${planned} ${planned === 1 ? "materia" : "materie"} nel piano di studio · ${withItems} con impegni in calendario`,
  summaryHint: "Tocca una materia per vedere nel calendario solo i suoi impegni.",
  summaryItems: (items: number) => (items === 1 ? "1 impegno in calendario" : `${items} impegni in calendario`),
  summaryBreakdown: ({ events, weekly, exams, deadlines }: { events: number; weekly: number; exams: number; deadlines: number }) =>
    [
      events ? `${events} ${events === 1 ? "evento" : "eventi"}${weekly ? ` (${weekly} ogni settimana)` : ""}` : "",
      exams ? `${exams} ${exams === 1 ? "esame" : "esami"}` : "",
      deadlines ? `${deadlines} ${deadlines === 1 ? "scadenza" : "scadenze"}` : ""
    ]
      .filter(Boolean)
      .join(" · "),
  summaryShow: (name: string) => `Mostra solo ${name} nel calendario`,
  summaryCompleted: "Superata",
  openSubject: "Apri materia",
  openSubjectAria: (name: string) => `Apri la materia ${name}`,
  summaryEmptyTitle: "Ancora nessuna materia",
  summaryEmptyBody: "Aggiungi le tue materie: qui vedrai quanti impegni hai in calendario per ognuna e potrai mostrarne una sola.",
  goSubjects: "Vai a Materie",
  openExamAria: (name: string) => `Apri l'esame di ${name}`
} as const;

/** Aiuto "?" del Calendario (HelpTip): testi ed esempi. */
export const CALENDAR_HELP = {
  views: {
    title: "Le viste del calendario",
    text: "Giorno, Settimana e Mese mostrano gli impegni sul calendario; Agenda li elenca per le prossime due settimane. Tocca un orario libero per aggiungere un evento.",
    example: "tocca martedì alle 10 per segnare la lezione di Anatomia."
  },
  shared: {
    title: "Calendari condivisi",
    text: "I bordi tratteggiati sono eventi di un'altra persona. Tocca il suo nome per mostrarli o nasconderli.",
    example: "nascondi il calendario di Giulia per vedere solo il tuo."
  }
} as const;

/** Griglie del calendario: eventi nascosti su schermi stretti ("+N") ed eventi su più giorni. */
export const CALENDAR_LAYOUT_TEXT = {
  more: (count: number) => `+${count}`,
  moreAria: (count: number) => `${count === 1 ? "Un altro evento" : `Altri ${count} eventi`} in questa fascia: apri l'elenco`,
  /** Colonna troppo stretta (Settimana sul tablet): la fascia è un solo pulsante con tutti i suoi eventi. */
  merged: (count: number) => `${count} ${count === 1 ? "evento" : "eventi"}`,
  mergedAria: (count: number) => (count === 1 ? "1 evento sovrapposto: apri l'elenco" : `${count} eventi che si sovrappongono: apri l'elenco`),
  dayOfSpan: (index: number, total: number) => `giorno ${index} di ${total}`
} as const;

/** Un solo modulo per creare e modificare un evento (Principali · Aspetto e collocazione · Altre opzioni). */
export const EVENT_EDITOR_TEXT = {
  newEvent: "Nuovo evento",
  newTask: "Nuova attività",
  editEvent: "Modifica evento",
  viewShared: (name: string) => `Evento di ${name}`,
  editShared: (name: string) => `Modifica evento di ${name}`,
  kindLabel: "Cosa vuoi aggiungere",
  kindEvent: "Evento",
  kindEventTitle: "Un impegno con giorno e orario: lezione, studio, laboratorio…",
  kindTask: "Attività con scadenza",
  kindTaskTitle: "Una cosa da fare entro una data, da spuntare quando è fatta",
  taskHint: "Comparirà nel calendario il giorno della scadenza e nella sezione Attività.",
  calendarOf: "Nel calendario di",
  myCalendar: "Il mio calendario",
  calendarGone: "Non puoi più aggiungere eventi in quel calendario: l'evento andrà nel tuo.",
  sectionMain: "Principali",
  sectionLook: "Aspetto e collocazione",
  sectionMore: "Altre opzioni",
  sectionMoreHint: "ripetizione, promemoria, descrizione, luogo, collegamenti",
  /** Senza collegamenti (calendario di un'altra persona, evento importato): la sezione non li ha. */
  sectionMoreHintNoLinks: "ripetizione, promemoria, descrizione, luogo",
  /** Evento di un'altra persona: i promemoria sono personali e la sezione non li ha. */
  sectionMoreHintOther: "ripetizione, descrizione, luogo, collegamenti",
  sectionMoreHintOtherNoLinks: "ripetizione, descrizione, luogo",
  /** Lezione: la ripetizione è già in vista, il riassunto di «Altre opzioni» non la elenca. */
  withoutRepeat: (hint: string) => hint.replace(/^ripetizione, /, ""),
  remindersPersonal: "I promemoria sono personali: negli eventi di un'altra persona non si impostano.",
  /** Giorno di una serie altrui cambiato da solo: la ripetizione è della serie. */
  repeatSharedRow: "Questo giorno è stato cambiato da solo: per cambiare la ripetizione apri un altro giorno della serie.",
  title: "Titolo",
  titlePlaceholder: "Es. Lezione di Anatomia",
  taskTitlePlaceholder: "Es. Consegnare la relazione di laboratorio",
  start: "Inizio",
  end: "Fine",
  day: "Giorno",
  firstDay: "Dal",
  lastDay: "Al",
  due: "Scadenza",
  duration: "Durata",
  durationCustom: "Altra durata",
  durationLabel: (text: string) => `Durata: ${text}`,
  daysLabel: (count: number) => (count === 1 ? "1 giorno" : `${count} giorni`),
  allDay: "Tutto il giorno",
  allDayHint: "Occupa giornate intere, senza orari",
  /** Tipologia «Vacanza» scelta nel modulo completo: passa a tutto il giorno (come «Nuova vacanza»). */
  vacationAllDay: "Una vacanza occupa giornate intere: scegli il primo e l'ultimo giorno in «Dal» e «Al».",
  endFollows: "Se cambi l'inizio, la fine si sposta e la durata resta la stessa.",
  /** Ripetizione personalizzata il cui schema non comprende il giorno d'inizio: il motore lo conta comunque. */
  repeatStartExtra: (day: string) => `Anche ${day}, il giorno d'inizio, che conta come la prima volta.`,
  /** Regola «fino al» un giorno che non è una delle volte (es. domenica 22): l'ultima volta vera. */
  repeatLastTime: (day: string) => `(ultima volta ${day})`,
  type: "Tipologia",
  typeOccasions: "Ogni anno",
  color: "Colore",
  colorAuto: (type: string) => `Colore di «${type}»`,
  colorAutoHint: "Segue la tipologia e la materia",
  colorCustom: "Scegli un altro colore",
  colorPreview: "Anteprima",
  subject: "Materia",
  subjectOptional: "Materia (facoltativa)",
  subjectNone: "Nessuna",
  subjectChoose: "Scegli una materia",
  subjectNoneShared: "Nessuna materia condivisa",
  subjectOwner: "La materia è di chi ha creato l'evento: da qui non si cambia.",
  priority: "Priorità",
  status: "Stato",
  description: "Descrizione (facoltativa)",
  descriptionPlaceholder: "Es. Aula 3, portare gli appunti del capitolo 2",
  location: "Luogo (facoltativo)",
  locationPlaceholder: "Es. Aula Magna, via Celoria 26",
  links: "Collegamenti",
  /** Nel calendario di un'altra persona il server non accetta collegamenti in un evento nuovo. */
  linksOtherCalendar: "Nel calendario di un'altra persona un evento nuovo si crea senza collegamenti.",
  linkPlaceholder: "https://…",
  linkAdd: "Aggiungi il collegamento",
  linkRemove: (label: string) => `Togli il collegamento ${label}`,
  linkInvalid: "Questo collegamento non funziona: copia l'indirizzo completo, che inizia con https://",
  importedTitle: "Appello ufficiale aggiunto al tuo calendario",
  importedTitleShared: "Appello ufficiale",
  importedHint: "Qui modifichi solo il tuo promemoria: la data ufficiale resta visibile in Esami › Date ufficiali.",
  sharedReadOnly: "Puoi solo vedere questo evento.",
  sharedEditable: (name: string) => `Le modifiche arrivano subito a ${name}, che le vede nella cronologia e può ripristinarle.`,
  sharedSeries: "Si ripete: le modifiche valgono per tutte le sue date.",
  occurrenceOf: (day: string) => `Si ripete · stai guardando ${day}`,
  save: "Salva",
  saveCreate: "Aggiungi evento",
  saveTask: "Aggiungi attività",
  cancel: "Annulla",
  close: "Chiudi",
  delete: "Elimina evento",
  deleteConfirm: (title: string) => `Eliminare l'evento «${title}»? Non si può annullare.`,
  deleteShared: (title: string, owner: string) => `Eliminare «${title}» dal calendario di ${owner}? Resta nella sua cronologia e può ripristinarlo.`,
  deleteSeriesConfirm: (title: string) => `Eliminare l'evento «${title}»? Si ripete: verranno eliminate tutte le sue date. Non si può annullare.`,
  deleteAction: "Elimina",
  unsavedTitle: "Chiudere senza salvare?",
  unsavedText: "Le modifiche fatte in questo modulo andranno perse.",
  unsavedDiscard: "Chiudi senza salvare",
  unsavedKeep: "Continua a modificare",
  simpleForm: "Modulo completo",
  simpleFormHint: "Materia, priorità, ripetizione e il resto",
  titleMissing: "Scrivi un titolo per l'evento.",
  dateMissing: "Scegli una data valida.",
  endBeforeStart: "La fine viene prima dell'inizio: sposta «Fine» dopo l'inizio.",
  lastDayBeforeFirst: "L'ultimo giorno viene prima del primo: scegli un giorno uguale o successivo.",
  repeatEndsEarly: "La ripetizione finisce prima dell'inizio: scegli una fine dopo il primo giorno.",
  subjectMissing: "Scegli una materia per continuare.",
  saveFailed: "Modifiche non salvate. Riprova.",
  addFailed: "Evento non aggiunto. Riprova.",
  deleteFailed: "Evento non eliminato. Riprova.",
  moveFailed: (title: string) => `«${title}» non è stato spostato. Riprova.`,
  sharedGone: "Questo evento non è più condiviso con te.",
  sharedGoneDraft: "L'evento che stavi modificando non è più condiviso con te: le modifiche non salvate sono andate perse."
} as const;

/** Scelta "Solo questo · Questo e i successivi · Tutti" per modifica, spostamento ed eliminazione. */
export const SCOPE_TEXT = {
  titleEdit: (title: string) => `Salvare le modifiche a «${title}»?`,
  titleMove: (title: string) => `Spostare «${title}»?`,
  titleDelete: (title: string) => `Eliminare «${title}»?`,
  intro: "Questo evento si ripete. A quali date vuoi applicarlo?",
  this: "Solo questo",
  following: "Questo e i successivi",
  all: "Tutti",
  /** Una riga breve sotto ogni scelta; le conseguenze per intero sono in «Dettagli». */
  thisShort: (day: string) => `Solo ${day}.`,
  followingShort: (day: string) => `Da ${day} in poi.`,
  allShort: ({ from, until, past }: { from?: string; until?: string; past: boolean }) =>
    from && until ? `Da ${from} a ${until}.` : from ? `Da ${from} in poi.` : until ? `Fino a ${until}.` : past ? "Tutte le date, anche quelle passate." : "Tutte le date.",
  allDeleteShort: (past: boolean) => (past ? "Tutta la serie, anche le date passate." : "Tutta la serie."),
  allDeleteFamilyShort: "Tutta la serie, anche le parti cambiate prima.",
  sharedAllShort: "Tutte le date insieme.",
  details: "Dettagli",
  thisEdit: (day: string) => `Cambia solo l'evento di ${day}; gli altri restano come sono.`,
  thisMove: (day: string) => `Sposta solo l'evento di ${day}; gli altri restano dove sono.`,
  thisDelete: (day: string) => `Elimina solo l'evento di ${day}; gli altri restano.`,
  thisSubject: "La materia però cambia per tutta la serie.",
  followingEdit: (day: string) => `Cambia l'evento di ${day} e tutti quelli dopo; quelli prima restano come sono.`,
  followingMove: (day: string) => `Sposta l'evento di ${day} e tutti quelli dopo; quelli prima restano dove sono.`,
  followingDelete: (day: string) => `Elimina l'evento di ${day} e tutti quelli dopo, comprese le modifiche fatte ai singoli giorni.`,
  /** Regola nuova: le parti cambiate prima con "Questo e i successivi" prendono la ripetizione nuova e perdono ciò che avevano di loro. */
  followingSplits:
    "Dopo questa data avevi già cambiato la serie con «Questo e i successivi»: anche quelle date prendono la ripetizione nuova e perdono il titolo, l'orario e gli altri dettagli che avevano cambiato.",
  /** Le date di quelle parti che la ripetizione nuova non ha (es. "ven 4, 11, 18 dic"). */
  followingGone: (dates: string, more: boolean) => `Spariscono: ${dates}${more ? " e altre date dopo" : ""}.`,
  /** Senza regola nuova le parti cambiate prima restano (R1-S1). */
  followingKeepsSplits: "Dopo questa data avevi già cambiato la serie con «Questo e i successivi»: quelle date restano nei loro giorni e prendono solo ciò che hai cambiato qui.",
  /** Spostando il giorno: le parti cambiate prima con gli stessi giorni e lo stesso orario si spostano anche loro. */
  followingMovesSplits: "Dopo questa data avevi già cambiato la serie con «Questo e i successivi»: anche quelle date si spostano e prendono ciò che hai cambiato qui.",
  followingSplitsOwnDays: "Dove avevi già cambiato giorni o orario, quelle date restano dove sono.",
  followingSplitsOwnTime: "Dove avevi già cambiato l'orario, resta quello.",
  followingKeepsEnd: "La serie finisce quando finiva prima.",
  /** La modifica sposta l'ultima data della serie (es. "martedì 22 dicembre"). */
  followingNewEnd: (day: string) => `La serie ora finisce ${day}.`,
  /** Regola nuova che non ha il giorno aperto: da dove riprende la serie (es. "martedì 17 novembre"). */
  followingStartsOn: (day: string) => `Da qui la serie riprende ${day}, il primo giorno che corrisponde alla nuova ripetizione.`,
  /** Spostando, una data arriva sul giorno di un'altra parte della serie: quel giorno ci sono tutti e due (es. "lun 30 nov"). */
  followingBoth: (dates: string) => `Ci saranno entrambi gli eventi, quello spostato e quello che c'era già: ${dates}.`,
  /** Da un giorno cambiato da solo: i successivi prendono ciò che quel giorno ha di suo (vedi followingPatch). */
  followingTakesDay: "Anche i giorni dopo prendono il titolo e i dettagli che questo giorno aveva solo per sé.",
  /** Regola con più giorni della settimana spostata: tutti i giorni dello stesso scarto (es. "lun–ven", "mar–sab"). */
  followingDaysShift: (from: string, to: string) => `Da questo giorno in poi le date passano da ${from} a ${to}.`,
  allDaysShift: (from: string, to: string) => `Tutte le date passano da ${from} a ${to}.`,
  /** "Tutti": le date che cambiano davvero (una parte di una serie divisa, o tutta la serie). */
  allEdit: ({ from, until, past }: { from?: string; until?: string; past: boolean }) =>
    from && until
      ? `Cambia le date di questa serie da ${from} a ${until}; le altre restano come sono.`
      : from
        ? `Cambia tutte le date di questa serie da ${from} in poi; quelle prima restano come sono.`
        : until
          ? `Cambia le date di questa serie fino a ${until}; quelle dopo, già cambiate con «Questo e i successivi», restano come sono.`
          : past
            ? "Cambia tutte le date della serie, anche quelle passate."
            : "Cambia tutte le date della serie.",
  allMove: ({ from, until, past }: { from?: string; until?: string; past: boolean }) =>
    from && until
      ? `Sposta allo stesso modo le date di questa serie da ${from} a ${until}; le altre restano dove sono.`
      : from
        ? `Sposta allo stesso modo tutte le date di questa serie da ${from} in poi; quelle prima restano dove sono.`
        : until
          ? `Sposta allo stesso modo le date di questa serie fino a ${until}; quelle dopo, già cambiate con «Questo e i successivi», restano dove sono.`
          : past
            ? "Sposta tutte le date della serie allo stesso modo, anche quelle passate."
            : "Sposta tutte le date della serie allo stesso modo.",
  allDelete: (past: boolean) => (past ? "Elimina tutta la serie, con tutte le sue date, anche quelle passate." : "Elimina tutta la serie, con tutte le sue date."),
  allDeleteFamily: "Elimina tutta la serie, comprese le parti modificate in precedenza con «Questo e i successivi».",
  /** Che cosa succede ai giorni cambiati o annullati da soli (calcolato prima di salvare). */
  changedLost: (count: number) =>
    count === 1
      ? "1 giorno che avevi cambiato da solo perde la sua modifica e torna come il resto della serie."
      : `${count} giorni che avevi cambiato da soli perdono le loro modifiche e tornano come il resto della serie.`,
  changedGone: (count: number) =>
    count === 1
      ? "1 giorno che avevi cambiato da solo non fa più parte della serie: sparisce, con la sua modifica."
      : `${count} giorni che avevi cambiato da soli non fanno più parte della serie: spariscono, con le loro modifiche.`,
  cancelledBack: (count: number) => (count === 1 ? "1 giorno che avevi annullato torna nel calendario." : `${count} giorni che avevi annullato tornano nel calendario.`),
  rowsKept: "I giorni che avevi cambiato o annullato da soli restano così.",
  othersKept: "Gli altri giorni che avevi cambiato o annullato da soli restano così.",
  ownLost: "Questo giorno perde la modifica fatta solo a lui e diventa come il resto della serie.",
  newStart: (day: string) => `La serie ora inizia ${day}, il primo giorno che corrisponde alla nuova ripetizione.`,
  sharedAll: "Negli eventi di altre persone si cambiano tutte le date insieme.",
  pinZone: (zone: string) => `Da adesso gli orari di questa serie restano quelli del fuso orario ${zone}, anche se apri StudyOS da un altro paese.`,
  cancel: "Annulla"
} as const;

/** Promemoria nel modulo: scelte pronte, personalizzati, onestà su dove suonano. */
export const REMINDER_PICKER_TEXT = {
  label: "Promemoria",
  none: "Nessun promemoria",
  add: "Aggiungi promemoria",
  remove: (text: string) => `Togli il promemoria «${text}»`,
  custom: "Personalizzato",
  amount: "Quanto prima",
  unit: "Unità",
  units: { minutes: "minuti prima", hours: "ore prima", days: "giorni prima" },
  at: "Alle (facoltativo)",
  addCustom: "Aggiungi",
  invalid: "Scrivi un numero valido: fino a 4 settimane prima.",
  where: "Suonano dentro StudyOS quando è aperta, e in Google o Apple Calendar se esporti il calendario. Ad app chiusa non arrivano: quelli persi nelle ultime 24 ore compaiono nella campanella quando la riapri."
} as const;

/** Percorso "Nuova ricorrenza": compleanni, anniversari e altre date di ogni anno. */
export const OCCASION_FORM_TEXT = {
  menu: "Nuova ricorrenza",
  newTitle: "Nuova ricorrenza",
  editTitle: "Modifica ricorrenza",
  kind: "Che cosa ricordi",
  name: (kind: string) => (kind === "birthday" ? "Di chi è il compleanno" : "Nome"),
  namePlaceholder: (kind: string) =>
    kind === "birthday" ? "Es. Giulia" : kind === "anniversary" ? "Es. Anniversario di matrimonio" : kind === "holiday" ? "Es. Festa del paese" : "Es. Rinnovo dell'abbonamento",
  birthdayTitle: (name: string) => `Compleanno di ${name}`,
  /** Inizi di titolo che non fanno parte del nome (ricorrenze create senza nome, es. dall'agente). */
  titlePrefixes: ["Compleanno di ", "Onomastico di "],
  day: "Giorno",
  month: "Mese",
  year: "Anno (facoltativo)",
  yearPlaceholder: "Es. 2001",
  yearHint: (kind: string) => (kind === "birthday" ? "Con l'anno di nascita vedi quanti anni compie." : "Con l'anno di inizio vedi quanti anni sono."),
  notes: "Note (facoltative)",
  notesPlaceholder: "Es. idea regalo: un libro di cucina",
  next: (day: string, age: string) => (age ? `Prossima volta: ${day} · ${age}` : `Prossima volta: ${day}`),
  automatic: "Ogni anno, tutto il giorno. Chi è nato il 29 febbraio lo festeggia il 28 negli anni non bisestili.",
  nameMissing: "Scrivi un nome.",
  dayInvalid: "Questo giorno non esiste in quel mese.",
  yearInvalid: "Scrivi un anno a quattro cifre, non nel futuro (es. 2001).",
  save: "Salva ricorrenza",
  delete: "Elimina ricorrenza",
  deleteConfirm: (title: string) => `Eliminare «${title}» da tutti gli anni? Non si può annullare.`
} as const;

/** Percorso "Nuova vacanza": un solo evento su più giorni. */
export const VACATION_FORM_TEXT = {
  menu: "Nuova vacanza",
  newTitle: "Nuova vacanza",
  editTitle: "Modifica vacanza",
  name: "Nome",
  namePlaceholder: "Es. Vacanza a Lisbona",
  days: "Dal… al…",
  daysHint: "Partenza e ritorno compresi, tutto il giorno.",
  destination: "Destinazione (facoltativa)",
  destinationPlaceholder: "Es. Lisbona",
  notes: "Note (facoltative)",
  notesPlaceholder: "Es. volo alle 7:40 da Malpensa",
  nameMissing: "Scrivi un nome per la vacanza.",
  daysMissing: "Scegli il primo e l'ultimo giorno.",
  save: "Salva vacanza",
  delete: "Elimina vacanza",
  deleteConfirm: (title: string) => `Eliminare la vacanza «${title}»? Spariscono tutti i suoi giorni. Non si può annullare.`
} as const;

/** "Altre azioni › Colori delle tipologie": colore predefinito di ogni tipologia, sincronizzato. */
export const TYPE_COLORS_TEXT = {
  menu: "Colori delle tipologie",
  title: "Colori delle tipologie",
  intro: "Ogni tipologia ha un colore. Gli eventi lo prendono da soli, tranne quelli a cui hai scelto un colore a mano.",
  subjectNote: "Lezione, Studio, Laboratorio e Ripasso con una materia usano il colore della materia.",
  reset: "Ripristina",
  resetAria: (type: string) => `Ripristina il colore predefinito di ${type}`,
  isDefault: "Predefinito",
  chooseFor: (type: string) => `Colore di ${type}`,
  saveFailed: "Colore non salvato. Riprova."
} as const;

/** Nomi dei colori della tavolozza per i lettori di schermo (i codici esadecimali non dicono nulla). */
export const EVENT_COLOR_NAME: Record<string, string> = {
  "#EF4444": "rosso",
  "#F97316": "arancione",
  "#FACC15": "giallo",
  "#A3E635": "verde lime",
  "#22C55E": "verde",
  "#14B8A6": "verde petrolio",
  "#7CF7C8": "verde acqua",
  "#06B6D4": "azzurro",
  "#3B82F6": "blu",
  "#6366F1": "indaco",
  "#A855F7": "viola",
  "#D946EF": "fucsia",
  "#EC4899": "rosa",
  "#B45309": "marrone",
  "#FFFFFF": "bianco",
  "#D4D4D4": "grigio chiaro"
};

export const colorName = (hex: string) => `Colore ${EVENT_COLOR_NAME[hex.toUpperCase()] ?? hex}`;

/**
 * Calendario come si vede (griglie, Mese, Agenda, elenco del telefono, anteprima): fascia "tutto il
 * giorno", "+N", festività, Attività senza data, calendari di altre persone.
 */
export const CALENDAR_VIEW_TEXT = {
  allDayRow: "Tutto il giorno",
  allDayRowTitle: "Eventi senza orario, su più giorni, festività, esami e attività in scadenza",
  examDate: "Data appello",
  moreTasks: (count: number) => `+${count} ${count === 1 ? "altra" : "altre"}`,
  moreItems: (count: number) => `+${count} ${count === 1 ? "altro" : "altri"}`,
  moreItemsAria: (count: number, day: string) => `${count === 1 ? "Un altro impegno" : `Altri ${count} impegni`} ${day}: apri il giorno`,
  showLess: "Mostra meno",
  hiddenBefore: (count: number, hour: string) => `${count} ${count === 1 ? "evento prima" : "eventi prima"} delle ${hour} · mostra tutte le ore`,
  hiddenAfter: (count: number, hour: string) => `${count} ${count === 1 ? "evento dopo" : "eventi dopo"} le ${hour} · mostra tutte le ore`,
  gridTitle: "Clicca su un orario libero per aggiungere un evento",
  monthCellTitle: "Clicca per aggiungere un evento in questo giorno",
  /** Nome del giorno nelle intestazioni: prima il testo visibile ("lun 3"), poi l'azione. */
  openDay: (visible: string, long: string) => `${visible}, apri ${long}`,
  noItems: "Nessun impegno",
  addOn: (day: string) => `Aggiungi un evento il ${day}`,
  recurring: "Si ripete",
  /** Evento cominciato il giorno prima (passa la mezzanotte), in un elenco sotto il giorno dopo. */
  continues: "continua",
  continuedFrom: (day: string, start: string, end: string) => `Dal ${day}, ${start}–${end}`,
  /** Mese sul telefono: pallini delle voci del giorno, oltre i primi tre. */
  moreDots: (count: number) => `+${count}`,
  exam: (name: string) => `Esame · ${name}`,
  examTitle: (name: string, preparation: number) => `Esame di ${name} · preparazione al ${preparation}%`,
  /** Azione detta solo a voce dopo il testo visibile di una voce. */
  openAction: "apri",
  bandTitle: (from: string, to: string) => `Dalle ${from} alle ${to}`,
  bandCount: (count: number) => `${count} ${count === 1 ? "evento" : "eventi"} in questa fascia`,
  holidaysTitle: "Mostra o nascondi festività e ricorrenze italiane",
  holidaysOfPeriod: "Festività del periodo:",
  undated: (count: number) => `Senza data · ${count}`,
  undatedAria: (count: number) => `${count === 1 ? "1 attività" : `${count} attività`} senza data: scegli quando farle`,
  undatedTitle: "Attività senza data",
  undatedIntro: "Scegli un giorno e l'attività compare nel calendario, con scadenza alle 18:00 (puoi cambiarla aprendola).",
  undatedEmpty: "Tutte le attività hanno una data.",
  undatedOpen: (title: string) => `Apri l'attività "${title}"`,
  overdue: (count: number) => `In ritardo · ${count}`,
  overdueGroup: "Attività in ritardo",
  todayTitle: (day: string) => `Oggi · ${day}`,
  tomorrowTitle: (day: string) => `Domani · ${day}`,
  agendaEmptyTitle: "Niente in programma",
  agendaEmptyBody: "In queste due settimane non hai eventi, scadenze o esami: quello che aggiungi comparirà qui, giorno per giorno.",
  markDone: (title: string) => `Segna "${title}" come fatta`,
  markTodo: (title: string) => `Segna "${title}" come da fare`,
  openTask: (title: string) => `Apri l'attività "${title}"`,
  task: "Attività",
  noDate: "Nessuna data",
  estimated: (time: string) => `${time} stimati`,
  actual: (minutes: number) => `${minutes} min reali`,
  completedLate: "Completata in ritardo",
  sharedGroup: "Calendari di altre persone",
  showOwner: (name: string) => `Mostra gli eventi di ${name}`,
  hideOwner: (name: string) => `Nascondi gli eventi di ${name}`,
  sharedFiltered: "Con «Solo» attivo gli eventi di altre persone non si vedono: usano le loro materie.",
  unknownOwner: "Un'altra persona"
} as const;

export const OCCASION_KIND_LABEL: Record<"birthday" | "anniversary" | "holiday" | "recurring-day", string> = {
  birthday: "Compleanno",
  anniversary: "Anniversario",
  holiday: "Festa o ricorrenza personale",
  "recurring-day": "Altro ogni anno"
};

export const HOLIDAY_NAME = {
  newYear: "Capodanno",
  epiphany: "Epifania",
  valentine: "San Valentino",
  fatThursday: "Giovedì grasso",
  fatTuesday: "Martedì grasso",
  ashWednesday: "Mercoledì delle Ceneri",
  womensDay: "Festa della donna",
  fathersDay: "Festa del papà",
  palmSunday: "Domenica delle Palme",
  easter: "Pasqua",
  easterMonday: "Lunedì dell'Angelo (Pasquetta)",
  liberation: "Festa della Liberazione",
  labour: "Festa dei lavoratori",
  mothersDay: "Festa della mamma",
  republic: "Festa della Repubblica",
  assumption: "Ferragosto",
  grandparents: "Festa dei nonni",
  saintFrancis: "San Francesco d'Assisi",
  halloween: "Halloween",
  allSaints: "Ognissanti",
  allSouls: "Commemorazione dei defunti",
  immaculate: "Immacolata Concezione",
  christmasEve: "Vigilia di Natale",
  christmas: "Natale",
  saintStephen: "Santo Stefano",
  newYearsEve: "San Silvestro",
  summerTime: "Inizia l'ora legale (lancette avanti di un'ora)",
  winterTime: "Torna l'ora solare (lancette indietro di un'ora)"
} as const;

export const HOLIDAY_KIND_LABEL: Record<"national" | "celebration" | "clock", string> = {
  national: "Festa nazionale",
  celebration: "Ricorrenza",
  clock: "Cambio dell'ora"
};

export const HOLIDAYS_TOGGLE_LABEL = "Festività";

/**
 * Testo di un link di un appello: «ufficiale UniMi» solo se porta davvero a unimi.it (o a un suo
 * sottodominio); gli altri mostrano dove portano, così un link cambiato non si spaccia per l'ateneo.
 */
export const eventLinkLabel = (href: string | undefined) => {
  let url: URL;
  try {
    url = new URL(href ?? "");
  } catch {
    return "Apri il link";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "Apri il link";
  const host = url.hostname.toLowerCase();
  if (host === "unimi.it" || host.endsWith(".unimi.it")) return "Apri la pagina ufficiale UniMi";
  return `Apri la pagina · ${hostOf(href)}`;
};
