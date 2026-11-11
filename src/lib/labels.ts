// Etichette italiane per i valori enum salvati nei dati: la UI non mostra mai i codici interni.
import type { Attachment, CalendarEvent, Exam, Goal, StudySession, Subject, Task } from "../types";
import type { InviteBlock, ItemRevision, ShareAction, ShareInviteStatus, SharePermission, ShareScope } from "./sharing";
import type { RevertSummary } from "./shareHistory";

export const PRIORITY_LABEL: Record<Task["priority"], string> = {
  low: "Bassa",
  medium: "Media",
  high: "Alta",
  urgent: "Urgente"
};

export const ENERGY_LABEL: Record<Task["energy"], string> = {
  low: "Energia bassa",
  medium: "Energia media",
  high: "Energia alta"
};

export const TASK_STATUS_LABEL: Record<Task["status"], string> = {
  todo: "Da fare",
  doing: "In corso",
  blocked: "Bloccata",
  done: "Completata",
  postponed: "Rimandata",
  archived: "Archiviata"
};

export const SUBJECT_STATUS_LABEL: Record<Subject["status"], string> = {
  "not-started": "Non iniziata",
  active: "In corso",
  review: "Da ripassare",
  "exam-ready": "Pronta per l'esame",
  completed: "Completata",
  archived: "Archiviata"
};

const countWord = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Archiviare una materia dalla sua scheda (con Annulla) ed eliminarla per sempre dalle Archiviate. */
export const SUBJECT_REMOVE_TEXT = {
  archive: "Archivia",
  archiveAria: (name: string) => `Archivia ${name}`,
  archived: (name: string) => `«${name}» archiviata: attività, esami e materiali restano. La ritrovi in «Archiviate».`,
  undo: "Annulla",
  deleteForever: "Elimina per sempre",
  deleteAria: (name: string) => `Elimina per sempre ${name}`,
  confirm: (name: string, exams: number, graded: number, topics: number) => {
    const parts = [
      exams ? `${countWord(exams, "esame", "esami")}${graded ? " (voti compresi)" : ""}` : "",
      topics ? countWord(topics, "argomento", "argomenti") : ""
    ].filter(Boolean);
    const single = parts.length === 1 && exams + topics === 1;
    const lost = parts.length ? ` Si ${single ? "cancella" : "cancellano"} anche ${parts.join(" e ")}.` : "";
    return `Eliminare per sempre «${name}»?${lost} Attività, eventi, sessioni e materiali restano, senza materia. Non si può annullare.`;
  }
} as const;

/** Pezzi comuni dell'interfaccia: menu "Altre azioni", aiuto "?" (HelpTip), aggiunta rapida. */
export const UI_TEXT = {
  moreActions: "Altre azioni",
  help: "Aiuto",
  helpAria: (title: string) => `Aiuto: ${title}`,
  example: "Per esempio:",
  close: "Chiudi",
  /** Scadenza dell'attività nell'aggiunta rapida: parte vuota, si può scegliere. */
  dueOptional: "Entro quando? (facoltativa)"
} as const;

/** Un solo nome, ovunque, per aggiungere le date d'esame ufficiali dell'università. */
export const OFFICIAL_EXAMS_ADD_LABEL = "Aggiungi appelli ufficiali";

export const EXAM_STATUS_LABEL: Record<Exam["status"], string> = {
  planning: "Da pianificare",
  studying: "In preparazione",
  reviewing: "In ripasso",
  ready: "Pronto per l'esame",
  done: "Sostenuto"
};

