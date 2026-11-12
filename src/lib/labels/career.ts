// Libretto e laurea.
// Testi che si caricano con la schermata che li usa; le etichette condivise (valori enum, testi comuni) sono in ../labels.

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
