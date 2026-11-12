// Libretto e laurea.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Libretto e laurea: riepilogo in alto, libretto, calcolo del voto di laurea. */
export const CAREER_TEXT = {
  title: "Libretto e laurea",
  subtitle: "Registra i voti degli esami: medie e voto di laurea previsto si calcolano da soli.",
  rulesOf: (name: string, level: string, cfu: number) => `Regole di: ${name} · ${level} · ${cfu} CFU`,
  changeInSettings: "Cambia in Impostazioni",
  changeInSettingsAria: "Cambia il corso di laurea in Impostazioni",
  basis: "Media da usare",
  recordGrade: "Registra un voto",
  emptyTitle: "Ancora nessun voto nel libretto",
  emptyBody: "Registra i voti degli esami che hai superato: medie e voto di laurea previsto si aggiornano da soli. Per esempio: Biochimica, 28, 6 CFU.",
  noSubjects: "Non hai ancora materie: aggiungile in Materie oppure creale mentre registri un voto.",
  goToSubjects: "Vai a Materie",

  /** Riquadro in alto: il voto previsto e i tre numeri che contano. */
  hero: {
    label: "Voto di laurea previsto",
    outOf: "/ 110",
    empty: "Registra almeno un voto, o metti un voto obiettivo agli esami in programma, per vedere la stima.",
    top: "Con queste ipotesi arrivi a 110.",
    missing: (points: string) => `Ti mancano ${points} punti per il 110.`,
    assumptions: "Stima con le tue ipotesi sulla tesi.",
    editAssumptions: "Cambia le ipotesi",
    gauge: (value: string) => `Voto di laurea previsto: ${value} su 110`,
    overTop: (total: string) => `Il calcolo dà ${total}: sopra 110 la lode la decide la commissione.`
  },
  kpi: {
    weighted: "Media ponderata",
    arithmetic: (value: string) => `Aritmetica ${value}`,
    passed: "Esami superati",
    passedNone: "Registra il primo voto",
    passedMissing: (count: number) => `${plural(count, "esame", "esami")} senza voto`,
    passedHonors: (count: number) => `${count} con lode`,
    passedPlain: "Idoneità comprese",
    cfu: "CFU acquisiti",
    cfuOf: (total: number) => `/ ${total}`,
    cfuLeft: (count: number) => `Ne mancano ${count}`,
    cfuDone: "Tutti i CFU del corso",
    cfuBar: "CFU acquisiti sul totale del corso"
  },

  /** Su telefono e tablet una parte alla volta; dal computer le due parti affiancate. */
  tabs: { label: "Parte da mostrare", libretto: "Libretto", laurea: "Voto di laurea" },

  libretto: {
    title: "Esami superati",
    sortLabel: "Ordina il libretto",
    sorts: { recent: "Recenti", grade: "Voto", cfu: "CFU" },
    missingTitle: "Superati senza voto",
    missingWhen: (date: string) => `Superato il ${date}`,
    addGrade: "Aggiungi voto",
    honors: "lode",
    passFail: "idoneo",
    open: (name: string, grade: string) => `${name}: ${grade}. Modifica il voto`,
    legend: "La lode vale 30 nella media. Le idoneità danno CFU ma non entrano nella media. Gli esami con più CFU pesano di più."
  },

  graduation: {
    title: "Come si arriva al voto",
    base: (average: string) => `Voto di partenza (media ${average} × 110 / 30)`,
    total: "Totale",
    manifesto: "Totale secondo il Manifesto 2026/27 (+1 per l'estero)",
    upTo: (points: string) => `Fino a +${points}`,
    reached: "Con queste ipotesi arrivi a 110.",
    needed: (average: string) => `Per arrivare a 110 ti serve una media ponderata di almeno ${average}.`,
    plannedTooHigh: (cfu: number, average: string) => `Gli esami in programma (${cfu} CFU) da soli non bastano: servirebbe una media di ${average}.`,
    plannedPass: (cfu: number) => `Negli esami in programma (${cfu} CFU) ti basta passarli.`,
    planned: (cfu: number, average: string) => `Negli esami in programma (${cfu} CFU) ti serve una media di ${average}.`,
    empty: "Registra almeno un voto, o metti un voto obiettivo agli esami in programma, per vedere il calcolo.",
    hypotheses: "Le tue ipotesi",
    thesisSb: "Voto che prevedi per la prova finale",
    thesisBarb: "Punti che prevedi per la tesi",
    basisRegistered: "Voti registrati",
    basisTargets: "Con obiettivi",
    basisUsed: (average: string) => `Media usata nel calcolo: ${average}`,
    basisOnlyRegistered: "Metti un voto obiettivo agli esami in programma per vedere dove arriveresti.",
    abroadSb: "Programma Erasmus svolto almeno al 70%",
    abroadBarb: "Tesi svolta all'estero o almeno 3 esami superati all'estero",
    how: "Come si calcola e fonti",
    estimate: "È una stima: voto finale, eventuali arrotondamenti e lode li decide la commissione di laurea.",
    sources: "Fonti ufficiali delle regole"
  }
} as const;

/** Modulo breve del voto (GradeDrawer): esito dell'esame, voto, idoneità o non superato. */
export const GRADE_TEXT = {
  outcome: "Esito",
  outcomeAsk: "Com'è andata?",
  outcomeGrade: "Superato con voto",
  outcomePassFail: "Superato senza voto (idoneità)",
  outcomeFailed: "Non superato o ritirato",
  failedHint: "L'esame resta tra quelli da preparare e non entra nel libretto.",
  newDate: "Nuova data (facoltativa)",
  newDateHint: "Non la sai ancora? Lasciala vuota: la scegli poi in Esami.",
  newDatePast: "La nuova data è già passata: scegline una da oggi in poi.",
  newDateInvalid: "Nuova data non valida: sceglila di nuovo.",
  recordTitle: "Registra il voto",
  saveOutcome: "Salva esito",
  // Chiudere il modulo (✕, Esc, tocco fuori, Indietro) con dati cambiati: «Annulla» e il salvataggio no.
  unsavedTitle: "Scartare le modifiche?",
  unsavedText: "Hai cambiato l'esito (voto, data, materia…) senza salvarlo.",
  unsavedKeep: "Continua a modificare",
  unsavedDiscard: "Scarta le modifiche",
  /** Pulsante del modulo per un nuovo esito: dice cosa registra. */
  recordButton: (outcome: "grade" | "passFail" | "failed") => (outcome === "passFail" ? "Registra idoneità" : "Registra voto"),
  /** «Biochimica: 28 registrato», «Biochimica: idoneità registrata» (nel libretto). */
  saved: (name: string, outcome: string, passFail: boolean, updated: boolean) =>
    `${name}: ${outcome} ${updated ? (passFail ? "aggiornata" : "aggiornato") : passFail ? "registrata" : "registrato"} nel libretto.`,
  failedSaved: (name: string, date: string | null) =>
    date
      ? `${name}: non superato. L'esame resta da preparare, con la nuova data del ${date}.`
      : `${name}: non superato. L'esame resta da preparare: scegli la nuova data in Esami quando la sai.`
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