/** Esami: intestazione, schede, collegamenti della scheda d'esame, stati vuoti, date ufficiali. */
export const EXAMS_TEXT = {
  title: "Esami",
  subtitle: "Le date dei tuoi esami, quanto sei pronto e le date ufficiali degli appelli. Voti e medie sono in Libretto e laurea.",
  tabsLabel: "Quali esami vedere",
  tabPersonal: "I miei esami",
  tabOfficial: "Date ufficiali",
  addExam: "Aggiungi esame",
  recordGrade: "Registra un voto",
  shareProgress: "Condividi i progressi",
  study: "Studia",
  readiness: "Quanto sei pronto",
  tasksLink: (count: number) => `${count} attività da fare`,
  tasksAria: (name: string) => `Apri le attività di ${name}`,
  studyLink: (time: string) => `${time} di studio`,
  studyAria: (name: string) => `Studia ${name}: apre il timer con la materia già scelta`,
  studyTimeAria: (name: string) => `Tempo già studiato per ${name}: apri lo Studio con questa materia`,
  topicsLink: (count: number) => `${count} ${count === 1 ? "argomento" : "argomenti"} da ripassare`,
  topicsAria: "Apri gli argomenti da ripassare in Studio",
  riskHigh: "Sei indietro",
  riskMedium: "Un po' indietro",
  noSubjectsTitle: "Ancora nessuna materia",
  noSubjectsBody: "Ogni esame appartiene a una materia: aggiungi prima la materia, poi la data dell'esame. Per esempio: Biochimica, poi l'esame del 14 febbraio.",
  goToSubjects: "Vai a Materie",
  pickFromDegree: "Scegli dal corso di laurea",
  noUpcomingTitle: "Ancora nessun esame in arrivo",
  noUpcomingBody: "Aggiungi la data del prossimo esame: qui vedrai i giorni che mancano e quanto sei pronto. Per esempio: Biochimica, 14 febbraio alle 9:00.",
  officialTitle: "Date ufficiali degli appelli",
  courseFilter: "Insegnamento",
  allCourses: "Tutti gli insegnamenti",
  legacy: "Vecchio piano di studi (F92)",
  browseByCourse: "Sfoglia per insegnamento",
  browseByCourseHint: "Scegli un insegnamento per vedere tutte le sue date, anche quelle passate.",
  coursesInPlan: (count: number) => `${count} insegnamenti nel piano`,
  sameDay: (days: number) => `${days} ${days === 1 ? "giorno" : "giorni"} con più appelli`,
  noSessionsInPeriodBody: "Cambia periodo, oppure scegli un insegnamento nel filtro qui sopra per vedere tutte le sue date.",
  incompleteSources: "Alcune fonti ufficiali sono incomplete: qui vedi solo le date verificate.",
  registrations: (count: number) => `${count} iscrizioni diverse: tocca per sceglierne una`,
  registrationsCount: (count: number) => `${count} iscrizioni negli elenchi ufficiali`,
  officialEyebrow: "Appello ufficiale"
} as const;

/** Tipo di prova e momento degli appelli ufficiali. */
export const BARB_EXAM_TYPE_LABEL: Record<string, string> = {
  written: "Scritto",
  oral: "Orale",
  practical: "Pratico",
  exam: "Esame",
  partial: "Parziale"
};
export const BARB_EXAM_TYPE_MISSING = "Tipo non pubblicato";
export const BARB_EXAM_TIMING_LABEL = { passato: "Passato", prossimo: "Prossimo", futuro: "Futuro" } as const;

/** Aiuto "?" della sezione Esami. */
export const EXAMS_HELP = {
  riskHigh: {
    title: "Sei indietro",
    text: "Mancano meno di 10 giorni e la preparazione è sotto il 70%.",
    example: "mancano 8 giorni e sei al 60%. Dopo ogni sessione di studio alza la preparazione con +."
  },
  riskMedium: {
    title: "Un po' indietro",
    text: "Mancano meno di 20 giorni e la preparazione è sotto il 55%.",
    example: "mancano 15 giorni e sei al 40%. Dopo ogni sessione di studio alza la preparazione con +."
  },
  readiness: {
    title: "Quanto sei pronto",
    text: "Quanto ti senti pronto, da 0 a 100%. Lo decidi tu: aggiornalo con + e − dopo lo studio.",
    example: "hai finito metà del programma → 50%."
  },
  official: (covered: number, total: number, sessions: number, checked: string) => ({
    title: "Date ufficiali",
    text: `Le date d'esame pubblicate dall'università per tutti gli insegnamenti del corso: ${covered} insegnamenti su ${total} hanno date, ${sessions} appelli in tutto (fonti controllate il ${checked}). Non entrano nel tuo calendario finché non le aggiungi. Se un insegnamento non ha date, non vuol dire che non ci siano esami: qui compaiono solo le date verificate.`,
    example: "tocca un appello per vedere orario, aula e date di iscrizione."
  }),
  sameDay: (dates: string) => ({
    title: "Più appelli nello stesso giorno",
    text: `${dates}. Stesso giorno non vuol dire stessa ora: controlla gli orari nei dettagli di ogni appello.`
  }),
  legacy: {
    title: "Vecchio piano di studi (F92)",
    text: "Insegnamenti del piano di studi degli anni passati. Ti servono solo se devi ancora sostenere un esame del vecchio piano."
  }
} as const;

