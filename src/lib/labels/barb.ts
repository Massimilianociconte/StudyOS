// Corso di laurea (insegnamenti e fonti ufficiali BARB).
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

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

/** Tipo di pagina ufficiale da cui arrivano i dati del corso (sezione Fonti). */
export const UNIVERSITY_SOURCE_KIND_LABEL: Record<string, string> = {
  "calendario-didattico": "Calendario delle lezioni",
  "contatti-ufficiali": "Contatti",
  "elenco-insegnamenti": "Elenco insegnamenti",
  "manifesto-pdf": "Manifesto (PDF)",
  "piano-didattico": "Piano didattico",
  "scheda-corso": "Scheda del corso"
};