/** Libretto e laurea: corso di laurea in sola lettura, stato vuoto. */
export const CAREER_TEXT = {
  rulesOf: (name: string, level: string, cfu: number) => `Regole di: ${name} · ${level} · ${cfu} CFU`,
  changeInSettings: "Cambia in Impostazioni",
  changeInSettingsAria: "Cambia il corso di laurea in Impostazioni",
  basis: "Media da usare",
  recordGrade: "Registra un voto",
  emptyTitle: "Ancora nessun voto nel libretto",
  emptyBody: "Registra i voti degli esami che hai superato: medie e voto di laurea previsto si aggiornano da soli. Per esempio: Biochimica, 28, 6 CFU."
} as const;

/** Aiuto "?" di Libretto e laurea e del pannello del voto. */
export const CAREER_HELP = {
  weighted: {
    title: "Media ponderata",
    text: "Gli esami con più CFU contano di più. La lode vale 30.",
    example: "30 in un esame da 12 CFU e 24 in uno da 6 → (30×12 + 24×6) / 18 = 28."
  },
  arithmetic: {
    title: "Media aritmetica",
    text: "Media semplice dei voti: ogni esame conta uguale, qualunque sia il numero di CFU.",
    example: "30 e 24 → (30 + 24) / 2 = 27."
  },
  cfu: {
    title: "CFU acquisiti",
    text: "I crediti degli esami superati, idoneità comprese, sul totale del tuo corso di laurea.",
    example: "superi un esame da 6 CFU → i CFU acquisiti salgono di 6."
  },
  base: {
    title: "Voto di partenza",
    text: "La media ponderata portata su 110: è il punto da cui parte il voto di laurea.",
    example: "media 27 → 27 × 110 / 30 = 99."
  },
  basis: {
    title: "Media da usare",
    text: "Puoi includere i voti obiettivo degli esami che devi ancora dare, per vedere dove arriveresti."
  },
  passFail: {
    title: "Idoneità",
    text: "Esame senza voto: ti dà i CFU ma non entra nella media.",
    example: "inglese B2."
  },
  honors: {
    title: "Lode",
    text: "Nella media vale 30. In alcuni corsi aggiunge punti al voto di laurea."
  }
} as const;

/** Corso di laurea: filtri cliccabili, fonti, dettagli tecnici chiusi per chi gestisce l'app. */
export const BARB_TEXT = {
  meta: (name: string, year: string, verified: string) => `${name} · anno accademico ${year} · dati verificati il ${verified}`,
  degreeRow: "Corso di laurea",
  semesterFilterOn: "Filtro attivo",
  semesterFilterOff: "Mostra solo questi",
  semesterHelpTitle: (label: string) => `Orario del ${label}`,
  coursesTile: "Insegnamenti",
  coursesTileHint: (offered: number) => `${offered} attivi quest'anno`,
  teachersTile: "Docenti",
  teachersTileHint: (contacts: number) => `${contacts} contatti ufficiali`,
  mine: "Nelle tue materie",
  mineGroupAria: "Nelle tue materie: mostra solo quelle, anche per semestre",
  mineAll: (count: number) => `Tutte · ${count}`,
  mineSemester: (label: string, count: number, cfu: number) => `${label} · ${count} ${count === 1 ? "insegnamento" : "insegnamenti"} · ${cfu} CFU`,
  openDetails: "Apri i dettagli",
  alreadyAdded: "Già nelle tue materie",
  officialSource: "Fonte ufficiale:",
  openOfficialPage: "Apri la pagina ufficiale",
  verifiedOn: (date: string) => `verificata il ${date}`,
  reliability: (percent: number) => `Affidabilità stimata dei dati: ${percent}%`,
  sourceAddress: "Indirizzo della fonte:",
  conflictNote: "Da verificare:",
  lastUpdate: (date: string, changes: number) => `${date} · ${changes} ${changes === 1 ? "modifica" : "modifiche"}`,
  technicalDetails: "Dettagli tecnici (per chi gestisce l'app)",
  technicalPages: (count: number) => `${count} pagine controllate all'ultimo aggiornamento, con il codice di risposta`,
  technicalLog: "Registro degli aggiornamenti"
} as const;

/** Tipo di insegnamento nel piano di studi (prima in BarbView). */
export const BARB_CHARACTER_LABEL: Record<string, string> = {
  obbligatorio: "Obbligatorio",
  "opzionale-scelta-guidata": "Scelta guidata",
  "scelta-libera": "Scelta libera",
  lingua: "Lingua",
  "altre-conoscenze": "Altre conoscenze",
  "tirocinio-tesi": "Tirocinio e tesi"
};

/** Aiuto "?" della sezione Corso di laurea. */
export const BARB_HELP = {
  ssd: {
    title: "Settore (SSD)",
    text: "Il codice della disciplina usato dall'università.",
    example: "BIO/10 è Biochimica."
  },
  choiceGroup: {
    title: "Gruppi a scelta",
    text: "Da ogni gruppo scegli il numero di insegnamenti indicato accanto al titolo.",
    example: "dal Gruppo 2 ne scegli 2, per 12 CFU."
  },
  ariel: {
    title: "Ariel",
    text: "La piattaforma dell'Università di Milano con i materiali del corso: dispense, avvisi e registrazioni."
  }
} as const;

export const GOAL_STATUS_LABEL: Record<Goal["status"], string> = {
  active: "Attivo",
  paused: "In pausa",
  done: "Raggiunto",
  archived: "Archiviato"
};

export const GOAL_CATEGORY_LABEL: Record<Goal["category"], string> = {
  study: "Studio",
  exam: "Esame",
  notes: "Appunti",
  review: "Ripasso",
  streak: "Costanza",
  fitness: "Sport",
  personal: "Personale",
  project: "Progetto"
};

export const SESSION_STATUS_LABEL: Record<StudySession["status"], string> = {
  planned: "Pianificata",
  running: "In corso",
  completed: "Completata",
  skipped: "Saltata"
};

export const SESSION_TEMPLATE_LABEL: Record<StudySession["template"], string> = {
  "new-topic": "Nuovo argomento",
  review: "Ripasso",
  exercises: "Esercizi",
  "exam-simulation": "Simulazione esame",
  "pdf-reading": "Lettura PDF",
  "notes-cleanup": "Riordino appunti",
  memorization: "Memorizzazione",
  lab: "Laboratorio",
  "oral-prep": "Preparazione orale"
};

export const EVENT_CATEGORY_LABEL: Record<CalendarEvent["category"], string> = {
  study: "Studio",
  lesson: "Lezione",
  lab: "Laboratorio",
  exam: "Esame",
  review: "Ripasso",
  deadline: "Scadenza",
  project: "Progetto",
  gym: "Palestra",
  personal: "Personale",
  work: "Lavoro",
  relax: "Relax",
  other: "Altro"
};

export const EVENT_STATUS_LABEL: Record<CalendarEvent["status"], string> = {
  planned: "Pianificato",
  "in-progress": "In corso",
  done: "Fatto",
  skipped: "Saltato"
};

/** Calendario: intestazione, menu "Altre azioni", viste, filtro per materia, riepiloghi, stati vuoti. */
export const CALENDAR_TEXT = {
  subtitle: "Lezioni, studio, scadenze ed esami.",
  newEvent: "Nuovo evento",
  importFile: "Importa da un altro calendario",
  exportFile: "Esporta il calendario",
  share: "Condividi",
  officialDates: "Date ufficiali degli appelli",
  subjectSummary: "Riepilogo per materia",
  examSummary: "Riepilogo esami",
  backToCalendar: "Torna al calendario",
  viewsLabel: "Vista calendario",
  dayFocus: "Solo 8–19, ore grandi",
  dayFocusTitle: "Mostra il giorno dalle 8 alle 19, con le ore più grandi",
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

/** Selettore di data e ora (DateField, DateTimeField, DateRangeField): nomi di giorni e mesi, testi. */
export const DATE_PICKER_TEXT = {
  weekdaysShort: ["lun", "mar", "mer", "gio", "ven", "sab", "dom"],
  weekdaysLong: ["lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica"],
  monthsShort: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
  monthsLong: ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"],
  previousMonth: "Mese precedente",
  nextMonth: "Mese successivo",
  previousYear: "Anno precedente",
  nextYear: "Anno successivo",
  previousYears: "Anni precedenti",
  nextYears: "Anni successivi",
  chooseMonthYear: (title: string) => `${title}: scegli mese e anno`,
  chooseYear: (year: number) => `${year}: scegli l'anno`,
  backToDays: "Torna ai giorni",
  today: "Oggi",
  todaySuffix: "oggi",
  done: "Fatto",
  clear: "Togli la data",
  noDate: "Nessuna data",
  chooseDate: "Scegli la data",
  chooseDateTime: "Scegli data e ora",
  chooseRange: "Scegli i giorni",
  time: "Ora",
  timeInput: "Scrivi l'ora",
  timePlaceholder: "hh:mm",
  timeSlots: "Orari",
  timeInvalid: "Ora non valida: scrivi per esempio 9:30 o 14.15.",
  timeTooEarly: (min: string) => `Scegli un orario dalle ${min} in poi.`,
  rangeStartHint: "Tocca il primo giorno",
  rangeEndHint: "Ora tocca l'ultimo giorno",
  days: (count: number) => (count === 1 ? "1 giorno" : `${count} giorni`)
} as const;

/** Colore semantico della priorità (token del tema, leggibile in chiaro e scuro). */
export const PRIORITY_TONE: Record<Task["priority"], string> = {
  low: "var(--faint)",
  medium: "var(--accent-2)",
  high: "var(--warning)",
  urgent: "var(--accent-3)"
};

export type AttachmentKind = "pdf" | "image" | "video" | "doc" | "link" | "file";

export const attachmentKind = (attachment: Pick<Attachment, "mimeType" | "name" | "externalUrl">): AttachmentKind => {
  const mime = attachment.mimeType.toLowerCase();
  const name = attachment.name.toLowerCase();
  const url = attachment.externalUrl?.toLowerCase() ?? "";
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/") || /youtube\.com|youtu\.be|vimeo\.com/.test(url)) return "video";
  if (/word|document|presentation|sheet|excel|powerpoint|text\/plain|markdown/.test(mime)) return "doc";
  if (attachment.externalUrl) return "link";
  return "file";
};

export const ATTACHMENT_KIND_LABEL: Record<AttachmentKind, string> = {
  pdf: "PDF",
  image: "Immagine",
  video: "Video",
  doc: "Documento",
  link: "Link",
  file: "File"
};

export const ATTACHMENT_KIND_ICON: Record<AttachmentKind, string> = {
  pdf: "FileText",
  image: "Image",
  video: "PlayCircle",
  doc: "FileText",
  link: "Link",
  file: "Paperclip"
};

const decimal = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });

/** Ore con la virgola decimale italiana: 0,8 h. */
export const formatHours = (minutes: number) => decimal.format(Math.round((minutes / 60) * 10) / 10);

/** Durata leggibile: 45 min, 2 h, 13 h 55 min. */
export const formatMinutes = (minutes: number) => {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

export const formatNumber = (value: number) => decimal.format(value);

/** Tipo di pagina ufficiale da cui arrivano i dati del corso (sezione Fonti). */
export const UNIVERSITY_SOURCE_KIND_LABEL: Record<string, string> = {
  "calendario-didattico": "Calendario delle lezioni",
  "contatti-ufficiali": "Contatti",
  "elenco-insegnamenti": "Elenco insegnamenti",
  "manifesto-pdf": "Manifesto (PDF)",
  "piano-didattico": "Piano didattico",
  "scheda-corso": "Scheda del corso"
};

/** Etichetta degli eventi senza orario, che occupano l'intera giornata. */
export const ALL_DAY_LABEL = "Tutto il giorno";

/** Evento senza materia, o con una materia che non si conosce (es. di un'altra persona, non condivisa). */
export const NO_SUBJECT_LABEL = "Senza materia";

/**
 * Prima lettera maiuscola: nomi di giorni/mesi da date-fns a inizio frase, etichette
 * dinamiche in Tag/Pill. Non tocca il resto della stringa (acronimi e nomi propri salvi).
 */
export const capitalizeFirst = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

export const hostOf = (url: string | undefined) => {
  if (!url) return "";
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

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

// ——— Condivisione ———

export const SHARE_SCOPE_LABEL: Record<ShareScope, string> = {
  calendar: "Calendario",
  barb_exams: "Appelli ufficiali",
  tasks: "Attività",
  study: "Studio",
  progress: "Progressi",
  materials: "Materiali",
  goals: "Obiettivi"
};

export const SHARE_SCOPE_HINT: Record<ShareScope, string> = {
  calendar: "Eventi e lezioni, compresi gli appelli che hai aggiunto",
  barb_exams: "Solo gli appelli ufficiali che hai scelto (in sola lettura)",
  tasks: "Le cose da fare, con scadenza",
  study: "Sessioni di studio e argomenti da ripassare",
  progress: "Esami ancora da sostenere e preparazione, mai i voti",
  materials: "File, link e note",
  goals: "I tuoi traguardi"
};

export const SHARE_PERMISSION_LABEL: Record<SharePermission, string> = {
  view: "Può vedere",
  edit: "Può modificare"
};

export const SHARE_INVITE_STATUS_LABEL: Record<ShareInviteStatus, string> = {
  pending: "In attesa",
  accepted: "Accettato",
  declined: "Rifiutato",
  expired: "Scaduto"
};

/** Cosa non è andato a buon fine quando fallisce un'azione appena fatta (pannello Condividi, sezione Condivisione). */
export const SHARE_ACTION_FAILED: Record<ShareAction, string> = {
  invite: "Invito non creato.",
  share: "Condivisione non salvata.",
  accept: "Invito non accettato.",
  decline: "Invito non rifiutato.",
  cancel: "Invito non annullato.",
  update: "Permessi non aggiornati.",
  revoke: "Condivisione non tolta.",
  leave: "Non sei uscito dalla condivisione.",
  open: "Invito non aperto.",
  history: "Cronologia non caricata.",
  restore: "Ripristino non riuscito.",
  revertCheck: "Controllo non riuscito.",
  revert: "Modifiche non annullate.",
  save: "Modifiche non salvate.",
  delete: "Elemento non eliminato."
};

/**
 * Testi del dettaglio di un elemento di un'altra persona. `who` è il nome di chi condivide già adatto
 * a una frase ("Giulia Rossi", "un'altra persona"; vedi actorInSentence): i testi aggiungono "Di", "a", "dai dati di".
 */
export const SHARED_ITEM_TEXT = {
  gone: "Questo elemento non è più condiviso con te.",
  invalidField: (label: string) => `Controlla «${label}»: serve un valore valido.`,
  readOnlyIntro: (who: string) => `Di ${who}: puoi solo vedere.`,
  editIntro: (who: string) => `Di ${who}: le modifiche arrivano subito anche a ${who}, che può ripristinarle dalla cronologia.`,
  deleteConfirm: (title: string, who: string) => `Eliminare «${title}» dai dati di ${who}? Resta nella sua cronologia e può ripristinarlo.`
} as const;

/** Perché un invito aperto da link non si può accettare (il link salvato su questo dispositivo si toglie). */
export const SHARE_INVITE_BLOCKED: Record<InviteBlock, string> = {
  invalid: "Link non valido, oppure l'invito è stato annullato.",
  own: "È un tuo invito: mandalo a un'altra persona.",
  otherAccount: "Questo invito è per un altro indirizzo email: accedi con quell'account e riapri il link.",
  accepted: "Invito già usato.",
  declined: "Invito rifiutato.",
  expired: "Invito scaduto: chiedine uno nuovo."
};

/** Schede della sezione Condivisione. */
export const SHARING_TAB_LABEL = {
  mine: "Condivisi da me",
  received: "Condivisi con me",
  invites: "Inviti",
  history: "Modifiche di altri"
} as const;

/** Testi del pulsante e del pannello Condividi che non dipendono da un valore enum. */
export const SHARE_TEXT = {
  opening: "Apro…",
  loadFailed: "Non riesco ad aprire Condividi: controlla la connessione e riprova. Se succede ancora, ricarica la pagina.",
  done: "Fatto",
  linkOnce: "Il link non si può rivedere dopo aver chiuso questa finestra: se lo perdi, crea un nuovo invito.",
  /** Dopo il nome di un gruppo tra i destinatari: il codice del gruppo non scade, chi entra dopo vede anche lui. */
  groupTarget: "tutto il gruppo, anche chi entrerà dopo"
} as const;

/** Una condivisione da cambiare o togliere che sul server non c'è più (tolta altrove, o non più tua). */
export const SHARE_GONE_TEXT = "Questa condivisione non c'è più.";

/** Avviso della condivisione mostrato in ogni sezione (AppShell), lì dove si è fatta la modifica. */
export const SHARE_NOTICE_TEXT = {
  denied: (owner: string) => `Non hai più il permesso di modificare i dati di ${owner || "questa persona"}: la modifica non è stata salvata.`,
  dismiss: "Ok",
  dismissTitle: "Chiudi l'avviso sulla condivisione"
} as const;

export const REVISION_CHANGE_LABEL: Record<ItemRevision["change"], string> = {
  create: "ha aggiunto",
  update: "ha modificato",
  delete: "ha eliminato"
};

/** "Calendario (Può modificare), Attività (Può vedere)". */
export const scopesSummary = (offers: ReadonlyArray<{ scope: ShareScope; permission: SharePermission }>) =>
  offers.map((offer) => `${SHARE_SCOPE_LABEL[offer.scope]} (${SHARE_PERMISSION_LABEL[offer.permission]})`).join(", ");

/** Tipo di elemento condivisibile, per la cronologia ("ha modificato l'evento …"). */
export const SHARED_ENTITY_LABEL: Record<string, string> = {
  calendarEvent: "evento",
  task: "attività",
  studySession: "sessione di studio",
  studyTopic: "argomento",
  exam: "esame",
  attachment: "materiale",
  note: "nota",
  goal: "obiettivo"
};

/** Etichetta di un tipo che arriva dal server: i nomi di Object.prototype ("constructor"…) non sono tipi. */
export const sharedEntityLabel = (type: string) =>
  Object.hasOwn(SHARED_ENTITY_LABEL, type) ? SHARED_ENTITY_LABEL[type] : "elemento";

/** Chi ha fatto una modifica quando non si sa il nome: in testa a una frase, e in mezzo ("prima che un'altra persona…"). */
export const UNKNOWN_PERSON = "Un'altra persona";
export const UNKNOWN_PERSON_IN_SENTENCE = "un'altra persona";

/**
 * Intestazione della cronologia. La lista ha un tetto (`limit`): se è piena le modifiche più vecchie
 * possono mancare e lo dice, invece di promettere "gli ultimi 90 giorni".
 */
export const revisionListIntro = (shown: number, limit: number) =>
  `${shown >= limit ? `Ultime ${limit} modifiche degli ultimi 90 giorni (le più vecchie non compaiono).` : "Ultimi 90 giorni."} «Ripristina» riporta l'elemento alla versione prima della modifica.`;

/** "1 elemento" / "3 elementi" con la frase accordata al numero. */
const several = (count: number, one: string, many: (count: number) => string) => (count === 1 ? one : many(count));

/**
 * "Modifiche di altri" → annullare tutte le modifiche di una persona da un giorno. `who` è il nome già
 * adatto a una frase (actorInSentence), `day` il giorno scelto ("3 nov").
 */
/** "dal 3 nov", ma "dall'8 nov" e "dall'11 nov" (`Dal`/`Dall'` a inizio frase). */
const fromDay = (day: string, start = false) => `${start ? "D" : "d"}${/^(?:8|11)\b/.test(day) ? "all'" : "al "}${day}`;

export const REVERT_TEXT = {
  open: "Annulla le modifiche di una persona",
  intro:
    "Ogni elemento che ha modificato o eliminato torna com'era prima della sua prima modifica da quel giorno. Gli elementi che ha aggiunto restano.",
  person: "Persona",
  since: "Dal giorno",
  noPeople: "Nessuno può modificare i tuoi dati: qui compaiono le persone con «Può modificare».",
  check: "Controlla",
  checking: "Controllo…",
  close: "Chiudi",
  /** Accanto ad "Annulla" (che chiude la conferma): non deve iniziare con la stessa parola. */
  confirm: "Ripristina tutto",
  tooMany: "Troppe modifiche da quel giorno: scegli un giorno più vicino.",
  /** Tra il controllo e la conferma qualcosa è cambiato: si conferma solo ciò che si è letto. */
  changed: "Nel frattempo è cambiato qualcosa: rileggi il riepilogo e conferma di nuovo.",
  skipChanged: (count: number) =>
    several(count, "Lascia com'è l'elemento cambiato dopo da te o da altri", (n) => `Lascia come sono i ${n} elementi cambiati dopo da te o da altri`),
  skipChangedHint: "Così torna solo ciò che, dopo questa persona, nessun altro ha toccato.",
  nothing: (who: string, day: string) => `${fromDay(day, true)} ${who} non ha cambiato nulla dei tuoi dati.`,
  /** Cosa succede confermando: prima ciò che torna (e cosa si perde), poi ciò che resta com'è. */
  plan: (who: string, day: string, summary: RevertSummary) =>
    [
      summary.toRestore
        ? several(summary.toRestore, "1 elemento torna com'era", (n) => `${n} elementi tornano com'erano`) + ` prima delle modifiche di ${who} ${fromDay(day)}.`
        : "Nessun elemento da riportare indietro.",
      summary.ownerDeleted
        ? several(summary.ownerDeleted, "1 di questi l'avevi eliminato tu: torna tra i tuoi dati.", (n) => `${n} di questi li avevi eliminati tu: tornano tra i tuoi dati.`)
        : "",
      summary.ownerAfter
        ? several(summary.ownerAfter, "Su 1 di questi hai fatto modifiche anche tu, dopo: vengono sostituite.", (n) => `Su ${n} di questi hai fatto modifiche anche tu, dopo: vengono sostituite.`)
        : "",
      summary.othersAfter
        ? several(
            summary.othersAfter,
            "Su 1 di questi elementi ha fatto modifiche anche un'altra persona, dopo: si perdono anche quelle.",
            (n) => `Su ${n} di questi elementi hanno fatto modifiche anche altre persone, dopo: si perdono anche quelle.`
          )
        : "",
      summary.skipped
        ? several(summary.skipped, "1 elemento cambiato dopo da te o da altri resta com'è ora.", (n) => `${n} elementi cambiati dopo da te o da altri restano come sono ora.`)
        : "",
      summary.added
        ? several(summary.added, `1 elemento aggiunto da ${who} resta: eliminalo tu, se non ti serve.`, (n) => `${n} elementi aggiunti da ${who} restano: eliminali tu, se non ti servono.`)
        : "",
      summary.gone
        ? several(summary.gone, "1 elemento che hai eliminato tu resta eliminato.", (n) => `${n} elementi che hai eliminato tu restano eliminati.`)
        : "",
      summary.notHere
        ? several(
            summary.notHere,
            "1 elemento non è ancora arrivato su questo dispositivo e resta com'è: controlla di nuovo dopo la sincronizzazione.",
            (n) => `${n} elementi non sono ancora arrivati su questo dispositivo e restano come sono: controlla di nuovo dopo la sincronizzazione.`
          )
        : ""
    ]
      .filter(Boolean)
      .join(" "),
  done: (who: string, restored: number, notRestored: number) =>
    [
      restored
        ? several(restored, `Fatto: 1 elemento è tornato com'era prima delle modifiche di ${who}.`, (n) => `Fatto: ${n} elementi sono tornati com'erano prima delle modifiche di ${who}.`)
        : notRestored
          ? "Nessun elemento è cambiato."
          : `Nessun elemento è cambiato: le modifiche di ${who} non c'erano più da annullare.`,
      notRestored
        ? several(
            notRestored,
            "1 elemento non si è potuto ripristinare: non era più tra i tuoi dati o nella cronologia.",
            (n) => `${n} elementi non si sono potuti ripristinare: non erano più tra i tuoi dati o nella cronologia.`
          )
        : ""
    ]
      .filter(Boolean)
      .join(" ")
} as const;

/** Ripristino di una versione dalla cronologia "Modifiche di altri". */
export const RESTORE_TEXT = {
  notRestorable: "Questo elemento non si può ripristinare.",
  missing: "Questa versione non c'è più nella cronologia: aggiorna l'elenco.",
  /** Il controllo al momento di scrivere (l'elemento è sparito nel frattempo, e la versione non ha i suoi file). */
  notHere: "Questo elemento non è più tra i tuoi dati: aggiorna l'elenco e riprova.",
  /** Versione di una modifica, senza file: l'elemento non è qui e nessuna eliminazione salvata li conserva. */
  gone: (title: string) =>
    `«${title}» non è tra i tuoi dati su questo dispositivo (l'hai eliminato, o non è ancora arrivato) e questa versione non ha i suoi file: non si può ripristinare.`,
  /** Al posto di «Ripristina» quando il ripristino non riuscirebbe (gone). */
  blocked: "Non ripristinabile",
  blockedHint: "Non è tra i tuoi dati su questo dispositivo e questa versione non ha i suoi file."
} as const;
